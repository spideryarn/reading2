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
 * ShelfTermsDetail.tsx. Each topic wears a hue chosen by which articles it
 * shares with the others, so related topics look alike (topic-colour.ts,
 * report 5N), as a dot on its pill and a swatch on its row.
 *
 * **Both views draw only the topics worth offering** — a topic with nothing
 * left to show is not drawn unless it is chosen (`availableTopics`, plan
 * 260929a, Greg's report 4Y). It used to be greyed in place.
 *
 * This component draws; it decides nothing about which articles are shown.
 * The counts come in already computed by the one formula in shelf-narrow.ts,
 * and a click goes back up as a key. docs/project/shelf-terms.md.
 */
import { useMemo, useState } from "react";
import { ChevronRight, LoaderCircle } from "lucide-react";
import { useQueryState } from "nuqs";
import type { LibraryEntry, LibraryTermsResponse } from "../types.js";
import type { PaperTopic } from "./PaperCard.js";
import { libraryTopicsViewParam } from "./params.js";
import { availableTopics, isModelNamed, topicDepth, withinChosenFirst } from "./shelf-narrow.js";
import { TermChip, type TermTipScope } from "./ShelfTermChip.js";
import { type PaperScope, ShelfTermsDetail } from "./ShelfTermsDetail.js";
import { topicHueStops } from "./topic-colour.js";
import { ControlTip, Tooltip, TooltipGroup } from "./Tooltip.js";

/** How many chips the collapsed row draws, besides any chosen ones. */
export const COLLAPSED_CHIPS = 12;

/** Below this many distinct works the server chooses no topics at all. */
export const MIN_WORKS = 8;

const QUIET_BUTTON =
  "tw:inline-flex tw:h-7 tw:items-center tw:gap-1 tw:rounded-md tw:bg-transparent tw:px-2 tw:text-xs tw:text-muted-foreground tw:transition-colors tw:hover:bg-highlight/10 tw:hover:text-foreground";
const TERMS_ROW = "tw:flex tw:flex-wrap tw:items-center tw:gap-x-2 tw:gap-y-2";

/**
 * Widths for the placeholder's outline pills, in rem: a spread like a real
 * row's (≈50–130px, mean ≈100px, measured on a 21-article shelf), so the
 * outlines wrap where the pills will. One fewer than COLLAPSED_CHIPS, because
 * the spinner and its words take the first pill's place.
 */
const GHOST_PILL_REM = [7.5, 4.5, 8, 5.5, 6, 8, 4, 6.5, 7, 5.5, 6];

/**
 * **The word *Topics*, with a card saying how they are picked and ordered.**
 * Greg, 2026-09-29 (`spya-tw6zxw`): *"Add a tooltip explaining how they're
 * selected and ordered. Or alternatively, make the ordering much more
 * self-explanatory, because it's very confusing right now"*. The card, because
 * the order is the chooser's and an eval picked it (shelf-terms.md § The
 * model's judgement); docs/plans/261001j-five-small-feedback-tooltips-and-labels.md § 3.
 *
 * What it says is src/shelf-terms/choose.ts said plainly: a greedy cover in
 * which each pick is the candidate whose *discounted* coverage (an article
 * already covered still counts, for less) times its quality is highest — the
 * model's 0–3 score when there is one, the program's own measure when there is
 * not — with restatements skipped and near-neighbours separated afterwards.
 * Hence *roughly* the order of picking: the adjacency pass can reorder. GPT
 * Sol's plan review caught the first draft saying "the most articles the ones
 * before it had not reached", which is the lexicographic order this does not
 * use.
 *
 * Only on the row that has topics: the loading and empty states already say
 * in words what is happening, and a card there would be a second sentence.
 * Focusable, as the glossary's globe is, so the card is not mouse-only.
 */
function TopicsLabel({ modelNamed }: { modelNamed: boolean }) {
  /* **Two cards, because there are two kinds of topic** (plan 261003f): a
     model names subjects as a broad-to-fine tree, and until its answer is
     stored the row is the older phrases picked by the program. Each card says
     only what is true of the row it is on. */
  return (
    <Tooltip
      placement="top"
      keepSide
      className="tip-soon"
      content={
        modelNamed ? (
          <ControlTip
            head="Topics"
            what="Subjects a model named from the titles and summaries of your articles. Broad subjects come first. Choose one to see only its articles, and the finer topics inside it, marked ›, move up beside it; choose one of those to narrow further."
            how="Topics with nothing left to show are hidden while you narrow. New articles are sorted into the topics automatically. The number is how many articles in this view are in the topic."
          />
        ) : (
          <ControlTip
            head="Topics"
            what="Phrases your articles use, picked to cover much of the shelf while still overlapping. Choose one to see only the articles about it; choose another to narrow to articles about both."
            how="Listed roughly in the order they were picked. Each pick favours a phrase that reaches articles the earlier ones reached less, weighted by how good a topic it makes — judged for you by a model once it has scored them, by the program until then. Near-copies are left out, and similar ones kept apart. The number is how many articles in this view use it."
          />
        )
      }
    >
      <span
        // biome-ignore lint/a11y/noNoninteractiveTabindex: focus opens the card
        tabIndex={0}
        className="tw:cursor-help tw:border-0 tw:border-b tw:border-dotted tw:border-rule-strong tw:text-xs tw:font-medium tw:text-muted-foreground tw:focus-visible:outline-none tw:focus-visible:text-highlight-text"
      >
        Topics
      </span>
    </Tooltip>
  );
}

/**
 * **The row's place, held while the topics are asked for** (Greg's report
 * a4xsg3, 2026-09-30: *"let's show some kind of loading spinner in their place
 * while they're loading"*): the same label, the app's one spinner with its
 * words, and — when the article count makes topics possible — the collapsed
 * row's shape in faint outlines, wrapping with the real row's flex classes,
 * then its always-present detail control and, when possible, its conditional
 * All-topics control, drawn invisibly at their real width. So the cards below
 * land near where they will stay at any width (GPT Sol, plan 260930j: a
 * remembered pixel height was the alternative, and goes stale with the shelf,
 * the window and the zoom).
 *
 * Before the answer, article rows are only an upper bound on distinct works:
 * exact copies are one work on the server, but their `textHash` is not in the
 * library response. So `articleCount` decides only what the shelf *might*
 * draw. Fewer than MIN_WORKS rows is certainly one line; more rows may still
 * collapse after the answer if they are copies or no useful topics survive.
 */
export function ShelfTermsLoading({ articleCount }: { articleCount: number }) {
  const mightHaveTopics = articleCount >= MIN_WORKS;
  /* The chooser returns at most one topic per distinct work. More than twelve
     article rows is therefore necessary — though not sufficient — for the
     real row's conditional "All N topics" button. */
  const mightHaveAllTopics = articleCount > COLLAPSED_CHIPS;
  return (
    <div
      role="status"
      aria-label="Loading topics"
      className={`tw:mb-3 tw:min-h-7 ${TERMS_ROW}`}
    >
      <span className="tw:text-xs tw:font-medium tw:text-muted-foreground">Topics</span>
      <span className="tw:inline-flex tw:h-7 tw:items-center tw:gap-1.5 tw:px-1 tw:text-xs tw:text-muted-foreground">
        <LoaderCircle className="cmt-spinner" size={13} />
        Loading topics…
      </span>
      {mightHaveTopics && (
        <>
          {GHOST_PILL_REM.map((rem, i) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list that never reorders
              key={i}
              aria-hidden="true"
              data-ghost-pill
              className="tw:inline-block tw:h-7 tw:rounded-full tw:border tw:border-border tw:opacity-50"
              style={{ width: `${rem}rem` }}
            />
          ))}
          {mightHaveAllTopics && (
            <span aria-hidden="true" className={`${QUIET_BUTTON} tw:invisible`}>
              All 20 topics
              <ChevronRight size={12} />
            </span>
          )}
          <span aria-hidden="true" className={`${QUIET_BUTTON} tw:invisible`}>
            More detail
          </span>
        </>
      )}
    </div>
  );
}

export function ShelfTerms({
  data,
  counts,
  selected,
  onToggle,
  onClear,
  entryOf,
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
  /**
   * The shelf entry for a slug, or `undefined` for one not on the lists
   * loaded: its title for the chips' cards and the detail rows, and the whole
   * entry for the paper card on a detail row's links.
   */
  entryOf: (slug: string) => LibraryEntry | undefined;
  /** Every slug in scope, before search, Unread or topics: the tooltip's "of 38". */
  inScope: ReadonlySet<string>;
  /** Whether the archive is in scope, which the tooltip names. */
  archived: boolean;
}) {
  const [all, setAll] = useState(false);
  const [view, setView] = useQueryState("topicsView", libraryTopicsViewParam);
  const { terms, pending, scope } = data;
  /* Selection, search and the two views all rerender this component without
     changing the server answer. Keep the O(topics² × members + topics³)
     projection tied to that answer, while still calling the hook on the empty
     early-return path below. */
  const hues = useMemo(() => topicHueStops(terms), [terms]);
  /* Every topic each article is in, for its paper card: over **every** topic
     the server chose, not only those drawn, in rank order with the hue each
     already wears — so a card names the same topics however the view is
     narrowed (plan 261002f). */
  const topicsBySlug = useMemo(() => {
    const by = new Map<string, PaperTopic[]>();
    for (const t of terms) {
      const topic: PaperTopic = {
        key: t.key,
        label: t.label,
        slot: hues.get(t.key) ?? 0,
        ...(t.granularity !== undefined ? { voice: "ai" as const } : {}),
      };
      for (const a of t.articles) {
        const list = by.get(a.slug);
        if (list) list.push(topic);
        else by.set(a.slug, [topic]);
      }
    }
    return by;
  }, [terms, hues]);

  /* What the row is still waiting for. On the phrase row, the program's
     reading. On a model-named row that reading is not what the topics come
     from, so it is not mentioned; what matters there is the articles that
     arrived after the topics were last worked out and are missing from them
     until they are sorted in, which happens by itself (plan 261003f). */
  const sorting = data.sorting ?? 0;
  const reading = isModelNamed(terms) ? (
    sorting > 0 && (
      <span className="tw:text-xs tw:text-muted-foreground">
        Sorting {sorting} new {sorting === 1 ? "article" : "articles"} into topics…
      </span>
    )
  ) : (
    pending > 0 && (
      <span className="tw:text-xs tw:text-muted-foreground">
        Reading {pending} more {pending === 1 ? "article" : "articles"}…
      </span>
    )
  );

  if (terms.length === 0) {
    /* Said rather than left blank: an empty space where a feature was is a
       feature that looks broken. Only when the server has read everything, or
       "too few" could be a count of the articles read so far. */
    const tooFew = pending === 0 && scope.works < MIN_WORKS;
    if (!reading && !tooFew) return null;
    return (
      <div className="tw:mb-3 tw:flex tw:min-h-7 tw:flex-wrap tw:items-center tw:gap-x-2">
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
  /* A topic's colour comes from which articles it shares with the other
     topics, over every topic the server chose (not only those drawn), so it
     does not move as the view narrows. */
  const slotOf = (key: string) => hues.get(key) ?? 0;
  /* **The server's rank order**, never re-sorted (plan 260928d): the chooser
     ranks for coverage, so the first few chips are the few that reach most of
     the shelf. **Zeros go first, then the first twelve** (plan 260929a, Sol
     R5): a topic with nothing left to show is dropped unless chosen, and only
     then does the row take the first COLLAPSED_CHIPS, plus any chosen topic
     further down, in its place — or, with "All N topics", every one. Taking
     twelve and then dropping zeros would leave the row short with pills
     waiting beyond it. The colour is computed over every topic, above, so a chip
     keeps its dot when its neighbours come and go. */
  /* Then the finer topics inside a chosen one move up beside it
     (`withinChosenFirst`): the identity with nothing chosen, and for phrase
     topics. Before the first twelve, so the next step down is never beyond
     the fold. */
  const available = withinChosenFirst(availableTopics(terms, count, chosen), chosen);
  const byKey = new Map(terms.map((t) => [t.key, t]));
  const shown = all
    ? available
    : available.filter((t, i) => i < COLLAPSED_CHIPS || chosen.has(t.key));
  const tipScope: TermTipScope = {
    inScope,
    scopeWord: archived ? "on the shelf and in the archive" : "on the shelf",
    titleOf: (slug) => entryOf(slug)?.title,
    labelOf: (key) => byKey.get(key)?.label,
  };
  const papers: PaperScope = { entryOf, topicsOf: (slug) => topicsBySlug.get(slug) ?? [] };

  /* Every child of this row keeps its position in both views — a view's
     absent parts are `false`, not missing — so React keeps the one toggle
     button mounted across the switch and focus stays on it. */
  return (
    <div className="tw:mb-3">
      <div className={TERMS_ROW}>
        <TopicsLabel modelNamed={isModelNamed(terms)} />
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
          depthOf={(key) => {
            const t = byKey.get(key);
            return t ? topicDepth(t, byKey) : 0;
          }}
          count={count}
          chosen={chosen}
          onToggle={onToggle}
          scope={tipScope}
          papers={papers}
        />
      )}
    </div>
  );
}
