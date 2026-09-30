# A "nobody has designed this" comment was overtaken by a decision elsewhere, and nothing joined them

**Feedback:** SPIDERYARN-READING2-70, Greg, 2026-09-30. Fix: [260930d plan](../plans/260930d-a-live-conversation-started-in-remember-is-saved-as-a-remember-conversation.md).

> I just had a live conversation in remember mode about what I took from it, and it was good. But
> then I went back to remember mode and it seemed to have gone.
>
> — Greg, 2026-09-30

## What happened

Most likely nothing was lost: on the ordinary path the conversation is stored as a **Chat**, and
Remember mode then looks for Remember conversations, finds none, and opens a fresh empty one. That
is the code's behaviour, not a reading of Greg's row, which this box cannot reach.

## Real root cause

Three decisions, made on three different days, each sensible alone:

1. `withSpokenTurn` (`src/chat.ts`) creates a thread that does not exist yet with a hard-coded
   `kind: "chat"`, under the comment *"a spoken Remember turn is a mode nobody has designed, so
   inventing one here … would be deciding it by accident."* A refusal to decide, recorded as prose.
2. `live-conversation.md` later decided *"Keep the existing Live control in an open Remember
   conversation too."* So a spoken Remember turn became a mode somebody had designed. Nobody went
   back to the comment, because nothing pointed at it.
3. Remember's arrival rule (`ConversationModes.tsx`, `startNew` when it owns zero threads) opens a
   local-only empty Remember thread. The comment's one unguarded case, Live pressed before any typed
   turn, had been a corner. The arrival rule made it the ordinary way in.

Spoken turns into a Remember thread that already exists keep its kind (kind is written on insert
only), so the hole was exactly "the first write to a thread happens to be spoken". The browser knew
the thread's kind; the request never carried it, so the server invented one.

## The class

**A deferral recorded as a comment, invalidated by a decision elsewhere.** "Not designed yet" is a
claim about the rest of the product, and it goes stale the moment the rest changes. The comment sat
at the one place that was wrong; the decision that falsified it was in a doc and a UI file far away.
A second half: **a new default path turning a rare unguarded case into the common one.**

## Which commits

- **`43814634`** (2026-08-31, "The expected tail is the idempotency, so there is no exchange-id
  column"): introduced `withSpokenTurn`, the hard-coded `kind: "chat"` and the comment. It is the
  first commit containing the comment text (`git log -S`). At that date Remember was still called
  Review, and Live in it was not decided either way, so the comment was true when written.
- **`7eb8f2a0`** (2026-09-06, "Make realtime chat visible, resumable and recoverable"): `git blame`
  on the `live-conversation.md` line that keeps the Live control in an open Remember conversation.
  This is the decision that made the comment false. It touched neither `chat.ts` nor the kind.
- **`2d82c0e7`** (2026-09-06, "Chat and Remember leave last…") is the earliest commit touching
  `startNew` in `ConversationModes.tsx`; the exact commit that added the `ownKind === 0` arrival
  rule was not pinned down, and does not change the argument.

## The fix that is right for the long term

A spoken write should name the kind it belongs to, and the server should honour it only when the
write creates the thread, refusing a contradiction (a thread is one kind for life). That is the
plan: `SpokenTurn.kind`, validated in the route, filled from the thread the tab began (in
`startSpoken`, from the controller's `base`), not from the mode. It is the same rule `withTurn`
already has. Greg's existing conversation stays a Chat until he says otherwise; re-kinding it is a
production write.

## What would have caught it, ranked by ease against value

1. **A test that the kind a spoken turn creates follows the thread the tab began** (Remember begun,
   Live first, expect `remember`). Cheap, aimed at the class: any mode that creates on first write.
   Being done.
2. **Make the caller name the kind.** A required `kind` on the spoken-turn type, no default, so
   `"chat"` cannot be chosen by omission. The compiler then lists every caller when a mode is added.
   Done as optional-with-default for wire compatibility; making it required once old clients are gone
   is the tighter form.
3. **When a decision makes a mode reachable, grep for "not designed" / "nobody" comments.** A habit,
   free, and weak on its own, because it needs somebody to remember to do it. It is why the comment
   should have named the doc that would overrule it.
4. Rejected: **make the arrival rule count all threads.** It would bring back showing chats when
   the reader asked for Remember, and would still file the conversation under the wrong kind.
