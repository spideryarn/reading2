/**
 * The seam between the two halves of a step.
 *
 * > A stage stops writing. It returns a product. A short commit afterwards
 * > writes the product, checks it, finishes the step, and moves the job on.
 *
 * The runner in src/jobs.ts used to make four store calls per step —
 * `beginStep`, the stage's own writes inside `run`, `assertProduced`,
 * `finishStep` — and then a fifth from its caller, the job's own release or
 * finish. Each commits on its own. On the filesystem that is fine, because there
 * is nothing to commit. On Postgres each would be its own transaction, and the
 * first of them writes the artefacts: a crash between the write and the
 * completion leaves a revision holding new artefacts that no step claims to have
 * made, and a crash between the completion and the release leaves a revision
 * saying done while the job says interrupted.
 *
 * So the run phase and the commit phase are separated here, and the commit is
 * the short thing a transaction can wrap — **artefacts, postcondition, step
 * completion and job transition, in that order, behind one call.**
 *
 * **The model call stays outside**, deliberately and permanently. A transaction
 * held open across a thirty-second model call is a transaction held open across
 * a thirty-second model call, whatever else is true about it.
 *
 * docs/plans/260827aa-delete-the-importer.md § D1. This file is D1a: the shape, and the
 * filesystem session, which holds no transaction and says so. The transactional
 * one is D1b, and everything it needs a place for has a place here.
 */
import { assertProduced, UNCONVERTED_STEPS } from "../pipeline.js";
import type { PipelineStep, StepContext, StepProduct } from "../pipeline.js";
import { ProductRefused } from "./artifacts.js";
import type {
  ArtifactKind,
  ArtifactMap,
  ArtifactReads,
  ArtifactStore,
} from "./artifacts.js";
import type { JobEnding, JobStore, StepOutcome as JobStepFields } from "./jobs.js";
import type { Job, JobStep, StepName } from "../types.js";

/**
 * The job write that belongs with a step's artefacts.
 *
 * **A payload, not a closure**, for the same reason `commit` takes the product
 * rather than a function: a session that is handed a closure cannot inspect what
 * it is about to do, and D1b has to bind these to its transaction rather than
 * run them beside it. The two shapes are the two things that can follow a step —
 * the claim goes back so the next request can have it, or the job is over.
 *
 * The job's *progress* note is deliberately not here. `revision_step_runs` is
 * the authority for "is this step done"; `noteProgress` is a progress bar, and
 * pulling the job row into the artefact transaction for a field nothing decides
 * anything on would widen it for nothing. The **terminal** release and finish
 * are a different matter, and that is what these are —
 * docs/plans/260827aa-delete-the-importer-d1-design-sol.md, finding 1.
 */
export type JobTransition =
  /**
   * The step is done, the job goes on, and **the claim stays here.**
   *
   * The ordinary case, since the coordinator started walking a whole job on one
   * claim (docs/plans/260830d-v1-imports-on-vercel.md § Stage 3). It writes nothing to
   * the `jobs` row at all: the step's completion is in `revision_step_runs`,
   * which is the authority for *is this step done*, and the row the card is
   * rendered from catches up a moment later through `noteProgress` — outside
   * this transaction, deliberately, because a progress bar is not worth widening
   * an artefact transaction for.
   *
   * **Why it is not simply `release`.** A release hands the claim back, and on a
   * serverless host the next request lands on a different instance with an empty
   * `/tmp` and finds nothing the last step wrote. That is the whole reason
   * imports do not work today, and it is why every non-final step now keeps.
   */
  | { kind: "keep" }
  /**
   * The step is done and the job goes on, but **let the claim go** — the next
   * request takes it.
   *
   * A deliberate handoff rather than the ordinary path: the claimant is close
   * enough to its own deadline that starting the next step would mean being
   * killed inside it. See `budgetFor` in src/jobs.ts.
   */
  | { kind: "release"; jobId: string; attempt: string; steps: JobStep[]; fields: JobStepFields }
  /** The job is over, however it ended. */
  | { kind: "end"; jobId: string; attempt: string; ending: JobEnding };

/**
 * The half of `JobTransition` that ends the job — **the only kind `settleJob`
 * takes.**
 *
 * A named type rather than an inline `Extract`, because the narrowing is a
 * safety property and not a tidy-up. `settleJob` is the door for the endings
 * that have no product, and every caller in src/jobs.ts passes an `end`. Letting
 * a `release` through it would reach `discardAfterCancel` in
 * src/store/pg-session.ts on a path where the draft has *not* been fenced one
 * statement earlier — `releaseStepIn` checks job, attempt and status, and says
 * nothing about which draft the job points at. On the commit path that fence is
 * already proved by `writeArtefacts`; through this door it would not be. GPT
 * Sol, 2026-08-30, docs/plans/260827aa-delete-the-importer-d1b-sol.md finding 4.
 */
export type JobEndTransition = Extract<JobTransition, { kind: "end" }>;

/**
 * The two transitions that write the `jobs` row — **the only ones
 * `settlementOf` can read**.
 *
 * A `keep` writes nothing there, so there is no row to read the outcome off and
 * no settlement to infer. Excluded in the type rather than handled with a throw,
 * because the alternative is a branch nothing can reach and nothing can test.
 */
export type JobSettlingTransition = Exclude<JobTransition, { kind: "keep" }>;

/**
 * The two job writes a session performs, and no others.
 *
 * Narrowed the way `ArtifactReads` is: a session may end a claim, and it may not
 * claim, cancel, sweep or enumerate. It also makes the session testable against
 * a two-method stub rather than a whole `JobStore`.
 *
 * **The transactional session must not accept this**, and that is not a style
 * preference. Its methods reach `getDb()` for themselves, so handing them to a
 * session binds them to nothing: the artefacts and the step state would commit
 * while the release failed separately, which is the exact fault the whole seam
 * exists to remove. It calls `releaseStepIn(tx, …)` and `finishIn(tx, …)`
 * instead. GPT Sol, 2026-08-29,
 * docs/plans/260827aa-delete-the-importer-d1b-design-sol.md critical 2.
 */
export type JobSettles = Pick<JobStore, "releaseStep" | "finish">;

/**
 * **What the settlement actually did** — never what it was asked to do.
 *
 * `commit` and `settleJob` used to return the `Job` alone, and every caller
 * worked out what had happened by looking at the transition it had *requested*.
 * That is wrong on one path, and the path is reachable: `releaseStep` resolves
 * to **cancelled** when a Stop arrived while the step was running (see the
 * `case` expression in src/store/pg-jobs.ts, and the same branch in
 * src/store/jobs-fs.ts). A caller that infers "released, so the job goes on"
 * from its own request then tells the reader the job is still working, and
 * `/advance` answers `done: false` about a job that is over.
 *
 * So the two shapes here mirror `JobTransition`'s two, and the mapping between
 * them is not the identity — a `release` can come back as `ended`. GPT Sol,
 * 2026-08-29, docs/plans/260827aa-delete-the-importer-d1b-design-sol.md critical 1.
 *
 * `ending` travels with the ending rather than being re-derived by each caller,
 * because src/jobs.ts needs it for the log line and the retention sweep, and a
 * release that resolved to cancellation has no `JobEnding` anywhere else — the
 * transition it was given holds a `steps` list and nothing that says how it
 * finished.
 */
export type JobSettlement =
  /**
   * The step landed and **this claimant still holds the job**, so there is
   * nothing to report about the `jobs` row: nothing wrote to it.
   *
   * No `job`, deliberately. The only honest one would be a row read back for the
   * purpose, and the coordinator has the record in memory and is about to write
   * it through `noteProgress` anyway — a second copy here would be a second
   * account of the same thing, one statement out of date the moment it is made.
   */
  | { readonly kind: "kept" }
  /** The claim went back; the job is `queued` and the next request takes it. */
  | { readonly kind: "released"; readonly job: Job }
  /** The job is over, however it got there. */
  | { readonly kind: "ended"; readonly job: Job; readonly ending: JobEnding };

/**
 * The requested transition plus the row that came back, read as what happened.
 *
 * **One dispatcher, shared by both sessions**, so the filesystem and Postgres
 * cannot disagree about what a release-that-cancelled is. Both stores really do
 * settle a cancellation inside `releaseStep`, so this is not a Postgres-only
 * shape.
 *
 * It reads `job.status` and not the flag it was set from: the status is what the
 * store committed and what the reader will be shown, and asking the same
 * question twice in two places is how the two answers drift.
 */
export function settlementOf(transition: JobSettlingTransition, job: Job): JobSettlement {
  if (transition.kind === "end") return { kind: "ended", job, ending: transition.ending };
  if (job.status === "queued") return { kind: "released", job };
  return { kind: "ended", job, ending: endingOf(job) };
}

/**
 * The ending a store has already written, read back off the row.
 *
 * Only ever called for a release that did not release. `queued` and `running`
 * are refused loudly rather than coerced, because a release that came back
 * `running` means the fence let something through and the honest answer is that
 * nobody knows what state the job is in.
 */
function endingOf(job: Job): JobEnding {
  if (job.status !== "done" && job.status !== "error" && job.status !== "cancelled") {
    throw new Error(
      `A release of job ${job.id} came back "${job.status}", which is neither queued nor an ending.`,
    );
  }
  return {
    status: job.status,
    steps: job.steps,
    ...(job.error !== undefined && { error: job.error }),
    ...(job.failureKind !== undefined && { failureKind: job.failureKind }),
    ...(job.title !== undefined && { title: job.title }),
  };
}

/**
 * One claim's worth of store access, split into what the run phase may do and
 * what the commit phase does.
 *
 * **Not one per job.** Every `/advance` mints a new attempt and runs one step,
 * and a Postgres draft reference embeds that attempt — so a session built once
 * per job is stale on the second request. It is built once per successful claim,
 * which is what src/jobs.ts does.
 */
export interface StoreSession {
  /**
   * What a stage may ask while it works. Reads only — see `ArtifactReads`.
   *
   * **A facade, not the store itself.** Handing out the real object makes the
   * narrowing compile-time only: one `as ArtifactStore` and the run phase is
   * writing again, outside the transaction that is supposed to hold the step
   * together. Six methods, and nothing else to reach.
   *
   * The preflight `stepIsDone` goes through this too, and not through some other
   * store the caller happens to have: a Postgres step deciding whether to skip
   * by looking at files on disk is the exact silent success this seam is for.
   */
  readonly reads: ArtifactReads;
  /** This step has started; nothing it writes is to be believed until `commit`. */
  beginStep(slug: string, step: StepName): Promise<string>;
  /**
   * Write what the step made, check it landed, mark the step done, and move the
   * job on. Returns the job as it now stands.
   *
   * **It takes the product, not a closure**, and that is the whole shape of the
   * thing. A closure runs inside the commit and the session never sees what the
   * step produced, so it cannot refuse a step that produced nothing — which is
   * precisely the failure that has to be refusable. See `checkProduct`.
   *
   * **And it takes the job transition**, so that the step's completion and the
   * job's are one act rather than two. On the filesystem they are still two
   * writes in a row; what this buys today is that there is exactly one place for
   * D1b to make them one.
   *
   * **Or no job write at all.** A `keep` is the ordinary case now that one claim
   * walks the whole job: the step is finished and nothing about the `jobs` row
   * changes, so this writes the artefacts, checks them, completes the step and
   * stops. See `JobTransition`.
   *
   * Throws rather than returning an outcome. Every caller treats a refusal as a
   * step failure, and an outcome that has to be checked is one that can be
   * ignored.
   *
   * **It returns the settlement that happened, not the one it was handed** —
   * see `JobSettlement`.
   */
  commit(
    ctx: StepContext,
    step: PipelineStep,
    attempt: string,
    product: StepProduct,
    transition: JobTransition,
  ): Promise<JobSettlement>;
  /**
   * The job transition on its own, for the endings that have no product.
   *
   * Three reach this: a step that failed, a step the reader cancelled, and a
   * claim where **every step skipped** — which never calls `commit` at all and
   * was the third gap the review found. Routing them here means every terminal
   * job write in the runner goes through the session, so D1b has one seam rather
   * than one seam and three exceptions.
   *
   * **And the all-skipped case is not merely a job write.** Under Postgres this
   * claim opened a draft that copied the published revision forward, so an
   * ending that only touched the `jobs` row would leave that copy behind for the
   * sweeper and leave the reader on a revision this job never confirmed. The
   * transactional session publishes or discards it explicitly — see
   * `pgStoreSession` in src/store/pg-session.ts.
   *
   * **`JobEndTransition`, not `JobTransition`** — see that type for why a
   * release may not come through this door.
   */
  settleJob(transition: JobEndTransition): Promise<JobSettlement>;
}

/**
 * The six read operations, and nothing else reachable.
 *
 * Written out one by one rather than spread, because a spread of the store is
 * the store: `{ ...store }` carries `write`, `beginStep` and `finishStep` along
 * with the rest, and the only thing stopping a stage calling them would be the
 * type. `read` and `readBaseline` are generic, so they are methods rather than
 * arrow properties — an arrow with rest arguments loses the type parameter and
 * hands every caller back `unknown`.
 */
export function readsOf(store: ArtifactReads): ArtifactReads {
  return {
    has: (slug, step, kinds) => store.has(slug, step, kinds),
    hasEarlierBlocks: (slug) => store.hasEarlierBlocks(slug),
    read<K extends ArtifactKind>(slug: string, step: StepName, kind: K) {
      return store.read(slug, step, kind);
    },
    readBaseline<K extends ArtifactKind>(slug: string, step: StepName, kind: K) {
      return store.readBaseline(slug, step, kind);
    },
    stampFor: (slug, step) => store.stampFor(slug, step),
    interrupted: (slug, step) => store.interrupted(slug, step),
  };
}

/**
 * Is this product one the commit may act on at all? Throws if it is not.
 *
 * **Asked before anything is written**, which is not a detail. `assertProduced`
 * runs *after* the write and only asks whether each declared artefact is
 * readable now — its own comment admits it "cannot tell that this run wrote
 * them" (src/pipeline.ts). In Postgres `beginDraftIn` copies the previous
 * revision's artefacts into the draft before any stage runs, so a step that
 * returns `{ parts: {} }`, or a product holding one of the two things it
 * declares, writes nothing, passes the postcondition against the **carried
 * copy**, and is marked done. For `blocks` that commits new stamped HTML beside
 * old block rows: the identity loss this whole migration exists to prevent,
 * arriving through the coordinator meant to prevent it. GPT Sol, 2026-08-29,
 * docs/plans/260827aa-delete-the-importer-d1-design-sol.md finding 2.
 *
 * Four rules, and the second is the migration:
 *
 * 1. **A step must declare something.** `produces: []` with `parts: {}` would
 *    otherwise pass every check here and be marked done — while `has([], …)`
 *    deliberately answers `false`, so the step could never be considered done
 *    and would re-run for ever with nothing to show for it.
 * 2. **A product with no `parts` is permitted only for a step still on
 *    `LEGACY_UNCONVERTED_STEPS`** — and a transactional session passes an empty
 *    set, so no step is. Such a stage wrote its own files during `run`, which is
 *    what the filesystem runner has always done and what `assertProduced` then
 *    checks; the same stage under a transaction would write nothing and report
 *    success.
 * 3. **A product with `parts` must have all of them**, as its **own**
 *    properties. `ArtifactParts` is `Partial`, so nothing in the type system
 *    asks. `Object.hasOwn` rather than a lookup, because `write` iterates
 *    `Object.entries` and so writes none of a prototype's keys — an inherited
 *    `labels` would satisfy a lookup, be written nowhere, and then pass the
 *    postcondition against the artefact the draft carried forward. The same hole
 *    as rule 2 through a different door.
 * 4. **And nothing it does not declare.** An extra kind is a caller error, and
 *    the store finds out about it half way through: the filesystem adapter
 *    writes the valid entries and then throws on the unknown `(step, kind)`
 *    pair, leaving a step that is neither written nor untouched.
 *
 * `{}` is not "no parts". An empty object is truthy, has none of the declared
 * kinds, and would call `write` with nothing in it — so it goes through rule 3
 * and is refused by name.
 */
export function checkProduct(
  step: PipelineStep,
  product: StepProduct,
  unconverted: ReadonlySet<StepName>,
): void {
  if (step.produces.length === 0) {
    throw new ProductRefused(
      `${step.name} declares no artefacts, so nothing can say whether it ran. ` +
        `A step's "produces" is what the postcondition and the skip check are ` +
        `both asked about, and has([]) is false — this step could never be done.`,
    );
  }
  if (product.parts === undefined) {
    if (unconverted.has(step.name)) return;
    throw new ProductRefused(
      `${step.name} returned no artefacts to write, and it is not marked unconverted. ` +
        `A step that writes its own artefacts inside run() must be named in ` +
        `LEGACY_UNCONVERTED_STEPS (src/pipeline.ts); one that has been converted ` +
        `must return parts.`,
    );
  }
  const parts: Partial<Record<ArtifactKind, ArtifactMap[ArtifactKind]>> = product.parts;
  const missing = step.produces.filter(
    (kind) => !Object.hasOwn(parts, kind) || parts[kind] === undefined,
  );
  if (missing.length > 0) {
    throw new ProductRefused(
      `${step.name} returned a product missing ${missing.join(" and ")}, ` +
        `so nothing was written. A step that declares an artefact has to produce it: ` +
        `an artefact carried forward from the previous run would otherwise pass the ` +
        `postcondition and mark this step done.`,
    );
  }
  const declared = new Set<string>(step.produces);
  const extra = Object.keys(parts).filter((kind) => !declared.has(kind));
  if (extra.length > 0) {
    throw new ProductRefused(
      `${step.name} returned ${extra.join(" and ")}, which it does not declare in "produces". ` +
        `Refused before the write, because a store told to write an artefact a step does not ` +
        `own writes the valid ones first and then throws on the unknown one.`,
    );
  }
}

/**
 * A session over the filesystem, and **there is no transaction in it.**
 *
 * Said plainly rather than left to be inferred, because the shape of `commit`
 * invites the inference. The four things inside it — `write`, the postcondition,
 * `finishStep`, the job transition — happen one after another, and a kill
 * between any two of them leaves exactly the state it always did: artefacts on
 * disk and a `beginStep` marker still there saying the run did not finish, which
 * is what makes the next run re-run the step. That marker is the filesystem's
 * whole answer to atomicity, and it is weaker than a transaction rather than an
 * imitation of one.
 *
 * What this session *does* buy on the filesystem is the boundary: the runner has
 * one place where a step's product is written and checked and completed and the
 * job moves on, so D1b can make that place atomic without touching the runner
 * again.
 *
 * `unconverted` is a parameter with a default rather than a lookup, so that the
 * Postgres session can pass an empty set and so that a test can make a step
 * converted without editing the production list.
 */
export function fsStoreSession(options: {
  artifacts: ArtifactStore;
  jobs: JobSettles;
  unconverted?: ReadonlySet<StepName>;
}): StoreSession {
  const { artifacts, jobs, unconverted = UNCONVERTED_STEPS } = options;
  /* **Through `settlementOf`, on the filesystem too.** `jobs-fs.ts`'s
     `releaseStep` has the same cancelling branch the Postgres one has — Stop
     arriving mid-step lands on the release — so a filesystem caller that read
     the outcome off its own request would be wrong in exactly the same way. */
  const settleJob = async (transition: JobSettlingTransition): Promise<JobSettlement> =>
    settlementOf(
      transition,
      transition.kind === "release"
        ? await jobs.releaseStep(
            transition.jobId,
            transition.attempt,
            transition.steps,
            transition.fields,
          )
        : await jobs.finish(transition.jobId, transition.attempt, transition.ending),
    );

  return {
    reads: readsOf(artifacts),
    beginStep: (slug, step) => artifacts.beginStep(slug, step),
    settleJob,
    async commit(ctx, step, attempt, product, transition) {
      checkProduct(step, product, unconverted);
      if (product.parts) {
        await artifacts.write(ctx.slug, step.name, product.parts, product.stamp ?? {});
      }
      /* Still asked, and still the guard it always was: `checkProduct` knows
         what the step *says* it made, and this knows what the store can actually
         read back. An unconverted step passes the first and is caught by the
         second when its own writes did not land. */
      await assertProduced(step, ctx, artifacts);
      await artifacts.finishStep(ctx.slug, step.name, attempt);
      /* **Nothing else on a `keep`.** The step is done and the claim is staying
         where it is, so there is no job write to make here at all — the
         coordinator's `noteProgress` catches the row up outside this call, which
         is where a progress note belongs. See `JobTransition`. */
      if (transition.kind === "keep") return { kind: "kept" };
      /* **Last, and inside the same call.** Under D1b this is the statement that
         has to share a transaction with the three above it: without that there
         is a window in which `settleExpired` invalidates the attempt after the
         artefacts have committed, and the revision says done while the job says
         interrupted. On the filesystem it is simply the next write. */
      return await settleJob(transition);
    },
  };
}
