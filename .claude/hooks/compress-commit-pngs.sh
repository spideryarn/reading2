#!/bin/bash
# PreToolUse hook on Bash: on `git commit`, compress the PNGs under docs/ that the commit
# will carry, in place, before the commit runs — so it carries the compressed bytes.
#
# Why: tests/screenshots-compressed.test.ts fails the whole suite on any tracked PNG under
# docs/ that has not been through `npm run screenshots:compress`, and sessions add
# screenshots to their plans all day without knowing. On 2026-10-07 it went red twice in a
# few hours, and a red suite blocks deploys. The test stays as the backstop; this makes it
# rare. Plan: docs/plans/261007m-compress-docs-screenshots-on-commit.md.
#
# Only literal PNG paths in one ordinary `git commit`, or unchanged staged PNGs in
# a bare commit. Uncertain shell syntax, repository switches and commit options are
# skipped. Never interpret a commit message or another command as a screenshot path.
# Re-staging uses a receipt for the bytes actually written, and checks the index has
# not changed since selection. Parent-directory symlinks are refused too.
#
# The same contract as push-doc-hint.sh: ALWAYS exit 0, quiet on any error. A hook that
# ever blocks a commit costs more than every screenshot it ever shrank. The registration
# in .claude/settings.json adds a `timeout` (past it Claude Code lets the call through;
# the script writes by rename, so a kill mid-file leaves the original) and `|| true`.
#
# Output: JSON `additionalContext` naming what it did, or nothing.
set -uo pipefail
export LC_ALL=C

quiet() { exit 0; }

# The matcher, proved both ways before it is trusted (see push-doc-hint.sh).
is_commit() { printf '%s' "$1" | grep -Eq '(^|[;&|(]|[[:space:]])git([[:space:]]+-[^[:space:]]+([[:space:]]+[^-[:space:]][^[:space:]]*)?)*[[:space:]]+commit([[:space:]]|$)'; }
self_test() {
  is_commit 'git commit -F msg -- a.ts' || return 1
  is_commit 'git add -- x.png && git commit -F m -- x.png' || return 1
  is_commit 'git -C /x commit' || return 1
  is_commit 'npm run check:staged-revert; git commit' || return 1
  is_commit 'git log --grep commit' && return 1
  is_commit 'git commitx' && return 1
  is_commit 'grep -n "git commits" notes' && return 1
  return 0
}

if [ "${1:-}" = "--self-test" ]; then
  self_test && echo "compress-commit-pngs: self-test ok" && exit 0
  echo "compress-commit-pngs: self-test FAILED" >&2; exit 1
fi
exec 2>/dev/null

payload=$(cat) || quiet
case "$payload" in *commit*) ;; *) quiet ;; esac   # every Bash call passes here; stay cheap
self_test || quiet
cmd=$(PAYLOAD="$payload" python3 -c '
import json, os
d = json.loads(os.environ["PAYLOAD"])
cmd = (d.get("tool_input") or {}).get("command", "")
if not isinstance(cmd, str):
    raise ValueError()
print(cmd)
') || quiet
is_commit "$cmd" || quiet
command -v pngquant >/dev/null || quiet
# Python handles parsing, NUL-delimited git paths, bounded subprocesses and
# receipts. Bash 3.2 and BSD tools need no GNU utilities or newer array builtins.
PAYLOAD="$payload" python3 - <<'PYTHON'
import hashlib, json, os, shlex, signal, subprocess, time

def main():
    d = json.loads(os.environ["PAYLOAD"])
    cwd = d.get("cwd")
    cmd = (d.get("tool_input") or {}).get("command", "")
    if not isinstance(cwd, str) or not os.path.isdir(cwd) or not isinstance(cmd, str):
        return
    cwd = os.path.realpath(cwd)  # macOS /var and /tmp are aliases of /private/...
    # Do not evaluate shell expansion or try to reconstruct shell execution state.
    if any(c in cmd for c in "$`*?[]{}~\n"):
        return
    lex = shlex.shlex(cmd, posix=True, punctuation_chars=";&|()<>")
    lex.whitespace_split = True
    segments, part = [], []
    for word in lex:
        if word in (";", "&&"):
            if not part:
                return
            segments.append(part)
            part = []
        elif word and all(c in ";&|()<>" for c in word):
            return
        else:
            part.append(word)
    if part:
        segments.append(part)
    # A leading `cd <dir> &&` is how sessions here reach their worktree; follow a literal one.
    while segments and segments[0][:1] == ["cd"]:
        if len(segments[0]) != 2 or segments[0][1].startswith("-"):
            return
        cwd = os.path.realpath(os.path.join(cwd, segments.pop(0)[1]))
        if not os.path.isdir(cwd):
            return
    commits = [s for s in segments if s[:2] == ["git", "commit"]]
    if len(commits) != 1:
        return
    for s in segments:
        if s is commits[0] or s[:2] == ["git", "add"] or s == ["npm", "run", "check:staged-revert"]:
            continue
        return
    args = commits[0][2:]
    paths, i, only = [], 0, False
    while i < len(args):
        arg = args[i]
        if arg == "--":
            paths.extend(args[i + 1:])
            break
        if arg in ("-m", "--message", "-F", "--file"):
            i += 2
            if i > len(args):
                return
            continue
        if arg.startswith(("--message=", "--file=")) or (arg.startswith(("-m", "-F")) and len(arg) > 2):
            i += 1
            continue
        if arg in ("--only", "-o"):
            only = True
        elif arg in ("--amend", "--no-edit", "--allow-empty", "--allow-empty-message", "--no-verify", "-n", "--quiet", "-q", "--verbose", "-v", "--signoff", "-s"):
            pass
        elif arg.startswith("-"):
            return  # -a, -i, --dry-run, --interactive, etc.: let the backstop handle it
        else:
            paths.append(arg)
        i += 1
    if only and not paths:
        return  # --only --amend carries no staged changes

    deadline = time.monotonic() + 26
    def run(argv, data=None, timeout=2, directory=None):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError()
        child = subprocess.Popen(argv, cwd=directory or cwd, stdin=subprocess.PIPE if data is not None else subprocess.DEVNULL,
                                 stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, start_new_session=True)
        try:
            out, _ = child.communicate(data, timeout=min(timeout, remaining))
        except subprocess.TimeoutExpired:
            os.killpg(child.pid, signal.SIGKILL)
            out, _ = child.communicate()
        return child.returncode, out

    def git(*args, **kwargs):
        code, out = run(["git", "--literal-pathspecs", "-C", root, *args], **kwargs)
        if code != 0:
            raise RuntimeError()
        return out

    code, out = run(["git", "rev-parse", "--show-toplevel"])
    if code != 0:
        return
    root = os.path.realpath(os.fsdecode(out).rstrip("\n"))
    script = os.path.join(root, "scripts/compress-screenshots.ts")
    loader = os.path.join(root, "node_modules/tsx/dist/loader.mjs")
    if not os.path.isfile(script) or not os.path.isfile(loader):
        return
    def safe(name):
        file = os.path.join(root, name)
        return (name.startswith("docs/") and name.lower().endswith(".png") and "\n" not in name
                and os.path.isfile(file) and not os.path.islink(file) and os.path.realpath(file) == file)

    # Preserve literal spelling: resolving symlinks here would bypass the compressor's
    # own refusal and could rewrite a different file from the path being committed.
    if paths:
        files = set()
        added = set()
        for s in segments[:segments.index(commits[0])]:
            if s[:2] != ["git", "add"]:
                continue
            names = s[2:]
            if names[:1] == ["--"]:
                names = names[1:]
            if any(n.startswith(("-", ":")) for n in names):
                continue
            added.update(os.path.relpath(os.path.abspath(os.path.join(cwd, n)), root) for n in names)
        for name in paths:
            if name.startswith(":"):
                return  # git pathspec magic is not a literal pathname
            relative = os.path.relpath(os.path.abspath(os.path.join(cwd, name)), root)
            if safe(relative) and (relative in added or git("ls-files", "-z", "--", relative)):
                files.add(relative)
        restage = {}
    else:
        staged = git("diff", "--cached", "--no-renames", "--name-only", "-z", "--diff-filter=AM")
        files, restage = set(), {}
        for raw in staged.split(b"\0"):
            if not raw:
                continue
            name = os.fsdecode(raw)
            if not safe(name):
                continue
            entry = git("ls-files", "--stage", "-z", "--", name).split(b"\t", 1)[0].split()
            if len(entry) != 3 or entry[0] not in (b"100644", b"100755") or entry[2] != b"0":
                continue
            # diff --quiet trusts assume-unchanged/skip-worktree; raw blob equality does not.
            if git("hash-object", "--no-filters", "--", name).strip() != entry[1]:
                continue
            files.add(name)
            restage[name] = entry
    if not files:
        return
    # The script bounds pngquant and its whole batch. A process-group deadline also
    # covers loader failures; preserve any completed-file receipts if it times out.
    _, output = run(["node", "--import", loader, script, "--best-effort", "--", *sorted(files)], timeout=24, directory=root)
    did = []
    for line in output.decode("utf-8", "replace").splitlines():
        if line.startswith(("compressed ", "kept ", "skipped ")):
            did.append(" ".join(line.split()))
        if not line.startswith("compression-result "):
            continue
        receipt = json.loads(line[len("compression-result "):])
        name = receipt["file"]
        if name not in restage or not safe(name):
            continue
        with open(os.path.join(root, name), "rb") as f:
            data = f.read()
        if hashlib.sha256(data).hexdigest() != receipt["sha256"]:
            continue  # an unstaged peer edit after compression must stay unstaged
        current = git("ls-files", "--stage", "-z", "--", name).split(b"\t", 1)[0].split()
        if current != restage[name]:
            continue  # another owner changed what was staged
        # Stage the verified bytes, rather than re-reading a worktree a peer can edit.
        blob = git("hash-object", "-w", "--stdin", data=data).strip()
        current = git("ls-files", "--stage", "-z", "--", name).split(b"\t", 1)[0].split()
        if current == restage[name]:
            git("update-index", "--cacheinfo", os.fsdecode(current[0]), os.fsdecode(blob), name)
    if did:
        msg = "Commit hook (never blocks): " + "; ".join(did)
        print(json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse", "additionalContext": msg}}))

try:
    main()
except Exception:
    pass  # errors are deliberately silent and never affect the permission decision
PYTHON
exit 0
