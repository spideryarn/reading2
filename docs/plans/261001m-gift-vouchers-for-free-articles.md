# Gift vouchers: extra free articles, given by email

Report `spya-vp4mdn`, from Greg (admin, trusted input), 2026-10-01. Up:
[billing.md](../project/billing.md), [admin.md](../project/admin.md).

> I'd like to be able to give somebody a gift voucher (e.g. 20 free articles).
>
> Perhaps it's a voucher code that I provide them that they type in somewhere? Actually better still
> add a new page in `/admin` where I can enter their email address (and if they log in or are
> already logged in with that email address, it automatically & permanently increases their
> allotment of articles that they can process while still on the Free pricing plan, and indicates to
> them during login that this has been applied.) That /admin/vouchers page should show existing
> vouchers that have been created, which have been claimed and how used, allow me to edit/invalidate
> them, etc.
>
> If we don't already, we should indicate somewhere on the logged-in Homepage for free users how
> many free articles used & remaining, plus default-collapsed section:
> - Brief explanation of how free articles & pricing works, with link to page with more information
> - Linking to Pricing page
> - Linking/explaining how to upgrade
> - if they have a voucher, show it and its status. Perhaps indicate this prominently with a little
>   icon next to the "Remaining" count so it's easy to see at a glance that a voucher has been
>   applied.
> - If they don't have a voucher, don't mention vouchers at all
> - (plus anything else you can think of)
> - etc
>
> — Greg, 2026-10-01

And from the brief that dispatched this run: *"a voucher may only be created by an admin,
server-side, and must never let a reader raise their own allowance … an email with no account yet is
held until sign-up. Any schema change is additive. Keep the v1 small; the free-articles summary box
on the homepage is part of it."*

## What we are building (v1)

1. **A voucher is a row**: an email address, a number of extra articles, an optional private note,
   who made it and when, and — once claimed — which account claimed it and when, and whether it has
   been revoked.
2. **Claiming binds it to an account, once.** When a signed-in reader whose *verified* address
   matches an unclaimed, unrevoked voucher asks for their plan (`GET /api/billing/usage`, which the
   homepage reads on arrival), the voucher is stamped with their account id. From then on it belongs
   to the account, not the address — an address can change, an id cannot (admin.md § Who the
   administrator is, same reasoning). An address with no account yet simply waits: the voucher sits
   unclaimed until somebody signs up with it.
3. **While on Free, the allowance is 3 + the claimed, unrevoked vouchers.** Computed live from the
   table at the one place entitlement is decided (`entitlementFromRow`), so the wall, `/profile`,
   `/pricing`, `/admin/users` and the new box all agree. Paid tiers are unaffected; a lapsed reader
   is back on Free and gets the bonus back.
4. **`/admin/vouchers`**: create (email, articles, note); a table of every voucher with its status
   (waiting / claimed by whom, when / revoked) and, for a claimed one, the claimant's current free
   usage; edit the article count and note; change the address only while unclaimed; revoke and
   restore.
5. **The homepage box**, for free (and lapsed) readers only: what is used and what remains, said the
   way `isRatio` allows (see F3 in the log — never a false *N of M*, never `limit − used`), with a
   small gift icon beside *remaining* when a voucher is in it, and a collapsed *How free articles
   work* section: the lifetime allowance, public-counts-half, link to `/pricing`, how to upgrade,
   and — only when they have one — the voucher(s) and their status. For a few days after a claim the
   box also shows a one-line *A gift of 20 articles has been added* notice, dismissible.

## Security — this is a defence (security-map.md, billing.md § The quota)

The quota is *what stops a script taking twenty*. The rules this design has to keep:

- **Only the admin can create or change a voucher.** All writes are under `/api/admin/vouchers`,
  inside the namespace gate in `src/routes.ts` (403 for anybody but `ADMIN_USER_IDS`). There is no
  reader-facing route that writes a voucher row; the only reader-triggered write is the claim, which
  can only stamp *the caller's own id* onto a voucher *already addressed to the caller's verified
  email*.
- **The address is verified twice.** The JWT's `email` comes from `requireUser`, which verifies the
  signature (never decodes). But production refusing unconfirmed sign-ins rests on a dashboard
  checkbox (admin.md), so the claim additionally asks the Auth Admin API for the account
  (`GET /auth/v1/admin/users/{id}`, the lookup `accountEmail` already does) and claims only if the
  service's own record has that same address **and** `email_confirmed_at` set. The network call
  happens only when an unclaimed voucher matches — almost never. On any doubt (service down, mismatch)
  it does not claim and tries again next time; failing to claim is the safe direction.
- **Addresses compared normalised**: trimmed, lower-cased, on write (check constraint) and on read.
- **The bonus is bounded**: each voucher 1–1000 articles (check constraint plus route validation).
- **The claim is not inside the billing lock** and takes no lock of its own; it is one `UPDATE …
  WHERE claimed_by IS NULL AND revoked_at IS NULL AND email = $1 RETURNING`, idempotent, so two
  concurrent reads cannot double-claim (a row is claimed by exactly one statement). Admission reads
  the sum under the lock in the same statement as the billing row (a correlated subquery in
  `BILLING_COLUMNS`), so nothing new runs between lock and commit.
- **The claim creates the reader's `billing_accounts` anchor** (`insert … on conflict do nothing`)
  in the same transaction, so a claimed bonus is always visible to the reads that use the row,
  including the unlocked ones that treat "no row" as plain Free.
- Revoking a claimed voucher lowers the limit immediately; a reader past it is refused the next
  ingest, with the ordinary copy. Nothing they already added is touched.

## Schema (additive)

New table `billing_vouchers`, one migration:

| column | |
|---|---|
| `id` uuid pk default gen_random_uuid() | |
| `email` text not null, check `email = lower(btrim(email)) and email like '%@%'` | |
| `articles` integer not null, check 1..1000 | whole articles, never half-units |
| `note` text null | admin's private note; never sent to the reader |
| `created_at` timestamptz not null default now(), `created_by` uuid not null | |
| `updated_at` timestamptz not null default now() | |
| `claimed_by` uuid null, `claimed_at` timestamptz null, check both-or-neither | owner id |
| `revoked_at` timestamptz null | |

Index on `lower(email)` where unclaimed; index on `claimed_by`. Grants and RLS following the
house pattern in database.md (app role only; no anon/authenticated access).

## What the reader is told, and what is deliberately left out

- `ReaderPlan`'s `free` arm gains `gifts?: readonly Gift[]` (articles, claimedAt) — **absent when
  there are none**, so no surface can mention vouchers to somebody without one. `limit` already
  includes them; the copy says *3 free + 20 from a gift* rather than a bare 23 when gifts exist.
- The note, the creator and the voucher id never leave the admin routes.

## Pushback and the simpler choices taken

- **No voucher codes.** Greg offered codes then preferred email himself; codes would add a
  reader-facing redeem route that writes allowance — exactly the surface a script attacks. Email
  binding needs no reader-facing write beyond the claim.
- **"Indicates during login"** becomes the homepage notice (the page sign-in lands on), shown while
  the claim is under 7 days old and not dismissed (localStorage, per voucher id). Not an interstitial
  in the sign-in flow: the sign-in code (`SignInControls`, `AuthCallback`) is security-sensitive and
  the homepage is where everybody arrives anyway.
- **"Edit"** is article count, note, and address-while-unclaimed, plus revoke/restore. No hard
  delete: a revoked voucher stays as a record. No expiry dates, no per-voucher usage ledger ("how
  used" = the claimant's current free usage, which is what the allowance is).
- **Claimed while on a paid plan**: bound, but inactive until they are on Free (Greg's "while on
  Free"). The box shows only for free readers in v1; `/profile` mentions gifts through the shared
  free-arm copy.
- **Not built**: emailing the recipient when a voucher is created (would be a new outbound flow —
  Greg's call; noted as a follow-up), vouchers for paid tiers.

## Stages

1. **Server** — migration, schema, `src/store/pg-vouchers.ts` (admin CRUD, claim), the bonus in
   `BILLING_COLUMNS`/`entitlementFromRow`, the claim in `GET /api/billing/usage`, the `gifts` field,
   `/api/admin/vouchers` (GET list, POST create, PATCH :id). Red-first tests against Postgres:
   a claimed voucher admits a 4th ingest that a plain free account is refused; unclaimed, revoked,
   other-address and unconfirmed-address vouchers grant nothing; a paid account's limit is unchanged;
   20 concurrent ingests on a 3+2 account admit exactly 5; a non-admin gets 403 on every voucher
   route; the reader's wire shape carries no note/creator/id.
2. **Client** — `/admin/vouchers` (on `ADMIN_ONLY`, linked from `/admin`), the homepage box, docs
   (billing.md, admin.md, library.md). Browser check, desktop and 390px, via Playwright.
3. **Review and land** — GPT Sol code review (workspace-write), gates, push to `dev`, the note.

## Log

- 2026-10-01: plan written; prior-work check found nothing (no voucher code, plan or note; the live
  session `fb-gift-vouchers` is this one).
- 2026-10-01: GPT Sol plan review ([answer](261001m-plan-review-sol.md)): *build with these changes*.
  All taken:
  - **F1 (P0)** `sum()` arrives from Postgres as a **string**; `3 + "20"` is `"320"`. Cast in SQL
    (`::int`) **and** `.mapWith(Number)`, assert a non-negative safe integer before `articles()`, and
    one `freeEntitlement(row)` helper for every Free return in `entitlementFromRow`. A test asserts
    the exact limit (23), not just that a fourth ingest passes.
  - **F2 (P1)** Revoke/downsize must serialise with admission: every voucher mutation that touches a
    claimed voucher locks the claimant's `billing_accounts` row first (house lock order), and
    admission reads the bonus in a **separate statement after** taking the lock, so READ COMMITTED
    sees a post-lock snapshot. A two-connection race test.
  - **F3 (P1)** The box must obey `isRatio`: no *N of M* when not a ratio, and *remaining* is the
    server's `privateHeadroom` ("further private articles"), never `limit − used`. Reuse
    `describePlan` where it fits.
  - **F4 (P1)** Gifts go on the summary for both `free` and `lapsed` (both are Free); the box shows
    for both, with `lapsed` still carrying no `used`.
  - **F5 (P2)** Claim stays in the GET as a documented idempotent exception; `Cache-Control:
    private, no-store`; the notice is driven by persisted `claimedAt`, never by "this request
    claimed"; the wire carries an opaque `noticeKey` (the voucher id is fine to send — it grants
    nothing) for dismissal.
  - **F6 (P2)** `claimed_by` references `billing_accounts(owner_id)`; the anchor is inserted first.
  - **F7 (P2)** Greg's full text is now above rather than elided.
- 2026-10-01: **stage 1 (server) landed.** `billing_vouchers` (migration
  `20261001143300_billing_vouchers`, additive; applied locally), `src/store/pg-vouchers.ts` (claim,
  `giftsFor`, admin list/create/update, strict body parsers), `confirmedAccountEmail` beside
  `accountEmail` in `admin-accounts.ts` (one shared fetch, still never throws), `voucherArticles` on
  `BillingRow` and `freeEntitlement` for every Free return, `ReaderPlan` `gifts` on `free` and
  `lapsed` plus a server-computed `remaining` on `free`, `giftMakeup` for the copy, the claim in
  `GET /api/billing/usage` (`private, no-store`), and the three `/api/admin/vouchers` rows. Tests:
  `tests/billing-vouchers.test.ts` (22) and three copy cases in `tests/billing-plan.test.ts`, each
  watched red under a mutation of the code it guards (bonus never added; sum uncast; lock and read
  in one statement; `updateVoucher` without the billing lock; the claim trusting an unconfirmed
  address; the gate skipping `vouchers`; the makeup dropped from the copy). Docs: billing.md
  § Gift vouchers, admin.md § `/admin/vouchers`. What changed from the plan:
  - **`lockBillingAccount` now locks with a bare `select owner_id … for update` and reads the
    columns in a second statement** — the F2 shape applied to the shared helper, so the visibility
    switch and the shelf's delete pay one extra small read.
  - **Changing a claimed voucher re-reads after locking and retries** if a claim landed between the
    unlocked read and the voucher lock, so the billing lock is always taken first; nothing unclaims,
    so a second attempt always settles it.
  - **A note is capped at 500 characters in the table too**, not only at the route; and the address
    check is `like '%_@_%'`, slightly stricter than the plan's `'%@%'`.
  - **The admin list asks the Auth service for each claimant's current address** (`accountEmail`,
    once per claimant) — a network call per claimant on every load of an admin-only page.
  - `noticeKey` is the voucher id, as F5 allows; the plan's earlier line that the id never leaves the
    admin routes is superseded by F5.
- 2026-10-01: **stage 2 (client) built.** `/admin/vouchers` is `AdminVouchersPage.tsx` over
  `useAdminVouchers.ts` (create form, a plain table, inline edit, Revoke/Restore, every write
  followed by a fresh read, refusals in the server's words), on the `/admin` index and lazy-loaded
  through a new `ADMIN_LOADERS` map keyed by `AdminPage`. The shelf's box is `FreeAllowance.tsx`
  under the add box: `describePlan`'s headline, the server's `remaining`, a gift icon and a gift
  list only when `gifts` exists, the seven-day notice dismissed per `noticeKey`. Tests:
  `tests/free-allowance-box.test.tsx` (13), `tests/admin-vouchers-page.test.tsx` (5), and
  `/admin/vouchers` added to `tests/admin-only-routes.test.tsx`; each new file was red against a
  missing module, the route test red before the loader existed, and the box and page tests were
  each watched red under mutations (drawn for every plan, dismissal ignored, gift wording without
  gifts; Revoke sending the wrong body, the address editable once claimed). Docs: library.md § The
  free-allowance box, admin.md § `/admin/vouchers` (the page), billing.md § What a reader sees.
  What changed from the plan:
  - The first client cut carried its own copy of the admin wire type because `pg-vouchers.ts` is a
    server module that `tests/client-imports.test.ts` refuses even a type import from. The stage's
    final small follow-up moved `AdminVoucher`/`ClaimantUsage` into the flat, import-free
    `src/admin-vouchers.ts`, so the store and client now share one shape.
  - The `/admin` index's *"Nothing on them can change anything"* now names Gift vouchers as the
    exception.
  - **The box mounts `useBilling` on the shelf**, which also reads `?checkout=` on mount. Stripe
    returns to `/profile`, so nothing sends that parameter to `/`, but if one ever arrived there it
    would be handled there and only that parameter would be cleared; the shelf's filters remain.
- 2026-10-01: **stage 2 browser check (Playwright, 390 and 1280).** `/admin/vouchers` at 390 scrolled
  the whole page sideways by 336px: the table's scroll box worked, but the `sr-only` caption and
  Actions header are `position: absolute` and, with no positioned ancestor, were laid out against
  the table's full width — the bug and fix DataTable met on 2026-09-28. The box is now `relative`,
  and the email, note, status and usage cells have a `min-w-*` so the table scrolls inside its box
  rather than squeezing an address to two characters a line. Measured `scrollWidth − clientWidth`
  336 → 0 at 390 (0 at 1280 both times); pinned in `tests/admin-vouchers-page.test.tsx`, watched
  red first. The *"Cannot update a component while rendering … App SignedIn"* error on arriving
  from `/login` is not this branch: `SignedIn` called `navigate()` during render for `/login` since
  22c733d03 (2026-08-26), and `dev` already replaced it with `<LeaveLogin />` in 073ac1513, so a
  merge of `dev` clears it. The one-off *"Rendered more hooks"* has no cause in the code — every
  hook in `AdminVouchersPage.tsx` and `FreeAllowance.tsx` is called unconditionally — so it was
  most likely HMR while the D1–D7 review commit was editing the file.
