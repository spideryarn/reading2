/**
 * **The scoped expansion call's protocol** — the prompt, the request the wave
 * puts on the wire, the strict reading of what comes back, and the record of
 * what was decided about each candidate.
 *
 * `src/hierarchy-cascade.ts` is the arithmetic: when a node still needs
 * splitting, how many parents one call may carry, and how one answer's starts
 * become ranges. This is the half that has to talk to a model. Between them
 * they are everything a wave needs except the executor itself — the queue, the
 * retries, the checkpoint and the wiring into `generateHierarchy` are stages 4b
 * and 5. Nothing here makes a call; nothing here is called by
 * `generateHierarchy` yet.
 *
 * docs/plans/260904d-deepen-fat-sections.md § stage 4.
 *
 * ## The three things this file exists to get right
 *
 * 1. **The precedence, written into the prompt.** The spike ran the same
 *    expansion twice on the same 382-block section and got 10 children one time
 *    and 20 the next — because `"headings are HARD boundaries"` and `"aim for
 *    5-9 children"` collide with twenty headings in range and the prompt never
 *    said which wins. That is a precedence bug rather than a product choice,
 *    and the plan settles it: an authored heading always begins a child, and
 *    the fan-out target applies only where the model is inventing the
 *    boundaries itself.
 * 2. **A verdict that cannot go missing.** `ModelVerdict` is a two-member union
 *    rather than a boolean precisely because a boolean that goes missing reads
 *    as `false`, and `false` here means "finished" — *"a missing field silently
 *    reading as finished is the shape of this plan's whole failure mode"*. So
 *    the wire field is a string, it is required, and `parseExpansionAnswer`
 *    **refuses** an answer that omits it rather than defaulting it. The absent
 *    verdict that `decideExpansion` handles is wave 1, where nobody has been
 *    asked; it is not a licence for a scoped answer to leave the field out.
 * 3. **The numbers, before the live pilot rather than after it.** A model that
 *    always says "deeper" turns a bounded cascade into a bill, so how often the
 *    self-assessment says yes has to be a first-class number the first time a
 *    wave runs — not a thing somebody adds once the bill arrives.
 *    `CandidateRecord` and `tallyVerdicts` are that number.
 *
 * ## What is deliberately NOT here
 *
 * - **The checkpoint fingerprint and the resumption.** `expansionRequest`
 *   returns `params`, the exact object a call would hand `streamMessage`, and
 *   that is the value a fingerprint hashes — the same shape `structureRequest`
 *   already offers `canonicalStructureRequest`. Building the digest, the
 *   validity checks on a hit and the store are the other half of stage 4.
 * - **The executor.** No queue, no concurrency, no retry policy, no network.
 *   Every refusal is an `ExpansionRefused` and retryable; how many times is the
 *   executor's decision and the plan gives it a fixed attempt budget.
 */
import { CACHE_FLOOR_TOKENS, estimateTokens } from "./article-prompt.js";
import {
  bodyHeadingsIn,
  bodyWordsIn,
  type CascadeRecipe,
  decideExpansion,
  type ExpansionDecision,
  type ExpansionTarget,
  ExpansionRefused,
  indexBlocks,
  type BlockIndex,
  type ModelVerdict,
  predictedChildren,
  type ProposedChild,
  type RangedNode,
  structuralBlocksIn,
} from "./hierarchy-cascade.js";
/* **Types only from `hierarchy.ts`, values only from `hierarchy-prompt.ts`.**
   This file is imported (through `hierarchy-deepen.ts`) *by* `hierarchy.ts`, so
   a value import from there is a cycle `npm run cycles` refuses; a type import
   is erased and is not. The three values this needs — the stamp, the effort and
   the renderer — were hoisted into the leaf on 2026-09-05 for exactly that
   reason, unchanged. See `hierarchy-prompt.ts`. */
import type { BuildReport, ModelNode } from "./hierarchy.js";
import { PRODUCTION_EFFORT, PROMPT_VERSION, renderBlocks } from "./hierarchy-prompt.js";
import type { MessagesBody } from "./messages-stream.js";
import { type Effort, modelFor } from "./models.js";
import { parseJsonAnswer, MalformedJson } from "./parse-json.js";
import { budgetFor, THINKING_HEADROOM } from "./token-budget.js";
import type { Block } from "./types.js";

/* ------------------------------------------------------------- the prompt */

/**
 * **The handle for a change in what a scoped expansion asks or does with the
 * answer**, and what the checkpoint fingerprint will be keyed on beside the
 * wire request.
 *
 * Separate from `PROMPT_VERSION` (src/hierarchy.ts), which stamps the
 * whole-document call: the two prompts change for different reasons and a
 * shared stamp would throw away one stage's cached answers to say something
 * about the other's. Both go into the fingerprint, because a scoped call is
 * only meaningful against the wave-1 outline the other one produced.
 *
 * **`expand/2`, 2026-09-05**: the prompt began asking for children in document
 * order, which the derivation had always required and the prompt had never said
 * (§ 6 of `EXPAND_SYSTEM` below). A stored `expand/1` answer was written under a
 * question that did not ask for it, so it must read as a miss rather than be
 * resumed onto — which is the whole reason this string is in the key.
 *
 * **`expand/4`, 2026-09-07**: the prompt gained a QUESTIONS block and the
 * per-section mark that says which targets it applies to (§ 7 of `EXPAND_SYSTEM`
 * below), so an `expand/3` answer carries no `question` on any child of any
 * section.
 *
 * **This bump is for honest provenance, not to force a checkpoint miss**, and
 * the distinction is worth stating because the two earlier notes above are the
 * other case. Stage 1's `toc/7` had already carried `EXPANSION_PROMPT_STAMP`
 * from `toc/6+expand/3` to `toc/7+expand/3` before this change was written, so
 * "the stamp moved" was already true and would have been satisfied by doing
 * nothing here ⟨GPT Sol's F5⟩. A stale replay was never the risk either: the
 * expansion checkpoint key hashes the whole wire request, `EXPAND_SYSTEM` and
 * the target briefings included (src/hierarchy-deepen.ts §
 * `canonicalExpansionRequest`), so a changed prompt already misses. What this
 * buys is a record on every candidate of **which semantic protocol wrote it**.
 */
export const EXPAND_PROMPT_VERSION = "expand/4";

/**
 * **Both prompt versions, as one string** — the wave-1 prompt this outline came
 * from, and the scoped one that divided it.
 *
 * A scoped answer is only meaningful against the tree the whole-document call
 * produced, so a change to *either* is a change to the question. Written once
 * here rather than spelled out at each of the two places that need it —
 * `recordCandidate` below, and the checkpoint key in src/hierarchy-deepen.ts —
 * because two hand-built copies of one stamp would drift, and the half that
 * drifted would be the one that decides whether a stored answer is replayed.
 */
export const EXPANSION_PROMPT_STAMP = `${PROMPT_VERSION}+${EXPAND_PROMPT_VERSION}`;

/**
 * **How hard a scoped call thinks, and it is the structure call's value by
 * decision rather than by coincidence.**
 *
 * Read off `PRODUCTION_EFFORT` rather than typed in again: the eval harness
 * typed `"high"` in beside this stage once and drifted for eight days, scoring
 * every paid arm against a recipe the pipeline does not run. The day a scoped
 * call should think harder or less hard than the whole-document one — and it is
 * a genuinely different question, over 1% of the article rather than all of it
 * — this line is where that is said, and it becomes a constant with its own
 * measurement behind it.
 *
 * **It is part of the cache key**, so a wave that varies effort loses its
 * cohort's shared prefix. One value per wave, not one per call.
 */
export const EXPAND_EFFORT: Effort = PRODUCTION_EFFORT;

/**
 * Room reserved for a scoped call's own reasoning.
 *
 * `STRUCTURE_HEADROOM`'s 64,000 was measured on the call that reads *every*
 * block of the longest article we have. A scoped call reads one section, and
 * the three real expansions in the spike spent 1,938, 1,361 and 1,938 output
 * tokens **in total** — thinking and answer together — against inputs of 76,558
 * and 14,889 (evals/results/hierarchy-waves-2026-09-04/). So the general
 * reservation is the honest number here, and raising it would be the mistake
 * docs/postmortems/260826a-toc-max-tokens.md is about: adaptive thinking
 * expands into whatever room it is given.
 *
 * `maxRequestTokensPerBatch` lets a batch carry up to 120,000 tokens of slice,
 * which is larger than anything that has been measured. Stage 5 is where that
 * end of the range gets a number.
 */
export const EXPAND_HEADROOM = THINKING_HEADROOM;

/**
 * What one proposed child costs in the answer: a start, a title, a gist, often
 * a `sourceHeading`, a verdict and a short reason.
 *
 * 175 is what src/hierarchy.ts measured across 32 finished trees for a node
 * carrying a title, a gist, a two-id range and a `sourceHeading`. A child here
 * trades one of those ids for `"verdict"` and a reason of at most twelve words,
 * so 200 is that figure with the same shape of cushion on it. An over-generous
 * ceiling costs nothing — unspent allowance is not billed — and a truncated
 * answer costs the whole call.
 */
const TOKENS_PER_CHILD = 200;

/** The JSON envelope and the per-section wrapper around the children. */
const ENVELOPE_TOKENS = 200;

/**
 * **The scoped prompt.**
 *
 * Grown from `scripts/spike-expand-section.ts`'s draft, which made the three
 * calls the plan's stage 2 rests on. Seven things changed, and each of them is a
 * finding rather than a preference:
 *
 * 1. **The precedence, stated.** *"An authored heading always begins a child,
 *    and no child may contain more than one authored heading. Aim for 5-9
 *    children only where you are inventing the boundaries yourself; if the
 *    headings give you more, return more."* The wording is the plan's, adopted
 *    verbatim. It buys run B's shape deterministically, and what it trades away
 *    is an even stride at that level — the argument for paying that is that the
 *    invented grouping is content-free: *"Quarter-Deck, Sunset, Dusk"* is a
 *    list of its children's names, which is the tell that the model had nothing
 *    to say about the group.
 * 2. **A verdict, not a boolean.** `"needsDeeper": true|false` became
 *    `"verdict": "needs-deeper"|"finished"`, required, with the prompt saying
 *    out loud that an answer omitting it is discarded. See § 2 of the file
 *    header.
 * 3. **Several sections in one call.** `planExpansionBatches` packs up to four
 *    parents into a request — that packing is what makes the cascade
 *    affordable — so the answer is keyed by the ordinal the request gave each
 *    section, and the model is told that a child of one section may never start
 *    inside another.
 * 4. **Withheld blocks are described.** The spike rendered every block's text;
 *    the real builder uses `renderBlocks`, which withholds a supplement's prose
 *    and prints `NOT-GISTABLE: (withheld)`. A marker the prompt never explains
 *    is a marker the model gets to interpret.
 * 5. **`sourceHeading` is omitted rather than empty.** Run B returned
 *    `"sourceHeading": ""` on children the author gave no heading, and
 *    `buildTree` counts an unbackable claim — the empty string included, on
 *    purpose — into `droppedHeadings`. Saying "omit it" keeps that figure
 *    measuring what it is for.
 * 6. **Document order, asked for.** `normaliseExpansion` reads array order *as*
 *    document order — a start that is not strictly after the previous kept one
 *    marks no split point and is dropped — and nothing here said so. Five
 *    scoped, in-parent, otherwise-valid children listed 0, 8, 4, 12, 16 lose a
 *    real section of the article, and the tree over it is valid. The rule was
 *    always enforced; this is the sentence that asks for it, and it took the
 *    stamp to `expand/2` so no `expand/1` answer is resumed onto.
 *    ⟨GPT Sol's review of stage 4, F3, 2026-09-05.⟩
 *
 * 7. **A question, on the children of the whole work and on nothing else.**
 *    `EXPAND_SYSTEM` had no such field, so a part built by the cascade drew a
 *    bare gist beside a neighbour's question once `SummaryPanel` began drawing
 *    `question ?? gist` — GPT Sol's P1-5, recorded on 2026-09-05 and fixed here.
 *    The content rules are **V4's**, copied from the QUESTIONS block in
 *    src/hierarchy.ts § `SYSTEM` and put into this prompt's voice, because two
 *    paths writing two kinds of line is the same failure as two contracts for a
 *    tree. **Which targets are asked is marked per section, not stated once**:
 *    a batch carries up to four parents at different depths, so a global
 *    instruction is wrong for some of them and the model has nothing to infer a
 *    depth from. `renderTargetBriefing` supplies each mark; this explains it.
 *    ⟨GPT Sol's F4.⟩
 *
 * It is otherwise deliberately close to `SYSTEM` in src/hierarchy.ts: the same
 * boundary rules, the same title and gist contract, the same refusal to invent
 * ids. Two levels of the same tree written to two different contracts is how a
 * tree comes to read as though two people made it.
 */
export const EXPAND_SYSTEM = `You are extending a nested table of contents for a longer work. You are given
one or more of its sections. Each section's boundaries and title are already
fixed; your job is to divide each one into its immediate children — one level,
no deeper.

You are shown the whole work's top-level outline for context, then one entry per
section: the chain of titles above it, and its own blocks as a numbered list.
Each block has an id (e.g. spya-k3m9qt), a tag, and its text. Some are marked
NOT-GISTABLE, and a few of those are withheld and show no text at all — use
their ids where a boundary needs them, and say nothing about prose you cannot
see. Block numbers restart at 0 in each section and are only a reading aid; the
ids are what you answer with.

BOUNDARIES

- Give each child the id of the block it STARTS at. Do not give an end — ends
  are computed from the next child's start, and the last child ends where its
  section ends.
- The first child of a section must start at that section's first block.
- List children in document order. After the first child, each "start" must
  occur strictly later in the section than the previous child's start.
- Use only ids listed under the section you are dividing. A child of one section
  may never start inside another.
- An authored heading always begins a child, and no child may contain more than
  one authored heading. Aim for 5-9 children only where you are inventing the
  boundaries yourself; if the headings give you more, return more.
- Where a run between headings is longer than ~9 blocks, propose your own
  boundaries inside it at genuine topic shifts, and title those nodes.
- Do NOT go deeper than one level. Do not emit grandchildren.

TITLES AND GISTS

- title: 2-6 words, a landmark scanned at a glance. No trailing punctuation.
- Where the author gave the child a heading, use that heading's text UNCHANGED
  and repeat it in "sourceHeading". Rewrite it ONLY if it shares no content word
  with the body, or is a stock label ("Introduction", "Background"). Rewriting
  should be rare. Omit "sourceHeading" entirely where the author gave the child
  no heading — do not send an empty one.
- gist: exactly ONE sentence, on every child. It is a CLAIM or a MOVE, not a
  topic label. Keep the work's own words for the things it names and ordinary
  words for everything else; where a shorter, commoner word loses nothing, use
  it.
- These are the FINE rungs, and a fine gist is longer than a coarse one, not
  shorter: AT LEAST 22 words, and at most 32. The floor is the half that will
  feel wrong, so obey it: down here a one-clause gist is too SHORT, not
  admirably terse. A reader at this zoom is reading your sentence INSTEAD of the
  paragraphs it covers, so give them the claim AND the ground it stands on — its
  reason, contrast, consequence or example. The floor does not apply where the
  RANGE itself is slight: a title, a credit line, a URL, a heading with nothing
  under it. Never pad, never invent support, and never move a boundary to reach
  a word count. One sentence still.
- No narration of document order: not "this section explores", "the author then
  turns to", "goes on to". Say what the child CLAIMS; do not narrate that it is
  claiming. Ordinary "then" and "next" inside a claim are fine.
- Your titles must distinguish these children from EACH OTHER and from the
  sibling sections in the outline above. Four children that all mean
  "Background" is the failure to avoid.

QUESTIONS

Each section below is marked ASK QUESTION ON CHILDREN or OMIT QUESTION. The
mark depends on where that section sits in the whole work, which you cannot tell
from its blocks, so obey each section's own mark and never carry one across to
another section in the same answer.

- Under OMIT QUESTION: send no "question" on any child of that section.
- Under ASK QUESTION ON CHILDREN: exactly ONE question on every child of that
  section.
- It is the question that child is BUILT to answer — the author's question, not
  a reader's. A reader must be able to tell from this line alone whether to go
  in: it carries the same direction as the gist, in a different mood.
- Shape: "<topic> — <question>? (<shape hint>)" — the topic first, in the
  author's own term; then the question, ending in "?"; then an optional hint in
  brackets. Nothing follows the hint.
- The question presupposes where the child lands. "Why isn't computation
  sufficient" carries the claim; "is computation sufficient?" hides it. So
  "why", "how", "what follows if" — never "which", "who", or anything a single
  fact settles.
- Where the child does NOT land — it weighs, describes, or leaves the matter
  open — do not invent a landing. Ask the question it leaves open and let the
  hint say so: "(two options weighed)", "(no settled answer)".
- The hint is the SHAPE of the answer, never its content: a count or a kind
  ("a thought experiment", "two case studies", "a recommendation"). A count
  only when the child itself counts ("four arguments") or you could list each
  item from its text. Never count anything below this child — that is a
  different number. Omit the hint when there is no honest shape.
- Not rhetorical, not yes/no, never the gist with a question mark on it.
- Under 20 words in all. Digits for counts. The work's own words for what it
  names, ordinary words for the rest, exactly as with gists.

THE VERDICT

For each child, say whether it is finished or still wants a level of its own.

- "verdict": exactly "needs-deeper" or "finished". Required on every child.
  There is no default, and an answer that omits it on any child is discarded
  whole.
- "needs-deeper" only when the child holds several distinct movements a reader
  would want to navigate between — not merely because it is long. A child that
  is one sustained argument is finished however many paragraphs it runs to.
- "why": at most 12 words, the reason.

Most children of most sections are finished. A section where every child needs
deepening is a section you have not really divided.

OUTPUT

JSON only, no prose, no code fence. One entry per section you were given, in the
order you were given them, each naming its own number:

{"sections": [{"section": 1, "children": [
  {"start": "<blockId>", "title": "...", "gist": "...", "question": "...",
   "sourceHeading": "...", "verdict": "finished", "why": "..."}]}]}

"question" only under ASK QUESTION ON CHILDREN; omit the key entirely otherwise.

Use only block ids that appear in that section's blocks. Do not invent ids.`;

/* ------------------------------------------------------------ the request */

/** A title and its one-sentence gist: an outline row, or a rung of a chain. */
export interface OutlineEntry {
  title: string;
  gist?: string | undefined;
}

/**
 * **One parent as the request shows it**: the cascade's target, and the titles
 * above it.
 *
 * The chain is what stops the failure 260826h names — *"never blind subtree
 * calls with independently invented sibling roots, that is where four sections
 * all end up meaning 'Background'"* — and `ExpansionTarget` deliberately does
 * not carry it: the cascade's arithmetic has no use for an ancestor's prose,
 * and a field only the request builder reads belongs to the request builder.
 */
export interface TargetBriefing {
  target: ExpansionTarget;
  /**
   * The article's root first, the target's own parent last. The target itself
   * is **not** in it — the renderer adds it, so a caller cannot leave it out or
   * put it in twice.
   */
  ancestors: readonly OutlineEntry[];
}

/**
 * **The frozen global outline**, rendered once per article and shown to every
 * scoped call in every wave.
 *
 * Frozen is the operative word: it is wave 1's answer, and it must not be
 * re-derived from the cascade's current state as later waves deepen it. A
 * prefix that changes at every barrier is a prefix that never pays for itself,
 * and — worse — two calls in the same wave would then be reasoning about two
 * different maps of the same article.
 *
 * Depth 1 only. The spike showed the top level and its titles came back
 * distinguishable from their siblings, which is the whole job of the outline;
 * showing every section of a book would put the thing the cascade is trying to
 * avoid sending back into every request.
 */
export function renderFrozenOutline(root: ModelNode): string {
  return (root.children ?? [])
    .map((child, i) => `${i + 1}. ${child.title}${child.gist ? ` — ${child.gist}` : ""}`)
    .join("\n");
}

/** One rung of the chain above a section, as the request prints it. */
function chainRung(entry: OutlineEntry): string {
  return `${entry.title}${entry.gist ? ` — ${entry.gist}` : ""}`;
}

/**
 * **Whether this target's children are the ones a question is asked on** —
 * `ASK QUESTION ON CHILDREN` against `OMIT QUESTION`, per target and never per
 * call.
 *
 * A target with no ancestors *is* the whole work, so its children are the
 * depth-1 parts — the only ones `questionFor` (src/hierarchy.ts) keeps a
 * question on. One call batches up to four parents and they need not be at the
 * same depth, so a single instruction for the call would be wrong for some of
 * them, and the model has nothing in the request to infer a depth from: the
 * chain above a target is prose, not a number. ⟨GPT Sol's F4.⟩
 *
 * **It decides what is asked for, and nothing about what is kept.** Whether a
 * returned question survives is `questionFor`'s, applied by `buildTree` at the
 * node's real depth in the finished tree — a second depth rule here could
 * disagree with the one that ships, and the disagreement would be invisible.
 * What this predicate is additionally good for is the honest reading of an
 * absent question: only a section that was *asked* can have failed to answer
 * (src/hierarchy-deepen.ts § `DeepenStats.missingQuestions`).
 */
export function asksChildQuestions(ancestors: readonly OutlineEntry[]): boolean {
  return ancestors.length === 0;
}

/**
 * The per-target half of the request: which section this is, what sits above
 * it, and its blocks.
 *
 * `ordinal` is 1-based and is the only handle the answer has on this target —
 * `ExpansionTarget.node.range` is fixed and an answer may not redefine it, so
 * there is nothing else for the two to agree on. The same ordinal goes into the
 * checkpoint fingerprint, which is why it is derived from the batch's own order
 * rather than from anything the model says.
 */
function renderTargetBriefing(
  briefing: TargetBriefing,
  ordinal: number,
  count: number,
  blocks: readonly Block[],
  index: BlockIndex,
): string {
  const { node } = briefing.target;
  const from = index.get(node.range[0]);
  const to = index.get(node.range[1]);
  if (from === undefined || to === undefined || to < from) {
    /* The ids came out of a built tree, so this cannot happen on the ordinary
       path — and it would otherwise send an empty slice and ask the model to
       divide nothing, which is a valid-looking request and a wasted call. */
    throw new Error(
      `The parent at ${briefing.target.where} does not resolve to a range in blocks.json, so ` +
        `there is nothing to show a call about it.`,
    );
  }
  const own: OutlineEntry = {
    title: node.title,
    ...(node.gist !== undefined ? { gist: node.gist } : {}),
  };
  const chain = [...briefing.ancestors, own].map(chainRung).join("\n  ↳ ");
  /* **Above the chain, not inside it.** The mark is an instruction about this
     section and the chain is the article's own prose; a line of ours in the
     middle of a list of the author's titles reads as another rung. */
  const questions = asksChildQuestions(briefing.ancestors)
    ? "ASK QUESTION ON CHILDREN"
    : "OMIT QUESTION";
  return (
    `SECTION ${ordinal} OF ${count}\n\n` +
    `${questions}\n\n` +
    `THE CHAIN ABOVE IT\n\n  ${chain}\n\n` +
    `ITS BLOCKS\n\n${renderBlocks(blocks.slice(from, to + 1))}`
  );
}

/**
 * **One scoped expansion call, assembled.**
 *
 * `system`, `shared` and `own` are the three parts in cache order, and the
 * order is the point: a cache breakpoint is a **position**, so everything from
 * the top of the request through the marked part is the prefix. Rules
 * (`system`), then the frozen outline (`shared`, marked), then the per-call
 * targets and their slices (`own`). Put a target's title above the outline and
 * the prefix is different in every batch of the wave, which costs the write
 * premium on every call and reads back nothing.
 */
export interface ExpansionRequest {
  system: string;
  /** The cacheable part of the user message: the frozen outline, and only that. */
  shared: string;
  /** This call's own half: its targets, their chains and their blocks. */
  own: string;
  maxTokens: number;
  effort: Effort;
  /**
   * **Would the model actually cache the prefix?** — reported rather than
   * assumed, and named for what it is.
   *
   * Sonnet 5 will not cache a prefix under 1,024 tokens; below that a
   * `cache_control` marker is accepted and does nothing, with zeros in both
   * usage fields. src/labels.ts spent months writing a marker that bought
   * nothing for exactly this reason. The plan's estimate for this prefix was
   * 1,150–1,400, near enough the floor to fall either side; since `expand/4`
   * added the QUESTIONS block, `EXPAND_SYSTEM` is 1,631 estimated tokens and
   * clears the floor on its own, so this is `true` for every outline including
   * none at all. It is still reported rather than assumed, because that margin
   * is one prompt edit wide. A zero in `cache_read_input_tokens` is also what
   * a run of one fresh call reports, so the flag is what separates *"there was
   * nothing to read"* from *"there was, and it did not"*.
   *
   * An estimate at four characters a token, like every other caller of
   * `estimateTokens`. docs/project/prompt-caching.md § The floor.
   */
  estimatedCacheable: boolean;
  /**
   * **The exact object a call hands `streamMessage`** — not a description of
   * it.
   *
   * This is the value a checkpoint fingerprint hashes, the way
   * `canonicalStructureRequest` hashes `structureRequest().params`: run it
   * through `messagesWireBody("hierarchy", params)` and the digest covers the
   * model, the routing, `max_tokens`, the effort, both prompts, the frozen
   * outline, every ancestor chain and every block of every slice — because all
   * of that is inside these bytes. Stage 4b builds the digest; this is the
   * value it needs and the reason there is no second assembly to drift.
   */
  params: MessagesBody;
}

/**
 * How many children this parent may actually come back with — the number the
 * answer's budget has to survive, which is **not** `predictedChildren`.
 *
 * `predictedChildren` clamps at nine because that is the fan-out the prompt
 * asks for, and under the settled precedence the headings overrule the fan-out:
 * a twenty-heading parent answers with twenty children and is right to. So the
 * budget takes the larger of the two, and a section with no authored heading in
 * it is sized exactly as before.
 *
 * **`planExpansionBatches` still packs by `predictedChildren`**, and that is a
 * known under-count rather than an oversight — its child cap is a soft
 * preference about how big a question to ask, and being wrong about it moves a
 * batch boundary. `max_tokens` is not a preference: being wrong about it
 * truncates a paid call. The two are separated here so that whoever tunes the
 * packing later is deciding it rather than inheriting it.
 * ⟨docs/plans/260904d-deepen-fat-sections.md, stage 4, 2026-09-05.⟩
 */
export function expectedChildren(
  node: RangedNode,
  blocks: readonly Block[],
  recipe: CascadeRecipe,
  index: BlockIndex = indexBlocks(blocks),
): number {
  return Math.max(
    predictedChildren(node, blocks, recipe, index),
    bodyHeadingsIn(node, blocks, index),
  );
}

/** Is the shared prefix long enough for the model to take it? See `estimatedCacheable`. */
export function expansionPrefixIsCacheable(outline: string): boolean {
  return estimateTokens(EXPAND_SYSTEM + outline) >= CACHE_FLOOR_TOKENS;
}

/**
 * **Build the request for one batch.**
 *
 * Takes the briefings rather than the `ExpansionBatch` itself, because
 * everything the request needs is in them and the batch's other fields —
 * `predictedChildren`, the token estimates, the span — are the planner's
 * accounting rather than anything that reaches the wire. The briefings must be
 * the batch's targets, in the batch's order: the ordinals the model answers
 * with are their positions in this list.
 */
export function expansionRequest(opts: {
  briefings: readonly TargetBriefing[];
  blocks: readonly Block[];
  /** `renderFrozenOutline` of wave 1's root. The same string for every call of the run. */
  outline: string;
  recipe: CascadeRecipe;
  index?: BlockIndex;
}): ExpansionRequest {
  const { briefings, blocks, outline, recipe } = opts;
  if (briefings.length === 0) {
    throw new Error("An expansion request needs at least one target; this one carried none.");
  }
  const index = opts.index ?? indexBlocks(blocks);
  const effort = EXPAND_EFFORT;

  const shared = `THE WHOLE WORK'S TOP-LEVEL OUTLINE\n\n${outline}`;
  const own = briefings
    .map((briefing, i) => renderTargetBriefing(briefing, i + 1, briefings.length, blocks, index))
    .join("\n\n");

  const children = briefings.reduce(
    (total, b) => total + expectedChildren(b.target.node, blocks, recipe, index),
    0,
  );
  const maxTokens = budgetFor(
    "section expansion",
    ENVELOPE_TOKENS + children * TOKENS_PER_CHILD,
    EXPAND_HEADROOM,
  );

  return {
    system: EXPAND_SYSTEM,
    shared,
    own,
    maxTokens,
    effort,
    estimatedCacheable: expansionPrefixIsCacheable(shared),
    params: {
      max_tokens: maxTokens,
      thinking: { type: "adaptive" },
      output_config: { effort },
      system: EXPAND_SYSTEM,
      /* Two parts, breakpoint on the first — src/labels.ts sends the identical
         shape for the identical reason. Everything from the top of the request
         through that part is the prefix, and it is the same bytes for every
         call in the wave. */
      messages: [
        {
          role: "user",
          content: [
            { type: "text" as const, text: shared, cache_control: { type: "ephemeral" as const } },
            { type: "text" as const, text: own },
          ],
        },
      ],
    },
  };
}

/**
 * **What a wave's requests cost beyond their targets' evidence**, measured off
 * the real strings and handed to `planExpansionBatches`.
 *
 * `UNMEASURED_OVERHEAD`'s zeros are the honest reading of *"the builder has not
 * told us"* and make the feasibility bound degenerate to the evidence total —
 * fine for a test about packing, and not fine in a wave, whose hard cap would
 * then be measuring the wrong thing.
 *
 * `perTargetTokens` is one number for a wave where the targets differ, so it is
 * the **largest** of them: an estimate that errs high closes batches slightly
 * early, which is the harmless direction, and it is the direction
 * `estimateEvidenceTokens` already errs in.
 *
 * **One discrepancy, stated rather than left to be found.**
 * `estimateEvidenceTokens` counts one block of the article either side of each
 * target, copying `CONTEXT_BLOCKS` from src/labels.ts, and
 * `renderTargetBriefing` sends **no** context blocks: a scoped call that can
 * see a block outside its parent is a scoped call that can start a child on
 * one, which `normaliseExpansion` refuses outright. So the evidence estimate
 * runs two blocks per target high. Harmless in the same direction as
 * everything else here, and worth a number rather than a shrug.
 */
export function expansionOverhead(opts: {
  briefings: readonly TargetBriefing[];
  blocks: readonly Block[];
  outline: string;
  index?: BlockIndex;
}): { prefixTokens: number; perTargetTokens: number } {
  const { briefings, blocks, outline } = opts;
  const index = opts.index ?? indexBlocks(blocks);
  const prefixTokens = estimateTokens(
    `${EXPAND_SYSTEM}\n\nTHE WHOLE WORK'S TOP-LEVEL OUTLINE\n\n${outline}`,
  );
  /* The briefing with its evidence taken back out: what remains is the header,
     the ordinal and the chain, which is exactly what this number is for. */
  const perTargetTokens = briefings.reduce((worst, briefing, i) => {
    const whole = renderTargetBriefing(briefing, i + 1, briefings.length, blocks, index);
    const evidence = whole.indexOf("\nITS BLOCKS\n");
    return Math.max(worst, estimateTokens(evidence === -1 ? whole : whole.slice(0, evidence)));
  }, 0);
  return { prefixTokens, perTargetTokens };
}

/* -------------------------------------------------------------- the parse */

/**
 * One child exactly as the wire carries it: `ProposedChild` plus the verdict
 * this stage exists to collect.
 *
 * It **extends** `ProposedChild` rather than restating it, so the parsed value
 * feeds `normaliseExpansion` unchanged and the two files cannot come to hold
 * two ideas of what a proposed child is.
 */
export interface ExpansionAnswerChild extends ProposedChild {
  verdict: ModelVerdict;
  /** The model's reason, at most a dozen words. Telemetry: nothing reads it to decide. */
  why?: string;
}
/* `question` is on `ProposedChild` itself (src/hierarchy-cascade.ts), beside
   `gist` and `sourceHeading`, so `normaliseExpansion` carries it onto the node
   with the other two rather than this file holding a field the derivation has
   never heard of. */

/**
 * **What a refused answer looked like**, kept so that a refusal can be read
 * afterwards instead of guessed at.
 *
 * A refused answer is never checkpointed — a stored refusal would be replayed
 * for ever — and until 2026-09-05 it was not kept anywhere else either. So when
 * the first paid run of stage 5b lost a wave to a target the model declined
 * three times, nobody could tell **whether the model had declined on the merits
 * or fumbled the schema**, which was the only question worth asking about it.
 *
 * ## What is in here, and where it may go
 *
 * The child count and the verdicts are shape. `why` is the model's own dozen
 * words *about the article*, so this whole structure belongs in the deepening
 * **records file** and never in a log line — docs/project/logging.md, and the
 * same rule `describeShape` above keeps for error messages. The type carries no
 * `title` or `gist` for that reason: they are the article's prose restated, and
 * the shape of a refusal does not need them.
 */
export interface RefusedAnswerShape {
  /** How many sections it carried, or `null` if it was not readable as an answer at all. */
  sections: number | null;
  perSection: {
    /** The ordinal the answer claimed, or `null` where it gave none that made sense. */
    section: number | null;
    children: number;
    /** One per child, `null` where the child gave none or gave nonsense. */
    verdicts: (string | null)[];
    /** The model's own reason per child, `null` where absent. Article-adjacent text. */
    why: (string | null)[];
  }[];
}

/**
 * **Read whatever can be read out of an answer that was refused**, without
 * refusing again.
 *
 * Deliberately the opposite of `parseExpansionAnswer`, which throws on the first
 * thing that is wrong — the point here is that something has *already* gone
 * wrong and the shape is the evidence. So every field is optional, every
 * malformed value becomes a `null` rather than an error, and the whole thing
 * comes back `sections: null` if the text is not even JSON.
 *
 * Pure, and it never throws.
 */
export function readRefusedShape(raw: string): RefusedAnswerShape {
  const nothing: RefusedAnswerShape = { sections: null, perSection: [] };
  let answer: unknown;
  try {
    answer = parseJsonAnswer<unknown>(raw, "the refused expansion");
  } catch {
    return nothing;
  }
  if (typeof answer !== "object" || answer === null || Array.isArray(answer)) return nothing;
  const sections = (answer as { sections?: unknown }).sections;
  if (!Array.isArray(sections)) return nothing;
  return {
    sections: sections.length,
    perSection: sections.map((entry) => {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
        return { section: null, children: 0, verdicts: [], why: [] };
      }
      const { section, children } = entry as { section?: unknown; children?: unknown };
      const list = Array.isArray(children) ? children : [];
      const field = (child: unknown, key: "verdict" | "why"): string | null => {
        if (typeof child !== "object" || child === null) return null;
        const value = (child as Record<string, unknown>)[key];
        return typeof value === "string" ? value : null;
      };
      return {
        section: typeof section === "number" && Number.isInteger(section) ? section : null,
        children: list.length,
        verdicts: list.map((c) => field(c, "verdict")),
        why: list.map((c) => field(c, "why")),
      };
    }),
  };
}

/** One parent's complete child set, paired with the ordinal it was asked under. */
export interface ExpansionAnswerSection {
  /** 1-based, and equal to this entry's position in the returned array. */
  section: number;
  children: ExpansionAnswerChild[];
}

/** The two spellings the wire accepts, and nothing else. */
const VERDICTS: readonly string[] = ["needs-deeper", "finished"];

/** An answer that never reached the derivation planned nothing. */
function nothingPlanned(): BuildReport {
  return { repairs: [], droppedChildren: [], droppedHeadings: [], collapsedRungs: [], droppedQuestions: [] };
}

/**
 * What something is, never what it says — src/labels.ts § `describeShape`, and
 * src/parse-json.ts for the longer version of the argument. Every value that
 * reaches this function came out of a model that was reading the article, so a
 * message may carry a shape and never a content.
 */
function describeShape(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `an array of ${value.length}`;
  if (typeof value === "string") return `a ${value.length}-character string`;
  if (typeof value === "object") return `an object with ${Object.keys(value).length} key(s)`;
  return `a ${typeof value}`;
}

function refuse(
  reason: ConstructorParameters<typeof ExpansionRefused>[0],
  message: string,
): ExpansionRefused {
  return new ExpansionRefused(reason, message, nothingPlanned());
}

/**
 * **Read one scoped answer strictly, and refuse it rather than mend it.**
 *
 * ## Where this sits, and why it is not `normaliseExpansion`
 *
 * This asks about the answer's **shape**; `normaliseExpansion` asks about its
 * **ranges**. Keeping them apart is what lets a refusal here carry an empty
 * `planned` honestly — nothing was planned, because nothing was derived — while
 * a refusal there carries the drops and repairs that provoked it, which is what
 * whoever reads the retry wants to know. It is also what lets this function be
 * tested against a recorded model answer with no `blocks.json` in the room: a
 * shape is checkable without the article, and a range is not.
 *
 * So the order is: parse, then normalise per target, then decide. Not one pass.
 *
 * ## What it refuses
 *
 * - **Not JSON at all**, including a truncated answer — wrapped as
 *   `malformed-answer` rather than left as `MalformedJson`, because the retry
 *   policy is written once against `ExpansionRefused` and a cut-off answer is
 *   the single most retryable fault on this path. `MalformedJson`'s own message
 *   is content-free by construction (src/parse-json.ts § `diagnose`), so it is
 *   safe to carry.
 * - **A shape that is not `{sections: [{section, children: [...]}]}`**, a child
 *   that is not an object, and a child with no `start`, no `title` or no
 *   `gist` — `malformed-answer`. The gist is required here rather than left to
 *   `checkTree`, and the reason is timing rather than duplication: see the
 *   comment on the loop that enforces it.
 * - **A missing verdict** — `missing-verdict`, its own reason so the retry
 *   telemetry can count the one fault this plan is most afraid of separately
 *   from every other malformed answer.
 * - **A verdict that is present and wrong** — `bad-verdict`: a boolean left
 *   over from the spike's format, a `"deeper"`, a `null`.
 * - **An answer that does not cover its request exactly** — `target-mismatch`:
 *   a section left out, one answered twice, or an ordinal nobody asked about.
 *   A half-answer builds a perfectly valid tree with a wave of the article
 *   silently unasked, which is the shape this whole file is written against.
 *
 * **It does not look at whether a `start` is a real block id**, and that is the
 * same division: `normaliseExpansion` resolves every start against the article
 * and refuses an `invented-start`, which is strictly stronger than any check on
 * the string's shape, and it can only be made where the blocks are. A weaker
 * copy here would be a second opinion that could disagree with the one that
 * ships.
 *
 * @param expected how many targets the request carried. The returned array has
 * exactly that many entries, in request order, so a caller may zip it against
 * `batch.targets` by position.
 */
export function parseExpansionAnswer(raw: string, expected: number): ExpansionAnswerSection[] {
  if (expected < 1) throw new Error(`An expansion answer cannot be read against ${expected} targets.`);

  let answer: unknown;
  try {
    answer = parseJsonAnswer<unknown>(raw, "the expansion");
  } catch (err) {
    if (!(err instanceof MalformedJson)) throw err;
    throw refuse("malformed-answer", err.message);
  }

  if (typeof answer !== "object" || answer === null || Array.isArray(answer)) {
    throw refuse("malformed-answer", `The expansion answer is ${describeShape(answer)}, not an object.`);
  }
  const sections = (answer as { sections?: unknown }).sections;
  if (!Array.isArray(sections)) {
    throw refuse(
      "malformed-answer",
      `The expansion answer's "sections" is ${describeShape(sections)}, not an array.`,
    );
  }

  const byOrdinal = new Map<number, ExpansionAnswerSection>();
  for (const [i, entry] of sections.entries()) {
    const at = `answer entry ${i + 1}`;
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw refuse("malformed-answer", `${at} is ${describeShape(entry)}, not an object.`);
    }
    const { section, children } = entry as { section?: unknown; children?: unknown };
    if (typeof section !== "number" || !Number.isInteger(section)) {
      throw refuse(
        "malformed-answer",
        `${at} has a "section" of ${describeShape(section)}; it must be the whole number the ` +
          `request gave that section.`,
      );
    }
    if (section < 1 || section > expected) {
      throw refuse(
        "target-mismatch",
        `${at} answers about section ${section}, and this call carried ${expected}. An answer ` +
          `about a section nobody asked about is an answer about a different request.`,
      );
    }
    if (byOrdinal.has(section)) {
      throw refuse(
        "target-mismatch",
        `Section ${section} is answered twice. A parent's complete child set is indivisible, so ` +
          `two child sets for one parent are two answers that could not see each other.`,
      );
    }
    if (!Array.isArray(children)) {
      throw refuse(
        "malformed-answer",
        `Section ${section} has a "children" of ${describeShape(children)}, not an array.`,
      );
    }
    byOrdinal.set(section, {
      section,
      children: children.map((child, k) => readChild(child, `section ${section} > child ${k + 1}`)),
    });
  }

  const missing = Array.from({ length: expected }, (_, i) => i + 1).filter((n) => !byOrdinal.has(n));
  if (missing.length > 0) {
    throw refuse(
      "target-mismatch",
      `This call carried ${expected} section(s) and the answer covers ${byOrdinal.size}: nothing ` +
        `came back for section(s) ${missing.join(", ")}. A parent left out of the answer is a ` +
        `stretch of the article that would be built as though it had never been asked about.`,
    );
  }
  return Array.from({ length: expected }, (_, i) => byOrdinal.get(i + 1)!);
}

/** One child, checked field by field. `where` is an ordinal path, safe to log. */
function readChild(value: unknown, where: string): ExpansionAnswerChild {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw refuse("malformed-answer", `${where} is ${describeShape(value)}, not an object.`);
  }
  const child = value as Record<string, unknown>;

  /* **`gist` is required, and it took reading `checkTree` to be sure of it.**
     An earlier draft of this function let it through on the argument that a
     missing gist is caught downstream and refusing a whole batch for one absent
     sentence throws away every boundary in it. Both halves are true and the
     conclusion was wrong, because of *when* it is caught: every child a scoped
     call proposes becomes an **internal body node** — `buildTree` grows its
     leaves under it, and a deepening pass never sees a supplement, which is the
     one exemption the rule makes — so `src/tree-invariants.ts` § "internal node
     has no gist" fails the whole article at `assertTreeSound`, after the entire
     cascade has been paid for. Re-asking one batch costs a few cents; finding
     out at the end costs the run.

     **Blank counts as missing, and blank means `trim`.** This tested `.length`
     and justified itself by saying `buildTree` applies its own truthiness a
     moment later — which is true of `""` and false of `"   "`, because a string
     of spaces is truthy. So a gist of three spaces went through the whole
     derivation as a real gist and rendered as a blank internal node the reader
     can navigate to, and a title of spaces as a blank row in the spine: exactly
     the outcome the required-gist argument above is written to prevent,
     arriving through the gate meant to stop it. A `start` of whitespace resolves
     to no block and would be refused a step later as an `invented-start`, which
     is a true statement about a different fault; it is checked here so that all
     three read as what they are.

     Only the *test* trims. The value is carried through as the model sent it,
     because this function is not the place a field quietly changes — the same
     rule `normaliseExpansion` follows about presence over truthiness. */
  for (const field of ["start", "title", "gist"] as const) {
    if (typeof child[field] !== "string" || (child[field] as string).trim().length === 0) {
      throw refuse(
        "malformed-answer",
        `${where} has a "${field}" of ${describeShape(child[field])}; every child needs a ` +
          `${field} with something in it.`,
      );
    }
  }

  /* **Presence first, value second, and they are different refusals.** An
     absent verdict is the failure mode this plan is named after — a field that
     goes missing and reads as "finished" — and a present-but-wrong one is an
     ordinary malformed answer. Counting them together would hide the first
     inside the second exactly when it started happening. */
  if (!("verdict" in child) || child.verdict === undefined) {
    throw refuse(
      "missing-verdict",
      `${where} has no "verdict". It is required on every child: there is no default, because a ` +
        `missing verdict read as "finished" is a section that quietly stops being asked about.`,
    );
  }
  const verdict = child.verdict;
  if (typeof verdict !== "string" || !VERDICTS.includes(verdict)) {
    throw refuse(
      "bad-verdict",
      `${where} has a "verdict" of ${describeShape(verdict)}; it must be exactly ` +
        `"needs-deeper" or "finished".`,
    );
  }

  /* Optional, and checked for type rather than for presence. `sourceHeading` is
     carried through to `normaliseExpansion` by presence and not by truthiness,
     and it is **not** trimmed the way the required three above are: an empty or
     blank string the model *sent* is a claim it made, and `buildTree` counts an
     unbackable `sourceHeading` into `droppedHeadings` on purpose — "a number, or
     a string of spaces, is a claim this stage threw away too". `gist` is in this
     loop only for the type check; it is required and non-blank above.
     (`why` is telemetry and nothing reads it structurally.)

     **`question` is optional here whatever the section was marked**, and that is
     deliberate rather than lax. A section marked ASK QUESTION ON CHILDREN whose
     answer carries none is a *logged omission*, not a refusal: refusing the
     batch would throw away every boundary in it over a second line, and
     re-asking would be a second model call to fill a gap left by the first. The
     count is `DeepenStats.missingQuestions`; the rule is stage 2 of
     docs/plans/260907d-ship-socratic-v4-repair-the-eval-gate-and-answer-q7.md.
     Nothing here judges the string either — `questionFor` (src/hierarchy.ts)
     owns depth, shape and the gist-re-asked check, and a second opinion in this
     file would take a drop out of `droppedQuestions` where nobody could see it. */
  for (const field of ["gist", "sourceHeading", "why", "question"] as const) {
    if (field in child && child[field] !== undefined && typeof child[field] !== "string") {
      throw refuse(
        "malformed-answer",
        `${where} has a "${field}" of ${describeShape(child[field])}; it must be a string where ` +
          `it is present at all.`,
      );
    }
  }

  return {
    start: child.start as string,
    title: child.title as string,
    verdict: verdict as ModelVerdict,
    ...(typeof child.gist === "string" ? { gist: child.gist } : {}),
    ...(typeof child.question === "string" ? { question: child.question } : {}),
    ...(typeof child.sourceHeading === "string"
      ? { sourceHeading: child.sourceHeading }
      : {}),
    ...(typeof child.why === "string" ? { why: child.why } : {}),
  };
}

/* ---------------------------------------------------- the instrumentation */

/**
 * **Which mechanical bound overruled the model**, where one did.
 *
 * The four are `decideExpansion`'s bounds 1–4 by their own names. `"verdict"`
 * is not among them: a decision the verdict carried overrode nothing.
 */
export type OverridingBound =
  | "authored-heading"
  | "depth-cap"
  | "divisibility-floor"
  | "forced-open";

/**
 * Did a bound overrule what the model said about this node?
 *
 * Only where there **was** something to overrule: a node nobody has asked yet —
 * every node of wave 1 — overrides nothing, and counting it would make the
 * bounds read high on exactly the wave where no verdict exists. That is the
 * same correction `decideExpansion` made when it split `"unassessed-ceiling"`
 * out of `"forced-open"`, and this reads its answer rather than restating the
 * rule: `"unassessed-ceiling"` and `"no-verdict"` are the two `because`s that
 * say nobody was asked, and neither can be an override.
 */
export function overrodeVerdict(
  raw: ModelVerdict | null,
  decision: ExpansionDecision,
): OverridingBound | null {
  if (raw === null) return null;
  if (decision.decision === "expand") {
    if (raw === "needs-deeper") return null;
    switch (decision.because) {
      case "authored-heading":
        return "authored-heading";
      case "forced-open":
        return "forced-open";
      case "unassessed-ceiling":
      case "verdict":
        return null;
    }
  }
  if (raw === "finished") return null;
  switch (decision.because) {
    case "depth-cap":
      return "depth-cap";
    case "divisibility-floor":
      return "divisibility-floor";
    case "no-verdict":
    case "verdict":
      return null;
  }
}

/**
 * **What was decided about one candidate node, and everything needed to argue
 * with it later.**
 *
 * A named type with every field required, because the plan asks the eval for
 * numbers that a bag of optionals cannot produce: an absent `bodyWords` and a
 * `bodyWords` of zero are different facts, and a rate computed over records
 * where half the denominator is missing is a rate nobody can act on. Where a
 * value genuinely does not exist yet it is `null` and says so — `rawVerdict` on
 * wave 1, `fanOut` on a node that was never expanded.
 *
 * **Nothing here is prose from the article.** `where` is an ordinal path the
 * cascade derives from the shape of the tree ("root > child 2 > child 4"), and
 * every other field is a number, an enum or a model id. `CapReached` states the
 * same rule and gives the reason: a title is a sentence the model wrote about
 * the article, and this travels into a log line. src/ids.ts § `nameValue`.
 */
export interface CandidateRecord {
  /**
   * "root > child 2 > child 4". Derived from the tree's shape, so safe to log.
   *
   * **It is not a repeat-stable identity**, which is why `range` sits beside it.
   * The ordinal comes from the answer's own fan-out, so two repeats that split
   * one parent at different points both emit `root > child 1` — and pairing on
   * that reads a boundary that moved as a node whose verdict held.
   */
  where: string;
  /**
   * **The first and last block id of this node's derived span**, which is what
   * makes two runs' records pairable: the same parent plus the same range is the
   * same prose, whatever ordinal the fan-out gave it.
   *
   * Safe to write down for the same reason `where` is, and it is worth saying
   * plainly because the rule above it is "nothing here is prose from the
   * article": a block id is `spya-k3m9qt`, minted by src/ids.ts from nothing the
   * article contains ([block-ids.md](../docs/project/block-ids.md)). It is an
   * address, not a quotation.
   *
   * `evals/deepen/report.ts` § `compareRepeats` is what reads it, and the
   * classification lives there rather than here: a changed fan-out, and an
   * unmatched range at equal fan-out, are **structural instability** — a
   * different finding from a verdict that flipped, and one stage 6 must not
   * confuse with it.
   */
  range: [string, string];
  /**
   * 1 for the whole-document call's own nodes; 2 for the first scoped wave, and
   * so on. Not the node's depth — a wave-2 call can produce a node at depth 3
   * under one parent and depth 2 under another.
   */
  wave: number;
  /** The node's own depth; the root is 0. What bound 1 is read against. */
  depth: number;
  /**
   * **What the model said about this node**, or `null` where nobody has been
   * asked — every node of wave 1, and the whole reason `decideExpansion` treats
   * an absent verdict as a third state rather than as "finished".
   */
  rawVerdict: ModelVerdict | null;
  /** What the governor decided, and which bound produced it. */
  effective: ExpansionDecision;
  /** Which bound overruled the model, or `null` where nothing did. */
  overriddenBy: OverridingBound | null;
  structuralBlocks: number;
  bodyWords: number;
  /** Authored body headings in range — the number bound 2 fires on. */
  authoredHeadings: number;
  /**
   * Expansion calls refused and re-asked before one stood up; 0 where the first
   * answer held, and 0 on a node that was never expanded. Every
   * `ExpansionRefused` is retryable and nothing but the attempt budget bounds
   * them, so this is the figure that says whether the budget is doing work.
   */
  retries: number;
  /** Children `normaliseExpansion` kept, or `null` where the node was not expanded. */
  fanOut: number | null;
  /**
   * **Set where the call about this node was refused on every draw its budget
   * allowed**, and absent otherwise.
   *
   * The third of three states that must never share a spelling: *finished by the
   * model* is `effective: {decision: "stop", because: "verdict"}`, *stopped by a
   * bound* is `stop` with the bound's name, and this keeps the governor's own
   * `decision: "expand"` — true, it did force the node open — and says the
   * expansion never happened. Reading a refusal as "finished" is the move
   * `granularity-zoom.md` § The supplement node forbids one field over: never
   * infer the role from a missing answer.
   *
   * `shape` carries the model's own `why`, which is article-adjacent text — so
   * this whole field belongs in the deepening records file and never in a log.
   */
  refused?: {
    reason: string;
    /** Draws made, counting the first. */
    draws: number;
    shape: RefusedAnswerShape;
  };
  model: string;
  effort: Effort;
  /** Both stamps: the wave-1 prompt this outline came from, and the scoped one. */
  promptVersion: string;
}

/**
 * **Decide about one candidate and record it in the same breath.**
 *
 * It calls `decideExpansion` itself rather than taking a decision, so that the
 * record cannot describe a decision other than the one that was acted on: the
 * caller reads `record.effective` and there is no second call to disagree with
 * it. That is the whole reason this returns a record rather than taking one.
 */
export function recordCandidate(opts: {
  node: RangedNode;
  where: string;
  wave: number;
  depth: number;
  blocks: readonly Block[];
  recipe: CascadeRecipe;
  verdict?: ModelVerdict | undefined;
  retries?: number;
  fanOut?: number | null;
  index?: BlockIndex;
}): CandidateRecord {
  const { node, blocks, recipe } = opts;
  const index = opts.index ?? indexBlocks(blocks);
  const effective = decideExpansion({
    node,
    depth: opts.depth,
    blocks,
    recipe,
    ...(opts.verdict !== undefined ? { verdict: opts.verdict } : {}),
    index,
  });
  const rawVerdict = opts.verdict ?? null;
  return {
    where: opts.where,
    /* Copied rather than shared, so a later mutation of the node cannot rewrite
       what was recorded about it. */
    range: [node.range[0], node.range[1]],
    wave: opts.wave,
    depth: opts.depth,
    rawVerdict,
    effective,
    overriddenBy: overrodeVerdict(rawVerdict, effective),
    structuralBlocks: structuralBlocksIn(node, blocks, index),
    bodyWords: bodyWordsIn(node, blocks, index),
    authoredHeadings: bodyHeadingsIn(node, blocks, index),
    retries: opts.retries ?? 0,
    fanOut: opts.fanOut ?? null,
    model: modelFor("hierarchy"),
    effort: EXPAND_EFFORT,
    promptVersion: EXPANSION_PROMPT_STAMP,
  };
}

/**
 * **How often the self-assessment says yes** — the first-class number, because
 * a model that always says "deeper" turns a bounded cascade into a bill and the
 * plan asks for this rather than for the tree alone.
 *
 * Deliberately flat: no grouping by wave or by size, because a caller that
 * wants either can filter the records and call this again, and a tally that
 * grows a dimension every time somebody wants a cut is a tally nobody can read.
 */
export interface VerdictTally {
  candidates: number;
  /** Said "needs-deeper" — the raw yes rate's numerator. */
  rawYes: number;
  /** Said "finished". */
  rawNo: number;
  /** Nobody asked: wave 1's nodes, and the reason `rawYes + rawNo < candidates`. */
  unassessed: number;
  /** The governor expanded, whatever the model said — the effective yes rate. */
  effectiveYes: number;
  /** How often each bound overruled a stated verdict. */
  overrides: Record<OverridingBound, number>;
}

export function tallyVerdicts(records: readonly CandidateRecord[]): VerdictTally {
  const tally: VerdictTally = {
    candidates: records.length,
    rawYes: 0,
    rawNo: 0,
    unassessed: 0,
    effectiveYes: 0,
    overrides: {
      "authored-heading": 0,
      "depth-cap": 0,
      "divisibility-floor": 0,
      "forced-open": 0,
    },
  };
  for (const record of records) {
    if (record.rawVerdict === null) tally.unassessed++;
    else if (record.rawVerdict === "needs-deeper") tally.rawYes++;
    else tally.rawNo++;
    if (record.effective.decision === "expand") tally.effectiveYes++;
    if (record.overriddenBy !== null) tally.overrides[record.overriddenBy]++;
  }
  return tally;
}
