# P06 after: a "Questions" mode behind the experimental switch

Interpretation (the task is ambiguous): a free, band-drawing mode listing the Socratic question each
part of the article answers (already stored on tree nodes), each row jumping to its part. It must
not be mistaken for FAQ (model-written, passage-answered) or Quiz (article asks you).

## 1. Docs opened, in order
1. `CLAUDE.md` (in context) - pointed straight to reading-view-overview and new-mode; helpful.
2. `docs/project/reading-view-overview.md` - the modes list; helpful, and showed Annotations as the nearest sibling (it reads the same Socratic questions).
3. `docs/project/new-mode.md` - the checklist; excellent, gave nearly every file and test.
4. `docs/project/experimental-features.md` - the switch, `experimental` flag, table row to add; helpful.
5. `docs/project/faq.md` (first 40 lines) - to see how it differs from a "Questions" mode; helpful.

## 2. Code files you would edit
- `src/modes.ts` (add `"questions"` to `MODES`, with a comment)
- `src/title-text.ts` (`MODE_LABEL`), `src/messages.ts` (`OWNER_MODE_NOTE`)
- `src/mode-catalog.ts` (`MODE_CATALOG`: description, how, aliases, `experimental: true`)
- `src/web/Dock.tsx` (`MODES_UI` row, group `guides`, a new icon) and `tests/dock-mode-order.test.ts`
- `src/web/visitor.ts` (`POLICY`), `src/web/activation.ts` (`MODE_TARGET`: `kind: "none"` with reason)
- `src/web/reader/Reader.tsx` (`modeBand()` arm), `src/web/reader/ModeBoundary.tsx` (`MODE_CONTAINMENT`)
- `src/web/reader/passages.ts` (`selectPassages` -> `NO_FOUND`)
- New `src/web/QuestionsPanel.tsx` using `ModeSurface`; `src/web/styles/*.css` only if needed (then `styles-entry-is-imports-only` MANIFEST)
- Tests: `BAND_SAYS` in `tests/public-network-trace.test.tsx`; `SPENDS`/`DRAWS` in `tests/every-mode-draws-its-surface.test.tsx`; `GENERATES` in `tests/command-bar.test.tsx`; `BEHIND_THE_SWITCH` in `tests/dock-experimental-modes.test.tsx`; `tests/visitor-gaps.test.ts`, `tests/page-title.test.ts`, `tests/every-mode-says-which-passages-it-marks.test.ts`, `tests/mode-surface-changes-no-markup.test.tsx`, last-view mode list
- Docs: new `docs/project/questions.md`, line in `reading-view-overview.md`, row in `experimental-features.md`

## 3. Existing helpers/components/functions to reuse
- `src/web/ModeSurface.tsx` § `ModeSurface` (band container)
- `src/web/annotations/notes.ts` § `annotationNotes` / how it reads `questionFor` from the tree (`src/hierarchy.ts` § `questionFor`); I would reuse or extract its question-per-part walk rather than write a second one
- `src/web/BlockRef.tsx` § `BlockRef`, `src/web/scroll.ts` jump helper (via Reader's `bandJump`)
- `src/section-path.ts` § `blockIndex`, `sectionNodesOf`
- `src/web/experimental-visibility.ts` / `useExperimental` (the gate is driven by the catalog flag, no new code)
- No new hook needed (no artefact, no job). Would write one small new panel component.

## 4. Rules/policies I would follow
- Add to `MODES`, then let the compiler list the totals; run the suite for the six silent tests (new-mode.md).
- Decide experimental in `MODE_CATALOG` and mirror in `BEHIND_THE_SWITCH`, plus row and reason in experimental-features.md (new-mode.md § Moving a mode).
- Card copy: `description` + `how` about the mode not the press, no price (new-mode.md § The card on the button).
- No description line in the band, no band title naming the mode (new-mode.md, Greg 2026-09-30/09-05).
- Block ids, never offsets (block-ids.md); view state in the URL (url-state.md) - no new param expected.
- Nothing generated, so no streaming, no cost row, no `PROMPT_VERSION`; `MODE_TARGET` = `none` with reason.
- Visitor sees what is stored (visitor.ts `POLICY` available), never starts a paid call.
- Nothing counts the modes. Run `npm test`, `npm run typecheck`, lint on touched files; plan doc via `scripts/plan-name.ts`; GPT Sol review of plan and code; work in a worktree; commit by name and push to `dev`; every doc has a parent.

## 5. Where you got lost
- The task name collides with several existing things (FAQ, Quiz, Annotations' questions, Chat); no doc says what "Questions" would mean or that `question` is reserved as Chat's alias (found only in a comment in `mode-catalog.ts`).
- I could not tell whether the Socratic questions are stored on every tree node or only depth 0-1 (types.ts says root and depth-1) without reading more code.
- No `annotations.md` exists, so the closest precedent (a free mode reading existing data) lives only in a plan I may not open; I learned its shape from code comments.
- Did not verify the exact set of silent tests beyond new-mode.md's list; its lists are dated and may have grown.

## 6. Confidence
7/10 that I found everything; the main uncertainty is product intent for "Questions".
