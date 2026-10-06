Fixed two findings; changes are uncommitted.

- **F1 — P2, fixed:** [SkimPanel.tsx:552](/var/tmp/spideryarn-worktrees/skim-cue-situates-and-glossary-chips/src/web/SkimPanel.tsx:552). A delayed Hide stole focus from another term and closed its card. Focus recovery now tracks the initiating chip/card. Red-first test: “does not pull focus back from another term when a slow Hide completes”.
- **F2 — P1, fixed:** [SkimPanel.tsx:1046](/var/tmp/spideryarn-worktrees/skim-cue-situates-and-glossary-chips/src/web/SkimPanel.tsx:1046). Focus before a touch click prevented pinning and second-tap dismissal. Touch/pen activation now uses pointer type and clears held state. Red-first test: “pins a touch tap even when focus opens the card before click, and a second tap closes it”.

Validation: **190 tests passed**, including the requested suites, prose-card actions, keyboard navigation and doc links. Typechecking passed through `node --import tsx`; lint reported only existing complexity advice.

Full `npm test` was blocked by sandbox Docker/Postgres access. Short-window geometry remains unverified; `acts` introduces no memoization defect. Stage 2 files were untouched. Root causes are recorded in the [postmortem](/var/tmp/spideryarn-worktrees/skim-cue-situates-and-glossary-chips/docs/postmortems/261006g-input-and-focus-ownership-inferred-from-shared-ui-state.md).

VERDICT: ready