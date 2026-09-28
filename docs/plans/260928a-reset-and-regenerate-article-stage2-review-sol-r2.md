Fixed one P1; no unresolved P0/P1 findings.

- **F16 P1 — fixed:** reload recovery treated any later same-step job as a reset successor, then kept per-step watchers mounted indefinitely. This could show unrelated work under Reset, duplicate a multi-step job, and offer a Stop button for the wrong job. Successors are now matched to the reset’s completion transaction, plan, profile, and one-step shape, and rendered through the existing queue subscription. Regression tests failed before the fix. [ResetArticle.tsx](/home/greg/code/spideryarn2/.claude/worktrees/metadata-reset-regenerate/src/web/ResetArticle.tsx:99) [test](/home/greg/code/spideryarn2/.claude/worktrees/metadata-reset-regenerate/tests/metadata-reset-section.test.tsx:544)
- **F17 P2 — reported:** successor jobs do not carry a durable parent-reset ID; the scope exists only inside their work-key hash. A matching independent job created in the same millisecond remains theoretically ambiguous. Closing that requires a wider server/store contract change.

Merge audit:

- `trajectory` is correctly an extra: it is on-demand, outside default ingest, stored in its own whole column, and regenerated after Quotes.
- Migration ordering and snapshots are correct: trajectory is journal entry 90; reset is entry 91.
- `394390aa`’s route counts are correct.
- F14’s `reset-role.ts` leaf gives client and server one exhaustive classification without violating client imports.

Verification:

- 5 pure/jsdom files: **402 tests passed**
- All four TypeScript projects passed via direct `tsc`; the wrapper itself was blocked by sandbox IPC permissions.
- Biome and `git diff --check` passed.
- No database, dev server, commit, or unrelated files touched.

**Verdict: ACCEPT after fixes.**