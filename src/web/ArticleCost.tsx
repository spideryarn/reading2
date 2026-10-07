/**
 * **What this article has cost in model calls** — the administrator's section
 * on the metadata page. Greg, 2026-09-30 (SPIDERYARN-READING2-68): *"a section
 * that shows cost estimates as best as we can calculate them, total for the
 * article and also broken down by modes or whatever."*
 *
 * The data is `GET /api/admin/articles/:slug/cost`, and the server's
 * `/api/admin` gate is the only thing that keeps it from anybody else.
 * `Metadata.tsx` draws this only for `isAdmin`, which is a courtesy: nobody
 * else would get an answer if it asked. docs/project/cost-tracking.md.
 *
 * ## Why "estimate", and the lines under the table
 *
 * A total with nothing beside it reads as the whole truth. This one is a floor:
 * calls that reported no cost are counted and not priced, live conversations
 * that connected but never reported usage are counted separately, and calls a
 * route never attributed to the article are invisible to the query. Each of
 * those is said in words when it applies, which is the same move the coverage
 * header of `npm run cost` makes (docs/reusable/silent-success.md).
 */

import { useEffect, useState } from "react";

import {
  type ArticleCost,
  type ArticleCostLine,
  articleCostLineNanos,
  formatSpendNanos,
} from "../admin.js";
import { CARD } from "./card.js";
import { taskOf } from "../cost-cube.js";
import { currentStepName } from "../step-order.js";
import { apiFetch, readJson } from "./lib/api.js";
import { describeFetchFailure } from "./lib/describe-failure.js";

export type ArticleCostLoad =
  | { kind: "loading" }
  | { kind: "failed"; message: string }
  | { kind: "ready"; cost: ArticleCost };

/** What a line is called: the pipeline step for step work, the job otherwise. */
export function lineName(line: ArticleCostLine): string {
  // The append-only ledger keeps old names; only their presentation changes.
  const name = taskOf(line);
  const job = currentStepName(line.job);
  /* Historical labels calls ran inside the structure step. Keep that detail
     so the two kinds of calls remain distinguishable. */
  const detail = line.stepName && job !== name ? ` · ${job}` : "";
  return `${name.replaceAll("_", " ")}${detail.replaceAll("_", " ")}`;
}

/**
 * **The ledger read, one level above the body that draws it.** The section is
 * shut by default and shows the total on its heading (Greg, 2026-10-01,
 * SPIDERYARN-READING2-7G), and a shut section does not mount its children — so
 * the read cannot live inside them, or the heading would have nothing to say
 * until somebody opened it. Call it only where the administrator check has
 * already passed: calling it is the request.
 */
export function useArticleCost(slug: string): ArticleCostLoad {
  /* **Tagged with the slug it answers.** Without the tag, a new `slug` would
     render the previous article's total for one frame before the effect below
     set it loading — nothing on the metadata page does that today, since the
     page is keyed by slug and remounts, but the hook should not rely on its
     caller for it. GPT Sol, plan review. */
  const [state, setState] = useState<{ slug: string; load: ArticleCostLoad }>({
    slug,
    load: { kind: "loading" },
  });

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const res = await apiFetch(`/api/admin/articles/${encodeURIComponent(slug)}/cost`);
        const cost = await readJson<ArticleCost>(res);
        if (live) setState({ slug, load: { kind: "ready", cost } });
      } catch (e) {
        /* The server's refusal passes through; a lost connection or a bug is
           said in our words, not its own (lib/describe-failure.ts). */
        if (live) setState({ slug, load: { kind: "failed", message: describeFetchFailure(e as Error) } });
      }
    })();
    return () => {
      live = false;
    };
  }, [slug]);

  return state.slug === slug ? state.load : { kind: "loading" };
}

/** The sums the heading and the body both say, from one place so they cannot disagree. */
function totals(cost: ArticleCost) {
  const lines = [...cost.lines].sort((a, b) => articleCostLineNanos(b) - articleCostLineNanos(a));
  return {
    lines,
    total: lines.reduce((n, l) => n + articleCostLineNanos(l), 0),
    calls: lines.reduce((n, l) => n + l.calls, 0),
    unpriced: lines.reduce((n, l) => n + l.unpricedCalls, 0),
  };
}

function totalLine(total: number, isFloor: boolean): string {
  return `${isFloor ? "At least " : ""}${formatSpendNanos(total)}`;
}

/**
 * **The one line on the shut heading** — the total and the call count, or
 * `none recorded`, and `…` while it loads. Null when the read failed: the failure is drawn in the body, which the section then refuses to
 * shut (Metadata.tsx § `CostSection`).
 */
export function articleCostSummary(load: ArticleCostLoad): string | null {
  if (load.kind === "loading") return "…";
  if (load.kind === "failed") return null;
  const { total, calls, unpriced } = totals(load.cost);
  /* **A silent live conversation makes the figure a floor too**, though the
     body says so in a line of its own rather than with a `+`: the heading is
     all a shut section shows, so it must not read as the whole bill while the
     qualification sits hidden underneath. GPT Sol, plan review P1. */
  const silent = load.cost.silentLiveSessions ?? 0;
  if (load.cost.lines.length === 0) {
    return silent > 0
      ? `none priced · ${silent} live ${silent === 1 ? "conversation" : "conversations"} unreported`
      : "none recorded";
  }
  return `${totalLine(total, unpriced > 0 || silent > 0)} · ${calls} ${calls === 1 ? "call" : "calls"}`;
}

export function ArticleCostBody({ load }: { load: ArticleCostLoad }) {
  if (load.kind === "loading") {
    return <p className="tw:m-0 tw:text-sm tw:text-ink-faint">Reading the ledger…</p>;
  }
  if (load.kind === "failed") {
    return (
      <p role="alert" className="tw:m-0 tw:text-sm tw:text-destructive">
        Could not read what this article cost: {load.message}
      </p>
    );
  }
  return <CostTable cost={load.cost} />;
}

function CostTable({ cost }: { cost: ArticleCost }) {
  const { lines, total, calls, unpriced } = totals(cost);
  const computed = lines.reduce((n, l) => n + l.computedCalls, 0);
  const nonOk = lines.reduce((n, l) => n + l.nonOkCalls, 0);
  /* **The fee is on buying credits, so it applies to this pocket only** — not
     to BYOK, billed to somebody else's key, nor to our own arithmetic. GPT Sol,
     plan review P2; docs/project/ai-gateway.md § What it cost. */
  const credits = lines.reduce((n, l) => n + l.creditsNanos, 0);

  return (
    <div className={`${CARD} tw:p-4 tw:text-sm`}>
      {lines.length === 0 ? (
        <p className="tw:m-0 tw:text-ink-faint">
          No model calls are recorded against this article.
        </p>
      ) : (
        <>
          <p className="tw:m-0 tw:mb-3" data-testid="article-cost-total">
            <span className="tw:text-lg tw:font-semibold tw:tabular-nums">
              {totalLine(total, unpriced > 0 || (cost.silentLiveSessions ?? 0) > 0)}
            </span>{" "}
            <span className="tw:text-ink-faint">
              over {calls} {calls === 1 ? "call" : "calls"}
            </span>
          </p>

          <table className="tw:w-full tw:border-collapse tw:text-left">
            <thead>
              <tr className="tw:text-[0.68rem] tw:uppercase tw:tracking-[0.06em] tw:text-ink-faint">
                <th className="tw:py-1 tw:pr-3 tw:font-normal">Work</th>
                <th className="tw:py-1 tw:pr-3 tw:font-normal">Kind</th>
                <th className="tw:py-1 tw:pr-3 tw:text-right tw:font-normal">Calls</th>
                {/* "Total", because "Calls, Cost" can be read as so many calls
                    at so much each, and Greg asked for a total-cost column
                    here (2026-10-06, spya-h2dzab). Kept on one line:
                    at 390px the two words broke over two. */}
                <th className="tw:py-1 tw:text-right tw:font-normal tw:whitespace-nowrap">Total cost</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr
                  key={`${line.scopeKind}/${line.job}/${line.stepName ?? ""}`}
                  className="tw:border-t tw:border-border"
                >
                  <td className="tw:py-1 tw:pr-3">{lineName(line)}</td>
                  <td className="tw:py-1 tw:pr-3 tw:text-ink-faint">{line.category}</td>
                  <td className="tw:py-1 tw:pr-3 tw:text-right tw:tabular-nums">{line.calls}</td>
                  <td className="tw:py-1 tw:text-right tw:tabular-nums">
                    {formatSpendNanos(articleCostLineNanos(line))}
                    {line.unpricedCalls > 0 ? "+" : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <ul className="tw:m-0 tw:mt-3 tw:list-none tw:p-0 tw:text-xs tw:text-ink-faint tw:space-y-1">
        {unpriced > 0 && (
          <li>
            {unpriced} {unpriced === 1 ? "call" : "calls"} reported no cost, so the total is a
            floor (marked +).
          </li>
        )}
        {cost.silentLiveSessions !== null && cost.silentLiveSessions > 0 && (
          <li>
            {cost.silentLiveSessions} live{" "}
            {cost.silentLiveSessions === 1 ? "conversation" : "conversations"} connected and never
            reported usage, so {cost.silentLiveSessions === 1 ? "it is" : "they are"} not counted.
          </li>
        )}
        {computed > 0 && (
          <li>
            {computed} {computed === 1 ? "call was" : "calls were"} priced by our own arithmetic
            rather than settled by the provider.
          </li>
        )}
        {nonOk > 0 && (
          <li>
            {nonOk} {nonOk === 1 ? "call" : "calls"} failed or {nonOk === 1 ? "was" : "were"}{" "}
            stopped, and {nonOk === 1 ? "is" : "are"} included: they usually still cost.
          </li>
        )}
        {credits > 0 && (
          <li>
            {formatSpendNanos(credits)} of this is OpenRouter credits, which cost about 5.5% more in
            cash.
          </li>
        )}
        <li>
          Only what was recorded and tied to this article: a call whose ledger write failed is
          missing, and link previews and dictation were not tied to an article before 30 September
          2026.
        </li>
      </ul>
    </div>
  );
}
