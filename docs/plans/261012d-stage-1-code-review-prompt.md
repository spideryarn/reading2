# Code review (write-capable): 261012d stage 1, chat mentions on the server

You are reviewing AND fixing. Repo root: the current directory, a git worktree. The stage is commit f64a446cc (`git show f64a446cc`, or `git diff 6991cb4af f64a446cc`). The plan it implements is docs/plans/261012d-chat-at-mention-your-own-articles.md (Design §2–§5, Stage 1; the client is stage 2 and not built yet). Your own plan review is docs/plans/261012d-chat-at-mention-plan-review-sol.md: check that each finding you raised there that falls in stage 1 is actually honoured.

Rules for fixes: fix what is inside this stage, narrowly; write a failing test first where it is a guard. Report, do not fix, anything wider. Do not run git commands that discard work (no stash, reset, checkout, restore, clean); do not commit — leave your fixes in the working tree. Read CLAUDE.md once.

Tests needing Postgres cannot run in your sandbox. Raw output of the stage's DB-backed tests, run by me at f64a446cc: docs/plans/261012d-stage-1-test-output.txt (66 passed). You can run `npm run typecheck` and pure unit tests (e.g. `npx vitest run tests/chat-mentions-prompt.test.ts` may or may not need a DB — try it).

The builder's own notes on where it departed from the plan:
1. The prompt rules for mentions (the widened fence rule, "the article" means the open one, mentioned ids citable) live in the mentions part of the first user message, not in SYSTEM, so a conversation without mentions sends byte-identical requests and the open article's cache survives.
2. The wire type is a union: unavailable = {available:false, title, reason}.
3. A deleted mention is deduped and counted by stored title; re-mentioning a held article takes no new place.
4. Another reader's slug and a nonexistent slug get the same refusal sentence.
5. "Grew past the cap" is tested by passing a lower cap to the resolver.
6. The send route reads each mentioned article once and hands it to the resolver.
7. No RLS or grants were added to the migration; it says new tables here carry none (docs/project/database.md says RLS is deferred and grants carry the weight — check that default privileges or an existing mechanism really cover a new table, and that nothing else (e.g. a test listing tables, the owner-deletion or account-deletion path, article transfer) needs to know about chat_mentions).

What I most want checked, in order:
- Ownership: can any path return or use another owner's slug, title, block ids or text (send, retry, edit, thread GET, the begin frame, the prompt)? Is the open article's thread really the reader's (scoping of chat_mentions reads by article_id)?
- Fence: is every author-written byte of a mentioned article (title included) inside untrusted(), and our own words outside? Does a no-mention conversation produce byte-identical messages to before (find the test)?
- Cache: is the second cache_control placed as the plan says; does the bp1 part stay byte-identical when mentions are added?
- Refusals: retry and edit refuse `mentions`; max 3 per question and per thread, enforced under the lock; the open article, minimal, importing and over-cap refused; draft-preserving 400s.
- Citation accounting: mentioned ids known, collisions logged as ambiguous.
- Export: snapshot + ZIP include mentions, rollback omits with reason.
- Account deletion / article transfer / article delete: any path that enumerates chat tables and now misses chat_mentions.
- evals/chat-mention-caching.ts: will it actually show bp1 and bp2 cache reads? (Do not run it; it makes paid calls.)

Severity: P0 (security hole or data loss), P1 (wrong behaviour a reader would hit, or code contradicts plan), P2 (should fix), P3 (nit). Give every finding an ID, severity, file:line evidence, and whether you FIXED it (with the test) or are REPORTING it. End with one line: APPROVE, APPROVE WITH FIXES APPLIED, or CHANGES NEEDED.
