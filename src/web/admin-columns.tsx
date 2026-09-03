/**
 * The users table's columns: what it can be sorted by, and how each cell draws.
 *
 * Everything reusable comes from [lib/DataTable.tsx](lib/DataTable.tsx) — the
 * chips, the header row, the sorting rules and the URL round-trip — exactly as
 * it does for the shelf ([library-columns.tsx](library-columns.tsx)). This file
 * is the whole of what the admin page has to say about its own table.
 *
 * Greg, 2026-08-27:
 *
 * > a list of users … when they signed up, when they last logged in (in
 * > human-readable format), how many docs they've uploaded, etc etc
 *
 * ## What the "etc etc" is, and what it is not
 *
 * Numbers, dates, and — since 2026-09-03 — a plan and a Stripe status.
 * **Nothing here names a document.** Not a title, not a URL, not a filename, not
 * a sentence of anybody's reading — see docs/project/admin.md § What it
 * deliberately does not show, which is the one paragraph to read before adding a
 * column. A tier id and a subscription status are facts about the account, in
 * the same family as "how many articles", and neither is anybody's reading.
 *
 * ## The two accessor rules, borrowed rather than reinvented
 *
 * They are the same two the shelf's columns carry, and for the same reasons —
 * and `at()`, the date parser both files sort by, is no longer two copies of
 * the rules but one import, from `lib/table-sort.js`:
 *
 * **A missing value must be `undefined`**, never `null` and never `NaN` —
 * `numberOrMissing` sorts missing low and `sinkLast` in the page moves them to
 * the bottom, and `NaN` compares false in both directions, which is a sort that
 * silently does nothing.
 *
 * **`0` is a value.** Nobody's article count is absent; it is zero, and it
 * sorts at the low end rather than being banished with the unknowns.
 */

import { type AdminUser, formatSpendNanos, isAdmin } from "../admin.js";
import type { SortableColumn } from "./lib/DataTable.js";
import { at, localeText, numberOrMissing } from "./lib/table-sort.js";
import { exactly, timeAgo } from "./relative-time.js";

/**
 * The default sort: **who signed up most recently, first.**
 *
 * A list of accounts is a list of things that arrived, which is the one shape
 * where "newest first" is not a preference but the question — *who is new?*
 * The shelf moved off that default because a shelf is not an inbox
 * (library-columns.tsx § DEFAULT_BY); this page is.
 *
 * Single-key, for the same reason the shelf's is: a compound default lights two
 * chips on a page nobody has clicked, which reads as somebody else's sort left
 * behind.
 */
export const ADMIN_DEFAULT_BY = ["signedUp"];

/**
 * The order the chips appear in, which is not the order of the columns.
 *
 * The table leads with the email, because that is what a row *is*. The chips
 * lead with `ADMIN_DEFAULT_BY`, because that is the page's resting state.
 * Anything sortable and missing from this list is appended rather than dropped.
 */
export const ADMIN_CHIP_ORDER = [
  "signedUp",
  "lastSignIn",
  "lastRead",
  /* Third among the numbers, above the counts. "Who is expensive" is the
     question this page gained on 2026-09-02 and the one a subscription price is
     argued from; how many articles somebody has is context for it. */
  "spend",
  /* Beside spend, and above the counts, for the same reason spend is: "who is
     paying" and "who is expensive" are the two halves of one question, and both
     are read before "how much have they got on the shelf". */
  "plan",
  "ingests",
  "articles",
  "uploads",
  "questions",
  "email",
];

/**
 * A date cell: how long ago, with the exact timestamp on hover.
 *
 * An em dash rather than a blank when there is none — an empty cell reads as
 * data that failed to load, and "never signed in" is a fact. The `title`
 * carries the precise time because "3 days ago" is the readable answer and
 * "when exactly?" is the next question.
 */
function When({ iso, now, absent }: { iso: string | undefined; now: number; absent: string }) {
  const ago = timeAgo(iso, now);
  if (!ago) return <span title={absent}>—</span>;
  return <span title={exactly(iso) ?? absent}>{ago}</span>;
}

/**
 * **What one account's reading cost us**, and the two things that stop the
 * number overclaiming.
 *
 * GPT Sol withdrew its objection to this column on exactly two conditions, and
 * both of them are in this component rather than in a doc:
 *
 * > It does need a defined period — e.g. "current UTC month" — and a visible
 * > partial/unpriced marker. A bare currency number would overclaim.
 *
 * So: the period is on the cell, from the row's own `spendMonth` rather than
 * from the browser's clock, and a "· N unpriced" line is drawn whenever any call
 * behind the figure reported no cost. That marker is not an edge case — on
 * 2026-09-02 the local ledger had 207 of 243 rows reporting nothing, and a
 * confident `$1.63` drawn over that would be a page lying quietly.
 *
 * **An account with no calls draws an em dash, not `$0.0000`.** A zero with a
 * currency sign on it reads as a measurement, and "we recorded nothing for this
 * person" is the one thing it is not — the same distinction `pocket()` in
 * scripts/ai-cost.ts refuses to blur. The sort still treats it as zero, because
 * for ranking who is expensive it genuinely is one.
 */
function Spend({ user }: { user: AdminUser }) {
  const period = `over ${user.spendMonth} (UTC)`;
  if (user.spendCalls === 0) {
    return <span title={`No model calls recorded ${period}`}>—</span>;
  }
  return (
    <div className="tw:min-w-0">
      <div title={`${user.spendCalls} model call(s) ${period}`}>
        {formatSpendNanos(user.spendNanos)}
      </div>
      {user.spendUnpricedCalls > 0 && (
        <div
          className="tw:truncate tw:text-xs tw:text-muted-foreground"
          title={
            `${user.spendUnpricedCalls} of those call(s) reported no cost, so the figure above ` +
            "is short by an unknown amount"
          }
        >
          · {user.spendUnpricedCalls} unpriced
        </div>
      )}
    </div>
  );
}

/**
 * **What they are on, and what Stripe says about it.**
 *
 * Two lines rather than one, because they answer different questions and only
 * one of them is usually interesting: `plan` is the entitlement this server
 * acted on, and `planStatus` is Stripe's own word for the subscription behind
 * it. They agree on a healthy account and the interesting rows are the ones
 * where they do not — `free` over `canceled` is a lapsed subscriber, and `free`
 * over `past_due` would be a bug, because `past_due` is entitled on purpose.
 *
 * **The status is drawn raw**, in the mono face the ids use, rather than
 * translated: `AdminUser.planStatus` says why, and a status Stripe adds next
 * year should show itself here rather than be flattened into whichever of ours
 * it least resembles.
 */
function Plan({ user }: { user: AdminUser }) {
  return (
    <div className="tw:min-w-0">
      <div className="tw:truncate tw:text-foreground">{user.plan}</div>
      {user.planStatus && (
        <div
          className="tw:truncate tw:font-mono tw:text-xs tw:text-muted-foreground"
          title={`Stripe's own subscription status. Entitlement is decided from an allowlist, so a status not on it reads as the free tier.`}
        >
          {user.planStatus}
        </div>
      )}
    </div>
  );
}

/**
 * **How much of the allowance is gone**, over the span the allowance is for.
 *
 * `4 / 20` rather than `4`, because a bare count against a limit that is a *row*
 * in `billing_tiers` — raisable at any time, by anybody with a psql prompt — is
 * a number the reader of this page cannot scale. The window is in the `title`
 * and again in the column's hint, for the reason the spend column carries its
 * period twice: an allowance measured over an unnamed span is a figure two
 * people read differently.
 *
 * **A lapsed account really does read `40 / 3` here, and that is deliberate** —
 * it is the one place the shape the reader must never see is the right thing to
 * draw. GPT Sol raised it as a P1 on 2026-09-03 and the disagreement is recorded
 * rather than silently overruled: Greg's rule is about **what a reader is told
 * about themselves**, because *"you have added all 3 articles a free account can
 * add"*, shown to somebody looking at forty of them, reads as arithmetic going
 * wrong. This page is the administrator reading a support email, and forty
 * against three is precisely the fact that makes it make sense — hiding it would
 * remove the answer while leaving the question. `plan: free` beside
 * `planStatus: canceled` in the column to the left is what says it is a policy.
 *
 * **An administrator gets an em dash.** `isAdmin` is the gate's own question,
 * the same one the wall exempts on (`admitIngest` in src/billing/admission.ts),
 * and the exemption is total — no slot is reserved at all, so an administrator's
 * ingests are legitimately absent from `ingest_events` and any figure drawn here
 * would be a count of something that was never counted. Drawn on the page rather
 * than sent from the server because those two uuids are already in this bundle.
 */
function Ingests({ user }: { user: AdminUser }) {
  if (isAdmin(user.id)) {
    return <span title="Administrators take no quota slot, so nothing is counted">—</span>;
  }
  /* **"used", not "successful ingests"**, because the figure includes
     reservations still in flight — which is what the wall counts, so it is what
     the page has to count or the two disagree about who has a slot left. */
  if (user.ingestWindow === "stale") {
    /* **Said on the cell, because the fraction cannot be read without it.** A
       subscription whose stored period has run out has no window to count
       inside, so this is a lifetime count against a monthly limit — and `active`
       in the Plan column beside it is the status of dates we could not read.
       Drawn as `61 / 20 ?` rather than as a bare fraction. GPT Sol, 2026-09-03. */
    return (
      <span
        className="tw:text-muted-foreground"
        title={
          `${user.ingests} used over the lifetime of the account, against this tier's ` +
          `${user.ingestLimit} a month — the two are not the same window. Stripe's stored ` +
          "billing period does not contain now, so there is no current period to count inside."
        }
      >
        {user.ingests} / {user.ingestLimit} ?
      </span>
    );
  }
  const window =
    user.ingestWindow === "period"
      ? "in the current Stripe billing period"
      : "over the lifetime of the account";
  return (
    <span title={`${user.ingests} of ${user.ingestLimit} used ${window}`}>
      {user.ingests} / {user.ingestLimit}
    </span>
  );
}

/**
 * The marker on the administrator's own row, and nobody else's.
 *
 * Greg, 2026-09-03: *"also indicate if a row is an admin user or not"*.
 *
 * **It asks `isAdmin`, which is the gate's own question** — the same id list
 * `/api/admin/*` compares against in src/routes.ts, not a second opinion about
 * who the administrator is. So the marker cannot drift from the thing it
 * describes: an unmarked row is an account this page would refuse.
 *
 * Positive only: absence means "not an administrator", which is what an absent
 * badge conventionally means, and a `—` on every other row would be noise on a
 * page that is already eleven columns wide.
 *
 * Nothing new about anybody crosses the wire for it: the id is already in the
 * row and the id list is already in the browser bundle. (`ADMIN_USER_IDS` holds
 * two ids because there are two Supabase projects — a laptop's and
 * production's — not because anybody has two accounts in one of them.)
 */
function AdminMarker({ id }: { id: string }) {
  if (!isAdmin(id)) return null;
  return (
    /* **A tinted word, not a bordered pill**, and both halves of that were
       measured rather than preferred. A border and `py` make the chip taller
       than the line of text it sits in, which made the administrator's row 58px
       against everybody else's 53px; and `uppercase` with letter-spacing made
       it wider than this column gets on a narrow screen, so it hung over the
       column's edge. Lower-case at the line's own height does neither, and it
       matches the words beside it (`google`, `email unconfirmed`). Measured at
       1280 and 390 on 2026-09-03. */
    <span
      title="Can reach the admin pages"
      className="tw:shrink-0 tw:rounded tw:bg-highlight/15 tw:px-1.5 tw:text-highlight"
    >
      admin
    </span>
  );
}

/**
 * `now` is passed in rather than read here, so that every relative date on one
 * render agrees with every other and nothing in this file reads the clock.
 */
export function adminColumns(now: number): SortableColumn<AdminUser>[] {
  /** Every count column is the same six lines but the words. */
  const counted = (
    id: string,
    header: string,
    label: string,
    hint: string,
    value: (u: AdminUser) => number,
  ): SortableColumn<AdminUser> => ({
    id,
    header,
    accessorFn: value,
    sortDescFirst: true,
    sortingFn: numberOrMissing<AdminUser>(),
    meta: { label, hint, ends: ["fewest first", "most first"], numeric: true },
    cell: ({ row }) => value(row.original),
  });

  return [
    {
      id: "email",
      header: "Account",
      accessorFn: (u) => u.email,
      sortDescFirst: false,
      sortingFn: localeText<AdminUser>(),
      meta: {
        label: "Email",
        hint: "Alphabetically, ignoring case and accents",
        ends: ["A to Z", "Z to A"],
        fluid: true,
      },
      /* The address, and under it how they got in. `providers` comes straight
         from the Auth service's own record for the account
         (src/store/admin-accounts.ts), so it says `google` or `email` rather
         than anything we inferred.

         **The sub-line is no longer behind `providers.length > 0`.** It was,
         and that hid "email unconfirmed" on exactly the account that most needs
         a word under it: one with no linked provider at all. The gate is now
         "has this line anything to say". Found while looking at something else
         (docs/plans/260903c-admin-users-count-disagrees-with-rows.md) and fixed
         on its own merits, not as an explanation of that. */
      cell: ({ row }) => {
        const under = [
          ...(row.original.providers.length > 0 ? [row.original.providers.join(", ")] : []),
          ...(row.original.emailConfirmedAt ? [] : ["email unconfirmed"]),
        ];
        const marked = isAdmin(row.original.id);
        return (
          /* **The marker goes under the address rather than beside it**, which
             looks like the lesser arrangement and is the only one that works.
             This is the fluid column (`w-full max-w-0` in lib/DataTable.tsx),
             so on a narrow screen the table scrolls and this column collapses
             to almost nothing — and a pill that will not shrink, on the same
             line, then takes all of it: measured at 390px on 2026-09-03, the
             administrator's own address was the one address on the page that
             could not be read at all. Below, the worst it can do is make the
             column as wide as the word. */
          <div className="tw:min-w-0">
            <div className="tw:truncate tw:text-foreground" title={row.original.email}>
              {row.original.email}
            </div>
            {(marked || under.length > 0) && (
              <div className="tw:flex tw:min-w-0 tw:items-center tw:gap-1.5 tw:text-xs tw:text-muted-foreground">
                <AdminMarker id={row.original.id} />
                {under.length > 0 && <span className="tw:truncate">{under.join(" · ")}</span>}
              </div>
            )}
          </div>
        );
      },
    },
    {
      id: "signedUp",
      header: "Signed up",
      accessorFn: (u) => at(u.createdAt),
      sortDescFirst: true,
      sortingFn: numberOrMissing<AdminUser>(),
      meta: {
        label: "Signed up",
        hint: "When the account was created",
        ends: ["oldest first", "newest first"],
      },
      cell: ({ row }) => <When iso={row.original.createdAt} now={now} absent="Unknown" />,
    },
    {
      id: "lastSignIn",
      header: "Last sign-in",
      accessorFn: (u) => at(u.lastSignInAt),
      sortDescFirst: true,
      sortingFn: numberOrMissing<AdminUser>(),
      meta: {
        label: "Last sign-in",
        hint: "When they last authenticated — not when they last read anything",
        ends: ["longest ago first", "most recent first"],
      },
      cell: ({ row }) => <When iso={row.original.lastSignInAt} now={now} absent="Never signed in" />,
    },
    {
      id: "lastRead",
      header: "Last read",
      accessorFn: (u) => at(u.lastReadAt),
      sortDescFirst: true,
      sortingFn: numberOrMissing<AdminUser>(),
      meta: {
        label: "Last read",
        /* The distinction that makes both date columns worth having: a session
           lasts for weeks, so a recent sign-in is not evidence anybody has
           read anything. */
        hint: "The most recent time they opened any article of their own",
        ends: ["longest ago first", "most recent first"],
      },
      cell: ({ row }) => <When iso={row.original.lastReadAt} now={now} absent="Never opened one" />,
    },
    {
      id: "spend",
      header: "Spend",
      accessorFn: (u) => u.spendNanos,
      sortDescFirst: true,
      sortingFn: numberOrMissing<AdminUser>(),
      meta: {
        label: "Spend",
        /* The period is in the hint and again in every cell's `title`, and that
           is not belt-and-braces: a currency figure with no window is the one
           thing GPT Sol would not let this column ship as. It reads the row's
           own `spendMonth` rather than the browser's clock, so a page left open
           across a month boundary says which month the server actually
           measured. */
        hint: "Model cost this UTC month — not eval or CLI spend, which is ours",
        ends: ["cheapest first", "most expensive first"],
        numeric: true,
      },
      cell: ({ row }) => <Spend user={row.original} />,
    },
    {
      id: "plan",
      header: "Plan",
      accessorFn: (u) => u.plan,
      /* A to Z first, so the default press groups `free` away from the tiers
         rather than starting at whichever tier sorts last. */
      sortDescFirst: false,
      sortingFn: localeText<AdminUser>(),
      meta: {
        label: "Plan",
        hint: "What they are entitled to — the tier id, or free. Stripe's status underneath",
        ends: ["A to Z", "Z to A"],
      },
      cell: ({ row }) => <Plan user={row.original} />,
    },
    {
      id: "ingests",
      header: "Ingests",
      accessorFn: (u) => u.ingests,
      sortDescFirst: true,
      sortingFn: numberOrMissing<AdminUser>(),
      meta: {
        label: "Ingests",
        /* The window is named here and again on every cell, and that repetition
           is deliberate: the two allowances are measured over different spans,
           so a column of `4 / 20` and `2 / 3` is two different questions in one
           list unless each cell says which it is answering. */
        hint: "Articles added against the allowance — a paid period, or the account's lifetime",
        ends: ["fewest first", "most first"],
        numeric: true,
      },
      cell: ({ row }) => <Ingests user={row.original} />,
    },
    counted("articles", "Articles", "Articles", "How many are on their shelf", (u) => u.articles),
    counted("archived", "Archived", "Archived", "How many they have taken off it", (u) => u.archived),
    counted("uploads", "Uploads", "Uploads", "PDFs that finished uploading", (u) => u.uploads),
    counted("questions", "Comments", "Comments", "Passages they have marked", (u) => u.questions),
    counted("chats", "Chats", "Chats", "Conversations started", (u) => u.chats),
    counted("searches", "Searches", "Searches", "Meaning searches run", (u) => u.searches),
    counted("opens", "Opens", "Opens", "Times they have opened an article, summed", (u) => u.opens),
  ];
}
