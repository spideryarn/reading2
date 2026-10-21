/**
 * The articles table's columns: what `/admin/articles` can be sorted by, and
 * how each cell draws.
 *
 * The users table's shape ([admin-columns.tsx](admin-columns.tsx)) for the
 * second admin list: everything reusable — the chips, the headers, the sorting
 * rules, the URL, the Columns menu — comes from
 * [lib/DataTable.tsx](lib/DataTable.tsx), and this file is the whole of what the
 * page has to say about its own table. Greg, 2026-10-21 (`spya-k8mka5`), of the
 * hand-drawn table this replaced: *"the /users one, I think perhaps it was more
 * functional?"* — plan 261021i § Stage 1.
 *
 * The accessor rules are the shelf's and the users table's: **a missing value
 * is `undefined`**, never `null` or `NaN`, so `numberOrMissing` and
 * `localeText` sort it low and the page's `sinkLast` (lib/useUrlSortedTable.ts)
 * moves it to the bottom whichever way the arrow points.
 *
 * **Nothing here names another reader's private article**: the server sends no
 * title or slug for one (docs/project/admin.md § `/admin/articles`), so its
 * Article cell says whose it is and nothing more, and it sorts as untitled.
 */
import type { SortingFn } from "@tanstack/react-table";

import type { AdminArticle } from "../admin-articles.js";
import { formatSpendNanos, isAdmin } from "../admin.js";
import { readableDate } from "../billing-plan.js";
import { amountWithFloor } from "./admin-costs-view.js";
import { BUTTON } from "./admin-vouchers-parts.js";
import type { SortableColumn } from "./lib/DataTable.js";
import { at, localeText, numberOrMissing } from "./lib/table-sort.js";
import { Link } from "./Link.js";
import { exactly } from "./relative-time.js";
import { readHref } from "./router.js";
import { voiceClass } from "./voice.js";

/**
 * The order the chips appear in: the default sort first (`ADMIN_ARTICLES_DEFAULT_BY`
 * in params.ts, which keeps this file off the reader's startup path), then
 * cost — Greg's "what I care about most" (plan 261006j), which had the page's
 * one other order before it could be sorted. Anything sortable and missing
 * here is appended rather than dropped.
 */
export const ADMIN_ARTICLES_CHIP_ORDER = ["added", "cost", "title", "owner", "visibility", "read"];

/** On the Total cost header's tooltip and in its accessible name. */
export const COST_HINT =
  "Every model call the ledger ties to this article by its id, whoever made it, over its whole life: the same attribution rule as /admin/costs. Marked + when some call reported no cost, so it is a floor.";

/**
 * **An article of yours, or a public one, that no import ever published**
 * (spya-zt7u0h): a failed or unfinished import. It was *Untitled*; its link
 * opens the job's card for its owner, which says why.
 */
export const NOT_PUBLISHED_YET = "Not published: its import failed or has not finished";

/** The handle a row is known by: its short id, or its id when it has none (Sol F9). */
function handleOf(article: AdminArticle): string {
  return article.shortId ?? article.id;
}

export function ownerLabel(article: AdminArticle): string {
  return article.ownerEmail ?? article.ownerId;
}

/** `/admin/costs`' own figure: `$0.42`, `+` for a floor, `—` when no call was priced. */
function costText({ cost }: AdminArticle): string {
  return amountWithFloor({ recordedNanos: cost.nanos, calls: cost.calls, pricedCalls: cost.calls - cost.unpricedCalls });
}

function costTip({ cost }: AdminArticle): string {
  if (cost.calls === 0) return "No model calls recorded";
  const calls = `${cost.calls} ${cost.calls === 1 ? "call" : "calls"}`;
  const unpriced = cost.unpricedCalls > 0 ? `, ${cost.unpricedCalls} reported no cost` : "";
  const amount = cost.calls === cost.unpricedCalls ? "No recorded amount" : formatSpendNanos(cost.nanos);
  return `${amount} over ${calls}${unpriced}`;
}

/**
 * **What the cost column sorts by: the recorded total, or missing when no call
 * was priced** (Sol F1). That is exactly the two cases `costText` draws as `—`
 * — no calls at all, and calls that all reported no cost — so a dash always
 * sinks, and a `$0.00` sorts as a real zero only when a priced call recorded
 * it. A floor (`$0.42+`) sorts by what was recorded, which is all it claims.
 */
export function costSortValue({ cost }: AdminArticle): number | undefined {
  return cost.calls - cost.unpricedCalls === 0 ? undefined : cost.nanos;
}

/**
 * Cost, and **equal costs newest first** — the page's order before it could be
 * sorted, kept as the tiebreak (a test holds it). Missing-and-missing is a tie
 * too, so the dashes at the foot also read newest first.
 *
 * The tiebreak is inside the `sortingFn`, so TanStack's descending inversion
 * applies to it as well: ties read newest first under the default arrow and
 * oldest first under the other. DataTable.tsx's header says why a tiebreak in
 * a `sortingFn` reverses with the arrow; accepted here, because the
 * alternative — a second sort key the page adds for you — lights a chip nobody
 * pressed (plan 261021i § Stage 1). It also means a shift-clicked second key
 * never decides between two equal costs; this one already has.
 */
const byCostThenNewest: SortingFn<AdminArticle> = (rowA, rowB, columnId) => {
  const cost = numberOrMissing<AdminArticle>()(rowA, rowB, columnId);
  if (cost !== 0) return cost;
  const a = at(rowA.original.createdAt) ?? 0;
  const b = at(rowB.original.createdAt) ?? 0;
  return a < b ? -1 : a > b ? 1 : 0;
};

/** The Article cell: the title, linked, and its handle — or, for another reader's private article, only whose. */
export function ArticleCell({ article }: { article: AdminArticle }) {
  if (article.title === null && article.slug === null) {
    return (
      <span className="tw:text-muted-foreground">
        Another reader's private article · <code className="tw:text-xs">{handleOf(article)}</code>
      </span>
    );
  }
  /* Our words, not the author's, so not in the author's face (fonts.md). */
  const unpublished = article.title === null && article.published === false;
  const title = unpublished ? NOT_PUBLISHED_YET : (article.title ?? "Untitled");
  const voice = unpublished ? "tw:text-muted-foreground" : voiceClass("author");
  return (
    <span>
      {article.slug ? (
        <Link href={readHref(article.slug)} className={voice}>
          {title}
        </Link>
      ) : (
        <span className={voice}>{title}</span>
      )}{" "}
      <code className="tw:text-xs tw:text-muted-foreground">{handleOf(article)}</code>
    </span>
  );
}

/**
 * The two presses a row offers. Passed in rather than imported, the way
 * `adminColumns(now, onViewAs)` takes *View as*: the confirmation and the
 * *View as* card belong to the page. **Both must keep their identity** (a
 * `useState` setter, or a `useCallback`), because the page memoises the
 * columns on them — lib/useUrlSortedTable.ts § The identity contract.
 */
export interface ArticleRowActions {
  readonly onTransfer: (article: AdminArticle) => void;
  readonly onViewAs: (article: AdminArticle) => void;
}

export function adminArticlesColumns({ onTransfer, onViewAs }: ArticleRowActions): SortableColumn<AdminArticle>[] {
  return [
    {
      id: "title",
      header: "Article",
      /* `undefined` for no title — another reader's private article, or an
         import that never published — so those sink under either arrow. */
      accessorFn: (a) => a.title ?? undefined,
      sortDescFirst: false,
      sortingFn: localeText<AdminArticle>(),
      /* What a row *is*: never hidden, and held at the left (`pinFirst`). */
      enableHiding: false,
      meta: {
        label: "Title",
        hint: "Alphabetically by title; articles with no title shown last",
        ends: ["A to Z", "Z to A"],
        fluid: true,
      },
      cell: ({ row }) => <ArticleCell article={row.original} />,
    },
    {
      id: "owner",
      header: "Owner",
      accessorFn: ownerLabel,
      sortDescFirst: false,
      sortingFn: localeText<AdminArticle>(),
      meta: {
        label: "Owner",
        hint: "Alphabetically by the owner's address, or their id when the address is not known",
        ends: ["A to Z", "Z to A"],
      },
      cell: ({ row }) => `${ownerLabel(row.original)}${row.original.mine ? " (you)" : ""}`,
    },
    {
      id: "added",
      header: "Added",
      accessorFn: (a) => at(a.createdAt),
      sortDescFirst: true,
      sortingFn: numberOrMissing<AdminArticle>(),
      meta: {
        label: "Added",
        hint: "When the article was added",
        ends: ["oldest first", "newest first"],
      },
      /* The exact time is in the words as well as on hover, so it can be read
         without a pointer. */
      cell: ({ row }) => {
        const exact = exactly(row.original.createdAt);
        return (
          <span data-tip={exact}>
            {readableDate(row.original.createdAt) ?? row.original.createdAt}
            <span className="tw:sr-only"> ({exact})</span>
          </span>
        );
      },
    },
    {
      id: "visibility",
      header: "Visibility",
      accessorFn: (a) => (a.visibility === "public" ? "Public" : "Private"),
      sortDescFirst: false,
      sortingFn: localeText<AdminArticle>(),
      meta: {
        label: "Visibility",
        hint: "Private or public",
        ends: ["Private first", "Public first"],
      },
      cell: ({ getValue }) => getValue() as string,
    },
    {
      id: "read",
      header: "Read",
      accessorFn: (a) => (a.processing === "minimal" ? "Abstract only" : "In full"),
      sortDescFirst: false,
      sortingFn: localeText<AdminArticle>(),
      meta: {
        label: "Read",
        hint: "Whether the whole article was read, or only its abstract",
        ends: ["Abstract only first", "In full first"],
      },
      cell: ({ getValue }) => getValue() as string,
    },
    {
      id: "cost",
      header: "Total cost",
      accessorFn: costSortValue,
      sortDescFirst: true,
      sortingFn: byCostThenNewest,
      meta: {
        label: "Total cost",
        hint: COST_HINT,
        ends: ["lowest first", "highest first"],
        numeric: true,
      },
      cell: ({ row }) => {
        const tip = costTip(row.original);
        return (
          <span data-tip={tip}>
            <span aria-hidden="true">{costText(row.original)}</span>
            <span className="tw:sr-only">{tip}</span>
          </span>
        );
      },
    },
    {
      id: "actions",
      header: () => <span className="tw:sr-only">Actions</span>,
      enableSorting: false as const,
      /* Never hideable: the only way to a transfer. */
      enableHiding: false,
      meta: { label: "Actions", hint: "", ends: ["", ""], noChip: true },
      cell: ({ row }) => (
        <span className="tw:inline-flex tw:gap-2">
          <button type="button" className={BUTTON} onClick={() => onTransfer(row.original)}>
            Transfer…
          </button>
          {/* Not on your own rows, and not on another administrator's, which
              the server refuses (plan 261019n § Part 3: an admin is never a
              subject). */}
          {!row.original.mine && !isAdmin(row.original.ownerId) && (
            <button type="button" className={BUTTON} onClick={() => onViewAs(row.original)}>
              View as owner
            </button>
          )}
        </span>
      ),
    },
  ];
}
