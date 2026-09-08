# Box health history: 24h graphs, and drawing absence as absence

> Box Health: graphs of recentish history (last 24h) so he can see whether there were
> problems/disruptions, plus amount/proportion of swap used
>
> — Greg's brief for this workstream, 2026-09-08

Status: **built and looked at**, 2026-09-08. Stages 1-3 landed; stage 4's browser pass is done and
its GPT Sol code review is the second one below. Not yet on `dev` at the time of writing.
Wave: one of five parallel workstreams — see
[260908f-orchestrator-wave-2](260908f-orchestrator-wave-2-write-path-usage-limits-box-health-history-attention-inbox-codex-adapter.md),
which is where the other agents look to see who holds what.

## Goal

Answer one question, from a phone, in the two seconds before Greg decides whether to care:
**was there a problem on this box while I was not looking?**

Not "how is the box now" — [health.ts](../../tools/fleet/health.ts) and
[health-view.ts](../../tools/fleet/web/src/health-view.ts) already answer that, and answer it well.
The missing tense is the past one.

## What is already true, so nobody rediscovers it

Measured 2026-09-08, before any of this was designed.

**Swap is already collected, richly.** `SwapReading` carries `usedBytes`, `totalBytes`,
`usedFraction` and the per-file `areas` count, it distinguishes `none` (empty `swapon` output is a
real answer) from `unknown`, and `SwapActivityReading` separately carries si/so KiB/s, `waPercent`
and `activelySwapping` from `vmstat` — because swap is a cliff and not a slope, and 100% full and
quiet is a different fact from 60% and thrashing. Both already reach `/api/state` and both are
already drawn as tiles.

**So the gap in Greg's bullet is history, not measurement.** *(Confirmed independently by the
`orchestrator-setup` session, 2026-09-08.)* If anything below starts to look like a new parser for
something `health.ts` already parses, it is wrong.

**Nothing is retained.** `health` is a module-level variable in
[server.ts](../../tools/fleet/server.ts), overwritten by `refreshHealth()` once per loop turn, and
nothing in `tools/fleet/` writes anything to disk. A restart loses everything, and restarts are
frequent.

**The real cadence is ~73s, not 60s.** The loop is ~13s of collection plus a 60s wait timed from its
*end* (`refreshLoop` chains rather than intervals, deliberately). ~1,200 samples in 24h. A failed
collection waits 5× that, capped at 300s.

## The four states of a point in time, which is the whole design

Everything below follows from refusing to collapse these. They are four genuinely different facts
and a chart that draws any two of them the same way is lying about the one question it exists to
answer.

| what happened | on disk | on the chart |
|---|---|---|
| the collector ran and read a number | a sample, reading arm `value` | a point on the line |
| the collector ran and one command failed | a sample, that reading's `unknown` arm with its `why` | a violet mark on that series; **no point** |
| the collector itself threw | a sample, `kind: "collector-failed"`, with `why` | a violet band across every series |
| **nothing was written** | **no line** | **a break in the line and a hatched band** |
| the writer could not write | nothing — but the writer says so on itself | a red banner: *any break after this is us, not the box* |

The fourth is the one Greg is looking for and the only one that cannot be written down at the time,
because whatever would have written it is the thing that was not there to write. It is recoverable
only by inference — two samples further apart than the interval the earlier one said to expect —
which is why the expectation has to be recorded rather than assumed.

**Its row said "nothing was running at all" until GPT Sol pointed out that this claims more than the
evidence supports**, and the correction is worth keeping in front of the table rather than filed
under the review below. A break is *no sample was written*. That is the box being down, the dashboard
being down, a collection that hung, a drain that blocked the loop, an append that failed, or — most
often on this box — somebody restarting the server. **The record is silent; why it is silent is not
in it**, and a chart that named a cause would answer Greg's question with an invention. The fifth row
exists because it is the one cause the record CAN speak to, and it is also the most embarrassing one:
a monitor that has stopped writing manufactures an outage that looks exactly like the thing it was
built to detect.

> A GAP MUST RENDER AS A GAP, never as a line drawn across it. […] an interpolated line through the
> ninety minutes the box was thrashing is the single most expensive thing this feature could do,
> because it answers his question with a confident "no".
>
> — the `orchestrator-setup` session, 2026-09-08, as the condition of handing this over

There is a **fifth** state that is not a gap and must not be drawn as one: *before the history
began*. A process that has been up for twenty minutes has no claim about the twenty-three hours
before that, and an axis labelled "24h" over twenty minutes of line implies one. Drawn as its own
region, labelled, and never as absence-of-reading.

## Where the samples are written, and the doc this diverges from

**In the dashboard process, appended from `refreshOnce`.**

[orchestrator-direction.md § Two tenses](../project/overseer-direction.md#two-tenses-the-seam-between-the-overseer-and-the-dashboard)
assigns *"the vitals history"* to the Overseer's past tense. This plan puts it in the dashboard, and
that divergence is deliberate, agreed between the two sessions on 2026-09-08, and left for Greg to
settle in the doc rather than settled here:

- `tools/overseer/daemon.ts` says in its own header, *"No health history and no local collection:
  there is one collector on this box and it is the dashboard's."* The territory is nominally
  Overseer's and factually unoccupied.
- The reading **already exists in-process** in the dashboard. Retaining it there is an append;
  retaining it in the Overseer means it travels over SSE first and then depends on a second daemon
  being up to be written down at all.
- A history whose writer depends on two processes has two ways to develop holes.

> take it. Your argument beats the direction doc's assignment. […] Note the divergence in your plan
> and let Greg move the doc; I will not edit orchestrator-direction.md out from under you.
>
> — the `orchestrator-setup` session, 2026-09-08

**The cost, named rather than discovered:** the dashboard is now the thing whose crash punches a hole
in the record of its own crash. That is not fixable by moving the writer — the Overseer's copy would
have the same hole, because the *collector* is the dashboard either way. It is fixable only by
drawing the hole, which is why the table above is the design and not a detail.

## Key decisions

**Store the `HealthReport` verbatim, and do the projection on the read side.** Measured on this box:
one report is **869 bytes** of JSON (a critical one with several verdict reasons, ~1.4 KB), so a day
is ~1 MB. A narrowed sample would be 398 bytes and save half a megabyte a day on a disk with 145 GB
free — and would cost a mapping function at the write boundary, which is the exact place a lossy
join does the most damage, since what is discarded there is discarded for ever. Verbatim also means
`attribution` (which process group held the RAM at 03:00) is in the file the day somebody wants it,
having cost nothing. *Simpler option passed over: a narrow per-metric sample. Rejected on the ratio
— it buys 0.5 MB/day and pays for it in the one kind of code this feature must not have.*

**Reuse `tools/overseer/jsonl.ts`.** `truncateToLastLine` / `writeAll` / `writeAtomically`, imported,
not edited — its own header exists because that twenty-line discipline had already been written
twice. Cleared with `orchestrator-setup`: happy for `tools/fleet/` to import it as a leaf (no imports
beyond node builtins), nothing in flight in it, last commit `e9cd1e38`. *Simpler option passed over:
inlining `appendFileSync`. Rejected: it is the third copy of a rule whose second copy was reported as
a finding.*

**Two files, and the cap is sized by an invariant rather than by taste.** `health.jsonl` and
`health.prev.jsonl` under `~/.fleet-health/`. Rotate when the live file reaches **8 MB** (≈ 8 days at
the measured rate; ≈ 5 days at the pessimistic one). The invariant: **the cap must exceed 24h of
samples by a wide margin**, because the moment after a rotation the live file is empty and the
previous file is the only thing covering the window. Reader reads both. Ceiling on disk: 16 MB.
*Simpler option passed over: trimming by age. Rejected — it means rewriting the file on a schedule,
and a byte cap needs no clock and no schedule.*

**Its own root, `~/.fleet-health/`, `FLEET_HEALTH_DIR` to override, absolute paths only.** The same
argument `tools/overseer/store.ts` makes, for the same reason: every agent works in a worktree and
deletes it when done, `data/` is gitignored, and a relative override resolves to two different
directories depending on who started the process — two plausible histories, silently. Separate from
`~/.overseer/` so there is no question of two writers on one file.

**One writer by construction, so no lock.** The dashboard binds port 8787 and a second instance fails
to start (`server.on("error")` is fatal, deliberately). `tools/overseer/store.ts` takes an
`O_CREAT|O_EXCL` lock because two Overseer daemons genuinely can coexist; two dashboards cannot.
*Named because it is the assumption that breaks first: if the dashboard is ever run twice against one
`FLEET_HEALTH_DIR`, this needs the lock.*

**A torn line is counted and reported, not fatal — and this diverges from the Overseer's reader
contract, on purpose.** `store.ts` stops at the first hole and cold-starts, because folding across a
hole yields a register that is well-formed, plausible and wrong about which agents are running. A
time series has no such fold: a line that will not parse is one missing sample, which is a 73-second
hole in a 24h chart, and this panel *already draws holes honestly*. Refusing the whole window over
one torn byte would blank the chart, which is the worse failure by a distance. **But it is never
silent**: the payload carries `unreadableLines`, and the panel says so on the page. *This is the one
place I have knowingly departed from a rule a peer asked for; it is called out here so the review can
overrule it.*

**Append on the failed turn too.** `refreshHealth()` catches its own throw so the session list
survives; today that leaves `health` holding the *previous* report, and appending it would write a
reading nobody took, with a fresh timestamp. So the retention hook is told what actually happened —
`{kind: "reading"}` or `{kind: "collector-failed", why}` — and the failed turn is a sample, not a
gap. Without this, *"the box was up and health collection has been broken for six hours"* renders
identically to *"the box was down"*. Raised by `claude-agents-dashboard`.

**Do not synthesise an all-`unknown` report for the failed turn.** It is tempting (one arm instead of
two) and it is a manufactured reading: "the collector threw" and "the collector ran and every command
failed" are different facts, and only the second one has six `why` strings that somebody actually
produced.

**The append goes in `refreshOnce`, not in `server.ts`.** Importing `server.ts` binds port 8787, so
nothing in it can be driven by a test — and *the bug this whole module was re-shaped around was a
missing line in exactly that function*. `refresh.ts` exists so the order can be tested. The append is
a required field on `RefreshDeps`, so a caller cannot forget it and have it compile.

**The append is synchronous and does not `fsync`.** Measured on this box at load 17.5, 200 appends
of an 869-byte line: **median 0.017 ms, p95 0.038 ms, worst 0.5 ms** without `fsync`; 0.98 ms median
and 4.9 ms worst with it. Against a 13-second collection, either is free, so there is no case for
making it async and no case for the complexity that would bring. `fsync` is skipped because the
thing it protects against — a machine crash losing the last few samples still in the page cache —
**renders as a gap, and a gap is a truthful drawing of what happened.** The one durability
requirement this file has is met by the byte, not by the flush: `O_APPEND` makes the write atomic
against interleaving, and `truncateToLastLine` repairs the torn tail at the next start.

**Order within the turn: collect → keep → health → APPEND → publish → drain.** Before `publish` so a
subscriber and the file cannot disagree about a turn; before `drain` because the drain is up to six
`execFileSync` calls at ten seconds each and anything after it can be starved for a minute. Wrapped
in its own try/catch: **a retention layer that takes the dashboard down is worse than no retention
layer.**

**The chart imports `THRESHOLDS` from `health-view.ts`.** Not a copy. Ten of the sixteen instances in
this morning's postmortem are a producer that said the careful thing and a consumer that made its own
copy of it; the tiles and the chart bands must go amber on the same number or the page contradicts
itself in a way nobody will be able to see.

**Inline SVG, nothing new in `package.json`.** Four small charts on a 390px screen is a `<polyline>`
and a scale function. A chart library is the first dependency this tool would take and
[vision.md § Principles](../project/vision.md#principles) says check before adding a third exception
to "prefer boring".

**Gzip the history response.** ~1,200 × 869 bytes ≈ 1 MB, on a phone, over Tailscale. `zlib` is a
node builtin and this is six lines behind an `accept-encoding` check. *The alternative — downsampling
server-side — is rejected outright: a bucket average is exactly the mechanism that hides the
five-minute spike this feature exists to show.*

**Read the whole files and filter by time.** ~16 MB worst case, from page cache, per request — and
the panel asks at most once a minute, because a new sample only exists every ~73s. *Optimisation
passed over: scanning backwards in chunks the way `truncateToLastLine` does. Worth doing if the read
ever shows up in a measurement; not worth doing now on a guess.*

## What this does NOT do

- **No new collector, and no second reading of the box.** The samples are exactly what
  `refreshHealth()` already produces. This box hit load 391 this morning; a second survey is a real
  cost, not untidiness.
- **No alerting, no push.** "Was there a problem" is a question Greg asks the page, not a thing the
  page shouts. Push notifications are a separate stage in the dashboard plan.
- **No window other than 24h in v1.** A 6h/7d selector is one number and a query parameter; it can
  land the day it is wanted.
- **No change to `health.ts`'s readings, thresholds or verdict.** Including the property that the
  verdict is never `ok` on silence.

## Stages

Each is a commit, and each is worth having if the next never lands.

### Stage 1 — the sample and the store

- [x] `tools/fleet/health-history.ts`: the `HealthSample` union (two arms, per above), `appendSample`,
      `readSamples(sinceMs)`, rotation at the byte cap, absolute-path check on `FLEET_HEALTH_DIR`.
- [x] Pure/impure split the way `health.ts` does it: parsing and windowing are pure functions over
      strings, one function touches the filesystem.
- [x] `tests/fleet-health-history.test.ts` against a temp dir: round-trip, rotation (write past the
      cap, assert the window is still covered), a torn last line, an unparseable middle line counted
      rather than fatal, a `collector-failed` sample surviving the round trip intact.
- [x] **Red first**: the rotation test written against a store that does not rotate.

### Stage 2 — the join, which is the stage the postmortem is about

- [x] `RefreshDeps.refreshHealth` returns what happened; new required `retainHealth` dep; the call
      in `refreshOnce` in the right place, in its own try/catch.
- [x] `server.ts`: wire the real store, mount `GET /api/health/history`.
- [x] `tools/fleet/routes-health-history.ts`: window clamp, gzip, the two-armed payload (samples, or
      "the store could not be read and here is why" — **never an empty array standing in for a
      failure**).
- [x] **The test that would have caught the four dead features**: run a real `refreshOnce` against a
      real store in a temp dir, then read it back *through the real route handler*, and assert the
      sample is there. Delete the append from `refreshOnce` and this goes red.

### Stage 3 — the panel

- [x] `health-history-client.ts`: four arms off the wire (history / store-unreadable / this-browser-
      could-not-ask / not-this-API), the same discipline as `messages-client.ts`.
- [x] `HealthHistory.tsx`: the verdict strip, four series (load ratio, memory available, swap used,
      swap activity + IO wait), a shared x scale, bands from `THRESHOLDS`.
- [x] Gaps: break the line, hatch the band, and **say it in words underneath** — "2 breaks, the
      longest 22 min ending 06:14" — because that sentence is the answer to Greg's question and a
      shape on a 390px screen is not.
- [x] "History begins" boundary drawn as its own thing, with the sentence a fresh process needs:
      *collecting since 11:04; 3 samples so far*.
- [x] Mounted in `HealthPanel.tsx` under the tiles, above the raw disclosure.
- [x] `tests/fleet-web.test.tsx` additions: a gap is not interpolated; an `unknown` reading and a
      `0` value do not produce the same output.

### Stage 4 — look at it, then get it reviewed

- [x] **Open the real page in a real browser at 390px and look at it.** Not a test, not a screenshot
      of a fixture — the running dashboard.
- [x] Force each of the four states and photograph them: a real gap (stop the server for a few
      minutes), a `collector-failed` turn, an `unknown` reading, a fresh store with three samples.
- [x] GPT Sol on the built code, with the diff and the screenshots.
- [x] Docs: a section in `orchestrator-direction.md` or its own file, and the line under the entry
      point that owns it.

## What the plan review changed — GPT Sol, 2026-09-08

Verdict was **"rethink the absence model, then build with the named changes. Do not build this plan
as-is."** The full review is
[260908f-box-health-history-plan-review-sol.md](260908f-box-health-history-plan-review-sol.md). What
follows is what was done about each finding, including the two that were declined.

**1. "A gap means nothing was running" claims more than the evidence supports.** *Accepted, and it
was the most valuable finding.* A break in the record is also a collection that hung (the exact fault
`attemptedAt` exists to catch), a drain that blocked the loop, a failed append, or — most often on
this box — somebody restarting the server. **The record is silent; why it is silent is not in it.**
Every sentence, comment and doc line that named a cause now says *no sample was written*, and the
chart's own sentence spells out the three most likely causes rather than picking one. A test asserts
the page never says "nothing was running" or "the box was down".

*The other half of that finding — move health collection into its own fixed-cadence loop — is
**declined**, and this is the one place I have overruled the review.* It is a change to the loop
another workstream owns, mid-wave, and it does not change what the chart may claim, which is the part
that was actually wrong. Worth doing; not worth doing here. Recorded as a follow-up below.

**1c. Return a sample from before the window.** *Accepted.* A window that opens in the middle of a
four-hour break had no way to tell that from where the record begins. `read()` returns a
`predecessor`, and the plot uses it to classify the left edge.

**2. Every unknown must break the line, and test the topology.** *Already true; tests added.* The
plot flushes its segment on any non-value. `tests/fleet-history-series.test.ts` now asserts **segment
counts**, not merely that the markup differs — a test on markup passes on a chart that filtered the
unknown out and drew one calm line across the crisis.

**3. A persistence failure becomes a fabricated outage.** *Accepted, and it is the second most
valuable finding.* If appends start failing, the old file stays readable and the chart grows a hole
at its right-hand edge that looks exactly like the box going down. The store now reports on itself
(`RetentionStatus`), the route carries it on every answer, and the panel draws a red banner naming
the cause and saying **"any break after that is this, not the box."** Verified in a browser by
`chmod 400` on a live store.

**4. A partial write poisons the next line.** *Accepted, then narrowed by a browser pass.* A throw
from `writeAll` may have written part of a record, so the writer refuses further appends until a
restart. But a throw from `openSync` wrote nothing, and poisoning on that made a fixed permission bit
into a permanent self-inflicted hole — so only a mid-write failure poisons. The original cause is
kept in `failure` rather than overwritten by the refusal's own wording, which is a smaller version of
the same mistake and was also found by looking at a real payload.

**5. The join test bypassed the production composition.** *Accepted, and it was the sharpest
finding.* The first join test built its own store and its own route, so it would have stayed green if
`server.ts` composed a different one — the exact failure class it claimed to catch.
`tools/fleet/health-wiring.ts` is now the single composition, `server.ts` holds only a call to it,
and `tests/fleet-health-wiring.test.ts` drives that same function. The one line no import can reach
(`retention.route.handle` in the request path) is covered by a source check and by the browser pass.

**6. Count-and-discard loses WHERE the corruption was.** *Accepted; the peer was right and so was
I, about different halves.* Refusing the whole window over one torn byte blanks a chart that is
mostly fine, so the read does not refuse — but a count alone lets the line reconnect across the
break. Unparseable lines are now returned as **positional holes**, bracketed by their neighbours'
timestamps, and the plot breaks its segments there.

**7. The 8 MB invariant is false at an unbounded rate.** *Accepted.* `why` is now bounded
(`MAX_WHY_CHARS`), so a record has a size; the read reports `rotated`, and the page says *"retained
data begins"* rather than *"collecting since"* once a rotation has happened, because after one the
oldest retained sample is not the first ever taken. The crash-loop case remains a named, accepted
hole — it is written into `MAX_FILE_BYTES`.

**8. Do not cast disk JSON to the current `HealthReport`.** *Accepted.* A stored report is
`StoredReport = Record<string, unknown>`. The writer takes a real report; the reader gets what was on
disk, across a version boundary, and every consumer already reads by name.

**9. Port binding does not construct a single writer.** *Accepted.* The dashboard now takes a writer
lock — `tools/overseer/lock.ts`, which the `orchestrator-setup` session extracted for this. Being
locked out **degrades rather than refuses**: the store still reads, the page still draws the day, and
`lockedOutBy` says why nothing is being added. Worth recording: proving that extraction correct by
mutation found that `isProcessAlive`'s `EPERM` branch — *a live process belonging to somebody else
reads as running* — survived all 102 tests when flattened to `return false`. That is the single line
I had hand-copied, and nothing in the repo would have caught mistyping it.

**10. `THRESHOLDS` alone does not unify the health judgment.** *Partly accepted.* Sol is right that
the operators and the combination rules are still duplicated, and a shared node-free classifier is
the real fix — it is a refactor of `health.ts` and `health-view.ts` together, bigger than this
workstream and touching tiles another agent is in. What bounds the risk here: **the chart does not
compute a verdict at all.** The strip renders the collector's own stored `verdict.level`, and
`THRESHOLDS` is used only for indicative background shading. Historical disk-critical samples stay
visible through the strip even though disk has no line of its own. Recorded as a follow-up.

**11. Synchronous persistence is on the wrong side of the UI.** *Accepted in placement, declined in
mechanism.* The append moved to **after `publish`** — publishing is what a person is waiting on, and
the "file and stream cannot disagree" argument did not survive contact, since the append is caught
rather than fatal and the page fetches history separately anyway. It stays synchronous: measured at
0.017 ms median and 0.5 ms worst at load 17.5, against a 13-second collection, and an async writer is
complexity bought with nothing.

**Cut the window clamp.** *Declined.* It is ten lines, already tested, and makes a 6h view a query
parameter away.

**Update the standing ownership doc before implementing.** *Accepted, done by
`orchestrator-setup`* in the same commit as the lock extraction — `orchestrator-direction.md`
§ Two tenses now carries the divergence, marked as agreed between the two sessions rather than
decided by one, and says explicitly that changing the assignment itself is Greg's call.

### What looking at it found that no review did

**The axis was fitted to the window's peak.** On a day containing the 2026-09-08 spike — load 391 on
16 cores — that put the ceiling at 430, every ordinary hour at 4% of the height, and the amber and
red bands into sub-pixel slivers, so **the entire chart was painted red and a normal day looked
catastrophic**. Every test was green. The axis is fixed now, excursions are clipped and marked, and
the real peak is in the sentence beside the label.

**"Before the record starts" and "no reading to take" were the same grey.** Two meanings, one fill,
in a panel whose whole purpose is keeping meanings apart. There is a boundary rule and a fourth
legend entry now.

**Two hundred sub-pixel rectangles.** A four-hour collector failure is ~200 consecutive samples and
each drew its own 1px `<rect>`. Adjacent spans that agree are merged; the DOM went from ~200 rects
per chart to 7.

### Two more found afterwards, by re-reading my own arithmetic and my own brief

**Three mechanisms described one silence and the sentence added it up.** A break could be produced by
a wide spacing, by a corrupt line bracketed by the *same two samples*, or by the run to the right-hand
edge — and each pushed its own entry. A torn record inside a four-hour outage was pushed twice, so the
sentence read **"2 breaks totalling 8.0 h" about four hours**: a number Greg would act on, arrived at
by adding a thing to itself. `mergeGaps` folds overlapping breaks, **strictly overlapping and not
merely touching** — two breaks that share an endpoint are separated by a sample at that instant, and
merging them would erase a moment the box was heard from. Found by walking the code while the review
was running, reproduced with a failing test first. It is the answer to question 4 of the review
prompt, which I wrote and then answered myself.

**The chart had the number and not the event.** The brief asked for swap *activity*; I had drawn only
`waPercent`. `health.ts` is emphatic that the percentage is not the point — *100% full and quiet is a
different fact from 60% and thrashing* — and `activelySwapping` was collected, kept carefully
separate, and then dropped by my renderer. That is the defect class this whole panel is against, in
my own code. A series may now carry one boolean second fact, drawn as a bar along the bottom and
totalled in words: *"swapping 1.5 h"*.

## The second code review — GPT Sol again, and it said "do not ship" again

[260908f-box-health-history-code-review-2-sol.md](260908f-box-health-history-code-review-2-sol.md).
Every finding was **verified by execution**, not by reading, and the three it repeated were the three
I had answered too cheaply. The headline lesson is one sentence: **clamping one side of an overlap is
not the same as removing it.**

- **One coverage timeline, at last.** Sol had asked for *"one normalized sequence of mutually
  exclusive coverage spans"* and I clamped the spans instead. It ran the four-hour failure case and
  found a gap `[t0, t0+4h]` sitting under an unknown span `[t0, t0+182.5s]` — the hatch hiding a
  known collector failure, the prose overstating the silence by three minutes. Now every layer
  derives from one timeline: samples cover, holes subtract, gaps are the complement. There is a test
  asserting **non-overlap directly**, because a count cannot see an overlap and both earlier attempts
  passed tests that counted.
- **A schedule is not an observation.** `nextDueMs` is what the writer *intended* to wait, and after
  a fleet-collection failure that is five times the cadence even though health succeeded. Coverage is
  capped at twice the nominal cadence, so a backoff draws a small break — true, nobody was watching —
  instead of hiding a real outage inside it. **This is the half of the "keep health on the fleet
  loop" decision that was actually wrong**, and it is fixed rather than deferred; the decoupled loop
  remains the real fix and remains a follow-up.
- **The phone's clock no longer decides what is missing**, after `Math.max(view.toMs, nowMs)` turned
  a fast phone into a one-hour outage.
- **An omission goes on disk.** An oversized sample set an in-memory failure the next success cleared
  — healthy, oversized *critical*, healthy, and the chart joins the two healthy ones. `sample-omitted`
  is a fourth arm.
- **The lock leaked on repair failure**, leaving a lock file naming a process that then did nothing.
- Plus `latestIsCurrent` blind to a trailing corrupt record; seven more client fields defaulted rather
  than required; an `unreadable` envelope read above the version check; a rotation dropping a file
  under a read-only reader for one poll; and a tooltip reading *"red past Infinity"*.

**Two more found by running [260908b](../postmortems/260908b-the-parts-were-all-tested-and-none-of-the-joins-were.md)'s
own checks over this feature before pushing.** Its recommendation is a question to ask on Tuesday —
*who reads this?* of every field a route computes, *who calls this?* of every symbol it exports — and
it works on its author: `windowHours` and `lastAttemptAt` crossed the wire and were read by nothing
(the second is half of a diagnosis, since a writer still trying and one that has stopped being asked
are different faults), and `UNREADABLE_LINE_POLICY` was an exported constant containing only prose.

**Rounds stop at two**, per the working agreements. What Sol would still change is recorded as
follow-ups below rather than pretended away.

## Follow-ups, named rather than silently dropped

- **Health collection on its own cadence**, decoupled from the 13-second fleet collection — Sol's
  finding 1 in both rounds, and the only one it raised twice without being satisfied. The chart no
  longer *claims* a fleet backoff as observation, so the dishonesty is gone; what remains is that
  health's resolution varies with an unrelated failure, and a backoff now shows as a small break that
  is true but uninformative. Belongs to whoever owns the loop.
- **The remaining span-algebra edges Sol would still tighten**, and would not block on: reading the
  two files through held descriptors rather than detect-and-retry, and a fully declarative layer
  stack rather than one built inside `plotHistory`.
- **Trim the prose.** Sol's closing note both rounds: *"the code is over-written rather than
  structurally over-built — roughly 4,000 lines repeat the same rationale many times"*, and that
  repetition has already drifted once. A pass that keeps one statement of each argument and cites it
  from the rest is worth doing when the correctness churn has stopped, which it now has.
- **A shared, node-free classifier** for the health thresholds, used by the collector, the tiles and
  the chart, so the operators and combination rules stop being duplicated (Sol's finding 10).
- **A window selector** (6h / 24h / 7d). The route already takes `?hours=`.
- **Delete the local `HistoryPayload` type** once `tools/fleet/wire.ts` absorbs it —
  `claude-agents-dashboard` owns that move.

## Alternatives considered and rejected

- **Let the Overseer retain it.** See above — the direction doc says so, and it loses to the fact
  that the reading is already in the dashboard's memory and the Overseer had declined the job.
- **A time-series database, or SQLite.** 1 MB a day of append-only lines with one writer and one
  reader. `prefer boring`, and the file is greppable when the page is the thing that is broken.
- **Sample independently of the loop, on a short timer.** Would give a finer-grained chart, and would
  be a second collector on the box this is meant to protect. Rejected in the brief and again here.
- **Downsample or average server-side to keep the payload small.** Rejected as the one transformation
  that structurally hides what the feature is for. Gzip instead.
- **Draw the gap as a zero, or interpolate across it.** Named only so that it is on the record as
  refused: it is the specific failure this plan is written against.

## References

- [health.ts](../../tools/fleet/health.ts) — every reading, every `unknown` arm, and the rule that a
  zero must never mean healthy.
- [health-view.ts](../../tools/fleet/web/src/health-view.ts) — `THRESHOLDS`, imported rather than
  copied.
- [refresh.ts](../../tools/fleet/refresh.ts) — the order of a turn, and why it lives outside
  `server.ts`.
- [jsonl.ts](../../tools/overseer/jsonl.ts) — the append-only discipline, reused.
- [store.ts](../../tools/overseer/store.ts) — the absolute-path argument, and the reader contract this
  plan knowingly departs from.
- [silent-success.md](../reusable/silent-success.md) — the class all four of the states above belong
  to.
- [260907e-agent-fleet-dashboard.md](260907e-agent-fleet-dashboard.md) — the dashboard, its stages,
  and the middle robustness tier this sits in.
- [orchestrator-direction.md](../project/overseer-direction.md) — the standing direction, and the
  § Two tenses that this diverges from.
