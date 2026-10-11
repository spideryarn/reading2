Code review of commit 87e14f32b in this repo (a Spideryarn worktree): `git show 87e14f32b`. Read CLAUDE.md, then the plan docs/plans/261011p-learn-explore-out-of-the-experimental-switch.md and your own earlier plan review beside it (…-plan-review-sol.md).

The change takes Learn's Explore sub-mode out from behind the experimental-features switch, points Tutorial's prompt at Explore instead of Chat, and updates tests, generated files, /help and docs.

Check: correctness of the code and tests (would each changed test have gone red before the change?); anything still gating or describing Explore as experimental anywhere in src/, tests/, docs/project/, src/web/help/; generated files consistent (run WRITE-less: npx vitest run tests/command-pick-catalogue.test.ts tests/help-corpus.test.ts); the touched suites pass (tests/learn-header-cards.test.tsx tests/chat-commands.test.ts tests/command-bar-sub-modes.test.tsx tests/guide-kind.test.ts tests/tutorial-kind.test.ts tests/dock-experimental-modes.test.tsx tests/sub-mode-param-outlives-its-mode.test.tsx tests/doc-links.test.ts); docs accurate and not contradicting each other.

You may FIX what you find inside this change's scope, editing files in the working tree (do not commit, do not run git commands that change state). Report anything wider for me to decide. Do not touch the production database, .env.local, or deploy.

Output: findings ranked by severity, each with file:line, what you changed (if anything), then a final line: VERDICT: approve / approve with changes (made) / rework.
