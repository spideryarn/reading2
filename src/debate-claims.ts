/**
 * Pipeline stage — **debate-claims**: the claims an article rests on that
 * someone outside could argue with, listed for Debate's Claims sub-mode so the
 * reader can pick which to check.
 *
 * docs/plans/261008i-debate-claims-picked-by-the-reader.md § 2 is the design;
 * docs/project/debate.md § The claims list is the summary.
 *
 * **There is no command line here.** Running it against one article is a job:
 *
 *   POST /api/jobs { slug, steps: ["debate-claims"] }
 *
 * and in the app a press on the Claims chip asks for it (src/web/activation.ts
 * § `activationForSources`). Arriving on Claims by a link, Back, a reload or a
 * last-view restore only reads.
 *
 * ## What it is, and what it is not
 *
 * - **No web search.** One Messages-wire call over the article, a few cents.
 *   The search is the check the reader asks for afterwards, one press at a
 *   time (plan § 3, a later stage). Debate's own search (src/debate.ts) is on
 *   OpenRouter's chat/completions wire because it needs the web plugin; this
 *   needs nothing of the kind, so it is on the Messages wire with `faq` and
 *   `relations`, sending Ideas' article block byte for byte.
 * - **Not Referee's list** (`src/referee-claims.ts`), which answers a different
 *   question for a peer reviewer. **Its anchoring rule is reused**: every quote
 *   is re-found in the block it names with `findQuote(…, "spaced")` and
 *   replaced by the article's own characters — src/referee-claims.ts says why
 *   `"spaced"` and not the default.
 * - **Document order, never a ranking**, and at most `MAX_LISTED_CLAIMS`.
 * - **Public**: a visitor to a shared article sees the list read-only, as every
 *   generated artefact (docs/project/mode.md § The artefact). The quote is the
 *   article's, the statement is the model's and labelled as such.
 *
 * Its counts of what validation dropped are stored and logged; they are never
 * a claim or a quote.
 */

import type Anthropic from "@anthropic-ai/sdk";
import type { Article } from "./article-input.js";
import { articleWithIds } from "./article-prompt.js";
import { anthropicCallFailed } from "./anthropic-call.js";
import { isBodyEvidence } from "./block-policy.js";
import { mintUniqueId } from "./ids.js";
import { finishedText, streamMessage } from "./messages-stream.js";
import {
  CAPABLE_MODEL,
  effortFor,
  generatorFor,
  sameGenerator,
  type ModelPower,
} from "./models.js";
import { parseJsonAnswer } from "./parse-json.js";
import {
  assertNoBlockIdEnums,
  validateAnthropicJsonSchema,
  withMessagesJsonSchema,
} from "./messages-structured-output.js";
import { findQuote } from "./quote-match.js";
import {
  checkpointKey,
  type BlockFingerprint,
  fallbackHeadTitle,
  type MetaFingerprintWithUrl,
} from "./source-hash.js";
import { budgetFor } from "./token-budget.js";
import { plainWords } from "./plain-words.js";
import { paperwork } from "./paperwork.js";
import type {
  Block,
  BlockId,
  DebateClaimList,
  DebateClaimListDropped,
  ListedClaim,
  Meta,
  Tree,
} from "./types.js";

export type { DebateClaimList, DebateClaimListDropped, ListedClaim } from "./types.js";

/**
 * Bumped whenever the prompt changes what a listed claim *is*. Exported so
 * tests compare against the constant rather than a literal.
 *
 * `debate-claims/1`, 2026-10-08: the first (plan 261008i, stage 2).
 */
export const PROMPT_VERSION = "debate-claims/1";

/** The plan's number: up to eight claims, a list to pick from rather than a tour. */
export const MAX_LISTED_CLAIMS = 8;

/** A claim's quote is a sentence or a clause. Over this it is dropped, never cut. */
export const MAX_QUOTE_CHARS = 300;

/** The statement is one short line. Longer is not one we show. */
export const MAX_STATEMENT_CHARS = 160;

/**
 * The answer budget in tokens, derived from the caps: a base for the JSON,
 * then per claim an id, the quote, the statement and their keys, at a
 * conservative three characters a token. The model is asked for at most eight,
 * but a few over the cap must still parse — they are counted, not lost to a
 * truncation — so the budget is for twelve.
 */
export const ANSWER_TOKENS =
  300 + 12 * Math.ceil((40 + MAX_QUOTE_CHARS + MAX_STATEMENT_CHARS + 60) / 3);

/**
 * What this list was written from: the exact dynamic article bytes sent to the
 * model — the cited metadata head and body blocks. The tree matters only when
 * it supplies the fallback title. The stamp in src/pipeline.ts hands this the
 * real, nullable meta, and so does `generateDebateClaims`.
 */
export function inputFingerprint(
  blocks: readonly BlockFingerprint[],
  tree: Tree,
  meta: MetaFingerprintWithUrl | null,
): string {
  const promptMeta = (meta ?? { title: fallbackHeadTitle(tree) }) as Meta;
  /* `BlockFingerprint.treatment` is a database string rather than Block's
     narrower union; the CHECK behind it permits only the same values, and
     `isBodyEvidence` is "not a supplement". */
  const evidence = blocks.filter((block) => block.treatment !== "supplement");
  return checkpointKey([
    "debate-claims-input/1",
    articleWithIds(promptMeta, evidence),
  ]);
}

/** Does this list still describe the rendered body and metadata head? */
export function isStale(
  list: DebateClaimList,
  blocks: readonly BlockFingerprint[],
  tree: Tree,
  meta: MetaFingerprintWithUrl | null,
): boolean {
  return list.sourceHash !== inputFingerprint(blocks, tree, meta);
}

/** Would a run today use a different prompt or model generation? */
export function isOutdated(list: Pick<DebateClaimList, "version" | "generator">): boolean {
  return list.version !== PROMPT_VERSION || !sameGenerator(list.generator, CAPABLE_MODEL);
}

export function emptyDropped(): DebateClaimListDropped {
  return { unknownIds: 0, unquoted: 0, tooLong: 0, duplicate: 0, overCap: 0, malformed: 0 };
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** A verified claim, with what the ordering and the duplicate check need. */
interface Located {
  blockId: BlockId;
  quote: string;
  statement: string;
  start: number;
  end: number;
}

/**
 * Turn what the model said into listed claims, believing as little as
 * possible. Pure.
 *
 * In the model's order: an unreadable item is `malformed`; a claim naming a
 * block id that is not in `blocks` is `unknownIds`; a quote `findQuote`
 * (`"spaced"`) cannot find in that block is `unquoted`; a located quote over
 * `MAX_QUOTE_CHARS` is `tooLong`; a second claim on the same words of the same
 * block is `duplicate`. Then the cap, in the model's order, so the claims the
 * model listed first are kept and the rest counted as `overCap`. Then document
 * order — block position, then where in the block — and an id each.
 *
 * **The stored quote is the article's characters**, `block.text.slice(start,
 * end)`, never what the model typed.
 */
export function toListedClaims(
  raw: readonly unknown[],
  blocks: readonly Block[],
  dropped: DebateClaimListDropped,
): ListedClaim[] {
  const byId = new Map(blocks.map((b) => [b.id as string, b]));
  const kept: Located[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      dropped.malformed++;
      continue;
    }
    const r = item as { blockId?: unknown; quote?: unknown; statement?: unknown };
    const blockId = text(r.blockId);
    const typed = text(r.quote);
    const statement = text(r.statement);
    if (!blockId || !typed || !statement || statement.length > MAX_STATEMENT_CHARS) {
      dropped.malformed++;
      continue;
    }
    const block = byId.get(blockId);
    if (!block) {
      dropped.unknownIds++;
      continue;
    }
    const span = findQuote(block.text, typed, undefined, "spaced");
    if (!span) {
      dropped.unquoted++;
      continue;
    }
    if (span.end - span.start > MAX_QUOTE_CHARS) {
      dropped.tooLong++;
      continue;
    }
    if (kept.some((k) => k.blockId === block.id && k.start === span.start && k.end === span.end)) {
      dropped.duplicate++;
      continue;
    }
    kept.push({
      blockId: block.id,
      quote: block.text.slice(span.start, span.end),
      statement,
      start: span.start,
      end: span.end,
    });
  }

  if (kept.length > MAX_LISTED_CLAIMS) {
    dropped.overCap += kept.length - MAX_LISTED_CLAIMS;
    kept.length = MAX_LISTED_CLAIMS;
  }

  const position = new Map<BlockId, number>();
  for (const [i, b] of blocks.entries()) position.set(b.id, i);
  const at = (c: Located): number => position.get(c.blockId) ?? Number.MAX_SAFE_INTEGER;
  const taken = new Set<string>();
  return [...kept]
    .sort((a, b) => at(a) - at(b) || a.start - b.start || a.end - b.end)
    .map(({ blockId, quote, statement }) => ({ id: mintUniqueId(taken), blockId, quote, statement }));
}

/**
 * The artefact, from what the model said plus what we could verify of it.
 *
 * **Three empty outcomes**, `faq`'s (src/faq.ts § `buildFaq`):
 * - no `claims` array — a failed answer, so it throws;
 * - `claims: []` — the model found no claim worth listing, a real answer;
 * - a non-empty array that validation empties — throws, with the counts, and
 *   nothing is written.
 */
export function buildDebateClaimList(
  parsed: { claims?: unknown },
  opts: {
    slug: string;
    blocks: readonly Block[];
    sourceHash: string;
    power: ModelPower;
    elapsedMs: number;
    dropped: DebateClaimListDropped;
  },
): DebateClaimList {
  if (!Array.isArray(parsed.claims)) {
    throw new Error(
      "The model's answer has no `claims` array in it, so there is nothing to read. " +
        "That is a failed answer rather than an empty one.",
    );
  }
  const d = opts.dropped;
  const claims = toListedClaims(parsed.claims, opts.blocks, d);
  if (parsed.claims.length > 0 && claims.length === 0) {
    throw new Error(
      `The model listed ${parsed.claims.length} claims and none of them could be anchored ` +
        "to the article, so there is nothing to write. " +
        `Dropped: ${d.unknownIds} naming a block id that is not in this article, ` +
        `${d.unquoted} whose quote could not be found in the block it named, ` +
        `${d.tooLong} quotes over ${MAX_QUOTE_CHARS} characters, ` +
        `${d.malformed} malformed, ${d.duplicate} duplicates.`,
    );
  }
  return {
    version: PROMPT_VERSION,
    generator: generatorFor(opts.power),
    slug: opts.slug,
    sourceHash: opts.sourceHash,
    claims,
    dropped: { ...d },
    generatedAt: new Date().toISOString(),
    elapsedMs: opts.elapsedMs,
  };
}

export const DEBATE_CLAIMS_SYSTEM = `You are listing the claims the article above rests on, so that a reader can
choose which of them to check against what others have written.

WHAT TO LIST

Up to ${MAX_LISTED_CLAIMS} claims that the article's argument depends on AND that
someone outside could argue with: a finding, a cause, a prediction, a
generalisation, a judgement of evidence, a claim about how something works.
For each, ask: if this were wrong, would the piece's argument be weaker? And
could a researcher, a critic or a practitioner reasonably dispute it or have
tested it? List it only if both answers are yes.

WHAT DOES NOT BELONG

- A definition, a description of the method, or a summary of what the article
  is about. Those are not claims anyone argues with.
- A plain fact nobody disputes: a date, a name, what a cited paper said.
- The same claim twice, in different words or in different places. List it
  once, where the article makes it most plainly.
- A tour of the sections, one claim each. Many sections make none worth
  listing; a few make two.

Fewer is fine. None is fine: if the piece makes no claim that someone outside
could argue with, return an empty list. A padded claim is worse than a
missing one.

FOR EACH CLAIM

Every block of the article above has an id like spya-k3m9qt.

  "blockId"   — MUST be one of the ids listed in the article, the paragraph
                where the article makes the claim. Never invent one.
  "quote"     — the ARTICLE'S OWN WORDS for the claim, copied VERBATIM from
                that block, character for character: the words, the spacing
                and the punctuation. Not a paraphrase, not tidied up, no "..."
                to skip words. The sentence or clause that makes the claim, at
                most ${MAX_QUOTE_CHARS} characters. A quote that is too long, or
                not found exactly in the block you named, is thrown away.
  "statement" — the claim in your own words: one short line, at most
                ${MAX_STATEMENT_CHARS} characters, that a reader can take in at a
                glance. Say what is claimed, with any condition the article
                attaches to it ("in mice", "since 2010"). Not a verdict on
                whether it is true, and not who said it.

${plainWords("explain")}

${paperwork("pick")}

OUTPUT

JSON only, no prose, no code fence:

{"claims": [
  {"blockId": "spya-k3m9qt", "quote": "...", "statement": "..."}
]}

THE ANSWER MUST PARSE. Inside a string, a straight double quote ends the
string, so if the article's quotation marks are straight ones, escape them as
\\". Never put a real line break inside a string.`;

/** The user message. Nothing about the reader: no profile is in this stamp. */
export const DEBATE_CLAIMS_PROMPT = `List up to ${MAX_LISTED_CLAIMS} claims this article rests on that someone outside could argue with. Fewer is fine, and none is fine.`;

const stringSchema = { type: "string" } as const;

/** The closed answer shape. `blockId` is a plain string, resolved after the parse. */
export const DEBATE_CLAIMS_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    claims: {
      type: "array",
      items: {
        type: "object",
        properties: { blockId: stringSchema, quote: stringSchema, statement: stringSchema },
        required: ["blockId", "quote", "statement"],
        additionalProperties: false,
      },
    },
  },
  required: ["claims"],
  additionalProperties: false,
} as const;

validateAnthropicJsonSchema(DEBATE_CLAIMS_OUTPUT_SCHEMA);
assertNoBlockIdEnums(DEBATE_CLAIMS_OUTPUT_SCHEMA, ["blockId"]);

export interface DebateClaimsRun {
  claimList: DebateClaimList;
  dropped: DebateClaimListDropped;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  maxTokens: number;
  elapsedMs: number;
}

export async function generateDebateClaims(opts: {
  /** The article, handed in — never a directory to open. src/article-input.ts. */
  article: Article;
  onProgress?: (detail: string) => void;
  signal?: AbortSignal;
  /** Mark the article as a cache breakpoint — see src/glossary.ts for the note. */
  cacheArticle?: boolean;
  /** Which capable model reads it — the article's High-powered AI setting (plan 260930f). */
  power: ModelPower;
}): Promise<DebateClaimsRun> {
  const { blocks, tree, meta: realMeta } = opts.article;

  /* **Two values, deliberately**, as src/faq.ts: the stub is for the prompt's
     head and the fingerprint gets the real nullable meta, which is what the
     stamp hashes. tests/meta-fallback-fingerprint.test.ts asks the property. */
  const meta: Meta = realMeta ?? ({ title: fallbackHeadTitle(tree) } as Meta);
  const sourceHash = inputFingerprint(blocks, tree, realMeta);

  /* The body only, as `ideas`, `faq` and Debate's old pass B sent it — and the
     quotes are verified against the same set, so an id from the bibliography
     is an invented one. */
  const evidence = blocks.filter(isBodyEvidence);
  const started = Date.now();
  const maxTokens = budgetFor("debate-claims", ANSWER_TOKENS);

  let message: Anthropic.Message;
  try {
    const call = streamMessage(
      "debate-claims",
      withMessagesJsonSchema(
        {
          max_tokens: maxTokens,
          thinking: { type: "adaptive" },
          output_config: { effort: effortFor("debate-claims") },
          /* Article first, then this stage's instructions: byte-identical to
             `ideas` and `faq` up to the breakpoint. */
          system: [
            {
              type: "text" as const,
              text: articleWithIds(meta, evidence),
              ...(opts.cacheArticle ? { cache_control: { type: "ephemeral" as const } } : {}),
            },
            { type: "text" as const, text: DEBATE_CLAIMS_SYSTEM },
          ],
          messages: [{ role: "user", content: DEBATE_CLAIMS_PROMPT }],
        },
        DEBATE_CLAIMS_OUTPUT_SCHEMA,
      ),
      { power: opts.power, ...(opts.signal ? { signal: opts.signal } : {}) },
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
        report(`listing its claims, ${Math.round(chars / 1000)}k characters so far`);
      });
    }

    /* `call.finalMessage()`, never `call.stream.finalMessage()` — the wrapper
       is what records what this call cost. src/messages-stream.ts. */
    message = await call.finalMessage();
  } catch (err) {
    throw anthropicCallFailed(err);
  }
  const raw = finishedText(message, "debate-claims", maxTokens, ANSWER_TOKENS);

  const dropped = emptyDropped();
  const claimList = buildDebateClaimList(
    parseJsonAnswer<{ claims?: unknown }>(raw, "the model's answer"),
    {
      power: opts.power,
      slug: opts.article.slug,
      blocks: evidence,
      sourceHash,
      elapsedMs: Date.now() - started,
      dropped,
    },
  );

  /* Nothing is written here — the caller writes through the store. */
  return {
    claimList,
    dropped,
    model: generatorFor(opts.power),
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
    cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
    maxTokens,
    elapsedMs: Date.now() - started,
  };
}
