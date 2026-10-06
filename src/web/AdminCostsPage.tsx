/**
 * `/admin/costs` — one explorer over the cost cube.
 * docs/plans/261005a-admin-costs-page-cost-analysis-report-and-a-cost-tracking-audit.md.
 *
 * Greg, 2026-10-04:
 *
 * > Create a rich /admin/costs that breaks down by user (and then within user,
 * > by article) or mode or model. Ideally in a couple of forms, e.g. table and
 * > pivot table and/or graph.
 *
 * One request fetches the cube for a period ([useAdminCosts.ts](useAdminCosts.ts));
 * everything below is a view of those rows through src/cost-cube.ts, so the
 * headline, a ranking, a pivot and the chart cannot come from two definitions.
 * The view helpers are [admin-costs-view.ts](admin-costs-view.ts) and the
 * charts [cost-charts.tsx](cost-charts.tsx).
 *
 * ## What the address bar holds
 *
 * The whole view: period, the evals switch, both groupings, the sort and every
 * filter — **by key, never by label**. A user is an owner id and an article is
 * its opaque key, so no email and no slug enters this page's query state.
 *
 * ## Nothing here is a gate
 *
 * As on every admin page (AdminPage.tsx): App.tsx decides whether this is
 * drawn and the `/api/admin` namespace decides whether the data arrives.
 */
import { useCallback, useMemo, type ReactNode } from "react";
import { LoaderCircle, RefreshCw, X } from "lucide-react";
import type { OnChangeFn, SortingState } from "@tanstack/react-table";
import { functionalUpdate } from "@tanstack/react-table";
import { createParser, parseAsString, useQueryStates } from "nuqs";

import {
  type AdminCosts,
  type CostCubeRow,
  type CubeFilters,
  type CubeGroup,
  type CubeTotals,
  FAILURE_DEFINITIONS,
  FAILURE_NOTES,
  type FailureGroup,
  NOT_MEASURED,
  type OwnerEmails,
  amountPerPricedCall,
  dimensionValue,
  estimatedCashNanos,
  failureCauses,
  failureCountsBy,
  failureCountsOf,
  failureSummary,
  filterRows,
  groupRows,
  totalsOf,
} from "../cost-cube.js";
import {
  DEFAULT_PERIOD,
  DEFAULT_STACK,
  DIMENSION_LABEL,
  type FoldedPivot,
  PAGE_DIMENSIONS,
  PERIOD_LABEL,
  PERIODS,
  type PageDimension,
  type Period,
  amountWithFloor,
  articleOwners,
  colourOrder,
  dayPivot,
  daySeries,
  daysInWindow,
  foldedPivot,
  formatCostNanos,
  formatShare,
  isPageDimension,
  labelForKey,
  nextDrillDimension,
  periodWindow,
  scopedRows,
  shadeAlpha,
} from "./admin-costs-view.js";
import { Shell } from "./AdminPage.js";
import { RankBar, StackedDayChart } from "./cost-charts.js";
import {
  DataTable,
  type SortableColumn,
  chipClass,
  naturalDirections,
  useSortedTable,
} from "./lib/DataTable.js";
import {
  isAllNatural,
  localeText,
  numberOrMissing,
  sameList,
  sortingFromUrl,
  sortingToUrl,
} from "./lib/table-sort.js";
import { Link } from "./Link.js";
import { pageTitle, useDocumentTitle } from "./page-title.js";
import { parseAsBit, sortDirParam } from "./params.js";
import { ADMIN_COSTS_HREF, ADMIN_HREF, readHref } from "./router.js";
import { useAdminCosts } from "./useAdminCosts.js";

/* ------------------------------------------------------- the URL's state -- */

const periodParam = createParser<Period>({
  parse: (v) => ((PERIODS as readonly string[]).includes(v) ? (v as Period) : null),
  serialize: (v) => v,
});

const dimensionParam = createParser<PageDimension>({
  parse: (v) => (isPageDimension(v) ? v : null),
  serialize: (v) => v,
});

/** The ranking's resting order: the largest recorded amount first. */
const DEFAULT_SORT = ["amount"];

const sortParam = createParser<string[]>({
  parse: (v) => {
    const ids = v.split(",").filter((s) => s !== "");
    return ids.length ? ids : null;
  },
  serialize: (v) => v.join(","),
  eq: sameList,
});

/**
 * Every parameter of the page. The last nine are the filters, one per
 * dimension, each holding **the value's key** — an owner id, an article key, a
 * task or model name.
 */
const PARAMS = {
  period: periodParam.withDefault(DEFAULT_PERIOD),
  evals: parseAsBit.withDefault(false),
  by: dimensionParam.withDefault("user"),
  thenBy: dimensionParam,
  sort: sortParam.withDefault(DEFAULT_SORT),
  dir: sortDirParam,
  user: parseAsString,
  article: parseAsString,
  task: parseAsString,
  category: parseAsString,
  model: parseAsString,
  upstream: parseAsString,
  scope: parseAsString,
  outcome: parseAsString,
  day: parseAsString,
};

/** `?then=` in the address; `thenBy` in code, because an object with a `then` is a thenable. */
const URL_KEYS = { thenBy: "then" } as const;

/** The four questions Greg named, and the calendar. Each is only URL state. */
const QUESTIONS: readonly { label: string; by: PageDimension }[] = [
  { label: "Who spends most", by: "user" },
  { label: "Costliest articles", by: "article" },
  { label: "By mode or task", by: "task" },
  { label: "By model", by: "model" },
  { label: "Over time", by: "day" },
];

const VIEW_PARAMS = new Set([
  "period",
  "evals",
  "by",
  "then",
  "sort",
  "dir",
  ...PAGE_DIMENSIONS,
]);

/** A question is a real, copyable link containing only this page's declared state. */
function questionHref(by: PageDimension): string {
  const search = new URLSearchParams(location.search);
  for (const key of [...search.keys()]) {
    if (!VIEW_PARAMS.has(key)) search.delete(key);
  }
  search.set("by", by);
  search.delete("then");
  return `${ADMIN_COSTS_HREF}?${search.toString()}`;
}

/** The most columns a pivot draws before the rest fold into "Other". */
const MAX_PIVOT_COLUMNS = 8;

const SELECT =
  "tw:h-7 tw:rounded-full tw:border tw:border-border tw:bg-transparent tw:px-2 tw:text-xs tw:text-foreground";
const ROW_OF_CONTROLS = "tw:flex tw:flex-wrap tw:items-center tw:gap-2";
const SMALL_LABEL = "tw:text-xs tw:text-muted-foreground";

/**
 * A row label's width: capped so that at 390px the label and the amount beside
 * it are both on screen, and let out on a wider window. The text truncates
 * inside it and its `title` has the whole of it.
 */
const LABEL_WIDTH = "tw:min-w-0 tw:max-w-40 tw:sm:max-w-72 tw:lg:max-w-md";

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/* -------------------------------------------------------------- the page -- */

export function AdminCostsPage() {
  useDocumentTitle(pageTitle({ kind: "admin", page: "costs" }));
  const [q, setQ] = useQueryStates(PARAMS, { history: "push", urlKeys: URL_KEYS });
  /* Read once: a period must not slide while the page is being read. */
  const now = useMemo(() => Date.now(), []);
  const asked = useMemo(() => periodWindow(q.period, now), [q.period, now]);
  const { load, reload } = useAdminCosts(asked.since, asked.until);

  const by = q.by;
  const then = q.thenBy !== null && q.thenBy !== by ? q.thenBy : null;

  /** Add a row as a filter, and step the grouping along user → article → task → model. */
  const drill = useCallback(
    (dim: PageDimension, key: string) => {
      void setQ({ [dim]: key, by: nextDrillDimension(dim) } as Partial<Record<PageDimension, string>> & {
        by: PageDimension;
      });
    },
    [setQ],
  );

  return (
    <Shell title="Costs" back={{ href: ADMIN_HREF, label: "Back to Admin" }}>
      <div className={`${ROW_OF_CONTROLS} tw:mb-3 tw:justify-between`}>
        {/* biome-ignore lint/a11y/useSemanticElements: toggle buttons, as AdminPage.tsx § FeedbackFromToggle. */}
        <div role="group" aria-label="Period" className={ROW_OF_CONTROLS}>
          {PERIODS.map((period) => (
            <button
              key={period}
              type="button"
              aria-pressed={q.period === period}
              onClick={() => void setQ({ period })}
              className={chipClass(q.period === period)}
            >
              {PERIOD_LABEL[period]}
            </button>
          ))}
        </div>
        <div className={ROW_OF_CONTROLS}>
          <label className={`tw:inline-flex tw:items-center tw:gap-1.5 ${SMALL_LABEL}`}>
            <input
              type="checkbox"
              data-include-evals=""
              checked={q.evals}
              onChange={(e) => void setQ({ evals: e.target.checked })}
            />
            Include evals and dev CLI
          </label>
          <button
            type="button"
            onClick={reload}
            disabled={load.kind === "loading"}
            aria-label="Refresh the costs"
            title="Refresh the costs"
            className={`${chipClass(false)} tw:disabled:opacity-50`}
          >
            <RefreshCw size={12} />
            Refresh
          </button>
        </div>
      </div>

      {load.kind === "loading" && (
        <p role="status" className="tw:flex tw:items-center tw:gap-2 tw:text-sm tw:text-muted-foreground">
          <LoaderCircle size={13} className="cmt-spinner" aria-hidden />
          Reading the ledger
        </p>
      )}
      {load.kind === "failed" && (
        <p
          role="alert"
          className="tw:rounded-md tw:border tw:border-destructive/40 tw:bg-destructive/10 tw:p-4 tw:text-sm tw:text-foreground"
        >
          {load.message}
        </p>
      )}
      {load.kind === "ready" && (
        <Explorer
          costs={load.costs}
          now={now}
          includeEvals={q.evals}
          by={by}
          thenBy={then}
          filters={q}
          sort={q.sort}
          dir={q.dir}
          setQ={setQ}
          drill={drill}
        />
      )}
    </Shell>
  );
}

type Query = ReturnType<typeof useQueryStates<typeof PARAMS>>;
type FilterState = Record<PageDimension, string | null>;

function Explorer({
  costs,
  now,
  includeEvals,
  by,
  thenBy: then,
  filters,
  sort,
  dir,
  setQ,
  drill,
}: {
  costs: AdminCosts;
  now: number;
  includeEvals: boolean;
  by: PageDimension;
  thenBy: PageDimension | null;
  filters: FilterState;
  sort: string[];
  dir: ("asc" | "desc")[] | null;
  setQ: Query[1];
  drill: (dim: PageDimension, key: string) => void;
}) {
  const owners: OwnerEmails = useMemo(
    () => new Map(costs.owners.map((o) => [o.id, o.email])),
    [costs.owners],
  );
  const active = PAGE_DIMENSIONS.flatMap((dim) => {
    const key = filters[dim];
    return key === null ? [] : [{ dim, key }];
  });
  /* The filter values themselves, so the memo below holds across renders. */
  const filterKey = active.map((f) => `${f.dim}\n${f.key}`).join("\n\n");
  // biome-ignore lint/correctness/useExhaustiveDependencies: `filterKey` is `active`, as a string.
  const visible = useMemo(() => {
    const cube: CubeFilters = Object.fromEntries(active.map((f) => [f.dim, [f.key]]));
    return filterRows(scopedRows(costs.rows, includeEvals), cube);
  }, [costs.rows, includeEvals, filterKey]);
  const totals = useMemo(() => totalsOf(visible), [visible]);

  if (costs.rows.length === 0) {
    return (
      <>
        <WindowLine costs={costs} />
        <p className="tw:text-sm tw:text-muted-foreground">No calls recorded in this period.</p>
      </>
    );
  }

  return (
    <>
      <WindowLine costs={costs} />
      {!costs.emailsAvailable && (
        <p className={`tw:m-0 tw:mb-3 ${SMALL_LABEL}`}>
          Email addresses could not be loaded; users are shown by id.
        </p>
      )}

      {active.length > 0 && (
        <ul aria-label="Filters" className={`${ROW_OF_CONTROLS} tw:m-0 tw:mb-3 tw:list-none tw:p-0`}>
          {active.map(({ dim, key }) => (
            <li
              key={dim}
              data-filter={dim}
              className="tw:inline-flex tw:h-7 tw:max-w-full tw:items-center tw:gap-1 tw:rounded-full tw:border tw:border-border tw:pl-3 tw:pr-1 tw:text-xs tw:text-foreground"
            >
              <span className="tw:text-muted-foreground">{DIMENSION_LABEL[dim]}:</span>
              <span className="tw:truncate">{labelForKey(costs.rows, dim, key, owners)}</span>
              <button
                type="button"
                aria-label={`Remove the ${DIMENSION_LABEL[dim].toLowerCase()} filter`}
                onClick={() => void setQ({ [dim]: null } as Partial<FilterState>)}
                className="tw:inline-flex tw:size-5 tw:items-center tw:justify-center tw:rounded-full tw:border-0 tw:bg-transparent tw:text-muted-foreground tw:hover:text-foreground"
              >
                <X size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <Headline totals={totals} />

      <div className={`${ROW_OF_CONTROLS} tw:mb-3`}>
        <span className={SMALL_LABEL}>Questions:</span>
        {QUESTIONS.map((question) => (
          <Link
            key={question.by}
            href={questionHref(question.by)}
            aria-current={by === question.by && then === null ? "page" : undefined}
            className={`${chipClass(by === question.by && then === null)} tw:no-underline`}
          >
            {question.label}
          </Link>
        ))}
      </div>

      <div className={`${ROW_OF_CONTROLS} tw:mb-4`}>
        <label className={`tw:inline-flex tw:items-center tw:gap-1.5 ${SMALL_LABEL}`}>
          Group by
          <select
            className={SELECT}
            value={by}
            onChange={(e) => {
              const next = e.target.value;
              if (isPageDimension(next)) {
                void setQ({ by: next, ...(then === null || next === then ? { thenBy: null } : {}) });
              }
            }}
          >
            {PAGE_DIMENSIONS.map((dim) => (
              <option key={dim} value={dim}>
                {DIMENSION_LABEL[dim]}
              </option>
            ))}
          </select>
        </label>
        <label className={`tw:inline-flex tw:items-center tw:gap-1.5 ${SMALL_LABEL}`}>
          {by === "day" ? "stacked by" : "then by"}
          <select
            className={SELECT}
            value={then ?? ""}
            onChange={(e) => {
              const next = e.target.value;
              void setQ({ thenBy: isPageDimension(next) ? next : null });
            }}
          >
            <option value="">{by === "day" ? `${DIMENSION_LABEL[DEFAULT_STACK]} (default)` : "None"}</option>
            {PAGE_DIMENSIONS.filter((dim) => dim !== by).map((dim) => (
              <option key={dim} value={dim}>
                {DIMENSION_LABEL[dim]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {visible.length === 0 ? (
        <p className="tw:text-sm tw:text-muted-foreground">
          No calls match.{" "}
          {includeEvals ? "Remove a filter to see more." : "Remove a filter, or include evals and dev CLI."}
        </p>
      ) : by === "day" ? (
        <OverTime
          rows={visible}
          allRows={costs.rows}
          stack={then ?? DEFAULT_STACK}
          owners={owners}
          since={costs.since}
          until={costs.until}
          now={now}
          drill={drill}
        />
      ) : then !== null ? (
        <PivotTable
          pivot={foldedPivot(visible, by, then, MAX_PIVOT_COLUMNS, owners)}
          rowDim={by}
          colDim={then}
          drill={drill}
        />
      ) : (
        <Ranking
          rows={visible}
          allRows={costs.rows}
          dim={by}
          owners={owners}
          total={totals.recordedNanos}
          sort={sort}
          dir={dir}
          setQ={setQ}
          drill={drill}
        />
      )}

      {visible.length > 0 && <Failures rows={visible} />}
    </>
  );
}

/** The period, in the server's own words. Every figure below is over it. */
function WindowLine({ costs }: { costs: AdminCosts }) {
  return (
    <p className={`tw:m-0 tw:mb-3 ${SMALL_LABEL}`}>
      Calls {costs.label === "all recorded calls" ? "— all recorded" : costs.label}. Days and periods are UTC.
    </p>
  );
}

/* ---------------------------------------------------------- the headline -- */

function Figure({
  name,
  label,
  nanos,
  children,
  hint,
}: {
  name: string;
  label: string;
  nanos?: number;
  children: ReactNode;
  hint: string;
}) {
  return (
    <div data-figure={name} data-nanos={nanos} title={hint} className="tw:min-w-0">
      <dt className={SMALL_LABEL}>{label}</dt>
      <dd className="tw:m-0 tw:text-lg tw:tabular-nums tw:text-foreground">{children}</dd>
    </div>
  );
}

/**
 * What the visible rows add up to, each figure named for what it is — GPT
 * Sol's F6 on the plan. The notes under it are the three ways the amount is
 * less than it looks.
 */
function Headline({ totals }: { totals: CubeTotals }) {
  const cash = estimatedCashNanos(totals);
  return (
    <section aria-label="Totals" className="tw:mb-4 tw:rounded-lg tw:border tw:border-border tw:bg-card tw:p-4">
      <dl className="tw:m-0 tw:grid tw:grid-cols-2 tw:gap-x-6 tw:gap-y-3 tw:sm:grid-cols-3 tw:lg:grid-cols-6">
        <Figure
          name="recorded"
          label="Recorded ledger amount"
          nanos={totals.recordedNanos}
          hint="Credits, BYOK and computed amounts added, as the ledger recorded them"
        >
          {amountWithFloor(totals)}
        </Figure>
        <Figure name="calls" label="Calls" hint="Every model call in the ledger for this view">
          {totals.calls.toLocaleString("en-US")}
        </Figure>
        <Figure name="priced" label="Priced calls" hint="Calls that carry an amount: calls less unpriced calls">
          {totals.pricedCalls.toLocaleString("en-US")}
        </Figure>
        <Figure name="unpriced" label="Unpriced calls" hint="Calls that reported no cost and are counted, not priced">
          {totals.unpricedCalls.toLocaleString("en-US")}
        </Figure>
        <Figure
          name="failed"
          label="Failed or stopped calls"
          hint="Calls whose outcome was not ok, and what the ledger recorded for them"
        >
          {totals.failedCalls.toLocaleString("en-US")}
          {totals.failedCalls > 0 && (
            <span className="tw:text-sm tw:text-muted-foreground">
              {" "}
              · {formatCostNanos(totals.failedRecordedNanos)}
            </span>
          )}
        </Figure>
        <Figure
          name="cash"
          label="Estimated cash"
          nanos={cash}
          hint="The recorded amount with OpenRouter's credit-purchase fee added to the credits part only"
        >
          {totals.pricedCalls > 0
            ? `about ${formatCostNanos(cash)}${totals.unpricedCalls > 0 ? "+" : ""}`
            : "—"}
        </Figure>
      </dl>
      <ul className="tw:m-0 tw:mt-3 tw:list-none tw:space-y-1 tw:p-0 tw:text-xs tw:text-muted-foreground">
        {totals.unpricedCalls > 0 && (
          <li>
            {plural(totals.unpricedCalls, "call")} reported no cost, so the recorded amount is a floor
            (marked +).
          </li>
        )}
        {totals.failedCalls > 0 && (
          <li>Failed and stopped calls are in every figure here: they usually still cost.</li>
        )}
        <li>
          {plural(totals.settledCalls, "call")} settled by the provider and{" "}
          {plural(totals.computedCalls, "call")} priced by our own arithmetic. Settled, computed and
          unpriced overlap, so they do not add up to the calls.
        </li>
        <li>Estimated cash adds the fee for buying credits to the credits part only.</li>
      </ul>
    </section>
  );
}

/* ----------------------------------------------------------- the ranking -- */

const keyOf = (g: CubeGroup) => g.key;

/** The administrator's own articles, key → slug: the only ones with a page to link. */
function ownArticleSlugs(rows: readonly CostCubeRow[]): Map<string, string> {
  const slugs = new Map<string, string>();
  for (const row of rows) {
    if (row.articleId !== null && row.articleSlug !== null) {
      slugs.set(dimensionValue(row, "article").key, row.articleSlug);
    }
  }
  return slugs;
}

function rankingColumns({
  dim,
  owners,
  largest,
  total,
  articleOwner,
  ownSlugs,
  drill,
}: {
  dim: PageDimension;
  owners: OwnerEmails;
  largest: number;
  total: number;
  articleOwner: Map<string, string>;
  ownSlugs: Map<string, string>;
  drill: (dim: PageDimension, key: string) => void;
}): SortableColumn<CubeGroup>[] {
  const count = (
    id: string,
    header: string,
    hint: string,
    pick: (g: CubeGroup) => number,
  ): SortableColumn<CubeGroup> => ({
    id,
    header,
    accessorFn: pick,
    sortDescFirst: true,
    sortingFn: numberOrMissing<CubeGroup>(),
    meta: { label: header, hint, ends: ["fewest first", "most first"], numeric: true },
    cell: ({ row }) => pick(row.original).toLocaleString("en-US"),
  });

  return [
    {
      id: "label",
      header: DIMENSION_LABEL[dim],
      accessorFn: (g) => g.label,
      sortDescFirst: false,
      sortingFn: localeText<CubeGroup>(),
      /* **Not the fluid column.** That one carries a 224px floor
         (lib/DataTable.tsx § `FLUID_CELL`), which at 390px pushed the amount
         off the right-hand edge. The label is capped instead, so label and
         amount fit a phone together; the bar takes the leftover width. */
      meta: { label: DIMENSION_LABEL[dim], hint: "What the row is", ends: ["A to Z", "Z to A"] },
      cell: ({ row }) => {
        const g = row.original;
        const ownerId = dim === "article" ? articleOwner.get(g.key) : undefined;
        const owner = ownerId === undefined ? undefined : (owners.get(ownerId) ?? ownerId.slice(0, 8));
        const slug = dim === "article" ? ownSlugs.get(g.key) : undefined;
        return (
          <div data-label="" className={LABEL_WIDTH}>
            <button
              type="button"
              data-drill=""
              title={`Filter to ${g.label}`}
              onClick={() => drill(dim, g.key)}
              className="tw:block tw:max-w-full tw:truncate tw:border-0 tw:bg-transparent tw:p-0 tw:text-left tw:text-sm tw:text-foreground tw:underline-offset-2 tw:hover:underline"
            >
              {g.label}
            </button>
            {(owner !== undefined || slug !== undefined) && (
              <div className="tw:flex tw:min-w-0 tw:items-baseline tw:gap-2 tw:text-xs tw:text-muted-foreground">
                {owner !== undefined && (
                  <span className="tw:min-w-0 tw:truncate" title={owner}>
                    {owner}
                  </span>
                )}
                {slug !== undefined && (
                  <Link href={readHref(slug, "", "metadata")} className="tw:shrink-0 tw:text-muted-foreground">
                    metadata
                  </Link>
                )}
              </div>
            )}
          </div>
        );
      },
    },
    {
      id: "amount",
      header: "Recorded amount",
      accessorFn: (g) => g.recordedNanos,
      sortDescFirst: true,
      sortingFn: numberOrMissing<CubeGroup>(),
      meta: {
        label: "Recorded amount",
        hint: "Credits, BYOK and computed amounts added; a floor where a call is unpriced (marked +)",
        ends: ["smallest first", "largest first"],
        numeric: true,
      },
      cell: ({ row }) => (
        <span data-amount="">
          {amountWithFloor(row.original)}
        </span>
      ),
    },
    {
      id: "share",
      header: "Share",
      accessorFn: (g) => g.recordedNanos,
      sortDescFirst: true,
      sortingFn: numberOrMissing<CubeGroup>(),
      meta: {
        label: "Share",
        hint: "This row's part of the recorded amount in view",
        ends: ["smallest first", "largest first"],
        numeric: true,
        noChip: true,
      },
      cell: ({ row }) => formatShare(row.original.recordedNanos, total),
    },
    {
      /* The graph of a ranking: each row against the largest. After the
         figures it draws, and the one column that absorbs spare width. */
      id: "bar",
      header: "",
      enableSorting: false,
      meta: {
        label: "Bar",
        hint: "Recorded amount against the largest row",
        ends: ["", ""],
        fluid: true,
        noChip: true,
      },
      cell: ({ row }) => <RankBar share={largest > 0 ? row.original.recordedNanos / largest : 0} />,
    },
    count("calls", "Calls", "Every model call in the row", (g) => g.calls),
    {
      id: "perCall",
      header: "Per priced call",
      accessorFn: (g) => amountPerPricedCall(g) ?? undefined,
      sortDescFirst: true,
      sortingFn: numberOrMissing<CubeGroup>(),
      meta: {
        label: "Per priced call",
        hint: "Recorded amount divided by the calls that carry one, never by all calls",
        ends: ["cheapest first", "dearest first"],
        numeric: true,
      },
      cell: ({ row }) => {
        const each = amountPerPricedCall(row.original);
        return each === null ? "—" : formatCostNanos(each);
      },
    },
    count("unpriced", "Unpriced", "Calls that reported no cost", (g) => g.unpricedCalls),
    count("failed", "Failed", "Calls that failed or were stopped; their amount is in the row", (g) => g.failedCalls),
  ];
}

/**
 * One dimension, ranked. Through the shared `DataTable`, so the headers sort
 * the way the shelf's and the users table's do and the table scrolls inside
 * its own box on a phone.
 */
function Ranking({
  rows,
  allRows,
  dim,
  owners,
  total,
  sort,
  dir,
  setQ,
  drill,
}: {
  rows: CostCubeRow[];
  allRows: readonly CostCubeRow[];
  dim: PageDimension;
  owners: OwnerEmails;
  total: number;
  sort: string[];
  dir: ("asc" | "desc")[] | null;
  setQ: Query[1];
  drill: (dim: PageDimension, key: string) => void;
}) {
  const groups = useMemo(() => groupRows(rows, dim, owners), [rows, dim, owners]);
  const largest = groups.reduce((n, g) => Math.max(n, g.recordedNanos), 0);
  const articleOwner = useMemo(() => articleOwners(allRows), [allRows]);
  const ownSlugs = useMemo(() => ownArticleSlugs(allRows), [allRows]);
  const columns = useMemo(
    () => rankingColumns({ dim, owners, largest, total, articleOwner, ownSlugs, drill }),
    [dim, owners, largest, total, articleOwner, ownSlugs, drill],
  );
  const natural = useMemo(() => naturalDirections(columns), [columns]);
  const sorting = useMemo(() => sortingFromUrl(sort, dir, natural, DEFAULT_SORT), [sort, dir, natural]);

  const onSortingChange = useCallback<OnChangeFn<SortingState>>(
    (updater) => {
      const next = functionalUpdate(updater, sorting);
      if (next.length === 0) return;
      const url = sortingToUrl(next);
      void setQ({ sort: url.by, dir: isAllNatural(next, natural) ? null : url.dir });
    },
    [sorting, natural, setQ],
  );

  const table = useSortedTable({ data: groups, columns, sorting, onSortingChange, rowId: keyOf });
  const sorted = table.getRowModel().rows;

  return (
    <>
      <p data-row-count="" className={`tw:m-0 tw:mb-2 ${SMALL_LABEL}`}>
        {plural(sorted.length, "row")}
      </p>
      <div data-ranking="">
        <DataTable
          table={table}
          rows={sorted}
          caption={`Recorded amount by ${DIMENSION_LABEL[dim].toLowerCase()}`}
        />
      </div>
    </>
  );
}

/* ------------------------------------------------------------- the pivot -- */

const CELL = "tw:px-3 tw:py-2 tw:text-right tw:tabular-nums tw:whitespace-nowrap";
const HEAD = "tw:px-3 tw:py-2 tw:text-xs tw:font-normal tw:text-muted-foreground tw:whitespace-nowrap";
/**
 * The label column, held at the left while the table scrolls sideways. Opaque
 * in the page's own colour — the table sits on the page, not on a card — so a
 * shaded cell passing under it does not show through, in either theme. The
 * shadow is the column's right-hand rule: a collapsed border does not travel
 * with a sticky cell.
 */
const PINNED = "tw:sticky tw:left-0 tw:z-10 tw:bg-background tw:shadow-[1px_0_0_var(--border)]";

/**
 * Rows × columns, with both sets of totals. A plain table rather than
 * `DataTable`: its columns are data, it has a totals row and a totals column,
 * and it does not sort — none of which that seam has a place for.
 *
 * Cells are shaded in one categorical hue at an alpha that carries the amount,
 * so the figures stay in the text colour and legible in both themes. It was
 * the viridis ramp at a fixed wash until a browser pass read that as a rainbow.
 *
 * **The total comes straight after the label**, not at the far right: on a
 * wide pivot, and always on a phone, the far right is off screen, and the
 * total is the figure a row is read for.
 */
function PivotTable({
  pivot,
  rowDim,
  colDim,
  drill,
}: {
  pivot: FoldedPivot;
  rowDim: PageDimension;
  colDim: PageDimension;
  drill: (dim: PageDimension, key: string) => void;
}) {
  const largest = Math.max(
    0,
    ...[...pivot.cells.values()].flatMap((across) => [...across.values()].map((c) => c.recordedNanos)),
  );
  /* One hue, the rank bar's, with the amount in the alpha — `shadeAlpha`. */
  const shade = (nanos: number) => {
    const alpha = shadeAlpha(nanos, largest);
    return alpha === null ? undefined : { background: `rgb(var(--cat-0-rgb) / ${alpha})` };
  };

  return (
    <>
      <p data-row-count="" className={`tw:m-0 tw:mb-2 ${SMALL_LABEL}`}>
        {plural(pivot.rows.length, "row")} · {DIMENSION_LABEL[rowDim]} by {DIMENSION_LABEL[colDim].toLowerCase()},
        recorded amount
      </p>
      <div className="tw:relative tw:overflow-x-auto tw:rounded-lg tw:border tw:border-border">
        <table data-pivot="" className="tw:w-full tw:border-collapse tw:text-sm">
          <caption className="tw:sr-only">
            Recorded amount, {DIMENSION_LABEL[rowDim]} by {DIMENSION_LABEL[colDim]}
          </caption>
          <thead>
            <tr className="tw:border-b tw:border-border">
              <th scope="col" className={`${HEAD} ${PINNED} tw:text-left`}>
                {DIMENSION_LABEL[rowDim]}
              </th>
              <th scope="col" className={`${HEAD} tw:text-right`}>
                Total
              </th>
              {pivot.columns.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  data-col={col.key}
                  title={col.label}
                  className={`${HEAD} tw:text-right`}
                >
                  <span data-col-label="" className="tw:ml-auto tw:block tw:max-w-40 tw:truncate">
                    {col.label}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pivot.rows.map((row) => (
              <tr key={row.key} className="tw:border-b tw:border-border/60">
                <th
                  scope="row"
                  className={`tw:px-3 tw:py-2 tw:text-left tw:font-normal tw:whitespace-nowrap ${PINNED}`}
                >
                  <button
                    type="button"
                    data-drill=""
                    title={`Filter to ${row.label}`}
                    onClick={() => drill(rowDim, row.key)}
                    className={`tw:block tw:truncate tw:border-0 tw:bg-transparent tw:p-0 tw:text-left tw:text-sm tw:text-foreground tw:underline-offset-2 tw:hover:underline ${LABEL_WIDTH}`}
                  >
                    {row.label}
                  </button>
                </th>
                <td data-row-total="" data-nanos={row.recordedNanos} className={`${CELL} tw:text-foreground`}>
                  {amountWithFloor(row)}
                </td>
                {pivot.columns.map((col) => {
                  const cell = pivot.cells.get(row.key)?.get(col.key);
                  return (
                    <td
                      key={col.key}
                      data-cell=""
                      data-nanos={cell?.recordedNanos ?? 0}
                      style={shade(cell?.recordedNanos ?? 0)}
                      className={`${CELL} ${cell ? "tw:text-foreground" : "tw:text-ink-faint"}`}
                      title={cell ? `${plural(cell.calls, "call")}` : "No calls"}
                    >
                      {cell ? amountWithFloor(cell) : ""}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" className={`${HEAD} ${PINNED} tw:text-left`}>
                Total
              </th>
              <td data-grand-total="" data-nanos={pivot.total.recordedNanos} className={`${CELL} tw:text-foreground`}>
                {amountWithFloor(pivot.total)}
              </td>
              {pivot.columns.map((col) => (
                <td key={col.key} data-col-total="" data-nanos={col.recordedNanos} className={`${CELL} tw:text-foreground`}>
                  {amountWithFloor(col)}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
    </>
  );
}

/* ------------------------------------------------------------- over time -- */

/** A stacked bar per UTC day, and the same figures as a table under it. */
function OverTime({
  rows,
  allRows,
  stack,
  owners,
  since,
  until,
  now,
  drill,
}: {
  rows: CostCubeRow[];
  allRows: readonly CostCubeRow[];
  stack: PageDimension;
  owners: OwnerEmails;
  since: string | null;
  until: string | null;
  now: number;
  drill: (dim: PageDimension, key: string) => void;
}) {
  const pivot = useMemo(() => dayPivot(rows, stack, owners), [rows, stack, owners]);
  const days = useMemo(() => daysInWindow(since, until, allRows, now), [since, until, allRows, now]);
  /* From the whole cube, so a filter does not repaint the series that remain. */
  const colourKeys = useMemo(() => colourOrder(allRows, stack), [allRows, stack]);

  return (
    <>
      <figure className="tw:m-0 tw:mb-4 tw:rounded-lg tw:border tw:border-border tw:bg-card tw:p-4">
        <figcaption className={`tw:mb-2 ${SMALL_LABEL}`}>
          Recorded amount per UTC day, stacked by {DIMENSION_LABEL[stack].toLowerCase()}
        </figcaption>
        <StackedDayChart
          data={daySeries(pivot, days)}
          colourKeys={colourKeys}
          label={`Recorded amount per UTC day, stacked by ${DIMENSION_LABEL[stack].toLowerCase()}`}
        />
      </figure>
      <PivotTable pivot={pivot} rowDim="day" colDim={stack} drill={drill} />
    </>
  );
}

/* -------------------------------------------------- failures and retries -- */

const COUNT_COLUMNS: readonly { id: string; header: string; hint: string; pick: (g: FailureGroup) => number | null }[] = [
  {
    id: "counted",
    header: "Counted attempts",
    hint: "Attempts our retry loop numbered. Context for the counts beside it, not a denominator",
    pick: (g) => g.counted,
  },
  {
    id: "retries",
    header: "Retries",
    hint: "Goes after the first: each started because the go before it failed before its answer began",
    pick: (g) => g.retries,
  },
  {
    id: "gaveUp",
    header: "Gave up after the last go",
    hint: "Calls whose third and last go failed before the provider accepted it. A call refused outright on an earlier go is in the causes table",
    pick: (g) => g.gaveUp,
  },
  {
    id: "diedPartWay",
    header: "Died part-way",
    hint: "Attempts that failed after the provider accepted the call, which can be before any of the answer arrived",
    pick: (g) => g.diedPartWay,
  },
];

/** The three figures that can be unmeasured; the counted attempts beside them never are. */
const MEASURED_COLUMNS = COUNT_COLUMNS.slice(1);

const CAUSE_COLUMNS = ["Failed", "Cause", "Status", "Upstream", "Model", DIMENSION_LABEL.task, "Attempts"] as const;

const SCROLL_BOX = "tw:relative tw:mb-4 tw:overflow-x-auto tw:rounded-lg tw:border tw:border-border";

/**
 * Counts per value of one dimension. A plain table in its own scrolling box,
 * as the pivot is, with the label pinned. A null figure is drawn as words,
 * never as a zero: src/cost-cube.ts § `FailureCounts`.
 *
 * `fold` names the rows in the plural, and with it a row none of whose three
 * figures was measured is left out and counted in one line underneath. The
 * task table passes it, because most tasks have nothing to say for weeks after
 * the counting began (41 rows of 42, on the day it was built). The day table
 * does not: a calendar with rows missing reads as days with no calls.
 */
function FailureCountsTable({
  name,
  label,
  groups: all,
  fold,
}: {
  name: string;
  label: string;
  groups: FailureGroup[];
  fold?: string;
}) {
  const measured = (group: FailureGroup) => MEASURED_COLUMNS.some((col) => col.pick(group) !== null);
  const groups = fold ? all.filter(measured) : all;
  const folded = all.length - groups.length;
  return (
    <>
    <div className={SCROLL_BOX}>
      <table data-failures-table={name} className="tw:w-full tw:border-collapse tw:text-sm">
        <caption className="tw:sr-only">Retries, calls that gave up and attempts that died part-way, by {label}</caption>
        <thead>
          <tr className="tw:border-b tw:border-border">
            <th scope="col" className={`${HEAD} ${PINNED} tw:text-left`}>
              {label}
            </th>
            {COUNT_COLUMNS.map((col) => (
              <th key={col.id} scope="col" title={col.hint} className={`${HEAD} tw:text-right`}>
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <tr key={group.key} className="tw:border-b tw:border-border/60">
              <th scope="row" title={group.label} className={`tw:px-3 tw:py-2 tw:text-left tw:font-normal ${PINNED}`}>
                <span className={`tw:block tw:truncate ${LABEL_WIDTH}`}>{group.label}</span>
              </th>
              {COUNT_COLUMNS.map((col) => {
                const value = col.pick(group);
                return value === null ? (
                  <td key={col.id} data-not-measured="" className={`${CELL} tw:text-muted-foreground`}>
                    {NOT_MEASURED}
                  </td>
                ) : (
                  <td key={col.id} className={`${CELL} tw:text-foreground`}>
                    {value.toLocaleString("en-US")}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    {fold && folded > 0 && (
      <p data-failures-unmeasured={name} className={`tw:m-0 tw:mb-4 ${SMALL_LABEL}`}>
        {folded.toLocaleString("en-US")} other {fold}: {NOT_MEASURED}.
      </p>
    )}
    </>
  );
}

/**
 * **Failures and retries**: how often a call was asked again, gave up, or died
 * after its answer began, and why. docs/project/admin-costs.md § Failures and
 * retries; plan 261006b.
 *
 * Folds of the same visible rows as everything above it, so the period, the
 * evals switch and every filter apply. Counts with the counted attempts beside
 * them; no percentage is drawn anywhere in it.
 */
function Failures({ rows }: { rows: CostCubeRow[] }) {
  const total = useMemo(() => failureCountsOf(rows), [rows]);
  const byDay = useMemo(
    /* A calendar reads oldest first. */
    () => failureCountsBy(rows, "day").sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
    [rows],
  );
  const byTask = useMemo(() => failureCountsBy(rows, "task"), [rows]);
  const causes = useMemo(() => failureCauses(rows), [rows]);
  const anything = total.counted > 0 || causes.length > 0;

  return (
    <section data-failures="" aria-labelledby="failures-heading" className="tw:mt-8">
      <h2 id="failures-heading" className="tw:m-0 tw:mb-2 tw:text-sm tw:font-medium tw:text-foreground">
        Failures and retries
      </h2>
      <p data-failures-summary="" className="tw:m-0 tw:mb-2 tw:text-sm tw:text-foreground">
        {failureSummary(total)}
      </p>
      {anything && (
        <>
          <p className={`tw:m-0 tw:mb-3 ${SMALL_LABEL}`}>{FAILURE_DEFINITIONS}</p>
          <FailureCountsTable name="day" label={DIMENSION_LABEL.day} groups={byDay} />
          <FailureCountsTable name="task" label={DIMENSION_LABEL.task} groups={byTask} fold="modes or tasks" />
          {causes.length === 0 ? (
            <p className={`tw:m-0 tw:mb-4 ${SMALL_LABEL}`}>No failed attempt in this view recorded a cause.</p>
          ) : (
            <div className={SCROLL_BOX}>
              <table data-failures-table="causes" className="tw:w-full tw:border-collapse tw:text-sm">
                <caption className="tw:sr-only">Why attempts failed</caption>
                <thead>
                  <tr className="tw:border-b tw:border-border">
                    {CAUSE_COLUMNS.map((header, i) => (
                      <th
                        key={header}
                        scope="col"
                        className={`${HEAD} ${i === CAUSE_COLUMNS.length - 1 ? "tw:text-right" : "tw:text-left"}`}
                      >
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {causes.map((cause) => (
                    <tr key={cause.key} className="tw:border-b tw:border-border/60">
                      {[cause.phase, cause.failureClass, cause.status, cause.upstream, cause.model, cause.task].map(
                        (value, i) => (
                          <td
                            // biome-ignore lint/suspicious/noArrayIndexKey: six fixed columns of one row.
                            key={i}
                            className="tw:px-3 tw:py-2 tw:text-left tw:whitespace-nowrap tw:text-foreground"
                          >
                            {value}
                          </td>
                        ),
                      )}
                      <td className={`${CELL} tw:text-foreground`}>{cause.attempts.toLocaleString("en-US")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      <ul className="tw:m-0 tw:list-none tw:space-y-1 tw:p-0 tw:text-xs tw:text-muted-foreground">
        {FAILURE_NOTES.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
    </section>
  );
}
