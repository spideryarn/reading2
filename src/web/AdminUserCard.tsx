/**
 * **A link to one account on `/admin/users`, with a card saying how much they
 * use Spideryarn.**
 *
 * Greg, 2026-10-19 (`spya-qdd2vc`), on /admin/vouchers: *"create link from each
 * user to /admin/users , with a tooltip summarising their usage"*. Plan
 * docs/plans/261019k-admin-vouchers-links-each-account-to-admin-users-with-a-usage-card.md.
 *
 * **The card shows nothing `/admin/users` does not.** Its facts are read off
 * the same `AdminUser` row that page draws, from the same request
 * (`useAdminUsers`), so it adds no field to what an admin page may show
 * (docs/project/admin.md § the one rule). The link goes to
 * `/admin/users?user=<id>`, which marks that row in the whole table.
 *
 * Shaped like the paper card (PaperCard.tsx): a title, then label-and-value
 * facts, one short line each (tooltips.md § Short paragraphs or bullets). The
 * caller decides which account and how its row was found; this file knows
 * nothing about vouchers, so `/admin/feedback` or `/admin/articles` could carry
 * the same link.
 */
import type { ReactNode } from "react";

import { type AdminUser, formatWholeDollars } from "../admin.js";
import { Link } from "./Link.js";
import { timeAgo } from "./relative-time.js";
import { ADMIN_USERS_HREF } from "./router.js";
import { Tooltip } from "./Tooltip.js";

/**
 * What the card has to go on. The link itself needs only the id, so it works
 * while the user list is still loading, or after it failed; the card says
 * which.
 */
export type AccountUsage =
  | { readonly kind: "loaded"; readonly user: AdminUser }
  /** A failed refresh left the last successful row in memory. */
  | { readonly kind: "stale"; readonly user: AdminUser; readonly error: string }
  | { readonly kind: "loading" }
  | { readonly kind: "failed"; readonly error: string }
  /** The list arrived without this id: an account deleted since, most likely. */
  | { readonly kind: "missing" };

/** `/admin/users?user=<id>` — AdminPage.tsx § `AdminUsersPage` reads `user`. */
export function adminUserHref(id: string): string {
  return `${ADMIN_USERS_HREF}?user=${encodeURIComponent(id)}`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The card's lines, in order. Pure, so the wording is tested without a pointer. */
export function accountUsageFacts(user: AdminUser, now: number): { label: string; value: string }[] {
  const ago = (iso: string | undefined) => timeAgo(iso, now);
  const shelf =
    plural(user.articles, "article") +
    (user.archived > 0 ? `, ${user.archived} archived` : "") +
    (user.uploads > 0 ? `; ${plural(user.uploads, "PDF")} uploaded` : "");
  const opened =
    user.opens === 0
      ? "never"
      : `${plural(user.opens, "time")}${user.lastReadAt ? `, last ${ago(user.lastReadAt) ?? "at an unknown time"}` : ""}`;
  /* The period on the line, and the unpriced calls beside the money: the two
     conditions the Spend column carries for the same figure (admin-columns.tsx
     § `Spend`). No calls is said in words, not as `$0`. */
  const period = `${user.spendMonth} (UTC)`;
  const spend =
    user.spendCalls === 0
      ? `none recorded in ${period}`
      : `${formatWholeDollars(user.spendNanos)} in ${period}, ${plural(user.spendCalls, "call")}` +
        (user.spendUnpricedCalls > 0 ? `, ${user.spendUnpricedCalls} unpriced` : "");
  return [
    { label: "Signed up", value: ago(user.createdAt) ?? "at an unknown time" },
    { label: "Last sign-in", value: ago(user.lastSignInAt) ?? "never" },
    { label: "Shelf", value: shelf },
    /* `questions` is passages marked with a comment: /admin/users calls the
       column Comments (admin-columns.tsx). */
    {
      label: "Used",
      value: `${plural(user.questions, "comment")} · ${plural(user.chats, "chat")} · ${plural(user.searches, "search", "searches")}`,
    },
    { label: "Opened", value: opened },
    { label: "Plan", value: user.planStatus ? `${user.plan} (${user.planStatus})` : user.plan },
    { label: "Model calls", value: spend },
  ];
}

export function AccountUsageCard({ usage, now }: { usage: AccountUsage; now: number }) {
  switch (usage.kind) {
    case "loading":
      return <p className="tip-byline tw:m-0">Their usage is still loading. Open Users for the whole row.</p>;
    case "failed":
      return <p className="tip-byline tw:m-0">Could not read their usage: {usage.error}</p>;
    case "missing":
      return <p className="tip-byline tw:m-0">This account is not in the user list. It may have been deleted.</p>;
    case "stale":
    case "loaded":
      return (
        <div className="tip-paper">
          <div className="tip-title">{usage.user.email}</div>
          {usage.kind === "stale" && (
            <p className="tip-byline">
              Usage is from the last successful read; refresh failed: {usage.error}
            </p>
          )}
          <dl className="tip-facts">
            {accountUsageFacts(usage.user, now).map(({ label, value }) => (
              <div key={label} className="tw:contents">
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <p className="tip-account-press">Open in Users</p>
        </div>
      );
    default: {
      const never: never = usage;
      return never;
    }
  }
}

/** The address (or whatever the caller draws) as a link to the account, with the card on it. */
export function AdminUserLink({
  id,
  usage,
  now,
  children,
}: {
  id: string;
  usage: AccountUsage;
  now: number;
  children: ReactNode;
}) {
  return (
    <Tooltip placement="bottom-start" keepSide content={<AccountUsageCard usage={usage} now={now} />}>
      <Link
        href={adminUserHref(id)}
        data-account-link={id}
        className="tw:text-foreground tw:underline tw:decoration-border tw:underline-offset-2 tw:hover:decoration-foreground"
      >
        {children}
      </Link>
    </Tooltip>
  );
}
