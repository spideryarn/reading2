/**
 * **The `matter` step: an article's front and back matter, found once and
 * stored beside its blocks** — stage 2 of
 * docs/plans/261018a-front-and-back-matter-marked-at-import-and-folded-by-default.md,
 * as amended by its plan review (F1, F2, F4, F10).
 *
 * Three things, each used in one place:
 *
 * - `buildMatter` — what the step's `run` stores (src/pipeline.ts § `matter`).
 *   One call (`classifyMatter`, src/matter.ts) and the labels rule
 *   (`matterByLabels`, src/matter-labels.ts), combined (`combineMatter`), as
 *   stretches of block ids. **It fails soft**: a refused, failed or timed-out
 *   call stores the labels rule's stretches alone, with a closed
 *   `modelUnavailable` code (never the model's words); a failure of the step
 *   itself stores `{ status: "unavailable" }`. The import goes on either way.
 * - `matterForReader` — the owner's article read (src/store/pg.ts §
 *   `loadArticle`). The stored value reaches the reading view only when it is
 *   about **these** blocks; anything else is `undefined`, which the reading view
 *   reads as *use today's byline rule* (review F2: a draft copies the published
 *   revision's columns, so a stale value is the ordinary case, not a corrupt one).
 * - `matterSettled` — whether a publication still needs the successor that
 *   makes it (src/store/pg-revisions.ts § `publishRevisionIn`).
 *
 * ## Why a successor job, and not `DEFAULT_INGEST_STEPS`
 *
 * The plan put it in the default ingest; its review (Sol, "its point on the
 * critical path") asked for the choice to be made on the numbers. The call
 * takes ~5.8 s at the median and ~17 s at worst over the eval's corpus, with a
 * 30 s ceiling (`TIMEOUT_MS`). A pasted address opens early (plan 261005j):
 * the reader waits for fetch, extract, blocks, a stand-in tree with no model
 * call, and assets — a wait of seconds that this would have lengthened by a
 * third or more, and by up to 30 s on a slow call. Every step is sequential, so
 * a step in the default cannot overlap anything. A successor queued by the
 * publication arrives a few seconds after the article opens, and until then
 * the reading view falls back to the byline rule it uses today. So it is a
 * successor, queued **ahead** of the `structure` and `labels` successors so
 * that it is not stuck behind a pass of several minutes (it is a sharing step,
 * src/sharing-steps.ts, so it runs beside the main-mode jobs).
 *
 * ## Why a column of its own, and not `Block.role` (review F10)
 *
 * A stretch is a range-level, multi-kind judgement, while `role` is one value
 * per block; model policy is `treatment`'s, not `role`'s; `hashBlocks` reads
 * `role`, so writing it would put a stamp over a hash containing its own
 * output; and failure and staleness here fall back without rewriting block data.
 */
import {
  MATTER_KINDS,
  classifyMatter,
  combineMatter,
  matterInputHash,
  type MatterKind,
  type MatterOptions,
} from "./matter.js";
import { matterByLabels } from "./matter-labels.js";
import { MATTER_KIND_NAMES, isMatterDocument } from "./matter-shape.js";
import { MATTER_MODEL } from "./models.js";
import type { Author, Block, Matter, MatterKindName, MatterModelUnavailable, MatterStretchStored } from "./types.js";
import { mastheadEcho } from "./web/masthead-echo.js";

/**
 * **The step's version**, stamped into the artefact and the run row. Bump it
 * when `MATTER_SYSTEM`, the request, the checks in src/matter.ts, the labels
 * rule or `MATTER_MODEL` change what would be stored, so every stored value
 * reads as outdated. **The model is in this version rather than in the stamp**,
 * because a stored value's `generator` names its sources — `labels+<model>`,
 * or `labels` alone after a failed call — not one model, and a stamp that
 * declared a model would clash with the second on every write.
 *
 * Here rather than beside the prompt only because src/matter.ts was being
 * edited by another stage when this was written; it belongs there.
 */
export const MATTER_PROMPT_VERSION = "matter/1";

/** The `generator` of a value both sources made. */
export const MATTER_GENERATOR = "labels+" + MATTER_MODEL;
/** The `generator` of a value the call failed for: the labels rule's alone. */
export const LABELS_ONLY_GENERATOR = "labels";

/* **The closed kinds, held equal in both directions** — `MATTER_KINDS`
   (src/matter.ts, which the browser may not import) and `MatterKindName`
   (src/types.ts, which it may). A kind added to one and not the other makes
   this line a type error. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const KINDS_AGREE: Same<MatterKind, MatterKindName> = true;
void KINDS_AGREE;
/* And the runtime set src/matter-shape.ts tests stored strings against.
   Checked once at import: a mismatch is a programming error, not a state. */
if (MATTER_KINDS.length !== MATTER_KIND_NAMES.size || !MATTER_KINDS.every((k) => MATTER_KIND_NAMES.has(k))) {
  throw new Error("MATTER_KINDS (src/matter.ts) and MATTER_KIND_NAMES (src/matter-shape.ts) disagree");
}

/** What the step reads: the blocks, and the head the classifier is shown. */
export interface MatterStepInput {
  blocks: readonly Block[];
  meta: {
    title?: string | null | undefined;
    byline?: string | null | undefined;
    authors?: Author[] | null | undefined;
  } | null;
}

/**
 * **`classifyMatter`'s reason, as a closed code.** Its reasons are ours, not
 * the model's (src/matter.ts § `classifyMatter`), but they are sentences, and
 * a sentence stored is a sentence somebody will one day show. Anything not
 * recognised is a refused answer, which is what every other reason there is.
 */
export function modelUnavailableReason(reason: string): MatterModelUnavailable {
  if (reason === "the call timed out") return "timed-out";
  if (reason === "the call failed") return "call-failed";
  return "invalid-answer";
}

/**
 * **What the step stores**: the union of the classifier's stretches and the
 * labels rule's (`combineMatter`). Fails soft twice over:
 *
 * - **the call failed** (refused, failed, timed out): `ok` still, with the
 *   labels rule's stretches alone, `generator: "labels"` and
 *   `modelUnavailable` saying why — a failed call still folds what the free
 *   rule finds;
 * - **the step itself failed** (no blocks, or the rule or the checks threw):
 *   `unavailable` with a closed reason, and the reading view uses today's rule.
 *
 * Only an abort from the caller throws.
 */
export async function buildMatter(input: MatterStepInput, opts: MatterOptions = {}): Promise<{ matter: Matter; dropped: number }> {
  const blocks = input.blocks;
  const sourceHash = matterInputHash(blocks);
  const unavailable = (reason: "no-blocks" | "step-failed"): { matter: Matter; dropped: number } => ({
    matter: { status: "unavailable", version: MATTER_PROMPT_VERSION, sourceHash, reason },
    dropped: 0,
  });
  if (blocks.length === 0) return unavailable("no-blocks");
  const meta = {
    title: input.meta?.title ?? null,
    byline: input.meta?.byline ?? null,
    authors: input.meta?.authors ?? null,
  };
  const article = { blocks: blocks as Block[], meta };
  /* `titleOverridden: false`: the pipeline reads the article's own title, and
     a reader's rename is a display fact the reading view subtracts again
     (review F7), not something a stored stretch should depend on. */
  const echo = mastheadEcho({ blocks: blocks as Block[], titleOverridden: false, meta: { title: meta.title ?? "" } });
  const verdict = await classifyMatter(article, echo, opts);
  try {
    const labelled = matterByLabels(
      { blocks: blocks as Block[], meta: { authors: meta.authors ?? undefined, byline: meta.byline ?? undefined, title: meta.title } },
      echo,
    );
    const combined = combineMatter(article, verdict.status === "ok" ? verdict : { held: [] }, labelled, echo);
    const stretches = combined.stretches.map((s) => ({ from: s.from, to: s.to, kinds: [...s.kinds] }));
    if (verdict.status === "unavailable") {
      return {
        matter: {
          status: "ok",
          version: MATTER_PROMPT_VERSION,
          generator: LABELS_ONLY_GENERATOR,
          sourceHash,
          stretches,
          modelUnavailable: modelUnavailableReason(verdict.reason),
        },
        dropped: combined.dropped.length,
      };
    }
    return {
      matter: {
        status: "ok",
        version: MATTER_PROMPT_VERSION,
        generator: opts.model ? "labels+" + opts.model : MATTER_GENERATOR,
        sourceHash,
        stretches,
      },
      dropped: verdict.dropped.length + combined.dropped.length,
    };
  } catch {
    /* The rule or the checks threw: a bug of ours, on these blocks. Stored,
       so the reading view falls back and the publication does not re-queue
       it; the step's log line says `unavailable (step-failed)`. */
    opts.signal?.throwIfAborted();
    return unavailable("step-failed");
  }
}

/**
 * **Is this stored value about these blocks** — `ok` (with or without the
 * model's half) or `unavailable`, with the hash of these blocks. What decides
 * whether a publication queues the step: a failed call or a failed step on
 * the same blocks is not retried by every publication (a re-run is a press on
 * Metadata), and the step's own publication never queues another.
 */
export function matterSettled(value: unknown, blocks: readonly Block[]): boolean {
  return isMatterDocument(value) && value.sourceHash === matterInputHash(blocks);
}

/**
 * **The stretches the reading view may fold, or `undefined` for *use today's
 * rule*.** Every one of these, or nothing (review F2):
 *
 * 1. the stored shape is valid and its status is `ok`;
 * 2. `sourceHash` equals `matterInputHash` of the blocks on this payload —
 *    so a column a draft carried over changed blocks, or a value copied from
 *    another revision, is withheld;
 * 3. every id is a block here;
 * 4. each `from` is at or before its `to` **by index** (block-ids.md § The
 *    cost we accepted), and the stretches are in document order and do not
 *    overlap.
 *
 * 2 implies 3 and 4 for a value this step wrote; they are checked anyway,
 * because the column is a document anybody with a SQL prompt can write.
 */
export function matterForReader(value: unknown, blocks: readonly Block[]): MatterStretchStored[] | undefined {
  if (!isMatterDocument(value) || value.status !== "ok") return undefined;
  if (value.sourceHash !== matterInputHash(blocks)) return undefined;
  const index = new Map(blocks.map((b, i) => [b.id, i]));
  let last = -1;
  for (const s of value.stretches) {
    const a = index.get(s.from);
    const b = index.get(s.to);
    if (a === undefined || b === undefined || a > b || a <= last) return undefined;
    last = b;
  }
  return value.stretches.map((s) => ({ from: s.from, to: s.to, kinds: [...s.kinds] }));
}
