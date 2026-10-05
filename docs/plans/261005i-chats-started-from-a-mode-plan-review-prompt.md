# Review: a plan for chat threads that record which mode and item they were started from

Repo: this worktree, branch `worktree-chats-started-from-a-mode`, based on dev `8646b09ad`.
TypeScript + ESM, Postgres through drizzle (`src/db/schema.ts`, migrations in `drizzle/`), a React
client under `src/web/`.

## The candidate

Committed: the plan is one file, `docs/plans/261005i-chats-started-from-a-mode-a-thread-remembers-where-it-began.md`,
at this branch's HEAD. Nothing is built. There is no diff to read beyond that file.

Start with the plan, then the code it makes claims about. This is where to begin, not the limit:

- `src/db/schema.ts` § `chatThreads`; `src/types.ts` § `ThreadKind`, `ChatAnchor`, `ChatThread`, `ThreadSummary`
- `src/routes.ts` § `streamChat`, `parseAnchor`, `summarise`; `src/chat.ts` § `withTurn`, `targetOf`
- `src/store/pg-chat.ts` § `upsertThread`, `threadsFor`; `src/store/export.ts`
- `src/web/modes/conversation/ConversationModes.tsx` (the kind filter, the handoff effect, the arrival rule)
- `src/web/reader/Reader.tsx` § `handToChat`, the overlay that draws `?thread=` outside Chat
- `src/web/ChatPanel.tsx` § `ThreadList`; `src/web/ChatDialog.tsx`; `src/web/useChatAnchors.ts`; `src/web/useChat.ts` § `send`
- `src/web/DebatePanel.tsx` (the claim groups), `src/web/debate-order.ts` § `groupByClaim`
- `src/web/chat-handoff.ts`; `docs/plans/261004a-ask-about-a-summary-paragraph-in-chat.md`
- `docs/project/url-state.md`, `docs/project/chat-tools.md`, `docs/project/sql.md`, `docs/project/mode.md`

## What it is meant to do

Greg's two requests are quoted at the top of the plan. The plan must: (1) let a chat thread record
the mode and item it started from; (2) give the caller a way back to that thread and a short line
of its outcome; (3) say where the thread opens; (4) list every kind of conversation in Chat with a
source icon, tooltip and filter; (5) build a first slice end to end with one caller (Debate's
"check this claim"), with an additive migration only; (6) leave the rest as named stages and put
real product choices to Greg as plain questions.

The repo's rules that bind it: simplest version first; columns over JSON; one way of doing a thing;
no article prose or reader words in logs or error text; the reader is never charged without a
press; a visitor (signed-out reader of a shared article) has no chat.

## What you can and cannot run, and what you may change

The tree is read-only. /tmp and the node_modules caches are writable. You can run one test file
(`npx vitest run tests/<one>.test.ts`) and a script. You have no network, not even loopback, so
anything needing Postgres will skip.

## Attack it

Independently, before you read my questions below. Is each statement the plan makes about the
existing code accurate? Does the design do what Greg asked, at every window width? Will the first
build stage, as listed, produce a working feature, or is a step missing that only shows at run
time? Is there a smaller design that gives the same thing?

For each finding give:
  - an ID (F1, F2, …), a severity (P0/P1/P2/P3), and whether it is established or reasoned
  - (a) the concrete scenario the plan does not handle, or the code or contract it contradicts, with file and line
  - (b) the smallest change that closes it: exact replacement wording for the plan
A finding with no (a) goes last.

Severity: P0 data loss, exploitable security, incorrect charging, service broadly unusable. P1
user-visible wrong behaviour or an authoritative contract violated. P2 design or maintainability
risk with no wrong behaviour today. P3 non-behavioural prose defect. Grade by consequence: a
defect in the plan that would cause a P1 to ship is a P1.

Say "not ready" only on an established P0 or P1, and name what established it. End with one line:
ready, or not ready.

Also say, separately from findings, whether each of the four questions for Greg is answerable by
someone who has not read the code, and whether any of them is really a technical call I should
make myself.

## My own suspicions — read last

These are already my doubts, so confirming them is worth less than anything you find yourself.

- Does a thread opened through `?thread=` in `mode=debate` really draw in `ChatDialog` and dock,
  for a thread with no anchor? The dialog was built for passage chats; it may assume an anchor.
- Carrying the origin from the handoff to the first Send: the draft store is keyed by thread id
  and the arrival rule can move a draft to a newly begun thread. Where should the origin live so
  it cannot be dropped or attached to the wrong thread?
- The FK from `origin_block_id` to `block_identities`: right, or more than this needs?
- `origin_quote` capped at `MAX_ANCHOR_CHARS`: a claim quote should fit; will a summary paragraph
  (later stage) not? Is one cap for both wrong?
- Listing Remember threads in Chat while the band's own code assumes `threads` are all `chat`
  kind (drafts, the arrival rule that starts a new chat when the list is empty, `?thread=`
  pointing at a non-chat thread).
- The reader_notes tool and Explore's digest list "other conversations": does an origin thread
  need anything there for the first slice?

Do not change any file.
