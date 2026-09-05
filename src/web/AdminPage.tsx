/**
 * `/admin`, `/admin/users` and `/admin/feedback` — the administrator's pages.
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
import { ArrowLeft, MessageSquareWarning, Palette, RefreshCw, Users } from "lucide-react";
import type { OnChangeFn, SortingState } from "@tanstack/react-table";
import { functionalUpdate } from "@tanstack/react-table";
import { throttle, useQueryState } from "nuqs";

import type { AdminUser } from "../admin.js";
import { ADMIN_CHIP_ORDER, ADMIN_DEFAULT_BY, adminColumns } from "./admin-columns.js";
import { buildCommit, buildTime, shortCommit } from "./build-stamp.js";
import { DataTable, naturalDirections, SortChips, useSortedTable } from "./lib/DataTable.js";
import { isAllNatural, sinkLast, sortingFromUrl, sortingToUrl } from "./lib/table-sort.js";
import { Link } from "./Link.js";
import { pageTitle, useDocumentTitle } from "./page-title.js";
import { adminByParam, sortDirParam } from "./params.js";
import { exactly, timeAgo } from "./relative-time.js";
import {
  ADMIN_FEEDBACK_HREF,
  ADMIN_HREF,
  ADMIN_USERS_HREF,
  DESIGN_HREF,
  LIBRARY_HREF,
} from "./router.js";
import { FeedbackCard } from "./AdminFeedbackList.js";
import { useAdminFeedback } from "./useAdminFeedback.js";
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
 * One line on the index: an icon, a name and a sentence saying what is behind
 * it.
 *
 * A component rather than two copies of the same markup, from the moment there
 * were two — the point at which "one entry today" stops being a good reason not
 * to have one.
 */
function Entry({
  href,
  icon,
  title,
  blurb,
}: {
  href: string;
  icon: ReactNode;
  title: string;
  blurb: string;
}) {
  return (
    <li className="tw:rounded-lg tw:border tw:border-border tw:bg-card">
      <Link
        href={href}
        className="tw:flex tw:items-center tw:gap-3 tw:p-4 tw:no-underline tw:hover:bg-highlight/5"
      >
        {icon}
        <span className="tw:min-w-0">
          <span className="tw:block tw:text-foreground">{title}</span>
          <span className="tw:block tw:text-xs tw:text-muted-foreground">{blurb}</span>
        </span>
      </Link>
    </li>
  );
}

/**
 * **When this went live** — the one question /admin could not answer.
 *
 * Greg, 2026-09-04: *"indicate somewhere in /admin exactly when the last deploy
 * happened"*. Everything needed was already compiled in: `vite.config.ts`
 * writes the commit and the build time of the bundle into it, from the stamp
 * `scripts/build-stamp.ts` resolves for the client, the API function and the
 * Sentry release alike.
 *
 * **So this asks nothing over the network**, which is what makes it worth
 * having: no request to fail, no second opinion to reconcile, and no way for it
 * to be right about a deployment other than the one drawing the page.
 * `/api/health` reports the serverless half's own stamp, and `scripts/deploy.ts`
 * is what compares the two — this line is for a person, not a check.
 *
 * **It says "Built", not "Deployed", and the difference is not pedantry.** GPT
 * Sol, reviewing this, was right that a compile time overclaims in three
 * ordinary cases, and the wording is the fix for all three: a tab left open
 * across a deploy goes on reporting the build it loaded with; Vercel compiles
 * and then promotes, a minute or two later; and an instant rollback restores an
 * older build carrying its own older stamp, so the moment of the rollback is
 * nowhere in this line. Fetching `/api/health` instead would fix only the first
 * of those, at the price of a request that can fail. What the line does answer,
 * exactly, is **which bundle you are looking at and how old it is** — which is
 * what "was my change in this?" needs.
 *
 * `null` off a build — vitest, and the dev server, which despite Vite's docs
 * does not apply `define` here: served modules on `npm run dev` still carry the
 * bare identifiers, checked against this repo's own dev server on 2026-09-04
 * (Vite 8.2.2, rolldown) by fetching `/src/web/build-stamp.ts` from it. It says
 * so rather than drawing an em dash: "no stamp" and "stamp unreadable" are
 * different things to whoever is standing in front of it.
 */
function BuildStampLine() {
  const now = useNow();
  const commit = buildCommit();
  const builtAt = buildTime();
  const ago = timeAgo(builtAt ?? undefined, now);

  if (!commit && !ago) {
    return (
      <p className="tw:mt-10 tw:text-xs tw:text-ink-faint">
        Running unbuilt — nothing compiled this page, so there is no build to name.
      </p>
    );
  }

  return (
    <p
      className="tw:mt-10 tw:text-xs tw:text-ink-faint"
      title={[
        builtAt ? `Compiled ${exactly(builtAt)}` : "This bundle carries no build time",
        commit ? `commit ${commit}` : "no commit stamp",
        "This is the build this tab is running — reload to ask again. Vercel promotes a " +
          "build a minute or two after compiling it, and a rollback restores an older one " +
          "carrying its own older stamp.",
      ].join(" · ")}
    >
      Built {ago ?? "at an unknown time"}
      {commit ? ` · ${shortCommit(commit)}` : ""}
    </p>
  );
}

/**
 * `/admin` — the index.
 *
 * It exists rather than redirecting to `/admin/users` because Greg asked for the
 * address, and because the second and third admin pages then have somewhere to
 * be listed rather than somewhere to be remembered. That paid off on
 * 2026-09-02, when `/admin/feedback` was added and this page needed one entry
 * rather than a decision.
 */
export function AdminHome() {
  useDocumentTitle(pageTitle({ kind: "admin", page: "home" }));
  return (
    <Shell title="Admin">
      <p className="tw:mb-6 tw:text-sm tw:text-muted-foreground">
        Everything on these pages reads across accounts. Nothing on them can change anything.
      </p>
      <ul className="tw:m-0 tw:flex tw:list-none tw:flex-col tw:gap-3 tw:p-0">
        <Entry
          href={ADMIN_USERS_HREF}
          icon={<Users size={18} className="tw:shrink-0 tw:text-muted-foreground" />}
          title="Users"
          blurb="Who has signed up, when they last signed in, and how much each of them has read"
        />
        <Entry
          href={ADMIN_FEEDBACK_HREF}
          icon={
            <MessageSquareWarning size={18} className="tw:shrink-0 tw:text-muted-foreground" />
          }
          title="Feedback"
          blurb="Bug reports readers filed with the Feedback button, newest first"
        />
        {/* **Moved off the shelf's masthead on 2026-09-05**, at Greg's request:
            > Move the Design link on the logged-in Homepage into /admin
            > — Greg (SPIDERYARN-READING2-1T)

            The odd one out on this page, and worth saying so rather than
            letting the next reader wonder: `/design` reads across nothing and
            is not gated — any signed-in reader can type the address, exactly as
            before. It is here because it is developer furniture rather than
            because it is privileged, and drawing a link was never a gate in any
            case (docs/project/admin.md § The three refusals). */}
        <Entry
          href={DESIGN_HREF}
          icon={<Palette size={18} className="tw:shrink-0 tw:text-muted-foreground" />}
          title="Design"
          blurb="Every token, face and component variant on one page — look here after changing tokens.css"
        />
      </ul>
      <BuildStampLine />
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
            /* **Counted off `sorted`, which is the list the table is drawn
               from** — not off `users`, the list the request returned.

               Greg, 2026-09-03, of production: *"it says '2 accounts', but only
               lists one! … the number of rows and the number in the text above
               should match"*. No mechanism was found by which those two numbers
               could differ, and this does not add one to look for: it removes
               the second number, so a sentence about the table is counted off
               the table. The assertion that the words and the `<tr>` agree
               lives in tests/admin-page.test.tsx, which can see the DOM this
               cannot — structure, not visibility.
               docs/plans/260903c-admin-users-count-disagrees-with-rows.md. */
            <span className="tw:text-xs tw:text-muted-foreground">
              {sorted.length === 1 ? "1 account" : `${sorted.length} accounts`}
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


/**
 * `/admin/feedback` — the bug reports, newest first.
 *
 * **The one page in this app that shows one reader's words to another person**,
 * and the whole of what makes that legitimate is consent: they typed those three
 * answers into a box labelled with what happens to them.
 * docs/project/feedback.md § The one rule, and docs/project/admin.md § the
 * second clause. The card itself is [AdminFeedbackList.tsx](AdminFeedbackList.tsx).
 *
 * No sort in the address bar, unlike the users page, and that is not an
 * oversight: an inbox has one order and the server promises it
 * (`listFeedbackAcrossOwners`). A `?by=` here would be a second opinion about
 * which end of the list the cap cut.
 */
export function AdminFeedbackPage() {
  useDocumentTitle(pageTitle({ kind: "admin", page: "feedback" }));
  const { reports, error, loading, hasMore, reload, loadMore } = useAdminFeedback();
  const now = useNow();

  return (
    <Shell title="Feedback" back={{ href: ADMIN_HREF, label: "Admin" }}>
      {error && (
        /* Same sentence-shape as the users page, and the distinction it draws
           matters more here: an empty inbox is an ordinary answer, so an error
           that left the previous reports on screen must say so or the page
           looks current when it is not. */
        <p className="tw:mb-4 tw:rounded-md tw:border tw:border-destructive/40 tw:bg-destructive/10 tw:p-4 tw:text-sm tw:text-foreground">
          {reports ? `That request failed, so these are the reports we already had. ${error}` : error}
        </p>
      )}

      {/* Always drawn, error or not — a first load that failed must leave
          something to press. The users page learned this in review. */}
      <div className="tw:mb-4 tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-3">
        <span className="tw:text-xs tw:text-muted-foreground">
          {reports === null ? "" : reports.length === 1 ? "1 report" : `${reports.length} reports`}
          {/* **When the list is not the whole story, the page says so** — and
              `hasMore` is a thing the server saw rather than something inferred
              from a length. A page that quietly stops being complete is the
              failure this whole feature exists to catch elsewhere. */}
          {reports && hasMore ? " — there are older ones" : ""}
        </span>
        <button
          type="button"
          onClick={() => void reload()}
          disabled={loading}
          aria-label="Refresh the reports"
          title="Refresh the reports"
          className="tw:inline-flex tw:h-7 tw:items-center tw:gap-1 tw:rounded-full tw:border tw:border-border tw:bg-transparent tw:px-3 tw:text-xs tw:text-muted-foreground tw:hover:border-highlight/50 tw:hover:text-foreground tw:disabled:opacity-50"
        >
          <RefreshCw size={12} />
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {/* `null` is "still loading". An empty array is a real and perfectly
          ordinary answer here — unlike the users page, where it cannot be true
          — so it gets a plain sentence rather than an alarm. */}
      {reports === null ? null : reports.length === 0 ? (
        <p className="tw:text-sm tw:text-muted-foreground">Nobody has filed a report yet.</p>
      ) : (
        <>
          <ul className="tw:m-0 tw:p-0">
            {reports.map((report) => (
              /* **Both halves of the key.** A report id is minted by a browser
                 and is unique within an owner, not globally — two readers may
                 legitimately hold the same one, and React would then draw one
                 card where there are two. src/store/pg-admin-feedback.ts. */
              <FeedbackCard key={`${report.ownerId}:${report.id}`} report={report} now={now} />
            ))}
          </ul>
          {hasMore && (
            <button
              type="button"
              onClick={() => void loadMore()}
              disabled={loading}
              className="tw:mt-2 tw:inline-flex tw:h-8 tw:items-center tw:rounded-full tw:border tw:border-border tw:bg-transparent tw:px-4 tw:text-xs tw:text-muted-foreground tw:hover:border-highlight/50 tw:hover:text-foreground tw:disabled:opacity-50"
            >
              {loading ? "Loading…" : "Load older"}
            </button>
          )}
        </>
      )}
    </Shell>
  );
}
