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
import { articleWithIds, underCacheFloor } from "./article-prompt.js";
import { anthropicCallFailed } from "./anthropic-call.js";
import { isBodyEvidence } from "./block-policy.js";
import { stageFailure } from "./job-failure.js";
import { MODEL_REFUSED } from "./messages.js";
import { streamMessage, wasRefused } from "./messages-stream.js";
import { effortFor, generatorFor, type ModelPower, modelFor } from "./models.js";
import { parseJsonAnswer } from "./parse-json.js";
import {
  assertNoBlockIdEnums,
  validateAnthropicJsonSchema,
  withMessagesJsonSchema,
} from "./messages-structured-output.js";
import { plainWords } from "./plain-words.js";
import { hashProfile, PROFILE_RULES, profileSection } from "./profile.js";
import { paperwork } from "./paperwork.js";
import { checkLevel, type CheckOutcome, SIMPLE_CHECK_ENABLED, SIMPLE_CHECK_VERSION } from "./simple-check.js";
import {
  type BlockFingerprint,
  fallbackHeadTitle,
  type MetaFingerprintWithUrl,
} from "./source-hash.js";
import { budgetFor, truncationFailure } from "./token-budget.js";
import {
  SIMPLE_ARTIFACT_VERSION,
  SIMPLE_LEVELS,
  SIMPLE_LIMITS,
  SIMPLE_MAX_IDS,
  type BlockId,
  type Meta,
  type SimpleLatestCheckAttempts,
  type SimpleCheckFlag,
  type SimpleLevel,
  type SimpleLevelCheck,
  type SimpleRetryFailure,
  type SimpleParagraph,
  type SimpleSummary,
  type Tree,
} from "./types.js";

export type { SimpleLevel, SimpleParagraph, SimpleSummary } from "./types.js";
export { SIMPLE_LEVELS } from "./types.js";

/**
 * **The stored shape's version**, stamped into the artefact as `version`.
 * Bumped only when what is stored changes shape, because `isUsableSimpleSummary`
 * (src/types.ts) requires an exact match and reads anything else as absent.
 *
 * `simple/2` (2026-10-01) is three levels and the profile. A `simple/1` row has
 * no `levels` and reads as absent.
 */
export const SIMPLE_VERSION = SIMPLE_ARTIFACT_VERSION;

/**
 * **The prompt's version**, bumped whenever the wording changes what a level
 * says. Stamped as `promptVersion`, and what the pipeline's stamp, Metadata and
 * the owner's `outdated` compare (src/pipeline.ts, src/store/pg.ts). Split from
 * `SIMPLE_VERSION` on 2026-10-01, when the paperwork rule and the shorter Brief
 * changed the prompt and not the shape: bumping the shape would have made every
 * stored summary unreadable (GPT Sol's plan review of 261001p, P1-3).
 *
 * `simple-prompt/2` (2026-10-01): the paperwork rule (src/paperwork.ts), an
 * ending on the takeaway, a shorter Brief (Greg, SPIDERYARN-READING2-8M, -8F).
 *
 * `simple-prompt/3` (2026-10-02): the request gained
 * `SIMPLE_SUMMARY_OUTPUT_SCHEMA`; the prompt text is unchanged.
 */
export const SIMPLE_PROMPT_VERSION = "simple-prompt/3";

/** The prompt a stored summary was written with; a row from before the field is the first. */
export function simplePromptVersion(simple: SimpleSummary): string {
  return simple.promptVersion ?? "simple-prompt/1";
}

/** Passages per paragraph. Extra ids are dropped and counted. */
export const MAX_IDS = SIMPLE_MAX_IDS;

/**
 * **The level asked first, with the others waiting until its stream has begun**
 * — so it writes the article's cache entry and they read it (plan 261001j).
 * Fuller, because it is the longest to write: starting it first keeps the
 * press's wait closest to the unstaggered one.
 */
export const FIRST_LEVEL: SimpleLevel = "fuller";

/** Asks per level: the first, and one more if its answer fails validation (`writeLevel`). */
export const LEVEL_ATTEMPTS = 2;

/**
 * One call's answer budget in tokens, sized for the larger level: Fuller's
 * word ceiling (480 words, ~640 tokens at 0.75 words a token, nearly doubled for
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
    shape: "Two short paragraphs, each two or three sentences; three only if the piece truly needs it",
    words: 80,
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

Keep it very simple: the one thing the piece is about, why it matters, and
what it concludes. At most one other key idea. Leave out anything a first-time
reader could do without.`,
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
- End on the takeaway: the piece's main conclusion, and any implication it
  states itself. Never advice or a consequence it does not give.

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

${paperwork("summary")}

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

/** The same answer contract for every level and every retry. */
export const SIMPLE_SUMMARY_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    paragraphs: {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: { type: "string" },
          ids: { type: "array", items: { type: "string" } },
        },
        required: ["text", "ids"],
        additionalProperties: false,
      },
    },
  },
  required: ["paragraphs"],
  additionalProperties: false,
} as const;

validateAnthropicJsonSchema(SIMPLE_SUMMARY_OUTPUT_SCHEMA);
assertNoBlockIdEnums(SIMPLE_SUMMARY_OUTPUT_SCHEMA, ["ids"]);

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
 * The instructions have their own `SIMPLE_PROMPT_VERSION`; the stored shape
 * has `SIMPLE_VERSION`, and the model has its own stamp field.
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

type LevelAttempt =
  | { ok: true; paragraphs: SimpleParagraph[]; tally: SimpleDropped }
  | { ok: false; error: unknown };

/** Parse and validate one writer answer without making the retry loop a nested try/catch. */
function readLevelAttempt(raw: string, level: SimpleLevel, evidenceIds: ReadonlySet<string>): LevelAttempt {
  const tally = emptyDropped();
  try {
    return {
      ok: true,
      paragraphs: buildLevel(parseJsonAnswer<unknown>(raw, `the model's "${level}" answer`), level, evidenceIds, tally),
      tally,
    };
  } catch (error) {
    return { ok: false, error };
  }
}

/** The check record for text kept from the latest writer attempt. */
function checkedLatest(outcome: CheckOutcome, attempt: number, retriedAfterFlag: boolean): SimpleLevelCheck {
  if (outcome.kind === "flagged") {
    if (attempt !== 2) throw new Error("a first-attempt flag must spend its available retry");
    return { result: "flagged", attempts: 2, retriedAfterFlag, stored: 2, flags: outcome.flags };
  }
  const base: SimpleLatestCheckAttempts =
    attempt === 1
      ? { attempts: 1, retriedAfterFlag: false, stored: 1 }
      : { attempts: 2, retriedAfterFlag, stored: 2 };
  return outcome.kind === "passed"
    ? { result: "passed", ...base }
    : { result: "unchecked", ...base, failure: outcome.failure };
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
 * verify of it. **Every failure throws and writes nothing**, at every level:
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

/** The stamp around every validated level. */
function stamped(levels: Record<SimpleLevel, SimpleParagraph[]>, opts: StampOptions): SimpleSummary {
  return {
    version: SIMPLE_VERSION,
    promptVersion: SIMPLE_PROMPT_VERSION,
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
  /** Writer requests made, across every level and retry — three when nothing was asked twice. */
  calls: number;
  /**
   * The fidelity guard's calls and chat-wire tokens, **beside** the writer's
   * rather than added in: the chat wire counts cache reads inside its input
   * tokens and the Messages wire does not, so a sum would mean nothing.
   * Zero with the guard off.
   */
  checkCalls: number;
  checkInputTokens: number;
  checkOutputTokens: number;
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
  /**
   * The pipeline's shared-article hint. Simple now marks every prefix its own
   * three calls can cache, so this cannot override the selected model's floor.
   */
  cacheArticle?: boolean;
  /**
   * Which capable model writes it. Production passes
   * `powerFor("simple", articlePower)`; evals choose directly.
   */
  power: ModelPower;
  /**
   * Run the fidelity guard (src/simple-check.ts). Defaults to the switch,
   * `SIMPLE_CHECK_ENABLED`; tests pass it rather than flipping the constant.
   */
  guard?: boolean;
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
  /* What the checker quotes beside each paragraph: the same blocks' text. */
  const textOf = new Map(evidence.map((b) => [b.id as string, b.text]));
  const guard = opts.guard ?? SIMPLE_CHECK_ENABLED;
  const started = Date.now();
  const maxTokens = budgetFor("simple", ANSWER_TOKENS);
  const article = articleWithIds(meta, evidence);

  /* **One cache for the press's three calls** (plan 261001j). Fired together,
     three calls each pay the article in full — or, if it is marked, each pay
     the 1.25x cache write, because an entry cannot be read until the request
     writing it has begun (docs/project/prompt-caching.md § What breaks a
     cache, 4). So the article is marked, `FIRST_LEVEL` goes first, and the
     other two wait for its stream to begin: measured on three articles from
     cold, $0.142 a press became $0.090, for about two seconds more wait (16.2 s
     median against 14.2). Below the cache floor nothing can be cached, so
     the three go together, unmarked, as before. */
  const cacheable = !underCacheFloor(article, modelFor("simple", opts.power));
  const stagger = cacheable;
  /* `cacheArticle` used to be the only reason Simple marked its one request.
     Now the press itself supplies three readers, so every cacheable article is
     marked regardless of that pipeline hint. Conversely the hint cannot lower
     the selected model's physical floor: below it a marker is accepted and
     silently does nothing. */
  const markArticle = cacheable;
  /* How the first level's first call got going: its stream began; it ended
     without saying so; or it failed before it began. Settled once, so a call
     that never begins never strands the others. */
  type FirstCall = "started" | "ended" | "failed";
  let begun: (how: FirstCall) => void = () => {};
  const firstBegun = new Promise<FirstCall>((resolve) => {
    begun = resolve;
  });
  const user = renderPrompt(opts.profile);
  const dropped = emptyDropped();

  /* **All or none, and the losers do not run on.** The first level to
     fail aborts the others, so a failed press is not billed for a paragraph
     list nobody will keep. The job's own signal still stops all of them. */
  const sibling = new AbortController();
  const signal = opts.signal ? AbortSignal.any([opts.signal, sibling.signal]) : sibling.signal;
  const untilAborted = new Promise<void>((resolve) => {
    if (signal.aborted) resolve();
    else signal.addEventListener("abort", () => resolve(), { once: true });
  });

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

  let writerCalls = 0;
  let firstStarted = false;

  /** One request for one level: its answer, or a failure with usage when the provider answered. */
  const askLevel = async (
    level: SimpleLevel,
  ): Promise<{ raw: string; usage: Anthropic.Usage } | { failure: unknown; usage: Anthropic.Usage }> => {
    let message: Anthropic.Message;
    try {
      const call = streamMessage(
        "simple",
        withMessagesJsonSchema({
          max_tokens: maxTokens,
          thinking: { type: "adaptive" },
          output_config: { effort: effortFor("simple") },
          /* Article first, then this level's instructions: Ideas' article bytes. */
          system: [
            {
              type: "text" as const,
              text: article,
              ...(markArticle ? { cache_control: { type: "ephemeral" as const } } : {}),
            },
            { type: "text" as const, text: SIMPLE_SYSTEMS[level] },
          ],
          /* The reader goes here and nowhere earlier: after the breakpoint, so
             a profile never splits the article's cache entry (src/profile.ts §
             `profileSection`). */
          messages: [{ role: "user", content: user }],
        }, SIMPLE_SUMMARY_OUTPUT_SCHEMA),
        { power: opts.power, signal },
      );
      writerCalls += 1;
      call.onText(onText);
      if (level === FIRST_LEVEL) {
        call.onStart(() => {
          firstStarted = true;
          begun("started");
        });
      }
      /* `call.finalMessage()`, never `call.stream.finalMessage()` — the wrapper
         is what records what this call cost. src/messages-stream.ts. */
      message = await call.finalMessage();
    } catch (err) {
      if (level === FIRST_LEVEL) begun("failed");
      throw anthropicCallFailed(err);
    }
    if (wasRefused(message)) {
      /* With no raw start event, a refusal did not make the cache readable and
         has already lost the press. Keep the waiters closed until the outer
         failure path aborts them. If it did start, `begun` is already settled
         and the siblings were legitimately opened while the outcome was still
         unknown. */
      if (level === FIRST_LEVEL) begun("failed");
      return {
        failure: stageFailure(MODEL_REFUSED, {
          authored: `the model answered the "${level}" request with stop_reason: refusal`,
        }),
        usage: message.usage,
      };
    }
    if (message.stop_reason === "max_tokens") {
      if (level === FIRST_LEVEL) begun("failed");
      return {
        failure: truncationFailure("simple", maxTokens, ANSWER_TOKENS, {
          outputTokens: message.usage.output_tokens,
          answerChars: message.content
            .filter((b): b is Anthropic.TextBlock => b.type === "text")
            .reduce((n, b) => n + b.text.length, 0),
        }),
        usage: message.usage,
      };
    }
    const raw = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    /* A complete usable response is the fallback for a provider/SDK path that
       succeeds without exposing `message_start`: the cache write is finished,
       so the other two calls cannot be stranded. */
    if (level === FIRST_LEVEL) begun(firstStarted ? "started" : "ended");
    return { raw, usage: message.usage };
  };

  /**
   * **One level, with one second chance when its answer fails validation.**
   * All-or-none over three calls turns each level's small failure rate into a
   * press that fails about one time in twelve (plan 261001b § Ledger: 22 of 24
   * stored all three on the shipped settings; the losses there were a level one
   * word over its ceiling and a level whose ids matched no passage, and an
   * earlier run lost one to a stray character after the JSON).
   * Each is a fresh sample's problem, so that level alone is asked again —
   * once. A failed *call* (network, refusal, truncation, an abort) is not
   * retried here: those have their own handling, and the job can be re-run.
   *
   * A rejected attempt's tally is discarded, so `dropped` counts what the kept
   * answer lost. Every response's reported tokens are returned; a transport
   * failure has none to report here, while the ledger still records its call.
   */
  const writeLevel = async (level: SimpleLevel) => {
    /* A cancelled job must not open even the first paid request. The checks
       after the stagger wait cover cancellation while Fuller is in flight. */
    signal.throwIfAborted();
    const usages: Anthropic.Usage[] = [];
    const checked = { calls: 0, inputTokens: 0, outputTokens: 0 };
    /** A valid attempt the checker flagged, kept in case the retry it bought cannot be stored. */
    let flagged: { paragraphs: SimpleParagraph[]; tally: SimpleDropped; flags: SimpleCheckFlag[] } | null = null;
    const keep = (paragraphs: SimpleParagraph[], tally: SimpleDropped, attempts: number, check: SimpleLevelCheck | null) => {
      for (const k of Object.keys(dropped) as (keyof SimpleDropped)[]) dropped[k] += tally[k];
      return { paragraphs, usages, attempts, check, checked };
    };
    /* **The guard never costs a press.** If the retry a flag bought fails —
       its call or its validation — the flagged first attempt is stored, as it
       would have been with no guard at all. An abort is still an abort. */
    const fallBack = (err: unknown, retryFailure: SimpleRetryFailure) => {
      if (!flagged || signal.aborted) throw err;
      /* A flag on the first attempt is the only way to get here. */
      return keep(flagged.paragraphs, flagged.tally, LEVEL_ATTEMPTS, {
        result: "flagged",
        attempts: 2,
        retriedAfterFlag: true,
        stored: 1,
        retryFailure,
        flags: flagged.flags,
      });
    };
    if (stagger && level !== FIRST_LEVEL) {
      /* A first call that failed before it began fails the press (its first
         attempt has no flagged fallback), and the abort follows a few ticks
         later. Wait for it rather than opening two calls into it — they would
         be billed (Sol's plan review, P1). */
      const first = await Promise.race([
        firstBegun,
        untilAborted.then(() => "aborted" as const),
      ]);
      if (first === "failed") await untilAborted;
      signal.throwIfAborted();
    }
    for (let attempt = 1; ; attempt += 1) {
      let raw: string;
      try {
        const asked = await askLevel(level);
        usages.push(asked.usage);
        if ("failure" in asked) return fallBack(asked.failure, "call");
        raw = asked.raw;
      } catch (err) {
        return fallBack(err, "call");
      }
      const built = readLevelAttempt(raw, level, evidenceIds);
      if (!built.ok) {
        if (attempt >= LEVEL_ATTEMPTS || signal.aborted) return fallBack(built.error, "validation");
        continue;
      }
      const { paragraphs, tally } = built;
      if (!guard) return keep(paragraphs, tally, attempt, null);

      /* **The fidelity guard** (src/simple-check.ts, plan 261001i): only valid
         text is checked, and it shares this level's attempts with validation. */
      const result = await checkLevel(paragraphs, textOf, { signal });
      checked.calls += 1;
      checked.inputTokens += result.inputTokens;
      checked.outputTokens += result.outputTokens;
      /* A cancelled job, or a sibling that failed, is an abort — never a check
         that failed and a level stored unchecked. */
      signal.throwIfAborted();
      const { outcome } = result;
      if (outcome.kind === "flagged" && attempt < LEVEL_ATTEMPTS) {
        flagged = { paragraphs, tally, flags: outcome.flags };
        continue;
      }
      return keep(paragraphs, tally, attempt, checkedLatest(outcome, attempt, flagged !== null));
    }
  };

  /* `Promise.all` alone returns on the first rejection. That would let the
     step's spend collector close while the aborted siblings were still
     settling and recording their cost. Abort on the first failure, but drain
     every call before returning that first error. */
  let firstFailure: unknown;
  let failed = false;
  const settled = await Promise.allSettled(
    SIMPLE_LEVELS.map(async (level) => {
      try {
        return await writeLevel(level);
      } catch (err) {
        if (!failed) {
          failed = true;
          firstFailure = err;
          sibling.abort();
        }
        throw err;
      }
    }),
  );
  if (failed) throw firstFailure;
  const written = settled.map((result) => {
    if (result.status === "rejected") throw result.reason;
    return result.value;
  });
  const levels = Object.fromEntries(SIMPLE_LEVELS.map((level, i) => [level, written[i]!.paragraphs])) as Record<
    SimpleLevel,
    SimpleParagraph[]
  >;
  const sum = (pick: (u: Anthropic.Usage) => number | null | undefined) =>
    written.reduce((n, w) => n + w.usages.reduce((m, u) => m + (pick(u) ?? 0), 0), 0);

  const stamp = stamped(levels, {
    power: opts.power,
    slug: opts.article.slug,
    sourceHash,
    profile: opts.profile,
    elapsedMs: Date.now() - started,
  });
  /* The guard's record goes on the artefact, beside what it judged (plan
     261001i § The record): the ledger counts checker calls, but cannot say
     what they answered. With the guard off there is no record at all. */
  const simpleSummary: SimpleSummary = guard
    ? {
        ...stamp,
        check: {
          checker: SIMPLE_CHECK_VERSION,
          requestedModel: modelFor("simple-check", "standard"),
          levels: Object.fromEntries(
            SIMPLE_LEVELS.map((level, i) => {
              const check = written[i]!.check;
              if (!check) throw new Error(`the "${level}" level was written with the guard on and has no check record`);
              return [level, check];
            }),
          ) as Record<SimpleLevel, SimpleLevelCheck>,
        },
      }
    : stamp;
  const checkSum = (pick: (c: { calls: number; inputTokens: number; outputTokens: number }) => number) =>
    written.reduce((n, w) => n + pick(w.checked), 0);

  /* Nothing is written here — the caller writes through the store. */
  return {
    simpleSummary,
    blocks: blocks.length,
    words: Object.fromEntries(SIMPLE_LEVELS.map((l) => [l, paragraphWords(levels[l])])) as Record<SimpleLevel, number>,
    dropped,
    model: generatorFor(opts.power),
    /* Summed over all three calls. */
    inputTokens: sum((u) => u.input_tokens),
    outputTokens: sum((u) => u.output_tokens),
    cacheReadTokens: sum((u) => u.cache_read_input_tokens),
    cacheWriteTokens: sum((u) => u.cache_creation_input_tokens),
    maxTokens,
    calls: writerCalls,
    checkCalls: checkSum((c) => c.calls),
    checkInputTokens: checkSum((c) => c.inputTokens),
    checkOutputTokens: checkSum((c) => c.outputTokens),
    elapsedMs: Date.now() - started,
  };
}
