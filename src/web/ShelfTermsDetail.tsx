/**
 * **The Topics row's "More detail" view**: one row per topic instead of pills
 * on one line — its colour, its chip, its live count as a small bar, and the
 * three articles that use it most, as links.
 *
 * Greg, 2026-09-29 (`spya-f28vqj`), on this view: *"there are these coloured
 * bars … It took me a while to figure out that they're probably a
 * count/proportion of matches. … anything like that that's hard for the user
 * to guess/intuit should always have a tooltip … if we have the bar we can
 * remove the "N of M on the shelf". … make the bars a little narrower"*. So
 * the bar has a card, the row no longer prints *N of M*, and the bar's column
 * is 3rem, down from 4 — docs/plans/261001j-five-small-feedback-tooltips-and-labels.md § 2.
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
 * § Stage 2, the state machine; the zeros dropped since plan 260929a).
 * **The colour is a supplementary visual cue**: the label is always drawn,
 * and every swatch and bar is `aria-hidden`; a reader who cannot distinguish
 * its hue loses the relatedness cue but not the control.
 *
 * **Compact table-like rows**, chosen over cards and two-line rows from
 * screenshots at desktop and phone widths (plan 260928d § Stage 2): the bars
 * line up in one column, so the counts compare at a glance. On a phone the
 * titles drop to a second line under the chip.
 */
import { Link } from "./Link.js";
import { PaperCard } from "./PaperCard.js";
import { readHref } from "./router.js";
import type { ShelfTerm } from "./shelf-narrow.js";
import { TermChip, type TermTipScope, TopicDot, topArticles } from "./ShelfTermChip.js";
import { topicColourStyle } from "./topic-colour.js";
import { TipNote, Tooltip, TooltipGroup } from "./Tooltip.js";

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
  /** Each topic's hue-ring stop — the same one its pill's dot wears. */
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
              className="tw:grid tw:grid-cols-[0.625rem_minmax(0,1fr)_3rem] tw:items-center tw:gap-x-3 tw:gap-y-1 tw:border-b tw:border-border/50 tw:py-1.5 tw:text-xs tw:sm:grid-cols-[0.625rem_12rem_3rem_minmax(0,1fr)]"
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
              <CountBar n={n} most={most} slot={slot} scopeWord={scope.scopeWord} />
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
 * The live count as a bar, in the topic's colour, with a card saying so.
 *
 * **Still `aria-hidden`**: the number is on the chip beside it, so to a screen
 * reader the bar would only be a second reading of it. The card is for the
 * eye, which is who was left guessing what the bar meant — so the trigger is a
 * taller strip around the 6px bar, which is otherwise too thin to point at.
 * `data-count-bar` carries the fraction for a test.
 */
function CountBar({
  n,
  most,
  slot,
  scopeWord,
}: {
  n: number;
  most: number;
  slot: number;
  scopeWord: string;
}) {
  const pct = Math.round((n / most) * 100);
  return (
    <Tooltip
      placement="top"
      content={
        <TipNote>
          {n} {n === 1 ? "article" : "articles"} in this view use this topic. The longest bar is the
          topic with the most ({most}), so the bars compare topics with each other, not with
          everything {scopeWord}.
        </TipNote>
      }
    >
      <span aria-hidden="true" data-count-bar={pct} className="tw:block tw:cursor-help tw:py-2">
        <span className="tw:block tw:h-1.5 tw:w-full tw:overflow-hidden tw:rounded-full tw:bg-border/60">
          <span
            style={{ ...topicColourStyle(slot), width: `${pct}%` }}
            className="tw:block tw:h-full tw:rounded-full tw:bg-[var(--topic)]"
          />
        </span>
      </span>
    </Tooltip>
  );
}

/**
 * The articles that use the topic most, one per title, as links — each with
 * the paper card on hover or focus (PaperCard.tsx; Greg's `spya-f28vqj`:
 * *"add rich tooltips … to the paper-links that are matched for each
 * faceted-text-search-pill"*, plan 261002f). A slug on no list loaded keeps
 * the bare link: there is nothing true to put on its card.
 *
 * Inside the view's `TooltipGroup`, so running the pointer down the titles
 * opens each card at once rather than waiting out the delay every time. The
 * card has nothing to press, so it is an ordinary card, and a tap on a phone
 * simply follows the link, as the shelf table's title does.
 *
 * **No *"7 of 38 on the shelf"* in front, since 2026-10-01** — the bar says
 * the proportion, and the chip's own card still gives both denominators
 * (ShelfTermChip.tsx § `TermTip`). Greg's `spya-f28vqj`.
 */
function Titles({ term, scope }: { term: ShelfTerm; scope: TermTipScope }) {
  const top = topArticles(term, scope.inScope, ROW_ARTICLES, scope.titleOf);
  return (
    <span className="tw:text-muted-foreground">
      {top.map((a, i) => {
        const entry = scope.entryOf(a.slug);
        const link = (
          <Link
            href={readHref(a.slug)}
            className="tw:text-muted-foreground tw:underline-offset-2 tw:hover:text-foreground tw:hover:underline"
          >
            {scope.titleOf(a.slug) ?? a.slug}
          </Link>
        );
        return (
          <span key={a.slug}>
            {i > 0 && <span aria-hidden="true"> · </span>}
            {entry ? (
              <Tooltip
                placement="bottom-start"
                content={<PaperCard entry={entry} topics={scope.topicsOf(a.slug)} />}
              >
                {link}
              </Tooltip>
            ) : (
              link
            )}
          </span>
        );
      })}
    </span>
  );
}
