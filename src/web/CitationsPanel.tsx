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
import { type ReactNode, useEffect, useRef } from "react";
import { useTapReveal } from "./useTapReveal.js";
import { ScoreBars } from "./ScoreBars.js";
import { OrderGroup } from "./OrderGroup.js";
import { BookOpen, BookText, ExternalLink, TriangleAlert } from "lucide-react";
import {
  MAX_CITATIONS,
  type BlockId,
  type CitationLookup,
  type CitationPlace,
  type CitationSupport,
  type CitedInSpideryarn,
  type CitedMatchedBy,
  type CitedWork,
  type InvestigateStage,
  type RegistrySource,
} from "../types.js";
import { readCitationRegistry, REGISTRY_NAME, registryAuthorsText } from "../registry-work.js";
import { effectiveInfluence, type EffectiveInfluence } from "../citation-effective-influence.js";
import { Link } from "./Link.js";
import { readHref } from "./router.js";
import type { PublicCitations, PublicCitedWork } from "../public-types.js";
import type { CiteOrder } from "./params.js";
import type { FindNote, UseCitations } from "./useCitations.js";
import { AboutMade } from "./BandAbout.js";
import { BlockRef } from "./BlockRef.js";
import { Tooltip } from "./Tooltip.js";
import { citePassageKey } from "./rows.js";
import {
  InvestigateButton,
  type InvestigateFailureHere,
  InvestigationBlock,
  investigationViewOf,
  type InvestigationView,
} from "./CitationInvestigation.js";
import { JobProgress } from "./JobProgress.js";
import { ModeSurface } from "./ModeSurface.js";
import { ReadError } from "./ReadError.js";
import { useRenderCount } from "./perf.js";
import {
  survivesThreshold,
  floorToGateStep,
  applyThreshold,
  canThreshold,
  hiddenNote,
  thresholdMax,
  thresholdTop,
  type ThresholdResult,
} from "./threshold.js";
import { ThresholdSlider } from "./ThresholdSlider.js";

/**
 * **A row as this panel draws it** — the owner's `CitedWork` and a visitor's
 * `PublicCitedWork` alike. The visitor's has no `key` (never drawn), no `found`
 * (the owner's *Find it*, private), and a `url` that may be absent because the
 * public boundary refused it (src/public/dto.ts § `publicCitedWork`). Every
 * `CitedWork` is one of these, so the owner's path is unchanged. Since
 * 2026-09-29, plan 260929c stage 3.
 */
export type ShownWork = Omit<PublicCitedWork, "linkFrom" | "registry"> & {
  /** The owner may have a private Find-it row; a public row cannot. */
  linkFrom: CitedWork["linkFrom"];
  found?: CitedWork["found"];
  /** The owner's *Look it up* reading (plan 260929g). A public row cannot carry one. */
  lookup?: CitedWork["lookup"];
  /** The owner's kept *Investigate* answer (plan 260930a). A public row cannot carry one. */
  investigation?: CitedWork["investigation"];
  /** Already an article here, the reader's or a public one (plan 260930b). A public row cannot carry one. */
  inSpideryarn?: CitedWork["inSpideryarn"];
  /** The work's entry as the article gives it (plan 260930i); public only when it is its reference block's text. */
  entry?: CitedWork["entry"];
  /**
   * The registry's record (plan 261001a stage 5). A visitor's row carries only
   * a `found` one; the owner's may say `conflict`. Read through `workByLine`.
   */
  registry?: CitedWork["registry"];
};

/* ------------------------------------------------------------- the scores -- */

/**
 * The bar's **starting** position on `priorityOf` (relevance alone if influence is unknown).
 *
 * **`0.25`, lowered from `0.40` on 2026-09-15**, at Greg's request that every
 * prioritised bar let most entries in by default. `0.40` was set from stage 1's
 * runs to show about half of a long list (docs/plans/260911g-citations-mode.md
 * § Progress); across the four local citation lists it showed 46% on average,
 * and `0.25` shows 92% (90% on the median list) while still holding the weakest
 * tail back. `?citebar=` overrides it.
 * docs/plans/260915d-prioritised-by-default-in-search-and-lower-default-thresholds-everywhere.md.
 */
export const CITATION_BAR_DEFAULT = 0.25;

/* `priorityOf`, below, is what the bar thresholds on. */

/**
 * **The verified place a row's *first cited* names** — a mention in the
 * `firstCited` block, else the reference when that is where it points (a
 * bibliography-only work). `null` when neither is: a work reached through a
 * footnote's marker, whose paragraph holds a number and no quote of ours. Its
 * `quote` is the article's own characters (src/citations.ts § `verifyPlace`),
 * and `citeMarks` re-finds it at render time — nothing here reads `start`.
 */
export function citingPlaceOf(
  work: Pick<ShownWork, "firstCited" | "mentions" | "reference">,
): CitationPlace | null {
  const mention = work.mentions.find((m) => m.blockId === work.firstCited);
  if (mention) return mention;
  return work.reference?.blockId === work.firstCited ? work.reference : null;
}

/** How long a row lets the citing words run before it shortens them. */
export const CITING_WORDS_MAX = 60;

/**
 * **The citing words, short enough for a row.** A quote is up to 120
 * characters; the marker is what matters, so a quote ending in one — `…TV
 * episodes [8]`, `…as argued (Tulving 1983)` — keeps its end, and any other
 * keeps its start. Cut at a word boundary where there is one.
 */
export function citingWordsOf(quote: string): string {
  const q = quote.replace(/\s+/g, " ").trim();
  if (q.length <= CITING_WORDS_MAX) return q;
  if (/[\])]$/.test(q)) {
    const tail = q.slice(q.length - CITING_WORDS_MAX);
    const space = tail.indexOf(" ");
    return `…${space > 0 && space < CITING_WORDS_MAX / 2 ? tail.slice(space + 1) : tail}`;
  }
  const head = q.slice(0, CITING_WORDS_MAX);
  const space = head.lastIndexOf(" ");
  return `${space > CITING_WORDS_MAX / 2 ? head.slice(0, space) : head}…`;
}

/** More names than this, and a row shows the first and *et al.* */
export const AUTHORS_SHOWN = 2;

/**
 * **Authors short enough for a row** (SPIDERYARN-READING2-6K: *"even if in
 * somewhat truncated form"*): two names or fewer as the article gives them,
 * more as *First et al.* — and a list that already ends *et al.* keeps only its
 * first name. The whole list is in the by-line's tooltip.
 */
export function shortAuthors(authors: string): string {
  const etAl = /\bet al\.?\s*$/i.test(authors);
  const names = authors
    .replace(/\bet al\.?\s*$/i, "")
    .split(/\s*(?:;|,|\s&\s|\band\b)\s*/)
    .map((n) => n.trim())
    .filter(Boolean);
  if (names.length === 0) return authors;
  if (etAl || names.length > AUTHORS_SHOWN) return `${names[0]} et al.`;
  return authors;
}

/**
 * **The authors and year a row draws, and where each came from** (plan
 * 261001a stage 5). The article's own, always, where it gives them; the
 * registry's only in a field the article leaves empty, and then `filled` names
 * the registry so the row can say so. `conflict` when the registry holds a
 * different title under the article's identifier — then nothing of its is drawn.
 */
export interface WorkByLine {
  authors?: string;
  year?: string;
  filled: { source: RegistrySource; fields: ("authors" | "year")[] } | null;
  conflict: RegistrySource | null;
}

export function workByLine(work: Pick<ShownWork, "authors" | "year" | "registry">): WorkByLine {
  const registry = readCitationRegistry(work.registry);
  if (registry?.kind !== "found") {
    return {
      ...(work.authors ? { authors: work.authors } : {}),
      ...(work.year ? { year: work.year } : {}),
      filled: null,
      conflict: registry?.kind === "conflict" ? registry.source : null,
    };
  }
  const fields: ("authors" | "year")[] = [];
  let authors = work.authors || undefined;
  if (!authors) {
    const fromRegistry = registryAuthorsText(registry);
    if (fromRegistry) {
      authors = fromRegistry;
      fields.push("authors");
    }
  }
  let year = work.year || undefined;
  if (!year && registry.year !== undefined) {
    year = String(registry.year);
    fields.push("year");
  }
  return {
    ...(authors ? { authors } : {}),
    ...(year ? { year } : {}),
    filled: fields.length > 0 ? { source: registry.source, fields } : null,
    conflict: null,
  };
}

/** `Chen et al. · 2017`, or empty when neither the article nor the registry gives either. */
export function byLineOf(work: Pick<ShownWork, "authors" | "year" | "registry">): string {
  const line = workByLine(work);
  return [line.authors ? shortAuthors(line.authors) : undefined, line.year].filter(Boolean).join(" · ");
}

/**
 * **Does the by-line only say the title again?** When the article gives a work
 * only as an author–year label (`Bartlett (1932)`, gwern's `Santoro et al
 * 2016`), that label is the row's title, and `authors · year` under it is the
 * same words with other punctuation — SPIDERYARN-READING2-7W, plan 261001m.
 * Folded only of the differences a label and a by-line are known to have: case
 * and accents, brackets round the year, the middle dot, a comma before the
 * year, `&` for `and`, and the stop in `et al.`. Hyphens, apostrophes and the
 * commas between names stay, so `Smith-Jones (2001)` is not `Smith, Jones ·
 * 2001` (Sol, plan review). Anything else is "different" and both lines show —
 * the safe side, since a hidden line that said something new is a loss and a
 * repeated one is only clutter.
 */
export function byLineRepeatsTitle(title: string, by: string): boolean {
  const words = (s: string) =>
    s
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/[()·]/g, " ")
      .replace(/&/g, " and ")
      .replace(/\bet al\./g, "et al")
      .replace(/,(?=\s*\d{4}[a-z]?\s*$)/, "")
      .split(/\s+/)
      .filter(Boolean)
      .join(" ");
  const said = words(by);
  return said !== "" && said === words(title);
}

/** What a by-line the registry filled in says about it: *Authors and year from Crossref …* */
export function registryFilledNote(filled: NonNullable<WorkByLine["filled"]>): string {
  const what = filled.fields.length === 2 ? "Authors and year" : filled.fields[0] === "authors" ? "Authors" : "Year";
  return `${what} from ${REGISTRY_NAME[filled.source]}, under the identifier the article links — the article does not give ${filled.fields.length === 2 ? "them" : "it"}.`;
}

/** The short visible mark beside a filled-in by-line. */
export function registryFilledMark(filled: NonNullable<WorkByLine["filled"]>): string {
  return `from ${REGISTRY_NAME[filled.source]}`;
}

/** What a row says when the registry's title disagrees with the article's. */
export function registryConflictNote(source: RegistrySource): string {
  return `The article's identifier points, at ${REGISTRY_NAME[source]}, to a work with a different title — the link may not be this work.`;
}

/** Said under an entry wherever it is shown — a row's tooltip and the prose card. */
export const CITE_ENTRY_NOTE =
  "The entry in the article's own reference list, copied from the article, not from the work.";

/**
 * The citing words in quotation marks — unless they already are in them, as a
 * cited title often is (`“Scaling Hypothesis Revisited”`), which would come out
 * doubled. Found in the browser check (plan 260930i).
 */
export function quotedCitingWords(quote: string): string {
  const words = citingWordsOf(quote);
  return /^…?["“‘']/.test(words) && /["”’']$/.test(words) ? words : `“${words}”`;
}

/**
 * **The one place this panel reads a work's influence**: the bar, the two
 * orders, the row's bars and whether the influence order is offered all go
 * through it. It is `effectiveInfluence` (src/citation-effective-influence.ts,
 * plan 261003m stage 2), the read path chat shares: the number a kept *Dig
 * deeper* answer read from the web when there is a current one, else the
 * list's own, else nothing — the model said it does not know the work
 * (`citations/6`) or left no usable score.
 */
function influenceOf(work: ShownWork): number | undefined {
  return effectiveInfluence(work)?.value;
}

/** The web influence on this row and where it came from, or `undefined` when the influence is the list's or unknown. */
function webInfluenceOf(work: ShownWork): Extract<EffectiveInfluence, { from: "web" }> | undefined {
  const influence = effectiveInfluence(work);
  return influence?.from === "web" ? influence : undefined;
}

/**
 * What the bar thresholds on (src/web/threshold.ts § survivesThreshold):
 *
 * - **no relevance**: nothing, so the work survives every position of the bar;
 * - **relevance, influence unknown**: the relevance alone;
 * - **both**: two parts relevance to one part influence, `(2r + i) / 3`.
 *
 * Not the glossary's product (Sol F9): there both dimensions are necessary, and
 * here influence is not — an obscure work the piece is built on is exactly what
 * the list should keep. Weighted to relevance so a famous but passing reference
 * does not ride its fame over the bar.
 *
 * **Relevance alone is not neutral, and that is accepted** (plan 261003m, GPT
 * Sol's F8): returning `r` is the same arithmetic as `(2r + i) / 3` with
 * `i = r`, so an unknown work is treated as exactly as influential as it is
 * relevant. At relevance 0.30 it clears the default 0.25 bar, while a work known
 * to be minor (influence 0.10) scores 0.23 and does not. Not knowing a work is
 * not evidence against it. Before `citations/6` a work missing its influence
 * was unscored and always shown; with unknown now common, that would stop the
 * bar hiding anything.
 */
export function priorityOf(work: ShownWork): number | undefined {
  if (work.relevance === undefined) return undefined;
  const influence = influenceOf(work);
  if (influence === undefined) return work.relevance;
  return (2 * work.relevance + influence) / 3;
}

/** The bar applied once: the works to draw, and how many went. threshold.ts. */
export function visibleWorks<W extends ShownWork>(works: readonly W[], bar: number): ThresholdResult<W> {
  return applyThreshold(works, bar, priorityOf);
}

/**
 * The highest position the bar needs, on the shared hundredth grid —
 * `thresholdTop` in threshold.ts, so the thumb's top stop always shows the top work.
 */
export function barTop(works: readonly ShownWork[]): number {
  return thresholdTop(works, priorityOf);
}

/** The track's maximum: the data's top, the current bar, and one step at least. */
export function barMax(works: readonly ShownWork[], bar: number): number {
  return thresholdMax(works, bar, priorityOf);
}

/**
 * Can this list be prioritised **at all** — would some position of the bar hide
 * something? `GlossaryPanel.canPrioritise`, over this list's score. A question
 * about the whole list, not about where the bar is now.
 */
export function canPrioritise(works: readonly ShownWork[]): boolean {
  return canThreshold(works, priorityOf);
}

/**
 * The order actually in force: `prioritised` falls back to first-cited when
 * there is nothing to bar, so the default never labels an order that is not
 * one. `GlossaryPanel.effectiveSort`.
 */
export function effectiveOrder(works: readonly ShownWork[], order: CiteOrder): CiteOrder {
  if (order === "date") return works.some((w) => publicationYear(w) !== null) ? "date" : "document";
  /* Each score order under the condition `orderOptions` offers it on: a saved
     `?citeby=relevance` on a list with no relevance must not reorder the rows
     while no button is pressed (GPT Sol's F14, the class of F10). */
  if (order === "relevance") return works.some((w) => w.relevance !== undefined) ? "relevance" : "document";
  if (order === "influence") return works.some((w) => influenceOf(w) !== undefined) ? "influence" : "document";
  if (order !== "prioritised") return order;
  return canPrioritise(works) ? "prioritised" : "document";
}

/**
 * **The year the date order sorts by: the one the row draws** — `workByLine`'s,
 * the article's own and the registry's only where the article gives none — so
 * the order cannot disagree with the by-line. The first four-digit year in it,
 * 1000–9999 as Debate's `readPublishedYear` (`2017a` is 2017, `2019–2020` is
 * 2019); none (`n.d.`, `in press`, a five-digit run) is undated.
 */
export function publicationYear(work: Pick<ShownWork, "authors" | "year" | "registry">): number | null {
  const year = workByLine(work).year?.match(/(?<!\d)[1-9]\d{3}(?!\d)/)?.[0];
  return year === undefined ? null : Number(year);
}

/** A sort comparison: higher first, a missing score after every present one, 0 on a tie. */
function descending(a: number | undefined, b: number | undefined): number {
  if (a === undefined && b === undefined) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  return b - a;
}

/**
 * **The bar that puts a hidden work back**, or null when nothing is hiding it —
 * `gateToReveal` (GlossaryPanel.tsx) over this list's score, for the same
 * press: the prose card's *Dig deeper* opens the band on a row, and a row the
 * prioritised order is hiding cannot be opened. **Lowered, never cleared**, so
 * the slider visibly moves; null in any other order, where the bar is dormant
 * and must not be moved behind the reader's back; and floored to the step, so
 * the value the URL prints is not above the work it was set to reveal. Plan
 * 261004b.
 */
export function barToReveal(
  works: readonly ShownWork[],
  id: string,
  order: CiteOrder,
  bar: number,
): number | null {
  if (effectiveOrder(works, order) !== "prioritised") return null;
  const work = works.find((w) => w.id === id);
  const p = work ? priorityOf(work) : undefined;
  if (p === undefined || survivesThreshold(p, bar)) return null;
  return floorToGateStep(p);
}

/**
 * The list in one flat order. `document` is the artefact's own first-cited
 * order; `prioritised` is that order with what is below the bar taken out; the
 * two score orders are descending, a work without that score last, and
 * first-cited order breaks ties so equal scores do not shuffle. **In the
 * influence order the unknown tail is itself ordered, by relevance descending**
 * (no relevance last): with unknown common since `citations/6`, a tail in
 * first-cited order would be most of the list in no order at all. `date` is
 * oldest first, undated last, as Debate's date order is (debate-order.ts), with
 * the same tie-break.
 */
export function orderWorks<W extends ShownWork>(
  works: readonly W[],
  order: CiteOrder,
  bar: number = CITATION_BAR_DEFAULT,
): W[] {
  switch (order) {
    case "document":
      return [...works];
    case "prioritised":
      return visibleWorks(works, bar).visible;
    case "relevance":
      return works
        .map((work, index) => ({ work, index }))
        .sort((a, b) => descending(a.work.relevance, b.work.relevance) || a.index - b.index)
        .map(({ work }) => work);
    case "influence":
      return works
        .map((work, index) => ({ work, index, influence: influenceOf(work) }))
        .sort(
          (a, b) =>
            descending(a.influence, b.influence) ||
            /* Reached only by two knowns that tie, where relevance is not
               asked, or by two unknowns, where it orders the tail. */
            (a.influence === undefined ? descending(a.work.relevance, b.work.relevance) : 0) ||
            a.index - b.index,
        )
        .map(({ work }) => work);
    case "date":
      return works
        .map((work, index) => ({ work, index, year: publicationYear(work) }))
        .sort((a, b) => {
          if (a.year === null && b.year === null) return a.index - b.index;
          if (a.year === null) return 1;
          if (b.year === null) return -1;
          return a.year - b.year || a.index - b.index;
        })
        .map(({ work }) => work);
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
export function scoresOf(work: ShownWork): { key: string; label: string; value: number }[] {
  const out: { key: string; label: string; value: number }[] = [];
  if (work.relevance !== undefined) {
    out.push({ key: "relevance", label: "relevance to this piece", value: work.relevance });
  }
  const influence = effectiveInfluence(work);
  if (influence !== undefined) {
    out.push({
      key: "influence",
      label: influence.from === "web" ? INFLUENCE_LABEL_WEB : INFLUENCE_LABEL_LIST,
      value: influence.value,
    });
  }
  return out;
}

/**
 * **Does the row say *influence unknown*?** When it has a relevance and no
 * influence. A row with neither score says nothing, as before: that is an
 * answer that lost both, not the model saying it does not know the work.
 */
export function influenceIsUnknown(work: ShownWork): boolean {
  return work.relevance !== undefined && influenceOf(work) === undefined;
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

export function sourceOf(work: Pick<CitedWork, "url" | "linkFrom">): Source {
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

/** What the influence bar measures, by where the number came from — the bar's tooltip and its spoken label. */
const INFLUENCE_LABEL_LIST = "influence in its field (the model's memory)";
const INFLUENCE_LABEL_WEB = "influence in its field (an AI estimate from web evidence)";

/** Under every non-empty list: the weaker of the two scores, said plainly. */
export const INFLUENCE_NOTE =
  "Influence is the model's own memory of how much a work mattered in its field, not a citation count. New lists give a score only when the model is confident it knows the work; older lists keep their scores. “influence unknown” means no usable influence score was saved. In prioritised order, a row with unknown influence is judged on its relevance alone when available.";

/**
 * The owner's (i) adds this after `INFLUENCE_NOTE` (plan 261003m stage 2). Not
 * a visitor's: they have no *Dig deeper*, and their rows never carry what it found.
 */
export const INFLUENCE_WEB_NOTE =
  "Dig deeper also looks for a work's influence on the web. A row marked “from the web” shows an AI estimate read from one page the search found, in place of the model's memory, and its card shows that page's words.";

/** Beside the influence bar when the number came from *Dig deeper*'s web search. */
const INFLUENCE_FROM_WEB = "from the web";

/** The card on those words: our sentence, with the host and the day in it. The page's own words follow, marked as the page's. */
function influenceFromWebNote(host: string, day: string): string {
  return `This influence is an AI estimate from web evidence, not a citation count: Dig deeper read it from a page on ${host} on ${day}. The estimate may be wrong, and the words may be about something else on that page. The page says:`;
}

/** The words on a row with no influence, in place of a bar. Never a bar at zero. */
export const INFLUENCE_UNKNOWN = "influence unknown";

/** The card on those words, as a visitor reads it: they have no *Dig deeper*. */
const INFLUENCE_UNKNOWN_NOTE_SHARED =
  "No usable influence score for this work: the model was not confident it knows it, or its score was missing. In prioritised order the bar goes by this row's relevance alone.";

/**
 * The card on those words, for the owner. It says only what is built: since
 * plan 261003m stage 2 *Dig deeper* looks for the work's standing on the pages
 * its web search returns. A look, not a promise: a press that finds no page
 * about the work saying how well known it is leaves the row unknown.
 */
export const INFLUENCE_UNKNOWN_NOTE = `${INFLUENCE_UNKNOWN_NOTE_SHARED} Dig deeper looks on the web for a page that says how well known the work is. Most searches find none.`;

/**
 * **A piece that cites nothing is a real answer**, not an error, and no retry is
 * offered beside it: running it again would find the same nothing and cost
 * another model call. The timeline's `TIMELINE_NO_CHRONOLOGY` rule.
 */
export const CITATIONS_NONE = "We found no works this piece cites.";

/* ------------------------------------------- what we have and have not read --
   Plan 260929g stage 1 (docs/plans/260929g-check-a-cited-paper-supports-the-claim.md).
   Greg, 2026-09-29: *"be really careful to be clear about whether you could get
   the actual paper, so that we can be sure you're not hallucinating"*.

   `why` is a sentence the model wrote **from the article**, about what the
   article uses the work for. Nothing here has read the work, and without saying
   so `why` reads as a description of it. So `why` carries a label, and every
   row says what we have not read. The band and the hover card (ProseHoverCard.tsx
   § CiteCard) both draw these strings, so the two surfaces cannot drift. */

/** The label on `why`, in the band and the hover card alike. */
export const CITE_WHY_LABEL = "what the article uses it for";

/* **`why` is drawn only beside something that was checked against it** — Greg,
   2026-10-03 (spya-zmdb7y, plan 261003j): *"err on the side of saying … nothing
   about a paper beyond what's available in the bibliography"*. The sentence can
   only restate the citing paragraph, and on a row nothing has looked up it
   still reads as what the paper says, label or no label. Once a quick check
   has a verdict (*supports what the article uses it for*) or *Dig deeper* has
   an answer, it is the claim under test, and the reader needs it to read
   either. Each surface asks about what IT draws: the card shows no *Dig
   deeper* answer, so it passes only the lookup. */
export function showsWhy(work: Pick<ShownWork, "lookup">, view?: InvestigationView): boolean {
  return assessedOf(work) !== null || view?.kind === "arriving" || view?.kind === "kept" ||
    (view?.kind === "failed" && view.previous !== null);
}

/** Every row, until something has read the work: nothing has. */
export const CITE_NOT_READ = "We have not read this work, only the article that cites it.";

/**
 * **After *Find it* kept a page.** What code checked is that a search result's
 * title or excerpt names the work (src/citation-find.ts § namesTitle), which a
 * review of the paper can pass too — so this says a page *matching its title*,
 * never that the page is the work, and still that we have not read it. The
 * plan's R-1.
 */
export const CITE_PAGE_FOUND = "We found a web page matching its title, but have not read the work itself.";

/* After *Look it up* (plan 260929g stage 2): one line per stored state, each
   saying what was read and from where. **Never "from the paper", never
   "verified", never "confirmed"** — what code checked is that a search result
   passed the identity rule and that each quote is in its extract, and a result
   passing that rule can still be somebody else's page about the work (R-1). */

/** `assessed`: an extract was read — the extract, not the work. */
export function citeReadAssessed(words: number, host: string): string {
  return `We have not read the work itself, only a search engine's extract of a page matching it (${words} ${words === 1 ? "word" : "words"}, from ${host}).`;
}
/** *Dig deeper* (was *Investigate*) read the paper's own text (plan 261001a): a PDF code confirmed is this work. */
export function citeReadPaper(words: number, host: string, readAt: string): string {
  const day = new Date(readAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  return `We read the paper itself on ${day}: a PDF from ${host}, ${words.toLocaleString("en-GB")} ${words === 1 ? "word" : "words"}, confirmed by code to be this work (Dig deeper).`;
}
/** `no-extract`: a page, and nothing of it to read. Never drawn as `not-in-extract`. */
export function citeReadNoExtract(host: string): string {
  return `A page matching it was found (${host}), but the search gave no extract to read, so we have read nothing of the work.`;
}
/** `not-identified`: the page may still be the row's link, but it is not read as this work. */
export function citeReadNotIdentified(host: string): string {
  return `A page was found (${host}), but we could not tell it is this work, so we have read nothing of it.`;
}
/** `unreadable`: the AI's reading of the extract was malformed and thrown away whole. */
export function citeReadUnreadable(host: string): string {
  return `We have not read the work itself. A page matching it was found (${host}), but the AI's reading of its search extract came back garbled and was thrown away, so we show nothing from that extract.`;
}

/**
 * **Which line a row says.** A lookup, when there is one, says what it read;
 * otherwise `linkFrom` decides between the two stage-1 lines. Total over both
 * unions, as `sourceOf` is. The band and the hover card both call this.
 */
export function readNoteOf(work: Pick<ShownWork, "linkFrom" | "lookup" | "investigation">): string {
  /* *Investigate* read the paper itself (plan 261001a stage 3): the strongest
     thing we have read, so it is what the row says, dated — a kept answer is a
     snapshot. Any other paper state leaves the line to what it was before. */
  const paper = work.investigation?.paper;
  if (paper?.state === "read") return citeReadPaper(paper.words, paper.host, paper.readAt);
  const lookup = work.lookup;
  if (lookup !== undefined) {
    switch (lookup.state) {
      case "assessed":
        return citeReadAssessed(lookup.excerptWords, lookup.host);
      case "no-extract":
        return citeReadNoExtract(lookup.host);
      case "not-identified":
        return citeReadNotIdentified(lookup.host);
      case "unreadable":
        return citeReadUnreadable(lookup.host);
      default: {
        const unhandled: never = lookup;
        return unhandled;
      }
    }
  }
  switch (work.linkFrom) {
    case "web":
      return CITE_PAGE_FOUND;
    case "doi":
    case "arxiv":
    case "article":
    case "search":
      return CITE_NOT_READ;
    default: {
      const unhandled: never = work.linkFrom;
      return unhandled;
    }
  }
}

/**
 * The label on the verdict: **the AI's reading**, and of the extract, so
 * neither the verdict nor its absence reads as a fact about the work.
 */
export const CITE_VERDICT_LABEL = "the AI's reading of that extract";
/** The caption on every quote a lookup kept: the extract's characters, located by code. */
export const CITE_QUOTE_LABEL = "from the search extract";
/** The label on `paperDoes.says` — the AI's sentence, shown only beside the quote that bears it out. */
export const CITE_DOES_LABEL = "what the work does, in the AI's reading of that extract";

/**
 * **The verdict in words.** Three, and none of them "does not support": an
 * extract that does not show a thing says nothing about the full work
 * (plan 260929g, Sol P-1), so `not-in-extract` says so and leaves it open.
 */
export function verdictText(support: CitationSupport): string {
  switch (support) {
    case "supports":
      return "supports what the article uses it for";
    case "partly":
      return "partly supports what the article uses it for";
    case "not-in-extract":
      return "the extract doesn't show what the article uses it for, though the full work might";
    default: {
      const unhandled: never = support;
      return unhandled;
    }
  }
}

/** The assessed arm of a lookup, which is the only one with anything to show under the line. */
export type AssessedLookup = Extract<CitationLookup, { state: "assessed" }>;

export function assessedOf(work: Pick<ShownWork, "lookup">): AssessedLookup | null {
  return work.lookup?.state === "assessed" ? work.lookup : null;
}

/* -------------------------------------------------------------- the panel -- */

/** A module constant, so an empty list is the same array every render. */
const NO_WORKS: ShownWork[] = [];

/**
 * **Who is reading, and the list they get — one prop, so the two cannot
 * disagree.** The owner's arm is the whole `useCitations` read: its status,
 * the job, and the verbs that spend — the run, the re-run and *Find it*. The
 * visitor's arm is the stored list off the public payload and nothing else, so
 * a visitor's panel has nothing to press that could ask the model or a search
 * provider. `owner?: never` for `TimelineAccess`'s reason. Since 2026-09-29,
 * SPIDERYARN-READING2-56, plan 260929c stage 3.
 */
export type CitationsAccess =
  | { kind: "owner"; owner: UseCitations }
  | { kind: "visitor"; citations: PublicCitations; owner?: never };

interface Props {
  access: CitationsAccess;
  /** `?citeby=` — the order the reader asked for. `effectiveOrder` decides the one in force. */
  order: CiteOrder;
  onOrder(order: CiteOrder): void;
  /** `?citebar=`, or null for "nobody has touched it" — `CITATION_BAR_DEFAULT`. */
  bar: number | null;
  onBar(bar: number | null): void;
  /** `passage` is `citePassageKey(work.id)` when the row names the citing words (rows.ts). */
  onJump(id: BlockId, passage?: string): void;
  /**
   * **One work to bring into view, once** — the prose card's *Dig deeper* has
   * just opened this band for it (plan 261004b). Not a selection: the row has
   * no selected state and there is no `?cite=`. `n` tells two presses on the
   * same work apart. The panel lowers the bar if it is hiding the row
   * (`barToReveal`), scrolls to the row once it is drawn, and calls
   * `onFocusTaken` so that coming back to the band later does not scroll again.
   */
  focus?: CiteFocus | null;
  /** Handed the request it served, so an older one's answer cannot clear a newer one. */
  onFocusTaken?(focus: CiteFocus): void;
}

/** `Props.focus`. */
export interface CiteFocus {
  id: string;
  n: number;
}

export function CitationsPanel({
  access,
  order: chosenOrder,
  onOrder,
  bar: chosenBar,
  onBar,
  onJump,
  focus = null,
  onFocusTaken,
}: Props) {
  useRenderCount("CitationsPanel");
  /* `null` for a visitor, and every owner-only thing below is behind it. */
  const owner = access.kind === "owner" ? access.owner : null;
  const citations = access.kind === "owner" ? access.owner.citations : access.citations;
  const all: readonly ShownWork[] = citations?.citations ?? NO_WORKS;
  const bar = chosenBar ?? CITATION_BAR_DEFAULT;
  /* One answer for the order in force, passed down, so the list, the pressed
     button and the slider's presence cannot disagree. */
  const order = effectiveOrder(all, chosenOrder);
  const shown = orderWorks(all, order, bar);
  /* A visitor's list arrived with the page, so it is ready by construction. */
  const ready = citations !== null && (owner === null || owner.status === "ready");
  const showJob = owner !== null && ready && !owner.stale && (owner.job || owner.starting || owner.failed);
  /* Empty with fewer than two works or two orders, and then there is no order
     row and an empty head row holds the top of the band instead. */
  const orders = citations && all.length > 1 ? orderOptions(all) : [];

  /* **Bring the focused work into view** — `Props.focus`. Three steps, each a
     render apart, which is why this is an effect over what is drawn rather than
     one call at the press: the list may still be loading (nothing is taken
     then), the bar may be hiding the row, and the bar's new value comes back
     through the URL on a later render. A work the ready list does not have is
     dropped rather than waited for. The row is looked for inside this panel's
     own list. `nearest`, so a row already on screen does not move. */
  const list = useRef<HTMLOListElement>(null);
  const focusDrawn = focus !== null && shown.some((w) => w.id === focus.id);
  useEffect(() => {
    if (focus === null || !ready) return;
    if (!all.some((w) => w.id === focus.id)) {
      onFocusTaken?.(focus);
      return;
    }
    const lowered = barToReveal(all, focus.id, chosenOrder, bar);
    if (lowered !== null) {
      onBar(lowered);
      return;
    }
    if (!focusDrawn) return;
    for (const item of list.current?.querySelectorAll("[data-citation-id]") ?? []) {
      if (item.getAttribute("data-citation-id") !== focus.id) continue;
      /* Optional call: jsdom has no `scrollIntoView`. */
      item.scrollIntoView?.({ block: "nearest" });
      break;
    }
    onFocusTaken?.(focus);
  }, [focus, ready, all, chosenOrder, bar, focusDrawn, onBar, onFocusTaken]);

  /* **A row being dug stays drawn, and so does its answer.** A dig changes the
     row's priority under the reader: the `finding` step detaches the kept
     answer, and with it a web influence that may have been what held the row
     above the bar; the new answer can score lower too. Without this the row,
     its stage line and its stream vanish mid-press (GPT Sol, plan review of
     261004b, F1 — true of a press on the row itself before the card had one).
     So whenever the priority of the last work dug here changes, the bar is
     lowered to it if it would hide it. **Keyed on that priority and not on the
     bar**, so a reader who drags the bar above the row afterwards is not
     fought. */
  const digging = owner?.investigating ?? null;
  const lastDug = useRef<string | null>(null);
  if (digging !== null) lastDug.current = digging;
  const keptId = lastDug.current;
  const kept = keptId === null ? undefined : all.find((w) => w.id === keptId);
  const keptPriority = kept ? priorityOf(kept) : undefined;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the work's priority is the trigger; the bar and the order are read, not watched
  useEffect(() => {
    if (keptId === null || !ready) return;
    const lowered = barToReveal(all, keptId, chosenOrder, bar);
    if (lowered !== null) onBar(lowered);
  }, [keptId, keptPriority, ready]);
  /* What the band's (i) adds after the mode's own words: the two sentences
     about the whole list (plan 261001l moved them off the foot), the count, and
     who made it — only once the list is ready and has something in it, which
     is when the foot used to draw them. In the band's corner since 2026-10-01
     (spya-ucu35y, plan 261001m); it was at the order row's end. */
  const made = owner?.citations ?? null;
  const about =
    ready && all.length > 0 ? (
      <>
        {citations.capped && <p>{CAPPED_NOTE}</p>}
        <p>{INFLUENCE_NOTE}</p>
        {owner !== null && <p>{INFLUENCE_WEB_NOTE}</p>}
        <p>
          {all.length} {all.length === 1 ? "work" : "works"} cited.
        </p>
        {made && (
          <AboutMade
            generator={made.generator}
            version={made.version}
            generatedAt={made.generatedAt}
            elapsedMs={made.elapsedMs}
          />
        )}
      </>
    ) : null;

  const run = (label: string, again = false) =>
    owner === null ? null : (
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
      mode="citations"
      about={about}
      /* **No head row while the order row is drawn**, since 2026-10-01 — the
          move Glossary made (plan 260929a), for Greg's *"it says at the top how
          many works there are. I feel like that's maybe there's a more
          space-efficient way to say that"* (`spya-nca765`). The count went to
          the order row's end, and since 2026-10-01 into the band's (i) with
          Glossary's and Quotes' (spya-ucu35y, plan 261001m); *prioritised*'s
          threshold row still says "8 of 24". With one work, or one order on
          offer, there is no order row, so an empty head row stays.

          Otherwise a fragment, not a conditional, so the row stays put while
          the list loads — the choice Timeline and Glossary make. Plan 261001l. */
      head={orders.length > 0 ? null : <></>}
      /* Pinned under the scroller, and **only a job's status now**. The two
         sentences about the whole list that were here went behind the (i) on
         2026-10-01 — Greg: *"at the bottom, there's an explanation of what
         citations mode is, and that could be inside an information icon
         tooltip"* (`spya-nca765`, plan 261001l).

         **No re-run here.** The first draft had *Find them again* in this foot,
         and the browser check found it the largest control in the band and the
         one press that costs money, under a list that was fine. Greg took the
         same button out of the Glossary (*Start again*, 2026-09-05: "confusing
         and unnecessary") and out of Quotes (*Choose them again*, 2026-09-11).
         A stale list still offers it, in the banner above, which is the case
         where asking again buys something; an outdated one is not announced
         (plan 260929c). A job started from Metadata still needs its progress,
         Stop and failure here. */
      foot={showJob ? <div className="cite-foot">{run("Find them again", true)}</div> : null}
    >
      {orders.length > 0 && (
        <OrderBar options={orders} order={order} onOrder={onOrder} />
      )}

      {/* Only in the order it belongs to: a number that means nothing in the
          other three would be furniture. */}
      {citations && order === "prioritised" && (
        <BarSlider works={all} bar={bar} moved={chosenBar !== null} onBar={onBar} />
      )}

      {owner?.error && <ReadError error={owner.error} onRetry={owner.retryRead} />}

      {owner?.status === "loading" && <p className="gloss-quiet">Looking for the citations…</p>}

      {owner?.status === "none" && (
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
          {owner?.stale ? (
            <div className="gloss-stale">
              <p>
                <TriangleAlert size={13} />
                This describes an older version of the article.
              </p>
              {run("Find them again", true)}
            </div>
          ) : null}
          {/* No banner for an outdated list (older prompt, same article) —
              Greg, 2026-09-29 (SPIDERYARN-READING2-55): *"it's not worth
              bugging the user about it."* Re-running is in Metadata. Plan
              260929c. */}

          {all.length === 0 && <p className="gloss-quiet">{CITATIONS_NONE}</p>}

          {all.length > 0 && (
            <div className="tl-scroll">
              <ol className="tl-list cite-list" ref={list}>
                {shown.map((work) => (
                  <WorkRow
                    key={work.id}
                    work={work}
                    unscored={order === "prioritised" && priorityOf(work) === undefined}
                    showInSpideryarn={owner !== null}
                    onJump={onJump}
                    /* The owner's alone, and never on the hover card. */
                    investigate={
                      owner === null
                        ? null
                        : {
                            running: owner.investigating,
                            stage: owner.investigating === work.id ? owner.investigateStage : null,
                            note: owner.findNote?.id === work.id ? owner.findNote : null,
                            draft: owner.investigateDraft?.id === work.id ? owner.investigateDraft.text : null,
                            failed: owner.investigateFailed?.id === work.id ? owner.investigateFailed : null,
                            onInvestigate: (id) => void owner.investigate(id),
                          }
                    }
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

/**
 * The orders a list can honour — each option only once the list can honour
 * it, because a control that would visibly do nothing is worse than one that is
 * not there (GlossaryPanel.tsx § SortBar). Empty when fewer than two are on
 * offer, which is how the panel knows there is no order row to fold the head
 * row into.
 */
function orderOptions(works: readonly ShownWork[]): { key: CiteOrder; label: string; title: string }[] {
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
    ...(works.some((w) => influenceOf(w) !== undefined)
      ? [
          {
            key: "influence" as const,
            label: "influence",
            title:
              "How influential each work is in its field — the model's memory, or an AI estimate from the web where Dig deeper found one; not a citation count. Works with unknown influence come after, by relevance",
          },
        ]
      : []),
    ...(works.some((w) => publicationYear(w) !== null)
      ? [
          {
            key: "date" as const,
            label: "date",
            title: "Oldest first, by the year each work was published; works with no year last",
          },
        ]
      : []),
  ];
  return options.length < 2 ? [] : options;
}

/**
 * The order buttons. The count and the (i) that sat at this row's end (plan
 * 261001l) are in the band's (i) since 2026-10-01 (plan 261001m).
 */
function OrderBar({
  options,
  order,
  onOrder,
}: {
  options: readonly { key: CiteOrder; label: string; title: string }[];
  order: CiteOrder;
  onOrder(order: CiteOrder): void;
}) {
  return (
    <div className="gloss-sort">
      <OrderGroup label="Order the citations by" selected={order}>
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
      </OrderGroup>
    </div>
  );
}

function BarSlider({
  works,
  bar,
  moved,
  onBar,
}: {
  works: readonly ShownWork[];
  bar: number;
  moved: boolean;
  onBar(bar: number | null): void;
}) {
  /* One pass, and every number here comes out of it — threshold.ts. */
  const { visible, hiddenCount } = visibleWorks(works, bar);
  return (
    <ThresholdSlider
      id="cite-bar"
      value={bar}
      max={barMax(works, bar)}
      defaultValue={CITATION_BAR_DEFAULT}
      moved={moved}
      visible={visible.length}
      total={works.length}
      noun="citations"
      title="How high a work has to score to stay on screen: two parts relevance to one part influence, or relevance alone where the influence is unknown. Left shows more works, right fewer."
      note={citationsNote(hiddenCount, works.length)}
      onChange={onBar}
    />
  );
}

/* ------------------------------------------------------------------ a row -- */

/**
 * A row's *Investigate* — the owner's alone, so `null` on a visitor's row.
 * Plan 260930a; since plan 260930d the one button, with *Look it up* (was
 * *Find it*) as its first step.
 */
interface RowInvestigate {
  /** The work whose *Investigate* is running anywhere in the list, or null. */
  running: string | null;
  /** This row's step while its press is out — `finding` the work, then `reading`. */
  stage: InvestigateStage | null;
  /** What this row's last press's lookup said when it found no page. */
  note: FindNote | null;
  /** This row's words so far, while its run is out. */
  draft: string | null;
  /** This row's last run, when it did not end in a stored answer. */
  failed: InvestigateFailureHere | null;
  onInvestigate(id: string): void;
}

function WorkRow({
  work,
  unscored,
  showInSpideryarn,
  onJump,
  investigate,
}: {
  work: ShownWork;
  unscored: boolean;
  /** Owner-only even if malformed visitor JSON carries the optional field. */
  showInSpideryarn: boolean;
  onJump(id: BlockId, passage?: string): void;
  investigate: RowInvestigate | null;
}) {
  const cited = citingPlaceOf(work);
  /* **No source at all when the public boundary refused the address** — a
     visitor's row whose link carried a credential or a private host. The row
     stays, drawn as a citation with no link, and says nothing about why: the
     `publicMeta` rule, since there is nothing a visitor could do differently. */
  const source = work.url === undefined ? null : sourceOf({ url: work.url, linkFrom: work.linkFrom });
  const note = investigate?.note ?? null;
  const scores = scoresOf(work);
  const web = webInfluenceOf(work);
  const line = workByLine(work);
  const by = byLineOf(work);
  /* The found page's own title, in the tooltip: the search result's words,
     never the model's (src/citation-find.ts). */
  const foundAs = work.found?.title ? ` — “${work.found.title}”` : "";
  const view = investigate === null ? undefined : investigationViewOf(work.investigation, {
    running: investigate.running === work.id,
    stage: investigate.stage,
    draft: investigate.draft,
    failed: investigate.failed,
    lookupAt: work.lookup?.at ?? null,
  });

  return (
    <li
      className="tl-item cite-item"
      data-citation-id={work.id}
      {...(unscored && { title: "Not scored for prioritising — shown regardless of the threshold" })}
    >
      <CiteTitle work={work} source={source} foundAs={foundAs} by={by} />
      {showInSpideryarn && work.inSpideryarn && <InSpideryarn match={work.inSpideryarn} />}
      {by && !byLineFolds(work, by) && <ByLine work={work} by={by} />}
      {line.conflict && <p className="cite-find-note cite-registry-conflict">{registryConflictNote(line.conflict)}</p>}
      {/* The claim accompanies exactly the verdict or answer drawn below. */}
      {showsWhy(work, view) && (
        <p className="cite-why">
          <span className="cite-why-label">{CITE_WHY_LABEL}:</span> {work.why}
        </p>
      )}
      <p className="cite-read">{readNoteOf(work)}</p>
      <LookupReading work={work} />
      <p className="cite-meta">
        {scores.length > 0 && <ScoreBars className="cite-scores" scores={scores} />}
        {web !== undefined && <WebInfluence influence={web} />}
        {influenceIsUnknown(work) && (
          <UnknownInfluence canDig={investigate !== null} />
        )}
        {source === null ? null : source.kind === "address" ? (
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
        {investigate !== null && (
          <InvestigateButton
            id={work.id}
            again={work.investigation !== undefined}
            running={investigate.running === work.id}
            busy={investigate.running !== null}
            onInvestigate={investigate.onInvestigate}
          />
        )}
        <span className="cite-first">
          {work.citedInBody ? "first cited" : "only in the references"}{" "}
          {cited === null ? (
            <BlockRef id={work.firstCited} onJump={onJump} />
          ) : (
            /* The words the article cites it with, not the block id: one
               paragraph can cite three works, and only the words say which
               (SPIDERYARN-READING2-6J). The jump lands on — and flashes — those
               words' mark; with none drawn it falls back to the paragraph. */
            <BlockRef
              id={work.firstCited}
              onJump={(id) => onJump(id, citePassageKey(work.id))}
              preview={false}
              className="cite-at"
            >
              {quotedCitingWords(cited.quote)}
            </BlockRef>
          )}
        </span>
      </p>
      {/* The press's first step found no page: said quietly, and the
          reading below goes on unconfirmed (plan 260930d P-5). */}
      {note && (
        <p className="cite-find-note" role="status">
          {note.message}
        </p>
      )}
      {investigate !== null && view !== undefined && (
        <InvestigationBlock
          id={work.id}
          view={view}
          busy={investigate.running !== null}
          lookup={work.lookup}
          onInvestigate={investigate.onInvestigate}
        />
      )}
    </li>
  );
}

/** A dated snapshot: the day the press finished, never "current". */
function dayOf(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime())
    ? "an unknown day"
    : at.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

/**
 * ***from the web*, beside the influence bar** (plan 261003m stage 2): the
 * number came from one page of *Dig deeper*'s web search, not from the model's
 * memory. The card says so in our words, names the host and the day, and then
 * shows the page's own words, in a `<q>` so they read as the page's and not
 * ours. The quote stays in the app's face: third-party text is left UI
 * (docs/project/fonts.md § Whose voice is it). No link: the address is in the
 * answer's own sources below. Opens on hover, focus or tap, as
 * `UnknownInfluence` does.
 */
function WebInfluence({ influence }: { influence: Extract<EffectiveInfluence, { from: "web" }> }) {
  const reveal = useTapReveal(false);
  return (
    <Tooltip
      content={
        <>
          {influenceFromWebNote(hostOf(influence.sourceUrl), dayOf(influence.at))}{" "}
          <q className="cite-influence-quote">{influence.quote}</q>
        </>
      }
      placement="left"
      className="score-bars-card"
      open={reveal.open}
      onOpenChange={reveal.onOpenChange}
    >
      <button
        type="button"
        className="cite-influence-web"
        aria-expanded={reveal.open}
        onPointerDown={reveal.onPointerDown}
        onPointerCancel={reveal.onPointerCancel}
        onClick={(e) => {
          if (reveal.commit(e)) reveal.onOpenChange(!reveal.open);
        }}
      >
        {INFLUENCE_FROM_WEB}
      </button>
    </Tooltip>
  );
}

/** The explanation opens on hover, focus or tap; a finger's card closes on scroll. */
function UnknownInfluence({ canDig }: { canDig: boolean }) {
  const reveal = useTapReveal(false);
  return (
    <Tooltip
      content={canDig ? INFLUENCE_UNKNOWN_NOTE : INFLUENCE_UNKNOWN_NOTE_SHARED}
      placement="left"
      className="score-bars-card"
      open={reveal.open}
      onOpenChange={reveal.onOpenChange}
    >
      <button
        type="button"
        className="cite-influence-unknown"
        aria-expanded={reveal.open}
        onPointerDown={reveal.onPointerDown}
        onPointerCancel={reveal.onPointerCancel}
        onClick={(e) => {
          if (reveal.commit(e)) reveal.onOpenChange(!reveal.open);
        }}
      >
        {INFLUENCE_UNKNOWN}
      </button>
    </Tooltip>
  );
}

/**
 * **What an assessed lookup shows under the row's line**, and nothing for any
 * other state — those read nothing, and the line above already says so.
 *
 * Three things, each labelled for what it is: the verdict, as *the AI's
 * reading of that extract*; each quote, as *from the search extract* (the
 * extract's own characters, located by code — src/citation-lookup.ts §
 * `verifyQuote`); and `paperDoes.says`, the AI's sentence, only beside the
 * quote that bears it out. Quotes are `<blockquote>`s drawn as text, with
 * Debate's rule down the left (debate.css § `.dbt-quote`): a slice of a
 * stranger's page, which may never become markup.
 */
/**
 * **The row's by-line, and on hover the authors as given and where they came from**
 * — the authors unshortened and the work's entry in the article's reference list,
 * which is where the journal or conference, volume and pages are
 * (SPIDERYARN-READING2-6K). No card when there is nothing more to say. Not a
 * tab stop — eighty rows would be eighty — so the entry is also `sr-only`,
 * Masthead.tsx's idiom for a tooltip on a line of text.
 */
function ByLine({ work, by }: { work: ShownWork; by: string }) {
  const card = byLineCard(work);
  if (card === null) return <p className="cite-by">{by}</p>;
  const filled = workByLine(work).filled;
  return (
    <Tooltip placement="bottom" keepSide className="tip-soon" content={card.content}>
      <p className="cite-by cite-by-more">
        {by}
        {/* The registry's words are never drawn as the article's: a visible
            mark, and the whole sentence in the tooltip (plan 261001a stage 5). */}
        {filled && <span className="cite-by-from"> · {registryFilledMark(filled)}</span>}
        {card.spoken}
      </p>
    </Tooltip>
  );
}

/**
 * **What the by-line's hover card says, and its words for a screen reader** —
 * or null when it has nothing beyond the line itself. One source for the two
 * places it can open from: the by-line, and the title when the by-line only
 * repeats it (`byLineFolds`), so the two cannot drift.
 */
function byLineCard(
  work: ShownWork,
  link?: ReactNode,
  titleTrigger = false,
): { content: ReactNode; spoken: ReactNode } | null {
  const entry = work.entry;
  const line = workByLine(work);
  const shortened = line.authors !== undefined && shortAuthors(line.authors) !== line.authors;
  const filled = line.filled;
  if (!entry && !shortened && !filled) return null;
  return {
    content: (
      <>
        {/* A folded title already says this short line. Hide that repetition
            from assistive technology while keeping it in the visual card; a
            shortened by-line is the exception because the head then supplies
            the full author list the visible title omits. */}
        <div className="tip-soon-head" aria-hidden={titleTrigger && !shortened ? true : undefined}>
          {[line.authors, line.year].filter(Boolean).join(" · ")}
        </div>
        {filled && <p className="tip-soon-how">{registryFilledNote(filled)}</p>}
        {entry && <p className="cite-entry">{entry}</p>}
        {entry && <p className="tip-soon-how">{CITE_ENTRY_NOTE}</p>}
        {link}
      </>
    ),
    spoken: (
      <>
        {shortened && <span className="sr-only"> — authors: {line.authors}</span>}
        {filled && <span className="sr-only"> — {registryFilledNote(filled)}</span>}
        {entry && <span className="sr-only"> — {entry}</span>}
      </>
    ),
  };
}

/**
 * **The by-line is left off when it only repeats the title** (7W) — but never
 * when the registry filled a field, since then it carries the visible *from
 * Crossref* mark, which must stay (plan 261001a stage 5).
 */
function byLineFolds(work: ShownWork, by: string): boolean {
  return workByLine(work).filled === null && byLineRepeatsTitle(work.title, by);
}

/**
 * **The row's title**, a link out when the article gave an address. When the
 * by-line has folded into it, the by-line's hover card opens from here instead
 * — for an author–year work the reference-list entry in that card is often the
 * only place its real title is.
 *
 * A linked title is then the card's trigger itself, so the link is what
 * `aria-describedby` names, and its native `title` goes (two popups on one
 * hover) with its words, `foundAs` included, as the card's last line. A finger
 * gets reveal-then-commit (useTapReveal.ts, docs/project/touch.md): the first
 * tap opens the card, the second follows the link — otherwise the entry would
 * be out of a phone's reach. Sol, plan 261001m review.
 */
function CiteTitle({
  work,
  source,
  foundAs,
  by,
}: {
  work: ShownWork;
  source: ReturnType<typeof sourceOf> | null;
  foundAs: string;
  by: string;
}) {
  const reveal = useTapReveal(true);
  const linkSays = source?.kind === "address" ? `${source.how}${foundAs} — opens ${source.host} in a new tab` : null;
  const card =
    by && byLineFolds(work, by)
      ? byLineCard(
          work,
          <>
            {linkSays && <p className="tip-soon-how">{linkSays}</p>}
            {reveal.tap && <p className="tip-soon-tap">Tap again to open the link.</p>}
          </>,
          true,
        )
      : null;
  if (source?.kind !== "address") {
    if (card === null) return <p className="cite-title">{work.title}</p>;
    return (
      <Tooltip placement="bottom" keepSide className="tip-soon" content={card.content}>
        <p className="cite-title">
          {work.title}
          {card.spoken}
        </p>
      </Tooltip>
    );
  }
  /* Every link that leaves the app opens a new tab — docs/project/links.md
     — and `noreferrer noopener`, as everything outbound here is. */
  const inner = (
    <>
      {work.title}
      <ExternalLink size={11} aria-hidden="true" className="cite-out" />
    </>
  );
  if (card === null) {
    return (
      <p className="cite-title">
        <a href={source.url} target="_blank" rel="noreferrer noopener" title={linkSays ?? undefined}>
          {inner}
        </a>
      </p>
    );
  }
  return (
    <p className="cite-title">
      <Tooltip
        placement="bottom"
        keepSide
        className="tip-soon"
        content={card.content}
        open={reveal.open}
        onOpenChange={reveal.onOpenChange}
      >
        <a
          href={source.url}
          target="_blank"
          rel="noreferrer noopener"
          onPointerDown={reveal.onPointerDown}
          onPointerCancel={reveal.onPointerCancel}
          onClick={(e) => {
            if (!reveal.commit(e)) e.preventDefault();
          }}
        >
          {inner}
        </a>
      </Tooltip>
      {/* In the reading flow for a screen reader browsing the row, as the
          by-line's own was. Not the link's `aria-describedby`: focus opens the
          card, which already describes it, and naming both read it twice. */}
      {card.spoken}
    </p>
  );
}

/** How a work was matched to an article here, in the tooltip's words. */
export const CITE_HERE_HOW: Record<CitedMatchedBy, string> = {
  doi: "the same DOI",
  arxiv: "the same arXiv id",
  "guessed-id": "the DOI or arXiv id we found for your uploaded PDF",
  address: "the same address",
  title: "the same title — check it is the same work",
};

/**
 * The row's label for a work that is already an article here. An archived copy
 * says so: it is off the shelf, and a reader who went looking there would not
 * find it (plan 261001i).
 */
export function citeHereLabel(match: CitedInSpideryarn): string {
  if (match.whose === "public") return "On the public shelf";
  return match.archived ? "In your library · archived" : "In your library";
}

/**
 * **This work is already an article here** — SPIDERYARN-READING2-5R, plan
 * 260930b. A link to *our* page, so `Link` and the same tab, not a link out.
 * A title match names the article it matched, because that is the one a reader
 * should check: the same words are not the same identity. Drawn by the band's
 * row and by the prose hover card (ProseHoverCard.tsx § `CiteCard`, plan
 * 261001i), so the two cannot word it differently.
 */
export function InSpideryarn({ match }: { match: CitedInSpideryarn }) {
  return (
    <p className="cite-here">
      <Link href={readHref(match.slug)} title={`Open “${match.title}” here — matched by ${CITE_HERE_HOW[match.matchedBy]}`}>
        <BookOpen size={11} aria-hidden="true" className="cite-here-icon" />
        {citeHereLabel(match)}
      </Link>
      {match.matchedBy === "title" && <span className="cite-here-how"> · matched by title: “{match.title}”</span>}
    </p>
  );
}

function LookupReading({ work }: { work: ShownWork }) {
  const lookup = assessedOf(work);
  if (lookup === null) return null;
  const { verdict, paperDoes } = lookup;
  return (
    <div className="cite-lookup">
      <p className="cite-verdict">
        <span className="cite-lookup-label">{CITE_VERDICT_LABEL}:</span>{" "}
        <span className="cite-verdict-text">{verdictText(verdict.support)}</span>
      </p>
      {verdict.support !== "not-in-extract" && <ExtractQuote quote={verdict.quote} />}
      {paperDoes && (
        <>
          <p className="cite-does">
            <span className="cite-lookup-label">{CITE_DOES_LABEL}:</span> {paperDoes.says}
          </p>
          <ExtractQuote quote={paperDoes.quote} />
        </>
      )}
    </div>
  );
}

function ExtractQuote({ quote }: { quote: string }) {
  return (
    <figure className="cite-quote">
      <blockquote>“{quote}”</blockquote>
      <figcaption>{CITE_QUOTE_LABEL}</figcaption>
    </figure>
  );
}
