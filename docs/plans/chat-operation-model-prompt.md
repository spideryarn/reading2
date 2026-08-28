# Review this build plan before anything is built

You advised on this codebase yesterday, 2026-08-28, on whether `src/web/useChat.ts` needed
rearchitecting. Your answer is in `docs/plans/chat-client-architecture-sol.md` — the operation model,
the admission gate, the staged path 1–4. Step 1 was built from it and you reviewed the code twice
(`docs/plans/chat-client-architecture-review-sol.md`, `...-recheck-sol.md`); both blockers you raised
were fixed and it is committed as `2d0449e`.

Greg has now asked for steps 2–4 to be built. **`docs/plans/chat-operation-model.md` is the build
plan.** Review it before any code is written.

## What to read

- `docs/plans/chat-operation-model.md` — the plan under review.
- `docs/plans/chat-client-architecture.md` — the strategy it implements, including what step 1
  actually built and the three claims I got wrong along the way.
- `docs/plans/chat-client-architecture-sol.md` — your own answer, for what I have changed and why.
- `src/web/useChat.ts` — 1734 lines, ten refs, the subject.
- `src/web/ChatPanel.tsx`, `src/web/App.tsx` (`ConversationBand`, ~line 2151), `src/web/ChatDialog.tsx`
  — the two mounts and the consumer of `ChatApi`.
- `src/routes.ts` and `src/chat.ts` for the server contract, which is not changing.
- The chat suites in `tests/` — the contract this must keep green.

## The questions I actually need answered

1. **Is `base` = "what this tab believes" a mistake?** Your sketch put only server facts in `base`
   and made everything an operation. I have put `begin`, `discard` and `rename` — local, structural,
   not turns — directly into `base`, and kept `operations` for turns alone. Does that break anything
   the operation model buys, or is it the right narrowing? Be specific about which of the twelve bugs
   or which invariant it would let through if it is wrong.

2. **Are the four stage boundaries in the right places?** Each is supposed to end with the tree
   green, committable and deployable. Is any of them not actually shippable on its own — in
   particular stage 2, which leaves a turn as an operation while stop, cancel and recovery are still
   the old refs?

3. **Is the `legacy.apply` escape hatch safe, or does it reintroduce the thing we are removing?**
   It carries a pure updater for `base` and is exempt from the admission gate, because the callers
   that use it have no `opId` yet. That is precisely an unguarded write path, living inside the
   machine whose whole point is not to have one. Say whether it should be scoped harder — for
   instance, an allowlist of callers, or a slug carried on it and checked — or whether the staging
   should change so it never exists.

4. **The order of stages 2 and 3.** Turn-as-operation first, then intent/recovery/409. Stop and
   cancel intent currently lives in two sets keyed by *message id* and consumed inside `run`'s
   `begin` handler. Does migrating the turn without migrating intent leave a window where a stop
   pressed before `begin` is dropped?

5. **What have I not thought about?** Particularly: StrictMode's double-invoked reducer, the
   projection's cost on every delta of a streaming answer (`ConversationBand` renders the article),
   and anything in `ChatApi`'s current behaviour that a projection would change without meaning to.

## Ground rules

Read-only. Do not change any file. If the plan is fit to build, say so plainly and say which stage to
start with; if it is not, say what must change first. Judge the plan, not my prose — but if a claim
in it is false, say so, because two of the three things you caught yesterday were confident sentences
about what a reader could reach.
