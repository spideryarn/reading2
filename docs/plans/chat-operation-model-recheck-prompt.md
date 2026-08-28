# Re-check: the revised build plan

You refused the first version of `docs/plans/chat-operation-model.md` this morning — "do not build
yet", four blockers. Your answer is in `docs/plans/chat-operation-model-sol.md`. **The plan has been
rewritten.** Read it again and say whether stage 1 can start.

## What changed, and why you should check each one rather than take my word

1. **One `operations` map holding every kind** — load, turn, recovery, rename, delete — so the gate
   is a single lookup and the load is inside it. Your blocker 1.
2. **Rename and delete became operations.** Their optimistic behaviour is unchanged (no rollback, as
   today); the operation exists to admit the completion. I have also corrected the plan's claim about
   which three catches are unguarded: it is `askToStop`, `askToCancel`, and the shared `write` that
   serves *both* rename and delete — not `remove` as a third.
3. **`begin` and `discard` still write `base` directly.** You said they may. Check I have not left
   anything else in that category by mistake.
4. **Four stages became three, and the turn migration swallowed recovery and the 409** — your
   blocker 2, where I had left a live operation projecting a pending row over the old watcher's
   patch. Stop and cancel keep their two ref sets through that stage and are folded in last.
5. **A controller from stage 1, not a `useReducer` converted later** — your blocker 3. The reducer
   returns `{ state, commands }`; the controller applies an event synchronously and runs the
   commands; React sees it through `useSyncExternalStore` with one cached projection. This is a
   bigger change than you asked for and is the thing I most want you to push on: it pulls your
   original step 3 into the spine of stage 1, and if it is the wrong call the cost lands early.
6. **`legacy.apply` is stage-1-only**, with a development assertion that no turn operation exists,
   and stage 2 deletes it. Your blocker 4.
7. Purity rules, structural sharing, defined ordering for two operations in one conversation, and
   your façade acceptance list, all written in.

Two of your factual corrections are in; the third I checked and you were right — that suite runs in
4.8 seconds, and the ninety-second figure was five files measured together. The claim is gone.

Also confirmed by grep, since you said existing tests do not cover it: **no test in `tests/` calls
`stop` or `cancelAndDiscard` on the hook.** Both are now required tests in stage 3.

## What I need

Is stage 1 fit to start, as written? If not, say what must change. Push hardest on point 5, and on
whether three stages are each still independently shippable now that stage 2 is much larger — that is
the one I have least confidence in.

Read-only. Change no file. The plan is `docs/plans/chat-operation-model.md`; the code is
`src/web/useChat.ts` and the chat suites in `tests/`.
