/**
 * Pipeline stage 5f — the **ideas**: the propositions a reader has to hold in
 * order to get this piece.
 *
 *   npm run ideas -- data/writes
 *
 * The glossary (stage 5d) answers *what does this word mean*, on both sides of
 * the introduced/assumed line — `senseHere` is what the author means,
 * `background` is what you bring. This answers the other unit. A term is a noun
 * phrase and the answer to it is a definition; **an idea has a claim shape**,
 * and the answer is a sentence you could carry to a different article and use.
 *
 * Full design, the alternatives, and the cross-family review that rewrote half
 * of it: docs/plans/ideas-mode.md.
 *
 * ## The three things here that are not the glossary's
 *
 * 1. **The occurrences come from the model, so every one of them is checked.**
 *    A glossary entry's `blocks` are computed by us — the model never sees a
 *    block id and so cannot invent one. An idea has no name to match, so the
 *    model must name ids, and this file therefore runs the *other* discipline:
 *    `validateOccurrences` drops any id not in blocks.json and any quote
 *    `findQuote` cannot locate, and counts what it dropped. Same shape as
 *    `validateHits` in src/search.ts, which is where it is copied from.
 *
 * 2. **An idea with no surviving occurrence is dropped.** The glossary
 *    deliberately keeps a term that matched nothing and says so, because an
 *    unmatched entry is still a definition you can read. An idea with no
 *    occurrence is a claim with no evidence and no way back to the page, which
 *    is what vision.md § Principles 4 refuses. It is also exactly the failure
 *    to expect — the model naming a general topic instead of finding a
 *    load-bearing assumption — so the count is logged.
 *
 * 3. **No append, and therefore no pagination.** The glossary paginates because
 *    an article can hold an encyclopaedia of terms and their *output* length
 *    caused a production outage. A piece has three to ten ideas. Running this
 *    again replaces, which deletes the FORBIDDEN checklist, `existingFor`,
 *    `passes` and "a stale glossary is not appended to" in one go. What
 *    survives is id inheritance, and see `idsByName` for why its promise is
 *    weaker here than there.
 *
 * **The freshness input is blocks AND tree**, unlike every artefact before it —
 * see `inputFingerprint`. And the profile is in the stamp rather than merely
 * recorded, because "what you need to bring" is *defined by* who is reading.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { partsOf } from "./arc.js";
import { mintUniqueId } from "./ids.js";
import { streamMessage, wasRefused } from "./messages-stream.js";
import { CAPABLE_MODEL, effortFor } from "./models.js";
import { MODEL_REFUSED } from "./messages.js";
import { anthropicCallFailed } from "./anthropic-call.js";
import { hashBlocks, structureHash, type BlockFingerprint } from "./source-hash.js";
import { findQuote } from "./quote-match.js";
import { budgetFor, truncationFailure } from "./token-budget.js";
import { parseJsonFrom, readJsonOrNull, stripFence } from "./parse-json.js";
import { articleWithIds } from "./article-prompt.js";
import { articleWordCounts, isBodyEvidence } from "./block-policy.js";
import { loadEnvLocal } from "./env.js";
import { PROFILE_RULES, hashProfile, profileSection } from "./profile.js";
import type {
  Block,
  BlockId,
  Idea,
  IdeaOccurrence,
  IdeaProvenance,
  Ideas,
  Meta,
  Tree,
} from "./types.js";
import type { ArtifactStore } from "./store/artifacts.js";
import { stageCli } from "./cli-ledger.js";

/**
 * Bumped whenever the prompt changes in a way that changes what an idea *is*.
 *
 * Exported so tests assert against the current value rather than pinning a
 * literal that has to be edited on every bump — a fixture that hardcodes the
 * version tests the fixture.
 */
export const PROMPT_VERSION = "ideas/1";

/** The most ideas one call may return. A piece does not have forty. */
export const MAX_IDEAS = 10;

/** The most occurrences one idea may carry into the artefact. */
export const MAX_OCCURRENCES = 6;

const PROVENANCES: ReadonlySet<string> = new Set<IdeaProvenance>(["assumed", "introduced"]);

/**
 * How many ideas to ask for — one per ~800 words, clamped to 3–10.
 *
 * Half the density of `suggestedCount` in src/glossary.ts, deliberately. A term
 * is a word the piece happens to use; an idea is something the whole argument
 * leans on, and there are far fewer of them in any article. Asking for one per
 * 400 words would be asking the model to pad, and padding here does not produce
 * a weak entry the reader can skip — it produces a *theme*, which is the
 * failure mode this stage is most likely to have.
 */
export function suggestedIdeas(words: number): number {
  return Math.min(MAX_IDEAS, Math.max(3, Math.round(words / 800)));
}

/**
 * What this artefact was written from: **the blocks and the tree**.
 *
 * The first stage to fold the second half in, and it is not a refinement — it
 * closes a hole `StepStamp` (src/store/artifacts.ts) has flagged since it was
 * written: *"`arc`, `tweets`, `glossary` and `summary` all read the tree as
 * well as the blocks, and src/labels.ts already keeps a separate
 * `structureHash` precisely because section boundaries can move without a
 * single block changing."*
 *
 * It matters more here than anywhere. The prompt shows the model the skeleton
 * *before* the article, so that it judges what is load-bearing against the
 * shape of the argument rather than against how often a phrase appears. Re-cut
 * the sections and that judgment is being made against a different question —
 * while every block is byte-identical and a blocks-only hash reports no change
 * at all.
 */
export function inputFingerprint(blocks: readonly BlockFingerprint[], tree: Tree): string {
  return `${hashBlocks(blocks)}.${structureHash(tree)}`;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** One idea as the model returns it, before any of it has been believed. */
interface RawIdea {
  name?: unknown;
  provenance?: unknown;
  statement?: unknown;
  whyYouNeedIt?: unknown;
  analogy?: unknown;
  occurrences?: unknown;
}

interface RawOccurrence {
  blockId?: unknown;
  quote?: unknown;
  reasoning?: unknown;
}

/**
 * What was thrown away, and why. **Every one of these is invisible from
 * outside** — a dropped occurrence looks exactly like a passage the model chose
 * not to name — which is the whole reason they are counted and logged.
 *
 * Counts only. Never the quote, never the statement, never the raw parse error:
 * this file does not log, but a step that throws is logged by src/jobs.ts with
 * `errorFields`, and an error is a value that travels.
 */
export interface Dropped {
  /** A `blockId` that is not in blocks.json. The model invented it. */
  unknownIds: number;
  /** A `quote` that `findQuote` could not locate in the block the model named. */
  unquoted: number;
  /** Occurrences past `MAX_OCCURRENCES` on one idea. */
  truncated: number;
  /** Ideas past `MAX_IDEAS`, discarded whole. */
  overCap: number;
  /** Ideas with a name but no usable prose, or an unusable provenance. */
  malformed: number;
  /**
   * **Assumed** occurrences with no `reasoning`, and assumed ideas with no
   * `whyYouNeedIt`.
   *
   * Its own counter rather than folded into `malformed`, because it is a
   * different fact and the difference is the whole feature: a malformed idea is
   * one we could not read, and this is one we could read perfectly well and
   * which **does not carry its argument**.
   *
   * An assumed idea's entire claim is that the piece would not go through
   * without it. The passage alone cannot establish that — it only proves the
   * passage exists — so an assumed occurrence with no line saying which
   * inferential step fails is a block id lending the appearance of evidence to
   * an assertion nobody has argued for. That is the failure this whole mode is
   * shaped against (docs/project/ideas.md § It is a hypothesis), and it was
   * getting through: GPT Sol's review of the built code, 2026-08-27.
   */
  unargued: number;
  /**
   * Ideas that lost **every** occurrence and were therefore dropped whole.
   *
   * The one quality signal this stage gives about what the model returned, and
   * the number to watch on a first run: a high count means the model is naming
   * topics rather than finding load-bearing propositions.
   */
  unanchored: number;
}

/**
 * Believe an occurrence only if the article backs it up.
 *
 * Copied from `validateHits` in src/search.ts, and the reason it is copied
 * rather than shared is that the two disagree about `confidence` — search
 * clamps a number into 0–100, and an idea has no such field at all (see
 * `IdeaOccurrence` in src/types.ts for why). Everything else is the same
 * discipline: **the id must exist, and the words must be there.**
 *
 * `findQuote` and not a string compare, because it is the rule the browser will
 * use to draw the marks. If the server's idea of "is this quote in this block"
 * differed from the client's, the panel would list a passage and the article
 * would show nothing marked — the failure src/quote-match.ts exists to prevent.
 */
export function validateOccurrences(
  raw: unknown,
  blocks: readonly Block[],
  dropped: Dropped,
  /**
   * `true` when the idea claims to be *assumed*, which raises the bar on every
   * occurrence under it: it must say which local step fails without the idea.
   * See `Dropped.unargued`.
   */
  assumed: boolean,
): IdeaOccurrence[] {
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const out: IdeaOccurrence[] = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    /* Per element, before any field is read. A `null` or a bare string in the
       array throws on the first property access and takes the whole idea with
       it — the salvage this function advertises has to cover the array's
       elements, not only the fields inside them. src/glossary.ts § `toEntries`
       had exactly this bug and it was found in review. */
    if (!item || typeof item !== "object") {
      dropped.malformed++;
      continue;
    }
    const o = item as RawOccurrence;
    const blockId = text(o.blockId) as BlockId;
    const block = byId.get(blockId);
    if (!block) {
      dropped.unknownIds++;
      continue;
    }
    const quote = text(o.quote);
    const span = quote ? findQuote(block.text, quote) : null;
    if (!span) {
      dropped.unquoted++;
      continue;
    }
    const reasoning = text(o.reasoning);
    /* For an assumed idea this is not a nicety. The panel puts these passages
       under "the model thinks these passages rely on it", and without the line
       naming what fails they are just paragraphs sitting beside a claim —
       which is exactly the shape of evidence, with none of the substance. An
       introduced idea is different: the passage *states* the thing, so the
       reader can check it by reading, and a missing line costs them nothing
       they cannot get themselves. */
    if (assumed && !reasoning) {
      dropped.unargued++;
      continue;
    }
    out.push({
      blockId,
      quote,
      reasoning,
      /* A disambiguator between repeats, never the anchor — the client re-finds
         the words itself in the *rendered* text, which is a different offset
         space from `block.text`. src/web/annotate.ts § the header. */
      start: span.start,
    });
  }
  if (out.length > MAX_OCCURRENCES) {
    dropped.truncated += out.length - MAX_OCCURRENCES;
    return out.slice(0, MAX_OCCURRENCES);
  }
  return out;
}

/**
 * Turn what the model said into ideas, believing as little of it as possible.
 *
 * The drop rule is **a name, a statement, a usable provenance, and at least one
 * surviving occurrence**. The first three are what makes an idea readable; the
 * fourth is what makes it checkable, and it is the rule this stage does not
 * share with the glossary — see the header.
 *
 * Everything else degrades rather than failing the batch. Nine good ideas must
 * not be lost because one came back with `provenance: "both"`.
 */
export function toIdeas(
  raw: unknown,
  blocks: readonly Block[],
  taken: Set<string>,
  dropped: Dropped,
): Idea[] {
  const out: Idea[] = [];
  const raws = Array.isArray(raw) ? raw : [];
  for (const [i, item] of raws.entries()) {
    if (!item || typeof item !== "object") {
      dropped.malformed++;
      continue;
    }
    const r = item as RawIdea;
    const name = text(r.name);
    const statement = text(r.statement);
    const provenanceText = text(r.provenance).toLowerCase();
    if (!name || !statement || !PROVENANCES.has(provenanceText)) {
      dropped.malformed++;
      continue;
    }
    const provenance = provenanceText as IdeaProvenance;
    const assumed = provenance === "assumed";
    const whyYouNeedIt = text(r.whyYouNeedIt);
    /* Checked before the occurrences, so an assumed idea that cannot say what
       fails without it costs nothing to reject. The prompt calls this field
       required for `assumed` and optional for `introduced`; a rule the prompt
       states and the validator does not enforce is a rule that holds until the
       first time it matters. */
    if (assumed && !whyYouNeedIt) {
      dropped.unargued++;
      continue;
    }
    const occurrences = validateOccurrences(r.occurrences, blocks, dropped, assumed);
    if (occurrences.length === 0) {
      dropped.unanchored++;
      continue;
    }
    const analogy = text(r.analogy);
    out.push({
      id: mintUniqueId(taken),
      name,
      provenance,
      statement,
      ...(whyYouNeedIt ? { whyYouNeedIt } : {}),
      ...(analogy ? { analogy } : {}),
      occurrences,
    });
    /* **The cap is enforced here, not merely requested in the prompt.**
       `suggestedIdeas` asks for at most `MAX_IDEAS`; nothing made the model
       obey, and everything else in this file believes as little as possible of
       what came back. It also has a second effect nobody would look for: the
       band synthesises a `createdAt` per idea from its index, and `#10` sorts
       before `#2` lexicographically, so an eleventh idea would quietly reshuffle
       the palette. GPT Sol, 2026-08-27. */
    if (out.length === MAX_IDEAS) {
      dropped.overCap += Math.max(0, raws.length - i - 1);
      break;
    }
  }
  return out;
}

/**
 * Ids from a list this run is replacing, keyed by normalised name.
 *
 * **The promise here is weaker than the glossary's, and saying so is the
 * point.** `idsByTerm` works because *"United States of America"* comes back
 * spelled the same way twice. An idea's name is a sentence, and a regeneration
 * will paraphrase it — *"Writing is a test of thought"* and *"Prose is where
 * thinking is tested"* are the same idea and will not match here.
 *
 * So a `?idea=` link survives an unchanged name and nothing more, and that is a
 * deliberate stopping point rather than an oversight. The tempting next step is
 * fuzzy matching, and it is the wrong one: **inheriting an id wrongly is worse
 * than minting a new one.** A stale link that lands on nothing is a dead end
 * the reader can see; one that lands on a *different* idea is a dead end that
 * looks like it worked. If this is ever strengthened, the honest signal is
 * occurrence overlap — the evidence is stable even when the wording is not.
 */
export function idsByName(onDisk: Ideas | null): Map<string, string> {
  const out = new Map<string, string>();
  for (const idea of onDisk?.ideas ?? []) {
    const key = normaliseName(idea.name);
    if (key && !out.has(key)) out.set(key, idea.id);
  }
  return out;
}

/** A name reduced to the form two spellings of it have in common. Comparison key only. */
export function normaliseName(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")
    .trim();
}

function inheritIds(fresh: Idea[], inherit: Map<string, string> | null): Idea[] {
  if (!inherit || inherit.size === 0) return fresh;
  const used = new Set<string>();
  return fresh.map((idea) => {
    const old = inherit.get(normaliseName(idea.name));
    /* `used`, because two fresh ideas can normalise to one old name and an id
       handed out twice is worse than a new one — `?idea=` would then address
       whichever the panel happened to find first. */
    if (!old || used.has(old)) return idea;
    used.add(old);
    return { ...idea, id: old };
  });
}

/**
 * Assumed first, then introduced; within each group, first occurrence.
 *
 * Assumed leads because a prerequisite is worth having *before* you read and a
 * takeaway is not. Within a group the order is the reader's own way through the
 * piece, so the model has chosen nothing there.
 *
 * **The order is fixed at write time and never re-derived**, because
 * `assignSlots` in src/web/hit-colours.ts colours by walking the list: a list
 * that reordered itself between reads would recolour every idea on the rail.
 */
export function inReadingOrder(ideas: Idea[], blocks: readonly Block[]): Idea[] {
  const position = new Map<BlockId, number>();
  for (const [i, b] of blocks.entries()) position.set(b.id, i);
  const rank = (idea: Idea): number => {
    let first = Number.MAX_SAFE_INTEGER;
    for (const o of idea.occurrences) {
      const at = position.get(o.blockId);
      if (at !== undefined && at < first) first = at;
    }
    return first;
  };
  const group = (idea: Idea): number => (idea.provenance === "assumed" ? 0 : 1);
  return ideas
    .map((idea, i) => ({ idea, i, group: group(idea), rank: rank(idea) }))
    .sort((a, b) => {
      if (a.group !== b.group) return a.group - b.group;
      if (a.rank !== b.rank) return a.rank - b.rank;
      // Index as the tie-break, so two ideas first needed in the same block
      // have a reason for their order rather than an accident of sort stability.
      return a.i - b.i;
    })
    .map((x) => x.idea);
}

/** The artefact, from what the model said plus what we could verify of it. */
export function buildIdeas(
  parsed: { ideas?: unknown },
  opts: {
    slug: string;
    blocks: readonly Block[];
    sourceHash: string;
    profile?: string | null;
    elapsedMs: number;
    inherit?: Map<string, string> | null;
    dropped: Dropped;
  },
): Ideas {
  const taken = new Set<string>(opts.inherit?.values() ?? []);
  const fresh = inheritIds(
    toIdeas(parsed.ideas, opts.blocks, taken, opts.dropped),
    opts.inherit ?? null,
  );
  /* Nothing to say is not a degenerate success — it is a model call that
     produced nothing, and writing it would make the step report done for ever
     after. The same rule `buildGlossary` follows, and it matters more here
     because every idea can be dropped by validation rather than by the model
     declining to answer. */
  if (fresh.length === 0) {
    /* **The counts, in the message.** Without them this reads as "the model
       said nothing", which is one of four very different failures: it really
       did return nothing; it named block ids that are not in the article; it
       paraphrased its quotes; or its ideas were malformed. The first version of
       this threw the bare sentence, and the actual cause — a prompt asking for
       ids against a renderer that omits them — was invisible in it.
       docs/reusable/silent-success.md, from the other side. */
    const d = opts.dropped;
    throw new Error(
      "No ideas could be anchored to the article, so there is nothing to write. " +
        `Dropped: ${d.unanchored} with no usable passage, ${d.unargued} assumed without ` +
        `saying what fails without them, ${d.unknownIds} passages naming a block id that is ` +
        `not in this article, ${d.unquoted} whose quote could not be found in the block it ` +
        `named, ${d.malformed} malformed.`,
    );
  }

  return {
    version: PROMPT_VERSION,
    generator: CAPABLE_MODEL,
    slug: opts.slug,
    sourceHash: opts.sourceHash,
    /* `null`, never absent. Absent means "written before this existed"; `null`
       means "written deliberately without a profile", and the two need
       different sentences. src/profile.ts § profileIsStale. */
    profileHash: opts.profile ? hashProfile(opts.profile) : null,
    ideas: inReadingOrder(fresh, opts.blocks),
    generatedAt: new Date().toISOString(),
    elapsedMs: opts.elapsedMs,
  };
}

/** Does this artefact still describe the article and tree on disk? */
export function isStale(ideas: Ideas, blocks: readonly BlockFingerprint[], tree: Tree): boolean {
  return ideas.sourceHash !== inputFingerprint(blocks, tree);
}

/**
 * The ideas on disk, or null — for the API and this file's own CLI, and since
 * 2026-08-28 **not for the pipeline**, which asks `previousIdeasFrom` below.
 *
 * Every road to `null` here is the same road: no file, a truncated one, a
 * document of the wrong shape. That is right for the panel, which has one thing
 * to say either way, and wrong for the stage, which loses every `?idea=` link
 * on one of them.
 */
export async function readIdeas(dir: string): Promise<Ideas | null> {
  const found = await readJsonOrNull<Ideas>(path.join(dir, "ideas.json"));
  /* A truncated write parses as `null`, and `null` is a perfectly good JSON
     document. Without this check the panel reports "nobody has found the ideas
     for this one yet" — the artefact gone, and nothing anywhere saying so. */
  if (!found || typeof found !== "object" || !Array.isArray(found.ideas)) return null;
  return found;
}

/**
 * There is a previous `ideas` artefact, this store cannot read it, and we are
 * not guessing which of the two harmless cases it would have been.
 *
 * The sibling of `GlossaryBaselineUnusable` in src/glossary.ts, and a separate
 * type rather than a shared one because the sentence a person needs is about
 * *this* artefact: which links go dead, and where to put the file back.
 */
export class IdeasBaselineUnusable extends Error {
  constructor(readonly slug: string) {
    super(
      `ideas "${slug}": there is a previous ideas artefact and this store cannot read it — it ` +
        "will not parse, is of the wrong shape, or is past the size the store reads back.\n" +
        "Every id in it is one a reader's `?idea=` links name (docs/project/ideas.md), so " +
        "carrying on would mint a fresh id for every idea and orphan all of them, quietly.\n" +
        "Nothing has been written — the ideas are still the previous run's.\n" +
        "Put it back from a backup, or delete it deliberately if this article's ideas really are " +
        "starting again from nothing.",
    );
    this.name = "IdeasBaselineUnusable";
  }
}

/**
 * The previous ideas, **from the store** — the only thing this stage reads the
 * old artefact for, and the thing landing D would otherwise take away.
 *
 * Until 2026-08-28 this was `readIdeas(opts.dir)` inside `generateIdeas`, whose
 * every failure is `null`. After landing D of
 * docs/plans/delete-the-importer.md that read fails on every run while looking
 * exactly like a first pass, and every `?idea=` link a reader holds goes dead
 * with nothing anywhere saying so.
 *
 * **Four states, and the same table as the glossary's**, for the same reason:
 * this stage inherits ids **only when `sourceHash` matches**, so a mismatch is
 * a legitimate refusal to inherit rather than a fault.
 *
 * | | what it means | what happens |
 * |---|---|---|
 * | no previous ideas | a first run for this article | mint, quietly |
 * | ones whose `sourceHash` differs | the article's text or its tree moved | mint, quietly — **correct, not an error** |
 * | ones this store cannot read | we cannot tell which of those two it was | **the stage fails** |
 * | the store read throws | an infrastructure fault | **propagates; the stage fails** |
 *
 * Row two is `generateIdeas`'s to decide and not this function's, which is why
 * this hands back the artefact rather than a map of ids: an id inherited across
 * a re-extraction would carry a reader's link onto an idea about a different
 * text, and the comparison that stops that wants the whole artefact.
 *
 * Row three is the one that has to be told from row one. A truncated
 * `ideas.json` still holds every id; a person with a backup can put it back,
 * and minting over it takes that away while reporting success.
 */
export async function previousIdeasFrom(
  store: Pick<ArtifactStore, "readBaseline">,
  slug: string,
): Promise<Ideas | null> {
  const outcome = await store.readBaseline(slug, "ideas", "ideas");
  if (outcome.state === "unusable") throw new IdeasBaselineUnusable(slug);
  return outcome.state === "ok" ? outcome.value : null;
}

export interface IdeasRun {
  ideas: Ideas;
  outFile: string;
  blocks: number;
  words: number;
  dropped: Dropped;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  elapsedMs: number;
}

const SYSTEM = `You are naming the IDEAS a reader needs in order to get this article.

WHAT AN IDEA IS

An idea is not a word. A word goes in the glossary. An idea is something you
have to HOLD IN YOUR HEAD — a claim, a frame, a way of carving something up —
and a reader who does not have it will follow every sentence and still miss the
piece.

The test: can you state it as a proposition? "Attention" is a word. "Attention
is a filter that runs before awareness, not after it" is an idea.

THE TWO KINDS

Every idea is exactly one of these.

"assumed" — the piece leans on it and never states it. This is what the reader
has to BRING. It is the harder and the more valuable half.

"introduced" — the piece puts it forward. This is what the reader TAKES AWAY.

THE RULE THAT MATTERS MOST

Never write an idea whose content is "the article's section about X". An idea is
something the reader could carry OUT of this article and use on a different one.
If your statement only makes sense as a description of this piece, it is not an
idea — it is a summary, and this is not the summary.

WHERE AN IDEA OCCURS

Every idea must be anchored to real passages, and what you are looking for
depends on which kind it is.

For "introduced": quote the passages where the piece states or develops it.

For "assumed": the article does NOT state it. That is the definition. So do not
go looking for where it is said. Quote the passages that would STOP MAKING SENSE
without it — the sentence that takes it for granted, the step in the argument
that only goes through if the reader already has this. That is where the reader
needs it and where they can check you.

Each occurrence is:

  "blockId"   — MUST be one of the ids listed in the article below. Never invent
                one and never guess at one you half-remember. A wrong id points
                the reader at the wrong paragraph, which is worse than nothing.
  "quote"     — copied VERBATIM from that block, character for character. Not a
                paraphrase, not tidied up. If you cannot copy it exactly, leave
                the occurrence out.
  "reasoning" — one short sentence naming the LOCAL move. For an "assumed" idea
                this is the whole point: say what the passage claims, what
                connection fails without the idea, and why THIS idea rather than
                general background knowledge supplies it.

Two to five occurrences per idea. An idea you cannot anchor at all is not an
idea about this article, and it will be thrown away — so do not offer it.

WHAT DOES NOT BELONG

- A truth so general that almost any article would need it. "Institutions shape
  behaviour", "correlation is not causation", "language is imprecise". These
  satisfy the words of the "assumed" rule and are worthless. Ask: would this be
  on the list for a piece about something else entirely? Then leave it out.
- A term. If the answer is a definition, it belongs in the glossary.
- A theme. "The dangers of automation" is a topic, not a proposition. It cannot
  be true or false, so it is not an idea.
- YOUR reading of the piece. An interpretation that is COMPATIBLE with a passage
  is not one the passage REQUIRES. If a reader could accept every sentence you
  quoted and still reject your idea, it is not assumed — it is your opinion, and
  attaching a real block id to it makes it look like evidence when it is not.
- Anything the article states plainly somewhere else. That is "introduced", not
  "assumed", however differently the piece words it.

FOR EXAMPLE

An article argues that AI writing tools will damage how people think.

BAD — name: "The dangers of AI writing", provenance: "introduced",
statement: "The article argues that letting AI write will harm our ability to
think."
That is the piece's third section with a label on it. You could not take it
anywhere. It is a summary.

BAD — name: "Technology changes society", provenance: "assumed"
True of almost every article ever written. It tells the reader nothing.

GOOD — name: "Writing is a test of thought, not a record of it",
provenance: "assumed",
statement: "Prose that hangs together is evidence that the thinking hung
together; you cannot produce the first without having done the second.",
whyYouNeedIt: "The argument only goes through if writing is where thinking gets
checked rather than where finished thinking gets written down. The piece never
argues for this — it starts from it."
That is a proposition, it is not stated in the piece, the piece collapses
without it, and a reader can go to the quoted passages and test whether it is
really being assumed.

WRITING

- "name": a short proposition, three to ten words. Not a topic.
- "statement": one or two plain sentences. The idea itself.
- "whyYouNeedIt": one or two plain sentences on what stops making sense without
  it. Required for "assumed". Optional for "introduced" — leave it out rather
  than pad.
- Do NOT describe the page in either field. "The article argues", "This section
  explains", "The author's point that", "Used to show" — all of these describe
  something the reader is looking at. Say the idea; they can see the article.
  This applies to "whyYouNeedIt" as much as to "statement".
- Plain prose. No Markdown, no bullets, no headings, no bold.

"analogy" — OPTIONAL, and it is YOURS rather than the author's. A concrete
everyday thing this idea works like. The reader will be told it is yours. Only
offer one when you have one that genuinely helps: a strained analogy is worse
than none, and a field invites filling. LEAVE IT OUT rather than reach.

NEVER put the article's OWN analogy here. If the piece already compares the
thing to something, the reader has read that comparison — handing it back
labelled as yours is worse than leaving the field empty, because it credits you
with the author's thinking and tells the reader nothing new. Before you write
one, check that the comparison does not appear in the article. If the best
picture of this idea really is the author's, that is a good sign about the
article and this field stays empty.

OUTPUT

JSON only, no prose, no code fence:

{"ideas": [
  {
    "name": "...",
    "provenance": "assumed|introduced",
    "statement": "...",
    "whyYouNeedIt": "...",
    "analogy": "...",
    "occurrences": [
      {"blockId": "spya-k3m9qt", "quote": "...", "reasoning": "..."}
    ]
  }
]}

"whyYouNeedIt" and "analogy" may be omitted. Nothing else may be.

Fewer, better ideas beat a list padded to a number. If the piece genuinely has
two, return two.

${PROFILE_RULES}`;

/**
 * What the model is shown.
 *
 * The skeleton before the full text, for the same reason the arc, the thread
 * and the glossary do it: it is what lets the model judge what the argument
 * rests on rather than what the article says most often. It is also why this
 * stage's freshness hash covers the tree — see `inputFingerprint`.
 */
/* Exported for tests/profile-prompts.test.ts, which pins the two things a
   profile must do here: arrive when there is one, and leave no trace when
   there is not. */
export function renderPrompt(opts: {
  tree: Tree;
  count: number;
  /**
   * Who is reading, already rendered — `renderProfile` in src/profile.ts.
   *
   * **The stage this matters most to, more even than the glossary.** There, a
   * profile changes which terms are worth an entry. Here it changes what
   * "assumed" *means*: a physicist reading a physics essay brings everything it
   * assumes, and the same essay for a lay reader is three ideas deep before its
   * first argument. Which is why `profileHash` is in this stage's freshness
   * stamp rather than merely recorded on the artefact.
   *
   * In the user prompt, never the `system` block: the article is up there with
   * the breakpoint on it, and this changes between readers.
   */
  profile: string | null;
}): string {
  const { tree, count } = opts;
  const skeleton = partsOf(tree)
    .map((p, i) => `PART ${i + 1}: ${p.title}\n  ${p.gist ?? "(no gist)"}`)
    .join("\n\n");

  /* Near the top, where it will be read, and before the shape — the reader is
     context for *choosing* the ideas, and the choosing is what the rest of this
     prompt is about. The long rules are in SYSTEM, where the profile cannot
     reach them. src/profile.ts § PROFILE_RULES. */
  const who = profileSection(opts.profile);

  return `Find up to ${count} ideas. Fewer is fine.
${who ? `\n${who}\n` : ""}
=== ITS SHAPE ===

${skeleton}`;
}

/**
 * Read the model's answer, fence and all.
 *
 * `stripFence` then `parseJsonFrom`, never a bare `JSON.parse` — src/parse-json.ts
 * § `stripFence` has the reasoning.
 */
function parseJson(raw: string): { ideas?: unknown } {
  return parseJsonFrom<{ ideas?: unknown }>(stripFence(raw), "the model's answer");
}

export async function generateIdeas(opts: {
  dir: string;
  onProgress?: (detail: string) => void;
  signal?: AbortSignal;
  /** Mark the article as a cache breakpoint — see src/glossary.ts for the full note. */
  cacheArticle?: boolean;
  /** Frozen by whoever queued the job, never read here. */
  profile?: string | null;
  /**
   * The ideas this article already has, or `null` **only** when it genuinely
   * has none — `previousIdeasFrom` above is how the pipeline gets it.
   *
   * **Required, for the reason `runBlocks`'s baseline is** (src/blocks.ts): an
   * optional parameter is precisely what landing D could drop while still
   * compiling, and the result would be a stage that re-mints every id on every
   * run and reports success. There is only one thing this is read for — ids,
   * and only when `sourceHash` matches — so nothing else here would notice.
   */
  previous: Ideas | null;
}): Promise<IdeasRun> {
  /* `parseJsonFrom`, not `JSON.parse`: blocks.json *is* the article, and V8's
     own parse error quotes the first characters of what it was handed. */
  const { blocks } = parseJsonFrom<{ blocks: Block[] }>(
    await readFile(path.join(opts.dir, "blocks.json"), "utf-8"),
    "blocks.json",
  );
  const tree = parseJsonFrom<Tree>(
    await readFile(path.join(opts.dir, "tree.json"), "utf-8"),
    "tree.json",
  );
  /* Unlike the glossary, this stage cannot shrug meta.json off: `articleWithIds`
     needs a head, and a stage that silently rendered a different head would be
     a stage that silently sent uncacheable bytes. A stub with the slug in it is
     enough — the head is context for the model, not something the answer cites
     — and it keeps a missing meta.json from failing a run that has everything
     it actually needs. */
  const meta: Meta =
    (await readFile(path.join(opts.dir, "meta.json"), "utf-8")
      .then((raw) => JSON.parse(raw) as Meta)
      .catch(() => null)) ?? ({ title: tree.slug } as Meta);

  const sourceHash = inputFingerprint(blocks, tree);
  const profile = opts.profile ?? null;
  /* No `existingFor`, because there is no append. The only thing the old file
     is read for is its ids — and only when it describes the same article, since
     an id inherited across a re-extraction would carry a reader's link onto an
     idea about a different text. */
  /* **Handed in, not read from `opts.dir`** — see `previous` on the options
     above. The `sourceHash` comparison stays exactly here: a mismatch means the
     article moved and the old ids describe text that is gone, which is a
     legitimate reason not to inherit and not something the caller could tell
     apart from having no artefact at all. */
  const onDisk = opts.previous;
  const inherit = onDisk && onDisk.sourceHash === sourceHash ? idsByName(onDisk) : null;

  /* **The argument, not the apparatus.** Applied here at the call site rather
     than inside `articleText`/`articleWithIds`, and that is the whole care in
     this line: the two builders look like the seam between automatic and asked
     work and they are not — `ideas` is automatic and sends ids, while
     `explain`, `search` and `converse` are *asked* and send ids too. Filtering
     inside the builders would be right three times and would silently leave
     `ideas` summarising the bibliography. src/block-policy.ts. */
  const evidence = blocks.filter(isBodyEvidence);
  /* The **body's** words — see the note in src/tweets.ts. */
  const words = articleWordCounts(blocks).body;
  const count = suggestedIdeas(words);
  const started = Date.now();

  /* Each idea is a short proposition, two prose fields, an optional analogy and
     up to five verbatim quotes — and the quotes are what makes this larger per
     item than the glossary's. Undersizing does not degrade: it throws
     `truncationFailure` and loses the whole pass. */
  const answerTokens = 400 + count * 420;
  const maxTokens = budgetFor("ideas", answerTokens);

  /* `streamMessage` builds the client, and sets `logLevel: "off"` on it — a
     privacy setting rather than a preference, since the SDK's own logger reads
     ANTHROPIC_LOG and at `debug` prints the outgoing request, which is the
     whole article, outside Pino and so unredactable. */
  let message: Anthropic.Message;
  try {
    const call = streamMessage(
      "ideas",
      {
        max_tokens: maxTokens,
        thinking: { type: "adaptive" },
        output_config: { effort: effortFor("ideas") },
        /* Article first, then this stage's instructions. The cache prefix runs
           from the top of the request, so anything ahead of the article that
           differs between stages breaks the match before it starts. */
        system: [
          {
            type: "text" as const,
            /* **`articleWithIds`, not `articleText`** — and this is the one
               way this stage's prompt genuinely differs from the glossary's.
               `articleText` renders bare prose with no block ids, deliberately,
               because an id in the prompt is an invitation to put one in the
               answer and the arc, the thread, the glossary and the summary all
               want prose *about* the piece rather than pointers into it.

               Ideas wants pointers into it. Every occurrence is a block id the
               model has to name, so the ids have to be on the page — the first
               version of this file asked for ids while sending the renderer
               that omits them, and every single occurrence was then dropped as
               an invented id. The stage reported "the model returned no ideas"
               and the model had done nothing wrong.

               The cost is that these bytes match search/explain/converse rather
               than the other pipeline stages, so this stage shares no cached
               prefix with arc or tweets. `ARTICLE_RENDERER` in src/models.ts is
               where that fact is recorded, because `sharesArticleCache` would
               otherwise group on effort alone and claim a share that cannot
               happen. */
            text: articleWithIds(meta, evidence),
            ...(opts.cacheArticle ? { cache_control: { type: "ephemeral" as const } } : {}),
          },
          { type: "text" as const, text: SYSTEM },
        ],
        messages: [{ role: "user", content: renderPrompt({ tree, count, profile }) }],
      },
      { ...(opts.signal ? { signal: opts.signal } : {}) },
    );

    if (opts.onProgress) {
      const report = opts.onProgress;
      let chars = 0;
      let last = 0;
      call.onText((delta) => {
        chars += delta.length;
        // Throttled: the model emits deltas far faster than anyone reads them,
        // and each of these is a write the job poller may pick up.
        const now = Date.now();
        if (now - last < 500) return;
        last = now;
        report(`up to ${count} ideas, ${Math.round(chars / 1000)}k characters so far`);
      });
    }

    /* `call.finalMessage()`, never `call.stream.finalMessage()` — the wrapper is
       what records what this call cost. The stream's own method works and
       records nothing. See src/messages-stream.ts. */
    message = await call.finalMessage();
  } catch (err) {
    throw anthropicCallFailed(err);
  }
  if (wasRefused(message)) {
    /* `stop_details` is neither thrown nor logged — it is the provider's own
       words about a request that carried the whole article. src/messages.ts. */
    throw new Error(MODEL_REFUSED.message);
  }
  if (message.stop_reason === "max_tokens") {
    throw truncationFailure("ideas", maxTokens, answerTokens, {
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

  const dropped: Dropped = {
    unknownIds: 0,
    unquoted: 0,
    truncated: 0,
    overCap: 0,
    malformed: 0,
    unargued: 0,
    unanchored: 0,
  };
  const ideas = buildIdeas(parseJson(raw), {
    slug: tree.slug,
    blocks,
    sourceHash,
    profile,
    elapsedMs: Date.now() - started,
    inherit,
    dropped,
  });

  const outFile = path.join(opts.dir, "ideas.json");
  await writeFile(outFile, JSON.stringify(ideas, null, 2), "utf-8");

  return {
    ideas,
    outFile,
    blocks: blocks.length,
    words,
    dropped,
    model: CAPABLE_MODEL,
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
    cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
    elapsedMs: Date.now() - started,
  };
}

async function main(): Promise<void> {
  const dir = process.argv[2];
  if (!dir) {
    console.error("Usage: tsx src/ideas.ts <dir with blocks.json + tree.json>");
    console.error("Running it again replaces the list — it does not append.");
    process.exit(1);
  }
  /* **In `main`, never in `generateIdeas`.** The server already loaded
     `.env.local` (vite.config.ts) before any stage runs, so doing it inside the
     generator would be a no-op there and an import of `node:fs` into a code
     path that does not need one.

     **That gap is closed, and this comment outlived it.** When it was written
     the other pipeline stages did not do this, and running one from a shell
     with no exported key failed with "this app has not been set up to talk to
     the AI service" — a missing credential, apparently, rather than an unread
     file. By 2026-08-28 six of the seven others had the call. The one left was
     `src/pdf-read.ts`, which this comment did not name and which nobody would
     have thought to look in. It has it now, and
     `tests/paid-cli-ledger.test.ts` holds the rule for all eight, so the next
     stage CLI cannot be copied without it. */
  loadEnvLocal();
  // Before the call, not after: this is the only thing on screen while the
  // model works, and printing it afterwards makes the command look hung.
  console.log(`Finding the ideas with ${CAPABLE_MODEL}…`);
  const run = await generateIdeas({
    dir,
    /* The CLI has files and no store, so it reads the file — and `readIdeas`
       gives one `null` for every kind of failure, which is exactly why this is
       not the pipeline's path any more. Acceptable here: a person is watching,
       and the worst case is a re-run that mints fresh ids in a directory they
       named by hand. */
    previous: await readIdeas(dir),
    onProgress: (detail) => process.stdout.write(`\r  ${detail}          `),
  });

  const { ideas } = run;
  const assumed = ideas.ideas.filter((i) => i.provenance === "assumed").length;
  console.log(
    `\n${run.blocks} blocks, ${run.words} words → ${ideas.ideas.length} ideas ` +
      `(${assumed} to bring, ${ideas.ideas.length - assumed} the piece adds)`,
  );
  for (const idea of ideas.ideas) {
    const mark = idea.provenance === "assumed" ? "bring" : "adds ";
    console.log(`  [${mark}] ${idea.name}  (${idea.occurrences.length})`);
  }
  console.log(`\nTokens:  ${run.inputTokens} in, ${run.outputTokens} out`);
  console.log(`Elapsed: ${(run.elapsedMs / 1000).toFixed(1)}s`);
  console.log(
    `Dropped: ${run.dropped.unanchored} unanchored, ${run.dropped.unargued} unargued, ` +
      `${run.dropped.unknownIds} bad ids, ${run.dropped.unquoted} unquoted, ` +
      `${run.dropped.malformed} malformed, ${run.dropped.truncated} occurrences over the ` +
      `cap, ${run.dropped.overCap} ideas over the cap`,
  );
  console.log(`\nWrote ${run.outFile}`);
}

/* **`stageCli`, which is the guard and the ledger together.** Awaited rather
   than `void`ed: flushing the ledger, and any failure in it, are part of the
   command finishing rather than something the process might exit before doing.
   src/cli-ledger.ts says what the one line replaces and why it is one line. */
await stageCli(import.meta.url, main);
