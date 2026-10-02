/**
 * **Would this answer reach the reader?** Each entry point's real acceptance
 * rule, applied to an eval answer (plan 261001s § The arms, Sol F1). An answer
 * refused here is *not delivered*: it counts against the delivered rate and
 * the acceptable rate, and is not judged.
 *
 * - **comment** — `explainStream`'s own switch (src/explain.ts): our clocks,
 *   a provider failure and a stream with no `[DONE]` throw; a truncated,
 *   filtered or abandoned answer is kept; an empty one throws.
 * - **glossary** — the same, then production's `refuseUnfinished`
 *   (src/term-lookup.ts), imported rather than copied: truncated, filtered and
 *   abandoned are refused.
 * - **citation** — `reading()` in src/citation-investigate.ts: every delta
 *   through production's quote guard (`createQuoteGuard` over
 *   `allowedQuoteTexts`), only `finished` kept, the guard's end, an empty
 *   answer refused, and no extract read refused unless the paper was read.
 *
 * explain's switch is copied, not imported, because it lives inside the
 * generator that also builds the request this eval has to edit. The cases are
 * the same `StreamOutcome` union, so a new ending is a compile error here too.
 */
import type { StreamOutcome } from "../../src/ai-call.js";
import { allowedQuoteTexts, provenanceOf, withSearchStep } from "../../src/citation-investigate.js";
import type { InvestigateContext, MatchedPage } from "../../src/citation-investigate-context.js";
import type { DigFindings } from "../../src/dig-deeper.js";
import { createQuoteGuard } from "../../src/investigate-quote-guard.js";
import { refuseUnfinished } from "../../src/term-lookup.js";
import type { Block, SearchEvidence } from "../../src/types.js";

export type Delivery =
  | { delivered: true; answer: string; ending: StreamOutcome["kind"] }
  | { delivered: false; why: string; ending: StreamOutcome["kind"] | null };

/** explain's verdict on an ending: kept (`null`) or the reason it throws. */
function explainRefuses(kind: StreamOutcome["kind"]): string | null {
  switch (kind) {
    case "timed-out":
    case "went-quiet":
    case "provider-failed":
    case "unterminated":
      return `explain throws on ${kind}`;
    case "abandoned":
    case "truncated":
    case "filtered":
    case "unknown-finish-reason":
    case "wants-tools":
    case "finished":
      return null;
    default: {
      const never: never = kind;
      throw new Error(`unhandled ending ${JSON.stringify(never)}`);
    }
  }
}

/** A glossary or comment press. */
export function acceptExplain(entry: "glossary" | "comment", kind: StreamOutcome["kind"], text: string): Delivery {
  const refused = explainRefuses(kind);
  if (refused) return { delivered: false, why: refused, ending: kind };
  const answer = text.trim();
  if (answer === "") return { delivered: false, why: "explain throws on an empty answer", ending: kind };
  if (entry === "glossary") {
    /* explainStream only yields `done` for the kept endings, so this narrowing is the one it makes. */
    const ending = kind as Parameters<typeof refuseUnfinished>[0];
    try {
      refuseUnfinished(ending);
    } catch (err) {
      return { delivered: false, why: `the glossary refuses ${kind}: ${(err as Error).message}`, ending: kind };
    }
  }
  return { delivered: true, answer, ending: kind };
}

/** What a Citations press needs beyond the stream to decide. */
export interface CitationAcceptInput {
  blocks: readonly Block[];
  context: InvestigateContext;
  matched: MatchedPage | null;
  findings: DigFindings;
  /** The answer's own search results — none on an isolated arm, which has no tool. */
  ownEvidence: readonly SearchEvidence[];
  paperRead: boolean;
}

/**
 * A Citations press, in `reading()`'s order: the guard on each delta as it
 * arrived, then the ending, then the guard's end, then empty, then what was
 * read. `deltas` are the chunks as streamed; a non-streamed answer (the check's
 * replacement) is one chunk.
 */
export function acceptCitation(
  kind: StreamOutcome["kind"],
  deltas: readonly string[],
  input: CitationAcceptInput,
): Delivery {
  const guard = createQuoteGuard(allowedQuoteTexts(input.blocks, input.context, input.matched));
  let released = "";
  for (const d of deltas) {
    const step = guard.push(d);
    released += step.text;
    if (!step.ok) return { delivered: false, why: `the quote guard stopped it (${step.cause})`, ending: kind };
  }
  if (kind !== "finished") return { delivered: false, why: `Citations keeps only finished, not ${kind}`, ending: kind };
  const last = guard.end();
  released += last.text;
  if (!last.ok) return { delivered: false, why: `the quote guard stopped it at the end (${last.cause})`, ending: kind };
  const answer = released.trim();
  if (answer === "") return { delivered: false, why: "Citations refuses an empty answer", ending: kind };
  const provenance = provenanceOf(withSearchStep(input.findings, input.ownEvidence), input.matched?.url ?? null);
  if (provenance.extractsRead === 0 && !input.paperRead) {
    return { delivered: false, why: "Citations refuses an answer with no extract read and no paper", ending: kind };
  }
  return { delivered: true, answer, ending: kind };
}
