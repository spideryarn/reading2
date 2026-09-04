# Four billing faults, and the witnesses that agreed with the code

**The faults are from 2026-09-03**, the day billing went live; this was written on **2026-09-04**.
Three were found by GPT Sol reviewing the upgrade path, and one by Greg cancelling the first real
subscription and reading what `/profile` then said.

The fixes are [260903i](../plans/260903i-fix-the-upgrade-path-and-the-cancellation-telling.md);
[billing.md](../project/billing.md) records each fault beside the thing it bites. This is about the
other question — why a green suite, a passing `stripe:check` and a code review found none of them.

[The four](../plans/260903i-fix-the-upgrade-path-and-the-cancellation-telling.md#the-four):

| | |
|---|---|
| **1** | A paying Reader **cannot become a Researcher**. The Portal has `subscription_update.enabled: false`, and `/profile` sends an existing subscriber to the Portal rather than to Checkout, so the loop closes on itself. |
| **2** | A cancellation is **never shown to the reader**. Stripe expressed *cancel at period end* as `cancel_at`; we read only `cancel_at_period_end`, which stayed `false`. |
| **3** | With two live subscriptions the reader is **metered on the wrong one** — `chooseSubscription` picked by latest period start, not largest allowance. |
| **4** | An invoice that **cannot be finalised** leaves the subscription `active`, collected from nobody, and no invoice event is handled at all. |

## Twenty hours

Everything here was written, went live, and broke inside one working day and the one before it.

| when | commit | |
|---|---|---|
| 2026-09-02 15:40 | `9789d5ae` | The Portal configuration: four features, `subscription_update` not among them, and `ensurePortalConfiguration` returning early on an existing default. **Fault 1 born.** |
| 16:00 | `8e97a260` | `cancel_at_period_end` becomes a column. Nothing reads `cancel_at`. **Fault 2 born.** |
| 16:12 | `c9f187a1` | `chooseSubscription` takes the newest live subscription. Harmless: there is one paid tier. |
| 16:58 | `9eeae4e3` | `HANDLED_EVENTS` — four events, plus a comment arguing that no invoice event is needed. **Fault 4 born.** |
| 18:23 | `da98334d` | **A second tier.** Fault 3 becomes real and fault 1 becomes real. |
| 2026-09-03 10:52 | `7fb838c0` | `stripe:check` — three of the four features the setup script writes. |
| 11:37 | | The first live sale. |
| that afternoon | | Greg cancels through the Portal. `/profile` goes on saying the plan renews. |

## Class one: the witness was built from the belief

**A check that shares a parent with the code it checks cannot contradict it.** That is the plan
doc's thesis, and it holds for faults 1, 2 and 4 — not only the two headline ones.

**Fault 1 — the check enumerated our own writes.** `checkPortal`, as born in `7fb838c0`, asked after
`subscription_cancel`, `invoice_history` and `payment_method_update`: a strict subset of the
`features` block `ensurePortalConfiguration` had written in `9789d5ae`, in the sibling script. A
field the setup script never sets is a field the check has no name for, and no state of the Stripe
account could have made it complain. It passed cleanly on live day with the upgrade path shut.

**Fault 2 — the fixture was a cast.** `tests/billing-subscription.test.ts` built its subscriptions
as `{ id, object, status, cancel_at_period_end, livemode, items } as unknown as Stripe.Subscription`.
The cast is the mechanism: a hand-built object cast into a vendor type carries exactly the fields its
author had in mind, and TypeScript is asked to look away. `cancel_at` was in the pinned SDK's
`Subscription` type the whole time and in no fixture we owned.

One step further out, `tests/billing-plan.test.ts` § *does not say a cancelled subscription renews*
was green — asserting the right sentence for `cancelling: true`, a state the sync could not produce
from a Portal cancellation. A passing UI test over an unreachable state.

And the belief was not careless. The pinned SDK documents `cancel_at_period_end` as *"Whether this
subscription will (if `status=active`) or did (if `status=canceled`) cancel at the end of the current
billing period"* — our case, described exactly, on the field that is `false` in our case. Two fields
express one intention; the hosted Portal writes the other one. Reading the field's own documentation
confirmed the wrong answer.

**Fault 4 — a load-bearing negative.** [`src/billing/webhook.ts`](../../src/billing/webhook.ts)
§ `HANDLED_EVENTS` did not merely omit invoice events. It argued for the omission, and still does:

> `invoice.payment_failed` is deliberately absent. `past_due` is an entitled status … and the
> transition into and out of it arrives on `customer.subscription.updated` anyway — so handling the
> invoice event would be a second path to the same conclusion, free to disagree with the first.

Every path that argument enumerates is real, and the fault lives where there is no path. An invoice
that cannot be **finalised** produces no status transition, so no `customer.subscription.updated`
ever arrives, and the subscription sits `active`, entitled, and never collected. **A decision not to
handle something is the cheapest thing in a codebase to get wrong**, because nothing exercises it and
no test can be seen failing on it.

**The tell.** Ask what fact *outside our own head* could make this check go red. If the honest answer
is "a value we wrote", the check tests our consistency, not our correctness.

### The gap was written down, one direction too narrow

`ensurePortalConfiguration`'s header, on the morning of live day (`7fb838c0`):

> `features` are not reconciled on a configuration that already exists. Note the gap that leaves:
> they decide money-sensitive behaviour, so a hand-edited `subscription_cancel` is invisible here.
> Reporting that drift is worth doing and is not done.

Exactly right about the mechanism, and framed as drift somebody else would cause — a hand edit to a
field *we had written*. The case that bit is the one where we never wrote the field at all, so there
was nothing for it to drift from. Afterwards the note reads as though the hole was known.

That is the general finding of
[260903c § a defect recorded instead of fixed will recur](260903c-quiz-band-quota-refused-a-good-batch-and-its-error-reached-the-reader.md),
written the same day, with a sharper edge on it: **a defect note that names one direction of a hole
is worse than none, because it buys the confidence of having looked.**

## Class two: a rule that was only right while a dimension had one value

Fault 3 is not class one, and neither is half of fault 1. **An arbitrary-but-deterministic choice
becomes a policy the moment a second value arrives, and the commit that adds the second value does
not touch it.**

`chooseSubscription`'s reasoning at 16:12, in `c9f187a1`:

> Two live subscriptions for one customer should be impossible — checkout is refused while a
> non-terminal one exists … Picking the newest is a defensible answer and *not* picking one at all
> would be worse (it would drop a paying customer to free), but it is never done quietly.

Both sentences are true, and neither asks *which one is right* — because at 16:12 there was nothing
to be right about. One paid tier meant every live subscription entitled the same 20 ingests, so
"newest" and "largest allowance" were the same rule. The docstring is about determinism and about not
refusing; that was the whole of the question at the time.

Two hours and eleven minutes later `da98334d` separated them. It changed thirteen files including 254
lines of `scripts/stripe-setup.ts`, and it touched **no line of the Portal `features` block** and
**not `src/billing/subscription.ts` at all** — verified by diffing that commit against both. There is
no textual link: `subscription.ts` does not mention a tier, on purpose, and the Portal's feature list
does not mention a plan menu because there was no second plan to list.

Fault 1 is the same commit from the other side: a Portal with no *Switch plan* button is a complete
Portal when there is one plan. So fault 1 was **created by class two and then preserved by class
one** — which is why finding it took a reviewer reading the live Stripe account rather than the code.

**The tell.** When you add the second of something, the code that has to change is often the code
that never names it. Look for the rules that were arbitrary while N was 1: tie-breaks, "pick any",
defaults, `[0]`, and any configuration that enumerates a menu.

Faults 2 and 4 are not this. They were wrong from birth.

## Three of the four are documented in the code that has them

Worth stating, because the tempting reading — *somebody was careless, or skipped a review* — is
false and would send the next person after the wrong fix. `9eeae4e3`'s comment argues for the
omission. `c9f187a1`'s argues for the tie-break. `7fb838c0`'s names the reconcile gap. Only fault 2
is silent. Writing the reasoning down did not help, because in each case the reasoning was **correct
about the question it asked**. Nothing in a comment can ask the question its author did not have.

## The fix that is right for the long term

Per fault, and then the one that outlives them.

- **Fault 2**, landed in `a8a1a0ff`: both raw Stripe facts are stored, and turned into exactly one
  date by `planEndsAt` in [`src/billing-plan.ts`](../../src/billing-plan.ts) — `cancelAt ??
  (cancelAtPeriodEnd ? currentPeriodEnd : null)`. One derived value reaches the browser, because two
  independently-interpreted cancellation flags in the UI is how they drift into this bug a second
  time. The regression test is built from the payload Stripe actually returned.
- **Fault 3**, landed in `631895d6`:
  [`chooseSubscription`](../../src/billing/subscription.ts) now sieves *understood → entitled → on a
  price a tier sells → period containing now → strongest allowance*. The period test comes before the
  ranking deliberately: fault 4's stale-but-`active` subscription would otherwise win for ever, fail
  the period check downstream and refuse the reader at 503.
- **Fault 1**: `portalDrift` in [`scripts/stripe-setup.ts`](../../scripts/stripe-setup.ts) is one
  contract that both the reconcile and `stripe:check` consult, so anything `--apply` would rewrite is
  a blocking failure rather than an opinion held in two places.
- **Fault 4**: not built. It is Stage 4 of the plan, and it needs a policy rather than a log line.

**And the structural one: make the check enumerate the vendor's schema, not our list.** `portalDrift`
covers all five keys of `Stripe.BillingPortal.Configuration.Features` today — by coincidence, not by
construction, because it is a hand-written run of `if`s. A sixth feature in a future SDK bump would be
invisible to it in precisely the way `subscription_update` was, and *one contract, not two* does not
touch that: two scripts agreeing about a field neither knows is still silence. Keying the drift table
on `Record<keyof Stripe.BillingPortal.Configuration.Features, …>` turns the next one into a compile
error, which is what AGENTS.md § *Let the types catch it* asks for.

## What would have caught it — ranked by ease and value

1. **Do the thing a reader does, once, in the sandbox, before live.** Cancel through the Portal and
   read the row back; press *Upgrade to Researcher* and look at the page that arrives. Faults 1 and 2
   both fall out immediately and neither needs any new machinery. Stage 2 did exactly this on
   2026-09-03 and it cost one test-mode Checkout and an afternoon. **A billing integration is not
   verified by asserting what we send. It is verified by performing the reader's journey and reading
   back what the vendor now says.** Cheapest thing here and the highest value by a distance.
2. **Fixtures captured from the vendor, never cast into its type.** `as unknown as Stripe.X` in a
   test is the moment the fixture stops being able to disagree with the code. The practical form is a
   captured payload — the real JSON from a sandbox call, checked in — because `Stripe.Subscription`
   has too many required fields to build honestly by hand, and that difficulty is exactly what the
   cast is hiding. Cost: one sandbox call per event shape, refreshed on an API-version bump. Catches
   fault 2 outright and retires the class wherever else a vendor shape is asserted.
3. **A negative decision needs a citation or a test.** *"`invoice.payment_failed` is deliberately
   absent"* was reasoning about Stripe's behaviour with nothing behind it. Requiring either a link to
   the vendor's own documentation or a test that produces the state would have sent somebody looking
   for a Stripe page saying a failed finalisation moves a subscription to `past_due` — and there is
   none, because it does not. Cost: nothing at writing time; it is a review question, not a
   mechanism. Catches fault 4, which is the one that gives a month away.
4. **Enumerate the vendor's schema.** The `Record<keyof …Features, …>` refactor above. Cost: an
   afternoon. It is the only item on this list that catches the *next* fault 1 rather than this one.
5. **A check on remote configuration must be seen failing against a wrong remote configuration** —
   the specific form of AGENTS.md § *A check you have never seen fail is not evidence*, with the
   wrongness at the vendor rather than in a fixture. Cost: minutes, one deliberate misconfiguration
   in the sandbox. Ranked below 4 because it would **not** have caught fault 1: a check that never
   names `subscription_update` passes a sandbox with `subscription_update` off, too.
6. **When you add the second of something, list what was only correct while there was one.**
   [billing.md § Adding a tier or a currency](../project/billing.md#adding-a-tier-or-a-currency)
   documents adding a tier as one `INSERT` and one script run, and says nothing about the Portal's
   plan menu or about the rule that chooses between two subscriptions — both of which that path
   silently invalidated. Both are handled in code now, so the checklist is not urgent; the point is
   that **the next dimension will not be tiers.** A yearly price is the obvious candidate:
   `stripe:check` pins `interval_count: 1` as a constant, and the quota window, the proration
   fraction and `fractionRemaining` all assume a month. Cost: a paragraph. Value: this is the class
   that produced the expensive fault.

## Still open

- **Fault 4 is not fixed.** No invoice event is handled; a subscription whose invoice cannot be
  finalised stays `active` and entitled. Stage 4 of the plan — **rescoped on 2026-09-04, after this
  section was drafted, to detection rather than a billing hold**: subscribe to
  `invoice.finalization_failed`, and sweep for subscription invoices still `draft` or `open` after
  three days. Half of the premise turned out to be wrong — Stripe's tax documentation says a
  subscription invoice finalises *without* tax rather than sticking in draft, while another Stripe
  page says the opposite — and a stored entitlement-suppressing hold is not something to build on a
  premise the vendor contradicts itself about.
  [The plan records both citations](../plans/260903i-fix-the-upgrade-path-and-the-cancellation-telling.md#stage-4-rescoped-2026-09-04-detect-do-not-hold).
  **This makes item 3 above sharper, not weaker**: *a negative decision needs a citation or a test*
  would have caught the original omission, and *a positive* one deserves the same — the belief that
  a failing finalisation reaches `past_due` went unchallenged for a day in a review by a strong
  model, and was then half-refuted by reading the vendor rather than reasoning.
- **`portalDrift` is exhaustive by coincidence** — item 4 above.
- **The one live cancelled row predates the `cancel_at` column** and will not heal itself;
  [billing.md § The live row that needs a backfill](../project/billing.md#the-live-row-that-needs-a-backfill).
- **The declined-upgrade case is recorded as unverified, which is not the same as safe.** Stripe
  applies a plan change even when the immediate payment fails, and `past_due` is entitled here on
  purpose, so a declined upgrade still grants 150 for the length of dunning. Bounded at roughly $40
  and 130 ingests, and accepted rather than closed.
