# The Live button says "Resume" on a thread that has never been live

Report [SPIDERYARN-READING2-3G](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-3G), from
Greg, on an iPad in production, 2026-09-12 08:33 UTC. The note is
[260912_0833-live-button-says-resume-before-any-live-conversation.md](../user-feedback/260912_0833-live-button-says-resume-before-any-live-conversation.md).

> … I can see the icon for it, but the icon text says resume, which seems weird because I'm assuming
> that if I had to click that, it would be a real-time conversation about this conversation thread,
> and it would be the first time I've had a real-time conversation about this thread. So I don't know,
> that icon text should say something like real-time or similar.
>
> — Greg, 2026-09-12

## Diagnosis

Two bugs were possible: the label is unconditional, or the "has there been a live conversation here
already?" test is wrong. **It is neither.** There is no such test. `ChatPanel` passes
`resumeLive={thread.messages.length > 0}` (`src/web/ChatPanel.tsx`), so the button says **Resume**
on any thread with a message in it, typed or spoken. That was deliberate in `7eb8f2a0`: "resume"
meant *carry on this thread, out loud*, following Greg's words of 2026-09-06 in
[live-conversation.md](../project/live-conversation.md) — *"start a new conversation, or resume an
existing one"*.

The word does not say that on the screen. Beside a thread of typed messages, **Resume** reads as
"pick up a call you left", which is the thing Greg had not done. The state test was right about what
the click does — it continues this thread — and the label named the wrong object.

The chat rows themselves cannot tell the two readings apart: a spoken exchange is saved as an
ordinary chat pair with no marker (the one-conversation design in live-conversation.md). **The
billing journal can**, though — `realtime_sessions` keeps `thread_id` and `connected_at` for every
session (`src/db/schema.ts`), which GPT Sol's review pointed out after this plan first said nothing
stored could answer it. That journal is written best-effort, so it can miss a session but never
invent one.

## What changes

The visible label stops distinguishing. It is **Live** (or **Live conversation** in Remember's larger
composer) whether or not the thread has messages. What differs is what the click will do, and that is
said where a label can say a sentence:

| State | Visible label | Accessible name | Tooltip state line |
| --- | --- | --- | --- |
| No thread yet, or an empty one | Live | Start a live conversation | Starts a new conversation, out loud. |
| A thread with messages | Live | Continue this conversation live | Continues this conversation out loud, with its recent completed turns. |
| Connecting / live / closing | unchanged: Cancel / Hang up / Finishing… | same | — |

The tooltip's "then resume" becomes "then press Live again". The prop is renamed from `resume` to
`continues` so the code no longer carries the misleading word.

## The option passed over

**Keep "Resume", but only after a live session in this thread.** It is what Greg's 2026-09-06 words
most literally describe, and it is true after a hang-up. It needs no migration — a query on
`realtime_sessions` for a connected session on this thread, a field on the thread's wire shape, and
the client plumbing to carry it to the button — and it would still show "Live" on the rare thread
whose session report was lost. The gain is one word on one button in one state, and it gives the
same button two visible names. Greg asked for "real-time or similar", which "Live" already is in
every state. Deferred until someone misses it.

## Checks

- `tests/chat-live-handoff.test.tsx` § what the button says: a typed thread reads **Live** and is
  named "Continue this conversation live"; the list composer reads **Live** and is named "Start a
  live conversation". Seen red against the old label first.
- `npm test`, `npm run typecheck`.
- GPT Sol code review ([prompt](260912d-live-button-label-code-review-prompt.md),
  [answer](260912d-live-button-label-code-review-sol.md)): NOT READY on two findings, both taken.
  The tooltip said the call "hears everything said here so far", but `recentHistory` seeds at most
  20 completed turns; the reviewer reworded it and added phase and Remember cases to the test. And
  the "nothing stored" claim above was false; corrected, and the deferred option's cost with it.
  Re-run afterwards: that test file 26/26, `npm run typecheck` exit 0.
