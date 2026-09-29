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
 * ShelfTermsDetail.tsx. Each topic wears the colour of its rank
 * (topic-colour.ts), as a dot on its pill and a swatch on its row.
 *
 * **Both views draw only the topics worth offering** — a topic with nothing
 * left to show is not drawn unless it is chosen (`availableTopics`, plan
 * 260929a, Greg's report 4Y). It used to be greyed in place.
 *
 * This component draws; it decides nothing about which articles are shown.
 * The counts come in already computed by the one formula in shelf-narrow.ts,
 * and a click goes back up as a key. docs/project/shelf-terms.md.
 */
import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { useQueryState } from "nuqs";
import type { LibraryTermsResponse } from "../types.js";
import { libraryTopicsViewParam } from "./params.js";
import { availableTopics } from "./shelf-narrow.js";
import { TermChip, type TermTipScope } from "./ShelfTermChip.js";
import { ShelfTermsDetail } from "./ShelfTermsDetail.js";
import { topicSlot } from "./topic-colour.js";
import { TooltipGroup } from "./Tooltip.js";

/** How many chips the collapsed row draws, besides any chosen ones. */
export const COLLAPSED_CHIPS = 12;

/** Below this many distinct works the server chooses no topics at all. */
const MIN_WORKS = 8;

const QUIET_BUTTON =
  "tw:inline-flex tw:h-7 tw:items-center tw:gap-1 tw:rounded-md tw:bg-transparent tw:px-2 tw:text-xs tw:text-muted-foreground tw:transition-colors tw:hover:bg-highlight/10 tw:hover:text-foreground";

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
      <div className="tw:mb-3 tw:flex tw:flex-wrap tw:items-center tw:gap-x-2">
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
  /* A topic's colour is its rank's: its index in the server's order. */
  const rank = new Map(terms.map((t, i) => [t.key, i]));
  const slotOf = (key: string) => topicSlot(rank.get(key) ?? 0);
  /* **The server's rank order**, never re-sorted (plan 260928d): the chooser
     ranks for coverage, so the first few chips are the few that reach most of
     the shelf. **Zeros go first, then the first twelve** (plan 260929a, Sol
     R5): a topic with nothing left to show is dropped unless chosen, and only
     then does the row take the first COLLAPSED_CHIPS, plus any chosen topic
     further down, in its place — or, with "All N topics", every one. Taking
     twelve and then dropping zeros would leave the row short with pills
     waiting beyond it. The colour stays the rank's, above, so a chip keeps its
     dot when its neighbours come and go. */
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
      <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-x-2 tw:gap-y-2">
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
