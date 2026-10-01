## Findings

1. **P1 — The upgrade row is safe for enforcement, but not for every reporting/display contract.**

The plan says existing readers can count the new row unchanged as an “article-worth” ([plan:95](/home/greg/code/spideryarn2/.claude/worktrees/fb6c2-high-power-for-readers/docs/plans/260930k-high-power-for-readers-and-cost-only-for-admins.md:95)). That conflicts with code that explicitly defines each row as an ingest:

- `ingestsUsed` is documented as a count of ingests ([pg-billing.ts:276](/home/greg/code/spideryarn2/.claude/worktrees/fb6c2-high-power-for-readers/src/store/pg-billing.ts:276)).
- `ReaderPlan.used` means “how many ingests” ([billing-plan.ts:67](/home/greg/code/spideryarn2/.claude/worktrees/fb6c2-high-power-for-readers/src/billing-plan.ts:67)).
- `/profile` says “N articles added” and “N of M articles” ([billing-plan.ts:504](/home/greg/code/spideryarn2/.claude/worktrees/fb6c2-high-power-for-readers/src/billing-plan.ts:504), [billing-plan.ts:514](/home/greg/code/spideryarn2/.claude/worktrees/fb6c2-high-power-for-readers/src/billing-plan.ts:514)).
- Worse, `sharedHalfPrice` becomes the number of public *charge rows*. One public high-powered article therefore produces “2 of them are public” ([billing-plan.ts:423](/home/greg/code/spideryarn2/.claude/worktrees/fb6c2-high-power-for-readers/src/billing-plan.ts:423)).
- `/admin/users` counts every settled row as an ingest ([pg-admin.ts:500](/home/greg/code/spideryarn2/.claude/worktrees/fb6c2-high-power-for-readers/src/store/pg-admin.ts:500)); its DTO promises “Successful ingests” ([admin.ts:363](/home/greg/code/spideryarn2/.claude/worktrees/fb6c2-high-power-for-readers/src/admin.ts:363)), and its tooltip says they were “added” ([admin-columns.tsx:246](/home/greg/code/spideryarn2/.claude/worktrees/fb6c2-high-power-for-readers/src/web/admin-columns.tsx:246)).
- Existing pricing copy still says one URL/file is counted once and the monthly allowance is articles added ([PricingPage.tsx:285](/home/greg/code/spideryarn2/.claude/worktrees/fb6c2-high-power-for-readers/src/web/PricingPage.tsx:285), [PricingPage.tsx:333](/home/greg/code/spideryarn2/.claude/worktrees/fb6c2-high-power-for-readers/src/web/PricingPage.tsx:333)).

Exhaustive reader audit:

| Reader | Result with an upgrade row |
|---|---|
| `usageSql` / `usageFor` | Correct enforcement arithmetic: all settled charge rows should count ([pg-billing.ts:395](/home/greg/code/spideryarn2/.claude/worktrees/fb6c2-high-power-for-readers/src/store/pg-billing.ts:395)). |
| `reserveIngest`, `ingestEligibility`, `atTheWall` | Correct: future ingests see the extra charge ([pg-billing.ts:562](/home/greg/code/spideryarn2/.claude/worktrees/fb6c2-high-power-for-readers/src/store/pg-billing.ts:562), [pg-billing.ts:612](/home/greg/code/spideryarn2/.claude/worktrees/fb6c2-high-power-for-readers/src/store/pg-billing.ts:612), [pg-billing.ts:852](/home/greg/code/spideryarn2/.claude/worktrees/fb6c2-high-power-for-readers/src/store/pg-billing.ts:852)). |
| Billing summary | Enforcement and `remaining` are correct; `used`, `sharedHalfPrice`, and their prose are not ([summary.ts:209](/home/greg/code/spideryarn2/.claude/worktrees/fb6c2-high-power-for-readers/src/billing/summary.ts:209)). |
| Lapsed detection | Safe: `hasLapsed` reads only the billing account; lapsed `remaining` correctly includes the charge ([pg-billing.ts:589](/home/greg/code/spideryarn2/.claude/worktrees/fb6c2-high-power-for-readers/src/store/pg-billing.ts:589), [summary.ts:252](/home/greg/code/spideryarn2/.claude/worktrees/fb6c2-high-power-for-readers/src/billing/summary.ts:252)). |
| Share offer | Correct for making room for an ordinary ingest: it groups all charge rows by article, so a high-powered article frees two half-units ([pg-billing.ts:744](/home/greg/code/spideryarn2/.claude/worktrees/fb6c2-high-power-for-readers/src/store/pg-billing.ts:744)). |
| Unshare warning | Safe: it is conditional prose and remains true for either kind of charge ([AccessSharing.tsx:522](/home/greg/code/spideryarn2/.claude/worktrees/fb6c2-high-power-for-readers/src/web/AccessSharing.tsx:522)). |
| Admin aggregate | Arithmetic is correct, but “Ingests” and “N added” become false. |
| `settleReservation` | Safe: it can only update the supplied reservation ID, and an already-settled upgrade row would fail rather than move ([pg-billing.ts:1045](/home/greg/code/spideryarn2/.claude/worktrees/fb6c2-high-power-for-readers/src/store/pg-billing.ts:1045)). |
| `releaseReservation(s)` / `reportUnreleased` | Safe: they only receive IDs held by admission/jobs and only move unsettled rows ([pg-billing.ts:945](/home/greg/code/spideryarn2/.claude/worktrees/fb6c2-high-power-for-readers/src/store/pg-billing.ts:945), [pg-billing.ts:1109](/home/greg/code/spideryarn2/.claude/worktrees/fb6c2-high-power-for-readers/src/store/pg-billing.ts:1109), [pg-billing.ts:1150](/home/greg/code/spideryarn2/.claude/worktrees/fb6c2-high-power-for-readers/src/store/pg-billing.ts:1150)). |
| Shelf’s stranded-reservation query | Safe: it inner-joins jobs and requires an unsettled event; an upgrade matches neither ([pg-shelf.ts:278](/home/greg/code/spideryarn2/.claude/worktrees/fb6c2-high-power-for-readers/src/store/pg-shelf.ts:278)). |
| Export | Safe from leaking the row because `ingest_events` is excluded, but its “one row per attempt to spend/add” rationale becomes stale ([article-rows.ts:313](/home/greg/code/spideryarn2/.claude/worktrees/fb6c2-high-power-for-readers/src/store/article-rows.ts:313)). |
| Existing fixtures | A non-null default of `ingest` preserves existing inserts, but reporting fixtures need explicit high-power cases. |
| Delete trigger | Safe: it updates every row for the article, including the upgrade ([migration:57](/home/greg/code/spideryarn2/.claude/worktrees/fb6c2-high-power-for-readers/drizzle/20260907200800_ingest_events_unlink_atomically.sql:57)). |
| Constraints | Mechanically safe, subject to finding 6 below. |

**Fix:** keep one ledger table, but make its readers kind-aware. Enforcement may aggregate both kinds; display/reporting must either split `ingest` and `high_power` counts or consistently rename the numbers to allowance charges/article-equivalents. In particular, never derive “N public articles” from public charge rows. Update the admin DTO/column, billing-summary copy, pricing copy, schema comments, export rationale, and tests.

2. **P2 — The high-power refusal must not reuse the existing share offer unchanged.**

The strict upgrade rule is correctly `used + cost <= budget` ([plan:74](/home/greg/code/spideryarn2/.claude/worktrees/fb6c2-high-power-for-readers/docs/plans/260930k-high-power-for-readers-and-cost-only-for-admins.md:74)), but `articlesToShare` stops as soon as sharing makes `used < budget`, because that is the ordinary ingest wall ([pg-billing.ts:750](/home/greg/code/spideryarn2/.claude/worktrees/fb6c2-high-power-for-readers/src/store/pg-billing.ts:750), [pg-billing.ts:782](/home/greg/code/spideryarn2/.claude/worktrees/fb6c2-high-power-for-readers/src/store/pg-billing.ts:782)).

At `used=budget`, sharing one ordinary private charge frees one half-unit. That admits another ordinary ingest under the deliberate overdraft rule, but it does **not** leave room for a private high-power charge costing two. Reusing the offer would tell a reader to publish an article without making the switch succeed. Sharing the target article is subtler again because it reduces both existing usage and the prospective upgrade price.

**Fix:** specify the refusal path. The simplest safe v1 is not to attach `shareToMakeRoom` to high-power refusals; return a high-power-specific 402 without a publishing recommendation. If an offer is wanted, parameterize the calculation around the exact post-share admission predicate and prospective target visibility, rather than reusing `used - freed < budget`.

3. **P1 — The cost audit misses a current reader-visible leak in `/changelog`.**

The committed changelog tells every visitor that Illustrated costs `$0.40–$0.65` and previously `$0.27–$0.40` ([changelog-versions.ndjson:52](/home/greg/code/spideryarn2/.claude/worktrees/fb6c2-high-power-for-readers/src/web/changelog-versions.ndjson:52)). That file is imported raw and rendered on the public changelog page ([ChangelogPage.tsx:11](/home/greg/code/spideryarn2/.claude/worktrees/fb6c2-high-power-for-readers/src/web/ChangelogPage.tsx:11), [ChangelogPage.tsx:116](/home/greg/code/spideryarn2/.claude/worktrees/fb6c2-high-power-for-readers/src/web/ChangelogPage.tsx:116)).

`/features` currently contains no amount, and the proposed entry is safe. Server spend fields go only to logs; the fleet is a separate operator surface, not a reader route. Current email notifications containing operational information go only to the admin ([email.ts:153](/home/greg/code/spideryarn2/.claude/worktrees/fb6c2-high-power-for-readers/src/email.ts:153)). Route-local error bodies presently contain no AI-cost amount.

**Fix:** add the changelog to the audit table and remove or generalize that historical amount. Explicitly record `/features`, `/changelog`, route-local errors, emails, server logs, and the fleet in the audit so their inclusion or exclusion is deliberate.

4. **P1 — The proposed no-leak guard can pass over the main class of leak.**

The JSON walker examines only keys matching `cost|spend|nanos|usd|price` ([plan:236](/home/greg/code/spideryarn2/.claude/worktrees/fb6c2-high-power-for-readers/docs/plans/260930k-high-power-for-readers-and-cost-only-for-admins.md:236)). It misses:

```json
{ "message": "Illustrating this costs about $0.20" }
```

It also samples five responses rather than “every non-admin response,” omitting stream frames and route-local error bodies. The source scan only recognizes `$` and `£`, missing `€0.20`, `USD 0.20`, `20¢`, or “twenty cents” ([plan:248](/home/greg/code/spideryarn2/.claude/worktrees/fb6c2-high-power-for-readers/docs/plans/260930k-high-power-for-readers-and-cost-only-for-admins.md:248)). Its admin-route control proves only that the JSON key matcher sees `creditsNanos`; it does not prove the value matcher or source scanner works.

The actual sensitive endpoint is correctly protected by the central namespace gate ([routes.ts:9735](/home/greg/code/spideryarn2/.claude/worktrees/fb6c2-high-power-for-readers/src/routes.ts:9735), [routes.ts:9765](/home/greg/code/spideryarn2/.claude/worktrees/fb6c2-high-power-for-readers/src/routes.ts:9765)), with an existing direct non-admin test ([admin-article-cost-route.test.ts:181](/home/greg/code/spideryarn2/.claude/worktrees/fb6c2-high-power-for-readers/tests/admin-article-cost-route.test.ts:181)). There is no second non-admin route to the “What it cost” data.

**Fix:** recursively inspect both keys and string values; recognize symbols, currency codes, cents/pence, and written currency words. Give the response matcher and source scanner separate synthetic positive controls. Retain the existing explicit 403/no-store-call test for the admin endpoint. Include the raw changelog asset in the source scan, and describe the response test as a targeted DTO audit unless it genuinely enumerates every route and stream.

5. **P1 — The privacy test still does not cover every production model.**

The general-wording table preserves coverage for models already in `DISPLAY_NAME`, but that inventory is incomplete. `DISPLAY_NAME` claims to contain every sendable model ([models.ts:1409](/home/greg/code/spideryarn2/.claude/worktrees/fb6c2-high-power-for-readers/src/models.ts:1409)), while the image model `google/gemini-3.1-flash-image` is absent. That model is sent to OpenRouter ([illustrated.ts:179](/home/greg/code/spideryarn2/.claude/worktrees/fb6c2-high-power-for-readers/src/illustrated.ts:179), [illustrated.ts:351](/home/greg/code/spideryarn2/.claude/worktrees/fb6c2-high-power-for-readers/src/illustrated.ts:351)). The “every model” test omits `IMAGE_MODEL` from its sendable list ([models.test.ts:142](/home/greg/code/spideryarn2/.claude/worktrees/fb6c2-high-power-for-readers/tests/models.test.ts:142)), so the privacy test necessarily misses it too ([privacy-page.test.ts:83](/home/greg/code/spideryarn2/.claude/worktrees/fb6c2-high-power-for-readers/tests/privacy-page.test.ts:83)).

**Fix:** add `IMAGE_MODEL` to a central production-model inventory and to `DISPLAY_NAME`, then make both model-inventory and privacy tests iterate that complete inventory. Keep live models’ separate extraction, but do not let image jobs sit outside the checked set.

6. **P2 — The database does not enforce the promised shape of a `high_power` row.**

The proposed migration adds a kind check and unique index, but nothing described prevents a `high_power` row from being unsettled, released, or carrying neither a live article nor a frozen price. Existing constraints only enforce one terminal timestamp and terminal time ordering ([schema.ts:4992](/home/greg/code/spideryarn2/.claude/worktrees/fb6c2-high-power-for-readers/src/db/schema.ts:4992), [schema.ts:4997](/home/greg/code/spideryarn2/.claude/worktrees/fb6c2-high-power-for-readers/src/db/schema.ts:4997)). Such a malformed row would be counted as an in-flight ingest by every usage reader.

Also, `reserved_at = succeeded_at = now()` passes `ingest_events_settled_after_reserved` only if both values use the database clock in the same statement. Existing release code deliberately uses PostgreSQL `now()` because host-clock skew can violate this constraint ([pg-billing.ts:945](/home/greg/code/spideryarn2/.claude/worktrees/fb6c2-high-power-for-readers/src/store/pg-billing.ts:945)).

**Fix:** add a kind-shape constraint requiring a high-power row to have `succeeded_at IS NOT NULL`, `released_at IS NULL`, `reserved_at = succeeded_at`, and either a live `article_id` or a frozen deletion visibility. Insert both timestamps with one SQL `now()`, not two JavaScript dates or a default plus host time.

7. **P2 — The test list omits the exact paid-period regression that motivated this charge event.**

The design correctly timestamps the upgrade when switched on, fixing the earlier wrong-period problem ([previous plan:338](/home/greg/code/spideryarn2/.claude/worktrees/fb6c2-high-power-for-readers/docs/plans/260930f-high-powered-ai-per-article.md:338)). But Stage A’s tests do not include an old ingest upgraded in the current paid period ([plan:258](/home/greg/code/spideryarn2/.claude/worktrees/fb6c2-high-power-for-readers/docs/plans/260930k-high-power-for-readers-and-cost-only-for-admins.md:258)). Paid usage is determined solely from each row’s `succeeded_at` ([pg-billing.ts:450](/home/greg/code/spideryarn2/.claude/worktrees/fb6c2-high-power-for-readers/src/store/pg-billing.ts:450)).

**Fix:** add a real-database regression with the base ingest before the current Stripe period and the high-power event inside it; assert only the upgrade counts this month. Add a half-open boundary case at `periodStart`/`periodEnd`.

## Remaining answers

Dropping `isAdmin` from `articlePower` is acceptable after the atomic route lands. The only runtime writer today is `pgHighPowerStore.set` ([pg-high-power.ts:35](/home/greg/code/spideryarn2/.claude/worktrees/fb6c2-high-power-for-readers/src/store/pg-high-power.ts:35)), called by the one route ([routes.ts:7225](/home/greg/code/spideryarn2/.claude/worktrees/fb6c2-high-power-for-readers/src/routes.ts:7225)). Copy/export/restore paths do not write the column; direct production SQL remains the stated operator risk. Remove the now-unused `ownerId` parameter from `articlePower` so all callers visibly adopt the new rule. Public payloads already null the field ([article/access.ts:353](/home/greg/code/spideryarn2/.claude/worktrees/fb6c2-high-power-for-readers/src/web/article/access.ts:353)).

The core admission check is right: private cost 2, public cost 1, and no ingest-style overdraft. Entitlement must be derived from the locked billing row; Stripe resync must happen after that transaction has committed, followed by one complete retry, then 503 if still stale. That matches the existing pattern ([admission.ts:155](/home/greg/code/spideryarn2/.claude/worktrees/fb6c2-high-power-for-readers/src/billing/admission.ts:155)).

I found no unintended charge/refund loophole in the proposed transaction:

- On → off → on retains one charge row and never refunds.
- Sharing reprices both rows live; unsharing restores the full price and may leave the account over quota. Temporarily sharing and later unsharing is the existing public-discount policy, not a refund, though free unlimited reruns remain the deliberate residual spend exposure.
- Deletion freezes both prices and refunds nothing.
- Re-adding while the same article exists sees the same unique upgrade row. Re-adding after deletion creates a new article ID and correctly incurs a new ingest and upgrade; the old frozen charges remain.
- Billing-account then article locking serializes concurrent switch-ons, sharing, deletion, and ingest admission; the unique partial index is the final duplicate-charge guard.
- Settlement locks the article before settling its event ([pg-session.ts:691](/home/greg/code/spideryarn2/.claude/worktrees/fb6c2-high-power-for-readers/src/store/pg-session.ts:691)). A racing switch either sees the unsettled row at its conservative full in-flight price or the committed settled row; it cannot miss both.
- Power is read once per step ([jobs.ts:2157](/home/greg/code/spideryarn2/.claude/worktrees/fb6c2-high-power-for-readers/src/jobs.ts:2157)). Turning off cannot change a step already running, but that step was already paid for; later steps see the new setting.

The simplest design remains one `ingest_events` table with a `kind`, not a second charge table. The simplification the plan should take is narrower: keep enforcement shared, split reporting by kind, use a high-power-specific refusal without a share recommendation in v1, and use focused leak guards plus the existing admin authorization test.

**Verdict:** build with changes. The locking, one-time charge, strict admission arithmetic, deletion freeze, and removal of the `articlePower` admin check are sound. Before building, the plan needs to make ledger reporting kind-aware, define the high-power refusal separately, close the changelog leak, strengthen the leak guard, cover the image model in Privacy, enforce the high-power row shape, and add the paid-period regression.