import test from 'node:test';
import assert from 'node:assert/strict';

import { patchCompaniesServiceSource } from './patch-paperclip-company-prefix.mjs';

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
