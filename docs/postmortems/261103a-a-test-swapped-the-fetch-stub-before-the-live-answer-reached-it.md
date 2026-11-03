# A test swapped the fetch stub before the live answer reached it

Up: [postmortems.md](../project/postmortems.md).

The box's readiness full suite went red twice on 2026-11-03, on `936d2a5a` (10:52Z) and `58eff96f`
(15:04Z), with the same single failure. It had passed on `267ac313` at 02:56Z, and no server code
changed between the two. **Nothing reached a reader.** The product does the right thing; the test
was asserting on a state it had not waited for. The cost was two red readiness runs, about 90
minutes each, and a commit that looked broken when it was not.

## What happened

```
FAIL  private-postgres  tests/chat-route.test.ts > an edit the store will refuse stops nothing
      > an edit that names the real tail still stops the live answer and replaces it
AssertionError: expected 'event: begin\ndata: {"threadId":"spya…' to contain '"stopped":true'
+ event: begin
+ data: {"threadId":"spya-t7r4wz","title":"q1","messageId":"spya-yh5gcs",…}
+
+ event: error
+ data: {"error":"This answer stopped for a reason this app could not explain to you; … [ai-gave-up]","text":""}
```

The test opens a second question with `globalThis.fetch = hanging`, a model stub that never answers
until its request is aborted. That keeps the answer "live" for as long as the test needs. The
helper `withALiveSecondAnswer` returned as soon as the response contained `event: begin`. The test
then set `globalThis.fetch = rejecting` for the edit it was about to send, and expected the edit to
stop the live answer with `"stopped":true`.

But `begin` is not where the live answer reaches the model. In the chat route
(`src/routes.ts`, `streamChat`), `frame("begin", …)` is written first, and only then does the route
await three database reads before `converse` calls `fetch`:

```ts
frame("begin", { threadId: thread.id, … });
const profileParts = wantsProfile ? await resolveProfileParts(slug) : null;
const reading = thread.kind === "candidates" ? null : await chatReadingSoFar(slug, article.blocks);
const others = await chatOthers(slug, thread);
for await (const event of converse({ … })) {   // → fetch, read from globalThis at call time
```

On a loaded box those reads were still running when the test swapped the global. So the live
answer called **`rejecting`**, not `hanging`. `rejecting` takes no notice of the abort signal and
rejects with `Error("no model in tests")`. `stoppedByReader` in `src/openrouter-stream.ts` then did
exactly what it is for: the signal was aborted, but the thrown error was not the abort
(`err === signal.reason` was false, and its name was not `AbortError`). So it classed the failure as
the provider's, and the route ended with `ai-gave-up`. That was the right verdict on the evidence it
was given.

The test durations in the logs agree. The two failures ran in 286 ms and 264 ms. Every pass in the
retained logs took 313–414 ms. The failing live answer did not wait to be aborted; it died as soon
as it called the wrong stub.

### Reproduced, and the product checked

- **Deterministic red.** A 300 ms delay inserted before `resolveProfileParts` in the route turns
  the test red on every run, with the readiness message word for word. With the fix in the test and
  the delay still in, it is green.
- **The product path is fine.** A reader really can edit inside that gap, between `begin` and the
  model call. With the same 300 ms delay and a fetch stub that does what real `fetch` does (reject
  with `signal.reason` when the signal is already aborted), the route ends the live answer with
  `"stopped":true`. An edit that lands before the model call stops the answer cleanly. There is no
  product bug.

## The class: a test waited on an acknowledgement the code sends before the state it meant

**The test needed "the live answer is sitting at the model". It waited for "the server has said
`begin`".** Those are two different moments, and the code under test does real work between them.
The proxy is earlier than the condition by design, too: `begin` goes out first so the panel can
show ids before any answer exists (the comment above it says so). Any test that treats an early
acknowledgement as readiness is betting that nothing in the gap takes long enough to matter.

This bet had a sharper edge than usual, because what the test did next was **swap a shared
global the code under test had not yet read**. `globalThis.fetch` is read when `fetch` is called,
not when the request starts. So "after `begin`" decided which stub the live answer would get, not
merely whether the next assertion saw a settled state. The test thought it had a request held open
by `hanging`. It actually had a request that would pick up whatever stub was installed by the time
it got there.

It is the event-shaped sibling of
[260930a — a fixed window stands in for a condition](260930a-a-fixed-window-stands-in-for-a-condition.md):
there, a test waited a fixed number of milliseconds; here, it waited for an earlier event. Both
replace the condition with something that usually comes at about the same time. The product-side
cousin is
[261002g — transport completion is not server acknowledgement](261002g-transport-completion-is-not-server-acknowledgement.md),
which is the same confusion between one stage of a request and a later one.

The other test in the same `describe` uses the same helper and has the same hole, but
less visibly. *A stale edit gets its 409* asserts that the live answer was **not** ended
(`live.settled()` is false). If the live answer is still in its database reads, that is true
whether or not the route stopped it. So under load it could also pass with the bug it guards against
put back in. Its 2026-10-07 mutation check (delete `requireTail`, watch it go red) was run on an
unloaded machine, where the gap closes before the assertion.

## Which commit introduced it

- **`17ae67ee6`** (2026-10-07, *Seventh sweep C4/A (SV1): a stale chat edit is refused before it
  stops anything*) wrote the describe block, the helper and its `begin`-only wait. The gap was
  already there. At that commit the route awaited `resolveProfile(slug)` (a database read, since
  `wantsProfile` defaults to true) and `exploreNotes(…)` inside `converse`'s argument list, after
  `begin` and before `fetch`. **The race is as old as the test.**
- The gap then grew. **`3c73b222a`** (2026-10-08, *Chat knows the reader's other conversations*)
  added `chatOthers`, a `chatStore.load` for a `chat`-kind thread, which is what this test makes.
  **`37ec56d84`** (2026-10-21, *chat is told roughly how much of the article you have read*) added
  `chatReadingSoFar`, a `readingTimeStore.read`. **`cac2fbf9f`** (2026-10-05) and later commits
  reshaped the profile read into `resolveProfileParts`. None of these authors touched the test or
  had reason to: each added an ordinary read to the request path.

### Why it went red only today

It was always latent, and it depends on how busy the box is at that particular moment, not on the
code. The readiness logs dir keeps the last 20 runs (back to 2026-10-30T11:27Z). Over that window
the test passed 18 times and failed only these 2. Total suite time does not separate them: the
failures took 5570 s and 5422 s, and the passes ranged from 5142 s to 5673 s. So what lost the race
was contention in the few hundred milliseconds around this test, not a slower suite overall.
Nothing older than 10-30 survives, so earlier failures before then cannot be ruled out. There is
no earlier commit touching this test that looks like a flake fix (`git log -- tests/chat-route.test.ts`
ends at `8836f40ab`, 2026-10-07).

## Why nothing went red sooner

- **The test was mutation-checked, and the check was real but unloaded.** On 2026-10-07 deleting
  `requireTail` turned the first case red and left the control green. On a quiet machine the three
  reads finish before the test's next line runs, so the mutation run never exercised the gap.
- **Every local and readiness run before 11-03 that is still logged was green.** A race that loses
  about one time in ten under full load, and almost never alone, does not show up in a single run.
- **`stoppedByReader` was right, so the error was honest.** The route reported `ai-gave-up`
  because the stub really did fail for a reason other than the abort. That is why the message
  pointed at the provider path rather than at the test. It made the failure look like a product bug
  in the stop logic.
- **The `rejecting` stub is unlike real `fetch`.** Real `fetch` handed an already-aborted signal
  rejects with `signal.reason`, and `stoppedByReader` would have classed that as a stop. Because
  the stub ignores the signal, the race turned into a wrong verdict instead of the right verdict by a
  different route.

## What would have caught it, ranked by ease against value

1. **Make the stub say it was reached, and wait on that.** `hanging` now counts the calls it is
   handed (`held`), and `withALiveSecondAnswer` waits for `held === 1` after `begin`. "Held open"
   is then true by construction when the helper returns, and the shared-global swap afterwards
   cannot reach the live answer. This is done, in `tests/chat-route.test.ts`, with a comment at the
   site. The general rule: **when a test holds a request open with a stub, its readiness signal
   comes from the stub, not from the response.** It fixes both cases in the `describe`.
2. **Write stubs that honour `AbortSignal` the way `fetch` does.** If `rejecting` checked
   `init.signal.aborted` and rejected with `signal.reason`, this race would have ended `stopped`,
   and the test would have passed for a defensible reason. The cost is a few lines. But on its own
   it would *hide* the race rather than catch it, and the test would still not be testing what it
   says. So it is worth doing as a fidelity fix, alongside item 1, not instead of it. Not done here,
   because the file's main stub is shared by every other test in it, and nothing is red without it.
3. **When writing a concurrency test, run it once with a delay injected at each `await` between
   the signal it waits on and the state it means.** That is exactly how this one was reproduced (300
   ms before `resolveProfileParts`), and it took minutes. As a habit it costs one throwaway edit per
   such test, and it is the only one of these that would have caught the race on 2026-10-07. Kept
   as a habit rather than a mechanism, because a permanent delay hook in the request path would be
   test-only machinery inside production code.
4. *Inject `fetch` per request instead of reading the global* — rejected. It would remove the
   shared-global half of the class, but it means threading a transport through `converse` and the
   tool loop for the sake of a test. And item 1 already removes it here.
5. *Retry flaky tests in readiness* — rejected. This one was not flaky; it was reporting a real
   gap in the test, and a retry would have turned two useful reds into green.

## The fix that is right for the long term

What shipped is item 1, and it is also the right design: the test's readiness signal is now the
condition it actually depends on. If a second test grows the same hold-a-request-open shape, the
`hanging` stub and its counter should become a shared helper, with the wait included, so nobody has
to rediscover that `begin` is too early. Item 2 is worth doing the next time the file's stubs are
touched for another reason.

## The thing I would tell myself

When I wrote "held open" in that helper, I believed it because I had seen `begin`. I knew `begin` is
written before the model call — that is the whole point of the frame. I did not ask what the route
does between the two, and I swapped a global the code was still going to read. The question to ask
of any wait in a test is: "is this the thing I need, or something that usually comes just before
it?" If it is the second, wait on the first.
