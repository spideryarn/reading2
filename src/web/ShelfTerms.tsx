/**
 * **The Topics row**: short phrases picked from the shelf's own words, each a
 * chip with a count, between the shelf's controls and its "n of m" line.
 *
 * Greg, 2026-09-28: *"some simple keyword/clustering on the articles in my shelf
 * so I can easily filter to different kinds of article"* — and *"make heavy use
 * of tooltips (e.g. when I hover over a term it might indicate the articles that
 * use it most commonly), or perhaps each filter-term gets its own row with extra
 * metadata"*. This does both: a tooltip per chip for a mouse, and a "More
 * detail" view with one row per topic, which is also **the touch answer** — the
 * shared `Tooltip` opens on hover and focus but not on a tap, and a chip cannot
 * both toggle and hold a card open on one tap (Sol F5). So a tap toggles, and
 * what hovering would have told you is in the rows.
 *
 * **Two views** (plan 260928d § Stage 2). Pills, the default: the first
 * COLLAPSED_CHIPS in rank order plus any chosen further down, and "All N
 * topics" expands the same row to every pill in place. Detail
 * (`?topicsView=detail`): every topic, in rank order, one row each —
 * ShelfTermsDetail.tsx. Each topic wears a hue chosen by which articles it
 * shares with the others, so related topics look alike (topic-colour.ts,
 * report 5N), as a dot on its pill and a swatch on its row.
 *
 * **Both views draw only the topics worth offering** — a topic with nothing
 * left to show is not drawn unless it is chosen (`availableTopics`, plan
 * 260929a, Greg's report 4Y). It used to be greyed in place.
 *
 * This component draws; it decides nothing about which articles are shown.
 * The counts come in already computed by the one formula in shelf-narrow.ts,
 * and a click goes back up as a key. docs/project/shelf-terms.md.
 */
import { useMemo, useState } from "react";
import { ChevronRight, LoaderCircle } from "lucide-react";
import { useQueryState } from "nuqs";
import type { LibraryTermsResponse } from "../types.js";
import { libraryTopicsViewParam } from "./params.js";
import { availableTopics } from "./shelf-narrow.js";
import { TermChip, type TermTipScope } from "./ShelfTermChip.js";
import { ShelfTermsDetail } from "./ShelfTermsDetail.js";
import { topicHueStops } from "./topic-colour.js";
import { TooltipGroup } from "./Tooltip.js";

/** How many chips the collapsed row draws, besides any chosen ones. */
export const COLLAPSED_CHIPS = 12;

/** Below this many distinct works the server chooses no topics at all. */
export const MIN_WORKS = 8;

const QUIET_BUTTON =
  "tw:inline-flex tw:h-7 tw:items-center tw:gap-1 tw:rounded-md tw:bg-transparent tw:px-2 tw:text-xs tw:text-muted-foreground tw:transition-colors tw:hover:bg-highlight/10 tw:hover:text-foreground";
const TERMS_ROW = "tw:flex tw:flex-wrap tw:items-center tw:gap-x-2 tw:gap-y-2";

/**
 * Widths for the placeholder's outline pills, in rem: a spread like a real
 * row's (≈50–130px, mean ≈100px, measured on a 21-article shelf), so the
 * outlines wrap where the pills will. One fewer than COLLAPSED_CHIPS, because
 * the spinner and its words take the first pill's place.
 */
const GHOST_PILL_REM = [7.5, 4.5, 8, 5.5, 6, 8, 4, 6.5, 7, 5.5, 6];

/**
 * **The row's place, held while the topics are asked for** (Greg's report
 * a4xsg3, 2026-09-30: *"let's show some kind of loading spinner in their place
 * while they're loading"*): the same label, the app's one spinner with its
 * words, and — when the article count makes topics possible — the collapsed
 * row's shape in faint outlines, wrapping with the real row's flex classes,
 * then its always-present detail control and, when possible, its conditional
 * All-topics control, drawn invisibly at their real width. So the cards below
 * land near where they will stay at any width (GPT Sol, plan 260930j: a
 * remembered pixel height was the alternative, and goes stale with the shelf,
 * the window and the zoom).
 *
 * Before the answer, article rows are only an upper bound on distinct works:
 * exact copies are one work on the server, but their `textHash` is not in the
 * library response. So `articleCount` decides only what the shelf *might*
 * draw. Fewer than MIN_WORKS rows is certainly one line; more rows may still
 * collapse after the answer if they are copies or no useful topics survive.
 */
export function ShelfTermsLoading({ articleCount }: { articleCount: number }) {
  const mightHaveTopics = articleCount >= MIN_WORKS;
  /* The chooser returns at most one topic per distinct work. More than twelve
     article rows is therefore necessary — though not sufficient — for the
     real row's conditional "All N topics" button. */
  const mightHaveAllTopics = articleCount > COLLAPSED_CHIPS;
  return (
    <div
      role="status"
      aria-label="Loading topics"
      className={`tw:mb-3 tw:min-h-7 ${TERMS_ROW}`}
    >
      <span className="tw:text-xs tw:font-medium tw:text-muted-foreground">Topics</span>
      <span className="tw:inline-flex tw:h-7 tw:items-center tw:gap-1.5 tw:px-1 tw:text-xs tw:text-muted-foreground">
        <LoaderCircle className="cmt-spinner" size={13} />
        Loading topics…
      </span>
      {mightHaveTopics && (
        <>
          {GHOST_PILL_REM.map((rem, i) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list that never reorders
              key={i}
              aria-hidden="true"
              data-ghost-pill
              className="tw:inline-block tw:h-7 tw:rounded-full tw:border tw:border-border tw:opacity-50"
              style={{ width: `${rem}rem` }}
            />
          ))}
          {mightHaveAllTopics && (
            <span aria-hidden="true" className={`${QUIET_BUTTON} tw:invisible`}>
              All 20 topics
              <ChevronRight size={12} />
            </span>
          )}
          <span aria-hidden="true" className={`${QUIET_BUTTON} tw:invisible`}>
            More detail
          </span>
        </>
      )}
    </div>
  );
}

export function ShelfTerms({
  data,
  counts,
  selected,
  onToggle,
  onClear,
  titleOf,
  inScope,
  archived,
}: {
  data: LibraryTermsResponse;
  /** `|visible ∩ its articles|` per key — shelf-narrow.ts § topicCounts. */
  counts: ReadonlyMap<string, number>;
  /** The chosen keys that apply (`chosenTopics`), in the order chosen. */
  selected: readonly string[];
  onToggle: (key: string) => void;
  onClear: () => void;
  /** The title the card shows, or `undefined` for a slug not on the lists loaded. */
  titleOf: (slug: string) => string | undefined;
  /** Every slug in scope, before search, Unread or topics: the tooltip's "of 38". */
  inScope: ReadonlySet<string>;
  /** Whether the archive is in scope, which the tooltip names. */
  archived: boolean;
}) {
  const [all, setAll] = useState(false);
  const [view, setView] = useQueryState("topicsView", libraryTopicsViewParam);
  const { terms, pending, scope } = data;
  /* Selection, search and the two views all rerender this component without
     changing the server answer. Keep the O(topics² × members + topics³)
     projection tied to that answer, while still calling the hook on the empty
     early-return path below. */
  const hues = useMemo(() => topicHueStops(terms), [terms]);

  const reading = pending > 0 && (
    <span className="tw:text-xs tw:text-muted-foreground">
      Reading {pending} more {pending === 1 ? "article" : "articles"}…
    </span>
  );

  if (terms.length === 0) {
    /* Said rather than left blank: an empty space where a feature was is a
       feature that looks broken. Only when the server has read everything, or
       "too few" could be a count of the articles read so far. */
    const tooFew = pending === 0 && scope.works < MIN_WORKS;
    if (!reading && !tooFew) return null;
    return (
      <div className="tw:mb-3 tw:flex tw:min-h-7 tw:flex-wrap tw:items-center tw:gap-x-2">
        <span className="tw:text-xs tw:font-medium tw:text-muted-foreground">Topics</span>
        {reading || (
          <span className="tw:text-xs tw:text-muted-foreground">
            Topics appear once there are about eight different articles on the shelf.
          </span>
        )}
      </div>
    );
  }

  const detail = view === "detail";
  const count = (key: string) => counts.get(key) ?? 0;
  const chosen = new Set(selected);
  /* A topic's colour comes from which articles it shares with the other
     topics, over every topic the server chose (not only those drawn), so it
     does not move as the view narrows. */
  const slotOf = (key: string) => hues.get(key) ?? 0;
  /* **The server's rank order**, never re-sorted (plan 260928d): the chooser
     ranks for coverage, so the first few chips are the few that reach most of
     the shelf. **Zeros go first, then the first twelve** (plan 260929a, Sol
     R5): a topic with nothing left to show is dropped unless chosen, and only
     then does the row take the first COLLAPSED_CHIPS, plus any chosen topic
     further down, in its place — or, with "All N topics", every one. Taking
     twelve and then dropping zeros would leave the row short with pills
     waiting beyond it. The colour is computed over every topic, above, so a chip
     keeps its dot when its neighbours come and go. */
  const available = availableTopics(terms, count, chosen);
  const shown = all
    ? available
    : available.filter((t, i) => i < COLLAPSED_CHIPS || chosen.has(t.key));
  const tipScope: TermTipScope = {
    inScope,
    scopeWord: archived ? "on the shelf and in the archive" : "on the shelf",
    titleOf,
  };

  /* Every child of this row keeps its position in both views — a view's
     absent parts are `false`, not missing — so React keeps the one toggle
     button mounted across the switch and focus stays on it. */
  return (
    <div className="tw:mb-3">
      <div className={TERMS_ROW}>
        <span className="tw:text-xs tw:font-medium tw:text-muted-foreground">Topics</span>
        {!detail && (
          <TooltipGroup delay={{ open: 300, close: 120 }} timeoutMs={400}>
            {shown.map((t) => (
              <TermChip
                key={t.key}
                term={t}
                count={count(t.key)}
                on={chosen.has(t.key)}
                slot={slotOf(t.key)}
                onToggle={onToggle}
                scope={tipScope}
              />
            ))}
          </TooltipGroup>
        )}
        {selected.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            aria-label="Clear — stop narrowing by topic"
            className="tw:h-7 tw:rounded-md tw:bg-transparent tw:px-2 tw:text-xs tw:text-muted-foreground tw:transition-colors tw:hover:bg-highlight/10 tw:hover:text-foreground"
          >
            Clear
          </button>
        )}
        {available.length === 0 && (
          <span className="tw:text-xs tw:text-muted-foreground">None of the topics is in this view.</span>
        )}
        {!detail && available.length > COLLAPSED_CHIPS && (
          <button type="button" onClick={() => setAll((v) => !v)} aria-expanded={all} className={QUIET_BUTTON}>
            All {available.length} topics
            <ChevronRight size={12} className={`tw:transition-transform ${all ? "tw:rotate-90" : ""}`} />
          </button>
        )}
        <button
          type="button"
          onClick={() => void setView(detail ? null : "detail")}
          className={QUIET_BUTTON}
        >
          {detail ? "Fewer details" : "More detail"}
        </button>
        {reading}
      </div>

      {detail && available.length > 0 && (
        <ShelfTermsDetail
          terms={available}
          slotOf={slotOf}
          count={count}
          chosen={chosen}
          onToggle={onToggle}
          scope={tipScope}
        />
      )}
    </div>
  );
}
