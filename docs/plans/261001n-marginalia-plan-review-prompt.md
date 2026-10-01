# GPT Sol plan review: 261001n (rename Annotations to Marginalia; interface vision doc)

You are reviewing a plan before it is built, in the repo at the current directory (read-only).

Read:
1. docs/plans/261001n-rename-annotations-mode-to-marginalia-and-the-three-column-interface-vision.md (the plan)
2. docs/project/interface-vision.md (a vision doc, explicitly NOT decided; Greg asked for it)
3. docs/user-feedback/261001_1132-interface-vision-and-annotations-become-marginalia.md (Greg's verbatim words)
4. The code the rename touches: src/modes.ts (MODES, BandMode, isBandMode, modeFromParam, RETIRED_MODES), src/mode-catalog.ts (the `annotations` entry), src/title-text.ts MODE_LABEL, src/web/params.ts (marginParam, marginInSearch), src/web/last-view.ts (rememberableSearch), src/web/Dock.tsx (search for "annotations"), src/web/reader/Reader.tsx (search for "annotations"), src/web/annotations/*, and docs/project/mode.md § Retiring a mode.

Answer:
A. The rename plan: is anything missing, wrong, or risky? In particular: (i) is generalising the legacy translators to "the legacy word `annotations`, or any Mode that is not a BandMode" correct and complete, so `?mode=marginalia` behaves exactly as `?mode=annotations` does today in every path (Reader arrival rewrite, Dock link builder, last-view remembering, page/tab title via readMode/documentTitle, feedback diagnostics, public/visitor paths)? (ii) Is skipping RETIRED_MODES right? (iii) Any stored or wire value that would be orphaned? (iv) Is renaming the internal identifiers and the src/web/annotations/ folder worth it, or should it be the user-facing word + mode word only? Give a recommendation.
B. The vision doc: is anything factually wrong about today's code (check claims against code, e.g. Debate claim rows carrying blockId; margin coexisting from 900px)? Are the three "sent" questions the right first three (ease x value, gated on Greg), each answerable, with a defensible recommendation? Anything important missing or a better simpler path?
Rank findings P0/P1/P2 with file:line evidence. Be concise.
