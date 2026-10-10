K5-ONE-RULE-3H8V

**No stylesheet changed. No reader-visible regression established.** I made narrow fixes to the evidence tooling, test and documentation; nothing was committed.

1. **Does anything alter what a reader sees? No established change.** I found no competing cascade winner. The coarse-pointer floor sets properties absent from the base button rule; `.on` still follows hover/active; the shared scrolling group already applied to Quotes. No changed element carries a conflicting Tailwind utility. The old names had no operational DOM consumers in source, scripts or the fleet dashboard; remaining references are retained IDs, tests, evidence and historical documentation. There is no `e2e/` directory.

2. **Is there an outside-matrix case that resolves differently? No identified case.** Additional unmeasured cases include a pressed range thumb, endpoints, a one-stop Quotes track, later selected orders, horizontal scrolling, mixed pointer capabilities, browser zoom and fallback fonts. Real-phone rendering and native range painting are substantive limits on empirical proof. The static audit found no changed rule that distinguishes these cases.

3. **Does the dedup earn its keep? Yes.** It removes independently maintained declarations without introducing component flags or replacement copies. The glossary prefix is awkward in Search, but it was already the shared convention. A neutral rename would expand this otherwise small refactor substantially. I would keep this dedup.

4. **Is the Debate modifier excessive? No.** It describes the value itself and avoids coupling every future Debate slider to a contextual exception. **Yes**, explicit inheritance selects the same parent face that omission selected in the current contexts. `inherit` is the specified keyword; the computed value is the resolved font family.

5. **Was removing the old classes appropriate? Yes.** The documented constraint protects operational selector hooks. These removed names had no such consumer, and the range IDs and label associations remain intact.

6. **Is the measurement sound evidence? Yes, for the recorded matrix.** Compare mode reproduced **0 differences over 76,084 values**. I decoded both files and verified 28 scenes, 292 captures, 2,112 stored records, and the intended hover/focus/active targets. Delta encoding retains its comparison bases; default comparison skips only `cls`; sorting computed-property names removes enumeration noise without discarding property values. Native pseudo-elements and uncaptured surrounding content remain outside its proof. The injected Debate row is a useful CSS stand-in, with the limitations below.

7. **Is every “umbrella or brief was not so” statement accurate? No.** The umbrella already refers generally to panel tests, so calling the individually unnamed tests “missed” overstates the omission. Its K5 consumer list also does not name `mode-band.css` or `voices.css`. I corrected that wording. The line counts and changed-file claims check out. Stored-article counts cannot be independently verified without the database.

8. **Does the new Debate test earn its place? Yes. Was its original statement true at its strength? No.** It checked class/declaration presence, not computed rendering. Its name and assertions now describe and enforce the structural guarantee.

The findings were:

- **K5-F1 — P2, established: census drops declaration priority.**  
  **Evidence:** `.gloss-gate { padding: 1px }` and the same declaration with `!important` produced identical canonical output because PostCSS stores priority separately.  
  **Fix made:** retain `d.important`. A regression assertion failed before the fix and passed afterwards. Actual K5 rules contain no important declarations.

- **K5-F2 — P2, established: face test ignores applicability.**  
  **Evidence:** wrapping the modifier in `@media print` still satisfied the original regex, while leaving the screen value monospaced.  
  **Fix made:** require exactly one unconditional inherited-face rule, alongside the JSX modifier. The print-only mutation failed the strengthened test; the actual stylesheet passes.

- **K5-F3 — P3, established: injected markup described as exact.**  
  **Evidence:** injection uses *as found / stance / date*; the real panel uses *as found / date / stance*. It also omits titles, handlers and `OrderGroup` effects.  
  **Fix made:** describe those limitations accurately. The injected fixture and saved captures remain unchanged.

- **K5-F4 — P3, established: inaccurate explanatory prose.**  
  **Evidence:** the umbrella includes general panel-test coverage; `inherit` is not a computed family; AGENTS.md explicitly exempts signposting from approval.  
  **Fix made:** correct those descriptions in the cluster plan. No rule document was edited.

Ten targeted test files passed: **281 tests**. All four TypeScript projects passed direct compiler checks; lint and `git diff --check` passed. Sandbox restrictions blocked the standard typecheck wrapper and one Git-spawning import-order assertion; its equivalent import scan passed separately.

Files changed:

- [census script](/var/tmp/spideryarn-worktrees/agent-a9c5866f16a8fec1a/docs/plans/261007a-ui-sweep-k5-census.mjs.txt)
- [measurement script comments](/var/tmp/spideryarn-worktrees/agent-a9c5866f16a8fec1a/docs/plans/261007a-ui-sweep-k5-measure.ts.txt)
- [cluster plan](/var/tmp/spideryarn-worktrees/agent-a9c5866f16a8fec1a/docs/plans/261007a-ui-sweep-k5-threshold-slider-and-order-row-one-class-set.md)
- [Debate test](/var/tmp/spideryarn-worktrees/agent-a9c5866f16a8fec1a/tests/reception-and-claims-panel.test.tsx)

VERDICT: ready with these fixes