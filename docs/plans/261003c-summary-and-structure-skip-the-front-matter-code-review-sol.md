No P0 findings. I fixed the in-scope defects; two P1 decisions remain.

### P1

- **The registered Brief ship gate fails. Not fixed.** [plan:147](/home/greg/code/spideryarn2/.claude/worktrees/fbabs6bj-summary-skips-front-matter/docs/plans/261003c-summary-and-structure-skip-the-front-matter.md:147) requires the after mean not to exceed before. `after` is 147.75 versus 146.5; `after-2` is 138.5 versus 138.75. Pooled, after is 143.125 versus 142.625. The increase is tiny compared with the 7.75-word control-arm spread, but the literal gate is unmet and should not be rewritten after seeing the result.

- **The Structure rule contradicted its required schema and blurred its two exceptions. Fixed.** [src/paperwork.ts:36](/home/greg/code/spideryarn2/.claude/worktrees/fbabs6bj-summary-skips-front-matter/src/paperwork.ts:36) said to send no `question`, although depth-1 requires that field, and “every other gist ignores it” sat awkwardly beside permission to use the abstract. It now says to leave the question empty and distinguishes clearly between ignoring paperwork and drawing on the abstract.

- **Wider: the supposedly frozen toc/10 baseline imports today’s changing prompt. Not fixed—outside scope.** [toc10-frozen.ts:2](/home/greg/code/spideryarn2/.claude/worktrees/fbabs6bj-summary-skips-front-matter/evals/structure-whole-document/toc10-frozen.ts:2) imports `TOC10_SYSTEM`, whose text interpolates the live shared rules at [src/structure.ts:224](/home/greg/code/spideryarn2/.claude/worktrees/fbabs6bj-summary-skips-front-matter/src/structure.ts:224). The “frozen” test at [request-parity.test.ts:326](/home/greg/code/spideryarn2/.claude/worktrees/fbabs6bj-summary-skips-front-matter/tests/structure-whole-document-request-parity.test.ts:326) stayed green because its expected literal was updated too. This can silently move historical eval baselines.

### P2

- **The free report crashed after reading the real arms because it also treated `pairs-*` folders as arms. Fixed.** [evals/paperwork/run.ts:236](/home/greg/code/spideryarn2/.claude/worktrees/fbabs6bj-summary-skips-front-matter/evals/paperwork/run.ts:236) now excludes those folders. It exits successfully.

- **The position screen lacked protection against stale or reversed manual bounds. Fixed.** [evals/paperwork/run.ts:263](/home/greg/code/spideryarn2/.claude/worktrees/fbabs6bj-summary-skips-front-matter/evals/paperwork/run.ts:263) now validates both block IDs and their order. The last-block-only predicate is correct: parsed node ranges are ordered, and each abstract upper bound is the last block before the body, so a node ending inside it cannot have run into the body. The corrected scaling range includes both its description and opening blockquote.

- **The Simple version test pinned a value through the constant under test. Fixed.** [simple-summary.test.ts:1268](/home/greg/code/spideryarn2/.claude/worktrees/fbabs6bj-summary-skips-front-matter/tests/simple-summary.test.ts:1268) now pins literal `simple-prompt/6` and independently checks the changed prompt text. The other three stamps already had literal pins capable of going red.

- **The plan’s baseline counts and scaling description were stale. Fixed.** [plan:122](/home/greg/code/spideryarn2/.claude/worktrees/fbabs6bj-summary-skips-front-matter/docs/plans/261003c-summary-and-structure-skip-the-front-matter.md:122) now records 6/4 content gists and 3/2 questions and describes the corrected scaling range.

- **The prompting guide omitted “identifies the piece.” Fixed.** [prompting-guide.md:100](/home/greg/code/spideryarn2/.claude/worktrees/fbabs6bj-summary-skips-front-matter/docs/project/prompting-guide.md:100) now agrees with the shared rule. I found no remaining active wording describing the dropped Summary/Tweets ID rule or calling paperwork “the only exception.”

- **The saved after arms no longer byte-match the reviewed prompt. Not fixed because that requires prohibited paid generation.** Their recorded `paperwork.ts` hash is shown at [after result:9](/home/greg/code/spideryarn2/.claude/worktrees/fbabs6bj-summary-skips-front-matter/evals/results/front-matter/after/analog-cognition-and-consciousness-4-28-26-spya-f03kqf.json:9). The review changes clarify schema and precedence, and the saved outputs already behave accordingly, but final prompt provenance needs a fresh after run before claiming exact evidence.

The coarse Structure result looks sound: each root retains the article’s central claim, and the first body node begins its development, so making the combined title/authors/abstract node a label does not materially weaken coarse zoom. Both `8. Summary` arms and the closing Conclusions retain substantive gists.

Validation: 198 scoped tests passed; typecheck passed for all 2,775 covered source files; doc-link tests passed; lint had only the existing harness-complexity notice; the free report and `git diff --check` passed. Full `npm test` could not start Postgres/Docker inside the sandbox. No paid calls were made.

**Verdict: changes requested—the implementation is sound after the fixes, but the Brief ship gate fails and the wider frozen-baseline defect needs a decision.**