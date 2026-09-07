# Review: the built "Generate it again" control on the Metadata page

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/worktree-rerun-a-mode`, branch
`worktree-worktree-rerun-a-mode` (a git worktree; trunk is `dev`). TypeScript + ESM, React 19 client
under `src/web/`, Postgres the only store, vitest.

**This is the code review. You reviewed the plan for this on the same day** and refused it as
written — that review is `docs/plans/260907d-re-run-any-generated-mode-review-sol.md`, and what
happened to each of its eight findings is in the plan's § Findings table. Seven were accepted; F2
was overruled after arbitration, and the plan says on what grounds. **Do not re-open F2's remedy**;
do say so if you think the built code makes that exposure worse than the plan claimed.

## The candidate

Committed: `81e4205d` (one commit)

```
git show 81e4205d --stat
git diff 81e4205d^..81e4205d
```

changed paths (13):

```
src/rerun-steps.ts                              new
src/web/sketch-cost.ts                          new
src/web/Metadata.tsx                            the section, the rows, the read
src/web/SketchView.tsx                          two constants moved out
src/web/IllustratedView.tsx                     imports them from the new leaf
src/web/useStepJob.ts                           docstring only
tests/metadata-rerun-section.test.tsx           new, 8 cases
tests/metadata-rerun-steps.test.ts              new, 5 cases
tests/rerun-failure-keeps-the-old-artefact.test.ts  new, 3 cases
tests/metadata-page-order.test.tsx              one added case
tests/client-imports.test.ts                    one allowlist entry
tests/store-migration-registry.ts               one lane entry
docs/plans/260907d-…-from-the-metadata-page.md  the plan, updated
```

Start with `src/rerun-steps.ts`, then `src/web/Metadata.tsx` § `RerunSection` / § `RerunRow` / the
`useOrderedRead` block around line 390. That is where to begin, not the limit of scope.

## What it is meant to do

A reader on `/read/<slug>/metadata` sees a **Generate it again** section: one row per offered step,
each with the mode's name and a control. First press opens an inline confirm; second press posts
`{ slug, steps: [step], force: [step] }` to the existing job queue. `JobProgress` draws everything
after that.

**The invariants:**

1. A failed re-run leaves the reader on the artefact they already had.
2. One press forces exactly one step and cascades into nothing. (It does **not** promise one model
   call — see the plan; that was your F1/F2 and it is corrected.)
3. Nothing on the page claims an artefact is stale.
4. No control is offered whose only outcome is a refusal.

**Deliberately out of scope:** `hierarchy`, `illustrated`, `labels`, `blocks`, `fetch`, `extract`,
`assets`; staleness detection; a third pill state; any in-mode control; removing the `SOON` `rerun`
row (that is Stage 3, with a docstring-relocation task attached).

## What you can and cannot run

The tree is read-only; `/tmp` and node_modules caches are writable. You have **no network, not even
loopback**, so every Postgres suite will refuse (loudly — the unit lane poisons `DATABASE_URL` to
`127.0.0.1:1` on purpose).

- **You can run** `npx vitest run tests/metadata-rerun-section.test.tsx` and
  `npx vitest run tests/metadata-rerun-steps.test.ts` — jsdom, no database. Please do; a finding you
  reproduced outranks one you reasoned to.
- **You cannot run** `tests/rerun-failure-keeps-the-old-artefact.test.ts` (private-postgres lane).
  I ran it. Raw output, and the three sabotages that turned each case red first, are in the plan
  under Stage 2 and in that file's own header. Take the transcript as given and review the test's
  *design* — in particular whether it could pass for the wrong reason.
- `npm run check` on my machine: `All gates green`, `Test Files 800 passed | 1 skipped`,
  `Tests 14810 passed | 35 skipped`. `npm run typecheck` clean.

## Attack it

Independently, before you read my questions below.

**The invariant most worth trying to break: that a reader can spend more than they were shown, or
end up with less than they started with.** Second: that the nine rows, each holding a `useStepJob`
on one page, interact — through the shared job engine, through the one `refresh` they share, or
through React's own scheduling — in some way none of them does alone.

For each finding give:
- an ID continuing the existing series (**start at `F9`** — F1–F8 are taken by the plan review), a
  severity, and whether it is **established** or **reasoned**
- (a) the input or mutation that shows it fails its own claim
- (b) the smallest change that closes it

A finding with no (a) goes last.

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Refuse only on an **established** P0 or P1, and name what established it.

## Previous findings

| ID | Finding (abbreviated) | Disposition | What changed |
|----|----|----|----|
| F1 | `FORCE_ONLY_WHEN_NAMED` is not the allowlist; one step is not one model call; client cannot import `pipeline.ts` | fixed | `src/rerun-steps.ts`, an explicit leaf; the claim is corrected in the plan |
| F2 | one press can be attempted three times (lease budget) | **overruled**, via Fable arbitration | queue-wide and pre-existing; named under § Concurrency and § Deferred |
| F3 | Illustrated offered where it can only fail | fixed | `illustrated` not on the list |
| F4 | a degraded Illustrated replaces a good one | fixed | as F3 |
| F5 | hierarchy is neither fresh nor self-contained | fixed | `hierarchy` not on the list; deferred as its own work |
| F6 | the universal confirmation is false for Glossary | fixed | two confirm constants, `RERUN_CONFIRM` and `RERUN_CONFIRM_GLOSSARY` |
| F7 | completion refresh unspecified | fixed | `useOrderedRead`, one stable `refresh` to all nine |
| F8 | the carried-tree refusal paragraph describes a fixed bug as current | fixed | plan paragraph rewritten |

Treat the fixes as unreviewed code written by someone else, and spend most of the run on what has
changed since.

## My own suspicions — read last

Already my doubts, so confirming them is worth less than anything you find yourself.

1. **The confirm hides `JobProgress` entirely** (`RerunRow`, the `asking ? … : <JobProgress …>`
   ternary). So while the confirm is open, a failure sentence from the previous run disappears, and
   a job started in another tab would not show as progress until the reader cancels. Is either of
   those worse than I think?
2. **`done` comes from `provenance?.stages.find(…)?.done` and is `undefined` while the request is
   out**, which picks *Run it* over *Run it again*. Is `undefined` handled the same way everywhere
   it is read?
3. **The section is not gated on `hasShelfRow`**, unlike Export and Archive. My reasoning is in
   `RerunSection`'s docstring. Is there a reachable state where these rows draw and a press can only
   fail?
4. **The purpose-box seeding changed** (`seededPurposeFor` ref, keyed on slug) because the refresh
   would otherwise drop the stored sentence over a half-typed draft. Is the ref right, or does it
   now fail to re-seed on a genuine article change?
5. **`tests/rerun-failure-keeps-the-old-artefact.test.ts` writes its quotes with a `db.update`**
   rather than through `writeArtefacts`, to avoid needing a live job owning the draft. Does that
   shortcut make any of its three assertions vacuous?
6. **Nine `useStepJob` mounts.** You said in the plan review that this is acceptable. Does the built
   version do anything that changes that answer — the `onFinished` identity, the `announced` ref,
   `useNow`?

Do not change any file.
