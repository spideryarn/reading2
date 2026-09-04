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
 * ## Cards since 2026-09-04, and the four things that make them cards
 *
 * It was a three-row `<table>` until stage 2 of that plan. Web research on
 * pricing pages (2025–26), summarised in the plan § *What the research said*,
 * said four things that a three-tier indie product can actually use, and this is
 * all four:
 *
 *  - **Cards, three across, price and button above the fold.** A comparison
 *    table below them earns its place once the cards cannot show the difference;
 *    with three tiers ours can, so there is no table — the old one was doing the
 *    comparison job for a comparison nobody needs.
 *  - **One tier raised, and it is Reader rather than Researcher.** The step up
 *    from Free is the one to point at; pushing a stranger at the £40 tier reads
 *    as pushing, on a product that sells careful reading. The elevation is four
 *    changes at once — raised surface, stronger hairline, a lit top edge, and
 *    the page's one filled button — because any one of them alone is too quiet
 *    to survive the page. Opt-in through `recommended`, and **the thing it is
 *    opted into by is whether the reader is choosing**, never which page they
 *    are on — see `recommended` on `PlanCards` for the version of this that was
 *    wrong for a day.
 *  - **The allowance translated, on the card, never in a tooltip.** "20 articles
 *    a month" is a number with no scale. `habit` is the scale. The rule the plan
 *    drew from it: *if a number needs explaining to be usable, the explanation is
 *    not tooltip material* — tooltips get the fine print instead, and the fine
 *    print is the footnote below.
 *  - **A trust line at the point of decision** — *No card required* under Free,
 *    *Cancel any time* under the paid ones — rather than three inches further
 *    down among the terms.
 *
 * The design was built and looked at as a spike first (variant B of three,
 * 2026-09-04) rather than argued about; the spike is deleted, which is what a
 * spike is for.
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
 * **The `site-*` classes work here even off a `.site` page**, and that took one
 * line of CSS rather than a second set of styles: the `--site-*` custom
 * properties are declared on `.plan-cards` as well as on `.site` (styles.css §
 * the site), because `/profile` is the one caller that is not a marketing page
 * and `site-panel` without those values is a transparent border over no fill —
 * which reads as a class somebody forgot to define rather than as a bug.
 */
import type { ReactNode } from "react";

import { Tooltip } from "./Tooltip.js";

/**
 * One plan as a reader sees it, and the tier id that buys it where there is one.
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
  /**
   * The figure, set large: `$10`, or `No charge`.
   *
   * **Not the plan's own name again.** The first draft of the cards printed
   * *Free* in the price slot under a heading that already said *Free*, and the
   * eye skipped it: a card whose largest word repeats its heading has wasted its
   * largest word.
   *
   * A caller that cannot say which currency the reader will be charged in puts
   * **all** of them here and leaves `alt` unset — see `alt`.
   */
  readonly price: string;
  /** The small word beside the figure: `a month`. Absent where there is none. */
  readonly per?: string | undefined;
  /**
   * The other currencies, faint, on their own line: `£8 · €9`.
   *
   * **Its presence is also what says the figure above is a headline**, and that
   * is deliberate rather than a coincidence to tidy away. The website names one
   * currency and lists the rest, so its figure is short and is set large.
   * `/profile` builds its cards from the billing rows and genuinely does not
   * know which currency Checkout will pick, so it puts all three in `price` and
   * sets no `alt` — and three currencies at 2.1rem in a 230px card is not a
   * headline, it is an overflow. So the card sizes the figure by whether the
   * caller was able to pick one.
   */
  readonly alt?: string | undefined;
  /**
   * What you get, in articles: `20 articles a month`.
   *
   * **The noun is in the string**, and `tests/plans-match-tiers.test.ts` pins the
   * exact wording against `billing_tiers.ingests_per_period`. It read
   * `20 a month` until the cards arrived, which is fine in a column headed
   * *Articles* and means nothing on a card that has no columns.
   */
  readonly allowance: string;
  /**
   * That allowance translated into a reading habit — the research's *explain the
   * unit inline*.
   *
   * Website copy only, so it lives beside the numbers it is arithmetic on and
   * inside the file `tests/plans-match-tiers.test.ts` names when a quota moves.
   * **Raising a quota is one `UPDATE` and two edits here**, not one: the
   * allowance *and* the sentence under it.
   */
  readonly habit?: string | undefined;
  /** One short line under the button, at the point of decision. */
  readonly trust?: string | undefined;
  /** The row's own sentence, on `/profile`. The website copy has none. */
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
  /**
   * The whole accessible name, where the visible one cannot carry the plan.
   *
   * **Only for a label that repeats across the row.** `/pricing` says *Get
   * Reader* and needs nothing here; `/profile` says *Upgrade* on every card,
   * because *Upgrade to Researcher* wraps in a 210px column — and three buttons
   * with one name is a screen reader's button list that cannot say which plan
   * each one buys (GPT Sol, stage 2 code review, finding 5). Whatever goes here
   * must **contain** the visible label, or a reader saying "click Upgrade" to
   * their voice control finds nothing: WCAG 2.5.3.
   */
  readonly ariaLabel?: string | undefined;
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
 *
 * The `habit` and `trust` lines are `[tissue]` — agent-written, approved by Greg
 * on 2026-09-04 and marked so a dictation pass can find them
 * (docs/project/positioning.md § Whose words). They say what the allowance *is*,
 * arithmetically — 20 a month is about one on every weekday, 150 is about seven
 * a working day — and nothing about time saved, which
 * positioning.md § *Depth, and efficiency* rules out along with any number
 * attached to one.
 */
/* **`as const satisfies`, not an annotation**, and the difference is the reason
   `RECOMMENDED_TIER` below can be checked at all. `readonly PlanCard[]` widens
   every `id` to `string`, so a constant naming a tier that does not exist
   typechecks perfectly and silently draws no recommendation — GPT Sol, stage 2
   code review, finding 3. `satisfies` still enforces the shape, which is the
   whole job the annotation was doing. */
export const WEBSITE_PLANS = [
  {
    id: null,
    name: "Free",
    price: "No charge",
    allowance: "3 articles, for life",
    /* [tissue] */
    habit: "Enough to try it on something you actually have to read.",
    /* [tissue] */
    trust: "No card required.",
  },
  {
    id: "reader",
    name: "Reader",
    price: "$10",
    per: "a month",
    alt: "£8 · €9",
    allowance: "20 articles a month",
    /* [tissue] */
    habit: "About one on every weekday.",
    /* [tissue] */
    trust: "Cancel any time.",
  },
  {
    id: "researcher",
    name: "Researcher",
    price: "$50",
    per: "a month",
    alt: "£40 · €45",
    allowance: "150 articles a month",
    /* [tissue] */
    habit: "About seven a working day, for somebody who reads for a living.",
    /* [tissue] */
    trust: "Cancel any time.",
  },
] as const satisfies readonly PlanCard[];

/** A tier the website sells. `null` — the Free card — is not one of them. */
export type WebsiteTierId = NonNullable<(typeof WEBSITE_PLANS)[number]["id"]>;

/**
 * **The one tier the product points at**, by id rather than by position.
 *
 * By id because the id is the thing that means something: reorder
 * `WEBSITE_PLANS` and "the middle one" silently becomes a different plan, which
 * is the same class of mistake as the swapped ids the drift guard now catches.
 *
 * Reader rather than Researcher — the research's *highlight the step up from
 * Free*, and the plan's own reasoning: pushing a stranger at the £40 tier reads
 * as pushing.
 *
 * **The annotation is the guard, and it replaces a runtime one.** `recommended`
 * on `PlanCards` has to stay a plain `string`, because `/profile` builds its
 * cards from `billing_tiers` rows whose ids this file has never seen — so a
 * typo here would have been a recommendation that simply never appeared. It
 * cannot be a throw either: a row legitimately missing from *this* reader's
 * offers is the normal case that component already handles. Typing the constant
 * moves the check to where the literal is actually written. GPT Sol, stage 2
 * code review, finding 3.
 *
 * **Exported because `/profile` points at the same tier**, and two files naming
 * the step up from Free would be two chances to point at different ones.
 */
export const RECOMMENDED_TIER: WebsiteTierId = "reader";

/**
 * The plans as the *website* says them, with the footnote that belongs to them.
 *
 * A thin wrapper rather than three more props, so the marketing copy and the
 * marketing numbers stay in one place: `/`, `/features` and `/pricing` render
 * this, `/profile` renders `PlanCards` directly with rows of its own. Neither
 * call site holds a sentence about the plans, which is what stops the three
 * pages drifting.
 *
 * @param recommend whether this reader is **choosing** between the plans. See
 * `PlanCards`' own `recommended` for why that is the question, and why it is
 * asked of the caller: this component knows the copy, and only the page knows
 * who is reading it.
 */
export function WebsitePlans({
  action,
  recommend,
}: {
  action?: PlanAction | undefined;
  recommend: boolean;
}) {
  return (
    /* **The width cap came off with the table.** Three rows of two words each,
       stretched across 1152px, read as a spreadsheet with the data missing — so
       the table was capped at `max-w-2xl`. Three cards across the shell is what
       the row is *for*, and `PlanCards` caps itself at `max-w-md` in the stacked
       view, which is where a full-width card would look wrong. */
    <div>
      <PlanCards
        plans={WEBSITE_PLANS}
        action={action}
        recommended={recommend ? RECOMMENDED_TIER : null}
      />
      <PlanFootnote />
    </div>
  );
}

/**
 * The fine print under the cards — and the only place on these pages a tooltip
 * is allowed.
 *
 * **The two sentences are Greg's** (2026-09-02, rephrased to the reader; the
 * quota rule is the plan's) and are not rewritten here, only marked up:
 * docs/project/marketing-pages.md § *The copy is not yours to write* permits a
 * restructure to move a sentence and not to rewrite one.
 *
 * **Why the detail is here and not on the card.** The research's rule, taken
 * from the biggest legibility gap it found: a number a reader needs explained
 * before they can use it gets its explanation *on the card* (that is `habit`);
 * what gets a tooltip is the sentence they only read if they are already
 * suspicious — which of their presses cost them one, and what happens to the
 * ones that fail. Putting the allowance itself behind a hover would hide the one
 * thing they came to find out.
 *
 * **It must work by tap and by keyboard, and that is why the trigger is a
 * `<button>`.** `Tooltip` opens on focus (`useFocus`) as well as on hover, and
 * an uncontrolled one lets Floating UI's `useHover` answer touch too — but none
 * of that reaches a `<span>`, which takes no focus and is not a thing a
 * screen reader announces as pressable. A hover-only tooltip is invisible on a
 * touchscreen, which for a sentence about money is close to not being there
 * (Tooltip.tsx § `ControlTip` makes the same argument against `title`).
 */
function PlanFootnote() {
  return (
    <p className="tw:mt-6 tw:max-w-2xl tw:text-sm tw:leading-relaxed">
      <FinePrint
        tip={
          <>
            {/* [tissue] **Checked against the admission path, not against a
                doc about it**, because the second sentence of each paragraph is
                the kind that is easy to get backwards: a slot is reserved only
                where the request carries a URL or an upload (src/routes.ts →
                `withIngestSlot`, src/billing/admission.ts), and it is *settled*
                only on a `done` ending — every other ending releases it
                (src/store/pg-session.ts § settleJob). A re-run against a slug
                you already own carries neither, so it never reserves; pasting a
                URL again does, even when every step then finds its artefact and
                skips. */}
            {/* The same head-then-paragraphs shape every other card in the app
                has (Tooltip.tsx § `ControlTip`), so a reader who has met one
                already knows what they are looking at. */}
            <div className="tip-soon-head">What counts as one</div>
            {/* **"a paywall" named something the code cannot see.** Nothing
                detects a paywall; what is refused is an extraction that
                produced no blocks (`assertSomethingWasProduced`, src/blocks.ts),
                which is what a hard paywall or an error page comes to — while a
                soft one that still yields readable prose ends `done` and
                settles its slot like any other article. GPT Sol, stage 2 code
                review, finding 2; the same correction is on `/pricing`'s FAQ,
                which is the longer telling of this sentence. */}
            <p>
              An article is one URL or one file, and it counts when it comes back readable. A fetch
              that fails, a paywall that leaves no readable article, or a PDF we turn down costs you
              nothing.
            </p>
            <p>
              Pasting the same URL again counts again — it is a second add. Refreshing something
              already on your shelf does not: re-running it from source is free, however many times
              you do it.
            </p>
          </>
        }
      >
        A successfully added article
      </FinePrint>{" "}
      counts; everything you do with it afterwards is included. Reading is never gated: at your
      limit you can still read every article you have and every public one.
    </p>
  );
}

/**
 * A phrase in the fine print that has more behind it.
 *
 * Underlined with dots rather than a solid rule, so it does not read as a link
 * to somewhere else; the card *is* the destination.
 */
function FinePrint({ tip, children }: { tip: ReactNode; children: ReactNode }) {
  return (
    /* **`tip-soon`, the card class the rest of the app's tooltips use**, rather
       than a width utility of this file's own. There is no preflight here, so a
       bare `<p>` inside the panel would arrive with the UA's 1em margins; that
       class carries `.tip-soon p` spacing and size, and its own `min()` width
       clamp, which styles.css § tip-soon warns must not be overridden without
       restating. */
    <Tooltip content={tip} placement="top" className="tip-soon">
      <button
        type="button"
        className="tw:p-0 tw:text-left tw:underline tw:decoration-dotted tw:underline-offset-4 tw:decoration-ink-faint"
      >
        {children}
      </button>
    </Tooltip>
  );
}

/**
 * The plans themselves, and nothing around them.
 *
 * @param plans in the order they should be read — cheapest first, the same
 * order `summary.offers` arrives in.
 * @param action what may be done with each plan, or omitted entirely on a page
 * where nothing may be done.
 * @param recommended the tier id to raise out of the row, or omitted for a row
 * of equals.
 *
 * **The question it answers is whether this reader is choosing, and it was
 * attached to the route instead for a day.** `WebsitePlans` passed the tier
 * unconditionally, so a signed-in Researcher reading `/pricing` saw *Reader* —
 * a downgrade they cannot buy, `canCheckout` being false while a subscription
 * is live — labelled Recommended; while `/profile` declined it, although its
 * cards render only when `canCheckout` is true, which is exactly the moment
 * somebody is choosing. Both halves are one mistake: a recommendation belongs
 * where there is a choice to make, and the page is the only thing that knows.
 * GPT Sol, stage 2 code review, finding 3.
 */
export function PlanCards({
  plans,
  action,
  recommended,
}: {
  plans: readonly PlanCard[];
  action?: PlanAction | undefined;
  recommended?: string | null | undefined;
}) {
  /* Asked once per plan and kept, rather than asked again inside the card: an
     action is free to be a closure over billing state, and calling it twice per
     render for the same answer invites somebody to make it do work. */
  const cards = plans.map((plan) => ({ plan, act: action?.(plan) ?? null }));
  /* Only if the row actually contains it. A `recommended` naming a tier that is
     not on this page — `/profile` hiding Reader from a Reader subscriber, say —
     would otherwise reserve an eyebrow line above cards that never get one. */
  const raises = recommended != null && plans.some((plan) => plan.id === recommended);

  return (
    /* **`plan-cards` is not decoration**: it is where the `--site-*` ladder is
       declared for the callers that are not `.site` pages. See the header.

       `max-w-md` in the stacked view and none above `lg`, so a phone gets one
       readable column rather than one card the width of the page.

       **`lg:py-4` is the room the raised card needs, and it is not spacing.**
       That card is lifted by `-my-4` (`OnePlan`), which shrinks its margin box
       rather than growing the row, so it hangs 1rem out of this element at the
       top and the bottom. `/pricing` never showed it, because the footnote
       under the cards carries `mt-6` and absorbed the overhang; `/profile` puts
       its Stripe sentence a `gap-2` away, and the card was drawn straight
       through the text — found in a browser the moment `/profile` started
       recommending a tier (GPT Sol, stage 2 code review, finding 3). Padding
       here fixes every caller at once, and it keeps the overhang inside the box
       a screenshot is clipped to
       (docs/project/marketing-pages.md § Screenshotting the pages). Only at
       `lg`, because that is the only width the lift exists at. */
    <div className="plan-cards tw:mx-auto tw:grid tw:max-w-md tw:gap-4 tw:lg:max-w-none tw:lg:grid-cols-3 tw:lg:py-4">
      {cards.map(({ plan, act }) => (
        <OnePlan
          key={plan.name}
          plan={plan}
          act={act}
          elevated={raises && plan.id === recommended}
          reserveEyebrow={raises}
        />
      ))}
    </div>
  );
}

/**
 * One plan, as a card.
 *
 * `elevated` is four changes at once and they are meant to be read together —
 * raised surface, stronger hairline, brighter inset top edge, and the filled
 * button. **Depth here is a hairline plus an inset top highlight, never a drop
 * shadow**: the app's `--background`, `--card` and `--border` are three greys
 * within 0.13 of each other, so a black shadow on a near-black page does
 * nothing, and the 1px lit top edge is the whole effect
 * (docs/project/marketing-pages.md § The visual language).
 *
 * The utilities win over `.site-panel` on purpose: `@layer utilities` outranks
 * `@layer app`, which is where styles.css lands (tailwind.css § the `@layer`
 * statement). Every value is an existing `--site-*` custom property or the same
 * translucent white the block already uses; nothing new, and nothing in
 * tokens.css.
 *
 * `tw:order-first` is what puts the raised card at the top of the stack below
 * `lg`, where *the middle card* means nothing.
 */
function OnePlan({
  plan,
  act,
  elevated,
  reserveEyebrow,
}: {
  plan: PlanCard;
  act: PlanCardAction | null;
  elevated: boolean;
  /** This row has a recommended card, so every other card keeps its space. */
  reserveEyebrow: boolean;
}) {
  const raised = elevated
    ? "tw:border-[var(--site-hairline-strong)] tw:bg-[var(--site-surface-raised)] " +
      "tw:shadow-[inset_0_1px_0_rgb(255_255_255/0.11)] " +
      /* Taller than its neighbours at desktop, so the card physically stands
         out of the row rather than only being a different colour. Below `lg`
         the row is a stack and there is nothing to stand out of. */
      "tw:order-first tw:lg:order-none tw:lg:-my-4 tw:lg:py-10"
    : "site-panel-hover";

  return (
    <div className={`site-panel tw:flex tw:flex-col tw:px-6 tw:py-6 ${raised}`}>
      {/* A non-breaking space, not an empty string: HTML collapses ordinary
          whitespace, so a blank `<p>` would have no height at all and the two
          quiet cards would ride a line higher than the recommended one.

          Only above `lg`, because that is the only place the alignment it buys
          exists. In the stacked view there is no row to line up with, and the
          reserved eyebrow is just an empty line over two of the three cards. */}
      {reserveEyebrow && (
        <p
          className={`site-eyebrow tw:mb-3 tw:min-h-[0.95rem] ${
            elevated ? "" : "tw:hidden tw:lg:block"
          }`}
          aria-hidden={!elevated}
        >
          {elevated ? "Recommended" : " "}
        </p>
      )}

      <h3 className="tw:font-prose tw:text-base tw:text-foreground">{plan.name}</h3>

      <p className="tw:mt-4 tw:flex tw:flex-wrap tw:items-baseline tw:gap-2">
        <span
          className={`tw:font-prose tw:leading-none tw:font-medium tw:text-foreground ${
            plan.alt ? "tw:text-[2.1rem]" : "tw:text-xl"
          }`}
        >
          {plan.price}
        </span>
        {plan.per && <span className="tw:text-sm tw:text-muted-foreground">{plan.per}</span>}
      </p>
      {/* Reserved even when empty, so the three allowance lines sit on one
          baseline across the row. A ragged row of three prices is the first
          thing the eye finds wrong in a pricing table. */}
      <p className="tw:mt-2 tw:min-h-[1.1rem] tw:text-xs tw:text-ink-faint">{plan.alt ?? " "}</p>

      <p className="tw:mt-5 tw:text-sm tw:font-medium tw:text-foreground">{plan.allowance}</p>
      {/* The website's translation of the allowance, or the tier row's own
          sentence on `/profile` — one slot, because they are the same slot:
          the line under the number that says what the number means. */}
      {(plan.habit ?? plan.note) && (
        <p className="tw:mt-1.5 tw:text-sm tw:leading-relaxed tw:text-muted-foreground">
          {plan.habit ?? plan.note}
        </p>
      )}

      {/* Pushes the button to the foot of whichever card is tallest, so the
          three CTAs line up however the lines above them wrap. */}
      <div className="tw:mt-6 tw:flex-1" />

      {/* **A `<button>`, not the anchor the spike used.** Every action here is a
          press with an effect — a checkout POST, or a jump to the panel that
          signs you in — and none of them is a destination, so there is no href
          to give. `site-cta` styles both the same way. */}
      {act && (
        <button
          type="button"
          disabled={act.disabled}
          onClick={act.onPress}
          aria-label={act.ariaLabel}
          className={`site-cta ${
            elevated ? "site-cta-primary" : "site-cta-ghost"
          } tw:w-full tw:justify-center tw:disabled:opacity-60`}
        >
          {act.label}
        </button>
      )}
      {plan.trust && (
        <p
          className={`tw:text-center tw:text-xs tw:text-ink-faint ${act ? "tw:mt-3" : "tw:mt-0"}`}
        >
          {plan.trust}
        </p>
      )}
    </div>
  );
}
