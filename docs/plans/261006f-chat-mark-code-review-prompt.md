# Code review: a chat's mark shows its latest answer in plain words (261006f, one stage)

You may edit files. Fix what is inside this stage, narrowly, with a failing test first. Report,
do not fix, anything wider you notice. Do not commit. Do not invent quotations from anyone; if you
edit a doc, state facts only.

The plan: `docs/plans/261006f-chat-mark-latest-line-without-references-or-markdown.md` (read its
Log: your plan review's five findings were all taken).

The stage is the last commit on this branch: `git show HEAD`. The files:

- `src/answer-opening.ts` (new: `answerOpening`, and `withoutBlockIds` moved from `src/live.ts`)
- `src/live.ts` (imports and re-exports `withoutBlockIds`)
- `src/routes.ts` § `summarise` (now exported; uses `answerOpening(answerAsSeen(...))`)
- `src/web/ChatDialog.tsx` § `cardLine`
- `tests/answer-opening.test.ts` (new), `tests/chat-dialog-in-column.test.tsx` (one test added)
- `docs/project/architecture.md`, `docs/project/debate.md` (a line each)

Run these yourself; they need nothing outside the tree:

```
npx vitest run tests/answer-opening.test.ts tests/chat-dialog-in-column.test.tsx tests/live-seed.test.ts
```

My results: 61 passed; `npm run typecheck` clean.

Look for:

1. An answer whose preview is now false, empty when it should not be, or worse than the raw first
   line was. Try real shapes: nested lists, a link whose label is a URL, an image, escaped
   characters, a half-written answer in `cardLine` (unclosed `**`, an open code fence), a reference
   link with a definition, CRLF line endings.
2. `withoutBlockIds` run on a flattened line: does `webLinks` still protect what it protected on
   raw text, and can flattening a markdown link create an id-shaped string that is then deleted?
3. Whether the move changed `withoutBlockIds` or Live's seed in any way.
4. Cost: `summarise` runs once per thread on the summaries route and now parses markdown. Is there
   an answer length where that matters?
5. Anything in the two doc lines that is not true of the code.

My own suspicions, last: the depth cap returns source characters, markdown included, for the deep
part; and `summarise` being exported from `routes.ts` only for a test.

Answer in the output file with findings ranked P1/P2/P3, each with an ID, file and line, what you
changed for it (or "reported only"), and a verdict: approve, approve with changes, or rethink.
