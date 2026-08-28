# Review the built stage 1

You reviewed this plan twice before it was fit to build (`docs/plans/chat-operation-model-sol.md`,
`...-recheck-sol.md`). Both refusals are answered in the plan and the second one changed the design:
one operations map holding every kind, a controller rather than a `useReducer`, three stages instead
of four, `legacy.apply` confined to stage 1, and supersession so two renames finishing out of order
cannot put the replaced title back.

**Stage 1 is built and committed as `6f35022`.** Review the code, not the plan.

## What to read

- `git show 6f35022` — the whole stage. 7 files, +1773 / −402.
- `src/web/chat/{model,reduce,project,controller}.ts` — new.
- `src/web/useChat.ts` — now 1656 lines, three refs lighter.
- `tests/chat-reduce.test.ts` — 18 dependency-free tests.
- `docs/plans/chat-operation-model.md`, especially § *What stage 1 actually did*, which records four
  places the plan was silent or wrong.
- The characterisation net, written this morning against the **old** code and committed before the
  refactor: `tests/chat-write-paths.test.ts` (5), `tests/chat-turn-paths.test.ts` (2),
  `tests/chat-intent-paths.test.ts` (4). Every one was watched red against a probe first. All 11 pass
  against the new code, unedited.

## The evidence

`npm test`: 4757 of 4758 pass. The one failure is `tests/store-jobs-parity.test.ts`, a file another
agent is editing; it imports no chat code and passes 42/42 in isolation. `npm run typecheck` clean
across all three projects.

The gate was watched failing. Making `withoutOp` a no-op and letting `load.started` keep the earlier
load — so nothing ever retires — turns four red:

```
× refuses a superseded load's success
× refuses a superseded load's failure
× leaves the newer title on screen when the older one answers last
× keeps the title when a rename succeeds and the operation retires
```

The first pair is the point of the stage: bugs 10 and 12 were one stale-load bug found a day apart,
once on the success path and once in the `catch`, and one deleted gate now turns both red together.

Worth saying because it nearly went unnoticed: my first probe was weaker and turned only two red. It
admitted results against "any operation in the map", and in the stale-load-*failure* test the map is
empty by then, so the test passed for the wrong reason. Also, `refuses a rename that fails after the
reader has moved on` cannot be made red by damaging the gate at all — it dispatches into a fresh
state for another article — so it pins per-article isolation rather than the gate. I am not counting
it as gate evidence.

## What I need judged

1. **Is the gate actually load-bearing, or does something still write around it?** `legacy.apply` is
   the obvious hole and is meant to be: it is stage-1-only, carries a dev-only assertion that no turn
   operation is live, and stage 2 deletes it. Is that assertion sufficient, and is there any path in
   the current file that writes state without going through `reduce`?
2. **One deliberate behaviour change.** `cancelAndDiscard` no longer keeps a rollback copy: the
   conversation stays in `base`, the tombstone projects it away, and removing the tombstone is the
   restore. Is that equivalent to what it replaced in every case, including a cancel refused while
   another operation is live on the same conversation?
3. **Supersession.** A rename supersedes the previous rename of the same conversation; both its
   answers commit the title unless it was superseded; a delete supersedes everything for that
   conversation. Are there orderings where this is still wrong?
4. **The controller's lifecycle.** It is latched in a `useRef` and replaced when the slug changes,
   read through `useSyncExternalStore` with a cached projection. Is that safe under `StrictMode`'s
   double mount, and does anything tear between the render that swaps it and the effect that
   resubscribes?
5. **Is stage 2 still the right next move as the plan describes it**, now that you can see the shape
   the code actually took?

Read-only. Change no file. If it should not ship, say so — it is already committed, and a revert is
cheaper than a stage 2 built on it.
