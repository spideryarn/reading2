# P06 (after2) — add a "Questions" mode behind the experimental switch

Assumption: the task is vague, so I read "Questions" as a mode in the band listing the article's questions (not a duplicate of FAQ or Quiz). Before building I would ask Greg how it differs from `faq` (reader questions, passage-backed), `quiz` (Remember's questions to the reader) and Annotations' per-part Socratic questions (`src/hierarchy.ts` § `questionFor`, drawn by `src/web/annotations/notes.ts`). Simplest v1: a band that lists those stored per-part questions, so nothing is generated.

## 1. Docs opened, in order
1. `CLAUDE.md` — signpost; pointed to reading-view-overview and new-mode. Helped.
2. `docs/project/new-mode.md` — the checklist; very helpful, lists every total table and the residue.
3. `docs/project/experimental-features.md` — how to gate; the table of what is behind the switch, and the three edits to put a mode in or out. Helpful.
4. `docs/project/reading-view-overview.md` (grep only, § The modes in the band) — found FAQ, Annotations, quiz neighbours.

## 2. Code files I would edit
- `src/modes.ts` (add `"questions"` to `MODES`)
- `src/title-text.ts` (`MODE_LABEL`), `src/messages.ts` (`OWNER_MODE_NOTE`)
- `src/mode-catalog.ts` (`MODE_CATALOG`: description, how, aliases, `experimental: true`)
- `src/web/Dock.tsx` (`MODES_UI` row, icon, group), `tests/dock-mode-order.test.ts`
- `src/web/visitor.ts` (`POLICY`), `src/web/activation.ts` (`MODE_TARGET`, probably `none`)
- `src/web/reader/Reader.tsx` (`modeBand()` arm), `src/web/reader/ModeBoundary.tsx` (`MODE_CONTAINMENT`, `WITNESS`), `src/web/reader/passages.ts` (`selectPassages`, `NO_FOUND`)
- New `src/web/QuestionsPanel.tsx` using `ModeSurface`.
- Tests: `tests/dock-experimental-modes.test.tsx` (`BEHIND_THE_SWITCH`), `tests/public-network-trace.test.tsx` (`BAND_SAYS`), `tests/every-mode-draws-its-surface.test.tsx` (`SPENDS`, `DRAWS`), `tests/command-bar.test.tsx` (`GENERATES`), `tests/visitor-gaps.test.ts`, `tests/page-title.test.ts`, `tests/every-mode-says-which-passages-it-marks.test.ts`, plus a new test for the panel.
- Docs: `docs/project/experimental-features.md` (row and reason), `docs/project/reading-view-overview.md` (mode line), a new `docs/project/questions.md` with an owner line.
- If it has its own stylesheet: `tests/styles-entry-is-imports-only.test.ts` `MANIFEST`.

## 3. Existing helpers to reuse
- `src/web/ModeSurface.tsx` § `ModeSurface` (band shell; no hand-written `<aside>`).
- `src/web/annotations/notes.ts` § `annotationNotes` and the `question` note kind (the questions already exist).
- `src/web/FaqPanel.tsx` and `src/web/useFaq.ts` as the model for a list panel; `src/web/faq-order.ts` if rating-ordered.
- `src/web/experimental-visibility.ts` (the rule that `visibleModes` in `Dock.tsx` already applies; nothing new needed).
- `src/web/threshold.ts` § `applyThreshold` only if the list is rated. Not for v1.
- New helper: none for the hook if reusing stored data. If it generated questions, I would add a pipeline step following the artefact checklist in new-mode.md, with `useStepJob`, `useOrderedRead` and `useAutoRun`.

## 4. Rules and policies
- new-mode.md: totals the compiler checks, then the residue. Re-run `npm run typecheck` and the full suite, because four tests go red without a type error.
- experimental-features.md: set `experimental: true` in `MODE_CATALOG`, add to `BEHIND_THE_SWITCH`, add the row and reason. Gate the control, not the URL. Do not count modes.
- new-mode.md: no description line inside the band (Greg, 2026-09-30); `ControlTip` card's `how` must not mention price or "pressing". Two sentences, written from the source.
- new-mode.md: the visitor sees whatever is stored and never starts a paid call (`POLICY` / `REVISION_READ_POLICY`).
- new-mode.md: add `WITNESS` entries and `MODE_CONTAINMENT: contained`.
- CLAUDE.md: work in a worktree, plan doc under `docs/plans/` reviewed by GPT Sol before building, and again after the code. Reproduce with a failing test first. Commit my own files by name, push to `dev`. Never deploy.
- Cost: nothing extra if no model call; if there is one, `cost-tracking.md`, `JOB_DISPOSITION`, `plainWords` in `prompting-guide.md`, and streaming for waited calls.
- Browser check goes to a Sonnet subagent (browser-control.md).

## 5. Where I got lost
- The task name collides with existing concepts (FAQ, Quiz, Annotations questions). No doc says what a "Questions" mode should be, or whether a mode with that name was considered. I did not find a doc that disambiguates the three.
- `new-mode.md` is long and its counts of red tests are dated, so I would still need to run the compiler and suite to find the real list.
- `docs/project/` has no `annotations.md`; the plan under `docs/plans/` (forbidden to me this round) is the only reference for the newest mode, so I read the code instead.
- I did not open `docs/project/web-client.md` or `tooltips.md` in detail.

## 6. Confidence
7/10 on the file list and rules; the product definition of "Questions" is the main unknown.
