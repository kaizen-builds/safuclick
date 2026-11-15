#!/usr/bin/env bash
# Example Claude Code "Stop" hook: when the coding agent says it's done, Kane re-checks the
# dApp. If SafuClick flags a trap, exit code 2 feeds the Kane report back to the agent as its
# next instruction (Claude Code shows stderr to the model), closing the loop without a human.
# settings.json: { "hooks": { "Stop": [ { "hooks": [ { "type": "command", "command": "hooks/claude-code-stop-hook.sh" } ] } ] } }
URL="${SAFU_STAGING_URL:-http://safuswap.localhost:4100/}"
if node bin/safuclick.js check "$URL" --markdown .safuclick/last-report.md --fail-on-trap >/dev/null 2>&1; then
  exit 0
fi
{ echo "SafuClick (Kane CLI) flagged a trap on $URL. Fix it, then stop again:"; cat .safuclick/last-report.md; } >&2
exit 2
