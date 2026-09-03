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
 * Styled with Tailwind utilities — docs/project/web-client.md. `tw:` prefix on
 * every class.
 */
import { ArrowLeft } from "lucide-react";

import { CONTACT_EMAIL } from "../site-text.js";
import { Link } from "./Link.js";
import { pageTitle, useDocumentTitle } from "./page-title.js";
import { Plans } from "./Plans.js";
import { FEATURES_HREF, PRIVACY_HREF } from "./router.js";
import { H2 } from "./SiteBits.js";

export function PricingPage() {
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
      <p className="tw:mt-4">
        Cancel whenever you like, from the same page you subscribed on. You keep the month you have
        paid for, and nothing you have added is taken away.
      </p>

      <footer className="tw:mt-14 tw:border-t tw:border-border tw:pt-5 tw:text-xs tw:text-ink-faint">
        <p className="tw:m-0">
          <Link href="/" className="tw:text-ink-faint tw:hover:text-highlight">
            Home
          </Link>
          {" · "}
          <Link href={FEATURES_HREF} className="tw:text-ink-faint tw:hover:text-highlight">
            Features
          </Link>
          {" · "}
          <Link href={PRIVACY_HREF} className="tw:text-ink-faint tw:hover:text-highlight">
            Privacy
          </Link>
          {" · "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="tw:text-ink-faint tw:hover:text-highlight">
            {CONTACT_EMAIL}
          </a>
        </p>
      </footer>
    </main>
  );
}
