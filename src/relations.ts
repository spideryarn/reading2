/**
 * Pipeline stage 5q — **relations**: how each paragraph bears on the one
 * before it, as one word from a closed list of ten. Marginalia draws a few of
 * them as a small word beside the paragraph (so, but, vs); the rest are stored
 * and not drawn. docs/plans/261003f-marginalia-relation-words-and-timeline-events.md
 * § Stage 2 is the design, and GPT Sol's review of it is where the validation
 * rules below come from.
 *
 * **There is no command line here.** Running it against one article is a job:
 *
 *   POST /api/jobs { slug, steps: ["relations"] }
 *
 * ## What it shares with `faq`, and what it does not
 *
 * **The request is Ideas' byte for byte up to the breakpoint** —
 * `articleWithIds(meta, blocks.filter(isBodyEvidence))` first, carrying the
 * cache breakpoint, then this stage's instructions (src/models.ts §
 * `ARTICLE_RENDERER`). The fingerprint is FAQ's exactly.
 *
 * What it does not share:
 *
 * 1. **The model writes no prose.** It answers a block id and one of ten
 *    words, so there is no quote to verify and no plain-words rule to apply
 *    (`PLAIN_WORDS_EXEMPT`, src/plain-words.ts).
 * 2. **The model is told which paragraphs to answer**, in the user message,
 *    and must answer every one once. FAQ chooses its own passages.
 * 3. **A sparse answer fails.** FAQ's empty list is a real answer; here fewer
 *    than half the listed paragraphs answered throws, because a stored
 *    artefact with three words in it looks exactly like a quiet article (Sol
 *    P1-5).
 * 4. **An article with nothing to label spends nothing**: fewer than two body
 *    paragraphs stores an empty artefact without a model call.
 * 5. **Owner only.** Nothing here reaches a visitor — a relation word has no
 *    quote to check against its block, and a visitor's payload carries no
 *    staleness verdict (Sol P1-4). src/sharing-steps.ts.
 */

import type Anthropic from "@anthropic-ai/sdk";
import type { Article } from "./article-input.js";
import { articleWithIds } from "./article-prompt.js";
import { anthropicCallFailed } from "./anthropic-call.js";
import { isBodyEvidence } from "./block-policy.js";
import { stageFailure } from "./job-failure.js";
import { MODEL_REFUSED } from "./messages.js";
import { streamMessage, wasRefused } from "./messages-stream.js";
import { effortFor, generatorFor, type ModelPower } from "./models.js";
import { parseJsonAnswer } from "./parse-json.js";
import {
  assertNoBlockIdEnums,
  validateAnthropicJsonSchema,
  withMessagesJsonSchema,
} from "./messages-structured-output.js";
import {
  articleWithIdsFingerprint,
  type BlockFingerprint,
  fallbackHeadTitle,
  type MetaFingerprintWithUrl,
} from "./source-hash.js";
import { budgetFor, truncationFailure } from "./token-budget.js";
import { paperwork } from "./paperwork.js";
import {
  RELATIONS,
  type Block,
  type BlockId,
  type Meta,
  type Relation,
  type Relations,
  type RelationsDropped,
  type Tree,
} from "./types.js";

export type { Relation, Relations, RelationsDropped } from "./types.js";

/** Bumped whenever the prompt changes what a relation *is*, or which paragraphs are asked about. */
export const PROMPT_VERSION = "relations/1";

/**
 * A sentence's worth: fewer words than this is a heading, a date or a byline.
 *
 * **A twin of `PARAGRAPH_MIN_WORDS` in src/web/marginalia/notes.ts**, which
 * decides where the margin puts a part's question. Defined again here because
 * `src/` must not import from `src/web/`; tests/relations.test.ts holds the
 * two equal. Changing it changes which paragraphs are asked about, so it bumps
 * `PROMPT_VERSION`.
 */
export const PARAGRAPH_MIN_WORDS = 12;

/** One paragraph the model is asked about, and the paragraph it is read against. */
export interface EligibleParagraph {
  id: BlockId;
  /** The paragraph before it in the same list — not always the block before it. */
  previous: BlockId;
}

/**
 * **Which paragraphs get a word**: body text blocks of at least a sentence,
 * all but the first. "The one before" is the previous paragraph by the same
 * rule, the first included — so a heading, a figure or a one-line aside
 * between two paragraphs does not come between them.
 *
 * A paragraph after a heading is listed like any other: "but" across a section
 * break still means something.
 */
export function eligibleParagraphs(
  blocks: readonly Pick<Block, "id" | "kind" | "words" | "treatment">[],
): EligibleParagraph[] {
  const paragraphs = blocks.filter(
    (b) => isBodyEvidence(b) && b.kind === "text" && b.words >= PARAGRAPH_MIN_WORDS,
  );
  const out: EligibleParagraph[] = [];
  for (let i = 1; i < paragraphs.length; i++) {
    out.push({ id: paragraphs[i]!.id, previous: paragraphs[i - 1]!.id });
  }
  return out;
}

/**
 * The answer budget in tokens, sized to the list: one row is
 * `{"blockId":"spya-k3m9qt","relation":"for-example"},`, about twenty tokens,
 * counted as thirty, plus a base for the JSON around the list. Undersizing does
 * not degrade: it throws `truncationFailure` and loses the pass.
 */
export const TOKENS_PER_PARAGRAPH = 30;
export function answerTokens(paragraphs: number): number {
  return 200 + paragraphs * TOKENS_PER_PARAGRAPH;
}

/**
 * What this artefact was written from — `articleWithIdsFingerprint`, FAQ's
 * exactly: the blocks, the tree and the cited metadata head. No profile,
 * because who reads does not change how one paragraph follows another.
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
  relations: Relations,
  blocks: readonly BlockFingerprint[],
  tree: Tree,
  meta: MetaFingerprintWithUrl | null,
): boolean {
  return relations.sourceHash !== inputFingerprint(blocks, tree, meta);
}

export function emptyDropped(): RelationsDropped {
  return { unknown: 0, repeated: 0, offList: 0, missing: 0 };
}

const RELATION_SET: ReadonlySet<string> = new Set(RELATIONS);

/**
 * Turn what the model said into one relation per paragraph, believing as
 * little as possible. Pure.
 *
 * In the model's order: a row naming an id that was not asked about — or a row
 * with no readable id at all — is dropped (`unknown`); a second row for a
 * paragraph already answered is dropped and the first wins (`repeated`); a
 * word outside `RELATIONS` is dropped (`offList`) and does not use the
 * paragraph up. Listed paragraphs left with no answer are `missing`.
 *
 * **Fewer than half the listed paragraphs answered throws**, so the job fails
 * and nothing is stored. An empty list of paragraphs is an empty answer.
 */
export function toRelations(
  raw: unknown,
  eligibleIds: readonly BlockId[],
): { relations: Record<BlockId, Relation>; dropped: RelationsDropped } {
  if (!Array.isArray(raw)) {
    throw new Error(
      "The model's answer has no `relations` array in it, so there is nothing to read. " +
        "That is a failed answer rather than an empty one.",
    );
  }
  const asked: ReadonlySet<string> = new Set(eligibleIds);
  const dropped = emptyDropped();
  const found = new Map<string, Relation>();
  for (const row of raw as readonly unknown[]) {
    const r = row && typeof row === "object" ? (row as { blockId?: unknown; relation?: unknown }) : {};
    const blockId = typeof r.blockId === "string" ? r.blockId.trim() : "";
    if (!asked.has(blockId)) {
      dropped.unknown++;
      continue;
    }
    if (found.has(blockId)) {
      dropped.repeated++;
      continue;
    }
    const word = typeof r.relation === "string" ? r.relation.trim() : "";
    if (!RELATION_SET.has(word)) {
      dropped.offList++;
      continue;
    }
    found.set(blockId, word as Relation);
  }
  dropped.missing = eligibleIds.length - found.size;

  if (found.size * 2 < eligibleIds.length) {
    throw new Error(
      `The model answered ${found.size} of ${eligibleIds.length} paragraphs, fewer than half, ` +
        "so nothing is written: a sparse list would look like an article with few turns in it. " +
        `Dropped: ${dropped.unknown} naming a paragraph that was not asked about, ` +
        `${dropped.repeated} repeats, ${dropped.offList} with a word off the list.`,
    );
  }

  /* In the article's order rather than the model's, so the stored object reads
     top to bottom. */
  const relations = {} as Record<BlockId, Relation>;
  for (const id of eligibleIds) {
    const word = found.get(id);
    if (word) relations[id] = word;
  }
  return { relations, dropped };
}

export const RELATIONS_SYSTEM = `You are reading the article above one paragraph at a time, to say how each
paragraph follows from the one before it.

WHAT TO DO

The user message lists paragraphs by their ids (like spya-k3m9qt), in reading
order. Beside each is the id of the paragraph before it. For every listed
paragraph, say how it bears on that paragraph before it, by choosing exactly
one word from the list below.

Judge by what the paragraph DOES, not by its first word. A paragraph can push
back without saying "but", and one that opens with "So" may only be carrying
on.

THE TEN RELATIONS

  "therefore"   — it draws its conclusion from the one before.
  "but"         — it pushes back on the one before: an objection, a limit, a
                  reason to doubt it.
  "because"     — it gives the reason for the one before.
  "for-example" — it is an instance of the claim the one before made.
  "contrast"    — it is set against what came before, without denying it: the
                  other side, the other case, the other group.
  "zoom-in"     — the same subject, in more detail.
  "zoom-out"    — it steps back from the detail to the larger point.
  "new-thread"  — it starts something the one before did not lead to.
  "restates"    — it makes the same point again, in other words.
  "and-also"    — more of the same line of thought, with no change of
                  direction. This is the default: choose it when nothing else
                  clearly fits.

Most paragraphs in most pieces simply carry on. Choose "therefore", "but" or
"contrast" only when the paragraph really does turn that way.

THE RULES

- Answer every listed id exactly once, in the order listed.
- Answer only the listed ids. Never invent an id, and never answer for a
  paragraph that is not on the list.
- A paragraph that follows a heading is judged like any other, against the
  paragraph named beside it.
- "relation" must be one of the ten words above, spelled exactly as shown.

${paperwork("pick")}

A listed paragraph that is only paperwork still gets its one word, like every
other listed paragraph; "new-thread" or "and-also" will usually be right.

OUTPUT

JSON only, no prose, no code fence:

{"relations": [
  {"blockId": "spya-k3m9qt", "relation": "but"},
  {"blockId": "spya-p7x2wd", "relation": "and-also"}
]}`;

/** The user message: the paragraphs to answer, each beside the one before it. */
export function renderPrompt(paragraphs: readonly EligibleParagraph[]): string {
  const lines = paragraphs.map((p) => `${p.id} (the paragraph before it: ${p.previous})`);
  return `Say how each of these ${paragraphs.length} paragraphs bears on the paragraph before it. Answer every one, once, in this order.

=== THE PARAGRAPHS ===

${lines.join("\n")}`;
}

/**
 * The closed answer shape. `relation` is an enum of the ten words; `blockId`
 * is a plain string and is resolved after the parse, never an enum
 * (`assertNoBlockIdEnums`, docs/project/prompting-guide.md).
 */
export const RELATIONS_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    relations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          blockId: { type: "string" },
          relation: { type: "string", enum: [...RELATIONS] },
        },
        required: ["blockId", "relation"],
        additionalProperties: false,
      },
    },
  },
  required: ["relations"],
  additionalProperties: false,
} as const;

validateAnthropicJsonSchema(RELATIONS_OUTPUT_SCHEMA);
assertNoBlockIdEnums(RELATIONS_OUTPUT_SCHEMA, ["blockId"]);

export interface RelationsRun {
  relations: Relations;
  /** False when there was nothing to label and no model was called. */
  called: boolean;
  /** How many paragraphs the model was asked about. */
  paragraphs: number;
  dropped: RelationsDropped;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  maxTokens: number;
  elapsedMs: number;
}

export async function generateRelations(opts: {
  /** The article, handed in — never a directory to open. src/article-input.ts. */
  article: Article;
  onProgress?: (detail: string) => void;
  signal?: AbortSignal;
  /** Mark the article as a cache breakpoint — see src/glossary.ts for the note. */
  cacheArticle?: boolean;
  /** Which capable model reads it — the article's High-powered AI setting (plan 260930f). */
  power: ModelPower;
}): Promise<RelationsRun> {
  const { blocks, tree, meta: realMeta } = opts.article;

  /* **Two values, deliberately**, as src/faq.ts: the stub is for the prompt's
     head and the fingerprint gets the real nullable meta, which is what the
     stamp hashes. tests/meta-fallback-fingerprint.test.ts asks the property. */
  const meta: Meta = realMeta ?? ({ title: fallbackHeadTitle(tree) } as Meta);
  const sourceHash = inputFingerprint(blocks, tree, realMeta);

  /* The body only, applied at the call site as `ideas` does — the same bytes.
     The paragraphs asked about are a subset of it. */
  const evidence = blocks.filter(isBodyEvidence);
  const paragraphs = eligibleParagraphs(blocks);
  const eligibleIds = paragraphs.map((p) => p.id);
  const started = Date.now();

  const artefact = (
    relations: Record<BlockId, Relation>,
    dropped: RelationsDropped,
  ): Relations => ({
    version: PROMPT_VERSION,
    generator: generatorFor(opts.power),
    slug: opts.article.slug,
    sourceHash,
    relations,
    dropped: { ...dropped },
    generatedAt: new Date().toISOString(),
    elapsedMs: Date.now() - started,
  });

  /* Fewer than two body paragraphs: nothing has a paragraph before it. A real,
     empty artefact, and no call. */
  if (paragraphs.length === 0) {
    const dropped = emptyDropped();
    return {
      relations: artefact({} as Record<BlockId, Relation>, dropped),
      called: false,
      paragraphs: 0,
      dropped,
      model: generatorFor(opts.power),
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      maxTokens: 0,
      elapsedMs: Date.now() - started,
    };
  }

  const answer = answerTokens(paragraphs.length);
  const maxTokens = budgetFor("relations", answer);

  let message: Anthropic.Message;
  try {
    const call = streamMessage(
      "relations",
      withMessagesJsonSchema(
        {
          max_tokens: maxTokens,
          thinking: { type: "adaptive" },
          output_config: { effort: effortFor("relations") },
          /* Article first, then this stage's instructions: byte-identical to
             `ideas` and `faq` up to the breakpoint. */
          system: [
            {
              type: "text" as const,
              text: articleWithIds(meta, evidence),
              ...(opts.cacheArticle ? { cache_control: { type: "ephemeral" as const } } : {}),
            },
            { type: "text" as const, text: RELATIONS_SYSTEM },
          ],
          messages: [{ role: "user", content: renderPrompt(paragraphs) }],
        },
        RELATIONS_OUTPUT_SCHEMA,
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
        report(`${paragraphs.length} paragraphs, ${Math.round(chars / 1000)}k characters so far`);
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
    throw truncationFailure("relations", maxTokens, answer, {
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
  const parsed = parseJsonAnswer<{ relations?: unknown }>(raw, "the model's answer");
  const { relations, dropped } = toRelations(parsed.relations, eligibleIds);

  /* Nothing is written here — the caller writes through the store. */
  return {
    relations: artefact(relations, dropped),
    called: true,
    paragraphs: paragraphs.length,
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
