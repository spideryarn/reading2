/**
 * `/pricing` — what it costs, at an address you can send somebody.
 *
 * **This page holds no numbers of its own.** It renders the same `<Plans />`
 * the landing page and the features page do, which is the point: three copies
 * of a price table would be three chances to disagree, and the one that is
 * wrong is always the one the customer read. Greg asked for this page on
 * 2026-09-03 and asked, if possible, that it keep itself up to date.
 *
 * ## How "up to date" is arranged, given the table is hardcoded
 *
 * The numbers in Plans.tsx are copy rather than configuration — a deliberate
 * trade so a signed-out page needs no fetch (Plans.tsx explains it). A public
 * `/api/tiers` would have undone that trade for a table that changes a few
 * times a year, and would have put a spinner in front of the first thing a
 * stranger wants to know.
 *
 * So the drift is caught rather than designed away: `tests/plans-match-tiers.test.ts`
 * reads `billing_tiers` and fails if this table disagrees with it. Raising a
 * quota is still one `UPDATE` (docs/project/billing.md), and it is still two
 * edits — but the second one can no longer be forgotten quietly, which is the
 * part that actually costs a customer.
 *
 * Reachable signed out, like `/privacy` and `/features`, and rather more so: a
 * price you have to sign up to read is the thing people complain about.
 *
 * ## Which plan you are on, and why that is a prop rather than a fetch
 *
 * Greg, 2026-09-03, asked the page to "indicate what you're on now". A signed-in
 * reader gets one line saying so, below the table; a signed-out one gets
 * nothing, and — the point — makes no request. `readerId` comes from App.tsx,
 * which already branches on signed-in to decide whether this page wears the
 * corner logo, so the answer is known before the page renders and there is no
 * moment where it has to guess. A `useBilling()` inside an unconditional render
 * would have put a 401 on the path of the one page a stranger is most likely to
 * be sent, for a line that is not for them.
 *
 * **It carries a reader id rather than a boolean, and that is the account
 * switch.** The first version took `signedIn: boolean`, which is enough to
 * decide whether to ask and not enough to say *who asked*: on a direct A→B
 * sign-in the route does not change, so React keeps this element in the same
 * place in the tree, `useBilling`'s one effect never re-runs — it depends only
 * on `attempt` — and B reads A's tier and A's usage count for as long as they
 * stay on the page. The repo has met this before and fixed it the same way, on
 * the shelf: `<Library key={user.id} readerId={user.id} />`, with the reasoning
 * beside it in App.tsx. So this page is keyed on the id too, and the prop is
 * the id, so a rendering that does not know which reader it is drawing cannot
 * be written.
 *
 * Below the table rather than above it, because it arrives a moment after the
 * prose does: above, it would push the prices down under the reader's eye just
 * as they started reading them.
 *
 * Styled with Tailwind utilities — docs/project/web-client.md. `tw:` prefix on
 * every class.
 */
import { ArrowLeft } from "lucide-react";

import { describePlan } from "../billing-plan.js";
import { Link } from "./Link.js";
import { pageTitle, useDocumentTitle } from "./page-title.js";
import { Plans } from "./Plans.js";
import { H2 } from "./SiteBits.js";
import { SiteFooter } from "./SiteFooter.js";
import { useBilling } from "./useBilling.js";

export function PricingPage({ readerId }: { readerId: string | null }) {
  useDocumentTitle(pageTitle({ kind: "pricing" }));

  return (
    <main className="tw:mx-auto tw:max-w-3xl tw:px-6 tw:pt-[calc(3.5rem_+_var(--safe-top))] tw:pb-24 tw:font-sans tw:text-[0.95rem] tw:leading-relaxed tw:text-muted-foreground">
      <Link
        href="/"
        className="tw:mb-6 tw:inline-flex tw:items-center tw:gap-1 tw:text-xs tw:text-ink-faint tw:no-underline tw:hover:text-highlight"
      >
        <ArrowLeft size={13} />
        Back
      </Link>

      <H2>Plans</H2>
      <Plans />
      {/* **Keyed here as well as in App.tsx, and this is the one that counts.**
          App.tsx keys the page on the account for the same reason it keys the
          shelf, but a guarantee that lives only in the caller is one edit away
          from being gone, and nothing in this file would notice. Keying the
          line on the reader whose plan it is makes the page safe on its own
          terms: a `readerId` change cannot leave the previous reader's summary
          mounted, whatever the caller does. */}
      {readerId !== null && <CurrentPlan key={readerId} />}

      {/* **What a reader is actually buying**, said once and plainly. The quota
          rule is the plan's (docs/project/billing.md § What we sell); the
          currency sentence is a fact about the Stripe prices, which carry all
          three and let hosted Checkout pick — docs/project/billing.md § Why
          three currencies rather than one. */}
      <H2>How it works</H2>
      <p className="tw:mt-4">
        You are charged in your own currency — the price you see on the payment page is the price
        that leaves your account, tax included. Nothing is added on top.
      </p>
      <p className="tw:mt-4">
        A month's allowance is articles <em>added</em>, and it resets on the day you subscribed.
        Everything you do with an article afterwards — the glossary, the summaries, the questions,
        chat — is included, however many times you come back to it.
      </p>
      {/* **The free three, said out loud, including the part that surprises
          people.** The table says "3, for life" and the sentence under it
          explains what counts, but neither says that *for life* means what it
          says: the count does not reset, and it does not pause while you are
          subscribed. So somebody who takes forty articles on Reader and
          cancels is past the free allowance permanently — the policy Greg chose
          on 2026-09-03 (docs/project/billing.md § *Reading is never gated*),
          and the reason `pay-lapsed` in src/messages.ts needs a third sentence.
          A rule a reader meets for the first time in a refusal reads as a bug;
          here it is a term of sale, which is the right place for it.

          The numbers are `Plans`' to state and this paragraph deliberately
          repeats none of them — a "3" here would be a fourth copy, outside
          what tests/plans-match-tiers.test.ts reads. Nor does it repeat
          *reading is never gated*, which `Plans` has just said three inches
          above; saying it twice on one page reads as a page that doubts it.

          **It does not say "every article you have ever added", which would be
          false.** The ledger started empty when billing launched and articles
          added before that were grandfathered rather than backfilled
          (docs/plans/260902i-stripe-payments-and-subscription-tiers.md), so an
          account older than the ledger has additions that do not count. GPT
          Sol caught that as a false absolute on a sales page, which is the
          right way to read it: the sentence now states the rule going forwards,
          which is both true and the part that can surprise somebody. */}
      <p className="tw:mt-4">
        The free allowance is for the lifetime of the account rather than per month, so it does not
        reset. Articles added while you are subscribed count towards it too, so cancelling does not
        hand back a fresh allowance — though whatever you have added stays yours either way.
      </p>
      <p className="tw:mt-4">
        Cancel whenever you like, from the same page you subscribed on. You keep the month you have
        paid for, and nothing you have added is taken away.
      </p>

      {/* **The shared row, not a hand-written one.** The first draft of this
          page copied the features page's footer, which is exactly the
          duplication SiteFooter.tsx was extracted to stop — and it says so: a
          Terms page should be one entry in its `LINKS`, not an edit to every
          page. No `here` is needed, because `/pricing` parses to its own route
          and the row can drop its own link by itself. */}
      <SiteFooter />
    </main>
  );
}

/**
 * *You are on Free — 1 of 3 articles used.* One line, for a signed-in reader.
 *
 * **Its own component so the hook is conditional legally**, which is the whole
 * reason it is not four lines inside `PricingPage`: React forbids calling
 * `useBilling()` behind an `if`, and the page's signed-out rendering must not
 * make the request at all (see the header).
 *
 * **The words are `describePlan`'s**, not this file's. It is the same sentence
 * `/profile` shows, from src/billing-plan.ts, because a page that phrased the
 * same state differently would be the second source of truth this repo keeps
 * writing postmortems about — and the `lapsed` arm's rule (never *"40 of 3"*)
 * comes along for free rather than needing to be remembered here.
 *
 * **The headline, plus `detail` in the three states where the headline alone
 * does not answer the question Greg asked.** Dropping `detail` everywhere was
 * the first version and it failed *"indicate what you're on now"* in the one
 * state where a reader most needs the answer — GPT Sol, 2026-09-03:
 *
 * - `lapsed` says *"Your plan has ended"*, which names what **ended** rather
 *   than what they are on. Both "two free slots left" and "the free allowance
 *   is spent" collapse into that one sentence, and they are different answers.
 * - `paid` **while cancelling** is word-for-word a renewing subscription: the
 *   cancellation and the date it stops live only in `detail`. Hiding that is
 *   the same failure `/profile` already has open as a live bug in
 *   docs/project/billing.md, and this page should not add a second place it is
 *   not said.
 * - `unknown` says we could not confirm it, and `detail` is what says reading
 *   is unaffected and to reload — a state with no way out of it is worse than
 *   the sentence being long.
 *
 * The other three keep the headline alone: `free` and a renewing `paid` are
 * explained by the table six inches above, and `exempt` and `off` are
 * self-contained. Two explanations of one rule read as a page that is not sure.
 *
 * **And the headline is printed as it stands, with no sentence built around
 * it.** The obvious framing — *"You are on {headline}"* — works for the two
 * states anybody thinks of and is broken English in the other four: *"You are
 * on We could not confirm your plan just now"*, *"You are on Your plan has
 * ended"*. `describePlan` returns six headlines in three grammatical shapes, so
 * the only safe thing to add around one is nothing. `/profile` prints it bare
 * for the same reason.
 *
 * **Nothing at all until the read lands, and nothing if it fails.** `summary`
 * is `null` for "don't know yet", and a plan this page cannot confirm is better
 * left unsaid than guessed: `/profile` is where the plan is authoritative, says
 * so out loud when a read fails, and is one click away from the link beside
 * this. Being silent is the right failure here precisely because this line is
 * an orientation, not a gate — nothing a reader may do depends on it.
 */
function CurrentPlan() {
  const { summary } = useBilling();
  if (!summary) return null;

  const plan = summary.plan;
  const copy = describePlan(plan);
  /* The three states from the header, named as a condition rather than left to
     a reader of the JSX to infer. A `switch` would be the exhaustive form, but
     this is one boolean about presentation and not a fork in what the page
     does. */
  const needsDetail =
    plan.kind === "lapsed" || plan.kind === "unknown" || (plan.kind === "paid" && plan.cancelling);

  return (
    /* **No `role="status"`.** This is passive page content that happens to
       arrive late, not feedback to something the reader did — and the page
       already has a polite live region announcing the title (page-title.ts), so
       a second one would announce twice in an order that depends on which
       request lands first. A live region mounted with its text already in it is
       also the pattern this repo has found screen readers unreliable about.
       Left in document order, where a reader meets it on the way down the page.
       GPT Sol, 2026-09-03. */
    <p className="tw:mt-4 tw:text-sm tw:text-foreground">
      <strong className="tw:font-medium">{copy.headline}</strong>
      {" · "}
      {/* **`/profile`, not a button.** Upgrading is two hosted-Stripe round
          trips and a Checkout return to land back on (useBilling.ts), and all
          of that already exists on the profile page. A second Upgrade button
          here would be a second copy of that flow to keep right. */}
      <Link href="/profile" className="tw:text-highlight">
        Change plan
      </Link>
      {needsDetail && copy.detail && (
        <span className="tw:mt-1 tw:block tw:text-xs tw:text-muted-foreground">{copy.detail}</span>
      )}
    </p>
  );
}
