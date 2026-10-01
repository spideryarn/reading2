/**
 * Pipeline stage 5r — **Simple**: a few short paragraphs, in everyday words,
 * saying what the piece is about, why it matters and what its key ideas are,
 * each paragraph resting on the passages it came from. A sub-mode of Summary,
 * written at **three levels**, one call each, side by side: `brief`, `simple` and `fuller`.
 *
 * > explain it to me like I'm 12 or 15 … a summary of, at most, I suppose, a
 * > few short paragraphs using simple language, kind of minimizing jargon, or
 * > if it uses jargon, very sparingly and with a clear explanation. It just
 * > helps the reader orient
 * >
 * > — Greg, 2026-09-30 (SPIDERYARN-READING2-6E)
 *
 * > the Very-Simple and Moderately-Complex summaries should take into account
 * > User-Profile and Why-are-you-reading-it. ... If it's ELI12, maybe it should
 * > be ELI15, and then the Moderately-Complex might be +3 or something.
 * >
 * > — Greg, 2026-09-30 (SPIDERYARN-READING2-7A)
 *
 * docs/plans/260930i-simple-summaries-eli15-sub-mode.md is the first design,
 * and GPT Sol's review of it is where most of the validation below comes from;
 * docs/plans/261001b-summary-controls-in-one-row-and-two-plain-words-levels-shaped-by-profile-and-goal.md
 * added the second level and the profile.
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
 * 1. **Short, and capped by code.** More paragraphs, or more words, than a
 *    level's `SIMPLE_LIMITS` allow is a failure — never a cut, because a
 *    silently truncated orientation is a wrong one.
 * 2. **Every paragraph is a door.** Each names one to three body-evidence block
 *    ids; one left with none after validation is dropped, and fewer than the
 *    level's minimum left is a failure that stores nothing.
 * 3. **Every level or none.** Any level failing fails the run.
 *
 * ## The reader
 *
 * The shared profile machinery, as Glossary and Ideas use it: `PROFILE_RULES`
 * in the constant system prompt and `profileSection` after the breakpoint, in
 * the user message. **The profile moves the floor, not the level**: a
 * fifteen-year-old *who already knows what the reader says they know*, so a
 * reader who says they build AI systems is not told what a language model is.
 * The goal changes what the paragraphs lead with, never what the piece says.
 *
 * The profile is recorded as `profileHash` and is **not in `sourceHash`**: a
 * changed profile does not make the paragraphs stale (the owner's GET reports
 * `profileChanged`, and *Write it again* picks up the new one), and
 * `inputFingerprint` hashes the article and the profile-free user message the
 * pipeline's stamp can also compute (Sol's plan review, P1-1).
 *
 * ## The request — one call per level, side by side
 *
 * `articleWithIds(meta, blocks.filter(isBodyEvidence))` — Ideas' article block
 * byte for byte — then the level's `simpleSystem(level)`, and a user message
 * that is a constant plus the profile section. At `high` effort
 * (src/models.ts § `STAGE_EFFORT` has the numbers), so it shares Ideas' cached
 * prefix when a job holds both.
 *
 * **A call per level, not one asked for all.** The plan's first design was one
 * call writing two levels; measured, it made the model think five to twenty
 * times as long (1–15k reasoning tokens against 150–800 for one level) and the
 * wait went from 9–18 s to 24–134 s. So each level is its own call, the shape
 * the first plan measured, and they run at once: the wait is the slowest of
 * three short calls. **All or none** — the first to fail aborts the others,
 * and nothing is stored. Plan 261001b § Ledger has the tables.
 *
 * Its fingerprint hashes the exact rendered article it sends, as
 * src/crossrefs.ts's does, so a change the request cannot see (a supplement
 * block, a re-cut tree) does not mark a paid artefact stale.
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
import { effortFor, generatorFor, type ModelPower } from "./models.js";
import { parseJsonAnswer } from "./parse-json.js";
import { plainWords } from "./plain-words.js";
import { hashProfile, PROFILE_RULES, profileSection } from "./profile.js";
import {
  type BlockFingerprint,
  fallbackHeadTitle,
  type MetaFingerprintWithUrl,
} from "./source-hash.js";
import { budgetFor, truncationFailure } from "./token-budget.js";
import {
  SIMPLE_LEVELS,
  SIMPLE_LIMITS,
  SIMPLE_MAX_IDS,
  type BlockId,
  type Meta,
  type SimpleLevel,
  type SimpleParagraph,
  type SimpleSummary,
  type Tree,
} from "./types.js";

export type { SimpleLevel, SimpleParagraph, SimpleSummary } from "./types.js";
export { SIMPLE_LEVELS } from "./types.js";

/**
 * Bumped whenever the prompt changes what a paragraph *is*. The one constant:
 * stamped into the artefact by `buildSimpleSummary` and compared against by the
 * pipeline's stamp and the owner's read (src/pipeline.ts, src/store/pg.ts).
 *
 * `simple/2` (2026-10-01) is three levels and the profile. A `simple/1` row has
 * no `levels` and reads as absent (`isSimpleLevels`, src/types.ts).
 */
export const SIMPLE_VERSION = "simple/2";

/** Passages per paragraph. Extra ids are dropped and counted. */
export const MAX_IDS = SIMPLE_MAX_IDS;

/**
 * One call's answer budget in tokens, sized for the larger level: Fuller's
 * word ceiling (450 words, ~600 tokens at 0.75 words a token, doubled for
 * safety), plus three ids and the JSON around each of its paragraphs.
 * Undersizing does not degrade: it throws `truncationFailure` and loses the
 * whole pass.
 */
export const ANSWER_TOKENS =
  1_200 + Math.max(...SIMPLE_LEVELS.map((level) => SIMPLE_LIMITS[level].maxParagraphs)) * MAX_IDS * 10;

/*
 * **The word asks are below what the ceiling allows, on evidence.** The first
 * probe asked for "under 250 words" and got 261–339 at 15: the model runs about
 * a third over a total it is given. So the ask is the length we want to see
 * and the sentence cap does most of the work — a sentence limit is kept where a
 * total is not. Plan 260930i § Measuring it has both rounds.
 *
 * Lowered again with the reader (plan 261001b): asked for about 200, a
 * profiled Simple came back at up to 338 words, two runs in twelve over the
 * 320 ceiling; Fuller, asked for 300, reached 448 of its 450.
 *
 * **Three levels around the first version's length**, which came out at
 * 240–273 words (Greg, SPIDERYARN-READING2-7J and -7F): Brief short and very
 * simple, at twelve; Simple fairly simple and just under that length, at
 * fifteen; Fuller moderately complex and just over it, at eighteen — Greg's
 * *"+3 or something"* above fifteen (7A).
 */
const PITCH: Record<SimpleLevel, { reader: string; shape: string; words: number; sentence: number }> = {
  brief: {
    reader: "A bright twelve-year-old",
    shape: "Two or three short paragraphs, each two or three sentences",
    words: 100,
    sentence: 18,
  },
  simple: {
    reader: "A bright fifteen-year-old",
    shape: "Two to four paragraphs, each two to four sentences",
    words: 170,
    sentence: 25,
  },
  fuller: {
    reader: "A bright eighteen-year-old in their first year at university",
    shape: "Three to five paragraphs, each two to four sentences",
    words: 220,
    sentence: 30,
  },
};

/**
 * What a level may do beyond the plainest — said inside that level's own
 * prompt, never as a comparison with another version: a reader may read only
 * one, so none refers to another.
 */
const NOTCH_UP: Record<SimpleLevel, string> = {
  brief: `

Keep it very simple: the one thing the piece is about, why it matters, and at
most two key ideas. Leave out anything a first-time reader could do without.`,
  simple: "",
  fuller: `

You may keep more of the piece's own terms than a beginner's version would (each
still said in plain words where it first appears), and add one more layer of how
or why.`,
};

/**
 * The system prompt for one level. Constant per level — the reader goes in
 * the user message, after the breakpoint.
 */
export function simpleSystem(level: SimpleLevel): string {
  const p = PITCH[level];
  return `You are helping a reader get their bearings before they read the article above.

WHAT YOU WRITE

A short orientation in plain words: what the piece is about, why it matters,
and its key ideas. It is not a replacement for the article. It is what a reader
wants to know first, so that the article itself makes sense when they read it.

THE READER

${p.reader} who has not studied this field. Everyday words and short sentences.${NOTCH_UP[level]}

- Use jargon sparingly. Where you do use a term, say what it means in the same
  sentence, in everyday words. Never explain one hard word with another.
- Keep the author's key term where the reader will meet it in the article; it
  is their handhold. Say what it means.
- If the request describes the reader, what they say they already know counts
  as everyday words for them: use it without explaining it. Everything else
  stays at this pitch.

LENGTH

${p.shape}. Every sentence under ${p.sentence} words. About ${p.words} words in
all, and never more than ${p.words + 50}. Shorter is fine; this is an
orientation, not a digest, so leave detail to the article.${SYSTEM_TAIL}`;
}

const SYSTEM_TAIL = `

THE SHAPE

- First: what the piece is about — its question or its subject, and what kind
  of piece it is.
- Then: why it matters — why THE PIECE says it matters, not why you think it
  might.
- Then: its key ideas or findings.

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

${PROFILE_RULES}

OUTPUT

JSON only, no prose, no code fence:

{"paragraphs": [
  {"text": "...", "ids": ["spya-k3m9qt", "spya-p7w2dn"]}
]}

Plain text in "text": no markdown, no bullet points, no headings. Never put a
real line break inside a string, and escape any straight double quote as \\".`;

/** Each level's system prompt, built once. */
export const SIMPLE_SYSTEMS = Object.fromEntries(
  SIMPLE_LEVELS.map((level) => [level, simpleSystem(level)]),
) as Record<SimpleLevel, string>;

/**
 * The user message's constant half — and all of what `inputFingerprint` hashes
 * of it. The same for every level: the level is in the system prompt.
 */
const BASE_PROMPT = "Write the plain-words orientation for this article.";

/**
 * The user message: the constant ask, and the reader after it when there is
 * one. With no profile it is `BASE_PROMPT` byte for byte — `profileSection`
 * returns `""` — and the separator is added only when there is a section,
 * since that function supplies no leading newline (Sol's plan review, P2-8).
 */
export function renderPrompt(profile: string | null): string {
  const section = profileSection(profile);
  return section ? `${BASE_PROMPT}\n\n${section}` : BASE_PROMPT;
}

/**
 * What this artefact was written from: the exact article bytes the request
 * sends and the **profile-free** user message — crossrefs' approach
 * (src/crossrefs.ts § `inputFingerprint`, Sol F11 there). The profile is in
 * `profileHash`, not here, so the pipeline's stamp, which has no profile, can
 * compute the same value (Sol's plan review, P1-1). The tree is here only for
 * the fallback head title `articleWithIds` prints when there is no metadata.
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
  const request = [articleWithIds(renderedMeta, evidence), renderPrompt(null)];
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
 * What validation threw away, across every level. **Reported, logged, never
 * stored**: the artefact is the paragraphs and the stamp, and a reader has no
 * use for our checking's tally.
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

/** Words across a list of paragraphs. */
export function paragraphWords(paragraphs: readonly SimpleParagraph[]): number {
  return paragraphs.reduce((n, p) => n + wordCount(p.text), 0);
}

/** One paragraph's ids: known body evidence, first occurrence, at most `MAX_IDS`. */
function keptIds(raw: unknown, evidenceIds: ReadonlySet<string>, dropped: SimpleDropped): BlockId[] {
  const ids: BlockId[] = [];
  const seen = new Set<string>();
  for (const id of Array.isArray(raw) ? raw : []) {
    const s = typeof id === "string" ? id.trim() : "";
    if (!evidenceIds.has(s)) {
      dropped.unknownIds++;
    } else if (seen.has(s)) {
      dropped.duplicateIds++;
    } else {
      seen.add(s);
      if (ids.length >= MAX_IDS) dropped.overCap++;
      else ids.push(s as BlockId);
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
 * One level's answer, validated against its limits. Throws, naming the level,
 * on any failure — which is what lets the generator abort the other calls the
 * moment one level is lost.
 */
export function buildLevel(
  parsed: unknown,
  level: SimpleLevel,
  evidenceIds: ReadonlySet<string>,
  d: SimpleDropped,
): SimpleParagraph[] {
  const limits = SIMPLE_LIMITS[level];
  const list =
    parsed && typeof parsed === "object" ? (parsed as { paragraphs?: unknown }).paragraphs : undefined;
  if (!Array.isArray(list)) {
    throw new Error(
      `The model's "${level}" answer has no \`paragraphs\` array in it, so there is nothing to read at that level.`,
    );
  }
  if (list.length > limits.maxParagraphs) {
    throw new Error(
      `The model wrote ${list.length} "${level}" paragraphs and the limit is ${limits.maxParagraphs}. ` +
        "Nothing is kept rather than a cut-down version, because a truncated orientation is a wrong one.",
    );
  }
  const before = { ...d };
  const paragraphs = toParagraphs(list, evidenceIds, d);
  const words = paragraphWords(paragraphs);
  if (words > limits.maxWords) {
    throw new Error(
      `The model wrote ${words} "${level}" words and the limit is ${limits.maxWords}. ` +
        "Nothing is kept rather than a cut-down version.",
    );
  }
  if (paragraphs.length < limits.minParagraphs) {
    throw new Error(
      `Only ${paragraphs.length} of the model's ${list.length} "${level}" paragraphs could be tied to the ` +
        `article, and at least ${limits.minParagraphs} are needed, so there is nothing to write. ` +
        `Dropped: ${d.unanchored - before.unanchored} with no usable passage, ${d.empty - before.empty} empty, ` +
        `${d.malformed - before.malformed} malformed; ${d.unknownIds - before.unknownIds} ids not in this article's body.`,
    );
  }
  return paragraphs;
}

interface StampOptions {
  slug: string;
  /** The power it was written at — the stamp names the model (plan 260930f). */
  power: ModelPower;
  sourceHash: string;
  /** The rendered profile the requests carried, or null — recorded as its hash. */
  profile: string | null;
  elapsedMs: number;
}

/**
 * The artefact, from what the model said at each level plus what we could
 * verify of it. **Every failure throws and writes nothing**, at either level:
 * no `paragraphs` array, more paragraphs or words than its limits, or fewer
 * paragraphs surviving than its minimum. Every level or none.
 *
 * @param answers each level's parsed answer, `{ paragraphs: [...] }`.
 */
export function buildSimpleSummary(
  answers: Partial<Record<SimpleLevel, unknown>>,
  opts: StampOptions & {
    /** The body evidence the requests sent — the only ids a paragraph may name. */
    evidence: readonly { id: BlockId }[];
    dropped: SimpleDropped;
  },
): SimpleSummary {
  const evidenceIds = new Set(opts.evidence.map((b) => b.id as string));
  const levels = {} as Record<SimpleLevel, SimpleParagraph[]>;
  for (const level of SIMPLE_LEVELS) levels[level] = buildLevel(answers[level], level, evidenceIds, opts.dropped);
  return stamped(levels, opts);
}

/** The stamp around two validated levels. */
function stamped(levels: Record<SimpleLevel, SimpleParagraph[]>, opts: StampOptions): SimpleSummary {
  return {
    version: SIMPLE_VERSION,
    /* The model's name for this power — every staleness check compares against it. */
    generator: generatorFor(opts.power),
    slug: opts.slug,
    sourceHash: opts.sourceHash,
    generatedAt: new Date().toISOString(),
    elapsedMs: opts.elapsedMs,
    profileHash: opts.profile ? hashProfile(opts.profile) : null,
    levels,
  };
}

export interface SimpleSummaryRun {
  simpleSummary: SimpleSummary;
  blocks: number;
  /** Words kept, per level. */
  words: Record<SimpleLevel, number>;
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
  /**
   * Who is reading, already rendered — `renderProfile` in src/profile.ts — or
   * null. The job's frozen copy (`ctx.profile`), never resolved here.
   */
  profile: string | null;
  onProgress?: (detail: string) => void;
  signal?: AbortSignal;
  /** Mark the article as a cache breakpoint — see src/glossary.ts for the note. */
  cacheArticle?: boolean;
  /** Which capable model writes it — the article's High-powered AI setting (plan 260930f). */
  power: ModelPower;
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
  const evidenceIds = new Set(evidence.map((b) => b.id as string));
  const started = Date.now();
  const maxTokens = budgetFor("simple", ANSWER_TOKENS);
  const article = articleWithIds(meta, evidence);
  const user = renderPrompt(opts.profile);
  const dropped = emptyDropped();

  /* **All or none, and the losers do not run on.** The first level to
     fail aborts the others, so a failed press is not billed for a paragraph
     list nobody will keep. The job's own signal still stops all of them. */
  const sibling = new AbortController();
  const signal = opts.signal ? AbortSignal.any([opts.signal, sibling.signal]) : sibling.signal;

  let chars = 0;
  let last = 0;
  const onText = (delta: string) => {
    if (!opts.onProgress) return;
    chars += delta.length;
    const now = Date.now();
    if (now - last < 500) return;
    last = now;
    opts.onProgress(`${chars.toLocaleString("en-GB")} characters so far`);
  };

  const writeLevel = async (level: SimpleLevel) => {
    let message: Anthropic.Message;
    try {
      const call = streamMessage(
        "simple",
        {
          max_tokens: maxTokens,
          thinking: { type: "adaptive" },
          output_config: { effort: effortFor("simple") },
          /* Article first, then this level's instructions: Ideas' article bytes. */
          system: [
            {
              type: "text" as const,
              text: article,
              ...(opts.cacheArticle ? { cache_control: { type: "ephemeral" as const } } : {}),
            },
            { type: "text" as const, text: SIMPLE_SYSTEMS[level] },
          ],
          /* The reader goes here and nowhere earlier: after the breakpoint, so
             a profile never splits the article's cache entry (src/profile.ts §
             `profileSection`). */
          messages: [{ role: "user", content: user }],
        },
        { power: opts.power, signal },
      );
      call.onText(onText);
      /* `call.finalMessage()`, never `call.stream.finalMessage()` — the wrapper
         is what records what this call cost. src/messages-stream.ts. */
      message = await call.finalMessage();
    } catch (err) {
      throw anthropicCallFailed(err);
    }
    if (wasRefused(message)) {
      throw stageFailure(MODEL_REFUSED, {
        authored: `the model answered the "${level}" request with stop_reason: refusal`,
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
    const paragraphs = buildLevel(parseJsonAnswer<unknown>(raw, `the model's "${level}" answer`), level, evidenceIds, dropped);
    return { paragraphs, usage: message.usage };
  };

  const written = await Promise.all(
    SIMPLE_LEVELS.map((level) =>
      writeLevel(level).catch((err: unknown) => {
        sibling.abort();
        throw err;
      }),
    ),
  );
  const levels = Object.fromEntries(SIMPLE_LEVELS.map((level, i) => [level, written[i]!.paragraphs])) as Record<
    SimpleLevel,
    SimpleParagraph[]
  >;
  const sum = (pick: (u: Anthropic.Usage) => number | null | undefined) =>
    written.reduce((n, w) => n + (pick(w.usage) ?? 0), 0);

  const simpleSummary = stamped(levels, {
    power: opts.power,
    slug: opts.article.slug,
    sourceHash,
    profile: opts.profile,
    elapsedMs: Date.now() - started,
  });

  /* Nothing is written here — the caller writes through the store. */
  return {
    simpleSummary,
    blocks: blocks.length,
    words: Object.fromEntries(SIMPLE_LEVELS.map((l) => [l, paragraphWords(levels[l])])) as Record<SimpleLevel, number>,
    dropped,
    model: generatorFor(opts.power),
    /* Summed over both calls. */
    inputTokens: sum((u) => u.input_tokens),
    outputTokens: sum((u) => u.output_tokens),
    cacheReadTokens: sum((u) => u.cache_read_input_tokens),
    cacheWriteTokens: sum((u) => u.cache_creation_input_tokens),
    maxTokens,
    elapsedMs: Date.now() - started,
  };
}
