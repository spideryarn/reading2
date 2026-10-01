# Plan review: 261001d Annotations mode (read-only)

Repo: /home/greg/code/spideryarn2/.claude/worktrees/fb7e-annotations-mode, commit c2a06ff5.
Review the plan `docs/plans/261001d-annotations-mode-marginalia-in-a-right-hand-column.md` BEFORE it is built.
Do not edit files. Read the code it names to check its claims: src/web/layout.ts (fitView, fitMode, bandWidth,
PROSE_MIN, MODE_PROSE_FLOOR, proseAloneMaxPx), src/web/reader/Reader.tsx (bandOpen, fit, modeBand, quizAfter,
className on .reader), src/web/TableView.tsx (quizAfter rendering inside td.text), src/web/styles/narrow-window.css
(`.text-alone` centring), src/web/styles/shell.css (.reader padding), src/web/visitor.ts (POLICY),
src/web/useIdeas.ts (useIdeasRead), docs/project/mode.md, src/hierarchy.ts (question on depth-1 nodes),
src/web/useArc.ts, src/web/reader/useReadingPosition.ts (`at`).

Context: Greg's two reports are quoted in the plan. CLAUDE.md has the house rules (prefer simple; block ids; view
state in the URL; visitor must issue no POST). This is experimental and behind the experimental-features switch.

Look especially for:
1. Is the layout arithmetic right? Does `margReserve = max(0, 2·margW + proseW − avail)` really keep the prose where
   Plain puts it, given how `.text-alone` actually centres the table (auto margins inside .reader's content box,
   with safe-area insets and the spine)? Would `.reader`'s min-width or the masthead / controls / sticky bars break?
2. Absolutely-positioned notes at `left: 100%` inside `td.text`: will they overflow, be clipped (overflow on any
   ancestor? the table's `table-layout: fixed`?), cause horizontal page scroll, interfere with selection.ts, the
   gutter, the reading-time hairline, or `memo(TableView)`?
3. The collision pass: anything that will make it loop, thrash, or go stale (zoom, images, fonts, notes map change)?
4. mode.md checklist: anything the plan misses, or gets wrong (e.g. `bandOpen` false for a non-plain mode —
   what else assumes `mode !== "plain"` means a band? `band-covers` class keyed on `fit.modeW === 0`; ModeHerald;
   `proseOnScreen`; last-view restore; the Dock).
5. Visitor path: can a visitor get the tree questions, the arc, and Ideas without any POST? Is "Ideas only where a
   visitor can already read them" implementable simply?
6. Product: is anything here going to read as "a second article down the margin"? Is deferring relation words right?
7. Anything simpler that gets the same result.

Severity scale: P0 (would ship broken / unsafe), P1 (must fix before building), P2 (should fix), P3 (nit).
Give every finding an ID (F1, F2…), the file:line evidence, and a concrete fix. Last: an overall verdict line
"VERDICT: build as planned | build with fixes | rethink".
