Accepted: no P0/P1 findings and no functional defect found in the candidate.

Findings:

- **F4 — P2, established and fixed:** the ID-uniqueness test did not reach the `used` guard; identical suggestions were deduplicated first. Removing the guard still passed. The revised test uses two non-overlapping NFKC-equivalent passages and fails with duplicate IDs when the guard is removed. [tests/quotes.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/tests/quotes.test.ts:497)

- **F5 — P2, established and fixed:** the rule that unparseable versions are treated as current was untested. Relaxing the anchored parser made `quotes/3-extra` outdated without failing the suite. Added the boundary test. [tests/quotes-find-more.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/tests/quotes-find-more.test.ts:112)

- **F6 — P2, established and fixed:** stale and outdated together was untested. Changing inheritance to depend only on outdatedness moved an old ID across changed article content without failing the previous tests. The stale test now covers an outdated stale list and proves the ID stays fresh. [tests/quotes-find-more-stage.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/tests/quotes-find-more-stage.test.ts:145)

- **F7 — P3, established, not changed because it is outside the allowed list:** the live `Quotes` type comment still says “only a stale list is replaced.” It should say “a stale or outdated list is replaced.” [src/types.ts](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/src/types.ts:1123)

Your suspicions:

- Keeping `existing.version` inside `buildQuotes` is a good defensive belt. Production no longer reaches it with an outdated list, but the helper remains honest if another caller does.
- The banner copy is accurate, including for historically mixed lists. I would keep it.

Verification:

- 4 scoped test files: 82 passed.
- Changed-test lint: passed.
- Typecheck: all projects passed via `node --import tsx scripts/typecheck.ts`.
- Diff whitespace check: passed.
- No commit made.

Files I changed:

- `tests/quotes.test.ts`
- `tests/quotes-find-more.test.ts`
- `tests/quotes-find-more-stage.test.ts`