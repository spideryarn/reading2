# A clock on the stream, and somebody to answer for the row

*Written 2026-08-26, after the work.*

The panel could spin on "thinking…" for ever. This is what was wrong, what was built, what it
cost, and the two holes it does not close.

Code: [`src/web/lib/sse.ts`](../../src/web/lib/sse.ts) (the clock),
[`src/web/useChat.ts`](../../src/web/useChat.ts) (the watcher),
[`src/routes.ts`](../../src/routes.ts) (`heartbeat`),
[`src/web/ChatPanel.tsx`](../../src/web/ChatPanel.tsx) (what the reader is told).
Tests: [`tests/sse-stall.test.ts`](../../tests/sse-stall.test.ts),
[`tests/sse-heartbeat.test.ts`](../../tests/sse-heartbeat.test.ts),
[`tests/use-chat-recovery.test.ts`](../../tests/use-chat-recovery.test.ts).

## The bug

> a question hung on "thinking…" for over two minutes with no error and no recovery, and a reload
> showed the server had finished and stored the right answer in the usual ten seconds.

Found in a browser pass while [chat tools](../project/chat-tools.md) were being checked, and
written down in [260826a-chat-mode.md](260826a-chat-mode.md) rather than fixed at the time.

**A stream can stop without ending.** A TCP connection that has gone away without being closed
delivers no bytes and no error: `reader.read()` neither resolves nor rejects, so a `for await`
over it waits for ever and there is no event on which to hang a failure. The client already
handled a stream that *closed* early. It had nothing at all for one that simply stopped.

## Three parts, and why it is three

### 1. The server keeps proving it is alive

`heartbeat` in [`src/routes.ts`](../../src/routes.ts) writes an SSE comment — `: ping` — every 15
seconds while the response is open. The spec says a client must ignore a comment line, and
`parseFrame` duly drops it. **The bytes are the message.**

Without it, a client-side clock would have to be longer than the longest legitimate silence on a
*healthy* stream, and those silences are long here: a tool can run for 45 seconds
(`MEANING_TIMEOUT_MS`) between its two `tool` frames, and a round can think for ten before its
first word. That would mean a minute and a half before a dead connection was noticed. The
heartbeat buys the difference. It also stops an idle-timeout proxy — thirty or sixty seconds is a
common default — closing a stream that was about to deliver.

It is installed in both SSE writers: `sse(res)`, which comments and search use, and `streamChat`,
which writes its own headers inside its `try` so that a socket dying between `beginTurn` and the
first write cannot leak the `streaming` key.

**Verified on a real socket, not asserted.** A heartbeat that silently never fires is exactly the
shape of [silent-success.md](../reusable/silent-success.md): every answer still arrives, nothing
looks wrong, and the only symptom is that dead connections take a minute longer to notice, on the
far side of a browser where nobody is watching. So `heartbeat` takes a test-only interval and
`tests/sse-heartbeat.test.ts` counts the bytes off an actual `http.createServer`. And a live chat
turn on the dev server produced exactly one `: ping` in 22.9 seconds, which is what a 15-second
beat looks like.

### 2. The client puts a clock on the bytes

`readEvents(body, { stallMs })` races each read against a timer, and throws `StreamStalled` when
the silence passes `STREAM_STALL_MS` (60 seconds).

**On bytes, not on frames**, and that is the whole reason it lives inside the generator: a
heartbeat is not a frame, so a timer in the caller's `for await` loop would never see the one
thing that proves the connection is alive.

**60 seconds, not 45.** At three beats the third beat and the timer race, and a browser that
throttles timers in a background tab — all of them do — wins that race often enough to kill
healthy streams. GPT-5.6's argument, taken.

**The clock arms on the first byte.** A stream that has not said anything *yet* is not a stream
that has stopped: an intermediary that ignores `X-Accel-Buffering: no` holds the whole body,
heartbeats included, and delivers it at the end. Clocking that would kill a response that was
going to arrive, having learnt nothing except that the reader is behind an old proxy. After the
first byte the rule is much stronger, because the server beats while it thinks.

### 3. Somebody has to answer for a `pending` row

This is the part the first design got wrong, and the part that actually fixes the reported bug.

The server **does not stop working when a reader's connection dies** — see `stopChat` in
[`src/routes.ts`](../../src/routes.ts), where letting an abandoned answer finish is deliberate. So
by the time the client has noticed the silence, the answer is usually already on disk, complete.
Erroring the row would make the reader pay twice for something they had already bought.

The first design polled for the answer inside `run`, where the stream was lost. GPT-5.6 pointed
out that this cannot fix the case that was reported: **the trigger was a remount.** Vite Fast
Refresh in development, and StrictMode on every mount — the old hook's stream dies with it, and
the new hook loads a `pending` row from the server with no stream and no clock. A recovery that
lives inside `run` is not there any more.

So there is one mechanism with one trigger: **an effect scans `threads` for a `pending` assistant
row that no local stream owns, and starts a watch for it.** A stream lost mid-answer and a
`pending` row loaded on a fresh mount are the same row in the same state, and take the same path.

`owned` is a ref of message ids — a `pending` row says "somebody is answering this" and nothing
about whether that somebody is still here. `run` claims the row *before* the request leaves, under
the provisional id, and again under the server's id when `begin` arrives. Claiming late was a real
bug for about ten minutes: `send` puts the row on screen before `run` is called, the effect runs on
the very next render, and the watcher would hunt for a row the server had not been told about,
fail every time, and error a live answer out from under its own stream.

A watch polls `GET /api/chat/:slug` every 3 seconds, **with a 10-second timeout on each request** —
`fetch` has none of its own, and a recovery that can itself hang is not one. It adopts only a row
that has settled to `done` or `error`; adopting a `pending` one would put a spinner on screen with
no stream behind it and nothing left to end it, which is worse than the failure it is avoiding.

It keeps looking for `SERVER_TURN_MS + RECOVER_MARGIN_MS` — **measured from when the watch starts,
not from the row's `createdAt`**, which is a fix rather than a simplification. The client stamps
`createdAt` when the reader presses Enter, and the server may then spend its whole turn deadline in
`settleThread` finishing a superseded answer before this turn begins, so a deadline anchored to the
stamp can already be spent by the time the first word arrives. The margin also has to clear a
*second* server number that is easier to forget: `CHAT_ORPHAN_GRACE_MS`, after which a sweep turns
an abandoned row into a failure the watch can adopt. Stopping at 140 seconds would mean writing our
own failure over a row that was ten seconds from settling. A test asserts the sum clears it, because
the two numbers live in different files.

Only then does the row become `ENDED_UNFINISHED`.

The reader is told the truth while this happens: not "thinking…", which is a claim about the model
and the one they already sat through, but *"connection lost — checking whether the answer
finished…"*. The row stays `pending`, so Stop is still offered — the answer really may still be
being written, just not to us.

## Three bugs found on the way, none of them the one being fixed

- **`await reader.cancel()` hung the generator.** The stall fired, the error was raised, and it
  never left the `finally` — because `cancel()`'s promise follows the socket teardown, and on the
  stalled connection this exists to escape from, that teardown is exactly what is not happening. A
  recovery that inherits the hang it is recovering from. Now fire-and-forget. Flagged in advance by
  GPT-5.6 and then reproduced by the test.
- **A functional `setThreads` updater read two `let`s the next four lines reassign.** React runs
  the updater at render time, so `withServerIds` was asked to find a thread under the id the server
  had just moved it to and a row under the id it was about to be renamed to. It found neither and
  returned the list untouched. Invisible on the ordinary path — the server accepts the client's
  thread id and neither variable changes — and it bites on exactly the path that frame exists for.
  Pre-existing, unrelated to streaming, found by the recovery test.
- **A ref release renders nothing.** The watcher effect is keyed on `threads`, and the case that
  matters most releases a row without touching `threads`: the stream stalls, the row is unchanged,
  and the only new fact is that nobody is writing to it. The scan would not have run again until
  the reader typed something. Hence `released`, a counter bumped in `run`'s `finally` whose only
  job is to make the effect look again.

## What the browser pass saw

Checked in a real browser on 2026-08-26, and the reproduction arrived by itself: with four other
agents editing this tree, a Vite HMR cycle dropped the stream mid-answer without anybody having to
stage it.

The row said **"connection lost — checking whether the answer finished…"**, spent about twenty
seconds saying it, and was then replaced by the finished answer — complete, ending on a full
sentence, with its tool strip and citation chips intact. Nine `GET /api/chat/:slug` requests and
**no second `POST`**, which is the number that matters: a recovery that re-asked would be a
recovery that charged the reader twice for an answer they had already paid for.

A second run reloaded the page deliberately, and the answer had already finished and been stored by
the time the new page loaded — so it simply appeared, with no recovery line at all. That is the
right behaviour and it exercises none of this code.

**One thing seen that is not a bug in this change**, recorded because it looks exactly like one:
mid-session, a page that had been loaded *before* `owned` changed from a `Set` to a `Map` threw
`owned.current.get is not a function` when the module hot-reloaded under it. React Fast Refresh
preserves hook state across an edit, so the old ref survived into code that expected the new type.
A reload clears it, and production has no Fast Refresh. The general shape is worth knowing: changing
the type inside a `useRef` is invisible to the typechecker at the moment it bites.

## The second review, and the four things it caught

The implementation went back to GPT-5.6 and came back NO-SHIP again. All four were real.

- **A `fetch` that never resolves** was the last way left to strand a row for ever, and this change
  had *made it worse*: `run` claims the row before the POST goes out, so a hung request left the row
  `pending`, owned, and therefore skipped by the very watcher that exists to rescue it. Now there is
  an opening deadline — `OPEN_TIMEOUT_MS`, three minutes, generous because a retry legitimately
  waits on `settleThread` — on an `AbortController` that is disarmed the moment the headers arrive,
  so it can never reach the stream behind them.
- **A clean EOF before `begin`** fell through to the watcher, which then spent two and a half
  minutes politely asking the server about a message id the client had invented, saying "connection
  lost, checking…" the whole way. The thrown case already guarded on `began`; the clean one had been
  left out of it. It now fails immediately.
- **The deadline was anchored to a stale timestamp** — described above.
- **The window stopped before the server's orphan sweep** — described above.

Two more, both taken: `owned` is counted rather than a `Set`, so that two streams on one row cannot
have the first to finish announce that nobody is writing; and each watch holds a token, so that a
second watch for the same row supersedes the first instead of running beside it.

What it cleared: the fire-and-forget `cancel`, the `wasThread`/`wasReply` capture, and the heartbeat
lifetimes.

## The tidying pass was checked in a browser, and reviewed

A regression pass on 2026-08-26, after the split: chat streamed and completed twice in one thread
(so the id-following path ran twice), a selection produced a streamed explanation, and a meaning
search returned twelve passages. No console errors, no stuck spinners, and each POST fired once.
The only interruptions were 503s from the dev server restarting under other agents' edits, which
the existing error-and-retry path handled — not this code.

GPT-5.6 reviewed it and said **SHIP** — the first of the three passes over this work that has. It
confirmed the three things the split could have broken and did not: `text`, the copied `tools`,
`began` and the two mutable row ids all keep their old lifetimes and ordering; `describeFetchFailure`
special-cases only `StreamStalled`; and both comment and search routes really do go through
`sse(res)`, whose 15-second beat covers every legitimate silence on them, since their own model-side
stall limits are shorter than 60 seconds anyway.

*(It took two attempts to get that verdict. The first died 79k tokens in on `Your workspace is out
of credits` with no answer file at all — which is the failure
[codex-cli-as-subagent.md](../reusable/codex-cli-as-subagent.md) warns about, because a review that
returned nothing looks exactly like a review that found nothing. Greg topped the key up and it ran.)*

## What is left, and what the tidying pass closed

Three things were written down as open when this landed. A tidying pass the same day closed two of
them; the first is still open, and is the only one of the three that is not a small change.

- **A stream lost before `begin` still cannot be recovered**, and is reported as a plain failure.
  The message id is one the client invented and no amount of looking on the server will find it.

  **Except for a retry, and that is GPT-5.6's correction to this paragraph.** `retry` passes the
  server's own message id as the reply id — `run(threadId, { retry: messageId }, messageId)` — so on
  that one path the row *is* nameable before `begin` and a watch could find it with no schema work
  at all. `send` and `edit` both mint a fresh id and still need the correlation id below. It is not
  simply an oversight to fix, though: a retry whose request never reached the server leaves the
  **previous** answer sitting on disk as `done`, and a watch that adopts a settled row would put
  that back on screen as though the retry had produced it. So the narrow fix wants a way to tell
  "the row the server re-opened" from "the row the server never touched", which is a smaller version
  of the same problem. Written down rather than built.
  Closing it means the client sending a correlation id that the server stores on the assistant row,
  so a watch can ask for the row by a name it chose rather than by one it was given. That is now
  more than a client change: chat rows live in Postgres as well as on disk
  ([`src/store/pg-chat.ts`](../../src/store/pg-chat.ts)), so it wants a column and a migration, and
  the store is somebody else's live work. Deliberately left.
  The window is narrow — the POST going out to `beginTurn`'s write returning — and the cost of
  losing it is one orphan row that the server's own sweep turns into a visible failure.
- **`useComments` and `useSearch` now have the clock too**, added 2026-08-26 in the tidying pass
  after this landed. *(The `useSearch` half went in a commit later, and what it had to
  carry is worth writing down: that file was mid-flight for the stale-search work recorded in
  [260826x-search-staleness.md](260826x-search-staleness.md), whose agent hit a session limit, so committing one
  argument meant committing their `SavedSearch`/`stale` derivation, the `src/search-stale.ts` it
  imports, and the line adding that module to the client-import allowlist — five lines in
  [`tests/client-imports.test.ts`](../../tests/client-imports.test.ts) without which the tree is
  red. Checked the way you check a thing like this rather than assumed: a scratch `git worktree`
  at `HEAD` with exactly those five files copied in, then `npm run typecheck` and the affected
  tests. It adds no error that `HEAD` did not already have — `HEAD` itself does not typecheck,
  for reasons in other agents' files — and the tests pass. Their server half is untouched and
  still uncommitted, so the committed client half computes `stale: false` for every row and shows
  nothing, which is what it should do until the server starts sending a fingerprint.)* One argument each way, and the argument for won: they are shorter waits and
  neither has anywhere to *recover* to, so all a clock buys them is a failure the reader can see
  instead of a spinner that never stops — but that is the whole of the bug this plan is about, and
  a comment that has hung for ever is not improved by having hung for a shorter time. The
  `StreamStalled` class message ("the stream sent nothing for 60s") is the right thing in a log and
  the wrong thing on screen, so `describeFetchFailure` — which all three hooks describe their
  failures through — now words it with `wentQuiet` and its `[ai-stalled]` code.
- **`run` is no longer the file's most complicated function by a wide margin**, though it is still
  over the advisory threshold: **86 → 46**, by lifting the frame loop out into `drainTurn` and the
  `begin` frame's id-juggling out into `nameRow`. The split is the one the shape suggests — frames
  in one function, which knows nothing about ids or deadlines, and the lifecycle in the other.
  Measured: only `drainTurn` moved the number; `nameRow` is readability and is written down as
  such, because a comment claiming a complexity win the tool disagrees with is worse than no
  comment.
