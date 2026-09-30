/**
 * Pipeline stage 5q — **cross-references**: a short phrase in one block that
 * refers to what another block of the same article shows in detail, so a reader
 * can jump from a claim to the passage behind it.
 *
 * > So, for example, if it describes a result, then it would create an anchor
 * > link to the block that actually, you know, the results in detail that
 * > underlie that statement or conclusion. So you can always jump around the
 * > paper to get to the thing being described.
 * >
 * > — Greg, 2026-09-30 (SPIDERYARN-READING2-5Z)
 *
 * docs/plans/260930f-cross-reference-links-between-blocks-with-a-rich-hover-preview.md
 * is the design, and GPT Sol's review of it is where the validation table below
 * comes from.
 *
 * **There is no command line here.** Re-running it against one article is a job:
 *
 *   POST /api/jobs { slug, steps: ["crossrefs"], force: ["crossrefs"] }
 *
 * ## What it shares with `ideas`, and what it does not
 *
 * **The request is Ideas' byte for byte up to the breakpoint** —
 * `articleWithIds(meta, blocks.filter(isBodyEvidence))` — and the user message
 * carries the same skeleton, so Ideas' fingerprint is this stage's unchanged
 * (Sol F11: the fingerprint covers exactly the bytes sent). It thinks at
 * `medium` rather than `high`, so it shares no cached prefix with that group;
 * the after-import box queues each mode as its own job, which shares nothing
 * anyway.
 *
 * What it does not share:
 *
 * 1. **Two ids per row, and the phrase is checked in the RENDERED text of
 *    `from`**, not `block.text`: `renderedText(block.html)` is the text space
 *    src/web/annotate.ts marks in, and a phrase that occurs once in `block.text`
 *    and twice there is one the prose cannot place (Sol F4). The server gets the
 *    same string from the same html through jsdom — `renderedTextOf` below.
 * 2. **Every rule the prompt states is enforced**, each with a `dropped`
 *    counter (Sol F3). A rule the prompt asks for and the validator does not
 *    check holds until the first time it matters.
 * 3. **No id inheritance.** Nothing addresses a link, so a re-run replaces.
 * 4. **No profile**: which passage backs which claim does not depend on who is
 *    reading.
 * 5. **An empty `links: []` is a valid artefact** — a piece with nothing worth
 *    linking. A missing list, or a non-empty one that validation empties, throws.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { partsOf } from "./arc.js";
import type { Article } from "./article-input.js";
import { articleWithIds } from "./article-prompt.js";
import { anthropicCallFailed } from "./anthropic-call.js";
import { isBodyEvidence } from "./block-policy.js";
import { stageFailure } from "./job-failure.js";
import { jsdom } from "./jsdom-lazy.js";
import { MODEL_REFUSED } from "./messages.js";
import { streamMessage, wasRefused } from "./messages-stream.js";
import { CAPABLE_MODEL, effortFor } from "./models.js";
import { parseJsonAnswer } from "./parse-json.js";
import { quoteFinder, quoteFinderWithMultiplicity } from "./quote-match.js";
import {
  articleWithIdsFingerprint,
  type BlockFingerprint,
  fallbackHeadTitle,
  type MetaFingerprintWithUrl,
} from "./source-hash.js";
import { budgetFor, truncationFailure } from "./token-budget.js";
import type {
  Block,
  BlockId,
  Crossref,
  Crossrefs,
  CrossrefsDropped,
  Meta,
  Tree,
} from "./types.js";

export type { Crossref, Crossrefs, CrossrefsDropped } from "./types.js";

/**
 * Bumped whenever the prompt changes what a link *is*. Exported so tests
 * compare against the constant rather than a literal.
 *
 * `crossrefs/2`, 2026-09-30, after stage 1's first two real runs: a claim
 * linked to its backing is asked for FIRST, and citations of other works,
 * pull-quotes linked to their own original, and targets that add nothing are
 * named as not links. `/1` had given mostly "see Section 6" and "Figure 4C"
 * links on a paper, three citation lists linked to blocks citing the same
 * works, and ten pull-quotes linked to the sentence they repeat on an essay.
 */
export const PROMPT_VERSION = "crossrefs/2";

/** The hard ceiling on links, however long the article. */
export const MAX_LINKS = 60;

/** A phrase is at least this many words… */
export const MIN_PHRASE_WORDS = 2;

/** …and at most this many. Longer is a sentence, and a sentence underlined is a wash. */
export const MAX_PHRASE_WORDS = 12;

/**
 * The most links one article may carry: **`min(60, max(3, round(blocks / 4)))`**,
 * over the body blocks the model was shown. One link per four paragraphs is
 * already a lot of underlining; the cap is the first dial if it proves noisy
 * (the plan's § Assumptions).
 */
export function linkCap(blocks: number): number {
  return Math.min(MAX_LINKS, Math.max(3, Math.round(blocks / 4)));
}

/**
 * The answer budget in tokens for `cap` links: a base for the JSON around the
 * list, plus per link two ids, up to twelve words of phrase and the keys — about
 * 160 characters — at a conservative three characters a token. Undersizing
 * does not degrade: it throws `truncationFailure` and loses the whole pass.
 */
export function answerTokens(cap: number): number {
  return 300 + cap * Math.ceil(160 / 3);
}

/**
 * What this artefact was written from — Ideas' fingerprint, unchanged, because
 * the request is Ideas' (Sol F11). The stamp in src/pipeline.ts hands it the
 * real, nullable meta, and so does `generateCrossrefs`.
 */
export function inputFingerprint(
  blocks: readonly BlockFingerprint[],
  tree: Tree,
  meta: MetaFingerprintWithUrl | null,
): string {
  return articleWithIdsFingerprint(blocks, tree, meta);
}

/** Does this artefact still describe the article, tree and metadata? */
export function isStale(
  crossrefs: Crossrefs,
  blocks: readonly BlockFingerprint[],
  tree: Tree,
  meta: MetaFingerprintWithUrl | null,
): boolean {
  return crossrefs.sourceHash !== inputFingerprint(blocks, tree, meta);
}

export function emptyDropped(): CrossrefsDropped {
  return {
    unknownIds: 0,
    nearby: 0,
    length: 0,
    unquoted: 0,
    ambiguous: 0,
    overlap: 0,
    truncated: 0,
    malformed: 0,
  };
}

/**
 * Turn what the model said into links, believing as little as possible.
 *
 * **Three empty outcomes**:
 * - no `links` array — a failed answer, so it throws;
 * - `links: []` — the model found nothing worth linking, a real answer;
 * - a non-empty array that validation empties — throws, with the counts, and
 *   nothing is written over a good artefact.
 */
export function buildCrossrefs(
  parsed: { links?: unknown },
  opts: {
    slug: string;
    /** The whole article, in document order. Ids are checked against its body. */
    blocks: readonly Block[];
    sourceHash: string;
    elapsedMs: number;
    dropped: CrossrefsDropped;
  },
): Crossrefs {
  if (!Array.isArray(parsed.links)) {
    throw new Error(
      "The model's answer has no `links` array in it, so there is nothing to read. " +
        "That is a failed answer rather than an empty one.",
    );
  }
  const d = opts.dropped;
  const links = toLinks(parsed.links, opts.blocks, d);
  if (parsed.links.length > 0 && links.length === 0) {
    throw new Error(
      `The model named ${parsed.links.length} links and none of them could be kept, so there ` +
        "is nothing to write. " +
        `Dropped: ${d.unknownIds} naming a block id that is not in this article's body, ` +
        `${d.nearby} to their own block or the one beside it, ${d.length} under ` +
        `${MIN_PHRASE_WORDS} or over ${MAX_PHRASE_WORDS} words, ${d.unquoted} whose phrase is ` +
        `not in the block it named, ${d.ambiguous} whose phrase occurs more than once there, ` +
        `${d.overlap} overlapping an earlier link, ${d.malformed} malformed.`,
    );
  }
  return {
    version: PROMPT_VERSION,
    /* `CAPABLE_MODEL`, the name — every staleness check compares against it. */
    generator: CAPABLE_MODEL,
    slug: opts.slug,
    sourceHash: opts.sourceHash,
    links,
    dropped: { ...d },
    generatedAt: new Date().toISOString(),
    elapsedMs: opts.elapsedMs,
  };
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

interface RawLink {
  from?: unknown;
  phrase?: unknown;
  to?: unknown;
}

/** A link that passed every per-row rule, with what the overlap and cap passes need. */
interface Placed extends Crossref {
  /** The model's index, for the cap. */
  index: number;
  /** `from`'s position in the article, for document order. */
  at: number;
  /** The phrase's span in the rendered text of `from`. */
  start: number;
  end: number;
}

function words(phrase: string): number {
  return phrase.split(/\s+/).filter(Boolean).length;
}

/**
 * **The rendered text of a block** — what `renderedText` in
 * src/web/annotate.ts returns for the same html, computed the same way: a
 * detached `<div>` given the html as `innerHTML`, and its `textContent`. That
 * function builds its host with the browser's `document`; this one builds it
 * with jsdom's, once per call of the returned function's owner.
 *
 * **Not imported from annotate.ts**, which is a client module that reaches for
 * the global `document`; and not moved into a shared leaf, because a leaf the
 * browser loads may not import jsdom. What is shared is the definition — the
 * parser's own `textContent` of the same html — and the phrase-finding rule,
 * `quoteFinderWithMultiplicity(…, "spaced")` in src/quote-match.ts, which both
 * sides import.
 */
function renderedTexter(): (html: string) => string {
  let host: HTMLElement | null = null;
  return (html) => {
    if (host === null) {
      const { JSDOM } = jsdom();
      host = new JSDOM("").window.document.createElement("div");
    }
    host.innerHTML = html;
    return host.textContent ?? "";
  };
}

/**
 * Every row checked against every rule, in the order the plan's table gives,
 * each drop counted once under the first rule it fails. Then overlaps, in
 * document order; then the cap, in the model's order; then document order.
 */
export function toLinks(
  raw: readonly unknown[],
  blocks: readonly Block[],
  dropped: CrossrefsDropped,
): Crossref[] {
  const position = new Map<BlockId, number>();
  for (const [i, b] of blocks.entries()) position.set(b.id, i);
  /* The body only: the ids the model was shown. A real supplement id is one it
     could only have invented. */
  const evidence = blocks.filter(isBodyEvidence);
  const byId = new Map<string, Block>(evidence.map((b) => [b.id as string, b]));
  const rendered = renderedTexter();
  /* One reduced haystack per block, however many links start there. */
  const finders = new Map<
    string,
    { text: string; any: ReturnType<typeof quoteFinder>; once: ReturnType<typeof quoteFinderWithMultiplicity> }
  >();
  const finderFor = (block: Block) => {
    let f = finders.get(block.id);
    if (!f) {
      const t = rendered(block.html);
      /* `"spaced"`: the stored phrase is shown as the article's words, so a
         word split in two is not a match (src/quote-match.ts § passes). */
      f = { text: t, any: quoteFinder(t, "spaced"), once: quoteFinderWithMultiplicity(t, "spaced") };
      finders.set(block.id, f);
    }
    return f;
  };

  const placed: Placed[] = [];
  for (const [index, item] of raw.entries()) {
    if (!item || typeof item !== "object") {
      dropped.malformed++;
      continue;
    }
    const r = item as RawLink;
    const fromId = text(r.from);
    const typed = text(r.phrase);
    const toId = text(r.to);
    if (!fromId || !typed || !toId) {
      dropped.malformed++;
      continue;
    }
    const from = byId.get(fromId);
    const to = byId.get(toId);
    if (!from || !to) {
      dropped.unknownIds++;
      continue;
    }
    const at = position.get(from.id) ?? 0;
    const toAt = position.get(to.id) ?? 0;
    /* A self-link goes nowhere, and a link to the next paragraph is one the
       reader is about to read anyway. */
    if (Math.abs(at - toAt) <= 1) {
      dropped.nearby++;
      continue;
    }
    const n = words(typed);
    if (n < MIN_PHRASE_WORDS || n > MAX_PHRASE_WORDS) {
      dropped.length++;
      continue;
    }
    const f = finderFor(from);
    if (!f.any(typed)) {
      dropped.unquoted++;
      continue;
    }
    const span = f.once(typed);
    if (!span) {
      dropped.ambiguous++;
      continue;
    }
    placed.push({
      from: from.id,
      /* The article's characters, never the model's typing. */
      phrase: f.text.slice(span.start, span.end),
      to: to.id,
      index,
      at,
      start: span.start,
      end: span.end,
    });
  }

  /* Overlaps, first in document order wins: the reader meets the earlier
     phrase first, and one underline cannot lead to two places. */
  const byPlace = (a: Placed, b: Placed): number =>
    a.at - b.at || a.start - b.start || a.index - b.index;
  const kept: Placed[] = [];
  for (const p of [...placed].sort(byPlace)) {
    const clash = kept.some((k) => k.from === p.from && p.start < k.end && k.start < p.end);
    if (clash) {
      dropped.overlap++;
      continue;
    }
    kept.push(p);
  }

  /* The cap, in the model's order — the prompt asks for the most useful first,
     and "few and good" means the tail is what goes. */
  const cap = linkCap(evidence.length);
  const capped = [...kept].sort((a, b) => a.index - b.index);
  if (capped.length > cap) {
    dropped.truncated += capped.length - cap;
    capped.length = cap;
  }
  return capped.sort(byPlace).map(({ from, phrase, to }) => ({ from, phrase, to }));
}

export const CROSSREFS_SYSTEM = `You are adding links INSIDE the article above, from one place in it to another.

WHAT A LINK IS

A link joins a short phrase in one block to the ONE other block that holds the
detail behind it: the evidence, the result, the method, the figure or table, or
the derivation. Following it should answer "where does it say that?" or "show
me".

Good links, most valuable first:
- A CLAIM STATED BRIEFLY, linked to where the piece backs it up. An abstract,
  introduction, summary or conclusion states a finding or a conclusion
  ("reduced recall by 38%", "brains are not computers") and another block
  reports the result, shows the data, or makes the argument at length. Link
  the claim to that block. Look for these first: they are the reason this
  exists, and they are the ones a reader cannot find by themselves.
- The text refers back or forward to a part of itself ("as shown in the second
  experiment", "the method described below", "see Table 2", "Figure 4C").
  Link those words to that experiment, method, table or figure.

Point at the paragraph, figure or table that holds the detail rather than the
heading above it.

Not links:
- A mere mention of the same topic. Two paragraphs that both talk about sleep
  are not a link; a claim and the evidence for that claim are.
- A citation of ANOTHER work: "[9]", "[2–4,20]", "(Smith, 2020)", "Varley et
  al.". Those point outside this article. Never link them to a block that
  happens to cite the same work.
- A quotation pulled out of the text and displayed on its own, or any sentence
  that repeats another block word for word. Linking a repeat to its original
  shows the reader nothing new.
- A link whose target says no more than the phrase already says.
- A link from a block to itself, or to the block directly before or after it.

THE PHRASE

- 2 to 12 words, copied EXACTLY from the "from" block, character for character.
  Not a paraphrase, not tidied up.
- It must occur only ONCE in that block. If the words you want appear twice,
  choose a longer phrase that appears once.
- The words that make the claim or the reference, not the whole sentence.
- No two links may use overlapping words in the same block.

HOW MANY

Few and good. Only link where a careful reader would genuinely want to jump.
Put the most useful links first. Never exceed the number in the request. If the
piece has nothing worth linking, return an empty list.

THE IDS

"from" and "to" MUST be ids listed in the article above. Never invent one and
never guess at one you half-remember. A wrong id sends the reader to the wrong
paragraph, which is worse than no link.

OUTPUT

JSON only, no prose, no code fence:

{"links": [
  {"from": "spya-k3m9qt", "phrase": "reduced recall by 38%", "to": "spya-p2x7rd"}
]}

Nothing else in each row. Escape a double quote inside a string as \\". Never
put a real line break inside a string.`;

/** The user message: the cap, then the skeleton — which is why the tree is in the fingerprint. */
export function renderPrompt(opts: { tree: Tree; cap: number }): string {
  const skeleton = partsOf(opts.tree)
    .map((p, i) => `PART ${i + 1}: ${p.title}\n  ${p.gist ?? "(no gist)"}`)
    .join("\n\n");
  return `Link this article to itself: at most ${opts.cap} links. Fewer is fine, and none is fine.

=== ITS SHAPE ===

${skeleton}`;
}

function parseJson(raw: string): { links?: unknown } {
  return parseJsonAnswer<{ links?: unknown }>(raw, "the model's answer");
}

export interface CrossrefsRun {
  crossrefs: Crossrefs;
  blocks: number;
  dropped: CrossrefsDropped;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  maxTokens: number;
  elapsedMs: number;
}

export async function generateCrossrefs(opts: {
  /** The article, handed in — never a directory to open. src/article-input.ts. */
  article: Article;
  onProgress?: (detail: string) => void;
  signal?: AbortSignal;
  /** Mark the article as a cache breakpoint — see src/glossary.ts for the note. */
  cacheArticle?: boolean;
}): Promise<CrossrefsRun> {
  const { blocks, tree, meta: realMeta } = opts.article;

  /* **Two values, deliberately** — the stub is for the prompt's head and the
     fingerprint gets the real nullable meta, which is what the stamp hashes.
     src/ideas.ts has the long version; tests/meta-fallback-fingerprint.test.ts
     asks the property. */
  const meta: Meta = realMeta ?? ({ title: fallbackHeadTitle(tree) } as Meta);
  const sourceHash = inputFingerprint(blocks, tree, realMeta);

  /* The body only, applied here at the call site as `ideas` does — the same
     bytes. Ids are checked against the same set in `buildCrossrefs`. */
  const evidence = blocks.filter(isBodyEvidence);
  const cap = linkCap(evidence.length);
  const answer = answerTokens(cap);
  const started = Date.now();
  const maxTokens = budgetFor("crossrefs", answer);

  let message: Anthropic.Message;
  try {
    const call = streamMessage(
      "crossrefs",
      {
        max_tokens: maxTokens,
        thinking: { type: "adaptive" },
        output_config: { effort: effortFor("crossrefs") },
        /* Article first, then this stage's instructions: byte-identical to
           `ideas` up to the breakpoint. */
        system: [
          {
            type: "text" as const,
            text: articleWithIds(meta, evidence),
            ...(opts.cacheArticle ? { cache_control: { type: "ephemeral" as const } } : {}),
          },
          { type: "text" as const, text: CROSSREFS_SYSTEM },
        ],
        messages: [{ role: "user", content: renderPrompt({ tree, cap }) }],
      },
      { ...(opts.signal ? { signal: opts.signal } : {}) },
    );

    if (opts.onProgress) {
      const report = opts.onProgress;
      let chars = 0;
      let last = 0;
      call.onText((delta) => {
        chars += delta.length;
        const now = Date.now();
        if (now - last < 500) return;
        last = now;
        report(`up to ${cap} links, ${Math.round(chars / 1000)}k characters so far`);
      });
    }

    /* `call.finalMessage()`, never `call.stream.finalMessage()` — the wrapper
       is what records what this call cost. src/messages-stream.ts. */
    message = await call.finalMessage();
  } catch (err) {
    throw anthropicCallFailed(err);
  }
  if (wasRefused(message)) {
    throw stageFailure(MODEL_REFUSED, {
      authored: "the model answered with stop_reason: refusal",
    });
  }
  if (message.stop_reason === "max_tokens") {
    throw truncationFailure("crossrefs", maxTokens, answer, {
      outputTokens: message.usage.output_tokens,
      answerChars: message.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .reduce((n, b) => n + b.text.length, 0),
    });
  }

  const raw = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  const dropped = emptyDropped();
  const crossrefs = buildCrossrefs(parseJson(raw), {
    slug: opts.article.slug,
    blocks,
    sourceHash,
    elapsedMs: Date.now() - started,
    dropped,
  });

  /* Nothing is written here — the caller writes through the store. */
  return {
    crossrefs,
    blocks: blocks.length,
    dropped,
    model: CAPABLE_MODEL,
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
    cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
    maxTokens,
    elapsedMs: Date.now() - started,
  };
}

