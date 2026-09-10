# Usage Limits: one section per Claude and Codex account-subscription

**Status:** built · **Started** 2026-09-10 · **Worktree** `.claude/worktrees/usage-per-account`
· **Session** `web-260910-062922-98694f` · **Review**
[260910c-review-sol.md](260910c-review-sol.md) (three P0s, all acted on) ·
**Doc:** [usage-per-account.md](../project/usage-per-account.md)

> **⚠ THE DESIGN BELOW WAS CORRECTED BEFORE IT WAS BUILT.** GPT Sol's verdict was *"I would not build
> the plan exactly as written"*, and he was right on all three P0s. The sections that follow are the
> plan **as reviewed**: each correction is written in where it belongs, with the wrong version kept
> visible rather than edited away, because over-crediting a design that was checked and found wanting
> is how the next person repeats it. The summary of what changed is
> [§ What the review changed](#what-the-review-changed).

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
   **Two things this plan first said about it were too strong**, corrected in the review: it never
   *selects, sends or spends* the refresh token, and it does read the file containing it, which is
   unavoidable; and its 10 s bound is per HTTP request rather than per account.
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

## What the review changed

GPT Sol read the plan and the source on 2026-09-10 —
[the full review](260910c-review-sol.md). Every claim below was re-checked here before it was
accepted; his citations were accurate in every case.

### Three P0s

1. **The plan collected the ambient Codex reading a second time.** `scripts/overseer.ts` already
   spawns one `collectCodexUsage()` per daemon usage tick and stashes it for the history recorder.
   A second collector would have been two app-server spawns every five minutes **and** two
   independently-measured numbers for one subscription on one page, a point apart, each undermining
   the other. **Fixed**: the composition root fans one observation to both consumers, and
   `collectAccountUsage` is *handed* the ambient reading rather than taking it.
2. **The plan gave both families the same `UsageWindowCard[]`.** Codex returns buckets containing
   slotted windows, and duration — not slot — names the window; flattening would have dropped the
   bucket structure or invented one for Claude, and nothing would have stopped a Codex section
   carrying Claude windows. **Fixed**: `family` discriminates the reading shape, and the existing
   Codex bucket interpretation is reused rather than re-derived.
3. **The plan depended on a peer session's unlanded type change.** It said `providerTenantId` "is
   becoming `string | null`" and asked for null-vs-null to read as a match. In committed source it is
   still a required `string`, and plan 260910b has not settled the question. Sol also showed the
   argument was misplaced: **a registered Codex account is pinned through `expectedAccountId` and
   never touches Claude's `LiveUsageIdentity.providerTenantId` at all.** **Fixed**: Claude's
   organisation pin stays required, `pinMismatch` is Claude-only and says so, and this plan now
   depends on nothing unlanded.

### Four P1s, all about the page making a claim it cannot support

- **An ambient Codex reading can carry no account id.** `enforceExpectedAccount` refuses a null only
  when an expected id was *supplied*, and the ambient read supplies none — so percentages could have
  reached a section headed *ambient Codex* with nothing tying them to any subscription. **Fixed**: a
  null `accountId` yields `unknown` for an account-subscription section, whether pinned or not.
- **Expiry has to be re-derived in the renderer.** Collection-time parsing is not enough: a window
  can reset while the page is open, and a held checkpoint is republished for up to five minutes.
  **Fixed** by reusing `UsagePanel`'s `WindowStatCard`, whose `windowStat` checks the reset against
  the browser's clock — and pinned by a test that resets a window under the page.
- **Directory equality is not subscription equality.** `path.resolve` catches two spellings of one
  path, not two state dirs holding one login, a symlink, or an ambient login copied into a registered
  home — and the ambient account is absent from the registry, so registry uniqueness cannot catch it
  either. **Fixed**: identity has the last word after the reads; two sections in one family sharing a
  provider account id collapse to the registered one with a loud problem, and sections with no
  established identity are never collapsed.
- **A short list reads as a complete one.** **Fixed** with `problems` beside the accounts, drawn
  loudly above the sections and printed with `!` by the CLI — this plan's choice between Sol's two
  options, now recorded rather than implicit.

### Two corrections to conclusions this plan asserted

- **The history caveat this plan proposed was false.** It would have said *"this chart is
  `greg@rehearsable.ai` only"*; a `/login` swap inside the window produces several account uuids
  across the range, and `UsageHistory.tsx` already distinguishes them by uuid fragment when it
  happens. The line now says history samples only the account the daemon observed on each pass,
  identified by uuid, and names no email.
- **`readUsage` "never reads the refresh token" was too strong.** It never *selects, sends or spends*
  it, and it does read the file containing it, which is unavoidable. The 10 s bound is also per HTTP
  request rather than per account: a rotated-token retry can make up to four sequential requests.
  Both corrected where they were written down.

### Three simplifications taken

`overseer usage` now consumes the same `collectAccountUsage`, so there is **one identity-pin
implementation** rather than two that could drift; the Claude and Codex window renderers are reused
rather than rewritten; and `ambient` moved out of `role` into its own `origin` field.

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

**As built** — the two corrections from the review are marked, and the wrong version is kept beside
each so the next person does not re-derive it.

```ts
/** One account's live headroom, or the reason there is none. Windows only — no verdict, no 429s. */
export type AccountUsageSection = {
  /** Registry name ("mindstone"), or "ambient" for the unregistered logged-in account. */
  name: string;
  /** What the account is FOR. ~~Was `"orchestrator" | "pool" | "ambient"`~~ — P0-3 of the review:
      the ambient login's role IS orchestrator, and folding provenance in here made the question
      unanswerable for the one account it matters most about. */
  role: "orchestrator" | "pool";
  /** How the box KNOWS about it, and therefore how far its identity can be trusted. */
  origin: "ambient" | "registered";
  displayEmail: string | null;
  /** What the provider itself returned. Null means the reading may carry no numbers. */
  providerAccountId: string | null;
  /** ISO. When THIS account was read — per section, never per pass. */
  takenAt: string;
} & (
  /* ~~One shared `windows: UsageWindowCard[]`~~ — P0-2: Codex returns buckets of slotted windows,
     and a shared shape would have dropped that or invented a bucket for Claude. */
  | { family: "claude"; reading: { kind: "windows"; windows: UsageWindowCard[] } | { kind: "unknown"; why: string } }
  | { family: "codex"; reading: { kind: "buckets"; buckets: CodexUsageBucket[]; resetCredits: number | null } | { kind: "unknown"; why: string } }
);

export type StoredAccountUsage =
  /** `problems` carries faults belonging to NO account — a registry that would not parse, above all.
      Without it a short list reads as a complete one. */
  | { kind: "reading"; collectedAt: string; accounts: readonly AccountUsageSection[]; problems: readonly string[] }
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

One pass per daemon usage tick — 300 s, the same timer, run **after** the transcript scan in the same
continuation and **whichever way that scan went**. Per pass that is **two HTTPS calls per registered
Claude account** (profile + usage; `readUsage` makes both) and **one short-lived app-server spawn per
registered Codex account**. The ambient Codex account costs **nothing extra**, because the pass
already takes that reading for the history recorder and it is fanned rather than re-taken — the
first draft of this section said "1 spawn" and was wrong about which spawn it was (P0-1).

With today's registry — one registered Claude account, no registered Codex ones — that is **4 HTTP
calls and no additional spawn** every five minutes.

**Bounded, with one correction to what this plan first claimed.** `readUsage`'s 10 s timeout is **per
HTTP request, not per account**: a rotated-token retry can make up to four sequential requests, so
one Claude account can take up to ~40 s in the worst case. `collectCodexUsage` carries 20 s. The
accounts are read with `Promise.all`, so the pass is as slow as its slowest account rather than their
sum — which is what keeps that worst case from compounding.

## The stages

### Stage 1 — the reading, per account, with the Codex pin closed

`tools/overseer/account-usage.ts` (new): `collectAccountUsage(deps)` → `StoredAccountUsage`.

- Claude accounts: `readUsage(account.stateDir, { fetch })`, then the **registry pin** —
  `providerAccountId`, `providerTenantId` and (when the registry recorded one) `displayEmail` must
  all match. **Claude-only, and it stays that way**: ~~`providerTenantId` is becoming `string | null`
  and null-vs-null must read as a match~~ was P0-3 of the review. A registered Codex account is
  pinned by `expectedAccountId` inside `collectCodexUsage` and never reaches this comparison, so
  weakening Claude's organisation pin to accommodate it would have traded a live check for nothing.
- Codex accounts: `collectCodexUsage({ env: { ...process.env, CODEX_HOME: account.stateDir }, expectedAccountId: account.providerAccountId })`.
- **`enforceExpectedAccount` is fixed here**: when an `expectedAccountId` was supplied, a `null`
  `accountId` is `unknown`, not a pass. Measurement 5. A red test first.
- **A `null` `accountId` carries no numbers even when nothing was pinned.** The ambient Codex read
  supplies no expected id, so `enforceExpectedAccount` never sees it — and a percentage under a
  heading saying *ambient Codex* that nothing ties to any subscription is the claim this page may not
  make. P1 of the review.
- The ambient Claude account: `readUsage(process.env.CLAUDE_CONFIG_DIR ?? ~/.claude)`, identity taken
  from the response rather than from a pin (there is nothing to pin it to), and emitted only if its
  resolved dir is not a registered `stateDir`.
- **The ambient Codex account is HANDED IN, not collected.** ~~`collectCodexUsage()` with no
  `CODEX_HOME`~~ was P0-1: the daemon's usage pass already spawns one app-server per tick. The
  composition root fans that single observation to the history recorder and to this collector.
- **Identity has the last word, after the reads.** Directory equality is not subscription equality —
  two state dirs can hold one login, and the ambient account is absent from the registry, so registry
  uniqueness cannot see it. Two sections in one family sharing a `providerAccountId` collapse to the
  registered one, with the collision reported in `problems`; sections with no established identity
  are never collapsed, because merging two unknowns invents the fact that is missing. P1 of the
  review.
- A failure is **data**, at two scopes: one account's `unknown` never fails the pass, and a fault
  belonging to no account — a registry that will not parse — goes in `problems`, because folding it
  into a section would blame an account that did nothing wrong and dropping it would let a **short**
  list read as a complete one. A pass that produced *no* sections at all is `none` with a `why`,
  never an empty `reading`.

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

`tools/fleet/web/src/AccountUsageSections.tsx` (new), drawn **above** the existing card on the Usage
tab. ~~Under it~~: Sol's coherence finding is that *which subscription still has room* is the
question the tab exists for, and putting the deep single-account card first made the page look like
it was about one subscription — which it was until 2026-09-10 and is no longer.

- **Grouped by family, Claude then Codex**, each family with its own heading — Greg's `qi-3sr3jht6`
  wording. Within a family, the ambient account first, then registered accounts by name.
- Each section: the account's email (or registry name when there is no email), a role chip and — when
  it applies — an `ambient` chip, then the **five-hour** and **weekly** rows. Each row is *X% used*
  with a bar, and *resets in <duration>* — **only ever "X% used", never "Y% remaining"**, Greg's
  explicit instruction.
- **The window renderers are `UsagePanel`'s, imported rather than rewritten**, and that is what
  satisfies the review's expiry P1: `windowStat` re-derives expiry against the **browser's** clock,
  so a window that reset while the page was open draws no percentage. A second renderer here would
  have inherited the collection-time answer. There is no window-drawing code in this file at all.
- Any further windows go in a `<details>` collapsed by default, headed with what they are — the
  `NIMBUS_QUILL` complaint. **Collapsed, not filtered**: rule 6.
- **Age is drawn from the section's own `takenAt`**, against the browser clock, on every section.
- An `unknown` reading draws its `why` and **no bar and no number**.
- **`problems` is drawn loudly above the sections**, under a heading saying the list may be
  incomplete.
- **The card below loses what would otherwise be on screen twice.** A `headroomShownAbove` prop makes
  the Usage tab's mount drop its cached window grid — the cache and the live read are the same source
  at two moments, and the live one is fresher — and drop the Codex card entirely. The Overseer tab
  passes nothing and keeps both, because there the cache is the only headroom reading there is. One
  component, two mounts, one prop, so they cannot drift.
- **One caveat line under the 24-hour chart, naming NO email.** ~~*"This chart is
  `greg@rehearsable.ai` only"*~~ was the Overseer's condition and it is false: a `/login` swap inside
  the window produces several account uuids across the range, and `UsageHistory.tsx` already
  distinguishes them by uuid fragment when it does. The line says history samples only the account
  the daemon observed on each pass, identified by uuid, and does not yet record the sections above.

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
3. *An expired window is unknown, not 0%* — inherited from `parseUsageWindow` at collection, **and
   re-derived against the browser's clock at render**, because a window can reset while the page is
   open and a held checkpoint is republished for minutes afterwards. Collection-time alone is not
   enough; that was a P1 of the review.
4. *Rejections are never attributed to an account* — no 429s in `AccountUsageSection` at all. The
   transcript scan stays where it is, global and unattributed.
5. *A publication decision is not an observation* — the whole reason for the sibling field.
6. *An unrecognised window is a named row* — the collapsed `<details>`, not a filter.
7. *A gap in the record is a gap, not a flat line* — Stage 4's problem; this slice draws no series.
8. *Coverage makes a negative believable* — a section with no windows says why, and a pass with no
   sections is `none` with a reason, not an empty list.

## File set, as built

New: `tools/overseer/account-usage.ts`, `tools/fleet/account-usage-feed.ts`,
`tools/fleet/web/src/AccountUsageSections.tsx`, `tests/overseer-account-usage.test.ts`,
`tests/fleet-account-usage-sections.test.tsx`.
Changed: `tools/overseer/codex-usage.ts` (the pin), `tools/overseer/store.ts`,
`tools/overseer/daemon.ts`, `scripts/overseer.ts` (both the daemon wiring and `overseer usage`),
`tools/fleet/wire.ts`, `tools/fleet/state.ts`, `tools/fleet/overseer-status.ts`,
`tools/fleet/web/src/types.ts`, `tools/fleet/web/src/usage-history-client.ts` (one parser exported
rather than a second written), `tools/fleet/web/src/UsagePanel.tsx`,
`tools/fleet/web/src/UsageHistory.tsx`, `tools/fleet/web/src/App.tsx`, and the test files whose call
sites the required new field made red — which is what that field being required is for.
Docs: `docs/project/usage-per-account.md`, a line under it in `dev-and-deployment-overview.md`, and
its signpost in `AGENTS.md`.

## How this is verified, and what would catch each class

- **Red first on the Codex pin**: a reading with `accountId: null` and an `expectedAccountId`
  supplied must be `unknown`. It failed against committed code before the fix — measurement 5 — and
  is the one test here whose subject was a bug that already existed. Its companion pins the other
  half: an *unpinned* null is still a good ambient reading, so a fix that refused every null would
  have broken the ambient read and looked like the same green.
- **The `?? 0` class**: the rendering test asserts an `unknown` section produces no `%` anywhere.
  Asserting "not 0%" is the weaker question — `NaN%` or `undefined%` would pass it.
- **The expiry class**: a window whose reset was ahead of its collection instant and is behind *now*.
  The section must draw no percentage. This fails against a renderer that trusts collection time.
- **The duplicate-ambient class**: the ambient config dir pointed at a registered `stateDir`,
  asserting one section rather than two — and its harder twin, two different dirs answering with one
  provider identity, asserting one section plus a stated problem.
- **The whole-hop join**: the real store writes a checkpoint, `statePayload` composes it,
  `parseFleetState` reads it as the browser does, and the component renders text into a DOM. Unit
  tests with injected fakes cannot see whether the real things are wired together — the class in
  docs/postmortems/260908b, which is exactly the bug this feature is a repair for.
- **Looked at in a browser**, at 900px and at 400px, against a seeded checkpoint carrying four
  sections including a failed one and a stale one. That is what caught two things no assertion did:
  the Claude window cards had no progress bar while the Codex ones did — Greg asked for one — and the
  Codex card at the foot of the tab was drawing the same subscription as the section above it.
- **The full suite caught a bug the focused suites did not.** The first version passed
  `headroomShownAbove` unconditionally, so against a server too old to send `accountUsage` — or before
  the daemon's first per-account pass — the sections said *there is no per-account reading* **and**
  the card below hid its own cached windows and Codex half. The tab then showed no percentage for any
  account while looking complete: suppressing a reading with no replacement on screen, which is the
  exact risk the code-review prompt had named in advance. Found by an existing test
  (`fleet-web.test.tsx`, *gives both mounts the same newest Codex reading*); fixed by suppressing only
  when the sections are `published`, and pinned from the other side by a new test.
- **And it exposed three tests that could not fail.** Every test in `fleet-web.test.tsx` that
  switched Usage → Overseer assigned `location.hash` and awaited a microtask — but the app re-renders
  on `hashchange`, which jsdom delivers as a later task, so the Overseer tab was never drawn. The
  assertions passed anyway because each checked text present on *both* tabs. All three now dispatch
  the event inside `act` and prove the switch landed by asserting a Usage-only heading is gone.
- **The code review was killed at its 45-minute limit with no verdict written — and had found a
  P0 no fixture could.** Anthropic's usage endpoint spells reset times with microseconds and
  `+00:00` (measured on this box: `2026-09-10T08:50:00.391562+00:00`), and every fleet-side reader
  accepts only the canonical `toISOString()` spelling. On the real box every Claude section would
  have been refused as unreadable while every test passed, because every fixture — and the seeded
  checkpoint the browser check used — was canonical. Sol normalised the instant once in the producer
  before the kill; it was then confirmed live here, with the real collector against this box's
  accounts, through the real fleet projection and the browser parser, `published` at both.
  **The class is worth naming for the next feature in this area: a fixture written by hand encodes
  the author's idea of the provider's format, and the provider does not share it. One live
  round-trip is worth more than any number of fixture tests here.**
- The same killed run fixed two further classes, each with a postmortem:
  [260910a](../postmortems/260910a-a-container-success-cannot-prove-every-suppressed-child-has-a-replacement.md)
  (the card hid its fallback on `published`, but a published feed can hold an unknown, stale, expired
  or differently-attributed section — suppression is now earned per provider, account and window)
  and
  [260910b](../postmortems/260910b-a-proof-bearing-field-cannot-live-outside-the-branch-it-licenses.md)
  (`providerAccountId` is now `string` on every numeric arm; the same flaw was live in the older
  standalone Codex card, which drew numbers under "Account not attributed" and no longer does).
- **One test Sol's extension left red found a real flicker.** The sections were anchored on the bare
  once-a-second `now`, so a section read just after a tick had a `takenAt` in the future and withheld
  its numbers. They now share the card's `Math.max(now, receivedAt)` anchor.
- **A short read-only re-review was run for the verdict the kill swallowed** —
  [260910c-code-rereview-sol.md](260910c-code-rereview-sol.md), a genuine spawn (its activity log
  opens with the Codex session header). **No P0, three P1s, no lesser findings.** Two were fixed,
  red first, in `tests/account-usage-reading-integrity.test.ts`, which drives each case through all
  three boundaries with a positive control beside it: a reset-credit count that is not a
  non-negative whole number, and duplicate windows or buckets inside one section.
- **The third is left as it is, and put to Greg as a product call.** A section older than 20
  minutes still shows its numbers, with its age in red — the rule the existing card has always
  followed (*"it never suppresses anything; past this it is printed loudly"*). Sol's case against
  it is real: usage only rises within a window, so a stale number errs towards looking like more
  room, which is the dangerous direction for a page used to decide whether to start more work.
  Changing it here would diverge the sections from the card beside them, so it should change in
  both places or neither.
- Gates: `npm test` and `npm run typecheck`, and GPT Sol on the plan before building and on the code
  after.
