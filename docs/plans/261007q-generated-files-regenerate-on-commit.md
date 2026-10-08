# Regenerate the committed generated files on commit

Asked for by the Overseer, 2026-10-07. On that day the deploy's test gate went red six times, and
several were a committed generated file that had fallen behind its source because a session edited
the source without running the generator:

| Generated file | Source | Generator | Backstop test |
| --- | --- | --- | --- |
| `src/help-corpus.generated.json` | `src/web/help/**` (the pages, `help-content.tsx`, …), `src/mode-catalog.ts` | `WRITE_HELP_CORPUS=1 npx vitest run tests/help-corpus.test.ts` | the same file |
| `src/feedback-endings.generated.ts`, `src/feedback-questions.generated.ts` | `docs/user-feedback/**/*.md` | `npx tsx scripts/feedback-endings.ts` | `tests/feedback-endings.test.ts` |

Screenshots had the same shape and are solved by a commit hook,
[261007m](261007m-compress-docs-screenshots-on-commit.md). This follows it.

## Option 1, generating in the build, does not fit

- **The endings map must stay committed.** `scripts/feedback-shipped-emails.ts` reads
  `src/feedback-endings.generated.ts` *from git, at the commit just deployed*
  (`GENERATED_REPO_PATH`) to decide who gets a "your feedback shipped" letter.
- **On Vercel neither generator can run as it is**: `.vercelignore` excludes both `tests/` (the
  corpus's generator is a Vitest file, because the pages are Vite `?raw` imports) and `docs/` (the
  feedback notes). The questions file has no git reader and could in principle be built, but only by
  shipping `docs/user-feedback/` to the build.
- **Every test and `npm run typecheck` imports these files**, so a gitignored copy would need a
  generation step in every fresh worktree before either could run.

So all three stay committed, and get option 2.

## What we built

[`.claude/hooks/regenerate-commit-generated.sh`](../../.claude/hooks/regenerate-commit-generated.sh),
a Bash `PreToolUse` hook registered beside `compress-commit-pngs.sh` with the same contract: always
exit 0, quiet on any error, `|| true` and a 30 s `timeout` in the registration.

**It acts only on the house recipe**, with the commit last:

    [cd <dir> &&] [npm run check:staged-revert &&] [git add -- <files> &&] git commit … -- <paths>

Anything else is left to the tests: a bare `git commit`, `git add -A` or `git add` of a directory,
anything after the commit (`&& git push`), a trailing shell separator, a `#` comment, shell expansion,
history amendment, hook bypass, unfamiliar options, or a leading `cd` whose path contains `..`.
The last refusal avoids treating Bash's logical parent of a symlink as `realpath`'s physical parent.

1. **Which sets the commit carries.** Each set has one manifest (`SETS` in the hook) used both to
   trigger and to guard: the help set includes its pages, catalogue and token/label sources; the
   feedback set includes its notes, generator, value modules and directly imported helpers.
   `SETS` is the list.
   Deliberately narrower than the generator's import graph (the corpus reaches ~30 modules); a
   change elsewhere is the test's.
2. **Guard.** `git status` over the set's sources (tracked, staged, untracked and ignored): every
   changed file must be covered by the commit's paths **and actually carried by Git**, or the set is
   left alone. A directory pathspec does not carry untracked files: those need an earlier explicit
   `git add`. Index flags that hide edits, symlinks and special files, and untracked outputs are
   refused before generation. `additionalContext` says which file stopped it.
3. **Run the generator** from the repo root (Vitest's `vitest.mjs`, or tsx's Node loader as the PNG
   hook does). A non-zero exit adds nothing.
4. **Recheck**: the set's changed files and their bytes must be the same as before the run. All
   successful sets and their output fingerprints are checked again after all generators, so a peer
   edit during the second generator cannot invalidate the first unnoticed. Invalidated sets add
   nothing.
5. **Add** each output that now differs from `HEAD` and is not already named: the hook returns
   `updatedInput`, every field of the original input kept and the command with those paths appended
   after its `--`, with `permissionDecision: "allow"` — Claude Code applies `updatedInput` only with
   `allow` or `ask`.

**One parser.** The PNG hook's command parsing moved into
[`.claude/hooks/commit_command.py`](../../.claude/hooks/commit_command.py), which both hooks import;
each hook keeps its own selection. The PNG hook's 74 checks pass unchanged after the move (its test
now copies the module beside the hook).

**Speed.** Every Bash call: one `case` on the payload. A commit carrying no source: a Python parse.
A commit carrying sources: `git status` plus ~1.4 s (feedback) or ~3.2 s (corpus), measured.

**Self-test.** `bash .claude/hooks/regenerate-commit-generated.test.sh` (59 checks, ~35 s): a
throwaway repo with stub generators, fed PreToolUse payloads; one case runs the returned command and
reads what the commit carried. Seen failing: a copy of the hook that never runs its generator fails
twelve original checks. The review's boundary, membership, hidden-input and cross-set concurrency
regressions failed before their fixes. A hung generator returns quietly within the internal
deadline, and its process is killed.

**Seen working in Claude Code**, not only in the test: `claude -p --permission-mode default` in a
throwaway repo with the hook registered and no Bash permission, asked to run
`git commit -F msg -- src/web/help/pages/a.md`. The commit ran and carried
`src/help-corpus.generated.json` too.

### The trade-off: `allow`

`allow` skips the permission prompt for that one command. The hook returns it only on the house
recipe above, where every segment is either the commit or one of three harmless forms naming literal
files, and the only change is more paths after `--`. Deny and ask rules, and any other hook's deny,
still win (precedence is deny > defer > ask > allow). The cost: a session that *would* have been
asked about that commit is not. `ask` would keep the prompt, but forces one on every such commit,
auto mode included, which is worse for every session that runs unattended.

The shared parser's `approval=True` is deliberately stricter than its default reading for PNG
selection; the move leaves the PNG hook's selection behavior unchanged.

## The simpler option passed over

A hint only: regenerate, and tell the agent in `additionalContext` to commit the generated file
next. Nothing changed or approved, but nothing guaranteed either, and `git commit … && git push`
pushes the stale file before the agent reads the hint.

## Review

GPT Sol's plan review ([prompt](261007q-generated-files-regenerate-on-commit-plan-review-prompt.md),
[answer](261007q-generated-files-regenerate-on-commit-plan-review-sol.md)) changed the design: bare
commits were dropped (a staged-and-edited source makes the generator read bytes the commit does not
carry); approval is limited to the exact recipe (the PNG parser accepts `git add -A`, and `allow`
covers the whole command); the source lists widened and became one manifest; the before/after
recheck was added; and the option-1 reasoning now names `.vercelignore`. Not taken: atomic writes of
the outputs — the generator writes the working tree exactly as a person running it would, and on
failure the hook adds nothing, so the test still sees the file.

GPT Sol's code review ([prompt](261007q-generated-files-regenerate-on-commit-code-review-prompt.md),
[answer](261007q-generated-files-regenerate-on-commit-code-review-sol.md)) fixed, in this uncommitted
work: a trailing `;` or `&&` the parser dropped, so an appended path could have become a command;
`git add` of pathspec magic, `--amend` and `--no-verify` under approval; a directory path counted as
carrying an untracked file git would leave out; `assume-unchanged`, symlinked and ignored inputs
hiding a peer's edit; the help set's direct dependencies (`title-text`, `messages`, `router`) and the
feedback generator's; and a final recheck across both sets, since the second generator can disturb
the first. The classes: a path-selection parser reused as an approval boundary, and a path's spelling
taken for git's membership. Hence `parse(…, approval=True)`, stricter than the PNG hook's reading,
which is unchanged.

**Accepted, not fixed: a generator that writes and then fails.** If the commit already names the
output (or its directory), the hook cannot keep those bytes out. Sol proposed temporary output in
both generators; not done, because neither real generator produces a wrong file that way.
`scripts/feedback-endings.ts` exits before writing when a header does not parse, and the corpus test
writes the true rendering of the pages even when another of its assertions fails — so the commit
carries a correct file and the backstop test is red over the source either way.

## Not covered

Best-effort freshness, not a guarantee: a commit outside Claude Code, anything outside the recipe, a
peer's change in the same set, a failing generator or a timeout. The tests stay the backstop.
[help-page.md](../project/help-page.md) and [feedback-reports.md](../project/feedback-reports.md)
say which way each file stays fresh.

