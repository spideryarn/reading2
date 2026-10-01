# P06 before: add a "Questions" mode behind the experimental switch

## 1. Docs opened, in order
- `AGENTS.md` (as CLAUDE.md) — pointed me at the reading-view entry point; the rules are generic, not mode-specific.
- `docs/project/reading-view-overview.md` — helpful: lists every mode and its owner doc, and points to the checklist.
- `docs/project/mode.md` — the key doc; a complete checklist (totals the compiler checks, plus untested residue).
- `docs/project/experimental-features.md` — helpful: the three edits to put a mode behind the switch and the table to add a row to.
- `docs/project/faq.md` (first 60 lines only) — to see the closest sibling ("the questions a careful reader would ask"); showed the task name collides with FAQ.
- Greps in `src/` and `tests/` for `faq` and `annotations` — to find the real touch points of a recent mode.

## 2. Code files I would edit
- `src/modes.ts` (add `"questions"` to `MODES`, with a comment)
- `src/title-text.ts` (`MODE_LABEL`), `src/messages.ts` (`OWNER_MODE_NOTE`)
- `src/mode-catalog.ts` (`MODE_CATALOG`: description, how, aliases, `experimental: true`)
- `src/web/Dock.tsx` (`MODES_UI` row: icon and group)
- `src/web/visitor.ts` (`POLICY`), `src/web/activation.ts` (`MODE_TARGET`)
- `src/web/reader/Reader.tsx` (`modeBand()` arm), `src/web/reader/passages.ts` (`selectPassages`), `src/web/reader/ModeBoundary.tsx` (`MODE_CONTAINMENT`)
- New `src/web/modes/questions/QuestionsMode.tsx` (beside `src/web/modes/faq/FaqMode.tsx`)
- Possibly `src/web/params.ts`, `src/web/last-view.ts`, `src/web/sub-modes.ts` (only if it has params or sub-modes)
- Tests: `tests/public-network-trace.test.tsx` (`BAND_SAYS`), `tests/every-mode-draws-its-surface.test.tsx` (`SPENDS`, `DRAWS`), `tests/command-bar.test.tsx` (`GENERATES`), `tests/dock-experimental-modes.test.tsx` (`BEHIND_THE_SWITCH`), `tests/dock-mode-order.test.ts`, `tests/visitor-gaps.test.ts`, `tests/page-title.test.ts`, `tests/every-mode-says-which-passages-it-marks.test.ts`, `tests/mode-surface-changes-no-markup.test.tsx`, `tests/styles-entry-is-imports-only.test.ts` if a stylesheet is added
- Docs: row in `docs/project/experimental-features.md`; line in `docs/project/reading-view-overview.md`; a new `docs/project/questions.md` with a parent line.
- If it generates an artefact (FAQ-style): `src/store/artifacts.ts`, `src/types.ts`, `src/jobs.ts`, `src/pipeline.ts`, `src/step-order.ts`, `src/models.ts`, `src/routes.ts`, `src/store/export.ts`, `src/store/public-reader.ts`, `src/public/dto.ts`, a migration for the step CHECK, `src/cost-categories.ts` (`JOB_DISPOSITION`).

## 3. Existing helpers/components/functions to reuse
- `src/web/ModeSurface.tsx` § `ModeSurface` (band shell; do not hand-write the aside)
- `src/web/useExperimental.ts` / `src/web/experimental-visibility.ts` (the gate is driven by the catalog flag; no new gating code)
- `src/web/modes/faq/FaqMode.tsx`, `src/web/useFaq.ts`, `src/web/useStepJob.ts`, `src/web/useOrderedRead.ts`, `src/web/useAutoRun.ts`, `src/web/auto-run-targets.ts` (only if generated)
- `src/web/BlockRef.tsx` (jump links), `src/web/lib/api.ts` § `CACHEABLE` (only if there is a GET)
- `src/web/annotations/AnnotationsColumn.tsx` / `notes.ts` (parts' Socratic questions already exist, so a client-only list may need no new artefact). I did not open these.
- I would NOT write a new helper unless the spec needs one; I found no existing "questions" component.

## 4. Rules/policies to follow
- Add the word to `MODES`, then let the typecheck list the totals — `mode.md` § The client, and its measured "what goes red" tables.
- `experimental: true` in `MODE_CATALOG`, a name in `BEHIND_THE_SWITCH`, and a row with a reason in `experimental-features.md` — `mode.md` § Moving a mode in or out of the switch.
- Nothing counts modes; no "N modes" anywhere — `mode.md`.
- No description line in the band (Greg, 2026-09-30); `description`/`how` written about the mode, no price — `mode.md` § The card on the button.
- Render through `ModeSurface` with a required `aria-label`; decide whether the head persists — `mode.md`.
- A press on the button runs generation, arrival does not; `MODE_TARGET` decides spending — `reading-view-overview.md`, `mode.md`.
- Stream any model call a person waits on; `PROMPT_VERSION`; `plainWords(...)` in the prompt (`prompting-guide.md`); cost tracking via `runStep` and `JOB_DISPOSITION` (`cost-tracking.md`) — only if generated.
- Visitor policy: stored output visible to visitors, making it is the owner's (`mode.md` on `PUBLIC_PROJECTIONS`).
- Project rules (`AGENTS.md`): work in a worktree, plan doc under `docs/plans/` and GPT Sol review, failing test first, `npm test` and `npm run typecheck`, merge not rebase, commit own files by name, push to `dev`, ask before any change to production data. Additive migration is fine to apply.
- Doc rule: new doc needs one parent (`tests/doc-links.test.ts`).

## 5. Where I got lost
- The task is underspecified: "Questions" overlaps FAQ, Quiz, Remember, and Annotations' per-part Socratic questions. No doc says which one a "Questions" mode would be, or lists those four side by side. I would have to ask Greg, and I planned the cheapest reading (client-only, no artefact).
- `mode.md` § "Before you call it finished" still says `band()`, while the table says `modeBand()` (renamed 2026-09-11). `docs/project/mode.md` also counts "sixteen" and "fourteen" modes in places, despite saying nothing may count them.
- `mode.md` never says how Annotations (a mode with no band, drawn to the right) was added; the overview points to a plan in `docs/plans/261001d-*`, which I was not allowed to open. So I could not learn the pattern for a mode that generates nothing.
- Never opened: `docs/project/web-client.md`, `url-state.md`, `visitor.ts`, `Dock.tsx` bodies, so exact edit shapes in those are unverified.

## 6. Confidence
6/10 on the list of touch points (the checklist is strong). 3/10 that I have the right product intent, because the task did not say what "Questions" is.
