# Review: the `/profile` billing surface, the quota refusal's upgrade path, and the admin columns

You are reviewing built code, not a plan. Weight this higher than a plan review: a plan-stage
reviewer cannot find a route that writes one field and then rejects the request.

## Context

Spideryarn is an AI-assisted reading app. Stripe billing was built over the previous two days:
tiers are **database rows** (`billing_tiers`, `billing_tier_prices`), a quota holds a free account
to **3 lifetime ingests** and a paid one to its tier's monthly allowance, and there are
checkout/portal/confirm routes. All of that already existed and is **not** what you are reviewing.

**What is new, and what you are reviewing**, is everything a reader can see:

1. `GET /api/billing/usage` — `src/billing/summary.ts`, wire shape in the pure `src/billing-plan.ts`.
2. `/profile`'s Plan section — `src/web/BillingSection.tsx` over `src/web/useBilling.ts`.
3. The at-quota refusal surfacing an upgrade path — `src/web/QuotaNotice.tsx`, wired into
   `AddArticle.tsx`, `AddPage.tsx` and `UploadPicker.tsx`; `isQuotaRefusal`/`QUOTA_CODES` in
   `src/messages.ts`.
4. Two `/admin/users` columns — `AdminUser` fields in `src/admin.ts`, `planFacts` and the `ingests`
   aggregate in `src/store/pg-admin.ts`, the cells in `src/web/admin-columns.tsx`.
5. Supporting store reads: `hasLapsed`, `accountSnapshot`, `allAccountSnapshots` in
   `src/store/pg-billing.ts`.

## Product rules that are settled, and must not be relitigated

- **Free = 3 ingests, lifetime** (not per month). The lifetime count **includes paid months**, so a
  reader who took 40 articles on a paid plan and cancelled is permanently past the free allowance.
  That is intended (Greg, 2026-09-03).
- **But it must never render as "40 of 3 used"**, which reads as a bug rather than a policy. The
  design answer: `lapsed` is its own arm of `ReaderPlan` with **no `used` field**, so the shape is
  not on the wire.
- **Reading is never gated.** Only adding new articles is.
- **The administrator is quota-exempt** via `isAdmin` (two hardcoded uuids).
- **Hosted Stripe Checkout and Portal only.** We never touch card data; there is no billing UI to
  build beyond two redirect buttons.
- A **price id from the browser is refused rather than ignored**; only a tier id is accepted.
- Quota is a **Postgres-only** feature; under the filesystem store everything is inert.

## What I most want you to look for

1. **Anything that could show a reader a number that is wrong or misleading** — especially the
   lapsed case, the stale-period case, the admin case, and the paid-period boundary.
2. **Any way the page and the wall could disagree.** The wall (`reserveIngest` in
   `src/store/pg-billing.ts`) decides admission under a row lock; the page reads the same columns
   without one. Is `readBillingSummary` asking the same question? Is `planFacts` in `pg-admin.ts`?
3. **The client's failure handling.** A browser check found one real bug already, now fixed:
   `AddPage.tsx` rendered `queue.error`, which is engine state cleared by the very next poll the
   failed POST itself provokes — so the 402 refusal (and the link to `/profile` that the whole
   change is for) vanished before anybody could read it. It now snapshots `queue.lastFailure()`.
   **Are there other reads of racy state, or other paths where a refusal is lost?**
4. **Comments that claim more than the code does.** An earlier review of this feature found eleven.
   Please name any you find, with the line.
5. Anything security-relevant: what the browser may decide, what crosses the wire, what a reader
   could learn about another reader.

## Known and accepted, so please do not report as new

- Pressing *Upgrade* once creates a mapped Stripe customer even if the Checkout is abandoned, so
  *Manage billing* then appears and opens an empty Portal. That follows from the ordering guarantee
  (the mapping must be committed before a payable Session exists) and is documented.
- Two concurrent checkouts can produce two subscriptions; caught afterwards by an anomaly log.
- The `unknown` (stale period) case does not resync from Stripe; the wall does.

## Evidence

The scoped diff of `src/` and `tests/` follows, then the five new files in full. Tests: 19 in
`tests/billing-plan.test.ts` (pure), 17 in `tests/billing-usage-route.test.ts` (real Postgres,
verified running with `REQUIRE_POSTGRES=1`), 9 in `tests/billing-admin-plan.test.ts`, 4 in
`tests/quota-notice.test.tsx`, 3 added to `tests/refused-job-reason-survives.test.tsx`. Each
assertion was falsified by mutating the implementation and watching it go red.

`npm run typecheck` is clean over all 1,114 files.
--- diff ---

## The scoped diff

```diff
diff --git a/src/admin.ts b/src/admin.ts
index b8232d4a..d99b1e7e 100644
--- a/src/admin.ts
+++ b/src/admin.ts
@@ -231,9 +231,10 @@ export function describeAdminMiss(userId: string, email: string): string | undef
  *
  * **The only shape in this repo that describes somebody other than the reader
  * asking**, which is why it is worth reading before extending it. Everything on
- * it is a count or a date. Nothing on it names an article, a file, a URL or a
- * sentence: how many pieces somebody has is a fact about the account, and
- * *which* pieces they are is their reading.
+ * it is a count, a date, or — since the billing fields below — a plan the
+ * account is on. Nothing on it names an article, a file, a URL or a sentence:
+ * how many pieces somebody has is a fact about the account, and *which* pieces
+ * they are is their reading.
  * docs/project/admin.md § What it deliberately does not show.
  *
  * ## Why it is here rather than in src/types.ts
@@ -318,6 +319,53 @@ export interface AdminUser {
   spendUnpricedCalls: number;
   /** `YYYY-MM`, UTC — the period the three numbers above cover, never implied. */
   spendMonth: string;
+
+  /* ------------------------------------------------------------ billing ---
+   *
+   * **What this account is entitled to, and how much of it is gone.** The plan
+   * said this would be "one field on `AdminUser`, one column, one per-owner
+   * statement in `pg-admin.ts`"; it is four fields, and the extra three are
+   * each load-bearing rather than decoration:
+   *
+   * - `plan` alone cannot be rendered as a usage figure — "reader" says nothing
+   *   about whether they are near the ceiling, which is the operational
+   *   question this column is for.
+   * - `ingests` without `ingestLimit` is a number with no scale, and the limit
+   *   is a *row* in `billing_tiers` that somebody may raise at any time, so it
+   *   cannot be a constant in the browser.
+   * - `ingestWindow` because the two allowances are measured over different
+   *   spans — a paid one over the billing period, the free one over the
+   *   lifetime of the account — and a bare "3 of 20" that does not say which is
+   *   the same overclaim `spendMonth` exists to prevent one column along.
+   *
+   * **The administrator's own row is exempt from the quota**, and the *page*
+   * says so rather than the wire: the Ingests cell draws an em dash for an
+   * account `isAdmin` recognises, which is a question already answered in the
+   * browser on that same row (`AdminMarker` in src/web/admin-columns.tsx). A
+   * fifth field would be a second opinion about the same two uuids. The plan and
+   * status fields are filled in as usual, because an administrator may hold a
+   * real subscription and it is a fact about the account either way.
+   */
+
+  /** `"free"`, or the id of the tier this account is currently entitled to. */
+  plan: string;
+  /**
+   * The raw Stripe subscription status, when there is a subscription at all.
+   *
+   * Raw text rather than a derived word, for the reason `billing_accounts.status`
+   * is text: entitlement is decided by an allowlist, and a status Stripe adds
+   * next year should show itself on this page rather than be flattened into
+   * whichever of ours it least resembles. **A status that does not entitle sits
+   * beside `plan: "free"`** — which is the lapsed account, and is exactly what
+   * an administrator looking at a support email needs to see.
+   */
+  planStatus?: string;
+  /** Successful ingests over `ingestWindow`, plus reservations still in flight. */
+  ingests: number;
+  /** What that count is measured against — the tier's row, or the free three. */
+  ingestLimit: number;
+  /** Which span `ingests` covers. `period` is Stripe's, not a calendar month. */
+  ingestWindow: "period" | "lifetime";
 }
 
 /**
diff --git a/src/messages.ts b/src/messages.ts
index bf20ecb8..71bdf651 100644
--- a/src/messages.ts
+++ b/src/messages.ts
@@ -2301,6 +2301,42 @@ export function ingestQuotaReached(quota: {
  * plainly for both, because copy.md's whole point is that we do not know who is
  * reading.
  */
+/**
+ * The three codes `ingestQuotaReached` can end with — *the wall said no*.
+ *
+ * A list rather than a prefix test, and the difference is the point: `pay-off`,
+ * `pay-down` and `pay-none` are also `pay-` codes and none of them is a quota
+ * refusal. A deployment with no Stripe configured, a bad minute at Stripe, and
+ * a Portal press with nothing to manage are all things a reader can do nothing
+ * about by subscribing, and offering them an Upgrade link would be an offer
+ * that leads nowhere.
+ *
+ * Exported so that the surfaces which show an ingest failure can put the way
+ * forward beside the sentence — `QuotaNotice` in src/web/QuotaNotice.tsx is the
+ * one component that does it, for the add box, the add page and the upload
+ * picker alike.
+ */
+export const QUOTA_CODES: readonly string[] = ["pay-free", "pay-limit", "pay-lapsed"];
+
+/**
+ * **Is this failure the quota refusing an ingest?**
+ *
+ * Asked of the message, because that is all a client has: `readJson` throws the
+ * server's own sentence and the code is the last thing in it. Reading the code
+ * rather than matching the prose is the same rule `kindOfMessage` follows — the
+ * wording is free to be reworded, and a classifier built out of it silently
+ * reclassifies every stored message the day somebody improves a sentence.
+ *
+ * **Not the 402 status**, though that would also work today. A status is lost
+ * the moment a message is stored on a job row and read back, which is exactly
+ * where these are read from; the code survives the round trip.
+ */
+export function isQuotaRefusal(message: string | null | undefined): boolean {
+  if (!message) return false;
+  const code = codeOfMessage(message);
+  return code !== null && QUOTA_CODES.includes(code);
+}
+
 export const BILLING_NOT_AVAILABLE: ReaderFacingFailure = {
   kind: "ours",
   message:
diff --git a/src/routes.ts b/src/routes.ts
index 83f972b2..6d91eb59 100644
--- a/src/routes.ts
+++ b/src/routes.ts
@@ -84,6 +84,10 @@
  *   POST   /api/jobs/:id/cancel
  *   POST   /api/jobs/:id/retry   the same steps again, skipping what succeeded
  *   POST   /api/jobs/:id/advance run the next step this job has not done yet
+ *   GET    /api/billing/usage    which plan, how much of it is used, what may be bought
+ *   POST   /api/billing/checkout { tierId, currency? } → a hosted Checkout, or the Portal
+ *   POST   /api/billing/portal   → a hosted Customer Portal session
+ *   POST   /api/billing/confirm  { sessionId } → prove a finished Checkout is yours, then sync
  *
  * The job routes return immediately; the work happens on the queue in
  * src/jobs.ts. See docs/project/comments.md, docs/project/library.md and
@@ -274,6 +278,7 @@ import {
   parseCheckoutRequest,
   startCheckout,
 } from "./billing/checkout.js";
+import { readBillingSummary } from "./billing/summary.js";
 import {
   refuseUploadWithoutQuota,
   withIngestSlot,
@@ -6238,11 +6243,10 @@ export async function serveAuthenticatedApi(
   const jobAction = /^\/api\/jobs\/([\w.%-]+)\/(cancel|retry)$/.exec(path);
   const jobAdvance = /^\/api\/jobs\/([\w.%-]+)\/advance$/.exec(path);
   /**
-   * **The three billing routes, and every one of them is a POST behind the
-   * gate.** No slug and no id in any path: each is about the reader who is
-   * signed in, and the only route that takes an identifier at all takes a
-   * Checkout Session id in its *body*, where it is proved to be theirs before
-   * anything is done with it (src/billing/checkout.ts).
+   * **The four billing routes.** No slug and no id in any path: each is about
+   * the reader who is signed in, and the only one that takes an identifier at
+   * all takes a Checkout Session id in its *body*, where it is proved to be
+   * theirs before anything is done with it (src/billing/checkout.ts).
    *
    * They are exact paths, like the shelf's, so `/api/billing/anything` is a 404
    * rather than a quiet match — and none of them is a namespace, for the same
@@ -6250,16 +6254,18 @@ export async function serveAuthenticatedApi(
    * endpoint gets added without anybody re-reading the ordering rules that make
    * checkout safe.
    *
-   * **POST rather than GET, including the one that only reads.** Two of them
-   * create a Stripe object — a Checkout Session is a real, chargeable thing —
-   * and a GET is something a browser prefetches, a crawler follows and a cache
-   * may keep. `confirm` creates nothing; it is a POST because it *writes*, being
-   * the thing that syncs a subscription into `billing_accounts`.
+   * **Three POSTs and one GET, and the split is not about which of them writes.**
+   * `checkout`, `portal` and `confirm` each *create a Stripe object* — a
+   * Checkout Session is a real, chargeable thing — and a GET is something a
+   * browser prefetches, a crawler follows and a cache may keep. `usage` creates
+   * nothing, reads two of our own tables and never touches the network, so
+   * asking for it twice costs nothing and means nothing: that is a GET.
    * docs/project/billing.md.
    */
   const billingCheckout = path === "/api/billing/checkout";
   const billingPortalRoute = path === "/api/billing/portal";
   const billingConfirm = path === "/api/billing/confirm";
+  const billingUsage = path === "/api/billing/usage";
 
     /* **The second gate, and it guards a prefix rather than a route.**
        Everything under `/api/admin/` is refused to everybody but the one
@@ -7273,6 +7279,19 @@ export async function serveAuthenticatedApi(
       return;
     }
 
+    /**
+     * **What plan this reader is on, and what they have used.** The one billing
+     * route that is a read.
+     *
+     * It never reaches Stripe — see src/billing/summary.ts. A stored period that
+     * has run out comes back as *we cannot say*, rather than as a guess or as
+     * the 503 admission answers, because nothing is being decided here.
+     */
+    if (billingUsage && req.method === "GET") {
+      send(res, 200, await readBillingSummary(currentOwnerId()));
+      return;
+    }
+
     /**
      * Anything else under `/api/` is a 404 **from us**, not a fall-through.
      *
diff --git a/src/store/pg-admin.ts b/src/store/pg-admin.ts
index de44a76f..1cabb4ee 100644
--- a/src/store/pg-admin.ts
+++ b/src/store/pg-admin.ts
@@ -8,10 +8,10 @@
  * readers"*, which cannot be asked with an owner filter on it, so the rules it
  * obeys instead are:
  *
- * 1. **Counts and dates only.** No title, no URL, no filename, no sentence.
- *    How many articles somebody has is a fact about the account; which articles
- *    they are is their reading. docs/project/admin.md § What it deliberately
- *    does not show.
+ * 1. **Counts, dates, and what the account may do.** No title, no URL, no
+ *    filename, no sentence. How many articles somebody has is a fact about the
+ *    account, and so is which plan they are on; *which* articles they are is
+ *    their reading. docs/project/admin.md § What it deliberately does not show.
  * 2. **Reached from exactly one route**, `GET /api/admin/users`, behind the
  *    `/api/admin` namespace check in src/routes.ts. There is no other caller,
  *    and a second one should be a second look at whether it is allowed.
@@ -20,19 +20,26 @@
  *    that makes this safe is a route gate somewhere else, so the one thing a
  *    future call site can be given here is a name that argues with it.
  *
- * ## Five queries, not one, and not one per user
+ * ## One query per table, not one query and not one per user
  *
- * The counts live in five tables that share nothing but an article. A single
- * statement joining all five would multiply rows — somebody with 3 articles and
- * 4 questions would count 12 of each — and the usual repair, five correlated
- * sub-selects, is a statement nobody can read. A count per user per table is an
- * N+1 that grows with the sign-up list.
+ * The counts live in tables that share nothing but an article. A single
+ * statement joining them all would multiply rows — somebody with 3 articles and
+ * 4 questions would count 12 of each — and the usual repair, a correlated
+ * sub-select each, is a statement nobody can read. A count per user per table is
+ * an N+1 that grows with the sign-up list.
  *
  * So: **one grouped aggregate per table, run together, joined in TypeScript by
- * owner id.** Five statements whatever the number of accounts, each hitting an
- * index that already exists — and a sixth thing beside them that is not a
- * statement at all: the account listing, which comes from the Auth service over
- * HTTP (admin-accounts.ts).
+ * owner id.** A fixed number of statements whatever the number of accounts, each
+ * hitting an index that already exists — and beside them the account listing,
+ * which is not a statement at all but an HTTP call to the Auth service
+ * (admin-accounts.ts).
+ *
+ * **Seven aggregates and two plain reads as of 2026-09-03**, against a pool of
+ * five (src/db/client.ts): the five article-shaped ones, spend, the ingest
+ * ledger, every `billing_accounts` row, and the (cached) tier table. Still one
+ * round trip's worth of waiting rather than several, on a page one person opens
+ * a few times a day — but it is the point at which adding another stops being
+ * free. docs/project/admin.md § Where the numbers come from.
  *
  * The file is in three parts for one reason — so that each of them can be
  * checked by something: `mergeUsers` is pure and takes two owners' worth of
@@ -64,7 +71,20 @@ import { count, eq, sql } from "drizzle-orm";
 
 import type { Db } from "../db/client.js";
 import { getDb } from "../db/client.js";
-import { articles, chatThreads, comments, searchRuns, uploads } from "../db/schema.js";
+import {
+  articles,
+  billingAccounts,
+  chatThreads,
+  comments,
+  ingestEvents,
+  searchRuns,
+  uploads,
+} from "../db/schema.js";
+import { FREE_LIFETIME_INGESTS, tierForPrice } from "../billing/tiers.js";
+import type { TierRow } from "../billing/tiers.js";
+import { allAccountSnapshots, entitlementFromRow } from "./pg-billing.js";
+import type { AccountSnapshot } from "./pg-billing.js";
+import { allTiers } from "./pg-tiers.js";
 import type { AccountRow } from "./account-row.js";
 import { gotruePages, listAccounts } from "./admin-accounts.js";
 import {
@@ -103,6 +123,25 @@ export interface CountRow {
   n: number;
 }
 
+/**
+ * The three ingest numbers, per owner.
+ *
+ * **Both windows come back, and the merge picks one**, because which one is
+ * right depends on the entitlement and the entitlement is decided in TypeScript
+ * — `entitlementFromRow`, the same function the wall decides with. Asking SQL
+ * to work out which allowance somebody is on would be a second implementation
+ * of that rule, living in a string, disagreeing with the first one quietly.
+ */
+export interface IngestTally {
+  owner: string;
+  /** Successful ingests ever — what the free allowance is measured over. */
+  lifetime: number;
+  /** Successful ingests inside the row's stored billing period, if it has one. */
+  inPeriod: number;
+  /** Reservations taken and not settled. Counted as used, as the wall does. */
+  inFlight: number;
+}
+
 /** Everything the merge needs, named so the call site reads as a sentence. */
 export interface UserCounts {
   shelf: ShelfTally[];
@@ -110,6 +149,18 @@ export interface UserCounts {
   questions: CountRow[];
   chats: CountRow[];
   searches: CountRow[];
+  ingests: IngestTally[];
+  /**
+   * One `billing_accounts` row per owner that has one. Absent is the free tier.
+   *
+   * The only read in this file that is not a count, and the exemption is the
+   * header's: there is no owner to filter by. It comes from
+   * `allAccountSnapshots` in pg-billing.ts rather than from a query written
+   * here, so the columns entitlement is decided from are named once.
+   */
+  accounts: Map<string, AccountSnapshot>;
+  /** What we sell, so a tier's quota is read from its row and never guessed. */
+  tiers: readonly TierRow[];
   /**
    * **Money, and the only entry here that is not a count of the reader's own
    * things.** Keyed by owner id like the rest; absent means the account made no
@@ -130,6 +181,84 @@ function tally(rows: CountRow[]): Map<string, number> {
   return new Map(rows.map((r) => [r.owner, r.n]));
 }
 
+/** What one account is entitled to and how much of it is spent. */
+interface PlanFacts {
+  plan: string;
+  planStatus?: string;
+  ingests: number;
+  ingestLimit: number;
+  ingestWindow: "period" | "lifetime";
+}
+
+/**
+ * The billing three lines of one row.
+ *
+ * **`entitlementFromRow` decides, not this function** — it is the same call the
+ * wall makes under its lock (`reserveIngest`), so a row this page draws as
+ * *Reader, 4 of 20* is a row that would be admitted, and a row it draws as free
+ * is one that would be refused at three. Two opinions about entitlement, one of
+ * them on an administrator's screen while the other decides what a reader may
+ * do, is the disagreement this reuse exists to prevent.
+ *
+ * **A stale period is shown as the lifetime count**, and it is the one case
+ * worth explaining. `entitlementFromRow` answers `stale` when the row says
+ * subscribed and its stored period does not contain now — so there is no
+ * current period to count inside, and `inPeriod` would be a count over a window
+ * that has closed. The tier's limit is still the right scale, because that is
+ * what they are paying for, and the raw `status` sits beside it in its own
+ * column, which is the tell. `/profile` says *"we could not confirm your plan"*
+ * for the same row (src/billing-plan.ts); an administrator gets the numbers
+ * instead, because they are the person who would act on them.
+ *
+ * **Nothing here is excused for an administrator.** The exemption is `isAdmin`'s
+ * and the page draws it, for the reason `AdminUser` gives: those two uuids are
+ * already in the browser bundle and a second copy of the question is a second
+ * answer waiting to differ.
+ */
+function planFacts(
+  account: AccountSnapshot | undefined,
+  tiers: readonly TierRow[],
+  counts: IngestTally | undefined,
+  now: Date,
+): PlanFacts {
+  const status = account?.status ?? undefined;
+  const inFlight = counts?.inFlight ?? 0;
+  const lifetime = (counts?.lifetime ?? 0) + inFlight;
+  const inPeriod = (counts?.inPeriod ?? 0) + inFlight;
+
+  const entitlement = entitlementFromRow(account, tiers, now);
+
+  if ("kind" in entitlement) {
+    /* Stale — see the docstring. The price still names the tier, and a price no
+       tier sells falls to the free numbers, which is the same direction
+       `entitlementFromRow` fails in. */
+    const tier = tierForPrice(account?.priceId, tiers);
+    return {
+      plan: tier?.id ?? "free",
+      ...(status === undefined ? {} : { planStatus: status }),
+      ingests: lifetime,
+      ingestLimit: tier?.ingestsPerPeriod ?? FREE_LIFETIME_INGESTS,
+      ingestWindow: "lifetime",
+    };
+  }
+
+  return entitlement.tier === "paid"
+    ? {
+        plan: entitlement.tierId,
+        ...(status === undefined ? {} : { planStatus: status }),
+        ingests: inPeriod,
+        ingestLimit: entitlement.limit,
+        ingestWindow: "period",
+      }
+    : {
+        plan: "free",
+        ...(status === undefined ? {} : { planStatus: status }),
+        ingests: lifetime,
+        ingestLimit: entitlement.limit,
+        ingestWindow: "lifetime",
+      };
+}
+
 
 /** ISO, or nothing at all — the wire shape leaves a missing date out. */
 function iso(at: Date | null | undefined): string | undefined {
@@ -169,6 +298,11 @@ export function mergeUsers(people: AccountRow[], counts: UserCounts): AdminUser[
   const searches = tally(counts.searches);
   const shelf = new Map(counts.shelf.map((r) => [r.owner, r]));
   const spend = counts.spend;
+  const ingests = new Map(counts.ingests.map((r) => [r.owner, r]));
+  /* One clock for the whole merge, so two rows cannot be decided either side of
+     a period boundary — the same reason `spendMonth` is settled before any
+     query runs in `listUsersAcrossOwners`. */
+  const now = new Date();
 
   return people
     /* An account with no address cannot sign in here — the gate refuses it by
@@ -212,6 +346,7 @@ export function mergeUsers(people: AccountRow[], counts: UserCounts): AdminUser[
         spendCalls: spend.get(p.id)?.calls ?? 0,
         spendUnpricedCalls: spend.get(p.id)?.unpricedCalls ?? 0,
         spendMonth: counts.spendMonth,
+        ...planFacts(counts.accounts.get(p.id), counts.tiers, ingests.get(p.id), now),
       };
     });
 }
@@ -219,7 +354,7 @@ export function mergeUsers(people: AccountRow[], counts: UserCounts): AdminUser[
 /* ---------------------------------------------------------- the queries --- */
 
 /**
- * The five statements, as builders rather than as results.
+ * The statements, as builders rather than as results.
  *
  * Pulled out so that **what they mean** can be asserted without a database:
  * `tests/admin-queries.test.ts` reads `.toSQL()` off each one and pins the
@@ -307,6 +442,46 @@ export function adminQueries(db: Db) {
       .innerJoin(articles, eq(searchRuns.articleId, articles.id))
       .where(onTheShelf())
       .groupBy(articles.ownerId),
+
+    /* **The quota ledger, and it groups by its own `owner_id`** — unlike the
+       three above, which reach an owner through the article. There is nothing to
+       reach through: an `ingest_events` row is a slot, not a document, and it
+       exists before the article does and outlives one that is deleted. That is
+       the whole reason it is the abuse boundary rather than a count of articles
+       (docs/project/billing.md § *The quota*).
+
+       **Left join, not inner**, because most owners have no `billing_accounts`
+       row at all — a free reader never gets one until they check out or hit the
+       wall — and an inner join would silently report every free account as
+       having ingested nothing.
+
+       The period predicate is the same half-open `>= start and < end` that
+       `usageSql` counts by, so an ingest at the instant a period rolls over is
+       counted once here and once there, in the same period. `mapWith(Number)`
+       on every one, for the reason the shelf query gives: `count()` comes back
+       from the driver as a string. */
+    ingests: db
+      .select({
+        owner: ingestEvents.ownerId,
+        lifetime:
+          sql<number>`count(*) filter (where ${ingestEvents.succeededAt} is not null)`.mapWith(
+            Number,
+          ),
+        inPeriod: sql<number>`count(*) filter (
+            where ${ingestEvents.succeededAt} is not null
+              and ${billingAccounts.currentPeriodStart} is not null
+              and ${billingAccounts.currentPeriodEnd} is not null
+              and ${ingestEvents.succeededAt} >= ${billingAccounts.currentPeriodStart}
+              and ${ingestEvents.succeededAt} < ${billingAccounts.currentPeriodEnd})`.mapWith(
+          Number,
+        ),
+        inFlight: sql<number>`count(*) filter (
+            where ${ingestEvents.succeededAt} is null
+              and ${ingestEvents.releasedAt} is null)`.mapWith(Number),
+      })
+      .from(ingestEvents)
+      .leftJoin(billingAccounts, eq(billingAccounts.ownerId, ingestEvents.ownerId))
+      .groupBy(ingestEvents.ownerId),
   };
 }
 
@@ -358,20 +533,33 @@ export const pgAdminStore: AdminStore = {
        heading — a one-second-a-month bug that nothing would ever reproduce. */
     const month = currentUtcMonth();
 
-    const [people, shelf, uploaded, questions, chats, searches, spend] = await Promise.all([
-      listAccounts(accountSource()),
-      q.shelf,
-      q.uploads,
-      q.questions,
-      q.chats,
-      q.searches,
-      /* The sixth aggregate, and the pool is sized 5 (src/db/client.ts), so one
-         of the six now waits for a connection. Measured against the alternative
-         — a second round trip after the first five — that is still one wall
-         clock's worth of latency rather than two, and this is an admin page a
-         single person opens. */
-      productSpendByOwner(month.since, month.until),
-    ]);
+    const [people, shelf, uploaded, questions, chats, searches, spend, ingests, accounts, tiers] =
+      await Promise.all([
+        listAccounts(accountSource()),
+        q.shelf,
+        q.uploads,
+        q.questions,
+        q.chats,
+        q.searches,
+        /* The sixth aggregate, and the pool is sized 5 (src/db/client.ts), so one
+           of the six now waits for a connection. Measured against the alternative
+           — a second round trip after the first five — that is still one wall
+           clock's worth of latency rather than two, and this is an admin page a
+           single person opens. */
+        productSpendByOwner(month.since, month.until),
+        /* Three more since 2026-09-03, for the plan column, and the paragraph
+           above is now about nine things queueing five deep rather than six
+           queueing one. That is still one round trip's worth of waiting rather
+           than several, on a page one person opens a few times a day — but it is
+           the point at which "add another aggregate" stops being free, and the
+           next column should read `allTiers`'s cache or join something that is
+           already here rather than making it ten. */
+        q.ingests,
+        allAccountSnapshots(),
+        /* Cached for thirty seconds, so on a page being reloaded this is usually
+           not a query at all. */
+        allTiers(),
+      ]);
 
     return mergeUsers(people, {
       shelf,
@@ -381,6 +569,9 @@ export const pgAdminStore: AdminStore = {
       searches,
       spend,
       spendMonth: month.label,
+      ingests,
+      accounts,
+      tiers,
     });
   },
 
diff --git a/src/store/pg-billing.ts b/src/store/pg-billing.ts
index a470dd6b..2ed3fcc7 100644
--- a/src/store/pg-billing.ts
+++ b/src/store/pg-billing.ts
@@ -303,7 +303,7 @@ function refusalFor(
   const used = usage.used + usage.inFlight;
   if (used < entitlement.limit) return null;
   /* Read off the row rather than inferred from `used > limit`; see `lapsed`. */
-  const lapsed = Boolean(row?.stripeSubscriptionId) && !isEntitledStatus(row?.status ?? null);
+  const lapsed = hasLapsed(row);
   return {
     kind: "refused",
     used,
@@ -313,6 +313,24 @@ function refusalFor(
   };
 }
 
+/**
+ * **Has this account had a subscription and lost it?**
+ *
+ * A `stripe_subscription_id` beside a status the allowlist does not entitle —
+ * read off the row rather than inferred from `used > limit`, which is the same
+ * answer most of the time and a wrong one the day somebody lowers a tier's
+ * `ingests_per_period`.
+ *
+ * Exported so the wall and the page ask it the same way: `refusalFor` below
+ * chooses the `pay-lapsed` refusal with it, and `readBillingSummary`
+ * (src/billing/summary.ts) chooses `/profile`'s "your plan has ended" with it.
+ * Two spellings of this rule would be two answers to *is my plan over*, on the
+ * same screen a minute apart.
+ */
+export function hasLapsed(row: BillingRow | undefined): boolean {
+  return Boolean(row?.stripeSubscriptionId) && !isEntitledStatus(row?.status ?? null);
+}
+
 /** Room for another ingest, without taking any. See `ingestEligibility`. */
 export interface Eligible {
   readonly kind: "eligible";
@@ -348,6 +366,56 @@ export async function ingestEligibility(
   return refusalFor(entitlement, await usageFor(ownerId, entitlement), row) ?? { kind: "eligible" };
 }
 
+/**
+ * The billing row as a page needs it: the entitlement columns, plus the one
+ * fact entitlement does not care about.
+ *
+ * `cancelAtPeriodEnd` is not part of `BillingRow` because entitlement is not
+ * decided by it — a cancelled-at-period-end subscription is still `active` and
+ * still entitled until the period runs out. It matters to the *reader*, who is
+ * owed the difference between "starts again on the 3rd" and "runs out on the
+ * 3rd", so it travels beside the row rather than inside it.
+ */
+export interface AccountSnapshot extends BillingRow {
+  readonly cancelAtPeriodEnd: boolean;
+}
+
+/**
+ * Read one owner's billing row, creating nothing.
+ *
+ * For the surfaces that only *ask* — `/profile` and `/admin/users`. It takes no
+ * lock and inserts no anchor, on the same reasoning as `ingestEligibility`: a
+ * question should not write, and a missing row is the free tier exactly as it is
+ * under the lock.
+ */
+export async function accountSnapshot(ownerId: string): Promise<AccountSnapshot | undefined> {
+  const [row] = await getDb()
+    .select({ ...BILLING_COLUMNS, cancelAtPeriodEnd: billingAccounts.cancelAtPeriodEnd })
+    .from(billingAccounts)
+    .where(eq(billingAccounts.ownerId, ownerId))
+    .limit(1);
+  return row;
+}
+
+/**
+ * Every billing row there is — the one read here that is not owner-scoped.
+ *
+ * `/admin/users` needs one row per account and there is no owner to filter by,
+ * which is the same exemption `src/store/pg-admin.ts` documents at length for
+ * the five count queries. It is called from there and nowhere else; a second
+ * caller should be a second look at whether it is allowed.
+ */
+export async function allAccountSnapshots(): Promise<Map<string, AccountSnapshot>> {
+  const rows = await getDb()
+    .select({
+      ownerId: billingAccounts.ownerId,
+      ...BILLING_COLUMNS,
+      cancelAtPeriodEnd: billingAccounts.cancelAtPeriodEnd,
+    })
+    .from(billingAccounts);
+  return new Map(rows.map(({ ownerId, ...row }) => [ownerId, row]));
+}
+
 /**
  * Take a slot for a new ingest, or refuse.
  *
diff --git a/src/web/AddArticle.tsx b/src/web/AddArticle.tsx
index 8813622e..828b5413 100644
--- a/src/web/AddArticle.tsx
+++ b/src/web/AddArticle.tsx
@@ -38,6 +38,7 @@ import {
   KEEP_A_TAB_OPEN,
 } from "../job-state.js";
 import { ADDING_SENDS_TEXT_AWAY } from "../messages.js";
+import { QuotaNotice } from "./QuotaNotice.js";
 import { addHref, navigate } from "./router.js";
 import { UploadPicker } from "./UploadPicker.js";
 import { useNow } from "./useNow.js";
@@ -286,9 +287,15 @@ export function AddArticle({ queue }: { queue: UseJobs }) {
         {ADDING_SENDS_TEXT_AWAY}
       </p>
 
-      {queue.error && (
-        <p className="tw:mt-3 tw:mb-0 tw:text-xs tw:text-destructive">{queue.error}</p>
-      )}
+      {/* **The reason, and something to press.** A quota refusal gets a link to
+          `/profile` beside it — the sentence has been naming an Upgrade button
+          since the wall went up, and this is the first version of this box where
+          that button exists. Everything else renders as it always did.
+          QuotaNotice.tsx. */}
+      <QuotaNotice
+        message={queue.error}
+        className="tw:mt-3 tw:mb-0 tw:text-xs tw:text-destructive"
+      />
 
       {current.length > 0 && <JobList jobs={current} queue={queue} onHide={hide} />}
 
@@ -435,6 +442,33 @@ export function JobCard({
      about something that has already stopped — and the engine drops the count
      at the same moment, so this is belt and braces about a race of one poll. */
   const stalled = busy && driverStalled(queue.driverFailures, job.id);
+
+  /**
+   * **Why Retry was refused**, kept where the next poll cannot clear it.
+   *
+   * `POST /api/jobs/:id/retry` is a second front door for the quota — it goes
+   * straight to `retryJob` → `enqueue()` and reserves a fresh slot when the
+   * attempt it repeats spent one (docs/project/billing.md § *Which requests
+   * spend a slot*) — so a reader at their ceiling can be refused **here**, on a
+   * card, and not only on the add page.
+   *
+   * Snapshotted out of `queue.lastFailure()` right after the await rather than
+   * read off `queue.error` at render, because `error` is engine state that the
+   * action's own follow-up poll clears: the same race that hid this refusal on
+   * AddPage.tsx until the browser check on 2026-09-03, and on the thread page
+   * before that (`tests/refused-job-reason-survives.test.tsx`).
+   *
+   * Cleared when the button is pressed again, and by the job id changing —
+   * `JobList` keys on it, so a card that becomes a different job is a different
+   * component and starts with nothing.
+   */
+  const [refusal, setRefusal] = useState<string | null>(null);
+  const retry = async () => {
+    setRefusal(null);
+    await queue.retry(job.id);
+    setRefusal(queue.lastFailure());
+  };
+
   return (
     <div className="tw:rounded-md tw:border tw:border-border tw:bg-background tw:p-3">
       <div className="tw:mb-2 tw:flex tw:items-baseline tw:gap-2">
@@ -480,7 +514,7 @@ export function JobCard({
                 variant="ghost"
                 size="sm"
                 title="Run it again, skipping the stages that already worked"
-                onClick={() => void queue.retry(job.id)}
+                onClick={() => void retry()}
               >
                 <RotateCw size={13} /> Retry
               </Button>
@@ -532,6 +566,13 @@ export function JobCard({
       {stalled && (
         <p className="tw:mt-2 tw:mb-0 tw:text-xs tw:text-muted-foreground">{DRIVER_STALLED}</p>
       )}
+
+      {/* **Why Retry was refused, with a way out of it if the reason is the
+          quota.** On the card rather than in the box above, because it is about
+          this job: the shelf's own line is engine state shared with the poller,
+          and two cards refused for different reasons would both point at it.
+          See `refusal` above. */}
+      <QuotaNotice message={refusal} className="tw:mt-2 tw:mb-0 tw:text-xs tw:text-destructive" />
     </div>
   );
 }
diff --git a/src/web/AddPage.tsx b/src/web/AddPage.tsx
index f1244c8c..6886276e 100644
--- a/src/web/AddPage.tsx
+++ b/src/web/AddPage.tsx
@@ -52,8 +52,9 @@ import { Link } from "./Link.js";
 import { JobCard } from "./AddArticle.js";
 import { normaliseUrl, slugFromUrl } from "../ingest.js";
 import { KEEP_A_TAB_OPEN } from "../job-state.js";
-import { DIRECT_ADD_SENT_TEXT_AWAY } from "../messages.js";
+import { DIRECT_ADD_SENT_TEXT_AWAY, worthRetrying } from "../messages.js";
 import { pageTitle, useDocumentTitle } from "./page-title.js";
+import { QuotaNotice } from "./QuotaNotice.js";
 import { LIBRARY_HREF, navigate, readHref } from "./router.js";
 import type { Job } from "../types.js";
 import { useJobs } from "./useJobs.js";
@@ -118,7 +119,30 @@ export function AddPage({ source: origin }: { source: AddSource }) {
      the URL is the same one — so without something that changes, pressing Retry
      would do nothing at all. */
   const [attempt, setAttempt] = useState(0);
-  const [failed, setFailed] = useState(false);
+  /**
+   * Why the POST failed, kept where no poll can clear it.
+   *
+   * **It was a boolean and `queue.error` was rendered beside it, and that was
+   * the bug** — found in the browser on 2026-09-03, and it is the third time
+   * this repo has met the same one. `error` is *engine* state shared with the
+   * poller, and `act`'s own `finally` starts the poll that clears it (see
+   * `lastFailure` in useJobs.ts), so the server's reason for refusing was
+   * replaced by the generic *"It didn't get as far as the queue"* before anybody
+   * could read it. On a free account at its quota that meant the refusal — and
+   * the link to `/profile` that the whole `QuotaNotice` change is for — never
+   * appeared at all.
+   *
+   * `queue.lastFailure()` is the durable record and is snapshotted *here*, right
+   * after the await, exactly as `useStepJob` does after the same discovery on
+   * the thread page (`tests/refused-job-reason-survives.test.tsx`). Reading it
+   * at render would be reading a ref, which is the same race one layer along.
+   *
+   * `null` is "the POST has not failed"; a string is the reason; `""` is a
+   * failure with nothing said about it, which is why this is not just
+   * `string | null` used as a boolean.
+   */
+  const [failure, setFailure] = useState<{ reason: string | null } | null>(null);
+  const failed = failure !== null;
 
   // Through a ref, the same way `useJobs` holds `onFinished`. `queue.add` is a
   // fresh closure on every poll, so depending on it directly would re-run this
@@ -129,6 +153,10 @@ export function AddPage({ source: origin }: { source: AddSource }) {
   addRef.current = queue.add;
   const uploadRef = useRef(queue.addUpload);
   uploadRef.current = queue.addUpload;
+  /* Through a ref for the same reason the two above are: the effect must not
+     re-run when the hook hands back a fresh closure on every poll. */
+  const failureRef = useRef(queue.lastFailure);
+  failureRef.current = queue.lastFailure;
 
   useEffect(() => {
     /* Cleared rather than simply skipped. Going from a URL we would add to one
@@ -137,14 +165,14 @@ export function AddPage({ source: origin }: { source: AddSource }) {
        still able to navigate away when it finished. */
     if (!ok) {
       setStarted(null);
-      setFailed(false);
+      setFailure(null);
       return;
     }
     const want = `${attempt}\u0000${wanted}`;
     if (posted.current === want) return;
     posted.current = want;
     setStarted(null);
-    setFailed(false);
+    setFailure(null);
     /* On `uploadId` rather than on `origin.kind`, so the effect reads only
        plain strings it also depends on — and so the union narrows, which
        `origin.kind === "upload"` does not do for a field read inside a
@@ -158,12 +186,14 @@ export function AddPage({ source: origin }: { source: AddSource }) {
          on screen and then navigate to it. The ref is the current request's
          name, so comparing against it is the check. GPT Sol, 2026-08-26.
 
-         `null` means the POST itself failed, and `useJobs` has put the reason
-         in `queue.error`. Without that branch the page sat on "Queueing it…"
-         for ever, with the error above it and no way to try again. */
+         `null` means the POST itself failed. Without that branch the page sat
+         on "Queueing it…" for ever, with no way to try again. */
       if (posted.current !== want) return;
       if (!queued) {
-        setFailed(true);
+        /* **The reason is taken here and kept**, out of the durable
+           `lastFailure` rather than the shared `error` — see `failure` above for
+           the race, and `useStepJob` for the same fix on the thread page. */
+        setFailure({ reason: failureRef.current() });
         return;
       }
       /* **Nothing was queued, because there was nothing left to queue.** A
@@ -255,9 +285,22 @@ export function AddPage({ source: origin }: { source: AddSource }) {
         </p>
       )}
 
-      {queue.error && (
-        <p className="tw:mb-4 tw:text-sm tw:text-destructive">{queue.error}</p>
-      )}
+      {/* **This is where a 402 lands for a pasted URL.** The shelf's Add button
+          navigates here and the effect above posts, so the quota's refusal is
+          read on this page rather than on the shelf — which is why the link to
+          `/profile` has to be here too, and not only in the add box.
+          QuotaNotice.tsx.
+
+          `failure.reason` first and `queue.error` behind it: the first is the
+          durable record of *this* POST's refusal and the second is whatever the
+          engine is unhappy about right now, which is the right thing to show
+          when nothing was refused (a poll that cannot reach the server). Taking
+          them the other way round is the bug this pair was written to fix —
+          see `failure` above. */}
+      <QuotaNotice
+        message={failure?.reason ?? queue.error}
+        className="tw:mb-4 tw:text-sm tw:text-destructive"
+      />
 
       {/* From the first render until the poll brings the job back — the POST
           and one poll, usually a fraction of a second. Deliberately *not*
@@ -268,7 +311,17 @@ export function AddPage({ source: origin }: { source: AddSource }) {
         <p className="tw:text-sm tw:text-muted-foreground">Queueing it…</p>
       )}
 
-      {failed && (
+      {/* **Only when another go could come out differently.** `worthRetrying`
+          is the one place that decides, and it says no to a `blocked` message —
+          which every quota refusal is, because the count will be the same next
+          time. A *Try again* under a sentence that has just said trying again
+          will not help is a button that teaches the reader to distrust the
+          sentence, and it is the same rule `JobCard` follows for the Retry on a
+          failed step (src/job-failure.ts).
+
+          The generic line goes with it: when the refusal above says what
+          happened, "It didn't get as far as the queue" adds nothing. */}
+      {failed && worthRetrying(failure?.reason) && (
         <p className="tw:mb-0 tw:text-sm tw:text-muted-foreground">
           It didn't get as far as the queue.{" "}
           <button
diff --git a/src/web/Library.tsx b/src/web/Library.tsx
index b0c8df08..39a7dd2b 100644
--- a/src/web/Library.tsx
+++ b/src/web/Library.tsx
@@ -66,7 +66,7 @@ import {
   sortDirParam,
 } from "./params.js";
 import { pageTitle, useDocumentTitle } from "./page-title.js";
-import { ADMIN_HREF, DESIGN_HREF } from "./router.js";
+import { ADMIN_HREF, DESIGN_HREF, PROFILE_HREF } from "./router.js";
 import { ShelfCard } from "./ShelfEntry.js";
 import { ShelfControls, type ShelfFilter } from "./ShelfControls.js";
 import { Tooltip, TooltipGroup } from "./Tooltip.js";
@@ -312,7 +312,7 @@ export function Library() {
                 }
               >
                 <Link
-                  href="/profile"
+                  href={PROFILE_HREF}
                   className="tw:inline-flex tw:items-center tw:gap-1.5 tw:text-xs tw:text-ink-faint tw:no-underline tw:hover:text-highlight"
                 >
                   <User size={13} />
diff --git a/src/web/Metadata.tsx b/src/web/Metadata.tsx
index 9c0d6c0d..330dd187 100644
--- a/src/web/Metadata.tsx
+++ b/src/web/Metadata.tsx
@@ -184,7 +184,7 @@ import { isWebUrl } from "../urls.js";
 import { Dock } from "./Dock.js";
 import { Link } from "./Link.js";
 import { atParam } from "./params.js";
-import { LIBRARY_HREF, carriedSearch, readHref } from "./router.js";
+import { LIBRARY_HREF, PROFILE_HREF, carriedSearch, readHref } from "./router.js";
 import { SourceLink, webSource } from "./SourceLink.js";
 import { articleStats } from "./stats.js";
 import { EditableTitle, useArticleRename } from "./TitleEditor.js";
@@ -761,7 +761,7 @@ export function Metadata({
                 <span className="tw:text-[0.7rem] tw:uppercase tw:tracking-[0.03em] tw:text-ink-faint">
                   About you
                 </span>
-                <Link href="/profile" className="tw:text-xs tw:text-highlight">
+                <Link href={PROFILE_HREF} className="tw:text-xs tw:text-highlight">
                   Edit on your profile →
                 </Link>
               </div>
diff --git a/src/web/ProfilePage.tsx b/src/web/ProfilePage.tsx
index 0aab6ffd..632286e9 100644
--- a/src/web/ProfilePage.tsx
+++ b/src/web/ProfilePage.tsx
@@ -29,6 +29,11 @@
  * may not import a server module), and the recent list is `GET /api/library`,
  * which the shelf already fetches.
  *
+ * **The plan arrived on 2026-09-03**, and it is here because the quota's own
+ * refusal messages had been pointing at *"the Upgrade button on your profile
+ * page"* since the wall went up, with no such button anywhere. BillingSection.tsx
+ * has it, and docs/project/billing.md has what is behind it.
+ *
  * **Settings arrived on 2026-08-31**, and they are a different kind of thing
  * from the rest of this page: the profile box says what the model is told, and
  * a setting says what the app does. One switch so far — experimental features,
@@ -44,13 +49,14 @@
  * the original's homepage did not have either. This is a reading tool.
  */
 import { useEffect, useState } from "react";
-import { ArrowLeft, BookOpen, Cpu, SlidersHorizontal, TriangleAlert, User, UserCheck } from "lucide-react";
+import { ArrowLeft, BookOpen, Cpu, SlidersHorizontal, TriangleAlert, User, UserCheck, Wallet } from "lucide-react";
 import { MAX_PROFILE_CHARS, type LibraryEntry } from "../types.js";
 import { apiFetch, readJson } from "./lib/api.js";
 import { Link } from "./Link.js";
 import { pageTitle, useDocumentTitle } from "./page-title.js";
 import { PRIVACY_HREF, readHref } from "./router.js";
 import { AccountSection } from "./AccountSection.js";
+import { BillingSection } from "./BillingSection.js";
 import { ProfileBox } from "./ProfileBox.js";
 import { SettingsSection } from "./SettingsSection.js";
 import { useProfile } from "./useProfile.js";
@@ -198,11 +204,15 @@ export function ProfilePage() {
       </Link>
 
       <h1 className="tw:m-0 tw:font-prose tw:text-2xl tw:leading-snug tw:text-foreground">Profile</h1>
-      {/* Two halves now, and the sentence says both: what the model is told,
-          and what you have switched on. It used to name only the first, which
-          was the whole page until Settings landed. */}
+      {/* Three things now, and the sentence names all three: what the model is
+          told, what your account may do, and what you have switched on. It used
+          to name only the first, which was the whole page until Settings landed;
+          the plan arrived on 2026-09-03. A sentence that keeps describing two of
+          three sections is the kind of small untruth that is nobody's job to
+          notice. */}
       <p className="tw:mt-2 tw:mb-0 tw:text-sm tw:text-muted-foreground">
-        What the model knows about who it is writing for, and what you have switched on.
+        What the model knows about who it is writing for, what your account may do, and what you
+        have switched on.
       </p>
 
       {/* ---------------------------------------------------------- account -- */}
@@ -212,6 +222,18 @@ export function ProfilePage() {
         </div>
       </Section>
 
+      {/* ---------------------------------------------------------- plan -- */}
+      {/* **Directly under the account, above everything else.** It is the other
+          half of "who am I here" — the address you signed in with, and what that
+          account may do — and it is the page the refusal copy sends people to
+          when the wall stops them (`ingestQuotaReached`, src/messages.ts), so it
+          must not be below three cards they have to scroll past. */}
+      <Section icon={Wallet} label="Plan">
+        <div className={`${CARD} tw:p-4`}>
+          <BillingSection />
+        </div>
+      </Section>
+
       {/* ------------------------------------------------------- about you -- */}
       <Section icon={User} label="About you">
         <div className={`${CARD} tw:p-4`}>
diff --git a/src/web/ProfilePanel.tsx b/src/web/ProfilePanel.tsx
index 578be330..844ec0a9 100644
--- a/src/web/ProfilePanel.tsx
+++ b/src/web/ProfilePanel.tsx
@@ -74,7 +74,7 @@ import {
 } from "@floating-ui/react";
 import { apiFetch, readJson } from "./lib/api.js";
 import { Link } from "./Link.js";
-import { carriedSearch, readHref } from "./router.js";
+import { PROFILE_HREF, carriedSearch, readHref } from "./router.js";
 
 /**
  * What `GET /api/reader?slug=` says about the reader.
@@ -256,7 +256,7 @@ function PanelBody({ slug, onLeave }: { slug: string; onLeave(): void }) {
         failed={load.state === "failed"}
         loading={load.state === "loading"}
         empty="You haven't said anything about yourself yet."
-        href="/profile"
+        href={PROFILE_HREF}
         onLeave={onLeave}
       />
       <Box
diff --git a/src/web/UploadPicker.tsx b/src/web/UploadPicker.tsx
index 0c88ed4e..2edcf8c4 100644
--- a/src/web/UploadPicker.tsx
+++ b/src/web/UploadPicker.tsx
@@ -25,6 +25,7 @@ import { useEffect, useRef, useState } from "react";
 import { FileText, Upload, X } from "lucide-react";
 import { Button } from "@/components/ui/button";
 import { type ChosenFile, formatBytes, uploadProblem } from "../uploads.js";
+import { QuotaNotice } from "./QuotaNotice.js";
 import { addUploadHref, navigate } from "./router.js";
 import { uploadPdf } from "./upload.js";
 
@@ -263,9 +264,12 @@ export function UploadPicker() {
           to somebody using a screen reader — and the button they just pressed
           gives no other feedback. */}
       <div aria-live="polite">
-        {problem && (
-          <p className="tw:mt-2 tw:mb-0 tw:text-xs tw:text-destructive">{problem}</p>
-        )}
+        {/* **`POST /api/uploads` refuses at the door when there is no room
+            left** — a non-reserving eligibility check, so nobody transfers
+            11 MB to be told no (docs/project/billing.md § *Which requests spend
+            a slot*). It carries the same refusal sentence the job route does, so
+            it gets the same link beside it. QuotaNotice.tsx. */}
+        <QuotaNotice message={problem} className="tw:mt-2 tw:mb-0 tw:text-xs tw:text-destructive" />
 
         {chosen && (
           <div className="tw:mt-2 tw:flex tw:items-baseline tw:gap-2 tw:text-xs tw:text-muted-foreground">
diff --git a/src/web/admin-columns.tsx b/src/web/admin-columns.tsx
index 91001d45..7c4402f0 100644
--- a/src/web/admin-columns.tsx
+++ b/src/web/admin-columns.tsx
@@ -13,10 +13,12 @@
  *
  * ## What the "etc etc" is, and what it is not
  *
- * Nine numbers and three dates. **Nothing here names a document.** Not a title,
- * not a URL, not a filename, not a sentence of anybody's reading — see
- * docs/project/admin.md § What it deliberately does not show, which is the one
- * paragraph to read before adding a column.
+ * Numbers, dates, and — since 2026-09-03 — a plan and a Stripe status.
+ * **Nothing here names a document.** Not a title, not a URL, not a filename, not
+ * a sentence of anybody's reading — see docs/project/admin.md § What it
+ * deliberately does not show, which is the one paragraph to read before adding a
+ * column. A tier id and a subscription status are facts about the account, in
+ * the same family as "how many articles", and neither is anybody's reading.
  *
  * ## The two accessor rules, borrowed rather than reinvented
  *
@@ -72,6 +74,11 @@ export const ADMIN_CHIP_ORDER = [
      question this page gained on 2026-09-02 and the one a subscription price is
      argued from; how many articles somebody has is context for it. */
   "spend",
+  /* Beside spend, and above the counts, for the same reason spend is: "who is
+     paying" and "who is expensive" are the two halves of one question, and both
+     are read before "how much have they got on the shelf". */
+  "plan",
+  "ingests",
   "articles",
   "uploads",
   "questions",
@@ -139,6 +146,69 @@ function Spend({ user }: { user: AdminUser }) {
   );
 }
 
+/**
+ * **What they are on, and what Stripe says about it.**
+ *
+ * Two lines rather than one, because they answer different questions and only
+ * one of them is usually interesting: `plan` is the entitlement this server
+ * acted on, and `planStatus` is Stripe's own word for the subscription behind
+ * it. They agree on a healthy account and the interesting rows are the ones
+ * where they do not — `free` over `canceled` is a lapsed subscriber, and `free`
+ * over `past_due` would be a bug, because `past_due` is entitled on purpose.
+ *
+ * **The status is drawn raw**, in the mono face the ids use, rather than
+ * translated: `AdminUser.planStatus` says why, and a status Stripe adds next
+ * year should show itself here rather than be flattened into whichever of ours
+ * it least resembles.
+ */
+function Plan({ user }: { user: AdminUser }) {
+  return (
+    <div className="tw:min-w-0">
+      <div className="tw:truncate tw:text-foreground">{user.plan}</div>
+      {user.planStatus && (
+        <div
+          className="tw:truncate tw:font-mono tw:text-xs tw:text-muted-foreground"
+          title={`Stripe's own subscription status. Entitlement is decided from an allowlist, so a status not on it reads as the free tier.`}
+        >
+          {user.planStatus}
+        </div>
+      )}
+    </div>
+  );
+}
+
+/**
+ * **How much of the allowance is gone**, over the span the allowance is for.
+ *
+ * `4 / 20` rather than `4`, because a bare count against a limit that is a *row*
+ * in `billing_tiers` — raisable at any time, by anybody with a psql prompt — is
+ * a number the reader of this page cannot scale. The window is in the `title`
+ * and again in the column's hint, for the reason the spend column carries its
+ * period twice: an allowance measured over an unnamed span is a figure two
+ * people read differently.
+ *
+ * **An administrator gets an em dash.** `isAdmin` is the gate's own question,
+ * the same one the wall exempts on (`admitIngest` in src/billing/admission.ts),
+ * and the exemption is total — no slot is reserved at all, so an administrator's
+ * ingests are legitimately absent from `ingest_events` and any figure drawn here
+ * would be a count of something that was never counted. Drawn on the page rather
+ * than sent from the server because those two uuids are already in this bundle.
+ */
+function Ingests({ user }: { user: AdminUser }) {
+  if (isAdmin(user.id)) {
+    return <span title="Administrators take no quota slot, so nothing is counted">—</span>;
+  }
+  const window =
+    user.ingestWindow === "period"
+      ? "in the current Stripe billing period"
+      : "over the lifetime of the account";
+  return (
+    <span title={`${user.ingests} of ${user.ingestLimit} successful ingests ${window}`}>
+      {user.ingests} / {user.ingestLimit}
+    </span>
+  );
+}
+
 /**
  * The marker on the administrator's own row, and nobody else's.
  *
@@ -316,6 +386,39 @@ export function adminColumns(now: number): SortableColumn<AdminUser>[] {
       },
       cell: ({ row }) => <Spend user={row.original} />,
     },
+    {
+      id: "plan",
+      header: "Plan",
+      accessorFn: (u) => u.plan,
+      /* A to Z first, so the default press groups `free` away from the tiers
+         rather than starting at whichever tier sorts last. */
+      sortDescFirst: false,
+      sortingFn: localeText<AdminUser>(),
+      meta: {
+        label: "Plan",
+        hint: "What they are entitled to — the tier id, or free. Stripe's status underneath",
+        ends: ["A to Z", "Z to A"],
+      },
+      cell: ({ row }) => <Plan user={row.original} />,
+    },
+    {
+      id: "ingests",
+      header: "Ingests",
+      accessorFn: (u) => u.ingests,
+      sortDescFirst: true,
+      sortingFn: numberOrMissing<AdminUser>(),
+      meta: {
+        label: "Ingests",
+        /* The window is named here and again on every cell, and that repetition
+           is deliberate: the two allowances are measured over different spans,
+           so a column of `4 / 20` and `2 / 3` is two different questions in one
+           list unless each cell says which it is answering. */
+        hint: "Articles added against the allowance — a paid period, or the account's lifetime",
+        ends: ["fewest first", "most first"],
+        numeric: true,
+      },
+      cell: ({ row }) => <Ingests user={row.original} />,
+    },
     counted("articles", "Articles", "Articles", "How many are on their shelf", (u) => u.articles),
     counted("archived", "Archived", "Archived", "How many they have taken off it", (u) => u.archived),
     counted("uploads", "Uploads", "Uploads", "PDFs that finished uploading", (u) => u.uploads),
diff --git a/src/web/router.ts b/src/web/router.ts
index 2655ea37..1342fbff 100644
--- a/src/web/router.ts
+++ b/src/web/router.ts
@@ -233,7 +233,7 @@ export function parseRoute(pathname: string): Route {
   if (new RegExp(`^${LOGIN_HREF}/?$`).test(pathname)) return { kind: "login" };
   // Beside `design` and above `/read/` for the same reason: it is not about an
   // article, so the article regex must never get a chance at it.
-  if (/^\/profile\/?$/.test(pathname)) return { kind: "profile" };
+  if (new RegExp(`^${PROFILE_HREF}/?$`).test(pathname)) return { kind: "profile" };
   // Beside `design` and `profile`, and for the same reason. Above `/read/`
   // because it is not about an article, and above the sign-in gate in App.tsx
   // because it is not about being signed in either.
@@ -350,6 +350,16 @@ export const ADMIN_USERS_HREF = "/admin/users";
 export const ADMIN_FEEDBACK_HREF = "/admin/feedback";
 export const DESIGN_HREF = "/design";
 export const LOGIN_HREF = "/login";
+/**
+ * The reader's own page — the profile box, the plan, the settings.
+ *
+ * A constant for the same reason `ADMIN_HREF` is one, and it earned it: the
+ * string was written out at three call sites before the quota's refusal copy
+ * needed a fourth (`QuotaNotice` in QuotaNotice.tsx), which is the point at
+ * which a typo stops being a broken link and starts being a reader who has just
+ * been refused an article landing on the shelf with no way forward.
+ */
+export const PROFILE_HREF = "/profile";
 /**
  * The privacy policy. Linked from the landing page's footer and from
  * `/profile`, so both a stranger and a reader can find it.
diff --git a/tests/admin-page.test.tsx b/tests/admin-page.test.tsx
index 7f7eadd1..2287fbc7 100644
--- a/tests/admin-page.test.tsx
+++ b/tests/admin-page.test.tsx
@@ -102,6 +102,14 @@ const ALICE: AdminUser = {
      marker that says so. */
   spendUnpricedCalls: 7,
   spendMonth: "2026-08",
+  /* Alice pays. Both windows are here because the Plan column names which one
+     the count is against, and a paid account's is the Stripe billing period
+     rather than the account's lifetime. */
+  plan: "reader",
+  planStatus: "active",
+  ingests: 4,
+  ingestLimit: 20,
+  ingestWindow: "period",
 };
 
 const BOB: AdminUser = {
@@ -120,6 +128,15 @@ const BOB: AdminUser = {
   spendCalls: 0,
   spendUnpricedCalls: 0,
   spendMonth: "2026-08",
+  /* **Bob is the empty account**, and the billing fields have no absent state
+     for him: a reader with no `billing_accounts` row is on the free tier with
+     nothing used, which is a fact rather than a blank. `planStatus` is the only
+     one that is genuinely absent, because he has never had a subscription — and
+     the Plan cell draws nothing under the word rather than an empty line. */
+  plan: "free",
+  ingests: 0,
+  ingestLimit: 3,
+  ingestWindow: "lifetime",
 };
 
 /**
diff --git a/tests/admin-spend-column.test.tsx b/tests/admin-spend-column.test.tsx
index 842ea826..b4191542 100644
--- a/tests/admin-spend-column.test.tsx
+++ b/tests/admin-spend-column.test.tsx
@@ -41,6 +41,12 @@ function user(over: Partial<AdminUser> = {}): AdminUser {
     spendCalls: 42,
     spendUnpricedCalls: 0,
     spendMonth: "2026-09",
+    /* Not what this file is about, but `AdminUser` requires them: a reader with
+       no `billing_accounts` row is on the free tier with nothing used. */
+    plan: "free",
+    ingests: 0,
+    ingestLimit: 3,
+    ingestWindow: "lifetime",
     ...over,
   };
 }
diff --git a/tests/admin-users-merge.test.ts b/tests/admin-users-merge.test.ts
index fde5c644..e73e2df3 100644
--- a/tests/admin-users-merge.test.ts
+++ b/tests/admin-users-merge.test.ts
@@ -47,6 +47,9 @@ const NOTHING: UserCounts = {
   searches: [],
   spend: new Map(),
   spendMonth: "2026-08",
+  ingests: [],
+  accounts: new Map(),
+  tiers: [],
 };
 
 describe("joining accounts to their counts", () => {
@@ -72,6 +75,17 @@ describe("joining accounts to their counts", () => {
         [BOB, { nanos: 30_000_000, calls: 30, unpricedCalls: 0 }],
       ]),
       spendMonth: "2026-08",
+      /* The billing three merge by owner id exactly as the six above do, so
+         they belong in the "nobody gets anybody else's numbers" test. Both are
+         on the free tier here — what each *plan* does with these numbers is
+         tests/billing-admin-plan.test.ts, and this one is only about whose row
+         they land on. */
+      ingests: [
+        { owner: ALICE, lifetime: 2, inPeriod: 0, inFlight: 0 },
+        { owner: BOB, lifetime: 1, inPeriod: 0, inFlight: 1 },
+      ],
+      accounts: new Map(),
+      tiers: [],
     });
 
     const alice = users.find((u) => u.id === ALICE);
@@ -80,11 +94,16 @@ describe("joining accounts to their counts", () => {
       articles: 3, archived: 1, opens: 40, uploads: 11, questions: 13, chats: 15, searches: 17,
       lastReadAt: "2026-08-25T09:00:00.000Z",
       spendNanos: 19_000_000, spendCalls: 19, spendUnpricedCalls: 2, spendMonth: "2026-08",
+      plan: "free", ingests: 2, ingestWindow: "lifetime",
     });
     expect(bob).toMatchObject({
       articles: 7, archived: 2, opens: 5, uploads: 22, questions: 24, chats: 26, searches: 28,
       lastReadAt: "2026-08-26T09:00:00.000Z",
       spendNanos: 30_000_000, spendCalls: 30, spendUnpricedCalls: 0, spendMonth: "2026-08",
+      /* 1 settled + 1 still in flight. A reservation nobody has settled is a
+         slot somebody is spending, which is what the wall counts — so the page
+         counts it too, or it would show a free slot the server would refuse. */
+      plan: "free", ingests: 2, ingestWindow: "lifetime",
     });
   });
 
@@ -102,6 +121,13 @@ describe("joining accounts to their counts", () => {
        rather than as `$0.0000`. A missing field here would have made those two
        states indistinguishable. */
     expect(alone).toMatchObject({ spendNanos: 0, spendCalls: 0, spendUnpricedCalls: 0 });
+    /* And the same rule for billing, where "no row" is the *ordinary* state
+       rather than an edge: a free reader has no `billing_accounts` row until
+       they check out or hit the wall, so an absent account and an absent ingest
+       tally have to read as the free tier with nothing spent — not as a missing
+       plan, which the column would draw as an empty cell. */
+    expect(alone).toMatchObject({ plan: "free", ingests: 0, ingestLimit: 3, ingestWindow: "lifetime" });
+    expect(alone?.planStatus).toBeUndefined();
     expect(alone?.spendMonth).toBe("2026-08");
     /* And the dates that genuinely have no answer stay *absent*, because
        `exactOptionalPropertyTypes` makes absent the only spelling of "no
diff --git a/tests/client-imports.test.ts b/tests/client-imports.test.ts
index e5966ab7..6c16a47e 100644
--- a/tests/client-imports.test.ts
+++ b/tests/client-imports.test.ts
@@ -137,6 +137,19 @@ const SHARED = new Set([
   // the point: two spellings of "is this Greg" is one place for them to
   // disagree. See docs/project/admin.md.
   "admin.js",
+  /* What plan a reader is on, and the sentences `/profile` says about it. On the
+     list for the same reason `admin.js` is, and it is the same argument one
+     question along: `GET /api/billing/usage` builds a `ReaderPlan` and
+     BillingSection.tsx draws it, so the shape is a wire contract with an end on
+     each side. It imports nothing at all.
+
+     **It is a flat module rather than `src/billing/plan.ts` because of this
+     rule**, and that is worth saying rather than looking like a naming whim: the
+     rest of `src/billing/` constructs Stripe clients and opens database
+     transactions, and the one file the browser may have had to leave the
+     directory to prove it. See src/billing-plan.ts and docs/project/billing.md
+     § What a reader sees. */
+  "billing-plan.js",
   /* The Sketch diagram's schema, its validator and its painter — the two files
      that turn a model's scene into geometry. On the list for the reason the
      header states rather than for convenience: `sketch-scene.js` imports
diff --git a/tests/refused-job-reason-survives.test.tsx b/tests/refused-job-reason-survives.test.tsx
index 1c903ad7..b87c8ebe 100644
--- a/tests/refused-job-reason-survives.test.tsx
+++ b/tests/refused-job-reason-survives.test.tsx
@@ -81,6 +81,7 @@ vi.mock("../src/web/Dock.js", () => ({ Dock: () => null }));
 
 const { useIdeas } = await import("../src/web/useIdeas.js");
 const { Tweets } = await import("../src/web/Tweets.js");
+const { AddPage } = await import("../src/web/AddPage.js");
 const { jobEngine } = await import("../src/web/jobEngine.js");
 
 /** Enough article for the page to render its head. */
@@ -93,6 +94,16 @@ const ARTICLE = {
 /** What the server says when it refuses the job. */
 const REFUSED = "You are out of credit for today.";
 
+/**
+ * The sentence the refusal carries, so one case can send a **quota** refusal.
+ *
+ * A variable rather than a second stub: the add-page cases below are about what
+ * happens to the server's words, and a `[pay-free]` code changes what the page
+ * draws around them (`QuotaNotice`, and the `worthRetrying` gate on *Try
+ * again*). Reset to `REFUSED` before each case.
+ */
+let refused = REFUSED;
+
 /** Every request the stub was asked to make, so a test can prove one happened. */
 let sent: { method: string; url: string }[] = [];
 /** Whether the next `POST /api/jobs` is refused. The second test turns it off. */
@@ -127,6 +138,7 @@ beforeEach(() => {
   heldPolls = [];
   ideas = null;
   refusing = true;
+  refused = REFUSED;
   vi.stubGlobal(
     "fetch",
     vi.fn(async (url: string, init?: RequestInit) => {
@@ -135,7 +147,7 @@ beforeEach(() => {
       if (method === "POST" && url === "/api/jobs") {
         /* Received and **refused**, with a reason written for a reader. This is
            the case `postFailed` cannot tell from a dead network on its own. */
-        if (refusing) return json({ error: REFUSED }, 402);
+        if (refusing) return json({ error: refused }, 402);
         return json({ id: "job1", slug: "constitution", status: "queued", steps: [] });
       }
       if (url === "/api/jobs") {
@@ -336,3 +348,83 @@ describe("the thread page, which had its own copy of all this", () => {
     expect(host.textContent).not.toContain(REFUSED);
   });
 });
+
+describe("the add page, which is the fifth copy and was found in a browser", () => {
+  /**
+   * **The one that mattered, and the one a passing suite did not catch.**
+   *
+   * `/add/<url>` posts on mount and had exactly the spelling this whole file is
+   * about: a boolean `failed`, and `queue.error` rendered beside it. So the
+   * quota's 402 — *"You have added all 3 articles a free account can add… the
+   * Upgrade button on your profile page sets one up. [pay-free]"* — was replaced
+   * by the generic *"It didn't get as far as the queue"* before anybody could
+   * read it, taking the link to `/profile` with it. **That is the entire point
+   * of the surface it was added to**: the refusal names a button, and the page
+   * that was meant to hand the reader that button showed them nothing.
+   *
+   * Found in the browser on 2026-09-03, by a subagent driving a real free
+   * account against a real server, after every unit test in the change was
+   * green. Written up here rather than in a file of its own because this is the
+   * file about this bug, and its own header already predicted the shape:
+   * *"the way this breaks is by somebody reintroducing a private `queue.error`
+   * read"*.
+   *
+   * The page is mounted whole, and everything real runs but the auth client.
+   */
+  const QUOTA = "You have added all 3 articles a free account can add. [pay-free]";
+
+  it("goes on saying what the server said after the next poll succeeds", async () => {
+    refused = QUOTA;
+    await act(async () => {
+      root.render(createElement(AddPage, { source: { kind: "url", url: "example.com/an-essay" } }));
+    });
+    await settle();
+
+    /* Before the poll lands — the frame the reader never sees. The broken code
+       passes this line, which is why it is here. */
+    expect(host.textContent).toContain(QUOTA);
+    expect(sent.some((r) => r.method === "POST" && r.url === "/api/jobs")).toBe(true);
+
+    /* And the poll the failed POST's own `finally` started really is in flight.
+       Without this the test could pass by never reaching the thing that wipes
+       the message. */
+    const before = polls();
+    await answerPolls();
+    expect(before).toBeGreaterThanOrEqual(1);
+
+    /* After a perfectly successful poll. Still the server's sentence, and still
+       the way out of it. */
+    expect(host.textContent).toContain(QUOTA);
+    expect([...host.querySelectorAll("a")].map((a) => a.getAttribute("href"))).toContain("/profile");
+  });
+
+  it("does not offer a Try again under a refusal that says trying again will not help", async () => {
+    /* The rule `worthRetrying` decides, and the reason it is worth a case: a
+       button under a sentence that has just said the count will be the same is
+       one that teaches the reader to distrust the sentence. */
+    refused = QUOTA;
+    await act(async () => {
+      root.render(createElement(AddPage, { source: { kind: "url", url: "example.com/an-essay" } }));
+    });
+    await settle();
+    await answerPolls();
+
+    expect(host.textContent).not.toContain("It didn't get as far as the queue");
+    expect([...host.querySelectorAll("button")].map((b) => b.textContent)).not.toContain("Try again");
+  });
+
+  it("still offers a Try again for a failure another go could fix", async () => {
+    /* The mirror, so the case above cannot pass by hiding the button for
+       everything. A refusal with no code is unrecognised, and `worthRetrying`
+       gives an unrecognised message the benefit of the doubt. */
+    refused = "The server was busy.";
+    await act(async () => {
+      root.render(createElement(AddPage, { source: { kind: "url", url: "example.com/an-essay" } }));
+    });
+    await settle();
+    await answerPolls();
+
+    expect(host.textContent).toContain("The server was busy.");
+    expect(host.textContent).toContain("It didn't get as far as the queue");
+  });
+});
```

## src/billing-plan.ts (new, in full)

```ts
/**
 * **What to tell a reader about their own plan** — the shape `/profile` reads,
 * and the words it puts on the page.
 *
 * Pure: no database, no network, no environment, no React. The server builds a
 * `BillingSummary` in src/billing/summary.ts and `GET /api/billing/usage`
 * answers with it; src/web/BillingSection.tsx draws it. This file is the wire
 * shape both ends agree on, plus the two things that are decisions rather than
 * layout — how a currency amount is written, and what each plan state *says*.
 *
 * ## Why it is here rather than in src/types.ts or in src/billing/
 *
 * The same reason `AdminUser` is in src/admin.ts: `types.ts` is the vocabulary
 * the reading app speaks in — articles, blocks, threads, the shelf — and this is
 * one page's answer, read by one component and one route. It also imports
 * nothing at all, which is what lets the browser have it without dragging a
 * Stripe client or a database pool into the bundle.
 *
 * **And it is flat rather than `src/billing/plan.ts`, because the client may
 * only import a shared module directly under `src/`** — the rule and the list
 * are in tests/client-imports.test.ts, and it is a good rule: the rest of
 * `src/billing/` constructs Stripe clients and opens database transactions, and
 * the one file the browser may have has to be visibly outside that. Written
 * down because the file was in `src/billing/` for an hour and the name looks
 * like a whim without it.
 *
 * ## The lapsed arm carries no `used`, and that is the point
 *
 * The free allowance is **lifetime and includes paid months** (Greg,
 * 2026-09-03), so a reader who took forty articles on Reader and cancelled is
 * permanently past the free three. That is the policy. But rendering it as
 * *"40 of 3 used"* reads as arithmetic going wrong rather than as a rule, and
 * the refusal message has had a third sentence for exactly this since the wall
 * went up (`pay-lapsed`, src/messages.ts).
 *
 * So `lapsed` is its own arm of the union and it has **no `used` field**: the
 * page cannot render the forbidden shape, because the number is not there to
 * render. `remaining` is what it gets instead, and `remaining` can never exceed
 * `limit`. A comment asking the next person not to print it would have been the
 * weaker version of this.
 */

/** One tier a reader may buy right now — a row of `billing_tiers`, trimmed. */
export interface TierOffer {
  readonly id: string;
  /** `Spideryarn Reader` — the product name off the row, never derived here. */
  readonly name: string;
  readonly description: string;
  readonly ingestsPerPeriod: number;
  /** Currency code → amount in that currency's smallest unit. At least one. */
  readonly amounts: Readonly<Record<string, number>>;
}

/**
 * What this reader's allowance is right now.
 *
 * A discriminated union rather than a bag of optionals, for the reason
 * `Entitlement` in tiers.ts is one: the states genuinely differ in what they
 * *have*. A free account has no renewal date, an exempt one has no count, and a
 * lapsed one deliberately has no `used` — see the header.
 *
 * `used` includes reservations still in flight, because that is what the wall
 * counts (`refusalFor` in src/store/pg-billing.ts). A page that counted only
 * settled successes would tell somebody they had a slot left and then watch the
 * server refuse them.
 */
export type ReaderPlan =
  /**
   * Quota is not enforced on this deployment at all — a filesystem store.
   *
   * Not an error and not a plan: docs/project/billing.md § *Billing is a
   * Postgres feature*. It cannot happen in production, where src/store/index.ts
   * refuses to boot on a filesystem store, so this is what a developer sees.
   */
  | { readonly kind: "off" }
  /** An administrator. No slot is ever taken, so there is no count to show. */
  | { readonly kind: "exempt" }
  /**
   * The row says subscribed and its stored period does not contain now.
   *
   * The admission path resyncs from Stripe once and answers 503 if that does not
   * help. **This page does neither**: a read of your own profile should not make
   * an outbound call to Stripe, and guessing in either direction would be a
   * number rather than an answer. It says it does not know.
   */
  | { readonly kind: "unknown" }
  | { readonly kind: "free"; readonly limit: number; readonly used: number }
  /** Had a subscription; does not have an entitled one. See the header. */
  | { readonly kind: "lapsed"; readonly limit: number; readonly remaining: number }
  | {
      readonly kind: "paid";
      readonly tierId: string;
      readonly tierName: string;
      readonly limit: number;
      readonly used: number;
      /** ISO. When the allowance starts again — or when it runs out, if cancelling. */
      readonly periodEnd: string;
      /** Cancelled at the end of the period, so `periodEnd` is an ending. */
      readonly cancelling: boolean;
    };

/** The whole of `GET /api/billing/usage`. */
export interface BillingSummary {
  readonly plan: ReaderPlan;
  /** What may be bought, cheapest first. Empty on a deployment with no Stripe. */
  readonly offers: readonly TierOffer[];
  /**
   * Whether *Manage billing* can do anything.
   *
   * `POST /api/billing/portal` refuses an owner with no Stripe customer (409,
   * `pay-none`), because there is no billing history to manage. A button that
   * can only produce that refusal is worse than no button, so the page asks
   * first — and it asks the same question the route decides on, which is whether
   * `billing_accounts.stripe_customer_id` is set.
   *
   * **So it turns true when somebody first presses *Upgrade*, not when they
   * pay**, and that follows from the ordering guarantee rather than from
   * anything here: `startCheckout` commits the customer→owner mapping *before*
   * a Checkout Session exists, because a session that could take money before
   * the webhook could find its owner is somebody paying for nothing
   * (src/billing/checkout.ts). Abandon that Checkout and the Portal opens on a
   * customer with no payment method and no invoices — which is empty rather
   * than wrong, and is the honest state of an account that started to subscribe
   * and stopped. Observed in the browser on 2026-09-03 and written down here,
   * because it looks like a bug for exactly as long as it takes to remember the
   * ordering.
   */
  readonly manageable: boolean;
}

/* ------------------------------------------------------------- the words -- */

/** What the page prints for a plan: one line, and a second when there is more. */
export interface PlanCopy {
  readonly headline: string;
  readonly detail: string | null;
}

/**
 * The sentences for each plan state.
 *
 * **Here rather than in the component**, so that the one rule that matters can
 * be tested without a DOM: a lapsed reader is never shown *"40 of 3"*. The type
 * already makes that unbuildable; this is where it is also demonstrated
 * (tests/billing-plan.test.ts).
 *
 * It agrees with `ingestQuotaReached` in src/messages.ts rather than inventing a
 * second wording — that function is what the API says when it refuses, and a
 * page that told a different story about the same rule would be the second
 * source of truth this repo keeps writing postmortems about. What it does not
 * do is *import* those strings: they are refusals, written to be read after
 * something failed, and these are a read-out of a state that is usually fine.
 */
export function describePlan(plan: ReaderPlan): PlanCopy {
  switch (plan.kind) {
    case "off":
      return {
        headline: "No plan on this copy of the app",
        detail:
          "This copy is not running against Postgres, so nothing is metered and nothing can be " +
          "bought. You will only ever see this on a development machine.",
      };
    case "exempt":
      return {
        headline: "Administrator — no limit",
        detail: "Adding an article never takes a slot on this account, so there is nothing to count.",
      };
    case "unknown":
      return {
        headline: "We could not confirm your plan just now",
        detail:
          "Your subscription's dates are out of step with Stripe. Reading is unaffected, and this " +
          "usually sorts itself out within a minute — reload the page to look again.",
      };
    case "free":
      return {
        headline: `Free — ${plan.used} of ${plan.limit} articles used`,
        detail:
          plan.used >= plan.limit
            ? "That is the whole free allowance, which is a lifetime one rather than a monthly " +
              "one. Everything you have added stays exactly where it is, and reading is never " +
              "limited — a subscription is what adds more."
            : `The free allowance is ${plan.limit} articles for the lifetime of the account, not ` +
              "per month. Reading is never limited.",
      };
    case "lapsed":
      /* **No `used`, and no ratio wider than the limit.** See the header: this
         is the one rendering the policy would otherwise make look like a bug. */
      return plan.remaining > 0
        ? {
            headline: "Your plan has ended",
            detail:
              `You are back on the free allowance, with ${plan.remaining} of ${plan.limit} ` +
              "left. Everything you added while subscribed is still here, and reading is " +
              "unaffected — resubscribing is what adds more.",
          }
        : {
            headline: "Your plan has ended",
            detail:
              "The free allowance is already spent, so no more articles can be added. Everything " +
              "you have added is still here and reading is unaffected — resubscribing is what " +
              "adds more.",
          };
    case "paid": {
      const when = readableDate(plan.periodEnd);
      return {
        headline: `${plan.tierName} — ${plan.used} of ${plan.limit} articles this month`,
        detail: plan.cancelling
          ? `Cancelled: this plan runs until ${when ?? "the end of the period"}, and then the ` +
            "account goes back to the free allowance. Nothing you have added is affected."
          : `The allowance starts again on ${when ?? "your renewal date"}.`,
      };
    }
  }
}

/**
 * A date a reader would write — `3 October 2026`.
 *
 * **UTC**, so the sentence does not change depending on where the server is
 * standing; the boundary is Stripe's and it is not to the hour anyway. The same
 * rule and the same format `ingestQuotaReached` uses, so the page and the
 * refusal name the same day.
 *
 * `null` for anything unparseable, so a caller writes around it rather than
 * printing `Invalid Date` at somebody.
 */
export function readableDate(iso: string): string | null {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return null;
  return new Date(at).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * An amount in a currency's smallest unit, written the way a price is written.
 *
 * **How many minor units make a major one is asked of `Intl`, not of a list.**
 * Stripe stores JPY in whole yen and USD in cents, and a hardcoded ÷100 would
 * price a yen tier at a hundredth of itself — a currency nobody has added yet,
 * which is exactly when the wrong constant gets written. `resolvedOptions()`
 * knows, and it stays right when somebody adds a row for a currency this file
 * has never heard of.
 *
 * Trailing zeros are dropped, so `$10` rather than `$10.00`: the tiers are whole
 * units by convention (docs/project/billing.md § *Why three currencies*), and a
 * tier priced at 9.99 still shows both decimals.
 *
 * A code `Intl` refuses falls back to the code and two decimals, which is ugly
 * and readable — rather than throwing inside a render.
 */
export function formatAmount(currency: string, minorUnits: number): string {
  const code = currency.toUpperCase();
  try {
    const money = new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: code,
      currencyDisplay: "narrowSymbol",
    });
    const digits = money.resolvedOptions().maximumFractionDigits ?? 2;
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: code,
      currencyDisplay: "narrowSymbol",
      minimumFractionDigits: 0,
      maximumFractionDigits: digits,
    }).format(minorUnits / 10 ** digits);
  } catch {
    return `${code} ${(minorUnits / 100).toFixed(2)}`;
  }
}

/**
 * Every price a tier is sold at, in one string — `$10 · £8 · €9`.
 *
 * All of them rather than one, because **Stripe picks the currency by the
 * customer's location at Checkout** (`currency_options`) and this page cannot
 * know which they will be shown. Guessing from the browser's locale would print
 * a number we then do not charge, which is worse than three numbers we do.
 *
 * Sorted by currency code so two readers of the same tier see the same order.
 */
export function describeAmounts(amounts: Readonly<Record<string, number>>): string {
  return Object.keys(amounts)
    .sort()
    .map((currency) => formatAmount(currency, amounts[currency] as number))
    .join(" · ");
}
```

## src/billing/summary.ts (new, in full)

```ts
/**
 * **What `/profile` is told** — this reader's plan, what they have used, and
 * what they could buy.
 *
 * `GET /api/billing/usage`, and the whole of it. The wire shape is in src/billing-plan.ts
 * (pure, so the browser can have it); this is the server half that reads the
 * row, the tiers and the ledger and decides which arm of `ReaderPlan` the
 * account is in.
 *
 * ## Why it is a route of its own rather than a field on `GET /api/reader`
 *
 * `/api/reader` was the obvious host — it is already *the route about the
 * reader* — and it is the wrong one for two reasons:
 *
 * - **It is fetched on every article page.** `useHasProfile` (src/web/useProfile.ts)
 *   asks it with a `?slug=` from six hooks, so a billing field on it would put a
 *   `billing_accounts` read and an `ingest_events` aggregate on the path of
 *   opening an article, for data only `/profile` draws.
 * - **It answers a different question.** That route is about the reader's own
 *   words — the profile text and the per-article purpose — and this is about
 *   what they may do.
 *
 * It is a **GET**, unlike the three routes in checkout.ts, and the difference is
 * the rule those state: those are POSTs because each *creates a Stripe object*.
 * This creates nothing, touches no network, and only reads our own tables — so a
 * prefetch or a reload of it costs nothing and means nothing.
 *
 * ## It never resyncs from Stripe
 *
 * Admission does, once, when the stored period has run out — because it has to
 * decide something. This does not: a page that reads your plan should not make
 * an outbound call, and the honest answer to *the row and the clock disagree* is
 * `unknown` rather than a number picked from the two available wrong ones. The
 * next ingest, the next webhook, or the return from Checkout all resync it.
 */

import { isAdmin } from "../admin.js";
import type { OwnerId } from "../owner.js";
import { accountSnapshot, entitlementFromRow, hasLapsed, usageFor } from "../store/pg-billing.js";
import { allTiers } from "../store/pg-tiers.js";
import { STORE } from "../store/live.js";
import type { BillingSummary, ReaderPlan, TierOffer } from "../billing-plan.js";
import { offerableTiers } from "./tiers.js";
import type { TierRow } from "./tiers.js";

/** A row of `billing_tiers`, with only what a pricing card needs on it. */
function toOffer(tier: TierRow): TierOffer {
  return {
    id: tier.id,
    name: tier.productName,
    description: tier.description,
    ingestsPerPeriod: tier.ingestsPerPeriod,
    amounts: tier.amounts,
  };
}

/**
 * This owner's plan, usage and options.
 *
 * The order of the answers below is the order they rule each other out, and it
 * is not arbitrary:
 *
 * 1. **No Postgres, no quota at all** — `off`. Nothing else would mean anything,
 *    because there is no ledger to count (docs/project/billing.md § *Billing is
 *    a Postgres feature*).
 * 2. **An administrator** — `exempt`, via `isAdmin`: the same hardcoded pair of
 *    uuids the wall uses, so this page and the wall cannot disagree about who is
 *    exempt. They still get the offers and the Portal button, because being
 *    exempt from the *quota* is not being unable to buy or to look at a
 *    subscription they already have.
 * 3. **The stored period does not contain now** — `unknown`. See the header.
 * 4. Otherwise the entitlement decides, and `hasLapsed` separates a reader who
 *    has never subscribed from one whose plan is over.
 */
export async function readBillingSummary(ownerId: OwnerId): Promise<BillingSummary> {
  if (STORE !== "postgres") return { plan: { kind: "off" }, offers: [], manageable: false };

  /* Cached for thirty seconds, which is right here for the same reason it is
     right for admission and wrong for `tierToSell`: this is a read-out, not a
     sale. Nothing chargeable is minted from it. */
  const tiers = await allTiers();
  const offers = offerableTiers(tiers).map(toOffer);
  const row = await accountSnapshot(ownerId);
  /* The same question `openPortal` decides on — see `BillingSummary.manageable`. */
  const manageable = Boolean(row?.stripeCustomerId);
  const summary = (plan: ReaderPlan): BillingSummary => ({ plan, offers, manageable });

  if (isAdmin(ownerId)) return summary({ kind: "exempt" });

  const entitlement = entitlementFromRow(row, tiers, new Date());
  if ("kind" in entitlement) return summary({ kind: "unknown" }); // stale

  const usage = await usageFor(ownerId, entitlement);
  /* **In-flight counts as used**, because it counts at the wall (`refusalFor` in
     src/store/pg-billing.ts). A page that showed only settled successes would
     say a slot was free and then watch the server refuse it. */
  const used = usage.used + usage.inFlight;

  if (entitlement.tier === "paid") {
    /* The tier's own product name, or its id if the row has gone. `tierForPrice`
       matched it a moment ago, so the fallback is for a tier deleted between
       these two lines — unreachable, and an id on screen beats an empty
       heading. */
    const name = tiers.find((t) => t.id === entitlement.tierId)?.productName ?? entitlement.tierId;
    return summary({
      kind: "paid",
      tierId: entitlement.tierId,
      tierName: name,
      limit: entitlement.limit,
      used,
      periodEnd: entitlement.periodEnd.toISOString(),
      cancelling: row?.cancelAtPeriodEnd === true,
    });
  }

  if (hasLapsed(row)) {
    /* **No `used` on this arm**, so the page cannot print "40 of 3" — see
       src/billing-plan.ts. `remaining` is clamped at zero rather than going negative, which
       is the same number said the way round that stays true. */
    return summary({
      kind: "lapsed",
      limit: entitlement.limit,
      remaining: Math.max(0, entitlement.limit - used),
    });
  }

  return summary({ kind: "free", limit: entitlement.limit, used });
}
```

## src/web/useBilling.ts (new, in full)

```ts
/**
 * The plan, and the two buttons that leave for Stripe.
 *
 * One read (`GET /api/billing/usage`) and three POSTs, which is the whole of the
 * billing client — there is no billing UI to build, because Checkout and the
 * Customer Portal are hosted and we never touch a card
 * (docs/project/billing.md § *We never touch a card*).
 *
 * ## Leaving the page is the success case
 *
 * `upgrade` and `manage` both end in `location.assign(...)` to an address Stripe
 * returned. So the *whole* of what this hook does on success is navigate away,
 * and `busy` is never cleared on that path on purpose: the tab is going, and
 * putting the button back to "Upgrade" for the half-second before it does reads
 * as the click having done nothing.
 *
 * What is cleared is the failure path, which is the one the reader is left
 * looking at.
 *
 * ## The Checkout return, and why it is a POST rather than a look at the URL
 *
 * Stripe sends the reader back to `/profile?checkout={CHECKOUT_SESSION_ID}`.
 * That query parameter is not evidence of anything — anybody can type one — so
 * the page does not read it as "they paid". It hands it to
 * `POST /api/billing/confirm`, which retrieves the session from Stripe and
 * proves it belongs to whoever is signed in before syncing
 * (src/billing/checkout.ts).
 *
 * And it is a **convenience, not the mechanism**: the webhook is what makes a
 * subscription real. If confirm fails, the plan still arrives — a moment later,
 * on the next load — so a failure here is worth a quiet line rather than an
 * alarm.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import type { BillingSummary } from "../billing-plan.js";
import { apiFetch, readJson } from "./lib/api.js";

/** What the Checkout return said, once we have asked the server about it. */
export type CheckoutReturn =
  /** Nothing in the address bar; the ordinary case. */
  | { kind: "none" }
  /** They pressed Back or closed Stripe's page. Nothing was charged. */
  | { kind: "cancelled" }
  | { kind: "checking" }
  | { kind: "confirmed" }
  /** We could not confirm it here. The webhook still will. */
  | { kind: "unconfirmed"; why: string };

export interface UseBilling {
  /** `null` until the first read lands — "don't know yet", not "no plan". */
  summary: BillingSummary | null;
  /** Why the read failed, or null. A failed read leaves `summary` alone. */
  error: string | null;
  /** Which button is mid-request, so only that one shows it. */
  busy: null | { kind: "upgrade"; tierId: string } | { kind: "manage" };
  /** Why the last button press failed, or null. Cleared by the next press. */
  actionError: string | null;
  /** What came back from a Checkout redirect, if this load is one. */
  checkout: CheckoutReturn;
  /** Buy a tier: ask for a Checkout Session, then go to it. */
  upgrade(tierId: string): void;
  /** Open the hosted Portal — invoices, card, cancellation. */
  manage(): void;
  reload(): void;
}

export function useBilling(): UseBilling {
  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<UseBilling["busy"]>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [checkout, setCheckout] = useState<CheckoutReturn>({ kind: "none" });
  const [attempt, setAttempt] = useState(0);

  /* Which read is the newest. A `reload` fired while the first is still in
     flight can otherwise land in the wrong order and write the older answer
     over the newer one — the same out-of-order guard `useProfile` carries, and
     here it would show a plan from before a Checkout completed. */
  const generation = useRef(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` is not read in here — it IS the trigger. `reload` bumps it, and so does a confirmed Checkout, which is the whole of "the plan has just changed, read it again". Biome cannot see a dependency whose only job is to change; useExperimental.ts carries the same line for the same reason.
  useEffect(() => {
    const mine = ++generation.current;
    apiFetch("/api/billing/usage")
      .then((r) => readJson<BillingSummary>(r))
      .then((body) => {
        if (mine !== generation.current) return;
        setSummary(body);
        setError(null);
      })
      .catch((e: Error) => {
        if (mine !== generation.current) return;
        /* **`summary` is left alone.** A refresh that fails should leave the
           plan on screen with a line saying it may be stale, rather than
           replacing a true answer with an empty card. Same rule as the shelf's
           admin table. */
        setError(e.message);
      });
  }, [attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  /**
   * The Checkout return, run once per load.
   *
   * `?checkout=cancelled` is Stripe's own `cancel_url`, so it means the reader
   * left without paying — said plainly, because "nothing has been charged" is
   * the thing somebody who has just backed out of a payment page wants to read.
   *
   * Anything else is treated as a session id and handed to the server, which is
   * the only thing that can say whether it is one. **The address is cleaned
   * either way**, with `replaceState` rather than a navigation, so a reload does
   * not confirm the same session again and the id is not left in the history for
   * whoever borrows the laptop.
   */
  useEffect(() => {
    const found = new URLSearchParams(location.search).get("checkout");
    if (!found) return;
    history.replaceState(null, "", location.pathname);

    if (found === "cancelled") {
      setCheckout({ kind: "cancelled" });
      return;
    }

    let live = true;
    setCheckout({ kind: "checking" });
    apiFetch("/api/billing/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: found }),
    })
      .then((r) => readJson<{ status: string | null }>(r))
      .then(() => {
        if (!live) return;
        setCheckout({ kind: "confirmed" });
        /* The plan has just changed, so the card above must not go on showing
           the old one. */
        setAttempt((n) => n + 1);
      })
      .catch((e: Error) => live && setCheckout({ kind: "unconfirmed", why: e.message }));
    return () => {
      live = false;
    };
  }, []);

  /**
   * Ask for a URL and go to it. The two buttons differ only in what they post.
   *
   * `location.assign` rather than `window.open`: this is a redirect the reader
   * asked for, and a popup is the thing a browser blocks when it arrives after
   * an `await`.
   */
  const leaveFor = useCallback(
    (which: NonNullable<UseBilling["busy"]>, path: string, body: unknown) => {
      if (busy) return;
      setBusy(which);
      setActionError(null);
      apiFetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
        .then((r) => readJson<{ kind?: string; url: string }>(r))
        .then((answer) => {
          if (!answer.url) throw new Error("No address came back to send you to.");
          /* **`kind` may say `portal` in answer to a checkout**, when the
             account turns out to have a subscription that is not over — an
             `unpaid` one, say, which is unentitled and still collectable
             (src/billing/checkout.ts § *Over is a shorter list than
             unentitled*). We follow it, because the Portal is where that reader
             needs to be. The page says nothing about the swap: it is leaving,
             and a sentence rendered for the half-second before a navigation is a
             sentence nobody reads. */
          /* `busy` deliberately stays set — see the header. */
          location.assign(answer.url);
        })
        .catch((e: Error) => {
          setActionError(e.message);
          setBusy(null);
        });
    },
    [busy],
  );

  const upgrade = useCallback(
    (tierId: string) => {
      /* **Only a tier id crosses the wire.** The price is the server's, read
         from `billing_tiers`; a `price` field in this body would be *refused*
         rather than ignored (`parseCheckoutRequest`), and no currency is sent
         at all — hosted Checkout picks one from the customer's location, which
         is the whole reason the price carries three. */
      leaveFor({ kind: "upgrade", tierId }, "/api/billing/checkout", { tierId });
    },
    [leaveFor],
  );

  const manage = useCallback(() => {
    /* No body worth sending: the only thing it could carry is a customer id,
       and that comes from the reader's own row. */
    leaveFor({ kind: "manage" }, "/api/billing/portal", {});
  }, [leaveFor]);

  return { summary, error, busy, actionError, checkout, upgrade, manage, reload };
}
```

## src/web/BillingSection.tsx (new, in full)

```ts
/**
 * **Plan and usage** — the half of `/profile` about what you may do, rather than
 * what the model knows about you.
 *
 * Until this landed the wall had no door on it from the browser: the quota
 * refused people and pointed at *"the Upgrade button on your profile page"*,
 * and there was no such button. Everything behind it already existed
 * (docs/project/billing.md); this is the surface.
 *
 * ## Two buttons, and neither of them is a billing UI
 *
 * **Upgrade** posts a tier id and follows the hosted Checkout Session that comes
 * back; **Manage billing** follows a hosted Customer Portal session. Invoices,
 * receipts, changing a card and cancelling are all the Portal's, on purpose —
 * card details never reach this server, which is what keeps us in Stripe's
 * lightest PCI scope. A proposal to draw any of that here is a proposal to take
 * on card-adjacent risk we have declined. Greg, 2026-09-02:
 *
 * > we don't want to process/touch/store sensitive info like card details.
 *
 * ## The prices come off the row, and there is no price on the wire
 *
 * Each card is a row of `billing_tiers` (`TierOffer`), so raising a quota or
 * changing an amount is an `UPDATE` and this page follows without a deploy.
 * Nothing here hardcodes a tier name, a quota or a price, and the POST carries
 * **only the tier id** — a price id from the browser is refused by the route
 * rather than ignored.
 *
 * All three currencies are shown at once rather than one guessed from the
 * locale, because hosted Checkout picks by the customer's location and this page
 * cannot know which they will be charged in. See `describeAmounts` in
 * src/billing-plan.ts.
 *
 * ## What the lapsed case must never say
 *
 * *"40 of 3 used"*. The free allowance is lifetime and includes paid months, so
 * a reader who took forty articles on Reader and cancelled is permanently past
 * it — that is the policy (Greg, 2026-09-03), but written as arithmetic it reads
 * as a bug. `describePlan` holds the words and the `lapsed` arm of `ReaderPlan`
 * has no `used` field at all, so this component could not print it if it tried.
 */
import { CreditCard, ExternalLink, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { describeAmounts, describePlan } from "../billing-plan.js";
import type { ReaderPlan, TierOffer } from "../billing-plan.js";
import { useBilling } from "./useBilling.js";

/**
 * Is there anything to sell this reader?
 *
 * **A paid plan hides the tier cards**, because upgrading between tiers is the
 * Portal's job — `startCheckout` redirects there rather than selling a second
 * subscription, so a row of Upgrade buttons that all lead to the same place
 * would be several spellings of *Manage billing*. Changing tier is one press
 * further in, in Stripe's own interface, which handles the proration we do not
 * want to.
 *
 * `off` and `exempt` keep them: a deployment with no Stripe has no offers to
 * show anyway (the list is empty), and an administrator is exempt from the
 * *quota*, not from being able to buy.
 */
function sellsTo(plan: ReaderPlan): boolean {
  return plan.kind !== "paid";
}

export function BillingSection() {
  const billing = useBilling();
  const { summary } = billing;

  if (!summary) {
    return (
      <p className="tw:m-0 tw:text-sm tw:text-muted-foreground" role="status">
        {billing.error ? (
          <span className="tw:inline-flex tw:items-center tw:gap-1 tw:text-highlight">
            <TriangleAlert size={12} /> Couldn't read your plan — {billing.error}{" "}
            <button type="button" className="linky" onClick={billing.reload}>
              Try again
            </button>
          </span>
        ) : (
          "Loading…"
        )}
      </p>
    );
  }

  const copy = describePlan(summary.plan);

  return (
    <div className="tw:flex tw:flex-col tw:gap-4">
      {/* ------------------------------------------------- what you are on -- */}
      <div className="tw:flex tw:flex-wrap tw:items-start tw:justify-between tw:gap-3">
        <div className="tw:min-w-0">
          <p className="tw:m-0 tw:text-sm tw:text-foreground">{copy.headline}</p>
          {copy.detail && (
            <p className="tw:mt-1 tw:mb-0 tw:text-xs tw:text-muted-foreground">{copy.detail}</p>
          )}
        </div>
        {/* **Only when the Portal has something to open.** It refuses an owner
            with no Stripe customer (409, `pay-none`), and a button whose only
            possible outcome is that refusal is worse than no button. */}
        {summary.manageable && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={billing.busy !== null}
            onClick={billing.manage}
          >
            <CreditCard size={13} />
            {billing.busy?.kind === "manage" ? "Opening…" : "Manage billing"}
          </Button>
        )}
      </div>

      {/* **A refresh that failed, over a plan that is still on screen.** The
          hook leaves `summary` alone when a reload fails, so this says the card
          above may be out of date rather than replacing a true answer with an
          empty one. */}
      {billing.error && (
        <p className="tw:m-0 tw:inline-flex tw:items-center tw:gap-1 tw:text-xs tw:text-highlight">
          <TriangleAlert size={12} /> This may be out of date — {billing.error}
        </p>
      )}

      <CheckoutReturnNote billing={billing} />

      {/* ------------------------------------------------------ what to buy -- */}
      {sellsTo(summary.plan) && summary.offers.length > 0 && (
        <div className="tw:flex tw:flex-col tw:gap-2">
          {summary.offers.map((offer) => (
            <Offer
              key={offer.id}
              offer={offer}
              busy={billing.busy !== null}
              pressed={billing.busy?.kind === "upgrade" && billing.busy.tierId === offer.id}
              onUpgrade={() => billing.upgrade(offer.id)}
            />
          ))}
          {/* Said once, under the cards, because it is true of all of them and
              because a reader looking at three prices will ask which one they
              pay. */}
          <p className="tw:m-0 tw:text-xs tw:text-ink-faint">
            Stripe charges in the currency for your location, and takes the card details — they
            never reach us. Invoices, changing a card and cancelling are all in Stripe's own billing
            page, reached from the button above; a cancellation ends at the end of the month you
            have paid for.
          </p>
        </div>
      )}

      {billing.actionError && (
        <p className="tw:m-0 tw:inline-flex tw:items-center tw:gap-1 tw:text-xs tw:text-highlight">
          <TriangleAlert size={12} /> {billing.actionError}
        </p>
      )}
    </div>
  );
}

/** One tier: what it costs, what it allows, and the button that buys it. */
function Offer({
  offer,
  busy,
  pressed,
  onUpgrade,
}: {
  offer: TierOffer;
  /** Any button on the section is mid-request, so none of them may be pressed. */
  busy: boolean;
  /** This one is the one being pressed, so only this one says so. */
  pressed: boolean;
  onUpgrade: () => void;
}) {
  return (
    <div className="tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-3 tw:rounded-md tw:border tw:border-border tw:bg-background tw:p-3">
      <div className="tw:min-w-0">
        <p className="tw:m-0 tw:text-sm tw:text-foreground">
          {offer.name}
          <span className="tw:text-ink-faint">
            {" · "}
            {describeAmounts(offer.amounts)} a month
          </span>
        </p>
        {/* **The row's own `description` and nothing else.** It was
            `{ingestsPerPeriod} articles a month. {description}` for an hour,
            which read *"20 articles a month. 20 articles a month. Reading what
            you have already added is always free."* on the real rows — the
            allowance is already the first sentence of every description, because
            that is what billing.md's *add a tier* recipe writes. Adding a
            structured copy of it beside the prose is a second source of truth
            for the same number, with the doubling as the visible symptom.
            `ingestsPerPeriod` is still on the wire, for a caller that wants the
            number rather than the sentence. */}
        <p className="tw:mt-0.5 tw:mb-0 tw:text-xs tw:text-muted-foreground">
          {offer.description}
        </p>
      </div>
      <Button type="button" disabled={busy} onClick={onUpgrade}>
        {pressed ? "Opening Stripe…" : "Upgrade"}
        {!pressed && <ExternalLink size={13} />}
      </Button>
    </div>
  );
}

/**
 * What happened on the way back from Stripe.
 *
 * Four states and none of them is an alarm.
 *
 * **`unconfirmed` does not say a payment was taken**, and the temptation to
 * write that sentence is why this comment exists: the reader arrived from
 * Stripe, so it *usually* was — but the confirmation failing is exactly the case
 * where we do not know. It might be a session that was never paid for, or one
 * that is not theirs, or Stripe having a bad minute. What is true either way is
 * that the webhook is the mechanism and this is only a convenience, so a real
 * subscription will appear here on its own within seconds.
 */
function CheckoutReturnNote({ billing }: { billing: ReturnType<typeof useBilling> }) {
  const { checkout } = billing;
  if (checkout.kind === "none") return null;

  const words =
    checkout.kind === "cancelled"
      ? "That checkout was cancelled, and nothing has been charged."
      : checkout.kind === "checking"
        ? "Checking with Stripe…"
        : checkout.kind === "confirmed"
          ? "Thank you — your subscription is set up."
          : "We couldn't check that with Stripe from here. If the payment went through, the plan " +
            `above will catch up within a few seconds — reload to look again. (${checkout.why})`;

  return (
    <p className="tw:m-0 tw:rounded-md tw:border tw:border-border tw:bg-background tw:px-3 tw:py-2 tw:text-xs tw:text-muted-foreground">
      {words}
    </p>
  );
}
```

## src/web/QuotaNotice.tsx (new, in full)

```ts
/**
 * An ingest failure, **with the way out of it beside the sentence** when the
 * failure is the quota.
 *
 * The refusal copy already names the way forward — *"the Upgrade button on your
 * profile page sets one up"* (`ingestQuotaReached`, src/messages.ts) — and until
 * this existed that sentence was the whole of it: the reader was told where to
 * go and given nothing to press. A line of prose pointing at a page is a worse
 * version of a link to that page.
 *
 * ## One component, three surfaces
 *
 * `POST /api/jobs` refuses with 402 and `POST /api/uploads` refuses at the door
 * with the same message, so the same refusal can land in three places: the add
 * box on the shelf (AddArticle.tsx), the add page a pasted URL navigates to
 * (AddPage.tsx), and the upload picker (UploadPicker.tsx). Three renderings of
 * one refusal are three chances for two of them to stop offering the link.
 *
 * ## Only the quota gets a link
 *
 * `isQuotaRefusal` reads the bracketed code, not the prose and not the status —
 * see it for why. Everything else this can be handed, from a 500 to an
 * unreachable Stripe, renders as the plain sentence it already was: a link to
 * `/profile` under *"we could not reach Stripe"* would send somebody to buy
 * their way out of an outage.
 */
import { ArrowRight } from "lucide-react";

import { isQuotaRefusal } from "../messages.js";
import { Link } from "./Link.js";
import { PROFILE_HREF } from "./router.js";

/**
 * @param message the server's own sentence, or null for nothing to say.
 * @param className the caller's own text treatment. Each of the three surfaces
 * already has one and they are not the same — the add page's error is `text-sm`,
 * the add box's is `text-xs` — so this component sets no size or colour of its
 * own rather than making two of them wrong.
 */
export function QuotaNotice({
  message,
  className,
}: {
  message: string | null | undefined;
  className: string;
}) {
  if (!message) return null;
  if (!isQuotaRefusal(message)) return <p className={className}>{message}</p>;

  return (
    <p className={className}>
      {message}{" "}
      {/* A real `Link`, so it is a middle-click-able address rather than a
          button that only works with a plain click — and the client router
          handles it without a reload. The label says what is on the other end
          rather than "click here": for a lapsed or a monthly-limit refusal the
          page is where you resubscribe or see the reset date, and "Your plan"
          is true of all three cases where a free-account "Upgrade" would not
          be. */}
      <Link href={PROFILE_HREF} className="tw:inline-flex tw:items-center tw:gap-1 tw:text-highlight">
        Your plan
        <ArrowRight size={12} />
      </Link>
    </p>
  );
}
```

## The test files

Not quoted, to keep this under the argv limit. They are on disk if you want them:
`tests/billing-plan.test.ts`, `tests/billing-usage-route.test.ts`,
`tests/billing-admin-plan.test.ts`, `tests/quota-notice.test.tsx`, and the three cases added to
`tests/refused-job-reason-survives.test.tsx` (visible in the diff above).
