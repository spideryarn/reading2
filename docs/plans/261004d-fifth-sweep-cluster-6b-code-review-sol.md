Fixed three findings. One wider risk remains.

- **F1 — P2, established, fixed:** Search and Criteria’s new SET branches silently discarded fields previously written. A variable can satisfy the union while carrying `model` or results on error, or `error` on success. Restored independent defined-field writes and added regression cases. The captured-method probe showed four failures before and four passes after. No existing production caller with mixed fields was found.
- **F2 — P3, established, fixed:** Criteria overlap **can happen in one process**: DELETE a pending criterion, then POST with its former ID while the old model call continues. Corrected the plan and route comment; added coverage. Claims’ overlap conclusion is correct.
- **F3 — P3, established, fixed:** Affected signatures still had filesystem-store explanations. Updated those comments and corrected the plan’s SSE failure description.
- **F4 — P2, reasoned, not fixed; wider:** The shared Search/Referee design assumes `begin` returns in database commit order. A delayed older response could replace the newer marker, then remove it when its fenced finish matches nothing. Tracking every active holder per key would avoid that assumption. Recorded for your decision.

All **14 compiler directives** suppress exactly the error their comments name. Chat’s looser internal options parameter is appropriate: it preserves `MissingAttempt` for untyped callers, while the exported `ChatStore` signature remains strict.

Validation:

- `npm run typecheck`: blocked by tsx IPC `EPERM`. The same script via `node --import tsx scripts/typecheck.ts` **passed**, including all coverage guards.
- Lifetime file and full suite: **blocked before collection** by denied Postgres/Docker access.
- Attempted all five marker mutations separately and restored each. Every run hit that preflight failure, so I could not verify their claimed red assertions or establish whether any passes with its fix removed.
- Scoped lint: five existing complexity notices. `git diff --check`: clean.

No commit, push, or deploy.

**Verdict: not ready for sign-off until the database regressions and mutation checks run successfully; F4 remains a wider design decision.**