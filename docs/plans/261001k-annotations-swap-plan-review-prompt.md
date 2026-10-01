Review this plan, read-only: docs/plans/261001k-annotations-head-path-wraps-and-the-notes-swap-in-on-a-narrow-window.md

It answers two of Greg's reports (quoted in the plan). Context: commit eb76050d / docs/plans/261001i-annotations-column-beside-a-band-mode.md built `?margin=1`. Code: src/web/reader/Reader.tsx (the Dock onMode handler near `next === "annotations"`, `marginColumn()`, `fit`), src/web/layout.ts (`fitView`, MARG_MIN, MODE_PROSE_FLOOR), src/web/annotations/AnnotationsColumn.tsx (`AnnotationsHead`), src/web/styles/marginalia.css (.marg-head, .marg-path), src/web/annotations/notes.ts (`headPath`), tests/every-mode-draws-its-surface.test.tsx § the notes beside a band.

Check:
1. Does the press rule actually deliver Greg's "whichever has been activated most recently trumps/swaps out the other"? Any case in the table that is wrong, missing or contradicts what the code does today (bandAway / stepped-aside band, sub-modes, herald, history push vs replace, the conversation bands' own onMode, the command bar, keyboard shortcuts that switch Annotations — do they go through the same handler?).
2. Is the "notes alone fit" computation right (what threshold, with/without spine)?
3. Is the mobile decision sound and simple?
4. 7M: is the path really what Greg means by "the rail at the top", and is the CSS fix right? Anything that makes the head too tall?
5. Anything simpler.
Give a verdict (build / build with fixes / rethink) and numbered findings with P0-P3 severity.
