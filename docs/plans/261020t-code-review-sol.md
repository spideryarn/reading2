# 261020t code review — GPT Sol (gpt-5.6-sol, effort high, workspace-write)

The answer as returned, for [the plan](261020t-chat-length-flexes-when-the-reader-asks-for-detail.md). Local links rewritten as repo paths.

Recomputed results and unblinded tables match the plan exactly. No prompt conflict or help-turn misfire found.

1. **P2 — Eval arms were not fully validated.** The harness recorded effort and shared prompt hashes but did not compare them across arms, despite the plan claiming it did. It also accepted malformed or mislabelled stored cases. Fixed with arm-shape validation and cross-arm model, effort, article, and shared-source checks in `evals/chat-length/run.ts:152`.

2. **P3 — `chat-principles.ts` fingerprint coverage was not pinned by a test.** Registration could regress silently. Added it to the real harness expectation in `tests/eval-source-fingerprint.test.ts:94`.

3. **P3 — OpenRouter limit documentation was stale.** It still named the exhausted $500 limit although the plan records the raise to $600. Corrected `docs/project/ai-gateway.md:1252`.

Verification:

- Focused tests: 22/22 passed.
- Typecheck: passed for all 3,866 source files via the equivalent `node --import tsx` invocation. The exact npm wrapper was blocked by sandbox IPC permissions.
- Report: reproduced the plan’s word counts and zero truncations.
- All 30 blind-pair sides match their stored answers; unblinding gives 11–0 with four ties and the 5–1/9-tie control.
- Full `npm test` could not start because the sandbox could not reach the local Postgres/Docker service.
- No paid calls, commits, or pushes.

Verdict: **pass with fixes**.