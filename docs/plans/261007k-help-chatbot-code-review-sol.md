Fixed four findings; no unresolved scoped defects remain.

F1 — High — Help state crossed account boundaries. A direct reader switch retained the previous reader’s question/answer and could leave their paid request running. [HelpPage.tsx](/var/tmp/spideryarn-worktrees/fbucftjt-help-chatbot/src/web/help/HelpPage.tsx:175) now keys all Help state by reader; unmount cleanup aborts active requests. Red-first coverage: [help-page.test.tsx](/var/tmp/spideryarn-worktrees/fbucftjt-help-chatbot/tests/help-page.test.tsx:366) and [help-ask.test.tsx](/var/tmp/spideryarn-worktrees/fbucftjt-help-chatbot/tests/help-ask.test.tsx:166).

F2 — Medium — The evaluated Help model was aliased to the generic quick model, so changing that tier would silently move Help away from Luna. [models.ts](/var/tmp/spideryarn-worktrees/fbucftjt-help-chatbot/src/models.ts:533) now pins `openai/gpt-5.6-luna` literally, enforced by Help and privacy tests.

F3 — Medium — The “whole Help” test checked only page addresses; every page body could disappear while it remained green. [help-chat.test.ts](/var/tmp/spideryarn-worktrees/fbucftjt-help-chatbot/tests/help-chat.test.ts:61) now checks each body inside its corresponding prompt section. Mutation-proved by removing `page.body` and observing the test fail.

F4 — Low — Signing in from a FAQ discarded its fragment and returned to the questions page rather than the original question. [HelpAsk.tsx](/var/tmp/spideryarn-worktrees/fbucftjt-help-chatbot/src/web/help/HelpAsk.tsx:201) now preserves pathname, query and hash. Red-first coverage is at [help-ask.test.tsx](/var/tmp/spideryarn-worktrees/fbucftjt-help-chatbot/tests/help-ask.test.tsx:98).

I also added coverage for provider finish reasons, unterminated streams, provider refusal before the first word, safe error output, allowance release, and browser-request cancellation. The Help documentation’s stale global fuse was corrected from 1,500 to 1,300.

Security review found no remaining issue: rendered links use the exact Help-address allowlist, raw HTML remains text, existing `Cited` callers retain their old behavior, admission happens before SSE headers, and logs contain only lengths/metadata—not questions or answers.

Checks:

- Targeted regression suite: 11 files passed, 721 tests passed, one unrelated skip.
- Final affected-file rerun: 143/143 passed.
- Typecheck: all 3,433 source files covered and passed.
- Scoped lint and `git diff --check`: passed.
- PostgreSQL allowance test: not run; sandbox denied connection to `127.0.0.1:54362`. Not counted as passing.
- No `drizzle/` files touched.
- Commit was blocked because the sandbox makes the shared Git worktree index read-only; fixes remain in the worktree.

VERDICT: ship