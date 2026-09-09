# Read the Codex subscription's usage limits, and show them beside Claude's

**Status:** stage 1 (research) done and measured; stages 2–4 not started.
**Queue item:** `qi-3fdnt4st`. Session `codex-usage`, worktree `codex-usage`.

## Why

The fleet's implementation work is moving off Claude and onto the ChatGPT subscription through
[`scripts/run-codex.ts`](../../scripts/run-codex.ts), because Claude's weekly window is at 76% with
six days to run. Greg, 2026-09-09:

> I don't want to set up a new account today if we can avoid it. So slow things down a bit, and/or
> delegate more to GPT via @docs/reusable/codex-cli-as-subagent.md to implement. That might mean you
> need to prioritise getting access to usage limits information for GPT.

The Overseer can already see Claude's headroom — [usage-history.md](../project/usage-history.md),
[`tools/overseer/usage.ts`](../../tools/overseer/usage.ts), `~/.overseer/usage.jsonl`,
`UsagePanel.tsx`. It cannot see the ChatGPT side at all, so it is rationing between one account it can
measure and one it cannot. That is the whole of this job: **one reading, one file, one card.**

## The simpler option passed over, and why

**Read the number by hand when it matters** — `codex` TUI, `/status`, tell the Overseer. Rejected
because the Overseer is not a person at a terminal: it decides which credential to spend on a 300 s
timer, and a number that exists only when somebody types a command is not available at the moment the
decision is made. The Claude side had exactly this shape before 260909b and the same argument settled
it.

**Spend a cheap Codex call and read the rate-limit event off it.** Rejected on measurement, not
principle: stage 1 found a source that is free *and* live, so paying for the number would be paying
for nothing. Recorded here because it was the brief's own leading suggestion.

---

## Stage 1 — research: where the number lives *(done)*

All figures measured on the Hetzner box, 2026-09-09, `codex-cli 0.153.4`, `plan_type: pro`.

### The answer: `account/rateLimits/read` on the app-server protocol

```bash
codex app-server --listen stdio://    # then, as JSON-RPC over stdin/stdout:
#  → {"jsonrpc":"2.0","id":1,"method":"initialize","params":{"clientInfo":{"name":"…","version":"…","title":"…"}}}
#  → {"jsonrpc":"2.0","method":"initialized","params":{}}
#  → {"jsonrpc":"2.0","id":2,"method":"account/rateLimits/read","params":{}}
```

**It is free.** No model call, no tokens, no session. It is an account query against OpenAI's backend
over the existing `~/.codex/auth.json` credential.

**It is live, and that is measured rather than assumed.** Two probes nine seconds apart returned a
`resetsAt` for the 300-minute window that had advanced by nine seconds (`1788958266` → `1788958275`).
A rolling window recomputed from *now* cannot come from a local cache. So unlike Claude's
`~/.claude.json` — whose whole design problem is that a stale entry reads exactly like a current one
— **this source has no staleness arm to get wrong.** The freshness field on the reading is still
required, because the *reading* can be old by the time anything renders it; what is not required is
Claude's `expired` arm adjudicating a cached window against a later clock.

**Cost of one reading:** 1.9 s wall clock end to end (0.4 s to `initialize`, 0.7 s for the call), and
**117 MB peak RSS** for the `codex app-server` child, for those ~2 s. On a box with ~20 GB available
that is affordable at a 300 s cadence, but it is the reason the reading must be a short-lived spawn
with a hard timeout rather than a long-lived app-server held open — this box OOM-kills, and a resident
117 MB earns nothing between passes.

**The failure arm is explicit and quotable**, which is what an honest `unknown` needs. With
`CODEX_HOME` pointed at a directory holding no `auth.json`:

```json
{"error":{"code":-32600,"message":"codex account authentication required to read rate limits"},"id":2}
```

### What one reading contains

Live values, verbatim, 2026-09-09 07:47 UTC:

```json
{ "rateLimits": { "limitId": "codex", "limitName": null,
    "primary":   { "usedPercent": 24, "windowDurationMins": 10080, "resetsAt": 1789435399 },
    "secondary": null,
    "credits":   { "hasCredits": false, "unlimited": false, "balance": "0" },
    "individualLimit": null, "spendControlReached": false,
    "planType": "pro", "rateLimitReachedType": null },
  "rateLimitsByLimitId": {
    "codex":            { …as above… },
    "codex_bengalfox":  { "limitName": "GPT-5.3-Codex-Spark",
      "primary":   { "usedPercent": 0, "windowDurationMins": 300,   "resetsAt": 1788958275 },
      "secondary": { "usedPercent": 0, "windowDurationMins": 10080, "resetsAt": 1789545075 } } },
  "rateLimitResetCredits": { "availableCount": 2, "credits": [ …two "Full reset" grants… ] },
  "accountId": "075e50c8-…", "rateLimitUpsell": null }
```

So: **24% of the weekly window used, resetting 2026-09-15 01:23 UTC.** That is the number the
Overseer has been rationing without.

### Four findings that change the design

**1. `primary`/`secondary` are positions, not window names.** On the `codex` bucket `primary` is the
*weekly* window (10080 min). On the `codex_bengalfox` bucket `primary` is the *five-hour* window
(300 min) and `secondary` is the weekly. So the window's identity **must be derived from
`windowDurationMins`**, and mapping `primary → five_hour` — the obvious reading, and the shape
Claude's side has — would be silently wrong on the bucket that matters. `windowDurationMins` is
nullable in the schema, so a window with no duration is a *named unknown*, never a guess.

**2. This account has no five-hour limit on the bucket that bills our work.** `secondary` was `null`
in the live read and in **all 25,043** historical snapshots (see below). The 300-minute window exists
only on the `codex_bengalfox` bucket, at 0%. The brief expected "5h limit … weekly limit" from the
TUI's `/status`; for this plan, on this account, there is one window that matters. The code must not
require two, and must not report a missing one as 0%.

**3. `credits.hasCredits: false`, `balance: "0"`.** The `CODEX_API_KEY` fallback path in
`run-codex.ts` has nothing behind it. So the subscription is not merely preferred, it is the only
live credential, and the ~12 s fallback tax documented in
[codex-cli-as-subagent.md](../reusable/codex-cli-as-subagent.md) is what a spent subscription buys.
Worth surfacing on the card: "no API-key credits behind this" is decision-relevant.

**4. Two "Full reset" credits are available**, with an `account/rateLimitResetCredit/consume` method
to spend them. **Not ours to spend** — that is Greg's call — but a fact the Overseer should be able to
see, because "we are at 100% and hold two full resets" and "we are at 100%" call for different
actions. Surface, never consume.

### The fallback source, and the two dead ends

**Fallback: session rollout JSONL.** `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`, on
`event_msg` / `token_count` payloads, carries a `rate_limits` object — the same shape in snake_case.
Free, and each line carries its own ISO timestamp, so **its age is known** — which is exactly the
property `usage.ts` relies on for Claude. Measured: 899 of 927 session files carry one, 25,043
snapshots in total. This is the right fallback when the app-server call cannot run, and it is why the
reading has a source discriminator rather than one shape.

**Dead end: `codex doctor`.** Hung; killed at 60 s. Not a source.

**Dead end: the SQLite stores.** `state_5`, `logs_2`, `thread_history_1`, `queue_1` under `~/.codex/`
hold no rate-limit column of any kind. Checked so nobody looks again.

### Stage 1 checklist

- [x] Enumerate the candidate sources named in the brief
- [x] Establish which are free and which cost a paid call — **the winner is free**
- [x] Prove the winner is live rather than cached (the +9 s rolling-window measurement)
- [x] Measure the cost of one reading (1.9 s, 117 MB peak RSS)
- [x] Find the unauthenticated failure arm and its exact message
- [x] Characterise the shape across history (25,043 snapshots) so the unknown arms are not guesses
- [ ] Sol reviews this plan

---

## Stage 2 — the reading: `tools/overseer/codex-usage.ts`

Implemented by Codex (`gpt-5.6-sol`, `--sandbox workspace-write`); reviewed by Sol; tests and
typecheck run by me.

Mirrors `usage.ts`'s split exactly: every `parse*` / `derive*` function pure, `now` a parameter, one
`collectCodexUsage` that spawns the process. Nothing at module scope does I/O.

Types in [`tools/fleet/wire.ts`](../../tools/fleet/wire.ts), declared once, never re-declared on the
renderer's side — the repair the 2026-09-08 dashboard postmortem bought.

- `CodexUsageWindow` — `{ kind: "value"; windowMinutes; usedPercent; resetsAt; resetsAtMs }`
  · `{ kind: "unknown"; why }`. **No `windowMinutes` ⇒ unknown**, never a positional guess (finding 1).
- `CodexUsageBucket` — `limitId`, `limitName`, the windows **keyed by derived name** rather than by
  `primary`/`secondary`, `planType`, `credits`, `rateLimitReachedType`.
- `CodexUsageReading` — `{ kind: "value"; source: "app-server" | "session-log"; accountId; readAt;
  buckets; resetCredits }` · `{ kind: "unknown"; why }`. `source` is on the value arm because the
  fallback's freshness story is different and a renderer must be able to say which it got.
- No number without its `resetsAt`; no absence rendered as a zero; `why` in words a person can act on.

**Tests red first.** Fixtures from the real payloads above (live, unauthenticated-error,
session-log, `secondary: null`, a `windowDurationMins: null`, a bucket whose `primary` is the 5 h
window). The one that must go red before it goes green is **the positional-mapping test**: a bucket
whose `primary` is 300 min and `secondary` is 10080 min must not report the 300 as the weekly window.

Fake executor for the spawn, so nothing in the suite talks to OpenAI.

- [ ] Types in `wire.ts`
- [ ] Pure parsers + tests red, then green
- [ ] `collectCodexUsage` with a hard timeout and a killed process group
- [ ] Sol code review

## Stage 3 — persist it: extend the `usage.jsonl` line

**Extend the existing line; do not start a second file.** The brief allowed a second file if the
codec's schema made sharing dishonest. It does not:

- `decodeUsageHistoryLine` reads `record.summarySchema`, validates the fields it knows, and **ignores
  unknown top-level keys**. So an added optional `codex` field is readable by the current build.
- **`SUMMARY_SCHEMA` must NOT be bumped.** A bump makes every line already on disk `unsupported`,
  which by that module's own contract breaks the series positionally — the whole existing 24 hours of
  Claude history would go dark to buy a field it does not use. Adding an optional field costs nothing;
  bumping costs the history.
- The reader must distinguish **three** absences, not two: a line written before this stage (no
  `codex` key at all), a pass where the reading failed (`codex: { kind: "unknown", why }`), and a
  window the payload did not carry. So `codex` is written on **every** pass from here on, with its own
  unknown arm — an absent key means "predates codex recording" and nothing else. A census cannot see
  a beginning-of-life state, and a reader that folds the three together reports a working recorder as
  a broken one, or the reverse; [silent-success.md](../reusable/silent-success.md) is the class.

One line per pass, alongside the Claude reading, from the daemon's existing `onPass` hook. The
coupling stays in the composition root (`scripts/overseer.ts`), per usage-history.md.

- [ ] `codex?: CodexObservation` on `UsageHistoryLine`, written on every arm
- [ ] Encode/decode tests, including the three-absence distinction
- [ ] Size check: the record stays well under `MAX_LINE_BYTES`
- [ ] Sol code review

## Stage 4 — show it: `overseer usage` and a second account card

- `overseer usage` prints both accounts. Additive to `usageLines`. **`scripts/overseer.ts` is shared
  with the `overseer-cli` session** — tell it by `SendMessage` which lines I touch before editing.
- A second account card on the Usage tab from the same `StatCard` primitive in
  `tools/fleet/web/src/ui.tsx`, additive to `UsagePanel.tsx`. One window row per derived window;
  the reset-credit count and the no-API-credits fact as their own stats.
- A short section in [usage-history.md](../project/usage-history.md) — the source, that it is live
  rather than cached, and the positional-mapping trap.

- [ ] `overseer usage` renders both, positive control included
- [ ] Card + `npm run typecheck`, `npm test`, lint on touched files
- [ ] Sol code review of the whole diff
- [ ] Debrief to the Overseer

## Not in scope

Consuming a reset credit; a second `~/.codex` account; the `account/usage/read` daily token series
(it exists and works — a year of daily totals — but it is not a limit, and the Overseer's question is
headroom); anything in `run-codex.ts` or the daemon loop beyond its existing `onPass` hook.
