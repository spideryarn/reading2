You are reviewing a PLAN (read-only; do not edit anything) for the Spideryarn reading app, in this repo.

Plan: docs/plans/261018g-phone-portrait-gutter-icons-above-the-paragraph.md — read it fully, including Greg's request quoted at the top.

The code it would change: src/web/styles/gutter.css (§ the gutter, the container-query count, the (hover: none) row-active reveal, the "…" open panel, reading-time strip), src/web/styles/shell.css (--text-pad-l/--text-pad-r, --blk-slot), src/web/styles/narrow-window.css (the @media (max-width: 731px) block, and every rule that reads --text-pad-l/-r: the masthead alignment, text-alone centring), src/web/styles/footnotes.css (note gutter), src/web/styles/prose.css (heading fold chevron), src/web/BlockGutter.tsx (markup order, which controls are hidden for focus), src/web/TableView.tsx (NOT_A_BLOCK_SELECTION, row-active), src/web/layout.ts (proseAloneMaxPx and anything that assumes the pad total), tests/gutter-target-size.test.ts, tests/gutter-touch-contrast.test.ts, tests/prose-centred-in-its-cell.test.ts, tests/text-alone-centring.test.ts. Also docs/project/touch.md § The gutter, and the row a finger is on.

Please answer:
1. Is the design sound as CSS? In particular: switching the gutter on tr.row-active from `container-type: size` column to a horizontal bar with `container-type: normal` — what happens to the @container count rules (which container do they then query?), to the `(hover: none)` rules that hide .blk-cmt on an active one-slot row, to span.blk-read, to headings (bottom-aligned gutter) and footnote gutters, and stacking against the previous row (z-index)?
2. Anything in JS or layout.ts that assumes --text-pad-r equals the gutter width, or that the pads total a fixed number, which the phone override would make false (e.g. proseAloneMaxPx, the masthead alignment, the centring)?
3. Is making the at-rest marks pointer-events:none a regression a reader would mind, and is there a cheap better option?
4. Is the condition `(max-width: 731px) and (hover: none)` right, given touch.md's notes on iPad and touch laptops?
5. Anything simpler that achieves Greg's ask as well?
Give findings ranked P0/P1/P2 with file:line evidence, and a one-line verdict at the end (VERDICT: build as planned / build with changes / rethink).
