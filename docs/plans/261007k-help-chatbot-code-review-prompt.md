# Code review: 261007k, Ask about Spideryarn (a chatbot on the Help pages)

You are reviewing, and fixing, the code built from plan `docs/plans/261007k-help-chatbot.md` in this
worktree. Read the plan first ("After the plan review" overrides the design) and your own earlier
plan review, `docs/plans/261007k-help-chatbot-plan-review-sol.md`, then the investigation
`docs/investigations/261007a-help-chat-model-and-refusals.md`.

The scoped diff: `git diff 0f34ed61a..HEAD -- . ':(exclude)evals/help-chat/results'` (three stage
commits: server, client, eval). The key files: `src/help-chat.ts`, `src/help-chat-call.ts`,
`src/help-corpus.generated.json` and `tests/help-corpus.test.ts` (its generator), the
`streamHelpAnswer` route and its `AUTH_ROUTES` row in `src/routes.ts`, the registrations in
`src/models.ts`, `src/ai-call.ts`, `src/cost-categories.ts`, `src/store/contracts.ts`,
`src/db/schema.ts` and `drizzle/20261007120915_help_chat_bucket.sql`, the client
`src/web/help/HelpAsk.tsx`, `src/web/help/help-answer-links.ts`, the `ownLink` seam in
`src/web/Cited.tsx`, `src/web/help/HelpPage.tsx`, and the privacy page.

Known and not yours: the migration has not been applied to the shared local database (a peer's
unlanded migration blocks it; I will restamp ours after theirs lands), so the browser has not yet
seen a real answer. Do not touch `drizzle/`.

Decisions that are mine, not the user's (Greg's words are only those quoted in the plan): signed in
only for v1; single-turn; Luna; the allowance numbers; not storing questions.

Look for: correctness bugs (the stream's endings, the allowance being freed on every path, a
refusal decided after stream headers are written, the reader leaving); security (anything that
lets the answer render a non-Help link or HTML, anything that edits a defence listed in
docs/project/security-map.md § Where the defences physically live, a way to make it a general LLM
beyond what the investigation tested); the Cited seam changing behaviour for existing callers;
tests that could not fail; anything that logs the question or the answer.

You may write. Fix what is inside this work, narrowly, each finding red-first with the test that
reproduces it. Report — do not fix — anything wider. You can run single test files with
`npx vitest run tests/<file>` (not `npm test`); tests needing Postgres will skip in the sandbox,
so say which you could not run rather than counting them as passing.

Write findings numbered F1… with severity, evidence (file:line), and what you did. End with
`VERDICT: ship | ship after fixes | do not ship`.
