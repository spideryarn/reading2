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
# a trailing `&& git push` — is not regenerated or approved, but if its text names a changed
# source it says which generator to run (`additionalContext` only): 137 of 174 measured commit
# command texts that named a source were declined silently (plan 261009t).
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
import hashlib, json, os, re, shlex, signal, stat, subprocess, sys, time
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
        "hint": "WRITE_HELP_CORPUS=1 npx vitest run tests/help-corpus.test.ts",  # docs/project/help-page.md
    },
    {
        "name": "the feedback endings and questions",
        "sources": ["docs/user-feedback/", "scripts/feedback-endings.ts", "src/feedback-ending-values.ts", "src/feedback-question-values.ts", "src/ids.ts", "src/is-main.ts"],
        "outputs": ["src/feedback-endings.generated.ts", "src/feedback-questions.generated.ts"],
        "command": lambda root: ["node", "--import", os.path.join(root, "node_modules/tsx/dist/loader.mjs"), os.path.join(root, "scripts/feedback-endings.ts")],
        "env": {},
        "hint": "npx tsx scripts/feedback-endings.ts",  # docs/project/feedback-reports.md
    },
]


def covers(path, name):
    """Does commit path `path` (repo-relative) carry file `name`? A path may be a directory."""
    path = path.rstrip("/")
    return path in ("", ".") or name == path or name.startswith(path + "/")


def under(name, source):
    return name.startswith(source) if source.endswith("/") else name == source


def house_recipe(commit):
    """`[cd <dir> &&] [npm run check:staged-revert &&] [git add -- <files> &&] git commit … -- <paths>`."""
    if commit.index != len(commit.segments) - 1 or not commit.dashdash or not commit.paths:
        return False
    leading = commit.segments[:-1]
    if leading[:1] == [["npm", "run", "check:staged-revert"]]:
        leading = leading[1:]
    if len(leading) > 1:
        return False
    for s in leading:
        names = s[3:] if s[:3] == ["git", "add", "--"] else None
        if not names or any(n in (".", "..") or n.startswith(("-", ":")) or os.path.isdir(os.path.join(commit.cwd, n)) for n in names):
            return False
    return True


def executable_commit(cmd):
    """Does the shell text contain a plain `git commit` in command position?

    COMMIT is the cheap matcher shared in shape with the screenshot hook. This second, conservative
    pass keeps quoted instructions, comments and heredoc bodies from looking executable, and refuses
    directory-changing forms the fallback cannot locate. Missing an exotic commit is safer than
    giving advice about a different repository.
    """
    if not commit_command.COMMIT.search(cmd):
        return False
    # A here-document's body is data, not shell code: drop it, so a commit after
    # `cat > msg <<'EOF' … EOF` (a common shape here) is still seen. One whose end we cannot
    # find leaves the rest as data, and the `<<` check below gives up.
    lines, kept, ends = cmd.split("\n"), [], []
    for line in lines:
        if ends:
            if (line.lstrip("\t") if ends[0][1] else line) == ends[0][0]:
                ends.pop(0)
            continue
        kept.append(line)
        ends = [(m.group(3), m.group(1) == "-") for m in
                re.finditer(r"<<(-?)\s*(['\"]?)([A-Za-z_][A-Za-z0-9_]*)\2", line)]
        if ends:
            kept[-1] = re.sub(r"<<-?\s*(['\"]?)[A-Za-z_][A-Za-z0-9_]*\1", "", line)
    if ends:
        return False
    cmd = "\n".join(kept)
    lex = shlex.shlex(cmd, posix=True, punctuation_chars=";&|()<>\n")
    lex.whitespace = " \t\r"
    lex.whitespace_split = True
    try:
        tokens = list(lex)
    except ValueError:
        return False
    at_start = True
    prior_cds = []
    for i, token in enumerate(tokens):
        if token.startswith("<<"):
            return False  # anything later may be the here-document's data, not shell code
        if token and all(c in ";&|()\n" for c in token):
            at_start = True
            continue
        if not at_start:
            continue
        assignment = re.fullmatch(r"([A-Za-z_][A-Za-z0-9_]*)=.*", token)
        if assignment:
            if assignment.group(1) in ("GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR"):
                return False
            continue
        if token == "!":
            continue
        if token in ("pushd", "popd", "source", ".", "eval"):
            return False
        if token in ("export", "declare", "typeset") and i + 1 < len(tokens):
            if re.match(r"GIT_(?:DIR|WORK_TREE|COMMON_DIR)=", tokens[i + 1]):
                return False
        if token in ("builtin", "command") and i + 1 < len(tokens) and tokens[i + 1] in ("cd", "pushd", "popd"):
            return False
        if token == "cd":
            target = tokens[i + 1] if i + 1 < len(tokens) else ""
            prior_cds.append((i, target))
        if token == "git" and i + 1 < len(tokens) and tokens[i + 1] == "commit":
            if not prior_cds:
                return True
            # leading_cd() understands only one literal leading cd. A `..` component is unsafe
            # even when quoted: Bash follows it logically, while realpath follows symlinks.
            return (len(prior_cds) == 1 and prior_cds[0][0] == 0
                    and ".." not in prior_cds[0][1].split("/"))
        at_start = False
    return False


def main():
    d = json.loads(os.environ["PAYLOAD"])
    tool_input = d.get("tool_input") or {}
    cwd, cmd = d.get("cwd"), tool_input.get("command", "")
    if not isinstance(cwd, str) or not os.path.isdir(cwd) or not isinstance(cmd, str):
        return

    deadline = time.monotonic() + 25
    def expired(_signal, _frame):
        raise TimeoutError()
    signal.signal(signal.SIGALRM, expired)
    signal.alarm(25)  # includes filesystem reads, not just subprocess waits
    where = {"dir": cwd}
    def run(argv, timeout=3, env=None, data=None):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError()
        child = subprocess.Popen(argv, cwd=where["dir"], stdin=subprocess.DEVNULL if data is None else subprocess.PIPE,
                                 stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, start_new_session=True,
                                 env={**os.environ, **(env or {})})
        try:
            out, _ = child.communicate(data, timeout=min(timeout, remaining))
        except (subprocess.TimeoutExpired, TimeoutError):
            os.killpg(child.pid, signal.SIGKILL)
            child.communicate()
            raise TimeoutError()
        return child.returncode, out

    def declined():
        """The hook will not regenerate. If this is a commit whose text names a source that differs
        from HEAD, say which generator to run (plan 261009t). Advice only: no updatedInput, no
        permission decision, so what the hook approves is unchanged."""
        if not executable_commit(cmd):
            return
        here = commit_command.leading_cd(cmd, cwd)
        if here is None:
            return
        where["dir"] = here
        code, out = run(["git", "rev-parse", "--show-toplevel"])
        if code != 0:
            return
        top = os.path.realpath(os.fsdecode(out).rstrip("\n"))
        where["dir"] = top
        said = []
        for s in SETS:
            # From the disk and HEAD's tree, not git status, which assume-unchanged and
            # skip-worktree can blind.
            on_disk = set()
            for src in s["sources"]:
                if src.endswith("/"):
                    for directory, dirs, files in os.walk(os.path.join(top, src)):
                        on_disk.update(os.path.relpath(os.path.join(directory, f), top) for f in files)
                        links = [d for d in dirs if os.path.islink(os.path.join(directory, d))]
                        on_disk.update(os.path.relpath(os.path.join(directory, d), top) for d in links)
                        dirs[:] = [d for d in dirs if d not in links]
                elif os.path.lexists(os.path.join(top, src)):
                    on_disk.add(src)
            code, tree = run(["git", "--literal-pathspecs", "ls-tree", "-r", "-z", "HEAD", "--", *s["sources"]])
            head = {}
            for record in tree.split(b"\0") if code == 0 else []:
                meta, tab, name = record.partition(b"\t")
                if tab and len(meta.split()) == 3:
                    fields = meta.split()
                    kind = b"symlink" if fields[0] == b"120000" else fields[1]
                    head[os.fsdecode(name)] = (kind, fields[2])
            candidates = sorted(n for n in on_disk | set(head) if commit_command.named(cmd, n, top, here))
            hashes = {}
            regular = []
            individual = []
            for n in candidates:
                file = os.path.join(top, n)
                try:
                    kind = os.lstat(file).st_mode
                except FileNotFoundError:
                    continue
                if stat.S_ISREG(kind) and "\n" not in n:
                    regular.append(n)
                elif stat.S_ISREG(kind) or stat.S_ISLNK(kind):
                    individual.append((n, kind))
            if regular:
                code, out = run(["git", "hash-object", "--no-filters", "--stdin-paths"],
                                data=b"".join(os.fsencode(n) + b"\n" for n in regular))
                blobs = out.splitlines()
                if code != 0 or len(blobs) != len(regular):
                    continue
                hashes.update((n, (b"blob", blob)) for n, blob in zip(regular, blobs))
            failed = False
            for n, kind in individual:
                file = os.path.join(top, n)
                if stat.S_ISLNK(kind):
                    data = os.fsencode(os.readlink(file))
                else:
                    with open(file, "rb") as source:
                        data = source.read()
                code, out = run(["git", "hash-object", "--no-filters", "--stdin"], data=data)
                blob = out.strip()
                if code != 0 or not blob:
                    failed = True
                    break
                worktree_kind = b"symlink" if stat.S_ISLNK(kind) else b"blob"
                hashes[n] = (worktree_kind, blob)
            if failed:
                continue
            changed = [n for n in candidates if head.get(n) != hashes.get(n)]
            if changed:
                more = f" (and {len(changed) - 1} more)" if len(changed) > 1 else ""
                said.append(f"did not regenerate {s['name']} automatically, because this command is not the one form "
                            f"the hook can safely extend ([cd <dir> &&] [git add -- <files> &&] git commit … -- <paths>, "
                            f"the commit last), although it names {changed[0]}{more}, which feeds it. After this command "
                            f"finishes, run `{s['hint']}` from the repository root, and commit "
                            f"{' and '.join(s['outputs'])} if it changes them")
        if said:
            print(json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse",
                              "additionalContext": "Commit hook (never blocks): " + "; ".join(said)}}))

    # The approval below covers the whole command, so only the house recipe gets it.
    # shlex drops a comment, and a path appended after one would be inside it.
    commit = None if "#" in cmd else commit_command.parse(cmd, cwd, approval=True)
    if commit is None or not house_recipe(commit):
        return declined()
    where["dir"] = commit.cwd
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
            return declined()  # outside this repo
        paths.append("" if rel == "." else rel)
    for absolute in commit.added:
        rel = os.path.relpath(absolute, root)
        if rel == ".." or rel.startswith("../"):
            return declined()  # approval cannot cover staging files in another repository

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
