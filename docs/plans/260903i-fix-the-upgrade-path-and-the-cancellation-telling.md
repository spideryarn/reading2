# Fix the upgrade path and the cancellation telling

Four faults found on the day billing went live, three of them by GPT Sol's review of the upgrade
path and one by cancelling the first real subscription. The parent is
[billing.md](../project/billing.md), which already records all four; this plan is how they get
fixed.

**Why now rather than later.** Two of them cost money in opposite directions — one stops a customer
paying us five times more, the other risks giving a month away — and both are in files this job has
open anyway.

## The four

| | what | where it bites |
|---|---|---|
| **1** | A paying Reader **cannot become a Researcher** | the Portal has `subscription_update.enabled: false`; `/profile` sends existing subscribers there rather than to Checkout, so the loop closes on itself |
| **2** | A cancellation is **never shown to the reader** | Stripe expresses *cancel at period end* as `cancel_at`; we read only `cancel_at_period_end`, which stays `false` |
| **3** | Two live subscriptions ⇒ **the reader is metered on the wrong one** | `chooseSubscription`'s `newest()` picks by latest period start, not largest allowance |
| **4** | An invoice that **cannot be finalised** leaves the subscription `active` | no invoice event is handled at all |

1 and 2 were confirmed against the **live** account, not just read off the code — 1 by reading the
live Portal configuration, 2 by cancelling the real subscription and then reading the production row.

## The decisions, and who made them

Greg, 2026-09-03, across three rounds as the research came back:

- **All four findings are in scope.**
- **Every plan change starts a fresh billing period.** An upgrade or a downgrade takes effect
  immediately, is charged at the new price, and credits unused time from the old one.
  `billing_cycle_anchor: "now"`, and **no `schedule_at_period_end` at all**.
- **The live Portal configuration gets changed by this job**, after the same change is proved in
  test mode.
- **`proration_behavior: "always_invoice"`** — see below.

### How the plan-change rule got to be one rule

It started as *upgrade immediate, downgrade at period end*, which is the conventional answer and
which this plan carried until Stripe's own documentation contradicted it:

> **Manage downgrades** … If enabled, the customer portal automatically creates and attaches a
> subscription schedule to the subscription. **You can only downgrade at the end of a billing period
> between prices that have the same product.**
> — [Configure the customer portal](https://docs.stripe.com/customer-management/configure-portal)

Reader and Researcher are **separate Products**, which is what Stripe's own product-modelling guide
tells you to do ("If two options appear as different rows on your pricing page, they must be
different products") and what makes an invoice say *Spideryarn Researcher* rather than just
*Spideryarn*. Merging them onto one Product to buy period-end downgrades was weighed and rejected:
it would make every Researcher's invoice and receipt carry the Reader product's name, and it needs a
price migration on a live account.

So the choice was between a worse invoice and a different downgrade rule, and the different rule
turned out to be *simpler than what we started with* — no subscription schedules, no product
migration, no cross-product restriction, and one sentence that describes both directions. Greg's two
stated reasons for wanting period-end downgrades both survive it: **nobody is refunded** (unused time
is credited, not repaid) and **nobody loses money they paid for**. What changes is that a downgrade
drops the allowance immediately rather than at the boundary.

### Why the quota window resets, which is the part that is not obvious

The obvious setting is `billing_cycle_anchor: "unchanged"` — keep the dates, let already-used ingests
count towards the new allowance. That was the plan, and **Fable found the hole in it**: the price is
prorated and the quota is not. Upgrade on day 27 of 30 for about $4, take 130 extra ingests
immediately, drop back to Reader, repeat monthly — 150 ingests a month for about $14 instead of $50.
Scheduling the downgrade does not close it, because the *upgrade* is the cheap step.

`billing_cycle_anchor: "now"` closes it structurally rather than arithmetically: a fresh 150 always
costs a fresh ~$50, whatever day you switch, because Stripe bills the new price in full and credits
only the time actually unused. The alternative — prorating the quota to match the money — is more
correct and much more machinery: the limit becomes time-dependent, which means storing when the
switch happened and what the previous tier was, and doing that arithmetic **inside the admission
transaction that holds the row lock**. Rejected on [simplest version
first](../project/vision.md#simpler-first).

### Proration: `always_invoice`

A web trawl and then Fable, per Greg. The blocking question was whether Managed Payments permits it
at all, since it forbids "generating a one-off invoice on a `Customer` object or for a subscription
**outside the billing period**". The load-bearing phrase is the last one: an `always_invoice`
proration invoice is generated *inside* the current period by an ordinary `subscriptions.update()`,
which is not the blocked case, and Managed Payments' own docs say "you can issue refunds and **update
subscriptions** in the Dashboard or with the API". Medium-high confidence and **no explicit Stripe
statement either way**, so Stage 2 proves it in the sandbox before it reaches live.

Fable's argument decided it: an upgrade is the reader saying *I want more, now*, and charging then is
the only option where the money and the decision happen in the same place. The alternative,
`create_prorations`, makes the next renewal of a "$50/month" plan arrive at $70 — which is the
version that generates the *why was I billed this?* email. `none` is out: it is a free upgrade for
the rest of the period.

One thing this does **not** buy, and the plan should not pretend it does: `past_due` is entitled here
on purpose, and Stripe applies a subscription change even when the immediate payment fails. So a
declined upgrade still grants 150. What `always_invoice` buys is that the unpaid window is *days*
rather than up to a month, because dunning starts today. Building `pending_updates` to close it
properly is not worth it at alpha — at most $40 and ~130 ingests are at stake.

## Two traps this job has to clear

**`ensurePortalConfiguration` returns early when a default configuration exists, and reconciles
nothing.** Editing the `features` block changes what a *fresh* account would get and leaves the live
account exactly as it is. The script's own header admits it. The obvious fix therefore looks like it
worked, which is why fixing fault 1 means changing **two** things — what we create, and what we do
about what is already there.

**The live row will not heal itself.** `/profile` never resyncs from Stripe by design, and the
cancellation webhook has already been delivered; it will not replay because a column appeared. Stage
1's new `cancel_at` will be null on the one live subscriber until something explicitly resyncs them.

## Stages

Restaged after Sol's plan review, which returned **DO NOT BUILD** on the original four. Each stage
ends with `npm test`, `npm run typecheck` and `npm run check` green, a Sol review, its own doc
update, and a commit. Docs land **with each behavioural stage**, not deferred to the end.

### Stage 1 — the cancellation telling *(fault 2)*

**Done looks like:** a cancelled reader sees on `/profile` that their plan ends on a named date, and
a test that was red against today's code proves it.

- Failing test first, from **the real payload Stripe returned** — `status: "active"`, `cancel_at`
  set, `cancel_at_period_end: false`. A fixture that sets the boolean tests the code we already have.
- Nullable `cancel_at` column. **Keep the boolean too** — Sol confirmed they are distinct raw Stripe
  facts and dropping one during an urgent live migration buys nothing.
- Written to null on every non-cancelling sync, keeping `sync.ts`'s every-field-every-time property.
- **Exactly one derived value reaches the browser**, `endsAt = cancelAt ?? (cancelAtPeriodEnd ?
  currentPeriodEnd : null)`. Two independently-interpreted cancellation flags in the UI is how they
  drift.
- A test pinning that a cancelled-but-paid-up subscriber is **still entitled** until the period ends.
- The backfill for the live row is decided here and executed in Stage 5.

### Stage 2 — the Portal *(fault 1)*

**Done looks like:** a Reader in **test mode** switches to Researcher through the Portal and back,
and both directions are proved by reading Stripe rather than by asserting a fixture.

`subscription_update`, with field names and allowed values read off the pinned SDK
(`node_modules/stripe/esm/resources/BillingPortal/Configurations.d.ts`) rather than from memory:

| field | value | why |
|---|---|---|
| `enabled` | `true` | the whole point |
| `default_allowed_updates` | `["price"]` | of `price \| promotion_code \| quantity`. **Without this the feature is on and still permits no switch** — the live config has it empty today |
| `products` | both tiers | `Array<{ product, prices }>` — needs the **product** id as well as the price id, and `billing_tiers` stores only `stripe_price_id`, so the script must expand the price to find its product |
| `billing_cycle_anchor` | `"now"` | the decision above |
| `proration_behavior` | `"always_invoice"` | the decision above |
| `schedule_at_period_end` | **not set** | no schedules; both directions are immediate |

- **Reconcile an existing configuration** rather than returning early. The dry run must show the
  drift without making it.
- `stripe:check` learns to verify **every money-sensitive field above**, not just "enabled with both
  tiers" — plus that both prices are monthly with `interval_count: 1`, since a change of interval is
  the other way a window can reset. **The new check has to be seen failing** against today's live
  configuration before it is trusted; it is the check that passed cleanly on live day with the
  upgrade path shut.
- **Prove `always_invoice` is legal under Managed Payments in the sandbox**, since no Stripe
  documentation says either way.
- Test-mode evidence must include: upgrade applies immediately; a **new** period starts; the
  downgrade direction also works; and an upgrade whose payment is **declined** — to find out what we
  actually grant, since `past_due` is entitled.

### Stage 3 — which subscription wins *(fault 3)*

**Done looks like:** a customer holding a Researcher and a Reader subscription is metered at 150, and
a stale `active` subscription cannot win.

Sol's correction, which the original plan got wrong: largest-allowance alone is **unsafe**. An
expired-but-still-`active` old Researcher would beat a current Reader for ever, and the stored row
then fails the period check in `pg-billing.ts`, so admission resyncs, picks the same stale row again
and ends at 503. Selection order is: understood → entitled → recognised → **period containing now**
→ then strongest entitlement. Keep the diagnostic fallback for when nothing has a current period.

Also, while the file is open: anomaly detection counts **non-terminal/collectable** subscriptions
rather than entitled ones, so `active + unpaid` — two collectable invoices — stops reading as normal.

**Ranking key.** `ingests_per_period` is mutable, so ranking on it means an `UPDATE` can change which
subscription wins. Either rank on something stable or write down and test that "largest current
allowance wins" is deliberately mutable. Decide in the stage.

### Stage 4 — an invoice that cannot be finalised *(fault 4)*

**The original plan's reasoning was false and Sol caught it.** "Log loudly, change no entitlement"
rested on Stripe eventually moving an uncollectable subscription to `past_due`, and it does not: a
subscription whose invoice cannot be *finalised* stays `active`, is never collected, and never enters
ordinary dunning. Resync-plus-log is detection, not a fix, and preserves entitlement indefinitely.

So this stage needs a real policy: a local billing hold tied to the failed invoice, a safe clearing
event (successful finalisation or payment), and inspection of `last_finalization_error` and
`automatic_tax.status` — Stripe distinguishes a customer-fixable missing location from a transient
tax failure, and they deserve different answers. Out-of-order failure/success events need tests.

**Adding the event to `HANDLED_EVENTS` is not enough**: the live webhook endpoint must actually be
subscribed to it, which is Stage 5's job and a read-back, not an assumption.

### Stage 5 — live, in this order

Sol was explicit that the original sequencing was unsafe. The order is:

1. deploy migrations and code;
2. update **and read back** the live webhook event subscription;
3. resync the existing live row, so `cancel_at` stops being null;
4. `stripe:check`;
5. update the Portal configuration;
6. read back **every** money-sensitive field — a successful-looking apply is not the evidence.

**Do not functional-test the new configuration on Greg's real cancelled subscription.** "Already
cancelled" is not a safety property: a Portal plan change attaches a subscription schedule, and
schedule changes can alter or remove `cancel_at`.

Then the postmortem, on the class both headline faults share: **we verified the integration against
our own model of Stripe, and never against a real user journey.** `stripe:check` tested the features
somebody thought to list; the cancellation bug survived a green suite because every fixture was
written from the same assumption as the code.

## The simpler option this passed over

**Enabling `subscription_update` in the Stripe dashboard by hand**, and fixing nothing else. It would
restore the upgrade path this afternoon. Rejected because the configuration would then exist only as
a click nobody recorded: `stripe:setup` would still create a broken one on the next account,
`stripe:check` would still not notice, and the next person to read the script would believe its
`features` block. The dashboard click is the *outcome* we want, not the mechanism.

## Status

Written 2026-09-03 before any code; restaged the same day after Sol's review returned DO NOT BUILD.
Progress is appended below as each stage lands.
