#!/bin/bash
# Exercise protect-shared-tree.sh. Run it with:  bash .claude/hooks/protect-shared-tree.test.sh
#
# Each case feeds the hook a realistic PreToolUse payload and checks the exit code:
# 2 = blocked, 0 = allowed. Every guard is confirmed by making it REFUSE, not by
# watching it allow — and there are controls alongside, because a guard that refuses
# everything passes the same tests as a guard that works.
HOOK="$(cd "$(dirname "$0")" && pwd)/protect-shared-tree.sh"
FAILED=0
EXTRA_PATH=""

check() { # expected_code  label  command
  local want="$1" label="$2" cmd="$3" got payload
  payload=$(EXTRA="$cmd" python3 -c '
import json, os
print(json.dumps({"session_id":"abc","cwd":"/Users/greg/Dropbox/dev/experim/spideryarn2",
                  "hook_event_name":"PreToolUse","tool_name":"Bash",
                  "tool_input":{"command":os.environ["EXTRA"],"description":"x"}}))')
  printf '%s' "$payload" | PATH="$EXTRA_PATH$PATH" "$HOOK" >/dev/null 2>&1
  got=$?
  if [ "$got" = "$want" ]; then printf 'ok    (%s) %s\n' "$got" "$label"
  else printf 'FAIL  want %s got %s: %s\n' "$want" "$got" "$label"; FAILED=1; fi
}

run_suite() { # $1 = expected code for the innocent controls
  local ctrl="$1"
  echo "--- must be REFUSED (exit 2) ---"
  check 2 "plain"                  'git stash'
  check 2 "subcommand"             'git stash push -m wip'
  check 2 "compound, the real one" 'npm test -- toc 2>&1 | tail -5; git stash'
  check 2 "&&-joined"              'git stash && npx vitest run'
  check 2 "global flag"            'git -C /Users/greg/Dropbox/dev/experim/spideryarn2 stash'
  check 2 "extra whitespace"       'git    stash'
  check 2 "newline before git"     'cd /tmp
git stash'
  check 2 "line-continuation"      'git \
stash'
  check 2 "multi-line script"      'set -e
npm run typecheck
git stash
npm test'
  check 2 "heredoc body"           'cat <<EOF > /tmp/x.sh
git stash
EOF'
  check 2 "tab-separated"          "$(printf 'git\tstash')"
  check 2 "pop"                    'git stash pop'
  check 2 "list"                   'git stash list'
  check 2 "aliased via var"        'g=git; s=stash; $g $s'
  check 2 "inside a subshell"      'echo $(git stash)'
  check 2 "over-refusal, by design" 'grep -rn "git stash" docs/'
  check 2 "a path carrying both"   'chmod +x .claude/hooks/no-git-stash.sh'

  echo "--- controls: must be $ctrl ---"
  check "$ctrl" "status"                'git status --short'
  check "$ctrl" "the commit recipe"     'git add -- a.ts && git commit -F msg -- a.ts b.ts'
  check "$ctrl" "diff"                  'git diff HEAD -- src/toc.ts'
  check "$ctrl" "multi-line, innocent"  'npm run typecheck
git status --short
npm test'
  check "$ctrl" "tests"                 'npm test'
  check "$ctrl" "log"                   'git log --oneline -5'
  check "$ctrl" "the word alone"        'grep -rn stash docs/project/version-control.md'
  check "$ctrl" "word containing it"    'npx tsx scripts/mustache-parser.ts'
  check "$ctrl" "no git nearby"         'ls output/'
}

echo "=========== normal path (python3 present) ==========="
EXTRA_PATH=""
run_suite 0

echo
echo "=========== python3 broken (fallback path must still refuse) ==========="
SHIM=$(mktemp -d)/nopy; mkdir -p "$SHIM"
printf '#!/bin/sh\nexit 1\n' > "$SHIM/python3"; chmod +x "$SHIM/python3"
EXTRA_PATH="$SHIM:"
run_suite 0

echo
echo "=========== grep broken (must fail CLOSED: everything refused) ==========="
SHIM2=$(mktemp -d)/nogrep; mkdir -p "$SHIM2"
printf '#!/bin/sh\nexit 3\n' > "$SHIM2/grep"; chmod +x "$SHIM2/grep"
EXTRA_PATH="$SHIM2:"
run_suite 2

echo
echo "=========== degenerate input ==========="
EXTRA_PATH=""
printf '' | "$HOOK" >/dev/null 2>&1;         echo "empty payload         -> $? (expect 0)"
printf 'not json' | "$HOOK" >/dev/null 2>&1; echo "unparseable, benign   -> $? (expect 0)"
printf 'garbage git stash garbage' | "$HOOK" >/dev/null 2>&1
echo "unparseable, mentions -> $? (expect 2)"

echo
[ "$FAILED" = 0 ] && echo "ALL PASS" || echo "SOME FAILED"
exit $FAILED
