## Findings

- **E1 — P0, established — allowance concurrency is ineffective for slow checks.** The shared lease is 170 seconds, while a check may run 720 seconds. Because only unexpired leases count, two more checks can start every 170 seconds across different articles: up to **10 simultaneous checks** despite `concurrency: 2`. Hourly/daily caps still apply. [dig-deeper.ts:117](/var/tmp/spideryarn-worktrees/fbcaue42-debate-pick-claims/src/dig-deeper.ts:117), [pg-rate-limit.ts:164](/var/tmp/spideryarn-worktrees/fbcaue42-debate-pick-claims/src/store/pg-rate-limit.ts:164), [routes.ts:5925](/var/tmp/spideryarn-worktrees/fbcaue42-debate-pick-claims/src/routes.ts:5925). Not changed: this is a security-map allowance defence and needs Greg’s decision.

- **E2 — P0, reasoned, wider than stage 3 — one allowance fill can dispatch up to three paid searches.** `generateClaimCheck` uses `openRouterJson` with its automatic three-attempt transport retry. If OpenRouter accepted a request but the connection failed before headers reached this process, the identical request may be submitted again without an idempotency key. [debate.ts:1660](/var/tmp/spideryarn-worktrees/fbcaue42-debate-pick-claims/src/debate.ts:1660), [ai-call.ts:2092](/var/tmp/spideryarn-worktrees/fbcaue42-debate-pick-claims/src/ai-call.ts:2092), [transport-retry.ts:18](/var/tmp/spideryarn-worktrees/fbcaue42-debate-pick-claims/src/transport-retry.ts:18). Not changed because it is gateway-wide, not stage 3.

- **E3 — P1, established — a broken answer stream enabled a second paid press.** The client cleared `sending` and returned failure before its recovery GET completed, leaving the same picks pressable even when the first answer was already stored. Fixed: an accepted POST now remains held and performs free GETs until its newly created matching row is terminal; it never automatically POSTs again. [useDebateChecks.ts:96](/var/tmp/spideryarn-worktrees/fbcaue42-debate-pick-claims/src/web/useDebateChecks.ts:96), [useDebateChecks.ts:185](/var/tmp/spideryarn-worktrees/fbcaue42-debate-pick-claims/src/web/useDebateChecks.ts:185), [use-debate-checks.test.tsx:103](/var/tmp/spideryarn-worktrees/fbcaue42-debate-pick-claims/tests/use-debate-checks.test.tsx:103).

- **E4 — P1, established — alternate-address copies counted as outside evidence.** Claim checks reused shared row validation but omitted the direct reader’s `sourceIsCopy` refusal. Fixed with one shared copy predicate used by direct Debate and reader-picked checks. [debate.ts:890](/var/tmp/spideryarn-worktrees/fbcaue42-debate-pick-claims/src/debate.ts:890), [debate.ts:2159](/var/tmp/spideryarn-worktrees/fbcaue42-debate-pick-claims/src/debate.ts:2159), [debate-claim-check-reader.test.ts:215](/var/tmp/spideryarn-worktrees/fbcaue42-debate-pick-claims/tests/debate-claim-check-reader.test.ts:215).

- **E5 — P1, established — replacing a list can hide a paid result permanently.** Same-input list generation retains `sourceHash` but mints new random claim IDs. A completed check therefore passes `checksUnder` but matches no claim on the replacement list. A changed article hash hides the whole old check. [debate-claims.ts:229](/var/tmp/spideryarn-worktrees/fbcaue42-debate-pick-claims/src/debate-claims.ts:229), [debate-checks.ts:31](/var/tmp/spideryarn-worktrees/fbcaue42-debate-pick-claims/src/web/debate-checks.ts:31), [DebatePanel.tsx:2429](/var/tmp/spideryarn-worktrees/fbcaue42-debate-pick-claims/src/web/DebatePanel.tsx:2429). Not changed because the fix requires a stage-2/list-identity decision.

- **E6 — P1, established conditional race — a live check can be swept before its deadline.** The 750-second orphan clock starts when the reservation is inserted, but the 720-second model deadline starts only after allowance admission. More than 30 seconds in admission/setup lets another process sweep a legitimately live check; its paid result then loses the attempt-fenced finish, and another check may start. [routes.ts:5952](/var/tmp/spideryarn-worktrees/fbcaue42-debate-pick-claims/src/routes.ts:5952), [pg-debate-claim-checks.ts:40](/var/tmp/spideryarn-worktrees/fbcaue42-debate-pick-claims/src/store/pg-debate-claim-checks.ts:40), [pg-debate-claim-checks.ts:180](/var/tmp/spideryarn-worktrees/fbcaue42-debate-pick-claims/src/store/pg-debate-claim-checks.ts:180). Not changed because it alters the sweep/allowance defence.

- **E7 — P1, established conditional failure — a successful paid answer is discarded if `finish` fails.** The route logs the store error, closes the stream, and leaves only a pending row that is later swept to a generic error. [routes.ts:5981](/var/tmp/spideryarn-worktrees/fbcaue42-debate-pick-claims/src/routes.ts:5981). Not changed: a correct fix needs a durable retry/recovery design, not a blind second write.

- **E8 — P1, reasoned — Dig further can use a stale “already found” snapshot.** It reads addresses before acquiring the reservation. Another request can finish between that read and this request’s reservation, so this search is not told about the newly stored addresses. [routes.ts:5856](/var/tmp/spideryarn-worktrees/fbcaue42-debate-pick-claims/src/routes.ts:5856), [routes.ts:5949](/var/tmp/spideryarn-worktrees/fbcaue42-debate-pick-claims/src/routes.ts:5949). Not changed; this needs a store-backed barrier test and route-ordering decision.

- **E9 — P1, established — an idle tab never discovered another tab’s check.** Polling only began after the local tab already knew about a pending row. Fixed by free refreshes on focus/visibility, followed by existing pending polling. [useDebateChecks.ts:160](/var/tmp/spideryarn-worktrees/fbcaue42-debate-pick-claims/src/web/useDebateChecks.ts:160), [use-debate-checks.test.tsx:86](/var/tmp/spideryarn-worktrees/fbcaue42-debate-pick-claims/tests/use-debate-checks.test.tsx:86).

- **E10 — P1, established — a free history read was presented as a paid search.** Loading or failed GET states showed “Searching the web…” and the spinner. Fixed by separating “controls held” from “search running.” [DebatePanel.tsx:2434](/var/tmp/spideryarn-worktrees/fbcaue42-debate-pick-claims/src/web/DebatePanel.tsx:2434), [debate-claim-checks-panel.test.tsx:242](/var/tmp/spideryarn-worktrees/fbcaue42-debate-pick-claims/tests/debate-claim-checks-panel.test.tsx:242).

- **E11 — P2, reasoned — overlapping free refreshes are not ordered.** Focus, manual retry, and pending polling can issue concurrent GETs; an older pending snapshot can overwrite a newer done snapshot until another refresh. [useDebateChecks.ts:126](/var/tmp/spideryarn-worktrees/fbcaue42-debate-pick-claims/src/web/useDebateChecks.ts:126), [useDebateChecks.ts:160](/var/tmp/spideryarn-worktrees/fbcaue42-debate-pick-claims/src/web/useDebateChecks.ts:160). Not changed because it does not cause spend and is subordinate to the unresolved P0/P1 issues.

Verified correct: free refusals precede reservation, allowance and model; the partial unique index serializes simultaneous presses; normal UI GET/polling eventually sweeps abandoned reservations; typed words are fenced and absent from logs, URLs, errors and public payloads; grouping and stored-anchor rules hold; both routes are owner-only; public reading exposes no checks; result rows deduplicate by address. Dig deeper’s original refusal sentences were not changed. The merge retained both `debate_claim_checks` and `referee_hidden_checks`; the migration is additive, with no loss or duplication found.

## Files edited

- [src/debate.ts](/var/tmp/spideryarn-worktrees/fbcaue42-debate-pick-claims/src/debate.ts)
- [src/web/useDebateChecks.ts](/var/tmp/spideryarn-worktrees/fbcaue42-debate-pick-claims/src/web/useDebateChecks.ts)
- [src/web/DebatePanel.tsx](/var/tmp/spideryarn-worktrees/fbcaue42-debate-pick-claims/src/web/DebatePanel.tsx)
- [tests/debate-claim-check-reader.test.ts](/var/tmp/spideryarn-worktrees/fbcaue42-debate-pick-claims/tests/debate-claim-check-reader.test.ts)
- [tests/debate-claim-checks-panel.test.tsx](/var/tmp/spideryarn-worktrees/fbcaue42-debate-pick-claims/tests/debate-claim-checks-panel.test.tsx)
- [tests/use-debate-checks.test.tsx](/var/tmp/spideryarn-worktrees/fbcaue42-debate-pick-claims/tests/use-debate-checks.test.tsx)

No commit made. The two pre-existing untracked review documents were untouched.

## Checks

- Reader regression: red 1/15, then green 15/15.
- Panel regression: red 1/12, then green 12/12.
- Hook regressions: red 2/2, then green 2/2.
- Five relevant unit files together: **114/114 passed**.
- `node --import tsx scripts/typecheck.ts`: passed all four projects; all 3,540 source files covered.
- Scoped Biome lint: exit 0; only existing advisory diagnostics outside the new hook remained.
- `git diff --check`: passed.
- Route test and `npm test`: could not run because sandbox access to Postgres at `127.0.0.1:54362` failed with `EPERM`; the harness correctly refused to report a skipped green run.
- `npm run typecheck` itself hit the sandbox’s `tsx` IPC `EPERM`; running the same script through Node completed successfully.

**Verdict: do not land.**