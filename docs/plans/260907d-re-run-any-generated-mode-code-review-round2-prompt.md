# Review round 2: the fixes to F9, F10, F11

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/worktree-rerun-a-mode`, branch
`worktree-worktree-rerun-a-mode`. TypeScript + ESM, React 19 client under `src/web/`, vitest.

You reviewed the plan (round 0) and then the built code (round 1) and **refused round 1** with three
established P1s — F9, F10, F11. All three are fixed. This is the narrow check of those fixes.

**Discovery is closing.** Spend the run on what has changed since `81e4205d`, not on re-opening the
feature. F2's queue remedy stays overruled and is not in scope.

## The candidate

Committed: `51c8ffd2` (one commit, on top of the reviewed `81e4205d`)

```
git diff 81e4205d..51c8ffd2
git show 51c8ffd2 --stat
```

changed paths (7):

```
src/web/Metadata.tsx                                the three fixes, plus the SOON removal
src/web/JobProgress.tsx                             one new optional prop
tests/metadata-rerun-section.test.tsx               three new tests, header rewritten
docs/project/ingest-queue.md                        a new section (evergreen doc)
docs/plans/260907d-…-from-the-metadata-page.md      the plan, updated
docs/plans/260907d-…-code-review-prompt.md          round 1's prompt (new file, no code)
docs/plans/260907d-…-code-review-sol.md             your round 1 answer (new file, no code)
```

Start with the diff of `src/web/Metadata.tsx` § `RerunRow` and § `RERUN_CONFIRM_DEBATE`, then
`src/web/JobProgress.tsx`.

## Previous findings

| ID | Finding, abbreviated | Disposition | What changed |
|----|----|----|----|
| F9 | Debate understates the paid work: generic *"Another model call"* for a step that makes two metered calls | **fixed** | `RERUN_CONFIRM_DEBATE`, a fourth confirm variant, naming two calls and up to ~$0.27. Price left inline rather than shared with `SKETCH_PRICE` — the reasoning is in its docstring; disagree if you think it is wrong. |
| F10 | Retry restores a one-click paid control, bypassing the confirm | **fixed** | `asking: boolean` → `pending: null \| "run" \| "retry"`. `JobProgress` receives `failedAsking` — the same `StepFailure` with `retry` replaced by `() => setPending("retry")`; `retry: null` stays null. The Yes button dispatches. `JobProgress` itself unchanged for this. |
| F11 | Nine controls with no mode-specific accessible name | **fixed** | `aria-label` on the confirm's Yes and Cancel (rendered by `RerunRow`); a new optional `about?: string` on `JobProgress` builds one for Run and Retry. Every composed name begins with the visible text. |
| F1–F8 | round 0, on the plan | settled | see the plan's § Findings |
| F2 | one press can be attempted three times (lease budget) | **overruled**, via Fable arbitration | queue-wide and pre-existing. **Not in scope.** Note F9's observation that debate makes this six calls rather than three is recorded in the plan. |

Treat the fixes as unreviewed code written by someone else.

## Also in this commit, and not previously reviewed

- **`SOON` and its one dimmed row are deleted** from `Metadata.tsx`. That row *was* this feature
  (*"Re-run a stage"*), it was the list's only member, and the convention it copied still lives in
  `Dock.tsx`. A comment stands where the constant was, keeping what the row knew.
- **The page's top docstring § *What it deliberately does not say* is corrected.** It claimed the
  honest thing was to name which stages had run *"until `tree.json` and `arc.json` carry a hash of
  the blocks they consumed"*. They do — `StageState.done` has meant *ran, and would not be re-run
  today* since the Postgres move, and `articleMetadata` computes it with a per-step `isCurrent`. The
  corrected claim is: **the store can answer; this page cannot say**, because one boolean carries
  two facts and renders as a two-state pill. **Check that new paragraph is true**, and that the
  deferred fix it names is the right one.
- **`docs/project/ingest-queue.md`** gains § *A reader can ask for nine of them again, from the
  Metadata page*. Check it for claims that are false or that will go stale.

## What you can and cannot run

Tree read-only; `/tmp` writable. **No network, not even loopback**, so every Postgres suite refuses.

- **You can and should run** `npx vitest run tests/metadata-rerun-section.test.tsx` (11 cases) and
  `npx vitest run tests/metadata-rerun-steps.test.ts`.
- On my machine: `npm test` → `Test Files 800 passed | 1 skipped`, `Tests 14813 passed | 35
  skipped`, `EXIT=0`. `npm run typecheck` clean. The six metadata suites re-run green after the last
  comment-only edit (67 tests).

## Attack it

Independently, before my questions.

**The thing most worth breaking: that there is still a path to spending money without the sentence
in front of it.** F10 closed one; find another if there is one. Second: that the composed accessible
names are actually distinct and actually announced, rather than merely present in the markup.

Continue the ID series — **start at `F12`**. For each finding: severity, established or reasoned,
(a) the input or mutation that shows it fails, (b) the smallest change that closes it.

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Refuse only on an **established** P0 or P1, and name what established it.

## My own suspicions — read last

1. **`failedAsking` is rebuilt on every render** and passed to `JobProgress`. Is there a stale-closure
   or identity problem — the Yes button reads `failed?.retry?.()` off the *current* render's
   `failed`, not off `failedAsking`. Is that the right one to read?
2. **A retry confirm that outlives its failure.** If the reader opens the retry confirm and the
   failure clears underneath them — another tab retries, or a new job appears — `failed?.retry` is
   undefined and the Yes button silently does nothing. How bad is that, and is a silent no-op the
   right behaviour?
3. **The debate price will go stale.** It is a literal in a string. Is inline right, given the
   reasoning in its docstring, or should it join `sketch-cost.ts`?
4. **`about` on `JobProgress`** is optional so nine callers are unchanged. Is optional the right
   call, or should it be required so a new surface has to decide?
5. **The confirm still hides `JobProgress` entirely.** You said in round 1 this is not an invariant
   break but makes the accessibility ambiguity worse. Does the `aria-label` work change that answer?

Do not change any file.
