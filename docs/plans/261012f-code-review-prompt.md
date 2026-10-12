You are reviewing, and fixing inside its scope, the code for plan docs/plans/261012f-guide-hands-content-questions-to-a-new-chat.md
in the Spideryarn repo (this checkout, a git worktree). Read the plan and its "GPT Sol's plan review" section first.

The change is commit 51d69afc4 (`git show 51d69afc4 --stat`, then `git show 51d69afc4`). Evidence: the eval results in
evals/guide/results/next-steps-261012f-{before,after,after2}.json and docs/investigations/261012a-guide-hands-off-to-chat-and-shorter-measured.md.

Check for real defects:
- src/next-steps.ts: the chat kind, the cap, at-most-one; does the order of checks drop a valid step wrongly (e.g. a duplicate counted toward three)?
- src/web/GuideNextSteps.tsx and src/web/ChatPanel.tsx: onChatNew is wired only for the guide; the press reaches ConversationModes' onSendNew,
  which mints a `chat` (band kind) thread. Any path where it appends to the guide, mints a guide, sends twice (double click), or sends while a
  turn is out? Is the draw order and the React keys stable? Does the legend/fieldset render accessibly?
- src/web/styles/chat-actions.css: cascade order against mode-band.css; any rule that bleeds into the greeting starters, Explore or Chat
  suggestions; light and dark themes (tokens in src/web/styles/tokens.css and styles/tokens.css); narrow widths (does a long question wrap?).
- src/converse.ts GUIDE_SYSTEM: contradictions with the rest of the prompt (e.g. "ask one question at a time, put it last" against "no
  question after" a content answer), or instructions now stale elsewhere in the prompt or in src/chat-tools.ts descriptions.
- Tests: do the new tests actually fail without the change? Anything important untested?
- Docs: are the docs/project/chat-tools.md and security-map.md lines accurate?

Fix what you find within this scope (edit files directly; keep the house style: comments explain why, cite plans). Do not commit.
Do not touch .env.local, infra/, or the production database. Run `npm run typecheck` and the touched test files with
`npx vitest run <files>` (not the full suite). Then write your findings: numbered F1.., each with severity, evidence (file:line), and
what you changed or why not. End with one line: LAND, LAND WITH FIXES, or DO NOT LAND.
