**F8 — P2 — fixed by me.** Chat put the concrete count and read date inside the article’s untrusted fence, contrary to the plan. A new test reproduced this. [The fix](/home/greg/code/spideryarn2/.claude/worktrees/q-crossref-count/src/chat-tools.ts:1707) prints validated count/source/day outside the fence, tied to numbered rows. Filtering, caps and the character budget remain aligned. Recorded the root cause in a postmortem.

**F9 — P2 — reported; outside scope.** [An existing chat test](/home/greg/code/spideryarn2/.claude/worktrees/q-crossref-count/tests/chat-tools.test.ts:765) stubs `fetch` but still performs real DNS resolution. It fails in this sandbox before reaching the stub. Reproduced separately; left unchanged.

The six statements check out, with one qualification:

| Statement | Result |
|---|---|
| 1. Confirmed Crossref counts only, across all surfaces | Yes |
| 2. Refresh until success, never afterwards | The **extra pre-feature refresh** stops; ordinary 180-day expiry still applies |
| 3. Other stored answers clear count and read moment | Yes |
| 4. Migration adds only two nullable columns and two compatible CHECKs | Yes, by SQL and snapshot inspection |
| 5. Threshold, priorities, orders and effective influence unchanged | Yes |
| 6. Non-encoded DOI inputs retain previous behavior | Yes; an 8,400-case comparison found no differences |

On the remaining suspicions: missing columns produce `unavailable: store`, causing callers to lose registry enrichment without failing the whole pipeline. No finer-grained `fetched_at` consumer was found. The accepted F4 outage behavior remains. A string accepted by `Date.parse` does not introduce the suspected `toISOString` exception. Rejecting decoded `<`/`>` follows the existing DOI validation contract.

Validation: **505 tests passed across 13 focused suites**, including all five requested suites. Typecheck, touched-file lint and documentation checks passed. The broader unit attempt was stopped after sandbox subprocess/network failures; no full-suite pass is claimed. Postgres and browser checks were not run.

Changes are uncommitted; `drizzle/` is untouched. No established P0 or P1 remains unfixed.

**land after fixes (F8)**