/**
 * **One shelf topic as a pressable chip**, with its tooltip — shared by the
 * Topics row's pills and by every row of its "More detail" view, so that the
 * two are the same control and cannot drift: same toggle, same `aria-pressed`,
 * same card on hover (plan 260928d § Stage 2). Which chips are drawn at all —
 * none at zero unless chosen — is decided above, by `availableTopics`.
 *
 * It draws; it decides nothing. The count comes in already computed by the
 * one formula in shelf-narrow.ts, and a press goes back up as a key.
 * docs/project/shelf-terms.md.
 */
import { X } from "lucide-react";
import { chipClass } from "./lib/DataTable.js";
import type { ShelfTerm } from "./shelf-narrow.js";
import { topicColourStyle } from "./topic-colour.js";
import { TipNote, Tooltip } from "./Tooltip.js";
import { voiceClass, withVoice } from "./voice.js";

/** How many articles a tooltip names. */
const TIP_ARTICLES = 5;

/** What the tooltip needs to know about the scope, the same for every chip. */
export interface TermTipScope {
  /** Every slug in scope, before search, Unread or topics: the tooltip's "of 38". */
  inScope: ReadonlySet<string>;
  /** "on the shelf", or "on the shelf and in the archive". */
  scopeWord: string;
  /** The title the card shows, or `undefined` for a slug not on the lists loaded. */
  titleOf: (slug: string) => string | undefined;
  /**
   * The label of the topic with this key, among every topic the server chose —
   * for a finer topic's *"Inside Neuroscience"*. This names the label's place
   * in the tree, not a membership bound; the card explains the distinction.
   * Absent where topics have no broader topic (the reader's tags).
   */
  labelOf?: (key: string) => string | undefined;
}

/**
 * **Whether a model wrote this topic's label** (plan 261003f) rather than a
 * program picking a phrase the articles use: only a model-named topic carries
 * a `granularity`. Then the label is in the model's face (fonts.md § Whose
 * voice is it), and nothing says "used N times", because there is no phrase.
 */
export const isModelTopic = (term: ShelfTerm) => term.granularity !== undefined;

/** A finer topic: one inside a broader subject, drawn with the `›` marker. */
export const isFinerTopic = (term: ShelfTerm) => (term.granularity ?? 0) > 0;

/**
 * A topic's members that are in scope, in the server's order — most uses first
 * for a phrase topic, newest first for a model-named one —
 * **one per title**, up to `n`.
 *
 * Several physical copies of one article carry one title, and a list naming
 * *"A brief history of ball lightning"* three times names one article. So the
 * first slug of each title is kept and the list fills on with the next distinct
 * one. Only what is *named* is deduplicated: every count stays physical
 * (shelf-terms.md § The count). A slug with no title is its own title.
 */
export function topArticles(
  term: ShelfTerm,
  inScope: ReadonlySet<string>,
  n: number,
  titleOf: (slug: string) => string | undefined,
) {
  const seen = new Set<string>();
  const out: ShelfTerm["articles"] = [];
  for (const a of term.articles) {
    if (out.length >= n) break;
    if (!inScope.has(a.slug)) continue;
    const title = titleOf(a.slug) ?? a.slug;
    if (seen.has(title)) continue;
    seen.add(title);
    out.push(a);
  }
  return out;
}

/**
 * The topic's colour as a small round mark. `data-topic-slot` is what a test
 * compares, and what says the pill's dot and the detail row's swatch agree.
 */
export function TopicDot({ slot, className = "tw:size-2" }: { slot: number; className?: string }) {
  return (
    <span
      aria-hidden="true"
      data-topic-slot={slot}
      style={topicColourStyle(slot)}
      className={`tw:inline-block tw:shrink-0 tw:rounded-full tw:bg-[var(--topic)] ${className}`}
    />
  );
}

const LABEL = "tw:min-w-0 tw:truncate";

export function TermChip({
  term,
  count,
  on,
  slot,
  onToggle,
  scope,
  className = "",
}: {
  term: ShelfTerm;
  /** `|visible ∩ its articles|` — shelf-narrow.ts § topicCounts. */
  count: number;
  on: boolean;
  /** The hue-ring stop for its dot (topic-colour.ts), or `null` for none. */
  slot: number | null;
  onToggle: (key: string) => void;
  scope: TermTipScope;
  className?: string;
}) {
  /* **No dead state since plan 260929a.** An unchosen chip at zero used to be
     greyed and aria-disabled in place, on the argument that a row reshuffling
     under the pointer was worse than a dead chip. Greg's report 4Y weighed it
     the other way — the row is for choosing the next filter, and a chip that
     leads to nothing is a distraction — so such a chip is no longer drawn
     (`availableTopics`). The only chip at zero now is a chosen one, which
     must stay pressable so it can be removed. */
  const action = on ? "chosen; activate to remove" : "show only articles about this";
  return (
    <Tooltip
      placement="bottom"
      keepSide
      content={<TermTip term={term} shown={count} {...scope} />}
    >
      <button
        type="button"
        onClick={() => onToggle(term.key)}
        aria-pressed={on}
        /* Begins with what is on the chip, so a reader driving the page by
           voice can say what they see (WCAG 2.5.3) — the rule ShelfControls
           states for Unread. */
        aria-label={`${term.label} ${count} — ${action}`}
        className={`${chipClass(on)} ${className}`}
      >
        {slot !== null && <TopicDot slot={slot} />}
        {/* **A finer topic is marked, not recoloured or shrunk**: a faint `›`
            in front of its label says "inside something broader" in both
            themes with the tokens the chip already has, and leaves the height
            (controls.md), the hue dot and the label's ink alone. The card
            names the broader topic. Decoration: the label is the name. */}
        {isFinerTopic(term) && (
          <span aria-hidden="true" data-topic-finer className="tw:-mr-0.5 tw:opacity-60">
            ›
          </span>
        )}
        <span className={isModelTopic(term) ? withVoice(LABEL, "ai") : LABEL}>{term.label}</span>
        {/* At the chip's own ink. It was dimmed to 70% until 2026-10-07,
            which measured 3.2:1 at 12px in both themes (plan 261007a § K3). */}
        <span className="tw:tabular-nums">{count}</span>
        {on && <X size={11} aria-hidden="true" />}
      </button>
    </Tooltip>
  );
}

/**
 * The card on a chip: both counts, the articles that use it most, and then the
 * paragraph a reader could not have guessed from the chip.
 *
 * **Both counts, with their denominators** (Sol F11): the chip says how many
 * match *this view*; the card adds how many use it across the scope, so a chip
 * reading 2 over a tooltip that says 7 explains itself.
 */
export function TermTip({
  term,
  shown,
  inScope,
  scopeWord,
  titleOf,
  labelOf,
}: {
  term: ShelfTerm;
  shown: number;
} & TermTipScope) {
  const members = term.articles.filter((a) => inScope.has(a.slug));
  const broader = term.within === undefined ? undefined : labelOf?.(term.within);
  return (
    <TipNote>
      <span className="tw:block tw:font-medium tw:text-foreground">
        {shown} match this view · {members.length} of {inScope.size} {scopeWord}
      </span>
      {broader !== undefined && (
        <span data-topic-inside className="tw:block">
          Inside <span className={voiceClass("ai")}>{broader}</span>
        </span>
      )}
      <span className="tw:mt-1 tw:block">
        {topArticles(term, inScope, TIP_ARTICLES, titleOf).map((a) => (
          <span key={a.slug} className="tw:block">
            {titleOf(a.slug) ?? a.slug}
            {/* A model-named topic's members carry no count: there is no
                phrase to count, so nothing is said (types.ts § LibraryTermsResponse). */}
            {a.count !== undefined && (
              <span className="tw:text-ink-faint">
                {" "}
                — used {a.count} {a.count === 1 ? "time" : "times"}
              </span>
            )}
          </span>
        ))}
      </span>
      <span className="tw:mt-1 tw:block tw:text-ink-faint">
        {isModelTopic(term)
          ? "Named by a model from your articles’ titles and summaries; the articles above are the newest in it. A finer topic can include matching articles from outside the broader topic it is grouped under. Choosing two topics shows only articles in both."
          : "Picked automatically from the words your articles use — nobody wrote this list. Choosing two shows only articles that have both."}
      </span>
    </TipNote>
  );
}
