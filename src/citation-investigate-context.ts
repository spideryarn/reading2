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
 * **The article enters as its blocks — ids and text — not as the rendered
 * prompt part.** The prompt part is `articleWithIds(meta, blocks)`, whose head
 * carries the title as the reading view shows it (a reader's rename included,
 * via `titleFor`) and the byline; the read seam that attaches has the blocks in
 * hand and not that meta. A renamed article keeps its investigation; a changed
 * paragraph does not. Written down as a deviation from the plan's wording.
 */
import { createHash } from "node:crypto";

import type { Citations, CitationInvestigation, CitedWork } from "./types.js";

/**
 * **Bump when the prompt (`INVESTIGATE_SYSTEM`, src/citation-investigate.ts),
 * the second part's layout, or anything here changes what an answer would say**
 * — it is inside the fingerprint, so a bump detaches every stored answer.
 */
export const CITATION_INVESTIGATE_VERSION = "citation-investigate/1";

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

type WorkFields = Pick<
  CitedWork,
  "title" | "authors" | "year" | "reference" | "url" | "linkFrom" | "why" | "firstCited" | "citedAt"
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
    reference: work.reference ? work.reference.quote.slice(0, INVESTIGATE_REFERENCE_CAP) : null,
    url: work.url,
    linkFrom: work.linkFrom,
    why: work.why,
    passages,
  };
}

function hash16(parts: readonly unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts), "utf8").digest("hex").slice(0, 16);
}

/** The article, as its blocks' ids and text in order — see the header for why not the rendered part. */
export function investigateArticleKey(blocks: readonly { id: string; text: string }[]): string {
  return hash16(blocks.map((b) => [b.id, b.text]));
}

/**
 * **The fingerprint** — the model asked for, not the one that answered, since
 * only the configured model is known at read time (as `lookupContextHash`).
 */
export function investigateContextHash(
  context: InvestigateContext,
  articleKey: string,
  profile: string | null,
  model: string,
): string {
  return hash16([
    CITATION_INVESTIGATE_VERSION,
    model,
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
