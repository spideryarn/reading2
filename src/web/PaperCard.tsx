/**
 * **The paper card** — what a link to an article on your shelf says when you
 * point at it: its title, who wrote it and where, its one-sentence gist, when
 * you added it and last opened it, and the shelf topics it is in.
 *
 * Greg, 2026-09-29 (`spya-f28vqj`): *"maybe create a reusable component for
 * paper-tooltips that we use anywhere there's a link to a paper that shows
 * title, authors, metadata (e.g. when added, when last opened,
 * faceted-text-search-pills, and maybe some kind of preview or summary)"*.
 * docs/plans/261002f-paper-card-on-topic-article-links.md.
 *
 * **It knows nothing about where the link is.** A caller passes the
 * `LibraryEntry` and the topics to name, and wraps its own link in a
 * `Tooltip` whose content is this. The first caller is the shelf topics'
 * *More detail* view (ShelfTermsDetail.tsx § Titles).
 *
 * **Unlike the table's row card, it repeats the title.** That card hangs off a
 * row which already prints everything else, so it is defined by subtraction
 * (library-columns.tsx § rowCardFacts); a paper card hangs off a bare link,
 * which may be a short label or cut off, and Greg listed the title first.
 *
 * Nothing in it is pressable — the topics are labels, not chips — so it is an
 * ordinary non-interactive card (docs/project/tooltips.md § A card the pointer
 * can enter).
 */
import type { LibraryEntry } from "../types.js";
import { exactly } from "./relative-time.js";
import { SHARING_ON } from "../messages.js";
import { TopicDot } from "./ShelfTermChip.js";

/** A shelf topic as the card names it: its words, and its hue-ring stop. */
export interface PaperTopic {
  label: string;
  slot: number;
}

/** How many topics the card names before it says how many more. */
export const CARD_TOPICS = 6;

/** One line of the card's facts: a label, and what it says. */
export interface PaperCardFact {
  label: string;
  value: string;
}

/** What the card says — **as data, so it can be checked as data.** */
export interface PaperCardFacts {
  title: string;
  /** `byline · site`, either half absent; `undefined` when both are. */
  byline: string | undefined;
  gist: string | undefined;
  facts: PaperCardFact[];
  topics: PaperTopic[];
  /** Topics past CARD_TOPICS, said as a number. */
  moreTopics: number;
}

export function paperCardFacts(entry: LibraryEntry, topics: readonly PaperTopic[]): PaperCardFacts {
  const facts: PaperCardFact[] = [];

  const added = exactly(entry.addedAt);
  if (added) facts.push({ label: "Added", value: added });
  facts.push({ label: "Last opened", value: exactly(entry.lastOpenedAt) ?? "never" });

  /* A minimal paper has only its title, authors and abstract read, so its
     counts are 0 — a length of "0 min" would be a false claim (types.ts §
     LibraryEntry.processing). */
  facts.push({
    label: "Length",
    value:
      entry.processing === "minimal"
        ? "not read yet — title and abstract only"
        : `${entry.minutes.toLocaleString()} min · ${entry.words.toLocaleString()} words`,
  });

  const archived = exactly(entry.archivedAt);
  if (archived) facts.push({ label: "Archived", value: archived });
  if (entry.visibility === "public") facts.push({ label: "Shared", value: SHARING_ON });

  const byline = [entry.byline, entry.siteName].filter((s): s is string => Boolean(s?.trim())).join(" · ");

  return {
    title: entry.title,
    byline: byline || undefined,
    gist: entry.gist,
    facts,
    topics: topics.slice(0, CARD_TOPICS),
    moreTopics: Math.max(0, topics.length - CARD_TOPICS),
  };
}

/**
 * The card, drawn with the `.tip-*` classes the other cards use so it reads as
 * the same kind of thing. tooltip.css § the paper card.
 */
export function PaperCard({ entry, topics }: { entry: LibraryEntry; topics: readonly PaperTopic[] }) {
  const card = paperCardFacts(entry, topics);
  return (
    <div className="tip-paper">
      <div className="tip-title">{card.title}</div>
      {card.byline && <p className="tip-byline">{card.byline}</p>}
      {card.gist && <p className="tip-gist">{card.gist}</p>}
      <dl className="tip-facts">
        {card.facts.map(({ label, value }) => (
          <div key={label} className="tw:contents">
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
        {card.topics.length > 0 && (
          <div className="tw:contents">
            <dt>Topics</dt>
            <dd>
              <ul className="tip-topics">
                {card.topics.map((t) => (
                  <li key={t.label}>
                    <TopicDot slot={t.slot} className="tw:size-1.5" />
                    {t.label}
                  </li>
                ))}
                {card.moreTopics > 0 && <li className="tip-more">+{card.moreTopics} more</li>}
              </ul>
            </dd>
          </div>
        )}
      </dl>
    </div>
  );
}
