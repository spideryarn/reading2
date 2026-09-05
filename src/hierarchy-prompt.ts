/**
 * **What the structure call is stamped with, how hard it thinks, and how the
 * article is printed for it** — the three values two prompt builders share.
 *
 * A leaf: it imports one policy predicate and one type, and nothing imports it
 * back. That is the whole reason it exists. `renderBlocks`, `PROMPT_VERSION`
 * and `PRODUCTION_EFFORT` lived in [`hierarchy.ts`](hierarchy.ts) and were read
 * from there by [`hierarchy-expand.ts`](hierarchy-expand.ts) **as values**, so
 * the moment `hierarchy.ts` imported the cascade — which stage 5 does, to run a
 * deepening wave — `hierarchy → hierarchy-deepen → hierarchy-expand →
 * hierarchy` closed, and `npm run cycles` is a gate at zero. `checkpointKey` was
 * hoisted into [`source-hash.ts`](source-hash.ts) the day before for the same
 * shape of reason; this is the rest of that job.
 * docs/plans/260904d-deepen-fat-sections.md § stage 5.
 *
 * **Not one byte of any of the three changed on the way**, and that is asserted
 * rather than asserted-by-eye: `PROMPT_VERSION` is inside the structure
 * checkpoint's key and `PRODUCTION_EFFORT` is inside the request the key is a
 * digest of, so a value that moved while being moved would invalidate every
 * reader's stored structure answer in exchange for nothing.
 * `tests/hierarchy-prompt-hoist.test.ts` pins all three, and
 * `tests/hierarchy-structure-request-parity.test.ts` — which pins the exact
 * bytes of the request — is the second opinion.
 *
 * `SYSTEM` deliberately stayed behind: it is the whole-document prompt and
 * nothing outside `hierarchy.ts` reads it, so moving it would be a change with
 * no cycle to break.
 */
import { isBodyEvidence } from "./block-policy.js";
import type { Block } from "./types.js";

/* Bumped to 2 when the nav labels moved out to src/labels.ts: this prompt no
   longer asks for them, and a tree written by toc/1 is a different artefact.

   Bumped to 4 for the heading snap (`snapStartsToHeadings`), which is not a
   prompt change at all: the wire request is byte-identical. The stamp still has
   to move, because it is what the structure *checkpoint* is keyed on, and the
   same answer now builds a different tree — a document part-way through the
   stage would otherwise resume onto the old boundaries and nothing would say
   so. One replayed call per article in flight, and that is the whole cost. */
export const PROMPT_VERSION = "toc/4";

/**
 * How hard the model thinks before it starts writing.
 *
 * **`"low"` since 2026-09-04, and this setting has now been wrong in both
 * directions twice before that.**
 *
 * The history, because it is the argument. It was `"high"` originally, by
 * default rather than by decision. The max_tokens postmortem forced it down to
 * `"medium"`: raising `max_tokens` from 32,000 to 77,100 failed again, having
 * spent roughly 64,000 tokens on thinking, because at `"high"` adaptive thinking
 * **expands into whatever room it is given**. `max_tokens` is a ceiling, not a
 * leash; `effort` is the leash. Moving the nav labels out to src/labels.ts then
 * bought enough room to put it back to `"high"`, and the comment here argued
 * that case well.
 *
 * It went wrong the same way a third time. On 2026-08-30 Stephen Wolfram's
 * "Towards a theory of bugs" was sized for a 52,225-token budget — 12,225 for
 * the answer, 40,000 of `THINKING_HEADROOM` — and came back truncated having
 * spent 2,825 on the answer and 49,400 on reasoning. Those two sum to 52,225
 * **exactly**. The reasoning did not overrun the reservation; it expanded to
 * fill the ceiling, which is what it does at `"high"` and what it will do at
 * any ceiling. So no value of `THINKING_HEADROOM` fixes this, and neither does
 * a better answer estimate: both make the room bigger and the thinking takes
 * the room. Greg's call, the same day.
 *
 * **The measurement that was owed has now been taken, and it says `"low"`.**
 * 2026-09-04. The three paragraphs above said this setting had never been
 * measured for quality, only chosen off a failure mode. That is no longer true,
 * and the evidence points one way in three independent runs:
 *
 * - **Blind judging, eight of eight.** Two evals, two judge families (GPT Sol
 *   and Fable), two draw sets — `low` preferred over `medium` every time, with
 *   the free heading tree placing second. evals/results/hierarchy-effort-2026-09-03.md
 *   and evals/results/hierarchy-cheap-models-2026-09-03.md.
 * - **The same reliability, not worse.** Pooled across three articles both
 *   efforts produced a tree 6 times in 7, and the one article that beat them
 *   beat *both*. The earlier "low failed 1 in 8 where medium failed 0 in 10"
 *   reading came from one document.
 * - **Cheaper and faster, on the long articles that matter.** 2026-09-04, on
 *   the 360-block constitution: $0.264 against $0.293 and 150s against 172s,
 *   for the same seven depth-1 parts. On the 184-block gwern essay: $0.135
 *   against $0.234 — 42% less — and **eight parts against six**.
 *
 * **The failure modes are not commensurable, and that is the argument.**
 * `medium`'s named fault is *welding*: it fuses two of the author's own
 * sections under one title. That is valid, silent, shipped, and paid by every
 * reader of that article — nothing in the pipeline can detect it, and the
 * six-versus-eight parts above is it happening again. `low`'s fault is a tiling
 * violation, which `buildTree` throws on, the job card reports, and a Retry
 * recovers. A loud failure that costs one retry is a better trade than a quiet
 * one that costs every reader a worse map.
 *
 * **What is still not measured**: `high` against either, for this stage. It has
 * never been run and is unlikely to be worth the money now, given that the
 * argument for lowering was a failure mode and the argument for lowering
 * further is a quality result.
 *
 * **If you run any of these comparisons, read `repairedBlocks` and
 * `largestRepair` alongside the score.** Since `0062f74` a tree that does not
 * tile is snapped shut and repaired rather than thrown away, so an arm can
 * score `ok` having been repaired into shape — and a boundary one paragraph out
 * and a section handed forty of its neighbour's blocks would otherwise look
 * identical. `evals/hierarchy-structure/run.ts` records both.
 *
 * See docs/plans/260904c-hierarchy-structure-in-waves.md § Product decisions,
 * docs/plans/260826h-toc-scaling.md and docs/postmortems/260826a-toc-max-tokens.md.
 */
const EFFORT = "low" as const;

/**
 * **What production actually thinks at, for anything that needs to say so.**
 *
 * Exported on 2026-09-03 because `evals/hierarchy-structure/arms.ts` had typed
 * the number in again, and drifted: it called `"high"` the incumbent for the
 * eight days after the max_tokens postmortem moved this to `"medium"`. Every
 * paid arm in that harness was therefore scored against a recipe the pipeline
 * does not run, and `smart-low` — declared as isolating the single variable
 * `effort` — was quietly answering high-vs-low instead of the medium-vs-low
 * question production has. GPT Sol found it by reading both files at once,
 * which is the only way a restated constant is ever found.
 *
 * *(That arm is `smart-medium` since 2026-09-04: production moved to `low`, so
 * the arm isolating effort had to move the other way or become a second copy of
 * the incumbent. The name in the paragraph above is the one it had at the time.)*
 *
 * `structureRequest` below already hands this out to callers who have blocks;
 * `evals/cost` reads it that way and stayed correct throughout. This export is
 * for the callers who only want the number.
 */
export { EFFORT as PRODUCTION_EFFORT };

/**
 * The article, as the structure model sees it.
 *
 * **A supplement's prose is withheld, and its id is not.** On the ordinary path
 * `generateHierarchy` hands this only the body, so the branch never fires — but the
 * split falls back to the whole article whenever the apparatus is not one
 * trailing run (src/supplement.ts), and on that path this function is the only
 * thing between a bibliography and the largest prompt the pipeline sends. A
 * marker alone was the shape of the original bug: `NOT-GISTABLE` is written from
 * `gistable`, and a prose footnote *is* gistable, so a note went out unmarked
 * and in full. Marking it would not have been a fix either — the text is what
 * must not travel. GPT Sol's review of stage 3, 2026-08-28.
 *
 * The **id stays**, because the model's ranges have to tile the whole article
 * and a block it cannot name is a block no node can cover. `NOT-GISTABLE` is
 * reused rather than a new marker invented: SYSTEM above already explains it,
 * and a word the prompt never defines is a word the model gets to interpret.
 *
 * **Exported for the scoped expansion call** (src/hierarchy-expand.ts), which
 * renders one section's slice with the identical rule. A second renderer would
 * be a second place for the withholding above to be forgotten, and
 * `estimateEvidenceTokens` (src/hierarchy-cascade.ts) already sizes a batch by
 * following *this* function's output — so a private copy would put the
 * estimator and the builder one edit apart with nothing to say so. The index in
 * `[i]` is a position within the array handed in, so a scoped call's slice is
 * numbered from 0 and its prompt says so.
 */
export function renderBlocks(blocks: Block[]): string {
  return blocks
    .map((b, i) => {
      if (!isBodyEvidence(b)) return `[${i}] ${b.id} <${b.tag}> NOT-GISTABLE: (withheld)`;
      const mark = b.gistable ? "" : " NOT-GISTABLE";
      return `[${i}] ${b.id} <${b.tag}>${mark}: ${b.text}`;
    })
    .join("\n\n");
}

