No P0s. I found and fixed four in-scope issues; two wider bounds remain.

1. **P1 — [src/web/useGlossary.ts:724](/home/greg/code/spideryarn2/.claude/worktrees/glossary-streaming/src/web/useGlossary.ts:724)** — After a stream failure, `refresh()` was fire-and-forget and admission reopened immediately. A quick retry could start a second paid call, then the first lookup’s reconciliation could arrive and hide the retry’s draft. I now await reconciliation while `lookLive` remains held. The regression failed red with two POSTs and now passes with one.

2. **P1 — [src/web/useGlossary.ts:714](/home/greg/code/spideryarn2/.claude/worktrees/glossary-streaming/src/web/useGlossary.ts:714), [GlossaryPanel.tsx:346](/home/greg/code/spideryarn2/.claude/worktrees/glossary-streaming/src/web/GlossaryPanel.tsx:346)** — The plan’s claim that no client path removes an entry was wrong: rebuilding a stale/outdated glossary can replace the list while lookup streams. Previously `done` confirmed storage, `patchEntry` found no row, the draft disappeared, and the panel said nothing. `lookKept` now survives independently of the list and the panel says the answer was saved but its term is no longer shown. A focused regression covers this exact interleaving.

3. **P2 — [GlossaryPanel.tsx:514](/home/greg/code/spideryarn2/.claude/worktrees/glossary-streaming/src/web/GlossaryPanel.tsx:514)** — A failure was attached to the currently selected `termId`, not the request’s ID. Changing selection mid-stream moved the error sentence onto the wrong term and separated it from its unfinished draft. Failures now carry their request ID and render only on that entry.

4. **P2 — [src/store/contracts.ts:340](/home/greg/code/spideryarn2/.claude/worktrees/glossary-streaming/src/store/contracts.ts:340)** — `GlossaryStore` still declared the obsolete non-streaming `lookUpTerm(...): Promise<{entry}>` contract even though lookup is explicitly orchestration outside that adapter. I removed the stale method and corrected the contract comment.

5. **P1, wider — [src/routes.ts:8383](/home/greg/code/spideryarn2/.claude/worktrees/glossary-streaming/src/routes.ts:8383)** — Claim 3’s disconnect decision is right for this product promise: one accepted model call has a whole-call 120-second deadline, a 45-second silence clock, and a 1,500-token ceiling. But aggregate spend remains unbounded: there is no server-side rate limit, per-term deduplication, or shared admission gate, so concurrent POSTs/tabs can start arbitrarily many individually bounded calls. I did not invent a glossary-only billing policy in this stage.

6. **P2, wider — [src/store/pg-lookups.ts:73](/home/greg/code/spideryarn2/.claude/worktrees/glossary-streaming/src/store/pg-lookups.ts:73), [src/db/client.ts:185](/home/greg/code/spideryarn2/.claude/worktrees/glossary-streaming/src/db/client.ts:185)** — The model cannot run forever, but the whole handler technically can: the post-model save/read-back and database pool have no query/statement deadline. This cannot add model spend after the model deadline, but a database stall can retain the request indefinitely. I left this for the database-wide timeout policy.

7. **P2 — [src/routes.ts:1159](/home/greg/code/spideryarn2/.claude/worktrees/glossary-streaming/src/routes.ts:1159)** — The shared SSE helper’s caller inventory said “eight” and omitted the new lookup route despite warning that the next caller must update it. I replaced the repeatedly stale count with a count-free inventory.

Claims 1, 2, 4, 5, and 6 hold after these fixes. Claim 3’s deliberate `gone` trade-off is sound per individual request, with the wider aggregate-spend and database-wait limits above. In particular, there is now no known single-client interleaving where an unstored answer is shown as kept, or a confirmed-stored answer disappears silently.

Verification: 5 runnable focused files, 56 tests passed. The Postgres-backed `term-lookup` and route suites could not run in this sandbox; I inspected the route harness and relied on your reported 7/7 route run. `npm run typecheck` was blocked by `tsx` IPC permissions, but running the same script directly checked all four TypeScript projects successfully. Focused lint had no errors. No commit made.

Files edited:

- `docs/plans/260910g-stream-glossary-answers-as-they-arrive.md`
- `docs/project/glossary.md`
- `src/routes.ts`
- `src/store/contracts.ts`
- `src/web/GlossaryPanel.tsx`
- `src/web/useGlossary.ts`
- `tests/glossary-lookup-stream.test.tsx`
- `tests/mode-surface-changes-no-markup.test.tsx`