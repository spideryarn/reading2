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
 * 7. **Two scores on every explanation** since `explanations/2` —
 *    `difficulty` and `centrality`, Glossary's names and range — so the band
 *    can order and threshold them as Glossary does. In the system block and
 *    the schema only: the first pass's user message is byte-identical, so a
 *    `/1` list reads as *outdated*, never falsely *stale*. A bad score drops
 *    the field and is counted (`ExplanationScoreDrops`), never the explanation.
 * 8. **Find more appends**, Quotes' way (src/quotes.ts): `existingFor` decides,
 *    the step reads the previous list from the store
 *    (`previousExplanationsFrom`), and the second pass is told the places
 *    already explained and kept out of their blocks. Plan 261029e § 2c.
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
  type DifficultyCentralityDrops,
  noDifficultyCentralityDrops,
  scoreCounting,
} from "./score-fields.js";
import type { ArtifactStore } from "./store/artifacts.js";
import {
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

/**
 * Bumped whenever the prompt changes what an explanation *is*. `/2` (plan
 * 261029e) added the two scores.
 */
export const PROMPT_VERSION = "explanations/2";

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
export function bodyParagraphs(
  blocks: readonly { kind: Block["kind"]; treatment?: Block["treatment"] | null }[],
): number {
  return blocks.filter((b) => isBodyEvidence(b) && b.kind === "text").length;
}

/** `, "difficulty": 0.35, "centrality": 0.80` and its whitespace, generously — FAQ's `SCORE_CHARS`. */
export const SCORE_CHARS = 60;

/**
 * The answer budget in tokens, from the field caps: per item an id, the quote,
 * the two scores with their keys (`SCORE_CHARS`), sixty words (counted as a
 * hundred tokens) and the punctuation, at a conservative three characters a
 * token for everything but the words. Undersizing does not degrade: it throws
 * `truncationFailure` and loses the pass. Sol F8 on plan 261029e: the scores
 * must be counted, and tests/explanations.test.ts checks a full answer fits.
 */
export const ANSWER_TOKENS = 400 + 15 * (Math.ceil((MAX_QUOTE_CHARS + 80 + SCORE_CHARS) / 3) + 100);

/**
 * **The scores the prompt required, and did not get. Counts of FIELDS** —
 * src/score-fields.ts has the absent/rejected split. Logged by the step, never
 * stored: it is a fact about our prompt, not about the reader's article. The
 * twin of `GlossaryScoreDrops`.
 */
export type ExplanationScoreDrops = DifficultyCentralityDrops;

/** A fresh set. One per run, threaded by hand so nothing sums two runs. */
export const noExplanationScoreDrops = noDifficultyCentralityDrops;

/**
 * **The item's id: a short hash of where it is** — stable when a re-run finds
 * the same words in the same block, a new id otherwise. Best effort (Sol's
 * PR-14): nothing addresses an explanation by id across runs yet.
 */
export function explanationId(blockId: string, quote: string): string {
  return checkpointKey(["explanation-id/1", blockId, quote]);
}

/** The block fields that can change either dynamic message sent to the model. */
export type ExplanationFingerprintBlock = Pick<Block, "id" | "text" | "kind"> & {
  treatment?: Block["treatment"] | null;
};

/**
 * What this artefact was written from: the exact dynamic request bytes — the
 * rendered body and cited head, plus the user message without its separately
 * hashed profile. The tree matters only when it supplies the fallback title.
 */
export function inputFingerprint(
  blocks: readonly ExplanationFingerprintBlock[],
  tree: Tree,
  meta: MetaFingerprintWithUrl | null,
): string {
  const promptMeta = (meta ?? { title: fallbackHeadTitle(tree) }) as Meta;
  /* Postgres supplies a nullable treatment while Block omits the body case;
     the database CHECK permits the same values, and body evidence here is
     precisely every block that is not a supplement. */
  const evidence = blocks.filter((block) => block.treatment !== "supplement");
  return checkpointKey([
    "explanations-input/1",
    articleWithIds(promptMeta, evidence),
    /* The profile has its own stamp field. The count does not, so keep the
       rest of the exact user message in the source hash. */
    renderPrompt({ count: explanationCap(bodyParagraphs(evidence)), profile: null }),
  ]);
}

/** Does this artefact still describe the request's rendered article and ceiling? */
export function isStale(
  explanations: Explanations,
  blocks: readonly ExplanationFingerprintBlock[],
  tree: Tree,
  meta: MetaFingerprintWithUrl | null,
): boolean {
  return explanations.sourceHash !== inputFingerprint(blocks, tree, meta);
}

/**
 * **Was this list written by an older prompt, or another model generation?**
 * One predicate for the read path's `outdated` (src/store/pg.ts) and for
 * `existingFor`, which makes a forced run on an outdated list a rewrite.
 *
 * **Older, not merely different** — Quotes' rule (src/quotes.ts §
 * `isOutdated`, Sol F2 on plan 261029e). In a rollback an older build meets a
 * list a newer prompt wrote; inequality would call it outdated and rewrite it
 * with the older prompt. So a version that is newer, or does not parse as
 * `explanations/<n>`, is current: appended to, never downgraded. (The
 * `explanations/1` build compared with `!==`; a rollback to it would offer a
 * rewrite of a `/2` list — accepted for an experimental, owner-only mode.)
 */
export function isOutdated(explanations: Pick<Explanations, "version" | "generator">): boolean {
  const stored = versionNumber(explanations.version);
  const current = versionNumber(PROMPT_VERSION);
  const older = stored !== null && current !== null && stored < current;
  return older || !sameGenerator(explanations.generator, CAPABLE_MODEL);
}

function versionNumber(version: string): number | null {
  const match = /^explanations\/(\d+)$/.exec(version);
  return match ? Number(match[1]) : null;
}

/**
 * **The list a forced run appends to — *Find more* — or null for a run that
 * writes a list of its own.** Glossary's three tests (src/glossary.ts §
 * `existingFor`), with Quotes' version rule:
 *
 * - **the same article** (`sourceHash`): a moved article's block ids and
 *   words may be gone, so extending it would add true lines to a list that is
 *   no longer true;
 * - **not outdated** (`isOutdated`): an older prompt's list has no scores, and
 *   appending scored places to it would leave the band ordering half a list;
 * - **the same profile, exactly**, either way round: who is reading decides
 *   what is confusing, so places found for a physicist are not merged with
 *   places found for nobody in particular. Stricter than `profileIsStale`,
 *   which does not count a cleared profile as a change — the question here is
 *   "may these be merged", not "should we warn".
 *
 * **One predicate for the step and the button.** `panelRunKind` below asks
 * this too, for the GET route's `panelRun`, so the band cannot say *Find more*
 * over a run that rewrites (Sol F1).
 */
export function existingFor(
  onDisk: Explanations | null,
  sourceHash: string,
  /** The profile the incoming run will use, hashed — or null for none. */
  profileHash: string | null,
): Explanations | null {
  if (!onDisk || onDisk.sourceHash !== sourceHash) return null;
  if (isOutdated(onDisk)) return null;
  /* `?? null`: a list from before the field existed was written for nobody. */
  if ((onDisk.profileHash ?? null) !== profileHash) return null;
  return onDisk;
}

/**
 * **What the band's run button will do** — append or rewrite — for its label:
 * *Find more* or *Write a new list*. Glossary's `panelRunKind`, through this
 * stage's own `existingFor`.
 *
 * `stale` stands in for the source test (`isStale` compares the same
 * fingerprint `existingFor` does). The press keeps **the list's own setting**
 * (useExplanations.ts § `more`): a plain list is run plainly, so it matches;
 * a profiled list is run with today's profile, so it matches only if today's
 * hashes the same — and not if the reader has changed it **or cleared it**,
 * which `profileChanged` deliberately does not count.
 *
 * `nowHash` is the hash of the reader's current profile, or null for none.
 */
export function panelRunKind(
  found: { explanations: Explanations; stale: boolean },
  nowHash: string | null,
): "append" | "rewrite" {
  const recorded = found.explanations.profileHash ?? null;
  const pressHash = recorded === null ? null : nowHash;
  const list = found.stale ? null : found.explanations;
  return existingFor(list, found.explanations.sourceHash, pressHash) ? "append" : "rewrite";
}

/**
 * There is a previous `explanations` artefact, this store cannot read it, and
 * we are not guessing which harmless case it would have been. The sibling of
 * `QuotesBaselineUnusable` (Sol F5 on plan 261029e).
 */
export class ExplanationsBaselineUnusable extends Error {
  constructor(readonly slug: string) {
    super(
      `explanations "${slug}": there is a previous explanations artefact and this store cannot ` +
        "read it — it will not parse, is of the wrong shape, or is past the size the store reads " +
        "back.\nA Find more would treat it as no list and write a fresh one over it, quietly.\n" +
        "Nothing has been written — the explanations are still the previous run's.\n" +
        "Put it back from a backup, or delete it deliberately if this article's explanations " +
        "really are starting again from nothing.",
    );
    this.name = "ExplanationsBaselineUnusable";
  }
}

/**
 * The previous explanations, **from the store** — what *Find more* extends.
 * Quotes' table (src/quotes.ts § `previousQuotesFrom`): none is a first run;
 * one whose `sourceHash` differs is `existingFor`'s to refuse; one the store
 * cannot read **fails the stage** rather than reading as none; a store fault
 * propagates.
 */
export async function previousExplanationsFrom(
  store: Pick<ArtifactStore, "readBaseline">,
  slug: string,
): Promise<Explanations | null> {
  const outcome = await store.readBaseline(slug, "explanations", "explanations");
  if (outcome.state === "unusable") throw new ExplanationsBaselineUnusable(slug);
  return outcome.state === "ok" ? outcome.value : null;
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
 *
 * `used` is the blocks the list being extended already explains — on a *Find
 * more* — so one-per-block holds across the whole list, and a second place in
 * a used block counts as `repeated`. `scores` counts the two score fields
 * (src/score-fields.ts), only for an explanation about to be kept.
 */
export function toExplanations(
  raw: readonly unknown[],
  body: readonly Block[],
  cap: number,
  dropped: ExplanationsDropped,
  scores: ExplanationScoreDrops = noExplanationScoreDrops(),
  used: Iterable<string> = [],
): Explanation[] {
  const byId = new Map(body.map((b) => [b.id as string, b]));
  const taken = new Set<string>(used);
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
    /* A valid first candidate owns the block even when the cap drops it. This
       keeps the one-per-block rule ahead of the cap for every later row, not
       only for rows before the ceiling is reached. */
    taken.add(blockId);
    if (kept.length >= cap) {
      dropped.overCap++;
      continue;
    }
    const quote = block.text.slice(span.start, span.end);
    /* The field, never the explanation: a bad score is dropped and counted. */
    const difficulty = scoreCounting(r.difficulty, scores, "difficultyAbsent", "difficultyRejected");
    const centrality = scoreCounting(r.centrality, scores, "centralityAbsent", "centralityRejected");
    kept.push({
      id: explanationId(block.id, quote),
      blockId: block.id,
      quote,
      text,
      sure: r.sure,
      outside: r.outside,
      ...(difficulty === undefined ? {} : { difficulty }),
      ...(centrality === undefined ? {} : { centrality }),
    });
  }
  return inReadingOrder(kept, body);
}

/**
 * One per block, so the block's position alone is the reading order. A block
 * the body no longer lists goes last, in the order it came — reachable only
 * for an old item whose block left the body evidence without the article
 * moving — and nothing else is reordered.
 */
function inReadingOrder(items: readonly Explanation[], body: readonly Block[]): Explanation[] {
  const position = new Map<BlockId, number>();
  for (const [i, b] of body.entries()) position.set(b.id, i);
  const at = (e: Explanation) => position.get(e.blockId) ?? body.length;
  return items
    .map((e, i) => ({ e, i }))
    .sort((a, b) => at(a.e) - at(b.e) || a.i - b.i)
    .map(({ e }) => e);
}

/**
 * The artefact, from what the model said plus what we could verify of it —
 * **and, on a *Find more*, the list it extends**. `blocks` is the body
 * evidence the model was shown.
 *
 * **Three empty outcomes on a first pass**, `buildFaq`'s: no `explanations`
 * array throws; an empty one is a real answer; a non-empty one that validation
 * empties throws, with the counts, and nothing is written.
 *
 * **On an append nothing short of a missing array throws** — Quotes' rule.
 * A pass that adds nothing is the piece having no more places worth
 * explaining: written back with `lastAdded: 0`, and the band says so, because
 * a *Find more* that found nothing otherwise looks exactly like a button that
 * did nothing (docs/reusable/silent-success.md). What it dropped is in the
 * stored, cumulative `dropped` and in the step's log line for the pass.
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
    /** This pass's drops, mutated in place. The artefact stores the cumulative sum. */
    dropped: ExplanationsDropped;
    /** The scores the model did not give us — logged by the caller, never stored. */
    scores?: ExplanationScoreDrops;
    /** The list this pass appends to — `existingFor` — or null/absent for a list of its own. */
    existing?: Explanations | null;
    /**
     * When this pass finished, as an ISO string: one value for every new
     * item's `addedAt` and the list's `generatedAt`. Absent means now.
     */
    now?: string;
  },
): Explanations {
  if (!Array.isArray(parsed.explanations)) {
    throw new Error(
      "The model's answer has no `explanations` array in it, so there is nothing to read. " +
        "That is a failed answer rather than an empty one.",
    );
  }
  const d = opts.dropped;
  const existing = opts.existing ?? null;
  const previous = existing?.explanations ?? [];
  const completedAt = opts.now ?? new Date().toISOString();
  /* The cap is per pass, not per list: a *Find more* asks for up to as many
     again, and one-per-block is what bounds the whole list. */
  const cap = explanationCap(bodyParagraphs(opts.blocks));
  const added = toExplanations(
    parsed.explanations,
    opts.blocks,
    cap,
    d,
    opts.scores,
    previous.map((e) => e.blockId),
  ).map((e) => ({ ...e, addedAt: completedAt }));
  if (!existing && parsed.explanations.length > 0 && added.length === 0) {
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
  /* Cumulative, as Quotes' `discarded` (Sol F6): the band's (i) reads it as
     a fact about the list on screen, and after two passes that is both. */
  const dropped: ExplanationsDropped = { ...d };
  if (existing) {
    for (const key of Object.keys(dropped) as (keyof ExplanationsDropped)[]) {
      dropped[key] += existing.dropped?.[key] ?? 0;
    }
  }
  return {
    /* On an append the list keeps its version: `existingFor` refuses an older
       one, so this is the current prompt's — or, in a rollback, a newer
       build's, whose items most of the list still are. */
    version: existing ? existing.version : PROMPT_VERSION,
    generator: generatorFor(opts.power),
    slug: opts.slug,
    /* The store's spellings (`sourceHash`, `version`, `generator`,
       `profileHash`), which `stampOf` reads — src/store/artifacts.ts. */
    sourceHash: opts.sourceHash,
    /* Equal by `existingFor` on an append; the list's own is kept regardless. */
    profileHash: existing ? (existing.profileHash ?? null) : opts.profileHash,
    /* Old items unchanged — ids, scores and `addedAt` — and the new ones
       among them, in reading order. */
    explanations: existing ? inReadingOrder([...previous, ...added], opts.blocks) : added,
    dropped,
    passes: (existing?.passes ?? (existing ? 1 : 0)) + 1,
    lastAdded: added.length,
    generatedAt: completedAt,
    elapsedMs: (existing?.elapsedMs ?? 0) + opts.elapsedMs,
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

RATE EVERY EXPLANATION

Two numbers from 0 to 1, on every explanation. Both are required.

  "difficulty" — how likely THIS reader is to get stuck here without your
                 explanation.
                 0.9: they would almost certainly lose the thread here.
                 0.5: they might, if they are reading quickly.
                 0.1: most would get past it on their own.
  "centrality" — how much of the piece's argument depends on getting past
                 this place.
                 0.9: the main claim cannot be followed without it.
                 0.5: one part of the argument depends on it.
                 0.1: a side point; missing it costs little.

Use the whole range, and judge each place on its own — do not make the
numbers fall in order down the list.

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
    "outside": false,
    "difficulty": 0.7,
    "centrality": 0.6
  }
]}

THE ANSWER MUST PARSE. Inside a string, a straight double quote ends the
string, so if the article's quotation marks are straight ones, escape them as
\\". Never put a real line break inside a string.`;

/**
 * The user message: the ceiling, then who is reading. The profile goes here,
 * after the breakpoint, never in the system block — src/profile.ts §
 * `profileSection` says why. Exported for the test that pins both halves.
 *
 * **Byte-identical since `explanations/1`**, and it must stay so: it is in
 * `inputFingerprint`, so changing it would mark every existing list *stale*
 * ("describes an older version of the article"), which would be false. A
 * prompt change goes in `EXPLANATIONS_SYSTEM` and bumps `PROMPT_VERSION`.
 */
export function renderPrompt(opts: { count: number; profile: string | null }): string {
  const who = profileSection(opts.profile);
  return `Find up to ${opts.count} places where this reader would get stuck, and explain each. Fewer is fine, and none is fine.${who ? `\n\n${who}` : ""}`;
}

/**
 * **The user message on a *Find more***: the places already explained — block
 * id and quote — and a ceiling of as many again, none in a block already used.
 * Quotes' and Glossary's ALREADY lists (src/quotes.ts § `renderPrompt`).
 *
 * In the user message, never the system block: the article is the cached
 * system block, and it has to be byte-identical between a first pass and every
 * append, or each pass pays for it again. Not in the fingerprint either — the
 * fingerprint is the first pass's message, which is what makes a list stale.
 */
export function renderAppendPrompt(opts: {
  count: number;
  profile: string | null;
  existing: readonly Pick<Explanation, "blockId" | "quote">[];
}): string {
  const who = profileSection(opts.profile);
  const already = opts.existing.map((e) => `- ${e.blockId}: ${JSON.stringify(e.quote)}`).join("\n");
  return `Find up to ${opts.count} MORE places where this reader would get stuck, and explain each. Fewer is fine, and none is fine.

=== ALREADY EXPLAINED ===

The reader already has an explanation at each of these places. Do not return a place in any of these blocks, and do not explain the same difficulty again somewhere else in other words. Every one of these is kept whatever you return.

${already}

If there are genuinely no more places worth explaining, return {"explanations": []}. That is a real answer, and a better one than padding.${who ? `\n\n${who}` : ""}`;
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
          /* 0–1 is a code check (`score`, src/score-fields.ts), as FAQ's. */
          difficulty: { type: "number" },
          centrality: { type: "number" },
        },
        required: ["blockId", "quote", "text", "sure", "outside", "difficulty", "centrality"],
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
  /** The artefact — on a *Find more*, the old list with this pass's added. */
  explanations: Explanations;
  paragraphs: number;
  /** **This pass's** drops, for the log; the artefact's `dropped` is cumulative. */
  dropped: ExplanationsDropped;
  /** The scores this pass asked for and did not get. Logged, never stored. */
  scores: ExplanationScoreDrops;
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
  /**
   * The list this article already has, or null **only** when it has none —
   * `previousExplanationsFrom` is how the pipeline gets it. Required, so a
   * later change cannot drop it and still compile: the symptom would be every
   * *Find more* quietly rewriting the list.
   */
  previous: Explanations | null;
}): Promise<ExplanationsRun> {
  const { blocks, tree, meta: realMeta } = opts.article;

  /* **Two values, deliberately**, as src/faq.ts: the stub is for the prompt's
     head and the fingerprint gets the real nullable meta, which is what the
     stamp hashes. */
  const meta: Meta = realMeta ?? ({ title: fallbackHeadTitle(tree) } as Meta);
  const sourceHash = inputFingerprint(blocks, tree, realMeta);
  const profileHash = opts.profile ? hashProfile(opts.profile) : null;
  /* **Append** to a list the current prompt wrote, from this article, for
     this profile — *Find more*. Anything else a forced run rewrites. */
  const existing = existingFor(opts.previous, sourceHash, profileHash);

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
        messages: [
          {
            role: "user",
            content: existing
              ? renderAppendPrompt({ count, profile: opts.profile, existing: existing.explanations })
              : renderPrompt({ count, profile: opts.profile }),
          },
        ],
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
        report(
          `up to ${count} ${existing ? "more " : ""}explanations, ${Math.round(chars / 1000)}k characters so far`,
        );
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
  const scores = noExplanationScoreDrops();
  const explanations = buildExplanations(parseJson(raw), {
    slug: opts.article.slug,
    blocks: evidence,
    sourceHash,
    profileHash,
    power: opts.power,
    elapsedMs: Date.now() - started,
    dropped,
    scores,
    existing,
  });

  /* Nothing is written here — the caller writes through the store. */
  return {
    explanations,
    paragraphs,
    dropped,
    scores,
    model: generatorFor(opts.power),
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
    cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
    maxTokens,
    elapsedMs: Date.now() - started,
  };
}
