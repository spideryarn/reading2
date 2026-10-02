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
 * **The preview is the gist, or else the abstract cut short.** A paper on the
 * shelf with only its title, authors and abstract read has no gist yet, and
 * its abstract is already on the entry (types.ts § `LibraryEntry.abstract`).
 *
 * Nothing in it is pressable — the topics are labels, not chips — so it is an
 * ordinary non-interactive card (docs/project/tooltips.md § A card the pointer
 * can enter).
 */
import type { LibraryEntry } from "../types.js";
import { exactly } from "./relative-time.js";
import { SHARING_ON } from "../messages.js";
import { NOT_PROCESSED_MARK } from "./ShelfEntry.js";
import { TopicDot } from "./ShelfTermChip.js";

/** A shelf topic as the card names it: its words, and its hue-ring stop. */
export interface PaperTopic {
  label: string;
  slot: number;
}

/** How many topics the card names before it says how many more. */
export const CARD_TOPICS = 6;

/** How long an abstract may run as the preview before it is cut, in characters. */
export const ABSTRACT_PREVIEW = 280;

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
  /** The gist, or else the abstract cut at ABSTRACT_PREVIEW on a word. */
  preview: string | undefined;
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
     LibraryEntry.processing). It gets the shelf card's own marker instead
     (ShelfEntry.tsx § NOT_PROCESSED_MARK). GPT Sol's plan review, P1. */
  if (entry.processing === "minimal") facts.push({ label: "Status", value: NOT_PROCESSED_MARK });
  else {
    facts.push({
      label: "Length",
      value: `${entry.minutes.toLocaleString()} min · ${entry.words.toLocaleString()} words`,
    });
  }

  const archived = exactly(entry.archivedAt);
  if (archived) facts.push({ label: "Archived", value: archived });
  if (entry.visibility === "public") facts.push({ label: "Shared", value: SHARING_ON });

  const byline = [entry.byline, entry.siteName].filter((s): s is string => Boolean(s?.trim())).join(" · ");

  return {
    title: entry.title,
    byline: byline || undefined,
    preview: entry.gist ?? (entry.abstract ? cut(entry.abstract, ABSTRACT_PREVIEW) : undefined),
    facts,
    topics: topics.slice(0, CARD_TOPICS),
    moreTopics: Math.max(0, topics.length - CARD_TOPICS),
  };
}

/** `text` whole if it fits in `max` characters, else cut on a word, with an ellipsis. */
function cut(text: string, max: number): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  const head = t.slice(0, max);
  const space = head.lastIndexOf(" ");
  return `${(space > max / 2 ? head.slice(0, space) : head).replace(/[\s,;:.]+$/, "")}…`;
}

/**
 * The card, drawn with the `.tip-*` classes the other cards use so it reads as
 * the same kind of thing. tooltip.css § the paper card.
 */
export function PaperCard({
  entry,
  topics,
  titleIsTriggerName = false,
}: {
  entry: LibraryEntry;
  topics: readonly PaperTopic[];
  /**
   * The link this card hangs off is named by the title already. A
   * non-interactive card is its trigger's `aria-describedby`, so a screen
   * reader would read the title twice: once as the name, once at the start of
   * the description. True hides the title line from assistive technology and
   * keeps it on screen (GPT Sol's plan review, P1). A caller whose link says
   * something else — a slug, a short label — leaves it false.
   */
  titleIsTriggerName?: boolean;
}) {
  const card = paperCardFacts(entry, topics);
  return (
    <div className="tip-paper">
      <div className="tip-title" aria-hidden={titleIsTriggerName || undefined}>
        {card.title}
      </div>
      {card.byline && <p className="tip-byline">{card.byline}</p>}
      {card.preview && <p className="tip-gist">{card.preview}</p>}
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
