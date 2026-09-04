/**
 * **The allowance prorates, because the price does.**
 *
 * Pure: no database, no network, no clock of its own. Given what the row said
 * and what Stripe now says, it answers with the two columns that go back into
 * the row. `syncSubscriptionFromStripe` (./sync.ts) is the only caller, and it
 * writes the answer in the same locked statement as `price_id` and the period.
 *
 * ## The mismatch this closes
 *
 * Stripe prorates the **money** on a mid-period plan change — `always_invoice`,
 * `billing_cycle_anchor: "unchanged"` — and we used to hand over the
 * **allowance** whole. So: upgrade with an hour left in the period for a few
 * pence of proration, take the full 150 ingests, downgrade before the roll,
 * repeat every month. Researcher volume at roughly the Reader price, and
 * scriptable. *Nobody uses 130 ingests in an hour* is not an answer: the quota
 * is an abuse boundary against a script, and a script can.
 *
 * So a mid-period change moves the limit by what the money actually bought:
 *
 *     limit ← floor(limit + (allowance(new tier) − allowance(old tier)) × remaining)
 *
 * where `remaining` is the fraction of the period still ahead **when the sync
 * runs**. Upgrading on day 27 of 30 takes a Reader from 20 to 33, not to 150.
 *
 * ## This is the accrual model, which is worth knowing before rewriting it
 *
 * Allowance accrues continuously at whatever tier you are on, so what a reader
 * has bought by the end of a period is `accrued(t) + R × f(t)`. At a change,
 *
 *     L_new = accrued + R_new × f = L_old + (R_new − R_old) × f
 *
 * which is the recurrence above, exactly. **The arithmetic is not the place to
 * look if this is ever wrong** — the inputs are. Three shapes were proposed and
 * refuted before this one settled, and all three are recorded in
 * docs/plans/260903i-fix-the-upgrade-path-and-the-cancellation-telling.md so
 * that the next person does not propose them a fourth time. The short versions:
 * `used_so_far + R × f` is not idempotent, because `used_so_far` moves — it
 * granted 429 ingests against a tier of 150 inside one period when simulated;
 * and scaling by a *change time* taken from the delivering event is wrong for
 * the reason below.
 *
 * ## Why `f` is taken at the sync, and the error that costs
 *
 * Stripe prorates the money **when the plan changes**; this scales the allowance
 * **when we hear about it**. Every millisecond between the two is granted at the
 * wrong tier's rate, and the error is `Δ × delay / period length`.
 *
 * That is accepted rather than fixed, because the obvious fix does not work.
 * Taking the moment from the delivering event's `created` was built and then
 * removed: the webhook handles four event types identically and then fetches
 * *current* state, so **the event that provokes a sync is not necessarily the
 * event that caused the change it finds**. A `checkout.session.completed` retry
 * from day 17 can arrive after a day-20 upgrade and discover it, and scaling by
 * day 17 grants 76 where the day-20 answer is 63. `created` is the moment the
 * *event object* was made and nothing ties it to a transition; Stripe does not
 * guarantee delivery order; and the "at most three days old" bound that argument
 * rested on is simply false — automatic retries run three days, but a **manual**
 * retry runs 15 days from the Dashboard and 30 from the CLI. GPT Sol, 2026-09-04,
 * reproduced.
 *
 * **The residual error is one-directional, and both directions are written down
 * rather than papered over.** A delayed *downgrade* over-grants, which is
 * generous to somebody who is paying us less and is accepted. A delayed
 * *upgrade* **under**-grants, which is a real harm to a customer who has just
 * paid more — rare, since ordinary delivery is seconds, and repaired by a manual
 * resync. The exploit this file exists to close runs through the upgrade
 * direction, so lag can only make it safer, never worse.
 *
 * ## Why the accumulated limit is floored, and never rounded
 *
 * **Rounding each delta independently is a ratchet, and a script can turn it.**
 * Switch up when 130 × remaining is 64.6 (+65) and immediately back down when it
 * is 64.4 (−64): net +1, for two Portal clicks and no money. Two hundred and
 * sixty clicks is the whole 130 back.
 *
 * Flooring the *accumulated* limit cannot do that, and the proof is two lines.
 * The stored limit `b` is always an integer, so
 *
 *     floor(floor(b + d₁) + d₂) ≤ floor(b + d₁ + d₂)
 *
 * — every step is bounded by the exact arithmetic, and by induction so is any
 * sequence of them. An up-and-down pair therefore nets at most
 * `floor(Δ × time actually spent on the higher tier)`, which is what the reader
 * paid for. The cost of this direction is that each switch loses **up to one
 * ingest** to the floor: an upgrade two hours into a fresh month gives 149
 * rather than 150, and ten switches drift down by ten. That is deliberate — the
 * error is small, bounded by the number of plan changes, and points away from
 * the exploit. Storing a fractional limit would remove the drift and would not
 * fix the 149, since the read still has to floor.
 *
 * ## The ordering rule, which is the part written on purpose
 *
 * Stripe does not guarantee webhook order, so the question *is this event about
 * the period I have stored?* has to be asked explicitly. It is asked of the
 * **period start**, never of a subscription-item id: the hosted Portal *updates*
 * the existing subscription item on a plan switch rather than replacing it —
 * measured from invoice lines in Stage 2, where the item id is the same before
 * and after — so an id would be stable across exactly the event we care about
 * and would tell us nothing.
 *
 * | the incoming period start | what it means | what happens |
 * |---|---|---|
 * | **equal** to the stored one, same price | a retry, or an unrelated field moved | the override is carried through unchanged |
 * | **equal**, different price | the plan changed inside this period | the delta above |
 * | **anything else** | this is not the period the override was computed for | cleared |
 *
 * **That third row folds together the plan's "later" and "earlier" branches, and
 * the reason is that the earlier case is not what the plan thought it was.**
 * `syncSubscriptionFromStripe` does not apply a webhook payload; it locks the
 * row and *then* asks Stripe, so a second delivery can never carry older state
 * than the first — it re-reads the world after the first has committed. An
 * incoming period start *earlier* than the stored one therefore does not mean a
 * stale event. It means the subscription that wins has changed: a Researcher
 * with a later anchor was cancelled and a Reader running the 1st to the 1st now
 * wins, say. Ignoring that would leave an override attached to a period the row
 * no longer has, and the read side would ignore it anyway. Clearing says the
 * same thing, in the row, where somebody can read it.
 *
 * **No branch skips the write.** `sync.ts` writes every field on every sync on
 * purpose — a partial update is how a cancelled subscription keeps a period that
 * makes it look current — and these two columns are written on every sync like
 * the rest, including when the answer is "the same as before".
 */

/** What the tier table answers. Filled in by `quotaRules` in ./tiers.ts. */
export interface QuotaRules {
  /** Ingests a period this price sells, or `null` for a price no tier sells. */
  readonly allowanceFor: (priceId: string | null) => number | null;
  /** The largest allowance any tier sells — the ceiling nothing may exceed. */
  readonly maxAllowance: number;
}

/**
 * The two columns, as they are stored and as they are written back.
 *
 * **A delta, not a limit**, and that is the difference between a tier table that
 * still governs and one that has been opted out of. Raising a quota here is one
 * `UPDATE` and no deploy (docs/project/billing.md), and an account carrying an
 * *absolute* 33 would have sat at 33 through every future raise, for ever. What
 * the plan change was **worth** does not go stale when the tier moves: a Reader
 * who upgraded with three days left is 117 short of a whole Researcher month,
 * and stays 117 short of whatever a Researcher month becomes. GPT Sol,
 * 2026-09-04, reproduced.
 */
export interface QuotaAdjustment {
  /**
   * Ingests added to — or taken from — the tier's own allowance this period.
   * Negative for an upgrade, positive for a downgrade, `null` for "nothing
   * happened, ask the tier".
   */
  readonly delta: number | null;
  /** The period that number belongs to. Null exactly when `delta` is. */
  readonly periodStart: Date | null;
}

/** No adjustment: the ordinary state, and what every unrecognised case falls to. */
export const NO_ADJUSTMENT: QuotaAdjustment = { delta: null, periodStart: null };

/** What the locked row said before this sync. */
export interface StoredQuota {
  /**
   * **Which subscription the rest of this row is about.**
   *
   * Without it a change of *winner* is indistinguishable from a change of
   * *plan*: two subscriptions created in the same Stripe second share a period
   * start, so the period test cannot separate them, and a Researcher giving way
   * to a separate Reader read as a mid-period downgrade and was prorated as one.
   */
  readonly subscriptionId: string | null;
  readonly priceId: string | null;
  readonly currentPeriodStart: Date | null;
  readonly adjustment: QuotaAdjustment;
}

/** What Stripe says now — the chosen subscription, or null for none. */
export interface IncomingPeriod {
  readonly subscriptionId: string;
  readonly priceId: string;
  readonly periodStart: Date;
  readonly periodEnd: Date;
}

/** How much of `[start, end)` is still ahead of `now`, in `[0, 1]`. */
export function fractionRemaining(period: IncomingPeriod, now: Date): number {
  const length = period.periodEnd.getTime() - period.periodStart.getTime();
  /* A period that does not have positive length cannot be divided by, and
     `readSubscription` refuses one — so this is a guard against a future caller
     rather than a reachable state. Nothing remaining is the safe reading. */
  if (!(length > 0)) return 0;
  const left = (period.periodEnd.getTime() - now.getTime()) / length;
  return Math.min(1, Math.max(0, left));
}

/**
 * The override the row should carry after this sync.
 *
 * @param now the instant the sync is being made at — passed, never read from
 * the clock, so the whole decision is a pure function of its inputs. **It is the
 * sync's instant and not the change's**, deliberately; the header says why the
 * difference is accepted rather than corrected.
 */
export function nextQuotaAdjustment(args: {
  stored: StoredQuota;
  incoming: IncomingPeriod | null;
  now: Date;
  rules: QuotaRules;
}): QuotaAdjustment {
  const { stored, incoming, now, rules } = args;

  /* No subscription we can meter: nothing to prorate, and the row is about to
     say so in every other column too. */
  if (!incoming) return NO_ADJUSTMENT;

  /* **A different subscription, or a different period, is not a plan change.**
     A renewal, a subscription bought a minute ago, or a change in which of two
     subscriptions wins — whichever it is, the reader gets the allowance the tier
     sells for the period they are now in, which is the one they have just been
     charged for in full. Both halves are needed: the periods of two
     subscriptions created in the same Stripe second are identical, so the
     subscription id is the only thing that separates them. */
  const sameSubscription =
    stored.subscriptionId !== null && stored.subscriptionId === incoming.subscriptionId;
  const sameStart =
    stored.currentPeriodStart !== null &&
    stored.currentPeriodStart.getTime() === incoming.periodStart.getTime();
  if (!sameSubscription || !sameStart) return NO_ADJUSTMENT;

  /* Same subscription, same period, same price: a retry, or a sync provoked by
     something else entirely — a cancellation, a card change. Nothing bought
     anything, so nothing moves. This is the branch that makes a redelivered
     webhook safe. */
  if (stored.priceId === incoming.priceId) return carriedThrough(stored, incoming);

  const before = rules.allowanceFor(stored.priceId);
  const after = rules.allowanceFor(incoming.priceId);
  /* A price no tier sells on either side of the change. The entitlement falls to
     free for exactly that reason (`entitlementFromRow`), so there is no
     allowance to move and no previous one to move it from. Unreachable through
     the Portal, which offers only what we sell. */
  if (before === null || after === null) return NO_ADJUSTMENT;

  /* What they were actually allowed a moment ago — the old tier plus whatever
     an earlier change this period had already moved it by. An integer, which is
     what the floor proof in the header needs. */
  const allowedBefore = before + (stored.adjustment.delta ?? 0);
  const moved = (after - before) * fractionRemaining(incoming, now);
  const allowedNow = clamp(Math.floor(allowedBefore + moved), rules.maxAllowance);
  /* **Stored relative to the new tier**, so that raising that tier tomorrow
     raises this account with it. */
  return { delta: allowedNow - after, periodStart: incoming.periodStart };
}

/**
 * The stored adjustment, re-dated to the period it already belongs to.
 *
 * Re-dating rather than passing the stored value straight back is what keeps the
 * two columns consistent when only one of them was set — a hand-typed `UPDATE`,
 * a partially-applied migration — without a second rule about what to do then.
 */
function carriedThrough(stored: StoredQuota, incoming: IncomingPeriod): QuotaAdjustment {
  if (stored.adjustment.delta === null) return NO_ADJUSTMENT;
  return { delta: stored.adjustment.delta, periodStart: incoming.periodStart };
}

/**
 * **Belt-and-braces.** The incremental formula telescopes and cannot exceed the
 * largest tier — Fable checked the up/down/up ratchet, and the floor above
 * proves it — but "I reasoned it is safe" and "it cannot be unsafe" are
 * different claims, and only one of them survives somebody editing the formula.
 */
function clamp(limit: number, maxAllowance: number): number {
  return Math.min(Math.max(limit, 0), maxAllowance);
}

/**
 * **What the row actually allows this period** — the read side, and the only
 * arithmetic admission does.
 *
 * **The tier is the base and the stored number adjusts it**, which is what keeps
 * a one-`UPDATE` quota raise working for an account that changed plan mid-period.
 *
 * The adjustment applies **only to the period it was computed for**. That is the
 * second of the two guards: a sync that failed to clear an old one, a row
 * restored from a backup, a period that moved for a reason nobody predicted —
 * none of them can meter somebody on a number belonging to another month.
 *
 * @param tierLimit what `billing_tiers.ingests_per_period` sells today.
 * @param periodStart the period the entitlement is being read for.
 */
export function limitForPeriod(
  tierLimit: number,
  periodStart: Date,
  adjustment: QuotaAdjustment,
  maxAllowance: number,
): number {
  if (adjustment.delta === null || adjustment.periodStart === null) return tierLimit;
  if (adjustment.periodStart.getTime() !== periodStart.getTime()) return tierLimit;
  /* Clamped here rather than only at the write, because this is the last place
     before a limit is enforced — and because the delta column carries no
     range constraint of its own: the bound it would need lives in another
     table. A hand-typed absurdity fails towards nothing, never towards more. */
  return clamp(tierLimit + adjustment.delta, Math.max(maxAllowance, tierLimit));
}
