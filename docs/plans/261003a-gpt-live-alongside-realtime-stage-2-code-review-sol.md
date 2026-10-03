**Wire contract unchanged:** `GptLiveTicket`, `GptLiveUsage`, and `/spoken`’s `engine`. Changes are uncommitted in the tree; browser files were untouched.

| ID | Severity | Location | Finding | Fixed / test seen red |
|---|---|---|---|---|
| C1 | P1 | `src/live-gpt.ts:71` | Character ratios underestimated punctuation-heavy instructions and history. Replaced with UTF-8 byte bounds, including seed framing. | **Yes.** Both “bounds punctuation-heavy…” tests in `live-gpt-server.test.ts`. |
| C2 | P1 | `src/live-gpt.ts:332` | Article and outline text lacked an explicit source fence. Added the shared fence and rules against following source instructions. | **Yes.** “frames article and outline injection…” |
| C3 | P1 | `src/db/schema.ts:3231`; migration line 6 | The CHECK admitted zero/negative seconds on non-voice rows. Corrected schema, migration, and snapshot. | **Yes.** Both SQL-expression tests failed on `null/-1`. |
| C4 | P1 | `src/routes.ts:4023` | Lost responses and malformed successful creates became `create_failed`, losing billing provenance. Confirmed successful creates now receive the 15-second charge; uncertain outcomes remain distinct. | **Yes.** Three creation-outcome tests in `live-gpt-server-routes.test.ts`. |
| C5 | P1 | `src/routes.ts:4069` | Failed accounting erased evidence of an already-created provider session. Added one transaction retry, then a fallback identity/reconciliation record; ticket stays withheld on failure. | **Yes.** “retries the charge transaction…” and “preserves a created provider id…” |
| C6 | P1 | `src/pricing.ts:806` | Unknown cached rates inflated computed spend; `npm run cost` did not expose the specific upper-bound substitution. Cached responses now remain explicitly unpriced, with counts retained. | **Yes.** “keeps cached responses unpriced…” |
| C7 | P2 | `src/live.ts:246` | “Answer in the first sentence” contradicted the required tool preamble. Qualified it in both voice prompts. | **Yes.** “fills the wait before a slow tool…” |
| C8 | P2 | `src/routes.ts:4003` | Journal model is requested, not provider-confirmed. The supplied create trace returns only an id. | **No.** Provenance limitation; no failing behavior demonstrated. |
| C9 | P2 | `tests/no-undeclared-spend.test.ts:637` | Broader spend scan flags `OPENAI_API_KEY` in concurrent browser work, `src/web/live/session-shared.ts`. | **No—outside scope.** “finds every file that can reach a paid provider” failed. |

The meter’s lock, monotonic delta, range-based identity, rollback, cross-engine refusal, and deadline handling look sound. The additive migration preserves existing rows. The allowlist matches the supplied trace and planned browser loop.

Changed files:

- Server: `src/live.ts`, `src/live-gpt.ts`, `src/routes.ts`, `src/pricing.ts`, `src/db/schema.ts`, `src/store/contracts.ts`, `src/store/realtime-sessions-pg.ts`.
- Migration: `drizzle/20261003105818_gpt_live_sessions_and_usage.sql` and its snapshot.
- Tests: `live.test.ts`, `live-gpt-server.test.ts`, new `live-gpt-server-routes.test.ts`, `realtime-usage.test.ts`, `live-session-routes.test.ts`, `store-realtime-sessions.test.ts`.

**Verified:** 130 server tests pass; typechecking and migration-chain checks pass. Lint reports only existing complexity advisories. Typechecking used `node --import tsx scripts/typecheck.ts` because the npm wrapper’s IPC socket was sandbox-blocked.

Please run, with Postgres available:

```sh
npx vitest run tests/store-realtime-sessions.test.ts tests/live-session-routes.test.ts tests/store-ai-calls.test.ts tests/ai-calls-spend-pg.test.ts tests/chat-spoken-route.test.ts
```

These verify concurrent accounting, rollback, actual constraints, fallback provider-id persistence, ledger mappings, ownership, and spoken engine attribution. Then run the full gate after browser work settles. `docs/project/live-conversation.md:207` also needs its cached-as-fresh description updated by the documentation owner.

**Verdict: conditional pass for the server half.** No remaining confirmed in-scope P1. Postgres validation remains outstanding. If accounting retries and the fallback journal write all fail, only the structured log retains reconciliation evidence. Provider rates still need independent verification.

