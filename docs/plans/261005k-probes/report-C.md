# Report C: git, worktrees, tests, build and docs tooling

Stage 1 of [261005k](../261005k-port-overseer-auto-memory-into-docs.md), batch C: 21 memory files.
Nothing was edited. Tree read at `e4e1441c9` (dev), 2026-10-05. Hashes are `sha256sum`, first twelve
characters, taken when each file was read.

## Table

| memory file | sha256 (first 12) | lessons | verdict |
|---|---|---|---|
| `api-build-refuses-stale-client-shell` | `abaa13f68eb4` | L1 (`build:api` alone refuses after a commit; run `npm run build`) already: `deployment.md`, the paragraph before § Everything that bundle imports at module scope — "Which is why `npm run build:api` alone refuses after a commit". L2 (hit while re-measuring `bench-cold-start.ts`) dropped: one finished job. | eligible |
| `typecheck-wrapper-covers-tests-tsc-does-not` | `b8c0efede26a` | L1 (wrapper checks more projects than bare `tsc`) already: `typechecking.md` § The layout — "is not \"the typecheck\", and reaching for it is a trap with no error message". L2 (vitest strips types, a type-level test cannot go red at `npm test`) already: same doc § Why three, and not one — "\"the tests pass\" and \"the tests compile\" are two claims". L3 (prove a type guard red under the right invocation; no case for bare `tsc`) already: § Four ways to report it clean while it is red — "Verify a guard by breaking it, under `npm run typecheck` and nothing narrower". L4 (grep `✗\|error TS`; a pipe destroys the exit code) already: same section — "A pipe also replaces the exit code with the last command's". L5 (2026-09-08 incident; "a note not reached for") dropped: one incident, and a remark about the memory system, which `written-down-is-not-checked.md` owns. Note: the memory's "three projects" is stale; `scripts/typecheck.ts` now discovers every `tsconfig.json`. | eligible |
| `eval-corpus-in-a-worktree-is-the-fixture-cut` | `f75071a2999b` | L1 (worktree `data/` is the fixture cut; 84 vs 360; `matchesManifest: false`) already: `testing.md` § An eval run in a worktree measures the fixture cut, not the corpus — "Nobody reads it". L2 (`cp -rn` appears to work and changes nothing) already: same section — "`cp -rn` skips existing files". L3 (copying the whole corpus breaks four named store suites, which is why `worktree:check` compares `data/` with the fixtures) edit CE1. L4 (run against the primary's directories by absolute path; `entryForDir` matches on slug) edit CE1. L5 (`constitution` is the negative fixture, never to be "repaired") already: `tests/fixtures/data-root/README.md`, the per-slug table — "The **negative fixture**, and the only sliced one" (in Git, though not under `docs/`; see Doubts). | retain |
| `removing-a-worktree-hits-two-false-blockers` | `08f6a2d7b5a6` | L1 (`logs/` no longer blocks; it is walked) already: `worktrees.md` § A new `.gitignore` entry needs a verdict here — "`logs/` is now walked rather than counted". L2 (`.env.local — DIFFERS` "often clears itself now") dropped: stale. `worktrees.md` § `.env.local — DIFFERS` and `scripts/worktree-check.ts:787` both say the line-subset test "was tried here and reverted" on 2026-09-08. L3 (never print a value; compare key names) already: same section — "Do not run a plain `diff` on two `.env.local`s". L4 (untracked eval results are the dangerous kind) already: § `ExitWorktree` refuses for two reasons — "Those 44 were once somebody's *paid* eval results". L5 (a blocker is resolved by an action) already: § A new `.gitignore` entry — "A blocker is resolved by an action, not by an argument." | eligible |
| `biome-formatter-is-off-on-purpose` | `c9d4779f1a60` | L1 (formatter off on purpose; never `--formatter-enabled=true`; 205 lines, 8 the author's) already: `linting.md` § The trap if anyone turns it on — "never pass `--formatter-enabled=true` on the command line". L2 (recovery by `git show HEAD:<file> >` and re-applying by hand) already: same paragraph — "There is no undo: the recovery is `git show HEAD:<file> >` the file". L3 (lint only the files you touched) already: `AGENTS.md` § Before you call it finished — "`npm run lint` on the files you touched". | eligible |
| `a-named-worktree-may-hold-a-dead-sessions-work` | `e5fd016e3e64` | L1 (a named worktree is resumed; look with `git status` and `git log origin/dev..HEAD`) already: `worktrees.md` § Two things about `EnterWorktree` — "is *resumed*, not recreated". L2 (re-derive inherited work's claims; neither trust it nor throw it away) propose CP5. | retain |
| `plan-name-collides-between-agents` | `02ebccbcec5c` | L1 (a shared letter is deliberate; no check-first ritual, no rename) already: `docs/reusable/write-planning-doc.md` § File naming conventions — "Don't worry if this happens", and the header of `scripts/plan-name.ts`. L2 (each directory has its own letter sequence) already: `postmortems.md` — "Its own letter sequence". L3 (the earlier wrong version of this memory) dropped: about the memory itself. | eligible |
| `merge-can-duplicate-what-it-does-not-conflict-on` | `e9e99adc93e2` | L1 (a merge keeps both sides' list entries with no markers, in a file whose marked hunks were elsewhere; run the list's own test straight after) propose CP1. The doc has the general sentence ("says nothing about the files it merged silently") but its example is two *files*; duplication inside one file is the missing case. | retain |
| `commit-pathspec-drops-files-silently` | `ed993b02fc3f` | L1 (a tracked file left out of the pathspec; every gate green because gates read the working tree) edit CE4. L2 (read `git status --porcelain` after every pathspec commit) propose CP2. | retain |
| `fresh-worktree-reds-two-bundle-tests` | `4f2d4b353abd` | L1 (no `api-dist/` reds two bundle tests; `npm run build`) already: `worktrees.md` § What a worktree costs — "`api-dist/vercel.js` is missing until `npm run build` runs". L2 (fleet tests red until `npm run build:fleet`) already: same paragraph — "are red until `npm run build:fleet` runs"; the detail that the reported line is `process.exit unexpectedly called` is edit CE2. L3 (`tests/fetch.test.ts` 400 ms budget busts under load) edit CE2. L4 (check the failing paths are in your diff first) dropped: duplicate of `diff-against-a-base-includes-the-merge` L1. L5 ("3 failed / 865 passed, 40 minutes") dropped: a dated count the doc says ages badly. | retain |
| `diff-against-a-base-includes-the-merge` | `e958f3530a52` | L1 (after merging dev, a diff from a remembered fork point includes everything the merge brought) edit CE3. L2 (don't wait for a green full suite on a busy trunk; show disjointness and push) propose CP4. | retain |
| `copying-a-fixture-uuid-reds-the-suite` | `280da0bdde6b` | L1 (a uuid in two test files reds `fixture-ids`; fix is a fresh uuid) already: `testing.md` § Mint a fixture id randomly, not by counting — "The fix for a flag is a fresh random id, not an exemption". L2 (it flags non-row uuids too; `NOT_A_ROW`) already: same section — "It therefore flags harmless overlaps too". L3 (only the full suite shows it, ~26 minutes later) dropped: a timing, and the gate is one file anyone can run alone. | eligible |
| `a-refused-merge-can-wipe-uncommitted-edits` | `c4a8588138b2` | L1 (a refused merge left tracked edits at HEAD; recovery from the dangling `WIP on` commit) edit CE5. L2 (commit before every merge) propose CP3. | retain |
| `exitworktree-counts-against-local-dev` | `b7122ca5c77b` | L1 ("N commits will be discarded" after a successful push is the wrong question) already: `worktrees.md` § `ExitWorktree` refuses for two reasons — "this count is the wrong question". L2 (re-invoke with `discard_changes: true`) dropped: superseded. The same section says "`ExitWorktree` is for leaving a worktree, not for removing one", and since 2026-10-05 a `WorktreeRemove` hook (`.claude/settings.json:60`) hands removal to `npm run worktree:remove`. | eligible |
| `worktree-session-refuses-compound-shell` | `8a229383866e` | L1 (Bash in a worktree session refuses what it cannot verify, including a heredoc that mentions git; use Edit and Write; a script saved and run is accepted) already: `worktrees.md` § Two things about `EnterWorktree` — "names git in a form too complex to verify". | eligible |
| `em-dash-heading-anchor-fails-both-ways` | `aedb02654539` | L1 (the gate's slug and GitHub's disagree on an em-dash heading) already: `testing.md` § Why the docs have a test — "passes links that are broken on GitHub and rejects the ones that work"; also `version-control.md` — "Two dated headings, one trap". L2 (link with no fragment and name the section in prose) propose CP6; it differs from what the doc tells you to do. L3 (queue item `qi-takva5m9`) dropped: not found anywhere under `docs/`, so not repeated. | retain |
| `prose-through-a-shell-loses-its-markup` | `2ae9b9505022` | L1 (backticks in a double-quoted shell string run as commands; the write succeeds and reads as clumsy prose) propose CP7. L2 (never pass prose through a shell string; Write it, or a quoted heredoc) propose CP7. | retain |
| `writing-escapes-produces-raw-bytes` | `cca7c088f279` | L1 (an escape typed as content can land as the raw byte; `grep` then reads the file as binary) edit CE6. L2 (the signature, and `file <path>`) edit CE6. L3 (the guard is a denylist over everything tracked; commit messages are outside it and git refuses them) edit CE6. L4 (`Edit` and a `Write`-written repair script reintroduce it) edit CE6. L5 (never insert an invisible character to escape syntax) propose CP8. L6 (the repair script holds no escape at all; do not retry a refused Bash call) propose CP8. L7 (`git checkout`/`restore` is not the way out) already: `AGENTS.md` § Working in a tree several agents share — "Never run a git command that throws work away". L8 (watch the guard go red, not pass) already: `AGENTS.md` — "A check you have never seen fail is not evidence". L9 (the false claim that `tools/` was uncovered) dropped: one corrected mistake. | retain |
| `browser-agents-measure-a-moving-tree` | `e7f6081a16c4` | L1 (HMR feeds a long browser check a moving tree) already: `browser-testing.md` § A long check measures a moving tree — "reports on whatever the tree held at each moment, not on a commit". L2 (queue edits, or brief the agent to re-verify at the end) propose CP9. L3 (record the sha a long gate started from; check before acting or telling anyone) propose CP10 — W3's P5 of 2026-10-01, never landed. L4 (a written survey expires the same way; sha in its heading) propose CP11. | retain |
| `scratchpad-scripts-cannot-import-repo-deps` | `0b2d5fc38414` | L1 (a script outside the repo cannot resolve the repo's packages, whatever the cwd; import by absolute path or `createRequire`) edit CE7. | retain |
| `parallel-subagents-share-one-scratchpad` | `034f4ce417c7` | L1 (the scratchpad is per session; give each subagent a prefix; "small targeted edits" for a shared file) already: `docs/reusable/engineering-manager.md` § Delegate — "Parallel subagents share one scratchpad." | eligible |

Eligible 9, retain 12.

## Edits

### CE1 — `docs/project/testing.md` § An eval run in a worktree measures the fixture cut, not the corpus

**Replace** (the section's last paragraph, exact text):

```
Do not fix it by copying the primary's corpus in. `cp -rn` skips existing files, so it appears to
work and changes nothing; copying the whole corpus brings articles the manifest does not describe.
Run evals in the primary, or make the cut deliberate and say so in the write-up.
```

**Text:**

```
Do not fix it by copying the primary's corpus in. `cp -rn` skips existing files, so it appears to
work and changes nothing; copying the whole corpus brings articles the manifest does not describe,
some with incomplete artefact sets, and that reddens `store-roundtrip`, `store-parity`,
`store-shelf-reads` and `admin-store` — which is why `worktree:check` compares `data/` with the
fixtures. Run evals in the primary, or from the worktree against the primary's directories by
absolute path: `entryForDir` (`evals/structure-whole-document/corpus.ts`) matches on the slug as
well as the path, so the manifest hash check still applies. Or make the cut deliberate and say so
in the write-up.
```

Carries: `eval-corpus-in-a-worktree-is-the-fixture-cut` L3, L4.

### CE2 — `docs/project/worktrees.md` § What a worktree costs, measured rather than assumed

**Anchor** (insert directly after this line, inside the same paragraph):

```
`GATE_TOOLING_BUILDS` (`scripts/deploy-checks.ts`).
```

**Text:**

```
The line vitest reports for the fleet ones is `process.exit unexpectedly called with "2"`, with a
stack into `tools/fleet/server.ts`, which reads as a wiring failure; the sentence naming the build
is on stderr above it (2026-09-09, in a docs-only diff). A third red in a loaded full run is no
missing build at all: `tests/fetch.test.ts` holds a wall-clock budget of 400 ms, measured at about
478 ms under load ~40 on 2026-09-08, and passes alone.
```

Carries: `fresh-worktree-reds-two-bundle-tests` L2 (detail), L3.

### CE3 — `docs/project/worktrees.md` § Traps

**Anchor** (insert directly after this line, as a new bullet):

```
  `npm run worktree:setup` fetches, so this now happens whenever anyone starts a worktree.
```

**Text:**

```
- **A diff from a remembered fork point stops being yours once you merge the trunk.**
  `git diff --name-only <fork-point> HEAD` then lists your changes plus everything the merge
  brought in. On 2026-09-08 a session ran it to show a failing `tools/fleet` test could not be its
  own and got fifty fleet files back, which reads as the opposite answer. Three dots against
  `origin/dev` still works after a merge; for one commit,
  `git show --name-only --format="" <commit>`. Whether a red is yours is whether the failing file,
  or anything it imports, is in your commits.
```

Carries: `diff-against-a-base-includes-the-merge` L1.

### CE4 — `docs/project/version-control.md` § The thing that fails silently

**Anchor** (insert directly after this line, as a new paragraph, before "**And the variant where the
import is not yours at all.**"):

```
something you import is in it, it is yours to add.
```

**Text:**

```

**A tracked file left out of the pathspec does the same, and the untracked list cannot show it.**
The recipe's list of paths is typed by hand. On 2026-09-07 a commit of fourteen files left out
`src/web/visitor.ts`: `HEAD` had a new member of `Mode` and no row for it in the total
`Record<Mode, VisitorPolicy>`, so every public reader crashed. `npm test`, `npm run typecheck` and
`npm run check` were green throughout, because all three read the working tree, which had the
row. GPT Sol found it by extracting the commit to a scratch directory and running the visitor
tests against that. After the commit the omitted file is still there as a ` M` line in
`git status --porcelain`.
```

Carries: `commit-pathspec-drops-files-silently` L1.

### CE5 — `docs/project/version-control.md` § Always merge, never rebase

**Anchor** (insert directly after this line, as a new paragraph, before § Commit your own files, by
name, in one command):

```
fires on real textual conflicts only, not on every push.
```

**Text:**

```

**A merge refused over a dirty tree has once taken the edits with it.** On 2026-10-01, in a
worktree with six modified tracked files, `git merge --no-edit origin/dev` printed *"Please commit
your changes or stash them … Aborting"* and *"Merge with strategy ort failed"*, and afterwards all
six files were back at `HEAD`, sharing one mtime. No autostash setting was on. `git status` showed
only untracked files, which looks like an ordinary state. The edits survived as an unreferenced
commit named `WIP on <branch>: <sha> …`, with an `index on …` twin. They were found with
`git fsck --no-reflogs --unreachable`, then `git log --no-walk` over the commit ids it lists,
and written back one file at a time with `git show <sha>:<path> > <path>`. Seen once and not
reproduced; the cause is not known.
```

Carries: `a-refused-merge-can-wipe-uncommitted-edits` L1.

### CE6 — `docs/project/testing.md` § A green run here proves less than it looks like

**Anchor** (insert directly after this line, the end of § A scoped run answers a smaller question
than it looks like, as a new subsection before "### `.env.local` is loaded into tests"):

```
  drive a route.
```

**Text:**

```

### A raw NUL in a file makes every grep of it come back empty

An escape sequence typed as *content* — a backslash-u NUL, a backslash-x zero — through the Write
tool, the Edit tool or a heredoc can land in the file as the control byte itself. The code still
compiles and its tests still pass. What breaks is every later `grep` of that file: this box's
`grep` treats it as binary and prints nothing, exit 1, the same as no match. Eight times between
2026-09-05 and 2026-09-08, in two sessions.

The signature is greps against one file all returning nothing while `sed` shows the text. `file
<path>` settles it in one command: a source file that reports `data` has one. `git grep` and `rg`
read such a file correctly.

[`tests/no-raw-nul-bytes.test.ts`](../../tests/no-raw-nul-bytes.test.ts) catches it at the gate. It
checks every file git tracks, and every untracked file that is not ignored, against a denylist of
binary extensions, so a new directory is covered the day it arrives; its header says why an
allowlist would be the same bug. A commit message is outside it: git refuses one outright with *"a
NUL byte in commit log message not allowed"* and writes nothing.

Retyping the escape to repair it puts the byte back. An `Edit` could not find its `old_string`,
because the file held bytes; a Python repair script written with Write arrived with a NUL in its
own docstring. A zero-width space behaves the same way: it is invisible, and `grep` cannot show it.
```

Carries: `writing-escapes-produces-raw-bytes` L1, L2, L3, L4.

### CE7 — `docs/project/testing.md` § A green run here proves less than it looks like

**Anchor**: directly after the text of CE6 (or, if CE6 is not applied, after the same line,
`  drive a route.`), as a new subsection before "### `.env.local` is loaded into tests".

**Text:**

```

### A script outside the repo cannot import the repo's packages

Reproducing a test's behaviour outside vitest is how a real failure is told from a loaded box, and
the script for it usually sits in a session scratchpad under `/tmp`. Run with `npx tsx` from the
repo root, it still fails with `ERR_MODULE_NOT_FOUND: Cannot find package …`, because Node resolves
a bare import by walking up from the **script's own directory**, not from the working directory.
Import by absolute path into the repo's `node_modules`, or build a `createRequire` rooted at the
repo's `package.json` and require through that. Moving the script into the tree also works, and
puts it in every agent's `git status`.
```

Carries: `scratchpad-scripts-cannot-import-repo-deps` L1.

## Proposals

### CP1 — `docs/reusable/git-resolve-merge-conflicts.md` § Once the proposal is agreed

**Before:** new, after the paragraph ending

```
conflict — which is how a merged migration journal can leave a forked snapshot chain that every test
still passes.
```

**After** (a new paragraph):

```

The same holds inside a file that did conflict. When both sides added entries to one list, array
or registry, git keeps both wherever the added lines did not collide, with no markers. A merge on
2026-09-07 marked five hunks in a route table, all comment wording, and left every referee route
declared twice. After a merge that touches a file holding a list, run that list's own test before
anything else.
```

Why here: this doc owns what a merge does silently, and its only example is two new files. Carries
`merge-can-duplicate-what-it-does-not-conflict-on` L1.

### CP2 — `docs/project/version-control.md` § The thing that fails silently

**Before:** new, as the last sentence of the paragraph CE4 adds (after "`git status --porcelain`.").

**After:**

```
So after every pathspec commit, run `git status --porcelain` and read it: a ` M` line for a file
that belongs to the change is a file that did not go in.
```

Why here: it is a new step in the commit recipe, and this section is where the recipe's silent
failures are listed. Carries `commit-pathspec-drops-files-silently` L2.

### CP3 — `docs/project/worktrees.md` § The workflow

**Before:**

```
git fetch origin dev
git merge origin/dev           # NOT rebase — see below
```

**After:**

```
git fetch origin dev
git merge origin/dev           # NOT rebase — see below. Commit first: never merge on a dirty tree
```

and, after the paragraph ending `Below` (a link to the Traps section) `for why this bites here in particular.`, a new
paragraph:

```

**Commit before every merge.** A merge refused over modified tracked files has once left them at
`HEAD` — [version-control.md § Always merge, never rebase](version-control.md#always-merge-never-rebase).
```

Why here: the workflow block is what an agent copies, and it merges without saying the tree must
be clean. `get-ready-to-deploy.md` already says "Commit before you pull" for its own sweep. Carries
`a-refused-merge-can-wipe-uncommitted-edits` L2. Depends on CE5 for the link's content.

### CP4 — `docs/project/worktrees.md` § The workflow

**Before:** new, after the paragraph CP3 adds (or after `Below` (a link to the Traps section) `for why this bites here in`
`particular.` if CP3 is declined).

**After:**

```

**Do not wait for a green full suite on a busy trunk.** Each merge of `dev` can bring a different
session's breakage: three merges in one afternoon on 2026-09-08 met three unrelated reds, each
fixed upstream within the hour by the session that caused it. Show that your own files are
disjoint from the failing ones, show that your own tests pass, and push.
```

Why here: it changes what the `npm test && npm run typecheck` line in this block is taken to
require. It is a permission, so it is Greg's to give; `AGENTS.md` says to tolerate reds that are not
yours but does not say a push may go ahead over one. Carries `diff-against-a-base-includes-the-merge`
L2.

### CP5 — `docs/project/worktrees.md` § Two things about `EnterWorktree` that have each cost an agent an hour

**Before:** new, after the line

```
checks, sees nothing, and starts again from scratch on top of a half-finished job.
```

**After** (continuing the same paragraph):

```
If there is work there, neither trust it nor throw it away: read it and check its claims
yourself, by breaking each fix and watching its test go red. On 2026-09-05 that took twenty
minutes for three inherited stages, and they were sound.
```

Why here: the paragraph says to look and stops before saying what to do with what you find.
Carries `a-named-worktree-may-hold-a-dead-sessions-work` L2.

### CP6 — `docs/project/testing.md` § Why the docs have a test

**Before:**

```
at once. Left alone on cost, not on merit. **Write anchors the way the gate wants** — one hyphen —
and know they are wrong on github.com; the rendered docs are read locally and in editors far more
often. Fixing it properly is a whole-tree sweep and wants to be its own job.
```

**After:**

```
at once. Left alone on cost, not on merit. **Write anchors the way the gate wants** — one hyphen —
and know they are wrong on github.com; the rendered docs are read locally and in editors far more
often. Or link to the file with no fragment and name the section in prose, which is right in both
places. Fixing it properly is a whole-tree sweep and wants to be its own job.
```

Why here: this paragraph is the rule for such a link, and the memory's advice is a second option
the rule does not offer. Carries `em-dash-heading-anchor-fails-both-ways` L2.

### CP7 — `docs/reusable/documentation-policy.md` § Keeping it true

**Before:** new bullet, after the bullet ending

```
  rule, so adding a line for a new doc, or tweaking a pointer, needs no approval.
```

**After:**

```
- **Never pass prose through a shell string.** Backticks inside a double-quoted shell argument are
  command substitution, so each code span is run and removed: a plan section appended that way on
  2026-09-08 landed with four spans missing, the script printed its success line, and the result
  read as clumsy writing, not as damage. `$`, `!` and `\` are the same family. Write prose with the
  Write tool, or have a script read it from a file; a heredoc with a quoted delimiter is safe. Then
  read what landed.
```

Why here: it is about how a doc edit reaches the file, and no project doc owns that. Carries
`prose-through-a-shell-loses-its-markup` L1, L2.

### CP8 — `docs/project/testing.md`, the subsection CE6 adds

**Before:** new, as the last paragraph of "### A raw NUL in a file makes every grep of it come back
empty".

**After:**

```

So: never insert an invisible character to get round syntax — rewrite the sentence so it does not
need the delimiter. Repair a file with a script that contains no escape sequence at all, building
each backslash with `chr(92)`, finding the line by a plain-text anchor that must match exactly
once, and counting the bad bytes before and after. And when a Bash call is refused for *"control
characters that would be hidden in the approval dialog"*, do not retry it: that is this byte, so
move the content into a file.
```

Why here: these are the instructions that follow from CE6's facts, kept beside them. Carries
`writing-escapes-produces-raw-bytes` L5, L6.

### CP9 — `docs/project/browser-testing.md` § A long check measures a moving tree

**Before:** new, after the line

```
verification round. The same is true of a 24-minute gate on a busy `dev`.
```

**After** (a new paragraph):

```

So do not edit the files a browser agent is checking while it runs; queue the edits. Where that is
not possible, say in its brief which findings to re-verify at the end, or re-run any serious
finding against a known commit before acting on it.
```

Why here: the section states the trap and not what to do about it. Carries
`browser-agents-measure-a-moving-tree` L2.

### CP10 — `docs/project/testing.md` § Run the suite in tmux, because a killed run and a passing run look the same

**Before:** new, after the paragraph ending

```
section belongs to — [silent-success.md](../reusable/silent-success.md).
```

**After** (a new paragraph):

```

**A long gate reports on a commit, not on the tree you are standing in.** Record the sha the run
started from, and before acting on a failure, and above all before telling its owner, check that
sha is still your `HEAD`; `git merge-base --is-ancestor <fix> HEAD` says whether a fix is already
in. On 2026-09-08 three sessions reported the same `fixture-ids` red to its owner after the fix
had merged, one of them from a tree that already held it.
```

Why here: it is the same family as the paragraphs above it. This is W3's P5 from the 2026-10-01
sweep (`docs/plans/261001i-probes/report-W3.md`), which never landed. Carries
`browser-agents-measure-a-moving-tree` L3.

### CP11 — `docs/project/plans.md` § A few principles

**Before:** new bullet, after the bullet ending

```
  prose cannot fail ([written-down-is-not-checked.md](../reusable/written-down-is-not-checked.md)).
```

**After:**

```
- **A survey of the tree carries the sha it was taken at, in its heading.** On 2026-09-08 a 29-row
  census took ninety minutes to land, `dev` moved 52 commits meanwhile, and a peer had shipped the
  stage one of its main findings called missing. Before landing one, re-check the rows the next
  stages depend on, and say that the others were not re-checked.
```

Why here: it sits beside the principle that a status line has to rest on something. Carries
`browser-agents-measure-a-moving-tree` L4.

## Quotes, and doubts

**Quotes.** None. No edit or proposal quotes or paraphrases Greg; no memory in this batch quotes him.
The strings in italics in CE5, CE6 and CP8 are tool and git messages copied from the memory files,
not anyone's words.

**Doubts.**

1. **CE5's mechanism is unexplained, and that is my biggest doubt.** Git does not normally touch the
   working tree when it refuses a merge over local changes, and a `WIP on …` commit is what a stash
   writes. The memory says no autostash setting was on. I could not reproduce it (no state-changing
   git command allowed) and `scripts/worktree-freshen.ts` refuses a dirty tree without stashing. So
   the text says "seen once, cause not known". If the writer thinks one unreproduced sighting is too
   thin for `version-control.md`, CE5 and CP3 should go together to a postmortem instead.
2. **`exitworktree-counts-against-local-dev` disagrees with the doc on the cause.** The memory says
   the count compares with the primary's stale local `dev`; `worktrees.md` says it counts everything
   not on the base branch, including the trunk commits `worktree:setup` merged in. Neither is
   verified here. I took the doc's account and dropped the memory's `discard_changes: true` advice
   as superseded by the 2026-10-05 hook. Its `MEMORY.md` line still says "then discard".
3. **`removing-a-worktree-hits-two-false-blockers` L2 contradicts the tree.** It says `.env.local`
   "often clears itself now"; the doc and the script both record that test as reverted the same day.
   Dropped as stale.
4. **`fresh-worktree-reds-two-bundle-tests` says the fleet test "does NOT announce" its missing
   build; `worktrees.md` says the fleet tests "say so".** Both are partly right: `tools/fleet/server.ts`
   prints the `build:fleet` sentence to stderr and then exits 2, and vitest's headline is the exit.
   CE2 says exactly that. I read the code; I did not run the test.
5. **CP4 may conflict with `AGENTS.md`** ("Run `npm test` and `npm run typecheck` when you finish a
   change"). It is the lesson most likely to be refused or reworded. Another batch's memory
   (`postgres-suites-fail-from-contention`) carries the same "treadmill" point; the two should
   become one proposal.
6. **CP6 offers a second way to write a link where the doc gives one.** If Greg prefers one rule,
   it is a choice between them, not an addition. The queue item the memory cites (`qi-takva5m9`) is
   named in no doc, so I could not tell whether the slug fix is still queued.
7. **Edit or proposal, three close calls.** CE4, CE5 and CE6 go into docs whose other sections are
   rules. Each is written as what happened, with the instruction split out (CP2, CP3, CP8). CE6's
   last paragraph ("Retyping the escape to repair it puts the byte back") is a fact but reads close
   to advice; move it into CP8 if in doubt.
8. **`eval-corpus…` L5 is "already" on the strength of `tests/fixtures/data-root/README.md`**, which
   is in Git but not under `docs/`. `testing.md` does not say that `constitution` is the negative
   fixture. If "already" must mean under `docs/`, it needs one sentence in `testing.md` pointing at
   that README.
9. **`copying-a-fixture-uuid…` is eligible, narrowly.** `testing.md` covers minting ids and the
   gate's breadth, but never says "when you copy a neighbour's fixture, replace every uuid". The
   gate catches it and the doc explains the flag, so I left it.
10. **CE7 and CP7 have no natural owner.** No project doc covers scratch scripts or how prose
    reaches a file through the harness. I put CE7 in `testing.md` because the memory's use is
    reproducing a test, and CP7 in `documentation-policy.md`. No new doc suggested.
11. **Not verified:** the 2026-09-08 fetch timing (478 ms, load ~40), the eight NUL incidents, and
    the 2026-09-07 `AUTH_ROUTES` duplication (29 rows for 21) are the memories' own numbers.
    `tests/fetch.test.ts` does hold a `toBeLessThan(400)`; the four store suites, `entryForDir`,
    `GATE_TOOLING_BUILDS` and the `WorktreeRemove` hook all exist. Every anchor line quoted in the
    Edits and Proposals was checked to occur exactly once in its file.
12. **Out of date in a doc:** `typechecking.md` § The layout still says "three projects" while
    `scripts/typecheck.ts` discovers every `tsconfig.json` (the same doc names
    `tools/fleet/web/tsconfig.json` lower down). Not from a memory lesson; left for the writer.
13. **A practical note for the writer:** a repo hook (`.claude/hooks/protect-shared-tree.sh`) refuses
    any Bash command whose text contains both the word `git` and the word `stash`, even inside a
    grep pattern. CE5's text contains both, so apply it with the Edit tool, not through a shell.
