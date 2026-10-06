# Plan review: chat keeps the previous answer when a Retry or Edit fails before the stream

Read-only review. Do not edit files.

Read `docs/plans/261006d-chat-keeps-the-previous-answer-when-a-retry-or-edit-fails-before-the-stream.md`
and check it against the code it names:

- `src/web/chat/effects.ts` § `runTurn` (which failures reach `sink.failed`, `sink.refused`, `sink.disconnected`)
- `src/web/chat/reduce.ts` § `turn.failed`, `turn.refused`, `turn.disconnected`, `repair.succeeded`, `repair.failed`, `stranded`, `commit`
- `src/web/chat/controller.ts` § `dispatch` (the `handedOver` / `finished` logic) and `#stream`
- `src/web/chat/model.ts` § `TurnOperation`, the `turn.*` events
- `src/routes.ts` around `chatStore.retry` / `chatStore.edit` and the `begin` frame, for what the
  server may have committed when a pre-stream failure reaches the browser
- `tests/unknown-thread-kind-refuses-cleanly.test.ts`, `tests/chat-reduce.test.ts`, `tests/chat-invariants.test.ts`

Questions:

1. Is the rule right: `turn.failed` on a retry or edit with `!op.began` is un-drawn and repaired like
   `turn.refused`? Name any case where this shows the reader something false, loses something, or
   leaves an operation or waiter stuck (wishes held on the turn, a superseded turn, a stop pressed
   before `begin`, the title an edit of the first question wrote into `base`, a repair superseding
   another repair).
2. Can an `error` frame reach the client before `begin`, and if so is un-draw + repair still right?
3. Is leaving a send alone right?
4. Anything an existing test or invariant asserts that this rule contradicts.
5. Is there a simpler design?

Answer with findings ranked P1/P2/P3, each with the file and line that shows it, and a verdict:
approve, approve with changes, or rethink. Be brief.
