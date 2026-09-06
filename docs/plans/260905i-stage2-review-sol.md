## Findings

- **F20 — P2 — `anchorKey.start` is unprotected by the regression suite.** [`anchorKey`](</home/greg/code/spideryarn2/.claude/worktrees/a7-annotation-measure/src/web/TableView.tsx:182>) correctly includes `start`, but removing it left all 9 annotation-reuse tests green. I added a temporary repeated-quote test: changing only `start` should move the underline from the first occurrence to the second. It passed on the candidate and failed on the mutation—the stale mark remained on the first occurrence. Add this case for comments and preferably anchored chats.

- **F21 — P2 — the reuse suite does not protect three-way overlap composition.** The integration overlap test at [annotation-reuse.test.tsx:519](</home/greg/code/spideryarn2/.claude/worktrees/a7-annotation-measure/tests/annotation-reuse.test.tsx:519>) exercises only comment + term. I mutated `proseHtml` so hits were applied in a second `annotateHtml` pass; all 9 tests still passed, although comment + term + hit became nested marks. A temporary “hit arrives last” assertion passed on the candidate and failed on the mutation. The lower-level three-way test in `annotate.test.ts` does not protect the TableView composition seam. Add three-way coverage when each source changes or arrives independently.

- **F22 — P2 — identity-cache immutability is contractual prose, not enforced by types.** [`unpressed`](</home/greg/code/spideryarn2/.claude/worktrees/a7-annotation-measure/src/web/search-hits.ts:1177>) keys on mutable `Found[]` and exposes mutable `Map`/`Mark[]` values. I ran two probes: mutating a `Found` in place returned the old offsets, and pushing into a returned mark array permanently poisoned later results. Current callers do not mutate either, so this is not wrong behaviour today. The analogous `blocks` identity assumption is also sound only while nobody mutates the array or its `Block.html` in place. Prefer readonly input and result types so a future caller cannot silently violate these caches.

- **F23 — P3 — the `sameInputs` explanation overstates producer identity preservation.** [TableView.tsx:144](</home/greg/code/spideryarn2/.claude/worktrees/a7-annotation-measure/src/web/TableView.tsx:144>) says all three producers preserve a block’s array whenever that block’s marks did not change. They do so for the optimized selection/streaming paths, but not generally: changing any anchor rebuilds every resolved anchor array; changing `terms` rebuilds every term array; changing the `Found[]` rebuilds every base hit array. Correct the comment so future performance expectations match the implementation.

## Correctness audit

The injected prose HTML currently depends on:

- `block.html`, compared by value;
- comment/chat marks, including their resolved offsets, kind, IDs and open flags;
- term marks and the relevant per-block `openTerm`;
- search marks, including offsets, strength, palette/direction and open flags;
- `addZoomHandles`, which is purely a function of the annotated HTML.

All are represented in `ProseEntry`/`sameInputs`. `block.text`, gutters, layout, callbacks and other row props do not affect the injected HTML. Note-return state is deliberately handled afterward by an effect keyed on both `noteReturn` and `proseHtml`.

`anchorKey` itself is collision-safe under the actual ID contracts. IDs and block IDs contain no newlines; the quote length makes embedded newlines unambiguous. Reordering changes the key, as do duplicate records, added identical anchors, and records naming missing blocks. A missing block simply contributes no resolved mark. It can cause unnecessary recomputation, but not stale output.

`byId` identity is sound for current producers: article block arrays are replaced wholesale. In-place array or `Block.html` mutation would break it, as covered by F22.

`applyOpen(base, null, null) === base` is safe today. Callers only read or spread its arrays; `applyOpen` always starts later selections from the unpressed `base`, and neither the map nor arrays are mutated. Moving to or from a nonexistent open ID correctly removes any previous ring and adds none.

An `openKey` absent from search base marks produces no ring. Upstream panels clear missing keys, and starting every call from `base` prevents a previous ring persisting.

The overlap implementation is correct: all three current sources are concatenated before one `annotateHtml` call, so changing any source recomputes the block from all sources together. F21 concerns the missing integration guard, not candidate behaviour.

The `marksByBlock.n` counter remains honest: it counts memo-body executions, including executions that determine resolution can be reused. The nearby comment states that explicitly, while `resolveMark.n` distinguishes actual resolution work.

## Mutation and test evidence

| Mutation | Focused-suite result |
|---|---|
| Drop `html` from `sameInputs` | Caught: 2 failures |
| Drop `openTerm` | Caught: 1 failure |
| Replace shared `NO_MARKS` fallbacks with fresh `[]` | Caught: 3 failures |
| Make `applyOpen` rebuild every base array | Caught: 1 failure |
| Omit `start` from `anchorKey` | **Missed: 9/9 passed** |
| Drop `cmts` / `terms` / `hits` equality | Caught: 2 / 1 / 1 failures |
| Apply hits through a separate annotation pass | **Missed: 9/9 passed** |

Baseline focused suite: 9/9 passed. Seven related suites passed, 210/210 tests. `npm run typecheck` could not execute in this sandbox because `tsx` was denied its `/tmp` IPC socket (`EPERM`); this was an environment failure, not a type error.

**Verdict: ACCEPT — no established P0 or P1; F20–F22 are non-blocking hardening work before or alongside Stage 3.**