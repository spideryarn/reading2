/**
 * An ingest failure, **with the way out of it beside the sentence** when the
 * failure is the quota.
 *
 * The refusal copy already names the way forward — *"the Upgrade button on your
 * profile page sets one up"* (`ingestQuotaReached`, src/messages.ts) — and until
 * this existed that sentence was the whole of it: the reader was told where to
 * go and given nothing to press. A line of prose pointing at a page is a worse
 * version of a link to that page.
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
 * `isQuotaRefusal` reads the bracketed code, not the prose and not the status —
 * see it for why. Everything else this can be handed, from a 500 to an
 * unreachable Stripe, renders as the plain sentence it already was: a link to
 * `/profile` under *"we could not reach Stripe"* would send somebody to buy
 * their way out of an outage.
 */
import { ArrowRight } from "lucide-react";

import { isQuotaRefusal } from "../messages.js";
import { Link } from "./Link.js";
import { PROFILE_HREF } from "./router.js";

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
  if (!isQuotaRefusal(message)) return <p className={className}>{message}</p>;

  return (
    <p className={className}>
      {message}{" "}
      {/* A real `Link`, so it is a middle-click-able address rather than a
          button that only works with a plain click — and the client router
          handles it without a reload. The label says what is on the other end
          rather than "click here": for a lapsed or a monthly-limit refusal the
          page is where you resubscribe or see the reset date, and "Your plan"
          is true of all three cases where a free-account "Upgrade" would not
          be. */}
      <Link href={PROFILE_HREF} className="tw:inline-flex tw:items-center tw:gap-1 tw:text-highlight">
        Your plan
        <ArrowRight size={12} />
      </Link>
    </p>
  );
}
