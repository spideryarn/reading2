/**
 * Pipeline stage 5t — the **Trajectory**: a route through the article's Quotes,
 * walked at three depths. docs/project/trajectory.md is the vision (Greg's brief
 * verbatim); docs/plans/260928a-trajectory-mode-skim-a-paper-at-increasing-depth.md
 * § The step (server) is the spec every rule below comes from.
 *
 * **There is no command line here.** Re-running it against one article is a job:
 *
 *   POST /api/jobs { slug, steps: ["trajectory"], force: ["trajectory"] }
 *
 * ## What it reads, and what it does not
 *
 * Its input is another step's artefact, like `illustrated`'s: the stored
 * Quotes, the hierarchy tree (for each quote's section path) and the reader's
 * profile. **It never reads the article's prose** — the prompt holds only the
 * quotes, which are already the article's own words, so the call is small and
 * in no cached prefix. It refuses without Quotes (src/pipeline.ts § the
 * `trajectory` step), and the client asks for both in one job.
 *
 * ## What the model decides, and what it is not trusted with
 *
 * The stops are the quotes that already exist; the model **orders** them into
 * a route and gives each a depth and a one-line role. Its ids are never
 * trusted: `validateRoute` drops what does not resolve, keeps the shallowest of
 * any repeat, allows one stop per block, nulls a bad role without dropping the
 * stop, and applies the caps to the cumulative counts in route order. Nothing
 * is ever demoted or relabelled (Sol F2, F8). Then the passes must grow, or the
 * job fails and writes nothing.
 *
 * ## Freshness
 *
 * The stamp is the quotes hash (each quote's id and block id), this prompt's
 * version, the model, and the profile — with a stricter profile rule than the
 * shared one: none → some is stale here (Sol F7). `routeProfileIsStale` says
 * why. The tree is not in the hash, as the plan specifies: the section paths
 * are context for the ordering, and a re-cut outline does not move a quote.
 */

import { createHash } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { anthropicCallFailed } from "./anthropic-call.js";
import { stageFailure } from "./job-failure.js";
import { MODEL_REFUSED } from "./messages.js";
import { streamMessage, wasRefused } from "./messages-stream.js";
import { CAPABLE_MODEL, type Effort } from "./models.js";
import { parseJsonAnswer } from "./parse-json.js";
import { hashProfile, PROFILE_RULES, profileSection } from "./profile.js";
import { budgetFor, truncationFailure } from "./token-budget.js";
import {
  type Block,
  MAX_QUOTES_TOTAL,
  type Quote,
  type Quotes,
  type Trajectory,
  type TrajectoryDepth,
  type TrajectoryDrops,
  type TrajectoryStop,
  type Tree,
  type TreeNode,
} from "./types.js";

export type {
  Trajectory,
  TrajectoryDepth,
  TrajectoryDrops,
  TrajectoryStop,
} from "./types.js";

/**
 * Bumped whenever the prompt changes what a route *is*. Exported so tests and
 * the read path compare against the constant rather than a literal.
 */
export const PROMPT_VERSION = "trajectory/3";

/** A role is a short label, not a sentence about the passage. Over this it becomes `null`. */
export const MAX_ROLE_CHARS = 80;

/** How much of each quote the prompt carries. Quotes are rarely longer. */
export const MAX_QUOTE_PROMPT_CHARS = 1200;

/**
 * The caps on the **cumulative** visible counts: at most 7 stops at depth ≤ 1,
 * 15 at ≤ 2 and 36 at ≤ 3. Over a cap, the excess is dropped in route order —
 * never demoted to a deeper pass (Sol F8).
 */
export const DEPTH_CAPS = [7, 15, 36] as const;

/** With at least this many usable quotes, the three passes must strictly grow (Sol F2). */
export const GROWTH_MIN_QUOTES = 8;

/**
 * **Low**, as a constant here rather than a row in `STAGE_EFFORT`, because
 * this is not an `ArticleStage`: it sends no article, so it shares no cached
 * prefix with the stages in that table. Low because the input is small and the
 * job is judgment about a list, not reading. `SPIDERYARN_PIPELINE_EFFORT`
 * still overrides it, as it does for `citations`.
 */
const EFFORT: Effort = "low";

/**
 * The answer budget in tokens: a base for the JSON around the list, plus per
 * stop the quote id, the depth and a role at the cap, at a conservative three
 * characters a token — for every quote the list can hold, because the prompt
 * says depth 3 should include nearly all of them and a model may list past the
 * cap. Undersizing does not degrade: it throws `truncationFailure`.
 */
export const ANSWER_TOKENS = 300 + MAX_QUOTES_TOTAL * Math.ceil((MAX_ROLE_CHARS + 60) / 3);

/* ------------------------------------------------------------ pure helpers -- */

export function emptyDrops(): TrajectoryDrops {
  return { unknownQuote: 0, duplicate: 0, sameBlock: 0, malformed: 0, badRole: 0, overCap: 0 };
}

/**
 * **Targets, not rules** — what the prompt asks for at each depth, from *q*,
 * the number of quotes. Hypotheses to measure (Sol F10), not product constants;
 * the caps above are the only hard numbers.
 */
export function targetsFor(q: number): { gist: number; more: number; most: number } {
  return {
    gist: Math.min(5, Math.ceil(q / 5)),
    more: Math.min(12, Math.ceil(q / 2)),
    most: Math.min(DEPTH_CAPS[2], q),
  };
}

/**
 * The fingerprint of what the route was written from: **each quote's id and
 * block id, in the stored order.** A quote's words and reason never change
 * under an id, so the pair is the whole identity; *Find more* adds a pair, and
 * choosing the quotes again mints new ids. Sixteen hex characters, like
 * `hashBlocks` in src/source-hash.ts.
 *
 * Over **every** quote in the artefact rather than the usable ones, so the
 * pipeline's `stamp` can compute it from the Quotes alone, without reading the
 * article.
 */
export function quotesHash(quotes: readonly Pick<Quote, "id" | "blockId">[]): string {
  const canonical = quotes.map((q) => `${q.id}\t${q.blockId}`).join("\n");
  return createHash("sha256").update(`trajectory-quotes\n${canonical}`, "utf8").digest("hex").slice(0, 16);
}

/**
 * **Is the route written for a different profile — including none → some?**
 *
 * Deliberately stricter than `profileIsStale` in src/profile.ts, which calls an
 * artefact written without a profile never stale: a plain glossary must not
 * nag the reader for ever. A route is different. It is exactly the thing a
 * profile is meant to change — *why you are reading this one* decides where the
 * route starts — and rebuilding it costs one small call over the quotes. So
 * any difference counts, in either direction (Sol F7, and the plan § Freshness).
 *
 * `undefined` (an artefact with no field) is treated as `null`.
 */
export function routeProfileIsStale(
  recorded: string | null | undefined,
  now: string | null,
): boolean {
  return (recorded ?? null) !== now;
}

/**
 * The quotes the model may route through: those whose block is in the
 * article. A quote on a block that has gone (a stale Quotes list) has no
 * passage to stop at, so it is not offered.
 */
export function usableQuotes(quotes: Quotes | null, blocks: readonly Block[]): Quote[] {
  if (!quotes || !Array.isArray(quotes.quotes)) return [];
  const present = new Set<string>(blocks.map((b) => b.id));
  return quotes.quotes.filter((q) => present.has(q.blockId));
}

/** `max(importance, striking)` — the Quotes panel's `priorityOf` (src/web/QuotesPanel.tsx), which server code may not import. */
function priorityOf(quote: Quote): number | undefined {
  const scores = [quote.importance, quote.striking].filter((n): n is number => n !== undefined);
  return scores.length === 0 ? undefined : Math.max(...scores);
}

/**
 * **The titles of the non-root ancestors of the leaf that holds this block** —
 * e.g. `["Results", "Robustness"]`. In a flat tree, where the leaf hangs off the
 * root, it is the leaf's own title. `[]` for a block the tree does not cover.
 *
 * Resolved by **block index**, never by comparing id strings: a range is two
 * ids, and "between" means between their positions in the blocks array
 * (docs/project/block-ids.md).
 */
export function sectionPathOf(blockId: string, blocks: readonly Block[], tree: Tree): string[] {
  const index = new Map<string, number>();
  for (const [i, b] of blocks.entries()) index.set(b.id, i);
  return sectionPathAt(index.get(blockId), index, tree);
}

function sectionPathAt(
  at: number | undefined,
  index: ReadonlyMap<string, number>,
  tree: Tree,
): string[] {
  if (at === undefined) return [];
  const contains = (n: TreeNode): boolean => {
    const lo = index.get(n.range[0]);
    const hi = index.get(n.range[1]);
    return lo !== undefined && hi !== undefined && lo <= at && at <= hi;
  };
  /* Walk down from the root, choosing the child whose range holds the block. */
  const path: TreeNode[] = [];
  let node = tree.nodes[tree.rootId];
  while (node && node.children.length > 0) {
    const next = node.children.map((id) => tree.nodes[id]).find((c) => c && contains(c));
    if (!next) break;
    path.push(next);
    node = next;
  }
  if (path.length === 0) return [];
  const leaf = path.at(-1)!;
  const ancestors = leaf.children.length === 0 ? path.slice(0, -1) : path;
  return (ancestors.length > 0 ? ancestors : [leaf]).map((n) => n.title);
}

interface RawStop {
  quote?: unknown;
  depth?: unknown;
  role?: unknown;
}

function isDepth(value: unknown): value is TrajectoryDepth {
  return value === 1 || value === 2 || value === 3;
}

function roleOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const role = value.trim();
  return role.length === 0 || role.length > MAX_ROLE_CHARS ? null : role;
}

/**
 * Turn what the model said into a route, believing as little as possible —
 * the plan's list, rule by rule, in this order:
 *
 * 1. not an object, no quote id, or a depth outside 1–3 → dropped (`malformed`);
 * 2. a quote id not in `quotes` → dropped (`unknownQuote`);
 * 3. a bad role → `null`, **the stop kept** (`badRole`);
 * 4. a quote named twice → its **shallowest** occurrence kept, in that
 *    occurrence's place; the earlier on a tie (`duplicate`);
 * 5. two stops on one block → the shallowest, then the earlier (`sameBlock`) —
 *    otherwise two stops would mark one paragraph;
 * 6. the cumulative caps, in route order: a stop is dropped if keeping it would
 *    take the count at its own depth **or any deeper one** over its cap
 *    (`overCap`). Never demoted.
 */
export function validateRoute(
  raw: readonly unknown[],
  quotes: readonly Quote[],
  dropped: TrajectoryDrops,
): TrajectoryStop[] {
  const byId = new Map(quotes.map((q) => [q.id, q]));
  interface Candidate {
    stop: TrajectoryStop;
    blockId: string;
    index: number;
  }
  const read: Candidate[] = [];
  for (const [index, item] of raw.entries()) {
    if (!item || typeof item !== "object") {
      dropped.malformed++;
      continue;
    }
    const r = item as RawStop;
    const id = typeof r.quote === "string" ? r.quote.trim() : "";
    if (!id || !isDepth(r.depth)) {
      dropped.malformed++;
      continue;
    }
    const quote = byId.get(id);
    if (!quote) {
      dropped.unknownQuote++;
      continue;
    }
    const role = roleOf(r.role);
    if (role === null) dropped.badRole++;
    read.push({ stop: { quoteId: quote.id, depth: r.depth, role }, blockId: quote.blockId, index });
  }

  /* 4 and 5 are the same rule over two keys: of the candidates sharing a key,
     keep the shallowest, then the earliest. */
  const winners = (items: readonly Candidate[], key: (c: Candidate) => string): Set<Candidate> => {
    const best = new Map<string, Candidate>();
    for (const c of items) {
      const held = best.get(key(c));
      if (!held || c.stop.depth < held.stop.depth) best.set(key(c), c);
    }
    return new Set(best.values());
  };
  const onePerQuote = winners(read, (c) => c.stop.quoteId);
  dropped.duplicate += read.length - onePerQuote.size;
  const distinct = read.filter((c) => onePerQuote.has(c));
  const onePerBlock = winners(distinct, (c) => c.blockId);
  dropped.sameBlock += distinct.length - onePerBlock.size;
  const placed = distinct.filter((c) => onePerBlock.has(c));

  /* 6 — cumulative caps, in route order. */
  const visible = [0, 0, 0];
  const kept: TrajectoryStop[] = [];
  for (const { stop } of placed) {
    const fits = [0, 1, 2].every((d) => d + 1 < stop.depth || visible[d]! < DEPTH_CAPS[d]!);
    if (!fits) {
      dropped.overCap++;
      continue;
    }
    for (let d = stop.depth - 1; d < 3; d++) visible[d]!++;
    kept.push(stop);
  }
  return kept;
}

/** How many stops are visible at depth ≤ 1, ≤ 2 and ≤ 3. */
export function visibleCounts(stops: readonly TrajectoryStop[]): [number, number, number] {
  const at = (d: number) => stops.filter((s) => s.depth <= d).length;
  return [at(1), at(2), at(3)];
}

/**
 * **The passes must grow (Sol F2)**, or the reader presses *More* and gets the
 * same route again. `null` when they do; otherwise the reason, with the counts.
 *
 * With at least `GROWTH_MIN_QUOTES` usable quotes: `1 ≤ c₁ < c₂ < c₃`. With
 * fewer, a shorter spiral is allowed — `c₁ ≥ 1` and never shrinking (which the
 * nesting guarantees) — and the band shows only the depths that add something.
 */
export function growthFailure(
  counts: readonly [number, number, number],
  offered: number,
): string | null {
  const [c1, c2, c3] = counts;
  const said = `${c1} stops at Gist, ${c2} at More and ${c3} at Most`;
  if (c1 < 1) return `The route has no stop at the first depth (${said}).`;
  if (c1 > c2 || c2 > c3) return `The route shrinks as it deepens (${said}).`;
  if (offered >= GROWTH_MIN_QUOTES && !(c1 < c2 && c2 < c3)) {
    return (
      `With ${offered} quotes, each depth has to add stops to the one before it, and this ` +
      `route does not (${said}).`
    );
  }
  return null;
}

/**
 * The artefact, from what the model said plus what survived validation.
 *
 * **Every empty outcome fails** — unlike FAQ, where "no questions" is a real
 * answer. There is always a route through a non-empty set of quotes, so no
 * `stops` array, an empty one, and one that validation empties are all a
 * failed answer, and nothing is written. So is a route that does not grow.
 * There is no automatic retry in v1; the reader can press re-run.
 */
export function buildTrajectory(
  parsed: { stops?: unknown },
  opts: {
    slug: string;
    /** The usable quotes — the ones the model was offered. */
    quotes: readonly Quote[];
    sourceHash: string;
    profileHash: string | null;
    elapsedMs: number;
    dropped: TrajectoryDrops;
  },
): Trajectory {
  if (!Array.isArray(parsed.stops)) {
    throw new Error(
      "The model's answer has no `stops` array in it, so there is no route to write. " +
        "That is a failed answer rather than an empty one.",
    );
  }
  if (parsed.stops.length === 0) {
    throw new Error(
      `The model returned an empty route over ${opts.quotes.length} quotes, so there is nothing ` +
        "to write.",
    );
  }
  const d = opts.dropped;
  const stops = validateRoute(parsed.stops, opts.quotes, d);
  if (stops.length === 0) {
    throw new Error(
      `The model named ${parsed.stops.length} stops and none of them survived, so there is ` +
        `nothing to write. Dropped: ${d.unknownQuote} naming a quote that is not in the Quotes, ` +
        `${d.malformed} malformed, ${d.duplicate} duplicates, ${d.sameBlock} on a block ` +
        `already stopped at, ${d.overCap} over a cap.`,
    );
  }
  const visible = visibleCounts(stops);
  const failure = growthFailure(visible, opts.quotes.length);
  if (failure) {
    throw new Error(
      `${failure} Nothing was written. Dropped: ${d.unknownQuote} unknown, ${d.malformed} ` +
        `malformed, ${d.duplicate} duplicates, ${d.sameBlock} on one block, ${d.overCap} over a cap.`,
    );
  }
  return {
    version: PROMPT_VERSION,
    generator: CAPABLE_MODEL,
    slug: opts.slug,
    /* The store's spellings (`sourceHash`, `version`, `generator`,
       `profileHash`), which `stampOf` reads — src/store/artifacts.ts. */
    sourceHash: opts.sourceHash,
    profileHash: opts.profileHash,
    stops,
    visible,
    offered: opts.quotes.length,
    dropped: { ...d },
    generatedAt: new Date().toISOString(),
    elapsedMs: opts.elapsedMs,
  };
}

/* ---------------------------------------------------------------- prompt -- */

export const TRAJECTORY_SYSTEM = `You are planning a route through an article for somebody who wants to skim it
well — to get what they need from it quickly without replacing the reading.

WHAT YOU ARE GIVEN

The article's own best lines, already chosen: its QUOTES. Each has a label (Q1,
Q2, …), the section of the article it sits in, how much the piece rests on it
(a priority from 0 to 1, where given), and its words. You do not see the rest of the
article, and you do not need to: every stop on the route is one of these quotes,
and the reader reads the paragraph around it in the article itself.

WHAT YOU DECIDE

1. THE ORDER. The route is not the article's order and not the priority order.
   It is the order in which a reader should meet these passages to understand
   the piece fastest. For most papers that means the main result or claim
   first, then a quick tour of how they got it, then what it builds on, what
   it rules out, and its limits. An essay may start with its central claim, a
   report with its conclusion. It varies from piece to piece: judge what each
   passage DOES, and put first what a first-time reader most needs.

2. THE DEPTH of each stop — the shallowest pass it belongs to:
   1 = GIST: the few stops that give the gist on their own;
   2 = MORE: go round again, in more detail — the stops that fill in how and why;
   3 = MOST: nearly everything else worth stopping at.
   The passes nest: depth 2 shows every stop at depth 1 or 2, in your route
   order, and depth 3 shows them all. So one route, one order — a depth-1 stop
   is simply one the reader meets on every pass.
   Each pass must ADD stops to the one before it.

3. A ROLE for each stop: a label, at most ${MAX_ROLE_CHARS} characters, that
   says what the passage DOES in the piece — NEVER what it found or says.
   GOOD: "The headline result", "How they measured it", "What earlier work
   missed", "Does it hold outside the lab?", "Where the argument turns".
   BAD: "Sleep improves memory by 20%", "Shows the effect is robust",
   "The author is wrong about X".
   No numbers, no findings, no verdicts: the reader gets those from the
   passage itself. A role may be the question the passage answers. Use the
   article's own words for the things it names, and ordinary words for
   everything else — plainer than the article, never further from it.

RULES

- Only the labels given (Q1, Q2, …), exactly as written. Never invent one.
- Each quote at most once.
- At most one stop per paragraph: a quote marked "same paragraph as Qn" is a
  second line from a paragraph already listed, and the route needs only one of
  them. A second stop on one paragraph is thrown away.
- Depth 3 should normally include nearly all the quotes. Leave one out only if
  it adds nothing a stop already gives.
- The user message gives a target for each depth. Aim near it.

OUTPUT

JSON only, no prose, no code fence. The array order IS the route:

{"stops": [
  {"quote": "Q7", "depth": 1, "role": "..."}
]}

THE ANSWER MUST PARSE. Inside a string, a straight double quote ends the
string: a role never needs one, so do not use one — write the words bare, or
use single quotes. Never put a real line break inside a string.

${PROFILE_RULES}`;

/**
 * The user message: the targets, the quotes with their section paths, and the
 * reader. Everything that varies is here, after the constant system prompt.
 *
 * `quotes` are the usable ones, in the stored order — the article's order.
 */
export function renderPrompt(opts: {
  quotes: readonly Quote[];
  blocks: readonly Block[];
  tree: Tree;
  profile: string | null;
}): string {
  const { quotes, blocks, tree } = opts;
  const t = targetsFor(quotes.length);
  const index = new Map<string, number>();
  for (const [i, b] of blocks.entries()) index.set(b.id, i);
  /* The model never sees block ids, so it cannot know two quotes share a
     paragraph unless it is told — and validation keeps only one stop per block.
     Measured on the first real runs: 1 of 10 and 3 of 16 stops were lost to it. */
  const firstOnBlock = new Map<string, string>();
  const listed = quotes
    .map((q, i) => {
      const label = labelOf(i);
      const path = sectionPathAt(index.get(q.blockId), index, tree);
      const where = path.length > 0 ? path.join(" › ") : "(no section)";
      const p = priorityOf(q);
      const earlier = firstOnBlock.get(q.blockId);
      if (earlier === undefined) firstOnBlock.set(q.blockId, label);
      const same = earlier === undefined ? "" : ` · same paragraph as ${earlier}`;
      const priority = `${p === undefined ? "" : ` · priority ${p.toFixed(2)}`}${same}`;
      const words =
        q.text.length > MAX_QUOTE_PROMPT_CHARS
          ? `${q.text.slice(0, MAX_QUOTE_PROMPT_CHARS)}…`
          : q.text;
      return `${label} · ${where}${priority}\n${words}`;
    })
    .join("\n\n");
  const who = profileSection(opts.profile);
  return `Plan the route through these ${quotes.length} quotes.

Targets: about ${t.gist} at depth 1; about ${t.more} at depth 1 or 2; about ${t.most} in all.
${who ? `\n${who}\n` : ""}
=== THE QUOTES, IN THE ARTICLE'S ORDER ===

${listed}`;
}

/**
 * **The model sees `Q1`, `Q2`, … and never a quote id.** Quote ids are
 * block-id shaped (`spya-k3m9qt`), and on the first real run the model copied
 * one back as `"spya-spya-xcg2ub".replace("spya-spya-","spya-")` — an answer
 * that does not parse. A short label it cannot mangle is the fix, and
 * `fromLabels` maps it back before validation, so `validateRoute` still
 * believes only ids that are in the Quotes.
 */
export function labelOf(index: number): string {
  return `Q${index + 1}`;
}

/**
 * Replace each stop's `quote` label with the quote id it names. A label that
 * names nothing is left as it is, and validation counts it `unknownQuote`.
 */
export function fromLabels(stops: readonly unknown[], quotes: readonly Quote[]): unknown[] {
  const byLabel = new Map(quotes.map((q, i) => [labelOf(i), q.id]));
  return stops.map((s) => {
    if (!s || typeof s !== "object") return s;
    const r = s as RawStop;
    const id = typeof r.quote === "string" ? byLabel.get(r.quote.trim()) : undefined;
    return id === undefined ? s : { ...r, quote: id };
  });
}

function parseJson(raw: string): { stops?: unknown } {
  return parseJsonAnswer<{ stops?: unknown }>(raw, "the model's answer");
}

export interface TrajectoryRun {
  trajectory: Trajectory;
  offered: number;
  dropped: TrajectoryDrops;
  model: string;
  inputTokens: number;
  outputTokens: number;
  maxTokens: number;
  elapsedMs: number;
}

/**
 * One call: order the quotes into a route. Writes nothing — the caller writes
 * through the store. The caller has already refused when `quotes` is empty.
 */
export async function generateTrajectory(opts: {
  slug: string;
  /** The usable quotes — `usableQuotes` — never empty. */
  quotes: readonly Quote[];
  /** For the section paths only. The prose is never sent. */
  blocks: readonly Block[];
  tree: Tree;
  /** The Quotes artefact's whole list, for the hash. */
  allQuotes: readonly Pick<Quote, "id" | "blockId">[];
  /** Who is reading, already rendered — `renderProfile` in src/profile.ts. */
  profile: string | null;
  onProgress?: (detail: string) => void;
  signal?: AbortSignal;
}): Promise<TrajectoryRun> {
  const sourceHash = quotesHash(opts.allQuotes);
  const profileHash = opts.profile ? hashProfile(opts.profile) : null;
  const started = Date.now();
  const maxTokens = budgetFor("trajectory", ANSWER_TOKENS);
  const effort = (process.env.SPIDERYARN_PIPELINE_EFFORT as Effort | undefined) ?? EFFORT;
  const count = opts.quotes.length;

  let message: Anthropic.Message;
  try {
    const call = streamMessage(
      "trajectory",
      {
        max_tokens: maxTokens,
        thinking: { type: "adaptive" },
        output_config: { effort },
        system: [{ type: "text" as const, text: TRAJECTORY_SYSTEM }],
        messages: [
          {
            role: "user",
            content: renderPrompt({
              quotes: opts.quotes,
              blocks: opts.blocks,
              tree: opts.tree,
              profile: opts.profile,
            }),
          },
        ],
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
        report(`ordering ${count} quotes, ${Math.round(chars / 100) / 10}k characters so far`);
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
    throw truncationFailure("trajectory", maxTokens, ANSWER_TOKENS, {
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

  const dropped = emptyDrops();
  const parsed = parseJson(raw);
  /* Labels back to ids before anything believes them. A non-array `stops` is
     left for `buildTrajectory` to refuse. */
  if (Array.isArray(parsed.stops)) parsed.stops = fromLabels(parsed.stops, opts.quotes);
  const trajectory = buildTrajectory(parsed, {
    slug: opts.slug,
    quotes: opts.quotes,
    sourceHash,
    profileHash,
    elapsedMs: Date.now() - started,
    dropped,
  });

  return {
    trajectory,
    offered: count,
    dropped,
    model: CAPABLE_MODEL,
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
    maxTokens,
    elapsedMs: Date.now() - started,
  };
}
