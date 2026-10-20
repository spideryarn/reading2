# Plan review: 261020g, Marginalia's tooltips

You are reviewing a plan, read-only, before it is built. Repo: Spideryarn (TypeScript, React).
Read `docs/plans/261020g-marginalia-tooltips-reuse-the-prose-citation-card-and-say-the-item.md`.

Then read the code it touches and check the plan against it:
- `src/web/marginalia/MarginaliaColumn.tsx` (`ShutNote`, `CitationNote`, `MarginNotesSlot`, `QuestionNote`)
- `src/web/marginalia/tips.ts`
- `src/web/BlockLinkCard.tsx` (`contentFor`, MARG_NOTE branch) and `src/web/useDelegatedCard.tsx`
- `src/web/ProseHoverCard.tsx` (`CiteCard`, `CitedAtJumps`, how `HoverCard` calls `CiteCard`)
- `src/web/Tooltip.tsx` (`Tooltip`, `interactive`, controlled `open`, `mouseOnly`, `ControlTip`)
- `src/web/SkimPanel.tsx` (`TermChip`, the precedent)
- `src/web/reader/Reader.tsx` around `marginNotes` (~line 2599) and the `ProseHoverCard` props (~4920)
- `src/web/styles/marginalia.css` (`.marg-shut-label`)
- `tests/marginalia-note-cards.test.tsx`
- `docs/project/marginalia.md`, `docs/project/tooltips.md`, `docs/project/touch.md`

Questions to answer, with file:line evidence:
1. Is reusing `CiteCard` in an interactive controlled `Tooltip` on the Cites line sound? Focus,
   Escape, safePolygon, touch (iPad: tap's synthesized mouse events and focus), the line's own press
   that opens a panel, and keeping the card shut while the panel is open. Any event-order trap?
2. Does the context route for the senders keep `marginNotes`'s memo and `memo(TableView)` intact?
   Is `CiteCard`'s `here` the right block? Is `onJump` with `citePassageKey` right?
3. Is reading `scrollWidth > clientWidth` on `.marg-shut-label` inside the delegated card's
   `contentFor` sound (when is it called; is it re-called on refresh; does `useDelegatedCard`
   pass the element)? Any reason the item's words should come some other way?
4. Anything in the plan that would make a reader worse off, any simpler option missed, any place
   that must hear about this change (docs, tests, help page) that the plan omits.
5. Security: the card draws a work's title/entry and a line's words — all text, never markup?

Write findings numbered F1..Fn, each with severity (blocker / should / nit), evidence, and the fix.
Write ONLY your findings to the output file. Do not edit any file.
