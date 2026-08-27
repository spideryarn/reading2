/**
 * Pipeline stage 5e — **the summaries**: the whole piece, and each of its parts
 * and sections, at more than one length.
 *
 *   npm run summarise -- data/noema-mythology-of-conscious-ai
 *
 * See docs/project/summaries.md for the feature, and
 * docs/project/original-version/summaries.md for the version this is taken
 * from — because almost every decision in this file is theirs, and the two
 * that are not are the two their own notes regret.
 *
 * ## What is theirs
 *
 * **A named length ladder, not a token count.** They shipped nine rungs — "short
 * phrase of just a few words", "sentence or two", "single short paragraph",
 * "page" — and the naming is the point: *"sentence or two" is a thing a writer
 * can aim at and a reader can recognise; "level 4" is not.* The steps are
 * uneven on purpose. The difference between a phrase and a sentence changes
 * what a line can do; the difference between four hundred tokens and eight
 * hundred is more of the same.
 *
 * **Every rung in one call, not one call per rung.** They costed nine parallel
 * calls with prompt caching against one call returning all nine as JSON, and
 * the single call won by about 89% with no caching machinery to coordinate.
 * Here that generalises to *one call per parent, covering all its children at
 * every rung* — which buys a second thing they did not need: siblings written
 * together can be made to distinguish themselves from each other, which is
 * exactly what a row's job is (docs/project/table-of-contents.md#granularity).
 *
 * **Generated ahead of time and cached on the article's fingerprint.** Theirs
 * were never cached and were rewritten on every page view; their own doc lists
 * that as a limitation. The reader's ladder has to be instant, and the moment a
 * click triggers a model call the feature stops being a control and starts
 * being a wait.
 *
 * ## What is deliberately not theirs
 *
 * **Partial salvage.** Their handler parsed one JSON blob, validated it whole,
 * and threw on any failure — eight good summaries discarded because the ninth
 * was malformed, with no retry anywhere in that codebase for model output. Here
 * a batch that will not parse is retried once with the error handed back, and
 * an entry that cannot be placed is dropped alone. `Summaries.missing` counts
 * what did not survive, so a half-written artefact cannot read as a whole one.
 *
 * **The ladder is wired to every level.** This is the one their notes are
 * sharpest about. They generated nine granularities and the place a reader
 * actually met a summary — the heading tooltip — had `const
 * TOOLTIP_GRANULARITY = 'single short paragraph'` hardcoded into it. *"Nine
 * granularities generated, one shown where it mattered most."* So here the rung
 * is the reader's control and it applies to the root, the parts and the
 * sections alike.
 *
 * **No expertise axis.** Their second version crossed three lengths with three
 * reading levels behind two sliders. There is no evidence in their repo that
 * anybody used it — no telemetry, no follow-up, no critique — and our review of
 * it (original-version/summaries.md § The second axis) says two sliders is a
 * lot of interface for a thing nobody measured. If reading level ever matters
 * here it is one global setting, not a second axis on every summary.
 *
 * ## A separate artefact, joined back on by range
 *
 * `summary.json`, not fields on the tree — `tree.json` belongs to stage 4 and a
 * re-run of `npm run toc` rewrites it wholesale, which would silently drop
 * anything merged in. Entries are anchored by **block range, never by node id**,
 * because node ids are positional and a re-run renumbers them: a summary
 * attached by id would move one section sideways and read perfectly plausibly
 * where it landed. Same rule, same reasoning, as src/arc.ts.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { streamMessage, wasRefused } from "./messages-stream.js";
import { CAPABLE_MODEL } from "./models.js";
import { loadEnvLocal } from "./env.js";
import { MODEL_REFUSED } from "./messages.js";
import { anthropicCallFailed } from "./anthropic-call.js";
import { stageFailure } from "./job-failure.js";
import { hashBlocks, type BlockFingerprint } from "./source-hash.js";
import { budgetFor, truncationFailure } from "./token-budget.js";
import { parseJsonFrom } from "./parse-json.js";
import { PROFILE_RULES, hashProfile, profileSection } from "./profile.js";
import type {
  Block,
  BlockId,
  Meta,
  Summaries,
  SummaryEntry,
  Tree,
  TreeNode,
} from "./types.js";
import { withLedger } from "./cli-ledger.js";

export const PROMPT_VERSION = "summary/3";

/* ----------------------------------------------------------- the ladder --
   Two generated rungs, and a third the reader gets for free.

   The gist is rung zero: one sentence, already on every tree node, written by
   stage 4. It is not regenerated here and must not be — two files claiming to
   hold the one-sentence version of a section is the second-copy-of-one-fact
   problem, and they can only ever disagree. So the ladder the reader sees has
   three steps while this stage writes two.

       gist    one sentence            ← tree.json, free
       short   a few sentences         ← here
       long    a paragraph, or more    ← here, and the length depends on
                                         how much the node covers

   `long` is the rung that carries their adaptive instruction, which our review
   calls "arguably the more useful instruction" in the whole of their prompt:

   > Adjust the length of your summary appropriately, based on the length and
   > complexity of the text. For example, if the text is a paragraph, write a
   > sentence or two. If it's a page, write a paragraph or so. If it's a book,
   > write a page.

   That is a **ratio** rather than a length, and it is what makes one control
   sensible across a whole tree: at `long` the article gets about a page, a part
   gets a couple of paragraphs, and a section gets one. Written as a table of
   named lengths per depth rather than as a sentence in the prompt, because a
   named target is a thing the model can hit and "appropriately" is not. */

interface Budget {
  /** What the model is asked for, in words a writer can aim at. */
  shortName: string;
  longName: string;
  /** Room to allow for each, in tokens. Estimates, and only ever used to size `max_tokens`. */
  shortTokens: number;
  longTokens: number;
}

/**
 * What a node at this depth is asked for.
 *
 * Depth 0 is the whole article, 1 is a part, 2 and below are sections. The
 * numbers are theirs, rounded: `few sentences` was 100 and `single short
 * paragraph` 200, `couple of paragraphs` 400 and `page` 800.
 */
export function rungsFor(depth: number): Budget {
  if (depth === 0) {
    return {
      shortName: "a few sentences",
      longName: "about a page",
      shortTokens: 120,
      longTokens: 900,
    };
  }
  if (depth === 1) {
    return {
      shortName: "a few sentences",
      longName: "a couple of paragraphs",
      shortTokens: 110,
      longTokens: 450,
    };
  }
  return {
    shortName: "a few sentences",
    longName: "a single short paragraph",
    shortTokens: 100,
    longTokens: 240,
  };
}

/**
 * How deep the ladder goes.
 *
 * Two levels below the root — parts and sections — which for every tree this
 * app has built so far is *every* non-leaf node, because the trees bottom out
 * at depth 3 with one leaf per paragraph. The cap is here for the tree that
 * does not: a five-level tree would otherwise multiply the bill by the width of
 * its fourth level with nothing on screen to show for it, since the panel's own
 * depth control stops here too.
 */
export const MAX_DEPTH = 2;

/**
 * The fewest blocks a node must cover to earn a summary above its gist.
 *
 * Their adaptive instruction, applied as a *whether* rather than only as a
 * *how long*: a section of two paragraphs summarised in "a single short
 * paragraph" is not a summary, it is a retelling at the same length, and it
 * costs a model call to produce something the gist already said better. The
 * node still appears in the panel — with its gist, which is what a two-block
 * section wants anyway.
 */
export const MIN_BLOCKS = 3;

/**
 * The most targets one call is asked to cover.
 *
 * Their failure mode is the cost of batching and it compounds with the output
 * ceiling: the glossary's 504s over there were caused by **output** tokens, not
 * by the article going in (docs/project/original-version/glossary.md § Bug
 * one). A parent with forty children is too big a batch whatever the salvage
 * rules are, so it becomes several.
 */
export const BATCH_SIZE = 8;

/** How many batches are in flight at once. */
const CONCURRENCY = 3;

/* --------------------------------------------------------- which nodes --- */

/** Where each block sits in the article. Ids carry no order — block-ids.md. */
function orderOf(blocks: Block[]): Map<BlockId, number> {
  return new Map(blocks.map((b, i) => [b.id, i]));
}

/** How many blocks a node covers, or 0 if its range does not resolve. */
export function spanOf(node: TreeNode, order: Map<BlockId, number>): number {
  const lo = order.get(node.range[0]);
  const hi = order.get(node.range[1]);
  if (lo === undefined || hi === undefined || lo > hi) return 0;
  return hi - lo + 1;
}

/**
 * Every node that earns a summary above its gist, in document order.
 *
 * The root always qualifies — it is the whole article, and the one summary the
 * original version actually shipped. Below it: not too deep, and covering
 * enough text to be worth compressing.
 *
 * **The test is what a node covers, not whether it has children**, and the
 * difference is not academic. "Has children" reads as a way of saying "is not a
 * leaf", and it is one — right up until a part has no sub-sections, at which
 * point it silently loses its summary for a reason that has nothing to do with
 * how much text is under it. `spanOf >= MIN_BLOCKS` says the thing itself: a
 * leaf is one block by construction (validate-tree.ts), so it cannot pass, and
 * a childless part covering four paragraphs can.
 */
export function targetsOf(tree: Tree, blocks: Block[]): TreeNode[] {
  const order = orderOf(blocks);
  const out: TreeNode[] = [];
  const visit = (node: TreeNode | undefined) => {
    if (!node) return;
    const earns =
      node.depth === 0 || (node.depth <= MAX_DEPTH && spanOf(node, order) >= MIN_BLOCKS);
    if (earns) out.push(node);
    if (node.depth >= MAX_DEPTH) return;
    for (const id of node.children) visit(tree.nodes[id]);
  };
  visit(tree.nodes[tree.rootId]);
  return out;
}

/**
 * One call's worth of work: some targets, and the slice of the article they are
 * about.
 *
 * `scope` is the node whose full text goes into the prompt. For the first batch
 * that is the root, so the model writing the article's own summary and the
 * parts' summaries reads the whole piece once. For a part's sections it is the
 * part — the sections still get the article's skeleton for context, but sending
 * the whole text again per part would multiply the input by the number of parts
 * to tell the model things the skeleton already says.
 */
export interface Batch {
  scope: TreeNode;
  targets: TreeNode[];
}

/**
 * Group the targets into calls: the root with its parts, then each part with
 * its sections, split at `BATCH_SIZE`.
 *
 * Grouping by parent rather than by count is the half that matters. Siblings in
 * one call can be told to distinguish themselves from each other; siblings
 * split across calls cannot, and neither can two nodes that have nothing to do
 * with one another.
 */
export function batchesOf(tree: Tree, targets: TreeNode[]): Batch[] {
  const chosen = new Set(targets.map((n) => n.id));
  const root = tree.nodes[tree.rootId];
  if (!root) return [];

  const batches: Batch[] = [];
  const push = (scope: TreeNode, group: TreeNode[]) => {
    for (let i = 0; i < group.length; i += BATCH_SIZE) {
      batches.push({ scope, targets: group.slice(i, i + BATCH_SIZE) });
    }
  };

  // The root goes in the first batch alongside the parts, because both are
  // written from the whole article and splitting them would read it twice.
  const parts = root.children
    .map((id) => tree.nodes[id])
    .filter((n): n is TreeNode => !!n && chosen.has(n.id));
  push(root, [...(chosen.has(root.id) ? [root] : []), ...parts]);

  for (const part of root.children.map((id) => tree.nodes[id])) {
    if (!part) continue;
    const sections = part.children
      .map((id) => tree.nodes[id])
      .filter((n): n is TreeNode => !!n && chosen.has(n.id));
    if (sections.length > 0) push(part, sections);
  }
  return batches;
}

/* ------------------------------------------------------------ the prompt --
   Three lines of this are theirs almost verbatim, and our review of their
   version says why each is worth taking:

     "Be as concise, concrete, and easy to understand as you can."
     "Provide only the summary itself, without any superfluous conversation
      or commentary."
     "do not include headings"

   The second is the one worth stealing outright. It is the same problem the arc
   prompt hit and solved differently — sentences that spend a clause announcing
   that a summary is coming — and two prompts in two projects meeting it says
   the model wants to introduce itself.

   And here is the absence our review names, which is the whole reason the RULES
   section below is longer than theirs: **nothing in their prompt asked the
   model to reuse the author's own terms or framing.** So it produced good,
   fluent, generic summary prose — the "the author argues that…" voice that
   vision.md forbids as principle 2. Theirs made a good summary; ours has to
   make a door into the passage. */

const SYSTEM = `You are writing the summaries for a reading view that shows an article at
several levels of compression at once. The reader can already see the article
itself. Your summaries are a way in to it, never a replacement for it.

You will be given the article's structure, the full text of one part of it, and
a numbered list of sections to summarise. For each one, write TWO summaries at
two named lengths.

WHAT A SUMMARY IS FOR HERE

A reader uses these to decide where to go and to hold the shape of the argument
while they read. So a summary must be specific enough that a reader who has not
read the section learns something real from it, and pointed enough that a reader
who has read it recognises which section it is.

RULES

- Be as concise, concrete, and easy to understand as you can. Prefer British
  English.
- Use the author's own distinctive vocabulary and their own framing. Those words
  are the reader's handholds, and a summary in generic words is a summary of
  some other article.
- Say what the article SAYS, not that it says it. Never make the article, the
  author or the section the subject of a sentence. No "the author argues that",
  "this section explores", "the piece goes on to", "we are told that".
    bad:  "The author argues that consciousness is rooted in the body."
    good: "Consciousness is rooted in the body: what it is like to be you
           starts with keeping you alive."
- Never write a summary that would be true of a hundred other articles. If a
  sentence would survive swapping this article for another on the same topic,
  cut it.
- Distinguish siblings. The sections in one list are read next to each other, so
  each summary must make clear what THIS section has that the others do not.
  Two summaries that could be swapped are two failures.
- Do not include headings, bullet points, bold, or any other formatting. Plain
  sentences and, where a length allows more than one, plain paragraphs separated
  by a blank line.
- No opening clause that only announces a summary is coming. Every word carries
  content.
- Do not give the reader advice, and do not evaluate the article.
- Provide only the summary itself, without any superfluous conversation or
  commentary.

POINTING BACK INTO THE ARTICLE

Every paragraph you are given is labelled with a block id like spya-k3m9qt. Say
where a claim lives: put the id of the paragraph it comes from in square
brackets at the end of the sentence that makes it.

  Perception is a controlled hallucination, not a window [spya-k3m9qt].

- Use only ids that appear in the text below. NEVER invent one and never guess
  at one you half-remember. A wrong id sends the reader to the wrong paragraph,
  which is worse than no id at all.
- Cite the paragraph that actually carries the claim, not one near it.
- Two or three ids in one bracket when a point is spread across paragraphs:
  [spya-k3m9qt spya-p7w2dn].
- Cite sparingly. One or two in a short summary; at most one a sentence in a
  long one. These are doors, not footnotes, and an id after every clause is
  noise a reader stops reading.
- The id goes inside the sentence's punctuation and nowhere else. Do not write
  a list of sources at the end.

IF THE READER ASKS FOR SOMETHING IN PARTICULAR

The prompt may carry a section headed WHAT THIS READER IS AFTER. That is the
reader's own note about why they are reading this piece. It changes what you
choose to put first and what you spend words on. It changes nothing else.

- Summarise the section. Do not answer the reader's question, do not address
  them, and do not write about their interest.
- Where the section genuinely bears on what they asked for, lead with that and
  give it more of the room.
- Where it does not, write exactly the summary you would have written anyway.
  Never say that the section does not cover it — that spends the reader's line
  telling them nothing about the section.
- Never add, sharpen, or bend a claim to fit the request. If the article does
  not say it, it does not go in.
- Keep the article's own proportions. A request cannot promote a passing remark
  into the main point of a section.

OUTPUT

JSON only, no prose, no code fence:

{"summaries": [
  {"n": 1, "title": "the title exactly as given", "short": "…", "long": "…"},
  {"n": 2, "title": "…", "short": "…", "long": "…"}
]}

One object per numbered section, in order, echoing its number and its title so
each summary can be matched back to the section it is about. Write every section
you are given. If a section defeats you, still return its object with your best
attempt — an omission is a hole in the reader's view.

${PROFILE_RULES}`;

/** The article's shape, so a section can be summarised knowing what surrounds it. */
function skeletonOf(tree: Tree): string {
  const root = tree.nodes[tree.rootId];
  if (!root) return "";
  return root.children
    .map((id) => tree.nodes[id])
    .filter((p): p is TreeNode => !!p)
    .map((p, i) => {
      const subs = p.children
        .map((cid) => tree.nodes[cid])
        .filter((c): c is TreeNode => !!c && !!c.gist)
        .map((c) => `      - ${c.title}: ${c.gist}`)
        .join("\n");
      return `PART ${i + 1}: ${p.title}\n  gist: ${p.gist ?? "(none)"}${subs ? `\n${subs}` : ""}`;
    })
    .join("\n\n");
}

/**
 * The text a node covers, in document order, **each paragraph labelled with its
 * block id**.
 *
 * The label is what makes a summary a door rather than a substitute. A model
 * that cannot see the ids cannot cite them, and a summary with no way back into
 * the passage is the thing vision.md's second principle refuses — the summary
 * standing where the paragraph should. Greg asked for the ids on 2026-08-26;
 * this line is where they become possible.
 *
 * `id: text`, which is the shape src/converse.ts and src/explain.ts already use
 * for the same purpose. One article rendering the model has to learn, not
 * three.
 *
 * The empty-text filter runs **before** the labels are attached, not after — an
 * image block would otherwise arrive as a bare id followed by nothing, which is
 * an id the model can cite for a paragraph that has no words in it.
 */
export function textOf(node: TreeNode, blocks: Block[], order: Map<BlockId, number>): string {
  const lo = order.get(node.range[0]);
  const hi = order.get(node.range[1]);
  if (lo === undefined || hi === undefined || lo > hi) return "";
  return blocks
    .slice(lo, hi + 1)
    .filter((b) => b.text)
    .map((b) => `${b.id}: ${b.text}`)
    .join("\n\n");
}

/* Exported for the tests, like `textOf` and `assign` beside it. What is worth
   pinning is that the reader's steer reaches the model at all and that its
   absence leaves no trace — a prompt that always carries an empty guidance
   header is a prompt that has taught the model to expect one. */
export function renderPrompt(opts: {
  meta: Meta | null;
  tree: Tree;
  blocks: Block[];
  batch: Batch;
  /**
   * The reader's own note about what they are reading for.
   *
   * In the **user** prompt and never in `SYSTEM`, which is a constant: the
   * rules for how much weight this may carry are the same on every run and
   * belong in the cached half, while the note itself changes per run and would
   * bust the cache for every batch if it lived there.
   */
  guidance?: string;
  /**
   * Who is reading, already rendered — `renderProfile` in src/profile.ts.
   *
   * **Two boxes about intent, in one prompt, and they are not the same thing.**
   * The profile is durable and about the reader; `guidance` is a note typed
   * while looking at the button that rewrites these summaries. So the profile
   * goes first and the steer second, and `SYSTEM` states the precedence out
   * loud: where they pull different ways, the steer wins. Leaving that to the
   * model would be handing it two instructions about emphasis with no ordering
   * between them, which is how you get an answer that follows neither.
   */
  profile?: string | null;
  /** Fed back on the one retry, so the second attempt knows what was wrong with the first. */
  repair?: string;
}): string {
  const order = orderOf(opts.blocks);
  const { scope, targets } = opts.batch;

  const list = targets
    .map((n, i) => {
      const b = rungsFor(n.depth);
      const what =
        n.depth === 0
          ? "THE WHOLE ARTICLE"
          : n.depth === 1
            ? "a part of the article"
            : "a section";
      return `${i + 1}. "${n.title}" — ${what}, ${spanOf(n, order)} paragraphs
     gist (one sentence, already written; do not repeat it back):
       ${n.gist ?? "(none)"}
     short: ${b.shortName}
     long:  ${b.longName}`;
    })
    .join("\n\n");

  const title = opts.meta?.title ? `"${opts.meta.title}"` : "this article";
  const scopeLabel = scope.depth === 0 ? "the whole article" : `the part "${scope.title}"`;

  /* **`repair` used to be prepended here, at position zero.** Every byte of the
     prompt behind it moved when it was present, so the one call most likely to
     be repeating work it had already paid for — a retry over the same sections
     of the same article — was guaranteed to miss the cache the first attempt
     had just written. It goes at the end now, with the other instructions.
     docs/plans/prompt-caching.md. */
  /* The reader before the request: who they are frames what "lead with this"
     even means. Both sit near the top, where they will be read, and both are
     immediately re-bounded — the long rules are in SYSTEM, because a constraint
     three thousand tokens above the text it constrains is a constraint the
     model has stopped weighing. */
  const who = profileSection(opts.profile ?? null);

  return `Summaries for ${title}.

Write ${targets.length} ${targets.length === 1 ? "entry" : "entries"}, one per numbered section below.
${who ? `\n${who}\n` : ""}${
  opts.guidance
    ? `
=== WHAT THIS READER IS AFTER ===

${opts.guidance}

Lead with this where a section genuinely bears on it. Where a section does not,
summarise it exactly as you would have anyway, and do not mention the request.
It changes emphasis only: never what the article says, and never its
proportions.
`
    : ""
}
=== SECTIONS TO SUMMARISE ===

${list}

=== THE ARTICLE'S STRUCTURE ===

${skeletonOf(opts.tree)}

=== FULL TEXT OF ${scopeLabel.toUpperCase()} ===

${textOf(scope, opts.blocks, order)}${
    opts.repair
      ? `\n\n=== YOUR PREVIOUS ANSWER COULD NOT BE READ ===\n\n${opts.repair}\n\nReturn valid JSON this time, in exactly the shape described.`
      : ""
  }`;
}

/* ---------------------------------------------------- reading the answer --- */

/**
 * Strip a stray code fence if the model wraps its JSON despite instructions.
 *
 * The parse goes through src/parse-json.ts, and the reason is that **nothing in
 * this file logs**. A step that throws is logged by src/jobs.ts with
 * `errorFields`, which keeps `message` *and* `stack` — and V8's own parse error
 * quotes the first characters of whatever it was handed. So a plain
 * `JSON.parse` here writes part of the model's writing about the article into
 * the log, from a file that never calls the logger at all. An error is a value
 * that travels, and where it is thrown is not where it is written down.
 */
export function parseJson(raw: string): { summaries?: unknown } {
  const text = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/, "")
    .trim();
  return parseJsonFrom<{ summaries?: unknown }>(text, "the summaries response");
}

/** Titles compared with the punctuation and casing taken out. */
function key(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function str(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export interface Assigned {
  node: TreeNode;
  short?: string;
  long?: string;
}

/**
 * Match what came back to the sections it was asked about.
 *
 * **Title first, number second, and that order is the whole point.** src/arc.ts
 * refuses to zip its answer to the parts at all, because a model that skips one
 * sentence puts every later sentence against the wrong part and each of those
 * cells still looks perfectly plausible. Here the model echoes both the number
 * and the title, so a skipped entry cannot shift the rest — and when the two
 * disagree the title wins, because the title is about the section and the
 * number is only about the list.
 *
 * Anything that matches neither is dropped rather than guessed at, and anything
 * dropped is counted. A summary against the wrong section is a lie the reader
 * cannot detect; a missing one is a gap they can see.
 */
export function assign(parsed: { summaries?: unknown }, targets: TreeNode[]): Assigned[] {
  const raw = Array.isArray(parsed.summaries) ? (parsed.summaries as unknown[]) : [];
  const byTitle = new Map<string, number>();
  targets.forEach((n, i) => {
    // First wins: two sections with the same title fall back to `n` for the
    // second, which is exactly what the number is there for.
    if (!byTitle.has(key(n.title))) byTitle.set(key(n.title), i);
  });

  const out: Assigned[] = [];
  const used = new Set<number>();
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const row = item as { n?: unknown; title?: unknown; short?: unknown; long?: unknown };

    const titled = typeof row.title === "string" ? byTitle.get(key(row.title)) : undefined;
    const numbered =
      typeof row.n === "number" && Number.isInteger(row.n) && row.n >= 1 && row.n <= targets.length
        ? row.n - 1
        : undefined;
    const index = titled !== undefined && !used.has(titled) ? titled : numbered;
    if (index === undefined || used.has(index)) continue;

    const node = targets[index];
    if (!node) continue;
    const short = str(row.short);
    const long = str(row.long);
    // An entry with neither rung is not a partial success, it is an empty
    // object; keeping it would make `missing` count it as written.
    if (!short && !long) continue;

    used.add(index);
    out.push({ node, ...(short && { short }), ...(long && { long }) });
  }
  return out;
}

/**
 * The artefact, from everything that came back.
 *
 * Entries are in document order — coarse before fine — which is the order the
 * panel renders them in and the order a reader meets them. Nodes whose batch
 * failed are simply absent, and counted in `missing`.
 */
export function buildSummaries(
  assigned: Assigned[],
  opts: {
    slug: string;
    targets: TreeNode[];
    blocks: Block[];
    sourceHash: string;
    elapsedMs: number;
    /** The reader's steer, kept so the panel can say these were written to it. */
    guidance?: string;
    /** The rendered profile these were written from, or null for none. */
    profile?: string | null;
  },
): Summaries {
  const order = orderOf(opts.blocks);
  const written = new Map(assigned.map((a) => [a.node.id, a]));

  const entries: SummaryEntry[] = [];
  for (const node of opts.targets) {
    const got = written.get(node.id);
    if (!got) continue;
    entries.push({
      range: node.range,
      depth: node.depth,
      ...(got.short !== undefined && { short: got.short }),
      ...(got.long !== undefined && { long: got.long }),
    });
  }

  if (entries.length === 0) {
    throw new Error("The model returned no usable summaries. Nothing to write.");
  }

  entries.sort((a, b) => {
    const ai = order.get(a.range[0]) ?? 0;
    const bi = order.get(b.range[0]) ?? 0;
    return ai - bi || a.depth - b.depth;
  });

  return {
    version: PROMPT_VERSION,
    generator: CAPABLE_MODEL,
    slug: opts.slug,
    sourceHash: opts.sourceHash,
    /* `null`, never absent: absent means "written before this existed" and
       `null` means "written deliberately without a profile", and the panel
       needs to tell those apart to decide whether its checkbox starts ticked.
       src/profile.ts § profileIsStale.

       Note the difference from `guidance` two lines down, which is stored as
       the text itself and omitted when empty. The steer is stored so a reader
       can *read it back*; this is stored so the app can *compare* it, and a
       comparison needs a value for "none" as much as for "this one". */
    profileHash: opts.profile ? hashProfile(opts.profile) : null,
    entries,
    /* Stored, because a steered summary that does not say so is a summary the
       reader cannot weigh. Six months later "why does this one lean so hard on
       the economics" has an answer on the artefact rather than nowhere. */
    ...(opts.guidance ? { guidance: opts.guidance } : {}),
    missing: opts.targets.length - entries.length,
    generatedAt: new Date().toISOString(),
    elapsedMs: opts.elapsedMs,
  };
}

/**
 * How many block ids the summaries cite, and how many of those the article does
 * not have.
 *
 * Both go in the step's log line, and neither is an error. The point is the
 * **first** number: a run that quietly starts returning zero is the model
 * having stopped citing, which breaks nothing visible — the panel simply
 * renders prose — and turns the summaries back into the thing they are not
 * allowed to be, a replacement for the passage. The second is the same check
 * `unknownCitedIds` does for chat, for the same reason: an invented id is a
 * door into the wrong room, and the client drops it silently.
 *
 * Its own small function rather than converse.ts's, which is the same six lines
 * behind an import that would drag the whole chat stage into this one.
 */
export function countCitations(
  summaries: Summaries,
  blocks: Block[],
): { cited: number; unknown: number } {
  const known = new Set(blocks.map((b) => b.id));
  let cited = 0;
  let unknown = 0;
  for (const entry of summaries.entries) {
    for (const text of [entry.short, entry.long]) {
      for (const id of text?.match(/spya-[a-z0-9]{6}/g) ?? []) {
        cited++;
        if (!known.has(id)) unknown++;
      }
    }
  }
  return { cited, unknown };
}

/* ---------------------------------------------------------- freshness ---- */

/**
 * Do these summaries still describe the article on disk?
 *
 * Pure, and used at both ends exactly as the glossary's is: `GET
 * /api/summary/:slug` puts the answer in the response so the panel can say so,
 * and `summariesAreCurrent` below wraps it so the pipeline will not skip a step
 * whose artefact has gone stale.
 */
export function isStale(summaries: Summaries, blocks: BlockFingerprint[]): boolean {
  return summaries.sourceHash !== hashBlocks(blocks);
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, "utf-8")) as T;
  } catch {
    return null;
  }
}

/** The summaries on disk, or null. Exported so the step and the API read them one way. */
export async function readSummaries(dir: string): Promise<Summaries | null> {
  return readJson<Summaries>(path.join(dir, "summary.json"));
}

/**
 * Are the summaries on disk ones we would write again today?
 *
 * The step's `isDone`, and the same three conditions the glossary and the
 * thread check: the blocks they were written from, the prompt that wrote them,
 * and the model that ran. Change any one and they regenerate by themselves.
 *
 * Anything unreadable answers **false**, which is the safe way to be wrong: the
 * cost is a run, where the other way round is a stale summary served for ever.
 */
export async function summariesAreCurrent(dir: string): Promise<boolean> {
  const summaries = await readSummaries(dir);
  if (!summaries) return false;
  if (summaries.version !== PROMPT_VERSION) return false;
  if (summaries.generator !== CAPABLE_MODEL) return false;
  const blocksFile = await readJson<{ blocks: Block[] }>(path.join(dir, "blocks.json"));
  if (!blocksFile?.blocks) return false;
  return !isStale(summaries, blocksFile.blocks);
}

/* ------------------------------------------------------------ the stage --- */

/**
 * Run `work` over `items`, `limit` at a time, keeping the results in order.
 *
 * Batches are independent — a part's sections do not depend on another part's —
 * and running them one at a time turns a seven-part article into seven model
 * calls end to end, which is minutes rather than one wait. The limit is there
 * because the other extreme fires every batch at once and discovers the
 * provider's rate limit as a failed ingest.
 */
async function pooled<T, R>(
  items: T[],
  limit: number,
  work: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const runner = async () => {
    for (;;) {
      const i = next++;
      // Bounds, not `items[i] === undefined`. They are the same thing for the
      // batches this is called with and they stop being the same thing the
      // first time somebody pools over a list that can hold a hole in it — at
      // which point the pool quietly stops early and the caller gets a short
      // answer with nothing thrown.
      if (i >= items.length) return;
      results[i] = await work(items[i] as T, i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runner));
  return results;
}

export interface SummariesRun {
  summaries: Summaries;
  outFile: string;
  model: string;
  targets: number;
  batches: number;
  /** Batches that failed even after the repair attempt. Their nodes are in `missing`. */
  failedBatches: number;
  blocks: number;
  /** Block ids the summaries point at, and how many of those do not exist. */
  cited: number;
  unknownCited: number;
  inputTokens: number;
  outputTokens: number;
  elapsedMs: number;
}

/** One batch, with one bounded retry that feeds the parse error back. */
async function runBatch(opts: {
  meta: Meta | null;
  tree: Tree;
  blocks: Block[];
  batch: Batch;
  guidance?: string;
  /** The rendered profile, frozen for the whole run — see `generateSummaries`. */
  profile?: string | null;
  signal?: AbortSignal;
  onTokens(input: number, output: number): void;
}): Promise<{ assigned: Assigned[]; failed: boolean }> {
  const { batch } = opts;

  /* Room for the answer, plus room for the thinking that precedes it — the two
     come out of one allowance on every model this app can use. The answer term
     is exact here in a way most stages' is not: we know which nodes are in this
     batch and what each was asked for. See src/token-budget.ts and
     docs/postmortems/toc-max-tokens.md. */
  const answerTokens = batch.targets.reduce((n, node) => {
    const b = rungsFor(node.depth);
    return n + b.shortTokens + b.longTokens + 60;
  }, 200);
  const maxTokens = budgetFor("summary", answerTokens);

  const attempt = async (repair?: string): Promise<Assigned[]> => {
    /* Streamed like every other stage, and for the same reason: the SDK refuses
       a large `max_tokens` on a non-streaming request, because the HTTP timeout
       will beat the model to the end. Nothing subscribes to the deltas here —
       progress is reported per batch, since three of these are in flight at
       once and a character count would be three streams added together. */
    /* The request itself, wrapped: a 429/401/etc from the SDK is not caught
       anywhere upstream of here, and the installed SDK builds `Error.message`
       from the upstream error body — the one place it can echo back part of
       what we sent, which is the whole article. See src/anthropic-call.ts.

       `streamMessage` builds the client, and sets `logLevel: "off"` on it — a
       privacy setting rather than a preference. The SDK has a logger of its own
       that defaults to `console` and reads `ANTHROPIC_LOG` from the
       environment; at `debug` it prints the outgoing request — **which is the
       whole article** — and, for a non-JSON error response, the raw upstream
       body. Neither goes through Pino, so neither can be redacted, and
       `anthropicCallFailed` never sees them. See docs/project/logging.md. */
    let message: Anthropic.Message;
    try {
      const call = streamMessage(
        "summarise",
        {
          max_tokens: maxTokens,
          thinking: { type: "adaptive" },
          output_config: { effort: "medium" },
          system: SYSTEM,
          messages: [
            {
              role: "user",
              content: renderPrompt({
                meta: opts.meta,
                tree: opts.tree,
                blocks: opts.blocks,
                batch,
                ...(opts.guidance !== undefined && { guidance: opts.guidance }),
                ...(opts.profile !== undefined && { profile: opts.profile }),
                ...(repair !== undefined && { repair }),
              }),
            },
          ],
        },
        { ...(opts.signal ? { signal: opts.signal } : {}) },
      );
      /* `call.finalMessage()`, never `call.stream.finalMessage()` — the wrapper
         is what records what this call cost. The stream's own method works and
         records nothing. See src/messages-stream.ts. */
      message = await call.finalMessage();
    } catch (err) {
      throw anthropicCallFailed(err);
    }

    opts.onTokens(message.usage.input_tokens, message.usage.output_tokens);

    if (wasRefused(message)) {
      /* `stop_details` is deliberately neither thrown nor logged — it is the
         provider's own words about a request that carried the whole article,
         and this error is copied onto the job and shown on the progress card.
         See MODEL_REFUSED in src/messages.ts. */
      throw new Error(MODEL_REFUSED.message);
    }
    if (message.stop_reason === "max_tokens") {
      throw truncationFailure("summary", maxTokens, answerTokens, {
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
    return assign(parseJson(raw), batch.targets);
  };

  try {
    return { assigned: await attempt(), failed: false };
  } catch (err) {
    // A cancelled job must stop, not retry. Everything else gets exactly one
    // more go with the error handed back — the retry-with-repair their codebase
    // had nowhere at all (original-version/llm-plumbing.md).
    if (opts.signal?.aborted) throw err;
    try {
      return { assigned: await attempt((err as Error).message), failed: false };
    } catch {
      // One batch, lost. The other batches keep their summaries, and the count
      // of what did not survive goes into the artefact rather than into a
      // thrown error that would take the good ones with it.
      return { assigned: [], failed: true };
    }
  }
}

/**
 * Stage 5e over a data directory: a handful of batched model calls, then
 * `summary.json` beside the tree, the arc, the thread and the glossary.
 *
 * Exported because two callers run this stage and they must not drift —
 * `main()` below, and the ingest queue in the server process (src/pipeline.ts).
 */
export async function generateSummaries(opts: {
  dir: string;
  /**
   * The reader's own note about what they want out of this article.
   *
   * Optional, and the ordinary case is that it is absent. What it may and may
   * not do to the output is set out in `SYSTEM` above — in short, emphasis
   * only. It is deliberately **not** part of `summariesAreCurrent`: a steer is
   * a reason to force a rewrite, which is what the button that carries it
   * already does, not a reason for the next ordinary run to decide the artefact
   * is stale.
   */
  guidance?: string;
  /**
   * Who is reading, already rendered — `renderProfile` in src/profile.ts.
   *
   * **Frozen by whoever queued the job, and this is the stage that most needs
   * it to be.** A summary run is several batches in flight at once; a reader
   * who edits their profile in the middle would otherwise get one artefact
   * written from two profiles and stamped with whichever was last. src/jobs.ts
   * resolves it once, as it already does for the steer above.
   *
   * Not part of `summariesAreCurrent` either — for the *opposite* reason to the
   * steer's, and the difference is worth keeping straight. A steer is left out
   * because it is a reason to force a rewrite rather than a reason to call the
   * artefact stale. The profile is left out of *that* function because
   * staleness against a profile is a different question with its own answer:
   * `profileIsStale` in src/profile.ts, which the panel asks and the pipeline
   * does not.
   */
  profile?: string | null;
  onProgress?: (detail: string) => void;
  /** Cancel the calls. The queue passes its job's signal — src/jobs.ts. */
  signal?: AbortSignal;
}): Promise<SummariesRun> {
  /* `parseJsonFrom`, not `JSON.parse`: blocks.json *is* the article, and V8's
     own parse error quotes the first characters of what it was handed. Nothing
     in this file logs, but a step that throws is logged by src/jobs.ts with
     `errorFields`, which keeps `message` and `stack`. src/parse-json.ts. */
  const { blocks } = parseJsonFrom<{ blocks: Block[] }>(
    await readFile(path.join(opts.dir, "blocks.json"), "utf-8"),
    "blocks.json",
  );
  const tree = parseJsonFrom<Tree>(
    await readFile(path.join(opts.dir, "tree.json"), "utf-8"),
    "tree.json",
  );
  // Optional, and only ever used to tell the model what it is reading. A
  // missing meta.json is not worth failing the whole stage over.
  const meta = await readFile(path.join(opts.dir, "meta.json"), "utf-8")
    .then((raw) => JSON.parse(raw) as Meta)
    .catch(() => null);

  const targets = targetsOf(tree, blocks);
  if (targets.length === 0) {
    /* `bug`, so the job card does not offer a Retry that cannot work. The root
       always earns a summary, so an empty list means the tree does not contain
       its own root — and that tree came off disk from a step that finished,
       which Retry skips. A second attempt reads the same file and counts the
       same zero. src/job-failure.ts. */
    throw stageFailure("bug", "No node in this tree covers enough text to summarise.");
  }
  const batches = batchesOf(tree, targets);
  const started = Date.now();

  /* No client is built here and none is passed down: `streamMessage` builds one
     per call inside `runBatch`, which is also where the privacy setting that
     used to be spelled out at this line (`logLevel: "off"`, and why it is not a
     preference) now lives. */
  let inputTokens = 0;
  let outputTokens = 0;
  let done = 0;

  const results = await pooled(batches, CONCURRENCY, async (batch) => {
    const out = await runBatch({
      meta,
      tree,
      blocks,
      batch,
      ...(opts.guidance !== undefined && { guidance: opts.guidance }),
      /* Read off `opts` once per batch rather than captured in a local, which
         is safe here only because nothing in this function can change it —
         `generateSummaries` never writes to its own opts. The freezing that
         matters happened upstream, in src/jobs.ts. */
      profile: opts.profile ?? null,
      ...(opts.signal !== undefined && { signal: opts.signal }),
      onTokens: (i, o) => {
        inputTokens += i;
        outputTokens += o;
      },
    });
    done++;
    // Reported per batch rather than per token: several calls are in flight at
    // once, so a character count would be the sum of three unrelated streams
    // and would read as one thing going oddly fast.
    opts.onProgress?.(`${done} of ${batches.length} groups summarised`);
    return out;
  });

  const summaries = buildSummaries(
    results.flatMap((r) => r.assigned),
    {
      slug: tree.slug,
      targets,
      blocks,
      sourceHash: hashBlocks(blocks),
      profile: opts.profile ?? null,
      elapsedMs: Date.now() - started,
      ...(opts.guidance !== undefined && { guidance: opts.guidance }),
    },
  );

  const citations = countCitations(summaries, blocks);

  const outFile = path.join(opts.dir, "summary.json");
  await writeFile(outFile, JSON.stringify(summaries, null, 2), "utf-8");

  return {
    summaries,
    outFile,
    model: CAPABLE_MODEL,
    targets: targets.length,
    batches: batches.length,
    failedBatches: results.filter((r) => r.failed).length,
    blocks: blocks.length,
    cited: citations.cited,
    unknownCited: citations.unknown,
    inputTokens,
    outputTokens,
    elapsedMs: Date.now() - started,
  };
}

async function main(): Promise<void> {
  const dir = process.argv[2];
  if (!dir) {
    console.error(
      'Usage: tsx src/summarise.ts <dir with blocks.json + tree.json> ["what you are reading for"]',
    );
    process.exit(1);
  }
  // The same steer the panel's box sends, so the CLI and the button exercise
  // one path. Quoted as one argument; anything past it is ignored.
  const guidance = process.argv[3]?.trim();
  // Before the calls, not after. This is the only thing on screen for the
  // minute or two the model takes, and printing it afterwards made the sibling
  // stages look hung for the whole request.
  /* At the program's edge, not inside the gateway — see `messagesClient` in
     src/messages-stream.ts for the test that proved the difference. Without it
     this command answers `[ai-not-set-up]` on a machine where the key is right
     there in `.env.local`. */
  loadEnvLocal();
  console.log(`Writing the summaries with ${CAPABLE_MODEL}…`);
  const run = await generateSummaries({
    dir,
    ...(guidance ? { guidance } : {}),
    onProgress: (detail) => process.stdout.write(`\r  ${detail}          `),
  });

  console.log(
    `\n${run.targets} sections in ${run.batches} ${run.batches === 1 ? "group" : "groups"}, ` +
      `${run.blocks} blocks → ${CAPABLE_MODEL}`,
  );
  console.log(`\nTokens:    ${run.inputTokens} in, ${run.outputTokens} out`);
  console.log(
    `Citations: ${run.cited}${run.unknownCited > 0 ? ` (${run.unknownCited} unknown)` : ""}`,
  );
  console.log(`Elapsed:   ${(run.elapsedMs / 1000).toFixed(1)}s`);
  if (run.summaries.missing > 0) {
    console.log(
      `Missing:   ${run.summaries.missing} of ${run.targets} ` +
        `(${run.failedBatches} ${run.failedBatches === 1 ? "group" : "groups"} failed)`,
    );
  }
  console.log(`Wrote:     ${path.resolve(run.outFile)}\n`);
  for (const entry of run.summaries.entries) {
    const indent = "  ".repeat(entry.depth);
    console.log(`${indent}L${entry.depth}  ${entry.short ?? "(no short summary)"}\n`);
  }
}

/* Compared as resolved paths, not by suffix — see the same guard in src/arc.ts
   for the import that would otherwise run this CLI as a side effect. */
const isMain =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) void withLedger("cli", main);
