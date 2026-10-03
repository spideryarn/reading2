/**
 * **The free allowance, on the shelf** — what a Free reader has used, what is
 * left, and a collapsed *How free articles work*. Plan 261001m stage 2;
 * docs/project/library.md § The free-allowance box.
 *
 * Greg, 2026-10-01: *"indicate somewhere on the logged-in Homepage for free
 * users how many free articles used & remaining, plus default-collapsed
 * section … if they have a voucher, show it and its status … If they don't have
 * a voucher, don't mention vouchers at all."*
 *
 * ## What it says, and where each word comes from
 *
 * - **The headline is `describePlan`'s** (src/billing-plan.ts), the same line
 *   `/profile` prints, so the two pages cannot disagree — and it already
 *   refuses the false *N of M* when public or high-powered articles make the
 *   two numbers stop being a ratio (`isRatio`). Nothing here computes
 *   `limit − used`.
 * - **`remaining` is the server's** — further *private* articles the wall would
 *   admit (`ingestHeadroom`). A public one costs half, so the reader may well
 *   add more than this; the expanded text says so.
 * - **Gifts appear only when `plan.gifts` exists**, and the server omits the
 *   field when there are none, so a reader without one meets neither word.
 *
 * Drawn for `free` and `lapsed` only. A subscriber has the renewal on
 * `/profile`; an administrator has no count; `unknown` and `off` are not a
 * free allowance at all.
 *
 * ## The notice
 *
 * *"A gift of 20 articles has been added to your free allowance"* — the plan's
 * stand-in for Greg's *"indicates to them during login"*, on the page sign-in
 * lands on. Driven by the stored `claimedAt` (under seven days old), never by
 * "this request claimed", and dismissed per `noticeKey` in localStorage. Every
 * storage touch is in a `try`, because a browser that blocks site data throws
 * from the accessor itself; then the notice simply comes back next visit.
 */
import { useState } from "react";
import { Gift as GiftIcon, X } from "lucide-react";

import { describePlan, type Gift, type ReaderPlan } from "../billing-plan.js";
import { GiftList, HowYourPlanWorks, PlanInfo } from "./PlanHelp.js";
import { useBilling } from "./useBilling.js";
import { useNow } from "./useNow.js";

/** How long after a claim the *has been added* line is shown. */
export const GIFT_NOTICE_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

const NOTICE_KEY_PREFIX = "spya.giftNotice.dismissed.";

function noticeDismissed(noticeKey: string): boolean {
  try {
    return window.localStorage.getItem(NOTICE_KEY_PREFIX + noticeKey) === "1";
  } catch {
    return false;
  }
}

function rememberDismissed(noticeKey: string): void {
  try {
    window.localStorage.setItem(NOTICE_KEY_PREFIX + noticeKey, "1");
  } catch {
    /* Storage is blocked: dismissed for this page only, back next visit. */
  }
}

type FreePlan = Extract<ReaderPlan, { kind: "free" } | { kind: "lapsed" }>;

function isFree(plan: ReaderPlan): plan is FreePlan {
  return plan.kind === "free" || plan.kind === "lapsed";
}

function articles(n: number): string {
  return n === 1 ? "1 article" : `${n} articles`;
}

/** The box wired to the reader's plan — the only `useBilling()` on the shelf. */
export function FreeAllowance() {
  const { summary } = useBilling();
  const now = useNow();
  /* Nothing at all until the plan arrives, and nothing if it never does: a
     failed read is `/profile`'s to explain, and an error box on the shelf about
     a number most readers never look for would be louder than the number. */
  if (!summary) return null;
  return <FreeAllowanceBox plan={summary.plan} now={now} />;
}

export function FreeAllowanceBox({ plan, now }: { plan: ReaderPlan; now: number }) {
  /* Per-mount record of what was dismissed, so the line goes at once even
     where storage refuses the write. */
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set());
  if (!isFree(plan)) return null;

  const copy = describePlan(plan);
  const gifts: readonly Gift[] = plan.gifts ?? [];
  const fresh = gifts.filter((gift) => {
    const at = Date.parse(gift.claimedAt);
    return (
      Number.isFinite(at) &&
      now - at < GIFT_NOTICE_DAYS * DAY_MS &&
      !dismissed.has(gift.noticeKey) &&
      !noticeDismissed(gift.noticeKey)
    );
  });
  /* The second sentence is worth having on screen only when it says something
     the reader must act on: the allowance is spent, or their plan has ended. */
  const showDetail = plan.kind === "lapsed" || plan.atLimit;

  function dismiss(noticeKey: string) {
    rememberDismissed(noticeKey);
    setDismissed((prev) => new Set(prev).add(noticeKey));
  }

  return (
    <section
      data-testid="free-allowance"
      aria-label="Your free articles"
      className="tw:mb-6 tw:rounded-lg tw:border tw:border-border tw:bg-card tw:px-4 tw:py-3 tw:text-sm"
    >
      {fresh.map((gift) => (
        <p
          key={gift.noticeKey}
          role="status"
          className="tw:m-0 tw:mb-2 tw:flex tw:items-start tw:gap-2 tw:rounded-md tw:bg-highlight/10 tw:px-3 tw:py-2 tw:text-foreground"
        >
          <GiftIcon size={16} aria-hidden="true" className="tw:mt-0.5 tw:shrink-0 tw:text-highlight-text" />
          <span className="tw:min-w-0 tw:flex-1">
            A gift of {articles(gift.articles)} has been added to your free allowance.
          </span>
          <button
            type="button"
            data-testid="gift-notice-dismiss"
            aria-label={`Dismiss gift of ${articles(gift.articles)} notice`}
            title="Dismiss"
            onClick={() => dismiss(gift.noticeKey)}
            className="tw:inline-flex tw:size-7 tw:shrink-0 tw:-my-1 tw:items-center tw:justify-center tw:rounded-md tw:bg-transparent tw:text-muted-foreground tw:hover:bg-highlight/10 tw:hover:text-foreground"
          >
            <X size={14} />
          </button>
        </p>
      ))}

      <div className="tw:flex tw:flex-wrap tw:items-baseline tw:justify-between tw:gap-x-4 tw:gap-y-1">
        <span className="tw:inline-flex tw:min-w-0 tw:items-center tw:gap-1 tw:text-foreground">
          <span className="tw:min-w-0">{copy.headline}</span>
          <PlanInfo plan={plan} />
        </span>
        <span
          data-testid="free-remaining"
          className="tw:inline-flex tw:items-center tw:gap-1 tw:whitespace-nowrap tw:text-muted-foreground"
        >
          {gifts.length > 0 && (
            <GiftIcon
              size={14}
              data-testid="gift-icon"
              aria-label="Includes a gift"
              className="tw:shrink-0 tw:self-center tw:text-highlight-text"
            />
          )}
          {plan.remaining} left
        </span>
      </div>
      {showDetail && copy.detail && (
        <p className="tw:m-0 tw:mt-1 tw:text-xs tw:leading-relaxed tw:text-muted-foreground">{copy.detail}</p>
      )}

      <div className="tw:mt-2">
        {/* The explainer and the gift list are shared with /profile
            (PlanHelp.tsx, plan 261002b), so the two pages say one thing. Here
            the gifts sit inside the collapsed half: the notice above and the
            icon on the count are this box's loud parts. */}
        <HowYourPlanWorks plan={plan} where="shelf">
          {gifts.length > 0 && (
            <div className="tw:mt-3">
              <GiftList plan={plan} />
            </div>
          )}
        </HowYourPlanWorks>
      </div>
    </section>
  );
}
