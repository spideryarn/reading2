/**
 * Pipeline stage 5r — **Simple**: a few short paragraphs, in everyday words,
 * saying what the piece is about, why it matters and what its key ideas are,
 * each paragraph resting on the passages it came from. A sub-mode of Summary,
 * written at **two levels**, one call each, side by side: `brief` and `fuller`.
 *
 * **There was a third until 2026-10-04**, a middle level also called `simple`,
 * hidden since 2026-10-03 and still written, so every press paid for a call
 * nobody read and a failure in it lost the other two. Greg, 2026-10-04:
 * *"we've removed that middle level of Summary, and we're not going to add it
 * back"*. docs/plans/261004f-stop-writing-the-simple-summary-level.md. The
 * step, the artefact and this file keep the name; only the level went. Greg's
 * two quotes below are from when it was built.
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
 * the user message. In Fuller, **the profile moves the floor, not the level**:
 * an eighteen-year-old *who already knows what the reader says they know*, so
 * a reader who says they build AI systems is not told what a language model
 * is. Brief is the exception: the profile changes what leads, but never
 * licenses field terms. The goal changes emphasis, never what the piece says.
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
 * call writing both of the levels there were then; measured, it made the model think five to twenty
 * times as long (1–15k reasoning tokens against 150–800 for one level) and the
 * wait went from 9–18 s to 24–134 s. So each level is its own call, the shape
 * the first plan measured, and they run at once: the wait is the slower of
 * two short calls. **All or none** — the first to fail aborts the others,
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
import { messageText, streamMessage, wasRefused } from "./messages-stream.js";
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
  SIMPLE_KEY_MAX_WORDS,
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
  type SimpleSentence,
  type SimpleSummary,
  type Tree,
  simpleKey,
} from "./types.js";

export type { SimpleLevel, SimpleParagraph, SimpleSummary } from "./types.js";
export { SIMPLE_LEVELS } from "./types.js";

/**
 * **The stored shape's version**, stamped into the artefact as `version`.
 * Bumped only when what is stored changes shape, because `isUsableSimpleSummary`
 * (src/types.ts) requires an exact match and reads anything else as absent.
 *
 * `simple/2` (2026-10-01) is `levels` and the profile. A `simple/1` row has
 * no `levels` and reads as absent.
 *
 * **Not bumped when the middle level went** (2026-10-04, plan 261004f): a row
 * from before has one more key in `levels` and in `check.levels`, which no
 * guard looks at, so it still reads. A bump would have made every stored
 * summary read as absent and be written again.
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
 *
 * `simple-prompt/4` (2026-10-02): each paragraph is written as its sentences,
 * each naming the one of the paragraph's ids it rests on, or none (Greg,
 * SPIDERYARN-READING2-8V; plan 261002e). The stored shape only gained an
 * optional field, so `SIMPLE_VERSION` stays.
 *
 * `simple-prompt/5` (2026-10-02): Brief is written for a reader in a hurry
 * from outside the field, whatever the profile claims, with few terms and one
 * phrase of method; every level opens on the piece's goal or question (Greg,
 * spya-rpqqxb; plan 261002h).
 *
 * `simple-prompt/6` (2026-10-03): the shared paperwork rule names the title
 * block and the reference list as paperwork (Greg, spya-abs6bj; plan
 * 261003c). The abstract rule beside it is Structure's alone.
 *
 * `simple-prompt/7` (2026-10-04): Fuller is asked for about half as much again
 * and told what the room is for; Brief and Fuller mark a key phrase on a
 * sentence or two, and Fuller may write a paragraph as a list (Greg,
 * spya-azft06 and spya-qzsvx4; plan 261004b). The stored shape only gained two
 * optional fields, so `SIMPLE_VERSION` stays.
 *
 * **Not bumped when the middle level went** (2026-10-04, plan 261004f stage
 * 1): Brief's and Fuller's prompts were the same bytes, pinned by
 * tests/simple-two-levels.test.ts, so nothing stored was outdated.
 *
 * `simple-prompt/8` (2026-10-04): Fuller is asked for about 500 words, in five
 * to eight paragraphs, now that Brief is shown first and a longer Fuller no
 * longer keeps the reader waiting for anything to read. Brief is unchanged,
 * byte for byte (plan 261004f stage 2). Every stored summary becomes
 * *outdated*, which is silent, and none is rewritten for it: an unforced run
 * skips a stored summary whatever its prompt's age (src/pipeline.ts § `simple`).
 *
 * `simple-prompt/9` (2026-10-05): the length Fuller is asked for follows the
 * length of the piece, in four bands (`SIMPLE_BANDS`; Greg, spya-gttwhn; plan
 * 261005b). Brief is `/8` byte for byte in every band, and so is Fuller in the
 * `standard` band, 2,500 to 14,999 words: only the Fuller of a short piece, a
 * long one or a book is written differently. As with `/8`,
 * every stored summary becomes *outdated* and none is rewritten for it.
 *
 * `simple-prompt/10` (2026-10-05): Brief is asked for about 100 words and
 * never more than 150, where it was about 80 and 130, for every piece (Greg:
 * *"maybe Brief could be ever so slightly longer but not much"*; plan 261005b § A slightly longer
 * Brief). Fuller is `/9` byte for byte in every band. Outdated and not
 * rewritten, as before.
 *
 * `simple-prompt/11` (2026-10-05): Fuller is written for someone who has not
 * read the piece: two more bullets for its reader (`NOT_READ`), and the
 * reader's claimed background no longer covers what the piece itself
 * introduces (`AFTER_PROFILE.fuller`; Greg, spya-rntjxu; plan 261005h). Brief
 * is `/10` byte for byte. Its eval ran before `/10` landed and calls this
 * prompt `/10` in its result files; Fuller's bytes are the ones it measured.
 * The fingerprint is `/9`'s, so nothing stored is made stale; as before,
 * every stored summary becomes *outdated* and none is rewritten.
 *
 * `simple-prompt/12` (2026-10-06): Brief is asked for about 80 words and never
 * more than 130 again, `/9`'s Brief byte for byte, in every band. A book-only
 * increase with a sentence about covering the whole book was measured and
 * rejected: it missed both the preference and padding shipping conditions
 * (plan 261005b § Brief by band). Greg's intent remains a slightly larger
 * Brief for very long pieces, once supported by evidence. Fuller is `/11`
 * byte for byte in every band. Outdated and not rewritten, as before.
 */
export const SIMPLE_PROMPT_VERSION = "simple-prompt/12";

/** The prompt a stored summary was written with; a row from before the field is the first. */
export function simplePromptVersion(simple: SimpleSummary): string {
  return simple.promptVersion ?? "simple-prompt/1";
}

/** Passages per paragraph. Extra ids are dropped and counted. */
export const MAX_IDS = SIMPLE_MAX_IDS;

/**
 * **The level asked first, with the other waiting until its stream has begun**
 * — so it writes the article's cache entry and Brief reads it (plan 261001j).
 * Fuller, because it is the longest to write: starting it first keeps the
 * press's wait closest to the unstaggered one.
 */
export const FIRST_LEVEL: SimpleLevel = "fuller";

/** Asks per level: the first, and one more if its answer fails validation (`writeLevel`). */
export const LEVEL_ATTEMPTS = 2;

/**
 * The most sentences a paragraph is asked for — "two to five" in `FULLER_LENGTH`'s
 * shapes. Not enforced (a sentence count is the prompt's ask, not a limit);
 * here only to size `ANSWER_TOKENS`.
 */
const MAX_SENTENCES_ASKED = 5;

/**
 * What each sentence costs beyond its words: `{"text": "", "id": "spya-k3m9qt"}`
 * and the comma — the braces, two keys, the quotes and an id or `null`. A
 * generous round number; an id alone is six or seven tokens.
 */
const SENTENCE_JSON_TOKENS = 20;

/**
 * What a sentence's `key` costs: `, "key": ""` and a phrase of up to
 * `SIMPLE_KEY_MAX_WORDS` words, which are the sentence's own words written a
 * second time. Counted for every sentence, though most are asked to say `null`.
 */
const KEY_JSON_TOKENS = 6 + Math.ceil(SIMPLE_KEY_MAX_WORDS / 0.75);

/** A paragraph's `"list": false,`. */
const LIST_JSON_TOKENS = 5;

/** The highest of the levels' own limits: the budget is sized for the largest answer any may give. */
const most = (pick: (limits: (typeof SIMPLE_LIMITS)[SimpleLevel]) => number): number =>
  Math.max(...SIMPLE_LEVELS.map((level) => pick(SIMPLE_LIMITS[level])));

/**
 * One call's answer budget in tokens, sized for the larger level: Fuller's
 * word ceiling at 0.75 words a token, doubled for safety; plus, for each of
 * its paragraphs, three ids and the JSON
 * around them, its `list`, and the JSON around each sentence, key included, at
 * twice the sentences asked for (the model runs over a count it is given, as
 * it does over a length). Undersizing does not degrade: it throws
 * `truncationFailure` and loses the whole pass.
 */
export const ANSWER_TOKENS =
  2 * Math.ceil(most((l) => l.maxWords) / 0.75) +
  most((l) => l.maxParagraphs) *
    (MAX_IDS * 10 + LIST_JSON_TOKENS + 2 * MAX_SENTENCES_ASKED * (SENTENCE_JSON_TOKENS + KEY_JSON_TOKENS));

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
 * **Two levels either side of the first version's length**, which came out at
 * 240–273 words (Greg, SPIDERYARN-READING2-7J and -7F): Brief short and very
 * simple, at twelve; Fuller moderately complex and longer, at eighteen. The
 * middle level, at fifteen and just under that length, went on 2026-10-04.
 *
 * **Fuller is about half as long again since 2026-10-04** (Greg, spya-azft06:
 * *"longer and more detailed still"*; plan 261004b). Asked for 220 it came
 * back at 221–261; asked for 350 it came back at 338–412. Asked for 500 it
 * came back at 464–520 and the press took twice as long (55 s against 26 s),
 * because nothing was shown until the slowest level was written, so 350 is
 * what shipped that morning.
 *
 * **And about 500 since later the same day** (plan 261004f stage 2). Brief is
 * now shown as soon as it is written (`onLevel`, below), so the longer Fuller
 * costs a wait for Fuller alone and the reader has Brief to read meanwhile.
 * The three values are the arm 261004b measured: five to eight paragraphs,
 * about 500 words, never more than 600. `SIMPLE_LIMITS.fuller` already allowed
 * it and is unchanged. `never` is the "never more than" the prompt states, a
 * number of its own per level, so Fuller's can sit 100 over its ask while
 * Brief's stays 50 over its own.
 */

/**
 * **How long the piece is, as Fuller's prompt sees it**: one of four bands,
 * picked from the words of the body the request sends. Greg, 2026-10-04
 * (spya-gttwhn): *"The length of the summaries should somewhat reflect the
 * length of the text. Not linearly. But a book will surely need (at least
 * somewhat) longer summaries than a short article."*
 *
 * Bands and not a formula, so there are four prompts a person can read, a test
 * can pin and a measurement can cover, where a formula would give every
 * article its own. **`standard` is the prompt as it was before bands**, byte
 * for byte, and most articles are in it. Plan 261005b has the measurement:
 * asked for 500 words whatever the piece, Fuller gave an 879-word essay 402
 * and 492 words and a 49,000-word book 489 and 515.
 */
export const SIMPLE_BANDS = ["short", "standard", "long", "book"] as const;
export type SimpleBand = (typeof SIMPLE_BANDS)[number];

/** The fewest body words in each band. Ascending, as `bandFor` reads it. */
export const BAND_FROM: Record<SimpleBand, number> = {
  short: 0,
  standard: 2_500,
  long: 15_000,
  book: 40_000,
};

/** The band for a body of this many words (`Block.words`, summed over the evidence sent). */
export function bandFor(bodyWords: number): SimpleBand {
  let band: SimpleBand = "short";
  for (const candidate of SIMPLE_BANDS) if (bodyWords >= BAND_FROM[candidate]) band = candidate;
  return band;
}

/**
 * Match `blocks.ts`'s count, including whitespace preserved inside a `pre`;
 * `wordCount` trims that whitespace and can move a block across a band edge.
 * Text is available to both generation and narrow freshness reads. */
export function evidenceBand(evidence: readonly Pick<BlockFingerprint, "text">[]): SimpleBand {
  return bandFor(evidence.reduce((n, b) => n + (b.text.length ? b.text.split(/\s+/).length : 0), 0));
}

/** How LENGTH ends for Brief; `simpleSystem` supplies the line it finishes. */
const ORIENTATION_NOT_DIGEST = `Shorter is fine; this is an
orientation, not a digest, so leave detail to the article.`;

/* Not the line above: detail is what Fuller is for, so it is not told to leave
   it out. It is still not a replacement for the article. */
const FULLER_SHORTER = `Shorter is fine for a short
piece. This is still not a replacement for the article: spend the words on what
the piece did, found and admits, and never on saying one thing twice.`;

/** What does not move with the piece's length: who it is for, and how long a sentence may be. */
const PITCH: Record<SimpleLevel, { reader: string; sentence: number; shorter: string }> = {
  brief: { reader: "A bright twelve-year-old", sentence: 18, shorter: ORIENTATION_NOT_DIGEST },
  fuller: {
    reader: "A bright eighteen-year-old in their first year at university",
    sentence: 30,
    shorter: FULLER_SHORTER,
  },
};

/** `room`, where a band has one, is said straight after the numbers: what the extra words are for. */
type Length = { shape: string; words: number; never: number; room?: string };

const BRIEF_SHAPE = "Two short paragraphs, each two or three sentences; three only if the piece truly needs it";

/** About 80 words: Brief for every piece, books included. */
const BRIEF_USUAL: Length = { shape: BRIEF_SHAPE, words: 80, never: 130 };

/**
 * **Brief stays short for every piece.** Greg,
 * 2026-10-06, of the `simple-prompt/10` that had asked every piece for about
 * 100 words:
 *
 * > Re longer Summary Brief - I wanted it to stay short for most articles, but
 * > allow it to go slightly larger for really long ones (e.g. books).
 * > Is that what's been done?
 *
 * All four bands are asked for about 80 words and never
 * more than 130: **the Brief prompt `/7` to `/9` sent, byte for byte**
 * (tests/simple-length-bands.test.ts pins every band).
 * A book-only ask of 100 with a sentence about its later parts won two of
 * four blind test pairs, below the required three, and was called padded
 * twice against zero for the old prompt. It therefore did not ship after
 * review. Greg's intent is recorded above; the tested variant and the
 * evidence are in plan 261005b § Brief by band and
 * docs/investigations/261005a § Round four.
 */
export const BRIEF_LENGTH: Record<SimpleBand, Length> = {
  short: BRIEF_USUAL,
  standard: BRIEF_USUAL,
  long: BRIEF_USUAL,
  book: BRIEF_USUAL,
};

/**
 * **What moves with the piece's length is Fuller**: the paragraphs asked for,
 * the words asked for, and the "never more than". Not linear: from `short` to
 * `book` the piece is at least sixteen times longer and the ask is 3.6 times.
 *
 * Every `never` has to sit under `SIMPLE_LIMITS.fuller.maxWords`
 * (src/types.ts), which is one cap for all bands: over it the write fails and
 * stores nothing. tests/simple-length-bands.test.ts holds that.
 */
export const FULLER_LENGTH: Record<SimpleBand, Length> = {
  short: { shape: "Three to five paragraphs, each two to five sentences", words: 250, never: 330 },
  standard: { shape: "Five to eight paragraphs, each two to five sentences", words: 500, never: 600 },
  long: { shape: "Six to nine paragraphs, each two to five sentences", words: 700, never: 820 },
  book: { shape: "Eight to eleven paragraphs, each two to five sentences", words: 900, never: 1050 },
};

/** The length one level is asked for, of a piece in one band. */
export const lengthFor = (level: SimpleLevel, band: SimpleBand): Length =>
  (level === "brief" ? BRIEF_LENGTH : FULLER_LENGTH)[band];

/*
 * **The numbers are the whole of it.** A sentence for the two long bands,
 * "This is a long piece. Cover the whole of it, the later parts as well as the
 * opening, and give each main part its share", was measured for Fuller and
 * left out: over four blind pairs the judge preferred the summary without it
 * twice and with it once, which is no more than two writes of one prompt
 * differed by. Plan 261005b § Ledger.
 */

/**
 * What a level may do beyond the plainest — said inside that level's own
 * prompt, never as a comparison with another version: a reader may read only
 * one, so none refers to another.
 */
const NOTCH_UP: Record<SimpleLevel, string> = {
  brief: `

Keep it very simple, for a reader in a hurry who does not know the field. What
the piece set out to do, what it found or concluded, and why that matters. At
most one other key idea.

- How it was done gets one plain phrase at most ("in an experiment with
  rats"): no equipment, no technique names, no experimental conditions.
- At most two technical terms, each said in everyday words where it appears.
  A term the reader does not need to follow the point is left out, not
  explained.
- Only the numbers the takeaway rests on.
- Fewer facts, each one plain, rather than every fact squeezed in. Leave out
  anything a first-time reader could do without.`,
  fuller: `

You may keep more of the piece's own terms than a beginner's version would (each
still said in plain words where it first appears).

This version has room to go into the piece. Use it for:

- how the work was done: what was studied, measured or argued from;
- the evidence and the numbers behind each main finding;
- the limits the piece itself names;
- how the steps of the argument connect: what each one leads to.`,
};

/**
 * What a level is told about `list`. Only Fuller is long enough for a list to
 * help; Brief is told to say false, and a `true` from it is still drawn
 * safely, since `paragraphShape` (src/types.ts) decides, not the prompt.
 */
const NO_LISTS = `"list" on a paragraph says whether it is drawn as a bulleted list. This
version has none. Always write "list": false.`;
/** The bold phrase, asked of both levels. */
const KEY_ASKED = `"key" on a sentence: a few words copied exactly from that sentence's "text",
which the reader sees in bold. Pick the finding, the number or the term that a
reader skimming the page should catch. At most ${SIMPLE_KEY_MAX_WORDS} words, and never the whole
sentence. In a paragraph, at most two sentences have a "key". Most sentences
have none: write null.`;
const LIST_RULE: Record<SimpleLevel, string> = {
  brief: NO_LISTS,
  fuller: `"list" on a paragraph: true when the reader should see it as a bulleted list,
false for an ordinary paragraph. Use a list only where the piece itself gives
parallel items: its findings, its steps, its reasons. At most two paragraphs
are lists, and many summaries need none.

In a list paragraph the first sentence is the lead-in, and it must make sense
on its own. Each later sentence is one bullet, and there are at least two.
Every bullet is a full sentence with its own "id", like any other sentence.`,
};

/**
 * **What a reader's claimed background does to the words**, per level. Fuller
 * takes what the reader says they know as everyday words. Brief does
 * not: it is for a reader in a hurry from outside the field, whatever the
 * profile claims (Greg, spya-rpqqxb — his own profiled Brief was denser in
 * jargon than the middle level then beside it). Plan 261002h.
 */
const KNOWN_AS_EVERYDAY = `- If the request describes the reader, what they say they already know counts
  as everyday words for them: use it without explaining it. Everything else
  stays at this pitch.`;
const KNOWN_WORDS: Record<SimpleLevel, string> = {
  brief: `- If the request describes the reader, it may steer what you put first. It
  never changes the words: this version stays in everyday words even when the
  request below describes a reader who does know the field.`,
  fuller: KNOWN_AS_EVERYDAY,
};

/**
 * **Fuller is written for someone who has not read the piece.** Greg,
 * 2026-10-05 (spya-rntjxu): *"they key principle is to write the fuller
 * summary for someone who hasn't read it yet rather than for someone who
 * has."* The writer has just read all of it, so the piece's own names do not
 * feel like jargon to it. Two more bullets for Fuller's reader, naming the two
 * faults: a name the piece introduces is a term, and nothing is referred to
 * before the summary has introduced it. Brief has neither: Greg finds Brief
 * good, and its two terms and one phrase of method leave little to point at.
 *
 * **A whole section was built first and measured against these two bullets**:
 * a heading, an opening paragraph, eight bullets and a closing check. On five
 * papers the two split 5 pairs to 5, with the same count of places a reader
 * could not follow, so by the rule the plan declared beforehand the smaller
 * one shipped. It also stays inside its length, where the section ran over in
 * four writes of twenty, and a reader with no profile did not prefer the old
 * summary to it, as they did to the section's. The section's text is in plan
 * 261005h; the numbers are in
 * docs/investigations/261005b-fuller-summary-for-a-new-reader-prompt-eval.md.
 */
const NOT_READ: Record<SimpleLevel, string> = {
  brief: "",
  fuller: `
- A name the piece introduces is a term like any other, however plain it
  looks: a term it coins or uses in its own sense, an abbreviation, its label
  for a method, model, measure, group, condition or experiment. The first time
  you use one, say what it is in the same sentence, in everyday words.
- Do not refer to a part, result, model or label before this summary has
  introduced it. "The second experiment" is fine after this summary has said
  what the experiments were; otherwise say what it is.`,
};

/**
 * Each level's exception to `PROFILE_RULES`, said **after** them so it is the
 * last word on the profile in the prompt. The shared rules tell every prompt to
 * "assume the background they claim", and an override said only before them
 * left the precedence to the model (GPT Sol's plan review of 261002h, P1).
 * `PROFILE_RULES` is shared by five prompts and stays as it is.
 */
const AFTER_PROFILE: Record<SimpleLevel, string> = {
  brief: `

FOR THIS VERSION, THE READER'S BACKGROUND DOES NOT CHANGE THE WORDS

This version is for a reader in a hurry from outside the field, even when the
request below describes a reader who does know it. Use the description only
for what to put first. Where it conflicts with "Assume the background they
claim" above, this paragraph wins: explain each technical term you keep as you
would for an outsider, and keep as few as you can.`,
  /* Fuller's, since `simple-prompt/10`: a reader's claimed field does not
     cover what the piece itself introduces. After `PROFILE_RULES` for Brief's
     reason, and worded as a boundary a model can apply (GPT Sol's plan review
     of 261005h, F1: "the general knowledge of their field", said before the
     shared rules, was neither). */
  fuller: `

FOR THIS VERSION, THE READER'S BACKGROUND DOES NOT COVER WHAT THIS PIECE INTRODUCES

Ordinary, established terms from the background the reader claims may stay
unexplained. A term, abbreviation, label or special meaning that this piece
introduces is different: it does not become known because it belongs to the
same field. Treat it as new unless the reader's description itself names it.
Where this differs from "Assume the background they claim" above, this
paragraph wins.`,
};

/**
 * The system prompt for one level, for a piece in one length band. Constant
 * per level and band — the reader goes in the user message, after the
 * breakpoint. The band changes three values in Fuller's LENGTH section and
 * nothing else; Brief's is identical in every band.
 */
export function simpleSystem(level: SimpleLevel, band: SimpleBand = "standard"): string {
  const p = { ...PITCH[level], ...lengthFor(level, band) };
  return `You are helping a reader get their bearings before they read the article above.

WHAT YOU WRITE

${level === "fuller" ? "An orientation" : "A short orientation"} in plain words: what the piece is about, why it matters,
and its key ideas. It is not a replacement for the article. It is what a reader
wants to know first, so that the article itself makes sense when they read it.

THE READER

${p.reader} who has not studied this field. Everyday words and short sentences.${NOTCH_UP[level]}

- Use jargon sparingly. Where you do use a term, say what it means in the same
  sentence, in everyday words. Never explain one hard word with another.
- Keep the author's key term where the reader will meet it in the article; it
  is their handhold. Say what it means.
${KNOWN_WORDS[level]}${NOT_READ[level]}

LENGTH

${p.shape}. Every sentence under ${p.sentence} words. About ${p.words} words in
all, and never more than ${p.never}. ${p.room ? `${p.room} ` : ""}${p.shorter}${systemTail(level)}`;
}

const systemTail = (level: SimpleLevel): string => `

THE SHAPE

- First: what the piece is about — its goal or question, or its subject, and
  what kind of piece it is.
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

Then write the paragraph as its sentences, in order, one sentence to each
"text". Give each sentence the "id" of the one block, from that paragraph's own
"ids", that the sentence most rests on. Use null when it rests on none of them
in particular: a sentence that frames the piece, or a takeaway drawn from the
whole paragraph. A sentence never names an id its paragraph did not list.

The ids go only in "ids" and "id". Never write an id, or "block …", in a
sentence's text.

WHAT A SKIMMING READER CATCHES

Two more fields say how a paragraph is drawn. They are the only formatting
there is.

${KEY_ASKED}

${LIST_RULE[level]}

${plainWords("explain")}

${paperwork("summary")}

${PROFILE_RULES}${AFTER_PROFILE[level]}

OUTPUT

JSON only, no prose, no code fence:

{"paragraphs": [
  {"ids": ["spya-k3m9qt", "spya-p7w2dn"], "list": false,
   "sentences": [
     {"text": "...", "id": "spya-k3m9qt", "key": "..."},
     {"text": "...", "id": null, "key": null},
     {"text": "...", "id": "spya-p7w2dn", "key": null}]}
]}

Plain text in "text" and "key": no markdown, no asterisks, no bullet or list
characters, no headings. Bold and lists are said only by "key" and "list".
Never put a real line break inside a string, and escape any straight double
quote as \\".`;

/** Each band's two system prompts, built once. */
export const SIMPLE_SYSTEMS_BY_BAND = Object.fromEntries(
  SIMPLE_BANDS.map((band) => [
    band,
    Object.fromEntries(SIMPLE_LEVELS.map((level) => [level, simpleSystem(level, band)])),
  ]),
) as Record<SimpleBand, Record<SimpleLevel, string>>;

/** The `standard` band's pair: the prompts as they were before bands, byte for byte. */
export const SIMPLE_SYSTEMS = SIMPLE_SYSTEMS_BY_BAND.standard;

/** The same answer contract for every level and every retry. */
export const SIMPLE_SUMMARY_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    paragraphs: {
      type: "array",
      items: {
        type: "object",
        properties: {
          ids: { type: "array", items: { type: "string" } },
          /* Before the sentences, so the model has said what the paragraph is
             by the time it writes the first one as a lead-in. */
          list: { type: "boolean" },
          sentences: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              properties: {
                text: { type: "string", pattern: "\\S" },
                /* Required and nullable, never optional: "omit it when…"
                   makes the model write the comma anyway, and OpenAI's subset
                   wants every property required (prompting-guide.md). */
                id: { type: ["string", "null"] },
                /* After `text`, which it is copied from. Nullable for `id`'s
                   reason, and never an empty string (`text`'s pattern); that
                   it is the sentence's own words is `simpleKey`'s check. */
                key: { type: ["string", "null"], pattern: "\\S" },
              },
              required: ["text", "id", "key"],
              additionalProperties: false,
            },
          },
        },
        required: ["ids", "list", "sentences"],
        additionalProperties: false,
      },
    },
  },
  required: ["paragraphs"],
  additionalProperties: false,
} as const;

validateAnthropicJsonSchema(SIMPLE_SUMMARY_OUTPUT_SCHEMA);
assertNoBlockIdEnums(SIMPLE_SUMMARY_OUTPUT_SCHEMA, ["ids", "id"]);

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
 * Since `/9`, the selected band also participates: literal block-looking
 * text can render identically to a separate block while changing the band.
 * A stored pre-band prompt keeps its original fingerprint algorithm, so a
 * prompt update alone never makes its article stale or pays for a rewrite.
 */
export function inputFingerprint(
  blocks: readonly BlockFingerprint[],
  tree: Tree,
  meta: MetaFingerprintWithUrl | null,
  promptVersion: string = SIMPLE_PROMPT_VERSION,
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
  /* A pre-field row's generic stamp uses its stored-shape version. */
  const legacy = promptVersion === SIMPLE_VERSION || /^simple-prompt\/[1-8]$/.test(promptVersion);
  const framed = legacy
    ? `spya-simple-input/1\n${JSON.stringify(request)}`
    : `spya-simple-input/2\n${JSON.stringify([...request, evidenceBand(evidence)])}`;
  return createHash("sha256")
    .update(framed, "utf8")
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
  return simple.sourceHash !== inputFingerprint(blocks, tree, meta, simplePromptVersion(simple));
}

/**
 * What validation threw away, across every level. **Reported, logged, never
 * stored**: the artefact is the paragraphs and the stamp, and a reader has no
 * use for our checking's tally.
 */
export interface SimpleDropped {
  /** A paragraph that was not an object. */
  malformed: number;
  /** A paragraph with no sentence that has text. */
  empty: number;
  /** A sentence that was not an object, or had no text — left out of its paragraph. */
  emptySentences: number;
  /**
   * A sentence's id that is not one of its paragraph's surviving `ids` (or not
   * a string): the sentence is kept, unlinked. Never promoted into `ids`.
   */
  sentenceIds: number;
  /**
   * A sentence's `key` that `simpleKey` (src/types.ts) refused — not its own
   * words, empty, too long, or the whole sentence: the sentence is kept, with
   * no bold. A `null` key is the usual answer and is not counted.
   */
  keys: number;
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
  return {
    malformed: 0,
    empty: 0,
    emptySentences: 0,
    sentenceIds: 0,
    keys: 0,
    unknownIds: 0,
    duplicateIds: 0,
    overCap: 0,
    unanchored: 0,
  };
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
 * One paragraph's sentences: each with text, trimmed, and an id only when it is
 * one of the paragraph's own surviving `ids` — anything else becomes `null` and
 * is counted, so a sentence can only point at a passage the paragraph already
 * rests on and the guard already reads. A `key` is stored only when
 * `simpleKey` accepts it; one it refuses is counted and left off.
 */
function keptSentences(raw: unknown, ids: readonly BlockId[], dropped: SimpleDropped): SimpleSentence[] {
  const own = new Set<string>(ids);
  const out: SimpleSentence[] = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    const r = item && typeof item === "object" ? (item as { text?: unknown; id?: unknown; key?: unknown }) : null;
    const text = typeof r?.text === "string" ? r.text.trim() : "";
    if (!r || !text) {
      dropped.emptySentences++;
      continue;
    }
    const key = simpleKey(r.key, text);
    if (key === null && r.key != null) dropped.keys++;
    const bold = key === null ? {} : { key };
    const id = typeof r.id === "string" ? r.id.trim() : r.id;
    if (id === null) out.push({ text, id: null, ...bold });
    else if (typeof id === "string" && own.has(id)) out.push({ text, id: id as BlockId, ...bold });
    else {
      dropped.sentenceIds++;
      out.push({ text, id: null, ...bold });
    }
  }
  return out;
}

/**
 * Turn what the model said into paragraphs, believing as little as possible:
 * ids checked against **the exact body-evidence set sent**, deduplicated,
 * capped at `MAX_IDS`; an empty paragraph dropped; a paragraph with no
 * surviving id dropped. The model's order is kept — it is the shape the prompt
 * asked for (about → why → key ideas), not reading order.
 *
 * **`text` is derived, never the model's**: the kept sentences' trimmed texts
 * joined with one space, which is exactly what `usableSentences` (src/types.ts)
 * requires before a reader sees them. Word limits, the fidelity guard and
 * everything else read `text`, as before.
 *
 * `list` is stored only when the model said `true`. Whether that draws as a
 * list is `paragraphShape`'s answer on every read (src/types.ts), so a list
 * with too few sentences is stored as said and drawn as prose.
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
    const r = item as { sentences?: unknown; ids?: unknown; list?: unknown };
    /* The ids first, so each sentence is checked against the ones that
       survived — tallied aside, because an empty paragraph's ids were never
       counted as dropped and still are not. */
    const tally = emptyDropped();
    const ids = keptIds(r.ids, evidenceIds, tally);
    const sentences = keptSentences(r.sentences, ids, tally);
    const text = sentences.map((s) => s.text).join(" ");
    if (!text) {
      dropped.empty++;
      continue;
    }
    for (const k of Object.keys(dropped) as (keyof SimpleDropped)[]) dropped[k] += tally[k];
    if (ids.length === 0) {
      dropped.unanchored++;
      continue;
    }
    out.push({ text, ids, sentences, ...(r.list === true ? { list: true } : {}) });
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
  /** Writer requests made, across every level and retry — two when nothing was asked twice. */
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
   * two calls can cache, so this cannot override the selected model's floor.
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
  /**
   * **Told once for each level, when that level is final**: valid, checked,
   * and past any retry, so these are the paragraphs that will be stored if the
   * other level also lands. Brief is final long before Fuller, which is what
   * lets a reader be shown it while Fuller is still being written (plan
   * 261004f, stage 2). Nothing is stored by this: all or none still holds, and
   * a level announced here is lost with the press if the other one fails.
   *
   * A courtesy, so a listener that throws is ignored rather than allowed to
   * lose a paid write.
   */
  onLevel?: (level: SimpleLevel, paragraphs: SimpleParagraph[]) => void;
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
  /* The same band participates in the fingerprint: counting evidence alone
     does not make it recoverable from the rendered article's bytes. */
  const systems = SIMPLE_SYSTEMS_BY_BAND[evidenceBand(evidence)];
  /* What the checker quotes beside each paragraph: the same blocks' text. */
  const textOf = new Map(evidence.map((b) => [b.id as string, b.text]));
  const guard = opts.guard ?? SIMPLE_CHECK_ENABLED;
  const started = Date.now();
  const maxTokens = budgetFor("simple", ANSWER_TOKENS);
  const article = articleWithIds(meta, evidence);

  /* **One cache for the press's calls** (plan 261001j). Fired together, the
     calls each pay the article in full — or, if it is marked, each pay the
     1.25x cache write, because an entry cannot be read until the request
     writing it has begun (docs/project/prompt-caching.md § What breaks a
     cache, 4). So the article is marked, `FIRST_LEVEL` goes first, and Brief
     waits for its stream to begin. Measured when there were three levels, on
     three articles from cold: $0.142 a press became $0.090, for about two
     seconds more wait (16.2 s median against 14.2). Below the cache floor
     nothing can be cached, so they go together, unmarked, as before. */
  const cacheable = !underCacheFloor(article, modelFor("simple", opts.power));
  const stagger = cacheable;
  /* `cacheArticle` used to be the only reason Simple marked its one request.
     Now the press itself supplies its own reader, Brief, so every cacheable article is
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
            { type: "text" as const, text: systems[level] },
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
      try {
        message = await call.finalMessage();
      } finally {
        /* `calls` is requests, and a transport retry inside the gateway is a
           request (src/messages-stream.ts § `attempts`). */
        writerCalls += call.attempts() - 1;
      }
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
          answerChars: messageText(message).length,
        }),
        usage: message.usage,
      };
    }
    const raw = messageText(message);
    /* A complete usable response is the fallback for a provider/SDK path that
       succeeds without exposing `message_start`: the cache write is finished,
       so the waiting call cannot be stranded. */
    if (level === FIRST_LEVEL) begun(firstStarted ? "started" : "ended");
    return { raw, usage: message.usage };
  };

  /**
   * **One level, with one second chance when its answer fails validation.**
   * All-or-none turns each level's small failure rate into a press that fails
   * more often: with three levels, about one time in twelve (plan 261001b §
   * Ledger: 22 of 24 stored all three on the shipped settings; the losses there were a level one
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
         later. Wait for it rather than opening a call into it — it would
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
        const written = await writeLevel(level);
        try {
          opts.onLevel?.(level, written.paragraphs);
        } catch {
          /* See `onLevel`: never a reason to fail the press. */
        }
        return written;
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
    /* Summed over every call. */
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
