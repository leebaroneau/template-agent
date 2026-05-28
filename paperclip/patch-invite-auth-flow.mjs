#!/usr/bin/env node

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// Paperclip ≤2026.513: npm global install → node_modules path
// Paperclip ≥2026.525: source install → /opt/paperclip-src/server
const DEFAULT_UI_ASSETS_DIR =
  '/opt/paperclip-src/server/ui-dist/assets';

const FALLBACK_UI_ASSETS_DIRS = [
  DEFAULT_UI_ASSETS_DIR,
  '/usr/local/lib/node_modules/paperclipai/node_modules/@paperclipai/server/ui-dist/assets',
];

const BROKEN_INVITE_AUTH_SUCCESS = 'onSuccess:async()=>{T(null),kae(i),await e.invalidateQueries({queryKey:z.auth.session});const Z=await e.fetchQuery({queryKey:z.companies.all,queryFn:()=>Jo.list(),retry:!1});if(F!=null&&F.companyId&&Z.some(Y=>Y.id===F.companyId)){HL(i),n(F.companyId,{source:"manual"}),t("/",{replace:!0});return}if(!(!F||F.inviteType!=="bootstrap_ceo"))try{const Y=await pe.mutateAsync();_ae(Y)&&t("/",{replace:!0})}catch{return}},';

const FIXED_INVITE_AUTH_SUCCESS = 'onSuccess:async()=>{T(null),kae(i),await e.invalidateQueries({queryKey:z.auth.session});if(F&&(F.inviteType==="bootstrap_ceo"||F.allowedJoinTypes!=="agent"))try{const Z=await pe.mutateAsync();_ae(Z)&&t("/",{replace:!0});return}catch{return}let Z=[];try{Z=await e.fetchQuery({queryKey:z.companies.all,queryFn:()=>Jo.list(),retry:!1})}catch{return}if(F!=null&&F.companyId&&Z.some(Y=>Y.id===F.companyId)){HL(i),n(F.companyId,{source:"manual"}),t("/",{replace:!0});return}},';

export function patchInviteAuthFlowSource(source) {
  if (source.includes(FIXED_INVITE_AUTH_SUCCESS)) {
    return source;
  }

  const patched = source.replace(BROKEN_INVITE_AUTH_SUCCESS, FIXED_INVITE_AUTH_SUCCESS);
  if (patched === source) {
    throw new Error('Unable to patch Paperclip invite auth flow');
  }

  return patched;
}

export async function findInviteUiAssetFile(
  assetsDir = process.env.PAPERCLIP_UI_ASSETS_DIR || null,
) {
  const dirs = assetsDir ? [assetsDir] : FALLBACK_UI_ASSETS_DIRS;
  for (const dir of dirs) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.js')) continue;
      const filePath = join(dir, entry.name);
      const source = await readFile(filePath, 'utf8');
      if (
        source.includes('Invite not available')
        && source.includes('Pr.signUpEmail')
        && (source.includes(BROKEN_INVITE_AUTH_SUCCESS) || source.includes(FIXED_INVITE_AUTH_SUCCESS))
      ) {
        return filePath;
      }
    }
  }
  throw new Error(`Unable to find Paperclip invite UI asset in: ${dirs.join(', ')}`);
}

export async function patchInviteAuthFlowFile({
  filePath = process.env.PAPERCLIP_INVITE_UI_ASSET_PATH || null,
  assetsDir = process.env.PAPERCLIP_UI_ASSETS_DIR || DEFAULT_UI_ASSETS_DIR,
} = {}) {
  const resolvedFilePath = filePath || await findInviteUiAssetFile(assetsDir);
  const source = await readFile(resolvedFilePath, 'utf8');
  const patched = patchInviteAuthFlowSource(source);
  if (patched === source) {
    console.log('[agent-stack] Paperclip invite auth flow patch already applied');
    return { changed: false, filePath: resolvedFilePath };
  }

  await writeFile(resolvedFilePath, patched);
  console.log('[agent-stack] Applied Paperclip invite auth flow patch');
  return { changed: true, filePath: resolvedFilePath };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    await patchInviteAuthFlowFile();
  } catch (err) {
    // Non-fatal: newer Paperclip versions may have fixed the invite auth
    // flow upstream and no longer have the target asset file.
    console.warn('[agent-stack] patch-invite-auth-flow skipped:', err.message);
    process.exit(0);
  }
}
