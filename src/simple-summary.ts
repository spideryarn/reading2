/**
 * Pipeline stage 5r — **Simple**: a few short paragraphs, in everyday words,
 * saying what the piece is about, why it matters and what its key ideas are,
 * each paragraph resting on the passages it came from. A sub-mode of Summary.
 *
 * > explain it to me like I'm 12 or 15 … a summary of, at most, I suppose, a
 * > few short paragraphs using simple language, kind of minimizing jargon, or
 * > if it uses jargon, very sparingly and with a clear explanation. It just
 * > helps the reader orient
 * >
 * > — Greg, 2026-09-30 (SPIDERYARN-READING2-6E)
 *
 * docs/plans/260930i-simple-summaries-eli15-sub-mode.md is the design, and GPT
 * Sol's review of it is where most of the validation below comes from.
 *
 * **There is no command line here.** Re-running it against one article is a job:
 *
 *   POST /api/jobs { slug, steps: ["simple"], force: ["simple"] }
 *
 * ## Why it is on the right side of vision.md's anti-goal
 *
 * It is the feature closest to *"trying to replace the words with quick and
 * easy summaries"*, so three things are enforced here rather than hoped for in
 * the prompt:
 *
 * 1. **Short, and capped by code.** More than `MAX_PARAGRAPHS` paragraphs, or
 *    more than `MAX_WORDS` words, is a failure — never a cut, because a
 *    silently truncated orientation is a wrong one.
 * 2. **Every paragraph is a door.** Each names one to three body-evidence block
 *    ids; one left with none after validation is dropped, and fewer than
 *    `MIN_PARAGRAPHS` left is a failure that stores nothing.
 * 3. **No profile** in v1, as `faq` has none.
 *
 * ## The request
 *
 * `articleWithIds(meta, blocks.filter(isBodyEvidence))` — Ideas' article block
 * byte for byte — then `SIMPLE_SYSTEM`, and a user message that is a constant.
 * At `high` effort, measured against `medium` (src/models.ts § `STAGE_EFFORT`
 * has the numbers), so it shares Ideas' cached prefix when a job holds both.
 * Its fingerprint
 * hashes the exact rendered strings it sends, as src/crossrefs.ts's does, so a
 * change the request cannot see (a supplement block, a re-cut tree) does not
 * mark a paid artefact stale.
 */

import { createHash } from "node:crypto";

import type Anthropic from "@anthropic-ai/sdk";
import type { Article } from "./article-input.js";
import { articleWithIds } from "./article-prompt.js";
import { anthropicCallFailed } from "./anthropic-call.js";
import { isBodyEvidence } from "./block-policy.js";
import { stageFailure } from "./job-failure.js";
import { MODEL_REFUSED } from "./messages.js";
import { streamMessage, wasRefused } from "./messages-stream.js";
import { CAPABLE_MODEL, effortFor } from "./models.js";
import { parseJsonAnswer } from "./parse-json.js";
import { plainWords } from "./plain-words.js";
import {
  type BlockFingerprint,
  fallbackHeadTitle,
  type MetaFingerprintWithUrl,
} from "./source-hash.js";
import { budgetFor, truncationFailure } from "./token-budget.js";
import type { BlockId, Meta, SimpleParagraph, SimpleSummary, Tree } from "./types.js";

export type { SimpleParagraph, SimpleSummary } from "./types.js";

/**
 * Bumped whenever the prompt changes what a paragraph *is*. The one constant:
 * stamped into the artefact by `buildSimpleSummary` and compared against by the
 * pipeline's stamp and the owner's read (src/pipeline.ts, src/store/pg.ts).
 */
export const SIMPLE_VERSION = "simple/1";

/** More is a failure, not a cut. */
export const MAX_PARAGRAPHS = 4;

/** Fewer surviving validation is a failure: nothing is stored. */
export const MIN_PARAGRAPHS = 2;

/** Passages per paragraph. Extra ids are dropped and counted. */
export const MAX_IDS = 3;

/**
 * The hard ceiling on the whole text, in words. The prompt asks for well
 * under 250; this leaves room for a model that runs a little long, and refuses
 * one that has written a digest rather than an orientation.
 */
export const MAX_WORDS = 320;

/**
 * The answer budget in tokens: at most four paragraphs of ~320 words in all
 * (~430 tokens at 0.75 words a token, doubled for safety), plus three ids and
 * the JSON around each. Undersizing does not degrade: it throws
 * `truncationFailure` and loses the whole pass.
 */
export const ANSWER_TOKENS = 1_000 + MAX_PARAGRAPHS * MAX_IDS * 10;

/**
 * **Who the paragraphs are pitched at.** Production ships one level, 15 (the
 * plan's § What v1 is: at 12, on a dense paper, a number, a direction or a
 * hedge is where it gets dropped). 12 exists so the stage-1 probe can put the
 * two side by side for Greg (evals/simple/probe.ts); no reader can ask for it.
 */
export type SimplePitch = 12 | 15;

/*
 * **The word asks are below what the ceiling allows, on evidence.** The first
 * probe asked for "under 250 words" and got 261–339 at 15 (two of three `high`
 * runs over `MAX_WORDS`), and "under 150" got 189–208 at 12: the model runs
 * about a third over a total it is given. So the ask is the length we want to
 * see and the sentence cap does most of the work — a sentence limit is kept
 * where a total is not. Plan 260930i § Measuring it has both rounds.
 */
const PITCH: Record<SimplePitch, { reader: string; shape: string; words: number; sentence: number }> = {
  15: {
    reader: "a curious fifteen-year-old who has not studied this field",
    shape: "Two to four paragraphs, each two to four sentences",
    words: 200,
    sentence: 25,
  },
  12: {
    reader: "a curious twelve-year-old who has not studied this field",
    shape: "Two or three paragraphs, each two or three sentences",
    words: 130,
    sentence: 18,
  },
};

/** The system prompt for a pitch. `SIMPLE_SYSTEM` is the one that ships. */
export function simpleSystem(pitch: SimplePitch): string {
  const p = PITCH[pitch];
  return `You are helping a reader get their bearings before they read the article above.

WHAT YOU WRITE

A short orientation in plain words: what the piece is about, why it matters,
and its key ideas. It is not a replacement for the article. It is what a reader
wants to know first, so that the article itself makes sense when they read it.

THE READER

${p.reader}. Everyday words and short sentences.

- Use jargon sparingly. Where you do use a term, say what it means in the same
  sentence, in everyday words. Never explain one hard word with another.
- Keep the author's key term where the reader will meet it in the article; it
  is their handhold. Say what it means.

THE SHAPE

- First: what the piece is about — its question or its subject, and what kind
  of piece it is.
- Then: why it matters — why THE PIECE says it matters, not why you think it
  might.
- Then: its key ideas or findings, in one or two paragraphs.

${p.shape}. Every sentence under ${p.sentence} words. About ${p.words} words in
all, and never more than ${p.words + 50}. Shorter is fine; this is an orientation,
not a digest, so leave detail to the article.

FAITHFUL, NOT JUST SIMPLE

- Plainer means equally specific. Keep the numbers, the direction of a
  finding, and the hedges ("may", "in mice", "in this sample"). Do not claim
  more certainty than the piece does.
- Only what the piece says. No outside knowledge presented as the piece's: no
  background, history, or consequences the article does not state.

WHERE EACH PARAGRAPH COMES FROM

Every paragraph lists the ids of the one to three blocks of the article above
that best support it. "ids" MUST be ids listed in the article; never invent one.
A paragraph with no id that checks out is thrown away — so a paragraph about
why it matters has to rest on where the piece says why it matters.

The ids go only in "ids". Never write an id, or "block …", in the text.

${plainWords("explain")}

OUTPUT

JSON only, no prose, no code fence:

{"paragraphs": [
  {"text": "...", "ids": ["spya-k3m9qt", "spya-p7w2dn"]}
]}

Plain text in "text": no markdown, no bullet points, no headings. Never put a
real line break inside a string, and escape any straight double quote as \\".`;
}

export const SIMPLE_SYSTEM = simpleSystem(15);

/** The user message — a constant, so the request is the article and the rules. */
export function renderPrompt(): string {
  return "Write the plain-words orientation for this article.";
}

/**
 * What this artefact was written from: the exact article bytes and user
 * message the request sends — crossrefs' approach (src/crossrefs.ts §
 * `inputFingerprint`, Sol F11 there). The tree is here only for the fallback
 * head title `articleWithIds` prints when there is no metadata.
 *
 * The instructions have their own `SIMPLE_VERSION`; the model has its own
 * stamp field.
 */
export function inputFingerprint(
  blocks: readonly BlockFingerprint[],
  tree: Tree,
  meta: MetaFingerprintWithUrl | null,
): string {
  /* `BlockFingerprint.treatment` is a database string rather than Block's
     narrower union; the CHECK behind it permits only the same values, and
     `isBodyEvidence` is "not a supplement". */
  const evidence = blocks.filter((block) => block.treatment !== "supplement");
  const renderedMeta: Meta = meta
    ? ({
        title: meta.title ?? fallbackHeadTitle(tree),
        ...(meta.byline == null ? {} : { byline: meta.byline }),
        ...(meta.siteName == null ? {} : { siteName: meta.siteName }),
        ...(meta.url == null ? {} : { url: meta.url }),
      } as Meta)
    : ({ title: fallbackHeadTitle(tree) } as Meta);
  const request = [articleWithIds(renderedMeta, evidence), renderPrompt()];
  return createHash("sha256")
    .update(`spya-simple-input/1\n${JSON.stringify(request)}`, "utf8")
    .digest("hex")
    .slice(0, 16);
}

/** Does this artefact still describe the article and its head? */
export function isStale(
  simple: SimpleSummary,
  blocks: readonly BlockFingerprint[],
  tree: Tree,
  meta: MetaFingerprintWithUrl | null,
): boolean {
  return simple.sourceHash !== inputFingerprint(blocks, tree, meta);
}

/**
 * What validation threw away. **Reported, logged, never stored**: the plan's
 * artefact is the paragraphs and the stamp, and a reader has no use for our
 * checking's tally.
 */
export interface SimpleDropped {
  /** A paragraph that was not an object. */
  malformed: number;
  /** A paragraph with no text. */
  empty: number;
  /** An id that is not a body-evidence block of this article (or not a string). */
  unknownIds: number;
  /** An id a paragraph had already named. */
  duplicateIds: number;
  /** Ids past the first `MAX_IDS` good ones. */
  overCap: number;
  /** A paragraph left with no id that checks out — every paragraph is a door. */
  unanchored: number;
}

export function emptyDropped(): SimpleDropped {
  return { malformed: 0, empty: 0, unknownIds: 0, duplicateIds: 0, overCap: 0, unanchored: 0 };
}

/** Words as a reader counts them: runs of non-space. */
export function wordCount(text: string): number {
  const t = text.trim();
  return t === "" ? 0 : t.split(/\s+/).length;
}

/** One paragraph's ids: known body evidence, first occurrence, at most `MAX_IDS`. */
function keptIds(raw: unknown, evidenceIds: ReadonlySet<string>, dropped: SimpleDropped): BlockId[] {
  const ids: BlockId[] = [];
  for (const id of Array.isArray(raw) ? raw : []) {
    const s = typeof id === "string" ? id.trim() : "";
    if (!evidenceIds.has(s)) {
      dropped.unknownIds++;
    } else if (ids.includes(s as BlockId)) {
      dropped.duplicateIds++;
    } else if (ids.length >= MAX_IDS) {
      dropped.overCap++;
    } else {
      ids.push(s as BlockId);
    }
  }
  return ids;
}

/**
 * Turn what the model said into paragraphs, believing as little as possible:
 * ids checked against **the exact body-evidence set sent**, deduplicated,
 * capped at `MAX_IDS`; an empty paragraph dropped; a paragraph with no
 * surviving id dropped. The model's order is kept — it is the shape the prompt
 * asked for (about → why → key ideas), not reading order.
 */
export function toParagraphs(
  raw: readonly unknown[],
  evidenceIds: ReadonlySet<string>,
  dropped: SimpleDropped,
): SimpleParagraph[] {
  const out: SimpleParagraph[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      dropped.malformed++;
      continue;
    }
    const r = item as { text?: unknown; ids?: unknown };
    const text = typeof r.text === "string" ? r.text.trim() : "";
    if (!text) {
      dropped.empty++;
      continue;
    }
    const ids = keptIds(r.ids, evidenceIds, dropped);
    if (ids.length === 0) {
      dropped.unanchored++;
      continue;
    }
    out.push({ text, ids });
  }
  return out;
}

/**
 * The artefact, from what the model said plus what we could verify of it.
 * **Every failure throws and writes nothing**: no `paragraphs` array, more than
 * `MAX_PARAGRAPHS`, more than `MAX_WORDS` in what survives, or fewer than
 * `MIN_PARAGRAPHS` surviving.
 */
export function buildSimpleSummary(
  parsed: unknown,
  opts: {
    slug: string;
    /** The body evidence the request sent — the only ids a paragraph may name. */
    evidence: readonly { id: BlockId }[];
    sourceHash: string;
    elapsedMs: number;
    dropped: SimpleDropped;
  },
): SimpleSummary {
  const list =
    parsed && typeof parsed === "object" ? (parsed as { paragraphs?: unknown }).paragraphs : undefined;
  if (!Array.isArray(list)) {
    throw new Error(
      "The model's answer has no `paragraphs` array in it, so there is nothing to read.",
    );
  }
  if (list.length > MAX_PARAGRAPHS) {
    throw new Error(
      `The model wrote ${list.length} paragraphs and the limit is ${MAX_PARAGRAPHS}. ` +
        "Nothing is kept rather than a cut-down version, because a truncated orientation is a wrong one.",
    );
  }
  const d = opts.dropped;
  const paragraphs = toParagraphs(list, new Set(opts.evidence.map((b) => b.id as string)), d);
  const words = paragraphs.reduce((n, p) => n + wordCount(p.text), 0);
  if (words > MAX_WORDS) {
    throw new Error(
      `The model wrote ${words} words and the limit is ${MAX_WORDS}. ` +
        "Nothing is kept rather than a cut-down version.",
    );
  }
  if (paragraphs.length < MIN_PARAGRAPHS) {
    throw new Error(
      `Only ${paragraphs.length} of the model's ${list.length} paragraphs could be tied to the ` +
        `article, and at least ${MIN_PARAGRAPHS} are needed, so there is nothing to write. ` +
        `Dropped: ${d.unanchored} with no usable passage, ${d.empty} empty, ${d.malformed} ` +
        `malformed; ${d.unknownIds} ids not in this article's body.`,
    );
  }
  return {
    version: SIMPLE_VERSION,
    /* `CAPABLE_MODEL`, the name — every staleness check compares against it. */
    generator: CAPABLE_MODEL,
    slug: opts.slug,
    sourceHash: opts.sourceHash,
    generatedAt: new Date().toISOString(),
    elapsedMs: opts.elapsedMs,
    paragraphs,
  };
}

export interface SimpleSummaryRun {
  simpleSummary: SimpleSummary;
  blocks: number;
  /** Words across the paragraphs kept. */
  words: number;
  dropped: SimpleDropped;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  maxTokens: number;
  elapsedMs: number;
}

export async function generateSimpleSummary(opts: {
  /** The article, handed in — never a directory to open. src/article-input.ts. */
  article: Article;
  onProgress?: (detail: string) => void;
  signal?: AbortSignal;
  /** Mark the article as a cache breakpoint — see src/glossary.ts for the note. */
  cacheArticle?: boolean;
  /**
   * **The probe's, not a reader's** (evals/simple/probe.ts): 15 ships. A
   * different pitch is a different prompt, so an artefact written at 12 would
   * carry `SIMPLE_VERSION` wrongly — nothing in the app passes it.
   */
  pitch?: SimplePitch;
}): Promise<SimpleSummaryRun> {
  const { blocks, tree, meta: realMeta } = opts.article;

  /* **Two values, deliberately** — the stub is for the prompt's head and the
     fingerprint gets the real nullable meta, which is what the stamp hashes.
     src/ideas.ts has the long version; tests/meta-fallback-fingerprint.test.ts
     asks the property. */
  const meta: Meta = realMeta ?? ({ title: fallbackHeadTitle(tree) } as Meta);
  const sourceHash = inputFingerprint(blocks, tree, realMeta);

  /* The body only, as `ideas` does — and ids are checked against the same set,
     so an id from the bibliography is an invented one. */
  const evidence = blocks.filter(isBodyEvidence);
  const started = Date.now();
  const maxTokens = budgetFor("simple", ANSWER_TOKENS);
  const system = opts.pitch === undefined || opts.pitch === 15 ? SIMPLE_SYSTEM : simpleSystem(opts.pitch);

  let message: Anthropic.Message;
  try {
    const call = streamMessage(
      "simple",
      {
        max_tokens: maxTokens,
        thinking: { type: "adaptive" },
        output_config: { effort: effortFor("simple") },
        /* Article first, then this stage's instructions: Ideas' article bytes. */
        system: [
          {
            type: "text" as const,
            text: articleWithIds(meta, evidence),
            ...(opts.cacheArticle ? { cache_control: { type: "ephemeral" as const } } : {}),
          },
          { type: "text" as const, text: system },
        ],
        messages: [{ role: "user", content: renderPrompt() }],
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
        report(`${chars.toLocaleString("en-GB")} characters so far`);
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
    throw truncationFailure("simple", maxTokens, ANSWER_TOKENS, {
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
  const simpleSummary = buildSimpleSummary(parseJsonAnswer<unknown>(raw, "the model's answer"), {
    slug: opts.article.slug,
    evidence,
    sourceHash,
    elapsedMs: Date.now() - started,
    dropped,
  });

  /* Nothing is written here — the caller writes through the store. */
  return {
    simpleSummary,
    blocks: blocks.length,
    words: simpleSummary.paragraphs.reduce((n, p) => n + wordCount(p.text), 0),
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
