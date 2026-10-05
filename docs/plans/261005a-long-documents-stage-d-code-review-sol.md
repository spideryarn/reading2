- **F8 — P1, established, fixed:** a root-only model answer followed by notes passed tree validation but made the planner omit every body block, failing structure. Five tests reproduced this red-first. The planner now excludes supplement branches; short bodies retain their model tree, and oversized bodies reach the bounded fallback with spend preserved.
- **F9 — P1, established, wider scope:** 1,097 authored parts make `generateArc` exceed its output budget. Reading still opens, but Arc sentences remain unavailable. Reproduce with `node --import tsx /tmp/stage-d-consumer-review.ts`. The smallest durable fix is bounded groups of Arc requests; I left that decision outside this stage.
- **F10 — P3, established, fixed:** corrected comments describing the former model-only path and implying a conditional metadata read.

The builder survived 9,815 valid adversarial sequences. All eight single-file checks passed (**263 tests**), including fresh, resumed and deepened fallbacks. Typechecking passed; lint had existing advisories. No full-suite or Postgres run. Nothing committed.

Files changed:

- [src/labels.ts](src/labels.ts)
- [src/structure.ts](src/structure.ts)
- [src/pipeline.ts](src/pipeline.ts)
- [tests/bounded-heading-tree.test.ts](tests/bounded-heading-tree.test.ts)
- [tests/structure-step-bounded-fallback.test.ts](tests/structure-step-bounded-fallback.test.ts)
- [Stage D review report](docs/plans/261005a-long-documents-stage-d-review-sol.md)
- [Root-cause postmortem](docs/postmortems/261005a-a-supplement-append-invalidates-a-labels-planner-assumption.md)

A separate `docs/project/structure-step.md` edit was left untouched.

**Verdict: ship with the fixes made.**