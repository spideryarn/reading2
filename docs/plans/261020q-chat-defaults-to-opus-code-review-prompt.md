Code review of plan docs/plans/261020q-chat-defaults-to-opus.md (Greg: "Default to Opus 5.5 for Chats"). The plan was reviewed by you earlier (APPROVE WITH CHANGES; F1–F3 are now applied). The uncommitted diff in this worktree (`git diff HEAD`, also saved at /tmp/claude-1000/-home-greg-code-spideryarn2/5c11caaa-612c-4477-abab-d10e4c5c3e85/scratchpad/code.diff, plus the new untracked plan file) is the whole change.

Review the code for correctness and completeness. You may edit files in this worktree to fix what you find inside this change's scope (do not commit, do not touch git state, .env.local, or the database). In particular:
- Is there any test, anywhere in tests/, that asserts a standard-power chat turn is on Sonnet, sends no effort, or has the 4,000 ceiling, that this change now breaks? Run `npx vitest run` on any test file that mentions converse, chat, defaultModel, ALWAYS_HIGH_POWER, powerFor, high-power or /api/models (e.g. tests/models.test.ts, tests/high-power-*.test.ts, tests/authenticated-api-route-contract.test.ts, tests/guide-kind.test.ts, tests/tutorial-kind.test.ts, tests/explore-kind.test.ts, tests/chat-*.test.ts) and report results.
- Does /profile (GET /api/models, modelsInUse in src/routes.ts) now report chat as Opus, and is any client/test text expecting otherwise?
- Any doc under docs/project/ that now states chat follows the High-powered AI switch (grep for it), or help page sources under the repo that do — fix the wording to match.
- Run `npm run typecheck`.

Write numbered findings (severity, file:line, and whether you fixed it), then a final line: VERDICT: SHIP, SHIP WITH FIXES APPLIED, or DO NOT SHIP.
