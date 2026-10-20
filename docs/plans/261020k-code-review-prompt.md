Code review of plan docs/plans/261020k-reading-another-conversation-in-full.md (read it first,
and its plan review docs/plans/261020k-plan-review-sol.md). The diff is
docs/plans/261020k-code-review.diff (commit HEAD; `git show HEAD`).

Files: src/reader-notes.ts (threadTranscript, exchangeLines, the constants), src/chat-tools.ts
(READER_NOTES_TOOL, readReaderNotes), src/converse.ts (two prompt paragraphs),
tests/reader-notes-tool.test.ts.

FIRST write your findings to docs/plans/261020k-code-review-findings-sol.md (numbered F1..Fn,
severity, file:line, concrete failure scenario). THEN fix what you are confident of, inside these
files only, and add or adjust tests so each fix has a test that would fail without it. Do not
commit. Do not touch the database, .env files or anything outside this worktree. Report anything
wider than these files for me to decide.

Look especially for:
- off-by-ones in `end`, `first`, `last` and the headings, across before = undefined, 1, 2, total,
  total+1, total+2, and pages where the budget drops the oldest rows (the while loop that shifts
  `shown`): can a heading ever claim "All N are below" or "the start of the conversation" when it
  is not, or name a `before` that skips or repeats an exchange?
- the shown.length === 0 branch: reachable? correct `before` to step past?
- `before` parsing in readReaderNotes: numbers, numeric strings, booleans, objects, arrays, "1e1",
  " 3 ", negative, huge, -0; and `before` without `thread`.
- whether the budget remains hard (content.length <= TRANSCRIPT_CHARS) in every branch.
- whether the prompt/tool wording now promises anything the code does not do.
- anything that leaks a thread id, title or text into ToolRun label/detail or the log.

Run: npx vitest run tests/reader-notes-tool.test.ts tests/reader-notes-owner-isolation.test.ts
tests/chat-tools.test.ts tests/guide-tool-gate.test.ts and npm run typecheck after your fixes, and
say in your answer whether they passed.
