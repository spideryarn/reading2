# Two streaming tests that hung instead of failing

Up: [postmortems.md](../project/postmortems.md). Two separate causes turned dev red together on
2026-10-08 and blocked the deploy. The first was introduced by `3c73b222a` (plan
[261008e](../plans/261008e-chat-knows-the-reader-s-other-conversations.md)). The second had been
in the test file for a while and only fails when the box is slow. Both are fixed in the commit that
adds this file.

## What happened

`tests/chat-live-turn.test.ts` failed two cases at the 30 s timeout, every time.
`tests/citation-investigate-route.test.ts` failed one to three cases at 30 s, plus a 429 case where
`calls()` read 0. That happened about half the time, **run alone as well**. The brief noticed it
passing alone at 18:00, and that run was lucky.

## Cause 1: Chat's new gist call got a body that never ends

`3c73b222a` added a second model call to every Chat turn. Once an answer is stored, including a
stopped one, `streamChat` awaits `refreshGist`, which makes a structured, non-streaming
`chat-gist` request. It awaits it *inside the handler*, on purpose: the spend ledger and Vercel's
instance lifetime both need that.

`tests/chat-live-turn.test.ts` stubs `fetch` with one answer for every request: a streamed body that
says one word and then never ends. The only way out is the abort. The gist request got that body
too. The stub's `Response` is built by hand, so its body ignores the request's abort signal, and the
gist's 20 s deadline (`chat-gist.ts` § `gistOf`) cannot free it. So the tests' `Call.done`
promises, which await the whole handler, waited forever. The server's `Live.done` is a
different promise: `release()` resolves it before the gist starts, so stop and supersede
requests do not wait for the gist.

The commit did fix the same thing in four other suites (`chat-help-route`, `high-power-routes`,
`chat-visible-route`, `guide-route`), each with a hand-written branch for the
`conversation_gist` request. It missed this one, because this file did not fail in the runs made
for that commit.

**Production is not affected.** The gist call starts only after `res.end()`, so the reader already
has `done`. A real `fetch` honours its 20 s deadline during the body read and the retries too. The
worst case is a server function that stays up about 20 s longer.

## Cause 2: a wait that gave up and carried on

The citation file's `until(ready)` polled 400 × 5 ms, about 2 s, and then **returned as if
`ready` had become true**. Before the model call, Dig deeper runs the real paper read through the
real composition root. The stubbed paper and registry answer at once, but the read still took
0.2–2.6 s under the load on the box. When it went over 2 s, the case called `stub.finish()` before
the model stream existed. `finish` did `controller?.enqueue(…)`, a quiet no-op. The stream then
started and never ended, and the test timed out 30 s later on `await handled`. Nothing pointed back
at the wait. In the 429 case the same early return made `calls()` read 0.

## The classes

1. **A new call on a shared path, and hand-written stubs that each have to know about it.** Each
   suite that stubs `fetch` holds its own picture of which requests a handler makes. A new call
   makes every one of those pictures stale at once, and nothing lists them. A stub that answers it
   with a body that never ends doesn't fail: it hangs.
2. **Silent success in a test helper**
   ([silent-success.md](../reusable/silent-success.md)). A bounded wait that runs out and returns
   normally, and a `?.` that turns "too early" into "done", together moved the failure 30 s
   downstream and made it depend on the load on the box.

## The fix

- `chat-live-turn`'s stub answers the `conversation_gist` request the way the other four suites do.
- `until` waits up to 20 s and **throws** when the time runs out. `finish()` throws if the stream
  has not started.

The right long-term fix for class 1: one shared test helper that recognises the gist request and
answers it, used by every Chat route suite, so that the next call added to a turn is added in one
place. Stub bodies should honour the abort signal as well, because a body that ignores it is what
turned a missing branch into a hang rather than an error.

## What would have caught it

- Class 1: the full suite (`npm test`) at commit time, not just the suites the commit touched. The
  new call is on the path of every Chat test.
- Class 2: a rule that a test's wait helper fails when it runs out of time. A grep for loops shaped
  like `for (… i < N && !ready() …)` across `tests/` finds no other copy today.
