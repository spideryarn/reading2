# Plan review: Referee mode puts the actions first (261003k)

You are GPT Sol, reviewing a plan before it is built. Read-only: report findings, change nothing.

Read, in this order:

1. `docs/plans/261003k-referee-mode-puts-the-actions-first-and-the-notices-behind-one-button.md` (the plan)
2. `docs/project/referee-mode.md`, especially "Every control says what it does", "The card that says
   what the mode is for", "Confidentiality", "The band has to fit", and the Candidates paragraphs about
   2026-09-06 and `REFEREE_CANDIDATES_REACHES_SEARCH`
3. `src/web/modes/referee/RefereeMode.tsx`, `src/web/RefereeCard.tsx`, `src/web/referee-card.ts`,
   `src/web/activation.ts` (`REFEREE_TARGET`, `subModeTarget`, `bandTarget`, `subModeGenerates`),
   `src/web/CandidatesPanel.tsx` (`CandidatesBand`, `useAutoRun` call, `StartBrief`),
   `src/web/useAutoRun.ts`, `src/web/SourceScanNotice.tsx` (`shown`, the `open` default),
   `src/web/styles/referee.css` (`.ref-brief`, `.ref-panel`)
4. The tests that pin the present layout: `tests/referee-band-fits.test.ts`,
   `tests/referee-how-card.test.tsx`, `tests/pressing-a-chip-arms-it.test.tsx`,
   `tests/referee-candidates-press.test.tsx`, `tests/command-bar-sub-modes.test.tsx`

The person who asked for this is Greg, the product owner, in a feedback report quoted at the top of the
plan. He asked for the simplest version that gets most of the value.

Questions I want answered, with file and line for each claim:

1. **Does removing `candidates` from `REFEREE_TARGET` do what the plan says, and only that?** Trace
   what `CandidatesBand` does on mount with no token armed: does it show `StartBrief`, or is there a
   state where it shows nothing, a spinner forever, or still auto-runs? Does `bandTarget` or the error
   boundary's retirement logic still expect a `candidates` target for the Referee band, and is there a
   test that asserts `subModeTarget` and `bandTarget` agree which would now fail or, worse, pass for
   the wrong reason? Is the `"candidates"` `AutoRunTarget` left with no producer, and does that matter?
2. **The Notices box opening itself when the scan found something.** The plan moves the scan's own
   "open when found" default up one level. `shown()` is module-private in `SourceScanNotice.tsx` and
   the plan says that file is not edited. What is the smallest honest way for the band to know
   "found"? Is there a way this goes wrong where a finding exists and the box stays shut (the scan
   arrives seconds after mount; a `useState` seeded from loading)? If the file must be edited to
   export a predicate, say so.
3. **Anything the plan removes from permanent view that a written rule in this repo says must stay
   visible**, beyond the two the plan already names as questions for Greg. Check `docs/project/copy.md`,
   `docs/project/privacy.md` and `docs/project/security-map.md` for a promise that the "already sent"
   sentence or the scan headline is always on screen.
4. **The How card's stored bit changing meaning under a new key.** Read `referee-card.ts`. Is a new key
   the right call, or is there a simpler correct one? What happens to focus restoration
   (`useHowCard`, `buttonRef`) when the card starts shut?
5. **The lead line.** Printing `REFEREE_VIEW_TIP[view].what` under the chips: does any existing test
   forbid visible text that repeats a tooltip (`tests/referee-tooltips.test.tsx` compares card text
   against labels)? Does Candidates' `what` ("For an editor: who could review this paper…") read
   correctly as a visible line above a panel whose first control is now the Build button?
6. **Layout.** With `.ref-brief` rendered only when open, does `.ref-panel`'s `min-height` floor and
   the 40% cap still hold the band at a short window (the 2026-09-01 bug)? Reason from the CSS; say
   what must be measured in a browser.
7. Anything else that would make this plan wrong, larger than it needs to be, or silently incomplete.

You can run a single test file that needs no database or network with
`npx vitest run tests/<one>.test.ts(x)`; do not run `npm test` or `npm run typecheck`.

Answer with: a verdict in one line (build as written / build after changes / do not build), then
findings numbered and ranked, each with the evidence and the smallest change that answers it.
