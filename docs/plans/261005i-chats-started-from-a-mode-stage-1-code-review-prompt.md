# Review: a chat thread records the mode and item it was started from; Debate's claims are the first caller

Repo: this worktree, branch `worktree-chats-started-from-a-mode`. TypeScript + ESM, Postgres through
drizzle (`src/db/schema.ts`, migrations in `drizzle/`), a React client under `src/web/`.

## The candidate

Committed: commit `eaf3a3fee` alone.
`git diff eaf3a3fee^..eaf3a3fee` — 42 paths; `git show --stat eaf3a3fee` prints them.

Start with: `src/routes.ts` (§ `streamChat`, `parseOrigin`), `src/thread-origin.ts`,
`src/store/pg-chat.ts`, `src/web/chat-draft.ts`, `src/web/modes/conversation/ConversationModes.tsx`,
`src/web/useChatAnchors.ts`, `src/web/DebatePanel.tsx`, and the migration
`drizzle/20261005150617_chat_thread_origin.sql`. This is where to begin, not the limit of what is
in scope: the commit is.

## What it is meant to do

The plan is `docs/plans/261005i-chats-started-from-a-mode-a-thread-remembers-where-it-began.md`;
this commit is its stage "a thread records its origin, and Debate's claims are the first caller"
(decisions D1, D2, D3, D4, D6, and from D5 only the icon on a list row with a stored origin). The
plan review this stage had to satisfy is
`docs/plans/261005i-chats-started-from-a-mode-plan-review-sol.md` (F1, F2, F4, F5, F7).

The contract:

- A thread's origin is four nullable columns, set once on insert, never updated. The route accepts
  it only on the turn that creates a thread, only for kind `chat`, never on a retry or edit; a
  different origin for an existing thread is a 409, the same one resent is fine. No part of the
  quote reaches an error message or a log line.
- The migration is additive only.
- A press on a claim's button spends nothing and sends nothing; it goes to Chat with a seeded,
  unsent draft that carries the origin until the server has confirmed the thread, across leaving
  Chat and coming back, a moved draft and a failed first Send. Two handoffs never share an origin.
- Live cannot create the thread while an origin is pending.
- The mark under a claim appears without a reload after the first answer, matches by block and
  exact words, and opens `?thread=` in the same mode.
- A visitor (signed-out reader of a shared article) gets neither the button nor the mark, and no
  origin or thread data crosses to a visitor.
- A thread with an origin and no anchor is never treated as a block's own chat.
- Out of scope, deliberately: listing Remember's conversations in Chat, the list filter, origins
  from Summary, Glossary or Citations.

## What you can and cannot run, and what you may change

You may edit this worktree. Fix what is inside the stage under review, each finding red-first with
the test that reproduces it, and leave everything wider as a finding for me to decide. Do not
commit. List every file you changed at the end. In any doc you edit, do not write or alter a
quotation attributed to Greg.

You have no network, not even loopback, so anything needing Postgres will skip or fail to connect:
`tests/chat-origin-route.test.ts` is one such. I ran it and its neighbours on this commit: 136
test files, 2222 tests, all passing; `npm run typecheck` clean. Tests that need nothing outside the
tree you can run one file at a time (`npx vitest run tests/<one>`), for example
`tests/conversation-band-origin.test.tsx`, `tests/chat-anchors-refresh.test.tsx`,
`tests/debate-claim-chat.test.tsx`, `tests/thread-origin-way-back.test.ts`,
`tests/chat-draft.test.ts`, `tests/debate-check-claim-in-chat.test.tsx`.

## Attack it

Independently, before you read my questions below. Break the contract above: find an input, an
order of events or a mutation under which one of its sentences is false.

For each finding give:
  - an ID, numbered from CR-1, a severity (P0/P1/P2/P3), and whether it is established or reasoned
  - (a) the input or mutation I can run that shows it
  - (b) the fix you made (or, if wider than the stage, the smallest change that would close it)
A finding with no (a) goes last.

P0 data loss, exploitable security, incorrect charging, service broadly unusable. P1 user-visible
wrong behaviour or an authoritative contract violated. P2 design or maintainability risk with no
wrong behaviour today. P3 non-behavioural prose or comment defect.

Refuse to land only on an established P0 or P1 you could not fix, and name what established it.
End with one line: land, or do not land.

## My own suspicions — read last

These are already my doubts, so confirming them is worth less than anything you find yourself.

- `useChatAnchors.refresh()` and the generalised `foldInLocalWrites`: can a refetch that started
  before a local add, drop or touch still overwrite it, or can two overlapping refreshes land out
  of order?
- The draft store keeps the origin after the server confirms the thread, and the band overlays it
  on the thread it hands the panel. Can that overlay ever show Debate's icon on a thread the server
  stored without an origin (a failed first Send followed by a spoken turn, a server-minted
  different thread id, a thread folded into another)?
- "Server confirmed" is `named(threadId)`. Is the origin sent on a second Send after the first
  succeeded but before `begin` arrived, and does the server then 409 or accept?
- The server may mint a different thread id from the client's guess (`src/chat.ts` § `withTurn`).
  Does the pending origin follow to the real id?
- The extra CHECK `chat_threads_origin_chat_only`: correct, and does anything that changes a
  thread's kind exist that it could now break?
- Export and restore: is the origin's block FK satisfied in the order rows are restored?
- The mark and the button sit inside a `<summary>`: keyboard (Enter and Space on the button must
  not toggle the details), and nested interactive content.

