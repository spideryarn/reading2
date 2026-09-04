/**
 * An ingest failure, **with the way out of it beside the sentence** when the
 * failure is the quota.
 *
 * The refusal copy already names the way forward — *"the pricing page sets one
 * up"* (`ingestQuotaReached`, src/messages.ts) — and until this existed that
 * sentence was the whole of it: the reader was told where to go and given
 * nothing to press. A line of prose pointing at a page is a worse version of a
 * link to that page.
 *
 * ## One component, four places
 *
 * Three routes can produce this refusal — `POST /api/jobs`, its `/retry`, and
 * `POST /api/uploads`, which refuses at the door with the same sentence — so it
 * lands in four: the add box on the shelf and a job card's refused **Retry**
 * (both AddArticle.tsx), the add page a pasted URL navigates to (AddPage.tsx),
 * and the upload picker (UploadPicker.tsx). Four renderings of one refusal would
 * be four chances for three of them to stop offering the link.
 *
 * ## Only the quota gets a link
 *
 * `quotaRefusalCode` reads the bracketed code, not the prose and not the status
 * — see it for why. Everything else this can be handed, from a 500 to an
 * unreachable Stripe, renders as the plain sentence it already was: a link
 * under *"we could not reach Stripe"* would send somebody to buy their way out
 * of an outage.
 *
 * ## And the three refusals do **not** share a destination
 *
 * They did for a day. Between 2026-09-04 and the review of that day's work all
 * three pointed at `/pricing`, on the reasoning that *a quota refusal means
 * buy* — and for one of the three it does. GPT Sol found the other two arrive
 * at a page with prices and nothing to press, which is a worse place to be sent
 * than nowhere:
 *
 * - **`pay-free`** — never subscribed, so every tier is on sale to them, and
 *   `/pricing` is exactly the page that answers *what would I have to pay to add
 *   this?*
 * - **`pay-limit`** — a subscription that is working, at its monthly ceiling.
 *   What they need is the date it resets and the subscription they already have,
 *   and both are on `/profile` — where a renewing plan's *"the allowance starts
 *   again on…"* is always drawn, while `/pricing` deliberately omits it
 *   (PricingPage.tsx § `CurrentPlan`).
 *
 *   **Two of the three arguments for that destination have now expired, and the
 *   destination has deliberately not moved.** Until 2026-09-04 the hosted Portal
 *   could not move Reader → Researcher, and until later that day `canCheckout`
 *   drew a subscriber no button anywhere, so a reader at their ceiling genuinely
 *   had nowhere to go. Both are fixed: Stripe takes the switch, and
 *   `summary.purchase` (src/billing/summary.ts) now offers a Reader the tier
 *   above on **both** pages — so `/pricing` is no longer a dead end for a
 *   subscriber, and `/profile` is not the only page that is not one. Do not
 *   re-point this link on the strength of that: Greg is deciding where a capped
 *   subscriber should land separately, and the reset date is still only here.
 * - **`pay-lapsed`** — and **the client cannot tell which kind of lapse this
 *   is.** `hasLapsed` (src/store/pg-billing.ts) covers a cancelled subscription,
 *   which is terminal and may check out again, *and* `unpaid` / `incomplete`,
 *   which are not terminal and may not. One code, two remedies, and the message
 *   carries nothing that separates them. So this takes the destination that is
 *   never a dead end: `/profile` draws the plan cards when there is something to
 *   sell **and** the Portal button when there is a customer to manage, so it
 *   works for both halves, where `/pricing` works for only one — an `unpaid`
 *   subscription is `purchase: { kind: "none" }` there, with nothing to press.
 *
 * `src/messages.ts`'s sentences name these pages and no others — the prose and
 * the link under it have to agree, or the reader is choosing between them.
 */
import { ArrowRight } from "lucide-react";

import { quotaRefusalCode } from "../messages.js";
import type { QuotaCode } from "../messages.js";
import { Link } from "./Link.js";
import { PRICING_HREF, PROFILE_HREF } from "./router.js";

/** Where this refusal's remedy is, and what to call the link to it. */
interface WayOut {
  readonly href: string;
  readonly label: string;
}

/**
 * The destination per refusal, argued in the header.
 *
 * **No `default` arm, deliberately.** The return type is `WayOut`, so a fourth
 * `QuotaCode` added to src/messages.ts stops this compiling rather than falling
 * through to whichever page happened to be the fallback — which is the failure
 * this function was written to end.
 */
function wayOut(code: QuotaCode): WayOut {
  switch (code) {
    case "pay-free":
      /* *Plans and prices*, not *Upgrade*: this reader is asking what carrying
         on would cost, and the page is where that is answered. */
      return { href: PRICING_HREF, label: "Plans and prices" };
    case "pay-limit":
    case "pay-lapsed":
      /* *Your plan*, because that is what is on the other end — a subscription
         that exists, with whatever can still be done to it. Not "Upgrade":
         for `pay-limit` there is nothing to upgrade to. */
      return { href: PROFILE_HREF, label: "Your plan" };
  }
}

/**
 * @param message the server's own sentence, or null for nothing to say.
 * @param className the caller's own text treatment. Each of the four places
 * already has one and they are not the same — the add page's error is `text-sm`,
 * the add box's is `text-xs` — so this component sets no size or colour of its
 * own rather than making three of them wrong.
 */
export function QuotaNotice({
  message,
  className,
}: {
  message: string | null | undefined;
  className: string;
}) {
  if (!message) return null;
  const code = quotaRefusalCode(message);
  if (code === null) return <p className={className}>{message}</p>;
  const out = wayOut(code);

  return (
    <p className={className}>
      {message}{" "}
      {/* A real `Link`, so it is a middle-click-able address rather than a
          button that only works with a plain click — and the client router
          handles it without a reload. The label says what is on the other end
          rather than "click here". */}
      <Link href={out.href} className="tw:inline-flex tw:items-center tw:gap-1 tw:text-highlight">
        {out.label}
        <ArrowRight size={12} />
      </Link>
    </p>
  );
}
