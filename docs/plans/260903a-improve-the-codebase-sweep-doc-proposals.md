# Doc edits from the sweep — proposed, approved, applied

Companion to [260903a-improve-the-codebase-sweep.md](260903a-improve-the-codebase-sweep.md).

CLAUDE.md's rule: *"Editing a doc whose wording is a rule — this file above all, the seven entry
points, anything in `docs/reusable/` — goes one approved set of changes at a time, with the before
and after shown"* ([edit-important-docs.md](../reusable/edit-important-docs.md)). The run was
unattended, so the sweep split its doc edits in two rather than guessing:

- **Applied**, because CLAUDE.md also says *"Signposting is not a rule"* and *"update the docs as you
  go"*: factual corrections and table rows in entry-point docs, where the change tracks a code change
  or fixes a number. Listed below so you can see exactly what moved, but already committed.
- **Held back for approval**: anything that adds or changes **guidance**. Three of those, and Greg
  approved all three on 2026-09-03. They are recorded below with the before and after they were
  approved from, rather than rewritten into the past tense — the point of this file is that the
  proposal and the change are the same text.

---

## Approved by Greg, 2026-09-03, and applied

All three landed as written below. The only thing still open is the pre-commit hook under item 2 —
see the note there.

### 1. `docs/reusable/rename-or-move.md` — a new section

**Why**: this sweep found 36 live references to `src/store/import.ts` across 28 files, two days
after the file was deleted cleanly. `rename-or-move.md` already says a rename is never one edit and
tells you how to sweep for it; it says nothing about a deletion, which is the same problem with a
narrower search. This is the reusable doc, so it travels beyond this repo.

**Before**: nothing — the section does not exist. It would go after *"Search for the distinctive
fragment on its own…"* and before *"## Process Guidelines"*.

**After**:

> ## A deletion is a rename to nothing, and needs the same sweep
>
> Deleting a file removes the thing; it does not remove the sentences that explain the codebase by
> pointing at it. Those keep their confident present tense and send the next reader looking for a
> file that is not there.
>
> So run exactly the sweep above with only the old name, and rewrite every hit. Prefer
> **correcting** the fact to deleting the sentence — the comment usually explains *why* some defence
> exists, and that is still worth having with the right subject. Where the deleted thing was the
> whole reason for a rule, say what the rule defends against now, or say plainly that the reason has
> gone. Past tense with a date (*"…until it was deleted on 2026-09-01"*) is the cheapest fix that
> misleads nobody.
>
> The evidence: `src/store/import.ts` was deleted cleanly on 2026-09-01, and two days later **36
> references to it were still live across 28 files**.

### 2. `CLAUDE.md` — one line in the commit recipe

**Why**: `scripts/check-staged-revert.ts` was written as the fix for the six hours of phantom
reverts, and `version-control.md` says so in as many words — *"the fix is not a firmer comment — it
is `scripts/check-staged-revert.ts` run before every commit, by everyone"*. It then lived only in
that sentence: no npm script, no git hook (`.git/hooks/` is empty, not even the samples), and no
mention in either place an agent reads before committing. **The npm script and the
`version-control.md` line landed in this sweep**; this is the other half.

**Before**, in *Working in a tree several agents share* → *Commit only your own files, by name, in
one command*:

> ```
> git add -- <any NEW files> && git commit -F <msg> -- <all your files>
> ```
>
> That is the whole recipe, and it is one command so there is no gap for a peer to land in.

**After**:

> ```
> npm run check:staged-revert
> git add -- <any NEW files> && git commit -F <msg> -- <all your files>
> ```
>
> The first line asks whether the shared index is quietly undoing somebody's commit — it is the
> guard written after the day that cost six hours, and until 2026-09-03 it was reachable only by
> somebody who already knew that story. The second is the whole recipe, and it is one command so
> there is no gap for a peer to land in.

**Still open — the alternative worth considering instead**, and it is stronger: install it as a real
`pre-commit` hook. `.git/hooks/` is currently empty, so there is no hook infrastructure to fit into
and adding some is a decision rather than a tidy-up — which is why this run did not make it. A hook
catches the agent who did not read the recipe, which is the population the guard exists for.

**Deliberately not done under the 2026-09-03 approval**, which covered the three doc edits. Two
reasons to decide it separately: linked worktrees share one `.git/hooks/`, so installing one changes
every agent's commits in every tree at once rather than just this one; and hooks are not in version
control, so it would live on this box and no other, which makes it the kind of change
[hetzner-remote-server-box.md § A change to the box is a change to a file](../project/hetzner-remote-server-box.md#a-change-to-the-box-is-a-change-to-a-file)
says to ask about — now, going forwards, or both.

### 3. `docs/reusable/improve-the-codebase.md` — one sentence, from this run's own failures

**Why**: the doc already says *"Count every instance before you plan the fix"* and explains one
reason counts arrive low (each agent reads one slice). **This run got a count wrong twice, and
neither time was for that reason.** Both were the same new mechanism:

- **T1.4** arrived as one module-scope lock. There are ten. The audit found the one its postmortem
  named and stopped.
- **T1.9** claimed three raw reads of `?at=`. There are two — the third site's comment said "same
  read-at-render trick as `Dock.tsx`", and the agent filed `Dock.tsx` as a hit. Dock reads the whole
  query string for a different job entirely.

Both are the *same* failure: **an agent read a citation and recorded it as an instance.** That is
worth naming, because this doc's own best advice — start from what the codebase already says about
itself — is exactly what produces it. Comments that cross-reference each other are a strong signal
that duplication exists *and* an unreliable guide to how much.

**Before**, in *Count every instance before you plan the fix*, after *"…so it sees the copies inside
its slice and none of the outermost ones."*:

> **A dedup that leaves a copy alive is worse than none: the next reader believes it is done.**

**After** — the same paragraph, with one sentence inserted before that line:

> **And a citation is not an instance.** The comments that say "same trick as X" are how you find
> the cluster, and they are not a census of it: X may be doing a different job, and the sites nobody
> cross-referenced are invisible to this method entirely. Grep for the idiom, then count what the
> grep returns.
>
> **A dedup that leaves a copy alive is worse than none: the next reader believes it is done.**

---

## Applied, for your review

Each of these tracks a change that landed in the same commit, or corrects a number.

### `docs/project/code-quality-overview.md` (entry point) — the command table

Three rows added (`typecheck:committed`, `db:chain`, `check:staged-revert`), two corrected. The
`build` row now says both passes; the `check` row's `-- --fast` clause said "skips the build" and now
says it narrows the build to its API pass. `typecheck:committed` and `db:chain` were both already
gates in `scripts/check.ts` and had never been in this table.

### `docs/project/dev-and-deployment-overview.md` (entry point) — one row

`npm run build` said "production bundle into `dist/`". It now names both passes and points at
`build:client` / `build:api`, because as of this commit that is what the command does.

### `docs/project/design-css-overview.md` (entry point) — a number

Said `src/web/styles.css` was "~1200 lines", twice. It is **12,830**.

**The interesting part, which the sweep's own plan got wrong**: that number was not sloppy. The file
was 1,211 lines on 2026-08-25 when `7e6a5ef0` wrote the line. It grew by a factor of ten in nine
days and the doc did not. The line-498 occurrence is the doc's closing open question — *"whether
~1200 lines of well-commented CSS is the answer at this size"* — so it was being asked about a file
ten times the size quoted, which is a different question. It now carries the real number and the
drift.

**That open question is one of the three things this run is putting back to you** — see the plan's
*Deferred for Greg*. The sweep found no drift inside the file (one hardcoded hex across ~989
selectors, with a comment justifying it), so it is a long file with one reason to change rather than
a tangled one. Whether that is fine at 12,830 lines is a product and architecture call, not an
engineering defect.

### `docs/project/version-control.md`, `static-analysis.md`, `deployment.md`, `setup-dev.md`

Not entry points and not `docs/reusable/`, so applied without a proposal. They carried statements
that this commit made false: the two-command build recipe, `npm run build` as client-only, and the
`committed` step's advisory status.
