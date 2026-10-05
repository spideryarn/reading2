Implemented five in-scope fixes:

- **C1 — P1 — Fixed:** Table topics vanished during title renaming. They now remain beside the editor, with a regression test observed red then green. [library-columns.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbmtajjy-topic-pills-on-shelf-rows/src/web/library-columns.tsx:352), [shelf-topics.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbmtajjy-topic-pills-on-shelf-rows/tests/shelf-topics.test.tsx:966)
- **C2 — P3 — Fixed:** Docs implied table pills opened the article. Only card pills inherit the stretched link; table pills are static labels.
- **C3 — P3 — Fixed:** The plan claimed cards became exactly one line taller, although pills can wrap onto further lines.
- **C4 — P3 — Fixed:** `/help` implied topics are always model-named, omitting the phrase-topic fallback. [help-topics.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbmtajjy-topic-pills-on-shelf-rows/src/web/help/help-topics.tsx:621)
- **C5 — P3 — Fixed:** The plan documented a nonexistent `rowTopics(topics, cap)` parameter.

All five earlier plan-review findings were genuinely addressed. The context value is identity-stable, late answers update memoised table cells, the `<ul>` is valid inside the table cell, and `tw:sr-only` is available under the configured prefix.

Checks:

- Requested Vitest command: 82 tests passed.
- Equivalent no-IPC typecheck: all four projects and 3,039 source files passed. The exact npm wrapper was blocked before execution by the sandbox denying `tsx`’s local IPC pipe.
- `git diff --check`: passed.
- No commit made. Untracked `261005a-shot-*.png` browser-check files were left untouched.

VERDICT: ship with the fixes I made