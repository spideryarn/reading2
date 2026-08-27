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
 * Nine numbers and three dates. **Nothing here names a document.** Not a title,
 * not a URL, not a filename, not a sentence of anybody's reading — see
 * docs/project/admin.md § What it deliberately does not show, which is the one
 * paragraph to read before adding a column.
 *
 * ## The two accessor rules, borrowed rather than reinvented
 *
 * They are the same two the shelf's columns carry, and for the same reasons:
 *
 * **A missing value must be `undefined`**, never `null` and never `NaN` —
 * `numberOrMissing` sorts missing low and `sinkLast` in the page moves them to
 * the bottom, and `NaN` compares false in both directions, which is a sort that
 * silently does nothing.
 *
 * **`0` is a value.** Nobody's article count is absent; it is zero, and it
 * sorts at the low end rather than being banished with the unknowns.
 */

import type { AdminUser } from "../admin.js";
import type { SortableColumn } from "./lib/DataTable.js";
import { localeText, numberOrMissing } from "./lib/table-sort.js";
import { exactly, timeAgo } from "./relative-time.js";

/** Parsed to a number, or `undefined` for absent and unparseable alike. */
function at(iso: string | undefined): number | undefined {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? undefined : t;
}

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
         from GoTrue's own record (src/db/auth-users.ts), so it says `google`
         or `email` rather than anything we inferred. */
      cell: ({ row }) => (
        <div className="tw:min-w-0">
          <div className="tw:truncate tw:text-foreground" title={row.original.email}>
            {row.original.email}
          </div>
          {row.original.providers.length > 0 && (
            <div className="tw:truncate tw:text-xs tw:text-muted-foreground">
              {row.original.providers.join(", ")}
              {!row.original.emailConfirmedAt && " · email unconfirmed"}
            </div>
          )}
        </div>
      ),
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
    counted("articles", "Articles", "Articles", "How many are on their shelf", (u) => u.articles),
    counted("archived", "Archived", "Archived", "How many they have taken off it", (u) => u.archived),
    counted("uploads", "Uploads", "Uploads", "PDFs that finished uploading", (u) => u.uploads),
    counted("questions", "Questions", "Questions", "Questions asked about a passage", (u) => u.questions),
    counted("chats", "Chats", "Chats", "Conversations started", (u) => u.chats),
    counted("searches", "Searches", "Searches", "Meaning searches run", (u) => u.searches),
    counted("opens", "Opens", "Opens", "Times they have opened an article, summed", (u) => u.opens),
  ];
}
