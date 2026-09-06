# Review: the Dock drawer stops claiming to be modal, and the docs catch up

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/a2-mode-failure-containment`, branch
`worktree-a2-mode-failure-containment`. TypeScript + ESM, React 19, vitest. This is **Stage 2** of a
job whose Stage 1 you have already reviewed twice (findings F1–F18, all in
`docs/plans/260905h-code-review-sol.md` and `-sol-2.md`). Stage 1 is committed; this is the smaller,
separate half.

## The candidate

Live pre-commit. Base is the Stage 1 commit on this branch (the tip of
`worktree-a2-mode-failure-containment`); `git diff HEAD` shows everything below.

Modified: `src/web/Dock.tsx` (+57/−4, three local edits), `docs/project/web-client.md`,
`docs/project/copy.md`, `docs/project/comments.md`, `docs/project/logging.md`,
`docs/project/ideas.md`, `docs/plans/260905e-main-app-architecture-review.md` (checkboxes only),
`docs/plans/260905h-a-mode-failure-should-leave-the-article-readable.md`.

Untracked: `tests/the-dock-drawer-is-not-a-modal.test.tsx` (8 tests), and this file.

Start with `src/web/Dock.tsx` and the new test. Not the limit of scope.

## What it is meant to do

`Dock.tsx`'s drawer — the comments panel that rises out of the bottom bar — declared
`role="dialog" aria-modal="true"` with no focus containment, no focus restoration and no
inert-background management. Item **A6** of `docs/plans/260905e-main-app-architecture-review.md` says
to establish first whether it is meant to be modal at all, reproduce any defect before correcting it,
and explicitly **not** to convert every reading overlay to a modal on the way past.

**It was reproduced in Chrome** (Playwright, on this box) and the findings are recorded in
`docs/plans/260905h-…-readable.md` § *Stage 2 — the Dock's real focus contract, reproduced*. In
short: the dock bar stays fully operable with the drawer open (`.dock` at `z-index: 96` above the
scrim at 92); the prose does not (the scrim intercepts); focus never enters the drawer at all
(after Enter, `activeElement` is still the dock tab, and Tab goes Tweets → Metadata → `<body>`);
focus is never restored on close; and nothing carries `inert` or `aria-hidden`.

So the correction is: drop `aria-modal`, keep the labelled `role="dialog"`, move focus to the
drawer's close button on open, restore the opener on all four close paths, and **deliberately add no
focus trap** — the bar is meant to stay reachable. The Escape handler's capture-phase
`stopImmediatePropagation` race with `CommentDialog` is load-bearing and was left alone, as were the
scrim, the z-indexes, and every other overlay.

Out of scope and owned by other agents right now: `styles.css`, `TableView.tsx`, `annotate.ts`,
`vite.config.ts`, `src/web/lib/*`, `src/converse.ts`. Lightbox, FeedbackDialog and IllustratedView are
real native `<dialog>` modals and were not touched.

## What you can and cannot run

Tree read-only; `/tmp` writable. You can run one test file
(`npx vitest run tests/the-dock-drawer-is-not-a-modal.test.tsx`, 8 tests, jsdom, no network) and a
script, and build a harness under `/tmp`. No network, not even loopback.

Results I have run: the new test 8/8 · `tests/dock-fit.test.ts` 17/17 ·
`tests/modes-that-start-themselves.test.tsx` 21/21 unchanged ·
`tests/a-broken-mode-leaves-the-article-readable.test.tsx` 17/17 ·
`tests/public-network-trace.test.tsx` 60/60 · `tests/doc-links.test.ts` 14/14 ·
`npm run typecheck` clean · `npm run check` **EXIT=0**, 13087 passed | 35 skipped.

**The red, before the change**: `6 failed | 2 passed (8)` — *does not claim the rest of the page
away* (`expected true to be false`), *moves into the drawer when it opens with Enter*
(`expected false to be true`), and each of the four close paths failing on the wrong element having
focus. The two that already passed are the two the browser had settled: labelled dialog, Tab
untrapped.

One thing the implementer caught and I want you to weigh: three of the four close-path tests were
green in a first draft, because **jsdom's `.click()` does not move focus**, so the opener still held
it and "focus was restored" looked true. Each now asserts focus is inside the drawer first, and
clicks the way a pointer does. Check the remaining assertions for the same shape of lie.

## Attack it

Independently, before my questions.

The interaction contract is the thing to break. Find a sequence — open, close, reopen, switch panel,
switch mode with the drawer open, unmount the bar, a visitor rather than an owner, the drawer opening
from a URL rather than a press — where focus ends up somewhere a keyboard reader cannot get back
from, or where the opener is restored to an element that no longer means what it did, or where the
new effect fights the existing capture-phase Escape handler or the scrim.

Then: is dropping `aria-modal` while keeping `role="dialog"` the right call for a surface that blocks
pointer input to the prose but not to the bar? Argue the alternative if you think it is better.

Then the docs: `docs/project/logging.md` § *The browser* claimed the client had no reporting and no
`console` calls, both of which had stopped being true; I corrected both. Check I have not replaced
one wrong statement with another — the `console` count in particular is a dated grep result and I
want the method judged, not just the number.

For each finding: an ID (continue the chain; new findings start at **F19**), a severity, established
or reasoned, (a) the sequence or contradicted contract, (b) the smallest closure as a code block or
exact replacement wording.

Severity by consequence: **P0** data loss, exploitable security, incorrect charging, or the service
broadly unusable; **P1** user-visible wrong behaviour or an authoritative contract violated; **P2**
design or maintainability risk with no wrong behaviour today; **P3** non-behavioural prose defect.
Refuse only on an established P0 or P1, naming what established it.

## My own suspicions — read last

- The focus effect depends on `open` alone. If the drawer ever holds a second panel, changing panel
  while open would not re-run it. There is one panel today, and the code says so — but I have not
  checked whether `?panel=` can change value without `open` going false.
- Restoring focus in the effect's **cleanup** covers all four close paths with one fact, which I like.
  But it also fires on unmount, where the opener may be going away with it; I guard with
  `isConnected` and I am not certain that is sufficient.
- `role="dialog"` without `aria-modal` on a surface that *does* block the prose may be the wrong
  half-measure. The alternative — keep `aria-modal` and add a real trap — was rejected because the
  bar is deliberately operable, but say if that reasoning is wrong.

Do not change any file.
