# Answer key P06: a new "Questions" mode in the band, behind the experimental switch

Nearest landed work: `261001d-annotations-mode-marginalia-in-a-right-hand-column.md` (the newest
experimental mode, built to the checklist) and `261001d-command-bar-lists-sub-modes.md` (the bar
now lists sub-modes from one registry).

**First, the name and the overlap.** "Questions" already exists three times: FAQ mode (the
questions a careful reader would ask, `docs/project/faq.md`), Quiz (the article asks, you answer,
`docs/project/quiz.md`), and the Socratic `TreeNode.question` per part that Annotations and Summary
draw. And `src/mode-catalog.ts` records that `question` is Chat's alias, which is why FAQ avoided
`questions`. The ideal agent asks Greg what Questions is for, and whether it is a sub-mode of FAQ
or Remember, before adding a fifteenth word to `MODES`.

## 1. Docs it must read
- MUST `docs/project/new-mode.md` - the whole checklist: § The client (the total tables), the residue, § The card on the button, § The artefact, if the mode shows one, § Its cost, § Before you call it finished (what goes red, including four tests the typecheck cannot see).
- MUST `docs/project/experimental-features.md` § "The four rules", § "Putting a feature behind it" (gate the control, not the URL; the reader stays where they are), § "What is behind it today" (add a row, say why).
- MUST `docs/project/reading-view-overview.md` § "The modes in the band" (add the line) and § The command bar.
- MUST `docs/project/faq.md`, `docs/project/quiz.md` - to not build a duplicate.
- MUST `docs/project/new-mode.md` § the residue "No description line in the band" (Greg, 2026-09-30, 7B).
- USEFUL `docs/plans/260902o-adding-a-mode-the-recurring-edits-and-how-to-make-them-one.md` § Rejected (no mode registry, no generic artefact route).
- USEFUL if it generates: `docs/project/prompting-guide.md`, `docs/project/ai-gateway.md`, `docs/project/cost-tracking.md`, `docs/project/architecture.md` § Conventions (content-hash cache).

## 2. Existing code to reuse
- `src/modes.ts` § `MODES` then the compiler-asked tables: `src/title-text.ts` § `MODE_LABEL`, `src/messages.ts` § `OWNER_MODE_NOTE`, `src/mode-catalog.ts` § `MODE_CATALOG` (`experimental: true`, aliases, `description`, `how`), `src/web/Dock.tsx` § `MODES_UI` (+ `group`), `src/web/visitor.ts` § `POLICY`, `src/web/activation.ts` § `MODE_TARGET`, `src/web/reader/Reader.tsx` § `modeBand()`, `src/web/reader/ModeBoundary.tsx` § `MODE_CONTAINMENT`, `src/web/reader/passages.ts` § `selectPassages`.
- `src/web/ModeSurface.tsx` § `ModeSurface` - the band's `<aside>`. Trap: hand-writing the aside.
- `src/web/useOrderedRead.ts`, `src/web/useStepJob.ts`, `src/web/useIdeas.ts` (the hook shape), `src/web/auto-run-targets.ts` + `useAutoRun` (opening it starts it). Trap: a ninth copy of the read/job hook.
- `src/web/useExperimental.ts` § `useExperimental` and `src/web/Dock.tsx` § `visibleModes` - the switch. Trap: gating the route or `MODES`, or writing a second gate in the panel.
- `src/web/sub-modes.ts` - if Questions has sub-modes, register them here so the command bar lists them. Trap: a private label table in the panel (what 261001d removed).
- `src/web/BlockRef.tsx`, `src/web/Tooltip.tsx` § `ControlTip` for rows and controls; `src/web/faq-order.ts` if the ordering is FAQ-like.
- If it shows an artefact: `src/store/artifacts.ts` § `ArtifactKind`/`ArtifactMap`, `src/types.ts` § `StepName`, `src/step-order.ts`, `src/models.ts` tables, `src/cost-categories.ts` § `JOB_DISPOSITION`, `plainWords(...)` for the prompt.

## 3. Code files it would edit
The tables above; a new `src/web/QuestionsPanel.tsx` (+ hook); its stylesheet in `src/web/styles/`, placed in `MANIFEST` (`tests/styles-entry-is-imports-only.test.ts`); `src/web/params.ts` for any URL param; tests `tests/every-mode-draws-its-surface.test.tsx` (`SPENDS`, `DRAWS`), `tests/public-network-trace.test.tsx` (`BAND_SAYS`), `tests/command-bar.test.tsx` (`GENERATES`), `tests/dock-experimental-modes.test.tsx` (`BEHIND_THE_SWITCH`), `tests/visitor-gaps.test.ts` (`ALWAYS_FREE`), `tests/page-title.test.ts` (`named`), `tests/dock-mode-order.test.ts`, `tests/every-mode-says-which-passages-it-marks.test.ts`; a new `docs/project/questions.md` with a line under `reading-view-overview.md`.

## 4. Project rules that apply
- Ask Greg when the requirement is unclear; explain options plainly (`CLAUDE.md`).
- Plan doc first, GPT Sol plan review, code review (`docs/reusable/engineering-manager.md`, `docs/reusable/codex-cli-as-subagent.md`).
- Every paid call through the gateway, tracked for free via a pipeline step (`docs/project/ai-gateway.md`, `docs/project/cost-tracking.md`); stream if the reader waits (`CLAUDE.md`).
- Run the full suite, not only typecheck: four tables are keyed on `string` (`new-mode.md` § Before you call it finished).
- New doc needs exactly one parent (`tests/doc-links.test.ts`). Browser check in a Sonnet subagent (`docs/project/browser-control.md`).

## 5. Traps (from the landed plans)
- Aliases may not repeat the label, and `question` ties with Chat in the bar (`src/mode-catalog.ts` FAQ comment; `tests/mode-catalog.test.ts`).
- With the switch off and the mode open, it stays open and its button stays (`Dock.tsx` § `visibleModes`); the bar's sub-rows follow the same gating (261001d command bar § P1-3).
- `MODE_CONTAINMENT` needs a `WITNESS` per composition path, or the boundary guards an empty slot (261001d annotations, Sol F3).
- No description line, no `.band-head` carrying the mode's name (`new-mode.md`; 261001d annotations § Astra 5).
- A `generates` marker must match what the press arms; test `subModeTarget`/`bandTarget` equality, not a mocked `onMode` (261001d command bar § review).
