import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  patchCompaniesServiceFile,
  patchCompaniesServiceSource,
  resolveCompaniesServiceFiles,
} from './patch-paperclip-company-prefix.mjs';

test('patchCompaniesServiceSource unwraps Drizzle duplicate issue-prefix errors', () => {
  const source = `
    function isIssuePrefixConflict(error) {
        const constraint = typeof error === "object" && error !== null && "constraint" in error
            ? error.constraint
            : typeof error === "object" && error !== null && "constraint_name" in error
                ? error.constraint_name
                : undefined;
        return typeof error === "object"
            && error !== null
            && "code" in error
            && error.code === "23505"
            && constraint === "companies_issue_prefix_idx";
    }
    async function createCompanyWithUniquePrefix(data) {
        return data;
    }
`;

  const patched = patchCompaniesServiceSource(source);

  assert.match(patched, /function unwrapIssuePrefixConflictError\(error\)/);
  assert.match(patched, /current = current\.cause;/);
  assert.match(patched, /return unwrapIssuePrefixConflictError\(error\) !== null;/);
});

test('patchCompaniesServiceSource supports TypeScript source services', () => {
  const source = `
  function isIssuePrefixConflict(error: unknown) {
    const constraint = typeof error === "object" && error !== null && "constraint" in error
      ? (error as { constraint?: string }).constraint
      : undefined;
    return typeof error === "object"
      && error !== null
      && "code" in error
      && (error as { code?: string }).code === "23505"
      && constraint === "companies_issue_prefix_idx";
  }

  async function createCompanyWithUniquePrefix(data: typeof companies.$inferInsert) {
    return data;
  }
`;

  const patched = patchCompaniesServiceSource(source);

  assert.match(patched, /function unwrapIssuePrefixConflictError\(error\)/);
  assert.match(patched, /current = current\.cause;/);
  assert.match(patched, /async function createCompanyWithUniquePrefix\(data: typeof companies\.\$inferInsert\)/);
});

test('patchCompaniesServiceSource deletes projects before goals', () => {
  const source = `
            await tx.delete(goals).where(eq(goals.companyId, id));
            await tx.delete(projects).where(eq(projects.companyId, id));
`;

  const patched = patchCompaniesServiceSource(source);

  assert(
    patched.indexOf('tx.delete(projects)') < patched.indexOf('tx.delete(goals)'),
    'projects should be deleted before goals because projects.goal_id references goals.id',
  );
});

test('patchCompaniesServiceSource is idempotent', () => {
  const source = `
    function unwrapIssuePrefixConflictError(error) {
        return error;
    }
    function isIssuePrefixConflict(error) {
        return unwrapIssuePrefixConflictError(error) !== null;
    }
`;

  assert.equal(patchCompaniesServiceSource(source), source);
});

test('resolveCompaniesServiceFiles prefers Paperclip source runtime files', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'paperclip-companies-')));
  const src = join(root, 'server/src/services/companies.ts');
  const dist = join(root, 'server/dist/services/companies.js');
  const legacy = join(root, 'global/server/dist/services/companies.js');
  await mkdir(join(root, 'server/src/services'), { recursive: true });
  await mkdir(join(root, 'server/dist/services'), { recursive: true });
  await mkdir(join(root, 'global/server/dist/services'), { recursive: true });
  await writeFile(src, 'src');
  await writeFile(dist, 'dist');
  await writeFile(legacy, 'legacy');

  const files = await resolveCompaniesServiceFiles({
    candidatePaths: [src, dist, legacy],
  });

  assert.deepEqual(files, [src, dist, legacy]);
});

test('patchCompaniesServiceFile patches every resolved service file', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'paperclip-companies-')));
  const src = join(root, 'companies.ts');
  const dist = join(root, 'companies.js');
  const source = `
    function isIssuePrefixConflict(error) {
        return false;
    }
    async function createCompanyWithUniquePrefix(data) {
        return data;
    }
`;
  await writeFile(src, source);
  await writeFile(dist, source);

  const result = await patchCompaniesServiceFile([src, dist]);

  assert.equal(result.changed, true);
  assert.equal(result.files.length, 2);
  assert.match(await readFile(src, 'utf8'), /function unwrapIssuePrefixConflictError\(error\)/);
  assert.match(await readFile(dist, 'utf8'), /function unwrapIssuePrefixConflictError\(error\)/);
});
