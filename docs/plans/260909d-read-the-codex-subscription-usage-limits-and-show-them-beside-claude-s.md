# Read the Codex subscription's usage limits, and show them beside Claude's

**Status:** stage 1 (research) done and measured; Sol's plan review round 1 in and folded in
(§ "Sol's plan review"); stages 2–4 not started.
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

**It is live, and here is what actually establishes that.** The first version of this section argued
from two probes nine seconds apart whose `resetsAt` had advanced by nine seconds. **That argument was
wrong and Sol rejected it** (finding 2): the field that moved was a rolling `now + 300 minutes` on the
*unused* Spark bucket, and a local adapter returning `{usedPercent: cached, resetsAt: now + 300min}`
reproduces that evidence exactly while serving a stale percentage. The evidence proved a field was
computed from the clock, not that anything had been fetched. It is left here rather than deleted
because it is a good-looking argument for a true conclusion, which is the kind worth recognising
again.

Three measurements that do establish it:

- **`used_percent` is a live counter.** Across the 25,179 historical snapshots it takes every integer
  value from 0 to 90, and over the twenty hours to 2026-09-09 07:00 it climbs 11 → 24 one step at a
  time, tracking a working day. No frozen cache does that.
- **Blocking the network makes the call fail rather than serve a stale value.** Forced through a dead
  proxy it returns `-32603 failed to fetch codex rate limits: error sending request for url
  (https://chatgpt.com/backend-api/wham/usage)`. So every reading is a real fetch and there is no
  local cache that could be silently served instead.
- **`resets_at` moves between weeks** — the history holds `1788797645` and `1789402645` alongside
  today's `1789435399`.

So there is no stale-reads-like-fresh arm of Claude's kind. The reading still carries its own
freshness, because a *reading* ages between collection and render; what is not needed is Claude's
`expired` adjudication of a cached window against a later clock. **Sol's defensive suggestion —
enforce `resetsAt > sourceAt` for any `value` arm — is adopted anyway**, because it costs one
comparison and turns a whole class of nonsense into a named unknown.

**The number is live but NOT monotonic at short range, and that is a design constraint.** Adjacent
snapshots seconds apart oscillate by a full point — `11→12→11→12`, repeatedly, in both directions —
almost certainly several concurrent runs reading a backend that is aggregating. Two consequences that
would otherwise produce confidently wrong behaviour: **a one-point drop is not quota being refunded**,
and **any threshold will flap** if a single crossing is treated as an event. Whatever the Overseer
compares against its bands wants hysteresis or two consecutive readings. Neither this plan nor Sol
predicted this; it fell out of plotting the history.

**There are two failure arms, not one.** `-32600 codex account authentication required to read rate
limits` (not logged in — persistent, a person must act) and `-32603 failed to fetch codex rate limits`
(the fetch failed — transient, retry). Collapsing them would send somebody to run `codex login`
because the network blipped.

**Cost of one reading:** 1.9 s wall clock end to end (0.4 s to `initialize`, 0.7 s for the call), and
**117 MB peak RSS** for the `codex app-server` child, for those ~2 s. On a box with ~20 GB available
that is affordable at a 300 s cadence, but it is the reason the reading must be a short-lived spawn
with a hard timeout rather than a long-lived app-server held open — this box OOM-kills, and a resident
117 MB earns nothing between passes.

**Both failure arms are explicit and quotable**, which is what an honest `unknown` needs — one from
`CODEX_HOME` pointed at a directory holding no `auth.json`, the other from a dead proxy:

```json
{"error":{"code":-32600,"message":"codex account authentication required to read rate limits"},"id":2}
{"error":{"code":-32603,"message":"failed to fetch codex rate limits: error sending request for url (https://chatgpt.com/backend-api/wham/usage)"},"id":2}
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

### Proven from Node, and one asymmetry that would trip the implementer

The spike is `tests/fixtures/codex-usage/capture/spike-app-server-from-node.ts`; both arms run from
TypeScript, the value arm in 1.1 s and the `unknown` arm under a bogus `CODEX_HOME`.

**`codex app-server` needs stdin to stay OPEN. `codex exec` needs it to reach EOF.** This is the exact
inversion of [`scripts/run-codex.ts`](../../scripts/run-codex.ts)'s central guarantee — that file
exists partly because a pipe which never closes wedges `codex exec` forever, so it hands codex a
finite file as fd 0. Here fd 0 is the *outbound half of a bidirectional protocol*: end it after
sending `initialize` and the session closes before the reply arrives. Anyone reasoning from
run-codex.ts's rule — the natural thing to do, since it is the only codex plumbing in the repo — will
close it and get a hang that looks like a network problem.

Three further things the spike settles, so stage 2 need not rediscover them:

- **Match the reply by its own `id`.** A `remoteControl/status/changed` notification arrives between
  `initialize` and the answer, so arrival order is not reply order.
- **`initialize` requires `clientInfo`**, and the `initialized` notification must follow it before the
  call, or the call is refused.
- **Kill the process group, not the child.** The child is spawned `detached`, as run-codex.ts does, so
  a timeout takes any helper it started with it rather than orphaning it to init.

### The evidence, durably

The payloads above are checked in under
[`tests/fixtures/codex-usage/`](../../tests/fixtures/codex-usage/README.md) — two captured real, two
synthetic and labelled as such — with the capture scripts beside them in `capture/`, so every number
on this page can be re-taken rather than taken on trust. The `resetsAt` values move on every
re-capture, which is itself the measurement that the reading is live.

### Six findings that change the design

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

**3. `credits.hasCredits: false`, `balance: "0"` says nothing about `CODEX_API_KEY` — WITHDRAWN.**
This finding originally read "the API-key fallback has nothing behind it, so the subscription is the
only live credential", and proposed a card stat saying so. **That was wrong** (Sol's finding 1, and
the one worth having asked for): the reading arrived over `~/.codex/auth.json`, which is the
*subscription* credential, and codex models `apiKey` and `chatgpt` as separate account kinds. A funded
`CODEX_API_KEY` in `.env.local` is entirely consistent with what was measured. So API-key fallback
capacity is **unknown**, not zero, and nothing in this work may claim otherwise without querying it
separately. The stat is dropped; if it ever returns it is labelled "ChatGPT/Codex credits".

Recorded rather than deleted because it had already been sent to the Overseer as a rationing fact, and
a withdrawn claim that leaves no trace is how the next person re-derives it.

**4. Two "Full reset" credits are available**, with an `account/rateLimitResetCredit/consume` method
to spend them. **Not ours to spend** — that is Greg's call — but a fact the Overseer should be able to
see, because "we are at 100% and hold two full resets" and "we are at 100%" call for different
actions. Surface, never consume.

### The fallback source, and the two dead ends

**Fallback: session rollout JSONL.** `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`, on
`event_msg` / `token_count` payloads, carries a `rate_limits` object — nearly the same shape. Free,
and each line carries its own ISO timestamp, so **its age is known** — which is exactly the property
`usage.ts` relies on for Claude. Measured: 899 of 927 session files carry one, 25,043 snapshots in
total. This is the right fallback when the app-server call cannot run, and it is why the reading has a
source discriminator rather than one shape.

**5. The two sources spell the same field differently, and not only in case.** The app-server replies
camelCase with **`windowDurationMins`**; the session log writes snake_case with **`window_minutes`**.
A parser that assumes a mechanical snake↔camel conversion looks for `windowMinutes`, finds
`undefined`, and — given finding 1 — every window then acquires its name from its position instead.
The two shapes get separate parsers, deliberately, rather than one normalising pass.

**6. `usedPercent` is an integer from the app-server (`24`) and a float in the session log (`24.0`).**
The same number today, not the same type. Whatever holds it must take both and must not assume the
value arrives rounded.

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

**The window carries its slot AND its duration, in an array — not a map keyed by derived name.** The
first draft keyed the windows by a name derived from `windowDurationMins`, which replaced one
positional assumption with a duration assumption; Sol's finding 6 broke it three ways. Two
10080-minute windows in one bucket silently overwrite each other in a map. A `windowDurationMins: null`
has neither duration nor name, so the promised "named unknown" cannot be named. And a new
1,440-minute window either vanishes or gets marked unknown merely because no friendly label exists for
it. So provenance is preserved and the name is display-only:

```ts
export type CodexUsageWindow =
  | {
      kind: "value";
      /** Which slot the payload put it in. Provenance, never identity. */
      slot: "primary" | "secondary";
      windowMinutes: number;
      usedPercent: number;
      resetsAt: string;
      resetsAtMs: number;
    }
  | { kind: "unknown"; slot: "primary" | "secondary"; windowMinutes: number | null; why: string };
```

`300 → "5 hours"` and `10080 → "7 days"` are **display aliases applied at render time**. An
unfamiliar positive duration stays a `value` and is shown by its raw duration — a window we have no
label for is still a real number, and refusing to draw it would hide the one that matters the day
OpenAI adds a window.

- `CodexUsageBucket` — `{ limitId; limitName; windows: CodexUsageWindow[]; planType; credits;
  rateLimitReachedType }`.
- `CodexUsageReading` — `{ kind: "value"; accountId: string | null; readAt; buckets; resetCredits }`
  · `{ kind: "unknown"; why; retryable: boolean }`. `retryable` is what separates the two measured
  error arms: `-32603` (fetch failed) is transient, `-32600` (not logged in) needs a person.
- No number without its `resetsAt`, and `resetsAt > sourceAt` enforced on every `value` arm; no
  absence rendered as a zero; `why` in words a person can act on.

**Bucket precedence, stated because Sol's finding 7 showed a plausible implementation can show 0%.**
The payload carries both a legacy single `rateLimits` snapshot and a `rateLimitsByLimitId` map, and
nothing said how to reconcile them — so the Spark bucket at 0% could stand in for general headroom:

- `rateLimitsByLimitId` is **canonical when present**; the bare `rateLimits` is a fallback only.
- A duplicate `codex` snapshot that **disagrees** between the two becomes `unknown`, never "first wins".
- Each map key is validated against a non-null inner `limitId`.
- **The general `codex` bucket is the only decision input.** If it is absent, general headroom is
  `unknown`. Every other model bucket is informational and can never substitute for it — which adds a
  distinct absence, *target bucket absent*, separate from *bucket present, window absent*.

**The child environment is explicit, and `CODEX_API_KEY` is withheld.** Sol's finding 3: codex prefers
`CODEX_API_KEY` whenever it is set, which is precisely why `run-codex.ts` withholds it to select the
subscription. A collector that inherits an ordinary environment may authenticate as the API-key
account and then report the wrong account's headroom, or fail because rate-limit reads need ChatGPT
auth — and all three outcomes make a card labelled "the Codex subscription" false. So the spawn passes
a deliberately built environment: `CODEX_API_KEY` absent, `HOME` and `CODEX_HOME` preserved. **The
exact child environment is asserted through the fake executor**, not left as a comment. Where
`accountId` is present it is checked against the intended account.

**Tests red first**, against the checked-in fixtures. The one that must go red before it goes green is
**the positional-mapping test**: the `reversed` bucket, whose `primary` is 300 min and `secondary` is
10080 min, must not report the 300-minute window as the weekly one. Then null-duration, null-reset,
unrecognised-window, limit-reached, the two error arms, the two bucket-disagreement cases, and the
withheld-`CODEX_API_KEY` assertion.

Fake executor for the spawn, so nothing in the suite talks to OpenAI. The protocol mechanics the spike
settled — stdin stays open, match on the reply's own id, `initialized` before the call, kill the group
— are the collector's contract and each gets a test.

- [ ] Types in `wire.ts`
- [ ] Pure parsers + tests red, then green
- [ ] `collectCodexUsage` with a hard timeout, a killed process group, and an asserted child env
- [ ] Sol code review

### What moved out of v1, and why

**The session-log fallback goes to follow-up work** (Sol's finding 8, accepted). It looked free —
another already-written source, age known — but it lacks the live call's account attribution, its
multi-bucket view and its reset credits, and its percentage is *an earlier observation, not current
headroom*. Showing its age does not make it safe: the failure mode is that app-server breaks, the
newest snapshot is yesterday's 24%, and the card **positively clears the account for more work** that
may already have exhausted it. Displaying a stale number confidently is the one thing this whole
design is against.

So v1 returns an explicit `unknown` when the app-server call fails. That also collapses stage 2 to one
parser, one freshness story and one account-identity source. The fallback stays documented in stage 1
as a real option — it is the right thing to reach for if the live call turns out to be unreliable in
practice, and then it is modelled as "last observed, a lower bound" and forbidden from clearing the
account.

## Stage 3 — persist it: extend the `usage.jsonl` line

**Extend the existing line; do not start a second file.** The brief allowed a second file if the
codec's schema made sharing dishonest. It does not, and Sol confirmed the central reading against the
decoder:

- `decodeUsageHistoryLine` checks the envelope and the source instants and then **casts** the rest,
  so an added optional `codex` field survives and is ignored by an old reader.
- **`SUMMARY_SCHEMA` must NOT be bumped.** The decoder accepts only exact equality, so a bump makes
  every line already on disk `unsupported` — which by that module's own contract breaks the series
  positionally. The whole existing 24 hours of Claude history would go dark to buy a field it does not
  use. An additive optional field whose absence has explicit semantics is not a breaking change.
- **The decoder does not validate what it casts**, which Sol's qualification makes load-bearing: the
  new reader must validate `codex` independently and **degrade a malformed Codex blob to `unknown`
  without discarding a valid Claude observation in the same line**. One bad field must not cost the
  other account's reading.
- `LINE_SCHEMA`'s comment says it is bumped when the line's shape changes. Since this changes the
  shape additively and deliberately does not bump, **that comment gets one sentence** defining a bump
  as a *breaking* change. Leaving it as written would make the next person's correct reading of the
  comment produce the wrong decision.

**Six absences, not three.** The first draft said three; Sol found six, and each is a different
investigation:

1. no `codex` key — the writer predates the field
2. collection attempted and failed — carries `why` and `retryable`
3. the target `codex` bucket absent from an otherwise good reading
4. bucket present, an expected window absent
5. reading succeeded but `accountId` is null — observed but unattributed
6. a source structurally cannot supply a fact (reset credits, once a fallback exists)

`codex` is therefore written on **every** pass from here on, so an absent key means (1) and nothing
else. A census cannot see a beginning-of-life state, and a reader that folds these together reports a
working recorder as broken, or the reverse; [silent-success.md](../reusable/silent-success.md) is the
class.

**The async problem, and why the fix is smaller than Sol's.** Finding 4 is right and was the most
valuable: `collectCodexUsage` returns a promise, the retention hook is synchronous, and `safeOnPass`
deliberately **does not await** what the callback returns — its own comment says the production
callback being synchronous must stay "a fact about the callback rather than a condition of the
containment". So collecting inside `onPass` would race shutdown: `usageRunning` settles, the writer
closes, and the append lands on a closed descriptor with no positional marker.

Sol proposed making the hook awaited and failure-isolated. **Adopting a narrower fix instead**: collect
the Codex reading inside `usageOptions.run()`, which the daemon *already* awaits into `usageRunning`
and which shutdown *already* waits for. The composition root's `run` becomes

```ts
run: async () => {
  const [claude, codex] = await Promise.allSettled([collectUsage(), collectCodexUsage()]);
  stashCodex(codex);           // read by the synchronous onPass, below
  if (claude.status === "rejected") throw claude.reason;   // a Claude failure is still a failed pass
  return claude.value;
},
onPass: usageRetention.onPass, // stays synchronous
```

Three reasons it is better: it changes **no daemon contract**, so the guard `safeOnPass`'s comment
describes stays true; shutdown ordering is correct for free, because `run`'s promise *is*
`usageRunning`; and it stays inside this work's declared file set, honouring the brief's "not yours:
the daemon loop beyond its existing `onPass` hook". `Promise.allSettled` is what stops a Codex failure
turning a good Claude pass into `collector-failed`.

The stash is safe **only because the daemon refuses to overlap passes** (`if (usageRunning !== null)
return`), so `onPass` is always called inside the same `run`'s continuation. That invariant is the
reason the design works and is exactly the kind that decays silently, so it gets a test **that mutates
the composition root** rather than an injected fake — an injected fake cannot see whether the real
things are wired together.

- [ ] `codex?: CodexObservation` on `UsageHistoryLine`, written on every arm
- [ ] Encode/decode tests, including all six absences and a malformed-Codex-keeps-Claude test
- [ ] The `run`-side collection, with a composition-root test for the no-overlap invariant
- [ ] `LINE_SCHEMA` comment reconciled
- [ ] Size check: the record stays well under `MAX_LINE_BYTES`
- [ ] Sol code review

## Stage 4 — show it: `overseer usage` and a second account card

**Scope increased by Sol's finding 5, which is the one that would have shipped a green build with an
empty card.** Sol constructed a schema-1 line carrying a top-level `codex`, and although the server
decoder retained it, `parseSample` in `usage-history-client.ts` rebuilds the line as
`{ nextDueMs, recordedAt, pass }` — a whitelist. Verified in the source: the field is dropped at the
browser boundary. **Stages 2 and 3 can both be green while the card has no input at all.** So this
stage explicitly includes the client parser:

- `usage-history-client.ts` — a tolerant `codex` parser and the browser view types.
- `UsagePanel.tsx` / `UsageHistory.tsx` — defined ownership of *which* reading is the newest Codex one.
- **An end-to-end test**: route payload → `parseUsageHistory` → rendered Codex card. Nothing less
  catches a whitelist.
- The card's age comes from **`codex.readAt`**, never from the enclosing Claude pass's source instant;
  they are different observations taken at different times.

The rest:

- `overseer usage` prints both accounts, additive to `usageLines()`, with the positive control printed
  every time. No new flag, so `buildProgram()`, the `Parsed` union and `help()` are untouched — which
  after `overseer-cli`'s Commander conversion (merged, `73a7832a`) is the whole of the collision
  surface, and they have confirmed `usageLines()` is ours.
- A second account card from the same `StatCard` primitive in `tools/fleet/web/src/ui.tsx`, additive
  to `UsagePanel.tsx`. One row per window, shown by its display alias or its raw duration. The
  reset-credit count is its own stat. **No "API credits" stat** — see the withdrawn finding 3.
- A short section in [usage-history.md](../project/usage-history.md): the source, that it is a real
  fetch every time, the positional-mapping trap, and that the number is non-monotonic at short range.

- [ ] Client parser + end-to-end test
- [ ] `overseer usage` renders both, positive control included
- [ ] Card + `npm run typecheck`, `npm test`, lint on touched files
- [ ] Sol code review of the whole diff
- [ ] Debrief to the Overseer

## Not in scope

Consuming a reset credit; a second `~/.codex` account; querying the API key's own balance (the
withdrawn finding 3 — worth doing, not needed for headroom); the session-log fallback (moved to
follow-up, above); the `account/usage/read` daily token series (it works — a year of daily totals — but
it is not a limit); anything in `run-codex.ts` or the daemon loop beyond its existing `onPass` hook.

## Sol's plan review, round 1

Verdict: **ready with changes; not ready to build as written** — eight findings, no P0, seven P1 and
one P2. Prompt and full answer are checked in beside this file
([prompt](260909d-codex-usage-plan-review-prompt.md) ·
[answer](260909d-codex-usage-plan-review-sol-r1.md)).

All eight are folded in above. Three were checked against the source before being accepted, because a
finding is a claim: **4** (verified — `safeOnPass` at daemon.ts:789 `void`s the returned promise, and
`usageRunning` at daemon.ts:809 is what shutdown waits for), **5** (verified — the `parseSample`
whitelist at usage-history-client.ts:181), and **2**, where Sol was right that the argument failed but
the conclusion survived a better test. Sol could not run the network-dependent checks and said so,
which is what let its finding 2 be answered rather than merely disputed.

One finding was adopted in a narrower form than proposed (**4**, above). One was accepted as an outright
error of mine and withdrawn rather than softened (**1**). Nothing was overruled.
