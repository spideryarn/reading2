# GPT Sol code review — 261009i

You are reviewing, and fixing, the code built from
`docs/plans/261009i-ask-in-chat-replaces-dig-deeper-and-a-chat-goes-back-to-its-item.md` in this
worktree. Read the plan (including "Revised after GPT Sol's plan review" and "What landed"), your own
plan review `docs/plans/261009i-plan-review-sol.md`, and `docs/project/chat-from-a-mode.md`.

The diff is `git diff 4da94b0e6..HEAD` (two commits: e1adfed3a stage 1, afbe657ab stages 3 and 2).
Read it in full.

Look hardest at:

1. **Stage 1:** a surface that still offers Dig deeper to an owner, a kept answer that no longer
   shows (Glossary `entry.lookup`, Citations `work.investigation`, web influence), a visitor who now
   sees an owner control, and a hover card's Ask in chat that sends with the wrong origin or does not
   close the card. Also Skim's chip.
2. **Stage 3:** the silent steps in chat-from-a-mode.md (`ORIGIN_MODES`, `originFromColumns`, the
   CHECKs, `chatSummaries` vs `chats` in Reader), the migration
   `drizzle/20261009085926_chat_thread_origin_ideas.sql` (it must be safe on production, where rows
   with every existing origin exist), the fence in `askAboutIdea`, and `parseItemOrigin` for `ideas`.
3. **Stage 2:** whether `openOrigin` actually lands on the item in every arm (a mode already mounted,
   a gate, bar or filter that hides the row, StrictMode double effects, a focus consumed before the
   list is ready, a stale focus re-firing on a later visit), Back being one press, the pending-origin
   case, and the line's layout at 390px (it must not push the composer off screen or wrap badly).
   `src/web/item-focus.ts` is new: is it the right single mechanism, or a near-copy of Citations'
   effect that should be shared?
4. Tests that pass without testing the thing (a check you have never seen fail is not evidence).

**Fix what you find** inside these files and their tests, keeping to the code's conventions (read
CLAUDE.md's "Writing code"). Do not commit. Do not touch the production database, `.env.local`, or
anything under `infra/`. Do not apply migrations. Run `npm run typecheck` and the test files you
touch (`npx vitest run <files>`). Do not run the full suite.

Write your findings to the answer file, numbered F1…, each with severity, evidence (file:line), and
what you changed (or, for anything wider than this plan, what you recommend). End with a one-line
verdict: "ship", "ship after my fixes", or "do not ship".
