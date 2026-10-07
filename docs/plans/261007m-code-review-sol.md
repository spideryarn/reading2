- **C1 — P1, fixed:** [mode-band.css:1637](/var/tmp/spideryarn-worktrees/design-consistency-followups/src/web/styles/mode-band.css:1637). Learn’s voice group wrapped, but Live and its experimental engine picker remained one unwrapping item, allowing overflow into Send’s space at 288px. Added Learn-only inner wrapping and width constraints. The [regression test:191](/var/tmp/spideryarn-worktrees/design-consistency-followups/tests/voice-row.test.tsx:191) failed before the fix and passes afterward.

- **C2 — P2, wider scope, unchanged:** [quotes.css:245](/var/tmp/spideryarn-worktrees/design-consistency-followups/src/web/styles/quotes.css:245) and [skim.css:77](/var/tmp/spideryarn-worktrees/design-consistency-followups/src/web/styles/skim.css:77). Their targets still shrink to 33px at a 12px root; Diagram now retains its 44px floor.

No further runtime defects found in S1–S4. All seven S4 shadows preserve their original dark geometry and alpha. Source review found no Chat focus-order, accessibility, `:has()`, or narrow-window selector regression from `display: contents`. Learn’s status rows retain their full-width placement.

Validation: **119 tests passed across eight files**, including every requested file; typechecking passed. Reproduced the submitted S1–S5 assertions failing against the original base. These tests establish markup/configuration/declarations, not rendered widths or pixels. Browser checks were blocked by sandbox socket restrictions; full `npm test` was blocked by the unavailable database. Lint reported two existing warnings.

Updated only the permitted plan, CSS, and regression test. No commits made.

**READY WITH THESE FIXES**