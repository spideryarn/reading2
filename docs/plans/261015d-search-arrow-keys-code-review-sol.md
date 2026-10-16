# Code review: ← / → step Search's results

1. **P2 — `useFollowRow` stayed bound to a detached list when the list element was replaced.**
   Evidence: the original effect captured `listRef.current` but depended on the stable ref object
   rather than the element it named. Both consumers conditionally mount their
   list: Search returns several empty states before its `<ul>` (`src/web/SearchPanel.tsx:1769-1918`),
   and Quotes removes `.quotes-list` while its read is not ready
   (`src/web/QuotesPanel.tsx:1031-1105`). If a selected list is removed without changing the selected
   key, its `ResizeObserver` remains on the detached element; when the replacement mounts, it is
   neither observed nor followed. **Action:** changed the hook to return a callback ref whose state
   tracks the actual element (`src/web/list-step.ts:51-81`), so replacement disconnects the old
   observer and follows/observes the new node. Added a mounted regression test that first failed on
   the leaked observer, then passed while proving both cleanup and the replacement's scroll
   (`tests/list-step.test.ts:186-197`).

2. **P3 — the composition test could pass when Search never moved beyond its first result.**
   Evidence: the Search fixture had one literal occurrence and asserted one result. The pure
   `stepByKey` test proves list arithmetic, and this composition test proves Reader wiring to the
   first row, but the two tests together still pass if `searchKeys` always opens `found[0]` instead
   of using the helper's returned row. **Action:** gave the existing paragraph a second occurrence,
   then asserted successive → presses light the first row, the second row, and leave the second row
   selected at the end (`tests/the-marks-in-the-prose-belong-to-the-mode-showing.test.tsx:758-790`).

Checks: both touched Vitest files pass together (17 tests); the full typecheck passes all four
TypeScript projects and covers all 3,753 source files. The requested `npm run typecheck` entry point
could not open `tsx`'s IPC socket in this sandbox (`listen EPERM`), so the same script was run as
`node --import tsx scripts/typecheck.ts`. Scoped Biome lint passed with only pre-existing complexity
advice and one pre-existing optional-chain warning in the large panels; `git diff --check` passed.

APPROVE WITH CHANGES
