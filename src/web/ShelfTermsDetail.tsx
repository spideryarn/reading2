/**
 * **The Topics row's "More detail" view**: one row per topic instead of pills
 * on one line — its colour, its chip, its live count as a small bar, and the
 * three articles that use it most, as links.
 *
 * Greg, 2026-09-28: *"there should be a different way to show 'More detail' or
 * similar, that turns them into per-row-with-extra-detail rather than
 * pills-on-the-same-row … right now it's ugly (just shows them directly
 * beneath), and not that functional (no links/tooltips). can we do better? e.g.
 * use colour per term"*.
 *
 * **The chip in each row is the pill** — `TermChip`, the same toggle and the
 * same tooltip — so choosing a topic here and in the row above are one act,
 * not two that happen to agree. This view is also the touch answer the old
 * "All N topics" list was: a tap on a chip toggles, and what hovering would
 * have told a mouse is written in the row (shelf-terms.md § Touch).
 *
 * It draws the topics it is handed, in the order handed — every topic worth
 * offering, in the server's rank order, is ShelfTerms.tsx's call (plan 260928d
 * § Stage 2, the state machine; the zeros dropped since plan 260929a). **The colour is decoration only**: the label is always
 * drawn, and every swatch and bar is `aria-hidden`.
 *
 * **Compact table-like rows**, chosen over cards and two-line rows from
 * screenshots at desktop and phone widths (plan 260928d § Stage 2): the bars
 * line up in one column, so the counts compare at a glance. On a phone the
 * titles drop to a second line under the chip.
 */
import { Link } from "./Link.js";
import { readHref } from "./router.js";
import type { ShelfTerm } from "./shelf-narrow.js";
import { TermChip, type TermTipScope, TopicDot, topArticles } from "./ShelfTermChip.js";
import { topicColourStyle } from "./topic-colour.js";
import { TooltipGroup } from "./Tooltip.js";

/** How many articles a row names. */
const ROW_ARTICLES = 3;

export function ShelfTermsDetail({
  terms,
  slotOf,
  count,
  chosen,
  onToggle,
  scope,
}: {
  /** The topics to draw, in the order to draw them. */
  terms: readonly ShelfTerm[];
  /** Each topic's palette slot — the same one its pill's dot wears. */
  slotOf: (key: string) => number;
  /** The live count, from the one formula in shelf-narrow.ts. */
  count: (key: string) => number;
  chosen: ReadonlySet<string>;
  onToggle: (key: string) => void;
  scope: TermTipScope;
}) {
  /* The bar is relative to the biggest count drawn, not to the shelf: it is
     there so the eye can compare rows, and the exact number is on the chip. */
  const most = Math.max(1, ...terms.map((t) => count(t.key)));

  return (
    <TooltipGroup delay={{ open: 300, close: 120 }} timeoutMs={400}>
      <ul aria-label="Topics in detail" className="tw:m-0 tw:mt-2 tw:flex tw:list-none tw:flex-col tw:p-0">
        {terms.map((t) => {
          const n = count(t.key);
          const slot = slotOf(t.key);
          return (
            <li
              key={t.key}
              className="tw:grid tw:grid-cols-[0.625rem_minmax(0,1fr)_4rem] tw:items-center tw:gap-x-3 tw:gap-y-1 tw:border-b tw:border-border/50 tw:py-1.5 tw:text-xs tw:sm:grid-cols-[0.625rem_12rem_4rem_minmax(0,1fr)]"
            >
              <TopicDot slot={slot} className="tw:size-2.5" />
              <span className="tw:min-w-0">
                <TermChip
                  term={t}
                  count={n}
                  on={chosen.has(t.key)}
                  slot={null}
                  onToggle={onToggle}
                  scope={scope}
                  className="tw:max-w-full"
                />
              </span>
              <CountBar n={n} most={most} slot={slot} />
              <span className="tw:col-span-full tw:min-w-0 tw:pl-[1.375rem] tw:sm:col-span-1 tw:sm:pl-0">
                <Titles term={t} scope={scope} />
              </span>
            </li>
          );
        })}
      </ul>
    </TooltipGroup>
  );
}

/**
 * The live count as a bar, in the topic's colour. Decorative: the number is on
 * the chip beside it, so the bar is `aria-hidden` rather than a second reading
 * of it. `data-count-bar` carries the fraction for a test.
 */
function CountBar({ n, most, slot }: { n: number; most: number; slot: number }) {
  const pct = Math.round((n / most) * 100);
  return (
    <span
      aria-hidden="true"
      data-count-bar={pct}
      className="tw:block tw:h-1.5 tw:w-full tw:overflow-hidden tw:rounded-full tw:bg-border/60"
    >
      <span
        style={{ ...topicColourStyle(slot), width: `${pct}%` }}
        className="tw:block tw:h-full tw:rounded-full tw:bg-[var(--topic)]"
      />
    </span>
  );
}

/**
 * How many articles in scope use the topic — the tooltip's *"7 of 38 on the
 * shelf"*, which unlike the chip's live count does not move as the view
 * narrows — then the ones that use it most, one per title, as links.
 */
function Titles({ term, scope }: { term: ShelfTerm; scope: TermTipScope }) {
  const members = term.articles.filter((a) => scope.inScope.has(a.slug)).length;
  const top = topArticles(term, scope.inScope, ROW_ARTICLES, scope.titleOf);
  return (
    <span className="tw:text-muted-foreground">
      <span className="tw:tabular-nums tw:text-ink-faint">
        {members} of {scope.inScope.size} {scope.scopeWord}
      </span>
      {top.length > 0 && <span aria-hidden="true"> — </span>}
      {top.map((a, i) => (
        <span key={a.slug}>
          {i > 0 && <span aria-hidden="true"> · </span>}
          <Link
            href={readHref(a.slug)}
            className="tw:text-muted-foreground tw:underline-offset-2 tw:hover:text-foreground tw:hover:underline"
          >
            {scope.titleOf(a.slug) ?? a.slug}
          </Link>
        </span>
      ))}
    </span>
  );
}
