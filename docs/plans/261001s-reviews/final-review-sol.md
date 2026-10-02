Verdict: no open production defect remains in 261001s; four code defects and the factual ledger were fixed, with only the already-known absence of a paid live chat-wire probe.

## Findings

- **P1 — 261001s-F1 — Fixed:** the chat adapter accepted optional object properties, which OpenAI strict structured outputs reject. Added recursive OpenAI-subset validation and represented Simple’s conditional `why` as two fully required variants. [messages-structured-output.ts](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/src/messages-structured-output.ts:352), [simple-check.ts](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/src/simple-check.ts:123).
  - Red: `npx vitest run --project unit tests/messages-structured-output.test.ts -t "refuses optional object properties"`
  - The new guard then made Simple’s request test fail until its schema was corrected.
  - The official [OpenAI structured-output guidance](https://developers.openai.com/api/docs/guides/structured-outputs) confirms that every object property must be required; the `openai-docs` skill directed this verification.

- **P1 — 261001s-F2 — Fixed:** Structure’s “three-level” schema allowed absent or empty root/chapter children, so a root-only answer could pass constrained decoding and be checkpointed. Both levels now require non-empty children. [hierarchy.ts](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/src/hierarchy.ts:262).
  - Red: `npx vitest run --project unit tests/hierarchy-structure-toc11.test.ts -t "requires the root, chapter, and section levels"`
  - The checkpoint and re-ask fixtures now contain schema-valid three-level `toc/11` answers.

- **P2 — 261001s-F3 — Fixed:** Tweets’ live schema admitted legacy strings, allowing newly generated posts without source block ids. The live schema now permits only `{text, blocks}`; the parser remains tolerant of stored legacy strings. [tweets.ts](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/src/tweets.ts:405).
  - Red: `npx vitest run --project unit tests/tweets.test.ts -t "requires every generated post"`

- **P3 — 261001s-F4 — Fixed:** `rangelessChildren` was permanent-zero production telemetry under `toc/11`. It was removed from `HierarchyRun` and the pipeline log, while retained in `BuildReport` for direct and legacy ranged-builder callers. [hierarchy.ts](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/src/hierarchy.ts:1112), [pipeline.ts](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/src/pipeline.ts:2769).
  - Red: the re-ask test initially received `rangelessChildren: 0`; it now asserts the public result omits the field.

- **P1 — 261001s-F5 — Fixed:** several documentation claims were false or too broad: “every JSON call,” schema/parser equality, the redraw being unbuilt, `$8.40`, Ideas thinking at `8–105`, and live `rangelessChildren` telemetry. These now match code and committed results. Main reconciliation: [plan ledger](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/docs/plans/261001s-structure-answer-writes-code-to-correct-an-id.md:473), [prompting guide](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/docs/project/prompting-guide.md:127), [hierarchy.md](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/docs/project/hierarchy.md:221), [postmortem](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/docs/postmortems/261002b-an-unconstrained-json-answer-fails-the-step.md:68).
  - Important-doc wording changed from “every JSON call” to compatible response-JSON calls plus named exceptions, and from parser equivalence to the live contract expressible by the provider, retaining legacy parser tolerance.

## Requested invariants

- The cache tripwire is sound. It enumerates every ordered distinct pair, so even an asymmetric predicate cannot hide a match; `sameOutputFormat` is itself symmetric. Temporarily assigning FAQ Tweets’ schema made the unit tripwire fail with both `tweets+faq` and `faq+tweets`. The mutation was restored. The production-walk version could not start without Postgres/Docker.
- A fresh `toc/11` answer that parses but fails starts-only conversion is re-asked once. The second raw replaces the first; checkpointing happens only after successful `treeFrom`. Refusal, truncation and abort remain outside the retry boundary. [hierarchy.ts](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/src/hierarchy.ts:2820).
- The restored first-start comment is accurate: every claimed start is checked against the parent before the first is pinned. [start-ranges.ts](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/src/start-ranges.ts:120).
- The whole-document checkpoint includes `toc/11` and the schema-bearing wire request. Expansion checkpoints carry `toc/11+expand/7`.
- No reviewed schema puts article block ids in an `enum`.
- Refusal and token-limit handling remains before parsing for the migrated Messages calls. The chat calls likewise reject non-clean endings before accepting content.
- No wider finding was identified. No live chat-wire request was made; current evidence is the preflight validator, `require_parameters` routing, focused tests, and provider documentation.

## Gates run

```text
npx vitest run --project unit [15 focused files]
Test Files  15 passed (15)
Tests       353 passed (353)

npx vitest run --project unit tests/doc-links.test.ts
Test Files  1 passed (1)
Tests       16 passed (16)

node --import tsx scripts/typecheck.ts
✓ src/web/tsconfig.json  (429 files)
✓ tests/tsconfig.json  (2531 files)
✓ tools/fleet/web/tsconfig.json  (104 files)
✓ tsconfig.json  (808 files)
✓ all 2648 source files are covered by some project

npx biome lint [12 touched code/test files]
Checked 12 files in 2s. No fixes applied.
Found 1 warning.
Found 3 infos.

git diff --check
[clean]
```

`npm test` stopped in global setup with:

```text
Error: No database, and every test that touches the store needs one.
could not ask Docker which container serves port 54362
```

Literal `npm run typecheck` and `npm run check` were also blocked by the sandbox’s `tsx` IPC restriction:

```text
Error: listen EPERM: operation not permitted /tmp/tsx-1000/14.pipe
```

The loader-equivalent typecheck above passed, and the production build phase completed successfully. No commits, state-changing git commands, reviewer dispatches, or live paid probes were made.