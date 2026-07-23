#!/bin/zsh

set -euo pipefail

readonly project_ref="ufpaeluwcqynzudhmrro"
readonly node_bin_dir="/Applications/ChatGPT.app/Contents/Resources/cua_node/bin"
readonly npm_cache_dir="${TMPDIR:-/private/tmp}/codex-padel-liga-supabase-npm"
readonly repository_root="${0:A:h:h}"
readonly token_file="${repository_root}/.codex-secrets/supabase-access-token"

if [[ ! -r "${token_file}" ]]; then
  print -u2 "Der lokale Supabase-Zugriffsschlüssel fehlt."
  exit 1
fi

supabase_access_token="$(<"${token_file}")"

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
