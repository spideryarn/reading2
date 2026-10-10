## Findings

- **D1 — P1, established:** claims-only public articles advertised Debate but dropped `debateClaims` while lifting the public payload, so visitors could not see the list. Fixed in [public-artefacts.ts](/var/tmp/spideryarn-worktrees/fbcaue42-debate-pick-claims/src/web/public-artefacts.ts:60), with a red-first regression test.

- **D2 — P1, established:** the freshness stamp hashed the whole tree and supplement blocks although neither reaches the prompt. Renaming a section therefore falsely marked the list stale, disabled its actions, and offered an unnecessary paid rerun. Fixed in [debate-claims.ts](/var/tmp/spideryarn-worktrees/fbcaue42-debate-pick-claims/src/sources-claims.ts:114) by hashing the exact rendered body and metadata head. Your suspicion was right: it should not be purely blocks-only because the prompt also contains the head and, without metadata, the tree slug as fallback title.

- **D3 — P1, established:** the Postgres owner read set `outdated` from prompt version alone, ignoring model-generation drift despite the authoritative helper checking both. Fixed in [pg.ts](/var/tmp/spideryarn-worktrees/fbcaue42-debate-pick-claims/src/store/pg.ts:3989) by using `debateClaimsAreOutdated`.

No security finding: `shareableArtefacts` and `artefactsIn` change inventory only. The existing visibility/share-key predicate still gates public reads, and the DTO still rebuilds every claim as exactly `{id, blockId, quote, statement}` in [dto.ts](/var/tmp/spideryarn-worktrees/fbcaue42-debate-pick-claims/src/public/dto.ts:601).

No paid-start defect found. Both hooks mount and make their separate, read-only GETs; StrictMode may duplicate opening GETs in development, but never POSTs. Their activation targets remain isolated, stale/ready results consume rather than spend a press, visitors mount no owner hooks, and another tab’s job only updates state.

Block IDs are correct at generation: only visible body blocks are eligible, quotes are re-found with the referee’s spaced matcher, and stored quotes are replaced with the article’s characters. A carried stale list can reference a subsequently removed block by design; `BlockRef` renders that as a missing, non-clickable reference.

The mode checklist, owner/visitor states, claims-without-debate path, migration/CHECK, carry policy, export, route, output schema, prompt plain-words/paperwork rules, and Reception isolation otherwise checked out.

## Files edited

Core fixes:

- [src/debate-claims.ts](/var/tmp/spideryarn-worktrees/fbcaue42-debate-pick-claims/src/sources-claims.ts)
- [src/store/pg.ts](/var/tmp/spideryarn-worktrees/fbcaue42-debate-pick-claims/src/store/pg.ts)
- [src/web/public-artefacts.ts](/var/tmp/spideryarn-worktrees/fbcaue42-debate-pick-claims/src/web/public-artefacts.ts)

Regression tests:

- [tests/debate-claims.test.ts](/var/tmp/spideryarn-worktrees/fbcaue42-debate-pick-claims/tests/sources-claims.test.ts)
- [tests/visitor-gaps.test.ts](/var/tmp/spideryarn-worktrees/fbcaue42-debate-pick-claims/tests/visitor-gaps.test.ts)
- [tests/store-revision-columns.test.ts](/var/tmp/spideryarn-worktrees/fbcaue42-debate-pick-claims/tests/store-revision-columns.test.ts)

Related stale comments/contracts were corrected in `src/db/schema.ts`, `src/pipeline.ts`, `src/store/contracts.ts`, `src/types.ts`, `src/web/DebatePanel.tsx`, `src/web/reader/Reader.tsx`, `src/web/useDebateClaims.ts`, and `tests/pipeline-artifact-store.test.ts`.

The pre-existing untracked review prompt/answer files were not changed. Nothing was committed.

## Checks

- Red-first run: 3 intended failures, 86 passes.
- Same focused run after fixes: **90/90 passed**.
- Spend/navigation/state suite: **431/431 passed**.
- Public boundary/schema/checklist suite: **424/424 passed**.
- Registration/output-format/API suite: **688/688 passed**.
- Direct typecheck: all four TypeScript projects passed.
- Biome on edited files: no errors; four existing warnings and eight complexity notices.
- `git diff --check`: passed.
- `npm test` and the Postgres freshness/export tests could not initialize because this sandbox cannot reach the local database or Docker.
- The required extra GPT Sol wrapper review could not start because its app-server state is read-only in this sandbox. The broader unit sweep likewise hit unrelated sandbox failures in the `run-claude`/`run-codex` wrapper tests.

**Verdict: land with the fixes made.**