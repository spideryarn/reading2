Found six issues and fixed all within this stage. No report-only findings remain.

- **F1 — P1** — The shared prompt said to place the outside note beside the article claim “and stop,” contradicting Recall’s required nudge and Tutorial’s required final task. Evidence: [src/wider-world.ts:82](/var/tmp/spideryarn-worktrees/fbh5mteu-modes-wider-world/src/wider-world.ts:82). **FIXED:** stopping is now governed only by each mode’s placement rule; added a red-first regression test.

- **F2 — P1** — Tutorial said to reach outside the article only when asked, while `widerWorld` permits checking an already-suspected error unasked. Evidence: [src/converse.ts:1321](/var/tmp/spideryarn-worktrees/fbh5mteu-modes-wider-world/src/converse.ts:1321) and [src/converse.ts:1359](/var/tmp/spideryarn-worktrees/fbh5mteu-modes-wider-world/src/converse.ts:1359). **FIXED:** distinguished reader-led exploration from the narrow factual-check exception.

- **F3 — P1** — Quiz’s “one sentence and stop” rule contradicted the required separate outside note when a reader faithfully repeats a wrong article claim. Evidence: [src/quiz-mark.ts:237](/var/tmp/spideryarn-worktrees/fbh5mteu-modes-wider-world/src/quiz-mark.ts:237) and [src/quiz-mark.ts:267](/var/tmp/spideryarn-worktrees/fbh5mteu-modes-wider-world/src/quiz-mark.ts:267). **FIXED:** both stop rules now explicitly permit the separate outside note and direct the model to state the article’s claim rather than judge the answer.

- **F4 — P2** — The investigation overstated the evidence: one baseline Chat reply used memory and the other linked web sources; the new notes were not all one sentence; three of the four shipped-arm Q4 losses were real prompt-contract leaks, not two harmless judge disagreements. Evidence: [before1.json:105](/var/tmp/spideryarn-worktrees/fbh5mteu-modes-wider-world/evals/wider-world/out/before1.json:105), [before2.json:105](/var/tmp/spideryarn-worktrees/fbh5mteu-modes-wider-world/evals/wider-world/out/before2.json:105), and [judge-before1-vs-after4.json:6](/var/tmp/spideryarn-worktrees/fbh5mteu-modes-wider-world/evals/wider-world/out/judge-before1-vs-after4.json:6). **FIXED:** corrected the investigation, plan progress, and investigation index; “never against the reader” is now qualified as none of the 19 judged replies.

- **F5 — P2** — The marker regex missed the actual phrase “from my memory rather than the piece,” recording that after3 Tutorial note as absent. Evidence: [after3.json:133](/var/tmp/spideryarn-worktrees/fbh5mteu-modes-wider-world/evals/wider-world/out/after3.json:133). **FIXED:** extracted a testable marker helper, expanded the regex, and added a red-first case at [tests/wider-world.test.ts:85](/var/tmp/spideryarn-worktrees/fbh5mteu-modes-wider-world/tests/wider-world.test.ts:85).

- **F6 — P2** — The tests checked placement wording rather than several actual prompt relationships, and excluded only Explore rather than Guide and Candidates. Evidence: [tests/wider-world.test.ts:90](/var/tmp/spideryarn-worktrees/fbh5mteu-modes-wider-world/tests/wider-world.test.ts:90). **FIXED:** tests now exhaustively map every `ThreadKind`, verify one real section instance, and ensure the citation rules and Recall entitlement pointer precede the section.

Files edited:

- `docs/investigations/261018c-modes-say-when-the-piece-is-wrong.md`
- `docs/plans/261018h-modes-say-what-the-wider-world-thinks-labelled.md`
- `docs/project/investigations.md`
- `evals/wider-world-screen.ts` — new
- `evals/wider-world.ts`
- `src/converse.ts`
- `src/quiz-mark.ts`
- `src/wider-world.ts`
- `tests/wider-world.test.ts`

Verification:

- Targeted and doc-link tests: **108 passed**
- Typecheck: **passed**
- `git diff --check`: **passed**
- Biome: no errors; complexity advisories only
- Full `npm test`: could not start because the local Postgres service is unavailable; the requested database-free suites passed.

APPROVE WITH CHANGES