/**
 * The three plans, drawn once for every page that shows them — and, since
 * 2026-09-04, with somewhere to press.
 *
 * **Presentational, and that is the whole point of the file.** It knows nothing
 * about billing: no `useBilling`, no fetch, no tier row, no Stripe. It is handed
 * a list of plans and an optional action per plan, and it draws them. Everything
 * that decides *whether* a plan may be bought, and what happens when the button
 * is pressed, lives in the page that renders this — `/pricing`
 * (PricingPage.tsx) and `/profile` (BillingSection.tsx) — and there is still
 * exactly one copy of the checkout flow, in useBilling.ts.
 *
 * That seam was decided before any of it was built
 * (docs/plans/260904b-pricing-page-and-public-showcase.md § *One owner of the
 * billing state*), because the obvious alternative — a `PlanChooser` that owns
 * its own `useBilling()` — puts two `/api/billing/usage` reads and two
 * independent busy/error states on the one page that already had one.
 *
 * ## Two sources for the same three facts, deliberately
 *
 * The signed-out pages (`/`, `/features`, `/pricing`) render `WebsitePlans`
 * below, whose numbers are **copy rather than configuration** — the trade made
 * on 2026-09-02 so that a page a stranger lands on needs no fetch, and the
 * reason `tests/plans-match-tiers.test.ts` exists: it reads this file and fails
 * when `billing_tiers` disagrees with it.
 *
 * `/profile` hands in cards built from the **rows** instead
 * (`summary.offers`), which is the property BillingSection.tsx argued for at
 * length and this change had no reason to take away: raising a quota there is
 * one `UPDATE` and that page follows without a deploy. One component, two
 * callers, each saying out loud where its numbers came from.
 *
 * Reading is never gated, in Greg's words (2026-09-02): *"if a user has hit
 * their quota, they should still be able to read their existing and
 * Public-readable articles, just not incur extra spend."*
 *
 * **It used to carry a second line, and it does not any more.** Until
 * 2026-09-03 an `OpensShortly` component sat under the table — the second half
 * of the landing page's honest strip, there because a table of prices with no
 * way to pay needs a sentence beside it. Stripe went live that day and sign-up
 * opened to anyone, so Greg had it and the strip deleted together.
 *
 * **Still a table, on purpose.** Stage 1 of the plan moves the *button*; stage 2
 * restyles this into actual cards on the `site-*` tokens. Building the new look
 * here and undoing it there was the shape the review rejected, so what changed
 * is the seam and not the appearance.
 */
import { Button } from "@/components/ui/button";

/**
 * One plan as a reader sees it: four short strings and, where there is one, the
 * tier id that buys it.
 *
 * `id` is `null` for Free — nothing to buy, so nothing to post. Where it is set
 * it is `billing_tiers.id`, which is the **only** thing a checkout POST carries
 * (useBilling.ts § *Only a tier id crosses the wire*), so a typo here is a
 * button that silently never appears rather than one that buys the wrong thing:
 * every caller checks the id against `summary.offers` before offering an action.
 * `tests/plans-match-tiers.test.ts` asserts the ids in this file are ids the
 * database actually sells, because "silently never appears" is precisely the
 * failure nobody notices.
 */
export interface PlanCard {
  readonly id: string | null;
  /** `Reader`, not `Spideryarn Reader` — the plan word, as the site writes it. */
  readonly name: string;
  readonly allowance: string;
  readonly price: string;
  /** The row's own sentence, on `/profile`. The website copy has none yet. */
  readonly note?: string | undefined;
}

/**
 * What pressing a plan does, decided entirely by the caller.
 *
 * **The label is the caller's too, including the pressed one** ("Opening
 * Stripe…"). It would be shorter to pass a `pressed` boolean and let this file
 * write that sentence, and it would put a fact about Stripe inside a component
 * whose whole claim is that it knows nothing about billing — on `/pricing` the
 * signed-out press does not go to Stripe at all, it goes to the sign-in panel.
 */
export interface PlanCardAction {
  readonly label: string;
  /** Any action on the page is mid-flight, so none of them may be pressed. */
  readonly disabled: boolean;
  readonly onPress: () => void;
}

/** Given a plan, what may be done with it here — or `null` for nothing. */
export type PlanAction = (plan: PlanCard) => PlanCardAction | null;

/**
 * The three plans as the website states them, and the second copy of every
 * number in `billing_tiers`.
 *
 * As docs/plans/260902i-stripe-payments-and-subscription-tiers.md set them on
 * 2026-09-02, and as `billing_tiers` holds them. Changing a price or a quota is
 * an `UPDATE` **and** an edit here; the guard that notices when only one of the
 * two happens is `tests/plans-match-tiers.test.ts`.
 *
 * **Exported for that guard, and the export is the guard's teeth.** It read this
 * constant's *source text* until 2026-09-04 and asked whether each name, id,
 * allowance and price appeared somewhere in the file — four independent
 * substring searches, never bound into one row. GPT Sol swapped the `reader` and
 * `researcher` ids, leaving `{ id: "researcher", name: "Reader" }`, and every
 * check still passed; that mutation makes *Get Reader* buy Researcher, because
 * the only thing a checkout carries is the id. Handing the test the real records
 * lets it compare a whole row against the tier it claims to be.
 */
export const WEBSITE_PLANS: readonly PlanCard[] = [
  { id: null, name: "Free", allowance: "3, for life", price: "—" },
  { id: "reader", name: "Reader", allowance: "20 a month", price: "$10 · £8 · €9 a month" },
  {
    id: "researcher",
    name: "Researcher",
    allowance: "150 a month",
    price: "$50 · £40 · €45 a month",
  },
];

/**
 * The plans as the *website* says them, with the footnote that belongs to them.
 *
 * A thin wrapper rather than a fourth prop, so the marketing copy and the
 * marketing numbers stay in one place: `/`, `/features` and `/pricing` render
 * this, `/profile` renders `PlanCards` directly with rows of its own. Neither
 * call site holds a sentence about the plans, which is what stops the three
 * pages drifting.
 */
export function WebsitePlans({ action }: { action?: PlanAction | undefined }) {
  return (
    /* Capped rather than filling the page shell. Three rows of two or three
       words each, stretched across 1152px, read as a spreadsheet with the data
       missing; the eye has to travel the width of the page to join a plan to its
       price. The shell went wide for the pictures, not for this. */
    <div className="tw:max-w-2xl">
      <PlanCards plans={WEBSITE_PLANS} action={action} />
      {/* Greg, 2026-09-02, rephrased to the reader; the quota rule is the plan's. */}
      <p className="tw:mt-4 tw:text-sm">
        A successfully added article counts; everything you do with it afterwards is included.
        Reading is never gated: at your limit you can still read every article you have and every
        public one.
      </p>
    </div>
  );
}

/**
 * The plans themselves, and nothing around them.
 *
 * @param plans in the order they should be read — cheapest first, the same
 * order `summary.offers` arrives in.
 * @param action what may be done with each plan, or omitted entirely on a page
 * where nothing may be done. The fourth column appears only if at least one
 * plan has an action, so the two marketing pages are unchanged.
 */
export function PlanCards({
  plans,
  action,
}: {
  plans: readonly PlanCard[];
  action?: PlanAction | undefined;
}) {
  const cell = "tw:py-2.5 tw:pr-6 tw:align-top";
  /* Asked once per plan and kept, rather than asked again inside the row: an
     action is free to be a closure over billing state, and calling it twice per
     render for the same answer invites somebody to make it do work. */
  const rows = plans.map((plan) => ({ plan, act: action?.(plan) ?? null }));
  const anyAction = rows.some((row) => row.act !== null);

  return (
    <table className="tw:mt-4 tw:w-full tw:border-collapse tw:text-sm">
      <thead>
        <tr className="tw:border-b tw:border-border tw:text-left tw:text-xs tw:uppercase tw:tracking-wide tw:text-ink-faint">
          <th className={cell}>Plan</th>
          <th className={cell}>Articles</th>
          <th className={cell}>Price</th>
          {/* No visible heading: the buttons say what they are, and "Buy" over a
              column that is empty for Free reads as a missing value. The column
              still needs a header cell for the row lengths to agree. */}
          {anyAction && <th className={cell} aria-label="Subscribe" />}
        </tr>
      </thead>
      <tbody className="tw:text-foreground">
        {rows.map(({ plan, act }, index) => (
          <tr
            key={plan.name}
            className={index < rows.length - 1 ? "tw:border-b tw:border-border" : undefined}
          >
            <td className={cell}>
              {plan.name}
              {plan.note && (
                <span className="tw:mt-0.5 tw:block tw:text-xs tw:text-muted-foreground">
                  {plan.note}
                </span>
              )}
            </td>
            <td className={cell}>{plan.allowance}</td>
            <td className={cell}>{plan.price}</td>
            {anyAction && (
              <td className={`${cell} tw:pr-0 tw:text-right`}>
                {act && (
                  <Button type="button" size="sm" disabled={act.disabled} onClick={act.onPress}>
                    {act.label}
                  </Button>
                )}
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
