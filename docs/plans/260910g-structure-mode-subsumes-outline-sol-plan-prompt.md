# Plan review: Structure mode subsumes Outline

You are reviewing a plan, read-only, in the Spideryarn repo (this worktree). Read
`docs/plans/260910g-structure-mode-subsumes-outline.md` first, then the code it names:
`src/modes.ts`, `src/mode-catalog.ts`, `src/read-address.ts`, `src/web/params.ts` (`modeParam`),
`src/web/router.ts` (`liftStrandedText`, `settleAddress`), `src/web/modes/structure/StructureMode.tsx`,
`src/web/StructurePanel.tsx`, `src/web/OutlinePanel.tsx`, `src/web/outline.ts`,
`src/web/styles/structure-mode.css`, `src/web/styles/outline-mode.css`, `src/web/reader/Reader.tsx`
(search "outline" and "structure"), `src/web/ModeSurface.tsx`, `src/web/Dock.tsx`, and
`docs/project/new-mode.md`.

The conclusion I would least like to be wrong about: **that choosing the face in JS from the band's
border-box width, against one px constant (389), cannot oscillate and cannot disagree with anything
else on the page** — in particular with the band's own layout (`.band-covers`, `--mode-w`,
narrow-window CSS), with root-font-size changes (the paddings are rem), and with the moment the
band mounts (first frame).

Second: **that `?mode=outline` resolving to `structure` inside the parser (client) and `readMode`
(server) — without rewriting the URL — leaves no reader-visible disagreement**: tab title, Dock
checked state, last-view restore, shared-link public view, feedback context, command bar.

Third: the 2Q change (dropping Outline's one-line clamp) — does anything in `OutlinePanel`'s fit or
`outline.ts` assume one line per row beyond the CSS comment?

Also tell me anything the plan misses from new-mode.md read backwards, and whether promoting
Structure out of the experimental switch is correctly argued from Greg's words.

Report findings numbered, each with file:line evidence and a severity (P0 blocks / P1 should fix /
P2 consider). Do not edit files.
