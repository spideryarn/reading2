# 260930k — High-powered AI for readers, and AI cost for the admin only

Follow-up to feedback **SPIDERYARN-READING2-6C** (the admin half shipped as
[260930f](260930f-high-powered-ai-per-article.md); this builds its § Deferred), plus one rule from
**SPIDERYARN-READING2-68** ([260930f-article-cost-on-the-metadata-page.md](260930f-article-cost-on-the-metadata-page.md)).
The note is [260930_0230-high-powered-ai-per-article.md](../user-feedback/260930_0230-high-powered-ai-per-article.md).

Greg's answers, relayed by the Overseer on 2026-09-30 (~23:00):

> it should double the processing cost per-article - that's how I'd think about it.

> approved changes to Privacy (though keep it a bit general, e.g. "Opus or similar frontier model")

> the most important thing is that that cost information should only be available to me (i.e.
> admin users). i don't want any regular users to know how much AI processing of their articles
> costs

— Greg, 2026-09-30

Three pieces of work:

1. **Readers can switch High-powered AI on**, and doing so doubles what the article counts against
   their allowance.
2. **/privacy names the model generally** — "Opus or similar frontier model" — and the test that
   every model the app can send to is covered still holds.
3. **No AI cost figure reaches a non-admin**, checked everywhere, with a test that fails if one does.

Billing and the public DTO are listed defences ([security-map.md](../project/security-map.md)).
Greg approved this change. § *Defences touched* at the end lists exactly which ones changed.

## 1. What "double" means, read against billing today

Billing counts in **half-units** ([billing.md § A public article counts half](../project/billing.md)).
One successful ingest is one charged row in `ingest_events`. It costs **2** while its article is
private and **1** while it is public. That price is recomputed from `articles.visibility` every time
usage is asked, and frozen when the article is deleted.

**High-powered AI adds one more charged row for the article, priced exactly like an ingest of it.**
So the article costs twice what it did:

| | ingest | + High-powered AI | total | in articles |
|---|---|---|---|---|
| private article | 2 | 2 | **4 half-units** | **2** |
| public article | 1 | 1 | **2 half-units** | **1** |
| shared later, or unshared later | follows visibility | follows visibility, the same way | | |

This is Greg's "0.5 × 2" for a public article, and it comes from the existing rule rather than a new
one.

**Switching on after the article was already processed** is the only way to switch on in v1 (see
decision 5). The charge is taken **at the moment of switching on**, in the billing period it happens
in, and it does not depend on when the article was added. So a three-month-old private article
switched on this month costs one article of this month's allowance. The ingest row, charged three
months ago, is not touched.

**Switching off refunds nothing, and switching on again charges nothing.** The charge is one row per
article, for ever. The Opus calls were already spent, and "switch on, run everything on Opus, switch
off" gets nothing back. This closes the loophole named in 260930f § Deferred item 1. It is enforced
twice: the handler checks under the billing lock, and a unique partial index
(`ingest_events (article_id) where kind = 'high_power'`) refuses a second row.

**What "double" does not reach, stated rather than hidden:**

- **An article with no charged ingest** still pays one article's worth. This covers an article added
  before billing launched, one charged before `ingest_events.article_id` existed, and one the admin
  added. The upgrade is "one more article's processing charge", which equals "double" for every
  article a reader adds today.
- **A re-added URL** (N ingest rows for one article, [billing.md](../project/billing.md)) gets one
  upgrade row, not N. Doubling is per article, as Greg said, not per ingest.
- **Re-runs stay free**, as they are for every article. On a high-powered article each re-run costs
  us about twice as much. That is fine at beta volumes, and it is the point of the feature: switch
  on, then re-run.

**Room needed to switch on.** Private: 2 half-units (one whole article). Public: 1 half-unit. The
check is **`used + cost <= budget`, strict**. It is not the ingest wall's `used < budget`, which
allows one half-unit of overdraft on purpose (billing.md § *The wall admits a half-unit of
overdraft*). That overdraft exists so Greg's "six public articles on a free account" is true. An
upgrade is a second charge for something already had, so it gets no overdraft. Example: a free reader
has three private articles (6 of 6 half-units) and cannot switch one on. With two private articles
(4 of 6), they can.

**The admin is exempt, as with ingests.** No row is written and the switch just flips.
`isAdmin(currentOwnerId())` is the same test `admitIngest` uses.

## Decisions, each with the simpler option passed over

1. **The upgrade is an `ingest_events` row with a new `kind` column**: `'ingest'` (default, every
   existing row) or `'high_power'`. It is inserted already settled (`reserved_at = succeeded_at =
   now()`) with `article_id` set.

   *Passed over: a separate `high_power_charges` table.* 260930f warned against reusing
   `ingest_events` "without changing the contracts around it". Looking at those contracts, an upgrade
   row satisfies each one unchanged, and a second table would need its own copy of all four:

   - **Usage and display** count charged rows as article-worths. `ingestsUsed` then reports "3 of
     20 used" for one ingest plus one upgrade, which is what the copy promises ("counts as two
     articles").
   - **The public half-price** and **the price freeze on delete** (the `BEFORE DELETE` trigger)
     work by `article_id` and apply to the upgrade row for free.
   - **The share-to-make-room offer** groups charged rows by article. Sharing a high-powered private
     article frees two half-units, and the offer counts that correctly.
   - **Settlement** acts by reservation id, which only a job carries. An upgrade row is never in
     flight, is never named by a job, and no settlement site can reach it.

   A second table would mean a `union` in `usageSql`, in `articlesToShare`, in pg-admin's split and
   in the delete trigger — four places to keep in step. The `kind` column is what separates the two
   kinds where it matters: the one-per-article index, and the admin page's labels.

2. **Charge, switch and lock in one transaction, in the house lock order.** The order is:
   `lockBillingAccount` → entitlement from the locked row → lock the article (`ownedSlug`,
   `for update`) → read its visibility and whether an upgrade row exists → usage → admit or refuse
   → insert the row → set `high_power_since`. This is billing before articles, as in
   `pg-visibility.ts`. So an unshare cannot land between the price read and the charge, and two
   concurrent switch-ons serialise on the billing row. The second sees the first's row and charges
   nothing. The unique index backs this up.

   Before the transaction, an unlocked `ownedSlug` probe (as `pg-visibility.ts` does), so a stranger's
   slug is a 404 without minting a billing anchor row.

   **Switching off takes no billing lock.** It writes one column, charges nothing and refunds nothing.

3. **A stale entitlement resyncs once, then 503**, exactly as `admitIngest` does. The resync
   helper there is generalised to take the retry as an argument rather than copied.

4. **One route for everyone: `PUT /api/article/:slug/high-power` `{ on: boolean }`**, beside
   `PUT /api/article/:slug/visibility`. The admin route `PUT /api/admin/article/:slug/high-power` is
   removed rather than kept as a second writer.

   Answers:
   - **200** `{ highPowerSince }`
   - **402** with the quota message when there is no room
   - **404** for a slug that is not the caller's
   - **400** for a bad body (the existing strict `parseHighPowerRequest`)
   - **503** for an unconfirmable plan

   *Passed over: keeping the admin route and adding a reader route.* That means two writers of one
   column, and only one of them charges.

5. **Switch-on happens on `/metadata` only, not at import.** An import-time flag needs a second
   reservation that has to ride the job and be settled at seven sites (billing.md § *A job ends at
   seven sites*), or it needs an article row that does not exist yet at admission. In v1 the reader
   switches on, then re-runs from the same section: the mode rows, or the whole-article reset. Both
   are free and already there.

   The cost of this choice: the first pass of an article is always Sonnet, and a reader who wants
   Opus throughout presses one more button. **Named for Greg**: the import-time flag is the natural
   next step, and it needs its own plan.

6. **`articlePower` drops the admin condition**: high exactly when `high_power_since` is set. The
   only writer is decision 4's route, and for a non-admin it cannot set the column without writing
   the charge row in the same transaction. The admin condition was there "so a row copied, restored or
   hand-edited onto a reader's article cannot quietly double what we spend" before billing existed
   (260930f decision 4). Nothing copies the column (checked in 260930f stage 2).

   The remaining risk is a hand-edit on production, which spends our money, not the reader's.
   *Passed over: also requiring an upgrade row to exist.* That is a join on every step start and on
   `loadArticle` (the hot path), to guard against somebody with production write access.

7. **The switch is shown to every owner on their own article.** `/metadata` is owner-only already
   (`PublicMetadataPage` replaces it for visitors). The switch's text no longer mentions token prices,
   which are an AI-cost fact (part 3).

   Reader copy:

   > **High-powered AI** — Uses a stronger AI model (Claude Opus) for this article: better on
   > difficult pieces. Switching it on counts as one more article against your allowance (half of
   > one while the article is shared publicly). Switching off doesn't give it back, and switching on
   > again is free. Only later runs use it — nothing re-runs by itself. Use a mode's *Run it again*
   > below to redo it.

   The admin sees the same text plus "Administrator: no charge."

   A refusal (402) shows the server's message beside the box, which stays off.

   *Passed over: a pre-check that disables the box when there is no room.* It needs an eligibility
   read on page load. The 402 says the same thing one click later.

8. **/pricing gets one answer, and /features one entry**, adjusted from 260930f's drafts.

   /pricing, a new `Answer`:

   > **What is High-powered AI?** For a difficult piece, you can switch one article to a stronger AI
   > model from its Metadata page. That doubles what the article counts against your allowance — one
   > more article, or half of one if the article is shared publicly. Switching it off doesn't give it
   > back, and switching it on again costs nothing more.

   /features, an entry:

   > **High-powered AI** — Claude Opus instead of Sonnet for one article, when the reading is hard.
   > It counts double against your allowance.

   Neither mentions money spent on AI (part 3). Both state the price in articles.

## 2. /privacy

The sentence becomes "…and Opus or a similar frontier model in its place on an article switched to
High-powered AI…". Greg's words, with the article the sentence needs.

`tests/privacy-page.test.ts` requires every `DISPLAY_NAME` value to appear on the page. It gains an
explicit, short table of **approved general wordings**: `{"claude-opus-5-5": "Opus or a similar
frontier model"}`. A model is covered if either its exact name or its approved wording appears.
So the test still fails when a new model is added with neither, and it fails if the general wording
is edited away. Red first: change the page, watch the test go red, then add the table.

## 3. AI cost reaches the admin only

**The rule:** a reader may be told what something costs *them*, in articles or in their subscription's
price. They are never told what an AI call costs *us*. That covers both a ledger figure and a
hand-written estimate like "about $0.20".

**Audit, 2026-09-30** (a Sonnet subagent, read-only, then checked by hand):

| Where | What | Verdict |
|---|---|---|
| `GET /api/admin/articles/:slug/cost` → `ArticleCostBody` on `/metadata` | the per-article ledger (report 68) | **safe**: `/api/admin` namespace gate on the server, `isAdmin` courtesy in the client, owner-scoped |
| `GET /api/admin/users` → spend column | per-account spend | **safe**: admin namespace |
| `GET /api/metadata/:slug` (`ArticleMetadata`) | — | **safe**: no cost field is computed or sent, for anyone |
| public article DTO (`src/web/article/access.ts`, `src/projection.ts`) | — | **safe**: no cost field; `highPowerSince` is nulled for a visitor |
| export bundle (`src/store/export-bundle.ts`) | — | **safe**: omits `ai_calls`. Its README line saying spend "isn't reliably attributable to a single article" went stale with report 68. Reworded to say it is kept out of exports |
| job DTOs, progress, stream `done` frames, `/api/models`, `/api/live/:id/usage` | — | **safe**: `spendFields` reaches server log lines only; `search`'s token `usage` is consumed server-side |
| `/api/billing/usage`, `/profile`, `/pricing`, `PlanCards` | subscription prices, article counts | **safe**: those are the reader's own costs |
| **`SKETCH_PRICE = "about $0.20"`** (`src/web/sketch-cost.ts`), drawn in `SketchView`, `IllustratedView`, and `/metadata`'s re-run note | an AI-cost estimate | **leak**, to every owner, and the Sketch panel is in the reader view |
| **`ILLUSTRATED_PRICE = "$0.40–$0.65"`** (`IllustratedView`, `DiagramPanel`'s mode description) | an AI-cost estimate | **leak** |
| **`/metadata`'s debate re-run note** "Up to two calls: $0.20–0.40…" | an AI-cost estimate | **leak** |
| **`ResetArticle`**: "Sketch costs about $0.20." | an AI-cost estimate | **leak** |

**The fix:** the dollar figures go from every reader-visible string. What stays says what the reader
actually waits for and what it is: "one model call", "about two minutes", "a brief plus one image
call per plate". The admin already has the real figure, measured, in *What it cost*.

*Passed over: keeping the dollar figures for the admin only.* That means a second variant of five
strings, for someone who can read the ledger.

**The guards, both red first:**

- `tests/no-ai-cost-for-readers.test.ts` walks the JSON of every non-admin response the suite can
  cheaply produce. It fails on any key matching `cost|spend|nanos|usd|price` at any depth. The
  responses are:
  - `GET /api/metadata/:slug` as the owner;
  - the public article payload as a visitor;
  - `GET /api/billing/usage`, where `price` is allowed only as the subscription's own field if one
    exists;
  - the job list;
  - the export bundle's files.

  It also runs the admin cost route as a *control*, which **must** match, so a walker that matches
  nothing cannot pass.
- The same file scans `src/web/**` and `src/messages.ts` for a `$<digit>` or `£<digit>` literal
  outside comments. It allows `PlanCards.tsx` (subscription prices), and `ArticleCost.tsx` and
  `admin-columns.tsx` (admin only). A new "about $0.20" in reader copy fails.

## What the plan review changed

GPT Sol reviewed the plan on 2026-09-30 and said **build with changes**. There was no P0. Each
finding was checked against the code before it was taken. Review:
[260930k-high-power-for-readers-plan-review-sol.md](260930k-high-power-for-readers-plan-review-sol.md).

1. **P1: reporting must know which kind of row it is counting.** The wall is right to add both
   kinds together. But `/profile` says "N articles added", and "2 of them are public". It counts
   `sharedHalfPrice` as public *rows*, so one public high-powered article would read as two public
   articles. `/admin/users` says "ingests".

   So `Usage` is split by kind. It gains `highPowerFullPrice` and `highPowerHalfPrice`, and the
   existing two counts become ingest-only. `halfUnitsUsed` adds all four, so the wall does not
   change. `ingestsUsed`, the plan's `used` and `sharedHalfPrice` stay counts of *ingests*, which is
   what their prose says. `ReaderPlan`'s free and paid arms gain `highPower`, the number of upgrades
   counted in the window.

   While `highPower > 0`, the copy stops printing a ratio. It says the upgrades as a separate fact,
   "K of them use High-powered AI, which counts as one more article each", and it does not attempt
   the "that is how they fit" arithmetic.

   `/admin/users` counts ingests by kind and shows the upgrades beside them. Its half-unit enforcement
   pair includes both kinds.

   The export rationale and the schema comment on `ingest_events` now say "one row per charge: an
   ingest, or one article's High-powered AI".
2. **P2: a high-power refusal carries no share offer.** `articlesToShare` answers the ingest wall
   (`used - freed < budget`), which is not the same question as `used + cost <= budget`. It could
   tell someone to publish an article, and then the switch still fails. So the refusal is its own
   402, `highPowerNoRoom`. It says the switch-on counts as N articles, that the allowance does not
   have that much left, and that reading is never limited.
3. **P1: the audit missed `/changelog`.** `src/web/changelog-versions.ndjson` tells every visitor
   Illustrated's dollar cost. The historical entry is reworded, and the source scan covers `.ndjson`.

   These were also checked and recorded as clean:
   - `/features`;
   - emails (only operational ones, and those go to the admin);
   - route-local error bodies;
   - server logs (not shown to readers);
   - the fleet (a separate operator process).
4. **P1: the guard must read values as well as keys.** A walker over keys alone passes
   `{"message": "about $0.20"}`. So the response walker inspects both keys and string values, for:
   - symbols;
   - currency codes (`USD 0.20`);
   - cents and pence;
   - currency words.

   The response walker and the source scanner each get their own synthetic positive control. The
   response test is described as a **targeted DTO audit**, not "every response". The existing
   admin-route 403 test stays as the authorisation half.
5. **P1: the privacy inventory was already missing a model.** `IMAGE_MODEL`
   (`google/gemini-3.1-flash-image`, `src/illustrated.ts`) is sent to OpenRouter and is not in
   `DISPLAY_NAME`, so neither test checked it. It goes into `DISPLAY_NAME`, and /privacy names it.
6. **P2: the database enforces the shape of an upgrade row.** A check requires a `high_power` row to
   have all of:
   - `succeeded_at` set;
   - `released_at` null;
   - `reserved_at = succeeded_at`;
   - a live `article_id` or a frozen price.

   Both timestamps come from one SQL `now()`.
7. **P2: the regression that motivated a charge event gets a test.** The ingest is before the current
   Stripe period and the upgrade is inside it: only the upgrade counts this month. Also a half-open
   boundary case.

Also from the review: `articlePower` loses its `ownerId` parameter, so every caller visibly takes
the new rule. The Stripe resync happens after the transaction commits, followed by one full retry.

## Stages

- **Stage A: billing and the route.**
  - Migration (the `kind` column, its check, and the unique partial index).
  - `chargeHighPower` in `pg-billing.ts`, `admitHighPower` in `admission.ts`, the new route, removal
    of the admin route, `articlePower`.
  - Tests against a real database. Red first where a test can be red:
    - private costs 2 and public costs 1;
    - strict room;
    - off then on charges once;
    - concurrent switch-ons charge once;
    - a public high-powered article unshared costs 4;
    - a deleted one keeps its frozen price;
    - admin charges nothing;
    - another owner's slug is a 404 with no anchor row;
    - usage and the share offer count the row.
- **Stage B: the switch, /pricing, /features, /privacy, docs.**
- **Stage C: the cost audit's fixes**, red first, and the guard test.

A GPT Sol review of this plan before building (`--sandbox review`), and of the code before pushing
(`--sandbox workspace-write`), with a second round if the first finds a P0 or P1.

## Defences touched

Greg approved this change. These are the listed defences it edits
([security-map.md](../project/security-map.md)), narrowly, and why.

- **Billing: the ingest quota ledger** (`ingest_events`, `src/store/pg-billing.ts`,
  `src/billing/admission.ts`).
  - **The change:** a `kind` column; the shape check and the one-per-article index; `Usage` split by
    kind; one new locked transaction (`switchOnHighPower`) and its admission wrapper.
  - **Why:** it is the charge Greg asked for.
  - **What did not change:**
    - `reserveIngest`, settlement at the seven sites, `releaseReservation(s)`, and the ingest
      wall's `used < budget` rule. An upgrade row can reach none of them: it is never in flight and
      never named by a job.
    - The lock order. It is taken, not altered.
    - `halfUnitsUsed` is the same sum with two more terms, so every existing account's usage is
      unchanged until it has an upgrade.
- **Who may make us spend Opus** (`articlePower`, `src/models.ts`).
  - **The change:** the administrator condition is dropped.
  - **Why:** it stood in for "nobody has paid for this" while nothing could charge. The one route
    that sets the column for a reader now charges in the same transaction.
- **The admin namespace.** The high-power route **left** `/api/admin`, so the namespace gate no
  longer covers it. It now has the owner scoping every article sub-resource has (`ownedSlug`, a 404
  for a stranger's slug, no anchor row minted), plus billing. `/api/admin/articles/:slug/cost` is
  untouched and stays behind the gate.
- **The public DTO** (`src/web/article/access.ts`, `src/projection.ts`) was audited and **not
  changed**. It carries no cost field, and it already nulls `highPowerSince` for a visitor. The new
  type-level check in `tests/no-ai-cost-for-readers.test.ts` now holds it to that.
- **Export** (`src/store/export-bundle.ts`, `src/store/article-rows.ts`). Only wording changed: the
  README line and the ledger's exclusion rationale. Nothing new is exported.

## Code review

GPT Sol reviewed commit `3b515253` on 2026-10-01 (workspace-write,
[260930k-high-power-for-readers-code-review-sol.md](260930k-high-power-for-readers-code-review-sol.md)).
There were no P0 or P1 findings, so no second round was needed. Sol fixed seven P2s and three P3s
itself, each checked by hand afterwards:

- **The period boundary.** Entitlement was read from the JavaScript clock while the charge used
  Postgres's `now()`. After waiting for the lock, the two could fall either side of a Stripe
  period's start. Now one post-lock `statement_timestamp()` decides both.
- **An uncharged switch-on was still an exported capability** (`HighPowerStore.set(slug, true)`).
  It is split into `switchOff` and `switchOnForAdmin`, which checks for the administrator itself.
- **The race test proved less than it claimed.** Two switch-ons on one article would pass even with
  a broken account lock. There is now also a race between two articles for the last slot.
- **The cost guard** now covers:
  - the browser's whole import closure, not only `src/web`;
  - the export prose;
  - exact allow-listed occurrences, where it used to allow a whole file;
  - more currency spellings.
- **/profile** tied an upgrade to "N articles this month". An old article upgraded this month read
  "0 articles this month. One of them…". The upgrade is now its own sentence.
- **The admin cell for a stale period** ignored the half-unit split. Fixed.
- **Marketing's "doubles" was false for grandfathered articles.** They have no ingest row, so the
  upgrade is their only charge. /pricing and /features now say "one more article".
- `no-store` is now set before the body is parsed, so a 400 carries it too.
- A missing space on /privacy, and stale comments.

**One of those fixes was broken, and the tests caught it.** Sol's sandbox could not reach Postgres,
so it never ran the database tests. Run here, 17 went red: the raw driver returns `timestamptz` as
text, and the fix called `toISOString` on a string. It is now parsed, and refused if it is not a
time. 53 of 53 pass.
