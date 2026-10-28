# Code review: 261028c stage 2, the Explanations mode and its margin line

You are reviewing **code**, with write access. The candidate is `git diff 5b7265ab7 df89fba67` (commit df89fba67; bf9938e99 after it only regenerates the help corpus). Stage 1 (the `explanations` step, store, route) is the two commits before it, already reviewed by you in `docs/plans/261028c-stage-1-code-review-sol.md`. The plan is `docs/plans/261028c-explanations-of-confusing-passages-and-sources-feeding-the-margin.md` (§ Idea 2, § Stages item 2); the feature doc is `docs/project/explanations.md`.

The closest existing modes, which this copies: Ideas (`src/web/useIdeas*`, its panel) and FAQ for the band; the margin's existing note kinds in `src/web/marginalia/notes.ts` and `MarginaliaColumn.tsx`; `askPassageInChat` in `src/web/reader/Reader.tsx` for Ask in chat. `docs/project/mode.md` is the checklist of everywhere a new mode has to be told about.

## What to look for

1. **Gating.** It must be behind the experimental switch everywhere a reader could meet it (Dock, command bar, margin feed, Help, Features page, URL `?mode=explanations` with the switch off), owner-only (a visitor never fetches `/api/explanations` and never sees margin lines), and it must **never start a paid run on arrival** — only on the owner's press into the mode (`useAutoRun`). The margin only reads.
2. **The margin rule** in `notes.ts`: a block with a fresh Explanation whose quote still holds does not also draw the relations call's `explain` note; stale lists are not drawn; outdated/profileChanged still are. Placement, ordering, and the quote check.
3. **Ask in chat**: the anchor (`findQuote` for `start`, whole-block fallback), and the question text — the explanation is model output put into a prompt; check it is quoted as data.
4. **Write it again on `outdated`.** The builder shows it on `outdated` as well as `profileChanged`. Greg ruled on 2026-09-29 that an older prompt is "not worth bugging the user about" — find how Ideas and Glossary treat `outdated` and make Explanations do the same.
5. Anything in mode.md's checklist missed; any test that should enumerate this mode and does not; any test that cannot fail.
6. Readers must never see AI cost figures (`tests/no-ai-cost-for-readers.test.ts`).

Model calls cannot be made until 1 November. The local database may lack the stage 1 migration; tests that build their own database from the tree's migrations are the ones to trust.

## How to work

Fix what you find inside this stage, keeping the surrounding style; run the test files you touch and `npm run typecheck` (or `node --import tsx scripts/typecheck.ts` if the wrapper can't start). Do not commit, push or deploy; do not touch production, `.env.local`, systemd or `infra/`. Report anything wider for me to decide.

## Answer

Findings with IDs (CR-1, …), severity P0–P3, file:line, what is wrong, what you changed (or why not). Then the files you edited and the test commands with results. End with a one-line verdict.
