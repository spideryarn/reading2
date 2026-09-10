# A later check reads an earlier fallback as evidence

`panes()` in the fleet collector promises that when `tmux list-panes` cannot be read, the
collection carries on without panes: *"not knowing a pane costs a question, while the row itself is
still worth showing"*. Six hours later, `selfCheck` was added downstream. It asks whether the
listing is of this box, and it takes that same empty map as proof that it is not. So under tmux, a
slow or failed `list-panes` does not degrade the collection. It fails it, with the wrong cause:
*"this is not a listing of this box"*. GPT Sol found it while reviewing Stage 3a of
[260910c](../plans/260910c-responsive-collection-monitoring-must-keep-answering-while-it-measures.md)
on 2026-09-10. **Nothing reached a reader**, because this is the operator's dashboard. I found no
sign that it has ever fired. And **the reviewer's premise is half wrong**: production has not run
under tmux since 2026-09-08, which hides this bug and also switches off the check that causes it
(below).

## What happened, verified

A throwaway `tsx` script in this worktree, run against `tools/fleet/collect.ts` at `b2029e4d` and
then deleted, printed the following:

```
selfCheck(new Map(), null, {TMUX:"/tmp/tmux-1000/default,1234,0", TMUX_PANE:"%5"})
  → {"kind":"absent","why":"this process runs in pane %5 and that pane is not in the listing — so the listing is not of this box, or it is missing rows"}
selfCheck(new Map(), null, {})  → {"kind":"cannot-check", …}
```

It then drove `panes()` with a fake `ProbeOwner` returning `timed-out`, `failed` and `refused`, and
with one that threw. All four gave `panes=0 pid=null`. `generationDrift(1234, null)` returned
`null`, which is correct: a null is not drift. `selfCheck` returned `absent`. So the composed path
in `collect()` (`collect.ts:799-804`) throws `this is not a listing of this box: …` in every case.
The script reproduced that composition by hand. `collect()` itself has no seam for `env`, so it
could not be called directly.

**What is wrong is the premise about production.** Today the live server, pid 1017141, is
`fleet-dashboard.service`: `enabled`, `active` since 2026-09-10 09:44:52 BST. Its environment in
`/proc/<pid>/environ` has `INVOCATION_ID` and **no `TMUX` or `TMUX_PANE`**. `collect()` runs in
that process (`server.ts:483`), and nothing in `tools/fleet/` sets `TMUX` at runtime. So in
production `selfCheck` returns `cannot-check`, and a failed listing still produces a snapshot.
[260908f's roadmap](../plans/260908f-overseer-and-fleet-improvement-roadmap.md) (line 406) records
the dashboard under systemd, `enabled`/`active`, from 21:25 on 2026-09-08.

The bug did fire, on the code, in two places:

- Under the tmux-job dashboard, from `41de8c8d` (08:49, 2026-09-08) until the move to systemd. The
  window is inferred. I cannot see when that server was restarted onto `41de8c8d`.
- In `scripts/fleet-collect-bench.ts:552`, which calls `collect(owner)` end to end. Any agent that
  runs it from a pane inherits `TMUX`. This shell has `TMUX=/tmp/tmux-1000/default,132280,2924`.
  That is inferred: I did not run the bench. It matters because Stage 3b's whole-collection
  measurement uses this bench.

## The class: a later check reads an earlier fallback as evidence

A producer degrades by returning a value **shaped like a real result**, and documents that a
degraded answer is still usable. A consumer written later takes the value at face value and makes
decisions on it. The degradation promise is broken without anyone editing the producer. The
failure it causes points at the consumer's hypothesis rather than the producer's failure, so it
names the wrong cause.

It is the mirror of [silent success](../reusable/silent-success.md). There, a failure passes as a
result and nothing is said. Here, a failure passes as a result and something **loud and wrong** is
said: *"not of this box"* for what was a busy tmux. The `why` does hedge (*"or it is missing
rows"*). The prefix `collect()` puts on it does not. For a `refused` probe, the real cause is also
thrown away: the outcome's `why` names the stuck child's pid, and `collect.ts:554` drops it.

**The same value carries a second, silent failure.** `selfCheck`'s `cannot-check` arm was written
for tests and shells (`collect.ts:616-619`: *"runs under `tmux-job.ts` in production and from a
shell in every test"*). It became the production path when the dashboard moved to systemd, about 13
hours after the check landed. Since then, the check that protects against *a calm, populated, wrong
fleet* has not run once in production. The test at `tests/fleet-collect.test.ts:271-285` warned
about exactly this outcome, *"the check would then answer `cannot-check` forever, in production
only, and the tests would say it worked"*, but it guarded only against the wiring changing. Here the
deployment changed. Two comments still say the move has not happened: `collect.ts:616-617`, and the
unit file's own header (*"INSTALLED BUT NOT ENABLED … The dashboard is up under
scripts/tmux-job.ts"*).

## Which commits

| Commit | Date | What it did |
|---|---|---|
| `8215d60f` | 2026-09-08 02:36 | *"The page shows what a blocked session is asking"*. Wrote `panes()`, its `catch { return new Map() }`, and the comment *"not knowing a pane costs a question, while the row itself is still worth showing"*. |
| `a59d65cb` | 2026-09-08 03:27 | Made it a `PaneListing` with `tmuxServerPid`, and added *"A null generation is the same bargain — it says 'unverifiable'"*. **Only the number was given an "unverifiable" meaning. The map stayed an ordinary empty map.** |
| `41de8c8d` | 2026-09-08 08:49 | *"Is this a listing of THIS box? The collector never asked"*. Added `selfCheck` and the throw at `collect.ts:803-804`. |
| `b2029e4d` | 2026-09-10 09:22 | Stage 3a. Routed `panes()` through the owner, so `timed-out` and `refused` now reach the empty map at `:554` as well. Refused is new: one wedged `list-panes` refuses the next call until its exit is observed. That makes the bug more reachable. It did not create it. |

`41de8c8d` considered two degraded inputs: not being under tmux, and a null server pid. It did not
consider an unread listing. Its test of the null pid (`tests/fleet-collect.test.ts:243-248`) models
the pid lost and **the panes intact**, *"Falls through to the pane check, which still passes"*. It
blames the null on *"the `display-message` times out"*, which is `generationNow`, a different call.
The null that `selfCheck` receives is `listing.tmuxServerPid`, parsed from the same `list-panes`
stdout as the panes (`collect.ts:555`). When that call fails, both are lost together. So the test
covered a state the real failure never produces. That comes from reading the code. I did not find
review notes for `41de8c8d` beyond its message.

## Why nothing went red

- **The promise and the check were tested on opposite sides of each other.** `panes()`'s fallback
  is tested on its own (`tests/fleet-collect.test.ts:492-511`, added in `7e0f3475`). "The row still
  arrives" is tested at `snapshotFrom` with an empty listing (`:835-841`). That is downstream of
  `selfCheck`, so the test skips the check that breaks the promise. Every `selfCheck` test
  (`:209-261`) passes a two-row `PANES` and never an empty map.
- **No test calls `collect()`.** I grepped `tests/` and found no caller. `collect()` reads
  `process.env` directly, so its only coverage is the source-text guard at `:283`. That guard
  proves the wiring exists, not what it does. **It is not that tests run outside tmux.** On this box
  they usually run inside a pane, and they pass `selfCheck` an explicit env anyway.
- **The empty map type-checks as a listing.** `ReadonlyMap<string, PaneInfo>` cannot tell "read,
  and empty" from "could not read". `strict` had nothing to object to.

## What it cost

I found nothing. I searched for the literal sentence in these places:

- the primary's `logs/`, including 104 tmux-job logs;
- the worktree's `logs/`, `~/.fleet-health/` and `~/.overseer/`;
- `docs/user-feedback/`, `docs/project/` and `docs/plans/`. The only hit was 260910c itself.
- `/tmp/claude-1000/`, where the only hits are copies of the source.

Two limits make that absence weak. `journalctl -u fleet-dashboard` is not readable from this account
(it is not in `systemd-journal`). And a failed collection is kept only in memory, in `lastError` at
`server.ts:511`, because `tools/fleet/refresh.ts` logs nothing. A firing would have left no
persistent trace. **So I cannot claim an incident, and I cannot rule one out** for the tmux-job
window on 2026-09-08.

## The fix that is right for the long term

**Stage 3b, being built:** the listing says whether it was read. The shape is
`{ kind: "read"; panes; tmuxServerPid } | { kind: "unread"; why }`.

- An unread listing fails the collection with a sentence that names the listing and carries the
  outcome's own `why`.
- A listing that was read but does not contain us still says *"not a listing of this box"*.
- Nothing unverifiable is published, which keeps today's safe behaviour.
- `selfCheck` only ever sees a listing that was read, so the consumer cannot misread the fallback.

**The decision it leaves open, which is the Overseer's:** when the listing could not be read, should
the rows be published anyway, marked unverified?

- *For publishing:* this keeps `panes()`'s original promise. The page stays populated exactly when
  tmux is struggling, which is when it is most wanted, and every row already carries its own
  `unknown`s. A stale page that says why is worse than a current one that says what it could not
  check.
- *Against publishing:* the rows come from `tmux ls`, which is exactly what `selfCheck` is there to
  vouch for. An unread `list-panes` gives no evidence that the sessions are ours, so rows published
  this way are the *calm, wrong fleet* that `41de8c8d` exists to prevent. Showing an unverified
  fleet on the page that other tools act on turns a check into a label.

**The decision is moot while production runs under systemd**, because `selfCheck` never gets that
far. The more pressing question is whether the check should work there at all. That would need an
anchor other than `TMUX_PANE`, for example the socket the server actually queries. It belongs to the
plan, not this file.

## Other fallbacks, and the one that got it right

These are the sites I read in `collect.ts` and `health.ts`, not an exhaustive sweep:

- **`generationNow()`'s `null`** (`collect.ts:689-702`) is the counter-example done right. It is
  documented as *unverifiable*. `generationDrift` (`:673-680`) handles it as its own arm (*"A NULL ON
  EITHER SIDE IS NOT DRIFT"*), and `selfCheck`'s pid branch skips it. The difference is that `null`
  is not a server pid, so no consumer can mistake it for one.
- **`health.ts`** gives every reading a `{ kind: "unknown"; why }` arm (`:22-23`, `:53`, and so on).
  The pane pass writes `permissionMode: { kind: "cannot-tell", why }` (`collect.ts:~489`). Both are
  the shape to copy.
- **`parseSessions`** throws rather than returning an empty list *"when the listing cannot be
  trusted"*.
- **`panes()`'s map is the only fallback I found that is indistinguishable from a real result.** Its
  own `tmuxServerPid` half got the right treatment in the same commit.

## What would have caught it, ranked by ease against value

1. **A value meaning "could not read" is never the same type as a real result.** Make it an arm of
   a union, not an empty collection, so every later consumer has to handle it by name. This is
   Stage 3b, being built. Aimed at the class, it would have forced `41de8c8d` to write the
   `unread` branch.
2. **When you add a check that consumes another function's output, write one test per fallback that
   function documents, run through the check.** It is cheap once `collect()` takes `env` as a
   parameter, and that parameter would also replace the source-text guard at `:283` with a
   behavioural test. Proposed.
3. **Report the check's verdict, and alarm when "cannot check" is the production path.** For
   example, put `selfCheck`'s kind on `/api/state`, or assert in `tests/systemd-units.test.ts` that
   the unit sets whatever the check needs. It would have caught the dead-in-production half within
   a day. Proposed.
4. A lint or grep rule against `catch { return new Map() }` and `return []`. Rejected: legitimate
   empties are common, and the type in item 1 is the enforcement.
5. A sentence in the fleet docs, on its own. Rejected: the promise was already written in
   `panes()`'s comment, six lines from the type, and it did not stop the consumer.

## The thing I would tell myself

When I add a check, I read the value it consumes as data. Before it gets to decide anything, I
should read the function that produces it, list every way that function says it degrades, and ask
what my check concludes from each one. Here the producer said so in plain words and the check took
it for evidence. And a check with a "cannot check" arm needs someone watching which arm production
actually takes. Otherwise a deploy can turn the protection off without a line of code changing.

---

Up: [postmortems.md](../project/postmortems.md)
