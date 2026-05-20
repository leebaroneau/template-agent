#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';

const DEFAULT_HERMES_PROFILES_PATH =
  '/usr/local/lib/hermes-agent/hermes_cli/profiles.py';

export function patchHermesProfilesSource(source) {
  if (source.includes('template-agent follow symlinked skill bundles')) {
    return source;
  }

  const original = `def _count_skills(profile_dir: Path) -> int:
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

  const replacement = `def _count_skills(profile_dir: Path) -> int:
    """Count installed skills in a profile."""
    # template-agent follow symlinked skill bundles
    import os

    skills_dir = profile_dir / "skills"
    if not skills_dir.is_dir():
        return 0
    count = 0
    seen_dirs = set()
    for root, dirs, files in os.walk(skills_dir, followlinks=True):
        root_str = str(root)
        real = os.path.realpath(root)
        if real in seen_dirs:
            dirs[:] = []
            continue
        seen_dirs.add(real)
        dirs[:] = [name for name in dirs if name not in {".hub", ".git"}]
        if "SKILL.md" in files and "/.hub/" not in root_str and "/.git/" not in root_str:
            count += 1
    return count
`;

  return source.replace(original, replacement);
}

export async function patchHermesProfilesFile(
  filePath = process.env.HERMES_PROFILES_PATH || DEFAULT_HERMES_PROFILES_PATH,
) {
  const source = await readFile(filePath, 'utf8');
  const patched = patchHermesProfilesSource(source);
  if (patched === source) {
    console.log('[template-agent] Hermes profile skill count patch already applied');
    return { changed: false, filePath };
  }

  await writeFile(filePath, patched);
  console.log('[template-agent] Applied Hermes profile skill count patch');
  return { changed: true, filePath };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await patchHermesProfilesFile();
}
