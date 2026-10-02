Verdict: **push after fixes**. Do not push `ed849a543` alone; the required fixes are present but uncommitted in this worktree.

## Findings

- **C1 — P0 — Fixed:** Reader-visible job progress still said Sketch “usually takes two or three minutes” and waited seven minutes before calling it slow. The wait is now sourced once as “about a minute,” with a three-minute slow threshold. Evidence: [src/job-state.ts](/home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/src/job-state.ts:150), [tests/job-state.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/tests/job-state.test.ts:129), [tests/metadata-reset-section.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/tests/metadata-reset-section.test.tsx:464). Fixed in `src/job-state.ts`, `src/web/sketch-cost.ts`, the three job-progress tests, `tests/metadata-reset-section.test.tsx`, and `tests/illustrated-view.test.tsx`.

- **C2 — P1 — Fixed:** `tally.ts`’s new arm discovery unconditionally reread the ranking verdict. A score-only result—explicitly supported by the script’s “judge unavailable” behavior—therefore crashed. It also silently accepted mixed candidate families. Evidence: [evals/thinking-effort/tally.ts](/home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/evals/thinking-effort/tally.ts:32), [tests/thinking-effort-tally.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/tests/thinking-effort-tally.test.ts:5). Fixed in those two files; a score-only integration run also passed.

- **C3 — P1 — Fixed:** Not every structure-answer parser used production’s exported seam. Hierarchy wave arms and the book-structure spike still called generic parsing directly, recreating the drift class from D1’s postmortem. Evidence: [model-arms.ts](/home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/evals/hierarchy-structure/model-arms.ts:845), [spike-book-structure.ts](/home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/scripts/spike-book-structure.ts:95). Both now call `parseStructureAnswer`.

- **C4 — P2 — Fixed:** Changed comments and tests claimed cache sharing requires `STEP_ORDER` contiguity. That contradicts `cacheArticleForStep`, which is deliberately position-blind; adjacency only reduces expiry risk within the five-minute cache lifetime. Evidence: [src/step-order.ts](/home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/src/step-order.ts:87), [src/pipeline.ts](/home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/src/pipeline.ts:343). Fixed in `src/step-order.ts`, `src/types.ts`, `tests/faq.test.ts`, and `tests/trajectory.test.ts`.

- **C5 — P2 — Fixed:** Sketch documentation and code comments continued presenting high-effort timing, price, and timeout rationale as current. Evidence: [docs/project/sketch.md](/home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/docs/project/sketch.md:102), [src/pipeline.ts](/home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/src/pipeline.ts:520). Fixed there and in the affected `src/web` comments.

- **C6 — P2 — Not fixed; wider/pre-existing:** `ARTICLE_RENDERER` commentary still says Tweets sends `articleText` and can never share with Ideas, despite the table correctly recording Tweets as `ids`. The project caching doc repeats it. Evidence: [src/models.ts](/home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/src/models.ts:1764), [prompt-caching.md](/home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/docs/project/prompt-caching.md:129).

- **C7 — P2 — Not fixed; wider/pre-existing:** `effortFor` applies the global effort override, but `sharesArticleCache` reads static `STAGE_EFFORT`. Under an override this produces false negatives and loses possible cache hits, though it does not produce wrong artefacts or unsafe cache reads. Evidence: [src/models.ts](/home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/src/models.ts:1817), [src/pipeline.ts](/home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/src/pipeline.ts:324).

## Other audit conclusions

- Existing high-effort Sketches correctly remain fresh: effort is not in the artefact stamp, and replacing a valid, potentially better picture would only charge the reader again. The prompt version remains unchanged.
- `config.sketch.json` recording `productionEffort: "high"` is historical evidence, not live configuration. New runs resolve today’s effort, and resuming into that old directory is refused as configuration drift.
- D1–D7 are addressed in the research/results package.
- All substantive changed tests would fail on the corresponding regression. The Quiz and Trajectory test edits are comment-only. I changed the Illustrated wait test from importing the production constant to asserting the literal reader copy, so reverting the wait now fails it.

## Verification

- 15 targeted test files: **337 tests passed**.
- `git diff --check`: clean.
- `npm run typecheck` was attempted but the sandbox refused tsx’s `/tmp` IPC socket. Running the identical script as `node --import tsx scripts/typecheck.ts` checked all projects and reported only the acknowledged pre-existing error in `tests/chat-empty-reads-from-the-top.test.tsx`.
- Targeted lint: no errors; two informational pre-existing complexity/style notices.
- No network used and no commit made.