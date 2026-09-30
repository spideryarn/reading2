# Code review (stage 1, server): Citations' Investigate — review AND fix

You are a reviewer-fixer working in this worktree. The code under review is commits 759aba1e (move-only runner extraction) and 126e3746 (stage 1): `git diff 0aa20200 126e3746` (ignore the later merge of origin/dev; it is not ours). The spec is docs/plans/260930a-citations-investigate-one-work-on-demand.md — settled after your two plan reviews (docs/plans/260930a-citations-investigate-plan-review-sol.md and -plan-review-2-sol.md) and Opus arbitration; read its § Review log and § The probe.

Fix what is inside this stage, narrowly and red-first (write the failing test, see it fail, fix). Report — do not fix — anything wider. Do not commit; leave your changes in the working tree. Do not touch the production DB, .env.local, infra/. Do not edit tests to make them pass unless the test is wrong, and say so if you do.

You have no network, not even loopback, so Postgres-backed tests can't run for you. Their raw output from me, just now, on 126e3746 + the merge: docs/plans/260930a-stage1-pg-tests.log (tests/citation-investigate-route.test.ts, public-dto, store-export-covers-tables, store-shelf-pg, db-schema-drift — 127 passed). You CAN run the unit files: tests/investigate-quote-guard.test.ts, tests/citation-investigate.test.ts, tests/citation-investigate-context.test.ts, tests/explain-request-snapshot.test.ts, tests/explain.test.ts — run at least the guard file yourself (`npx vitest run <file>`).

Known deviations the builder declared (judge them): the fingerprint covers the article's blocks (ids+text) not the rendered article part; the stop message has a retry tail; "current Look it up that identified a page" = lookup state assessed or unreadable with matching hashes, quotes only from assessed; the Look-it-up match is not in the fingerprint; a straight inch-mark `"` stops an answer; if resolveProfile's shelf read fails at press time the stored answer's fingerprint won't match later; the allowance lease frees only when the stream is iterated.

Look hardest at:
1. The in-stream quote guard (src/investigate-quote-guard.ts and its use in src/citation-investigate.ts): can ANY quote-shaped span not found in the allowed texts reach the SSE `delta` frames? Chunk boundaries splitting a quote mark or a `>` at line start; nested/mismatched curly vs straight; a span that is released and then continues; the end-of-stream flush; U+2019 as apostrophe vs close; the 400 cap.
2. Provenance: N/hosts/longest only from non-empty extracts; zero refuses; match line only when the lookup URL (normalised) is in the evidence.
3. Only `finished` stores; `done` only after save; nothing stored on a guard stop; allowance taken after the free refusals and always released.
4. Privacy: never in the public payload; the log lines carry no prose, URLs of sources, or profile.
5. The runner refactor: explain's behaviour unchanged (the snapshot test pins the request; check the ending/logging paths too).
6. The fingerprint: does a stored investigation hide when it should (why/passage/profile/prompt/model change) and survive when it should?

Severity: P0 (ships something false or unsafe to a reader), P1 (wrong, will need rework), P2 (should fix), P3 (nit). ID each C-1, C-2, … with file:line, the problem, what you changed (or "reported, not fixed" and why), and the red→green test for each fix. End with a verdict: approve / approve with the fixes made / changes needed.
