# Review (round 2): the Dock drawer and the comment dialog hand focus over properly

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/a2-mode-failure-containment`, branch
`worktree-a2-mode-failure-containment`. TypeScript + ESM, React 19, vitest. Round one of this Stage 2
review is `docs/plans/260905h-stage2-review-sol.md` — findings **F19–F22**. All four are fixed.

**This is the last round; discovery is closed.** Spend the run on the F19 fix and on whether my doc
corrections are now actually true — not on reopening Stage 1, which you have already reviewed twice
(F1–F18) and which is committed.

## The candidate

Live pre-commit, on top of the Stage 1 commit at the tip of this branch. `git diff HEAD` shows it.

Modified: `src/web/CommentDialog.tsx` (the F19 fix), `src/web/Dock.tsx` (round one's change,
unchanged since), `docs/project/copy.md`, `docs/project/logging.md`, `docs/project/comments.md`,
`docs/project/web-client.md`, `docs/project/ideas.md`,
`docs/plans/260905h-a-mode-failure-should-leave-the-article-readable.md`,
`docs/plans/260905e-main-app-architecture-review.md` (checkboxes only).

Untracked: `tests/opening-a-comment-moves-focus-into-its-dialog.test.tsx` (2 tests),
`tests/the-dock-drawer-is-not-a-modal.test.tsx` (8 tests), the two Stage 2 review files, and this one.

Start with `src/web/CommentDialog.tsx` and `tests/opening-a-comment-moves-focus-into-its-dialog.test.tsx`.

## Previous findings

| ID | Claim | Disposition | What changed |
|----|-------|-------------|--------------|
| F19 | Selecting a comment hands focus back to the Dock instead of into the dialog | fixed | `CommentDialog` gets the drawer's modeless-dialog lifecycle: `openerRef`/`closeRef`, an empty-dep effect that records `document.activeElement`, focuses `.cmt-close` on mount and restores the opener on unmount guarded by `isConnected`; `ref` on `.cmt-close`. No trap; `useEscapeToClose` untouched. Empty deps deliberately, so stepping prev/next does not re-steal focus — `App.tsx` puts no `key` on `CommentDialog`, so it does not remount. Red first: *"focus is outside the dialog that just opened: expected false to be true"*, then 2/2 green |
| F20 | The docs say two error boundaries; there are three | fixed | Confirmed independently: `grep -rn componentDidCatch src/` gives exactly three — `AppBoundary.tsx:52`, `LazyPage.tsx:107`, `FeatureBoundary.tsx:186` — and all three call **both** `captureClientFailure` and `recordLog`, with boundary tags `app` / `lazy-route` / `feature`. Your exact wording used in `copy.md`; `logging.md` now says three and names `ChunkBoundary` |
| F21 | "No logger" and "11 console calls" still misdescribe the source | fixed | Confirmed independently: the grep returns 11 non-preview lines, `lib/api.ts` holds five of them and **three are comments** (lines 26, 114, 176), leaving eight executable calls — one `console.log`, seven `console.error` — across six files. Your exact replacement paragraph and heading line are in |
| F22 | "Modal with respect to the prose" overstates it | fixed | Your exact bullet in `comments.md`. The same phrase appeared once more, in the plan doc's A6 section, and was corrected there. `Dock.tsx` does **not** carry it — its wording is "Only the *prose* is behind the dim", judged accurate about pointer blocking and left alone. Say if that judgement is wrong |

One doc addition beyond the four, flagged rather than smuggled: a bullet in `comments.md` § The
drawer recording the fifth close path (selecting a question) and pointing at the new test, since F19
changed behaviour and this repo's rule is to update the doc in the same stage.

## What you can and cannot run

Tree read-only; `/tmp` writable. You can run one test file — `npx vitest run
tests/opening-a-comment-moves-focus-into-its-dialog.test.tsx` (2 tests, jsdom, no network) is the
interesting one — and a script, and build a harness under `/tmp`. No network, not even loopback.

Results I have run: the new test 2/2 · `tests/the-dock-drawer-is-not-a-modal.test.tsx` 8/8 · every
test that mounts `CommentDialog`, found by grep and run separately —
`comment-dialog-search-the-web` 4/4, `referee-anchoring` 7/7, `referee-placement` 23/23,
`the-enter-key-really-sends` 12/12, `what-the-enter-key-promises` 4/4 · `dock-fit` 17/17 ·
`a-broken-mode-leaves-the-article-readable` 17/17 · `doc-links` 14/14 · `npm run typecheck` clean ·
`npm run check` **EXIT=0**, 731 files, 13089 passed, 0 failed.

## Attack it

The interaction contract, narrowly. Find a sequence in which focus ends somewhere a keyboard reader
cannot get back from, or the opener is restored to an element that no longer means what it did, or the
two focus lifecycles — the drawer's and the dialog's — fight each other. Worth specific attention:
stepping prev/next between comments; deleting a comment (which steps to a neighbour); the
*Discuss this* handoff that closes the dialog and opens a floating chat; opening a comment from the
prose gutter rather than from the drawer; a visitor rather than an owner; and the drawer being open
when the article unmounts.

Then judge the two doc claims I re-checked: is the three-boundary description right about all three,
and is the console inventory now stated in a way that will not be wrong again in a month?

For each finding: an ID (continue the chain; new findings start at **F23**), a severity, established
or reasoned, (a) the sequence or contradicted contract, (b) the smallest closure as a code block or
exact replacement wording.

Severity by consequence: **P0** data loss, exploitable security, incorrect charging, or the service
broadly unusable; **P1** user-visible wrong behaviour or an authoritative contract violated; **P2**
design or maintainability risk with no wrong behaviour today; **P3** non-behavioural prose defect.
Refuse only on an established P0 or P1, naming what established it.

## My own suspicions — read last

- The dialog's effect has **empty deps**, so it records the opener once at mount. If anything in
  `App.tsx` ever gives `CommentDialog` a `key`, or remounts it per comment, that becomes a
  focus-steal on every step. I have not put a guard on that, only a comment.
- Two nested modeless dialogs now each restore an opener on unmount. The drawer's cleanup runs before
  the dialog's setup, which is what makes the handoff work — but I have not thought hard about the
  order when *both* unmount in the same commit.
- `biome check src/web/CommentDialog.tsx` reports `noExcessiveCognitiveComplexity` 37 against a max
  of 25 — severity info, `npm run check` green, and dominated by pre-existing JSX conditionals rather
  than the four lines added. Left alone rather than refactor a file other agents are in. Say if that
  is the wrong call.

Do not change any file.
