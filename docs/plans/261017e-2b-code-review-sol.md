## Findings

F1 — P1 — Refused addresses consumed the guide’s sole page read.  
Evidence: the red test showed an unsupported `file:` URL caused the following loopback URL to return `limit reached`, despite no HTTP request occurring. The budget callback was outside `fetchDocument`, before its URL, scheme, DNS, and private-address refusals.  
Fixed: the fetch layer now gates immediately before its first HTTP request, once across retries and redirects; sequential excess calls stop before DNS, and concurrent calls cannot both pass. Added refusal, concurrency, transport-failure, retry, and redirect tests in [chat-tools.test.ts](/var/tmp/spideryarn-worktrees/qi-qsy8nqyt-guide-reads-pages/tests/chat-tools.test.ts:435) and [fetch.test.ts](/var/tmp/spideryarn-worktrees/qi-qsy8nqyt-guide-reads-pages/tests/fetch.test.ts:226). The root-cause write-up is [261018d-entering-a-fetch-abstraction-is-not-dispatching-a-request.md](/var/tmp/spideryarn-worktrees/qi-qsy8nqyt-guide-reads-pages/docs/postmortems/261018d-entering-a-fetch-abstraction-is-not-dispatching-a-request.md).

F2 — P2 — The web-reach eval’s new fields did not fully measure their claims.  
Evidence: it recorded only the tool’s host label rather than the requested address, and counted any `read_web_page` invocation as a successful page read, including refusals and failures.  
Fixed: [chat-web-reach.ts](/var/tmp/spideryarn-worktrees/qi-qsy8nqyt-guide-reads-pages/evals/chat-web-reach.ts:321) now records the exact requested URL, whether fetched content reached the model, model rounds, all model calls, steps, tokens, and per-turn spend. The nested `collectSpend` is valid: its explicit sink preserves ledger writes while exposing the per-turn report.

F3 — P2 — Documentation and reader-facing wording contradicted the implementation.  
Evidence: the tool docs still said a guide asking for `read_web_page` was refused and described Live’s first gate as the refusal; the Live doc named the typed gate; the prompt/help wording said “once an answer” / “one web page an answer.”  
Fixed: the docs now distinguish typed and spoken guide tools in [chat-tools.md](/var/tmp/spideryarn-worktrees/qi-qsy8nqyt-guide-reads-pages/docs/project/chat-tools.md:121) and [live-conversation.md](/var/tmp/spideryarn-worktrees/qi-qsy8nqyt-guide-reads-pages/docs/project/live-conversation.md:644). The prompt is plain and keeps subject-level work in Chat in [converse.ts](/var/tmp/spideryarn-worktrees/qi-qsy8nqyt-guide-reads-pages/src/converse.ts:1926); Help and its generated corpus were corrected.

I found no remaining bypass through `runTool` callers or `ToolContext` construction: typed conversation calls reuse one context per turn, while Live sets `spoken: true` and gates against `spokenToolsFor`. Nothing under `src/web/` assumes a typed guide cannot read pages.

Verification:

- Focused unit suite: 276 passed, 1 skipped.
- Final affected tests after the last fix: 116 passed.
- Help corpus: 7 passed.
- Documentation links: 18 passed.
- Typecheck equivalent passed for all 3,825 covered files. The literal `npm run typecheck` wrapper could not create its `tsx` IPC pipe under the sandbox, so `node --import tsx scripts/typecheck.ts` was used.
- `git diff --check` passed; lint has no new errors.
- `chat-live-ticket-route.test.ts` could not start because local Postgres was unavailable and the sandbox denied Docker inspection (`EPERM 127.0.0.1:54362`).

VERDICT: ship after the fixes made here