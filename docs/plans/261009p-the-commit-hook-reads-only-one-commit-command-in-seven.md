# The screenshot commit hook reads only one commit command in seven

Found by the Overseer, 2026-10-09, and fixed under Greg's standing rule for bugs (2026-10-09: *"You
are definitely authorised to fix bugs any time you notice them"*). Builds on
[261007m](261007m-compress-docs-screenshots-on-commit.md), which added the hook this plan repairs.
The postmortem is
[261009j](../postmortems/261009j-a-hook-that-cannot-read-the-command-does-nothing-and-says-nothing.md).

## The problem

`tests/screenshots-compressed.test.ts` fails the full suite when a tracked PNG under `docs/` has not
been through `npm run screenshots:compress`. On 2026-10-09 it was red on `dev` at least four times
(fixed by c7f389ebd, aee8df569, 0e745191e and 2a7841322, with more sessions compressing their own
afterwards: 8aaa5bd33, 6e2823069, 70156e45d, 959fc191d). Each time a session had committed plan
screenshots, and each time the red was found an hour later by a full suite or the readiness loop,
which blocks deploys.

The brief assumed nothing compresses at commit time. Something does: 261007m's `PreToolUse` hook,
`.claude/hooks/compress-commit-pngs.sh`. It was registered and it fired, but it **did nothing**,
because it only acts on a command it can read for certain (`.claude/hooks/commit_command.py`), and
the commands sessions actually write are almost never like that.

Measured over every Bash call in the last three days of transcripts on this box:

| | commands | the hook could read them |
|---|---|---|
| any `git commit` | 908 | 131 (14%) |
| a `git commit` naming a `.png` | 67 | 20 (30%) |

What the parser gave up on, in the 777 it could not read: a `$`, `*`, `~` or newline anywhere in the
command (549: `-F $SP/msg.txt`, a heredoc message, `docs/plans/261009m-shots/*.png`); a pipe or a
redirect anywhere (169: `git log -1 | cat`, `printf … > msg.txt`); any other segment (59:
`; git status`, `&& git fetch && git merge`). None of those is in the commit's pathspec. Replaying
the 261009e commit's exact command through the parser returns `None`; replaying the same commit
reduced to the commit alone compresses the file (248,928 → 96,976 bytes).

## What we do

**Status: built, 2026-10-09.** The parser still decides whenever it can read the command, exactly as
before. When it cannot, the hook no longer gives up: it falls back to **every PNG changed from
`HEAD` under `docs/` that the command text names**, found by walking `docs/` on disk and comparing
raw hashes in a batch (not `git status`, which assume-unchanged and skip-worktree can blind). A file
is named when, as a whole word in the text, there is:

- its own path, repo-relative, relative to the command's directory, or absolute; or
- its folder, as a whole word (`git add -- docs/plans/x-shots`), or as the base of a glob that
  matches it (`docs/plans/x-shots/*.png`); or
- a further ancestor, but only as a whole word. Naming `docs/plans/a.md` names no screenshot in
  `docs/plans`.

The fallback does **not** take the staged PNGs: without the parser it cannot tell a bare commit from
a pathspec one, and a peer's staged screenshot in the shared primary is not this commit's. Whichever
way a file was chosen, if its index copy was its exact bytes, the index gets the compressed bytes
(with a receipt binding both the source and written bytes); if not, only the file on disk changes.

The command's directory is the payload's `cwd`, or a leading literal `cd <dir>`. Everything else is
unchanged: symlink refusal, the time limits, never blocking, and the line saying what it did.

**What it still misses**, left to the test: a commit outside Claude Code; a name the text does not
contain (`git commit -a`, `P=docs; git commit -- "$P/x.png"`, `--pathspec-from-file`, an escaped
or pieced-together name); a staged screenshot the command does not name, when the parser declines.
**What it can wrongly touch:** a screenshot named somewhere other than the commit's pathspec (a
message, an `echo`, a `--dry-run`, a commit that then fails). That file is a screenshot under
`docs/` that must be compressed before it is committed anyway, and compressing twice is a no-op, so
261007m's tests that said such a file is left alone now say it is compressed.

`commit_command.parse` is unchanged, because `regenerate-commit-generated.sh` uses it too (see
below).

### How the one-in-seven was counted

Every Bash `tool_use` in the last three days of `~/.claude/projects/-home-greg-code-spideryarn2/*.jsonl`
whose command matched `(^|[;&|\s])git( -\S+)* commit(\s|$)`, put through
`commit_command.parse(cmd, cwd)` with the transcript's own `cwd`; `None` counted as unread. The
refusals were split by the first rule they hit: expansion characters (549), a pipe or redirect (169),
another segment (59).

## Why this and not the other candidates

The brief offered three; the git hook is a fourth.

- **(a) `npm run check:staged-revert` also refuses or fixes.** The 261009e session's first commit
  did not run it, and it inspects the shared index, which the house recipe's pathspec commit
  ignores, so it does not know which files are being committed. It would also braid a screenshot
  fixer into the stale-index guard.
- **(b) compress on capture.** Several capture paths (Playwright scripts, the MCP browser tools,
  the Chrome extension), and it misses a hand-made or copied-in shot. 261007m passed it over for
  the same reasons.
- **(c) a faster test.** Sessions run the suites for files they touched, and nobody touches the
  screenshot test.
- **A real git `pre-commit` hook** is the most complete fix: it sees the exact files of every commit,
  from Claude, Codex, a human or the Overseer, with no parsing. It needs `core.hooksPath` set on the
  shared repository, and
  [260902b](260902b-protect-main-from-an-accidental-push.md) ties that one flip to the `pre-push`
  hook protecting `main` and to a `pre-commit` running `check-staged-revert`, which Greg asked to be
  planned and not yet built (2026-09-02), and which `security-risks.md` R9 tracks. So it is a
  question for Greg, written in the postmortem, not something to slip in here.

The simpler option passed over: **every changed docs PNG on any commit**, named or not. Less code,
but in the shared primary it would rewrite peers' in-progress screenshots on every commit anybody
makes.

## The other hook with the same blind spot

`regenerate-commit-generated.sh` (261007q) reads commits through the same `commit_command.parse`, in
its stricter `approval` mode and only with the commit last, so it acts on **125 of the same 910
commits** (counted the same way). This fallback does not carry over: that hook rewrites the command
and grants permission for it, which is exactly where reading the command for certain is right. What
it needs is to *say* when it declines on a commit that names one of its sources, so the session
runs the generator. That is a separate change to a different hook, handed to the Overseer as a bug,
and built in [261009t](261009t-the-regenerate-hook-says-when-it-declines-a-commit-that-names-its-sources.md).

## Stages

1. Red first: four real command shapes covering five screenshots from 2026-10-09 (a trailing
   `; git log | cat`, a `$SP` message file and a push, a glob over a shots folder, a heredoc message)
   added to `.claude/hooks/compress-commit-pngs.test.sh`; all five screenshots failed on the old
   hook. Done.
2. The fallback in `compress-commit-pngs.sh`, its tests updated, the 261007m plan and
   `browser-control.md` corrected. Done: the hook test ends `ALL PASS`.
3. The postmortem, GPT Sol code review (fixes in place), gates, commit, push to `dev`. Done.

## Review

GPT Sol's plan review ([prompt](261009p-plan-review-prompt.md), [answer](261009p-plan-review-sol.md)):
APPROVE WITH CHANGES, all taken. The first draft took every staged PNG on any commit, which would
have rewritten a peer's staged screenshot on a pathspec commit (now: the fallback takes named files
only); it matched any parent folder, so naming `docs/plans/a.md` would have selected every screenshot
in `docs/plans` (now: the folder only as a whole word or a glob base, with a negative test); it
re-staged only in a bare commit (now one rule for every chosen file, with tests for both index
states); it found candidates with `git status` (now a walk of the disk and batched raw-hash
comparison with `HEAD`); and it overclaimed what the rule cannot miss (now listed above).

GPT Sol's code review ([prompt](261009p-code-review-prompt.md), [answer](261009p-code-review-sol.md),
[diff it reviewed](261009p-code-review.diff)): LAND WITH FIXES, made in place and read before
committing. A whole-word folder such as `docs/plans` sent every PNG in it (954 in `docs/`) through
the compressor, which could run past the deadline, so the fallback now keeps only files whose raw
bytes differ from `HEAD`, in two batched git calls. A peer edit landing between selection and
compression could be re-staged, so the compressor's receipt now carries the hash of the bytes it
read as well as the bytes it wrote (`scripts/compress-screenshots.ts`), and the hook re-stages only
when the first matches what it selected. `leading_cd` expanded a quoted `~` and fell back to the
payload's directory on a `cd` it could not read; it now follows the shell, or does nothing. And
`./docs/...` spellings are matched. Afterwards: the hook test 105 checks `ALL PASS`, the regenerate
hook's own test `ALL PASS`, `tests/screenshots-compressed.test.ts` and `tests/doc-links.test.ts`
49/49, `npm run typecheck` clean, and lint on the two TypeScript files only its two older complexity
notices. The full `npm test` was not run for this change; it touches no app code.
