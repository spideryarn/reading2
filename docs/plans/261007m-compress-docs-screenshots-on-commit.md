# Compress docs/ screenshots on commit, without anyone remembering

Asked for by the Overseer, 2026-10-07. Builds on
[261007j](261007j-box-followups-tmp-age-overseer-unit-png-compression.md), which added
`npm run screenshots:compress` and the test that refuses an uncompressed PNG under `docs/`.

## The problem

`tests/screenshots-compressed.test.ts` fails the full suite whenever a tracked PNG under `docs/`
has not been through the script. Sessions add screenshots to their plans all day and do not know
about it. On 2026-10-07 it went red twice in a few hours (seven files from 261007j and 261007k), and
a red suite blocks deploys.

## What we did

A third Bash `PreToolUse` hook, [`compress-commit-pngs.sh`](../../.claude/hooks/compress-commit-pngs.sh),
registered beside `push-doc-hint.sh` in `.claude/settings.json` with the same contract: always exit
0, quiet on any error, `|| true` and a `timeout` (30 s) in the registration.

On a command that matches `git … commit`, it compresses, in place:

- **with paths** (`git commit … -- a.png b.ts`, the house recipe): each named path that is a real,
  non-symlinked PNG under `<repo>/docs/` and is either tracked or named by an earlier `git add` in
  the same command — the hook runs before the whole command, so a new file is still untracked then;
- **without paths** (a bare `git commit`, which takes the index): each staged PNG under `docs/` whose
  index copy is byte-for-byte the file on disk. After compressing, it stages exactly the bytes it
  wrote, and only if nobody changed that index entry in the meantime.

It stays out of anything it cannot read for certain: any shell expansion (`$`, globs, backticks),
`git -C`, unfamiliar commit options (`-a`, `--interactive`, …), pathspec magic, more than one
commit, or any segment other than `git add`, `npm run check:staged-revert` and a leading literal
`cd <dir>`. Each of those is left to the test.

It runs `scripts/compress-screenshots.ts --best-effort` through tsx's Node loader, from the repo the
command reaches (not `$CLAUDE_PROJECT_DIR`, which may be the primary when the session is in a
worktree). `--best-effort` is new: a file it cannot take is reported and skipped and the rest still
go; it caps pngquant at 8 s a file and the batch at 20 s, inside the hook's own 26 s and the
registration's 30 s, and prints a receipt (a hash of the bytes written) that the hook re-stages from.

Speed: an ordinary Bash call costs the hook one `case` on the payload. A commit costs a Python parse
and, without paths, a `git diff --cached`. A commit with PNGs costs about a second to start Node plus
about 0.4 s of pngquant per screenshot.

Self-test: `bash .claude/hooks/compress-commit-pngs.test.sh` (74 checks, needs pngquant). Seen
failing: a copy of the first version that never ran the script failed nine checks; one that
re-staged an edited staged file failed "index left as its owner staged it"; and a copy of the
reviewed version that selected no files failed twenty.

## Review

GPT Sol's code review ([prompt](261007m-compress-docs-screenshots-on-commit-code-review-prompt.md),
[answer](261007m-compress-docs-screenshots-on-commit-code-review.md)) fixed what it found: PNG names
inside a commit message or another command were taken as paths; `git -C` and `cd` could point it at
the wrong repo; normalising a path could hide a symlinked parent; `git diff --quiet` trusts
skip-worktree, so re-staging now compares blobs and uses a receipt; no time limits on pngquant; a
`tsx` binary that opens a socket; macOS `/tmp` aliases. After it, two changes of ours: a leading
literal `cd <dir>` is followed rather than refused, because sessions here prefix almost every command
with one; and the per-file limit went from 2 s to 8 s, so a tall full-page screenshot is not skipped.

## What it does not cover, and why that is fine

- A commit made outside Claude Code (a human in a terminal, a Codex session).
- Everything in the "stays out" list above, and a folder rather than a file name.

The test catches all of these; then `npm run screenshots:compress` by hand.

## The simpler option passed over

Making the screenshot helpers write compressed PNGs in the first place. Simpler at the point of
capture, but it does not cover a hand-made shot or one copied in from elsewhere, and there are
several capture paths (Playwright, the Chrome extension, the MCP tools) to change instead of one
commit.
