# Usage Limits: one section per Claude and Codex account-subscription

**Status:** planning · **Started** 2026-09-10 · **Worktree** `.claude/worktrees/usage-per-account`
· **Session** `web-260910-062922-98694f`

Greg, 2026-09-10:

> The Usage Limits page should have sections for each Claude and Codex account-subscription,
> summarising 5d and weekly X% used and when they reset.

This is the same thing he asked for on 2026-09-09 as `qi-3sr3jht6` (*"separate sections with clear
headings for Claude vs Codex, each laid out similar"*, and *"always & only say X% used"*), and it is
[260909g](260909g-several-claude-subscriptions-on-the-box-and-a-fleet-that-spreads-across-them.md)
**Stage 4's** first half. The blocker named there is real and is most of this plan: the tab cannot
show one section per account until the **data reaching the tab is plural**, and today every hop
between the daemon and the page carries exactly one account.

## What this is for, in plain words

Greg pays for several Claude Max subscriptions and several ChatGPT/Codex ones. The box runs agents
across all of them. **The one question that decides what the fleet may do next is: which
subscription still has room?** Today the Usage Limits tab answers that for exactly one account — the
one the Overseer itself happens to be logged in as — and says nothing about the others. So a pool
account can be at 4% while the page shows 96% and everything looks blocked, or the reverse.

A "section" here is: a heading naming the account, then its **5-hour** window and its **weekly**
window, each as *X% used* and *resets at HH:MM*. That is the whole deliverable.

### One thing in Greg's sentence I am reading, not asking about

**"5d" is read as the five-HOUR window.** Both families have exactly two windows a person cares
about, and in both they are a five-hour one and a weekly one: Claude's are named `five_hour` and
`seven_day` (`tools/overseer/usage.ts`), Codex's are `primary` and `secondary` — *positions, not
window names* — which the box has measured as 5-hour and weekly. There is no five-day window
anywhere in either API, so there is nothing else it can mean. It costs nothing to be safe about it
anyway: **every window the reading carries is rendered**, with the five-hour and the weekly promoted
to the top of each section and anything else (Claude's rotating codename windows — `NIMBUS_QUILL`
and friends) collapsed below, which is separately what `qi-3sr3jht6` asked for.

## Jargon, once

| Term | What it means here |
|---|---|
| **account-subscription** | One paid login. `greg@mindstone.com`'s Claude Max is one; `greg@rehearsable.ai`'s is another. |
| **registry** | `~/.claude-accounts/registry.json`, from 260909g. One entry per account the box may launch work on, with `family: "claude" \| "codex"`. |
| **ambient account** | The login a process gets when nothing sets `CLAUDE_CONFIG_DIR` / `CODEX_HOME`. It **cannot be registered** ([260909g](260909g-several-claude-subscriptions-on-the-box-and-a-fleet-that-spreads-across-them.md)) and it is the one the Overseer runs on, so it must still get a section. |
| **checkpoint** | `~/.overseer/current.json`, written by the Overseer daemon and read by the fleet dashboard. The dashboard collects nothing itself. |
| **window** | A rolling limit — five-hour, weekly — with a utilisation percentage and a reset instant. |

## What was measured, on this box, before designing

Everything below was checked in the source or on the live box today, not carried from a brief. Three
of them came from peer sessions and are marked; each was re-checked here because a claim from a peer
becomes a source comment if nobody does.

1. **The dashboard is structurally forbidden from collecting.** `tools/fleet/usage-feed.ts`'s header
   states the *one collector* contract in as many words: *"This file collects nothing… a dashboard
   that scanned on its own would be a second collector of the most expensive thing on the box."* So
   the per-account readings **must** arrive through the checkpoint. A route that read
   `/api/oauth/usage` per account per poll was the obvious shortcut and is not available.
2. **Every hop is singular.** `UsageReport` (`tools/fleet/wire.ts:543`) has one `account`, one
   `cache`, one `verdict`. `UsageSummary` (`wire.ts:2840`) likewise. The daemon runs one usage pass.
   `usage-history-from-report.ts` projects one account into each history line.
3. **`readUsage(configDir, { fetch })` already does the whole per-account read**, and returns
   identity with it: it fetches `/api/oauth/profile` and `/api/oauth/usage` **on one credential
   snapshot** (`accounts.ts:406`, and the comment there says why — re-reading between them can join a
   rotated token's usage to the previous token's identity). It already redacts the credential out of
   the windows it returns. Nothing new needs writing to read a Claude account.
4. **`collectCodexUsage` is already per-account-capable.** `CollectCodexUsageOptions.env` is
   injectable (`codex-usage.ts:45-54`) and `CODEX_HOME` is on the child-env allowlist
   (`codex-usage.ts:562`, with a comment saying why it is an allowlist rather than the house
   denylist). *Told to me by session `codex-accounts`; verified here in the source.*
5. **`enforceExpectedAccount` has a hole, and it is on the path I am about to use.**
   `codex-usage.ts:516` returns the reading unchanged when `reading.accountId === null`, **even when
   an expected id was supplied** — so a null-identity reading passes the pin check and would be
   labelled with an account it was never shown to belong to. *Reported by `codex-accounts`; read the
   function here and it is exactly that.* Their brief stops at Stage 1 and plan 260910b Stage 3 is
   unassigned, so **this plan fixes it** rather than leaving a seam for nobody.
6. **The chart is already keyed by account.** `plotUsageHistory` builds `byAccount`
   (`usage-history-series.ts:145`). It is fed one account, not built for one. That is *not* the same
   as it being ready — see the not-built stage — but it means the eventual plural chart is a schema
   change and not a rewrite.
7. **An additive checkpoint field needs no schema bump.** `tools/overseer/store.ts` states its own
   rule three times (lines 470, 480, 509): a reader that ignores a new field *"draws no usage panel,
   which is poorer rather than wrong"* — unlike schema 2's `statusSince`, where an old reader would
   have rendered something false.
8. **The live registry has one entry.** `mindstone`, `family: "claude"`, `role: "pool"`. Zero Codex
   entries until `codex-accounts` lands 260910b Stage 1. So on the box today the page should draw
   **three** sections: ambient Claude (`greg@rehearsable.ai`), registered Claude (`mindstone`), and
   ambient Codex.

## The shape

### A sibling field, not a bigger `UsageReport`

The obvious move is to grow `UsageReport` an `accounts[]`. **Rejected**, for one reason that is not
tidiness:

`chooseUsage` (`tools/overseer/usage-carry.ts`) decides whether to publish a fresh `UsageReport` or
re-publish the stored one, and it decides that on **whether the transcript scan completed**. A scan
over ~2.9 GB routinely does not finish. If the per-account readings rode inside `UsageReport`, then
*"the transcript scan was incomplete"* would throw away **a set of live HTTP readings that were
perfectly good and have nothing to do with the scan.** That is precisely the mistake
[usage-history.md](../project/usage-history.md) already names — *"a publication decision is not an
observation"* — and it would be reintroducing it one file along.

So:

```text
Checkpoint
  usage:        StoredUsage          unchanged — ambient account, transcript scan, verdict
  accountUsage: StoredAccountUsage   NEW — one live reading per account, windows only
```

Two fields, two owners, two failure modes, and no interaction with the carry logic. It is also the
smaller diff: `chooseUsage`, `parseStoredUsage`, the verdict and the whole 429 path are untouched.

### The types

```ts
/** One account's live headroom, or the reason there is none. Windows only — no verdict, no 429s. */
export type AccountUsageSection = {
  /** Registry name ("mindstone"), or "ambient" for the unregistered logged-in account. */
  name: string;
  family: "claude" | "codex";
  /** "ambient" is a third role here, and is NOT a registry role: the ambient account cannot be registered. */
  role: "orchestrator" | "pool" | "ambient";
  displayEmail: string | null;
  reading:
    | { kind: "windows"; takenAt: string; windows: UsageWindowCard[] }
    | { kind: "unknown"; takenAt: string; why: string };
};

export type StoredAccountUsage =
  | { kind: "reading"; collectedAt: string; accounts: readonly AccountUsageSection[] }
  | { kind: "none"; why: string; at: string };
```

**`takenAt` is per account, not per pass.** The reads are independent HTTP calls; one can succeed at
06:00 and its neighbour fail until 06:12. A single pass-level timestamp would put a fresh badge on a
stale reading, which is the failure this whole subsystem exists to refuse.

**No percentage field exists on the `unknown` arm.** `parseUsageWindow` already returns an expired
window with *no percentage field at all*, and this carries that property outward: a renderer handed
a number renders it, so the number is not there to reach. This is rule 1 of the eight —
[usage-history.md](../project/usage-history.md) — *absence is never a zero*, and it is the single
rule most likely to be broken by a careless `?? 0` in the UI.

### Where the collection happens

`scripts/overseer.ts` — the composition root, and the only file allowed to touch both sides of this
seam, exactly as `usage-history-wiring.ts` already does for the history store. It gains one
collector, `collectAccountUsage`, wired into the daemon beside the existing usage pass. `daemon.ts`
learns a second optional pass and imports nothing new to serve it.

**Deduplication by resolved state dir, and this is a real trap rather than hygiene.** The Overseer
daemon may itself be running routed — `CLAUDE_CONFIG_DIR` pointed at a registered account. Then "the
ambient account" *is* `mindstone`, and a naive implementation draws `mindstone` twice, once labelled
ambient and once labelled pool, with two independently-taken readings that will disagree by a few
percent. So the ambient entry is emitted only when `path.resolve` of its config dir matches no
registry `stateDir`.

### Cadence, and what it costs

One pass per daemon usage tick — 300 s, the same timer. Per pass that is **two HTTPS calls per
registered Claude account** (profile + usage; `readUsage` makes both) and **one short-lived
app-server spawn per Codex account**. With today's registry that is 4 HTTP calls and 1 spawn every
five minutes. Bounded: `readUsage` already carries a 10 s timeout, `collectCodexUsage` a 20 s one,
and the accounts are read with `Promise.all` so the pass is as slow as its slowest account, not
their sum.

## The stages

### Stage 1 — the reading, per account, with the Codex pin closed

`tools/overseer/account-usage.ts` (new): `collectAccountUsage(deps)` → `StoredAccountUsage`.

- Claude accounts: `readUsage(account.stateDir, { fetch })`, then the **registry pin** —
  `providerAccountId` must match, and `providerTenantId` must match. Note `providerTenantId` is
  becoming `string | null` in `codex-accounts`' Stage 1 (Sol's ruling, so `Pick<AccountEntry, …>`
  keeps working for `LiveUsageIdentity`); **null-vs-null must read as a match, not as unknown**, or
  every Codex account fails its own pin.
- Codex accounts: `collectCodexUsage({ env: { ...process.env, CODEX_HOME: account.stateDir }, expectedAccountId: account.providerAccountId })`.
- **`enforceExpectedAccount` is fixed here**: when an `expectedAccountId` was supplied, a `null`
  `accountId` is `unknown`, not a pass. Measurement 5. A red test first.
- The ambient Claude account: `readUsage(process.env.CLAUDE_CONFIG_DIR ?? ~/.claude)`, identity taken
  from the response rather than from a pin (there is nothing to pin it to), and emitted only if its
  resolved dir is not a registered `stateDir`.
- The ambient Codex account: `collectCodexUsage()` with no `CODEX_HOME`, same dedup rule.
- A failure is **data**: one account's `unknown` never fails the pass, and the pass returns a
  `reading` carrying however many sections it managed. A pass that produced *no* sections at all is
  `none` with a `why`, never an empty `reading` — an empty list renders as "no accounts", which is a
  claim, and it must not be reachable from a total failure.

### Stage 2 — carrying it: checkpoint, wire, projection

- `tools/overseer/store.ts`: `Checkpoint.accountUsage`, `parseStoredAccountUsage` degrading a bad
  body to `none` rather than failing the whole checkpoint (the rule `usage` and `attention` already
  follow), and the held-value carry so a pass that did not run keeps the last good one. **No schema
  bump** — measurement 7.
- `tools/fleet/wire.ts`: the two types above, plus `AccountUsageFeed` with the same arms
  `UsageFeed` has (`not-asked`, `checkpoint-absent`, `checkpoint-unreadable`, `unsupported-schema`,
  `no-reading`, `reading-unreadable`, `published`). Not fewer: *no pass has run* and *a reading is
  there and this build cannot read it* are different investigations, and folding them cost a review
  round on the singular card already.
- `tools/fleet/account-usage-feed.ts` (new): `projectAccountUsage(checkpoint)`, pure, no clock, no
  I/O — so the same projection can serve a live card and a replayed record when Stage 4 (below,
  not built) arrives. Import surface kept to leaves, per `usage-feed.ts`'s header.
- `tools/fleet/collect.ts` / `state.ts`: one more field on the state the dashboard already fetches.
  No new route: the sections ride the `/api/state` poll the page already makes.

### Stage 3 — the page

`tools/fleet/web/src/AccountUsageSections.tsx` (new), drawn on the Usage tab under the existing card.

- **Grouped by family, Claude then Codex**, each family with its own heading — Greg's `qi-3sr3jht6`
  wording. Within a family, the ambient account first, then registered accounts by name.
- Each section: the account's email (or registry name when there is no email), a role chip, then the
  **five-hour** and **weekly** rows. Each row is *X% used* with a bar, and *resets HH:MM* — **only
  ever "X% used", never "Y% remaining"**, Greg's explicit instruction.
- Any further windows go in a `<details>` collapsed by default, headed with what they are — the
  `NIMBUS_QUILL` complaint.
- **Age is drawn from the section's own `takenAt`**, against the browser clock, on every section.
- An `unknown` reading draws its `why` and **no bar and no number**.
- **One caveat line under the 24-hour chart**, naming the account by email: *"This chart is
  `greg@rehearsable.ai` only. The per-account sections above are live readings; the history behind
  this chart is still single-account."* Naming the email rather than saying "the orchestrator" is
  the Overseer's condition, and it is right: in a week nobody will remember which one that was.

### Stage 4 — NOT BUILT, and named so nobody rediscovers it

**Per-account 24-hour history.** The chart stays single-account in this plan. What it needs, in
full, so the next agent starts from here:

- `usage-history-record.ts`: `UsagePass` carries one `accountUuid` and one `cache` (line 246), and
  `codex?: CodexObservation` is one observation (line 277). Making both plural is a
  **`SUMMARY_SCHEMA` 2** change to a persisted format, and `decodeUsageHistoryLine` must keep
  schema-1 lines readable **positionally** — the existing `unsupported` arm is there for exactly this
  and must not be bypassed.
- Retention carries one `stashedCodex`; that becomes plural too.
- `usage-history-series.ts:152`: the series cut. `byAccount` already exists (measurement 6), so the
  plot is close — but **alternating one-account lines do not work**: the plot cuts every series
  absent from the current record, so an A/B/A/B sequence draws as disconnected points rather than two
  lines. One record must carry all accounts. This is the trap 260909g Stage 3 names and it is the
  reason this is a separate stage rather than a widening of Stage 2.

## The simpler options passed over

1. **A live `/api/usage/accounts` route on the dashboard, read on demand.** Much the smallest diff —
   no daemon change, no checkpoint change. **Refused by the one-collector contract** (measurement 1),
   and it would put a second interpretation of the same measurement on the box, which is the class of
   bug this area keeps producing.
2. **Grow `UsageReport.accounts[]`.** Smaller than a sibling field, and entangles live readings with
   the transcript scan's publication decision. Argued above.
3. **Derive the ambient section from the existing `UsageSummary.cache.windows`** instead of reading
   it live. Free, and wrong in a way that would be invisible: the cache is a *hint* whose staleness
   reads exactly like currency, so the ambient section would be a different instrument from its
   neighbours while looking identical. Every section is a live read.
4. **Do the plural history in the same slice.** Deferred deliberately; Stage 4 says exactly what is
   left. Approved by the Overseer, 2026-09-10.

## The eight rules, checked against this design

From [usage-history.md](../project/usage-history.md):

1. *Absence is never a zero* — the `unknown` arm carries no percentage field at all.
2. *A stale reading is not a current one* — per-account `takenAt`, aged in the browser.
3. *An expired window is unknown, not 0%* — inherited unchanged from `parseUsageWindow`.
4. *Rejections are never attributed to an account* — no 429s in `AccountUsageSection` at all. The
   transcript scan stays where it is, global and unattributed.
5. *A publication decision is not an observation* — the whole reason for the sibling field.
6. *An unrecognised window is a named row* — the collapsed `<details>`, not a filter.
7. *A gap in the record is a gap, not a flat line* — Stage 4's problem; this slice draws no series.
8. *Coverage makes a negative believable* — a section with no windows says why, and a pass with no
   sections is `none` with a reason, not an empty list.

## File set

New: `tools/overseer/account-usage.ts`, `tools/fleet/account-usage-feed.ts`,
`tools/fleet/web/src/AccountUsageSections.tsx`, and a test file for each.
Changed: `tools/overseer/codex-usage.ts` (the pin), `tools/overseer/store.ts`,
`tools/overseer/daemon.ts`, `scripts/overseer.ts`, `tools/fleet/wire.ts`, `tools/fleet/collect.ts`,
`tools/fleet/web/src/App.tsx`, `tools/fleet/web/src/types.ts`.
Docs: a new `docs/project/usage-per-account.md` under `usage-history.md`'s parent, and a line in
`dev-and-deployment-overview.md`.

## How this is verified, and what would catch each class

- **Red first on the Codex pin**: a reading with `accountId: null` and an `expectedAccountId`
  supplied must be `unknown`. That test fails against today's code — measurement 5 — and is the one
  test in this plan whose subject is a bug that exists right now.
- **The `?? 0` class**: a test that feeds a section an `unknown` reading and asserts the rendered
  text contains no `%` at all. Asserting "not 0%" is the weaker question — a bug that rendered `NaN%`
  or `undefined%` would pass it.
- **The duplicate-ambient class**: a test with the ambient config dir set to a registered
  `stateDir`, asserting one section rather than two.
- **The mutation check**: unit tests with injected fakes cannot see whether the composition root
  actually wired the collector in. So the wiring is checked by mutating `scripts/overseer.ts` to pass
  no collector and confirming the page says *no reading* rather than silently drawing nothing.
- Gates: `npm test` and `npm run typecheck`, and GPT Sol on the plan before building and on the code
  after.
