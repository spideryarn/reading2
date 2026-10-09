"""What one Bash command's `git commit` carries, read for certain or not at all.

Shared by the PreToolUse commit hooks (compress-commit-pngs.sh, regenerate-commit-generated.sh),
so they cannot disagree on what a commit includes. Plans:
docs/plans/261007m-compress-docs-screenshots-on-commit.md and
docs/plans/261007q-generated-files-regenerate-on-commit.md.

`parse(cmd, cwd)` returns None for anything it cannot read for certain: shell expansion, more than
one commit, any segment but a leading literal `cd <dir>`, `git add` and
`npm run check:staged-revert`, and commit options it does not know (-a, -i, --dry-run, ...).
Never interprets a commit message or another command as a path.

`leading_cd` and `named` are the loose reading for when parse() declines: which files the command
text names, message and all. A hook may act on that only where a false positive is harmless
(compressing a screenshot, plan 261009p) or only to say something (plan 261009t).
"""
import fnmatch
import os
import re
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


# In the command text, a path starts at the start or after one of these...
BEFORE = r"(?:^|(?<=[\s'\"=;&|(<>]))"
# ...and ends at the end or before one of these.
AFTER = r"(?=$|[\s'\";&|)<>])"
WORD = r"[^\s'\";&|)<>/]*"  # one path component, which may be a glob
# A `git commit` anywhere in the command, after any global options (`git -C x commit`): the same
# matcher as compress-commit-pngs.sh's is_commit, whose self-test proves it both ways.
COMMIT = re.compile(r"(?:^|[;&|(]|\s)git(?:\s+-\S+(?:\s+[^-\s]\S*)?)*\s+commit(?:\s|$)")


def leading_cd(cmd, cwd):
    """Where a supported leading `cd <dir> &&` (or `;`) goes, or cwd; None if uncertain."""
    m = re.match(r"\s*cd\s+(?:'([^']*)'|\"([^\"$`\\]*)\"|([^\s;&|<>()$`'\"\\]+))\s*(?:&&|;|\n)", cmd)
    if not m:
        # Do not apply paths relative to the payload cwd when the shell will first change it
        # in a form we do not understand (an escaped path, expansion, cd --, ||, ...).
        return None if re.match(r"\s*cd(?:\s|$)", cmd) else os.path.realpath(cwd)
    single, double, bare = m.groups()
    # The shell expands a leading tilde only when it is unquoted.
    target = bare if bare is not None else single if single is not None else double
    if target == "" or (bare is not None and bare.startswith("-")):
        return None
    if bare is not None:
        target = os.path.expanduser(target)
    target = os.path.join(cwd, target)
    return os.path.realpath(target) if os.path.isdir(target) else None


def named(cmd, name, root, cwd):
    """Does the command text name this file: the file itself, its folder as a whole word, or its
    folder as the base of a glob that matches it (`docs/plans/x-shots/*.png`)? Repo-relative,
    cwd-relative or absolute. A further ancestor counts only as a whole word, so a command that
    names `docs/plans/a.md` names no screenshot in docs/plans."""
    def spellings(rel):
        absolute = os.path.join(root, rel)
        base = {s for s in (rel, absolute, os.path.relpath(absolute, cwd)) if s not in ("", ".")}
        return base | {"./" + s for s in base if not os.path.isabs(s)}
    if any(re.search(BEFORE + re.escape(s) + AFTER, cmd) for s in spellings(name)):
        return True
    parent, base = os.path.split(name)
    for s in spellings(parent):
        for m in re.finditer(BEFORE + re.escape(s) + "(?:/(" + WORD + "))?" + AFTER, cmd):
            pattern = m.group(1)
            if not pattern or (re.search(r"[*?\[]", pattern) and fnmatch.fnmatchcase(base, pattern)):
                return True
    parent = os.path.dirname(parent)
    while parent:
        if any(re.search(BEFORE + re.escape(s) + "/?" + AFTER, cmd) for s in spellings(parent)):
            return True
        parent = os.path.dirname(parent)
    return False
