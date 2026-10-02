You are reviewing a plan before it is built, in the repo at the current directory (read-only).

The plan: docs/plans/261002e-interactive-tooltip-prop-and-help-link-in-band-about-cards.md

Read it, then read the code it touches: src/web/Tooltip.tsx, src/web/BandAbout.tsx, src/web/ModeSurface.tsx (around BandAbout), src/web/styles/tooltip.css, src/web/help/help-anchors.ts, docs/project/tooltips.md § "The pointer cannot enter a card", docs/project/open-questions.md § Q10, and the installed @floating-ui/react 0.27.20 in node_modules (useHover handleClose, safePolygon, useFocus, FloatingFocusManager non-modal behaviour, useDismiss).

Questions I most want answered:
1. Will safePolygon + .interactive + non-modal FloatingFocusManager (initialFocus -1, returnFocus false) work together on a CONTROLLED Tooltip (mouseOnly hover, onClick toggle on the trigger)? Any interaction that would make the card stick open, close when it should not, or steal focus on hover?
2. role "tooltip" vs "dialog" for a card that holds a link — which, and why, given the trigger already sets aria-expanded.
3. Does anything in the default (non-interactive) path change? The spine must be untouched.
4. Touch: tap (i), then tap the link inside the card — any event-order trap (the file documents one for mouseleave-before-click)?
5. Are the jsdom tests proposed able to go red for the right reason? Suggest better ones.
6. Anything simpler that gets the same result.

Reply with numbered findings, each with severity (P0-P3), the evidence (file:line), and a concrete fix. End with a one-line verdict.
