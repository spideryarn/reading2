#!/bin/bash
# Exercise push-doc-hint.sh. Run it with:  bash .claude/hooks/push-doc-hint.test.sh
#
# Builds a throwaway repo with an `origin/dev` ref, commits on top of it, and feeds the
# hook PreToolUse payloads. The hint must appear when it should — a hook that is always
# silent passes every "never blocks" test — and every case must exit 0, including the
# broken ones.
HOOK="$(cd "$(dirname "$0")" && pwd)/push-doc-hint.sh"
FAILED=0
EXTRA_PATH=""

REPO=$(mktemp -d)
ONE=$(mktemp -d)
TREE="$REPO/tree with spaces"
trap 'rm -rf "$REPO" "$ONE" "${SHIM:-}"' EXIT
(
  cd "$REPO" && git init -q && git config user.email t@t && git config user.name t
  mkdir -p docs/project src docs/plans
  echo 'The step lives in `src/structure.ts`.' > docs/project/structure-step.md
  echo 'See post-structure.ts and modes.ts, and structure.ts again.' > docs/project/mode.md
  echo 'Nothing relevant here.' > docs/project/other.md
  echo 'See Dockerfile and README.md.' > docs/project/config.md
  echo 'Only DockerfileExtra and extra-Dockerfile.' > docs/project/plain-prefix.md
  echo 'See structure.ts.' > docs/project/period.md
  echo a > Dockerfile; echo a > README.md
  for i in {01..12}; do echo 'See modes.ts.' > "docs/project/cap-$i.md"; done
  echo 'Mentions structure.ts but is a plan.' > docs/plans/p.md
  echo a > src/structure.ts; echo a > src/modes.ts
  git add -A && git commit -qm base && git update-ref refs/remotes/origin/dev HEAD
  echo b > src/structure.ts && git commit -qam "change structure"
) || { echo "FAIL setup"; exit 1; }

run() { # command [cwd] → prints stdout, sets $code
  local payload
  payload=$(CMD="$1" CWD="${2:-$REPO}" python3 -c '
import json, os
print(json.dumps({"cwd": os.environ["CWD"], "hook_event_name": "PreToolUse", "tool_name": "Bash",
                  "tool_input": {"command": os.environ["CMD"], "description": "x"}}))')
  out=$(printf '%s' "$payload" | PATH="$EXTRA_PATH$PATH" "$HOOK" 2>"$REPO/hook.stderr")
  code=$?
}

expect() { # label  want-code  grep-pattern-that-must-match (or "" for silent)
  local label="$1" want="$2" pat="$3" ok=1
  [ "$code" = "$want" ] || ok=0
  [ ! -s "$REPO/hook.stderr" ] || ok=0
  if [ -z "$pat" ]; then [ -z "$out" ] || ok=0
  else
    printf '%s' "$out" | grep -Eq -- "$pat" || ok=0
    printf '%s' "$out" | python3 -c '
import json, sys
d = json.load(sys.stdin)
assert set(d) == {"hookSpecificOutput"}
h = d["hookSpecificOutput"]
assert set(h) == {"hookEventName", "additionalContext"}
assert h["hookEventName"] == "PreToolUse" and isinstance(h["additionalContext"], str)
' 2>/dev/null || ok=0
  fi
  if [ "$ok" = 1 ]; then echo "ok    $label"
  else echo "FAIL  $label (code $code, out: ${out:-<empty>})"; FAILED=1; fi
}

echo "--- self-test ---"
"$HOOK" --self-test | grep -q 'self-test ok' && echo "ok    self-test passes" || { echo "FAIL  self-test"; FAILED=1; }
NOGREP=$(mktemp -d); printf '#!/bin/sh\nexit 3\n' > "$NOGREP/grep"; chmod +x "$NOGREP/grep"
PATH="$NOGREP:$PATH" "$HOOK" --self-test >/dev/null 2>&1 && { echo "FAIL  self-test passed with grep broken"; FAILED=1; } || echo "ok    self-test fails when grep is broken"
rm -rf "$NOGREP"

echo "--- the hint appears ---"
run 'git push origin HEAD:dev'
expect "names the doc and the file"         0 'structure-step\.md \(structure\.ts\)'
expect "is additionalContext JSON"          0 '"hookEventName": "PreToolUse", "additionalContext"'
expect "a whole-name match elsewhere too"   0 'mode\.md \(structure\.ts\)'
printf '%s' "$out" | grep -q 'modes.ts' && { echo "FAIL  an unchanged file was named"; FAILED=1; } || echo "ok    unchanged files are not named"
printf '%s' "$out" | grep -qE '(^|[ (;:])(other|p)\.md' && { echo "FAIL  a non-matching doc or a plan was named"; FAILED=1; } || echo "ok    plans and non-matching docs are not named"
run 'npm test && git -C . push'
expect "push inside a compound"             0 'structure-step\.md'
run $'git status\ngit push origin HEAD:dev'
expect "multi-line push"                    0 'structure-step\.md'
run 'git --no-pager -c color.ui=false push'
expect "git global options"                 0 'structure-step\.md'
# Not tested, on purpose: `echo git push` and `cd elsewhere && git push`. The hook
# reads the command with a regex and uses the session's cwd, so those get a needless
# or wrong-repo hint — one line of noise, accepted rather than parsing shell.

echo "--- whole basenames ---"
(cd "$REPO" && echo 'Only post-structure.ts and structure.tsx.' > docs/project/prefix.md && git add docs/project/prefix.md && git commit -qm fixture)
run 'git push'
printf '%s' "$out" | grep -q 'prefix.md' && { echo "FAIL  a partial basename matched"; FAILED=1; } || echo "ok    partial basenames excluded"

echo "--- log ---"
LOG="$REPO/.git/push-doc-hint.log"
LOG_HEAD=$(git -C "$REPO" rev-parse --short HEAD)
tail -1 "$LOG" | grep -Eq "^[0-9TZ:-]+[[:space:]]+$LOG_HEAD[[:space:]]+.*structure-step" && echo "ok    log has time, HEAD and docs" || { echo "FAIL  log content"; FAILED=1; }

echo "--- a doc the push already changed is left out ---"
(cd "$REPO" && echo 'Updated: `src/structure.ts`.' > docs/project/structure-step.md && git commit -qam "doc")
run 'git push'
printf '%s' "$out" | grep -q 'structure-step' && { echo "FAIL  a touched doc was named"; FAILED=1; } || echo "ok    touched doc skipped"
expect "the untouched doc is still named"   0 'mode\.md'

echo "--- silent, exit 0 ---"
run 'git status';                expect "not a push"                0 ''
run 'grep -rn "git pushes" x';   expect "mentions push, not a push" 0 ''
run 'git push' /nonexistent/dir; expect "cwd gone"                  0 ''
run 'git push' /tmp;             expect "not a repo"                0 ''
(cd "$REPO" && git update-ref refs/remotes/origin/dev HEAD)
run 'git push';                  expect "nothing to push"           0 ''
for payload in 'not json' '' '{"push":1,"tool_input":[]}' '["push"]'; do
  out=$(printf '%s' "$payload" | "$HOOK" 2>"$REPO/hook.stderr"); code=$?
  expect "malformed or empty payload" 0 ''
done

echo "--- broken tools: still exit 0, still quiet ---"
(cd "$REPO" && git update-ref refs/remotes/origin/dev HEAD~3)
SHIM=$(mktemp -d)
for tool in grep python3 git; do
  mkdir -p "$SHIM/$tool"; printf '#!/bin/sh\nexit 3\n' > "$SHIM/$tool/$tool"; chmod +x "$SHIM/$tool/$tool"
  EXTRA_PATH="$SHIM/$tool:"; run 'git push'; expect "$tool broken" 0 ''
done
EXTRA_PATH=""

echo "--- errors after partial work stay quiet ---"
for tool in sort sed awk; do
  mkdir -p "$SHIM/$tool"; printf '#!/bin/sh\nexit 3\n' > "$SHIM/$tool/$tool"; chmod +x "$SHIM/$tool/$tool"
  EXTRA_PATH="$SHIM/$tool:"; run 'git push'; expect "$tool broken" 0 ''
done
EXTRA_PATH=""
# The log is for the review, not the reader: losing it must not lose the hint.
mkdir -p "$SHIM/date"; printf '#!/bin/sh\nexit 3\n' > "$SHIM/date/date"; chmod +x "$SHIM/date/date"
EXTRA_PATH="$SHIM/date:"; run 'git push'; expect "date broken, hint still shown" 0 'mode\.md'
EXTRA_PATH=""
rm -f "$LOG"; mkdir "$LOG"
run 'git push'; expect "log write failed, hint still shown" 0 'mode\.md'
rmdir "$LOG"

echo "--- basenames, cap and worktrees ---"
(cd "$REPO" && echo b > Dockerfile && echo b > README.md && git commit -qam config)
run 'git push'
expect "README named; extensionless names are not looked for" 0 'config\.md \(README\.md\)'
printf '%s' "$out" | grep -q 'plain-prefix.md' && { echo "FAIL  partial extensionless name matched"; FAILED=1; } || echo "ok    whole extensionless basenames"
expect "a filename followed by punctuation" 0 'period\.md \(structure\.ts\)'
(cd "$REPO" && echo b > src/modes.ts && git commit -qam modes)
run 'git push'
expect "ten docs plus an omitted count" 0 'and 5 more'
OUT="$out" python3 - <<'PY'
import json, os, re
msg = json.loads(os.environ["OUT"])["hookSpecificOutput"]["additionalContext"]
assert len(re.findall(r"[\w-]+\.md \(", msg)) == 10, msg
PY
[ $? = 0 ] && echo "ok    exactly ten docs named" || { echo "FAIL  cap"; FAILED=1; }
git -C "$REPO" worktree add -qb fixture "$TREE" HEAD || { echo "FAIL  worktree setup"; exit 1; }
BEFORE=$(wc -l < "$LOG")
run 'git push' "$TREE"
expect "worktree hint" 0 'cap-01\.md'
[ "$(wc -l < "$LOG")" -eq "$((BEFORE + 1))" ] && [ ! -e "$TREE/push-doc-hint.log" ] && echo "ok    worktree log goes in common dir" || { echo "FAIL  worktree log"; FAILED=1; }
run 'command git push'; expect "command wrapper" 0 'cap-01\.md'
run 'X=1 command -- git push'; expect "assignment before command wrapper" 0 'cap-01\.md'
run 'env X=1 git push'; expect "env wrapper" 0 'cap-01\.md'
run $'git \\\n push'; expect "line continuation" 0 'cap-01\.md'

echo "--- one doc and missing ref ---"
(
  cd "$ONE" && git init -q && git config user.email t@t && git config user.name t
  mkdir -p docs/project src
  echo 'See thing.ts and prior.ts.' > docs/project/one.md; echo a > src/thing.ts; echo a > src/prior.ts
  git add -A && git commit -qm base && git update-ref refs/remotes/origin/dev HEAD
  echo b > src/thing.ts && git commit -qam change
) || { echo "FAIL  single-doc setup"; exit 1; }
run 'git push' "$ONE"; expect "one doc still has a grep filename" 0 'one\.md \(thing\.ts\)'
(cd "$ONE" && git mv src/prior.ts src/later.ts && git commit -qm rename)
run 'git push' "$ONE"; expect "rename also names the removed basename" 0 'one\.md \(prior\.ts, thing\.ts\)'
(cd "$ONE" && mkdir -p docs/project/nested && echo 'See prior.ts.' > docs/project/nested/touched.md && git add docs/project/nested/touched.md && git commit -qm nested)
echo 'See thing.ts.' > "$ONE/docs/project/nested/untouched.md"
run 'git push' "$ONE"; expect "nested docs are scanned" 0 'nested/untouched\.md \(thing\.ts\)'
printf '%s' "$out" | grep -q 'nested/touched.md' && { echo "FAIL  touched nested doc named"; FAILED=1; } || echo "ok    touched nested doc skipped"
git -C "$ONE" update-ref -d refs/remotes/origin/dev
run 'git push' "$ONE"; expect "missing origin/dev" 0 ''

echo "--- registration ---"
SETTINGS="$(dirname "$HOOK")/../settings.json"
REGISTERED=$(python3 - "$SETTINGS" <<'PY'
import json, sys
with open(sys.argv[1]) as f:
    settings = json.load(f)
hooks = [h for group in settings["hooks"]["PreToolUse"] if group["matcher"] == "Bash" for h in group["hooks"]]
hint = [h for h in hooks if "push-doc-hint.sh" in h.get("command", "")]
assert len(hint) == 1 and hint[0]["type"] == "command"
# The time bound lives here: past it, Claude Code lets the call through.
assert 0 < hint[0].get("timeout", 0) <= 10
assert any("protect-shared-tree.sh" in h["command"] for h in hooks)
print(hint[0]["command"])
PY
) || { echo "FAIL  registration"; exit 1; }
mkdir -p "$TREE/.claude/hooks"
cp -p "$HOOK" "$TREE/.claude/hooks/push-doc-hint.sh"
PAYLOAD=$(REPO="$REPO" python3 -c 'import json, os; print(json.dumps({"cwd":os.environ["REPO"],"tool_input":{"command":"git push"}}))')
out=$(printf '%s' "$PAYLOAD" | CLAUDE_PROJECT_DIR="$TREE" bash -c "$REGISTERED" 2>"$REPO/hook.stderr"); code=$?
expect "registered hook in a path with spaces" 0 'cap-01\.md'
out=$(printf '%s' "$PAYLOAD" | CLAUDE_PROJECT_DIR="$ONE/missing" bash -c "$REGISTERED" 2>"$REPO/hook.stderr"); code=$?
expect "missing hook cannot block or print errors" 0 ''

echo "--- partial tool output with an error ---"
REAL_GIT=$(command -v git)
mkdir -p "$SHIM/partial-git"
REAL_GIT="$REAL_GIT" SHIM="$SHIM" python3 - <<'PY'
import os, shlex
path = os.path.join(os.environ["SHIM"], "partial-git", "git")
with open(path, "w") as f:
    f.write('#!/bin/sh\ncase "$*" in *" log "*) printf "src/structure.ts\\n"; exit 3;; esac\nexec ' + shlex.quote(os.environ["REAL_GIT"]) + ' "$@"\n')
os.chmod(path, 0o755)
PY
EXTRA_PATH="$SHIM/partial-git:"; run 'git push'; expect "git emits paths then errors" 0 ''
EXTRA_PATH=""

echo "--- missing tools and a huge payload ---"
mkdir -p "$SHIM/empty"
out=$(printf '{"tool_input":{"command":"git push"}}' | PATH="$SHIM/empty" "$HOOK" 2>"$REPO/hook.stderr"); code=$?
expect "no tools on PATH" 0 ''
out=$(python3 -c 'print("push" + " " * 1048576)' | "$HOOK" 2>"$REPO/hook.stderr"); code=$?
expect "oversized payload" 0 ''

echo
[ "$FAILED" = 0 ] && echo "ALL PASS" || echo "SOME FAILED"
exit $FAILED
