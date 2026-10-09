#!/bin/bash
# Exercise regenerate-commit-generated.sh. Run it with:
#   bash .claude/hooks/regenerate-commit-generated.test.sh
#
# Builds a throwaway repo with this checkout's node_modules linked and a stub of each generator
# (the real ones need the whole app): the help "corpus" is the pages joined, written by a Vitest
# file when WRITE_HELP_CORPUS=1; the feedback "endings" and "questions" list the notes and the
# question files. Feeds the hook PreToolUse payloads. A generated file must actually be rewritten
# and named in the returned command — a hook that never regenerates passes every "left alone"
# case — and one case runs the returned command and reads what the commit carried.
HOOK="$(cd "$(dirname "$0")" && pwd)/regenerate-commit-generated.sh"
SRC="$(cd "$(dirname "$0")/../.." && pwd)"
FAILED=0

[ -f "$SRC/node_modules/vitest/vitest.mjs" ] && [ -f "$SRC/node_modules/tsx/dist/loader.mjs" ] \
  || { echo "FAIL  no node_modules in $SRC: npm install"; exit 1; }

REPO=$(mktemp -d)
SCRATCH=$(mktemp -d)
trap 'rm -rf "$REPO" "$SCRATCH"' EXIT

(
  cd "$REPO" && git init -q && git config user.email t@t && git config user.name t
  mkdir -p .claude/hooks scripts tests src/web/help/pages docs/user-feedback/questions other
  cp -p "$HOOK" "$(dirname "$HOOK")/commit_command.py" .claude/hooks/
  ln -s "$SRC/node_modules" node_modules
  printf 'node_modules\n' > .gitignore
  cat > tests/help-corpus.test.ts <<'TS'
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { it } from "vitest";
const dir = "src/web/help/pages";
const text = readdirSync(dir).sort().map((f) => readFileSync(`${dir}/${f}`, "utf8")).join("|") + "\n";
it.runIf(process.env.WRITE_HELP_CORPUS === "1")("is written", () => writeFileSync("src/help-corpus.generated.json", text));
TS
  cat > scripts/feedback-endings.ts <<'TS'
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
const notes = readdirSync("docs/user-feedback").filter((f) => f.endsWith(".md")).sort();
if (notes.some((f) => readFileSync(`docs/user-feedback/${f}`, "utf8").includes("BROKEN"))) process.exit(1);
writeFileSync("src/feedback-endings.generated.ts", `export const N = ${JSON.stringify(notes)};\n`);
const qs = readdirSync("docs/user-feedback/questions").sort();
writeFileSync("src/feedback-questions.generated.ts", `export const Q = ${JSON.stringify(qs)};\n`);
if (notes.some((f) => readFileSync(`docs/user-feedback/${f}`, "utf8").includes("EDIT-HELP"))) {
  writeFileSync("src/web/help/pages/a.md", "changed during the second generator\n");
}
if (notes.some((f) => readFileSync(`docs/user-feedback/${f}`, "utf8").includes("HANG"))) {
  writeFileSync("generator.pid", String(process.pid));
  setInterval(() => {}, 1000);
}
TS
  echo one > src/web/help/pages/a.md
  echo two > src/web/help/pages/b.md
  echo note > docs/user-feedback/n1.md
  echo q > docs/user-feedback/questions/q-1.md
  echo x > other/x.ts
  echo m > msg
  node --import ./node_modules/tsx/dist/loader.mjs scripts/feedback-endings.ts
  WRITE_HELP_CORPUS=1 node node_modules/vitest/vitest.mjs run tests/help-corpus.test.ts >/dev/null 2>&1
  [ -s src/help-corpus.generated.json ] && [ -s src/feedback-endings.generated.ts ] || exit 1
  git add -A && git commit -qm base
) || { echo "FAIL setup"; exit 1; }

run() { # command [cwd] → $out (stdout), $code
  local payload
  payload=$(CMD="$1" CWD="${2:-$REPO}" python3 -c '
import json, os
print(json.dumps({"cwd": os.environ["CWD"], "hook_event_name": "PreToolUse", "tool_name": "Bash",
                  "tool_input": {"command": os.environ["CMD"], "description": "keep me", "timeout": 1234}}))')
  out=$(printf '%s' "$payload" | "$HOOK" 2>"$SCRATCH/stderr")
  code=$?
}
field() { # python expression over h (hookSpecificOutput) → prints it
  OUT="$out" python3 -c '
import json, os, sys
h = json.loads(os.environ["OUT"])["hookSpecificOutput"] if os.environ["OUT"].strip() else {}
print(eval(sys.argv[1]))' "$1" 2>/dev/null
}
check() { # label condition...
  local label="$1"; shift
  if [ "$code" = 0 ] && [ ! -s "$SCRATCH/stderr" ] && "$@"; then echo "ok    $label"; else echo "FAIL  $label (code $code, out: ${out:-<empty>})"; FAILED=1; fi
}
command_is() { [ "$(field 'h.get("updatedInput", {}).get("command")')" = "$1" ]; }
allowed() { [ "$(field 'h.get("permissionDecision")')" = allow ] && [ "$(field 'h["updatedInput"]["description"]')" = "keep me" ] \
  && [ "$(field 'h["updatedInput"]["timeout"]')" = 1234 ]; }
unchanged_input() { [ "$(field '"updatedInput" in h or "permissionDecision" in h')" != True ]; }
nothing() { [ -z "$out" ]; }
says() { field 'h.get("additionalContext", "")' | grep -q -- "$1"; }
holds() { grep -q -- "$2" "$REPO/$1"; }
lacks() { ! grep -q -- "$2" "$REPO/$1"; }
# Only ever the throwaway repo above, which holds nothing but this test's own files.
reset_repo() { (cd "$REPO" && git reset -q --hard && git clean -qfd -e node_modules); }

echo "--- a Help page in the house recipe ---"
echo ONE-EDITED > "$REPO/src/web/help/pages/a.md"
run "git commit -F msg -- src/web/help/pages/a.md"
check "the corpus is regenerated"                holds src/help-corpus.generated.json ONE-EDITED
check "and appended to the commit's paths"       command_is "git commit -F msg -- src/web/help/pages/a.md src/help-corpus.generated.json"
check "with allow, other input fields kept"      allowed
check "and says so"                              says "added src/help-corpus.generated.json"
cmd=$(field 'h["updatedInput"]["command"]')
(cd "$REPO" && eval "$cmd") >/dev/null 2>&1
committed=$(cd "$REPO" && git show --name-only --format= HEAD | sort | tr '\n' ' ')
code=0; : > "$SCRATCH/stderr"
check "running it commits page and corpus"       [ "$committed" = "src/help-corpus.generated.json src/web/help/pages/a.md " ]
dirty=$(cd "$REPO" && git status --porcelain)
check "and leaves nothing behind"                [ -z "$dirty" ]

echo "--- a new feedback note, git added in the same command, from a cd ---"
echo shipped > "$REPO/docs/user-feedback/n2.md"
run "cd docs && git add -- user-feedback/n2.md && git commit -F ../msg -- user-feedback/n2.md" "$REPO"
check "the endings are regenerated"              holds src/feedback-endings.generated.ts n2.md
check "only the file that changed is appended, relative to the cd" \
  command_is "cd docs && git add -- user-feedback/n2.md && git commit -F ../msg -- user-feedback/n2.md ../src/feedback-endings.generated.ts"
reset_repo

echo "--- a directory as the commit path ---"
echo q2 > "$REPO/docs/user-feedback/questions/q-2.md"
run "git add -- docs/user-feedback/questions/q-2.md && git commit -F msg -- docs/user-feedback"
check "the questions are appended"               command_is "git add -- docs/user-feedback/questions/q-2.md && git commit -F msg -- docs/user-feedback src/feedback-questions.generated.ts"
reset_repo

echo "--- the generated file already named ---"
echo TWO-EDITED > "$REPO/src/web/help/pages/b.md"
run "git commit -F msg -- src/web/help/pages/b.md src/help-corpus.generated.json"
check "is regenerated"                           holds src/help-corpus.generated.json TWO-EDITED
check "and the command is left as it was"        unchanged_input
reset_repo

echo "--- a peer's unfinished page ---"
echo MINE > "$REPO/src/web/help/pages/a.md"
echo PEER > "$REPO/src/web/help/pages/b.md"
run "git commit -F msg -- src/web/help/pages/a.md"
check "is not regenerated into this commit"      lacks src/help-corpus.generated.json MINE
check "the command is left alone"                unchanged_input
check "and says why"                             says "src/web/help/pages/b.md is changed and not in this commit"
reset_repo
echo PEER > "$REPO/docs/user-feedback/n3.md"
echo mine > "$REPO/docs/user-feedback/n1.md"
run "git commit -F msg -- docs/user-feedback/n1.md"
check "an untracked peer note counts too"        unchanged_input
reset_repo

echo "--- a generator that fails ---"
echo BROKEN > "$REPO/docs/user-feedback/n1.md"
run "git commit -F msg -- docs/user-feedback/n1.md"
check "adds nothing"                             unchanged_input
check "and says so"                              says "generator failed"
reset_repo

echo "--- left alone, and silent: nothing of a generator's is named ---"
echo y > "$REPO/other/x.ts"
run "git commit -F msg -- other/x.ts";                                   check "an unrelated commit"         nothing
run "git commit -F msg -- other/x.ts && git push";                       check "an unrelated declined commit" nothing
run 'git commit -m "$X: src/web/help/pages/b.md" -- other/x.ts';         check "an unchanged source named in a message" nothing
echo LATER-EDIT > "$REPO/src/web/help/pages/a.md"
run "git commit -F msg";                                                 check "a bare commit"               nothing
run "git log --grep commit -- src/web/help/pages/a.md";                  check "not a commit"                nothing
run "echo 'instructions: git commit -- src/web/help/pages/a.md'";         check "a quoted commit is not a command" nothing
run "echo done # git commit -- src/web/help/pages/a.md";                  check "a commented commit is not a command" nothing
run "cat <<'EOF'
git commit -- src/web/help/pages/a.md
EOF";                                                                    check "a commit in a heredoc is not a command" nothing
run "git -C other commit -- src/web/help/pages/a.md";                     check "git -C does not inspect the payload repo" nothing
run "echo first && cd other && git commit -- src/web/help/pages/a.md";    check "a non-leading cd does not inspect the wrong directory" nothing
run "pushd other >/dev/null && git commit -- src/web/help/pages/a.md";     check "pushd does not inspect the wrong directory" nothing
run "GIT_DIR=other/.git GIT_WORK_TREE=other git commit -- src/web/help/pages/a.md"; check "Git directory variables stay silent" nothing
run "export GIT_DIR=other/.git && git commit -- src/web/help/pages/a.md";   check "exported Git directory variables stay silent" nothing
check "and nothing was regenerated"              lacks src/help-corpus.generated.json LATER-EDIT
reset_repo

echo "--- declined, and says so: the commit names a changed source (261009t) ---"
# The hook approves only the house recipe, which it reads for certain. On anything else that names
# a changed source it must still say which generator to run, or a stale file goes in unremarked.
hints_help() { unchanged_input && says "WRITE_HELP_CORPUS=1 npx vitest run tests/help-corpus.test.ts" && says "src/web/help/pages/a.md"; }
hints_feedback() { unchanged_input && says "npx tsx scripts/feedback-endings.ts" && says "docs/user-feedback/n1.md"; }
echo LATER-EDIT > "$REPO/src/web/help/pages/a.md"
run "git add -A && git commit -F msg -- src/web/help/pages/a.md";        check "git add -A before it"        hints_help
run "git add -- src/web/help && git commit -F msg -- src/web/help/pages/a.md"; check "git add of a directory" hints_help
run "git commit -F msg -- src/web/help/pages/a.md && git push";          check "a push after it"             hints_help
run "git commit -F msg src/web/help/pages/a.md";                         check "paths without --"            hints_help
run "git commit -F msg -- src/web/help/pages/a.md # note";               check "a trailing comment"          hints_help
run 'git commit -m "$X" -- src/web/help/pages/a.md';                    check "shell expansion"             hints_help
run "git commit -a -F msg -- src/web/help/pages/a.md";                   check "an unknown option"           hints_help
run "git commit -F msg -- src/web/help/pages/a.md;";                     check "a trailing semicolon"        hints_help
run "git commit -F msg -- src/web/help/pages/a.md &&";                   check "a trailing and operator"     hints_help
run "git add -- :/ && git commit -F msg -- src/web/help/pages/a.md";     check "git add pathspec magic"      hints_help
run "git add -- : && git commit -F msg -- src/web/help/pages/a.md";      check "git add empty pathspec"      hints_help
run "git commit --amend -F msg -- src/web/help/pages/a.md";              check "history rewriting needs its own approval" hints_help
run "git commit --no-verify -F msg -- src/web/help/pages/a.md";          check "bypassing hooks needs its own approval" hints_help
# Shapes measured in session transcripts, 2026-10-06 to 09:
run 'git commit -q -F $SP/msg.txt -- src/web/help/pages/a.md';          check "a \$SP message file"         hints_help
run "git commit -F msg -- src/web/help/pages/a.md; git log -1 | cat";    check "a trailing log piped to cat" hints_help
run "git commit -F msg -- src/web/help/pages/*.md";                      check "a glob over the folder"      hints_help
run "git commit -F msg -- src/web/help && git log -1";                   check "an ancestor folder"          hints_help
run "cd src && git commit -F msg -- web/help/pages/a.md && git push";    check "relative to a leading cd"    hints_help
ln -s "$REPO/docs" "$REPO/other/alias"
run "cd other/alias/.. && git commit -F msg -- src/web/help/pages/a.md"; check "cd through a symlink and .. is uncertain, and silent" nothing
ln -s "$REPO/docs" "$REPO/other/my alias"
run "cd 'other/my alias/..' && git commit -F msg -- src/web/help/pages/a.md"; check "quoted cd through a symlink and .. is silent" nothing
run 'git log -1 && git commit -m "$X" -- src/web/help/pages/b.md';      check "a named source that is unchanged" nothing
check "and nothing was regenerated"              lacks src/help-corpus.generated.json LATER-EDIT
reset_repo
(cd "$REPO" && git update-index --assume-unchanged src/web/help/pages/a.md)
echo HIDDEN-EDIT > "$REPO/src/web/help/pages/a.md"
run 'git commit -m "$X" -- src/web/help/pages/a.md';                    check "assume-unchanged cannot hide a named source" hints_help
(cd "$REPO" && git update-index --no-assume-unchanged src/web/help/pages/a.md && git update-index --skip-worktree src/web/help/pages/a.md)
run 'git commit -m "$X" -- src/web/help/pages/a.md';                    check "nor can skip-worktree"       hints_help
(cd "$REPO" && git update-index --no-skip-worktree src/web/help/pages/a.md)
reset_repo
rm "$REPO/src/web/help/pages/a.md"
run 'git commit -m "$X" -- src/web/help/pages/a.md';                    check "a deleted source counts"     hints_help
reset_repo
echo edited > "$REPO/docs/user-feedback/n1.md"
run "git commit -F - -- docs/user-feedback/n1.md <<'EOF'
a heredoc message
EOF"
check "a heredoc message names the feedback generator" hints_feedback
run "cat > msg <<'EOF'
a message written first
EOF
git commit -F msg -- docs/user-feedback/n1.md && git push"
check "a message written by a heredoc before the commit" hints_feedback
run "cat > msg <<'EOF'
no end, so the commit below is data
git commit -F msg -- docs/user-feedback/n1.md"
check "an unterminated heredoc is all data"     nothing
check "and nothing was regenerated"              lacks src/feedback-endings.generated.ts edited
reset_repo

echo "--- raw hashes cover unusual source names and symlinks ---"
ln -s a.md "$REPO/src/web/help/pages/link.md"
(cd "$REPO" && WRITE_HELP_CORPUS=1 node node_modules/vitest/vitest.mjs run tests/help-corpus.test.ts >/dev/null 2>&1 \
  && git add -- src/web/help/pages/link.md src/help-corpus.generated.json && git commit -qm symlink-source)
run 'git commit -m "$X" -- src/web/help/pages/link.md';                 check "an unchanged symlink source is silent" nothing
rm "$REPO/src/web/help/pages/link.md" && ln -s b.md "$REPO/src/web/help/pages/link.md"
run 'git commit -m "$X" -- src/web/help/pages/link.md'
check "a retargeted symlink source is named"       unchanged_input
check "a retargeted symlink source is changed"     says "src/web/help/pages/link.md"
reset_repo
rm "$REPO/src/web/help/pages/link.md" && printf 'a.md' > "$REPO/src/web/help/pages/link.md"
run 'git commit -m "$X" -- src/web/help/pages/link.md'
check "a symlink replaced by equal blob bytes is changed" says "src/web/help/pages/link.md"
reset_repo
rm "$REPO/src/web/help/pages/link.md"
(cd "$REPO" && WRITE_HELP_CORPUS=1 node node_modules/vitest/vitest.mjs run tests/help-corpus.test.ts >/dev/null 2>&1 \
  && git add -- src/web/help/pages/link.md src/help-corpus.generated.json && git commit -qm remove-symlink-source)
ln -s "$REPO/other" "$REPO/src/web/help/pages/new-dir"
run 'git commit -m "$X" -- src/web/help/pages/new-dir'
check "a new symlink directory source is named"    unchanged_input
check "a new symlink directory source gets a hint" says "src/web/help/pages/new-dir"
rm "$REPO/src/web/help/pages/new-dir"
odd_name=$'docs/user-feedback/odd\nname.md'
printf 'base\n' > "$REPO/$odd_name"
(cd "$REPO" && node --import ./node_modules/tsx/dist/loader.mjs scripts/feedback-endings.ts \
  && git add -- "$odd_name" src/feedback-endings.generated.ts && git commit -qm odd-source)
printf 'edited\n' > "$REPO/$odd_name"
run $'git commit -m "$X" -- \'docs/user-feedback/odd\nname.md\''
check "a changed newline source is named"          unchanged_input
check "a changed newline source gets a hint"       says "docs/user-feedback/odd"
reset_repo

UNBORN="$SCRATCH/unborn"
mkdir -p "$UNBORN/src/web/help/pages" "$UNBORN/other"
(cd "$UNBORN" && git init -q)
printf 'new\n' > "$UNBORN/src/web/help/pages/a.md"
run 'git commit -m "$X" -- src/web/help/pages/a.md' "$UNBORN"
check "an unborn HEAD treats a regular source as new" hints_help
ln -s "$UNBORN/other" "$UNBORN/src/web/help/pages/new-dir"
run 'git commit -m "$X" -- src/web/help/pages/new-dir' "$UNBORN"
check "an unborn HEAD treats a symlink source as new" says "src/web/help/pages/new-dir"

echo "--- directory coverage is not Git membership ---"
echo mine > "$REPO/docs/user-feedback/n1.md"
echo peer > "$REPO/docs/user-feedback/untracked.md"
run "git commit -F msg -- docs/user-feedback"
check "an untracked peer under a commit directory is not carried" unchanged_input
check "the peer is not generated" lacks src/feedback-endings.generated.ts untracked.md
reset_repo

echo "--- hidden inputs and outputs ---"
(cd "$REPO" && git update-index --assume-unchanged src/web/help/pages/b.md)
echo PEER-HIDDEN > "$REPO/src/web/help/pages/b.md"
echo MINE > "$REPO/src/web/help/pages/a.md"
run "git commit -F msg -- src/web/help/pages/a.md"
check "assume-unchanged cannot hide a peer's input" unchanged_input
check "hidden peer bytes are not generated" lacks src/help-corpus.generated.json PEER-HIDDEN
(cd "$REPO" && git update-index --no-assume-unchanged src/web/help/pages/b.md)
reset_repo
(cd "$REPO" && git update-index --assume-unchanged src/help-corpus.generated.json)
echo MINE > "$REPO/src/web/help/pages/a.md"
run "git commit -F msg -- src/web/help/pages/a.md"
check "a hidden output is not silently omitted" unchanged_input
check "the output flag stops generation before writing" says "index flag"
(cd "$REPO" && git update-index --no-assume-unchanged src/help-corpus.generated.json)
reset_repo

echo "--- source and output file types ---"
echo EXTERNAL > "$SCRATCH/external"
rm "$REPO/src/web/help/pages/a.md"
ln -s "$SCRATCH/external" "$REPO/src/web/help/pages/a.md"
run "git commit -F msg -- src/web/help/pages/a.md"
check "a symlink source cannot stand for its target bytes" unchanged_input
check "a symlink source is refused before generation" lacks src/help-corpus.generated.json EXTERNAL
reset_repo
rm "$REPO/src/help-corpus.generated.json"
ln -s "$SCRATCH/external" "$REPO/src/help-corpus.generated.json"
echo MINE > "$REPO/src/web/help/pages/a.md"
run "git commit -F msg -- src/web/help/pages/a.md"
check "a symlink output is refused" unchanged_input
check "the generator cannot overwrite the symlink target" [ "$(cat "$SCRATCH/external")" = EXTERNAL ]
reset_repo
echo ignored.md >> "$REPO/.git/info/exclude"
echo peer > "$REPO/docs/user-feedback/ignored.md"
echo mine > "$REPO/docs/user-feedback/n1.md"
run "git commit -F msg -- docs/user-feedback/n1.md"
check "ignored notes are still generator inputs" unchanged_input
check "ignored peer bytes are not generated" lacks src/feedback-endings.generated.ts ignored.md
rm "$REPO/docs/user-feedback/ignored.md"
reset_repo

echo "--- dirty token dependency ---"
echo 'export const PUBLIC_SHELF_LABEL = "peer";' > "$REPO/src/messages.ts"
echo MINE > "$REPO/src/web/help/pages/a.md"
run "git commit -F msg -- src/web/help/pages/a.md"
check "the corpus's token dependency is guarded" unchanged_input
reset_repo

echo "--- the first set is rechecked after the second generator ---"
echo MINE > "$REPO/src/web/help/pages/a.md"
echo EDIT-HELP > "$REPO/docs/user-feedback/n1.md"
run "git commit -F msg -- src/web/help/pages/a.md docs/user-feedback/n1.md"
check "a later generator cannot invalidate an earlier source snapshot" unchanged_input
check "the invalidated set is reported" says "sources or outputs changed before the command was returned"
reset_repo

echo "--- broken: always exit 0, quiet ---"
out=$(printf 'not json commit' | "$HOOK" 2>"$SCRATCH/stderr"); code=$?;          check "garbage payload" nothing
out=$(printf '{"tool_input":{"command":"git commit -F m -- a"}}' | "$HOOK" 2>"$SCRATCH/stderr"); code=$?; check "no cwd" nothing
run "git commit -F msg -- a" /nonexistent;                                   check "a missing cwd" nothing
rm "$REPO/node_modules"
echo LATER-EDIT > "$REPO/src/web/help/pages/a.md"
run "git commit -F msg -- src/web/help/pages/a.md"
check "no node_modules: nothing added"           unchanged_input
ln -s "$SRC/node_modules" "$REPO/node_modules"
reset_repo

echo "--- a hung generator is bounded and its process is killed ---"
echo HANG > "$REPO/docs/user-feedback/n1.md"
started=$(date +%s)
run "git commit -F msg -- docs/user-feedback/n1.md"
elapsed=$(( $(date +%s) - started ))
check "the generator timeout returns quietly with no approval" unchanged_input
check "the internal deadline fits inside registration" [ "$elapsed" -le 27 ]
pid=$(cat "$REPO/generator.pid")
check "the timed-out generator does not survive" bash -c '! kill -0 "$1" 2>/dev/null' _ "$pid"
reset_repo

echo "--- a hung git while deciding what to say is bounded too ---"
mkdir -p "$SCRATCH/hung-bin"
printf '#!/bin/sh\nsleep 60\n' > "$SCRATCH/hung-bin/git" && chmod +x "$SCRATCH/hung-bin/git"
echo LATER-EDIT > "$REPO/src/web/help/pages/a.md"
started=$(date +%s)
out=$(printf '%s' "$(CWD="$REPO" python3 -c 'import json, os; print(json.dumps({"cwd":os.environ["CWD"],"tool_input":{"command":"git commit -m \"$X\" -- src/web/help/pages/a.md"}}))')" \
  | PATH="$SCRATCH/hung-bin:$PATH" "$HOOK" 2>"$SCRATCH/stderr"); code=$?
elapsed=$(( $(date +%s) - started ))
check "returns quietly"                          nothing
check "well inside the registered timeout"       [ "$elapsed" -le 10 ]
reset_repo

echo "--- registration ---"
REGISTERED=$(python3 - "$SRC/.claude/settings.json" <<'PY'
import json, sys
with open(sys.argv[1]) as f:
    settings = json.load(f)
hooks = [h for group in settings["hooks"]["PreToolUse"] if group["matcher"] == "Bash" for h in group["hooks"]]
mine = [h for h in hooks if "regenerate-commit-generated.sh" in h.get("command", "")]
assert len(mine) == 1 and mine[0]["type"] == "command"
assert mine[0].get("timeout") == 30
assert mine[0]["command"].endswith("|| true")
print(mine[0]["command"])
PY
) || { echo "FAIL  registration"; exit 1; }
echo LATER-EDIT > "$REPO/src/web/help/pages/a.md"
PAYLOAD=$(REPO="$REPO" python3 -c 'import json, os; print(json.dumps({"cwd":os.environ["REPO"],"tool_input":{"command":"git commit -F msg -- src/web/help/pages/a.md"}}))')
out=$(printf '%s' "$PAYLOAD" | CLAUDE_PROJECT_DIR="$REPO" bash -c "$REGISTERED" 2>"$SCRATCH/stderr"); code=$?
check "the registered command runs it"           command_is "git commit -F msg -- src/web/help/pages/a.md src/help-corpus.generated.json"
out=$(printf '%s' "$PAYLOAD" | CLAUDE_PROJECT_DIR="$REPO/missing" bash -c "$REGISTERED" 2>"$SCRATCH/stderr"); code=$?
check "a missing hook cannot block"              nothing

echo
[ "$FAILED" = 0 ] && echo "ALL PASS" || echo "SOME FAILED"
exit $FAILED
