# Plan review: a chat's mark shows its latest answer in plain words

Read-only review. Do not edit files.

Read `docs/plans/261006f-chat-mark-latest-line-without-references-or-markdown.md` (untracked, in
this worktree) and check it against the code it names:

- `src/routes.ts` § `summarise`
- `src/web/OriginChat.tsx` § `OriginChatMark`
- `src/web/ChatDialog.tsx` § `cardLine`
- `src/web/useChatAnchors.ts` and every other reader of `lastLine` (`grep -rn lastLine src`)
- `src/live.ts` § `withoutBlockIds`, and `tests/live-seed.test.ts`
- `src/web/Cited.tsx` (how an answer's markdown is parsed for the reader)
- `src/recall-hint.ts` § `answerAsSeen` / `splitHint` (a Learn answer can carry a hint)

Questions:

1. Is the single-producer claim right: does anything in the browser write `lastLine`, or cut an
   answer's first line, other than `summarise` and `cardLine`?
2. Does moving `withoutBlockIds` into a pure module and calling `mdast-util-from-markdown` from
   `src/routes.ts` pull anything into the server or the client bundle that should not be there?
3. Any answer shape where `answerOpening` as specified shows the reader something false or worse
   than today: a Learn answer with an unopened hint, a table, a code block, a half-written answer
   in `cardLine`, a web link, a very long first paragraph.
4. Anything an existing test asserts that this contradicts.
5. Is there a simpler design?

Answer with findings ranked P1/P2/P3, each with an ID and the file and line that shows it, and a
verdict: approve, approve with changes, or rethink. Be brief.
