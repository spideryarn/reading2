# Plan review: Annotations' column beside a band mode

You are reviewing a plan before it is built, read-only, in the Spideryarn repo (this worktree).
The plan: docs/plans/261001i-annotations-column-beside-a-band-mode.md. Its parent, which shipped
today: docs/plans/261001d-annotations-mode-marginalia-in-a-right-hand-column.md.

Read the code it will change: src/web/layout.ts (fitView, fitMargin, fitMode, bandWidth,
bandCoversProse), src/web/reader/Reader.tsx (mode, bandOpen, marginOpen, fit, modeBand(), the
Dock's onMode callback near the end, marginNotes / useMarginLayout), src/web/Dock.tsx
(DockModes, visibleModes, useActivateMode, the metadata-page link arm, fitSignature),
src/web/params.ts (modeParam), src/modes.ts (MODES, modeFromParam, RETIRED_MODES),
src/read-address.ts (readMode), src/web/annotations/AnnotationsColumn.tsx,
src/web/styles/marginalia.css, src/web/styles/narrow-window.css (the masthead rules near 1180 and
1290, band-covers), src/web/styles/shell.css, tests/layout-margin.test.ts, and
docs/project/url-state.md.

Check especially:
1. The state model: is `?margin=1` independent of `?mode=` sound across every path that writes
   or reads the mode — command bar, Back/Forward, last-view restore, the metadata page's Dock
   links, visitors, public articles, the herald, bandAway, activation arming?
2. The `BandMode = Exclude<Mode, "annotations">` typing: will it actually make the compiler find
   every site, or are there `Mode`-typed paths (string comparisons, Records) where
   `mode === "annotations"` silently becomes dead or wrong?
3. The arithmetic in § The layout: overflow, the threshold, the cap, Structure's face, Tweets'
   wide band, safe-area insets, `minWidth`, `layoutKey`.
4. Narrow windows: is "the band wins" implemented coherently with `band-covers`, `bandAway` (a
   band stepped aside on a phone), the small-screen hint, and the line's position?
5. Anything simpler that gets the same reader outcome.

Give findings as P0–P3 with file:line evidence, and a one-line verdict (build / build with fixes /
rethink). Under 1200 words. Do not edit files.
