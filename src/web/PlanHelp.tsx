/**
 * **Where a reader stands, and how it works** — three pieces drawn on both
 * `/profile` (BillingSection.tsx) and the shelf's free-allowance box
 * (FreeAllowance.tsx), so the two pages cannot tell the story differently.
 *
 * Greg, 2026-10-01 (spya-x9taw3):
 *
 * > If a user has received a gift voucher, then make that a bit more visible in
 * > the profile, a little bit like you do already on the logged in homepage.
 * > Make sure there are tooltips and stuff in both cases that are linked to the
 * > pricing page and explain the model and when the monthly limits will reset
 * > and what they'll reset to. … Maybe make these be reusable UI components
 * > across both these places.
 *
 * Plan 261002b stage 2. **The words are `planTip` and `planExplainer`'s**, in
 * src/billing-plan.ts beside `describePlan`, where they are tested without a
 * DOM; this file draws them and adds the links.
 *
 * - `PlanInfo` — an (i) beside the plan's headline. It **is** a link to
 *   `/pricing`, and its tooltip is `planTip`: hover or focus to read, press to
 *   go. On a touch screen, where nothing hovers, a tap follows the link, and the
 *   same facts are one tap away in `HowYourPlanWorks`.
 * - `GiftList` — each gift, its size, when it was added, and whether it is
 *   counting now or waiting for Free. Drawn only when `plan.gifts` exists.
 * - `HowYourPlanWorks` — the collapsed explainer.
 */
import type { ReactNode } from "react";
import { Gift as GiftIcon, Info } from "lucide-react";

import { type Gift, type ReaderPlan, planExplainer, planTip, readableDate } from "../billing-plan.js";
import { Link } from "./Link.js";
import { PRICING_HREF, PROFILE_HREF } from "./router.js";
import { TipNote, Tooltip } from "./Tooltip.js";

function articles(n: number): string {
  return n === 1 ? "1 article" : `${n} articles`;
}

/** The (i) beside a plan's headline: a link to Pricing whose tooltip says where the reader stands. */
export function PlanInfo({ plan }: { plan: ReaderPlan }) {
  const tip = planTip(plan);
  if (tip === null) return null;
  return (
    <Tooltip
      placement="bottom"
      content={
        <>
          <TipNote>{tip}</TipNote>
          <TipNote>Plans and prices are on the Pricing page.</TipNote>
        </>
      }
    >
      <Link
        href={PRICING_HREF}
        data-testid="plan-info"
        aria-label={`How your plan works: ${tip} See Pricing.`}
        className="tw:inline-flex tw:size-5 tw:shrink-0 tw:items-center tw:justify-center tw:rounded-full tw:align-middle tw:text-muted-foreground tw:hover:text-highlight tw:focus-visible:text-highlight"
      >
        <Info size={14} aria-hidden="true" />
      </Link>
    </Tooltip>
  );
}

/** The gifts a plan carries, in a highlighted panel — or nothing for a reader without one. */
export function GiftList({ plan }: { plan: ReaderPlan }) {
  const gifts: readonly Gift[] =
    plan.kind === "free" || plan.kind === "lapsed" || plan.kind === "paid" ? (plan.gifts ?? []) : [];
  if (gifts.length === 0) return null;
  const counting = plan.kind !== "paid";
  return (
    <div
      data-testid="gift-list"
      className="tw:flex tw:items-start tw:gap-2 tw:rounded-md tw:bg-highlight/10 tw:px-3 tw:py-2 tw:text-sm tw:text-foreground"
    >
      <GiftIcon size={16} aria-hidden="true" className="tw:mt-0.5 tw:shrink-0 tw:text-highlight" />
      <div className="tw:min-w-0">
        <p className="tw:m-0 tw:font-medium">{gifts.length === 1 ? "You have a gift" : "You have gifts"}</p>
        <ul className="tw:m-0 tw:mt-1 tw:flex tw:list-none tw:flex-col tw:gap-0.5 tw:p-0 tw:text-xs tw:text-muted-foreground">
          {gifts.map((gift) => {
            const added = readableDate(gift.claimedAt);
            return (
              <li key={gift.noticeKey}>
                {articles(gift.articles)}, a gift{added ? `, added ${added}` : ""}
              </li>
            );
          })}
        </ul>
        <p className="tw:m-0 tw:mt-1 tw:text-xs tw:text-muted-foreground">
          {counting
            ? "Part of your free allowance, and counted in the number above."
            : "Waiting: gifts count on the Free plan, so these start counting if you are ever back on it."}
        </p>
      </div>
    </div>
  );
}

/**
 * The collapsed *How … works*, with the links each page needs. `where` decides
 * one link: the shelf points at the Profile, which `/profile` would point at
 * itself.
 */
export function HowYourPlanWorks({
  plan,
  where,
  children,
}: {
  plan: ReaderPlan;
  where: "shelf" | "profile";
  /** Drawn at the end of the open details — the shelf puts its gift list here. */
  children?: ReactNode;
}) {
  const lines = planExplainer(plan);
  if (lines.length === 0) return null;
  const paid = plan.kind === "paid";
  return (
    <details data-testid="how-your-plan-works" className="tw:text-xs tw:leading-relaxed tw:text-muted-foreground">
      <summary className="tw:cursor-pointer tw:select-none tw:hover:text-foreground">
        {paid ? "How your plan works" : "How free articles work"}
      </summary>
      <ul className="tw:m-0 tw:mt-2 tw:flex tw:list-disc tw:flex-col tw:gap-1 tw:pl-5">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
        <li>
          {paid ? "Every plan, and what each gives, is on the " : "For more, subscribe to a plan on the "}
          <Link href={PRICING_HREF}>Pricing page</Link>
          {where === "shelf" ? (
            <>
              ; {paid ? "you manage yours" : "once subscribed, you manage it"} from your{" "}
              <Link href={PROFILE_HREF}>Profile</Link>.
            </>
          ) : (
            "."
          )}
        </li>
      </ul>
      {children}
    </details>
  );
}
