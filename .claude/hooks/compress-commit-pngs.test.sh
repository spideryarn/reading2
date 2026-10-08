#!/bin/bash
# Exercise compress-commit-pngs.sh. Run it with:  bash .claude/hooks/compress-commit-pngs.test.sh
#
# Builds a throwaway repo holding a copy of scripts/compress-screenshots.ts (and this
# checkout's node_modules, linked), puts truecolour PNGs in it, and feeds the hook
# PreToolUse payloads. A file must actually come out as a palette PNG when it should —
# a hook that never compresses passes every "never blocks" case — and every case must
# exit 0, the broken ones included. Needs pngquant, as the hook does.
HOOK="$(cd "$(dirname "$0")" && pwd)/compress-commit-pngs.sh"
SRC="$(cd "$(dirname "$0")/../.." && pwd)"
FAILED=0
EXTRA_PATH=""

command -v pngquant >/dev/null || { echo "FAIL  no pngquant on PATH"; exit 1; }
[ -x "$SRC/node_modules/.bin/tsx" ] || { echo "FAIL  no node_modules in $SRC: npm install"; exit 1; }

REPO=$(mktemp -d)
SHIM=$(mktemp -d)
trap 'rm -rf "$REPO" "$SHIM"' EXIT

# A 200x120 truecolour PNG with flat colours and a little noise, like a UI screenshot.
png() {
  python3 - "$1" "${2:-0}" <<'PY'
import struct, sys, zlib
w, h, seed = 200, 120, int(sys.argv[2])
rows = b"".join(b"\0" + b"".join(
    bytes((250, 250, 248)) if ((x >> 4) + (y >> 4)) % 2 == 0 else bytes((30, 30, (x * 7 + y + seed) % 40))
    for x in range(w)) for y in range(h))
def chunk(t, d):
    return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d))
with open(sys.argv[1], "wb") as f:
    f.write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b""))
PY
}
# Colour type: 3 once pngquant has written it, 2 as made above.
colour() { python3 -c 'import sys; print(open(sys.argv[1], "rb").read()[25])' "$1"; }

(
  cd "$REPO" && git init -q && git config user.email t@t && git config user.name t
  mkdir -p scripts docs/plans "docs/with space" other
  cp "$SRC/scripts/compress-screenshots.ts" scripts/
  ln -s "$SRC/node_modules" node_modules
  echo node_modules > .gitignore
  echo m > msg
  git add -A && git commit -qm base
) || { echo "FAIL setup"; exit 1; }

run() { # command [cwd] → prints stdout, sets $code
  local payload
  payload=$(CMD="$1" CWD="${2:-$REPO}" python3 -c '
import json, os
print(json.dumps({"cwd": os.environ["CWD"], "hook_event_name": "PreToolUse", "tool_name": "Bash",
                  "tool_input": {"command": os.environ["CMD"], "description": "x"}}))')
  out=$(printf '%s' "$payload" | PATH="$EXTRA_PATH$PATH" "$HOOK" 2>"$SHIM/hook.stderr")
  code=$?
}
check() { # label  condition...
  local label="$1"; shift
  if [ "$code" = 0 ] && [ ! -s "$SHIM/hook.stderr" ] && "$@"; then echo "ok    $label"; else echo "FAIL  $label (code $code, out: ${out:-<empty>})"; FAILED=1; fi
}
exit0_quiet() { [ "$code" = 0 ] && [ -z "$out" ] && [ ! -s "$SHIM/hook.stderr" ]; }
said() { [ "$code" = 0 ] && [ ! -s "$SHIM/hook.stderr" ] && printf '%s' "$out" | grep -Eq -- "$1" &&
  printf '%s' "$out" | python3 -c '
import json, sys
d = json.load(sys.stdin)
assert set(d) == {"hookSpecificOutput"}
h = d["hookSpecificOutput"]
assert set(h) == {"hookEventName", "additionalContext"}
assert h["hookEventName"] == "PreToolUse" and isinstance(h["additionalContext"], str)' 2>/dev/null; }
is_palette() { [ "$(colour "$REPO/$1")" = 3 ]; }
is_truecolour() { [ "$(colour "$REPO/$1")" = 2 ]; }
index_matches_file() { [ "$(git -C "$REPO" rev-parse ":$1")" = "$(git -C "$REPO" hash-object -- "$1")" ]; }
export REAL_PNGQUANT="$(command -v pngquant)"
export TEST_REPO="$REPO"

echo "--- self-test ---"
"$HOOK" --self-test | grep -q 'self-test ok' && echo "ok    self-test passes" || { echo "FAIL  self-test"; FAILED=1; }
mkdir -p "$SHIM/nogrep"; printf '#!/bin/sh\nexit 3\n' > "$SHIM/nogrep/grep"; chmod +x "$SHIM/nogrep/grep"
PATH="$SHIM/nogrep:$PATH" "$HOOK" --self-test >/dev/null 2>&1 && { echo "FAIL  self-test passed with grep broken"; FAILED=1; } || echo "ok    self-test fails when grep is broken"

echo "--- the house recipe: a new file, named, untracked when the hook runs ---"
png "$REPO/docs/plans/new.png"
run 'git add -- docs/plans/new.png && git commit -F msg -- docs/plans/new.png'
check "says what it did"                 said 'compressed docs/plans/new\.png'
check "the file is now a palette PNG"    is_palette docs/plans/new.png
check "it was not staged by the hook"    test -z "$(git -C "$REPO" ls-files -- docs/plans/new.png)"
(cd "$REPO" && git add -- docs/plans/new.png && git commit -qm new -- docs/plans/new.png)

echo "--- a relative name from a subdirectory, and a name with a space ---"
png "$REPO/docs/with space/shot.png"
run 'git add -- "with space/shot.png" && git commit -F ../msg -- "with space/shot.png"' "$REPO/docs"
check "relative to cwd, quoted"          is_palette "docs/with space/shot.png"
ln -s "$REPO" "$SHIM/cwd-alias"
png "$REPO/docs/plans/cwd-alias.png"
run 'git add -- docs/plans/cwd-alias.png && git commit -- docs/plans/cwd-alias.png' "$SHIM/cwd-alias"
check "symlinked cwd (including macOS /tmp): compressed" is_palette docs/plans/cwd-alias.png
png "$REPO/docs/plans/cd-prefix.png"
run "cd '$REPO' && git add -- docs/plans/cd-prefix.png && git commit -F msg -- docs/plans/cd-prefix.png" /
check "a leading cd into the repo is followed" is_palette docs/plans/cd-prefix.png
png "$REPO/docs/plans/cd-missing.png"
run 'cd /nonexistent && git add -- docs/plans/cd-missing.png && git commit -- docs/plans/cd-missing.png'
check "a cd to nowhere: quiet"           exit0_quiet
check "a cd to nowhere: untouched"       is_truecolour docs/plans/cd-missing.png

echo "--- a bare commit takes the index ---"
png "$REPO/docs/plans/staged.png" 1
git -C "$REPO" add -- docs/plans/staged.png
run 'git commit -m staged'
check "staged file compressed"           is_palette docs/plans/staged.png
check "and staged again, compressed"     index_matches_file docs/plans/staged.png

echo "--- a staged file edited since is left alone ---"
png "$REPO/docs/plans/edited.png" 2
git -C "$REPO" add -- docs/plans/edited.png
png "$REPO/docs/plans/edited.png" 3
staged_blob=$(git -C "$REPO" rev-parse :docs/plans/edited.png)
run 'git commit -m x'
check "working copy left alone"          is_truecolour docs/plans/edited.png
check "index left as its owner staged it" test "$(git -C "$REPO" rev-parse :docs/plans/edited.png)" = "$staged_blob"
(cd "$REPO" && git commit -qm staged-ones)

echo "--- only paths the commit includes ---"
png "$REPO/docs/plans/peer.png"
for cmd in 'echo docs/plans/peer.png && git commit -- msg' \
  'git commit -m docs/plans/peer.png -- msg' \
  'git add -- docs/plans/peer.png && git commit -- msg' \
  'echo "git commit -- docs/plans/peer.png"' \
  'git -C other commit -- docs/plans/peer.png' \
  'cd other && git commit -- docs/plans/peer.png' \
  'git commit --dry-run -- docs/plans/peer.png' \
  'git commit docs/plans/peer.png --dry-run' \
  'git commit -- docs/plans/peer.png'; do
  png "$REPO/docs/plans/peer.png"
  run "$cmd"
  check "$cmd: untouched" is_truecolour docs/plans/peer.png
done
png "$REPO/docs/plans/peer.png"
git -C "$REPO" add -- docs/plans/peer.png
peer_blob=$(git -C "$REPO" rev-parse :docs/plans/peer.png)
run 'git commit -- msg'
check "path commit excludes staged peer: untouched" is_truecolour docs/plans/peer.png
check "path commit excludes staged peer: index unchanged" test "$(git -C "$REPO" rev-parse :docs/plans/peer.png)" = "$peer_blob"
git -C "$REPO" commit -qm peer

png "$REPO/docs/plans/hidden.png"
git -C "$REPO" add -- docs/plans/hidden.png
git -C "$REPO" update-index --assume-unchanged docs/plans/hidden.png
png "$REPO/docs/plans/hidden.png" 7
hidden_blob=$(git -C "$REPO" rev-parse :docs/plans/hidden.png)
run 'git commit -m hidden'
check "assume-unchanged cannot hide a peer edit" is_truecolour docs/plans/hidden.png
check "hidden edit leaves index alone" test "$(git -C "$REPO" rev-parse :docs/plans/hidden.png)" = "$hidden_blob"
git -C "$REPO" update-index --no-assume-unchanged docs/plans/hidden.png
git -C "$REPO" commit -qm hidden

ln -s plans "$REPO/docs/alias"
png "$REPO/docs/plans/alias-target.png"
run 'git commit -- docs/alias/alias-target.png'
check "symlink parent inside docs is not canonicalized away" is_truecolour docs/plans/alias-target.png

echo "--- unusual staged names and symlinks ---"
for name in 'docs/with space/staged.png' 'docs/plans/back\slash.png' 'docs/plans/tab	name.png' 'docs/plans/é.PNG' 'docs/plans/literal[1].png'; do
  png "$REPO/$name"
  git -C "$REPO" --literal-pathspecs add -- "$name"
  run 'git commit -m unusual'
  check "staged $name: compressed" is_palette "$name"
  check "staged $name: compressed index" index_matches_file "$name"
  git -C "$REPO" commit -qm unusual
done
ln -s ../../other/outside.png "$REPO/docs/plans/staged-link.png"
png "$REPO/other/outside.png"
git -C "$REPO" add -- docs/plans/staged-link.png
link_blob=$(git -C "$REPO" rev-parse :docs/plans/staged-link.png)
run 'git commit -m link'
check "staged symlink: target untouched" is_truecolour other/outside.png
check "staged symlink: index unchanged" test "$(git -C "$REPO" rev-parse :docs/plans/staged-link.png)" = "$link_blob"
git -C "$REPO" commit -qm link

echo "--- compression cannot re-stage concurrent edits ---"
mkdir -p "$SHIM/race"
cat > "$SHIM/race/pngquant" <<'PY'
#!/usr/bin/env python3
import os, shutil, subprocess, sys
root = os.environ["TEST_REPO"]
if sys.argv[-1].endswith("race-z.png"):
    if os.environ["RACE_KIND"] == "worktree":
        shutil.copyfile(root + "/other/peer-edit.png", root + "/docs/plans/race-a.png")
    else:
        blob = subprocess.check_output(["git", "-C", root, "hash-object", "-w", "--", "other/peer-edit.png"]).decode().strip()
        subprocess.check_call(["git", "-C", root, "update-index", "--cacheinfo", "100644", blob, "docs/plans/race-a.png"])
os.execv(os.environ["REAL_PNGQUANT"], [os.environ["REAL_PNGQUANT"], *sys.argv[1:]])
PY
chmod +x "$SHIM/race/pngquant"
png "$REPO/other/peer-edit.png" 9
peer_edit_blob=$(git -C "$REPO" hash-object -- other/peer-edit.png)
for kind in worktree index; do
  png "$REPO/docs/plans/race-a.png" 1
  png "$REPO/docs/plans/race-z.png" 2
  git -C "$REPO" add -- docs/plans/race-a.png docs/plans/race-z.png
  before_blob=$(git -C "$REPO" rev-parse :docs/plans/race-a.png)
  export RACE_KIND="$kind"
  EXTRA_PATH="$SHIM/race:"; run 'git commit -m race'; EXTRA_PATH=""
  if [ "$kind" = worktree ]; then
    check "concurrent unstaged edit: not staged" test "$(git -C "$REPO" rev-parse :docs/plans/race-a.png)" = "$before_blob"
    check "concurrent unstaged edit: preserved" test "$(git -C "$REPO" hash-object -- docs/plans/race-a.png)" = "$peer_edit_blob"
  else
    check "concurrent staged edit: preserved" test "$(git -C "$REPO" rev-parse :docs/plans/race-a.png)" = "$peer_edit_blob"
  fi
  check "other completed file is re-staged" index_matches_file docs/plans/race-z.png
  git -C "$REPO" commit -qm race
done

echo "--- hung pngquant has a deadline and later files still run ---"
mkdir -p "$SHIM/hang"
cat > "$SHIM/hang/pngquant" <<'PY'
#!/usr/bin/env python3
import os, sys, time
if sys.argv[-1].endswith("timeout.png"):
    time.sleep(20)
os.execv(os.environ["REAL_PNGQUANT"], [os.environ["REAL_PNGQUANT"], *sys.argv[1:]])
PY
chmod +x "$SHIM/hang/pngquant"
png "$REPO/docs/plans/timeout.png"
png "$REPO/docs/plans/works.png"
started=$(date +%s)
EXTRA_PATH="$SHIM/hang:"; run 'git add -- docs/plans/timeout.png docs/plans/works.png && git commit -- docs/plans/timeout.png docs/plans/works.png'; EXTRA_PATH=""
check "hung pngquant: bounded wait (8 s a file)" test "$(( $(date +%s) - started ))" -lt 14
check "hung pngquant: always quiet on stderr, no decision" said 'skipped docs/plans/timeout\.png'
check "hung pngquant: original untouched" is_truecolour docs/plans/timeout.png
check "hung pngquant: later file compressed" is_palette docs/plans/works.png

echo "--- left alone ---"
png "$REPO/other/outside.png"; png "$REPO/docs/plans/untracked.png"
png "$REPO/docs/plans/tracked.png"; (cd "$REPO" && git add docs/plans/tracked.png && git commit -qm t)
png "$REPO/docs/plans/tracked.png" 5   # modified, unstaged, not named
run 'git commit -F msg -- other/outside.png'
check "outside docs/: quiet"             exit0_quiet
check "outside docs/: untouched"         is_truecolour other/outside.png
run 'git commit -m x'
check "unnamed, unstaged: quiet"         exit0_quiet
check "untracked, not named: untouched"  is_truecolour docs/plans/untracked.png
check "modified, not staged: untouched"  is_truecolour docs/plans/tracked.png
run 'ls docs/plans/untracked.png'
check "not a commit: quiet"              exit0_quiet
check "not a commit: untouched"          is_truecolour docs/plans/untracked.png
run 'git log --grep commit -- docs/plans/untracked.png'
check "mentions commit, is not one"      is_truecolour docs/plans/untracked.png
ln -s ../../other/outside.png "$REPO/docs/plans/link.png"
run 'git commit -- docs/plans/link.png'
check "symlink out of docs/: untouched"  is_truecolour other/outside.png

echo "--- broken: always exit 0 ---"
mkdir -p "$SHIM/pq"; printf '#!/bin/sh\nexit 3\n' > "$SHIM/pq/pngquant"; chmod +x "$SHIM/pq/pngquant"
EXTRA_PATH="$SHIM/pq:"; run 'git add -- docs/plans/untracked.png && git commit -- docs/plans/untracked.png'; EXTRA_PATH=""
check "pngquant failing: reported"       said 'skipped docs/plans/untracked\.png'
check "pngquant failing: file unchanged" is_truecolour docs/plans/untracked.png
printf 'not a png' > "$REPO/docs/plans/fake.png"
run 'git add -- docs/plans/fake.png docs/plans/untracked.png && git commit -- docs/plans/fake.png docs/plans/untracked.png'
check "one bad file does not stop the rest" is_palette docs/plans/untracked.png
for tool in python3 git; do
  mkdir -p "$SHIM/$tool"; printf '#!/bin/sh\nexit 3\n' > "$SHIM/$tool/$tool"; chmod +x "$SHIM/$tool/$tool"
  png "$REPO/docs/plans/b.png"
  EXTRA_PATH="$SHIM/$tool:"; run 'git commit -- docs/plans/b.png'; EXTRA_PATH=""
  check "$tool broken: quiet"            exit0_quiet
done
mv "$REPO/node_modules" "$REPO/nm"
run 'git commit -- docs/plans/b.png'
check "no tsx: quiet"                    exit0_quiet
mv "$REPO/nm" "$REPO/node_modules"
run 'git commit -- docs/plans/b.png' /nonexistent/dir; check "cwd gone"  exit0_quiet
run 'git commit -- docs/plans/b.png' /;                check "not a repo" exit0_quiet
for payload in 'not json' '' '{"commit":1,"tool_input":[]}' '["commit"]'; do
  out=$(printf '%s' "$payload" | "$HOOK" 2>"$SHIM/hook.stderr"); code=$?
  check "malformed payload" exit0_quiet
done
mkdir -p "$SHIM/empty"
out=$(printf '{"tool_input":{"command":"git commit"}}' | PATH="$SHIM/empty" "$HOOK" 2>"$SHIM/hook.stderr"); code=$?
check "no tools on PATH" exit0_quiet

echo "--- registration ---"
REGISTERED=$(python3 - "$SRC/.claude/settings.json" <<'PY'
import json, sys
with open(sys.argv[1]) as f:
    settings = json.load(f)
hooks = [h for group in settings["hooks"]["PreToolUse"] if group["matcher"] == "Bash" for h in group["hooks"]]
mine = [h for h in hooks if "compress-commit-pngs.sh" in h.get("command", "")]
assert len(mine) == 1 and mine[0]["type"] == "command"
assert 0 < mine[0].get("timeout", 0) <= 60
assert mine[0]["command"].endswith("|| true")
print(mine[0]["command"])
PY
) || { echo "FAIL  registration"; exit 1; }
mkdir -p "$REPO/.claude/hooks"; cp -p "$HOOK" "$(dirname "$HOOK")/commit_command.py" "$REPO/.claude/hooks/"
png "$REPO/docs/plans/reg.png"
PAYLOAD=$(REPO="$REPO" python3 -c 'import json, os; print(json.dumps({"cwd":os.environ["REPO"],"tool_input":{"command":"git add -- docs/plans/reg.png && git commit -- docs/plans/reg.png"}}))')
out=$(printf '%s' "$PAYLOAD" | CLAUDE_PROJECT_DIR="$REPO" bash -c "$REGISTERED" 2>"$SHIM/hook.stderr"); code=$?
check "the registered command runs it"   is_palette docs/plans/reg.png
check "registered output has no permission decision" said 'compressed docs/plans/reg\.png'
out=$(printf '%s' "$PAYLOAD" | CLAUDE_PROJECT_DIR="$REPO/missing" bash -c "$REGISTERED" 2>"$SHIM/hook.stderr"); code=$?
check "a missing hook cannot block"      exit0_quiet

echo
[ "$FAILED" = 0 ] && echo "ALL PASS" || echo "SOME FAILED"
exit $FAILED
