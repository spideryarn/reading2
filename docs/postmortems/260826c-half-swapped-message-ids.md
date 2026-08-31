# The id swap that only swapped half the turn

**2026-08-26.** Reported by Greg, from ordinary use:

> I tried editing a previous message, and got "That message is not in this conversation."

He was right, it did, and it did it every single time — for any question asked in the current tab
without a reload in between. Which means the feature shipped that morning
([260826a-chat-mode.md § Editing a question](../plans/260826a-chat-mode.md#editing-a-question)) had never worked at
all outside the case where the reader happened to reload first. Two reviews, a browser pass and a
test suite went past it.

## What the code did

Chat rows are optimistic. The reader presses Enter and their words appear immediately, under an id
this tab invented, because waiting for a round trip to render your own sentence feels broken:

```ts
// src/web/useChat.ts, send()
const user: ChatMessage = { id: mintId(), role: "user", text: question, … };
const reply: ChatMessage = { id: pendingId, role: "assistant", text: "", status: "pending" };
```

The server mints its own ids when it writes the turn down, and tells the client what they are in the
first frame of the stream:

```ts
// src/routes.ts, streamChat()
frame("begin", { threadId: thread.id, title: thread.title, messageId: reply.id });
```

Count the ids. The client invented **three** — a thread and two messages. The frame corrected
**two**. The reader's own question kept the name this tab made up, for ever, and every later request
that named that row was naming something the server had never heard of.

`withEdit` looks the row up by id and refuses what it cannot find:

```ts
// src/chat.ts
const index = existing.messages.findIndex((m) => m.id === messageId);
if (index < 0) throw new ChatConflict("That message is not in this conversation.");
```

The error message was accurate. It just described the client's mistake rather than the reader's.

## Why nothing caught it

**Nothing renders an id.** That is the whole answer, and it is the
[silent-success](../reusable/silent-success.md) shape exactly: for weeks the wrong id sat in
component state, was passed through renders, was used as a React `key`, and produced a screen
indistinguishable from the correct one. There is no check you could have run in a browser that would
have come back wrong, because every check anyone would think to run — is the question there, does it
say the right thing, does the answer stream in under it — asks about the *text*.

**The half that was tested was the half that worked.** The assistant row's id *is* followed, and
there is a comment in `useChat.ts` explaining why, written when the stop button needed it:

> the `begin` frame carried one and the client kept its own, so the two disagreed until the next
> reload. Nothing rendered from it, so nothing showed — until `stop` needed to name the row it
> wanted stopped

So the bug had already been found once, on the other row, and fixed **only on the row that had
surfaced it**. The comment even states the general rule and then does not apply it. That is the
mistake: the fix was scoped to the symptom rather than to the class, and the class was one line
wide.

**The tests tested the two halves and not the join.** `tests/chat.test.ts` covered `withEdit`
thoroughly — that it truncates, that it renames the thread only for the first question, that it
mints against discarded ids. Every one of those tests hands `withEdit` a message id that is in the
array, because the test author knows which ids exist. And on the client side there was nothing to
test, because the swap was four lines inline in a `useCallback` inside a hook this repo has no way to
render. Both halves were individually correct. The turn was not.

**The browser pass had reloaded.** The 2026-08-26 verification of retry/edit/stop
([260826a-chat-mode.md § What a browser pass found](../plans/260826a-chat-mode.md)) drove the panel hard and reported
9/10 PASS, edit included. It had loaded conversations from disk to test against — which is the one
state in which every id on screen is the server's, because they were read from the server. The bug
needs a question asked and edited *in the same page load*. Test data that came from the store cannot
reproduce a bug about ids that did not.

## The fix

The frame names both rows, and the client believes it about both:

```ts
frame("begin", { threadId: thread.id, title: thread.title, messageId: reply.id, questionId: user.id });
```

Two things about it are deliberate.

**All three kinds of turn send it**, though only an ordinary send strictly needs it — a retry and an
edit reuse rows the server has already named. "Usually the client already has the right id" is not
worth reasoning about per-turn; one rule, always true, is cheaper to be sure of than three.

**The client finds the question by position, not by id** — the user row immediately above the
pending answer:

```ts
if (begun.questionId && m.role === "user" && t.messages[i + 1]?.id === pendingId) …
```

Looking it up by id would be circular. The id is the thing that is wrong; a turn is the thing that
is not.

`asked` on the server changed with it. It used to read `"question" in begun ? begun.question : …`,
branching on which kind of turn it was; it now reads `user.text` for all three, so **the question
that was stored is the question that gets asked**, with no second rule for retries. `withRetry`
returns the whole message rather than its text to make that possible.

## What would have caught it earlier, and now does

A test at the **join**, which is where the bug was:
[`tests/chat-route.test.ts`](../../tests/chat-route.test.ts) drives the real route with a stubbed
`fetch`, reads the `begin` frame, and asserts every id in it matches the file that was just written.
Removing `questionId` from the frame turns all three of its cases red. It was written by asking a
different question from the one the existing tests ask — not "does this function do the right thing"
but "do the two sides agree about what things are called".

The client half is now [`withServerIds`](../../src/web/useChat.ts), pulled out of the hook as a pure
function for exactly the reason `withRetry` and `withEdit` were pulled out of `retryTurn` and
`editTurn`: a rule about ids that nothing renders needs a test, and a rule buried in a `useCallback`
in a React hook cannot have one in this repo.

## The lesson worth carrying

**When you find a value the client invented and the server later renamed, look for the other ones.**
Optimistic UI mints ids in threes and fours — a thread, a question, an answer, sometimes a job — and
they are corrected one at a time, as each becomes load-bearing for some feature. The ones that are
not load-bearing yet are wrong *right now* and silent about it, and they will surface as an
inexplicable error message in whatever feature needs them next, months later, far from here.

The general form: **a fix scoped to the symptom, in a codebase where the same mistake is one line
away, is half a fix.** The comment in `useChat.ts` proves the author understood the rule at the time.
Understanding it was not enough; grepping for the other instance would have been.

## See also

- [260826a-chat-mode.md](../plans/260826a-chat-mode.md) — the plan, and the two reviews that missed this
- [silent-success.md](../reusable/silent-success.md) — the pattern; this is a clean specimen of the
  "the check you would naturally run shares an assumption with the code" variety
- [block-ids.md](../project/block-ids.md) — the app's other id contract, which is careful about
  exactly this and says why
