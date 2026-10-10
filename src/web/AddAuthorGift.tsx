/**
 * **For the author…** — the add page's admin-only control, drawn under the
 * High-powered AI box. It draws an `AuthorGiftAtAddController`
 * (src/web/add-author-gift.ts), which holds the state; the page sends the
 * request as it leaves (AddPage.tsx § `leave`).
 * docs/plans/261009u-author-gift-draft-voucher-from-the-add-page.md § D9.
 *
 * **The button opens a question; it makes nothing**, like *Create a private
 * link* beside it (AddShareLink.tsx): four plain lines on what will happen,
 * and the private link's own rights tick-box, because the gift makes one.
 * Confirmed, it ticks High-powered AI through that box's own controller, so
 * the early send, the `404` retries and the line under the box are unchanged.
 */
import { useSyncExternalStore } from "react";
import { Gift, TriangleAlert } from "lucide-react";

import { SHARING_RIGHTS_CONFIRM } from "../messages.js";
import { Button } from "@/components/ui/button";
import type { AuthorGiftAtAddController } from "./add-author-gift.js";
import type { HighPowerIntent } from "./add-high-power.js";
import { Link } from "./Link.js";

export const AUTHOR_GIFT_AT_ADD_LABEL = "For the author…";
export const AUTHOR_GIFT_AT_ADD_CONFIRM = "Draft a gift for the author";
export const AUTHOR_GIFT_AT_ADD_ARMED =
  "Armed: when the import finishes, a draft gift is made before the article opens.";
export const AUTHOR_GIFT_AT_ADD_SENDING = "Drafting the author gift…";
export const AUTHOR_GIFT_AT_ADD_OPEN_ANYWAY = "Open the article anyway";
export const ADMIN_VOUCHERS_HREF = "/admin/vouchers";

/** The four lines, in order. */
export const AUTHOR_GIFT_AT_ADD_STEPS = [
  "High-powered AI is switched on for this article.",
  "A private link is made when the import finishes.",
  "A web lookup looks for the author and an email address, using up to three searches.",
  "A draft gift appears on /admin/vouchers. Nothing is sent until you press Send there.",
] as const;

export function AddAuthorGift({
  gift,
  highPower,
}: {
  gift: AuthorGiftAtAddController;
  highPower: HighPowerIntent;
}) {
  const state = useSyncExternalStore(gift.subscribe, gift.get);

  return (
    <div data-add-author-gift className="tw:mt-3 tw:text-sm">
      {state.kind === "off" && (
        <Button type="button" variant="outline" size="sm" onClick={() => gift.open()}>
          <Gift size={14} />
          {AUTHOR_GIFT_AT_ADD_LABEL}
        </Button>
      )}

      {state.kind === "confirming" && (
        <div className="tw:rounded-md tw:border tw:border-rule-strong tw:bg-surface-raised tw:p-3">
          <h4 className="tw:m-0 tw:mb-2 tw:text-sm tw:font-semibold tw:text-ink">
            Draft a gift of articles for this piece's author?
          </h4>
          <ul className="tw:m-0 tw:mb-3 tw:pl-5 tw:text-ink-faint">
            {AUTHOR_GIFT_AT_ADD_STEPS.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ul>
          <label className="tw:mb-3 tw:flex tw:items-start tw:gap-2 tw:text-ink">
            <input type="checkbox" checked={state.rights} onChange={(event) => gift.tick(event.target.checked)} />
            <span>{SHARING_RIGHTS_CONFIRM}</span>
          </label>
          <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
            <Button
              type="button"
              size="sm"
              disabled={!state.rights}
              onClick={() => {
                if (gift.confirm()) highPower.want(true);
              }}
            >
              {AUTHOR_GIFT_AT_ADD_CONFIRM}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => gift.cancel()}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {state.kind === "armed" && (
        <p className="tw:m-0 tw:text-muted-foreground" aria-live="polite">
          <span className="tw:inline-flex tw:items-center tw:gap-1">
            <Gift size={13} className="tw:text-ink-faint" />
            {AUTHOR_GIFT_AT_ADD_ARMED}
          </span>{" "}
          <Button type="button" variant="ghost" size="sm" onClick={() => gift.undo()}>
            Undo
          </Button>
        </p>
      )}

      {state.kind === "sending" && (
        <p className="tw:m-0 tw:text-muted-foreground" aria-live="polite">
          {AUTHOR_GIFT_AT_ADD_SENDING}
        </p>
      )}

      {state.kind === "made" && (
        <p className="tw:m-0 tw:text-muted-foreground" aria-live="polite">
          {state.created ? "Author gift drafted." : "This article already had an author gift."}
        </p>
      )}

      {(state.kind === "refused" || state.kind === "lost") && (
        <p data-add-author-gift-failed className="tw:m-0 tw:text-highlight-text" role="alert">
          <span className="tw:inline-flex tw:items-center tw:gap-1">
            <TriangleAlert size={12} />
            {state.kind === "refused"
              ? `The author gift was not made — ${state.message}`
              : `No answer about the author gift — it may or may not have been made (${state.message}).`}
          </span>{" "}
          See <Link href={ADMIN_VOUCHERS_HREF}>/admin/vouchers</Link>.
        </p>
      )}
    </div>
  );
}
