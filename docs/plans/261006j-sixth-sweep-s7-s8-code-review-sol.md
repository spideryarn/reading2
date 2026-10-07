S7: **ship with these fixes (applied)**  
S8: **ship with these fixes (applied)**

- **C1 — P2 — [scripts/deploy-checks.ts:1050](/var/tmp/spideryarn-worktrees/agent-a1fc72453aa7f7baa/scripts/deploy-checks.ts:1050), reproduced and fixed.** Converting the real robots file to CRLF produced 22 errors: comments between groups became “unexpected lines.” The borrowed parser’s `/#.*$/` cannot consume the retained carriage return, so comment stripping fails. `judgeServedRobots` now normalizes CRLF and lone CR before judging. **Fixed:** `scripts/deploy-checks.ts`, `tests/deploy-checks.test.ts`; the new regression test failed first. The standalone checker remains affected outside the permitted edit scope—**reported**.

- **C2 — P2 — [tools/fleet/web/src/ReadinessPanel.tsx:404](/var/tmp/spideryarn-worktrees/agent-a1fc72453aa7f7baa/tools/fleet/web/src/ReadinessPanel.tsx:404), reproduced and fixed.** Splitting the effects removed Refresh’s invalidation of pending polls. A newer refreshed “dev is not green” answer could be overwritten by an older poll saying “dev is green.” Refresh immediately before a timer tick also caused adjacent requests. Adding `refreshNonce` to the timer effect restores the previous cadence and invalidates pending polls. **Fixed:** `ReadinessPanel.tsx`, `tests/fleet-readiness-poll.test.tsx`; both reproductions failed first.

The remaining S7 checks support shipping:

- The real disk file passes. Expected `text/plain; charset=utf-8`, uppercase MIME spelling, BOM, and trailing-newline variations pass. MIME matching is case-insensitive substring matching.
- Redirects and 304 still fail, as before. The request follows no redirects and sends no conditional validators, so a normal response should supply 200 with the body.
- Missing restrictions, comments-only restrictions, and the Twitterbot-only reproduction fail. Every accepted file requires actual group restrictions, preserving what the old check caught.
- `--verify-only --host` checks the same shipped static file, including its production sitemap address. I found no documented alternative host policy.
- The new import graph has no network, database, environment-loading, or heavy initialization side effect. Its CLI entry point is guarded.
- The page test’s filename assertion is indirect, but its intent remains honored: deploy borrows the pure judge without running the checker’s requests or header checks. The reader-facing page underclaims the verification; its statement remains true.
- The postmortem amendment explicitly says “Built on 2026-10-06” and preserves the original incident and introducing commit. It is a dated follow-up.

S8’s two effects are justified. Timer cleanup, interval changes, alternating successful intervals, failed-fetch recovery, and the existing clamp/fallback work. Both effects suppress updates after cleanup. I independently tried the single-effect interval dependency: **six of the original seven tests failed**, including **51 requests** in the alternating-answer case. No materially smaller equivalent fix emerged. Removing the server interval would remove supported configuration and needs a product decision.

Validation: **446 focused tests passed**, all **11 polling tests passed**, typecheck passed, and the offline checker self-test passed **124/124**. Lint reported one existing complexity note. Broader subprocess tests hit sandbox `EPERM` failures.

The builder record has a dated review follow-up. Changes remain uncommitted; no network, database, or deployment work ran.