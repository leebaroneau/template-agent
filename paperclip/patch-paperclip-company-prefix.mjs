#!/usr/bin/env node

import { access, readFile, writeFile } from 'node:fs/promises';

const LEGACY_COMPANIES_SERVICE_PATH =
  '/usr/local/lib/node_modules/paperclipai/node_modules/@paperclipai/server/dist/services/companies.js';
const SOURCE_COMPANIES_SERVICE_PATH = '/opt/paperclip-src/server/src/services/companies.ts';
const SOURCE_DIST_COMPANIES_SERVICE_PATH = '/opt/paperclip-src/server/dist/services/companies.js';

const DEFAULT_COMPANIES_SERVICE_PATHS = [
  SOURCE_COMPANIES_SERVICE_PATH,
  SOURCE_DIST_COMPANIES_SERVICE_PATH,
  LEGACY_COMPANIES_SERVICE_PATH,
];

export async function resolveCompaniesServiceFiles({
  candidatePaths = DEFAULT_COMPANIES_SERVICE_PATHS,
  fsAccess = access,
} = {}) {
  const files = [];
  for (const candidatePath of candidatePaths) {
    try {
      await fsAccess(candidatePath);
      files.push(candidatePath);
    } catch (error) {
      if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') {
        throw error;
      }
    }
  }
  return files;
}

function buildIssuePrefixConflictReplacement(indent) {
  return `${indent}function unwrapIssuePrefixConflictError(error) {
${indent}    const seen = new Set();
${indent}    let current = error;
${indent}    while (current && typeof current === "object" && !seen.has(current)) {
${indent}        seen.add(current);
${indent}        const constraint = "constraint" in current
${indent}            ? current.constraint
${indent}            : "constraint_name" in current
${indent}                ? current.constraint_name
${indent}                : undefined;
${indent}        if ("code" in current
${indent}            && current.code === "23505"
${indent}            && constraint === "companies_issue_prefix_idx") {
${indent}            return current;
${indent}        }
${indent}        if ("cause" in current && current.cause) {
${indent}            current = current.cause;
${indent}            continue;
${indent}        }
${indent}        if ("originalError" in current && current.originalError) {
${indent}            current = current.originalError;
${indent}            continue;
${indent}        }
${indent}        if ("error" in current && current.error) {
${indent}            current = current.error;
${indent}            continue;
${indent}        }
${indent}        break;
${indent}    }
${indent}    const message = typeof error?.message === "string" ? error.message : "";
${indent}    return message.includes('duplicate key value violates unique constraint "companies_issue_prefix_idx"')
${indent}        ? error
${indent}        : null;
${indent}}
${indent}function isIssuePrefixConflict(error) {
${indent}    return unwrapIssuePrefixConflictError(error) !== null;
${indent}}
${indent}async function createCompanyWithUniquePrefix`;
}

export function patchCompaniesServiceSource(source) {
  let patched = source;
  let changed = false;

  if (!patched.includes('function unwrapIssuePrefixConflictError(error)')) {
    const next = patched.replace(
      /(\s*)function isIssuePrefixConflict\(error(?:: unknown)?\) \{[\s\S]*?\n\1async function createCompanyWithUniquePrefix/,
      (_match, indent) => buildIssuePrefixConflictReplacement(indent),
    );
    if (next !== patched) {
      patched = next;
      changed = true;
    }
  }

  const originalDeleteOrder = `            await tx.delete(goals).where(eq(goals.companyId, id));
            await tx.delete(projects).where(eq(projects.companyId, id));`;
  const replacementDeleteOrder = `            await tx.delete(projects).where(eq(projects.companyId, id));
            await tx.delete(goals).where(eq(goals.companyId, id));`;

  if (patched.includes(originalDeleteOrder)) {
    patched = patched.replace(originalDeleteOrder, replacementDeleteOrder);
    changed = true;
  }

  if (!changed) {
    return source;
  }

  return patched;
}

export async function patchCompaniesServiceFile(filePathOrPaths = process.env.PAPERCLIP_COMPANIES_SERVICE_PATH || null) {
  const filePaths = filePathOrPaths
    ? Array.isArray(filePathOrPaths)
      ? filePathOrPaths
      : [filePathOrPaths]
    : await resolveCompaniesServiceFiles();

  if (filePaths.length === 0) {
    throw new Error(`Unable to find Paperclip companies service file in: ${DEFAULT_COMPANIES_SERVICE_PATHS.join(', ')}`);
  }

  const files = [];
  for (const filePath of filePaths) {
    const source = await readFile(filePath, 'utf8');
    const patched = patchCompaniesServiceSource(source);
    if (patched === source) {
      files.push({ changed: false, filePath });
      continue;
    }

    await writeFile(filePath, patched);
    files.push({ changed: true, filePath });
  }

  const changed = files.some((file) => file.changed);
  console.log(
    changed
      ? '[agent-stack] Applied Paperclip company prefix patch'
      : '[agent-stack] Paperclip company prefix patch already applied',
  );
  return { changed, filePath: files[0]?.filePath, files };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await patchCompaniesServiceFile();
}
