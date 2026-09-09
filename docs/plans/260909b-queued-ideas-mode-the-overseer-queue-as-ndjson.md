# "Queued ideas" — the Overseer's queue as NDJSON, editable from the dashboard

**Status, 2026-09-09: Stages 1–3 landed, then a second GPT Sol review found two authorisation
bypasses and they are now closed. Stages 4–5 not started, and 4 is blocked on Greg.** What exists:
the append-only file, the fold, its own lock, the CLI, the migration seed (built, **not applied**),
`GET /api/queue`, and the read-only **Queued ideas** tab — 148 tests of its own, typecheck and lint
clean, verified in a real browser at 430px and 1280px, and **every round-two fix mutation-tested**
(§ What the code review changed).

Up: [dev-and-deployment-overview.md](../project/dev-and-deployment-overview.md) via
[overseer-queue.md](../project/overseer-queue.md), which is the doc this work turns into a file.

## What Greg asked for

> add a mode for "Queued ideas" that shows a list of ideas that will each get turned into a prompt
> for their own new-claude agent (probably running engineering-manager.md). I think we said that as a
> stopgap we'd create @docs/project/overseer-queue.md that we could write ideas to - it occurs to me
> that this would be much better if it was NDJSON, to make it easier to append, query, include
> metadata etc. Ideally the UI would allow the user to edit ideas, reorder the queue, and get an
> estimate of how long the wait time is. And also to add a new item (choosing whether it goes to the
> front or back of the queue).
>
> — Greg, 2026-09-08

## What this queue is, and why that constrains everything

The queue is not a todo list; it is **the Overseer's authorisation**.
[overseer.md § gate 3](../project/overseer.md) ends *"nothing dispatched that Greg did not queue"*,
and its test is *"is it in the queue?"*.

That test was adequate while the queue was a Markdown file only a person edited. **It stops being
adequate the moment the Overseer both reads and writes the file**: a coordinator that can append a
line can authorise its own work and then pass its own gate. So the central thing Stage 1 built is not
storage, it is a **replacement for that test**:

```
isDispatchable = the queue read cleanly
              && somebody authorised it   (and only Greg can)
              && they authorised THIS revision, not an earlier one since edited
              && it is still queued
              && it is not waiting on a person
```

Five clauses, each ruling out a real way of dispatching something nobody agreed to, and all five
enforced in **the fold** rather than in the writers — because a rule enforced at one entrance has an
unguarded second entrance, and there are three (the CLI, a route, a hand-edited file). All three
fold.

### Three axes, not one status

The first draft had a single `status` running `queued | blocked-on-greg | dispatched | done |
dropped`. Sol's P1-7 pointed out those are three questions wearing one field, and it was right — a
*running* item can also be waiting on Greg. So:

| axis | values | the question it answers |
|---|---|---|
| `authority` | `proposed` · `authorized{by, at, revision}` | who says this may happen |
| `lifecycle` | `queued` · `dispatched` · `done` · `dropped` | where it has got to |
| `needsGreg` + `waitingOn` | boolean + free text | what it is waiting for |

### An authorisation names the revision it authorises

Sol's P0-2, and the hole the review earned its keep on. Greg approves *"investigate X"*; an agent
edits the text or enlarges the file set; the changed job is still marked approved. The runbook
already forbids acting on an instruction that changed after it was authorised — nothing in the first
draft made that checkable.

So every content edit bumps `revision`, and an approval carries the revision it was granted for.
**An edit by Greg re-authorises in the same act** (he is the authority, and making him press twice
would train him to press twice); an edit by anyone else lapses the approval, and the CLI says
`this LAPSES Greg's authorisation` as it happens.

**Half of this is still open, and the code says so where somebody will read it.** `revision` covers
the fields in the queue file. It does not cover the documents they point at: `source` and `runs` are
paths, so editing the plan or `engineering-manager.md` changes the job while the approval sits still.
That is Sol's round-two P0-1 and it is Stage 4's, because pinning contents needs the dispatch design
to say which documents a brief uses.

### What this does not do, said plainly

Any process running as this user can append `by: "greg"` to the file. That is equally true of the
Markdown file this replaces, so nothing is lost — but it means **gate 3 is a governance constraint,
not an OS capability boundary**, and `by` is a self-declaration rather than a proven identity. Sol's
P0-1. A claimed protection is worse than an admitted gap, so it is admitted in
[`idea-queue.ts`](../../tools/overseer/idea-queue.ts)'s header, in the CLI's header, and here.

The consequence for staging is the important part: **nothing that landed accepts a write over HTTP**,
so the exposure Sol described is not created yet. The route is `GET`/`HEAD` only and refuses anything
else with a sentence saying why, rather than 404ing it — a reader who wants a write path is sent to
the question rather than to a gap. That question is Stage 4's, and it is Greg's.

## The file shape: append-only events

Greg said NDJSON, which settles the format and not the shape. The rejected shape is one line per
item, rewritten on every edit: it loses *who moved this to the front, and when* — of a record whose
purpose is to say who authorised what — and two writers silently lose each other's edit.

Sol agreed with append-only and corrected the reasoning: **the justification is auditability and a
serial history, not that "history is free"**. An event log's costs are the envelope, the strict
per-event parse, the transition validation and the idempotency key, and naming them is what got them
built:

- **the envelope** — `schema`, `eventId`, `commandId`, `at`, `by`. `eventId` makes a line citable and
  lets the version name the tail; `commandId` is the idempotency key, because *"the append succeeded
  and the response was lost"* otherwise duplicates an add on retry, and a duplicated add in an
  authorisation record is the worst kind of duplicate.
- **the version is opaque** — `{events, lastEventId}`, spelled `17.a4f9…`. A bare count cannot tell
  *behind* from *different*: two histories of the same length are the same number.
- **problems, not skips** — anything the fold cannot accept becomes a named `QueueProblem`, and **any
  problem makes the entire queue undispatchable.** A queue two items short must not authorise the
  items it did manage to read.
- **the reader distinguishes three silences** — `never-written`, an empty-but-real file, and
  `unreadable`. The Overseer's own store may cold-start because losing it costs only history; this
  file is original human input and is not disposable, so a lost one must never render as a healthy
  empty queue. **Which took a marker outside the log to actually deliver** — a `queue.created` file,
  because the difference between *never used* and *lost* cannot be drawn from inside a log that has
  been deleted. Sol found the promise unkept; § What the code review changed.

### A reorder is one placement, not a reordered array

The plan asked Sol which of these was sounder and its answer was clear. The rejected shape had the
client send the complete ordering; it cannot be *validated* — an array is a claim about the whole
queue, so a stale one is indistinguishable from an intentional reshuffle and the fold has to guess.

A placement (`front` · `back` · `before(id)` · `after(id)`) is an intent, and an intent can be
checked. Replay is in log order, so an anchor dropped by a *later* event is fine: the move happened
first. An anchor missing when its own move replays is recorded as a problem — **never rounded to an
end**, which is how a corrupt record becomes a plausible one.

LexoRank was considered and rejected for v1 on Sol's advice: key generation, collisions, precision
exhaustion and renormalisation, to solve concurrent order editing that the lock and the version check
already serialise.

## Concurrency

One whole-log version, and **every stale mutation is refused rather than merged** — including two
nominally disjoint reorders. Conservative on purpose: one human plus a low-volume coordinator, and
"apply this move only to the exact queue state Greg saw" is a meaningful promise where silent merging
is not.

The lock is the queue's own (`queue.lock`), and **it cannot borrow the store's** — `overseer.lock` is
held by the daemon for its whole lifetime, so anything waiting on it waits forever (Sol's P1-1). It
spans exactly repair → fold → version check → append → `fsync`, and nothing else: not the request
body, not a launch, not the response.

## The wait estimate: observations, not a forecast — ***needs Greg***

**Greg asked for "an estimate of how long the wait time is" and Stage 1 does not give him one.**
That is flagged rather than quietly decided, and he can overrule it.

A first version computed *position × median session length ÷ concurrency*, with a ±60% band and its
assumptions printed. Sol rejected it twice over and every term was wrong:

- **median session length is a fact about the mix of work**, not about any item — sessions here run
  from a ten-minute doc fix to a six-hour build;
- **a session is not a queue item**; most sessions on this box were never queued at all, so measuring
  the fleet to predict the queue measures the wrong population;
- **`startedAt → tmux-session-gone` is session lifetime, not work duration** — and it is *censored*,
  because the long sessions still running are missing from the sample of finished ones, so the
  average of what has completed is biased short by construction;
- **concurrency is a policy number**, not an observation;
- and the queue is not FIFO: *"a lull"* work starts only when nothing more important is waiting.

> A wide range does not repair a wrong estimator.
>
> — GPT Sol, 2026-09-09

So [`idea-queue-wait.ts`](../../tools/overseer/idea-queue-wait.ts) reports **depth split by why each
item is not moving** (ready · needs Greg · unauthorised · running) and **throughput over 7 and 30
days measured on the queue's own events**, with the sample count. *"Three dispatched in the last 7
days"* is an observation; *"about four days"* is an inference this data cannot support. The
`duration` field has exactly one arm — `not-enough` — so a page cannot render a confident figure by
forgetting a comparison, and it says how far off a real one is.

A duration becomes possible once the queue has ~8 of its own `dispatched → done` observations grouped
by size. `throughput` is what will measure it.

## What the review changed

GPT Sol reviewed this plan before anything was built
(`--model gpt-5.6-sol --effort high`, 2026-09-09, exit 0). Its verdict: *"keep the append-only
design, but do not build or cut over the queue as currently specified."* Acted on: P0-1 (no actor
from a request body; read-only Stage 1), P0-2 (revision-bound authorisation), P1-1 (own lock, opaque
version, named refusal codes), P1-3 (problems and three read arms), P1-4 (migration is a cutover,
and the proposals are not migrated), P1-5 (no forecast), P1-6 (envelope), P1-7 (three axes), P2-1
(restaged), P2-3 (placement intent, and up/down buttons before drag).

Two of its findings were **not** taken as written, and both are recorded rather than dropped:

- **`by: "greg"` on the seeded sixteen.** Sol noted the migration records the events while Greg's
  prior decision supplies their authority, so naming him the recorder is loose. It stands: `by` is
  carrying the authorisation, and his is real and documented — he approved all sixteen in principle
  and deferred them, in his own words in that doc. A third actor for the migration would record the
  clerk accurately and then need a way to say the work was nevertheless approved. **A judgement
  call, and Greg may disagree.**
- **P1-2, the dispatch state machine** (`reserved → started → completed | failed | unknown`, with a
  durable reservation before launch). Sol is right that `dispatched → done` omits the crash cases,
  and right that this argues for designing dispatch before freezing the lifecycle. It is deferred
  rather than refused: dispatch belongs to the coordinator session that owns `jobs.ts`, and Stage 4
  is where the two are designed together. **Nothing in Stage 1 launches anything**, so the ghost
  dispatch it describes cannot happen yet.

## What the code review changed

The code went back to GPT Sol (`--effort high`, exit 0). Its verdict: *"do not cut over yet. The
direct queue-field revision mechanism works, but two authorization bypasses remain, and the 'lost
queue never looks empty' guarantee is not implemented."* All of it was right, and the queue had been
passing 120 tests while every one of these was true.

**Closed, each with a test that a mutation run proves fails without the fix:**

| finding | the bypass | the fix |
|---|---|---|
| **P0-2** | `edit --by overseer --ready` cleared Greg's blocker without bumping the revision or lapsing his approval — an honestly attributed Overseer edit **answering a question only Greg can answer**. Sol ran it. | Setting `needsGreg` is anybody's; **clearing it is Greg's alone**, and the attempt is a recorded problem. |
| **P1-1** | The "strict" parser read `needsGreg: "yes"` as *false*, `metadata: null` as empty and `title: 42` as absent — so a malformed line became an authorised, unblocked, **dispatchable** item with no problem raised. A route straight around `problems`. | **Present-but-invalid rejects the line.** Absent is still a default. |
| **P1-2** | After cutover, **deleting** the live queue rendered *"Nothing has been queued here yet"* and **truncating** it rendered *"everything in it has been dispatched or dropped"*. Both reassuring, both false. | A `queue.created` marker outside the log. With the marker present and the log gone or empty, the read is `unreadable` and says **LOST**. The reader also refuses a relative root, which its comment had claimed while only the writer did. |
| **P1-3** | `dispatched` checked only the lifecycle, so an unauthorised or blocked item could become dispatched with nothing recorded. And `appendEvents` **wrote first and reported problems after**, so a bad `move` or `done` printed a tick and put an *irreparable* problem in the log. | The fold checks what the gate would have checked, at that point in the replay. `appendEvents` **folds the candidate and refuses a batch that adds a problem**. `--anyway` is gone. |
| **P2-1** | `A,B,C → done A → move A front → move C after A` gave a visible order of `C,B` with no problem — the stale-anchor bug re-entering through `moved`. | A settled item cannot be moved. |
| **P2-2** | With one bad line the page said **`12 not approved`** of twelve approved rows, and each row still said *"next in line"* — directly under the alarm explaining the file was the trouble. | `queueHeld` is its own count, authority is asked directly, and `itemWait` has a `queue-held` arm. |
| **P2-3** | `place()` rewrote the whole ordering on every add: Sol measured 41ms at 1,000 items, 686ms at 5,000, **2.37s at 10,000** — folded synchronously in the dashboard's single process. | Back-add is O(1). The alarm on measured GET latency is left for later, on Sol's advice to trigger on that rather than a guessed count. |
| **provenance** | `by: "greg"` on the seeded sixteen was, under the documented meaning of `by` (*who recorded this*), **false provenance** — a script recorded them. | The seed writes them as **proposals**, and `seed` prints the `authorize` commands for Greg to run at cutover. The judgement call is gone rather than defended. |

**Two mutations initially stayed green, which is the more useful result.** Disabling the dispatch
authority check changed nothing, because a `proposed` authority has no `revision` and `undefined !==
0` refuses for an accidental reason — so the test could not tell the two guards apart, and now
asserts the message. And `queueHeld` had **no behavioural test at all**; only fixtures passing zero.
Both gaps were invisible to reading and to a green suite.

**Still open, and honestly named rather than claimed shut:**

- **`source` and `runs` are paths, not pinned contents** (Sol's round-two P0-1). Editing the plan, or
  editing `engineering-manager.md`, changes the job that gets dispatched while the revision and
  therefore the approval sit still. Closing it means an authorisation naming a digest or commit for
  every instruction document, rechecked at dispatch — which belongs with the dispatch design,
  because that is where the document set is decided. Stage 4, and written into
  [`idea-queue.ts`](../../tools/overseer/idea-queue.ts)'s header so it cannot be forgotten.
- **`commandId` is stored and never queried**, so it buys no idempotency yet. Only `add` even accepts
  one. Needs duplicate-result lookup before a write path exists to retry.
- **`GET` does not take the lock**, so it can observe the file mid-append. Cheap to fix by taking the
  same short lock for a read; deferred because the window is one `writeAll` and the page re-reads.
- **The fold is uncapped**, so a very long history is fully parsed per `GET`.

**One finding pushed back on.** Sol suggested a dependency-free `idea-queue-types.ts` that both the
core and the wire DTO import, rather than the core aliasing types out of `wire.ts`. That would make
`wire.ts` acquire an import, and its header's rule — *"this file has no imports and must never
acquire one"* — exists because `tools/fleet/web/tsconfig.json` compiles it a second time under
DOM-only libs. The current direction keeps that invariant: `wire.ts` still imports nothing, and
`attention-classify.ts` and `usage-carry.ts` already reach into it the same way.

## Stages

- [x] **Stage 1 — the authority contract, the fold, the lock, the CLI, the migration seed.**
      `tools/overseer/idea-queue.ts` (types, fold, parse, lock, append),
      `idea-queue-wait.ts` (depth and throughput), `idea-queue-seed.ts` (the sixteen as data),
      `scripts/overseer-queue.ts` (`list · show · add · authorize · move · edit · dispatched · done ·
      drop · seed · export`), and `tests/overseer-idea-queue.test.ts` — 74 tests.
      **Three bugs were found by their own tests going red**, each recorded in a comment where it
      lives: a status guard that read the item's current state instead of the incoming one (so a
      crafted `edited` could drop an item); a settled item left anchorable in the ordering; and
      `Number("")` being `0`, so an empty version string parsed as *the queue is empty*.
- [x] **Stage 2 — the read route.** [`routes-idea-queue.ts`](../../tools/fleet/routes-idea-queue.ts):
      pure payload builder, the three read arms carried rather than flattened, `problems` on the
      wire, and **`ready`/`why` computed server-side** — `ready` is `isDispatchable`, and a second
      implementation of it in browser TypeScript would be a second answer to *"may this go out?"*.
      **`GET`/`HEAD` only**: a `POST` gets 405 with a sentence naming the reason, and a test asserts
      that refusal so adding a write path has to change a test that says why it exists.
      19 tests.
- [x] **Stage 3 — the "Queued ideas" mode.** Key **`ideas`**, deliberately not `queue`
      (`tools/fleet/queue.ts` is the dashboard's *steering* queue and the confusion would be
      permanent). Four registrations plus the mount in `App.tsx`, per
      [fleet-dashboard-modes.md](../project/fleet-dashboard-modes.md); `expect(MODES).toContain("ideas")`
      is the one that survives a clean merge dropping the entry, and the mount test was **verified by
      mutation** — commenting the `App.tsx` arm out reds it, which no type can do.
      27 tests in [`fleet-queue-panel.test.tsx`](../../tests/fleet-queue-panel.test.tsx).

      **The badge is the tab, not the list.** Four reasons an item sits still — *needs you*,
      *proposal*, *approval lapsed*, *ready* — and only the first is Greg's to clear, so flattening
      them into "blocked" would delete the point. A queue-wide problem outranks all four with *on
      hold*, because while the file has a hole in it nothing is dispatchable.

      **Five kinds of nothing, each drawn differently**, since collapsing any two gives an empty
      list that reads as *nothing is queued*: `never-written`, an emptied-but-readable queue,
      `unreadable` (the loud one), `no-answer` in the browser's own voice, and `loading`.
- [ ] **Stage 4 — writes from the page, and dispatch.** ***Blocked on Greg*** — see below. Add
      (front/back), edit, reorder (up/down buttons first, drag as enhancement), authorise, drop; and
      the reservation-based dispatch lifecycle designed with the coordinator
      (`queued → reserved → started → completed | failed | unknown`, reservation durable **before**
      launch — Sol's P1-2 in round one, deferred rather than refused). This stage also owns
      **pinning instruction contents** so an approval names what it approves, and **making
      `commandId` mean something**.
- [ ] **Stage 5 — the cutover.** Applying the seed to the live queue, and switching
      `overseer.md` and `overseer-queue.md` to one canonical source **in one approved change**.
      Sol's P1-4: two sources of authorisation is worse than an old one, and `overseer.md`'s rule
      text is Greg's to change.

## What the browser check showed

Built the client, seeded a queue into the scratchpad, ran a **throwaway server on 8799** — not the
live dashboard on 8787, which the Overseer reads and which this stage was told not to disturb; it
was still serving afterwards. At 430px and 1280px the sixteen migrated clusters render with four
*needs you* badges and twelve *ready*, the Overseer's test proposal renders as *proposal*, the depth
line reads `12 ready · 4 need you · 1 not approved`, and the footer names the file and the version.
`/api/queue` answered with `problems: []` and the same counts, so the route and the panel agree.

**The live dashboard will not show this tab until it is restarted** — it serves the `web/dist/` it
started with. That is the Overseer's to arrange, and it is in the debrief.

## Needs Greg

1. **Where the file lives.** Taken as an assumption pending him: `~/.overseer/queue.jsonl` on the
   box — single writer, survives a reboot, no merge conflicts, and `export` copies it out. The
   alternative is a file in the repo: versioned and visible from the Mac, but a live page editing a
   checked-in file dirties the shared primary and hands `git merge` authority over the live order.
   Sol agreed with the box, and named the shape actually taken: one runtime file off the repo, a
   checked-in deterministic seed, and an export.
2. **Writes from the page need an identity story.** The fleet server has no authentication —
   reachability is the boundary — so a write route would let anything that can reach it write
   `greg`. That is a privilege boundary reachable from a web page, and it is why Stage 4 is blocked
   rather than merely later. The cheap shape Sol suggests: mutations only from allowlisted
   Greg-device tailnet identities, loopback read-only.
3. **No wait forecast, though he asked for one.** § The wait estimate above.
4. ~~**`by: "greg"` on the migrated sixteen**~~ — **withdrawn.** Sol was right twice; the seed now
   writes proposals and prints the `authorize` commands for the cutover, so there is no judgement
   call left to make.

## The simpler option this passed over

**Leaving it as prose in `overseer-queue.md`.** It works today and needs no fold, lock or route. It
is being replaced because Greg asked for the three things a Markdown table cannot do — reorder, edit
and see the wait from a phone — and because *"is it in the queue?"* is a question a gate asks
mechanically, which wants a file with ids over a table somebody greps.

The second simpler option, taken: **no drag, no dispatch, no forecast, and no write path** in the
first landing.

## File set

Mine, all new: `tools/overseer/idea-queue.ts`, `idea-queue-wait.ts`, `idea-queue-seed.ts`,
`scripts/overseer-queue.ts`, `tests/overseer-idea-queue.test.ts`. Later stages add
`tools/fleet/routes-idea-queue.ts`, a client and a panel; `server.ts` gets one mount line, `wire.ts`
one block at the END only, and `mode.ts`/`Dock.tsx` my own four entries and nobody else's.

Not mine: `tools/overseer/jobs.ts`, `scheduler.ts`, `infra/` (the coordinator); actions/steer/kill/
drain and `tools/fleet/queue.ts`; `collect.ts`/`store.ts`/`daemon.ts`/`diff.ts`;
`scripts/gjd-remote*.ts`; `docs/project/overseer.md`, whose rule text is Greg's.
