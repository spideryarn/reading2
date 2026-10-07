1. **H1 — P2, established:** [delegations.ts:381](/var/tmp/spideryarn-worktrees/qi-p78m9ch9-gpt-live-status/src/web/live/gpt-live/delegations.ts:381) marked unusable usage as billed, discarding later valid totals. **Fixed:** validate through `backendReport` before setting the marker. Red test: `does not consume billing when an early error carries unusable usage`. Provider occurrence remains unverified.

2. **H2 — P2, established:** [delegations.ts:294](/var/tmp/spideryarn-worktrees/qi-p78m9ch9-gpt-live-status/src/web/live/gpt-live/delegations.ts:294) discarded late completed usage after an earlier completion lacked totals. **Fixed:** recover usage without replaying tools or finals. Red tests: `reports late completed usage once after the response became %s`, covering final, waiting and continued states. Provider occurrence remains unverified.

3. **H3 — P2, established:** [live.ts:1322](/var/tmp/spideryarn-worktrees/qi-p78m9ch9-gpt-live-status/src/live.ts:1322) accepted an explicit `status: undefined`, contradicting “missing key only.” **Fixed.** Red test: `refuses a status that is not one a backend response ends on`. This distinction cannot occur in JSON requests.

4. **H4 — P3, established:** [live.ts:1711](/var/tmp/spideryarn-worktrees/qi-p78m9ch9-gpt-live-status/src/live.ts:1711) overstated cancellation and pricing guarantees; related comments and the doc sentence overstated coverage. **Fixed:** describe handled events with usable totals, session-close omissions, and pricing independent of status.

No additional status-mapping, schema or cost-fold defect found. The accepted conflicting-terminal policy and old-tab `ok / null` fallback remain.

Validation: **169 tests passed**, plus **21 client-import/doc-link checks**; typecheck, scoped lint and the cost-fold probe passed. Postgres-backed tests were not rerun. No commits made.

Files changed:

- `src/web/live/gpt-live/delegations.ts`
- `src/web/live/gpt-live/meter.ts`
- `src/live.ts`
- `tests/gpt-live-delegations.test.ts`
- `tests/realtime-usage.test.ts`
- `docs/project/live-conversation.md`
- `docs/plans/261006g-gpt-live-backend-report-carries-its-terminal-status.md`
- `docs/postmortems/261006j-deduplication-before-validation-can-discard-the-first-usable-report.md`

ship with the fixes