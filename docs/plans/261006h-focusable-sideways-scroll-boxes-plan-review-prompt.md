# Plan review: focusable sideways scroll boxes (qi-t2ee3kyx)

You are reviewing a **plan**, read-only. Change no file.

## The candidate

- Base: `a680cc53b447ef9833e03574125bda294aa9ec20`.
- Untracked, the plan itself: `docs/plans/261006h-focusable-sideways-scroll-boxes.md`.
- Code it proposes to change (start here; this does not limit scope):
  `src/web/lib/SidewaysScrollBox.tsx`, `src/web/lib/DataTable.tsx`, `src/web/AdminVouchersPage.tsx`,
  `src/web/cost-charts.tsx`, `tests/sideways-scroll-box.test.tsx`. Callers:
  `src/web/AdminCostsPage.tsx`, `src/web/Library.tsx`, `src/web/AdminPage.tsx`.

## What to do

Read the plan and the code, and attack the plan independently: is the defect stated accurately, is
the fix correct and the simplest one that works, does it miss a sideways-scrolling box, would it
break anything (the shelf's keyboard handling, the static cost report that renders
`cost-charts.tsx` from a script, `tests/eager-client-graph.test.ts`, accessibility semantics of
`role="region"` on a conditional element), and are the tests enough to catch a wrong build.

The statement to judge is: *"after this plan, every sideways-scrolling box drawn by a React
component in `src/web` that has no focusable child guaranteed to reach its hidden content can take
keyboard focus while, and only while, it overflows, and has an accessible name."* Is that accurate?

## Severity and IDs

P0 data loss / security / charging / broadly unusable. P1 user-visible wrong behaviour or an
authoritative contract violated. P2 design or maintainability risk, no wrong behaviour today.
P3 prose defect. Refuse only on an *established* P0 or P1 (direct evidence, no unresolved material
inference); say which findings are established and which reasoned. Number findings `F1`, `F2`, …
End with a one-line verdict: ACCEPT or REFUSE.

## My own suspicions (already mine; spend most of the run elsewhere)

- Whether `cue={false}` on one component is cleaner than a separate plain component sharing the hook.
- Whether excluding article prose (`.prose pre/table/math`) is the right boundary for this item.
- Whether relying on the browser's default focus ring is safe here.
