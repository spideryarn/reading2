- **C-1 — P1 — fixed.** The splitter now preserves pre-dehyphenation entry text separately for identifier parsing, while the reader-facing entry remains dehyphenated: [citation-reference-list.ts](/home/greg/code/spideryarn2/.claude/worktrees/citations-read-the-paper/src/citation-reference-list.ts:98), [citations.ts](/home/greg/code/spideryarn2/.claude/worktrees/citations-read-the-paper/src/citations.ts:740). DOI and old-style arXiv identifiers spanning a line-end hyphen now keep Scholar search. Regression coverage is in [citations.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/citations-read-the-paper/tests/citations.test.ts:952) and [citation-reference-list.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/citations-read-the-paper/tests/citation-reference-list.test.ts:37). I saw the tests fail first: 2 failed, 72 passed.

- **C-2 — P1 — fixed and rechecked.** The conservative continuation checks still reject truncated or invented identifiers. I additionally fixed an indentation edge: leading spaces on a continuation line can no longer hide a line-end continuation. Covered at [citations.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/citations-read-the-paper/tests/citations.test.ts:958).

- **C-3 — P1 — fixed and rechecked.** Exact identifier ownership, old metadata ownership and current metadata uniqueness must agree before inheritance. Conflicts—including DOI swaps—mint fresh IDs reserved against every previous ID, so an ID cannot move to another work: [citations.ts](/home/greg/code/spideryarn2/.claude/worktrees/citations-read-the-paper/src/citations.ts:1434). No further defect found.

Verification:

- Focused tests: **74 passed**
- Biome on the four TypeScript files: passed
- `git diff --check`: passed
- Root TypeScript project: passed
- Test TypeScript project: only three unrelated concurrent stage-3 errors
- No commit made

**Verdict: ready.**