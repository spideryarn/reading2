# Review: Chat's list shows every conversation about the article, with its source and a filter

Repo: this worktree, branch `worktree-chats-started-from-a-mode`. TypeScript + ESM, a React client
under `src/web/`.

## The candidate

Committed: commit `94822496f` alone.
`git diff 94822496f^..94822496f`; `git show --stat 94822496f` prints its 20 paths.

Start with: `src/web/modes/conversation/ConversationModes.tsx`, `src/web/ChatPanel.tsx`
(§ `ThreadList`, `ThreadSourceMark`), `src/web/thread-source.ts`, `src/web/params.ts`
(§ `chatFromParam`), `src/web/mode-icons.ts`, `src/web/Dock.tsx`. This is where to begin, not the
limit: the commit is.

## What it is meant to do

The plan is `docs/plans/261005i-chats-started-from-a-mode-a-thread-remembers-where-it-began.md`;
this commit is its stage "Chat lists every conversation, with its source and a filter" (decision
D5; plan-review findings F3 and F6). No schema or server change.

The contract:

- Chat mode's list shows conversations of kind `chat`, `remember`, `tutorial` and `explore`. Never
  `candidates`.
- A row from elsewhere has a source icon with a tooltip, decided by one pure function,
  `threadSource`. It works with a pointer, a keyboard and a finger.
- What Chat lists and what Chat may open are separate sets. Chat's band never makes a non-chat
  thread its open conversation, never sends a turn into one, never keys a draft on one. A
  `?thread=` naming a non-chat thread is cleared (history replace) and the list shown. An article
  whose only conversations are Remember's shows those rows, and the reader can still start a new
  chat.
- Pressing a Remember row goes to Remember on that sub-mode with `mode`, `remember` and `thread`
  set in one navigation. A Remember row has no rename and no delete.
- The filter is `?chatfrom=` (absent means All), drawn only when more than one source is present,
  and a choice whose source is gone becomes All. It never produces an empty list with no way out.
- Remember mode itself is unchanged: one conversation per sub-mode, and no list of other
  conversations.
- Stage 1's behaviour is intact: a pending origin on a handed-over draft, Live withheld until the
  first typed Send, the claim's mark in Debate, an origin row's icon.
- The Dock draws exactly the icons it drew before; there is one icon map.
- A visitor (signed-out reader of a shared article) is unaffected: no chat, no list.

## What you can and cannot run, and what you may change

You may edit this worktree. Fix what is inside the stage under review, each finding red-first with
the test that reproduces it, and leave everything wider as a finding for me to decide. Do not
commit. List every file you changed at the end. In any doc you edit, do not write or alter a
quotation attributed to Greg. Do not write a postmortem per finding; one short one at most, and
only for a class worth naming.

You have no network. None of this stage's tests needs Postgres:
`tests/chat-lists-every-conversation.test.tsx`, `tests/chat-list-sources.test.tsx`,
`tests/thread-source.test.ts`, `tests/mode-icons.test.ts`, `tests/remember-own-thread.test.tsx`,
`tests/conversation-band-origin.test.tsx`, `tests/debate-check-claim-in-chat.test.tsx`,
`tests/last-view.test.ts`. Run them one file at a time (`npx vitest run tests/<one>`). The machine
is short of memory and vitest may refuse to start; that is not a failure of the code, retry later.

Know this about the evidence: the builder could not run vitest before writing the code, so these
tests were not seen red first. Red was shown afterwards by mutation, for the open-only-chat rule,
the cleared `?thread=`, the Remember-only arrival rule, the replace-with-All rule and the missing
rename and delete. **Nothing mutated the listing itself, the source icon, or the filter's
narrowing**, and one test ("never sends a question into a conversation of another kind") passes
with or without the change. Typecheck is clean on this commit. No browser has drawn it.

## Attack it

Independently, before you read my questions below. Break the contract above: an input, an order of
events or a mutation under which one of its sentences is false. Then say which of the tests would
still pass with its feature removed.

For each finding give:
  - an ID, numbered from CR-7 (CR-1 to CR-6 are taken by stage 1), a severity (P0/P1/P2/P3), and
    whether it is established or reasoned
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

- The effect that clears a non-chat `?thread=` is guarded on the address still saying `mode=chat`,
  because it once wiped the id a Remember-row press had just written. Is that guard right, or does
  it read the address in a way that races the navigation?
- `chatfrom` was added to `last-view.ts`'s `REMEMBERED`. Should a filter come back with an
  article's last view, and can a remembered filter hide the conversation a restored `?thread=`
  names?
- A Remember row is titled by its sub-mode, not its stored title. Is anything else (rename, the
  tooltip, sorting, `aria-label`) still reading the stored title in a way that now disagrees?
- The source icon became a `<button>` inside or beside the row's own button. Nested interactive
  content, focus order, and a tap on the icon also opening the row.
- Draft restore and the arrival rule now look at listable conversations. Can Chat be left with no
  open conversation, no list and no composer?
- `tests/remember-own-thread.test.tsx` uses ids such as `spya-rem001` that do not parse as a
  `?thread=` value (the id alphabet has no 0, 1, i, l or o), so its pasted-URL cases may assert
  nothing.

