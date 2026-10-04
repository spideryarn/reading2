## Findings

- **P2 — The reachability table overstates the (i) route.**  
  **(a)** A visitor who opens an unavailable mode gets `VisitorBand`, which deliberately passes no `mode` to `ModeSurface`, so it has no (i) ([PublicChrome.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbtnqt2t-bottom-bar-order-and-help/src/web/PublicChrome.tsx:294), [ModeSurface.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbtnqt2t-bottom-bar-order-and-help/src/web/ModeSurface.tsx:244)). A failed band’s hand-written fallback also has no (i) ([FeatureBoundary.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbtnqt2t-bottom-bar-order-and-help/src/web/FeatureBoundary.tsx:270)), nor does Marginalia’s column. On a phone these readers cannot fall back to hover or a keyboard shortcut.  
  **(b)** Replace “every mode’s (i)” and the two-row table with a full matrix that names normal panels, VisitorBand, Marginalia and the failure fallback. Add reading-view coverage through the real `drawer.visitor` path and public-Metadata coverage through the explicit `visitor` prop. Also qualify the existing absolute claims in `help-page.md`, `mode.md` and `tooltips.md`.

- **P2 — “A visitor’s bar is already the short one” is false for signed-in visitors.**  
  **(a)** A signed-in reader viewing somebody else’s shared article is still `isVisitor`, so Commands and quick search stand down, but `experimental.signedIn` still draws Experimental and Feedback ([Dock.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbtnqt2t-bottom-bar-order-and-help/src/web/Dock.tsx:1841), [PublicPages.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbtnqt2t-bottom-bar-order-and-help/src/web/PublicPages.tsx:308)). Their bar is therefore not the signed-out short bar described in the plan. They nevertheless still need the Help link because they have no command bar and may have no (i).  
  **(b)** Split signed-out and signed-in visitors in the table and rationale. Add a signed-in visitor test using `EXPERIMENTAL_ON` that asserts Help remains while Commands is absent. The decision to retain Help remains correct.

- **P3 — The planned Metadata test promises context the implementation does not provide.**  
  **(a)** A visitor on `/read/a-piece/metadata?mode=glossary` has no `mode` prop. `helpHrefFor(undefined)` intentionally points to `/help#the-reading-view`, not Glossary ([Dock.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbtnqt2t-bottom-bar-order-and-help/src/web/Dock.tsx:2637)). Thus “the visitor’s follows the mode, on both pages” is not implementable without an unplanned behavior change.  
  **(b)** Change the test specification to: contextual mode section on the reading view; reading-view section on Metadata; Help present for visitors on both.

- **P3 — The order edit omits the active `ModeGroup` enumeration.**  
  There is no affected reader state; this is the requested no-(a) finding. The comment will still say `FAQ, Glossary` and `Referee, Citations` after the row swaps ([Dock.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbtnqt2t-bottom-bar-order-and-help/src/web/Dock.tsx:648)).  
  **Smallest change:** add the `ModeGroup` run enumeration to the edit list, alongside the row comments and literal-order test.

## Reachability verdict

With the visitor exception retained, every requested state has a route:

- Owner in a mode: tappable (i), Commands button, or keyboard chord.
- Owner in Plain or Metadata: Commands button/chord.
- Signed-in or signed-out visitor, reading view or Metadata: retained Dock Help link.
- Phone: owner uses the Commands button or tappable (i); visitor uses the Dock link.
- Failed band: owner uses Commands; visitor uses the retained Dock link.

`isVisitor` is exactly the command-bar stand-down condition: the same derived boolean gates the chord, button and dialog on both page shapes.

Keeping Help for visitors is the smallest safe reading. Removing it would require either opening the command-bar capability seam to visitors or adding separate routes to Plain, Metadata, VisitorBand, Marginalia and the deliberately hand-written failure fallback.

The command bar derives mode order directly from `visibleModes`; `/design`, keyboard handling and fit logic encode no positional order. Help’s modes table deliberately uses `MODES` vocabulary order, not Dock order. Historical plans, changelog entries and the shipped feedback note should remain historical.

The permitted test was attempted but could not start because the read-only environment prevented Vite from creating `node_modules/.vite-temp`.

**Ready with changes.**