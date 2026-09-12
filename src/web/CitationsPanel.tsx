/**
 * Every work the piece cites, in the band between the spine and the prose.
 *
 * Asked for through the Feedback button, 2026-09-11 (SPIDERYARN-READING2-2Y):
 *
 * > Add a Citations mode that looks at citations and looks at the bibliography
 * > and references and provides, you know, a link to all of them. And you can
 * > either order them by when they appear in the text, or how relevant they
 * > are, or how influential, or a prioritized score. (the default, with
 * > threshold bar, kinda like Glossary etc)
 *
 * So this is the glossary's list with the glossary's two controls — the order
 * buttons and the threshold bar, `hiddenNote` under it — over a different row.
 * docs/project/citations.md; the design is docs/plans/260911g-citations-mode.md.
 *
 * ## The row says where its link came from, always
 *
 * **Every address a row presents as the work's own was in the article** — a
 * DOI or arXiv id in its text or hrefs, or one of its own anchors — and code
 * found it, not the model (src/citations.ts § linkFor). Where the article gave
 * none, the row offers a **Google Scholar search** instead, and it is drawn as
 * a search: the title is not a link, and the only link is labelled *search
 * Scholar*. A reader can always tell a link the article gave from one we built,
 * which is the glossary's provenance rule applied to URLs. `sourceOf` below is
 * total over `CitationLinkFrom`, so a sixth rule is a compile error here.
 *
 * ## Only the two raw numbers are drawn
 *
 * the two raw scores on each row (as `ScoreBars`), never the combined `(2r + i) / 3` the bar
 * thresholds on — as the glossary draws its two scores and never their product
 * (GlossaryPanel.tsx § rowScores). The combination is our arithmetic, not the
 * model's judgment. The foot line says what `influence` is: the model's memory,
 * not a citation count.
 */
import { ScoreBars } from "./ScoreBars.js";
import { BookText, ExternalLink, RotateCcw, Search, TriangleAlert } from "lucide-react";
import { MAX_CITATIONS, type BlockId, type CitedWork } from "../types.js";
import type { CiteOrder } from "./params.js";
import type { FindNote, UseCitations } from "./useCitations.js";
import { BlockRef } from "./BlockRef.js";
import { floorToGateStep, GATE_STEP } from "./GlossaryPanel.js";
import { JobProgress } from "./JobProgress.js";
import { ModeSurface } from "./ModeSurface.js";
import { useRenderCount } from "./perf.js";
import { applyThreshold, hiddenNote, type ThresholdResult } from "./threshold.js";

/* ------------------------------------------------------------- the scores -- */

/**
 * The bar's **starting** position on `(2 × relevance + influence) / 3`.
 *
 * Measured, not chosen: on stage 1's real runs the median was 0.37 on both long
 * articles and 0.48 on the blog post, so 0.40 shows about half of a long list
 * (23 of 57, 39 of 80) and 6 of 8 on the short one. `?citebar=` overrides it.
 * docs/plans/260911g-citations-mode.md § Progress.
 */
export const CITATION_BAR_DEFAULT = 0.4;

/**
 * What the bar thresholds on: two parts relevance to one part influence, **both
 * required** — a work missing either is unscored, and an unscored work survives
 * every position of the bar (src/web/threshold.ts § survivesThreshold).
 *
 * Not the glossary's product (Sol F9): there both dimensions are necessary, and
 * here influence is not — an obscure work the piece is built on is exactly what
 * the list should keep. Weighted to relevance so a famous but passing reference
 * does not ride its fame over the bar.
 */
export function priorityOf(work: CitedWork): number | undefined {
  if (work.relevance === undefined || work.influence === undefined) return undefined;
  return (2 * work.relevance + work.influence) / 3;
}

/** The bar applied once: the works to draw, and how many went. threshold.ts. */
export function visibleWorks(works: readonly CitedWork[], bar: number): ThresholdResult<CitedWork> {
  return applyThreshold(works, bar, priorityOf);
}

/**
 * The highest position the bar needs, on the glossary's hundredth grid — the
 * same `floorToGateStep`, so the thumb's top stop always shows the top work.
 */
export function barTop(works: readonly CitedWork[]): number {
  let top = 0;
  for (const work of works) {
    const p = priorityOf(work);
    if (p !== undefined && p > top) top = p;
  }
  return floorToGateStep(top);
}

/** The track's maximum: the data's top, the current bar, and one step at least. */
export function barMax(works: readonly CitedWork[], bar: number): number {
  return Math.max(barTop(works), bar, GATE_STEP);
}

/**
 * Can this list be prioritised **at all** — would some position of the bar hide
 * something? `GlossaryPanel.canPrioritise`, over this list's score. A question
 * about the whole list, not about where the bar is now.
 */
export function canPrioritise(works: readonly CitedWork[]): boolean {
  const top = barTop(works);
  for (const work of works) {
    const p = priorityOf(work);
    if (p !== undefined && p < top) return true;
  }
  return false;
}

/**
 * The order actually in force: `prioritised` falls back to first-cited when
 * there is nothing to bar, so the default never labels an order that is not
 * one. `GlossaryPanel.effectiveSort`.
 */
export function effectiveOrder(works: readonly CitedWork[], order: CiteOrder): CiteOrder {
  if (order !== "prioritised") return order;
  return canPrioritise(works) ? "prioritised" : "document";
}

/**
 * The list in one flat order. `document` is the artefact's own first-cited
 * order; `prioritised` is that order with what is below the bar taken out; the
 * two score orders are descending, unscored last, and first-cited order breaks
 * ties so equal scores do not shuffle.
 */
export function orderWorks(
  works: readonly CitedWork[],
  order: CiteOrder,
  bar: number = CITATION_BAR_DEFAULT,
): CitedWork[] {
  switch (order) {
    case "document":
      return [...works];
    case "prioritised":
      return visibleWorks(works, bar).visible;
    case "relevance":
    case "influence": {
      const score = (w: CitedWork) => (order === "relevance" ? w.relevance : w.influence);
      return works
        .map((work, index) => ({ work, index }))
        .sort((a, b) => {
          const sa = score(a.work);
          const sb = score(b.work);
          if (sa === undefined && sb === undefined) return a.index - b.index;
          if (sa === undefined) return 1;
          if (sb === undefined) return -1;
          return sb - sa || a.index - b.index;
        })
        .map(({ work }) => work);
    }
    default: {
      const unhandled: never = order;
      return unhandled;
    }
  }
}

/** The foot line under the bar. threshold.ts § hiddenNote. */
export function citationsNote(hidden: number, total: number): string {
  return hiddenNote(hidden, total, { one: "citation", many: "citations" });
}

/**
 * Whichever of the two raw scores the work has, for `ScoreBars` — **drawn, not
 * printed**, as the Glossary and Quotes rows are since 2026-08-31. Greg: *"Prefer
 * to use UI (e.g. a little sparkline/bar rather than numbers) plus tooltip
 * instead of numbers ... Same goes for Glossary etc."* The numbers are in the
 * tooltip and the bars' `aria-label`; never the combined `(2r + i) / 3`.
 */
export function scoresOf(work: CitedWork): { key: string; label: string; value: number }[] {
  const out: { key: string; label: string; value: number }[] = [];
  if (work.relevance !== undefined) {
    out.push({ key: "relevance", label: "relevance to this piece", value: work.relevance });
  }
  if (work.influence !== undefined) {
    out.push({ key: "influence", label: "influence in its field (the model's memory)", value: work.influence });
  }
  return out;
}

/* ------------------------------------------------------------- the source -- */

/**
 * Where a row's link came from, as the row says it.
 *
 * - `address` — the work's own address, which the article gave: the title is
 *   the link, and the row names the host and the rule.
 * - `search` — a Scholar search we built because the article gave none. The
 *   title is **not** a link; the only link is labelled as a search.
 */
export type Source =
  | { kind: "address"; url: string; host: string; how: string }
  | { kind: "search"; url: string };

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function sourceOf(work: CitedWork): Source {
  switch (work.linkFrom) {
    case "doi":
      return { kind: "address", url: work.url, host: hostOf(work.url), how: "DOI in the article" };
    case "arxiv":
      return { kind: "address", url: work.url, host: hostOf(work.url), how: "arXiv id in the article" };
    case "article":
      return { kind: "address", url: work.url, host: hostOf(work.url), how: "linked in the article" };
    /* Stage 3, *Find it on the web* — a search result code checked names the
       work (src/citation-find.ts), attached at read time. Drawn as found
       rather than given, because it was. */
    case "web":
      return { kind: "address", url: work.url, host: hostOf(work.url), how: "found on the web" };
    case "search":
      return { kind: "search", url: work.url };
    default: {
      const unhandled: never = work.linkFrom;
      return unhandled;
    }
  }
}

/* --------------------------------------------------------------- the copy -- */

/**
 * Drawn **only when the model said it left works out** (`Citations.capped`) —
 * never inferred from the list being 80 long, and "we judged" rather than a
 * claim that the ranking is a fact. docs/plans/260911g-citations-mode.md § Long
 * bibliographies.
 */
export const CAPPED_NOTE = `This piece cites more than ${MAX_CITATIONS} works; these are the ${MAX_CITATIONS} we judged it leans on most.`;

/** Under every non-empty list: the weaker of the two scores, said plainly. */
export const INFLUENCE_NOTE =
  "Influence is the model's own memory of how much a work mattered in its field, not a citation count.";

/**
 * **A piece that cites nothing is a real answer**, not an error, and no retry is
 * offered beside it: running it again would find the same nothing and cost
 * another model call. The timeline's `TIMELINE_NO_CHRONOLOGY` rule.
 */
export const CITATIONS_NONE = "We found no works this piece cites.";

/* -------------------------------------------------------------- the panel -- */

/** A module constant, so an empty list is the same array every render. */
const NO_WORKS: CitedWork[] = [];

interface Props {
  owner: UseCitations;
  /** `?citeby=` — the order the reader asked for. `effectiveOrder` decides the one in force. */
  order: CiteOrder;
  onOrder(order: CiteOrder): void;
  /** `?citebar=`, or null for "nobody has touched it" — `CITATION_BAR_DEFAULT`. */
  bar: number | null;
  onBar(bar: number | null): void;
  onJump(id: BlockId): void;
}

export function CitationsPanel({ owner, order: chosenOrder, onOrder, bar: chosenBar, onBar, onJump }: Props) {
  useRenderCount("CitationsPanel");
  const citations = owner.citations;
  const all = citations?.citations ?? NO_WORKS;
  const bar = chosenBar ?? CITATION_BAR_DEFAULT;
  /* One answer for the order in force, passed down, so the list, the pressed
     button and the slider's presence cannot disagree. */
  const order = effectiveOrder(all, chosenOrder);
  const shown = orderWorks(all, order, bar);
  const ready = citations !== null && owner.status === "ready";

  const run = (label: string, again = false) => (
    <JobProgress
      job={owner.job}
      starting={owner.starting}
      failed={owner.failed}
      stalled={owner.stalled}
      onRun={() => (again ? owner.regenerate() : owner.ensure())}
      onCancel={owner.cancel}
      label={label}
      step="citations"
      icon={<BookText size={13} />}
      runningLabel="Reading…"
    />
  );

  return (
    <ModeSurface
      label="Citations"
      feature="gloss citations"
      /* A fragment, so the row stays put while the list loads — the choice
         Timeline and Glossary make, for the count that is its only child. */
      head={
        <>
          {citations && (
            <span className="gloss-count">
              {all.length} {all.length === 1 ? "work" : "works"}
            </span>
          )}
        </>
      }
      /* Pinned under the scroller: the two sentences about the whole list.
         **No re-run here.** The first draft had *Find them again* in this foot,
         and the browser check found it the largest control in the band and the
         one press that costs money, under a list that was fine. Greg took the
         same button out of the Glossary (*Start again*, 2026-09-05: "confusing
         and unnecessary") and out of Quotes (*Choose them again*, 2026-09-11).
         A list that is stale or outdated still offers it, in the banner above,
         which is the case where asking again buys something. */
      foot={
        ready && all.length > 0 ? (
          <div className="cite-foot">
            {citations.capped && <p className="cite-note">{CAPPED_NOTE}</p>}
            <p className="cite-note">{INFLUENCE_NOTE}</p>
          </div>
        ) : null
      }
    >
      {citations && all.length > 1 && <OrderBar works={all} order={order} onOrder={onOrder} />}

      {/* Only in the order it belongs to: a number that means nothing in the
          other three would be furniture. */}
      {citations && order === "prioritised" && (
        <BarSlider works={all} bar={bar} moved={chosenBar !== null} onBar={onBar} />
      )}

      {owner.error && <p className="gloss-error">{owner.error}</p>}

      {owner.status === "loading" && <p className="gloss-quiet">Looking for the citations…</p>}

      {owner.status === "none" && (
        <div className="gloss-empty">
          <p>Nobody has listed the works this piece cites yet.</p>
          <p className="gloss-hint">
            One model pass over the whole article — under a minute for a short piece, two or three on a long one.
            Found once and kept — you will not be asked again unless the article changes.
          </p>
          {run("Find the citations")}
        </div>
      )}

      {ready && (
        <>
          {/* Stale wins when both are true: it is the one that can make a
              "first cited" jump land somewhere else. */}
          {owner.stale ? (
            <div className="gloss-stale">
              <p>
                <TriangleAlert size={13} />
                This describes an older version of the article.
              </p>
              {run("Find them again", true)}
            </div>
          ) : owner.outdated ? (
            <div className="gloss-stale">
              <p>
                <TriangleAlert size={13} />
                This was found by an older version of the prompt.
              </p>
              {run("Find them again", true)}
            </div>
          ) : null}

          {all.length === 0 && <p className="gloss-quiet">{CITATIONS_NONE}</p>}

          {all.length > 0 && (
            <div className="tl-scroll">
              <ol className="tl-list cite-list">
                {shown.map((work) => (
                  <WorkRow
                    key={work.id}
                    work={work}
                    unscored={order === "prioritised" && priorityOf(work) === undefined}
                    onJump={onJump}
                    finding={owner.finding}
                    note={owner.findNote?.id === work.id ? owner.findNote : null}
                    onFind={owner.find}
                  />
                ))}
              </ol>
            </div>
          )}
        </>
      )}
    </ModeSurface>
  );
}

/* --------------------------------------------------------------- controls -- */

function OrderBar({
  works,
  order,
  onOrder,
}: {
  works: readonly CitedWork[];
  order: CiteOrder;
  onOrder(order: CiteOrder): void;
}) {
  /* Each option only once the list can honour it — a control that would
     visibly do nothing is worse than one that is not there. GlossaryPanel.tsx
     § SortBar. */
  const options: { key: CiteOrder; label: string; title: string }[] = [
    ...(canPrioritise(works)
      ? [
          {
            key: "prioritised" as const,
            label: "prioritised",
            title:
              "Only the works the piece leans on most, in the order it first cites them — the threshold below decides how many",
          },
        ]
      : []),
    { key: "document", label: "first cited", title: "In the order the piece first cites them" },
    ...(works.some((w) => w.relevance !== undefined)
      ? [
          {
            key: "relevance" as const,
            label: "relevance",
            title: "The model's judgment of how much this piece's argument leans on each work",
          },
        ]
      : []),
    ...(works.some((w) => w.influence !== undefined)
      ? [
          {
            key: "influence" as const,
            label: "influence",
            title: "The model's memory of how influential each work is in its field — not a citation count",
          },
        ]
      : []),
  ];
  if (options.length < 2) return null;

  return (
    /* biome-ignore lint/a11y/useSemanticElements: toggle buttons that order a
       list, not form controls — GlossaryPanel.tsx § SortBar says why. */
    <div className="gloss-sort" role="group" aria-label="Order the citations by">
      <span className="gloss-sort-label">order</span>
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          className={`gloss-sort-btn${order === option.key ? " on" : ""}`}
          aria-pressed={order === option.key}
          title={option.title}
          onClick={() => onOrder(option.key)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function BarSlider({
  works,
  bar,
  moved,
  onBar,
}: {
  works: readonly CitedWork[];
  bar: number;
  moved: boolean;
  onBar(bar: number | null): void;
}) {
  /* One pass, and every number here comes out of it — threshold.ts. */
  const { visible, hiddenCount } = visibleWorks(works, bar);
  const count = `${visible.length} of ${works.length}`;

  return (
    <div className="gloss-gate">
      <div className="gloss-gate-row">
        <label className="gloss-gate-label" htmlFor="cite-bar">
          threshold
        </label>
        <span className="gloss-gate-value">
          {bar.toFixed(2)} · {count}
        </span>
        {moved && (
          <button
            type="button"
            className="gloss-gate-reset"
            title={`Back to ${CITATION_BAR_DEFAULT.toFixed(2)}`}
            aria-label={`Reset the threshold to ${CITATION_BAR_DEFAULT.toFixed(2)}`}
            onClick={() => onBar(null)}
          >
            <RotateCcw size={11} />
          </button>
        )}
      </div>
      <input
        id="cite-bar"
        className="gloss-gate-range"
        type="range"
        min={0}
        max={barMax(works, bar)}
        step={GATE_STEP}
        value={bar}
        title="How high a work has to score to stay on screen: two parts relevance to one part influence. Left shows more works, right fewer."
        aria-valuetext={`${bar.toFixed(2)}, showing ${count} citations`}
        onChange={(e) => onBar(Number.parseFloat(e.target.value))}
      />
      {/* Always, wherever the slider is: threshold.ts § hiddenNote. */}
      <p className="gloss-gate-note">{citationsNote(hiddenCount, works.length)}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ a row -- */

function WorkRow({
  work,
  unscored,
  onJump,
  finding,
  note,
  onFind,
}: {
  work: CitedWork;
  unscored: boolean;
  onJump(id: BlockId): void;
  /** The work whose *Find it* is running anywhere in the list, or null. */
  finding: string | null;
  /** What this row's last *Find it* said, when it found nothing or failed. */
  note: FindNote | null;
  onFind(id: string): Promise<void>;
}) {
  const source = sourceOf(work);
  const scores = scoresOf(work);
  const by = [work.authors, work.year].filter(Boolean).join(" · ");
  /* The found page's own title, in the tooltip: the search result's words,
     never the model's (src/citation-find.ts). */
  const foundAs = work.found?.title ? ` — “${work.found.title}”` : "";

  return (
    <li
      className="tl-item cite-item"
      data-citation-id={work.id}
      {...(unscored && { title: "Not scored for prioritising — shown regardless of the threshold" })}
    >
      <p className="cite-title">
        {source.kind === "address" ? (
          /* Every link that leaves the app opens a new tab — docs/project/links.md
             — and `noreferrer noopener`, as everything outbound here is. */
          <a
            href={source.url}
            target="_blank"
            rel="noreferrer noopener"
            title={`${source.how}${foundAs} — opens ${source.host} in a new tab`}
          >
            {work.title}
            <ExternalLink size={11} aria-hidden="true" className="cite-out" />
          </a>
        ) : (
          work.title
        )}
      </p>
      {by && <p className="cite-by">{by}</p>}
      <p className="cite-why">{work.why}</p>
      <p className="cite-meta">
        {scores.length > 0 && <ScoreBars className="cite-scores" scores={scores} />}
        {source.kind === "address" ? (
          <span className="cite-source">
            {source.host} · {source.how}
          </span>
        ) : (
          <a
            className="cite-source cite-search"
            href={source.url}
            target="_blank"
            rel="noreferrer noopener"
            title="The article gives no link for this work, so this is a Google Scholar search for its title — not a link the article gave"
          >
            search Scholar ↗
          </a>
        )}
        {/* Stage 3, on a searched row only. Disabled while any row's find
            runs, not just this one — each is a paid search, and a list that
            fires five because five were clicked spends money on a mis-click
            (GlossaryPanel.tsx § Check the web makes the same call). */}
        {source.kind === "search" && (
          <button
            type="button"
            className="gloss-btn cite-find"
            disabled={finding !== null}
            title="Searches the web for this work, and keeps a page only if a search result is plainly its own. A few seconds; kept afterwards."
            onClick={() => void onFind(work.id)}
          >
            <Search size={11} aria-hidden="true" />
            {finding === work.id ? "Looking…" : "Find it"}
          </button>
        )}
        <span className="cite-first">
          {work.citedInBody ? "first cited" : "only in the references"}{" "}
          <BlockRef id={work.firstCited} onJump={onJump} />
        </span>
      </p>
      {note && (
        <p className={`cite-find-note${note.kind === "failed" ? " failed" : ""}`} role="status">
          {note.message}
        </p>
      )}
    </li>
  );
}
