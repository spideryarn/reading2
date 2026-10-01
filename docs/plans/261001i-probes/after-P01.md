# after-P01 — shelf "added" as relative time, exact date on hover

## 1. Docs opened, in order
- `CLAUDE.md` (AGENTS.md) — pointed to reading-view-overview, which lists `library.md` (the shelf).
- `docs/project/library.md` — the "Where to look" list near the top names the exact helper file and its three functions, and the sections on the tooltip and sorting. Very helpful: it says the feature already exists.
- (not opened, would open next) `docs/project/tooltips.md`, `docs/project/testing.md`.

## 2. Code files you would edit
- Probably none: `src/web/library-columns.tsx` already renders `added ${timeAgo(e.addedAt, now)}` on the card (line ~70) and `timeAgo(row.original.addedAt, now)` in the table cell (~188), with the exact value from `exactly(entry.addedAt)` (~482).
- If any gap is found on the tooltip: `src/web/library-columns.tsx`, `src/web/Library.tsx`.

## 3. Existing helpers/components/functions to reuse
- `src/web/relative-time.ts` § `timeAgo`, `relativeAgo`, `exactly`
- `src/web/useNow.ts` § `useNow` (one clock; used in `src/web/Library.tsx`)
- No new helper needed.

## 4. Rules/policies to follow
- Format dates only through `relative-time.ts` (library.md "Where to look").
- Tooltip copy describes the artefact, not the gesture (memory note; `docs/project/tooltips.md`).
- Run `npm test` and `npm run typecheck`; failing test first for any bug (CLAUDE.md).
- Work in a worktree, commit own files by name, push to `dev`, GPT Sol review (CLAUDE.md).

## 5. Where you got lost
- The task as phrased appears already done; the docs say so ("added 3 days ago", real date past a month, exact time on hover). I did not verify in a browser (read-only probe), so I cannot say whether the hover on the card title works as the task wants; the code comment at `library-columns.tsx` line ~75 suggests the card's hover is a different surface.
- Initial grep of `web/src` failed; the client lives in `src/web/`.

## 6. Confidence
8/10 that the feature already exists and the plan is "verify, then adjust only the gap".
