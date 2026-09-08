# The parts were all tested and none of the joins were

**2026-09-08**, in `tools/fleet/` — the agent fleet dashboard
([260907e-agent-fleet-dashboard.md](../plans/260907e-agent-fleet-dashboard.md)). Nothing reached a
Spideryarn reader: this is an internal tool on the box, and its only user is Greg. What it cost was a
day in which several features were built, tested, reviewed, ticked in the plan doc and shipped
**doing nothing**, and every one of them was found by a person looking at the running page rather
than by a check.

**Sixteen instances, not one bug.** Five were reported to me; sweeping for the shape found nine more,
and two arrived from other sessions while this was being written. **Ten of the sixteen are the lossy
half and six are the missing-edge half**, and the lossy half holds all three of the expensive ones —
which is why the recommendation at the bottom points at the compiler rather than at a linter.

Three of the sixteen are mechanisms that exist to prevent harm and do nothing: the attribution prefix
that stops an automated coordinator speaking with Greg's authority (#8), the *"what would this
destroy"* preview shown before every destructive box action (#11), and — the worst — **the
dashboard's entire action vocabulary, which has never once appeared on the real page** (#15), under a
sentence blaming the server for being out of date.

## What happened

Measured against `dea7bf69` plus the working tree at **11:03, 2026-09-08**, and the timestamp is not
decoration: the tree moved twice while I wrote this, and instance 7 went from live to fixed between
two of my own greps. Each row says what was true at 11:03.

| # | The part | The join that was missing | State |
|---|---|---|---|
| 1 | `SteeringQueue` — built, bounded, **24 test call sites on `next()`** at `bc2c3e61^` | Nothing in the product called `next()`. Items were accepted, drawn, and dropped at thirty minutes | Fixed, `bc2c3e61` |
| 2 | `transcript.ts` (42KB, tested) + `GET /api/messages?id=` | No page ever called it; `SessionDetail.tsx` drew *"Recent messages are not wired up yet"* | Fixed, uncommitted |
| 3 | `stale` — the queue's own staleness rule, put on every queued item | `parseQueue` does not read it. A dead item draws as an ordinary waiting one | Fixed, uncommitted |
| 4 | `invalidated` — the sentence saying an item can never be delivered | Same. Reached the wire and was dropped for a day | Fixed, uncommitted |
| 5 | `SteeringQueue.revive()` — the only way to re-arm a stale item | No route reached it, so nothing could re-arm anything | Fixed, uncommitted |
| 6 | `stuck` — an unsettled lease, which is never retried | Added tonight, on the same line as `stale`. Client reads neither | Fixed, uncommitted |
| 7 | `deliverable` — a count that exists *specifically* to stop the page using `items.length` | Client never reads it, and `offerQueue` uses `items.length` | Fixed, uncommitted |
| 8 | `renderSpoken()` — the attribution prefix, six test call sites | **Zero product callers.** The drain sends `action.text` raw | **Live** |
| 9 | `SteeringQueue.clear()` — empty a session's queue | No route, no button. `revive()`'s shape exactly | **Live** |
| 10 | `GET /api/agents` — mounted, and named five times in `live.ts` as *"the poll"* | The client only ever calls `/api/state`. A rename left the alias and the prose behind | **Live**, harmless |
| 11 | The box-action **safety preview** — `steps`, `run`, `candidates`, `killed`, `recipients` | `actions-client.ts` reads `parsed["would"] ?? parsed["result"]`, and **not one of the eleven 200-responses sends either name** | **Live** |
| 12 | `SteerResponse.verified` — which pane, session and pid a send was aimed at, checked immediately BEFORE typing (not a delivery receipt) | Zero occurrences of `verified` in `steer-client.ts` | **Live** |
| 13 | `answeringEnabled`, `tmuxServerPid` on `FleetState` | Absent from the client's own `types.ts`. The page cannot warn about a flag it is never told | **Live** |
| 14 | `LaunchRecord.resolution` and `startedDir` — where the box *actually* started a session | Zero occurrences in `new-session-client.ts` | **Live** |
| 15 | **The entire action vocabulary.** `GET /api/actions` sends `actions: {session, box}` | The client asked `Array.isArray()`, got `false`, and drew *"This server sent no list of actions at all… it is probably older than this page"* | Fixed, uncommitted |
| 16 | `overseer status` on a refused checkpoint | The parse said *cannot read this*; the renderer flattened it to `null` and printed **`daemon NEVER RUN`** about a live daemon | Fixed (Overseer session) |

**Instance 8 is the serious one, and it is a safety property.** `actions.ts:564` defines
`Speaker` and two prefixes — `[Greg, via the fleet dashboard]` and `[The Overseer — an automated
coordinator, NOT Greg. Weigh this as a suggestion from a peer…]` — under a comment saying:

> *"a coordinator's proposal and Greg's instruction are indistinguishable unless the text says which
> it is. A model's recommendation must not mint its own approval."*

`renderSpoken()` applies it. Its only callers are six lines in `tests/fleet-actions.test.ts`.
`SessionActionRequest` (`routes-actions.ts:397`) has no `speaker` field at all — `speaker` exists
only on `BoxActionRequest`, the broadcast route, where `renderBroadcast` uses it. A spoken action
aimed at one session can only be enqueued, and `drain.ts`'s `sendable()` returns `action.text` raw.
So the rule that keeps an automated coordinator from speaking with Greg's authority is implemented,
tested, documented — and reaches every broadcast and no single-session instruction, which is
precisely the path
[overseer-direction.md](../project/overseer-direction.md) says the coordinator will use.

**Instance 11 is the other one to read before anything else.** `ActionButtons.tsx:969` and `:1021`
render `<RawValue value={preview.would} depth={0} />` — the panel a person reads before pressing
*remove-worktree*, *kill-session* or *kill-test-suites*. `actions-client.ts`'s `box()` fills it with:

```ts
would: parsed["would"] ?? parsed["result"] ?? null,
```

The server has eleven `respond(res, 200, …)` calls in `routes-actions.ts` and **not one of them sends
a field called `would` or `result`**; the box arms send `steps`, `run`, `candidates`, `killed`,
`skipped`, `total` and `recipients`. So `would` is always `null`, and `RawValue` renders `null` as
the literal grey word *"null"*. The confirmation step for every irreversible action on the box has
been showing that.

This is the same root cause wearing a third face. Class B's usual symptom is *the consumer drops a
field*; here **the two hand-written declarations drifted apart on the field's name**, and both ends
compile perfectly because nothing relates them. A shared type would have made it a compile error the
day the name changed.

Instance 7 is the one to read for the *ordinary* form of the class. `routes-actions.ts:1031` sends the field under this comment:

> *"The page asks 'is anything already ahead of the message I am about to queue' before it offers
> Queue on an idle session, and `items.length` is the wrong answer to that question: an invalidated
> or stale item is in the list and is ahead of nothing."*

And `SessionDetail.tsx`, until 11:03 today:

```ts
const offerQueue = row.status.kind !== "idle" || (waiting !== null && waiting.items.length > 0);
```

The producer computed the careful value, wrote down the exact mistake the consumer would otherwise
make, sent it — and the consumer made that exact mistake, because it never received the field at all.
Stage v0.5g's ticked behaviour ("on an idle session, Send is the only button") was therefore wrong,
for a day, on any idle session holding only stale items. It now reads `hasDeliverable(waiting)`.

**All four of the queue-payload instances (3, 4, 6, 7) were repaired by hand, individually, within
one night** — three of them while this file was being written, one of them between two of my own
greps. That is the treadmill the type fix removes: four correct repairs, none of which stops the
fifth.

### Instance 15: a fixture is a claim about the producer that nothing checks against the producer

The costliest of the sixteen, and the one that says the most about testing here. Every action button
the dashboard has — Continue, Compact, Pull, Push, Remove worktree, Exit, the sleeps — **has never
appeared on the real page**, from the day it was written, under a sentence blaming the server for
being out of date. Found by a browser agent taking screenshots for an unrelated stage.

Neither side is wrong on its own, and **neither commit introduced it**: the server began sending
`actions: {session, box}` in `0955fab4`, the client began asking `Array.isArray(rawActions)` in
`18800ff6`. Two diffs, each internally coherent, and no reviewer of either could have seen the pair.

What makes it belong here rather than being an ordinary bug is the fixture. `actionsWire()` in
`tests/fleet-web.test.tsx` built `{ actions: [] }` — a flat array the route has never sent — under a
doc comment that says:

> *"Written as the **wire shape** rather than as `ActionsFeed`, so every test that uses it goes
> through `parseActionsFeed` — which is the thing that has to be right, and the thing a hand-built
> `ActionsFeed` would skip past."*

**The comment states exactly the right intention and the fixture does the opposite, and ~196 tests
passed over a shape that does not exist.** The author understood the hazard well enough to write it
down and was defeated by it inside the same function. That is the sentence to carry out of this file:
**a fixture is a claim about the producer, and nothing checks it against the producer.** A shared
wire type would have made the fixture itself fail to compile.

### Instance 16: a type with one slot for three facts

The Overseer session's, the same night, and it is where the two classes are most clearly one type
decision. Straight after a schema bump, `overseer status` printed:

> `daemon NEVER RUN — notes but no checkpoint: the Overseer started and never got as far as a first collection`

The daemon was alive, pid 2400163, and had written a checkpoint thirty seconds earlier — a schema 1
one, correctly refused. **The parse did the careful thing; the renderer flattened *"I cannot read
this"* into *"this never happened"***, and so said the strongest available false thing about the most
consequential question the tool answers — one screen away from the code being changed to prevent
exactly that.

Nobody wrote a wrong branch. Somebody wrote a type with one slot for three facts, and every consumer
downstream then had no choice. The repair is the general one:

> The renderer now takes `CheckpointRead` **whole** instead of `Checkpoint | null`. Flattening three
> outcomes into one `null` was the entire bug.

**And instance 15's fix, arrived at independently in another session the same evening, is the same
move**: the client's boolean `catalogueOffered` became a three-armed `CatalogueReading` —
`absent` / `unreadable` / `read` — because *the server did not send a catalogue* and *the server sent
one I could not read* are different sentences and a boolean cannot hold both. Two sessions, two
areas, one repair, neither knowing about the other.

## There are two classes here, not one, and they want different things

They share a parent — *the parts are right and the composition is not* — but that parent is useless
operationally, because **it does not tell anybody what to look at**. The two children do.

### Class A — a part whose only caller is its test

Instances 1, 2, 5, 8, 9, 10. **The edge does not exist.** Nothing is flattened, nothing is wrong inside either
end; there is simply no line joining them. The evidence is an *absence*, which is why no assertion
about either end can find it.

The detector is a question about the graph, not about any type: **who calls this, on a path a person
can reach?** At `bc2c3e61^`, `queue.next()` had **24 test call sites and zero product ones** — 23 in
`tests/fleet-queue.test.ts`, 1 in `tests/fleet-actions-route.test.ts`. (It is 40 today, which is the
number you get if you count without checking the date; the honest figure is the one from the moment
the bug existed.) `revive()` was named in a comment in `drain.ts` and reached by no route. No amount of care inside `next()` or `revive()`
answers that question, and no type can express "somebody must call this" — which is exactly why this
class is a good candidate for a mechanical check and a poor candidate for discipline.

### Class B — the producer said the careful thing and the consumer collapsed it

Instances 3, 4, 6, 7, 11, 12, 13, 14, 15, 16. **The edge exists and carries the value, and the
consumer does not receive it.** The evidence is *present on the wire* and lost, so a reachability check cannot see
it: the endpoint is called, the field is sent, the parser runs.

Three symptoms, one cause — and the third is the one nobody would predict:

- **The consumer drops it.** `stale`, `stuck`, `verified`, `resolution` — parsed types that simply
  have no such field.
- **The consumer never declares it.** `answeringEnabled`, `tmuxServerPid` — absent from the client's
  copy of `FleetState`, so no code could read them if it wanted to.
- **The two declarations disagree about the name.** `would` / `result` (#11). Nothing on either side
  is wrong in isolation; they are simply about different things, and both compile.

The two classes are not always separate in origin — instance 8 is Class A (`renderSpoken()` has no
caller) *because* of something Class-B-shaped (`SessionActionRequest` has no `speaker` field, so no
caller could supply one). But they stay two classes, because the split is about what finds them and
what fixes them, and on both counts they part company.

The wording is the `overseer` session's, arrived at independently the same night from three of its
own defects — a `number | null` that flattened *cannot tell* into *older positive timestamp*, and a
floor value with nothing in its shape to say it was a floor. Its formulation is better than mine and
is worth keeping verbatim:

> **An honest type does nothing if its consumer flattens it, so the consumer must be unable to
> discard the distinction.**

The detector is a question about one type: **can the consumer express dropping this?** And the fix is
not a branch — it is making the flattening *un-writable*. That is why this class is a poor candidate
for a linter and a good candidate for the compiler.

**One class wants a tool and the other wants a type**, and confusing them gets you a linter for a
problem the compiler should have refused.

### The lossy half is the bigger and the more expensive one, and that decides the ranking

**Ten of the sixteen are Class B, six are Class A** — and the gap in cost is wider than the gap in
count. The three most expensive instances in the whole set are all lossy: the entire action
vocabulary invisible for days (#15), the destructive-action safety preview rendering the word "null"
(#11), and a live daemon reported as `NEVER RUN` (#16). Class A's worst, the missing attribution
prefix (#8), is serious but has not yet cost anything, because the coordinator that would exploit it
is not built.

There is a reason the lossy half dominates, and it is not that people are careless about consumers.
**A missing edge is a thing somebody notices the first time they use the feature** — press the
button, nothing happens, and it gets found. A lossy edge produces a page that works, renders,
responds, and is quietly wrong, so it survives being used. Class A is caught by a person; Class B is
not caught at all.

So the recommendation points at the compiler, not at a linter, and ranked item (1) is not merely the
cheapest — it is the one aimed at the larger class. A check that reports Class B findings would still
have been a check somebody had to read; a type that refuses them is not.

**How widespread it is.** A sweep of the whole server→client surface — 162 distinct field names
extracted from the eight wire root types, checked against the client's actual read idiom
(`obj["field"]`) rather than against the identifier appearing anywhere — produced 45 candidates, of
which roughly 30 were real and 15 benign, a **33% false-positive rate**. Every endpoint is affected
except two: the transcript/messages reply and the rename reply are fully read. All ten top-level
fields of `FleetRow` are read; the `FleetState` *wrapper* around them is not (#13).

The commonest benign case is worth knowing, because it is what a naive check gets wrong: the whole
`HealthReport` is unparsed and yet nothing is lost, because `HealthPanel.tsx` renders it through
`<RawValue>` as a raw-JSON disclosure. **A generic dump counts as a reader**, and roughly ten of the
fifteen false positives were that.

### The mechanism behind Class B here, which is not carelessness

The client cannot see the server's types, and not by choice. `tools/fleet/web/tsconfig.json` is a
separate project (Bundler resolution, DOM libs, `types: ["vite/client"]`), and every server type a
page would want to import sits in a module that transitively reaches `node:child_process` —
`queue.ts` → `steer.ts` → `node:child_process`, `status.ts` → `scripts/gjd-remote-tmux.js`. A
`import type` from the client would drag those into a project with no node types and fail on sight.

So `QueueItemView` is declared twice, once at each end, and the two declarations are related by
nothing but hope. **The duplication is structurally forced by the current file layout**, which is why
telling people to keep them in step has failed four times.

And the field does not even have to be typed at the boundary to cross it:

```ts
items: s.items.map((i) => ({ ...i, stale: deps.queue.isStale(i), stuck: deps.queue.isStuck(i) })),
```

`invalidated` reached the browser with **zero lines written at the boundary** — the spread carries
every field of `QueuedItem`. `git log -S invalidated -- tools/fleet/routes-actions.ts` returns
nothing, and that empty result is the diagnosis rather than a failed search.

## Why nothing went red

Every check ran and every check agreed. This is
[silent-success.md](../reusable/silent-success.md) at the composition layer, and each check was
satisfied for a different reason:

- **The fixtures, which is the worst of it.** ~196 tests exercised `parseActionsFeed` through
  `actionsWire()`, a fixture built in the shape the route has never sent — so the suite proved the
  parser correct against a wire that does not exist, and every one of those tests was green while no
  action button had ever rendered. **A fixture is a claim about the producer, and nothing checks it
  against the producer.** The fixture's own doc comment said it was written as the wire shape *"so
  every test that uses it goes through `parseActionsFeed` — which is the thing that has to be
  right"*: the intention was exactly correct and the code beneath it did the opposite. Knowing the
  hazard, in writing, in the same function, was not enough.
- **The unit tests.** Twenty test files under `tests/fleet-*`, and they are good tests. They are all
  over *parts*. A suite built by testing each side of a seam in isolation makes both sides provable
  and makes the seam the one thing nothing asserts — the tests are strongest exactly where the bug
  is. `tests/fleet-actions-route.test.ts` proved the route and the queue shared an object; nothing
  proved anything read from it.
- **`server.ts` cannot be imported, so the top of the wiring tree is structurally untestable.**
  Importing it binds port 8787. Twenty fleet test files mention it only as a string in fixture data;
  none imports it. So the composition root is the one file with no test over it, and the missing
  line in instance 1 was *in* it. **This is the sharpest detail in the whole story**: the defect was
  in the only file the suite was incapable of reaching.
- **The typecheck.** `tools/` is in the root project and typechecks clean. Nothing about an unread
  field is a type error when the two ends declare their own types.
- **The plan doc's checklist.** Stage v0.4c was ticked ✅ *landed* with a reader nothing called,
  because every box under it named a part and every part was done. **A stage is marked done from its
  own diff**, and a diff cannot show you a line that is not in it.
- **The reviews.** GPT Sol found instance 3 — from the code, not from a check. Instances 1 and 2 were
  found by Greg pressing a button and looking at a page. Instance 4 was found by me, an hour after
  writing it, because I happened to remember. Instances 6 and 7 were found by grepping for the class
  while writing this file. **Not one of the sixteen was found by anything that runs.**
- **`npm run knip`, the advisory that ought to have been the safety net.** See below — it never
  looked.

### The rule already existed, in prose, and did nothing

[silent-success.md](../reusable/silent-success.md) says, in its own words:

> **Never write a "should I emit this?" condition as a second list beside the data.** Derive it — so
> a field added tomorrow is covered without a second edit.

`parseQueue` is precisely a hand-copied list of keys beside the data. The lesson was written down
after [260901h](260901h-export-dropped-a-table-the-whole-row-design-was-meant-to-protect.md), where
an export named thirty-one columns by hand and dropped them, and it was written down *before* all
ten of these. Prose cannot fail —
[written-down-is-not-checked.md](../reusable/written-down-is-not-checked.md) — and this is the
cleanest demonstration of it I have: the rule, correct and general, sat in a file every agent is
pointed at, while the same mistake was made four more times in one directory.

## Does `knip` already see any of this? No — and it never looked

This was the question worth answering, because if the signal were already being printed and ignored,
the fix would be "promote an advisory" rather than "build something". Run against the tree, not
reasoned about:

**`tools/` is not in knip's scope at all.** `knip.jsonc`'s `project` globs are `src/**`,
`styles/**`, `api/**`, `scripts/**`, `evals/**`, `*.{ts,mts,cts}`. There is no `tools/**` and no
entry pattern for `tools/fleet/server.ts`. A full `npx knip` produces 359 lines and **zero
occurrences of the string `tools/`**. The fleet dashboard and the Overseer — the newest code in the
repo and the least exercised — are invisible to the one check that reports unused code.

That is itself an instance of a hazard `knip.jsonc` documents at length about its own root-level
globs: *"A file that falls out of scope looks exactly like a file with nothing wrong with it."* The
config's author wrote that sentence and the same trap took `tools/` anyway, because `tools/` was
created afterwards.

**And it would not have caught any of the sixteen even in scope.** Run with `tools/**` added and
`tools/fleet/server.ts` as the entry:

- 96 unused exports + 66 unused types = **162 findings for `tools/`**, and none of the sixteen is
  among them.
- `next()`, `revive()` and `clear()` are **class methods**. Knip 6's issue types are `files,
  dependencies, unlisted, unresolved, exports, nsExports, types, nsTypes, enumMembers,
  namespaceMembers, duplicates, cycles` — there is no class-member analysis, so none of the three is
  analysable at all.
- **`renderSpoken` is a plain export, and knip still does not flag it**, because a test counts as a
  consumer by default. That is the single most load-bearing fact here: *exported, and used only by
  its tests* — the exact shape of instances 1, 5, 8 and 9 — is invisible to knip's default mode **by
  design**, and it is the mode `scripts/check.ts` runs.
- `readRecentMessages` *is* called — by `server.ts`, which is the entry. The dead edge is at the
  HTTP boundary, one layer out from anything knip models.
- `stale`, `stuck`, `deliverable`, `invalidated` are object **fields**. Knip has no concept of them.

So the honest answer to "is the signal already there and ignored?" is **no, twice over**: the tool
never looked at the directory, and the tool cannot see this shape. Adding `tools/**` to `knip.jsonc`
is still worth doing, but it buys a 162-finding backlog and none of these ten — and a fresh
backlog of that size is how the check that *would* have caught the next one gets ignored.

*(Method note, because this file is about checks that agree with the code: `knip --production` on the
same config returned an empty report, which I did not treat as a zero. Its positive control — asking
it for `--files` and for a compact report — showed it reporting a different and clearly wrong
dependency set, so production mode is not measuring what its name suggests here and its zero means
nothing. The 162 figure is from the default mode, which I did calibrate.)*

## What would have caught it, ranked by ease against value

Each entry says what somebody would actually **run or ask**, because the class alone does not tell
anyone what to look at.

1. **One shared wire module, imported by both ends — and it closes Class B by construction.**
   `tools/fleet/wire.ts`, a leaf with **no imports at all** (that constraint is forced, see above),
   holding `QueuedItemView`, `QueueView` and their neighbours. The client's `parseQueue` returns that
   imported type rather than a hand-written twin. Then adding `stuck` on the server is a **compile
   error on the client** until somebody either parses it or writes an explicit `Omit<>` — which is a
   named, reviewable decision instead of a silence. This is the peer's *make the flattening
   inexpressible*, and it is the only item here that cannot rot. **Cheapest per bug prevented, and
   the one to do.**
2. **Ask "who reads this?" of every value a route computes, and "who calls this?" of every symbol
   it exports** — a question, one line in the review brief, and the detector for Class A. It is what
   found instances 6 through 10 in an afternoon with `grep`, after five had been found by people
   looking at a page. Concretely: for each field a route puts on the wire,
   `grep -rn '\bfieldName\b' tools/fleet/web/src/`; for each exported symbol, partition its callers
   into product and tests and read the ones with no product caller. **This question is the
   recommendation** — the class alone tells a reader what happened, and the question tells them what
   to do on Tuesday.
3. **A test that drives the composition root, once the composition root is importable.**
   `refresh.ts` already exists and is exactly this: it was carved out of `server.ts` in `bc2c3e61`
   *because* the missing line was in a file no test could import, and `tests/fleet-refresh.test.ts`
   now enqueues through the real route, runs one turn, and watches the message reach a fake
   transport. The generalisation is the rule: **a file that binds a port may hold dependencies and
   nothing else**; every ordering decision moves to a module a test can import. Catches Class A at
   the server. Does not catch a route no *page* calls.
4. **A mechanical unread-field check.** Extract the field names of the wire types; check the client
   tree for each; fail on zero hits. **Measured: 162 field names → 45 candidates → ~30 real, a 33%
   false-positive rate** — good enough to be useful, not good enough to gate without an allowlist.
   Two things make or break it, both learned by getting them wrong: match the client's **quoted read
   idiom** (`obj["field"]`), not the bare identifier — an identifier search misses `stale`, because
   `Header.tsx` has an unrelated `.stale` — and treat a generic `<RawValue>` dump as a reader, or
   the health panel alone gives you ten false positives. It is strictly worse than (1), which makes
   the mistake impossible rather than reporting it, and it cannot see #11 at all, where both ends
   are internally consistent and disagree about a name. Worth building **only if (1) proves
   unaffordable**; they are alternatives, not a pair.
5. **A mounted-route-with-no-client-caller check** — the one Class A check that pays. Enumerate the
   paths `server.ts` and the `routes-*.ts` files compare against; grep `tools/fleet/web/src/**` for
   each. Catches instances 2 and 10. **Measured on this tree: 12 mounted paths, 2 raw candidates, 1
   real** — and the other was a false positive caused by the client writing `"api/steer/message"`
   without a leading slash, which tells you the matcher has to be substring-not-prefix. A surface of
   twelve is small enough to keep an allowlist for the paths the Overseer and `curl` use honestly.
6. **Adding `tools/**` to `knip.jsonc`** — do it, but not as the answer to this. It catches none of
   the sixteen and arrives with 162 findings.
7. **An exported-function-called-only-from-tests check** — **rejected as a gate, kept as a
   one-off sweep.** The trap is that this repo deliberately uses injection seams whose default is
   the real thing (`realIo`, `realActionDeps`, `realSteerDeps`), plus a great deal of ordinary
   in-module wiring where an exported function is called by another function in its own file.
   **Measured: 143 exported symbols swept, ~55 raw candidates, 3 real — a 95% false-positive rate.**
   A gate at that rate teaches everyone to ignore it within a week, which is the exact failure
   `scripts/check.ts`'s header is written to avoid. But 55 candidates is an afternoon to read by
   hand, and reading them found instance 8. So: run it as a sweep when the shape is suspected, do
   not wire it to an exit code.
8. **Requiring a browser check on every stage** — rejected. It would have caught most of these, and
   it costs a Sonnet subagent and several minutes per stage on a box already at load 391. It is also
   what actually happened, five times, in the form of Greg opening the page; the problem is not that
   nobody looks, it is that looking is the *only* thing that works. It also cannot see instance 8 at
   all — a missing attribution prefix looks like a working message.

## The fix that is right for the long term, and how it differs from what shipped

What shipped was nine repairs, seven of them still uncommitted, each a line joining two things that
already existed — and **seven of the sixteen are still open as I write**, including two of the three
safety mechanisms. Every repair is correct and none of them is the fix; four of the nine were made
one after another, in one night, for one class, by people who could not see the next one coming.

The long-term fix is two changes, one per class, and they are not interchangeable:

- **Class B: one wire module, imported by both ends.** Delete the twin declarations. The compiler
  then refuses the mistake, and its ten instances become unrepresentable rather than detectable.
  **And the fixture goes with it**: `actionsWire()` built a shape the server has never sent, and a
  fixture typed as the shared wire type could not have.
- **Class A: no logic above the port bind.** `refresh.ts` is the pattern and it exists because of
  instance 1; the generalisation is that a file which cannot be imported may hold wiring and nothing
  else, so that the composition itself is something a test can run. Plus the review question in
  ranked item (2), which is the only thing that reaches the page→server edge.

Both are written up as **Stage v0.8a** of
[260907e-agent-fleet-dashboard.md](../plans/260907e-agent-fleet-dashboard.md). Filed at the finish
line is filed and never done, so it is a stage with checkboxes rather than a paragraph here.

## The thing I would tell myself

I knew, while writing `invalidated` into the server and the wire, that the client had a parser I had
not opened. I did not open it, because the field was new and small and I had just written both ends
and the test I wrote went green. An hour later I found it only because I still remembered — which
means the check that caught it was *my memory of the last hour*, and that is not a check, it is a
window that closes.

The part I got wrong was not the missing line; it was believing the tick. Every stage I marked ✅ was
marked from its own diff, and a diff is made of the lines you wrote. **The join is by definition not
in the diff** — that is what makes it a join — so a checklist assembled from the parts is guaranteed
to be satisfiable by a feature that does nothing. When six boxes are ticked and the product is inert,
the checklist is not evidence of anything except that the boxes described parts.

And I would tell myself the thing the seventh instance proved: the server had already written down,
in a comment, the exact mistake the page would make if it never got the field. Writing the warning at
the producer felt like diligence. It reached nobody, because the person who needed it was on the other
side of a boundary the compiler was not watching.

The whole file reduces to one sentence, and it is the Overseer session's, about its own bug:

> **Flattening three outcomes into one `null` was the entire bug.**

Nobody wrote a wrong branch in any of these sixteen. Somebody wrote a type with one slot for several
facts — `boolean` where there were three readings, `Checkpoint | null` where there were three
outcomes, a hand-copied twin where there was one contract — and every consumer downstream then had no
choice. That is why the answer is a type and not a check: a check would find the consumers that got
it wrong, and the point is that they were never given the option of getting it right.

## See also

- [silent-success.md](../reusable/silent-success.md) — the parent class, and the "derive it, don't
  copy the list" rule this violated four times.
- [written-down-is-not-checked.md](../reusable/written-down-is-not-checked.md) — why that rule,
  correctly written, prevented none of them.
- [260901h](260901h-export-dropped-a-table-the-whole-row-design-was-meant-to-protect.md) — Class B in
  the export, thirty-one columns named by hand and dropped.
- [260831e](260831e-a-write-path-with-no-reader.md) — Class A in the blob store: a writer, a name, a
  hash, a verification, and no reader at all, for four days.
- [Stage v0.8a](../plans/260907e-agent-fleet-dashboard.md) — what gets built.
