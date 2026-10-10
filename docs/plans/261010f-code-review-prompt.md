You are reviewing code before it is pushed, in the current directory (Spideryarn). You may edit files to fix
what you find inside this change; report anything wider for the author to decide. Do not commit, do not
run git commands that change history or the index, do not touch .env*, infra/ or any database.

The plan, including what the plan review changed and what landed:
docs/plans/261010f-a-stale-referee-criterion-overflow-and-the-calls-one-notch-from-it.md
Your own plan review: docs/plans/261010f-plan-review-sol.md

The change is the uncommitted diff in this worktree: `git diff HEAD` plus the new file
tests/json-wire-thinking-ceiling-log.test.ts. Files: src/search.ts, src/routes.ts, src/ai-call.ts,
src/pdf-frontmatter.ts, tests/search-stream.test.ts, tests/chat-reasoning.test.ts,
tests/pdf-frontmatter.test.ts, tests/json-wire-thinking-ceiling-log.test.ts.

Check in particular:
1. Search: module-load ordering of SEARCH_ANSWER_ROOM / SEARCH_MAX_TOKENS / SEARCH_TIMEOUT_MS (TDZ),
   routes.ts's SEARCH_ORPHAN_GRACE_MS derivation and its assertion, and anything else in src/ or tests/ that
   assumed a 60 s search deadline, a 90 s grace or a 4,000 search ceiling (comments included — correct stale ones).
   Does the `medium` effort reach the wire on the search route (require_parameters)? Does quick-search or any
   other caller share the `search` job name and so change behaviour unintentionally?
2. ai-call.ts: the warning in openRouterJson — correct placement after meterBody, the chat-wire guard, that it
   cannot throw or change the return, that it does not log response text, and that the streamed call site
   still behaves the same.
3. pdf-frontmatter: the budget, and that no fingerprint/cache key needed to change.
4. The tests: would any of them pass against a broken implementation? Run them:
   npx vitest run tests/search-stream.test.ts tests/chat-reasoning.test.ts tests/pdf-frontmatter.test.ts tests/json-wire-thinking-ceiling-log.test.ts tests/store-wiring.test.ts
   and npm run typecheck.
5. Docs: does any doc under docs/project/ (search.md, ai-gateway.md, referee-mode.md, logging.md) state the
   old search deadline, the old ceiling, search's provider-default effort, or that the warning is stream-only?
   Fix those sentences.

Answer with numbered findings (P1/P2/P3, file:line, what you changed or what the author should decide), then a
list of files you edited, then a one-line verdict: ship / ship with the fixes made / do not ship.
