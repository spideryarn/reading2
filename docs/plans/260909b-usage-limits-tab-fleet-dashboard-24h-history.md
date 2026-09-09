# Usage limits: a fourth fleet-dashboard tab, with the last 24 hours

**Status as of 2026-09-09: planned, not built.** Evidence: `git grep -l usage-history` returns
nothing, and `MODES` in `tools/fleet/web/src/mode.ts:30` still has three entries.

## Goal

A fourth tab in the fleet dashboard — **Usage limits** — beside Sessions, Box health and Overseer,
answering two questions Greg cannot answer today without reading a CLI:

1. **Where are we right now?** The current reading, shown exactly as the usage card on the Overseer
   tab shows it — the same projection, the same verdict rules, the same UTC/London/Athens times.
   Never a second interpretation of the same bytes.
2. **What happened over the last 24 hours?** Per known window (`five_hour`, `seven_day`), how
   utilisation moved, plus every rate-limit incident in the period — drawn the way
   `HealthHistory.tsx` draws load.

Greg, 2026-09-08 (verbatim, the request this plan answers):

> Do we have an agent working on a tab showing "Usage limits" (alongside Sessions, Box health, etc)
> - if not, please let's new-claude one (and ask it to start with Sonnet research on previous
> conversations, docs, research, scripts, etc). Ideally also show them over time for the last 24h,
> and in future we'll want to support multiple accounts on the same box, but perhaps not today..

### Why there is no history today

`~/.overseer/current.json` holds only the **latest** `StoredUsage` (`store.ts:460`, written whole
via `writeAtomically`, `store.ts:2619`). `events.jsonl` carries daemon lifecycle events and has no
`kind: "usage"` arm. Nothing anywhere keeps a previous reading.

So "the last 24 hours" is not a rendering problem, it is a **missing store**, and the bulk of this
plan is that store: written once, read bounded, drawn honestly.

## Context: what is knowable about usage limits

Every rule below was paid for by somebody. Source: `docs/project/overseer-direction.md:640-680`
("What is actually observable about usage limits", "Can we call an API instead?"), revalidated by
hand on 2026-09-08.

- `~/.claude.json` → `.cachedUsageUtilization` is a **cache, and a hint**. Observed stale in the
  wild: a 48-minute-old file describing a window that had reset 27 minutes earlier. A window's
  `resets_at` is the validity check — **expired means unknown, never a percentage**. Enforced at
  `tools/overseer/usage.ts:255-297`: `resets_at` is checked *before* the percentage is trusted, and
  the expired arm carries no percentage field at all, only prose in `why`.
- A **transcript 429** is **ground truth** — `error:"rate_limit"`, `isApiErrorMessage:true`,
  `apiErrorStatus:429`, plus `quotaLimits.rateLimitType`/`resetsAt`. Exact, greppable, cannot go
  stale.
- **There is no `claude usage` subcommand** and no pre-warning anywhere. Everything is post-hoc.
- **Do not propose calling an API.** The Anthropic Admin API and the documented rate-limit headers
  measure Console API-key spend — a *different billing system* from a Max subscription. The
  undocumented `anthropic-ratelimit-unified-*` / `GET /api/oauth/usage` are unsupported and 429 for
  Max users. Greg offered an admin key on 2026-09-08 (*"If absolutely necessary I can provide an
  Anthropic admin key in the .env.local that gets pushed by gjd-remote to this box."*); the research
  that day concluded it would not help. **Do not ask him for one again.**

### The scan is expensive and must stay where it is

A full transcript rescan is **30–45 s over ~1,770 transcripts / ~2.9 GB**. Two consequences this
plan inherits rather than re-decides:

- **One collector.** `collectUsage` (`usage.ts:1336`) on the daemon's `USAGE_INTERVAL_MS = 300_000`
  timer (`daemon.ts:417`, wired `scripts/overseer.ts:975`) is the only thing that scans. This plan
  adds **no second caller** — a contract set by session `260908f-roadmap-usage` and agreed by this
  session on 2026-09-09.
- **Never inside the heartbeat tick.** A 45 s blocking scan makes every tick look 45 s late — the
  "healthy operation spending most of its time alarming" trap.

An incremental scan was proposed during Stage B **and withdrawn by its own author**: `mtime` is a
bad watermark because active transcripts are appended to constantly. Simplest version first — a full
scan on a slow timer; the store carries memory, not speed (`usage-carry.ts`'s `chooseUsage`).

### Multiple accounts

Greg, 2026-09-08:

> Right now, I have a couple of Claude Max subscriptions, and I run /login every couple of days to
> switch when I hit limits. In future I expect to have more. But let's say that multiple Claude Max
> subscriptions is MEDIUM-TERM, i.e. out of scope for the next day or two.

Already recorded in the code, `tools/fleet/wire.ts:317-319`:

> "Recorded, never rotated: multiple Max subscriptions is medium-term by Greg's explicit call, so
> this stage records which account and builds no rotation."

So: **record, do not build.** Every history line carries `accountUuid`; the tab groups by it and
shows one account today. No switching, no second cache file, no settings. What a second account
would additionally need is in the appendix, so it is a stage later and not a rewrite.

## Principles and key decisions

Numbered so reviews and later stages can cite them.

**D1 — One projection, never two.** The tab's "now" half renders by mounting the *same*
`UsageCard` component (`tools/fleet/web/src/UsagePanel.tsx`) fed by the *same*
`projectUsage` (`tools/fleet/usage-feed.ts:190`) the Overseer tab's card uses. Not a copy, not a
reimplementation — the same component. If the tab and the card can disagree, that is a bug in this
plan.

**D2 — Store the projection, not the raw checkpoint.** Measured on the live checkpoint on
2026-09-08 by `260908f-roadmap-usage`: the whole file is 99,480 bytes and the `usage` blob alone is
**60,970** — 140 hits at ~405 bytes each. At one line per distinct reading that is still megabytes a
day of *the same 140 hits re-serialised*, and it grows with the transcript backlog rather than with
anything interesting. The projected summary is bounded, because incidents are grouped
(`groupUsageIncidents`, `usage-feed.ts:96`) before they cross the wire.

**What this gives up**, stated plainly because it cannot be recovered later: individual hit ids and
transcript paths are not in the history. The raw checkpoint is still on disk for the **current**
reading, so nothing is lost about now — only about then.

> **AMENDED by Sol F2/F8.** "Not the raw checkpoint" is right; "therefore store the card's
> projection" was a leap. A UI type is not a durable format, and the list above was not the whole
> list of what is given up. The persisted record is now **purpose-built and separately versioned** —
> Stage 2 designs it around the claims the chart makes. See the rulings below.

**D3 — A history line is a loose record, tagged with its provenance.** Copying
`health-history.ts`, which stores `report: Record<string, unknown>` and pointedly **never re-types
it** as a `HealthReport`, because those bytes crossed a version boundary. Each usage line carries
its own `schema` (of the line format) and the `checkpointSchema` that produced it. Anyone who later
chooses to replay a *raw* line back through `projectUsage` must honour `KNOWN_SCHEMA`, which is
checked hard — a schema-2 line replayed as schema 3 would produce a confidently wrong answer with no
error. We avoid that class entirely by storing the projection, but the provenance field is what
makes a future migration possible at all.

> **AMENDED by Sol F8, and I had the health precedent backwards.** Health's **writer** takes a typed
> `HealthReport`; only bytes *read back from disk* become `Record<string, unknown>`. So: **type the
> write side, keep the read side loose** — the reverse of what this decision said.
>
> And `checkpointSchema` is the wrong version to hang the payload on. `projectUsage` can rename or
> reinterpret a field without the Overseer's checkpoint schema moving at all, after which two lines
> both saying `checkpointSchema: 2` hold incompatible shapes and nothing can tell them apart. Every
> line therefore carries a **`summarySchema`** of its own, alongside `checkpointSchema` as
> provenance.

**D4 — One line per collection pass, three kinds. Hook the pass, never the tick.**

*Revised 2026-09-09 once the writer became the daemon; the original text is kept below because the
trap it names is still live.*

The daemon appends one line per `collectUsage` pass, carrying which of three things happened:
`take-fresh` (a new reading), `keep-stored` (the fresh scan fell over and `chooseUsage` republished
an earlier report — no new reading, and the `why` says so), or a throw. There is **no dedupe key**,
because the writer is the process that knows.

> **AMENDED by Sol F3/F4/F11, and F4 is a real improvement rather than a correction.**
>
> - **"No new reading was taken" is wrong for `keep-stored`.** `chooseUsage` keeps a complete 10:00
>   report over an *incomplete* 10:05 one — so a fresh observation existed and simply was not
>   published. The daemon holds it; the dashboard never could. A carry line therefore records the
>   carry reason **and the discarded fresh observation** (its cache reading and `coverage`), in a
>   separate labelled arm. A gap becomes "the scan stopped at 40 of 1,835 transcripts" instead of
>   "something didn't happen".
> - **There is no universal source instant.** The throw arm is `{kind: "none", at}` and has no
>   `collectedAt` at all. Requiring one would collapse every failure into the first, drop them all,
>   or fall back to `writtenAt` and write the same failure every 30 s. Each arm names its own source
>   instant.
> - **`collectedAt` is neither monotonic nor unique** — it is `new Date(Date.now()).toISOString()`,
>   and a wall clock can step backwards. A reader that promises "oldest first" by file order can
>   reverse its own polyline. Lines carry a separate `recordedAt`, and a clock regression is
>   surfaced rather than quietly sorted into plausibility.

**The trap that survives the revision**, and the reason this decision is numbered: `TICK_MS = 30_000`
and the checkpoint is **rewritten on every tick**, so `writtenAt` advances every 30 seconds whether
or not a usage pass ran. A writer hooked to the checkpoint *write* — the obvious place — would emit
~2,880 lines/day, ~90% of them the same reading re-stored, and would blur exactly the collector
failures the series exists to show. The hook goes in the `.then`/`.catch` of the 300 s timer.

Before the writer moved, this decision read "dedupe on `collectedAt`, never on `writtenAt`", which
was the right answer to the question as then posed: `UsageSummary.collectedAt` is the reading's own
clock and moves only when a pass produced something. That answer is now unnecessary rather than
wrong — and it is worth noticing that **the better design made a correctness question disappear
instead of answering it.**

**D5 — Two series, drawn differently, because they carry different claims.**
- **Utilisation is per-account and safe to plot.** It comes from the cache's `attributed` arm,
  which carries an `accountUuid`.
- **Rejections are not attributable.** A transcript 429 carries **no account id at all**, and the
  scan covers ~8 days (`DEFAULT_SINCE_MS`) that may span a `/login` swap. Live proof from this box
  on 2026-09-08: **27 unexpired `seven_day` rejections, verdict `unknown`**, because the daemon
  could not attribute them. `groupUsageIncidents` accordingly groups by `${window} ${resetsAtMs}`
  and not by account.

  So the rejection series is plotted as *observed window clusters with no account attribution*,
  labelled as such, and **never split by account** — doing so would manufacture attribution the data
  cannot support. Only `UsageVerdict.activeLimit` / the verdict level carry an attributed claim.

**D6 — Absence is a gap, never a zero.** An absent or too-short history renders as
"no history yet since &lt;time&gt;". Within the history, a reading whose cache arm is `unattributed`
(the `/login`-swap case, which carries **no windows at all**) or `unknown` is a **break in the
line**, not a point at zero. Every "is this silence believable" question goes through
`absenceGapReason` (`tools/fleet/usage-absence.ts`, pinned against the producer by
`tests/fleet-usage-absence.test.ts`) rather than being re-derived here — a chart that plots a `none`
without it draws a confident flat line over a scan that opened nothing. Gap width comes from each
sample's own recorded cadence, the way `history-series.ts` uses `nextDueMs`, not from one assumed
interval.

> **AMENDED by Sol F10: two absences, not one, and `absenceGapReason` answers only the first.**
> "Never zero" survives; "route every silence through `absenceGapReason`" does not, because it is
> answering a different question from the one the chart asks between samples.
>
> - **Within a recorded sample**: was this scan's failure to find a 429 believable? That is
>   `absenceGapReason`'s question, and it is the one it was built for.
> - **Between samples**: why did the next record never arrive? `absenceGapReason` **cannot know**.
>   A complete scan at 10:00 establishes "no 429 found" and its predicate returns no gap — but it
>   says nothing whatever about an hour in which nothing was recorded. Applying it there would join
>   the utilisation line straight across an unobserved hour, or label the silence "no incidents".
>
> The second layer is derived only from source instants and the recorded cadence, and it says
> nothing more than "nothing was recorded". The two must not be collapsed, however tempting the
> shared word "absence" is.

**D7 — No three-way collapse.** Inherited from the Stage B Sol reviews: a `null` or ambiguous
comparison must never collapse into a positive claim. The `contradictsCachedWindow` bug had `null`
mean both "agree" and "couldn't check", and both callers read it as a live rejection. Any
"does this belong to this account" logic here is three-valued (matching / contradicted /
cannot-attribute) and **only the matching arm may assert anything**.

**D8 — Store instants, format at render.** A relative-time string ("cache fetched 73 min ago") is a
rendering, not a fact, and becomes false the moment it is pasted into a doc. History lines store
epoch milliseconds and ISO instants only. Expiry is re-derived by the *renderer* against its own
skew-corrected clock — `projectUsage` deliberately takes no clock and reads nothing live, so that a
server-computed "expired" never ships an answer as old as the payload.

> **AMENDED by Sol F1 — a P0, and the finding I would have shipped.** "Re-derive expiry at render
> time" is right for the **current card** and **wrong for history**, and the second half was hiding
> inside the first.
>
> The cache says 70% at 10:00, resetting at 12:00. `parseUsageWindow` records a `value`, correctly,
> because it *was* valid at 10:00. Greg opens the 24-hour chart at 18:00. This decision as written
> tells the renderer to re-evaluate expiry against 18:00 — so a true, correctly-recorded observation
> becomes "expired/unknown" and **disappears from the chart**. Every point older than its own window
> would vanish, which on a five-hour window means most of the day.
>
> **Current state and history need different clocks.** The live card evaluates expiry at view time,
> because a stale "still valid" would be a live lie. A historical point preserves what was true at
> its own `collectedAt` and is **never re-adjudicated by today's clock**. Stage 2 freezes the
> verdict at write time for exactly this reason.
>
> D8's original rule survives intact for *formatting* — a relative-time string is still a rendering,
> not a fact. What it must not extend to is *validity*.

**D9 — MOOT since the writer became the daemon (2026-09-09).** There is one daemon by contract, and
the dashboard reads this store lock-free exactly as it reads `current.json`, so the race below
cannot arise for it. Kept because the reasoning still binds `~/.fleet-health/`, and because if this
store ever acquires a second writer, this is the rule it must adopt.

~~Being locked out is not a refusal to open.~~ Proved on this box on 2026-09-08: a second
dashboard on `FLEET_PORT=8799` shares the same directory as the live one on 8787, and two starts can
race before either sees an async bind failure. `health-history.ts` already learned this — the store
still **reads**, the page still draws the day, writes silently no-op, and `status().lockedOutBy`
says why. A dashboard that refused to start because another held a lock would be unavailable exactly
when somebody is trying to find out what went wrong. `FLEET_USAGE_DIR` exists for the same reason
`FLEET_HEALTH_DIR` does: so a preview instance can be pointed elsewhere.

**D10 — Nothing in scope makes a paid request, enforces anything, or defers a launch.** No admin
key, no export from `~/.claude.json` beyond the utilisation fields already read, no second
`collectUsage` caller, no account switching.

### The seam, and where the file goes

**SETTLED 2026-09-09, arbitrated by Fable after I got it wrong once.** The history lands at
**`~/.overseer/usage.jsonl`**, written by **the daemon**, through a callback composed in
`scripts/overseer.ts`. The dashboard reads it lock-free, exactly as it reads `current.json`.

This keeps `overseer-direction.md`'s existing statement true — *"the daemon is the only writer of
any of them"* — so the seam table gains a row rather than an exception, and the
`~/.fleet-usage/` idea below is abandoned. **D9 becomes moot**: nothing in the dashboard takes a
lock, so the two-dashboards-on-8799 race cannot arise for this store at all.

The section below is kept rather than deleted, because how the first answer was reached wrongly is
the part worth having.

#### Why the daemon, and the fifth option that made it cheap

The writer should be the process that **knows when a reading happened**. Every awkward part of the
dashboard design — the dedupe key, a lock on the `/api/state` path, the two-dashboards race, history
that stops when the dashboard restarts — is a workaround for not being that process.

And the daemon knows **more** than the dashboard, not merely as much:

- `daemon.ts:712-729` produces a clean **three-arm, once-per-pass** event: `take-fresh` sets the
  report, `keep-stored` leaves the local `usage` untouched (so `collectedAt` does not move), and a
  throw sets `{kind: "none", why, at}`. That is exactly the series, read off values that already
  exist.
- On `keep-stored` the daemon still **holds the discarded incomplete fresh report and its
  `coverage`**. The dashboard never sees it — it gets the held report and a log line. So a
  `kind: "scan-incomplete"` history line carrying the gap *reason* is available daemon-side only.
  "Gaps are real signal about the collector" becomes signal **with a reason**, rather than an
  inferred silence.

**The condition that makes this correct — hook the pass, not the tick.** `checkpointUpdate()`
(`daemon.ts:634`) re-spreads the same `usage` object every 30 s. A writer hooked to the checkpoint
write would reproduce the `writtenAt` bug exactly, in a new place. The hook goes in the `.then` /
`.catch` of the 300 s timer.

**The fifth option** (Fable's, and neither the card's author nor I had it): do **not** import
`projectUsage` into `daemon.ts`. `DaemonOptions.usage` is already `{intervalMs?, run}`
(`daemon.ts:331`) — add `onPass?: (outcome) => void`, called at the three sites above. `daemon.ts`
changes by ~5 lines and **imports nothing from `tools/fleet/`**. The composition happens in
`scripts/overseer.ts`, which already straddles the seam (`:42` imports
`../tools/fleet/overseer-claim.js`, `:59` imports `collectUsage`, `:975` builds `usage.run`).

That is worth stating as the general shape, because it is better than the argument it settles: **the
coupling belongs in the composition root, not in either module.** `tools/fleet/usage-history.ts`
stays where this plan already put it; the daemon gains a callback and no dependency; and the
`daemon.ts` diff is small enough to hand to `260908f-roadmap-exec-identity` as a one-line request
rather than a merge conflict.

#### Three corrections Fable made to my facts

- **`projectUsage` is not free to call from the daemon.** It takes the *parsed checkpoint*, not a
  `UsageReport`, and it imports `attention.ts`, which imports `node:fs`. So the composition either
  wraps the report in a `{schema, writtenAt, usage}` envelope or calls `groupUsageIncidents`
  (which takes hits directly) plus the smaller pieces. Not disqualifying — but "just call
  `projectUsage`" overstated it, and I had written that.
- **"The daemon is the long-lived one" is weaker than I claimed.** Both processes are systemd units
  with `Restart=always`. The honest version is: *the dashboard is the one people restart and run
  twice on port 8799.* The argument survives on that, not on uptime.
- **`usage-feed.ts`, `usage-absence.ts` and `UsagePanel.tsx` exist on no branch at all** — they are
  uncommitted in a sibling worktree. Every line number this plan cites into them is a citation into
  code that is not in git yet, and they must be re-checked once that work lands.

#### The reason that was wrong

#### The reason that was wrong

> "The module seam is one-way and would break. `tools/overseer/` imports from `tools/fleet/` in
> eight places; nothing under `tools/fleet/` imports `tools/overseer/`. A daemon-side writer wanting
> `projectUsage` — which lives in `tools/fleet/` — is exactly the thing that breaks it."

**Both halves are false**, verified by grep in this worktree:

- `tools/fleet/health-history.ts:81-82` imports `../overseer/jsonl.js` and `../overseer/lock.js`.
  Line 531 of the same file says so outright: *"The lock is `tools/overseer/lock.ts`'s, imported,
  not a copy."* So fleet **does** import overseer.
- `grep -rn 'from "\.\./fleet/' tools/overseer/` gives ~17 hits — mostly `import type` from
  `wire.js`, plus **value** imports of `pane.js`, `claude-argv.js`, `attempt-clock.js`. So
  overseer → fleet is a well-trodden direction, and a daemon importing `projectUsage` breaks
  nothing.

The real constraint in `tools/fleet/attention.ts`'s header is about **weight, not direction**: a
fleet module importing `readCheckpoint`/the store would close a cycle *and* drag the Overseer's
usage/memory/diff/lock/log modules into the process you reach for when something else is broken.
Pure leaves cross freely both ways — `jsonl.ts` and `lock.ts` are the proof, and they are the exact
machinery a history store needs.

**How this got in:** it came from the author of the usage card in a message, it was plausible, it
matched a rule I already half-believed, and I wrote it into a plan as reason #1 without running the
grep. That is the "an unchecked brief claim becomes a source comment" failure, one message earlier
in the chain than usual. The lesson is not "distrust peers" — everything else in that message was
right and several parts were load-bearing — it is that **the claims a decision rests on get checked,
whoever they came from.**

#### The fork as it actually stands

**Daemon writes** (one line per successful `collectUsage`):
- **No dedupe key needed at all.** The daemon knows when a reading happened; the dashboard has to
  infer it. That inference is D4 — and D4 was nearly a bug. A whole class of error disappears.
- History accrues whenever the *daemon* runs. The daemon is long-lived; the dashboard is restarted.
- No lock-taking file I/O on the `/api/state` request path.
- Single writer by construction — there is one daemon on this box by contract.
- Against: an edit to `daemon.ts` (owned by `260908f-roadmap-exec-identity` tonight — a scheduling
  cost, not a design one), and it couples the daemon to `UsageSummary`, a fleet-side projection type
  that reshaped *tonight*.

**Dashboard writes** (deduping on `collectedAt`):
- Mirrors `~/.fleet-health/` exactly, so this codebase has one shape rather than two.
- The projection stays in `tools/fleet/`, where it lives and where it changes.
- Against: needs the dedupe key; request-path I/O; history accrues only while the dashboard is up;
  and two dashboards on different ports share the directory and race for the lock — which actually
  happened on this box on 2026-09-08.

**Status: with Fable to arbitrate, and GPT Sol's round-1 review has been asked to check the seam
independently.** The open question that decides it, and the one I am least sure of: when
`chooseUsage` republishes an *earlier* pass's report because a fresh scan fell over, does the daemon
really know "this is a new reading" as cleanly as claimed — or is that a dedupe problem wearing a
disguise? If it is, the daemon's main advantage collapses and the dashboard wins on the precedent.

Either way, the cost of the dashboard option is that history accrues only while the dashboard is up:
a **visible gap**, not a wrong number, and D6 makes it read as one.

**The writer is invoked at request rate, not on a loop.** `REFRESH_MS` defaults to `60_000`
(`server.ts`, override `FLEET_REFRESH_MS`), but `statePayload` calls `readCheckpoint()` on **every
`/api/state` request**, deliberately, so the inbox's age is the age of the request. Dedupe on
`collectedAt` makes the writer idempotent at any invocation rate — which is the third reason the key
has to be the reading's own clock.

### The simpler options passed over

- **Render the last 24 h from the transcripts on demand, with no store at all.** Rejected on three
  counts: it is the 30–45 s / 2.9 GB scan on every page load; it needs a second `collectUsage`
  caller (D10); and it *still* could not produce utilisation-over-time, because the cache is a
  point-in-time hint that gets overwritten. History genuinely cannot be reconstructed after the
  fact. **The store is not an optimisation — it is the only way to have the data at all.**
- **Store the whole checkpoint per line and project at read time.** Rejected on the measured
  60,970-byte blob (D2). Revisit only if something later needs per-hit ids in history.
- **A database table instead of a jsonl file.** Rejected: the fleet dashboard has no database
  dependency today, the read is bounded and append-only, and `~/.fleet-health/health.jsonl` already
  works. Adding one for a few hundred lines a day would be a second way to do a thing we already do.
- **Extend the Overseer tab's card with a chart and skip the fourth tab.** Rejected because Greg
  asked for a tab, and because the card has to stay glanceable. Noted honestly: if the tab turns out
  thin, saying so is a better ending than padding it.
- **A charting library.** Rejected: `HealthHistory.tsx` hand-rolls inline `<svg>` with `<rect>` and
  `<line>` and puts labels in HTML beside the SVG. Copy that. A dependency for one chart in a tool
  that must keep working when everything else is broken is a poor trade.

## Measurements

Taken by this session on 2026-09-09 against the live `~/.overseer/current.json` (read-only;
`scratchpad/ult-size-usage-history.mjs`). These size the store and settle the rotation cap, which
until now was inherited from health without checking.

| | bytes |
|---|---|
| whole checkpoint | 101,430 |
| `usage` blob, raw | 61,122 |
| — of which `rateLimits` | **58,781 (96%)** |
| — `cache` | 970 |
| — `verdict` | 983 |
| — `account` | 259 |
| — `coverage` | 301 |

**140 hits collapse to 9 incident clusters.** Grouped by `${window} ${resetsAtMs}` the way
`groupUsageIncidents` does: one `seven_day` cluster (27 hits, 16 conversations) and eight `five_hour`
clusters (6–19 hits each). A projected incident list is **~4.2 KB against 58.4 KB of raw hits — a
14× reduction**, and it is bounded by the number of *windows that have ever been hit*, not by the
transcript backlog. This is D2's evidence, and it is stronger than the estimate D2 was written on.

**A history line therefore costs ~6.8 KB** (account + cache + ~4.2 KB incidents + verdict + coverage
+ envelope), and at one line per distinct reading — at most 288/day on the 300 s timer — the store
grows at **~2 MB/day**.

So **the rotation cap is 8 MiB, kept from health but for a different reason**: at health's ~1 MB/day
it bought 8 days; here it buys ~4. Four days is still ample for a 24-hour display window with room
to widen to the route's 168-hour maximum, and a single cap across both stores is one fewer number to
explain. Stage 1 asserts the ~6.8 KB line size in a test, so the day a line gets fat the suite says
so rather than the cap silently shrinking to a day and a half.

**A third argument for storing the projection, which D2 did not have — and it is a privacy argument,
not a size one.** A raw hit carries `transcriptPath` and `message`. Transcript paths carry project
and worktree names, and `message` is API error prose. Storing raw would copy both into a long-lived
file that nothing else prunes, for no gain the chart can use. The projection carries neither. This
is the strongest of the three reasons, and neither this plan nor the card's author had it before the
measurement.

### What the live data changed in the plan as first written

- **"Per known window" is a statement about `KNOWN_USAGE_WINDOWS`, not about what the file
  contains.** The live cache carries **three** window names beyond the two this plan kept naming:
  `nimbus_quill`, `spend` and `member_dashboard_available`, all in the `unknown` arm — no
  `resets_at`, and in the last case the entry is not even an object (`false`).

  I flagged this to the card's author as a probable bug and **it is not one**: `UsageWindowName` is
  deliberately an open `string` rather than a closed union, because — `wire.ts`'s words — a closed
  union "lets an exhaustive `switch` compile while silently dropping a real window". Nothing in
  `tools/fleet/` filters on `isKnownUsageWindow`, the card maps over `cache.windows` as the file
  gives them, and a browser subagent read all three back off the live card an hour before I asked.

  So this is a **requirement on my chart**, not a defect anywhere: Stage 4 renders an unrecognised
  window as a named row in the unknown state with its `why`, never as a series and never omitted.
  Note the `0` in `nimbus_quill`'s `why` — an unvalidated `utilizationPercent: 0` is precisely the
  number that must never reach a chart, and it is sitting in the live file today waiting for
  somebody to plot it.
- **Checkpoint fixtures captured today are valid, and I nearly re-captured them for nothing.** I had
  conflated two different reshapes. Tonight's change is to `UsageSummary["cache"]` — the *projection
  output*, a fleet-side type — and **not** to `UsageCacheReading`, the `{kind: "value" | "unknown"}`
  shape stored inside `StoredUsage`. `tools/overseer/usage.ts` compiles unchanged and there is no
  schema bump, so today's captures are exactly what `projectUsage` expects to be handed, before and
  after that branch lands. What *would* need re-capturing is anything saved of the card's output.

  Keep D3's provenance field regardless: it earns its place the moment the checkpoint schema really
  does move, which is live — `260908g` is working in the scheduler's part of the store.

## References

Roughly most-useful first.

- `docs/project/overseer-direction.md` §§ "What is actually observable about usage limits", "Can we
  call an API instead?", and the `~/.overseer/` seam table — the reading rules and the on-disk seams
  this plan must not contradict, plus the table Stage 5 adds a rule to.
- `tools/overseer/usage.ts` — the reading itself. `parseUsageWindow:255`, `computeUsageVerdict:926`,
  `collectUsage:1336`, `absenceGap:567`, `classifyHit:784`, `DEFAULT_SINCE_MS` (8 d).
- `tools/fleet/wire.ts:190-511` — every usage type (`UsageWindowReading`, `UsageCacheReading`,
  `UsageAccount`, `RateLimitHit`, `ScanCoverage`, `UsageVerdict`, `UsageReport:481`,
  `StoredUsage:509`). Types live here, never in `usage.ts`. The multi-account note is at `:317-319`.
- `tools/fleet/usage-feed.ts` — `groupUsageIncidents:96` (groups by window+reset, never by account),
  `projectUsage:190` (pure, takes no clock, degrades the whole report rather than half-drawing it).
- `tools/fleet/usage-absence.ts` — `absenceGapReason`, the shared "is this silence believable"
  answer, pinned by `tests/fleet-usage-absence.test.ts`.
- `tools/fleet/zones.ts` — `zonedReadings`/`zonedLine`, `USAGE_ZONES:43-47` (UTC/London/Athens with
  `(+1d)`/`(−1d)` suffixes). A dependency-free leaf written to be imported from three places; reuse
  it directly rather than formatting times again.
- `tools/fleet/web/src/UsagePanel.tsx` — `UsageCard`, the current-reading renderer, which
  re-derives expiry live via `untilReset` rather than trusting the server's computation.
- **The precedent to mirror, file by file**: `tools/fleet/health-history.ts` (`openHealthHistory:452`,
  `LOCK_FILE = "writer.lock":528`, `MAX_FILE_BYTES` 8 MiB with `LIVE_FILE`/`PREV_FILE` rotation,
  `MAX_LINE_BYTES` 64 KiB, `MAX_WHY_CHARS` 2000), `tools/fleet/health-wiring.ts:41`
  (`makeHealthRetention` — composes open + route + retain + startup lines **in one place**, written
  precisely because an earlier version tested the pieces separately and missed the join),
  `tools/fleet/routes-health-history.ts` (`GET /api/health/history?hours=N`, `windowHoursFrom`
  clamped to `[24, 168]`, `historyPayload` a **pure function** returning
  `{samples, predecessor, holes[], earliestAt, rotated, retention, unreadableLines, refreshMs}`),
  and the web trio `HealthHistory.tsx` / `history-series.ts` / `health-history-client.ts`.
- `tools/fleet/web/src/mode.ts:30`, `Dock.tsx:42-64`, `App.tsx:207-220` — the tab machinery.
- `docs/plans/260908f-overseer-and-fleet-improvement-roadmap.md` — the umbrella roadmap; the "Usage
  visibility" stage and its census row are the parent of this work.
- `docs/plans/260908f-stageb-usage-limits-code-review-sol-r1.md` / `-r2.md` — two rounds, 19
  findings, all accepted, no P0s. Constraints that survive into new code: D6/D7/D8 above, plus
  invalid `utilization` outside 0–100 is rejected not trusted; malformed auth JSON is `unknown`, not
  `logged-out`; cache-vs-hit same-window tolerance is **~1 second**, not minutes; OAuth linkage is
  adopted only when both org ids are present *and equal*; `--max-transcripts` is a validated
  non-negative **integer**.
- `docs/project/hetzner-remote-server-box.md` — the box, and the rule that a durable change to it is
  a change to a file.

## Traps (paid for already; do not re-discover)

- **Strict ISO round-trip parsing of `resets_at` rejected every real cached window.** Anthropic
  writes `2026-09-09T02:50:00.313670+00:00` — non-standard precision. Strict parsing degraded a
  healthy file to "no usage pass has run". Parse permissively, emit canonically, pin with a fixture.
- **A row asserted "IN FORCE" while the verdict itself was UNKNOWN.** A `/login` swap leaves
  old-account 429s in transcripts. Row-level text must never out-claim the verdict — which for this
  plan means the chart's own labels must not out-claim it either.
- **An 8-day scan window is not the 24-hour display window.** An unexpired `seven_day` 429 can sit
  in a transcript older than 24 h; excluding it reads absence as `none`/OK for an account that is
  still limited. Do not conflate the two windows anywhere in this work.
- **Timing is not evidence on this box.** The identical scan measured 1.8 s and 9.7 s two hours
  apart from ambient load alone. Do not design correctness around anything finishing promptly.
- **A NUL-byte corruption in `usage.ts` passed every test and every `grep` silently.** A guard you
  have seen pass is not evidence that it covers your file.
- **`git diff` against a base after merging `dev` shows other agents' files as yours.** Scope every
  review diff by explicit path.

## GPT Sol round 1 — rulings

Review at `docs/plans/260909b-usage-limits-tab-plan-review-sol-r1.md`, against revision `924f2209`.
**Verdict: reframed.** 13 findings, six P0. I accept the reframe: the current-reading tab was sound,
the history format and the stage order were not. Every finding gets a ruling, including the ones
I am not taking.

The review could not run any test — its sandbox refused Vite's `node_modules/.vite-temp` — so every
finding is reasoned from source. It said so plainly, which is what makes the rest usable.

| ID | Sev | Ruling | What changed |
|---|---|---|---|
| **F1** | P0 | **Accepted — the best finding in the review.** | D8 amended. History freezes validity at write time; only the live card re-derives expiry. Without this a 10:00 reading vanishes when viewed at 18:00. |
| **F2** | P0 | **Accepted in substance; the worse half does not apply.** | Stage 2 pins the incident model. `UsageIncident.id` is `` `${window}@${resetsAt}` `` — derived and stable across samples — and `firstHitAt`/`lastHitAt` are real hit instants, so an incident is placed *when it happened*, not at "first observed by history". Sol called this an unpinned dependency and was right to; it is pinned now against `d2e37fe4`. |
| **F3** | P0 | **Accepted.** | No universal source instant. The throw arm has no `collectedAt`; each arm names its own. |
| **F4** | P1 | **Accepted, and promoted.** | A carry line now records the *discarded fresh observation*, not just a reason. This is the strongest argument for the daemon writer — better than the dedupe one that actually decided it. |
| **F5** | P1 | **Already fixed before the review arrived.** | I found and retracted the seam claim myself; Sol confirms it independently. Recorded as confirmation, not as new work. |
| **F6** | P0 | **Accepted in substance; its crash path is moot by design.** | Retention status (`lastAttemptAt`, `lastSuccessAt`, `failure`, `poisoned`, `lockedOutBy`) is now contract, carried route → client → page: a hole the UI cannot explain is silent data loss. The `refreshLoop`-termination half assumed a request-path writer, which the daemon decision removed — recorded as moot so nobody reintroduces one. |
| **F7** | P0 | **Accepted, and it corrects my own measurement.** | I sized the cap on a *real* 6.8 KB line while copying a 64 KiB *legal maximum*. 288 × 64 KiB = 18 MiB/day worst case, so an 8 MiB file can rotate in under 11 hours and drop half the requested day. Stage 3 asserts the invariant directly instead of inheriting a constant. |
| **F8** | P1 | **Accepted — and I had the precedent backwards.** | Health types its *writer* and loosens only on read. `summarySchema` added, separate from `checkpointSchema`. |
| **F9** | P1 | **Accepted.** | Five concurrency invariants named in Stage 3 rather than inherited by "mirror closely" — including `0700`/`0600`, since the summary carries account identity. |
| **F10** | P0 | **Accepted.** | D6 amended: scan-absence and recorder-absence are two layers, and `absenceGapReason` answers only the first. |
| **F11** | P2 | **Accepted.** | `recordedAt` separate from the source instant; clock regressions surfaced, not sorted into plausibility. |
| **F12** | P2 | **Accepted — it was on my own suspicion list.** | Empty state uses health's narrower wording and claims no "since" it cannot know. |
| **F13** | P2 | **Accepted, and it is the reframe.** | The stage order is inverted: the tab is now Stage 1. Multi-account softened — "nothing in the store" was too strong, since a switched-away account becomes an opaque UUID; only positively attributed non-null uuids may form a series. |

**Nothing overruled.** That is unusual enough to be worth stating rather than glossed: this was a
plan review at the right moment, on a design soft enough to change, and the two findings I might
have argued with (F2's placement horn, F6's crash path) turned out to be answerable with evidence
rather than argument — one by reading code that had just been committed, one because a decision made
three hours earlier had already removed the failure.

**What the review cost and bought.** One round, ~13 minutes. It removed a P0 that would have silently
erased most of every chart older than five hours (F1), a rotation cap that would have thrown away
half the day it promised (F7), and a stage order that put two invisible stages before the one thing
Greg asked to see (F13).

### Round 2 will be against a different plan

The design Sol reviewed is not the design being built — the writer moved from the dashboard to the
daemon *while the review was running*, so its F5 and F6 are arguing with a document I had already
changed. Round 2 goes against the current revision, and its brief must say so explicitly, or it will
re-litigate the seam a third time.

## Stages

Ordered so the value is frontloaded — **properly this time.** The first ordering claimed to
frontload and did the opposite: it put the store and the route, neither of which anybody can see,
ahead of the tab. Sol's F13 caught it. If the job now stops after Stage 1, Greg has a working Usage
limits tab.

### A standing constraint on this run: the usage hold

The Overseer put a hold on full suites at 2026-09-09 ~00:05 UTC — `five_hour` was at 40% at 23:50
UTC and Greg is asleep, so the limit this plan is about is the limit this plan must not spend.
**Focused suites only until the Overseer says the window is safe**, and be ready for a pause.

Practically: every `npm test` below means *the focused files for that stage* until cleared, and the
full run is deferred to the end. Fortunately the stage cut already suits this — Stages 1, 2 and 4
are new files with their own test files, so `npx vitest run tests/fleet-usage-history*.test.ts`
covers almost everything. `npm run typecheck` is unaffected: it is seconds, and it is the gate that
actually catches a dropped `Record<Mode, …>` entry.

There is a nice irony worth stating rather than leaving implicit: **this plan cannot verify itself
tonight for exactly the reason it exists.** If the tab had shipped a week ago, the Overseer would be
reading the hold off a chart instead of off a single reading with no history behind it.

### Stage 0: plan, and get it reviewed

- [x] ~~Settle the writer fork with `260908f-roadmap-usage` — dashboard, on `collectedAt`~~
      — reopened after I checked the seam claim it rested on and found it false
- [x] Measure the real cost against the live checkpoint rather than inheriting health's numbers
- [x] Fable arbitrated the reopened fork: **daemon, via an `onPass` callback composed in
      `scripts/overseer.ts`**
- [x] Commit this doc pre-critique (`924f2209`)
- [x] GPT Sol round 1 (`260909b-usage-limits-tab-plan-review-sol-r1.md`) — **verdict: reframed**,
      13 findings, six P0. Rulings below; the stage cut and the stored format both changed.
- [ ] GPT Sol round 2 against the **current** revision, once the reframe is written down
- [ ] Revise and commit

### Stage 1: the tab, current reading only — no store

**Moved to the front by Sol's F13, which caught the plan claiming to frontload value while putting
two invisible stages first.** Stages 1–2 as originally written produced nothing anybody could see
and were not needed for the tab. This stage is now the first, it is small, and if the job stopped
here Greg has a working Usage limits tab.

- [ ] Merge `origin/dev` and confirm the usage card has landed (`d2e37fe4` is on
      `origin/worktree-260908f-usage-visibility`; cite `dev` once it is there, since that branch is
      a safety copy its author will delete)
- [ ] Extend `tests/fleet-web.test.tsx`: the fourth mode exists, is labelled, and mounts the panel
- [ ] `mode.ts` — add `"usage"` to `MODES` and `MODE_LABELS`
- [ ] `Dock.tsx` — add `MODE_ICONS.usage` and `MODE_TIPS.usage`
  - **The tip never opens on a phone.** `Dock.tsx` passes `mouseOnly`, so on touch a tap switches
    the tab and the card never appears; it survives only as `aria-describedby`. Since this page is
    mostly read on a phone, **the label and the icon must stand alone**. Pick an icon that reads as
    a limit rather than as a chart, so it is not confused with Box health at a glance.
  - Tip register is **the artefact, not the gesture** (`dashboard-modes-doc`'s ruling from the code,
    not Greg's): what you will see here, then where it comes from or what it does not promise.
  - Do not edit `MODE_TIPS.overseer` — that wording is `overseer-tab-messaging`'s.
- [ ] `App.tsx` — one additive `{mode === "usage" ? … : null}` block
- [ ] Mount `UsageCard` from `UsagePanel.tsx` **unchanged** (D1), fed from the same
      `CheckpointFeeds.usage`. The Overseer tab keeps its card; this is a second mount, not a move.
  - **Sol's F13 caveat**: confirm the component can genuinely be mounted twice off one feed — no
    module-level state, no id collisions between the two mounts. Test it, do not assume it.
- [ ] Browser check in a **Sonnet subagent** (Playwright against system Chrome; this is the box, so
      Claude-in-Chrome is not available): the tab appears, is reachable by keyboard, renders the
      real current reading, and matches the Overseer tab's card field for field — including the
      three unknown windows. Ask for the conclusion and one screenshot, not page dumps. Tell it to
      kill **its own** dev-server pid, never `pkill -f vite`, and never to touch port 8787.
- [ ] Focused suites, `npm run typecheck`, commit

### Stage 2: design the persisted record — a typed V1, not the UI's projection

**This stage is new, and it is the reframe.** Sol's central objection (F2, F8) is that storing "the
projection the card happens to use" is not a format decision at all: it is a bet that a UI type will
stay suitable for a durable log. The persisted record must be **designed around the claims the chart
makes**, typed on the write side, and versioned independently of both the checkpoint and the UI.

No production code in this stage beyond the type and its tests — it exists so that Stage 3 cannot
quietly invent a format.

- [ ] Define `UsageHistoryRecordV1` in a neutral leaf, with **three clocks kept separate** (F1, F3,
      F10, F11):
  - `sourceKind` + a discriminator-specific **source instant**: a report carries `collectedAt`, a
    thrown pass carries the daemon's `at`. **`collectedAt` is not a universal key** — the throw arm
    of `StoredUsage` (`{kind:"none", at}`) has none, and requiring it would either collapse every
    failure into the first or drop them all (F3).
  - `recordedAt` — when this line was appended. Distinct from the source instant, so a clock step
    is visible rather than silently reordered (F11).
  - **Event instants belong to the events**: each incident keeps its own `firstHitAt`/`lastHitAt`.
- [ ] **Freeze validity at write time (F1 — the finding I would have shipped).** D8 says the
      renderer re-derives expiry against its own clock. That is right for the current card and
      **wrong for history**: a 70% reading valid at 10:00, resetting at 12:00, would be
      re-adjudicated at 18:00 and vanish from the chart. So each stored window carries the verdict
      **as it was at its own `collectedAt`**, and the chart never re-expires a historical point.
      Only the live card re-derives.
- [ ] **Pin the incident model, which Sol called a real unpinned dependency (F2).** Now checkable —
      the card landed at `d2e37fe4`:
  - `UsageIncident.id` is `` `${window}@${resetsAt}` `` — **derived, stable across samples**, and
    its own comment says it is "a thing a person points at between two readings"
    (`usage-feed.ts:188-190`). So the cross-sample key F2 asks for already exists.
  - `firstHitAt`/`lastHitAt` are real instants taken from the hits (`:196-197`), so an incident is
    placed at **when it actually happened**, not at "first observed by history". F2's worse horn
    does not apply.
  - **Decision: draw each incident once, as a span from `firstHitAt` to `lastHitAt` with its
    rejection count** — deduped across samples by `id`. Not one mark per sample (which would draw
    288 rejections for one incident), and not one mark per hit.
  - **What this gives up, stated:** the distribution of individual hits inside a cluster — 27 hits
    between first and last become a span and a number. For a 24-hour chart that is arguably the
    better rendering; if Greg wants the distribution, it is a format change, so it is named here
    rather than discovered in Stage 5.
  - **Two cases that must not be silently mishandled:** `firstHitAt` can be `null` when no hit
    carried a time — such an incident is **listed but unplaced**, never dropped and never pinned to
    scan time. And an incident's `firstHitAt` may fall **outside** the 24-hour window, because the
    scan looks back eight days — it must read as "began before this window", never clipped to the
    left edge as though it started there.
- [ ] **Version the summary independently (F8).** `summarySchema` on every line, separate from
      `checkpointSchema`. `projectUsage` can rename a field without the checkpoint schema moving, and
      two lines both saying `checkpointSchema: 2` could then hold incompatible shapes with no way to
      tell them apart. Also correct my misreading of health: its **writer** takes a typed
      `HealthReport`; only bytes read back from disk become `Record<string, unknown>`. Type the
      write side; keep the read side loose.
- [ ] **Record the carry decision, not just its consequence (F4).** Sol is right that an unchanged
      `collectedAt` does not mean no reading was taken: `chooseUsage` keeps a complete 10:00 report
      over an incomplete 10:05 one, so **a fresh observation existed and was not published**. The
      daemon has it; the dashboard never would. So a `keep-stored` line carries the carry reason
      *and* whatever the discarded fresh pass observed — the cache reading and its `coverage` — as a
      separate, clearly-labelled arm. This is the single strongest reason the writer is the daemon,
      and it is stronger than the dedupe argument that originally decided it.
- [ ] Tests for the type: every arm round-trips; a record missing a source instant is rejected at
      write time rather than written and puzzled over later
- [ ] `npm run typecheck`, commit

### Stage 3: the store

Net-new leaf module. Mirrors `health-history.ts` — but Sol's F9 is right that "mirror closely" is
not a specification for invariants the tests never name.

- [ ] Write `tests/fleet-usage-history.test.ts` **first**, and watch it go red:
  - [ ] one line per pass, three kinds: `take-fresh` writes a reading; `keep-stored` writes a
        carry line with the reason **and the discarded fresh observation**; a throw writes a
        `collector-failed` line keyed on the daemon's `at`, not on an absent `collectedAt`
  - [ ] a `keep-stored` line does **not** contribute a utilisation point to the published series
  - [ ] **rotation holds 24 hours at the worst legal record size (F7).** The copied 64 KiB per-line
        cap against 288 readings/day is 18 MiB/day worst case, so an 8 MiB live file can rotate in
        under eleven hours and leave `prev` holding less than half the requested day. Assert the
        invariant directly: **one live file holds ≥24 h at the maximum accepted record size and
        cadence.** Fix by lowering the accepted record size to what a real record needs (measured
        ~6.8 KB), raising the cap, or both — and let the test decide, not the copied constant.
  - [ ] a realistic line is ~6.8 KB and under the accepted maximum
  - [ ] a line whose `summarySchema` is unknown reads back **tagged and skipped**, not
        reinterpreted (F8)
  - [ ] a corrupt/partial trailing line is counted in `unreadableLines`, not thrown
  - [ ] **the concurrency invariants Sol listed (F9)**, each named rather than inherited:
    - two processes both proving the old pid dead — the loser must stop writing (`stillOurs` before
      every repair *and* every append, not only at claim)
    - the lock is released after a post-claim open/repair failure
    - a partial write poisons, so the next line is not welded onto corrupt bytes
    - a read retries if `prev` changes underneath it during rotation
    - directory `0700` / file `0600` — **the summary carries account identity**
  - [ ] `OVERSEER_STORE_DIR` redirects the whole store, so no test touches the real `~/.overseer/`
- [ ] Write `tools/fleet/usage-history.ts`: `openUsageHistory(dir, options)`, append + bounded read.
      Reuse `../overseer/jsonl.js` and `../overseer/lock.js` rather than copying them, as
      `health-history.ts:81-82` already does.
- [ ] Green, then **mutate the finished code and check the suite notices** (silent-success)
- [ ] `npm run typecheck`, lint, commit

### Stage 4: the writer hook, and the read route

**The write side — a callback, not an import.**

- [ ] Write `tests/overseer-daemon-usage-pass.test.ts` first — **the join test**, which must fail if
      `onPass` is never called:
  - [ ] fires once per **pass**, with the right arm for `take-fresh`, `keep-stored` and a throw
  - [ ] **does not fire on a tick.** Drive several `checkpointUpdate()`s with no usage pass and
        assert zero calls — the `writtenAt` trap relocated, and the one test that catches it coming
        back.
- [ ] `tools/overseer/daemon.ts`: add `onPass?` to `DaemonOptions.usage` (already
      `{intervalMs?, run}`), called at the three sites around the usage timer. ~5 lines, importing
      nothing from `tools/fleet/`. **Re-read the file first** — `260908f-roadmap-exec-identity` has
      changed the `diff()` call site and its import list, so line numbers have moved. They have
      agreed I make this edit myself once they land, and will ping.
- [ ] `scripts/overseer.ts`: compose `openUsageHistory` + the projection + the append beside the
      existing `usage: { run: … }`. **The composition root, and the only place the coupling lives.**
      `projectUsage` takes a parsed *checkpoint* and is Node-only via `attention.ts`, so wrap the
      report in a `{schema, writtenAt, usage}` envelope here or call `groupUsageIncidents` plus the
      smaller pieces; write down which and why.
- [ ] **Retention status is part of the contract, not a nicety (F6).** An append that fails must
      never leave the chart with an unexplained hole. Carry `lastAttemptAt`, `lastSuccessAt`,
      `failure`, `poisoned`, `lockedOutBy` — the fields health already tracks — from the store,
      through the route, into the client, and onto the page. A hole the UI cannot explain is silent
      data loss.
  - Sol's associated crash path is **moot now the writer is the daemon** — nothing appends on
    `/api/state`, so an append failure cannot reject `publish()` or kill `refreshLoop`. Record that
    it was moot by design rather than fixed, so nobody reintroduces a request-path writer.

**The read side — no writer, no lock.**

- [ ] Write `tests/fleet-usage-history-route.test.ts` first, against a pure `usageHistoryPayload`:
  - [ ] `hours` clamped to `[24, 168]`; junk `hours` falls back rather than throwing
  - [ ] an **empty** store returns the "nothing recorded" arm — never an empty series a chart would
        draw as a flat line at zero
  - [ ] **the empty state does not claim a "since" it cannot know (F12).** An empty file has no
        first line; process start moves the claim forward on every restart, and the checkpoint's
        `collectedAt` may predate the recorder by days. Use health's narrower wording — *"Nothing
        recorded in the last 24 hours; this fills in as the recorder runs."* Once non-empty,
        distinguish "collecting since" from "retained data begins", which differ after a rotation.
  - [ ] holes are reported as holes, and a carry line is a hole **with a reason**
  - [ ] an unreadable store returns `{kind: "unreadable", why}`
  - [ ] the read takes **no lock** and works while the daemon is mid-append
  - [ ] `retention` is present in the payload and asserted, not optional
- [ ] `tools/fleet/routes-usage-history.ts`: `GET /api/usage/history?hours=N`, gzip above 8 KiB
- [ ] Mount in `server.ts` — one line, additive, announced to the Overseer first
- [ ] Focused suites, `npm run typecheck`, commit

**Sequencing.** The write side needs another session's file; the read side does not. If `daemon.ts`
is not free, build the read side first against a fixture store — the format is frozen in Stage 2.

### Stage 5: the last 24 hours

- [ ] Write `tests/fleet-usage-history-series.test.ts` first — where the honesty rules live or die:
  - [ ] **two independent absence layers, never conflated (F10).** *Within* a sample: value,
        unknown/unattributed cache, or a scan whose no-hit result is inconclusive — this is where
        `absenceGapReason` applies. *Between* samples: "nothing was recorded", derived only from
        source instants and the recorded cadence. `absenceGapReason` **cannot** say why the next
        record never arrived, and using it there would join the utilisation line across an
        unobserved hour or label the silence "no incidents".
  - [ ] an `unattributed` cache arm (no windows at all) breaks the line; it does not become 0
  - [ ] a historical point is **not** re-expired against the viewing clock (F1)
  - [ ] "before history began" is its own labelled region, distinct from a hole
  - [ ] an incident appears **once**, spanning `firstHitAt`→`lastHitAt`, deduped by `id` across
        every sample that carried it
  - [ ] an incident with `firstHitAt: null` is listed but unplaced; one beginning before the window
        reads as beginning before it, not at the left edge
  - [ ] rejections carry **no** `accountUuid` and are not split by account
  - [ ] utilisation **is** grouped by account, and **only positively attributed, non-null uuids form
        a series** — nulls must never merge into one apparent account (F13)
  - [ ] an unrecognised window (`nimbus_quill`, `spend`, `member_dashboard_available` are all live
        on this box) is a named row in the unknown state — never dropped, never plotted from its
        unvalidated `utilizationPercent: 0`
- [ ] `usage-history-client.ts` (parse + poll, validating `retention`) and `usage-history-series.ts`
      (the pure absence-classification layer)
- [ ] `UsageHistory.tsx` — hand-rolled inline `<svg>`, labels in HTML beside it, mirroring
      `HealthHistory.tsx`. Times via `zonedReadings` from `zones.ts`; never format an instant by hand.
- [ ] Browser check in a Sonnet subagent, **including the empty-history state**, which is what this
      box actually shows on the first run
- [ ] Focused suites, `npm run typecheck`, commit

### Stage 6: docs, and the multi-account writeup

- [ ] `docs/project/overseer-direction.md` — add a row for `~/.overseer/usage.jsonl` to the seam
      table. Its claim that *"the daemon is the only writer of any of them"* stays true, so this is
      an addition, not a rewrite. **This file's wording is a rule**, so it goes to Greg as a
      before/after via the Overseer, per `edit-important-docs.md`.
  - In the same set, propose a sentence saying what the `tools/fleet` ↔ `tools/overseer` rule
    actually is — **weight and the store cycle, not direction**. And quote the *mechanism*, not just
    the rule, because what went wrong twice in one night was not ignorance of it: both sessions
    reported a **one-directional check as a two-directional conclusion**. The usable form, which the
    card's author put well: *name the scope you actually searched inside the sentence that reports
    the result.* "Nothing in `tools/overseer/` imports X" is a claim a reader can size; "the seam is
    one-way" is one they cannot.
- [ ] A line for the new tab under the entry point that owns the dashboard docs, so
      `tests/doc-links.test.ts` stays green (signposting needs no approval)
  - **Cite by symbol, never `path:NNN`** in anything under `docs/project/`.
  - Link to `docs/project/fleet-dashboard-modes.md` rather than duplicating it — that doc owns "how
    to add a mode"; this one describes only the usage tab.
- [ ] Write the appendix below into whichever `docs/project/` doc owns usage
- [ ] `npm run check` last (~26 min) — **only once the Overseer clears the usage hold**

## Appendix: what a second account would need

Recorded so the medium-term work is a stage, not a rewrite. **None of this is in scope today.**

1. **Nothing in the store.** Every line already carries `accountUuid`, and the reader already groups
   by it. A second account produces lines that group into a second series with no format change.
   This is the whole point of recording it now.
2. **A collector that can see both.** `collectUsage` reads one `~/.claude.json`. Concurrent
   multi-account looks mechanically plausible via `CLAUDE_CONFIG_DIR` isolation, but that is
   **recorded and untested** — it would need a spike before it is designed.
3. **An account picker in the tab**, defaulting to the one currently logged in.
4. **Nothing for rejections.** They stay unattributed however many accounts exist — that is D5, and
   more accounts make it more true, not less.

## Decision log

- **2026-09-09, dedupe key.** Chose `collectedAt` over `writtenAt`, on a measurement from
  `260908f-roadmap-usage`: `TICK_MS = 30_000` rewrites the checkpoint every tick, so `writtenAt`
  would have produced ~2,880 lines/day, ~90% duplicates — and would have hidden the collector
  failures that an unchanged `collectedAt` makes visible. Caught before a line was written.
- **2026-09-09, writer — first answer, WRONG.** ~~Dashboard, not daemon. Decisive reason is the
  one-way module seam (`tools/fleet/` must not import `tools/overseer/`), not the health
  precedent.~~ The seam claim is false in both directions; see "The reason that was wrong". I took
  it from a peer's message because it was plausible and matched a rule I half-believed, and did not
  run the grep. The peer had grepped one direction and concluded about both.
- **2026-09-09, writer — settled, arbitrated by Fable.** The **daemon**, via an `onPass` callback on
  `DaemonOptions.usage`, composed in `scripts/overseer.ts`. File at `~/.overseer/usage.jsonl`.
  Reasons in order: the daemon *knows* when a reading happened (`chooseUsage` already returns
  `{take-fresh | keep-stored}` with a `why`, `usage-carry.ts:55-57`) where the dashboard can only
  infer it; the daemon additionally holds the discarded incomplete report and its coverage, so a gap
  gets a reason instead of a silence; and the dashboard is downstream of the sole collector, so it
  adds a liveness dependency and buys no resilience anywhere.

  The callback is the part worth carrying elsewhere: **the coupling belongs in the composition root,
  not in either module.** `daemon.ts` gains ~5 lines and no import; `tools/fleet/usage-history.ts`
  stays put; `scripts/overseer.ts`, which already straddles the seam, joins them.

  Consequences: D9 (lock-out behaviour) is moot — the dashboard reads lock-free and there is one
  daemon by contract. `FLEET_USAGE_DIR` is not needed; `OVERSEER_STORE_DIR` already exists.
  `overseer-direction.md`'s "the daemon is the only writer of any of them" stays **true**, so Stage 5
  adds a row rather than an exception.
- **2026-09-09, what this cost and what it bought.** Two hours of plan time, no code. It removed an
  entire correctness question (the dedupe key) rather than answering it, which is the better outcome
  and would not have been found by building the first design and reviewing it afterwards.
- **2026-09-09, storage.** Projection, not raw, on the measured 60,970-byte usage blob. Given up:
  per-hit ids and transcript paths in history.
