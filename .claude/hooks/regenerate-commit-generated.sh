#!/bin/bash
# PreToolUse hook on Bash: on the house commit recipe, regenerate a committed generated file
# whose source the commit carries, and add it to the same commit.
#
#   src/help-corpus.generated.json        ← the Help pages     (tests/help-corpus.test.ts)
#   src/feedback-{endings,questions}.generated.ts ← docs/user-feedback/ (scripts/feedback-endings.ts)
#
# Why: both are committed (the deploy's shipped-emails step reads the feedback map from git; the
# corpus can only be built inside Vitest), and on 2026-10-07 the deploy's test gate went red over
# and over because a session edited a source without running its generator. The tests stay as the
# backstop. Plan: docs/plans/261007q-generated-files-regenerate-on-commit.md.
#
# Acts only on `[cd <dir> &&] [npm run check:staged-revert &&] [git add -- <files> &&]
# git commit … -- <paths>`, with the commit last. The commit takes its paths from the working
# tree, so the generated file has to be named in the command: the hook returns `updatedInput`
# with it appended after `--`, which Claude Code honours only with `permissionDecision: allow`.
# That approval is the trade-off the plan names. Anything else — a bare commit, `git add -A`,
# a trailing `&& git push` — is left alone, for the test to catch.
#
# A set is regenerated only when every changed file of its sources is in this commit, and its
# sources are unchanged across the run: the generator reads the working tree, and a peer's
# unfinished page must not ride into somebody else's commit.
#
# The same contract as compress-commit-pngs.sh: ALWAYS exit 0, quiet on any error, never block a
# commit. The registration in .claude/settings.json adds a `timeout` and `|| true`.
set -uo pipefail
export LC_ALL=C

quiet() { exit 0; }

if [ "${1:-}" = "--self-test" ]; then
  exec bash "$(cd "$(dirname "$0")" && pwd)/regenerate-commit-generated.test.sh"
fi
exec 2>/dev/null

payload=$(cat) || quiet
case "$payload" in *commit*) ;; *) quiet ;; esac   # every Bash call passes here; stay cheap
HOOK_DIR=$(cd "$(dirname "$0")" && pwd) || quiet
PAYLOAD="$payload" HOOK_DIR="$HOOK_DIR" python3 - <<'PYTHON'
import hashlib, json, os, shlex, signal, stat, subprocess, sys, time
sys.dont_write_bytecode = True  # no __pycache__ in .claude/hooks
sys.path.insert(0, os.environ["HOOK_DIR"])
import commit_command  # the shared reading of what a commit carries

# One manifest per generated set: what triggers it and what the guard checks are the same list.
# A directory ends in "/". Narrower than the generator's whole import graph on purpose (the help
# corpus imports ~30 modules); a change to the rest is left to the test.
SETS = [
    {
        "name": "the Help chatbot's corpus",
        "sources": ["src/web/help/", "src/mode-catalog.ts", "src/modes.ts", "src/title-text.ts", "src/messages.ts", "src/web/router.ts", "tests/help-corpus.test.ts"],
        "outputs": ["src/help-corpus.generated.json"],
        "command": lambda root: ["node", os.path.join(root, "node_modules/vitest/vitest.mjs"), "run", "tests/help-corpus.test.ts"],
        "env": {"WRITE_HELP_CORPUS": "1"},
    },
    {
        "name": "the feedback endings and questions",
        "sources": ["docs/user-feedback/", "scripts/feedback-endings.ts", "src/feedback-ending-values.ts", "src/feedback-question-values.ts", "src/ids.ts", "src/is-main.ts"],
        "outputs": ["src/feedback-endings.generated.ts", "src/feedback-questions.generated.ts"],
        "command": lambda root: ["node", "--import", os.path.join(root, "node_modules/tsx/dist/loader.mjs"), os.path.join(root, "scripts/feedback-endings.ts")],
        "env": {},
    },
]


def covers(path, name):
    """Does commit path `path` (repo-relative) carry file `name`? A path may be a directory."""
    path = path.rstrip("/")
    return path in ("", ".") or name == path or name.startswith(path + "/")


def under(name, source):
    return name.startswith(source) if source.endswith("/") else name == source


def main():
    d = json.loads(os.environ["PAYLOAD"])
    tool_input = d.get("tool_input") or {}
    cwd, cmd = d.get("cwd"), tool_input.get("command", "")
    if not isinstance(cwd, str) or not os.path.isdir(cwd) or not isinstance(cmd, str):
        return
    if "#" in cmd:
        return  # shlex drops a comment, and a path appended after one would be inside it
    commit = commit_command.parse(cmd, cwd, approval=True)
    if commit is None:
        return
    # The approval below covers the whole command, so only the house recipe gets it.
    if commit.index != len(commit.segments) - 1 or not commit.dashdash or not commit.paths:
        return
    leading = commit.segments[:-1]
    if leading[:1] == [["npm", "run", "check:staged-revert"]]:
        leading = leading[1:]
    if len(leading) > 1:
        return
    for s in leading:
        names = s[3:] if s[:3] == ["git", "add", "--"] else None
        if not names or any(n in (".", "..") or n.startswith(("-", ":")) or os.path.isdir(os.path.join(commit.cwd, n)) for n in names):
            return

    deadline = time.monotonic() + 25
    def expired(_signal, _frame):
        raise TimeoutError()
    signal.signal(signal.SIGALRM, expired)
    signal.alarm(25)  # includes filesystem reads, not just subprocess waits
    where = {"dir": commit.cwd}
    def run(argv, timeout=3, env=None):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError()
        child = subprocess.Popen(argv, cwd=where["dir"], stdin=subprocess.DEVNULL,
                                 stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, start_new_session=True,
                                 env={**os.environ, **(env or {})})
        try:
            out, _ = child.communicate(timeout=min(timeout, remaining))
        except (subprocess.TimeoutExpired, TimeoutError):
            os.killpg(child.pid, signal.SIGKILL)
            child.communicate()
            raise TimeoutError()
        return child.returncode, out

    code, out = run(["git", "rev-parse", "--show-toplevel"])
    if code != 0:
        return
    root = os.path.realpath(os.fsdecode(out).rstrip("\n"))
    where["dir"] = root

    def git(*args):
        code, out = run(["git", "--literal-pathspecs", "-C", root, *args])
        if code != 0:
            raise RuntimeError()
        return out

    paths = []
    for p in commit.paths:
        rel = os.path.relpath(os.path.abspath(os.path.join(commit.cwd, p)), root)
        if rel == ".." or rel.startswith("../"):
            return  # outside this repo
        paths.append("" if rel == "." else rel)
    for absolute in commit.added:
        rel = os.path.relpath(absolute, root)
        if rel == ".." or rel.startswith("../"):
            return  # approval cannot cover staging files in another repository

    def changed(sources):
        """Every file under `sources` that differs from HEAD, staged or not, tracked or not."""
        out = git("status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all", "--ignored", "--", *sources)
        return sorted(os.fsdecode(e[3:]) for e in out.split(b"\0") if len(e) > 3)

    def regular(name):
        file = os.path.join(root, name)
        return os.path.realpath(file) == file and (not os.path.lexists(file) or stat.S_ISREG(os.lstat(file).st_mode))

    def uncertain(s):
        entries = git("ls-files", "-v", "-z", "--", *s["sources"], *s["outputs"])
        for entry in entries.split(b"\0"):
            if entry and (entry[:1].islower() or entry[:1] == b"S" or not regular(os.fsdecode(entry[2:]))):
                return os.fsdecode(entry[2:])
        for name in s["outputs"]:
            if not regular(name) or not git("ls-files", "-z", "--", name):
                return name  # appending an untracked output cannot make git commit carry it
        return None

    def carried(name):
        # A directory pathspec does not carry its untracked files. Only an explicit
        # earlier git add or an index/HEAD entry makes those bytes part of this commit.
        if not any(covers(p, name) for p in paths) or not regular(name):
            return False
        if os.path.join(root, name) in commit.added or git("ls-files", "-z", "--", name):
            return True
        code, _ = run(["git", "cat-file", "-e", "HEAD:" + name])
        return code == 0 and not os.path.exists(os.path.join(root, name))  # tracked deletion

    def fingerprint(names):
        h = hashlib.sha256()
        for name in names:
            h.update(name.encode() + b"\0")
            try:
                with open(os.path.join(root, name), "rb") as f:
                    h.update(b"file" + hashlib.sha256(f.read()).digest())
            except FileNotFoundError:
                h.update(b"<gone>")
        return h.hexdigest()

    added, said, verified = [], [], []
    for s in SETS:
        if not any(covers(p, src.rstrip("/")) or under(p, src) for p in paths for src in s["sources"]):
            continue
        unsafe = uncertain(s)
        if unsafe:
            said.append(f"did not regenerate {s['name']}: {unsafe} has an unsafe file type, index flag, or untracked output")
            continue
        before = changed(s["sources"])
        outside = [n for n in before if not carried(n)]
        if outside:
            said.append(f"did not regenerate {s['name']}: {outside[0]} is changed and not in this commit")
            continue
        print_before = fingerprint(before)
        code, _ = run(s["command"](root), timeout=20, env=s["env"])
        if code != 0:
            said.append(f"did not add {s['name']}: its generator failed (the test will say why)")
            continue
        after = changed(s["sources"])
        if after != before or fingerprint(after) != print_before or uncertain(s):
            said.append(f"did not add {s['name']}: its sources changed while it ran")
            continue
        for out_name in s["outputs"]:
            if any(covers(p, out_name) for p in paths):
                continue  # already in the commit; the regenerated bytes go with it
            if not git("status", "--porcelain=v1", "-z", "--untracked-files=all", "--", out_name):
                continue  # regenerated to what HEAD already has
            added.append(out_name)
        said.append(f"regenerated {s['name']}")
        verified.append((s, before, print_before, fingerprint(s["outputs"])))

    # The second generator (or a peer while it runs) can invalidate the first
    # set after its local recheck. Keep receipts for all sets until we return.
    for s, before, source_print, output_print in verified:
        if (changed(s["sources"]) != before or fingerprint(before) != source_print
                or uncertain(s) or fingerprint(s["outputs"]) != output_print):
            added = [name for name in added if name not in s["outputs"]]
            said.append(f"did not add {s['name']}: its sources or outputs changed before the command was returned")

    if not said:
        return
    out = {"hookEventName": "PreToolUse",
           "additionalContext": "Commit hook (never blocks): " + "; ".join(said)
           + (f"; added {', '.join(added)} to this commit" if added else "")}
    if added:
        extra = " ".join(shlex.quote(os.path.relpath(os.path.join(root, a), commit.cwd)) for a in added)
        out["updatedInput"] = {**tool_input, "command": cmd.rstrip() + " " + extra}
        out["permissionDecision"] = "allow"
        out["permissionDecisionReason"] = f"regenerated {', '.join(added)} from the sources this commit carries"
    print(json.dumps({"hookSpecificOutput": out}))

try:
    main()
except Exception:
    pass  # errors are deliberately silent and never affect the permission decision
PYTHON
exit 0
