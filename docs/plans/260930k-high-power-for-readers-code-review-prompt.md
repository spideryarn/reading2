# Code review: 260930k — High-powered AI for readers, and AI cost for the admin only

You are reviewing **built code**, commit `3b515253`. The scoped diff against the base is in
`docs/plans/260930k-code-review.diff`, and the working tree is that commit.

It touches money (the ingest quota) and a security boundary (who may see AI cost). **Weight these
above everything else:**

- correctness;
- loopholes;
- atomicity;
- data leaks.

## Read these first

- The plan: `docs/plans/260930k-high-power-for-readers-and-cost-only-for-admins.md`, including
  "What the plan review changed" and "Defences touched".
- Your own plan review, whose findings this was meant to address:
  `docs/plans/260930k-high-power-for-readers-plan-review-sol.md`.

## Greg's rulings, which are authoritative

- "it should double the processing cost per-article"
- /privacy: keep it general — "Opus or similar frontier model"
- "that cost information should only be available to me (i.e. admin users). i don't want any
  regular users to know how much AI processing of their articles costs"

## What changed, where

- **Billing.**
  - `src/store/pg-billing.ts`: `Usage` split by kind, `usageSql`, `halfUnitsUsed`, and the new
    `switchOnHighPower`.
  - `src/billing/admission.ts`: `chargeAndSwitchOnHighPower`, and `resyncAndRetry` generalised.
  - The migration `drizzle/20260930225042_ingest_events_kind.sql` and the matching changes in
    `src/db/schema.ts`.
  - `src/messages.ts`: `highPowerNoRoom`.
- **The route.** `src/routes.ts`: `PUT /api/article/:slug/high-power`. The old admin route is
  removed.
- **Model selection.** `src/models.ts` `articlePower`, and its callers.
- **Display.**
  - `src/billing/summary.ts` and `src/billing-plan.ts`: `highPower` and its copy.
  - `src/store/pg-admin.ts`, `src/admin.ts` and `src/web/admin-columns.tsx`: the admin split.
- **Client and copy.**
  - `src/web/HighPowerSwitch.tsx`;
  - `src/web/PricingPage.tsx` and `src/web/FeaturesPage.tsx`;
  - `src/web/PrivacyPage.tsx`.
- **Cost-leak fixes.**
  - `sketch-cost.ts`, `IllustratedView.tsx`, `SketchView.tsx`, `Metadata.tsx`, `DiagramPanel.tsx`,
    `ResetArticle.tsx`;
  - `changelog-versions.ndjson`;
  - `export-bundle.ts` and `article-rows.ts`.
- **Tests.**
  - `tests/billing-high-power.test.ts`, which runs against a real database;
  - `tests/no-ai-cost-for-readers.test.ts`;
  - `tests/high-power-routes.test.ts`, `tests/high-power-step.test.ts`;
  - `tests/privacy-page.test.ts`, `tests/models.test.ts`;
  - `tests/billing-plan.test.ts`, `tests/metadata-high-power-switch.test.tsx`.

## Questions to answer specifically

1. **Can a reader get Opus without paying, pay twice, or get a refund?** Check every path that can
   set `high_power_since` or change the price of an upgrade row. Include:
   - a switch-on racing a visibility change, an ingest settlement, or an article delete;
   - the stale path, the resync path and the 503;
   - any path that returns `on` without having charged for a non-admin.
2. **Is the transaction right?** Check the lock order, `read committed`, and that nothing in the
   locked section opens its own transaction or touches the network. Check that `now()` makes
   `reserved_at = succeeded_at`, and that the unlocked probe cannot mint an anchor row for a
   stranger's slug.
3. **Does every reader of `ingest_events` handle `kind` correctly?** That means enforcement, the
   display counts, admin, the share offer, settlement and release. In particular: is `in_flight`
   still right, and could a `high_power` row ever be counted as in flight or released?
4. **The route.** Is the owner scoping right now that it has left `/api/admin`? Is the admin
   exemption right? Does switch-off go through the uncharged path for everyone? Are the status codes
   and the no-store header correct?
5. **The cost-leak audit and guard.** Can any AI cost figure still reach a non-admin — a response,
   stream, copy, email, export, changelog or error? Is the guard test strong? Does each half have a
   real control? Its own report said the scan covers only `src/web/**`, `src/messages.ts` and raw
   assets under `src/web`, not shared modules the client imports from elsewhere in `src/` (such as
   `src/billing-plan.ts` and `src/mode-catalog.ts`). Should it?
6. **The /profile and admin copy.** Is it truthful for every combination of:
   - ingests, public ingests and upgrades;
   - free, paid and lapsed accounts;
   - an account over its allowance?
7. **The privacy page** and its test's approved-wording table.
8. **Type-level and test quality.** Could any new test pass while the thing it guards is broken?

## How to answer

Since 2026-09-09 **you fix what you find, inside this change**: edit the files directly (workspace-write).

- Keep fixes narrow.
- Add or adjust tests red-first where you can.
- Do not commit.
- Do not touch the database outside tests.
- Report anything wider than this change, or any product decision, instead of doing it.

Your final answer lists each finding, then the fix you made (or why you made none), with file:line:

- tag each finding P0, P1, P2 or P3;
- list the files you edited;
- end with a verdict paragraph.
