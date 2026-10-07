# F1 code review — cd1db5533

Independent review of the loading-line change. Findings recorded before fixes. No commits made;
other agents' uncommitted changes were left untouched.

- **E2 — P1, Search's first answer is a press response.** `SearchPanel.tsx`'s first-answer `BandWaiting` inherits the 600ms delay after Find or retry. Its hint and saved-row acknowledgement remain immediate, but the loading line itself violates the press-response exception. Pass `delayMs={0}` and test the line before advancing timers.
- **E3 — P1, Illustrated mixes a known empty state with a prerequisite wait.** In `IllustratedView.tsx`'s `checking` branch, the painting read has confirmed absence, while a GET for Sketch readiness is still pending. The immediate spinner violates the 600ms wait rule. Keep “Nobody has painted this one yet.” immediate without a spinner; give the Sketch lookup its own delayed `BandWaiting`.
- **E4 — P1, a new plate request inherits an earlier request's wait timer.** The unkeyed `Plate` reuses `BandWaiting` when switching between pending image fetches. Once the first fetch has waited 600ms, the next fetch shows a spinner immediately. Tie the wait's identity to slug, hash and extension; test switching between two unresolved requests.

- **E1 — P1, the empty box does not hold the sentence's height.** The reader uses `box-sizing: border-box`. `min-height: 1lh` includes vertical padding, so a blank `gloss-quiet`, `summ-quiet`, Sketch, Illustrated or Chat wait is only its padding tall; showing the words adds a line. An unpadded line can also grow when its sentence wraps. Reserve the actual wrapped sentence and icon footprint, with no visible or accessible words before the threshold. Keep caller padding, margins, display and Diagram's 8rem minimum.
- **E5 — P2, the immediate override still waits for a timer task, and its regression is untested.** `useSlow(true, 0)` initially returns false. `/design` and Referee therefore render blank until `setTimeout(0)` runs. Draw synchronously for zero delay, and assert this without advancing timers. Restore the Criteria test's assertion about the immediate words, which was weakened to presence of a box.
- **E6 — P3, the /design note overstates the delay.** It says a real band “always” waits 600ms despite Referee's explicit immediate exception. The loading-spinner rules also describe the chat-turn exception as “the one exception” before later listing Referee. Reconcile the text with the specified press-response behavior.
- **E7 — P1, wider and pre-existing: Learn's Start over is drawn as a delayed read.**
  `ConversationModes.tsx:560,1253–1268` removes the current conversation immediately while
  stopping Live and deleting the thread. `ChatPanel.tsx:679–686` then draws delayed
  `ChatListLoading`, without another pending-action acknowledgement. After 600ms it says
  “Fetching your Learn conversation…” even while shutdown/DELETE is pending. The old component
  already behaved this way before `cd1db5533`; passing reset phase/origin into the panel belongs
  to a wider change. Reported only, as requested.

**E1 remains unresolved and blocks readiness.** The relevant rules are
[`mode-band.css:184`](../../src/web/styles/mode-band.css#L184), the global border-box reset at
[`tokens.css:450`](../../src/web/styles/tokens.css#L450), and the callers' padding (for example
[`glossary.css:212`](../../src/web/styles/glossary.css#L212)). A one-line minimum includes the
padding rather than reserving a line *inside* it. Chat's stronger `min-height: 1.2rem` override
has the same pre-existing problem; merely increasing the shared rule cannot fix that caller.
Wrapped sentences also need their full footprint reserved. The new Chrome regression compares
empty and filled heights at 280px and 360px, using the real reader CSS and all eleven distinct
caller class/tag combinations. Chrome cannot launch in this sandbox: `setsockopt: Operation not
permitted`, then SIGTRAP, before any height assertion. The Sonnet browser dispatch also failed
to return a verdict. To honor the requested behavioral red-first sequence, no geometry fix was
made without seeing that test reach its assertions. This is an established CSS contract defect,
not a refusal based only on missing browser coverage. The candidate's held-height claims in
`BandWaiting.tsx`, `loading-spinner.md` and `web-client.md` therefore remain inaccurate under E1.

**Fixed E2–E6.** Search's first-answer line now opts into immediate feedback. Illustrated's known
empty sentence stays immediate without a spinner while the Sketch lookup uses the delayed line;
each plate wait is keyed by its fetch identity. These three caller regressions were observed red
before edits: **3 failed, 69 passed**. A separate no-timer component regression exposed E5:
**1 failed, 6 passed**. Zero delay now draws synchronously. Restored Criteria's immediate-words
assertion and added Claims' equivalent; deliberately removing Claims' immediate override made
its new assertion fail, and the mutation was restored. Ideas now checks the delayed words and
their disappearance, instead of treating a status box as proof the wait says anything. The shared
tests also check the live region keeps its identity, StrictMode loading→ready→loading, and keyed
remounts. The /design note and spinner doc now describe the immediate exceptions consistently.
The root cause, introduction history, and remaining geometry defect are in
[the postmortem](../postmortems/261007k-a-shared-wait-still-belongs-to-one-request.md).

Other audit conclusions:

- Apart from the pre-existing Learn reset exception (E7), the converted lines describe reads: opening artefacts, saved lists, reading history,
  projection data, and image bytes. Quiz/Skim generation and forced re-runs use `JobProgress`,
  keeping their acknowledgement immediate. Referee's immediate overrides are correct and now
  have words assertions for both callers. Not-made-yet and finished-empty states stay immediate.
- Normal completion/error transitions unmount the wait; cleanup cancels its timer. The plate
  replacement case was the established exception and is fixed. Reader mode subtrees are keyed
  by article slug and mode.
- Default waits mount an empty status region, later fill that same element, and hide their SVG
  from assistive technology. No converted line is nested in another status region. These DOM
  checks establish the accessibility structure, not speech output from a screen reader.
- Zero specificity correctly lets caller display/gap/min-height win, including Diagram's 8rem
  box. `as="div"` preserves Sketch/Illustrated/Chat's tags; paragraph callers retain their margins.
  Neither fact establishes stable height. The Chrome fixture does not cover all production
  ancestor selectors, custom webfonts, or screenshots.
- Snapshot assertions test markup, not timing or geometry. FAQ, Quiz and Diagram retain before/
  after text checks; Ideas' and Criteria's weakened text evidence was strengthened as above.

Verification:

- Before fixes: **7 requested files, 292 passed**. The first attempt was refused by the memory
  guard; a subsequent attempt was admitted without changing it.
- Final targeted run: **11 files, 418 passed**, including all seven requested files, Search,
  Illustrated, Claims, and doc-links. This excludes the Chrome geometry test, which failed at
  browser startup and verified no layout.
- `npm test` stopped at private-Postgres global setup: local database connection `EPERM`.
  No full-suite result was obtained.
- `npm run typecheck` could not start tsx's IPC server (`EPERM`). Running the same script with
  `node --import tsx scripts/typecheck.ts` checked every project and source coverage; the final
  tests-project compiler run reports only the other builder's two missing-children fixture
  errors at `tests/tap-target.test.tsx:181` and `:196`. The new Search test's union-type error was
  corrected, then the targeted run repeated green.
- Scoped Biome lint reports existing `dangerouslySetInnerHTML` in `/design`, `const escape` in
  `quick-search-panel.test.tsx`, and complexity advice. Those wider findings were left unchanged.

Files changed:

- `src/web/BandWaiting.tsx`
- `src/web/SearchPanel.tsx`
- `src/web/IllustratedView.tsx`
- `src/web/DesignPage.tsx`
- `docs/project/loading-spinner.md`
- `tests/band-waiting.test.tsx`
- `tests/band-waiting-layout.test.tsx` (new; browser execution blocked)
- `tests/ideas-read-states.test.tsx`
- `tests/referee-claims-panel.test.tsx`
- `tests/referee-criteria-panel.test.tsx`
- `tests/quick-search-panel.test.tsx`
- `tests/illustrated-view.test.tsx`
- `docs/postmortems/261007k-a-shared-wait-still-belongs-to-one-request.md` (new)
- `docs/plans/261007h-f1-code-review-sol.md`

VERDICT: not ready
