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
- **A plan change takes effect immediately in both directions**, is charged at the new price, and
  credits unused time from the old one. **No `schedule_at_period_end` at all** — Stripe cannot
  schedule one between separate Products anyway.
- **The billing dates do not move**: `billing_cycle_anchor: "unchanged"`. This reverses an earlier
  decision for `"now"`, which was exploitable — see [The quota window does NOT
  reset](#the-quota-window-does-not-reset-and-the-reasoning-that-said-it-should-was-wrong). Nothing
  had reached live.
- **The allowance prorates with the price**, which is [Stage 3b](#stage-3b-the-allowance-prorates-because-the-price-does)
  and a late addition. Greg, when the second exploit came back: *"If in doubt, keep things simple,
  and err on the side of being fair and generous to the user."* The simplest option here was not the
  generous one — it left a scripted bypass, and the quota exists to stop scripts.
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

### The quota window does NOT reset, and the reasoning that said it should was wrong

**Superseded, 2026-09-03, before anything reached live.** The section below is kept because the hole
it describes is real and still has to be closed — but its answer, `billing_cycle_anchor: "now"`, was
**worse than the problem**, and the argument for it was simply false.

`"now"` resets the quota window, and **Stripe credits unused *time*, not unused ingests**. So:
upgrade, take 150, immediately downgrade — almost no time has elapsed, so nearly the whole
Researcher charge comes back as customer credit — then immediately upgrade again, paid for by that
credit, and get **another fresh 150-ingest window for no cash**. Repeatable without limit. The claim
"a fresh 150 always costs a fresh ~$50" is only true if time passes, and nothing makes it pass. GPT
Sol found it in the Stage 2 code review; the mechanism is not theoretical, because Stage 2's own
sandbox run had already recorded the `+3200 paid` / `−3200 paid` pair that makes the middle step
work.

So the anchor is **`"unchanged"`**. The window stops moving, usage accumulates across switches, and
cycling gains nothing.

**That leaves the original hole open, and Fable sharpened it into something worse than first
described.** Not day 27 for ~$4: upgrade with **an hour left in the period** for a few pence of
proration, take the whole 150, downgrade before the roll, repeat every month — Researcher volume at
roughly the Reader price. The obvious objection, that nobody could use 130 ingests in an hour, does
not survive contact with what the quota is *for*: it is an abuse boundary against a script, and a
script can.

It is closed by **[Stage 3b](#stage-3b-the-allowance-prorates-because-the-price-does)** instead,
which is the fix Fable proposed at the start and this plan wrongly rejected as too expensive.

### The superseded reasoning, kept because the hole is real

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
| `billing_cycle_anchor` | `"unchanged"` | the decision above. **Was `"now"` until Sol's Stage 2 review** — the window must not move, or switching back and forth mints a fresh allowance paid for by the credit the last switch returned |
| `proration_behavior` | `"always_invoice"` | the decision above |
| `schedule_at_period_end` | **not set on create; cleared with `conditions: ""` on reconcile** | no schedules, both directions immediate. The *update* params type takes `Emptyable<Array<Condition>>` where *create* takes a plain array, so clearing is expressible only on the update path |
| `trial_update_behavior` | `"end_trial"` | `trialing` is an entitled status, so `continue_trial` would let a trialing Reader become a Researcher, entitled at 150 and unpaid |
| `active` (configuration level) | `true` | an inactive default configuration reads as matching while serving no Portal sessions at all |

- **Reconcile an existing configuration** rather than returning early. The dry run must show the
  drift without making it.
- `stripe:check` learns to verify **every money-sensitive field above**, not just "enabled with both
  tiers" — plus that both prices are monthly with `interval_count: 1`, since a change of interval is
  the other way a window can reset. **The new check has to be seen failing** against today's live
  configuration before it is trusted; it is the check that passed cleanly on live day with the
  upgrade path shut.
- **Prove `always_invoice` is legal under Managed Payments in the sandbox**, since no Stripe
  documentation says either way.
- Test-mode evidence must include: upgrade applies immediately; the billing dates **do not move**
  (this reversed with the anchor — the earlier measurement that the period start moved was taken
  under `"now"` and is no longer the wanted behaviour, so it needs re-measuring through the Portal);
  the downgrade direction also works; and an upgrade whose payment is **declined** — to find out what
  we actually grant, since `past_due` is entitled.

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

### Stage 3b — the allowance prorates, because the price does

**The mismatch is the whole bug family.** Stripe prorates the money and we hand over the allowance
whole, so every exploit in this plan is a consequence of the two being out of step. Both anchor
values only choose *which direction* to be wrong in. This is the stage that stops choosing.

On a mid-period tier change the extra allowance is scaled by how much of the period is left:

```
override += (limit(new tier) − limit(previous tier)) × fraction of period remaining
```

so upgrading on day 27 of 30 moves the limit from 20 to 33, not to 150 — which is exactly what the
~$4 bought.

**Where it goes.** In `syncSubscriptionFromStripe`, **not** in admission. The earlier objection —
that this puts time-dependent arithmetic inside the transaction holding the row lock — was wrong:
sync already holds that lock, already rewrites every field, and is off the ingest path. Admission
reads a stored integer and nothing else changes there.

Fable's implementation notes, which are the actual cost of this stage:

- **Two columns**, `quota_limit_override` and `quota_period_start`, not one.
- **The ordering rule is the part to write deliberately**, because Stripe does not guarantee webhook
  order. Compare the incoming `current_period_start` to the stored one: **greater** → the period
  rolled, clear the override; **equal** → same period, apply the delta; **less** → a stale event,
  ignore it entirely. That third branch is the "plan change arriving after a renewal" case, and it
  is three lines only if somebody writes them on purpose.
- **The delta needs the transition, not the state.** A fresh fetch tells you the new tier and loses
  the old one, so the previous tier comes from the stored row — which means the stored tier must be
  updated in the *same* locked write, or a webhook retry double-applies.
- **Clamp to `[0, max tier limit]`.** Fable checked the up/down/up ratchet and the incremental
  formula telescopes without exceeding 150, so this is belt-and-braces — but it turns "I reasoned it
  is safe" into "it cannot be unsafe".
- **Cancel-then-resubscribe needs no code** under any option: it mints a new subscription at full
  price with no proration credit, so the reader is buying more rather than taking it.
- **Verify in the sandbox first**: does the hosted Portal's plan switch *update* the existing
  subscription item or *replace* it? If it replaces it, anything keyed on subscription-item id
  breaks. Key on the period-start value, never the item id.

**Rejected, and worth recording.** *Upgrade-only in the Portal with `anchor: "now"`* is genuinely
simple and genuinely safe — with no downgrade there is no way to harvest the credit, and a
late-period upgrade then honestly costs a nearly-full new period. It was rejected because it buys
that safety by deleting a feature Greg explicitly chose, and "cancel and resubscribe to move down" is
the same dead end this whole job exists to remove, merely pointed the other way. *Owning the quota
window ourselves* was also weighed: it does not answer the question that actually bites — what limit
applies when the tier changes mid-window — so it collapses into this stage plus a migration on a live
billing system.

**Noted, not built:** a rolling rate ceiling (say 30 ingests per 24h) that no plan change can move.
It closes nothing here, so it is not a substitute, but it would bound the blast radius of billing
tricks nobody has thought of yet and touches no Stripe code. A candidate for later, on
[simplest version first](../project/vision.md#simpler-first).

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

### The live subscription inventory, taken before deciding anything

Read from the live account on 2026-09-03, because Sol's third review turned on whether anybody is
subscribed to a price the Portal would not list:

| | |
|---|---|
| live subscriptions, all statuses | **1** |
| `sub_1UBYxALv4piDbwcbVew6jxqN` | `active`, `cancel_at` 2026-10-03, on `price_1UBWz8Lv4piDbwcbJs6ZSN1N` |
| is that the current `reader` price? | **yes** — the row and Stripe agree |

So **nobody is on a replaced price**, and the grandfathering trap is a trap rather than a live fault.
That is what makes *detection* the right answer rather than a price-history catalog — see below.
Re-take this inventory immediately before the live apply rather than trusting this snapshot.

### What the live configuration will actually need

Read from the live account on 2026-09-03, **with the `products` expand**, so this is what Stage 5's
apply is up against rather than a guess:

```json
"subscription_update": { "enabled": false, "default_allowed_updates": [], "products": [],
  "billing_cycle_anchor": "unchanged", "proration_behavior": "none",
  "schedule_at_period_end": { "conditions": [] }, "trial_update_behavior": "end_trial" }
```

Four fields drift and all four are writable. **`schedule_at_period_end.conditions` is already empty
on live**, so the one field `--apply` cannot fix is one it will not need to — the un-clearable-field
problem is a trap for a future hand-edit, not a blocker now. Worth re-reading immediately before the
apply rather than trusting this snapshot, because a dashboard click between then and now would change
it silently.

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

### Stage 1 landed, 2026-09-03

`cancel_at` is read, stored, and turned into one date by `planEndsAt`; `/profile` says when a plan
ends. **Sol's code review: approve, no blockers** — with the note that the stage is not
*operationally* complete until the production row is resynced, which is Stage 5.

Three things worth keeping:

- **The red was witnessed**, and its message is in the commit: `expected undefined to deeply equal
  2026-10-03T11:37:09.000Z`. `1791027429` decodes to 11:37:09 UTC, exactly 30 days after the 11:37
  sale, so the payload is self-consistent.
- **The entitlement pins were mutation-tested rather than trusted.** Three green tests prove nothing
  on their own, so `entitlementFromRow` was made to return FREE on a scheduled ending, twice: keyed
  on `cancel_at` the Portal case reddened and the API case stayed green, and keyed on
  `cancel_at_period_end` the reverse. The two pins are therefore independent, and neither passes by
  admitting everybody.
- **The migration was checked by diffing the generated snapshot against its predecessor**, not by
  reading the one-line SQL — which is the check that trap actually needs, since a constraint landing
  on a same-named column of another table looks fine in a single statement.

**The backfill is a resend, not an `UPDATE`.** Re-deliver `customer.subscription.updated` for
`sub_1UBYxALv4piDbwcbVew6jxqN`; `syncSubscriptionFromStripe` then does what it does for everyone
else. A successful backfill is therefore *also* evidence the fix works live, where an `UPDATE` would
only prove the column accepts a timestamp — and a hand-typed `1791027429` is a number we chose
rather than one Stripe gave us. Sol's caveat, which Stage 5 must honour: **a Dashboard 2xx proves
the transaction completed, not that the expected value landed.** Read the row back and expect
`2026-10-03T11:37:09Z`.

**Browser-verified, because green tests are not evidence a reader can see it** — and this component
has form: billing.md records an earlier bug here where every unit test passed and only a browser run
found it. On the local stack, with the exact Portal shape (`cancel_at` set, `cancel_at_period_end`
false), `/profile` renders *"Your plan ends on 3 October 2026, and the account then goes back to the
free allowance. Everything you have added stays where it is, and reading is never limited."* — a real
formatted date, not `Invalid Date`, not the ISO string, not the fallback. The renewing case still
reads *"The allowance starts again on…"*, so nothing regressed, and the console is clean on both. The
detail line's foreground tone was confirmed from the computed style rather than by eye. *(The check
was asked for in both themes and correctly came back saying there is only one: the app is dark, full
stop — `src/web/tailwind.css`.)*

**Two `npm run check` gates are red in this worktree and neither is ours** — `test`
(`load-article-serialisation`, `store-shelf-reads`: shared local Supabase, and neither file
references billing) and `cycles` (biome cannot parse
`evals/results/illustrated-v2/constitution.raw.json`, which is a peer's committed artefact carrying a
```` ```json ```` fence). The second is worth somebody fixing properly: a gate that is red for
everyone has stopped being a gate.

### Stage 2 — the Portal, built 2026-09-03 (test mode only; live is Stage 5)

Applied to the **sandbox** and read back; nothing was run against live or against the production
database. `bpc_1UBWD7LUG7Oye8CXi4DGrb9c` now reads `enabled: true`,
`default_allowed_updates: ["price"]`, `billing_cycle_anchor: "unchanged"`,
`proration_behavior: "always_invoice"`, `trial_update_behavior: "end_trial"`, both products listed
with `adjustable_quantity` off, and no `schedule_at_period_end` conditions.

**Prose for [billing.md](../project/billing.md)**, to fold in once Stage 1 is out of that file. The
section *A paying Reader cannot become a Researcher* can lose its warning box and become a
description of how a plan change works, plus these facts, none of which is in Stripe's documentation
and all of which were measured in the sandbox on 2026-09-03:

- **`always_invoice` is legal under Managed Payments.** The blocking question in the decision above
  is answered: yes. Proved against a subscription born from a completed hosted Checkout and carrying
  `managed_payments: { enabled: true }` — an API-created subscription reads `{ enabled: false }` and
  would have proved nothing, which is the trap this nearly fell into. Both directions were accepted;
  the upgrade raised a paid `subscription_update` invoice and the downgrade a **negative** one, which
  becomes customer credit rather than a refund. Greg's "nobody is refunded" survives intact.
- **The hosted Portal really does perform the switch**, not just the API. A test reader switched
  Reader → Researcher on the Portal and Stripe recorded it. That run was made while the anchor was
  still `"now"`, and it is what demonstrated the anchor working at all: `current_period_start` moved
  to the second of the switch. Under the settled `"unchanged"` it must **not** move, and that has not
  been re-measured through the Portal — worth one switch during Stage 5's read-back.
- **`products` is absent from the API response unless expanded.** Not empty — missing. Both scripts
  now send `expand: ["data.features.subscription_update.products"]`; without it a correct
  configuration reads as one with nowhere to switch to.
- **`schedule_at_period_end` is cleared with `conditions: ""`, not `conditions: []`.** The empty
  array is dropped on the way into the form body, so Stripe answers 200 and the condition survives.
  The empty string produces the wire form that works,
  `features[subscription_update][schedule_at_period_end][conditions]=`, and the **update** params
  type permits it: `conditions?: Emptyable<Array<Condition>>`, where `Emptyable<T> = null | "" | T`.
  The **create** params type declares the same field as a plain `Array<Condition>`. Reading only the
  create type is how this was first written up, wrongly, as impossible; GPT Sol caught it. Two params
  types, two different rules, and a reconcile needs the update one.
- **`adjustable_quantity` defaults to *on*** whenever `products` is written without it, and quantity
  is a straight multiplier on the money that entitlement never reads. Both scripts now send it off
  and refuse it.
- **`trial_update_behavior` is part of the money.** `ENTITLED_STATUSES` includes `trialing`, so under
  `continue_trial` a trialling reader could switch up and be metered at the larger allowance without
  having paid. Pinned to `end_trial` and checked.

Two constraints worth recording beside them: **`products` is required** whenever
`subscription_update.enabled` is true (400 `parameter_missing` otherwise), and
**`default_payment_method` cannot be updated** on a Managed Payments subscription created by
Checkout.

**One contract, not two.** `stripe:check` no longer keeps its own idea of what a correct
configuration is; it calls the same `portalDrift` the reconcile uses, so anything `--apply` would
rewrite is a blocking `✗`. The first version of this stage checked loosely here and exactly there —
`includes("price")` against exact equality — which is the same shape as the fault the stage exists to
fix. Sol found it.

**Incomplete tier rows abort the reconcile.** An active tier with no `stripe_price_id` makes the
desired `products` list shorter than what the account sells, and reconciling against it would remove
a destination readers can currently switch to. On an existing configuration the mutation is refused
outright; on a *first* configuration the switch is created **off**, because an incomplete menu is
worse than no menu.

`unpriced` therefore sits inside `DesiredPortal` beside `products`, and every consumer asks
`complete()` rather than `products.length`. Keeping the two apart is what let the creation path
enable switching on a half-priced tier set — a menu that looks real with a plan missing from it.

**A refusal exits non-zero.** `REFUSING to touch …` and `updated … but it STILL reads back wrong`
used to print and then exit 0, under the closing line *"Price ids are on the billing_tiers rows.
There is nothing to paste anywhere."* The two states that exist to stop a bad write were announcing
themselves as a good run — [silent-success](../reusable/silent-success.md) in its purest form, and a
refusal nobody notices is worse than no refusal because it buys false confidence. `Step.failed` now
carries it and `main` exits 1 — on a dry run too, because a refusal is a data problem rather than
drift waiting for `--apply`, and exiting zero there would be the same false confidence one step
earlier.

**The obvious way to make a tier unpriced does not make it unpriced**, and it nearly became the
evidence for the fix above. Setting `stripe_price_id` to null looks like it stages the refusal; it
does not, because `ensureTier` finds the price by its `lookup_key` and records the id straight back
before the portal step runs. The run reaches the portal with a complete tier set, never refuses, and
prints a clean pass — so the "before" screenshot proves the opposite of what it appears to. What
actually reproduces it is a tier with **no rows in `billing_tier_prices`**: `ensureTier` skips it, so
nothing heals the null. Same shape as everything else in
[silent-success](../reusable/silent-success.md), found in the evidence rather than in the code.

**`stripe:check` gets the unfiltered tier list.** `offerableTiers` drops a tier with no price, which
is right for the pricing-page checks and fatal for the Portal one: an unpriced active tier is exactly
the plan the Portal cannot offer, and filtering it out first meant the check for it could never fire.
`tiersToCheck` names the two lists so the *composition* is testable — the bug was there, and a test
that calls `checkPortal` with a hand-made list reaches straight past it.

All three found by GPT Sol on the second review, 2026-09-03.

**Every step that means "Stripe is not as this script wants it" now fails the run.** Sol's third
review found two more states that were only prose: creating a configuration that is **not the account
default** (a Portal no reader can reach), and `SKIPPED — no rows in billing_tier_prices` on an
**active** tier. All twenty `Step` emissions were then swept one by one; those two plus the refusal
and the failed read-back are the complete set, and the remaining sixteen are narration or success. An
inactive tier with no prices is deliberately *not* a failure — that is a retired tier's normal end
state.

**A row that sells at no price slipped past both scripts.** `offerableTiers` keeps a tier as long as
it has a `stripe_price_id`, which a tier whose `billing_tier_prices` rows were deleted still does —
and `checkTier`'s per-currency comparison then loops over zero currencies and finds nothing wrong.
Staged in the sandbox and measured: three green ticks, *"Nothing blocking"*, exit 0, on a row that is
active and sells at nothing. `checkTier` now refuses an empty `amounts` before consulting Stripe at
all.

**Nobody may be stranded on a replaced price.** `stripe:setup` deliberately leaves existing
subscribers on the price they bought when an amount changes, and the Portal's `products[].prices`
lists only each tier's *current* price — so a grandfathered subscriber has no upgrade path on top of
already falling to free entitlement. Checked against the live account rather than reasoned about:
one subscription, on `price_1UBWz8Lv4piDbwcbJs6ZSN1N`, which **is** the current `reader` price, so
this is a trap rather than a live fault.

The fix is **detection, not price history**: `stripe:check` lists current subscriptions and fails if
any is on a price the Portal cannot switch. Keeping every price a tier has ever had is a real catalog
feature — an unbounded list, a retirement rule, and `portalDrift`'s exact comparison would have to
know which historical prices are legitimately absent — and it would compete with the warning
billing.md already carries rather than reinforcing it. One list call turns a silent trap into a noisy
one.

**And the detection had to move earlier, or it detects what the same run then creates.**
`stripe:check` runs before `stripe:setup --apply`, and the apply can replace a price and rebuild the
Portal from the new one — manufacturing the stranded subscriber the check had just failed to find.
So `ensureTier` now **refuses to replace a price while an entitled subscription still bills on it**,
on the dry run as well as the apply, so the refusal is visible before anybody types `--apply` against
live. It is the same shape as the abort for unpriced tiers, and it enforces the warning billing.md
already carries.

The subscription read **paginates to exhaustion** rather than reporting that it did not. The first
version read one page and emitted `has_more` as a `⚠`, which does not fail the run — so subscriber
101 could be stranded while the check exited 0: a guard built against a bounded read, then made
unable to fail. Reaching the page cap now throws, because a truncated list from a function whose
whole promise is exhaustiveness would put the blind spot back one level deeper.

**The success line says only what it looked at.** Billing on a listed price is *necessary* for a
Portal switch and not sufficient — Stripe also blocks the flow for scheduled, multi-product,
usage-based and send-invoice subscriptions, none of which is examined. The line says so.

Zero rows in `billing_tiers` also exits non-zero now: that is the shape a run against the wrong
database takes, and exiting 0 told a release gate the account was configured.

**The preflight validated the state we were leaving, not the one we were entering** — and that is the
finding that would have bitten this job's own live apply. `checkNobodyIsStranded` read the switchable
prices off the *live* configuration and returned early when `subscription_update` was disabled, which
is exactly the live account's state today. So it would have skipped in silence, and `--apply` would
have switched plan changes on having checked nobody. It now compares against the catalog
`stripe:setup` is about to write, and runs whether or not switching is on. Retiring a tier is the
same fault from the other end, so `ensurePortalConfiguration` refuses to write a menu that would
leave an existing subscriber out.

**"Entitled" was the wrong question for who could be stranded.** Entitlement asks whether a reader
may ingest *now*; the price question is whether a subscription could still bill on it. `incomplete`
becomes active when a first payment lands, `paused` resumes, `unpaid` can be reactivated — none
entitled today, all still on the price about to be replaced. The scan uses `isTerminalStatus`, which
also fails closed on a status Stripe adds later.

**A live price is never replaced by this script, at all.** Cursor pagination reads a moving list, so
a Checkout completing ahead of the cursor during the scan is never seen — and that window is exactly
when a price change makes somebody likely to be buying. A clean scan in live mode is reassuring
rather than true. Greg's call via the team lead, 2026-09-04: there is no need to reprice on live, so
the refusal is unconditional there and costs nothing; it refuses the harmless zero-subscriber case
too, which is the accepted price of not having to be right about the race.

The old advice in that refusal — *retire the tier instead of repricing it* — was **wrong and has been
removed**. Retiring drops the tier out of `offerableTiers`, which drops its price out of the Portal's
product list, stranding the same people by a different route. The only safe moves are to relocate
them or leave the price alone.

Two more false-greens shared by the two scripts, both the same divergence closed earlier for the
Portal: a Stripe `currency_options` entry the database does not have (a price a reader could be
charged at that nothing here costed), and a product tax code that was merely non-empty where setup
requires `txcd_10103000`.

**Not proved:** the declined-upgrade case the stage asked for. The constraint immediately above
blocks it — the subscription's card cannot be swapped for a failing one, and its first payment
happens at Checkout, so a card that declines never gets a subscription in the first place. Testing it
needs a second hosted Checkout with a card that succeeds once and fails later. The plan's reasoning
stands unverified: Stripe applies the change even when payment fails, so a declined upgrade still
grants 150, and `always_invoice` only shortens the unpaid window.

**Decision, 2026-09-03: leave it unverified rather than spend a second Checkout on it.** Not because
it is unimportant, but because the answer would not change anything we would do. The exposure is
bounded at one tier step for the length of Stripe's dunning — Fable put it at about $40 and 130
ingests — and `past_due` is entitled here **on purpose**, so that a card blip does not cut somebody
off mid-read. Closing it properly means `pending_updates`, which the Portal cannot express at all, so
the real alternative to accepting it is not a cheaper fix but a custom plan-change UI. Greg took the
same trade when he chose `always_invoice` knowing this. Recorded as *unverified*, which is not the
same as *safe* — if it ever bites, the evidence to gather is a second hosted Checkout with a card
that succeeds once and fails later.

### Stage 3 — which subscription wins, built 2026-09-03

`chooseSubscription` now sieves **understood → entitled → a price a tier sells → a period containing
now → strongest**, and takes its tier-table and clock questions through one `ChoiceRules` object
instead of two positional predicates. Nothing was run against live or against production data.

**The red, witnessed first.** Two tests written against the old code:

```
FAIL  tests/billing-subscription.test.ts > meters a reader who holds both tiers on the researcher's allowance
AssertionError: expected 'price_reader' to be 'price_researcher' // Object.is equality
FAIL  tests/billing-subscription.test.ts > counts an unpaid subscription beside an active one as an anomaly
AssertionError: expected false to be true // Object.is equality
```

**The stale-`active` case is a third red, and the first version of this paragraph was wrong.** It
said the case could not be red against the old code, because a stale subscription's period must have
started earlier and `newest()` would therefore pick the current one by accident. **Sol found the
counterexample and it is an ordinary Stripe shape**: a Reader running the 1st to the 1st, and a
Researcher bought on the 20th with a billing anchor on the 25th, which gets a short initial period —
the 20th to the 25th. If that first invoice cannot be finalised it goes stale on the 25th with a
period start five days *newer* than the Reader's, and `newest()` picks it. So the old code had the
503 lockout too, not merely the wrong meter. The fixture now uses that shape, and against the old
rule — no period filter, ranked by `newest()` — it reads:

```
FAIL  tests/billing-subscription.test.ts > will not let a stale active researcher beat a current reader
AssertionError: expected 'sub_stale_researcher' to be 'sub_reader' // Object.is equality

Expected: "sub_reader"
Received: "sub_stale_researcher"

 ❯ tests/billing-subscription.test.ts:440:42
```

One fixture now catches both wrong rules: the old `newest()` picks it for being newer, and the naive
strongest-only fix picks it for being bigger.

**The ranking key is `ingests_per_period`, and its mutability is deliberate.** The rejected
alternative was `billing_tiers.sort_order`, and it was rejected on two grounds rather than one: it is
**not more stable** — it is an equally editable column, so it buys nothing against the hand-typed
`UPDATE` Sol was worried about — and it is a **display** column, so ranking entitlement on it would
let reordering the pricing page change what somebody is metered at, and nothing constrains it to
ascend with what a tier sells. A genuinely immutable key would have to be a new column that nothing
else uses, which is machinery for a case Greg deliberately left open.

**What the mutability actually costs, stated properly.** An earlier draft called it "not a new
exposure", and Sol was right that this is too comfortable. An `UPDATE` to `ingests_per_period`
already moves every subscriber's *limit* mid-period, because `entitlementFromRow` reads it live — so
the limit moving is genuinely not new. **The window moving is.** Switching which subscription wins
switches the stored period with it, and when two subscriptions' periods are not aligned, ingests
already spent can fall outside the new window and stop counting. That is an additional consequence,
accepted rather than absent, and it is **confined to the anomaly**: one customer holding two
subscriptions at once, logged at `error`. Nobody with a single subscription can be moved by it.
`tests/billing-subscription.test.ts` pins the mutability explicitly — *follows the allowance table
when it changes* — so reversing the decision means deleting a test that says what it is.

**Mutation-tested, eight ways.** Each mutation was applied to the shipped code, the suite run, and
the mutation reverted:

| # | mutation | what reddened |
|---|---|---|
| M1 | rank by `newest()` again, keeping the period filter | the three allowance tests, and nothing else |
| M2 | drop the period filter — *the naive fix* | *stale researcher beats a current reader*, *half-open at both ends*, *nothing has a period containing now* |
| M3 | `now <= end` instead of `now < end` | *half-open at both ends*, alone |
| M4 | count the anomaly over entitled statuses again | *unpaid beside an active one*, alone |
| M5 | count the anomaly over readable subscriptions only | the two unreadable-subscription tests |
| M6 | recognise every price | *a price no tier sells*, alone |
| M7 | stop filtering on entitlement | *a dead one exists* — attributed by re-running it alone: `expected 'sub_dead' to be 'sub_live'`, the state assertion rather than the anomaly one |
| M8 | wire `allowanceFor` to `sortOrder` | *ranks on the allowance the reader bought*, in the new seam test |

M8 is the one worth keeping: **every test in `billing-subscription.test.ts` passes with the ranking
wired to the wrong column**, because that file supplies its own allowances and cannot see which
column they came from. The pin for it lives in `tests/billing-tiers.test.ts`, where the fixture tier
has `ingestsPerPeriod: 20` and `sortOrder: 10` so the two can be told apart. The wiring itself moved
out of `sync.ts` into `choiceRules` in `src/billing/tiers.ts` to make that testable without mocking
Stripe.

**Two things this stage does not do.**

- **It does not close the 503 loop, only the case where a current subscription exists.** When *every*
  subscription's period has ended, the diagnostic fallback still stores one, `entitlementFromRow`
  still calls it stale, and admission still answers 503 — which is the un-finalisable-invoice case,
  and is Stage 4's. The fallback now emits a note saying the stored row entitles nothing, so the log
  says which of the two situations it is.
- **The anomaly now fires on `active` + `incomplete`**, because `incomplete` is not terminal. That is
  intended: it is the same allowlist `hasOpenSubscription` uses to refuse a second checkout, so the
  anomaly fires on exactly what checkout would have refused to sell beside. It means an abandoned
  Checkout beside a live subscription logs at `error` — reachable only through the two-tab race,
  which is the thing we want to hear about.

**Prose for [billing.md](../project/billing.md) § *Subscribing twice*.** The last two paragraphs
(the anomaly hole, and "the reader would be left on the wrong one of the two") are now both fixed and
should be replaced with:

> If it happens, `chooseSubscription`'s anomaly is what says so, and it counts **non-terminal**
> subscriptions from the raw Stripe list — the same allowlist that refuses a second checkout — so an
> `active` beside an `unpaid`, or beside a subscription whose shape we cannot read, is two
> collectable invoices and is logged at `error`.
>
> **And the reader is metered on the better of the two.** Among the subscriptions that are entitled,
> on a price a tier sells, and whose period contains now, the one with the largest
> `ingests_per_period` wins; ties break on the later period start and then on the subscription id, so
> the answer never depends on Stripe's list order. The period test comes **before** the ranking on
> purpose: a subscription whose invoice cannot be finalised stays `active` with an expired period, and
> a rule that ranked on allowance alone would let that stale row win for ever, fail
> `entitlementFromRow`'s period check, and refuse the reader at 503 instead of merely under-serving
> them. A **stale subscription is not always the older one** — a short initial period from a later
> billing anchor starts *newer* than the plan it sits beside — so the period test is what makes this
> safe, not the ranking. Ranking on the allowance means the tier table can move what a double-subscribed reader is
> metered on; that is accepted and pinned by a test — the reasoning, and why `sort_order` is not the
> answer, is in the header of `src/billing/subscription.ts`.

**`npm test`, `npm run typecheck`, `npm run check`.** Typecheck clean. The `test` and `cycles` gates
are red for the reasons Stage 1 recorded and none of them is ours: `load-article-serialisation` and
`store-shelf-reads` (shared local Supabase), plus `store-jobs-parity`, whose own failure message says
*"claim refused … another process was inside this database"*. `biome` still cannot parse the peer's
committed eval artefacts. Worth knowing for the next stage: running the suite as
`SPIDERYARN_STORE=postgres npm test` reddens **32 files and 187 tests** that pass under plain
`npm test` — the env var belongs on the app, not on the test runner, which sets its own store per
file.

#### After Sol's code review: approved, four corrections applied

1. **The fixture gap, above** — the stale subscription now starts *later* than the current one, so
   the test catches the rule that was replaced as well as the naive fix, and the claim that the old
   code got this right by accident is corrected wherever it was written.
2. **"Not a new exposure" was too comfortable**, and is now stated as an accepted additional
   consequence — the window moves, not just the limit — confined to the anomaly.
3. **The anomaly log said "more than one live subscription"** while counting non-terminal ones. It
   now says non-terminal, because the wording is what sends whoever reads it to the right list.
4. **A sole malformed subscription still stores nothing, deliberately.** Sol asked whether that
   account should carry a diagnostic row rather than reading as never-subscribed, and I think not,
   for a reason stronger than rarity: **storing it would block the reader from buying a good one.**
   `hasOpenSubscription` is `stripeSubscriptionId && !terminal(status)`, so a stored malformed
   `active` row sends them to the Portal to manage a subscription nobody can meter, instead of
   letting them subscribe properly — a reader-facing regression bought for an operator-facing
   convenience. And the case is *already* not silent: every unreadable subscription logs a `warn`
   naming it and saying exactly which rule refused it, plus the anomaly at `error` when there is more
   than one. What is genuinely missing is only that `/admin/users` cannot see it, and the right fix
   for that is to surface these sync warnings in the admin view — not to write a row that entitles
   nothing, has a shape (subscription id, no price, no period) no consumer expects, and changes
   checkout behaviour as a side effect. Ordinary *ended* subscriptions keep their diagnostic row, as
   before; they are readable, so they carry a price and a period and the lapsed experience works.

### Stage 3b — the allowance prorates, built 2026-09-03

Two columns on `billing_accounts`, one pure module, and a seam. A mid-period plan change now moves
the limit by what is left of the period, so upgrading with an hour to go buys an hour's worth.
Nothing was run against live or against production data.

**The red, witnessed first**, from the case the whole stage exists for — three days and an hour left
of a thirty-day period, Reader → Researcher:

```
FAIL  tests/billing-quota-override.test.ts > hands over three days' worth of Researcher, not a month's
AssertionError: expected { kind: 'eligible' } to match object { Object (kind, limit, ...) }

- Expected
+ Received

  {
-   "kind": "refused",
-   "limit": 33,
-   "used": 33,
+   "kind": "eligible",
  }
```

Six behavioural cases were red against today's code before a column existed, and the downgrade one
was red **in the other direction** — refused at 32 where it should have admitted — because today's
code drops a downgraded reader to the Reader limit immediately rather than to the 33 they paid for.
The exploit and its mirror image are the same bug.

**Where it lives.** `nextQuotaOverride` in [`src/billing/quota-override.ts`](../../src/billing/quota-override.ts)
is pure and takes the transition; `syncSubscriptionFromStripe` calls it inside the lock it already
holds and writes both columns in the same statement as `price_id`. `entitlementFromRow` reads a
stored integer and compares one date. Admission does no arithmetic.

**The ordering rule, and where this plan was wrong.** The plan asked for three branches — later,
equal, earlier — with *earlier* meaning a stale event to ignore entirely. There are two branches, and
no branch skips the write:

| the incoming period start | what happens |
|---|---|
| **equal**, same price | the override is carried through unchanged — this is the retry |
| **equal**, different price | the delta |
| **anything else** | cleared |

*Earlier* is not staleness. **Sync locks the row and then asks Stripe**, so a later delivery can never
carry older state than an earlier one — it re-reads the world after the first has committed. An
earlier period start means a *different subscription now wins*: the Researcher with a late anchor was
cancelled and a Reader running the 1st to the 1st is what is left. Ignoring that would leave an
override attached to a period the row no longer has. And **ignoring it is not free**, which is the
plan's other mistake: `sync.ts` writes every field on every sync on purpose, so a branch that skipped
the write would be a new partial-update path in the file whose header explains why there are none.

**Floored, never rounded, and that is the one arithmetic decision worth arguing about.** Rounding each
delta independently is a ratchet: switch up when 130 × remaining is 64.6 (+65) and back down when it
is 64.4 (−64) nets +1, and 260 Portal clicks is the whole 130 back. Flooring the *accumulated* limit
cannot, because the stored limit is always an integer and `floor(floor(b + d₁) + d₂) ≤ floor(b + d₁ +
d₂)` — every step is bounded by the exact arithmetic. The price is that each switch loses **up to one
ingest**: an upgrade two hours into a fresh month gives 149 rather than 150, and ten switches drift
down by ten. Deliberate, bounded by the number of plan changes, and pointing away from the exploit.
Storing a fractional limit would remove the drift and would *not* fix the 149, because the read still
has to floor — which is why the column is an integer.

**Worked, and each one is a test:**

| | limit |
|---|---|
| upgrade two hours into a fresh 30-day period | 20 → **149** — `floor(20 + 130 × 0.99722)` |
| upgrade with 3 days 1 hour left | 20 → **33** — `floor(20 + 130 × 0.10139)`, which is what the ~$4 bought |
| upgrade with **an hour** left | 20 → **20** — 130 ⁄ 720 is 0.18 of an ingest. The exploit |
| downgrade with 27 days left | 150 → **33** — the same arithmetic, credited |
| up/down five times then up, at half the period | 20 → **79**, against 84 for a single switch. Drift is downwards |
| the same webhook delivered three times | **33**, once |
| a renewal after a change | override cleared; the full 150 |
| cancel, then resubscribe | override cleared, full allowance, **no branch** — the period test alone notices |

**Mutation-tested, twelve ways.** Each mutation applied to the shipped code, the suite run, the
mutation reverted and the revert diffed.

| # | mutation | what reddened |
|---|---|---|
| M1 | `round` instead of `floor` | *floors rather than rounding*, the ratchet sweep, *the whole difference*, the cycling case |
| M2 | never treat an incoming period as a different one | the two roll cases and the two clearing cases |
| M3 | apply the delta even when the price did not change | *leaves a row with no override alone* — **and not the retry case** |
| M4 | stop moving `price_id` in the same write | *delivered twice*, *freshly-bought*, the cycling case |
| M5 | ignore an existing override when taking the base | the cycling case, the clamp case |
| M6 | `fractionRemaining` always 1 — the bug, restored | **13 of 27** |
| M7 | drop the read-side period guard | the two "belongs to another period" cases |
| M8 | drop the clamp | the two clamp cases and the ratchet sweep |
| M9 | never write the two columns | all 8 database cases |
| M10 | wire the proration to `sort_order` | the seam pin in `billing-tiers.test.ts` **and** all 8 database cases |
| M11 | compare the incoming period start against itself | the two clearing cases |
| M12 | write `current_period_start` from the row instead of from Stripe | **nothing, across 88 tests** |

**M3 is the one worth keeping**, because it says where the retry safety actually comes from. Deleting
the *same price, same period* early return does **not** redden the redelivery case: by the time the
second delivery arrives the stored price is already the new one, so the delta is `(150 − 150) × r`,
which is zero. The early return is a clarity and a no-redundant-row rule; **the thing that makes a
retry safe is `price_id` moving in the same locked statement**, and M4 is the mutation that proves it.

**M12 was found by accident and is a pre-existing hole, now closed.** A slip while reverting M11 left
sync writing `current_period_start` from the row it had just read rather than from Stripe — a renewed
subscriber metered against last month's window for ever — and the entire billing suite stayed green.
Sync's *every field on every sync* property had no pin for that column, because nothing else drives
sync end to end. `records the period Stripe reported, not the one already in the row` is that pin, and
it reddens under M12.

**The seam.** `syncSubscriptionFromStripe` grew one optional dep, `listSubscriptions`, because the
arithmetic is a transition and a transition cannot be exercised by writing a row and reading it back.
The default is the real thing, so forgetting to inject cannot make a production build inert. The
tier-table wiring goes through `quotaRules` beside `choiceRules`, and `tests/billing-tiers.test.ts`
pins that it reads `ingests_per_period` rather than `sort_order` — the fixture has 20/150 against
10/20 so the two can be told apart, which is Stage 3's M8 lesson applied before it could bite.

**Two guards, not one, and they mask each other.** Sync clears an override when the period is not the
one it belongs to, and the read applies one only when `quota_period_start` equals
`current_period_start`. That means the *wall* cannot see a sync that forgot to clear — so the two
clearing cases assert the column directly and the read-side guard has its own case. Both are wanted;
neither is redundant.

**The migration**, `20260903185701_opposite_mach_iv`, was checked by diffing the generated snapshot
against its predecessor rather than by reading the SQL. Four additions, all on `billing_accounts`,
nothing else in the file: two nullable columns, `billing_accounts_quota_override_is_dated`
(`num_nonnulls(…) <> 1`, so one of the pair alone is not a state) and
`billing_accounts_quota_override_not_negative`. Applied locally against
`postgresql://postgres@127.0.0.1:54362/postgres`, read off the command's own `Target:` line.

**`npm test`, `npm run typecheck`, `npm run check`.** Typecheck clean across all three projects — and
it earned its keep: it caught `tests/billing-admin-plan.test.ts`'s `AccountSnapshot` fixture missing
the two new fields, which `tsc -p tsconfig.json` alone does not see because that project excludes
`tests/`. The `test` and `cycles` gates are red for the reasons Stages 1 and 3 recorded and none of
them is ours: `store-shelf-reads`, `store-jobs-parity` and `load-article-serialisation` (shared local
Supabase and a peer's concurrent claims — no billing file among them), and biome's 159 findings live
in `evals/` and `biome.jsonc`. All eight files this stage touched check clean under `biome check`, and
all fourteen billing suites pass (267 tests, plus this file's 28).

**What is not done here.** The stage changes no Stripe configuration and needs no Stage 5 step of its
own beyond the migration shipping with the code. **The live row will not be re-prorated**: the
existing subscriber's override is null, which means *ask the tier*, which is exactly right for
somebody who has not changed plan.

#### After Sol's code review: the lag is real, the proposed replacement is worse

Sol confirmed the two-branch ordering rule, the boundaries, the migration, `floor` over `round`, and
the latent-defect pin. It found one blocker and two smaller things. The blocker is real; the
replacement offered for it is not safe, and the numbers below are measured rather than argued.

**The blocker, stated exactly.** The delta is scaled by the fraction remaining at **sync** time,
while Stripe prorates the money at **change** time. Every millisecond between the two is allowance
granted at the wrong rate. Measured, on a 30-day period, for a change made on day 10:

| synced on | downgrade 150→20 (truth 63) | upgrade 20→150 (truth 107) |
|---|---|---|
| day 10 — prompt delivery | **63** | **106** |
| day 11 | 67 (+4) | 102 (−5) |
| day 13 — the end of Stripe's retry window | 76 (+13) | 93 (−14) |
| day 20 | 106 (+43) | 63 (−44) |

Two things follow that the review did not separate. **The error is one-directional**: a delayed
*downgrade* over-grants, a delayed *upgrade* under-grants. And **the exploit this stage exists to
close runs through the upgrade direction**, where lag is safe — a late-period upgrade synced late is
worth *less*, never more. So the lag is a fairness defect on downgrades, not a reopening of the hole.

**Its size is bounded by Stripe's own delivery behaviour**, which is worth writing down because it is
the whole risk assessment: live-mode retries run **up to three days with exponential backoff**
([Receive Stripe events](https://docs.stripe.com/webhooks#automatic-retries)), so the unobserved
window is three days unless the *destination is disabled*, in which case Stripe **never resends the
events generated while it was off** and the row heals only on the next event or a manual resync.
Three days of a thirty-day period caps the over-grant at about 13 ingests. In ordinary operation the
delivery is seconds and the error is 0.0002 of an ingest.

**The stateless replacement does not hold up.** `used_so_far + limit(tier) × fraction remaining` is
**not idempotent**, because `used_so_far` moves. Simulated at day 15 of 30 on Researcher, with the
reader spending to the ceiling and then triggering a sync — which any
`customer.subscription.updated` does, including a Portal card change or a plan switch and back:

```
day 15.00: used 0   -> limit 75    (+75 more)
day 15.25: used 75  -> limit 148   (+73 more)
day 15.50: used 148 -> limit 220   (+72 more)
day 15.75: used 220 -> limit 291   (+71 more)
day 16.00: used 291 -> limit 361   (+70 more)
day 16.25: used 361 -> limit 429   (+68 more)
total granted inside one 30-day period: 429, against a tier of 150
```

Each recomputation adds another `limit × fraction`, having forgotten that the previous ceiling
already contained it — unbounded in the number of syncs, and every sync is a Portal click away. The
claimed safety, *used only grows and the fraction only shrinks*, is the error: both moving in
opposite directions says nothing about their **sum**.

Guarding it with a price comparison stops the ratchet and reintroduces the history dependence it was
supposed to remove — and it still cannot see a collapsed excursion, so it buys nothing there either.
It is also not merely "less generous": for a reader who had spent 12 of their 20 before upgrading on
day 15 it gives **87** where the delta gives 85, because it tracks what somebody spent rather than
what they bought.

**There is no better model to switch to, because the delta already is the accrual model.** Allowance
accruing continuously at the current tier's rate is `L(t) = accrued(t) + R × f(t)`; at a change,
`L_new = accrued + R_new × f = L_old + (R_new − R_old) × f`, which is this stage's recurrence exactly.
So the arithmetic is not what is wrong. **The only wrong input is which instant `f` is evaluated at.**

**Which makes the fix a parameter rather than a redesign.** Evaluate `f` at the change time, taken
from the delivering event's `created` and clamped into `[last_synced_at, now]` — the window in which
the change must have happened, because `last_synced_at` is when we last saw the old price. This uses
the event for *when*, never for *state*, so `sync.ts`'s rule survives intact; it makes every
single-change case exact at any delay, including the three-day one; and the clamp closes the obvious
attack on it, a stale event delivered beside a fresh plan change — which Stripe's own three-day
retry ceiling already bounds. Two honest caveats: Stripe says **"don't use `created` to determine
event order… distinct events can share a timestamp"**, which is a warning about ordering rather than
about scaling a fraction, but it means the instrument is second-granular; and the other two callers
of `sync` (admission's resync, checkout) carry no event and would keep passing `now`, which is the
only bound they have.

**What no stateless rule can fix** is the collapsed excursion: Researcher → Reader on day 10 →
Researcher on day 20, with the first delivery never arriving. Current state equals stored state, so
no function of (stored, incoming, now) can know the ten Reader days happened. It needs stored event
history, and it needs the destination to have been **disabled** or down beyond three days — the one
case in which Stripe drops the events rather than retrying. Not built, deliberately: it is real
machinery on a live billing system for a case that requires an outage we would already be treating as
an incident, and the over-grant is bounded by the length of the unobserved excursion.

**The clamp fix, applied.** `maxAllowance` counted **unpriced** tiers, so a draft row typed into
`billing_tiers` while somebody costed out a third plan would silently raise the ceiling on everybody
and stop the defensive clamp matching the sentence describing it. It now counts only tiers with a
`stripe_price_id` — retired ones included, because `tierForPrice` still matches those and somebody
can still be holding one. Pinned in `tests/billing-tiers.test.ts` from both sides, and the pin was
watched failing against the old reduce.

#### The change-time fix, built — and how it was arrived at

**Read this before proposing anything here, because two prior proposals were refuted to get to it**
and the next person will otherwise propose one of them again. The blocker Sol found was real; the
replacement offered for it was worse; the answer was neither.

`f` is now evaluated at the moment the plan changed, taken from the delivering event's `created` and
clamped into `[last_synced_at, now]`. `observedChangeTime` in
[`src/billing/quota-override.ts`](../../src/billing/quota-override.ts) is the whole of it, and three
properties are what make it safe rather than clever:

- **the event supplies *when*, never *state*** — everything decided is still what
  `stripe.subscriptions.list` said under the lock, so `sync.ts`'s ask-Stripe-what-is-true rule is
  untouched;
- **the lower bound is `last_synced_at` because that is when we last saw the old price**, so the
  change cannot predate it, and a stale event cannot drag the fraction back towards the period start
  and buy a nearly-full upgrade for a few pence;
- **Stripe's own retry ceiling bounds the rest** — an event arriving now was created at most three
  days ago.

Two caveats live beside it in the code: Stripe warns against using `created` **to determine event
order**, which is not what this does, and the timestamp is second-granular, which against a fraction
of a month is noise.

**`changedAt` is required, not optional.** The two callers with no event — admission's resync and
checkout's confirmation — pass `"unknown"` out loud at the call site with a comment saying why.
Making it optional would let the next reader see a sensible default and quietly restore the bug the
default *is*.

**The red, witnessed by putting the reviewed version back** (one line: `fractionRemaining(incoming,
now)`):

```
× prorates a late webhook against the change, not against the delivery
× prorates at the moment the plan changed, not the moment we were told
    AssertionError: expected { limit: 124, …(1) } to deeply equal { limit: 33, …(1) }
× cannot be dragged back before the last time we looked
    AssertionError: expected { limit: 46, …(1) } to deeply equal { limit: 98, …(1) }
```

The first of those three is the **wiring** pin, over a real database: a downgrade made five days ago
and heard about now gives 41 rather than 63. Every date in it is fixed at fixture time, so it does
not depend on the clock at all. `tests/billing-webhook-route.test.ts` pins the other end of the same
seam — that the event's own `created` reaches `sync` — and reddens when the webhook passes
`"unknown"` instead.

**Why the two rejected shapes are recorded rather than summarised.** Sol's *stateless* form,
`used_so_far + limit(tier) × fraction remaining`, was offered as immune to collapsed history and
idempotent. It is neither, and simulating it rather than reasoning about it is the only thing that
showed why: it granted **429 ingests against a tier of 150** inside one period, because `used_so_far`
moves and each recomputation adds another `limit × fraction` on top of a ceiling that already
contained one — and every `customer.subscription.updated`, including a Portal card change, is a
recomputation. *Used only grows and the fraction only shrinks* is not an invariant: opposite
directions say nothing about the **sum**. It was also not the fairness-for-correctness trade it
looked like — for a reader who had spent 12 of their 20 before upgrading on day 15 it gives **87**
against the delta's 85, because it tracks what somebody spent rather than what they bought.

**Two `sync`-wide pins and a lock pin, added because M12's class is real.** They live in
`tests/billing-quota-override.test.ts` under *what one sync writes*, because that is the only file
that drives sync end to end. One asserts every field of the write against a row that disagrees with
Stripe in all of them; one asserts they all clear when the customer has no subscription we can meter.
Mutation-checked: hardcoding `livemode` reddens two of them, never writing `cancel_at` from Stripe
reddens one.

**M17, and the pin it broke.** Removing `.for("update")` from sync's locked read left the whole suite
**green**, which is a finding rather than a failure: the lock pin as first written asserted only that
the sync *waits*, and an unlocked sync waits too — the holder's row lock blocks sync's final `UPDATE`
whether or not its `SELECT` was locked. It was measuring something true that was not the thing it was
named for, which is this document's recurring shape at test scale.

The rewritten case changes the row *while the sync is in flight*: the holder records the upgrade
itself, with an override of 99, and commits. Under the lock the `SELECT` blocks and — at
`read committed` — re-reads the newest committed version, so the sync sees the price already moved,
finds nothing to prorate, and leaves the 99 alone. Without it:

```
× reads and moves the price inside one critical section
AssertionError: expected { limit: 33, …(1) } to deeply equal { limit: 99, …(1) }
```

**And the claim that pin was written to defend was too strong, which the mutation is also what
showed.** An earlier paragraph here said the override made sync a read-modify-write, so *"two
concurrent syncs that both read the old price would both apply the delta"*. They would not: two syncs
fetching the same Stripe state compute the same answer from the same stored state and write the same
number, so a lost lock does not double-apply. What it loses is an **intermediate transition** — a
sync that read before somebody else's change committed overwrites their result with a delta measured
from state that is already gone, which is what the 33-over-99 above is. The lock is still
load-bearing, for that reason rather than the one first given.

**A comment is not a guard.** Two of the new cases were written with a period of exactly three days
and came out at **32 rather than 33**, because the arithmetic lands on 33.0 and the milliseconds
between building the fixture and running the sync decide the floor. The first test in the file
carried a comment warning about precisely this, a few lines above, and the comment did not stop it
happening — to the person who had written it, the same day. `threeDaysLeft()` is now the only way
this file builds that period, and that is the difference: a guard removes the case, a comment asks
somebody to remember it.

**The evidence was wrong twice before the code was.** A `perl` revert of one mutation silently
rewrote a *second* matching line in the same `.set` block — the near-identical
`state?.x ?? null` fields make that easy — and only diffing the revert caught it. That is the second
time in this job that a checking step, rather than the code under it, was the thing that was wrong:
the first was M12's whole class, where the suite agreed with a bug because nothing drove sync end to
end. **Diff every revert**, and treat a mutation run that ends green as a claim needing its own
evidence.

**`npm test` and `npm run check`, run once the machine recovered.** Typecheck and build clean;
`test` and `cycles` red, and neither for our reasons. The `test` gate's six failures were
`store-shelf-reads` and `load-article-serialisation` (shared local Supabase, the set Stages 1 and 3
recorded) and `billing-portal-check` — **which passes 27/27 in isolation**, because Stage 2's agent
was editing it while the gate ran. `billing-tiers` failed in one full-suite run and passes alone, for
the same reason: `billing_tiers` is a shared table and a peer suite leaves rows in it. `cycles` is
biome's 159 findings in `evals/` and `biome.jsonc`; all twelve files this stage touched check clean.

**One flake worth somebody's time, found twice here and not ours.**
`tests/billing-settlement.test.ts` fails on
`ingest_events_settled_after_reserved` whenever the container's clock is a few milliseconds ahead of
the host's: `reserved_at` comes from Postgres `now()` and the settlement timestamp from JS
`new Date()`, so a reservation settled milliseconds after it was made can violate a constraint that
says a settlement cannot precede its reservation. Measured on 2026-09-03 with the container 60ms
ahead, and again on 2026-09-04 with the two clocks 2ms apart. The fix is for the settlement to take
its timestamp from the same clock as the default — `now()` — rather than from the application.

### What merging `origin/dev` will cost, measured 2026-09-04

The worktree was **71 commits behind** by the morning of 2026-09-04, and a peer landed work on this
job's own surfaces while it was running. Measured with `git diff HEAD...origin/dev`, so this is what
the merge actually contains rather than what it might:

**Stage 1's rename breaks three upstream call sites, and that is the types doing their job.** A peer
built a *"which plan you are on"* line into `/pricing` that reads `describePlan`'s `paid.cancelling`
boolean — the field Stage 1 replaced with `endsAt: string | null`. The three are
[`src/billing-plan.ts`](../../src/billing-plan.ts) § `describePlan`'s `detail`,
[`src/web/PricingPage.tsx`](../../src/web/PricingPage.tsx) § `showsPlanDetail`, and a
`DesignPage.tsx` fixture. **We own the fix**, because we made the rename; `npm run typecheck` finds
all three and none of them can be missed silently. (`job.cancelling` in `AddArticle.tsx` and
`JobProgress.tsx` is an unrelated field with the same name — do not touch it. Grepping for
`cancelling` alone finds twenty hits and only three are ours.)

That peer's own note is worth keeping, because it says the fix lands in two places at once:

> Note that the cancellation warning above means the `cancelling` detail this page renders is
> **currently always absent in production**: `cancelling` is computed from `cancel_at_period_end`,
> which Stripe no longer sets. So both surfaces stay silent about a plan that is ending, and fixing
> the sync fixes both at once.

So Stage 1 turns on a second surface nobody in this job built. Check `/pricing` as well as `/profile`
when the live row is resynced in Stage 5.

**The migration snapshot chain will be stale, and the `chain` gate is what notices.** Upstream
carries `20260903171940_jobs_requeues`, which is *earlier* by timestamp than this job's
`20260903185701_opposite_mach_iv` but was not in the tree when ours was generated — so our snapshot
does not contain its schema. Ordering is fine; the snapshot is not. **Regenerate the snapshot after
the merge, do not hand-edit it**, and re-read the `Target:` line of whatever applies it.

**Also arriving:** `src/db/schema.ts` (+30, conflict likely — both sides added columns),
`tests/billing-admission.test.ts` (+105/−11, and Stage 3b touches admission), and 27 lines of
`docs/project/billing.md` recording that *lifetime* free ingests start at the launch ledger rather
than at the account. None of those three is a contradiction of this job; they are ordinary
same-file edits.

**Merge, never rebase**, and treat the conflicts as a proposal before an edit —
[git-resolve-merge-conflicts.md](../reusable/git-resolve-merge-conflicts.md).

### The live account, re-read 2026-09-04 before Stage 5

Read directly from `acct_1UBW3NLv4piDbwcb` in livemode, not from a script, so this does not depend on
Stage 2's scripts being mid-edit.

**Subscriptions — unchanged from the 2026-09-03 inventory.** One, `sub_1UBYxALv4piDbwcbVew6jxqN`,
`status: active`, `cancel_at` 1791027429 (2026-10-03T11:37:09Z), `cancel_at_period_end: false` — the
fault-2 shape exactly — on `price_1UBWz8Lv4piDbwcbJs6ZSN1N`, which is still the current `reader`
price. **Nobody is on a replaced price**, so Stage 2's grandfathering guard remains a guard against a
trap rather than a live fault.

Two details from the same read that are worth having written down:

- `currency: "eur"` on a subscription whose price is `unit_amount: 1000, currency: "usd"` — Adaptive
  Pricing, observed rather than inferred, which is the answer to *why did a London customer pay
  euros*.
- `managed_payments: { enabled: true }` and `automatic_tax: { enabled: true, liability: stripe }`.
  The second is what makes [Stage 4](#stage-4-an-invoice-that-cannot-be-finalised-fault-4)'s failure
  mode reachable rather than hypothetical: automatic tax on a cross-border customer is the ordinary
  cause of an invoice that will not finalise.

**The webhook endpoint**, `we_1UBXjMLv4piDbwcbrLUPudWD` → `https://www.spideryarn.com/api/webhooks/stripe`,
`status: enabled`, `api_version: 2026-08-26.dahlia`, and `enabled_events` is exactly the four in
`HANDLED_EVENTS`. So **no invoice event reaches us today even if the code handled one** — which is
why Stage 5 step 2 is a write *and* a read-back, and why adding an event to `HANDLED_EVENTS` alone
would be a change with no effect that every local test would call green.

### Stage 4 rescoped, 2026-09-04: detect, do not hold

**This stage was over-built, and the premise it was built on is one Stripe's own documentation
contradicts itself about.** Fable arbitrated, reading the live account and the docs rather than the
plan; I then verified the citations myself and found the contradiction, which Fable had resolved
rather than reported. Sol's original finding was what put the stage in the plan, and half of it
survives.

**What survives.** An unfinalised invoice never produces `past_due` — `past_due` is defined against
the latest *finalized* invoice, and Stripe says plainly: *"Subscriptions remain active if invoices
can't be finalized, which means that users may still be able to access your product while you're not
able to collect payments"*
([subscription webhooks](https://docs.stripe.com/billing/subscriptions/webhooks#invoice-finalization-failure)).

**What does not.** Sol's *likeliest cause* — automatic tax failing — is documented as **not**
stopping finalisation for a subscription invoice:

> If we don't have a recognized customer location, invoices for a `Subscription` continue to finalize
> automatically but without calculating taxes … We collect payment as usual according to the
> collection method for the `Invoice`.
> — [Collect customer addresses § Handle invoice finalization errors](https://docs.stripe.com/tax/customer-locations)

Draft-forever is listed there under **Exceptions**, and applies to manual API/Dashboard finalisation
and to standalone invoices **without** a Subscription. The invoice object's
`automatic_tax.disabled_reason` enum has exactly two values, `finalization_requires_location_inputs`
and `finalization_system_error` — i.e. Stripe finalises through both the customer-fixable and the
transient case.

**But a second Stripe page says the opposite, and this is the part worth keeping:**

> make sure to listen to `invoice.finalization_failed` events. If the `automatic_tax.status` of the
> invoice is `requires_location_inputs` … Stripe can't calculate the taxes, **can't finalize the
> invoice**, and can't collect the payment.
> — [Collect taxes for recurring payments](https://docs.stripe.com/billing/taxes/collect-taxes?tax-calculation=stripe-tax)

Both read 2026-09-04. They cannot both be true. **We do not know which describes the account we
have**, and that uncertainty is the argument *for* the cheap answer rather than against it: a stored
hold with its own clearing semantics, built on a premise Stripe disagrees with itself about, is
machinery we would not be able to justify keeping if the premise turned out to be the other one.

**The decision.** Detection, and no hold:

1. subscribe the live endpoint to `invoice.finalization_failed` and add it to `HANDLED_EVENTS` — it
   carries a customer, so the ordinary resync is the right handler — and log at `error`, which
   reaches Sentry;
2. add a **read-only sweep** to `stripe:check`: any subscription invoice still `draft` or `open`
   more than three days after creation fails the run. That sees *every* uncollected invoice whatever
   the cause, not only finalisation failures, which is strictly more than the event buys.

No column, no policy module, no entitlement change, no out-of-order tests.

**Why this is the generous reading as well as the small one.** A hold removes entitlement from
somebody who is trying to pay us. The cost of being wrong runs the other way for each option: with
detection we serve somebody free for a bounded period, recoverable and, at one subscriber, trivial;
with a hold we cut off a paying reader over a tax hiccup, which is worse to experience and much
harder to notice. `past_due` is entitled here **on purpose** for exactly that reason, and detection
is the same policy applied to a second kind of unpaid invoice. Greg, 2026-09-03: *"If in doubt, keep
things simple, and err on the side of being fair and generous to the user."*

**The exposure we are accepting, stated rather than waved away.** Managed Payments is the gap: every
citation above is written for an account where *we* are liable for tax, and on this account
`liability.type` is `"stripe"`. It is plausible Stripe will not finalise a merchant-of-record invoice
with tax disabled, which lands back in *active forever, never collected*. There is no documentation
either way. The exposure is one period of one subscription per incident, bounded further by the
ingest quota, and reversible from the Dashboard by finalising or voiding the invoice. **If it ever
fires, the sweep is what tells us**, and the decision can be revisited with a real instance instead
of two contradictory doc pages.

**Do not subscribe to `invoice.created` while doing this.** Stripe delays finalising *every*
automatic-collection invoice on the account for up to 72 hours if an endpoint fails to return 2xx to
it — so an outage of our Vercel function would stall every renewal. Confirmed twice: the
[scheduled-finalization page](https://docs.stripe.com/invoicing/scheduled-finalization) refers to it
as the standing behaviour, and Stripe support states it directly. `invoice.finalization_failed`
carries no such penalty.

**One inherited claim nobody has verified**, and Stage 3 rests on it: that an unfinalised invoice
leaves the subscription with an *expired* period, so admission 503s. The item's
`current_period_start/end` plausibly roll at the cycle boundary when the draft invoice is created,
about an hour before finalisation is attempted — in which case the reader is entitled with a fresh
period rather than refused. One sandbox observation settles it. **Do not build on either version
until somebody has looked.**

### Sol's second Stage 3b review, 2026-09-04: the change-time fix is withdrawn

**The section above titled *The change-time fix, built* is superseded. Read this instead.** It is
kept because the reasoning that led to it is still the best account of what was ruled out, and
because the next person will otherwise propose it a third time.

Sol reviewed the change-time fix — which had never been reviewed by anyone, having been built in
response to Sol's *previous* review — and returned **not safe to commit**, with two blocking findings
it reproduced rather than reasoned to. All four findings were checked and all four are right.

**1. An event's `created` is not the time of the transition we then fetch. Reproduced.** The webhook
hands all four handled event types' timestamp to a function that afterwards asks Stripe for *current*
state, so the two are not causally tied. Stored Reader last synced day 17, the upgrade actually on
day 20, and a pending **day-17 `checkout.session.completed` retry** arriving first grants **76**
against a truth of **63**; an immediate downgrade then leaves 32 rather than 20, and the genuine
plan-change event that follows sees the same price and preserves the wrong number.

Sol also refuted the bound the design rested on: automatic retries run three days, but **manual
retries run 15 days from the Dashboard and 30 from the CLI**, so *"an event arriving now was created
at most three days ago"* — written into `src/billing/quota-override.ts` as load-bearing — is false.

**The decision, and it reverses one I made yesterday.** The mechanism comes out; the delay-induced
error is **accepted rather than fixed**. Two independent reviews have now found a blocking defect in
successive attempts to learn *when* a plan changed from an event, and the honest conclusion is that
an event cannot tell us. `fractionRemaining` goes back to being evaluated at `now`, and
`observedChangeTime`, the `ChangedAt` union, the webhook plumbing and the two `"unknown"` call sites
are deleted. In ordinary operation delivery is seconds and the error is ~0.0002 of an ingest, and the
**exploit direction — a late-period upgrade synced late — is *under*-granted**, which is the safe
side.

What is being accepted, stated rather than smoothed over: a delayed **downgrade** over-grants, which
is generous and fine; a delayed **upgrade** under-grants, which is a real harm to somebody who has
just paid us more, and is repaired only by a manual resync. Rare, and the price of not pretending to
know something we cannot.

**2. A different subscription sharing a period start is misclassified as a plan change. Reproduced.**
`billing_accounts` stores `stripe_subscription_id` and the quota calculation never receives it. Two
subscriptions created in the same Stripe second share a start, so a change in *which subscription
wins* draws a proration delta — 85 where it should clear. The id goes in; a different id clears.

**3. `last_synced_at` was never a valid lower bound anyway.** Stripe is queried at
[`sync.ts`](../../src/billing/sync.ts) and the timestamp is generated later, during the update — so a
plan can change in between and the row stores the old price under a *later* timestamp. Moot once
finding 1's mechanism is gone, and worth recording because the bound looked sound and was not.

**4. A stored absolute limit opts an account out of every future tier change. Reproduced.** An
account carrying override 33 stays at 33 when Reader is raised from 20 to 50 by the one-`UPDATE` the
docs describe, because `limitForPeriod` **replaces** the tier limit rather than adjusting it.

The obvious repair fails: `max(tierLimit, override)` reopens the hole, since an upgrade to Researcher
with an hour left gives `max(33, 150)`. **Store the delta instead of the absolute**, and read
`tierLimit + delta`, floored and clamped:

| | stored | tier | reads | after a tier raise |
|---|---|---|---|---|
| upgrade, an hour left | −117 | Researcher 150 | 33 | 200 → **83** |
| downgrade, 27 days left | +13 | Reader 20 | 33 | 50 → **63** |

The column is unshipped, so the rename is free. `not_negative` must go or become a bound on the
result, since a delta is legitimately negative.
