import { test } from 'node:test';
import assert from 'node:assert/strict';

import { patchHermesProfilesSource } from './patch-hermes-profile-skill-count.mjs';

const PROFILES_SOURCE = `from pathlib import Path

def _count_skills(profile_dir: Path) -> int:
    """Count installed skills in a profile."""
    skills_dir = profile_dir / "skills"
    if not skills_dir.is_dir():
        return 0
    count = 0
    for md in skills_dir.rglob("SKILL.md"):
        if "/.hub/" not in str(md) and "/.git/" not in str(md):
            count += 1
    return count
`;

test('patchHermesProfilesSource makes profile skill counts follow symlinked bundles', () => {
  const patched = patchHermesProfilesSource(PROFILES_SOURCE);
  assert.match(patched, /template-agent follow symlinked skill bundles/);
  assert.match(patched, /os\.walk\(skills_dir, followlinks=True\)/);
  assert.match(patched, /realpath\(root\)/);
});

test('patchHermesProfilesSource is idempotent', () => {
  const once = patchHermesProfilesSource(PROFILES_SOURCE);
  const twice = patchHermesProfilesSource(once);
  assert.equal(twice, once);
});
