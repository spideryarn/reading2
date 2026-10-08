# Review: plan 261008c — Chat's way back to the list on a phone, the model and thinking level in a thread's (i), and Top/↑/↓ between messages

Repo: this worktree (Spideryarn, TypeScript + ESM, React client in `src/web/`, Postgres via
Drizzle, `tsx`, vitest). Read `CLAUDE.md` for the house rules.

## The candidate

Live pre-commit candidate, base `origin/dev` at the worktree's merge-base (`git merge-base HEAD
origin/dev`). This is a **plan review**: read the plan as the thing under review.

- The plan: `docs/plans/261008c-chat-back-to-the-list-on-a-phone-the-model-in-the-thread-s-i-and-step-between-messages.md`
- Already drafted, for context (untracked or modified — `git status` lists them):
  `src/web/chat-steps.ts` (new), `tests/chat-steps.test.ts` (new), `src/web/ChatPanel.tsx`
  (the `Conversation` step row: `steps`, `reach`, `measureSteps`, `step`),
  `src/web/styles/chat-actions.css` (`.chat-steps`), `tests/chat-streamed-answer-stays.test.tsx`
  (a new `describe("the step buttons")` at the end).

Start with the plan, then `src/web/ChatPanel.tsx` (`ChatPanel`'s `head`, and `Conversation`'s hold
logic — `settle`, `noteAnchor`, `toBottom`, the `onScroll`), `src/web/keynav.ts` § `stepTarget`,
`src/ai-call.ts` § `CHAT_REASONING` and `wireEffort`, `src/converse.ts` (the `done` event),
`src/store/pg-chat.ts`, `src/types.ts` § `ChatMessage`, `src/web/BandAbout.tsx`,
`src/web/ModeSurface.tsx`. This list does not limit scope.

You may run `npx vitest run tests/chat-steps.test.ts tests/chat-streamed-answer-stays.test.tsx`
(jsdom, nothing outside the tree).

## What to do

An independent pass first: is this the right plan for Greg's three asks (quoted at the top of the
plan)? Is anything in it wrong, over-built or under-built? In particular judge:

1. The way-back fix in § 1, against the measured cause written there.
2. § 2's decision to **store** the thinking effort per answer (a new nullable column) rather than
   derive it at render time from the model id. Is the column worth it? Is `wireEffort` the right
   single source? Is "default" vs null the right encoding? Anything on the read paths (export,
   public reader, the browser's chat model, the controller's reducers) the plan forgot?
3. § 3's step row: when it shows, the arithmetic, and whether it can fight the streamed-answer
   hold (`docs/plans/261005f-a-streamed-answer-stays-where-it-starts.md`). Whether showing it on
   every overflowing transcript (also in the block-chat dialog and the Marginalia card) is right.

## Severity and IDs

P0 data loss / security / charging / broadly unusable; P1 user-visible wrong behaviour or a
contract violated; P2 design/maintainability risk, no wrong behaviour today; P3 prose. Refuse only
on an established P0/P1. Number findings F1, F2, …. Read-only: change no files.

## My own suspicions (worth less than your independent pass; spend most of the run elsewhere)

- The step row appearing whenever the transcript overflows costs a permanent ~30px row on a phone.
- `measureSteps` is called from a layout effect on every streamed word; it only sets state on a
  change — check that is actually true and cannot loop (postmortem 260915a).
- Whether storing `effort` is over-engineering for a line in a tooltip.

End with a verdict line: `VERDICT: approve` or `VERDICT: approve with changes` or `VERDICT: refuse`.
