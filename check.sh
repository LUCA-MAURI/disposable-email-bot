#!/usr/bin/env bash
# Everything this project claims about itself, checked in one command.
#
# Nothing here is bespoke: these are the standard tools a reviewer would reach
# for anyway. Missing ones are skipped with a note rather than failing, so the
# script stays useful before you have installed all of them.
#
#   ./check.sh                  # missing tools are skipped and counted
#   CHECK_STRICT=1 ./check.sh   # missing tools fail the run (CI uses this)
set -uo pipefail
strict=${CHECK_STRICT:-0}
cd "$(dirname "$0")" || exit 1

# Appended, never prepended: these directories only fill gaps, the system
# PATH always wins, and nothing inside the checked-out tree can shadow a tool.
for d in "$HOME/.local/audit/bin" "$HOME/.local/bin"; do
    [ -d "$d" ] && PATH="$PATH:$d"
done
export PATH

fail=0
skipped=0
have() { command -v "$1" >/dev/null 2>&1; }
step() { printf '\n=== %s ===\n' "$1"; }
ok()   { printf '  PASS  %s\n' "$1"; }
bad()  { printf '  FAIL  %s\n' "$1"; fail=1; }
# A skipped tool is not a pass. It is counted and reported at the end, because
# a green run that quietly checked half of what it claims is worse than a red one.
skip() { printf '  skip  %s (not installed)\n' "$1"; skipped=$((skipped + 1)); }

step "syntax (node --check)"
if have node; then
    for f in src/*.js test/*.mjs eslint.config.js; do
        if node --check "$f" 2>/dev/null; then ok "$f"; else node --check "$f"; bad "$f"; fi
    done
else
    skip "node"
fi

step "self-tests (node --test)"
if have node; then
    if out=$(npm test --silent 2>&1); then ok "npm test"; else echo "$out" | tail -30; bad "npm test"; fi
else
    skip "node"
fi

step "eslint"
if have node; then
    # The lock file pins every version, so a fresh clone gets the same eslint.
    [ -d node_modules ] || npm ci --silent --no-fund --no-audit
    if npx --no-install eslint .; then ok "eslint"; else bad "eslint"; fi
else
    skip "node"
fi

step "semgrep (javascript + security-audit rulesets)"
if have semgrep; then
    n=$(semgrep scan --config=p/javascript --config=p/security-audit \
          --metrics=off --json . 2>/dev/null \
        | python3 -c "import json,sys;print(len(json.load(sys.stdin).get('results',[])))" \
        2>/dev/null)
    if [ "${n:-x}" = "0" ]; then
        ok "semgrep (0 findings)"
    else
        semgrep scan --config=p/javascript --config=p/security-audit \
            --metrics=off . 2>/dev/null | tail -20
        bad "semgrep (${n:-error})"
    fi
else
    skip "semgrep"
fi

step "gitleaks (secrets)"
if have gitleaks; then
    if gitleaks detect --no-git --source . --redact >/dev/null 2>&1; then
        ok "gitleaks"
    else
        bad "gitleaks"
    fi
else
    skip "gitleaks"
fi

step "shellcheck"
if have shellcheck; then
    if shellcheck setup.sh check.sh; then ok "shellcheck"; else bad "shellcheck"; fi
else
    skip "shellcheck"
fi

printf '\n'
if [ $fail -ne 0 ]; then
    echo "SOMETHING FAILED"
elif [ $skipped -ne 0 ] && [ "$strict" = 1 ]; then
    echo "FAILED - $skipped tool(s) missing and CHECK_STRICT=1"
    fail=1
elif [ $skipped -ne 0 ]; then
    echo "PASSED WHAT RAN - $skipped tool(s) missing, not checked"
else
    echo "ALL CLEAR"
fi
exit $fail
