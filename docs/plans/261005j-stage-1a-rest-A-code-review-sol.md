No functional regression found in stage A. I made prose corrections only; nothing committed, and stage B’s files were untouched.

Findings:

- **A1 — P1, established, not fixed: the doubled-headroom retry can be unaskable.** For 1,742–2,032 leaves, the first call fits but the retry throws before sending another request. A mocked 1,742-leaf truncation reproduced `LabelsFailed`, `truncated+other`, and only one request on **both the parent and candidate**. This predates the commit and sits outside stage A’s first-call askability promise. [Retry site](/var/tmp/spideryarn-worktrees/qi-kssrwchh-long-structure-1a-rest/src/labels.ts:2741).

- **A2 — P3, established, fixed: comments and docs described an individually askable section as unsplittable.** `[2032, 1]` disproves that: the combined batch is unaskable, so the planner windows the 2,032-leaf section. Wording now refers to the **packed batch**. I also corrected the test helper’s claim to be an unchanged copy: it preserves default packing but omits configurable options and the coverage assertion.

- **A3 — P3, established, fixed: the documented cap overrun was too small.** `[12, 60, 12]` produces one 84-leaf batch. The floor and tail merge can each add twelve; their allowances combine. This arithmetic predates the commit and remains safely askable.

Answers to the review questions:

1. **Default planning:** no counterexample for valid pipeline trees. Each loop iteration windows previously uncut sections, so it terminates. Once sets are bounded, the floor and tail merge produce at most 84 leaves per batch. Coverage, uniqueness and document order held in the probes.
2. **Compatibility:** 731 previously askable synthetic plans were byte-identical to the **actual parent implementation**, including prompts and fingerprints. The six real trees also matched. The copied planner is faithful for the valid, default-cap plans it tests.
3. **Bounded headings:** the extracted arithmetic and heading predicate are unchanged, including `atLeast`. Differential checks passed for 95 complete builds and 18,434 window cuts.
4. **Repeated `nodeId`:** the mocked runtime probe passed windows within and across batches, truncation/retry, usage records, `setStarts`, block-based merging and checkpoint resume. Parsing and shift detection operate on batch ordinals and blocks.
5. **Removed fallbacks:** no new first-call budget refusal found. Successful labels remain contingent on model answers; A1 and the deferred reliability of large but askable sections remain.
6. **Docs:** the removed fallback is described historically. The misleading current rules identified above are corrected.

Evidence:

- [Independent probe](/tmp/stage-a-labels-review/probe.ts): **1,060 plans**, including heading-heavy, nested and nonstructural-block arrangements; **329 repaired**.
- Candidate snapshot: **211 tests passed**, plus **79 bounded-heading tests** in a separate run.
- After edits: **118 focused tests passed**; **3 independent runtime tests passed**.
- Full `npm test` was blocked by sandbox database access. `npm run typecheck` hit a sandbox socket restriction; `node --import tsx scripts/typecheck.ts` passed, covering **3,260 files**. Lint reported two existing complexity advisories; whitespace checks passed.

**Verdict: land with the fixes made.**

Files changed:

- [src/labels.ts](/var/tmp/spideryarn-worktrees/qi-kssrwchh-long-structure-1a-rest/src/labels.ts)
- [src/heading-tree.ts](/var/tmp/spideryarn-worktrees/qi-kssrwchh-long-structure-1a-rest/src/heading-tree.ts)
- [tests/labels-batching.test.ts](/var/tmp/spideryarn-worktrees/qi-kssrwchh-long-structure-1a-rest/tests/labels-batching.test.ts)
- [docs/project/structure-step.md](/var/tmp/spideryarn-worktrees/qi-kssrwchh-long-structure-1a-rest/docs/project/structure-step.md)
- [docs/project/testing.md](/var/tmp/spideryarn-worktrees/qi-kssrwchh-long-structure-1a-rest/docs/project/testing.md)