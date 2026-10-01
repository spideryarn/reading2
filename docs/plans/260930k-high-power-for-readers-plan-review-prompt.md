# Plan review: 260930k — High-powered AI for readers, and AI cost for the admin only

You are reviewing a PLAN, not code. Read the plan first:
docs/plans/260930k-high-power-for-readers-and-cost-only-for-admins.md

It touches money (the ingest quota) and a security boundary (who may see AI cost). Weight these above
style:

- the billing arithmetic;
- atomicity and locking;
- loopholes.

## Background: read it, don't trust the plan's summary of it

- **docs/project/billing.md**, especially these sections:
  - "The quota, and the one thing it has to survive"
  - "A public article counts half"
  - "Deleting an article freezes its price"
  - "Which requests spend a slot"
- **src/store/pg-billing.ts**: usageSql, isPublicPrice, articlesToShare, lockBillingAccount,
  reserveIngest, settleReservation, releaseReservations.
- **src/billing/admission.ts** and **src/billing/half-units.ts**.
- **src/store/pg-visibility.ts**, the lock-order pattern the plan copies.
- **The ingest_events table**: `ingestEvents` in src/db/schema.ts, and the drizzle migrations for it.
  These include the delete-freeze trigger and `ingest_events_require_price_on_unlink`.
- **Anything that counts ingest_events** in src/store/pg-admin.ts, plus src/billing/summary.ts.
- **The high-power code path**:
  - src/store/pg-high-power.ts;
  - `articlePower` in src/models.ts;
  - `readStepPower` in src/jobs.ts;
  - the high-power admin route and the visibility route in src/routes.ts.
- **docs/plans/260930f-high-powered-ai-per-article.md § Deferred.** This is the previous plan's
  analysis, including your own earlier finding F3 about charging the wrong period.
- **The UI and copy**:
  - src/web/HighPowerSwitch.tsx;
  - src/web/Metadata.tsx (RerunSection, RERUN_COST_NOTE);
  - src/web/sketch-cost.ts, src/web/IllustratedView.tsx, src/web/ResetArticle.tsx;
  - src/web/PrivacyPage.tsx and tests/privacy-page.test.ts.

## Greg's rulings, which are authoritative

- "it should double the processing cost per-article - that's how I'd think about it."
- Privacy: "keep it a bit general, e.g. 'Opus or similar frontier model'"
- "that cost information should only be available to me (i.e. admin users). i don't want any regular
  users to know how much AI processing of their articles costs"

## Questions to answer specifically

1. **Is an upgrade row safe for every reader of ingest_events?** The plan models the upgrade as an
   `ingest_events` row with `kind='high_power'`, inserted already settled, with article_id set.
   Enumerate every query and function in src/ that reads ingest_events, and say for each whether an
   upgrade row breaks its contract. Cover at least:
   - the admin page;
   - the billing summary;
   - the lapsed logic;
   - the share offer;
   - the unshare warning;
   - settlement and release;
   - export and fixtures;
   - triggers and constraints — for example `ingest_events_settled_after_reserved`, given
     reserved_at = succeeded_at = now().
2. **Is there any loophole?** Look for a way a reader could:
   - get Opus runs without paying;
   - pay twice for one article;
   - get a refund.

   Try at least:
   - switching on, off, then on again;
   - sharing or unsharing around the switch;
   - deleting the article;
   - re-adding the URL;
   - concurrent requests;
   - a switch-on racing an ingest's settlement for the same article;
   - the job runner reading power once per step.
3. **Is it acceptable to drop the isAdmin condition from articlePower** (decision 6)? Can any path
   besides the new route set high_power_since?
4. **Is the admission check right?** That is the strict `used + cost <= budget`, including the
   stale-entitlement resync and the 503.
5. **Is the cost-leak audit complete?** Does the table miss anything, such as:
   - server messages, emails, error bodies;
   - logs shown to the reader;
   - the fleet, the changelog, /features;
   - another way for a non-admin to reach the route behind the "What it cost" section?

   Is the proposed guard test strong enough, and does its control actually work?
6. **Does the privacy test still cover every model?** The plan adds an "approved general wording"
   table. Does every model the app can send to still have to be covered?
7. **Is there anything simpler** that gets the same result?

## How to answer

Give numbered findings. For each:

- tag it P0, P1, P2 or P3;
- cite file:line;
- give a concrete fix.

End with a one-paragraph verdict: build as planned, build with changes, or rethink.

Do not edit any file.
