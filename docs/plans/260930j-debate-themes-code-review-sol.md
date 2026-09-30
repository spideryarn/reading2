1. **P1 — [src/debate-synthesis.ts:60](/home/greg/code/spideryarn2/.claude/worktrees/fb6m-debate-themes-and-key-papers/src/debate-synthesis.ts:60)** — Work identity discarded meaningful queries and ports, stripped arbitrary title suffixes, merged generic/same-host titles, treated `notarxiv.org` as arXiv, and missed old-style arXiv IDs. This could wrongly drop themes or key sources. **FIXED** — preserved semantic URL parts, tightened title matching, corrected arXiv handling, and added regression tests. Updated the plan’s identity description too.

2. **P1 — [src/debate-synthesis.ts:276](/home/greg/code/spideryarn2/.claude/worktrees/fb6m-debate-themes-and-key-papers/src/debate-synthesis.ts:276)** — A non-empty stored `made` synthesis whose every item failed validation became an empty `made`, contradicting the failed-versus-empty contract. **FIXED** — it now reads as `failed`.

3. **P2 — [src/debate-synthesis.ts:117](/home/greg/code/spideryarn2/.claude/worktrees/fb6m-debate-themes-and-key-papers/src/debate-synthesis.ts:117)** — An unexpected non-string stored title threw inside the new work-identity reader. **FIXED** — malformed titles and URLs now contribute no identity instead of throwing.

4. **P2 — [tests/debate-passes.test.ts:215](/home/greg/code/spideryarn2/.claude/worktrees/fb6m-debate-themes-and-key-papers/tests/debate-passes.test.ts:215)** — No integration test proved that `generateDebate` actually made the third, tool-free call using the same job and model. Foot-count filtering, visitor isolation, prompt safeguards, and toggle semantics also lacked direct coverage. **FIXED** — added non-vacuous tests for each seam.

5. **P3 — [src/debate.ts:1891](/home/greg/code/spideryarn2/.claude/worktrees/fb6m-debate-themes-and-key-papers/src/debate.ts:1891)** — The comment said synthesis could not fail the step, although transport errors, aborts, and bugs deliberately propagate. **FIXED** — corrected the comment.

6. **P2 — [src/debate-synthesis.ts:159](/home/greg/code/spideryarn2/.claude/worktrees/fb6m-debate-themes-and-key-papers/src/debate-synthesis.ts:159)** — Two genuinely different works on different hosts can still share the same sufficiently distinctive normalized title and be merged. **REPORTING** — eliminating this residual heuristic requires stronger identifiers such as DOI/author/year, or abandoning the measured cross-site-copy matching.

7. **P2 — [src/web/DebatePanel.tsx:1812](/home/greg/code/spideryarn2/.claude/worktrees/fb6m-debate-themes-and-key-papers/src/web/DebatePanel.tsx:1812)** — Wider pre-existing issue: the panel itself still assumes stored row titles and URLs are strings, so a malformed row can crash later even though the new synthesis reader no longer does. **REPORTING** for a broader stored-row validation decision.

8. **P3 — [src/types.ts:5221](/home/greg/code/spideryarn2/.claude/worktrees/fb6m-debate-themes-and-key-papers/src/types.ts:5221)** — Visitors intentionally receive no synthesis, so threads remain owner-only. **REPORTING** as the plan’s deferred public-DTO product decision; the tested visitor path never calls `readStoredSynthesis`.

Checked without further findings: all plan-review items F1–F8; synthesis caps and validation; provider-refusal-only exception handling; malformed/non-string responses; same model/meter and no tools; prompt injection warning, plain-words rule, and output fields; prompt version and staleness; stale thread IDs; pressed-empty threads; head/Showing/foot/thread counts; React keys; and toggle accessibility.

Gate results:

- `npm run typecheck`: **exit 1** before compilation. `tsx` could not open `/tmp/tsx-1000/14.pipe` (`listen EPERM`) in the sandbox.
- Equivalent wrapper, `node --import tsx scripts/typecheck.ts`: **exit 0** — all four projects passed; all 2,461 source files covered.
- Requested Vitest command: **exit 0** — `9 passed`, `349 passed`.

Verdict: fixes are sound and tests pass, but the exact typecheck gate needs rerunning outside this IPC-restricted sandbox.