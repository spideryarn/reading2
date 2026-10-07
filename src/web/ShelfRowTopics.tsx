/**
 * **The topics an article is in, on its shelf card and its table row** — its
 * first few as pills, then how many more.
 *
 * Greg, 2026-10-04 (`spya-mtajjy`): *"On the logged in home page, for each
 * article show its topic-pills. If there's lots, then maybe only show the
 * first three."* Plan
 * docs/plans/261005a-topic-pills-on-each-shelf-card-and-table-row.md.
 *
 * **Labels, not controls — every part of it.** A pill here wears the Topics
 * row's marks (the hue dot, the `›` of a finer topic, the model's face) but is
 * quieter and not pressable. On a card it stays under the stretched title
 * link, so pressing one opens the article, like a tag chip beside it
 * (ShelfTags.tsx). That includes the `+N`: lifting it above the link for a
 * hover card would make a patch of the card that does nothing when pressed
 * (GPT Sol's plan review, F2). A table row has no stretched link, so its labels
 * do nothing; the title remains the row's link. Which topics the `+N` stands
 * for is in the Topics row's More detail view.
 *
 * **Through a context, and handed to the card and the table by the page.** The
 * table's column definitions are memoised and rebuilding them remounts every
 * cell (Library.tsx § columns), so the page provides the lookup and the cell
 * reads it. And ShelfEntry.tsx and library-columns.tsx are shared with the
 * lazy /admin and /design routes, so they take this as a slot rather than
 * importing it (tests/eager-client-graph.test.ts).
 */
import { createContext, useContext } from "react";

import { type ArticleTopics, NO_ARTICLE_TOPICS, rowTopics } from "./article-topics.js";
import { TopicDot } from "./ShelfTermChip.js";
import { voiceClass } from "./voice.js";

/** Each article's topics, for the cards and rows beneath the provider. */
export const ArticleTopicsContext = createContext<ArticleTopics>(NO_ARTICLE_TOPICS);

/**
 * **Whether this shelf is expected to have topics**, so every card and row
 * holds the line's room before the pills arrive, and an article in no topic
 * keeps it blank. The pills come from a second request; without this each card
 * with topics grew a line after it was drawn (plan 261005h § C). The page
 * decides (useShelfTerms.ts § `topicsExpected`).
 *
 * A context of its own, beside the lookup above: a boolean is equal to itself
 * from one render to the next, so nothing has to be memoised for the cards
 * not to re-render, and the lookup keeps the one shape the Topics row shares.
 * `false` off the shelf page, where nothing provides it.
 */
export const TopicsExpectedContext = createContext(false);

/* The pill's own box, and the height one line of each form has. They are side
   by side because the second is worked out from the first: change a pill's
   padding, border or text size and the minimum has to follow.

   Both forms are `text-xs`, whose line is 1rem tall (0.75rem type at
   Tailwind's 1/0.75 leading).
   - A card's line is as tall as one pill: that 1rem, `py-0.5` above and below
     (2 × 0.125rem) and a 1px border above and below. calc(1.25rem + 2px),
     22px at the default text size.
   - The table's line is running text with no box round it: 1rem, `min-h-4`.

   The minimum is on the line whether or not it has pills, so a blank line and
   a line of pills are one element with one set of classes. Pills that wrap to
   a second line still grow it. */
const PILL = "tw:rounded-full tw:border tw:border-border tw:px-1.5 tw:py-0.5";
const PILLS_LINE_MIN = "tw:min-h-[calc(1.25rem+2px)]";
const PLAIN_LINE_MIN = "tw:min-h-4";

export function ShelfRowTopics({
  slug,
  className = "",
  plain = false,
}: {
  slug: string;
  className?: string;
  /**
   * **The table's form: the same marks as running text, with no pill around
   * each.** The table's Article column is about 250px wide, where bordered
   * pills stack one to a line and a row of four is taller than its card (the
   * browser check of plan 261005a). As text they wrap like the byline above
   * them.
   */
  plain?: boolean;
}) {
  const topics = useContext(ArticleTopicsContext).bySlug.get(slug) ?? [];
  const expected = useContext(TopicsExpectedContext);
  /* Blank: the line's room and nothing in it. No outline pills and no shimmer,
     because a blank line claims nothing about an article that may be in no
     topic at all. Hidden from a screen reader, which would otherwise announce
     an empty list. */
  const blank = topics.length === 0;
  if (blank && !expected) return null;
  const { shown, more } = rowTopics(topics);
  return (
    <ul
      aria-label={blank ? undefined : "Topics"}
      aria-hidden={blank || undefined}
      data-row-topics
      data-row-topics-plain={plain || undefined}
      data-row-topics-blank={blank || undefined}
      className={`tw:m-0 tw:list-none tw:p-0 tw:text-xs tw:text-muted-foreground ${plain ? `tw:block tw:wrap-anywhere ${PLAIN_LINE_MIN}` : `tw:flex tw:flex-wrap tw:items-center tw:gap-1 ${PILLS_LINE_MIN}`} ${className}`}
    >
      {shown.map((t, i) => (
        /* Parallel branches may deliberately have the same label. */
        <li
          key={t.key ?? `${t.label}-${i}`}
          className={
            plain
              ? /* `inline-block`, so a topic stays whole and lines break
                   between topics: as `inline` a dot could end one line with
                   its label on the next. */
                "tw:mr-2.5 tw:inline-block tw:max-w-full"
              : `tw:inline-flex tw:max-w-full tw:items-center tw:gap-1 ${PILL}`
          }
        >
          <TopicDot slot={t.slot} className={plain ? "tw:mr-1 tw:size-1.5 tw:align-middle" : "tw:size-1.5"} />
          {t.finer && (
            <span aria-hidden="true" data-topic-finer className="tw:-mr-0.5 tw:opacity-60">
              ›
            </span>
          )}
          <span className={`${plain ? "" : "tw:min-w-0 tw:truncate"} ${t.voice ? voiceClass(t.voice) : ""}`}>
            {t.label}
          </span>
        </li>
      ))}
      {more > 0 && (
        <li data-row-topics-more className={`tw:tabular-nums ${plain ? "tw:inline" : ""}`}>
          <span aria-hidden="true">+{more}</span>
          <span className="tw:sr-only">and {more} more</span>
        </li>
      )}
    </ul>
  );
}
