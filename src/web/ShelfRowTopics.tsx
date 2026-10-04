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
 * quieter and not pressable: like a tag chip beside it (ShelfTags.tsx), it
 * stays under the card's stretched title link, so pressing one opens the
 * article. That includes the `+N`: lifting it above the link for a hover card
 * would make a patch of the card that does nothing when pressed (GPT Sol's
 * plan review, F2). Which topics the `+N` stands for is in the Topics row's
 * More detail view.
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

export function ShelfRowTopics({ slug, className = "" }: { slug: string; className?: string }) {
  const topics = useContext(ArticleTopicsContext).bySlug.get(slug);
  if (!topics?.length) return null;
  const { shown, more } = rowTopics(topics);
  return (
    <ul
      aria-label="Topics"
      data-row-topics
      className={`tw:m-0 tw:flex tw:list-none tw:flex-wrap tw:items-center tw:gap-1 tw:p-0 tw:text-xs tw:text-muted-foreground ${className}`}
    >
      {shown.map((t, i) => (
        /* Parallel branches may deliberately have the same label. */
        <li
          key={t.key ?? `${t.label}-${i}`}
          className="tw:inline-flex tw:max-w-full tw:items-center tw:gap-1 tw:rounded-full tw:border tw:border-border tw:px-1.5 tw:py-0.5"
        >
          <TopicDot slot={t.slot} className="tw:size-1.5" />
          {t.finer && (
            <span aria-hidden="true" data-topic-finer className="tw:-mr-0.5 tw:opacity-60">
              ›
            </span>
          )}
          <span className={`tw:min-w-0 tw:truncate ${t.voice ? voiceClass(t.voice) : ""}`}>{t.label}</span>
        </li>
      ))}
      {more > 0 && (
        <li data-row-topics-more className="tw:tabular-nums">
          <span aria-hidden="true">+{more}</span>
          <span className="tw:sr-only">and {more} more</span>
        </li>
      )}
    </ul>
  );
}
