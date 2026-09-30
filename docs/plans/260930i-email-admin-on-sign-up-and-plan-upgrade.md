# Email the admin on each sign-up and each plan upgrade

Up: [plans.md](../project/plans.md) · Report: SPIDERYARN-READING2-6T (suggestion, from Greg's own
account, so trusted) · Owner docs: [email.md](../project/email.md),
[billing.md](../project/billing.md)

> We had talked in the past about sending out an email to me (the admin user, e.g. to
> hello@spideryarn.com ) whenever a new user signs up and whenever a new user upgrades their pricing
> plan. We've just enabled resend and the resend API key, so I'm hoping that this should be doable
> now. Make sure that we have nice reusable machinery for dealing with email where it makes sense to
> do so.
>
> — Greg, 2026-09-30

## What exists

- Resend is already the provider, with one key (`RESEND_API_KEY`, in Vercel's three environments,
  `.env.local` and `.env.prod`) and one verified domain — [email.md](../project/email.md). **Only
  Supabase uses it**, over SMTP. The server has never sent an email itself, so there is no existing
  sending code to reuse: this adds the first, and it is the one place any later server mail goes.
- **The server never sees a sign-up.** Sign-up is Supabase Auth in the browser (email + password,
  or Google). The first the server hears of a new reader is their first authenticated API request,
  after `requireUser` (`src/auth.ts`, a defence — not edited).
- **Every plan change passes through one function**, `syncSubscriptionFromStripe`
  (`src/billing/sync.ts`), from all three callers: the Stripe webhook, the Checkout confirm route and
  admission's resync. It already reads the old row under a `for update` lock and writes the new one in
  the same transaction, so it is the one place that knows *before* and *after* at once. Neither
  `src/billing/webhook.ts` nor `sync.ts` is in security-map.md's defences table, and the webhook's
  signature check is not touched: the hook is after it, after the commit.

## The design

### 1. `src/email.ts` — the reusable machinery

```ts
sendEmail({ to, subject, text }, deps?) → Promise<SendResult>   // never throws
notifyAdmin({ subject, text }, deps?)   → Promise<SendResult>   // sendEmail to the admin address
```

- **Resend's HTTP API over `fetch`** (`POST https://api.resend.com/emails`), no SDK: one call, and a
  dependency for one call is not boring. A 10-second timeout.
- **From** `Spideryarn <hello@spideryarn.com>`, the sender auth mail already uses.
- **The admin address** is `SPIDERYARN_ADMIN_EMAIL`, defaulting in code to `hello@spideryarn.com`,
  so nothing has to be added to any env file. (Named here, as the brief asks; not written anywhere.)
- **Never throws.** Returns `{ kind: "sent", id } | { kind: "skipped", reason } | { kind: "failed",
  reason }` and logs through `src/log.ts`. A notification is not allowed to fail a sign-up or a
  payment, and the callers still wrap it anyway.
- **Only production sends.** Unless `VERCEL_ENV === "production"`, it logs that it would have sent
  and returns `skipped`. The box's `.env.local` carries the real key, so without this every local
  sign-up and every test-mode Stripe run would mail Greg. `SPIDERYARN_EMAIL_SEND=1` overrides, for a
  one-off manual check. A missing key is also `skipped`, logged as a warning.
- **Plain text only** for admin mail. HTML templates wait for a reader-facing email that needs one.
- A `deps` seam (`fetch`, `env`) so tests never touch the network, in the same shape as
  `listSubscriptions` on the sync.
- Never logs the body, and the admin email carries only what Greg needs: the account id, the email
  address, and for upgrades the tier names — no article text.

### 2. Upgrades: after the commit, in `syncSubscriptionFromStripe`

Inside the existing transaction, also read the old `status`. Compute

```
before = entitled tier of (old price, old status)   // free if none or not entitled
after  = entitled tier of (new price, new status)
upgrade ⇔ after.ingestsPerPeriod > before.ingestsPerPeriod    // ranking by allowance, as choiceRules does
```

with a pure function `planUpgrade(before, after, tiers)` in `src/billing/tiers.ts`. The transaction
returns it on the `synced` result (`upgrade: { from, to } | null`), and **after the transaction has
committed** the sync awaits `notifyAdmin`, inside a `try/catch` that logs. So:

- it covers the webhook, the confirm route and resync without touching any of them;
- **at most once per change**: the transition is decided under the row lock against the stored row,
  so a redelivered webhook, or the confirm route racing the webhook, finds the new price already
  stored and sees no change. The same property the quota arithmetic already relies on;
- a failed send is logged and forgotten — never retried, never a 5xx back to Stripe.

"Upgrade" includes free → paid (the first purchase, and a resubscription after a lapse) and a paid →
higher-paid change. Downgrades and cancellations send nothing (not asked for).

### 3. Sign-ups: a first-seen ledger, after `requireUser`

New table `spideryarn.reader_arrivals (owner_id uuid pk references auth.users on delete cascade,
first_seen_at timestamptz default now())`. After `requireUser` in `serveApi`, the route calls
`noteArrival(user)`:

1. An in-process `Set` of ids already noted this process, so a busy reader costs one lookup per
   instance, not one insert per request.
2. `insert … on conflict do nothing returning owner_id`. **A row returned means this is the first
   time anyone has seen this account**, and exactly one request in the whole fleet gets it — that is
   the dedup.
3. If returned, `notifyAdmin({ subject: "New sign-up: <email>", … })`.

It is awaited (serverless may freeze an unawaited promise once the response is written) but wrapped
so any failure is logged and the request carries on; it adds one indexed insert to a reader's first
request per instance, and one Resend round trip to their very first request ever.

**The migration backfills every existing `auth.users` id**, so shipping this does not mail Greg once
for every reader who already has an account. A reader who signs up between the migration and the
deploy is backfilled and missed; that is a window of minutes, and acceptable.

What counts as a sign-up, then, is **an account's first authenticated request** — for email sign-up,
after they have confirmed their address. An account created but never confirmed is never announced.
That is arguably the better signal, and the plan says so rather than hiding it.

### 4. Privacy page

Resend has been carrying auth mail since 2026-09-29 and is **not** in the subprocessor list on
`/privacy`. This adds a line: Resend, email delivery (sign-up confirmations, and the account's email
address when we notify ourselves of a sign-up), Ireland (eu-west-1).

## The simpler options passed over

- **A Supabase Auth hook or a database webhook on `auth.users`** would see sign-ups even when the
  reader never confirms. It needs a new public endpoint for Supabase to call, a shared secret, and a
  production configuration write — a new defence and a prod write, for a notification. No.
- **A Postgres trigger into an outbox table** needs something to drain it, and there is no scheduler
  ([cron-scheduler.md](../project/cron-scheduler.md)).
- **Checking `auth.users.created_at` is recent** instead of a ledger: no dedup across instances, so
  one sign-up can mail twice.
- **Hooking the upgrade in `webhook.ts`**: misses the confirm route and resync, and has to rebuild
  the before/after the sync already has under its lock.

## Deferred

- Downgrade, cancellation and failed-payment notifications.
- A digest instead of one mail per event, if the volume ever makes this noise.
- HTML templates for server-sent mail; any reader-facing email at all.
- Sign-ups that never confirm (would need the auth hook above).
- Retrying a failed notification. It is logged; that is all.

## Stages

1. `src/email.ts` + tests (fake fetch; production gate; never throws).
2. Upgrade hook: `planUpgrade` + sync change + tests (pure function, and the sync's transition with
   the existing `listSubscriptions` seam, asserting one notification on change and none on redelivery).
3. Sign-up ledger: schema + migration with backfill, `noteArrival`, route hook, tests.
4. Privacy line, email.md section, billing.md pointer.

## Review

- Plan: GPT Sol, read-only — `docs/plans/260930i-…-review-sol.md` once it lands.
- Code: GPT Sol, fixing inside the stage.
