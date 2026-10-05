/**
 * **Every topic each article is in**, worked out once from the topics answer
 * and shared by everything that names an article's topics: the Topics row's
 * paper cards (ShelfTermsDetail.tsx) and the pills on each shelf card and
 * table row (ShelfRowTopics.tsx).
 *
 * Pure, and computed by the page (Library.tsx) rather than inside the Topics
 * row, so the hue a topic wears is worked out once per answer and the row and
 * the cards cannot disagree about it. Plan
 * docs/plans/261005a-topic-pills-on-each-shelf-card-and-table-row.md;
 * docs/project/shelf-terms.md.
 */
import type { PaperTopic } from "./PaperCard.js";
import type { ShelfTerm } from "./shelf-narrow.js";
import { topicHueStops } from "./topic-colour.js";

export interface ArticleTopics {
  /** Each topic's hue-ring stop, by key (topic-colour.ts). */
  hues: ReadonlyMap<string, number>;
  /**
   * Each article's topics, by slug: over **every** topic the server chose, not
   * only those drawn, in the server's rank order — so what an article is said
   * to be in does not change as the view narrows (plan 261002f).
   */
  bySlug: ReadonlyMap<string, readonly PaperTopic[]>;
}

/** No topics: before the answer, after a failure, and off the shelf page. */
export const NO_ARTICLE_TOPICS: ArticleTopics = { hues: new Map(), bySlug: new Map() };

export function articleTopics(terms: readonly ShelfTerm[]): ArticleTopics {
  if (terms.length === 0) return NO_ARTICLE_TOPICS;
  const hues = topicHueStops(terms);
  const bySlug = new Map<string, PaperTopic[]>();
  for (const t of terms) {
    const topic: PaperTopic = {
      key: t.key,
      label: t.label,
      slot: hues.get(t.key) ?? 0,
      ...(t.granularity !== undefined ? { voice: "ai" as const } : {}),
      ...((t.granularity ?? 0) > 0 ? { finer: true } : {}),
    };
    for (const a of t.articles) {
      const list = bySlug.get(a.slug);
      if (list) list.push(topic);
      else bySlug.set(a.slug, [topic]);
    }
  }
  return { hues, bySlug };
}

/** How many topic pills a shelf card or table row shows when it cannot show them all. */
export const ROW_TOPICS = 3;

/**
 * **The pills a card or row shows, and how many it leaves unsaid.** Greg:
 * *"If there's lots, then maybe only show the first three."* Up to four are
 * all shown: a `+1` takes about the room of the pill it hides (GPT Sol's plan
 * review, F4). From five, the first three, so `more` is never 1.
 */
export function rowTopics(topics: readonly PaperTopic[]): { shown: readonly PaperTopic[]; more: number } {
  if (topics.length <= ROW_TOPICS + 1) return { shown: topics, more: 0 };
  return { shown: topics.slice(0, ROW_TOPICS), more: topics.length - ROW_TOPICS };
}
