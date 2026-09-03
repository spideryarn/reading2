/**
 * The three plans, rendered on the landing page and the features page.
 *
 * As docs/plans/260902i-stripe-payments-and-subscription-tiers.md set them on
 * 2026-09-02, and as `billing_tiers` holds them. **The numbers here are copy,
 * not configuration**: the source of truth is the database, and when a quota
 * changes there this table is a second copy that has to be changed by hand —
 * the trade the plan made so that a signed-out page needs no fetch. Reading is
 * never gated, in Greg's words (2026-09-02): *"if a user has hit their quota,
 * they should still be able to read their existing and Public-readable
 * articles, just not incur extra spend."*
 *
 * Its own module rather than an export of one page imported by the other,
 * which the cross-family review (docs/plans/260902k-website-copy-review-sol.md,
 * finding 8) rightly called the wrong direction of ownership.
 *
 * The line under the table is the second half of the landing page's honest
 * strip: the copy is written as if sign-up and payment are open, and until they
 * are, a table of prices with no way to pay needs the sentence beside it, on
 * both pages. Delete `OpensShortly` with the strip, the day sign-up opens.
 */
import { CONTACT_EMAIL } from "../site-text.js";

/** [tissue] Until sign-up opens: the one sentence that has to sit beside a price. */
export function OpensShortly() {
  const subject = encodeURIComponent("Tell me when Spideryarn Reading sign-up opens");
  return (
    <p className="tw:mt-4 tw:text-sm">
      Sign-up opens shortly.{" "}
      <a
        href={`mailto:${CONTACT_EMAIL}?subject=${subject}`}
        className="tw:text-highlight tw:no-underline tw:hover:underline"
      >
        Email us
      </a>{" "}
      (it opens your mail app) and we’ll tell you the day it does.
    </p>
  );
}

export function Plans() {
  const cell = "tw:py-2 tw:pr-6 tw:align-top";
  return (
    <div>
      <table className="tw:mt-4 tw:w-full tw:border-collapse tw:text-sm">
        <thead>
          <tr className="tw:border-b tw:border-border tw:text-left tw:text-xs tw:uppercase tw:tracking-wide tw:text-ink-faint">
            <th className={cell}>Plan</th>
            <th className={cell}>Articles</th>
            <th className={cell}>Price</th>
          </tr>
        </thead>
        <tbody className="tw:text-foreground">
          <tr className="tw:border-b tw:border-border">
            <td className={cell}>Free</td>
            <td className={cell}>3, for life</td>
            <td className={cell}>—</td>
          </tr>
          <tr className="tw:border-b tw:border-border">
            <td className={cell}>Reader</td>
            <td className={cell}>20 a month</td>
            <td className={cell}>$10 · £8 · €9 a month</td>
          </tr>
          <tr>
            <td className={cell}>Researcher</td>
            <td className={cell}>150 a month</td>
            <td className={cell}>$50 · £40 · €45 a month</td>
          </tr>
        </tbody>
      </table>
      {/* Greg, 2026-09-02, rephrased to the reader; the quota rule is the plan's. */}
      <p className="tw:mt-4 tw:text-sm">
        A successfully added article counts; everything you do with it afterwards is included.
        Reading is never gated: at your limit you can still read every article you have and every
        public one.
      </p>
      <OpensShortly />
    </div>
  );
}
