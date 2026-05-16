#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';

const DEFAULT_COMPANIES_SERVICE_PATH =
  '/usr/local/lib/node_modules/paperclipai/node_modules/@paperclipai/server/dist/services/companies.js';

export function patchCompaniesServiceSource(source) {
  let patched = source;
  let changed = false;

  const replacement = `    function unwrapIssuePrefixConflictError(error) {
        const seen = new Set();
        let current = error;
        while (current && typeof current === "object" && !seen.has(current)) {
            seen.add(current);
            const constraint = "constraint" in current
                ? current.constraint
                : "constraint_name" in current
                    ? current.constraint_name
                    : undefined;
            if ("code" in current
                && current.code === "23505"
                && constraint === "companies_issue_prefix_idx") {
                return current;
            }
            if ("cause" in current && current.cause) {
                current = current.cause;
                continue;
            }
            if ("originalError" in current && current.originalError) {
                current = current.originalError;
                continue;
            }
            if ("error" in current && current.error) {
                current = current.error;
                continue;
            }
            break;
        }
        const message = typeof error?.message === "string" ? error.message : "";
        return message.includes('duplicate key value violates unique constraint "companies_issue_prefix_idx"')
            ? error
            : null;
    }
    function isIssuePrefixConflict(error) {
        return unwrapIssuePrefixConflictError(error) !== null;
    }
    async function createCompanyWithUniquePrefix`;

  if (!patched.includes('function unwrapIssuePrefixConflictError(error)')) {
    const next = patched.replace(
      /    function isIssuePrefixConflict\(error\) \{[\s\S]*?    async function createCompanyWithUniquePrefix/,
      replacement,
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

export async function patchCompaniesServiceFile(
  filePath = process.env.PAPERCLIP_COMPANIES_SERVICE_PATH || DEFAULT_COMPANIES_SERVICE_PATH,
) {
  const source = await readFile(filePath, 'utf8');
  const patched = patchCompaniesServiceSource(source);
  if (patched === source) {
    console.log('[agent-stack] Paperclip company prefix patch already applied');
    return { changed: false, filePath };
  }

  await writeFile(filePath, patched);
  console.log('[agent-stack] Applied Paperclip company prefix patch');
  return { changed: true, filePath };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await patchCompaniesServiceFile();
}
