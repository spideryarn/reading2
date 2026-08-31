/**
 * `/admin` and `/admin/users` — the administrator's pages.
 *
 * Greg, 2026-08-27:
 *
 * > Set up an /admin/ page that only user `greg@gregdetre.com` sees a link for
 * > or is allowed to access. Then link to /admin/users/ that shows a list of
 * > users … when they signed up, when they last logged in (in human-readable
 * > format), how many docs they've uploaded, etc etc.
 *
 * Two pages, one file, because the index is a heading and a list of links and
 * splitting it into a module of its own would be ceremony. The table's columns
 * are in [admin-columns.tsx](admin-columns.tsx) and the fetch is in
 * [useAdminUsers.ts](useAdminUsers.ts) — the same division the shelf uses.
 *
 * ## Nothing here is a gate
 *
 * App.tsx decides whether these components are rendered at all, and the server
 * decides whether the data arrives. Both of those refusals stand on their own;
 * this file has no check in it, deliberately, so that nobody reading it comes
 * away thinking a component is holding a door shut. docs/project/admin.md.
 *
 * Tailwind utilities rather than styles.css, like every other chrome page —
 * note the `tw:` prefix, without which the class does nothing.
 */
import { useCallback, useMemo, type ReactNode } from "react";
import { ArrowLeft, RefreshCw, Users } from "lucide-react";
import type { OnChangeFn, SortingState } from "@tanstack/react-table";
import { functionalUpdate } from "@tanstack/react-table";
import { throttle, useQueryState } from "nuqs";

import type { AdminUser } from "../admin.js";
import { ADMIN_CHIP_ORDER, ADMIN_DEFAULT_BY, adminColumns } from "./admin-columns.js";
import { DataTable, naturalDirections, SortChips, useSortedTable } from "./lib/DataTable.js";
import { isAllNatural, sinkLast, sortingFromUrl, sortingToUrl } from "./lib/table-sort.js";
import { Link } from "./Link.js";
import { pageTitle, useDocumentTitle } from "./page-title.js";
import { adminByParam, sortDirParam } from "./params.js";
import { ADMIN_HREF, ADMIN_USERS_HREF, LIBRARY_HREF } from "./router.js";
import { useAdminUsers } from "./useAdminUsers.js";
import { useNow } from "./useNow.js";

/** Kept out of the render so the table is not rebuilt from a fresh `[]`. */
const EMPTY: AdminUser[] = [];

/**
 * Stable identity, and — see lib/DataTable.tsx — the tiebreak behind every sort.
 *
 * **Module scope, like the shelf's `slugOf`, and for the same reason.** Written
 * inline as `rowId: (u) => u.id` this was a new function every render, and
 * `useSortedTable` keys its `ordered` memo on it — so the core and sorted row
 * models were rebuilt every render, which is one half of the ring that froze
 * the shelf (docs/postmortems/260827e-shelf-render-loop.md). Found by GPT Sol,
 * 2026-08-27, reviewing the fix for the other half.
 */
const idOf = (u: AdminUser) => u.id;

/** The page shell both admin pages wear: the back-link, the heading, the width. */
function Shell({
  title,
  children,
  back = { href: LIBRARY_HREF, label: "Home" },
}: {
  title: string;
  children: ReactNode;
  back?: { href: string; label: string };
}) {
  return (
    /* Wider than the shelf's `max-w-4xl`: this page's content is a table with
       eleven columns, and a narrower page would spend its whole life scrolling
       sideways inside `DataTable`'s own overflow box. */
    <main className="tw:mx-auto tw:max-w-6xl tw:px-6 tw:py-10 tw:font-sans">
      <header className="tw:mb-8">
        <Link
          href={back.href}
          className="tw:inline-flex tw:items-center tw:gap-1.5 tw:text-xs tw:text-ink-faint tw:no-underline tw:hover:text-highlight"
        >
          <ArrowLeft size={13} />
          {back.label}
        </Link>
        <h1 className="tw:mt-2 tw:font-prose tw:text-3xl tw:text-foreground">{title}</h1>
      </header>
      {children}
    </main>
  );
}

/**
 * `/admin` — the index.
 *
 * One entry today. It exists rather than redirecting to `/admin/users` because
 * Greg asked for the address, and because the second admin page then has
 * somewhere to be listed rather than somewhere to be remembered.
 */
export function AdminHome() {
  useDocumentTitle(pageTitle({ kind: "admin", page: "home" }));
  return (
    <Shell title="Admin">
      <p className="tw:mb-6 tw:text-sm tw:text-muted-foreground">
        Everything on these pages reads across accounts. Nothing on them can change anything.
      </p>
      <ul className="tw:m-0 tw:list-none tw:p-0">
        <li className="tw:rounded-lg tw:border tw:border-border tw:bg-card">
          <Link
            href={ADMIN_USERS_HREF}
            className="tw:flex tw:items-center tw:gap-3 tw:p-4 tw:no-underline tw:hover:bg-highlight/5"
          >
            <Users size={18} className="tw:shrink-0 tw:text-muted-foreground" />
            <span className="tw:min-w-0">
              <span className="tw:block tw:text-foreground">Users</span>
              <span className="tw:block tw:text-xs tw:text-muted-foreground">
                Who has signed up, when they last signed in, and how much each of them has read
              </span>
            </span>
          </Link>
        </li>
      </ul>
    </Shell>
  );
}

/**
 * `/admin/users` — the table.
 *
 * The sort lives in the address bar, like every other view state in this app
 * (docs/project/url-state.md): `?by=articles&dir=desc` is a link somebody can
 * send. It shares the `dir` parser with the shelf and has a `by` default of its
 * own — see params.ts.
 */
export function AdminUsersPage() {
  useDocumentTitle(pageTitle({ kind: "admin", page: "users" }));
  const { users, error, loading, reload } = useAdminUsers();
  const now = useNow();

  const [by, setBy] = useQueryState("by", adminByParam);
  const [rawDir, setDir] = useQueryState("dir", sortDirParam);

  const columns = useMemo(() => adminColumns(now), [now]);
  const natural = useMemo(() => naturalDirections(columns), [columns]);
  /* `rawDir` straight in, `null` and all — absent means "each key goes whichever
     way it naturally goes", which `sortingFromUrl` fills in per column. Do not
     write `rawDir ?? []` here: a fresh array per render is what froze the shelf
     (docs/postmortems/260827e-shelf-render-loop.md). */
  const sorting = useMemo(
    () => sortingFromUrl(by, rawDir, natural, ADMIN_DEFAULT_BY),
    [by, rawDir, natural],
  );

  const onSortingChange = useCallback<OnChangeFn<SortingState>>(
    (updater) => {
      /* Applied to the very array TanStack was handed as its state, so what it
         computed the update against and what we apply it to cannot be two
         different things. */
      const next = functionalUpdate(updater, sorting);
      /* `enableSortingRemoval: false` should make this impossible; an empty
         sort would fall back to whatever order the server sent, which is a
         state the reader cannot name or ask for. */
      if (next.length === 0) return;
      const url = sortingToUrl(next);
      void setBy(url.by, { limitUrlUpdates: throttle(0) });
      /* Left out when it says nothing the columns would not have said
         themselves — and an absent `dir` is what makes the per-column fallback
         run at all. */
      void setDir(isAllNatural(next, natural) ? null : url.dir);
    },
    [sorting, natural, setBy, setDir],
  );

  const table = useSortedTable({
    data: users ?? EMPTY,
    columns,
    sorting,
    onSortingChange,
    rowId: idOf,
  });

  const rows = table.getRowModel().rows;
  const primary = sorting[0]?.id;
  /* Missing values last, whichever way the arrow points — the same rule the
     shelf follows, and the same reason: sorting by "last sign-in" ascending
     must not fill the top of the page with everyone who has never signed in.
     `sortUndefined` is deliberately off; lib/table-sort.ts has the measurement. */
  const sorted = useMemo(
    () => (primary ? sinkLast(rows, (r) => r.getValue(primary) === undefined) : rows),
    [rows, primary],
  );

  return (
    <Shell title="Users" back={{ href: ADMIN_HREF, label: "Admin" }}>
      {error && (
        <p className="tw:mb-4 tw:rounded-md tw:border tw:border-destructive/40 tw:bg-destructive/10 tw:p-4 tw:text-sm tw:text-foreground">
          {/* **Which numbers you are looking at, when there are still numbers.**
              A failed refresh leaves the previous list on screen (useAdminUsers.ts),
              which is the right call — throwing away the only figures we have
              because a retry failed is worse — but only if the page says so.
              Without this sentence the reader sees an error above a table that
              looks current. */}
          {users ? `Refresh failed, so these are the previous numbers. ${error}` : error}
        </p>
      )}

      {/* **The controls are always here, error or not.** They used to be drawn
          only once `users` was non-null, which meant a *first* load that failed
          left the reader with a message and nothing to press — reload the
          browser or nothing, which is exactly what `reload` exists to avoid.
          GPT Sol found it in review, 2026-08-27. Only the chips and the count
          need a list to describe. */}
      <div className="tw:mb-3 tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-3">
        {users ? <SortChips table={table} order={ADMIN_CHIP_ORDER} /> : <span />}
        <div className="tw:flex tw:items-center tw:gap-3">
          {users && (
            <span className="tw:text-xs tw:text-muted-foreground">
              {users.length === 1 ? "1 account" : `${users.length} accounts`}
            </span>
          )}
          <button
            type="button"
            onClick={() => void reload()}
            disabled={loading}
            aria-label="Refresh the user list"
            title="Refresh the user list"
            className="tw:inline-flex tw:h-7 tw:items-center tw:gap-1 tw:rounded-full tw:border tw:border-border tw:bg-transparent tw:px-3 tw:text-xs tw:text-muted-foreground tw:hover:border-highlight/50 tw:hover:text-foreground tw:disabled:opacity-50"
          >
            <RefreshCw size={12} />
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>

      {/* `null` is "still loading", and an empty array is a real answer — but
          not one this page can honestly get, since whoever is reading it is
          themselves an account. So an empty table means something went wrong
          upstream, and it says so rather than drawing an empty grid. */}
      {users === null ? null : users.length === 0 ? (
        <p className="tw:text-sm tw:text-muted-foreground">
          No accounts came back, which should not be possible — you are one. Something is wrong
          upstream of this page.
        </p>
      ) : (
        <DataTable table={table} rows={sorted} caption="Everyone with an account" />
      )}
    </Shell>
  );
}
