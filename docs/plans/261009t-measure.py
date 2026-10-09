# Plan 261009t: how often the regenerate hook declines a commit that names one of its sources.
# Usage: python3 -I docs/plans/261009t-measure.py <.claude/hooks dir> <repo root> [days, default 3]
#
# Walks every Bash tool_use (once per id) in the session transcripts modified in the last N days,
# keeps the ones matching the 261009p commit regex, and replays the parts of the hook's decision
# that need only the command text: a `#`, parse(approval=True), and the house-recipe shape (minus
# its isdir check on `git add` names). The worktree each command ran in is gone, so "names a source"
# is textual: a plain substring test for a source path or a generated file's name ("before"), and,
# for the hint, commit_command.named() against the files under the sources in <repo root> today
# ("after"). Whether a named source was actually changed at the time is not recoverable.
import glob, json, os, re, sys, time, collections
sys.dont_write_bytecode = True
sys.path.insert(0, sys.argv[1]); import commit_command
root = os.path.realpath(sys.argv[2])
days = float(sys.argv[3]) if len(sys.argv) > 3 else 3
cut = time.time() - days * 86400
RX = re.compile(r"(^|[;&|\s])git( -\S+)* commit(\s|$)")
SRC = ["src/web/help/", "src/mode-catalog.ts", "src/modes.ts", "src/title-text.ts", "src/messages.ts", "src/web/router.ts", "tests/help-corpus.test.ts",
       "docs/user-feedback/", "scripts/feedback-endings.ts", "src/feedback-ending-values.ts", "src/feedback-question-values.ts", "src/ids.ts", "src/is-main.ts"]
files = []
for src in SRC:
    if src.endswith("/"):
        for d, _, names in os.walk(os.path.join(root, src)):
            files += [os.path.relpath(os.path.join(d, n), root) for n in names]
    elif os.path.exists(os.path.join(root, src)):
        files.append(src)


def acts(cmd, cwd):
    if "#" in cmd: return "hash"
    try: c = commit_command.parse(cmd, cwd, approval=True)
    except Exception: return "error"
    if c is None: return "parse"
    if c.index != len(c.segments) - 1 or not c.dashdash or not c.paths: return "shape"
    lead = c.segments[:-1]
    if lead[:1] == [["npm", "run", "check:staged-revert"]]: lead = lead[1:]
    if len(lead) > 1: return "shape"
    for s in lead:
        if s[:3] != ["git", "add", "--"] or len(s) < 4: return "shape"
    return "acts"


# The hook's own executable_commit(), lifted out of its heredoc, so the replay cannot drift from it.
hook = open(os.path.join(sys.argv[1], "regenerate-commit-generated.sh")).read()
ns = {"commit_command": commit_command, "re": re, "shlex": __import__("shlex")}
exec(re.search(r"^def executable_commit\(cmd\):.*?(?=^def )", hook, re.S | re.M).group(0), ns)


def hinted(cmd, cwd):
    """Would the hint reach a named source, given today's files under the sources?"""
    if not ns["executable_commit"](cmd): return False
    here = commit_command.leading_cd(cmd, cwd)
    if here is None: return False
    # The transcript's worktree is gone: read its paths as if it were this repo.
    return any(commit_command.named(cmd, f, cwd, here) or commit_command.named(cmd, f, root, here) for f in files)


n = 0; why = collections.Counter(); src_named = collections.Counter(); hint = collections.Counter(); seen = set()
for f in glob.glob(os.path.expanduser("~/.claude/projects/-home-greg-code-spideryarn2*/*.jsonl")):
    if os.path.getmtime(f) < cut: continue
    for line in open(f, errors="replace"):
        if '"Bash"' not in line or "commit" not in line: continue
        try: d = json.loads(line)
        except Exception: continue
        cwd = d.get("cwd") or root
        for b in (d.get("message") or {}).get("content") or []:
            if not isinstance(b, dict) or b.get("type") != "tool_use" or b.get("name") != "Bash": continue
            cmd = (b.get("input") or {}).get("command", "")
            if not isinstance(cmd, str) or not RX.search(cmd) or b.get("id") in seen: continue
            seen.add(b.get("id")); n += 1
            r = acts(cmd, cwd if os.path.isdir(cwd) else root)
            why[r] += 1
            if any(s in cmd for s in SRC) or "help-corpus" in cmd or "feedback-endings" in cmd:
                src_named[r] += 1
                if r != "acts":
                    hint["hinted" if hinted(cmd, cwd if os.path.isdir(cwd) else root) else "silent"] += 1
print("commits", n, dict(why))
print("naming a source or output (substring)", dict(src_named))
print("of those declined, the hint would name a source", dict(hint))
