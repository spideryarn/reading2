Code review, with fixes. You may edit files in this worktree to fix what you find inside this change's scope; report anything wider instead of changing it. Do not commit, push, or touch .env*, infra/ or any database. **Do not edit evals/structure-whole-document/, evals/thinking-effort/, evals/results/hierarchy-structure/ or evals/results/structure-id-pattern/judging/**: a blind quality panel is running there now.

The plan is docs/plans/261020aa-structure-answers-the-block-number-not-its-id.md (revision 3). Read it first, including why it overturned revision 2's pattern design: your plan review of revision 2 is docs/plans/261020aa-plan-review-sol.md and your design consult is docs/plans/261020aa-design-consult-sol.md. The change is uncommitted here: `git diff HEAD`, plus untracked tests/structure-block-number-start.test.ts and evals/structure-id-pattern/. Scope:
- src/structure.ts: the two prompt passages, `blockNumberSchema` on `start` at both depths;
- src/structure-starts.ts: `startAsId`, and its use in `modelNodeFromStarts`;
- src/structure-prompt.ts: `toc/13`;
- src/start-ranges.ts: `splicedLineNumber` and the "line-number" outcome removed;
- src/structure.ts and src/pipeline.ts: `startsRecovered` removed;
- tests: structure-block-number-start (new), structure-step-invented-starts, structure-whole-document-reask, structure-step-expand;
- docs: structure-step.md, prompting-guide.md, and 261019l's status line;
- evals/structure-id-pattern/run.ts, the measuring harness.

Check in particular:
1. That every path that parses a whole-document answer passes the same block array the prompt numbered. That means treeFrom, the checkpoint gate `usableWholeDocument`, the long-document slices in src/structure-slices.ts, and any eval or script that calls `parseWholeDocumentAnswer` or `modelNodeFromStarts`. A slice is numbered from 0. Any caller that numbers one array and parses against another would make every number a silent wrong boundary.
2. Whether anything else reads `start` as a string. Candidates are the heading snap, `sourceHeading` handling, the scoped expansion (src/structure-expand.ts, src/structure-cascade.ts), checkpoint fingerprints, the canonical request digest, and eval harnesses under evals/ such as evals/paperwork/structure-parse.ts, structure-starts-replay.ts and evals/long-structure. Do they now break or mis-score on integer answers?
3. Whether `startAsId` mapping before the kernel loses anything the kernel used `start` for: error messages via `nameValue`, the drop budget's `drops`, and `sourceHeading`.
4. Stale comments or docs anywhere that still say the whole-document answer carries ids, or that describe the removed decoder or `startsRecovered`. Grep for "firstBlockId", "id of the first block", "splice", "line-number", "startsRecovered", "toc/12".
5. Whether the treeFrom failure-message branch that lists `unresolvedStarts` is still reachable and tested.

Run `npm run typecheck` and the touched test files (`npx vitest run <files>`); I run the full suite separately.

Write your findings to the output file as a numbered list. For each, say what you found, what you changed (file:line) or why you left it, and its severity. End with a one-line verdict: "ship", "ship after my fixes", or "do not ship".
