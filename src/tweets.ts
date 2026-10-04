/**
 * Pipeline stage 5c — the **thread**: the article as a short numbered sequence
 * of standalone posts. See docs/plans/260825g-tweet-thread-page.md.
 *
 * **There is no command line here.** Re-running this stage against one
 * article is a job, not a script:
 *
 *   POST /api/jobs { slug, steps: ["tweets"], force: ["tweets"] }
 *
 * That is the path the pipeline itself takes, so it exercises the store
 * writes — the half that actually breaks. The folder-reading CLI this file
 * used to carry was a second way to do the same thing, and was deleted on
 * 2026-09-01 (docs/project/ingest-queue.md § The pipeline is a list, not a function;
 * docs/plans/260831b-finish-the-database-move.md § sub-stage I).
 *
 * Why this exists, and the awkwardness it has to answer to. A tweet thread sits
 * close to two of vision.md's anti-goals — "read this in 2 minutes" and
 * "auto-generated confident claims with no path back to the source". Greg asked
 * for it anyway, and said what it is for: a reading aid first, copyable second.
 * So the prompt below is written against hype rather than for it, and when
 * accuracy and "good on X" pull apart, accuracy wins.
 *
 * **It is not part of a plain "add this URL".** `tweets` is in `STEP_ORDER` so
 * it sorts and so the API will accept the name, but `DEFAULT_INGEST_STEPS` in
 * src/pipeline.ts deliberately excludes it: a thread costs a model call and
 * exists only for articles somebody asks for one for.
 *
 * **Nothing here is silently modified.** The original version of this feature
 * fought its character limit twice — first truncating overlong posts to fit,
 * then reverting that on principle and rejecting the whole thread instead. Both
 * are bad: one hides what the model said, the other throws away eleven good
 * posts to punish one long one. We keep everything the model wrote, count the
 * characters ourselves, and record the count so the page can show the overrun.
 * See docs/plans/260825g-tweet-thread-page.md#the-character-limit-which-they-fought-about-twice.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { partsOf } from "./arc.js";
import type { Article } from "./article-input.js";
import { finishedText, streamMessage } from "./messages-stream.js";
import { effortFor, generatorFor, type ModelPower } from "./models.js";
import { anthropicCallFailed } from "./anthropic-call.js";
import {
  articleFingerprint,
  articleWithIdsFingerprint,
  type BlockFingerprint,
  fallbackHeadTitle,
  hashBlocks,
  type MetaFingerprintWithUrl,
} from "./source-hash.js";
import { budgetFor } from "./token-budget.js";
import type { Block, Meta, Tree, Tweet, TweetThread } from "./types.js";
import { parseJsonAnswer } from "./parse-json.js";
import {
  assertNoBlockIdEnums,
  validateAnthropicJsonSchema,
  withMessagesJsonSchema,
} from "./messages-structured-output.js";
import { articleWithIds } from "./article-prompt.js";
import { articleWordCounts, isBodyEvidence } from "./block-policy.js";
import { PROFILE_RULES, hashProfile, profileSection } from "./profile.js";
import { plainWords } from "./plain-words.js";
import { paperwork } from "./paperwork.js";

/**
 * `tweets/6`, 2026-10-01: the paperwork rule (src/paperwork.ts), a last post that
 * ends on the takeaway, and no author lists (Greg, SPIDERYARN-READING2-8M;
 * docs/plans/261001p-summaries-skip-the-paperwork-and-lead-with-the-takeaway.md).
 *
 * `tweets/5`, 2026-09-29: each post names the passages it was drawn from, so the
 * band can link it back to them (Greg, SPIDERYARN-READING2-5A;
 * docs/plans/260929f-tweets-become-a-mode-with-a-wide-band-and-block-links.md).
 * That meant sending `articleWithIds` rather than `articleText`, which moved the
 * fingerprint too — see `isStale`.
 *
 * `tweets/4`, 2026-09-28: the prompt's own plain-words wording gave way to the shared `plainWords` section, one rule for every prompt (Greg, 2026-09-28; docs/plans/260926a-plainer-summaries-and-glossary.md, stage 3).
 *
 * `tweets/7`, 2026-10-02: the request gained `TWEETS_OUTPUT_SCHEMA`; the
 * prompt text is unchanged.
 *
 * `tweets/8`, 2026-10-03: the shared paperwork rule names the title block and
 * the reference list as paperwork (Greg, spya-abs6bj;
 * docs/plans/261003c-summary-and-structure-skip-the-front-matter.md).
 */
export const PROMPT_VERSION = "tweets/8";

/** The most passages one post may link to. More is a row of chips nobody reads. */
export const MAX_POST_BLOCKS = 3;

/**
 * What a thread written from this prompt is fingerprinted with: the blocks, the
 * tree and the head `articleWithIds` prints, URL included — the FAQ's and the
 * ideas' fingerprint, because it is now their rendering of the article.
 */
export function inputFingerprint(
  blocks: readonly BlockFingerprint[],
  tree: Tree,
  meta: MetaFingerprintWithUrl | null,
): string {
  return articleWithIdsFingerprint(blocks, tree, meta);
}

/**
 * The per-post limit, in one place.
 *
 * The original left three different numbers lying around — the prompt said 270,
 * the schema said 280, the tooltip said 280 — which is the residue of the fight
 * described in the plan. Here there is one limit and one target, they mean
 * different things, and both are interpolated rather than retyped.
 *
 * `TARGET` is lower than `LIMIT` on purpose: whatever shows the thread puts a
 * "12/14 " in front of each post, and on X that prefix counts too.
 */
export const LIMIT = 280;
export const TARGET = 260;

/**
 * How many characters a post is, as a person would count them.
 *
 * Code points, not UTF-16 units: `"𝕏".length` is 2 and that is an artefact of
 * how JavaScript stores strings, not something a reader would ever say. This is
 * deliberately **not** X's own weighted algorithm, which counts CJK and emoji
 * double — our articles are English prose and the prompt forbids emoji, so the
 * two agree on everything we actually produce, and this one is explicable.
 */
export function countChars(text: string): number {
  return [...text].length;
}

/**
 * A fingerprint of the article the thread was written from — re-exported.
 *
 * **The implementation moved to src/source-hash.ts** when the glossary (stage
 * 5d) needed the identical question answered about its own artefact. Two stages
 * computing "the same" hash two ways is the second-copy-of-one-fact problem in
 * its most dangerous form: they can only ever disagree, and the day they do,
 * one artefact reports itself current against a different definition of
 * current. See src/source-hash.ts for the reasoning that used to live here.
 *
 * Re-exported rather than moved outright so that everything already importing
 * `hashBlocks` from this module — tests included — goes on working.
 *
 * Imported *and* re-exported, which looks redundant and is not: a bare
 * `export … from` re-exports without binding the name locally, so `isStale`
 * below stops compiling. The typecheck catches it, which is the only reason
 * this note is short.
 */
export { hashBlocks };

/**
 * Does this thread still describe the article on disk?
 *
 * The one thing their version could not answer. Their cache was "until the
 * document changes", enforced by a database row nobody re-checked, so a thread
 * outlived the article it summarised with nothing anywhere saying so.
 *
 * Pure, and read at both ends: `GET /api/tweets/:slug` puts the answer in the
 * response so the page can say the thread is out of date, and the step's
 * `stamp` (src/pipeline.ts) asks the same question of the store so the pipeline
 * will not skip a step whose artefact has gone stale.
 *
 * **`threadIsCurrent` used to sit below this**, wrapping it with the prompt
 * version and the model id to answer the step's `isDone`. Those are three
 * comparisons `sameStamp` makes in one place for every stage, so the step now
 * declares the three values and the function is gone — D0 of
 * docs/plans/260827aa-delete-the-importer.md. What went with it is a freshness check
 * that read `data/<slug>/` directly, which is a second door into the storage
 * the artefact store exists to be the only one of.
 *
 * **The tree and the metadata joined the fingerprint on 2026-08-31**, and until
 * then this asked about a third of what the prompt reads. `renderPrompt` builds
 * the skeleton out of `partsOf(tree)`, and `articleText` puts `TITLE:`, `BY:`
 * and `PUBLISHED IN:` at the head — so the sections could be re-cut or the
 * extracted title changed and the thread went on reporting itself current. Harmless
 * only while the pipeline's artefact reads answer `null` and the step re-runs
 * regardless; the moment they succeed it is a stale artefact that skips.
 * `articleFingerprint` in src/source-hash.ts,
 * docs/plans/260831b-finish-the-database-move.md § stage 1.
 */
export function isStale(
  thread: TweetThread,
  blocks: BlockFingerprint[],
  tree: Tree,
  meta: MetaFingerprintWithUrl | null,
): boolean {
  return thread.sourceHash !== fingerprintFor(thread, blocks, tree, meta);
}

/**
 * **Compared the way it was written.** A thread from before `tweets/5` was
 * hashed with `articleFingerprint` over `articleText`'s head; asking it the
 * newer question would call every thread stored before 2026-09-29 stale — a
 * banner saying the article moved when it had not. Those threads are merely
 * *outdated* (the prompt changed), which is the pipeline stamp's business and
 * is not announced (docs/plans/260929c-no-notice-when-a-mode-was-made-by-an-older-prompt.md).
 *
 * Keyed on the **parsed** producer version — `tweets/10` is after `tweets/5`,
 * which a string comparison would get wrong — rather than on the posts
 * carrying `blocks`, which a model can fail to fill without the prompt having
 * been any different. A version that does not parse is judged the old way:
 * every thread we ever wrote carries one, so that is a hand-made artefact, and
 * the cost of guessing wrong is a banner offering a rewrite. GPT Sol, plan
 * review, 2026-09-29.
 */
function fingerprintFor(
  thread: TweetThread,
  blocks: BlockFingerprint[],
  tree: Tree,
  meta: MetaFingerprintWithUrl | null,
): string {
  return sentIds(thread.version)
    ? inputFingerprint(blocks, tree, meta)
    : articleFingerprint(blocks, tree, meta);
}

/** The first prompt that sent the article with its block ids. */
const FIRST_WITH_IDS = 5;

/** Was a thread of this version written from `articleWithIds`? Exported for tests. */
export function sentIds(version: string): boolean {
  const m = /^tweets\/(\d+)$/.exec(version);
  return m !== null && Number(m[1]) >= FIRST_WITH_IDS;
}

/**
 * How many posts to ask for.
 *
 * The original asked for a flat 12 — "based on research: 10-15 tweets optimal
 * for academic content" — which is a fine number for a corpus of papers that
 * are all roughly one length. This pipeline eats a 500-word blog post and a
 * 13,000-word magazine essay, and twelve posts is a padding exercise for the
 * first and a compression to nothing for the second.
 *
 * So: one post per ~700 words, which is about the length of one idea in an
 * essay, clamped at both ends. The clamp is what stops a stub becoming a single
 * post and a book-length piece becoming forty. Our long test article (8,275
 * words) lands on 12, which is a decent sanity check on the divisor rather than
 * a coincidence worth claiming.
 */
export function suggestedLength(words: number): number {
  return Math.min(15, Math.max(4, Math.round(words / 700)));
}

export const TWEETS_SYSTEM = `You are writing a NUMBERED THREAD: one long article compressed into a short
sequence of standalone posts, each a few sentences long.

It is a READING AID. Someone reads the thread to decide whether to read the
article, or to hold its shape in mind after they have. Nobody is being sold
anything, and nothing here is promotion.

WHOSE VOICE IT IS

Yours, as a reader reporting what the piece says. Never the author's. This is
the difference between a summary and a misattribution, and it becomes invisible
the moment the thread is copied somewhere else.

  bad:  "I've spent ten years on this, and here is what I found."
  good: "Seth argues that ten years of this work point one way."
  bad:  "Consciousness is metabolic, not computational."
  good: "Consciousness, Seth argues, is metabolic rather than computational."

Attribute every contested claim. Where the piece states something uncontested as
plain fact, you may state it plainly too — a thread that hedges every sentence
is unreadable.

THE FIRST POST

Says what the piece CLAIMS. Not what it is about, and never a tease.

  bad:  "A fascinating new essay asks the question nobody wants to answer."
  bad:  "What if everything you know about machine consciousness is wrong?"
  good: "Anil Seth argues the question of machine consciousness is malformed:
         we keep asking it of the wrong kind of thing."

THE LAST POST

Ends on the piece's conclusion: where it lands, and any implication it states
itself. If it deliberately reaches no conclusion, end on the central question
it leaves open. Not a call to action, not "follow for more", not credits — whatever
shows this thread carries the article's own link already.

WHERE EACH POST CAME FROM

Every post names the passages it is drawn from: the ids of one to
${MAX_POST_BLOCKS} blocks. Pick the blocks a reader should go to in order to
check the post — where the claim is actually made, not every block that
mentions the topic. Use only ids that appear in the article above, copied
exactly.

RULES

- One idea per post. Each must stand alone, and the sequence must still read in
  order.
- ${TARGET} characters or fewer per post. Count them as you write. Going over is
  not fatal — nothing is truncated and nothing is discarded — but it is a defect
  and it will be shown as one.
- NO numbering. Do not write "1/", "3/12", or "🧵". The numbering is added when
  the thread is shown.
- No emoji, no hashtags, no "a thread:", no all-caps for emphasis.
- **Carry the caveats across.** Where the piece limits its own claim, hedges, or
  says what it has not shown, say so too. A thread that drops an argument's
  limits has changed the argument, and that is the failure this whole thing is
  most likely to commit.
- Never introduce a fact that is not in the article. No outside knowledge, no
  numbers you inferred, no examples of your own.
- No hype. Never "game-changing", "mind-blowing", "this changes everything",
  "buckle up", "let that sink in".
- No meta-narration: never "this section explores", "the author then turns to",
  "the piece goes on to argue". Say the thing the piece says.
- Prioritise comprehension over engagement.

OUTPUT

JSON only, no prose, no code fence:

{"tweets": [{"text": "...", "blocks": ["spya-...", "spya-..."]}, ...]}

Each element is one post, in order: its text, with no numbering in it, and the
ids of the blocks it came from. Nothing else — no summary, no title, no
commentary about the thread.

${plainWords("explain")}

${paperwork("summary")}

${PROFILE_RULES}`;

/**
 * The article, and enough about who wrote it to attribute anything to them.
 *
 * The byline is not decoration here: the voice rule above is "Seth argues",
 * and without a name the model can only write "the author argues" over and
 * over, which reads like a book report. Absent, we say so plainly rather than
 * letting the model invent one.
 *
 * The skeleton comes first for the same reason it does in the arc: it is what
 * lets the thread follow the piece's argument rather than its paragraphs. The
 * full text follows it so the posts stay in the author's own words rather than
 * becoming a summary of a summary.
 */
/* Exported for tests/profile-prompts.test.ts, which pins the two things a
   profile must do here: arrive when there is one, and leave no trace when
   there is not. Same reason src/glossary.ts and src/quotes.ts export theirs. */
export function renderPrompt(opts: {
  meta: Meta | null;
  tree: Tree;
  posts: number;
  /**
   * Who is reading, already rendered — `renderProfile` in src/profile.ts.
   *
   * The weakest of the five cases and included because Greg asked for it: a
   * thread is written for whoever scrolls past it, so "who is reading" is a
   * stranger claim here than it is for a glossary. What it can honestly change
   * is which of the article's threads gets pulled out — and that is worth
   * having. In the user prompt, never the `system` block, which is where the
   * article and the breakpoint are.
   */
  profile: string | null;
}): string {
  const { meta, tree, posts } = opts;
  const skeleton = partsOf(tree)
    .map((p, i) => `PART ${i + 1}: ${p.title}\n  ${p.gist ?? "(no gist)"}`)
    .join("\n\n");

  /* Stays here rather than moving into the cached block with the rest of the
     metadata: it is an *instruction* about how to refer to the author, not a
     fact about the article, and the cached block has to be the same bytes for
     every stage that reads it. */
  /* **Never a list of authors** (Greg, SPIDERYARN-READING2-8M): "Refer to them
     by surname" over a nine-name byline opened a thread with all nine. When the
     structured list says there are more than two we say so outright, rather
     than asking the model to count a free-text byline (GPT Sol's plan review,
     P2-9); without it, the model is asked to count. */
  const count = meta?.authors?.length ?? 0;
  const author = meta?.byline
    ? count > 2
      ? `Written by ${meta.byline}. That is ${count} authors: write "the authors", or the first author's surname and "colleagues". Never list them.`
      : `Written by ${meta.byline}. Refer to them by surname; if there are more than two, write "the authors", or the first author's surname and "colleagues". Never list them.`
    : "The byline is unknown. Write \"the author\" — do not guess a name.";

  /* The full text and the title moved to a cached `system` block — see
     `generateThread`. What is left is what only this stage asks for. */
  const who = profileSection(opts.profile);

  return `Write about ${posts} posts. Adjust that up or down a little if the piece
genuinely needs it.

${author}

${who ? `${who}\n\n` : ""}=== ITS SHAPE ===

${skeleton}`;
}

/**
 * Read the model's answer, fence, preamble, sign-off and all.
 *
 * `parseJsonAnswer`, never a bare `JSON.parse` — src/parse-json.ts has the
 * reasoning, and the short version is that nothing in this file logs and that is
 * not enough, because a thrown error is logged where it is caught and V8 quotes
 * the input in it.
 */
function parseJson(raw: string): { tweets?: unknown } {
  return parseJsonAnswer<{ tweets?: unknown }>(raw, "the tweet-thread response");
}

const tweetObjectSchema = {
  type: "object",
  properties: {
    text: { type: "string" },
    blocks: { type: "array", items: { type: "string" } },
  },
  required: ["text", "blocks"],
  additionalProperties: false,
} as const;

/** The object row the current prompt requires; the parser below remains tolerant of stored legacy rows. */
export const TWEETS_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    tweets: {
      type: "array",
      items: tweetObjectSchema,
    },
  },
  required: ["tweets"],
  additionalProperties: false,
} as const;

validateAnthropicJsonSchema(TWEETS_OUTPUT_SCHEMA);
assertNoBlockIdEnums(TWEETS_OUTPUT_SCHEMA, ["blocks"]);

/** One post as the model sent it, before anything is checked. */
interface RawPost {
  text: string;
  blocks: unknown;
}

/**
 * The model's `tweets` array, read tolerantly.
 *
 * A bare string is the `tweets/4` shape and is accepted as a post with no
 * passages: a model slipping back to the old shape should cost the links, not
 * the thread. Anything that is neither a string nor an object with a string
 * `text` is not a post and is skipped.
 */
function rawPosts(value: unknown): RawPost[] {
  if (!Array.isArray(value)) return [];
  const out: RawPost[] = [];
  for (const item of value) {
    if (typeof item === "string") {
      out.push({ text: item, blocks: [] });
    } else if (item && typeof item === "object") {
      const { text, blocks } = item as { text?: unknown; blocks?: unknown };
      if (typeof text === "string") out.push({ text, blocks });
    }
  }
  return out;
}

/** What validation took out of the posts' passages. Logged as counts, never text. */
export interface PostBlocksDropped {
  /** Ids that are not one of the blocks the model was shown. */
  unknownIds: number;
  /** Ids past `MAX_POST_BLOCKS` on one post. */
  overCap: number;
  /** Posts left with no passage at all. Kept — the text is still the thread. */
  unlinkedPosts: number;
}

export function emptyPostBlocksDropped(): PostBlocksDropped {
  return { unknownIds: 0, overCap: 0, unlinkedPosts: 0 };
}

/**
 * **Only ids the model was shown survive**, deduplicated, in article order, and
 * at most `MAX_POST_BLOCKS`. Article order rather than the model's, so a post's
 * links read down the page the way the reader will follow them.
 */
function checkBlocks(
  value: unknown,
  order: ReadonlyMap<string, number>,
  dropped: PostBlocksDropped,
): string[] {
  const ids = Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  const known: string[] = [];
  for (const raw of ids) {
    const id = raw.trim();
    if (!order.has(id)) {
      dropped.unknownIds++;
      continue;
    }
    if (!known.includes(id)) known.push(id);
  }
  known.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  if (known.length > MAX_POST_BLOCKS) dropped.overCap += known.length - MAX_POST_BLOCKS;
  return known.slice(0, MAX_POST_BLOCKS);
}

/**
 * Count the posts' characters, without changing a character of any of them.
 *
 * **There is no stored post number**, and that is deliberate. Position is the
 * array's job and the array already does it; a `number` field beside the index
 * is a second copy of the same fact, and the two can only ever disagree — which
 * is how a page comes to render "3/12" twice. `index + 1` at the point of
 * display cannot.
 *
 * An empty thread throws. A zero-post thread is not a degenerate success, it is
 * a model call that produced nothing, and writing it to disk would make the
 * step report done for ever after.
 */
export function buildThread(
  parsed: { tweets?: unknown },
  opts: {
    slug: string;
    sourceHash: string;
    elapsedMs: number;
    /** The rendered profile this was written from, or null for none. */
    profile?: string | null;
    /**
     * The blocks the model was shown, in article order — the only ids a post may
     * keep. src/block-policy.ts § `isBodyEvidence` decides which those are.
     */
    shown: readonly Pick<Block, "id">[];
    /** Filled in with what was taken out, for the caller to log. */
    dropped?: PostBlocksDropped;
    /** The power it was written at — the stamp names the model (plan 260930f). */
    power: ModelPower;
  },
): TweetThread {
  const order = new Map(opts.shown.map((b, i) => [b.id, i] as const));
  const dropped = opts.dropped ?? emptyPostBlocksDropped();
  const posts = rawPosts(parsed.tweets)
    .map((p) => ({ text: p.text.trim(), blocks: p.blocks }))
    .filter((p) => p.text.length > 0);
  if (posts.length === 0) {
    throw new Error("The model returned no posts. Nothing to write.");
  }
  /* **A post is never dropped for losing its passages** — the rule at the top
     of this file: nothing the model wrote is silently removed. It keeps its
     text and draws no link, and the count says so. */
  const tweets: Tweet[] = posts.map((p) => {
    const blocks = checkBlocks(p.blocks, order, dropped);
    if (blocks.length === 0) dropped.unlinkedPosts++;
    return { text: p.text, chars: countChars(p.text), blocks };
  });
  return {
    version: PROMPT_VERSION,
    generator: generatorFor(opts.power),
    slug: opts.slug,
    sourceHash: opts.sourceHash,
    /* `null`, never absent: absent means "written before this existed" and
       `null` means "written deliberately without a profile", and the page needs
       to tell those apart. src/profile.ts § profileIsStale. */
    profileHash: opts.profile ? hashProfile(opts.profile) : null,
    limit: LIMIT,
    tweets,
    generatedAt: new Date().toISOString(),
    elapsedMs: opts.elapsedMs,
  };
}

/** How many posts went over the limit. What the step reports on its run. */
export function overLimit(thread: TweetThread): number {
  return thread.tweets.filter((t) => t.chars > thread.limit).length;
}

export interface TweetsRun {
  thread: TweetThread;
  blocks: number;
  words: number;
  over: number;
  inputTokens: number;
  outputTokens: number;
  /* What the cache did on this call. Reported next to the token counts because
     a cache that has silently stopped hitting is indistinguishable from one that
     is working — same answer, no error, a bigger bill.
     docs/reusable/silent-success.md. */
  cacheReadTokens: number;
  cacheWriteTokens: number;
  elapsedMs: number;
  /** What validation took out of the posts' passages. */
  dropped: PostBlocksDropped;
}

/**
 * Stage 5c over one article: a single model call, and the thread it returns.
 *
 * **It writes nothing, and it reads nothing.** It used to drop `tweets.json`
 * beside the tree and the arc, which works on a laptop and cannot work through
 * a store that puts the artefact in a Postgres column — so the caller writes
 * now: src/pipeline.ts through the store, `main()` below to the directory it
 * was given. The blocks, the tree and the metadata arrive together as one
 * `Article` (src/article-input.ts), so the bytes the thread is written from are
 * the bytes its `stamp` fingerprinted.
 * docs/plans/260831b-finish-the-database-move.md § Stage 2.
 *
 * Exported because two callers run this stage and they must not drift —
 * `main()` below, and the ingest queue in the server process (src/pipeline.ts).
 *
 * The call is timed from **out here**, not from the SDK's own timestamps. The
 * previous version of this project asked the SDK and got empty values back,
 * which its display then rendered as `0ms` — a duration that reads as "instant"
 * rather than as "we don't know". See
 * docs/project/original-version/borrow-list.md.
 */
export async function generateTweets(opts: {
  article: Article;
  onProgress?: (detail: string) => void;
  /** Cancel the call. The queue passes its job's signal — src/jobs.ts. */
  signal?: AbortSignal;
  /**
   * Mark the article as a cache breakpoint.
   *
   * **Off by default, because a cache write costs 1.25x and a prefix nobody
   * reads never earns it back.** Each of these stages makes one call per run, so
   * none of them caches anything for itself; the entry only pays off if a stage
   * with the same renderer, effort and output schema runs behind it, inside the
   * 5-minute TTL. No current peer has Tweets' schema (`ARTICLE_OUTPUT_FORMAT`
   * in src/pipeline.ts). Ordinary ingest stops at `arc` — tweets, glossary and summary
   * are things a reader asks for later — so on the normal path that reader never
   * arrives, and marking unconditionally was a premium paid on every article
   * against a read that does not come. src/jobs.ts sets this from the steps the
   * job actually has left. Raised by GPT Sol's review, 2026-08-26; see
   * docs/project/prompt-caching.md.
   */
  cacheArticle?: boolean;
  /**
   * Who is reading, already rendered — `renderProfile` in src/profile.ts.
   *
   * The weakest of the five cases: a thread is written for whoever scrolls past
   * it. What it can honestly change is which of the article's threads gets
   * pulled out. Resolved by whoever queued the job, not read here — src/jobs.ts.
   */
  profile?: string | null;
  /** Which capable model writes it — the article's High-powered AI setting (plan 260930f). */
  power: ModelPower;
}): Promise<TweetsRun> {
  /* `meta` is `null` when the article has no metadata, and that is a state
     rather than a failure: the thread loses the author's name, which the prompt
     handles in so many words, and the fingerprint below is handed the same
     `null` the prompt was. Whoever built the `Article` resolved it — two
     resolutions of "is there metadata" are two answers waiting to differ.
     src/article-input.ts. */
  const { blocks, tree, meta: realMeta } = opts.article;
  /* `articleWithIds` needs a head; with no metadata it prints the slug, which is
     what `articleWithIdsFingerprint` resolves `null` to as well — the FAQ's and
     the ideas' arrangement exactly (src/faq.ts). The byline instruction in
     `renderPrompt` still sees the real `null`. */
  const meta: Meta = realMeta ?? ({ title: fallbackHeadTitle(tree) } as Meta);

  /* Read once, used for both the prompt and the stamp — the stamp's whole job
     is to name what the prompt actually carried. */
  const profile = opts.profile ?? null;

  /* **The argument, not the apparatus.** Applied here at the call site rather
     than inside `articleText`/`articleWithIds`, and that is the whole care in
     this line: the two builders look like the seam between automatic and asked
     work and they are not — `ideas` is automatic and sends ids, while
     `explain`, `search` and `converse` are *asked* and send ids too. Filtering
     inside the builders would be right three times and would silently leave
     `ideas` summarising the bibliography. src/block-policy.ts. */
  const evidence = blocks.filter(isBodyEvidence);
  /* The **body's** words, from the shared derivation. A thread's length is
     chosen from how much argument there is; sizing it from a word count that
     includes the endnotes, while the prompt above excludes them, is the same
     braiding one layer down. src/block-policy.ts. */
  const words = articleWordCounts(blocks).body;
  const posts = suggestedLength(words);
  const started = Date.now();

  /* A thread is a bounded thing — `suggestedLength` caps it — so the answer is
     a few thousand tokens whatever the article. The allowance still has to
     scale, because the model reads the whole piece to write it and thinks about
     it inside this same number. See src/token-budget.ts. */
  const answerTokens = 500 + posts * 140;
  const maxTokens = budgetFor("thread", answerTokens);

  /* The request itself, wrapped: a 429/401/etc from the SDK is not caught
     anywhere upstream of here, and the installed SDK builds `Error.message`
     from the upstream error body — the one place it can echo back part of
     what we sent, which is the whole article. See src/anthropic-call.ts.

     The client is built by `streamMessage`, which also sets `logLevel: "off"`
     — a privacy setting rather than a preference. The SDK has a logger of its
     own that defaults to `console` and reads `ANTHROPIC_LOG` from the
     environment; at `debug` it prints the outgoing request — **which is the
     whole article** — and, for a non-JSON error response, the raw upstream
     body. Neither goes through Pino, so neither can be redacted, and
     `anthropicCallFailed` never sees them. See docs/project/logging.md. */
  let message: Anthropic.Message;
  try {
    const call = streamMessage("tweets", withMessagesJsonSchema({
      max_tokens: maxTokens,
      thinking: { type: "adaptive" },
      output_config: { effort: effortFor("tweets") },
      /* Article first, this stage's instructions second — the prefix runs from the
         top of the request, so the article has to precede anything stage-specific
         for matching article bytes to be cache-compatible. Distinct output
         schemas currently separate every article stage anyway.
         docs/plans/260826g-prompt-caching.md. */
      system: [
        {
          type: "text" as const,
          /* **`articleWithIds`, not `articleText`, since `tweets/5`**: each post
             names its passages, so the ids have to be on the page. That moves
             this stage out of arc/glossary's renderer and into the ids renderer
             used by Ideas and FAQ. Its schema still gives it a distinct cache
             key — `ARTICLE_OUTPUT_FORMAT` in src/pipeline.ts. */
          text: articleWithIds(meta, evidence),
          ...(opts.cacheArticle ? { cache_control: { type: "ephemeral" as const } } : {}),
        },
        { type: "text" as const, text: TWEETS_SYSTEM },
      ],
      messages: [{ role: "user", content: renderPrompt({ meta: realMeta, tree, posts, profile }) }],
    }, TWEETS_OUTPUT_SCHEMA), { power: opts.power, ...(opts.signal ? { signal: opts.signal } : {}) });

    if (opts.onProgress) {
      const report = opts.onProgress;
      let chars = 0;
      let last = 0;
      call.onText((delta) => {
        chars += delta.length;
        // Throttled: the model emits deltas far faster than anyone can read them,
        // and every one of these is a write the job poller may pick up.
        const now = Date.now();
        if (now - last < 500) return;
        last = now;
        report(`about ${posts} posts, ${Math.round(chars / 1000)}k characters so far`);
      });
    }

    /* `call.finalMessage()`, never `call.stream.finalMessage()` — the wrapper is
       what records what this call cost. The stream's own method works and
       records nothing. See src/messages-stream.ts. */
    message = await call.finalMessage();
  } catch (err) {
    throw anthropicCallFailed(err);
  }
  const raw = finishedText(message, "thread", maxTokens, answerTokens);


  const dropped = emptyPostBlocksDropped();
  const thread = buildThread(parseJson(raw), {
    slug: tree.slug,
    sourceHash: inputFingerprint(blocks, tree, realMeta),
    profile,
    elapsedMs: Date.now() - started,
    shown: evidence,
    dropped,
    power: opts.power,
  });

  return {
    thread,
    blocks: blocks.length,
    words,
    over: overLimit(thread),
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
    cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
    elapsedMs: thread.elapsedMs,
    dropped,
  };
}
