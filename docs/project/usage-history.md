# Usage history: the last 24 hours of Claude's limits

The **Usage limits** tab in the fleet dashboard has two halves. The top is the current reading, and
it is the same `UsageCard` the Overseer tab draws — one component, mounted twice, so the two can
never disagree. The bottom is this: how utilisation moved and what was rejected, over the last day.

**This doc is about the history half.** The reading itself — what the cache is, why an expired window
is unknown rather than a percentage, why a transcript 429 is ground truth — is in
[overseer-direction.md](overseer-direction.md) §§ "What is actually observable about usage limits"
and "Can we call an API instead?". Read that first; nothing here makes sense without it.

The work is [260909b](../plans/260909b-usage-limits-tab-fleet-dashboard-24h-history.md), and the four
designs abandoned on the way are in
[260909a](../research/260909a-usage-history-the-dead-ends-and-how-the-plan-was-wrong-twice.md).

## Why there is a store at all

`~/.overseer/current.json` keeps only the **latest** reading, overwritten in place, and the
`~/.claude.json` cache behind it is overwritten too. So usage history **cannot be reconstructed after
the fact** — not from the transcripts, not from anywhere. If nobody wrote each reading down as it
happened, the last 24 hours does not exist.

That is the whole justification for the file. It is not a cache and not an optimisation.

## The shape

| | |
|---|---|
| File | `~/.overseer/usage.jsonl` (and `usage.prev.jsonl` after a rotation) |
| Written by | the **Overseer daemon**, one line per `collectUsage` pass |
| Read by | the **dashboard**, lock-free, on `GET /api/usage/history?hours=N` |
| Cadence | one line per pass — 288 a day at the 300 s timer |
| Size | ~3.8 KB a line, measured on live data |

Modules: `usage-history-record.ts` (the record and its merge contract), `usage-history.ts` (the
store), `usage-history-from-report.ts` (the mapping), `usage-history-wiring.ts` (the join),
`routes-usage-history.ts` (the route), and the web trio `usage-history-client.ts`,
`usage-history-series.ts`, `UsageHistory.tsx`.

## Four things that are not obvious

### The daemon writes it, and the coupling lives in the composition root

`daemon.ts` gained an `onPass` callback and **imports nothing** to serve it. The store and the
mapping are `tools/fleet/`'s; the pass that feeds them is `tools/overseer/`'s; `scripts/overseer.ts`
joins them, because it is the only file allowed to touch both sides of that seam.

The writer is the daemon rather than the dashboard because the daemon **knows** when a reading
happened — `chooseUsage` already returns its decision as a value — whereas the dashboard could only
infer it. And the dashboard is downstream of the only collector, so it can never see anything the
daemon did not produce.

### There is no writer lock, deliberately

`~/.fleet-health/` elects a writer because its writer is the dashboard, of which there can be
several. This store's writer is the daemon, of which there is exactly one by contract, behind a lock
already held. A second election is not redundancy — it is a **deadlock**: one process could win the
history lock while another wins the daemon lock, leaving the real daemon with a permanently read-only
handle and nothing able to explain why. The reader is a separate function with no lock code in it, so
the dashboard is structurally incapable of claiming the store.

### Recorder health is derived, not reported

Health's route serves `store.status()` because its writer and route share a process. Here they do
not, so `failure` and `poisoned` live in memory the route cannot reach — and serving a status read
off a *reader* handle would claim "no failures" merely because that process never tried to write.

So the route answers the weaker honest question — **is anything still being recorded?** — from the
records: the last line's own instant plus its own declared cadence. What it cannot distinguish is
*why*: a daemon that is down looks like a disk that went read-only. That is a real limitation, the
page says so, and a status sidecar would close it if anyone ever needs the distinction.

### A publication decision is not an observation

`chooseUsage` keeping a complete earlier report over an incomplete fresh one is a decision about the
**checkpoint**. It says nothing about that pass's *cache* reading, which comes from a different
source and cannot be spoiled by an unreadable transcript. So each record holds the cache observation,
the scan result and the publication decision as three separate facts.

An earlier design folded them together, and would have dropped a real, attributed utilisation point
off the chart every time a single transcript could not be opened.

## What the chart may not claim

Each of these is a way a usage chart is confidently wrong, and each has a test.

- **Absence is never a zero.** A cache that named no account carries no windows at all; the line
  breaks. Drawing 0 would say headroom was exhausted.
- **Validity is adjudicated once, at the collection instant, and never again.** A reading of 70%
  taken at 10:00 for a window resetting at 12:00 is true. Re-deciding at 18:00 whether it has expired
  would delete it — and on a five-hour window that erases most of the day. The live card re-derives
  expiry because it describes *now*; the chart describes *then*. Points are labelled *as observed*,
  and one still visible after its reset is correct.
- **Three absences, kept apart**: within a window (the producer's arm), within a scan
  (`absenceGapReason`'s question), and *between records* (derived only from source instants and each
  record's own cadence). `absenceGapReason` **cannot** say why the next record never arrived; using
  it there would join the line across an unobserved hour.
- **Utilisation is per-account; rejections are not attributed at all.** A transcript 429 carries no
  account id, and the scan looks back eight days that may span a `/login` swap. Rejections are drawn
  as observed window clusters and never split by account.
- **An incident is drawn once**, spanning the instants it actually happened at, merged across every
  record that carried it by its derived id. One mark per record would draw 288 rejections for one
  event. Counts come from a scan that **finished** — a scan that stopped early saw fewer rejections,
  not a corrected number — and the UI says so.
- **An unrecognised window is a named row.** Three are live on this box today with no `resets_at`,
  and their unvalidated percentage is literally `0`.
- **A record this build cannot read keeps its position** and breaks the series, rather than being
  skipped so the chart closes over an hour it could not interpret.
- **A clock going backwards is reported**, not sorted away.

## Multiple accounts

Every line carries `accountUuid` and the reader groups by it, so a second account produces a second
series with no format change. That much is already done.

**The open product decision** is labels: a switched-away account survives in history only as an
opaque uuid, because the current checkpoint can describe only the account logged in now. Storing a
display descriptor was declined on privacy grounds — the file is long-lived and unpruned, and an
email is materially more identifying than an opaque id. A future picker can resolve the *current*
account's uuid at view time and show truncated uuids for the rest. Changing that is a format
decision, and cheaper before more history accumulates.

Beyond labels, a second account needs a collector that can see both. `collectUsage` reads one
`~/.claude.json`; `CLAUDE_CONFIG_DIR` isolation is plausible and **untested**.

## See also

- [overseer-direction.md](overseer-direction.md) — the reading rules, and the `~/.overseer/` seam table.
- [fleet-dashboard-modes.md](fleet-dashboard-modes.md) — how a tab is added, which is where the tab
  half of this feature is documented.

---

Up: [dev-and-deployment-overview.md](dev-and-deployment-overview.md)
