#!/bin/zsh

set -euo pipefail

readonly project_ref="ufpaeluwcqynzudhmrro"
readonly keychain_service="codex-padel-liga-supabase"
readonly node_bin_dir="/Applications/ChatGPT.app/Contents/Resources/cua_node/bin"
readonly npm_cache_dir="${TMPDIR:-/private/tmp}/codex-padel-liga-supabase-npm"

if ! supabase_access_token="$(
  /usr/bin/security find-generic-password \
    -s "${keychain_service}" \
    -a "${project_ref}" \
    -w 2>/dev/null
)"; then
  print -u2 "Der Supabase-Zugriffsschlüssel fehlt im macOS-Schlüsselbund."
  exit 1
fi

mkdir -p "${npm_cache_dir}"
chmod 700 "${npm_cache_dir}"

export SUPABASE_ACCESS_TOKEN="${supabase_access_token}"
export npm_config_cache="${npm_cache_dir}"
export PATH="${node_bin_dir}:/usr/bin:/bin:/usr/sbin:/sbin"

unset supabase_access_token

exec "${node_bin_dir}/npx" \
  -y \
  "@supabase/mcp-server-supabase@0.9.0" \
  "--project-ref=${project_ref}" \
  "--features=database"

