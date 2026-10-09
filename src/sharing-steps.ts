/**
 * **Which jobs may run on one article at the same time** — the one policy, as a
 * leaf with no runtime imports.
 *
 * > Can we run some of the AI processing in parallel? For example, if I've
 * > opened up Ideas and Quotes and Drawing and Tweet-threads modes, or whatever,
 * > there aren't any dependencies between them … The only complexity I can see
 * > is for something like Trajectory mode, which should wait until any of the
 * > modes that it draws on to have finished if they're running.
 * >
 * > — Greg, 2026-09-29
 *
 * docs/plans/260929c-modes-generate-in-parallel-on-one-article.md is the
 * design. Until then an article's line let exactly one job run at a time,
 * because every job writes a draft copied from the published revision and
 * `publishRevisionIn` refuses a draft whose base has moved — so two mode jobs
 * run together meant the second one's paid work thrown away. Two things change
 * together and both read this file: `blockedByAnother` (src/store/pg-jobs.ts)
 * lets two jobs overlap when `mayOverlap` says so, and `rebaseSharingDraftIn`
 * (src/store/pg-revisions.ts) carries a finished sharing job's columns onto
 * whatever was published meanwhile instead of being refused.
 *
 * ## A sharing step
 *
 * One that writes **exactly one `article_revisions` column of its own** plus
 * its `revision_step_runs` row, and reads only the article (blocks, tree,
 * metadata — none of which a sharing step writes) plus the other sharing steps
 * it declares in `reads`. Everything after `assets` in `STEP_ORDER`. The two
 * declared reads were found by reading each step's `run` in src/pipeline.ts:
 * `illustrated` paints the `sketch`, and `skim` routes through the
 * `quotes` and the `ideas`. Five steps read their *own* previous column
 * (`glossary` and `quotes` append on *Find more*; `ideas`, `timeline` and
 * `citations` lend their ids forward) — that is covered by never letting one
 * step be made twice at once, so it needs no entry.
 *
 * `labels` is deliberately not one: it rewrites `tree` and `nav_label_status`
 * as well as `labels`, and writes the base revision on failure, so a column copy
 * is the wrong model of it. `structure` and the ingest steps change what
 * every mode reads. `assets` does not — it writes one column and only
 * `illustrated` reads it — so it would qualify, and is exclusive only because
 * nobody has needed it to share (docs/investigations/261004e).
 *
 * ## Exhaustive over `StepName`
 *
 * `satisfies Record<StepName, …>`, so a step added to the pipeline is a compile
 * error here until somebody decides whether it may share — the same discipline
 * as `RESET_ROLE` in src/reset-role.ts. A list of sharing steps would quietly
 * make every new step exclusive, which is safe; but the `reads` of a new step
 * that *does* share are the fact that must not be forgotten, and only an entry
 * per step asks for them. tests/sharing-steps.test.ts holds the columns against
 * `STORAGE` (src/store/artifact-storage.ts).
 *
 * A leaf: types only, so the browser could import it
 * (tests/client-imports.test.ts) and src/store/ can without a cycle.
 */

import type { WholeColumn } from "./store/artifact-storage.js";
import type { StepName } from "./types.js";

/** What one sharing step owns, and which other sharing steps it reads. */
export interface SharingPolicy {
  /** The one `article_revisions` column (a `STORAGE` whole column) it writes. */
  readonly column: WholeColumn;
  /** Other sharing steps whose artefacts this step's `run` reads. */
  readonly reads: readonly StepName[];
}

/**
 * Every step, and whether it may share an article with another running job.
 * See the file header for what `"exclusive"` protects.
 */
export const STEP_SHARING = {
  fetch: "exclusive",
  metadata: "exclusive",
  extract: "exclusive",
  blocks: "exclusive",
  structure: "exclusive",
  labels: "exclusive",
  assets: "exclusive",
  arc: { column: "arc", reads: [] },
  tweets: { column: "tweets", reads: [] },
  glossary: { column: "glossary", reads: [] },
  quotes: { column: "quotes", reads: [] },
  ideas: { column: "ideas", reads: [] },
  timeline: { column: "timeline", reads: [] },
  quiz: { column: "quiz", reads: [] },
  faq: { column: "faq", reads: [] },
  relations: { column: "relations", reads: [] },
  sketch: { column: "sketch", reads: [] },
  /* The Sketch is what it paints, and `inputFingerprint` (src/illustrated.ts)
     hashes it — so a Sketch redrawn mid-run would leave a picture of the old
     one under a fingerprint of the new. */
  illustrated: { column: "illustrated", reads: ["sketch"] },
  /* A route through the quotes' ids, and since 260928a stage 6 the ideas too. */
  skim: { column: "skim", reads: ["quotes", "ideas"] },
  debate: { column: "debate", reads: [] },
  /* Reads the article only — not the stored Debate — and writes its own column. */
  "debate-claims": { column: "debateClaims", reads: [] },
  citations: { column: "citations", reads: [] },
  crossrefs: { column: "crossrefs", reads: [] },
  simple: { column: "simpleSummary", reads: [] },
} as const satisfies Record<StepName, "exclusive" | SharingPolicy>;

/** The steps whose entry above is a policy rather than `"exclusive"`. */
export type SharingStep = {
  [S in StepName]: (typeof STEP_SHARING)[S] extends "exclusive" ? never : S;
}[StepName];

export const SHARING_STEPS: readonly SharingStep[] = (
  Object.keys(STEP_SHARING) as StepName[]
).filter((step): step is SharingStep => STEP_SHARING[step] !== "exclusive");

export function isSharingStep(step: StepName): step is SharingStep {
  return STEP_SHARING[step] !== "exclusive";
}

/** The policy for a sharing step. */
export function sharingPolicy(step: SharingStep): SharingPolicy {
  return STEP_SHARING[step] as SharingPolicy;
}

/**
 * What the queue knows about a job, and all `mayOverlap` needs.
 *
 * `reset` and `reservesName` are booleans rather than the columns themselves
 * because the only question asked of them is *is there one*: a reset rebuilds
 * the draft from scratch (and drops columns), and a name-reserving job is an
 * ingest minting the article — neither is a column copy, whatever its steps.
 */
export interface JobShape {
  readonly steps: readonly StepName[];
  readonly reset: boolean;
  readonly reservesName: boolean;
}

/**
 * A job every step of which is a sharing step, that carries no reset and
 * reserves no name. Anything else runs alone on its article, exactly as every
 * job did before 260929c. No steps at all is not a sharing job: nothing makes
 * one, and the answer that cannot hurt is to let it wait its turn.
 */
export function isSharingJob(job: JobShape): boolean {
  return (
    !job.reset && !job.reservesName && job.steps.length > 0 && job.steps.every(isSharingStep)
  );
}

/** W: the steps a job makes. */
export function writesOf(job: JobShape): ReadonlySet<StepName> {
  return new Set(job.steps);
}

/** R: the union of the declared reads over a job's steps. */
export function readsOf(job: JobShape): ReadonlySet<StepName> {
  const reads = new Set<StepName>();
  for (const step of job.steps) {
    const policy = STEP_SHARING[step];
    if (policy === "exclusive") continue;
    for (const read of policy.reads) reads.add(read);
  }
  return reads;
}

function disjoint(a: ReadonlySet<StepName>, b: ReadonlySet<StepName>): boolean {
  for (const x of a) if (b.has(x)) return false;
  return true;
}

/**
 * **May these two jobs run on one article at the same time?**
 *
 *     both are sharing jobs, and
 *     W(a) ∩ W(b) = ∅     no step made twice (own-column append, id inheritance)
 *     W(a) ∩ R(b) = ∅     b does not read what a is making
 *     R(a) ∩ W(b) = ∅     and the other way round
 *
 * Symmetric, and pure. Whether an overlap that is allowed also *publishes*
 * cleanly is the rebase's question, answered on the data at publication
 * (src/store/pg-revisions.ts § `rebaseSharingDraftIn`) rather than trusted
 * from here.
 */
export function mayOverlap(a: JobShape, b: JobShape): boolean {
  if (!isSharingJob(a) || !isSharingJob(b)) return false;
  const wa = writesOf(a);
  const wb = writesOf(b);
  return disjoint(wa, wb) && disjoint(wa, readsOf(b)) && disjoint(readsOf(a), wb);
}
