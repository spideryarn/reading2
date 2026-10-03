/**
 * **The shelf's Tags row** — the reader's own tags as filter chips, above the
 * Topics row.
 *
 * Greg, 2026-10-01: *"These tags should be part of the topics-pill
 * faceted-filtering interface for the Library shelf so I can filter by one or
 * more etc."* A row of its own rather than chips mixed into Topics (GPT Sol's
 * plan review, finding 4): the Topics row's colours, "All N topics", More
 * detail and copy are all about phrases a program chose, and the reader's own
 * labels are not that. What the two rows share is the narrowing — one AND
 * across every chip chosen in either, and one count formula
 * (shelf-narrow.ts § `tagFacets`). Plan
 * docs/plans/261003d-your-own-tags-on-articles-on-the-shelf-and-the-metadata-page.md.
 *
 * Drawn only when some article in scope has a tag; a chip whose count is zero
 * is hidden unless chosen, the Topics row's rule (`availableTopics`).
 */

import { Tag, X } from "lucide-react";

import { chipClass } from "./lib/DataTable.js";
import { availableTopics, type ShelfTerm } from "./shelf-narrow.js";
import { ControlTip, Tooltip } from "./Tooltip.js";
import { voiceClass } from "./voice.js";

export function ShelfTagFilter({
  facets,
  counts,
  selected,
  onToggle,
  onClear,
}: {
  /** `tagFacets` over the scope. */
  facets: readonly ShelfTerm[];
  /** `|visible ∩ its articles|` per tag. */
  counts: ReadonlyMap<string, number>;
  /** The chosen tags that apply, in the order chosen. */
  selected: readonly string[];
  onToggle: (key: string) => void;
  onClear: () => void;
}) {
  if (facets.length === 0) return null;
  const count = (key: string) => counts.get(key) ?? 0;
  const chosen = new Set(selected);
  const shown = availableTopics(facets, count, chosen);
  return (
    <div className="tw:mb-2 tw:flex tw:flex-wrap tw:items-center tw:gap-x-2 tw:gap-y-2">
      <Tooltip
        placement="top"
        keepSide
        className="tip-soon"
        content={
          <ControlTip
            head="Your tags"
            what="The tags you have put on your articles. Choose one to see only the articles with it; choose another, or a topic below, to narrow to articles with both."
            how="Add or change an article's tags from the Tag button on its card, or near the top of its Metadata page. Only you see them. The number is how many articles in this view have it."
          />
        }
      >
        <span
          // biome-ignore lint/a11y/noNoninteractiveTabindex: focus opens the card
          tabIndex={0}
          className="tw:cursor-help tw:border-0 tw:border-b tw:border-dotted tw:border-rule-strong tw:text-xs tw:font-medium tw:text-muted-foreground tw:focus-visible:outline-none tw:focus-visible:text-highlight"
        >
          Tags
        </span>
      </Tooltip>
      {shown.map((t) => {
        const on = chosen.has(t.key);
        const n = count(t.key);
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => onToggle(t.key)}
            aria-pressed={on}
            aria-label={`${t.label} ${n} — ${on ? "chosen; activate to remove" : "show only articles with this tag"}`}
            className={chipClass(on)}
          >
            <Tag size={11} aria-hidden="true" className="tw:shrink-0 tw:opacity-70" />
            <span className={`tw:min-w-0 tw:truncate ${voiceClass("reader")}`}>{t.label}</span>
            <span className="tw:tabular-nums tw:opacity-70">{n}</span>
            {on && <X size={11} aria-hidden="true" />}
          </button>
        );
      })}
      {selected.length > 0 && (
        <button
          type="button"
          onClick={onClear}
          aria-label="Clear — stop narrowing by tag"
          className="tw:h-7 tw:rounded-md tw:bg-transparent tw:px-2 tw:text-xs tw:text-muted-foreground tw:transition-colors tw:hover:bg-highlight/10 tw:hover:text-foreground"
        >
          Clear
        </button>
      )}
      {shown.length === 0 && (
        <span className="tw:text-xs tw:text-muted-foreground">None of your tags is in this view.</span>
      )}
    </div>
  );
}
