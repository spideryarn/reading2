You are reviewing CODE in this repository, write-capable: fix what you find inside this stage, and report anything wider for me to decide. Read CLAUDE.md first for house rules. Do not commit, push, deploy, or touch any database other than the test databases the suite mints itself.

The plan: docs/plans/261030b-sources-digest-a-prose-digest-of-what-it-cites-and-who-cites-it.md (§ The ask box, under the digest and under Summary; § Stages → Stage 3). Earlier reviews: docs/plans/261030b-stage1-code-review-sol.md, docs/plans/261030b-stage2-code-review-sol.md.
The diff under review: `git diff 8df753813 ca3f258b2` — two commits: a9386ceae (3a: two chat origins `sources-digest` and `summary`, migration drizzle/20261030220450_chat_thread_origin_sources_digest_and_summary.sql, the first-message builder askAboutModelText in src/web/chat-handoff.ts, the shared AskBox lifted from Investigate) and ca3f258b2 (3b: the box under the digest and under Summary Brief/Fuller, each digest paragraph's Ask in chat, senders in Reader.tsx, the way back landing on a paragraph). The house checklist for a new origin is docs/project/chat-from-a-mode.md § Adding it to another mode. A Sonnet browser pass runs at the same time; it does not edit code.

Review independently for:
1. Every step of the chat-from-a-mode checklist for both origins: union, ORIGIN_MODES, sameOrigin, columns round trip, the route's parse (parseShapedItemOrigin), the DB CHECKs (does the migration accept every id the client can build, refuse malformed ones, and can it fail on existing production rows?), title, originPlace/originBack, openOrigin, CHAT_FROM_WORDS.
2. The first message: always within MAX_CHAT_QUESTION_CHARS including everything; fences cannot be broken by model or reader text; the chat model is told the fenced text is quoted, not instructions; grapheme-safe cut. What happens on the server if it is over (413) and does the reader see it?
3. One chat per item and the box→mark→Continue path: can a double press, StrictMode, or a slow chat list create two chats for one item? Is the reader's typed text lost anywhere it shouldn't be?
4. Owner-only and view-as: no box, no paragraph button, no send in view-as or for visitors; no new route reachable by a visitor.
5. Investigate's behaviour unchanged after the AskBox lift (markup, IME guard, Enter, max length, touch target).
6. Item ids: paragraph numbering stable for a stored digest; ids built from generatedAt match the CHECK regex for every generatedAt format the server writes.
7. Anything else false, fragile, or simpler; docs claims in chat-from-a-mode.md that are now false.

Severity: P0 data loss / exploitable security / incorrect charging / broadly unusable; P1 user-visible wrong behaviour or contract violated; P2 design/maintainability; P3 prose. Give each finding an ID (SD3-01 …), severity, file:line evidence, and either "fixed" (what you changed, and a test seen red then green where it is behaviour) or "not fixed, for you" (the concrete change). Run typecheck (`node --experimental-strip-types scripts/typecheck.ts` if `npm run typecheck` cannot start in your sandbox) and the tests you touch after any fix, and report the results; say which database-backed tests your sandbox could not run.

Write your findings first to docs/plans/261030b-stage3-code-review-sol.md, then end with a one-line verdict: approve / approve with changes / revise.
