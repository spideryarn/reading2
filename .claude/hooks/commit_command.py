"""What one Bash command's `git commit` carries, read for certain or not at all.

Shared by the PreToolUse commit hooks (compress-commit-pngs.sh, regenerate-commit-generated.sh),
so they cannot disagree on what a commit includes. Plans:
docs/plans/261007m-compress-docs-screenshots-on-commit.md and
docs/plans/261007q-generated-files-regenerate-on-commit.md.

`parse(cmd, cwd)` returns None for anything it cannot read for certain: shell expansion, more than
one commit, any segment but a leading literal `cd <dir>`, `git add` and
`npm run check:staged-revert`, and commit options it does not know (-a, -i, --dry-run, ...).
Never interprets a commit message or another command as a path.
"""
import os
import shlex
from typing import NamedTuple, Optional


class Commit(NamedTuple):
    cwd: str  # the directory the commit runs in, after any leading `cd`
    segments: list  # every segment of the command, each a list of words
    index: int  # which segment is the commit
    paths: list  # pathspec as written (empty for a commit of the index)
    only: bool  # --only / -o was given
    dashdash: bool  # the paths came after a literal `--`
    added: set  # repo-relative names an earlier `git add` in the command named

    def segment(self):
        return self.segments[self.index]


def parse(cmd: str, cwd: str, *, approval: bool = False) -> Optional[Commit]:
    cwd = os.path.realpath(cwd)  # macOS /var and /tmp are aliases of /private/...
    # Do not evaluate shell expansion or try to reconstruct shell execution state.
    if any(c in cmd for c in "$`*?[]{}~\n"):
        return None
    # PNG selection needs only a conservative reading of paths. Granting permission needs
    # the complete shell recipe: no ignored comment/separator, and no history/hook bypass.
    # Keep the selection parser's existing behavior when approval=False.
    if approval and any(c in cmd for c in "#;"):
        return None
    lex = shlex.shlex(cmd, posix=True, punctuation_chars=";&|()<>")
    lex.whitespace_split = True
    segments, part = [], []
    for word in lex:
        if word in (";", "&&"):
            if approval and word != "&&":
                return None
            if not part:
                return None
            segments.append(part)
            part = []
        elif word and all(c in ";&|()<>" for c in word):
            return None
        else:
            part.append(word)
    if part:
        segments.append(part)
    elif approval:
        return None  # appending a path after a trailing && would execute it
    # A leading `cd <dir> &&` is how sessions here reach their worktree; follow a literal one.
    cd_count = 0
    while segments and segments[0][:1] == ["cd"]:
        cd_count += 1
        if approval and cd_count > 1:
            return None
        if len(segments[0]) != 2 or segments[0][1].startswith("-"):
            return None
        if approval and ".." in segments[0][1].split("/"):
            return None  # Bash cd follows logical ..; realpath follows a symlink's target
        cwd = os.path.realpath(os.path.join(cwd, segments.pop(0)[1]))
        if not os.path.isdir(cwd):
            return None
    commits = [i for i, s in enumerate(segments) if s[:2] == ["git", "commit"]]
    if len(commits) != 1:
        return None
    index = commits[0]
    for i, s in enumerate(segments):
        if i == index or s[:2] == ["git", "add"] or s == ["npm", "run", "check:staged-revert"]:
            continue
        return None
    args = segments[index][2:]
    paths, i, only, dashdash = [], 0, False, False
    while i < len(args):
        arg = args[i]
        if arg == "--":
            paths.extend(args[i + 1:])
            dashdash = True
            break
        if arg in ("-m", "--message", "-F", "--file"):
            i += 2
            if i > len(args):
                return None
            continue
        if arg.startswith(("--message=", "--file=")) or (arg.startswith(("-m", "-F")) and len(arg) > 2):
            i += 1
            continue
        if arg in ("--only", "-o"):
            only = True
        elif arg in ("--amend", "--no-edit", "--allow-empty", "--allow-empty-message", "--no-verify", "-n", "--quiet", "-q", "--verbose", "-v", "--signoff", "-s"):
            if approval and arg in ("--amend", "--no-verify", "-n"):
                return None
            pass
        elif arg.startswith("-"):
            return None  # -a, -i, --dry-run, --interactive, etc.: let the backstop handle it
        else:
            paths.append(arg)
        i += 1
    if only and not paths:
        return None  # --only --amend carries no staged changes
    if any(p.startswith(":") for p in paths):
        return None  # git pathspec magic is not a literal pathname
    added = set()
    for s in segments[:index]:
        if s[:2] != ["git", "add"]:
            continue
        names = s[2:]
        if names[:1] == ["--"]:
            names = names[1:]
        if any(n.startswith(("-", ":")) for n in names):
            continue
        added.update(os.path.abspath(os.path.join(cwd, n)) for n in names)
    return Commit(cwd, segments, index, paths, only, dashdash, added)
