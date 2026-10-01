/**
 * **What *Investigate* sends about one cited work, and the fingerprint over
 * it** — the pure half of Citations' *Investigate*, so src/store/pg.ts can
 * recompute the fingerprint at read time without pulling the model call in
 * (src/citation-lookup.ts has the same split, for the same reason).
 * docs/plans/260930a-citations-investigate-one-work-on-demand.md § Staleness.
 *
 * ## One hash over everything sent (Sol P-4)
 *
 * A stored investigation is attached to its row only while
 * `investigateContextHash` over what would be sent **now** equals the one it
 * was written under: the article, the work's fields including its link and
 * where the link came from, `why` and the citing passages as capped, the
 * reader's rendered profile, the prompt version and the model. Anything else
 * reads *Investigate* again, and one press regenerates.
 *
 * **The article enters as the exact fields `articleWithIds` renders**: title,
 * byline, site, URL, then block ids and text. The current matched *Look it up*
 * page enters as the exact URL, title and verified passages the second part
 * renders. Both used to be omitted, which let an answer survive after its
 * prompt had changed.
 */
import { createHash } from "node:crypto";

import { generationKey } from "./models.js";
/* A value import from a module that imports this one's types only — erased,
   so no cycle at run time. pdf.js is loaded lazily there (src/pdf.ts), so the
   store's read path does not pay for it. */
import { PAPER_SELECTION_VERSION } from "./paper-evidence.js";
import type { CitationFind, Citations, CitationInvestigation, CitedWork, Meta } from "./types.js";

/**
 * **Bump when the prompt (`INVESTIGATE_SYSTEM`, src/citation-investigate.ts),
 * the second part's layout, or anything here changes what an answer would say**
 * — it is inside the fingerprint, so a bump detaches every stored answer.
 *
 * `/7` is *Dig deeper* (plan 261001p stage 2, Sol F6): a forced search's pages
 * in the second part and Opus throughout. An answer from before had neither,
 * and must not be drawn under the new name. The model alone could not detach
 * it: Sonnet and Opus are one generation (`generationKey`).
 */
export const CITATION_INVESTIGATE_VERSION = "citation-investigate/7";

/** Each citing passage sent, in characters — *Look it up*'s `PASSAGE_CAP`. */
export const INVESTIGATE_PASSAGE_CAP = 1_200;
/** The first mention's paragraph and up to two more. */
export const INVESTIGATE_PASSAGES = 3;
/** The reference entry sent, in characters — *Find it*'s cap. */
export const INVESTIGATE_REFERENCE_CAP = 500;

/** Exactly what the second part says about the work, capped. One builder for the call and the hash. */
export interface InvestigateContext {
  title: string;
  authors: string | null;
  year: string | null;
  /** The reference entry as the article gives it — `CitationPlace.quote`, capped. */
  reference: string | null;
  /** The row's link and where it came from. Always hashed; sent only when the article gave it. */
  url: string;
  linkFrom: CitedWork["linkFrom"];
  why: string;
  /** The citing passages, in order, each capped. */
  passages: string[];
}

/** The current *Look it up* page and the fields Investigate sends from it. */
export interface MatchedPage {
  url: string;
  title: string | null;
  quotes: string[];
}

/**
 * The matched page, or `null`: the attached lookup must be current, must have
 * identified a page, and must be the lookup stored on this find.
 */
export function matchedPageOf(work: CitedWork, find: CitationFind | null): MatchedPage | null {
  const lookup = work.lookup;
  if (!lookup || !find?.lookup) return null;
  if (lookup.state !== "assessed" && lookup.state !== "unreadable") return null;
  if (find.lookup.contextHash !== lookup.contextHash || find.lookup.evidenceHash !== lookup.evidenceHash) {
    return null;
  }
  const quotes =
    lookup.state === "assessed"
      ? [
          ...(lookup.verdict.support !== "not-in-extract" ? [lookup.verdict.quote] : []),
          ...(lookup.paperDoes ? [lookup.paperDoes.quote] : []),
        ]
      : [];
  return { url: find.url, title: find.title ?? null, quotes };
}

type WorkFields = Pick<
  CitedWork,
  "title" | "authors" | "year" | "reference" | "entry" | "url" | "linkFrom" | "why" | "firstCited" | "citedAt"
>;

/**
 * The context for one row, from a block-text lookup — `article.blocks` at call
 * time, the revision's block texts at read time.
 */
export function investigateContext(
  work: WorkFields,
  textOf: (blockId: string) => string | undefined,
): InvestigateContext {
  const ids = [work.firstCited, ...work.citedAt.filter((id) => id !== work.firstCited)];
  const passages: string[] = [];
  for (const id of ids) {
    const text = textOf(id);
    if (text === undefined || text.trim() === "") continue;
    passages.push(text.slice(0, INVESTIGATE_PASSAGE_CAP));
    if (passages.length >= INVESTIGATE_PASSAGES) break;
  }
  return {
    title: work.title,
    authors: work.authors ?? null,
    year: work.year ?? null,
    /* `entry` is the whole article-owned reference-list entry, including the
       PDF list that has no rendered block. It is stronger identity evidence
       than the shorter citation place, and was already the intended meaning
       of this context field. */
    reference: (work.entry ?? work.reference?.quote ?? null)?.slice(0, INVESTIGATE_REFERENCE_CAP) ?? null,
    url: work.url,
    linkFrom: work.linkFrom,
    why: work.why,
    passages,
  };
}

function hash16(parts: readonly unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts), "utf8").digest("hex").slice(0, 16);
}

/** The fields `articleWithIds` renders, in its order, without duplicating its prose labels. */
export function investigateArticleKey(
  meta: Pick<Meta, "title" | "byline" | "siteName" | "url">,
  blocks: readonly { id: string; text: string }[],
): string {
  return hash16([
    [meta.title, meta.byline ?? null, meta.siteName ?? null, meta.url ?? null],
    blocks.map((b) => [b.id, b.text]),
  ]);
}

/**
 * **The fingerprint** — the model asked for, not the one that answered, since
 * only the configured model is known at read time (as `lookupContextHash`).
 * Since plan 261001p that is `DIG_DEEPER_MODEL` (src/dig-deeper.ts) on both
 * sides — src/citation-investigate.ts writes with it and src/store/pg.ts reads
 * with it — never `modelFor`, whose environment override could differ.
 * And its generation rather than its id, for `lookupContextHash`'s reason: a
 * toggle of High-powered AI must not detach the answer (plan 260930f, Sol F1).
 */
export function investigateContextHash(
  context: InvestigateContext,
  articleKey: string,
  profile: string | null,
  matched: MatchedPage | null,
  model: string,
): string {
  return hash16([
    CITATION_INVESTIGATE_VERSION,
    /* Which rule chose the paper's chunks (plan 261001a stage 3, Sol P-10).
       The paper's own content is not here: nothing re-fetches it on read, so
       a kept answer is a dated snapshot of what was read, not a claim that
       the remote paper is unchanged. */
    PAPER_SELECTION_VERSION,
    generationKey(model),
    articleKey,
    context.title,
    context.authors,
    context.year,
    context.reference,
    context.url,
    context.linkFrom,
    context.why,
    context.passages,
    profile,
    matched ? [matched.url, matched.title, matched.quotes] : null,
  ]);
}

/**
 * **Put each stored investigation onto its row, at read time**, only while its
 * fingerprint matches the row as the list now has it. Touches only
 * `investigation`. Called on the list *after* `attachFinds`, because that is
 * the row the call is made from — a searched row's link is the found page.
 */
export function attachInvestigations(
  citations: Citations,
  stored: ReadonlyMap<string, CitationInvestigation>,
  contextHashOf: (work: CitedWork) => string,
): Citations {
  if (stored.size === 0) return citations;
  let changed = false;
  const works = citations.citations.map((work) => {
    const investigation = stored.get(work.id);
    if (!investigation || investigation.contextHash !== contextHashOf(work)) return work;
    changed = true;
    return { ...work, investigation };
  });
  return changed ? { ...citations, citations: works } : citations;
}
