# A URL write outlived the page that asked for it

**The gate went red with every test green.** Three times over nine days, the `unit` project
reported `Test Files 2 passed · Tests 4 passed` and still exited non-zero, on this:

```
⎯⎯⎯ Uncaught Exception ⎯⎯⎯
ReferenceError: location is not defined
 ❯ getSearchParamsSnapshotFromLocation  node_modules/nuqs/dist/debounce-Ynq26WfO.js:119:29
 ❯ ThrottledQueue.applyPendingUpdates   node_modules/nuqs/dist/debounce-Ynq26WfO.js:207:16
 ❯ flushNow                             node_modules/nuqs/dist/debounce-Ynq26WfO.js:163:33
 ❯ Timeout.onTick [as _onTimeout]       node_modules/nuqs/dist/debounce-Ynq26WfO.js:78:3
 ❯ listOnTimeout                        node:internal/timers:685:17

This error originated in "tests/conversation-band-send-new.test.tsx"
```

There is nothing to open. No assertion failed, no test is named, and the one file that *is* named
is named only because vitest reports which file was running when the timer was scheduled — not
where the error was thrown.

## The mechanism

`nuqs` does not write the address on the render, and there are **two stages**. A parameter declared
`debounce(200)` waits first in a per-key `DebouncedPromiseQueue`, held by a `DebounceController`;
every parameter then joins the one shared `ThrottledQueue`, which flushes from a bare `setTimeout`
at 50ms — `src/lib/queues/debounce.ts` and `throttle.ts`, both shipped in
`node_modules/nuqs/dist/debounce-Ynq26WfO.js`.

Both queues are `globalSingleton`s, and that helper stores them on **`globalThis`**, keyed by the
package version — deliberately, so that two copies of nuqs loaded side by side share one instance
(`src/lib/global-singleton.ts`). They therefore belong to the *realm*, **not to the React root that
scheduled the write**.

Unmounting the root therefore cancels nothing. When a jsdom test case returns with a write still
queued, the timer is still armed after the file finishes; vitest tears the environment down; the
timer fires; `getSearchParamsSnapshotFromLocation` does `new URLSearchParams(location.search)`
against a global that is no longer there. There is no `try`/`catch` anywhere on that path and no
`typeof location === "undefined"` guard on it — nuqs has exactly one such guard, on a dev-only
URL-length warning (`src/lib/url-encoding.ts:53`), and it is not on the crashing call.

In `tests/conversation-band-send-new.test.tsx` all three cases called `onSendNew`, which moves
`?thread=` to the conversation it starts. One of them waited for that write. Two did not: they ran
`settle()`, which is four `setTimeout(0)` turns, and four turns of zero is not fifty milliseconds.

## The class

**Teardown does not cancel what a module scheduled** — or, said precisely enough to recognise the
next one: *realm-scoped work depending on environment-scoped globals*. The cleanup was scoped to the
component; the work was scoped to the realm, on `globalThis`; the globals it reads were scoped to
the test environment, which is the shortest-lived of the three. (The precise formulation is GPT
Sol's, 2026-09-06; the headline is kept because it is the one that fits in a reviewer's head.) Anything that hangs a timer, an interval, an observer or a fetch off
a module-level singleton outlives every `unmount`, `afterEach` and environment teardown, and will
run inside whatever is alive next. The give-away is a stack whose top frame is a library and whose
bottom frame is `listOnTimeout`.

It has a diagnostic half that is why this one lasted nine days: **escaped post-test asynchronous
work** — a failure that lands outside every assertion's reach. The suite has no way to fail a test that has already passed, so the
whole thing arrives as an unhandled error, at a 1-in-30 rate, attributed to a file that is green.
Twice it was assumed to be box contention — the standing and usually-correct explanation on this
machine — because that is what an intermittent with no failing test looks like.

## Where it came from

`748f1161`, 2026-08-28, which added `tests/conversation-band-send-new.test.tsx` whole. The file was
right about the throttle from the beginning — its second case says so in a comment, and waits —
and the other two cases simply did not inherit the care. Nothing about the commit was careless;
the knowledge was written down in one case and not generalised to the file.

## Measured, not reasoned

| run | configuration | result |
|---|---|---|
| loop 1 | the file alone, 70 clean iterations | **0 failures** |
| loop 2 | the file followed by a second jsdom file, one worker, fixed order, 30 iterations | **1 failure** |
| loop 3 | loop 2's configuration against the fix, 90 iterations | **0 failures** |

Ninety runs of a configuration that failed 1 in 30. Were the rate unchanged, zero failures has
probability `(29/30)^90` ≈ 4.6%, so the number supports the structural argument rather than
carrying it: the fix works because the write is *observed to have landed* before the case returns,
and the probe agrees — `pendingAtEnd=0/0` for both files afterwards.

Running alone almost never fails: the process exits before the timer fires. It needs a *following*
file whose environment the stale timer can land in — which is why the full suite saw it and a
developer re-running the one file never did.

The pending write was also confirmed directly rather than inferred. A bare assertion at the end of
the third case — no wait — fails every time, with `?thread=` still naming the conversation the
reader arrived with while the question had gone to a new one:

```
AssertionError: expected 'spya-k3m9qt' to be 'spya-gqr3se'
```

**Iterations 71-80 of loop 1 are discarded**: that probe was still in the file while the loop was
running, so the "failure" at iteration 71 is the probe, not the defect. Editing a file while a loop
over it is running invalidates the loop, and it took a confusing result to notice.

## A guard that was written, measured, and thrown away

The first attempt at a fix was a guard in `afterEach`: snapshot `location.search`, wait 150ms, and
assert it did not change — "nothing may still be queued when a case ends". It passed against the
bug it was written for.

Twice, in fact: once with the snapshot taken after `act(root.unmount)`, which is itself slow enough
for the flush to fire inside it, and then again with the snapshot taken first. Forcing the values
out showed why — **by the top of `afterEach` the write has already landed in all three cases**, so
`before` and `after` are always equal and the assertion can never fail. The 1-in-30 crash is the
tail where the flush is slower than that gap under load, which no fixed wait can catch.

So it was deleted rather than shipped. A check that cannot go red is
[silent-success](../reusable/silent-success.md), and shipping one *here* — in the fix for a bug
whose whole nature is a green report over a real failure — would have been the same mistake twice.

## The fix

Every case now goes through one helper that sends **and waits for the address to catch up**, using
`vi.waitFor` to poll until the write has landed. It is the idiom the file's second case already
used; the change is that it stopped being one case's private care and became the file's.

Waiting on the observed effect matters more than it looks. A `setTimeout(60)` would work today and
is what the crash tempts you into, but it bakes nuqs's current 50ms into the file and would go
quietly green-then-flaky if that value ever moved. Polling has no such constant in it.

## What would have caught it, and what to do

Ranked by value for the effort.

1. **Run the gate in a loop, occasionally, and read the exit code rather than the summary.** Cheap,
   needs no new code, and it is the only thing here that finds *unknown* members of this class
   rather than this one. Everything above was found by 200 runs of two files; nobody had ever run
   the same tree twice. Worth doing as a habit after a large change, and it would have caught this
   in an afternoon at any point in the last nine days.
2. **Treat "unhandled error, no failing test" as a distinct verdict, not as contention.** It was
   read as box noise twice. The two look identical from the summary line and are completely
   different underneath: contention fails *tests*, this fails *none*. That distinction costs
   nothing to apply and is the reason the bug survived.
3. **A file-local action helper wherever a test drives a URL parameter** — `sendNew`, `dragGateTo`,
   `until` — so the wait is attached to the action rather than remembered at each call site. Both
   exposed files now have one. A *shared* helper across files was considered and rejected
   (§ *Not a shared helper*): it could not make waiting unavoidable, which is the only thing that
   would beat a local one. Revisit it only if something can enforce the rule by construction.
4. **Ask whether a library's cleanup is scoped to the thing you unmount.** Generalising past nuqs:
   a `globalSingleton` is a hint that `unmount` will not help you, and it is checkable in a minute
   by reading the library's own source map.

## The review

GPT Sol on the change before it landed, `08d5aaee` as base — a *live* pre-commit candidate, which
names a tree rather than bytes, so: **what it reviewed became `edc26a87`**, plus the three P3 fixes
below, which were made in response to it and are in that same commit. **No P0, P1 or P2**, and it
reproduced rather than only reasoned: it ran both files separately and together in one worker, the doc-link
suite, Biome, and all three TypeScript projects.

Three P3 findings, all accepted and all fixed here, and all three were mine to have caught:

- **F1** — `dragGateTo`'s own docstring still promised it returned *"the instant the event does"*,
  which is precisely the behaviour the fix removed. A helper whose contract contradicts its body is
  how the next person reintroduces this.
- **F2** — this write-up collapsed two mechanisms into one. `debounce(200)` is a per-key queue that
  runs *before* the shared throttle, which keeps its own 50ms; and `globalSingleton` puts both on
  `globalThis`, so "module-global" understates it. Checked against nuqs's source rather than taken
  on trust: `DebounceController` holds both a per-key map and the `ThrottledQueue`, and
  `global-singleton.ts` says in its own docstring that it stores on `globalThis` so that duplicate
  copies share one instance.
- **F3** — recommendation 3 said to add a shared helper *"if more than one file is exposed"* while
  this same document established that two are exposed and then rejected the helper. An internal
  contradiction, and the reader would have followed the recommendation.

It also confirmed the two judgement calls that were least comfortable — deleting the `afterEach`
guard, and declining the shared helper — and answered the one that mattered most: `vi.waitFor`
proves only the observed value in general, but is sufficient on both of these paths, because the
initial and expected values differ, the adapter writes `history` synchronously inside `flushNow`,
and neither component re-arms after the observed value lands. **It would not be sufficient** for a
parameter whose expected value already matches the initial URL, or where a second parameter queues
work independently — which is the caveat to carry to the next file.

## How far it spreads

Twenty-two candidate jsdom files were **measured, not read**. The instrument patches `setTimeout`,
keeps only the timers whose immediate caller frame is inside `nuqs` — which is nuqs's own
`timeout()` helper, so this counts flushes and nothing else — and reports, in `afterAll`, how many
are still armed and how long ago the last one fired:

```
glossary-band-selection.test.tsx  delays=[200.0c,0.0,200.0]  pendingAtEnd=1/1  margin=202.5ms
conversation-band-send-new.test.tsx  delays=[0.0,0.0,0.0]    pendingAtEnd=0/0  margin=26.4ms
remember-url-rules.test.tsx       delays=[0.0,0.0,0.0,5.9]   pendingAtEnd=0/0  margin=61.1ms
… nineteen others                                            pendingAtEnd=0/0
```

**Two files were exposed, not one.** The second — `tests/glossary-band-selection.test.tsx` — was
not in the list of nuqs files handed to the survey; it was found because the probe measured every
candidate rather than reading the ones that looked likely. Its parameter is
`gateParam`, which is `debounce(200)` (`src/web/params.ts`), so its window is four times the
throttle's and it was the one file that ended with a write genuinely still armed. It had never been
seen to fail: 0 failures in 29 runs of the two-file configuration, because a 200ms timer usually
outlives the whole short run rather than landing inside a later file. In the full suite, with
hundreds of files behind it, that is the dangerous direction, not the safe one.

Both are fixed the same way, and the probe confirms it: glossary went `pendingAtEnd=1/1 → 0/0`.

### The third file, left alone deliberately

`tests/remember-url-rules.test.tsx` was reported as a third instance late in the day, on the
grounds that its final test's `mount()` triggers a write nothing waits for, and that its margins are
thin — 35-50ms across six runs, the same band as the file that demonstrably fails.

**The margin part is right and the mechanism is not.** `pendingAtEnd=0/0` is *not* evidence of
safety: `conversation-band-send-new` measured `pendingAtEnd=0/0, margin=26.4ms` and still failed 1
in 30, so the margin is the risk indicator and this file's is no better. But a probe over the final
test — snapshot the address after `mount()`, wait 250ms, compare — shows **the URL does not change
at all**. There is no unwaited write there, and so nothing to wait for.

Measured anyway, in the configuration that catches the others: **0 failures in 60 runs**. That is
not proof. At a 1-in-60 rate, zero in 60 has probability `(59/60)^60` ≈ 37%.

So it is left alone, and this paragraph is the record of why: reproduce before you fix, and adding
a wait for a write nobody has shown exists would be a check that proves nothing — in the postmortem
whose subject is checks that prove nothing. What would settle it is a longer loop, or the probe
catching `pendingAtEnd=1` once. Every *asserted* write in that file is already polled through its
own `until()` helper, which is the right idiom and predates all of this.

I had earlier called this file "safe by construction" on the strength of reading its assertions.
That was wrong in method even though the conclusion has so far held: the writes are what matter,
not the assertions, and the two are not the same list.

## Not a shared helper, and why

The obvious next move is a helper in `tests/helpers/` that every nuqs jsdom test calls. It was
considered and rejected. The two exposed files wait for different things — one for `?thread=` to
name the new conversation, the other for `?gate=` to reach the dragged value — so a shared helper
would have to be told what to wait for, which is what `vi.waitFor` already is. It would be
machinery wrapping a one-liner.

What *is* worth sharing is the rule, and it turns out the repo had already discovered it twice
without generalising it. `tests/conversation-band-send-new.test.tsx` said it in one case and not the
other two. `tests/remember-url-rules.test.tsx` has an `until()` helper whose docstring makes exactly
the right argument — *"waiting a tick after the setter fires is a race, and it is the kind that
passes on an idle laptop and fails when the suite is running sixteen files at once"* — and that file
is safe because of it. The knowledge existed; it just lived in two files' comments where no third
file could find it. So it goes in [testing.md](../project/testing.md) instead.
