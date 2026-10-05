# A refetch cannot tell "never had" from "no longer has"

Up: [postmortems.md](../project/postmortems.md).

Found on 2026-10-05 from a red test on `dev`, not from a reader. It was not deployed:
`eaf3a3fee` is not an ancestor of `main`.

## What happened

A reader presses the "?" beside a paragraph. The floating chat dialog opens and the question is
sent. If that first POST fails before its thread is stored (for example, a request validation or
database failure), the dialog closed by itself a moment later, taking with it the only sentence
that said why. A provider failure happens after the thread is stored; a network failure alone
does not tell us whether it was stored.

The same change turned four cases of
[`question-press-answer-does-not-loop.test.tsx`](../../tests/question-press-answer-does-not-loop.test.tsx)
red, and those four were the test's fault: its stub server took the POST and then went on
answering "no conversations" when asked for the list after the stream ended. The real route
awaits the transaction that stores the thread before sending the first stream frame
([`routes.ts`](../../src/routes.ts) § `streamChat`,
[`pg-chat.ts`](../../src/store/pg-chat.ts) § `begin`). Without a concurrent deletion, that later
GET has the thread. The stub now remembers what it was sent. The new refused-POST case was
red for the product.

## The root cause

The dialog is drawn only while the reading view's list of conversation summaries has a row for
it ([`Reader.tsx`](../../src/web/reader/Reader.tsx) § `overlay`, which asks for
`kind === "chat"` on purpose). The dialog puts that row there itself, at once, when the reader
sends ([`ChatDialog.tsx`](../../src/web/ChatDialog.tsx) § `onCreated`), before the server has
said anything.

Until `eaf3a3fee` that list was fetched once per article and never again, so a row put there by
hand stayed. `eaf3a3fee` added `refresh()`: ask the server again when an answer stops arriving,
and when the reader leaves Chat. It guarded the race it knew about, a write made *while* the
request is in the air (`written`, `dropped`). Its rule for everything else was "a row the server
no longer has goes".

A refused first question also "stops arriving", so it also asks again. The server never made
that conversation, the row was added before the request went out, and so it was in neither
guard. The fold read it as deleted elsewhere and removed it.

There is a second way in, narrower and not seen: a refresh sent for another reason (leaving
Chat, opening a claim's chat) can read its snapshot before the POST commits the new thread,
then deliver that stale list after the stream has begun. The row was added before this GET,
so the same fold can remove it while the answer is still streaming.

## The class

**A reconciliation that reads absence from a snapshot as deletion, when the local row is one the
snapshot's author has never been shown to have.** "No longer has" is a claim about two moments,
and the code had only one. An optimistic row has three states, not two: the server has it, the
server had it and dropped it, and the server has not got it yet (or never will). A fold with only
"present" and "absent" files the third under the second.

It is easy to walk into because the first fetch cannot show it: the list starts empty, so
everything in it was written during the flight and is protected. The hook's own comment said so
("the local writes *are* the state"). The assumption stopped being true the moment a second fetch
existed, and nothing in the code marked which rows it had covered.

## Which commit

`eaf3a3fee`, *261005i: a chat thread records where it was started* (2026-10-05 16:43), found
with `git bisect run` on the red test. Its message says what it had not run: *"Not yet run: the
full suite, the GPT Sol code review, the browser check."* The review ran afterwards
(`1cf578937`) and found six other things. The introducing commit records 136 neighbouring test
files green. The [plan's log](../plans/261005i-chats-started-from-a-mode-a-thread-remembers-where-it-began.md)
records that the full suite was not run, on the Overseer's instruction while the box was loaded;
these four reds were found later.

## The fix

Landed with this file: the hook remembers which rows `add` put there that no answer
from the server has ever contained (`unseen` in
[`useChatAnchors.ts`](../../src/web/useChatAnchors.ts)). Such a row survives any refetch until
an answer names it or `drop` takes it. Only a response that actually lands confirms an id;
superseded responses do not count. Confirmed ids stay confirmed for this article, even if `add`
replaces their local row. When the server first names a row added before the fetch, its copy
replaces the optimistic summary; local writes during that fetch still win.

What it costs: a conversation whose first question was refused keeps its mark on the paragraph
until the reader discards it or reloads. That is what happened before `eaf3a3fee` too, and it is
the right side to fail on, because the dialog still holds the reader's question and a way to try
again.

The same trade-off applies if the server accepted the thread but another tab deleted it before
any list response here named it. This tab cannot distinguish that absence from a refused first
POST: it keeps the row until a local discard or reload. Confirmation and unseen ids are reset
on an article change and discarded with the hook on unmount.

Found by GPT Sol's review of this fix, and done later the same day
([261005n](../plans/261005n-chat-guessed-id-reconciled-with-the-stored-one.md)): the tab guesses a
new conversation's id and the server stores another when a message uses the guess, including
one minted for this turn ([`chat.ts`](../../src/chat.ts) § `taken`, `withTurn`). The row under
the guess is then one no answer will ever name, so it stayed beside the real row until a reload, and the paragraph counted
one conversation as two. It needs two random ids to collide. The red test showed more
than the count: `?thread=` followed the server's id while the row stayed under the guess, so the
dialog closed on the answer's first frame, which predates this postmortem's fix. The dialog now
renames the row when it hears the real id ([`ChatDialog.tsx`](../../src/web/ChatDialog.tsx) §
`onConfirmed`, [`useChatAnchors.ts`](../../src/web/useChatAnchors.ts) § `rename`).

Also not done: the overlay still depends on a summary row to draw a dialog whose
real state lives in the chat store. Drawing it from the chat store's own thread would remove the
dependency. That is a larger change to a rule (`kind === "chat"`, positively) that exists for a
reason, and nothing here needs it.

## What would have caught it, ranked by ease against value

1. **A stub server that remembers what it was sent.** Done, in the test that went red. A stub
   that always answers an empty list contradicts this test's successful POST with no concurrent
   deletion once the code asks again. It fails for the wrong reason while hiding the right one.
   The four fixture reds and the one product red looked the same from outside.
2. **When a fetch-once list becomes fetch-again, test a row the server has never listed.** Done:
   cases in
   [`chat-anchors-refresh.test.tsx`](../../tests/chat-anchors-refresh.test.tsx). The existing
   local-write cases covered changes during a request. None covered an unconfirmed add before
   a later request.
3. **Run the full suite before a change lands, or have something say that it has not been.**
   [readiness.md](../project/readiness.md) records whether this box's cached `origin/dev` is known
   to pass; a plain test run cannot make that verdict green. Deployment independently runs
   typecheck and tests ([`deploy.ts`](../../scripts/deploy.ts) § `gate("test", …)`), rather than reading
   those records. The introducing commit is not on `main`; that alone does not establish that a
   deploy was attempted or stopped. Rejected as a new action: a harder gate on pushes to `dev`
   would also block unrelated work during overload, while deployment already has its own checks.
4. A type that makes an optimistic row a different kind from a confirmed one, so a fold cannot
   treat them alike. Rejected for now: `ThreadSummary` is shared with the server, and private
   bookkeeping in one hook does the job. Worth it if a second list grows the same shape.

## See also

- [261005l](261005l-a-failed-submission-hides-a-pending-origin-behind-a-missing-local-thread.md),
  from the review of the same commit: another failed first Send, another piece of state that did
  not survive it.
- [silent-success.md](../reusable/silent-success.md): the fixture half of this is that shape in
  reverse, a check that failed for a reason unrelated to the product's real fault.
