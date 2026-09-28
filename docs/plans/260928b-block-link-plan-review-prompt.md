# Plan review — 260928b one block-link component

You are reviewing a PLAN, read-only. Do not change any file.

Repo: this worktree. Plan: `docs/plans/260928b-one-block-link-component-with-a-rich-tooltip-and-a-flash-on-arrival.md` (untracked — read it from disk). Greg's ask is quoted at its top.

Read to check it against the code: `src/web/BlockRef.tsx`, `src/web/Cited.tsx` (the `cited` function and `CitedBlock`), `src/web/keynav.ts` § `beginJump`, `src/web/scroll.ts` (`scrollToBlock`, `glide`, `reducedMotion`), `src/web/reader/useReadingPosition.ts` § `jumpTo`, `src/web/ReturnChip.tsx`, `src/web/Tooltip.tsx`, `src/web/TableView.tsx` (the row `<tr data-block>` and `td.text`), and a few group-B callers named in the plan (ClaimsPanel, SearchPanel, TrajectoryPanel, IdeasPanel). Docs: docs/project/tooltips.md, block-ids.md § Showing an id, url-state.md § Three decisions, touch.md. These do not limit your scope.

Attack independently first:
- Is putting the flash in `beginJump` right? Which deliberate jumps would miss it, which non-deliberate moves would wrongly get it? Does the "flash when already there" branch interact badly with anything (e.g. search's always-onJump, the restore effect)?
- Timing: how can the flash reliably start when the glide lands (glide cancelled by wheel/touch, reduced motion instant branch, the row not rendered yet/lazily, the prose column hidden when `showText` is off)?
- The tooltip: is a React context in Reader the right way to feed `BlockRef` text and section? Callers outside Reader (other pages, dialogs portalled out, tests)? Performance: a Floating UI instance per link in long lists (glossary occurrences, search hits)?
- The missing-block state: any caller where an id legitimately is not in `blockText` but must stay a link?
- Group B migration: button → anchor. Semantics, CSS, tests, nested interactive content risks.
- Anything the plan gets wrong about the code, or a simpler design that gets most of the value.

Severity: P0 data loss/security/broadly unusable; P1 user-visible wrong behaviour or contract violated; P2 design/maintainability risk; P3 prose. Give each finding an ID (F1…), severity, file:line evidence, and a concrete fix. End with a verdict: build as planned / build with changes (list) / rethink.
