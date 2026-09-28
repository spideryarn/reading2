/**
 * **The Topics row**: short phrases picked from the shelf's own words, each a
 * chip with a count, between the shelf's controls and its "n of m" line.
 *
 * Greg, 2026-09-28: *"some simple keyword/clustering on the articles in my shelf
 * so I can easily filter to different kinds of article"* — and *"make heavy use
 * of tooltips (e.g. when I hover over a term it might indicate the articles that
 * use it most commonly), or perhaps each filter-term gets its own row with extra
 * metadata"*. This does both: a tooltip per chip for a mouse, and an "All N
 * topics" list with one row per topic, which is also **the touch answer** — the
 * shared `Tooltip` opens on hover and focus but not on a tap, and a chip cannot
 * both toggle and hold a card open on one tap (Sol F5). So a tap toggles, and
 * what hovering would have told you is in the rows.
 *
 * This component draws; it decides nothing about which articles are shown.
 * The counts come in already computed by the one formula in shelf-narrow.ts,
 * and a click goes back up as a key. docs/project/shelf-terms.md.
 */
import { useState } from "react";
import { ChevronRight, X } from "lucide-react";
import type { LibraryTermsResponse } from "../types.js";
import { chipClass } from "./lib/DataTable.js";
import type { ShelfTerm } from "./shelf-narrow.js";
import { TipNote, Tooltip, TooltipGroup } from "./Tooltip.js";

/** How many chips the collapsed row draws, besides any chosen ones. */
export const COLLAPSED_CHIPS = 12;

/** Below this many distinct works the server chooses no topics at all. */
const MIN_WORKS = 8;

/** How many articles a tooltip names, and how many a row in the list does. */
const TIP_ARTICLES = 5;
const ROW_ARTICLES = 3;

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

  const count = (key: string) => counts.get(key) ?? 0;
  const chosen = new Set(selected);
  /* **The server's rank order**, never re-sorted (plan 260928d): the chooser
     ranks for coverage, so the first few chips are the few that reach most of
     the shelf, and nothing moves when you press one or the counts change. The
     first COLLAPSED_CHIPS, plus any chosen topic further down, in its place. */
  const shown = terms.filter((t, i) => i < COLLAPSED_CHIPS || chosen.has(t.key));
  const scopeWord = archived ? "on the shelf and in the archive" : "on the shelf";

  const chip = (t: ShelfTerm) => {
    const on = chosen.has(t.key);
    const n = count(t.key);
    /* An unchosen chip at zero is greyed and aria-disabled in place, rather
       than removed — a row that reshuffles under the pointer is worse than a
       dead chip. It remains focusable so its explanatory tooltip is available
       from the keyboard; the handler enforces the disabled state. A chosen one
       at zero stays pressable, or it could not be removed. */
    const dead = !on && n === 0;
    const action = dead
      ? "unavailable because no articles match the current view"
      : on
        ? "chosen; activate to remove"
        : "show only articles about this";
    return (
      <Tooltip
        key={t.key}
        placement="bottom"
        keepSide
        content={<TermTip term={t} shown={n} inScope={inScope} scopeWord={scopeWord} titleOf={titleOf} />}
      >
        <button
          type="button"
          onClick={() => {
            if (!dead) onToggle(t.key);
          }}
          aria-disabled={dead}
          aria-pressed={on}
          /* Begins with what is on the chip, so a reader driving the page by
             voice can say what they see (WCAG 2.5.3) — the rule ShelfControls
             states for Unread. */
          aria-label={`${t.label} ${n} — ${action}`}
          className={`${chipClass(on)} ${dead ? "tw:cursor-default tw:opacity-40" : ""}`}
        >
          {t.label}
          <span className="tw:tabular-nums tw:opacity-70">{n}</span>
          {on && <X size={11} aria-hidden="true" />}
        </button>
      </Tooltip>
    );
  };

  return (
    <div className="tw:mb-3">
      <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-x-2 tw:gap-y-2">
        <span className="tw:text-xs tw:font-medium tw:text-muted-foreground">Topics</span>
        <TooltipGroup delay={{ open: 300, close: 120 }} timeoutMs={400}>
          {shown.map(chip)}
        </TooltipGroup>
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
        <button
          type="button"
          onClick={() => setAll((v) => !v)}
          aria-expanded={all}
          className="tw:inline-flex tw:h-7 tw:items-center tw:gap-1 tw:rounded-md tw:bg-transparent tw:px-2 tw:text-xs tw:text-muted-foreground tw:transition-colors tw:hover:bg-highlight/10 tw:hover:text-foreground"
        >
          All {terms.length} topics
          <ChevronRight size={12} className={`tw:transition-transform ${all ? "tw:rotate-90" : ""}`} />
        </button>
        {reading}
      </div>

      {all && (
        /* One row per topic — Greg's "each filter-term gets its own row with
           extra metadata" — and the place a phone gets what a tooltip gives a
           mouse. */
        <ul aria-label="All topics" className="tw:m-0 tw:mt-2 tw:flex tw:list-none tw:flex-col tw:gap-1 tw:p-0">
          {terms.map((t) => {
            const on = chosen.has(t.key);
            const n = count(t.key);
            const dead = !on && n === 0;
            const top = topArticles(t, inScope, ROW_ARTICLES);
            return (
              <li key={t.key} className="tw:flex tw:flex-wrap tw:items-baseline tw:gap-x-2 tw:text-xs">
                <button
                  type="button"
                  onClick={() => {
                    if (!dead) onToggle(t.key);
                  }}
                  aria-disabled={dead}
                  aria-pressed={on}
                  aria-label={`${t.label} ${n} — ${
                    dead
                      ? "unavailable because no articles match the current view"
                      : on
                        ? "chosen; activate to remove"
                        : "show only articles about this"
                  }`}
                  className={`${chipClass(on)} ${dead ? "tw:cursor-default tw:opacity-40" : ""}`}
                >
                  {t.label}
                  <span className="tw:tabular-nums tw:opacity-70">{n}</span>
                </button>
                <span className="tw:min-w-0 tw:flex-1 tw:text-muted-foreground">
                  {top.map((a) => titleOf(a.slug) ?? a.slug).join(" · ")}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** A topic's members that are in scope, most uses first (the server's order). */
function topArticles(term: ShelfTerm, inScope: ReadonlySet<string>, n: number) {
  return term.articles.filter((a) => inScope.has(a.slug)).slice(0, n);
}

/**
 * The card on a chip: both counts, the articles that use it most, and then the
 * paragraph a reader could not have guessed from the chip.
 *
 * **Both counts, with their denominators** (Sol F11): the chip says how many
 * match *this view*; the card adds how many use it across the scope, so a chip
 * reading 2 over a tooltip that says 7 explains itself.
 */
function TermTip({
  term,
  shown,
  inScope,
  scopeWord,
  titleOf,
}: {
  term: ShelfTerm;
  shown: number;
  inScope: ReadonlySet<string>;
  scopeWord: string;
  titleOf: (slug: string) => string | undefined;
}) {
  const members = term.articles.filter((a) => inScope.has(a.slug));
  return (
    <TipNote>
      <span className="tw:block tw:font-medium tw:text-foreground">
        {shown} match this view · {members.length} of {inScope.size} {scopeWord}
      </span>
      <span className="tw:mt-1 tw:block">
        {members.slice(0, TIP_ARTICLES).map((a) => (
          <span key={a.slug} className="tw:block">
            {titleOf(a.slug) ?? a.slug}
            <span className="tw:text-ink-faint">
              {" "}
              — used {a.count} {a.count === 1 ? "time" : "times"}
            </span>
          </span>
        ))}
      </span>
      <span className="tw:mt-1 tw:block tw:text-ink-faint">
        Picked automatically from the words your articles use — nobody wrote this list. Choosing two
        shows only articles that have both.
      </span>
    </TipNote>
  );
}
