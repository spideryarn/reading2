Six in-scope findings fixed, with changes left **uncommitted**. Each regression test failed before its fix.

- **C1 — P1:** Enter/find before loading was dropped. [SearchPanel.tsx:538](/home/greg/code/spideryarn2/.claude/worktrees/quick-search-bar/src/web/SearchPanel.tsx:538) now records the intent; the reducer queues it and seals that session. Red-first: `carries Enter/find before loading, including short words, and seals that session`.

- **C2 — P2:** Flesh-out on an unrelated row ended the current session. [SearchMode.tsx:155](/home/greg/code/spideryarn2/.claude/worktrees/quick-search-bar/src/web/modes/search/SearchMode.tsx:155) now receives the source row’s id and ends only its session. Red-first: `flesh out ends only its own typing session (own=false)`.

- **C3 — P1:** Failure before `begin` released a parked revision. The older server request could then begin last, overwriting newer words or creating another row. [useSearch.ts:727](/home/greg/code/spideryarn2/.claude/worktrees/quick-search-bar/src/web/useSearch.ts:727) now retains an unresolved lane and the latest words for explicit retry. Red-first: `keeps a failed unacknowledged request as a barrier to automatic revisions`.

- **C4 — P1:** Parked revisions changed the displayed words but left the duplicate guard on the old criterion. Repeated Enter could create another row. [useSearch.ts:746](/home/greg/code/spideryarn2/.claude/worktrees/quick-search-bar/src/web/useSearch.ts:746) now updates both. Red-first: `a repeated Enter does not duplicate a revision parked before begin`.

- **C5 — P2:** A failed revision replaced `createdAt` with its request timestamp, moving the saved row. [useSearch.ts:720](/home/greg/code/spideryarn2/.claude/worktrees/quick-search-bar/src/web/useSearch.ts:720) now preserves its saved creation time. Red-first: `keeps the saved creation time when a revision fails`.

- **C6 — P2:** Closing a meaning-search connection suppressed genuine failure reporting. [routes.ts:4447](/home/greg/code/spideryarn2/.claude/worktrees/quick-search-bar/src/routes.ts:4447) now suppresses cancellation reporting only for quick. Red-first: `closed meaning connections preserve their failure-reporting policy`, using the real handler with mocked store/model calls.

**C7 — P2, wider scope, reported only:** [searches.ts:154](/home/greg/code/spideryarn2/.claude/worktrees/quick-search-bar/src/searches.ts:154) deliberately creates a row for an absent revision id. A stale tab can therefore recreate another tab’s deletion. No fix or red-first integration test; this needs a broader ordering/deletion contract.

The SQL finish fence and `searching` ownership appear correct by inspection. Superseded-frame/error tests pass. Optional `typing` is intentional standalone-panel compatibility; autofocus remains stage 3.

**Validation:** 74 requested tests plus 112 adjacent/mocked-route tests passed. Typecheck, doc links and scoped lint passed; lint reports complexity advice. PostgreSQL tests were not run. The registry subprocess check hit a sandbox restriction; its equivalent import-graph check passed.

Recorded the race’s root cause in the [postmortem](/home/greg/code/spideryarn2/.claude/worktrees/quick-search-bar/docs/postmortems/261002g-transport-completion-is-not-server-acknowledgement.md).

**Verdict: land with fixes (made).**