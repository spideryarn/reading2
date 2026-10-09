/**
 * **What a stranger's page is told about the public shelf's topics**, from the
 * stored tree and the listing. Pure; imports only types, so it sits in the
 * public import graph without reaching a model, a gateway or an owner.
 *
 * The tree is stored under the site account (src/site-account.ts) by
 * src/public-shelf-topics.ts, out of the same closed listing this page shows.
 * Plan docs/plans/261008j-public-shelf-topic-pills-automatic-billed-to-the-site.md
 * § The design, 6; approved by Greg as "q-p5h2a7 A", 2026-10-09.
 *
 * ## Withheld whole, not trimmed
 *
 * If any article the tree was built from or filed into is no longer listed —
 * un-shared, archived, deleted — **no topic is sent at all** until the tree is
 * rebuilt. Cutting just that article's memberships is not enough: a label may
 * have been worded from its title, and un-sharing must take effect on the next
 * request, as it does for the card. Under 20 cards the un-share itself
 * rebuilds, so the gap is short.
 *
 * The order is a reader's shelf's (src/shelf-topic-sets.ts § `termsFromSet`):
 * broad first, then by how many cards, then by label.
 */
import type { PublicShelfTopic } from "./public-library-types.js";
import type { StoredTopic } from "./store/contracts.js";

/** Below this many listed cards nothing is sent: a reader's shelf's eight (`MIN_WORKS`), which a test pins. */
export const PUBLIC_TOPICS_MIN_CARDS = 8;

/** The stored tree, as far as this needs it. */
export interface PublicTopicTree {
  topics: readonly StoredTopic[];
  /** article id → topic ids. */
  members: Readonly<Record<string, readonly string[]>>;
}

export interface PublicTopicsAnswer {
  topics: PublicShelfTopic[];
  /** The keys of a listed card's topics; `[]` when it has none or nothing is sent. */
  keysOf: (articleId: string) => string[];
}

const NONE: PublicTopicsAnswer = { topics: [], keysOf: () => [] };

export function publicTopicsFor(
  cards: readonly { articleId: string }[],
  tree: PublicTopicTree | null,
): PublicTopicsAnswer {
  if (!tree || cards.length < PUBLIC_TOPICS_MIN_CARDS) return NONE;
  const listed = new Set(cards.map((c) => c.articleId));
  if (Object.keys(tree.members).some((id) => !listed.has(id))) return NONE;

  const count = new Map<string, number>();
  for (const c of cards) for (const id of tree.members[c.articleId] ?? []) count.set(id, (count.get(id) ?? 0) + 1);
  const shown = tree.topics.filter((t) => (count.get(t.id) ?? 0) > 0);
  if (shown.length === 0) return NONE;
  const keyOfId = new Map(shown.map((t) => [t.id, t.key]));

  const topics = [...shown]
    .sort(
      (a, b) =>
        a.depth - b.depth ||
        (count.get(b.id) ?? 0) - (count.get(a.id) ?? 0) ||
        (a.label < b.label ? -1 : a.label > b.label ? 1 : a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
    )
    .map((t): PublicShelfTopic => {
      const within = t.parent ? keyOfId.get(t.parent) : undefined;
      /* `granularityOf` in src/shelf-terms/model-topics.ts, which this file may not import. */
      return { key: t.key, label: t.label, granularity: 1 - 2 ** -t.depth, ...(within ? { within } : {}) };
    });
  /* In the order the topics are sent, so a card's pills read broad first. */
  const rank = new Map(topics.map((t, i) => [t.key, i]));
  return {
    topics,
    keysOf: (articleId) =>
      (tree.members[articleId] ?? [])
        .map((id) => keyOfId.get(id))
        .filter((k): k is string => k !== undefined)
        .sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0)),
  };
}
