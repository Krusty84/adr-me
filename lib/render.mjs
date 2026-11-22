export function renderHook(skills) {
  const checks = [];
  if (skills.includes("create-adr-md")) checks.push({
    status: "adr_status",
    command: 'BASE_SHA="$remote_sha" HEAD_SHA="$local_sha" ADR_REMOTE="$remote_name" node .adr-me/.github/scripts/check-adr.mjs',
    question: "Push without ADRs for these commits?",
    flag: "ADR_ALLOW_MISSING",
    missing: "missing ADRs",
  });
  if (skills.includes("create-update-architecture-md")) checks.push({
    status: "arch_status",
    command: 'HEAD_SHA="$local_sha" node .adr-me/.github/scripts/check-architecture.mjs',
    question: "Push without ARCHITECTURE.md?",
    flag: "ARCH_ALLOW_MISSING",
    missing: "missing architecture documents",
  });
  return `#!/bin/sh
# Installed by adr-me. Check the committed tree pushed to main.
set -eu

confirm_missing() {
  [ "$2" = 1 ] && return 0
  if {
    printf '%s [y/N] ' "$1" >&3
    IFS= read -r answer <&3 || return 1
    case "$answer" in
      y|yes) ;;
      *) return 1 ;;
    esac
  } 2>/dev/null 3<>/dev/tty; then
    return 0
  fi
  printf 'No terminal. To confirm %s, retry with %s=1 git push …\\n' "$3" "$4" >&2
  return 1
}

remote_name="\${1:-origin}"
while read -r local_ref local_sha remote_ref remote_sha; do
  [ "$remote_ref" = 'refs/heads/main' ] || continue

${checks.map(({ status, command }) => `  ${status}=0\n  ${command} || ${status}=$?`).join("\n")}

${checks.map(({ status }) => `  case "$${status}" in 0|2) ;; *) exit 1 ;; esac`).join("\n")}
${checks.map(({ status, question, flag, missing }) => `  if [ "$${status}" -eq 2 ]; then
    confirm_missing '${question}' "\${${flag}:-}" '${missing}' ${flag} || exit 1
  fi`).join("\n")}
done
`;
}

export function renderWorkflow(skills) {
  const adr = skills.includes("create-adr-md");
  const arch = skills.includes("create-update-architecture-md");
  const label = adr && arch ? "ADR and architecture" : adr ? "ADR" : "Architecture";
  return `name: ${label} audit (main)

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read

jobs:
  adr-audit:
    name: ${label} warnings (non-blocking)
    runs-on: ubuntu-latest
    steps:
      - name: Checkout commit and full history
        uses: actions/checkout@v4
        with:
          ref: \${{ github.sha }}
          fetch-depth: 0
          persist-credentials: false

      - name: Install Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '22'
${adr ? `
      - name: Show ADR warnings
        env:
          ADR_SCAN_LIMIT: '30'
          ADR_REMOTE: origin
        run: node .adr-me/.github/scripts/audit-adr.mjs
` : ""}${arch ? `
      - name: Show architecture warnings
        run: node .adr-me/.github/scripts/check-architecture.mjs --audit
` : ""}`;
}
