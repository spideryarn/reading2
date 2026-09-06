# Review request: plan for A7, measuring annotation computation

You are reviewing a **plan**, not code. Nothing has been built yet.

## The candidate

Repo root: `/home/greg/code/spideryarn2/.claude/worktrees/a7-annotation-measure` (a git worktree).
Base SHA: `6eecb377f24d92446086a006d5b3103daae40aef`, branch `worktree-a7-annotation-measure`.

**Live pre-commit candidate.** The only changed file is one new, untracked file:

- `docs/plans/260905i-measure-annotation-computation-before-optimising-it.md`

Read it in full. Everything else in the tree is unmodified at the base SHA.

## Context you should read for yourself

Start with these; the list does not limit your scope.

- `docs/plans/260905e-main-app-architecture-review.md` — the parent review. § "A7. Reduce annotation
  computation before changing the document renderer" and, under "## Implementation stages and
  handoff", "### Stage: Optimise annotation inputs, if measurements warrant it". That stage is the
  authority the plan must satisfy.
- `src/web/TableView.tsx` — especially `byId`, `cmtsByBlock`, `marksByBlock`, `termMarksByBlock`,
  `proseCache` and `proseHtml`, and their (long, load-bearing) docstrings.
- `src/web/annotate.ts` — `renderedText`, `resolveMark`, `annotateHtml`, `termMarks`, `host`.
- `src/web/search-hits.ts` — the `pages` / `folds` `WeakMap`s and `page()`.
- `src/web/zoomable.ts` — `addZoomHandles`, `mightHaveFigure`.
- `src/web/perf.ts` — the existing probe, its `?perf=1` gate and `window.__perf`.
- `tests/prose-not-rebuilt.test.tsx` — the existing DOM-identity regression test the bench copies.
- `docs/project/performance.md` — especially "Still open, ranked, with citations" (item 1),
  "Scrolling rebuilt the whole article, 2026-09-03", "Clicking, 2026-09-05", "Before you believe a
  number" and "The traps".
- `docs/reusable/silent-success.md`.
- `tests/fixtures/data-root/data/` — the committed fixture corpus.

## What to attack, independently

Please form your own view before reading my suspicions at the bottom.

1. **Is the measurement actually capable of deciding the question?** Would the instrument and the
   bench described in Stage 1 produce a number that means what the plan says it means? Name any way
   this measurement could report a comfortable number while the real interaction is slow, or report
   an alarming one that no reader can feel.
2. **Is the decision rule sound and applied to the right unit?** The thresholds are 16ms per
   gesture and 8ms per streamed delta. Are those the right budgets, and is "annotation work" the
   right thing to compare against them?
3. **Where does the plan risk a silent success?** Specifically: an instrument that is not running,
   a bench that renders nothing, a gesture that does not actually change the props it claims to, a
   memo that React re-runs for reasons the test does not model, or `StrictMode` double-invocation
   making a count meaningless.
4. **Is the synthesised long article (fixture blocks repeated under fresh ids) a valid stand-in**
   for a real 2,046-block article for this particular question? What would it get wrong?
5. **Is the Stage 2 design correct if it is reached?** In particular: reusing `search-hits.ts`'s
   array-identity `WeakMap` as the single owner of the rendered-text parse; splitting anchor
   resolution from `open` state; and per-block input reuse inside the existing `proseCache` ref.
   Look hard for correctness hazards — stale marks, a changed block under a stable id, overlapping
   marks losing their shared `<mark>`, a removed block, an article swap, a visitor/owner access
   change, note-return markers, figure handles.
6. **What has the plan left out** that the parent review's stage checklist requires?
7. **What in the plan is unnecessary** — machinery that would not earn its maintenance cost. This
   repo prefers simple over easy and fewer moving parts; say so if the plan is over-built.

## Severity scale

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Grade by consequence, not by the file the defect lives in. Refuse (recommend not proceeding) only
on an **established** P0 or P1: direct evidence with no unresolved material inference. Reasoned
findings rank and inform but do not block.

Give **every finding a stable ID** (`F1`, `F2`, …), a severity, the file and symbol it concerns, and
the smallest change that would settle it. Finish with an explicit verdict line: proceed, proceed
with changes, or do not proceed.

You have no network. You may read and run anything in the tree that needs nothing outside it; note
which findings you established by running something.

## My own suspicions, worth less than yours — spend most of the run above this line

- I suspect the dominant cost is not opening a comment but **streaming one**: `useComments` sits in
  `Reader`, so every delta replaces the `comments` array, which rebuilds `marksByBlock` and then
  loops every block in `proseHtml`. I may be over-weighting this.
- I suspect the per-block loop in `proseHtml` is cheap for unmarked blocks and that the real cost is
  `annotateHtml` on every glossary-marked block, so an article with a large glossary is the bad
  case and an article without one is nearly free. If that is right, the fixture matrix must include
  a big glossary or the measurement will find nothing.
- I am unsure whether the instrument should be unconditional counters (my choice) or gated behind
  `?perf=1` like the rest of `perf.ts`. Tell me if unconditional counters in a hot path are a
  mistake.
