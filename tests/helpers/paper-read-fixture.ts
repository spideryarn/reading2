/**
 * **A `read` paper, built the way src/paper-evidence.ts builds one** — the
 * canonical text, the chunks, the selection and the sent text all from that
 * module's own functions, so a test of what Investigate does with a read paper
 * is holding the same shapes `verifyPassage` will see. No fetch, no registry.
 */
import { createHash } from "node:crypto";

import {
  canonicalPaper,
  chunkPaper,
  PAPER_SELECTION_VERSION,
  type PaperRead,
  paperSentText,
  selectChunks,
} from "../../src/paper-evidence.js";

/** A sentence that can be quoted, and is in chunk c1 on page 1. */
export const PAPER_OPENING = "We study empirical scaling laws for language model performance on the cross-entropy loss.";
/** A sentence on page 2, in a later chunk. */
export const PAPER_FINDING = "The loss scales as a power-law with model size, dataset size, and the amount of compute used for training.";

/** Filler of `n` distinct-enough words, so chunks have size. */
function filler(n: number, seed: string): string {
  return Array.from({ length: n }, (_, i) => `${seed}${i % 37}`).join(" ");
}

export function paperRead(over: Partial<PaperRead> = {}): PaperRead {
  const pages = [
    { page: 1, lines: ["Scaling Laws for Neural Language Models", "Jared Kaplan", PAPER_OPENING, filler(300, "alpha")] },
    { page: 2, lines: [PAPER_FINDING, filler(300, "beta")] },
    { page: 3, lines: [filler(300, "gamma")] },
  ];
  const canonical = canonicalPaper(pages);
  const chunks = chunkPaper(canonical);
  const selected = selectChunks(chunks, { why: "power law loss model size", passages: [] });
  const sentText = paperSentText(chunks, selected);
  const chosen = new Set(selected);
  return {
    state: "read",
    requestedUrl: "https://arxiv.org/pdf/2001.08361",
    finalUrl: "https://arxiv.org/pdf/2001.08361",
    host: "arxiv.org",
    addressFrom: "arxiv",
    pages: pages.length,
    words: chunks.reduce((n, c) => n + c.words, 0),
    text: canonical.text,
    referencesCut: false,
    chunks,
    selected,
    sentWords: chunks.filter((c) => chosen.has(c.id)).reduce((n, c) => n + c.words, 0),
    sentText,
    sentSha256: createHash("sha256").update(sentText, "utf8").digest("hex"),
    matchedBy: "arxiv",
    registry: "agrees",
    selectionVersion: PAPER_SELECTION_VERSION,
    ...over,
  };
}

/** The chunk id a sentence of the fixture paper starts in. */
export function chunkOf(paper: PaperRead, sentence: string): string {
  const at = paper.text.indexOf(sentence);
  const chunk = paper.chunks.find((c) => c.start <= at && at < c.end);
  if (!chunk) throw new Error(`"${sentence.slice(0, 20)}…" is not in the fixture paper`);
  return chunk.id;
}

/** A chat completion carrying `content`, as `openRouterJson` hands one back. */
export function jsonAnswer(content: string, finish = "stop"): unknown {
  return { choices: [{ finish_reason: finish, message: { content } }] };
}
