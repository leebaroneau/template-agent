#!/usr/bin/env bash
# Shared GitHub Release backup helpers for Paperclip/Hermes snapshots.
#
# Source-only library: defining these functions must not perform API calls,
# mutate process state, install traps, or exit the caller.

release_backup_log() {
  printf '[release-backup] %s\n' "$*" >&2
}

release_backup_api_base() {
  printf '%s' "${RELEASE_BACKUP_API_BASE:-https://api.github.com}"
}

release_backup_upload_base() {
  printf '%s' "${RELEASE_BACKUP_UPLOAD_BASE:-https://uploads.github.com}"
}

release_backup_file_size() {
  stat -c%s "$1" 2>/dev/null || stat -f%z "$1"
}

release_backup_sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
    return
  fi
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
    return
  fi
  release_backup_log "ERROR: neither sha256sum nor shasum is available"
  return 1
}

release_backup_urlencode() {
  local value="$1"
  local length="${#value}"
  local i char encoded=""
  local LC_ALL=C
  for (( i = 0; i < length; i++ )); do
    char="${value:i:1}"
    case "$char" in
      [a-zA-Z0-9.~_-]) encoded+="$char" ;;
      *) printf -v encoded '%s%%%02X' "$encoded" "'$char" ;;
    esac
  done
  printf '%s' "$encoded"
}

release_backup_validate_repo() {
  local repo="$1"
  if [[ ! "$repo" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]; then
    release_backup_log "ERROR: AGENT_STATE_REPO must look like <owner>/<repo>; got '$repo'"
    return 1
  fi
}

release_backup_require_token() {
  local repo="$1"
  if [[ -n "${AGENT_STATE_TOKEN:-}" ]]; then
    return 0
  fi

  release_backup_log "ERROR: AGENT_STATE_REPO is set ($repo), but GitHub Release assets require AGENT_STATE_TOKEN with contents:write."
  release_backup_log "ERROR: SSH deploy keys (AGENT_STATE_DEPLOY_KEY/AGENT_STATE_KEY) cannot create releases, upload Release assets, verify asset digests, or prune tags through the Releases API."
  release_backup_log "ERROR: Set AGENT_STATE_TOKEN as a secret runtime variable, or AGENT_STATE_TOKEN_FILE for the host nightly script."
  return 1
}

release_backup_json() {
  local mode="$1"
  shift

  if command -v node >/dev/null 2>&1; then
    node - "$mode" "$@" <<'NODE'
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');

const mode = process.argv[2];
const args = process.argv.slice(3);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function field(file, name) {
  const value = readJson(file)[name];
  if (value === undefined || value === null) process.exit(2);
  process.stdout.write(String(value));
}

function buildRelease(tag, name, body) {
  process.stdout.write(JSON.stringify({
    tag_name: tag,
    name,
    body,
    draft: false,
    prerelease: false,
  }));
}

function asset(file, name) {
  const data = readJson(file);
  const assets = Array.isArray(data) ? data : (data.assets || []);
  const found = assets.find((item) => item.name === name);
  if (!found) process.exit(2);
  process.stdout.write([
    found.id,
    found.size,
    found.digest || '',
    found.url || '',
  ].join('\t'));
}

function releases(file, prefix) {
  const data = readJson(file);
  for (const release of data) {
    const tag = String(release.tag_name || '');
    if (prefix && !tag.startsWith(prefix)) continue;
    process.stdout.write([
      release.id,
      tag,
      release.published_at || release.created_at || '',
    ].join('\t') + '\n');
  }
}

function olderThan(createdAt, days, now) {
  const createdMs = Date.parse(createdAt);
  const nowMs = Date.parse(now);
  if (!Number.isFinite(createdMs) || !Number.isFinite(nowMs)) process.exit(2);
  const cutoffMs = nowMs - (Number(days) * 24 * 60 * 60 * 1000);
  process.exit(createdMs < cutoffMs ? 0 : 1);
}

function writeManifest(outFile, kind, tag, createdAt, brand, repo, source, commit, assetPaths) {
  const files = assetPaths.map((assetPath) => {
    const stat = fs.statSync(assetPath);
    return {
      name: path.basename(assetPath),
      size: stat.size,
      sha256: sha256(assetPath),
    };
  });
  const manifest = {
    schema_version: 1,
    metadata: {
      kind,
      tag,
      created_at: createdAt,
      brand,
      repository: repo,
      source,
      commit,
    },
    files,
  };
  fs.writeFileSync(outFile, JSON.stringify(manifest, null, 2) + '\n');
}

function manifestFiles(file) {
  const manifest = readJson(file);
  if (manifest.schema_version !== 1 || !Array.isArray(manifest.files)) process.exit(2);
  for (const entry of manifest.files) {
    if (!entry.name || entry.name.includes('/') || entry.name.includes('\\')) process.exit(2);
    if (!/^[0-9a-f]{64}$/.test(String(entry.sha256 || ''))) process.exit(2);
    if (!Number.isInteger(entry.size) || entry.size < 0) process.exit(2);
    process.stdout.write([entry.name, entry.sha256, entry.size].join('\t') + '\n');
  }
}

switch (mode) {
  case 'build-release':
    buildRelease(args[0], args[1], args[2]);
    break;
  case 'field':
    field(args[0], args[1]);
    break;
  case 'asset':
    asset(args[0], args[1]);
    break;
  case 'releases':
    releases(args[0], args[1] || '');
    break;
  case 'older-than':
    olderThan(args[0], args[1], args[2]);
    break;
  case 'write-manifest':
    writeManifest(args[0], args[1], args[2], args[3], args[4], args[5], args[6], args[7], args.slice(8));
    break;
  case 'manifest-files':
    manifestFiles(args[0]);
    break;
  default:
    process.exit(64);
}
NODE
    return
  fi

  if command -v python3 >/dev/null 2>&1; then
    python3 - "$mode" "$@" <<'PY'
import datetime
import hashlib
import json
import os
import sys

mode = sys.argv[1]
args = sys.argv[2:]

def read_json(file):
    with open(file, "r", encoding="utf-8") as handle:
        return json.load(handle)

def sha256(file):
    digest = hashlib.sha256()
    with open(file, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()

def parse_time(value):
    return datetime.datetime.fromisoformat(value.replace("Z", "+00:00"))

if mode == "build-release":
    print(json.dumps({"tag_name": args[0], "name": args[1], "body": args[2], "draft": False, "prerelease": False}), end="")
elif mode == "field":
    value = read_json(args[0]).get(args[1])
    if value is None:
        sys.exit(2)
    print(value, end="")
elif mode == "asset":
    data = read_json(args[0])
    assets = data if isinstance(data, list) else data.get("assets", [])
    found = next((item for item in assets if item.get("name") == args[1]), None)
    if not found:
        sys.exit(2)
    print("\t".join([str(found.get("id", "")), str(found.get("size", "")), found.get("digest", "") or "", found.get("url", "") or ""]), end="")
elif mode == "releases":
    prefix = args[1] if len(args) > 1 else ""
    for release in read_json(args[0]):
        tag = str(release.get("tag_name", ""))
        if prefix and not tag.startswith(prefix):
            continue
        print("\t".join([str(release.get("id", "")), tag, release.get("published_at") or release.get("created_at") or ""]))
elif mode == "older-than":
    created = parse_time(args[0])
    now = parse_time(args[2])
    cutoff = now - datetime.timedelta(days=int(args[1]))
    sys.exit(0 if created < cutoff else 1)
elif mode == "write-manifest":
    out_file, kind, tag, created_at, brand, repo, source, commit = args[:8]
    files = []
    for asset_path in args[8:]:
        files.append({"name": os.path.basename(asset_path), "size": os.path.getsize(asset_path), "sha256": sha256(asset_path)})
    manifest = {
        "schema_version": 1,
        "metadata": {
            "kind": kind,
            "tag": tag,
            "created_at": created_at,
            "brand": brand,
            "repository": repo,
            "source": source,
            "commit": commit,
        },
        "files": files,
    }
    with open(out_file, "w", encoding="utf-8") as handle:
        json.dump(manifest, handle, indent=2)
        handle.write("\n")
elif mode == "manifest-files":
    manifest = read_json(args[0])
    if manifest.get("schema_version") != 1 or not isinstance(manifest.get("files"), list):
        sys.exit(2)
    for entry in manifest["files"]:
        name = str(entry.get("name", ""))
        sha = str(entry.get("sha256", ""))
        size = entry.get("size")
        if not name or "/" in name or "\\" in name or len(sha) != 64 or not isinstance(size, int) or size < 0:
            sys.exit(2)
        print("\t".join([name, sha, str(size)]))
else:
    sys.exit(64)
PY
    return
  fi

  if command -v python >/dev/null 2>&1; then
    python - "$mode" "$@" <<'PY'
import datetime
import hashlib
import json
import os
import sys

mode = sys.argv[1]
args = sys.argv[2:]

def read_json(file):
    with open(file, "r") as handle:
        return json.load(handle)

def sha256(file):
    digest = hashlib.sha256()
    with open(file, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()

def parse_time(value):
    if value.endswith("Z"):
        value = value[:-1] + "+00:00"
    return datetime.datetime.fromisoformat(value)

if mode == "build-release":
    sys.stdout.write(json.dumps({"tag_name": args[0], "name": args[1], "body": args[2], "draft": False, "prerelease": False}))
elif mode == "field":
    value = read_json(args[0]).get(args[1])
    if value is None:
        sys.exit(2)
    sys.stdout.write(str(value))
elif mode == "asset":
    data = read_json(args[0])
    assets = data if isinstance(data, list) else data.get("assets", [])
    found = next((item for item in assets if item.get("name") == args[1]), None)
    if not found:
        sys.exit(2)
    sys.stdout.write("\t".join([str(found.get("id", "")), str(found.get("size", "")), found.get("digest", "") or "", found.get("url", "") or ""]))
elif mode == "releases":
    prefix = args[1] if len(args) > 1 else ""
    for release in read_json(args[0]):
        tag = str(release.get("tag_name", ""))
        if prefix and not tag.startswith(prefix):
            continue
        sys.stdout.write("\t".join([str(release.get("id", "")), tag, release.get("published_at") or release.get("created_at") or ""]) + "\n")
elif mode == "older-than":
    created = parse_time(args[0])
    now = parse_time(args[2])
    cutoff = now - datetime.timedelta(days=int(args[1]))
    sys.exit(0 if created < cutoff else 1)
elif mode == "write-manifest":
    out_file, kind, tag, created_at, brand, repo, source, commit = args[:8]
    files = [{"name": os.path.basename(asset_path), "size": os.path.getsize(asset_path), "sha256": sha256(asset_path)} for asset_path in args[8:]]
    with open(out_file, "w") as handle:
        json.dump({"schema_version": 1, "metadata": {"kind": kind, "tag": tag, "created_at": created_at, "brand": brand, "repository": repo, "source": source, "commit": commit}, "files": files}, handle, indent=2)
        handle.write("\n")
elif mode == "manifest-files":
    manifest = read_json(args[0])
    if manifest.get("schema_version") != 1 or not isinstance(manifest.get("files"), list):
        sys.exit(2)
    for entry in manifest["files"]:
        name = str(entry.get("name", ""))
        sha = str(entry.get("sha256", ""))
        size = entry.get("size")
        if not name or "/" in name or "\\" in name or len(sha) != 64 or not isinstance(size, int) or size < 0:
            sys.exit(2)
        sys.stdout.write("\t".join([name, sha, str(size)]) + "\n")
else:
    sys.exit(64)
PY
    return
  fi

  release_backup_log "ERROR: release-backup requires node, python3, or python for JSON parsing"
  return 1
}

release_backup_http() {
  local method="$1"
  local url="$2"
  local token="$3"
  local out_file="$4"
  local body_file="${5:-}"
  local content_type="${6:-application/json}"
  local status
  local -a args=(
    -sS
    -L
    -X "$method"
    -H "Accept: application/vnd.github+json"
    -H "Authorization: Bearer $token"
    -H "X-GitHub-Api-Version: 2022-11-28"
    -w "%{http_code}"
    -o "$out_file"
  )

  if [[ -n "$body_file" ]]; then
    args+=(-H "Content-Type: $content_type" --data-binary "@$body_file")
  fi
  args+=("$url")

  if ! status="$(curl "${args[@]}")"; then
    release_backup_log "ERROR: curl failed for $method $url"
    return 1
  fi
  printf '%s' "$status"
}

release_backup_http_download() {
  local url="$1"
  local token="$2"
  local out_file="$3"
  local status

  if ! status="$(curl -sS -L \
    -H "Accept: application/octet-stream" \
    -H "Authorization: Bearer $token" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    -w "%{http_code}" \
    -o "$out_file" \
    "$url")"; then
    release_backup_log "ERROR: curl failed for GET $url"
    return 1
  fi
  printf '%s' "$status"
}

release_backup_expect_status() {
  local status="$1"
  local out_file="$2"
  local ok_codes="$3"
  local context="$4"
  if [[ " $ok_codes " == *" $status "* ]]; then
    return 0
  fi

  local body=""
  if [[ -f "$out_file" ]]; then
    body="$(tr '\n' ' ' < "$out_file")"
    body="${body:0:500}"
  fi
  release_backup_log "ERROR: $context failed with HTTP $status: $body"
  return 1
}

release_backup_api_url() {
  local repo="$1"
  local path="$2"
  printf '%s/repos/%s%s' "$(release_backup_api_base)" "$repo" "$path"
}

release_backup_create_or_reuse_release() {
  local repo="$1"
  local token="$2"
  local tag="$3"
  local name="$4"
  local body="$5"
  local encoded_tag
  local tmp body_file status release_id

  release_backup_validate_repo "$repo" || return 1
  encoded_tag="$(release_backup_urlencode "$tag")"
  tmp="$(mktemp -t release-backup-release-XXXXXX)"
  body_file="$(mktemp -t release-backup-body-XXXXXX)"

  status="$(release_backup_http GET "$(release_backup_api_url "$repo" "/releases/tags/$encoded_tag")" "$token" "$tmp")" || return 1
  if [[ "$status" == "200" ]]; then
    release_id="$(release_backup_json field "$tmp" id)" || return 1
    rm -f "$tmp" "$body_file"
    printf '%s\n' "$release_id"
    return 0
  fi
  if [[ "$status" != "404" ]]; then
    release_backup_expect_status "$status" "$tmp" "200 404" "looking up release $tag" || return 1
  fi

  release_backup_json build-release "$tag" "$name" "$body" > "$body_file" || return 1
  status="$(release_backup_http POST "$(release_backup_api_url "$repo" "/releases")" "$token" "$tmp" "$body_file" "application/json")" || return 1
  release_backup_expect_status "$status" "$tmp" "200 201" "creating release $tag" || return 1
  release_id="$(release_backup_json field "$tmp" id)" || return 1
  rm -f "$tmp" "$body_file"
  printf '%s\n' "$release_id"
}

release_backup_find_asset() {
  local repo="$1"
  local token="$2"
  local release_id="$3"
  local asset_name="$4"
  local tmp status

  release_backup_validate_repo "$repo" || return 1
  tmp="$(mktemp -t release-backup-assets-XXXXXX)"

  status="$(release_backup_http GET "$(release_backup_api_url "$repo" "/releases/$release_id/assets?per_page=100")" "$token" "$tmp")" || return 1
  release_backup_expect_status "$status" "$tmp" "200" "listing release assets" || return 1
  local asset_info
  if asset_info="$(release_backup_json asset "$tmp" "$asset_name")"; then
    :
  else
    local json_status=$?
    rm -f "$tmp"
    return "$json_status"
  fi
  rm -f "$tmp"
  printf '%s\n' "$asset_info"
}

release_backup_delete_asset_if_exists() {
  local repo="$1"
  local token="$2"
  local release_id="$3"
  local asset_name="$4"
  local asset_info asset_id tmp status

  if asset_info="$(release_backup_find_asset "$repo" "$token" "$release_id" "$asset_name" 2>/dev/null)"; then
    :
  else
    local find_status=$?
    if (( find_status == 2 )); then
      return 0
    fi
    release_backup_log "ERROR: failed to check existing asset $asset_name before upload"
    return 1
  fi
  IFS=$'\t' read -r asset_id _ <<< "$asset_info"
  tmp="$(mktemp -t release-backup-delete-asset-XXXXXX)"
  status="$(release_backup_http DELETE "$(release_backup_api_url "$repo" "/releases/assets/$asset_id")" "$token" "$tmp")" || return 1
  release_backup_expect_status "$status" "$tmp" "204" "deleting existing asset $asset_name" || return 1
  rm -f "$tmp"
}

release_backup_upload_asset() {
  local repo="$1"
  local token="$2"
  local release_id="$3"
  local asset_path="$4"
  local asset_name="${5:-$(basename "$asset_path")}"
  local tmp status upload_url

  release_backup_validate_repo "$repo" || return 1
  if [[ ! -f "$asset_path" ]]; then
    release_backup_log "ERROR: asset file does not exist: $asset_path"
    return 1
  fi

  release_backup_delete_asset_if_exists "$repo" "$token" "$release_id" "$asset_name" || return 1

  tmp="$(mktemp -t release-backup-upload-XXXXXX)"
  upload_url="$(release_backup_upload_base)/repos/$repo/releases/$release_id/assets?name=$(release_backup_urlencode "$asset_name")"
  status="$(release_backup_http POST "$upload_url" "$token" "$tmp" "$asset_path" "application/octet-stream")" || return 1
  release_backup_expect_status "$status" "$tmp" "201" "uploading asset $asset_name" || return 1
  rm -f "$tmp"
}

release_backup_verify_asset() {
  local repo="$1"
  local token="$2"
  local release_id="$3"
  local asset_name="$4"
  local asset_path="$5"
  local expected_size expected_sha asset_info asset_id actual_size digest

  expected_size="$(release_backup_file_size "$asset_path")" || return 1
  expected_sha="$(release_backup_sha256_file "$asset_path")" || return 1
  asset_info="$(release_backup_find_asset "$repo" "$token" "$release_id" "$asset_name")" || {
    release_backup_log "ERROR: uploaded asset $asset_name is missing from release $release_id"
    return 1
  }

  IFS=$'\t' read -r asset_id actual_size digest _ <<< "$asset_info"
  digest="${digest#sha256:}"
  if [[ "$actual_size" != "$expected_size" ]]; then
    release_backup_log "ERROR: asset $asset_name size mismatch via API (expected $expected_size, got $actual_size)"
    return 1
  fi
  if [[ -z "$digest" ]]; then
    release_backup_log "ERROR: asset $asset_name has no sha256 digest in the GitHub API response"
    return 1
  fi
  if [[ "$digest" != "$expected_sha" ]]; then
    release_backup_log "ERROR: asset $asset_name sha256 mismatch via API (expected $expected_sha, got $digest)"
    return 1
  fi
  release_backup_log "Verified $asset_name ($expected_size bytes, sha256:$expected_sha)"
}

release_backup_list_releases() {
  local repo="$1"
  local token="$2"
  local kind="${3:-}"
  local prefix=""
  local page=1
  local tmp status compact

  release_backup_validate_repo "$repo" || return 1
  if [[ -n "$kind" ]]; then
    prefix="$kind-"
  fi

  while true; do
    tmp="$(mktemp -t release-backup-releases-XXXXXX)"
    status="$(release_backup_http GET "$(release_backup_api_url "$repo" "/releases?per_page=100&page=$page")" "$token" "$tmp")" || {
      rm -f "$tmp"
      return 1
    }
    release_backup_expect_status "$status" "$tmp" "200" "listing releases" || {
      rm -f "$tmp"
      return 1
    }
    compact="$(tr -d '[:space:]' < "$tmp")"
    if [[ "$compact" == "[]" ]]; then
      rm -f "$tmp"
      break
    fi
    release_backup_json releases "$tmp" "$prefix" || {
      rm -f "$tmp"
      return 1
    }
    rm -f "$tmp"
    page=$(( page + 1 ))
    if (( page > 100 )); then
      release_backup_log "ERROR: refusing to paginate more than 100 release pages"
      return 1
    fi
  done
}

release_backup_is_older_than() {
  local created_at="$1"
  local days="$2"
  local now="${3:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"
  release_backup_json older-than "$created_at" "$days" "$now"
}

release_backup_prune_releases() {
  local repo="$1"
  local token="$2"
  local kind="$3"
  local retention_days="$4"
  local now="${RELEASE_BACKUP_NOW:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"
  local releases_file id tag created_at tmp status encoded_tag

  if [[ ! "$retention_days" =~ ^[0-9]+$ ]]; then
    release_backup_log "ERROR: retention days must be a non-negative integer; got '$retention_days'"
    return 1
  fi

  releases_file="$(mktemp -t release-backup-prune-XXXXXX)"
  release_backup_list_releases "$repo" "$token" "$kind" > "$releases_file" || return 1

  while IFS=$'\t' read -r id tag created_at; do
    [[ -n "$id" && -n "$tag" && -n "$created_at" ]] || continue
    if ! release_backup_is_older_than "$created_at" "$retention_days" "$now"; then
      continue
    fi

    release_backup_log "Pruning $kind release $tag (created $created_at)"
    tmp="$(mktemp -t release-backup-prune-delete-XXXXXX)"
    status="$(release_backup_http DELETE "$(release_backup_api_url "$repo" "/releases/$id")" "$token" "$tmp")" || return 1
    release_backup_expect_status "$status" "$tmp" "204" "deleting release $tag" || return 1
    rm -f "$tmp"

    encoded_tag="$(release_backup_urlencode "$tag")"
    tmp="$(mktemp -t release-backup-prune-tag-XXXXXX)"
    status="$(release_backup_http DELETE "$(release_backup_api_url "$repo" "/git/refs/tags/$encoded_tag")" "$token" "$tmp")" || return 1
    release_backup_expect_status "$status" "$tmp" "204 404" "deleting tag $tag" || return 1
    rm -f "$tmp"
  done < "$releases_file"
  rm -f "$releases_file"
}

release_backup_latest_release_tag() {
  local repo="$1"
  local token="$2"
  local kind="${3:-}"
  local releases_file tag

  releases_file="$(mktemp -t release-backup-latest-XXXXXX)"
  release_backup_list_releases "$repo" "$token" "$kind" > "$releases_file" || return 1
  tag="$(awk -F '\t' 'NF >= 2 {print $2; exit}' "$releases_file")"
  if [[ -z "$tag" ]]; then
    rm -f "$releases_file"
    release_backup_log "ERROR: no releases found for kind '${kind:-any}'"
    return 1
  fi
  rm -f "$releases_file"
  printf '%s\n' "$tag"
}

release_backup_download_asset() {
  local repo="$1"
  local token="$2"
  local release_id="$3"
  local asset_name="$4"
  local out_path="$5"
  local asset_info asset_id status tmp_url

  asset_info="$(release_backup_find_asset "$repo" "$token" "$release_id" "$asset_name")" || {
    release_backup_log "ERROR: asset $asset_name not found on release $release_id"
    return 1
  }
  IFS=$'\t' read -r asset_id _ _ _ <<< "$asset_info"
  tmp_url="$(release_backup_api_url "$repo" "/releases/assets/$asset_id")"
  status="$(release_backup_http_download "$tmp_url" "$token" "$out_path")" || return 1
  release_backup_expect_status "$status" "$out_path" "200" "downloading asset $asset_name" || return 1
}

release_backup_release_id_for_tag() {
  local repo="$1"
  local token="$2"
  local tag="$3"
  local encoded_tag tmp status release_id

  encoded_tag="$(release_backup_urlencode "$tag")"
  tmp="$(mktemp -t release-backup-release-id-XXXXXX)"
  status="$(release_backup_http GET "$(release_backup_api_url "$repo" "/releases/tags/$encoded_tag")" "$token" "$tmp")" || return 1
  release_backup_expect_status "$status" "$tmp" "200" "looking up release $tag" || return 1
  release_id="$(release_backup_json field "$tmp" id)" || return 1
  rm -f "$tmp"
  printf '%s\n' "$release_id"
}

release_backup_write_manifest() {
  release_backup_json write-manifest "$@"
}

release_backup_verify_manifest_files() {
  local manifest_path="$1"
  local asset_dir="$2"
  local name expected_sha expected_size asset_path actual_sha actual_size
  local manifest_lines

  manifest_lines="$(release_backup_json manifest-files "$manifest_path")" || return 1
  if [[ -z "$manifest_lines" ]]; then
    release_backup_log "ERROR: manifest contains no files"
    return 1
  fi

  while IFS=$'\t' read -r name expected_sha expected_size; do
    asset_path="$asset_dir/$name"
    if [[ ! -f "$asset_path" ]]; then
      release_backup_log "ERROR: manifest references missing asset $name"
      return 1
    fi
    actual_size="$(release_backup_file_size "$asset_path")" || return 1
    actual_sha="$(release_backup_sha256_file "$asset_path")" || return 1
    if [[ "$actual_size" != "$expected_size" ]]; then
      release_backup_log "ERROR: manifest size mismatch for $name (expected $expected_size, got $actual_size)"
      return 1
    fi
    if [[ "$actual_sha" != "$expected_sha" ]]; then
      release_backup_log "ERROR: manifest sha256 mismatch for $name (expected $expected_sha, got $actual_sha)"
      return 1
    fi
  done <<< "$manifest_lines"
}
