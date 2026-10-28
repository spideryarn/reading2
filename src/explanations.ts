/**
 * Pipeline stage 5s — **Explanations**: the places a reader would get stuck,
 * each with a short explanation of the missing piece beside the author's
 * words. Greg's report spya-nkq6rj (2026-10-28): *"if you can tell that a user
 * is going to be confused by a paragraph, then perhaps you could flag it with
 * an explanation"*, *"if Opus is unsure itself, it should say so"*, *"it should
 * be clear if some of its responses are based on stuff that came from out the
 * article"*. The design is
 * docs/plans/261028c-explanations-of-confusing-passages-and-sources-feeding-the-margin.md
 * § The step, after GPT Sol's review of its first draft.
 *
 * **There is no command line here.** Running it against one article is a job:
 *
 *   POST /api/jobs { slug, steps: ["explanations"] }
 *
 * Not on import (`AUTO_MODE_STEPS`) and not on the margin's first open, until
 * Greg answers q-gkrkf5 and one live run has been read.
 *
 * ## What it shares, and what it does not
 *
 * **The request is Ideas' byte for byte up to the breakpoint**, as FAQ's is
 * (src/faq.ts): `articleWithIds(meta, blocks.filter(isBodyEvidence))` with the
 * cache breakpoint, then this stage's instructions. Its schema is its own, so
 * it shares no cached article (`ARTICLE_OUTPUT_FORMAT` in src/pipeline.ts).
 *
 * 1. **The reader's profile**, as `ideas`: `PROFILE_RULES` in the system, the
 *    profile in the user message after the cached article, and `profileHash`
 *    in the stamp, because who is reading decides what is confusing at all.
 * 2. **Every quote is verified FAQ's way** — a body block, `findQuote(…,
 *    "spaced")` in that block, the article's characters stored — and one more
 *    rule: **dropped if the words occur more than once in the block**, so a
 *    later underline in the prose can always find the one they mean (Sol's
 *    PR-7). An overlong quote is dropped, never cut.
 * 3. **Not a paraphrase, and not a lone term.** The nearest prose is the
 *    margin's own `explain` note (src/relations.ts): *a step, term or move
 *    likely to confuse this reader, unpicked*. Here the term is left to the
 *    Glossary, and what is asked for is the missing piece.
 * 4. **Two labels the model sets**, `sure` and `outside`, because nothing in
 *    code can check either. The text of an unsure one says what it is unsure of.
 * 5. **An empty list is a valid artefact**; a missing list, or a non-empty one
 *    validation empties, throws — `buildFaq`'s three outcomes.
 * 6. **Owner only**, as Marginalia's relation notes: nothing here reaches a
 *    visitor (src/sharing-steps.ts).
 */

import type Anthropic from "@anthropic-ai/sdk";
import type { Article } from "./article-input.js";
import { articleWithIds } from "./article-prompt.js";
import { anthropicCallFailed } from "./anthropic-call.js";
import { isBodyEvidence } from "./block-policy.js";
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
import { paperwork } from "./paperwork.js";
import { plainWords } from "./plain-words.js";
import { PROFILE_RULES, hashProfile, profileSection } from "./profile.js";
import { findOnlyQuote, findQuote } from "./quote-match.js";
import {
  articleWithIdsFingerprint,
  type BlockFingerprint,
  checkpointKey,
  fallbackHeadTitle,
  type MetaFingerprintWithUrl,
} from "./source-hash.js";
import { budgetFor } from "./token-budget.js";
import type {
  Block,
  BlockId,
  Explanation,
  Explanations,
  ExplanationsDropped,
  Meta,
  Tree,
} from "./types.js";

export type { Explanation, Explanations, ExplanationsDropped } from "./types.js";

/** Bumped whenever the prompt changes what an explanation *is*. */
export const PROMPT_VERSION = "explanations/1";

/** An explanation is a few sentences. Over this it is dropped, never cut. */
export const MAX_WORDS = 60;

/** A quote is a phrase or a sentence, FAQ's limit (src/faq.ts). Over this it is dropped, never cut. */
export const MAX_QUOTE_CHARS = 300;

/**
 * **How many an article may have**: one per six body paragraphs, at least
 * three and at most fifteen. The user message says the number and the prompt
 * says it is a ceiling; this keeps it, after every other rule, in the model's
 * order. The cap is what keeps a mark beside a passage a claim worth making
 * (explain-this-vision.md's worry, the plan's mitigation).
 */
export function explanationCap(paragraphs: number): number {
  return Math.min(15, Math.max(3, Math.ceil(paragraphs / 6)));
}

/** The body paragraphs the cap counts: body evidence of kind `text`. */
export function bodyParagraphs(blocks: readonly Pick<Block, "kind" | "treatment">[]): number {
  return blocks.filter((b) => isBodyEvidence(b) && b.kind === "text").length;
}

/**
 * The answer budget in tokens, from the field caps: per item an id, the quote,
 * sixty words (counted as a hundred tokens) and the punctuation, at a
 * conservative three characters a token for the quote. Undersizing does not
 * degrade: it throws `truncationFailure` and loses the pass.
 */
export const ANSWER_TOKENS = 400 + 15 * (Math.ceil((MAX_QUOTE_CHARS + 80) / 3) + 100);

/**
 * **The item's id: a short hash of where it is** — stable when a re-run finds
 * the same words in the same block, a new id otherwise. Best effort (Sol's
 * PR-14): nothing addresses an explanation by id across runs yet.
 */
export function explanationId(blockId: string, quote: string): string {
  return checkpointKey(["explanation-id/1", blockId, quote]);
}

/**
 * What this artefact was written from: the blocks, the tree (the fallback
 * title) and the cited head — `articleWithIdsFingerprint`, FAQ's. The profile
 * is a fourth value in the stamp, beside this, as `ideas`'.
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
  explanations: Explanations,
  blocks: readonly BlockFingerprint[],
  tree: Tree,
  meta: MetaFingerprintWithUrl | null,
): boolean {
  return explanations.sourceHash !== inputFingerprint(blocks, tree, meta);
}

/** Would a run today use a different prompt or model generation? */
export function isOutdated(explanations: Pick<Explanations, "version" | "generator">): boolean {
  return (
    explanations.version !== PROMPT_VERSION ||
    !sameGenerator(explanations.generator, CAPABLE_MODEL)
  );
}

export function emptyDropped(): ExplanationsDropped {
  return {
    malformed: 0,
    unknownIds: 0,
    unquoted: 0,
    tooLong: 0,
    ambiguous: 0,
    badText: 0,
    repeated: 0,
    overCap: 0,
  };
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** An explanation's words, one space apart, and how many there are. */
function words(v: unknown): { text: string; count: number } {
  const text = str(v).replace(/\s+/g, " ");
  return { text, count: text === "" ? 0 : text.split(" ").length };
}

/**
 * Turn what the model said into explanations, believing as little as possible.
 * Pure. Every rule runs before the cap, so a bad row never uses up a slot;
 * the cap keeps the model's first, and what is returned is in reading order.
 */
export function toExplanations(
  raw: readonly unknown[],
  body: readonly Block[],
  cap: number,
  dropped: ExplanationsDropped,
): Explanation[] {
  const byId = new Map(body.map((b) => [b.id as string, b]));
  const taken = new Set<string>();
  const kept: Explanation[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") {
      dropped.malformed++;
      continue;
    }
    const r = row as Record<string, unknown>;
    const blockId = str(r.blockId);
    const typed = str(r.quote);
    if (!blockId || !typed || typeof r.sure !== "boolean" || typeof r.outside !== "boolean") {
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
    /* Once, in the same comparison space the check above used: two matches
       are no answer, because an underline could not tell which is meant. */
    if (!findOnlyQuote(block.text, typed, "spaced")) {
      dropped.ambiguous++;
      continue;
    }
    const { text, count } = words(r.text);
    if (count === 0 || count > MAX_WORDS) {
      dropped.badText++;
      continue;
    }
    if (taken.has(blockId)) {
      dropped.repeated++;
      continue;
    }
    if (kept.length >= cap) {
      dropped.overCap++;
      continue;
    }
    taken.add(blockId);
    const quote = block.text.slice(span.start, span.end);
    kept.push({
      id: explanationId(block.id, quote),
      blockId: block.id,
      quote,
      text,
      sure: r.sure,
      outside: r.outside,
    });
  }
  const position = new Map<BlockId, number>();
  for (const [i, b] of body.entries()) position.set(b.id, i);
  /* One per block, so the block's position alone is the reading order. */
  return kept.sort((a, b) => (position.get(a.blockId) ?? 0) - (position.get(b.blockId) ?? 0));
}

/**
 * The artefact, from what the model said plus what we could verify of it.
 * `blocks` is the body evidence the model was shown.
 *
 * **Three empty outcomes**, `buildFaq`'s: no `explanations` array throws; an
 * empty one is a real answer; a non-empty one that validation empties throws,
 * with the counts, and nothing is written.
 */
export function buildExplanations(
  parsed: { explanations?: unknown },
  opts: {
    slug: string;
    blocks: readonly Block[];
    sourceHash: string;
    profileHash: string | null;
    power: ModelPower;
    elapsedMs: number;
    dropped: ExplanationsDropped;
  },
): Explanations {
  if (!Array.isArray(parsed.explanations)) {
    throw new Error(
      "The model's answer has no `explanations` array in it, so there is nothing to read. " +
        "That is a failed answer rather than an empty one.",
    );
  }
  const d = opts.dropped;
  const cap = explanationCap(bodyParagraphs(opts.blocks));
  const explanations = toExplanations(parsed.explanations, opts.blocks, cap, d);
  if (parsed.explanations.length > 0 && explanations.length === 0) {
    throw new Error(
      `The model wrote ${parsed.explanations.length} explanations and none of them could be ` +
        "kept, so there is nothing to write. " +
        `Dropped: ${d.unknownIds} naming a block that is not in this article's body, ` +
        `${d.unquoted} whose quote is not in the block it named, ` +
        `${d.ambiguous} whose words occur more than once in their block, ` +
        `${d.tooLong} quotes over ${MAX_QUOTE_CHARS} characters, ` +
        `${d.badText} empty or over ${MAX_WORDS} words, ${d.malformed} malformed, ` +
        `${d.repeated} second ones beside the same block.`,
    );
  }
  return {
    version: PROMPT_VERSION,
    generator: generatorFor(opts.power),
    slug: opts.slug,
    /* The store's spellings (`sourceHash`, `version`, `generator`,
       `profileHash`), which `stampOf` reads — src/store/artifacts.ts. */
    sourceHash: opts.sourceHash,
    profileHash: opts.profileHash,
    explanations,
    dropped: { ...d },
    generatedAt: new Date().toISOString(),
    elapsedMs: opts.elapsedMs,
  };
}

export const EXPLANATIONS_SYSTEM = `You are reading the article above as the reader described in the user
message — or, if there is no description, as a curious, intelligent reader who
has not studied this field. Your job is to find the few places where that
reader would get stuck, and for each to write a short explanation that gets
them moving again.

WHERE A READER GETS STUCK

Look for places where the reader can read every word and still not follow:

- A skipped step: the author goes from A to C, and B is what the reader is
  missing.
- A move whose point is not said: the author does something — introduces a
  case, changes the subject, makes a distinction — and the reader cannot tell
  why.
- Background the author assumes: the passage leans on something the field
  takes for granted and this reader does not know.
- A sentence whose structure hides its point: long, nested or inverted, so the
  claim is in there but hard to find.

WHAT DOES NOT BELONG

- The meaning of a single term. A word or phrase whose whole difficulty is
  what it means is the glossary's job, not yours. Explain a term only as part
  of a step, a move or background that is larger than the term.
- A paraphrase or summary of the passage. The reader has the passage. Say what
  is MISSING from it, not what it says.
- A place that is hard only because it is dense, where reading it again
  slowly is the whole remedy.
- Praise, agreement, disagreement or a verdict on whether the author is right.
- A place this reader would not stumble on. If the description says they know
  the field, do not explain what they know.

WRITING THE EXPLANATION

- At most ${MAX_WORDS} words: one to three short sentences.
- Supply the missing piece directly: the skipped step, the point of the move,
  the background, or the claim the structure hides. Do not start with "This
  passage" or "The author"; start with the piece itself.
- Write beside the author's words, not instead of them: the reader will go
  back and read the passage with your explanation in mind.
- Use the article first. Where the missing piece is not in the article and you
  must draw on what you know from elsewhere, set "outside" to true. Never
  present something from outside the article as if the article said it.
- If you are not sure your explanation is right, set "sure" to false and say,
  in the text, what you are unsure of. A plain "I am not sure whether…" is
  better than a confident guess. If you would be guessing about the whole
  thing, leave the place out.

WHERE IT IS

Every block of the article above has an id like spya-k3m9qt.

  "blockId" — MUST be one of the ids listed in the article. Never invent one.
  "quote"   — the words the reader would stumble on, copied VERBATIM from that
              block, character for character. A phrase or a sentence, at most
              ${MAX_QUOTE_CHARS} characters. Choose enough words that they occur
              only ONCE in the block. A quote that is not found exactly, is too
              long, or occurs twice in the block is thrown away.

At most one explanation per block.

HOW MANY

The user message gives an upper limit. It is a ceiling, not a target. Fewer is
fine. None is fine: a clear piece may have no place worth explaining, and then
return an empty list. A padded explanation is worse than a missing one. List
them most needed first.

${plainWords("explain")}

${paperwork("pick")}

${PROFILE_RULES}

OUTPUT

JSON only, no prose, no code fence:

{"explanations": [
  {
    "blockId": "spya-k3m9qt",
    "quote": "minimised over the latent variable",
    "text": "The model is not given z; it tries every value and keeps the one that fits best, so z stands for whatever the input leaves open.",
    "sure": true,
    "outside": false
  }
]}

THE ANSWER MUST PARSE. Inside a string, a straight double quote ends the
string, so if the article's quotation marks are straight ones, escape them as
\\". Never put a real line break inside a string.`;

/**
 * The user message: the ceiling, then who is reading. The profile goes here,
 * after the breakpoint, never in the system block — src/profile.ts §
 * `profileSection` says why. Exported for the test that pins both halves.
 */
export function renderPrompt(opts: { count: number; profile: string | null }): string {
  const who = profileSection(opts.profile);
  return `Find up to ${opts.count} places where this reader would get stuck, and explain each. Fewer is fine, and none is fine.${who ? `\n\n${who}` : ""}`;
}

function parseJson(raw: string): { explanations?: unknown } {
  return parseJsonAnswer<{ explanations?: unknown }>(raw, "the model's answer");
}

/**
 * The closed shape `EXPLANATIONS_SYSTEM` asks for. `blockId` is a plain string,
 * resolved after the parse and never an enum (`assertNoBlockIdEnums`,
 * docs/project/prompting-guide.md); the word limit is a code check.
 */
export const EXPLANATIONS_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    explanations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          blockId: { type: "string" },
          quote: { type: "string" },
          text: { type: "string" },
          sure: { type: "boolean" },
          outside: { type: "boolean" },
        },
        required: ["blockId", "quote", "text", "sure", "outside"],
        additionalProperties: false,
      },
    },
  },
  required: ["explanations"],
  additionalProperties: false,
} as const;

validateAnthropicJsonSchema(EXPLANATIONS_OUTPUT_SCHEMA);
assertNoBlockIdEnums(EXPLANATIONS_OUTPUT_SCHEMA, ["blockId"]);

export interface ExplanationsRun {
  explanations: Explanations;
  paragraphs: number;
  dropped: ExplanationsDropped;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  maxTokens: number;
  elapsedMs: number;
}

export async function generateExplanations(opts: {
  /** The article, handed in — never a directory to open. src/article-input.ts. */
  article: Article;
  /** Who is reading, already rendered — `renderProfile` in src/profile.ts — or null. */
  profile: string | null;
  onProgress?: (detail: string) => void;
  signal?: AbortSignal;
  /** Mark the article as a cache breakpoint — see src/glossary.ts for the note. */
  cacheArticle?: boolean;
  /** Which capable model writes it — the article's High-powered AI setting (plan 260930f). */
  power: ModelPower;
}): Promise<ExplanationsRun> {
  const { blocks, tree, meta: realMeta } = opts.article;

  /* **Two values, deliberately**, as src/faq.ts: the stub is for the prompt's
     head and the fingerprint gets the real nullable meta, which is what the
     stamp hashes. */
  const meta: Meta = realMeta ?? ({ title: fallbackHeadTitle(tree) } as Meta);
  const sourceHash = inputFingerprint(blocks, tree, realMeta);
  const profileHash = opts.profile ? hashProfile(opts.profile) : null;

  const evidence = blocks.filter(isBodyEvidence);
  const paragraphs = bodyParagraphs(evidence);
  const count = explanationCap(paragraphs);
  const started = Date.now();
  const maxTokens = budgetFor("explanations", ANSWER_TOKENS);

  let message: Anthropic.Message;
  try {
    const call = streamMessage(
      "explanations",
      withMessagesJsonSchema({
        max_tokens: maxTokens,
        thinking: { type: "adaptive" },
        output_config: { effort: effortFor("explanations") },
        /* Article first, then this stage's instructions: byte-identical to
           `ideas` and `faq` up to the breakpoint. */
        system: [
          {
            type: "text" as const,
            text: articleWithIds(meta, evidence),
            ...(opts.cacheArticle ? { cache_control: { type: "ephemeral" as const } } : {}),
          },
          { type: "text" as const, text: EXPLANATIONS_SYSTEM },
        ],
        messages: [{ role: "user", content: renderPrompt({ count, profile: opts.profile }) }],
      }, EXPLANATIONS_OUTPUT_SCHEMA),
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
        report(`up to ${count} explanations, ${Math.round(chars / 1000)}k characters so far`);
      });
    }

    /* `call.finalMessage()`, never `call.stream.finalMessage()` — the wrapper
       is what records what this call cost. src/messages-stream.ts. */
    message = await call.finalMessage();
  } catch (err) {
    throw anthropicCallFailed(err);
  }
  const raw = finishedText(message, "explanations", maxTokens, ANSWER_TOKENS);

  const dropped = emptyDropped();
  const explanations = buildExplanations(parseJson(raw), {
    slug: opts.article.slug,
    blocks: evidence,
    sourceHash,
    profileHash,
    power: opts.power,
    elapsedMs: Date.now() - started,
    dropped,
  });

  /* Nothing is written here — the caller writes through the store. */
  return {
    explanations,
    paragraphs,
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
