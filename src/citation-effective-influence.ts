/**
 * **A cited work's influence, and where it came from: the one read path** —
 * plan 261003m stage 2 (docs/plans/261003m-citations-influence-unknown-unless-confident-and-dig-deeper-fills-it-in.md
 * § One read path, GPT Sol's F6).
 *
 *   effectiveInfluence(work)
 *     → { value: 0.9, from: "web", quote, sourceUrl, sourceTitle?, at }
 *     | { value: 0.5, from: "list" }
 *     | undefined                       // unknown
 *
 * A row has up to two influences. The list's own (`CitedWork.influence`) is
 * the model's memory, and absent when it was not confident. *Dig deeper* may
 * add a second on its kept answer (`investigation.influence`), read from one
 * page of that press's web search. **The web one wins**, known or unknown,
 * because it has a source and the memory has none. It is used only while:
 *
 * - the answer is attached to the row, which `loadBibliography` does only while
 *   the answer's fingerprint is current; and
 * - it carries the current `INFLUENCE_VERSION`, so a later correction to the
 *   prompt or the checks drops old numbers without hiding the answers beside
 *   them (F7).
 *
 * **The list's own field is never overwritten**: a visitor's row has no
 * investigation, so this returns the list's value for them.
 *
 * Browser-safe: imports types only. The bar, the threshold, the influence
 * order, whether that order is offered (src/web/BibliographyPanel.tsx) and the
 * owner's chat tool (src/chat-tools.ts) all read influence through here.
 */
import type { CitationInvestigation } from "./types.js";

/**
 * **The stamp on a web influence** — the prompt in src/citation-influence.ts
 * and the rules its `keepInfluence` checks. Bump it with a change to either
 * that makes an older number untrustworthy; every stored one then stops being
 * read, and *Dig deeper again* writes a new one.
 */
export const INFLUENCE_VERSION = "citation-influence/2";

export type EffectiveInfluence =
  | {
      value: number;
      from: "web";
      /** The page's own words the number rests on. */
      quote: string;
      sourceUrl: string;
      sourceTitle?: string;
      /** When the press that found it finished, ISO 8601. */
      at: string;
    }
  | { value: number; from: "list" };

/** What this needs of a row: the owner's `CitedWork` and a visitor's row both fit. */
export interface InfluenceOfWork {
  influence?: number | undefined;
  investigation?: Pick<CitationInvestigation, "influence" | "at"> | undefined;
}

const usable = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;

export function effectiveInfluence(work: InfluenceOfWork): EffectiveInfluence | undefined {
  const investigation = work.investigation;
  const web = investigation?.influence;
  if (investigation && web && web.version === INFLUENCE_VERSION && usable(web.value)) {
    return {
      value: web.value,
      from: "web",
      quote: web.quote,
      sourceUrl: web.sourceUrl,
      ...(web.sourceTitle ? { sourceTitle: web.sourceTitle } : {}),
      at: investigation.at,
    };
  }
  return usable(work.influence) ? { value: work.influence, from: "list" } : undefined;
}
