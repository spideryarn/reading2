# P07 (after2): auto-generate FAQ after import

## 1. Docs opened, in order
- `AGENTS.md` / CLAUDE.md (in context) — pointed to reading-view-overview, faq.md, ingest-queue.md.
- `docs/project/faq.md` — very helpful: § Who sees it says outright that the add page's box skips FAQ because it is behind the experimental switch, and names `src/web/auto-modes.ts`.
- `src/web/auto-modes.ts` header (code, not a doc) — helpful: derived list, `AUTO_EXTRA_STEPS` is the hand-added escape hatch (used for `crossrefs`).
- `docs/project/ingest-queue.md` § The add page — helpful: lists today's auto modes (Tweets, Glossary, Quotes, Ideas, Trajectory).
- `docs/project/experimental-features.md` — grepped only, confirmed `experimental` flag lives in `MODE_CATALOG`.

## 2. Code files you would edit
- `src/web/auto-modes.ts` — add `"faq"` to `AUTO_EXTRA_STEPS` (and update the doc comment and `autoModesDetail()` copy so the line under the tick box mentions FAQ).
- `tests/auto-modes.test.tsx` — update the pinned `autoModeSteps()` list (line ~97) and the `autoModesDetail` / `autoModeRequests` / `autoModePosts` expectations; `tests/add-page-purpose.test.tsx` if it pins the label text.
- `docs/project/faq.md` § Who sees it, `docs/project/ingest-queue.md` § The add page (modes list) — stop saying FAQ is excluded.

## 3. Existing helpers/components/functions you would reuse
- `src/web/auto-modes.ts` § `AUTO_EXTRA_STEPS`, `autoModeSteps`, `autoModeRequests`, `autoModePosts`, `queueAutoModes` (all unchanged; faq reads nothing so it goes in the parallel group).
- `src/step-order.ts` § `STEP_ORDER` (faq already in it); `src/pipeline.ts` § `STEPS.faq` (the stage already exists, no new pipeline work).
- No new helper needed.

## 4. Rules/policies I would follow
- Simplest version first; and ask Greg because it is a product call: FAQ is deliberately experimental, owner-only, costs a paid model call (faq.md, vision.md). Name the choice: AUTO_EXTRA_STEPS (forces FAQ for everyone who ticks the box, even with the experimental switch off) vs only when the switch is on. Cheapest honest option: gate on `useExperimental` at the call site.
- Failing test first (CLAUDE.md), then `npm test`, `npm run typecheck`, lint on touched files.
- Plan doc under `docs/plans/` (name via `npx tsx scripts/plan-name.ts`), GPT Sol review of plan and code before commit (CLAUDE.md).
- Work in a worktree; commit own files by name; push to `dev`; no deploy.
- Doc edits: faq.md/ingest-queue.md are not "rule" docs, so no approval; keep one home per fact.
- Cost tracking: no new AI call, so nothing new (the faq step already tracked).
- Client-only: browser may not import server modules (`tests/client-imports.test.ts`).

## 5. Where you got lost
- Mild: unclear whether `AUTO_EXTRA_STEPS` forcing an experimental mode for non-switched readers is acceptable; faq.md says the exclusion is by design ("which is also why..."), so the task contradicts a documented decision. Did not find where the add page could read the experimental state (would check `AddPage.tsx` and `useExperimental`); not opened within budget.
- Did not verify how a public/non-owner or switch-off reader sees an FAQ generated for them (faq.md says only owner can ask, behind the switch).

## 6. Confidence
7/10
