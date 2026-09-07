/**
 * The life of a revision: begin a draft, fill it in, publish it or fail it.
 *
 * **There was no publication path before this file.** The only code that ever
 * made a revision current was the tail of `importArticle`'s transaction, which
 * is a migration tool. So the schema's promise — *the pipeline builds a draft
 * and publishes it in one step, so a reader sees either the previous published
 * revision or the complete new one and never a mixture* — had nothing behind
 * it. This is that path. docs/plans/260826e-postgres-storage-implementation.md § Step 11
 * half A.
 *
 * ## Why it is `pg-revisions.ts` and not `revisions.ts`
 *
 * The plan said `src/store/revisions.ts`. Every unprefixed file in this
 * directory was either store-agnostic (`contracts.ts`) or the filesystem
 * (`fs.ts`, `artifacts-fs.ts`, both deleted 2026-09-05), and every Postgres
 * adapter is `pg-*` —
 * `pg-chat`, `pg-comments`, `pg-lookups`, `pg-searches`, `pg-shelf`. A bare
 * `revisions.ts` would read as the seam rather than as one adapter, and there
 * is no filesystem notion of a draft revision for a seam to sit above:
 * `data/<slug>/` is one directory that is overwritten in place. So it is named
 * for what it is.
 *
 * ## The one rule everything here turns on
 *
 * **A new draft starts as a copy of the current published revision, and each
 * step overwrites what it owns.** That is not a new invention — it is what the
 * filesystem does for free, because `data/<slug>/` outlives any one step:
 * re-running `blocks` overwrites `blocks.json` and leaves `glossary.json` beside
 * it. As columns on one row, a new revision starts NULL, so a reader's paid-for
 * glossary would become *"nobody has found the terms for this one yet"* under a
 * green tick.
 *
 * The copy is expressed as a **denylist** (`REVISION_CARRY_POLICY`) rather than
 * as a list of columns to carry, because an allowlist is something somebody has
 * to remember to extend, and this repo already knows how that ends —
 * tests/store-artefact-manifest.test.ts exists because five artefacts appeared
 * under a one-day-old schema.
 *
 * ## Where the copy happens, and why it is at the beginning
 *
 * At `beginRevision`, never at `publishRevision`. Three reasons, the first
 * decisive:
 *
 * 1. **A step reads its siblings.** `generateArc` reads the tree;
 *    `generateGlossary` reads blocks, tree and the previous glossary, which it
 *    *appends* to. Filling NULLs at publish time means a `blocks`-only draft has
 *    a NULL tree all job long, and `arc` in the same job fails.
 * 2. **Publish-time filling cannot tell "nobody produced it" from "the reader
 *    deleted it".** `deleteGlossary` is a real, reachable write. Copying
 *    whatever is there, NULL included, means the question never arises.
 * 3. Publish-time filling is a hand-written `coalesce` per column — the
 *    allowlist again.
 *
 * **From the current published revision only.** Never walking back to the last
 * revision that *had* a glossary: that is how a deleted glossary returns weeks
 * later. There is deliberately no "carry from this job's own previous draft"
 * either — see `beginRevision`.
 *
 * ## What this file may log
 *
 * Slugs, ids, counts, statuses. Never article prose, never a title.
 */

import { randomUUID } from "node:crypto";

import { and, asc, eq, getTableColumns, inArray, lt, sql } from "drizzle-orm";

import { getDb } from "../db/client.js";
import {
  articleRevisions,
  articles,
  jobs,
  revisionBlocks,
  revisionStepRuns,
} from "../db/schema.js";
import { isReservedSlug, shortIdInSlug } from "../ingest.js";
import { mintId } from "../ids.js";
import { log } from "../log.js";
import {
  codeOfMessage,
  PUBLICATION_MOVED_ON,
  PUBLICATION_REFUSED,
  type FailureKind,
  type ReaderFacingFailure,
} from "../messages.js";
import { currentOwnerId } from "../owner.js";
import { hashBlocks } from "../source-hash.js";
import { checkTree } from "../tree-invariants.js";
import type { Block, OwnerId, StepName, Tree } from "../types.js";
import { deriveLibraryScalars } from "../library-scalars.js";
import { READ_COMMITTED } from "./isolation.js";
import { REVISION_PROJECTIONS, ownedSlug, requireSlug } from "./pg.js";
import { slugIsTaken } from "./slug-is-taken.js";
import { NO_INPUT_HASH, PIPELINE_RUN, hierarchyCurrency } from "./artifacts.js";
import { liveAttempt } from "./job-fence.js";
import { enqueueSuccessorIn } from "./pg-jobs.js";

const logger = log("store");

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/* ------------------------------------------------------ the column policy -- */

/**
 * What happens to one column of `article_revisions` when a new draft is minted.
 *
 * - `mint` — never copied. The new row gets its own value.
 * - `derive` — recomputed at publish, from the blocks and the tree.
 * - `carry` — copied from the current published revision, and overwritten by
 *   whichever step owns it if that step runs.
 */
export type RevisionColumnPolicy = "mint" | "derive" | "carry";

/**
 * Every column of `article_revisions`, and what happens to it. **Exhaustive.**
 *
 * A `Record` keyed on the table's own columns, so a column added to
 * `src/db/schema.ts` fails the *typecheck* until somebody decides about it.
 * `tests/store-revision-policy.test.ts` closes the other half — a column added
 * by a SQL-only migration never reaches `getTableColumns`, so the test compares
 * this map against the live table's columns too.
 *
 * **Carry-by-default is the dangerous default, not the safe one**, and a review
 * was right to push back on the first version of this design, which built the
 * carry set as "everything minus two short lists". A later `validated_at`,
 * `published_at`, `job_id` or `attempt_id` would be actively harmful copied:
 * new content inheriting an old certification, or an old worker's ownership. So
 * the map is exhaustive and an unclassified column is an error rather than a
 * carry.
 *
 * That paragraph named `based_on_revision_id` as a fourth hypothetical until
 * 2026-09-01, when it became a real column — and it is the sharpest case for
 * the rule: carried, every draft would inherit *its parent's* base, so the
 * publication guard would compare the wrong pair and pass exactly the race it
 * exists to refuse. It is `mint`, and the entry below says so out loud.
 */
export const REVISION_CARRY_POLICY: Record<
  keyof typeof articleRevisions.$inferSelect,
  RevisionColumnPolicy
> = {
  /* ---- MINT: never copied ------------------------------------------------ */

  /** A fresh uuid. See `beginRevision` on why it is not derived from anything. */
  id: "mint",
  /** The article being revised is an argument, not something to inherit. */
  articleId: "mint",
  /** A copied `status` would publish a draft the moment it was created. */
  status: "mint",
  /**
   * **The lineage, and it is written by `beginDraftIn` rather than copied.**
   *
   * The new row's value is the revision *this* mint copied from — `basedOn`
   * below — which is the whole content of the column (src/db/schema.ts). A
   * carry would give a draft its grandparent, quietly, and the lineage check in
   * `publishRevisionIn` would then wave through the publication it is there to
   * refuse.
   */
  basedOnRevisionId: "mint",
  /**
   * When this revision was made — the revision's own clock, not its parent's.
   *
   * **The reasoning in the plan was backwards and it is worth keeping the
   * correction.** It said copying `created_at` reorders the library. It is
   * *minting* that reorders it, for any article whose `fetched_at` is null,
   * because the shelf sorts on `coalesce(fetched_at, …)`. The answer is not to
   * copy a lie about when this row was written; it is to give the shelf an
   * article-level added-time to fall back on, which is what `ADDED_AT` in
   * src/store/pg.ts now does.
   */
  createdAt: "mint",

  /* ---- DERIVE: recomputed at publish ------------------------------------- */

  /* **This is the resurrect-dead-data case, and it is the real hazard in the
     whole step.** All five are derivations of `revision_blocks` and `tree`. A
     carried `block_count` sitting beside changed blocks is not a stale artefact
     with a banner — it is a wrong number the library prints as fact, and
     nothing anywhere can tell. `deriveLibraryScalars` computes them. */
  wordCount: "derive",
  blockCount: "derive",
  partCount: "derive",
  sectionCount: "derive",
  rootGist: "derive",

  /* ---- CARRY: everything else, each owned by a step ---------------------- */

  // Stage 2's reading of the piece.
  title: "carry",
  byline: "carry",
  siteName: "carry",
  lang: "carry",
  excerpt: "carry",
  /* Carries with the rest of stage 2's metadata, and `metaColumns` in
     src/store/artifacts-pg.ts writes `?? null` so a re-extraction that finds no
     date clears it rather than leaving this one behind. Note this is **not** the
     `published_at` the carry-policy header warns about — that one is a
     hypothetical column recording when *we* published a revision, and it would
     be actively harmful carried. This is the publisher's own claim about their
     article, which is exactly the kind of fact stage 2's other columns carry. */
  publishedAt: "carry",
  note: "carry",

  // Stage 1: what was fetched, and what came back.
  requestedUrl: "carry",
  finalUrl: "carry",
  fetchedAt: "carry",
  rawContentType: "carry",
  rawEncoding: "carry",
  rawSha256: "carry",
  /* Both new on 2026-08-28, and both carry for the same reason the reference
     does: `beginDraftIn` copies the successful `fetch` run forward, so a job
     that does not re-fetch must keep the document's facts with it. A draft that
     inherited the reference and lost the byte count would describe an object it
     could no longer size. */
  rawByteCount: "carry",
  rawFilename: "carry",
  /**
   * The reference to the object in the `sources` bucket — carried, beside the
   * hash and the bytes it belongs with.
   *
   * **Carrying is what makes the publication rule work rather than a hole in
   * it.** `beginDraftIn` copies `revision_step_runs` forward too, so a
   * re-extraction job inherits the previous revision's successful `fetch` run;
   * if the reference did not travel with it, that job would publish a revision
   * claiming a fetch it has no source for. They move together, and the article
   * keeps the document it was made from until something actually re-fetches it.
   *
   * Both halves, and the `article_revisions_raw_source_both` CHECK means the
   * database refuses a copy that takes only one. docs/plans/260827o-raw-bytes-in-storage.md.
   */
  rawSourceSha256: "carry",
  rawSourceKind: "carry",

  // Stage 2 again: how a PDF was read. All null for a web page.
  source: "carry",
  extractMethod: "carry",
  pages: "carry",
  unverified: "carry",
  recall: "carry",
  pagesChecked: "carry",

  extractedHtml: "carry",
  stampedHtml: "carry",

  /* `tree`, `labels` and `arc` carry too, and they are the uncomfortable case:
     a `{ steps: ["blocks"] }` job would publish new paragraphs under the
     previous tree, whose `range` pairs may name block ids that no longer exist.
     On the filesystem that is invisible. Here there is one row, so the mismatch
     becomes visible — and the answer is not to skip the carry (a NULL tree is an
     unreadable article) but to refuse the publication. `publishRevision`. */
  tree: "carry",
  labels: "carry",
  /* **Carries with the two above, and it has to be those two it travels with.**
     It is a fact about the labels — where they are in their life — so a
     `{ steps: ["blocks"] }` job that copies `labels` forward and leaves this
     behind would publish a revision holding last run's labels under this run's
     default. `derive` is the wrong shape for it (there is nothing to recompute
     it from: an empty labels map is what *both* "no labels yet" and "no
     labellable leaves" look like), and `mint` would reset every draft of a
     `pending` article back to `ready` and lose the fact that a run is owed.
     src/db/schema.ts § `navLabelStatus`. */
  navLabelStatus: "carry",
  arc: "carry",

  /* The image manifest carries, and the reason is the one thing about it that
     is not obvious: the objects it names are **content-addressed and never
     deleted** (src/store/blobs.ts), so a carried manifest cannot come to point
     at bytes that have gone. A `{ steps: ["blocks"] }` job that does not re-run
     `assets` therefore keeps a manifest that is still true about every hash in
     it, and the article goes on serving its own images instead of silently
     reverting to hot-linking the publisher.

     Its staleness is answered the same way as its neighbours' — `sourceHash` on
     the artefact against the blocks now — so a manifest that no longer matches
     the paragraphs is *visible* rather than trusted, and the step re-runs. Not
     carrying it would be the worse failure: an article that hot-links again
     after an unrelated re-run, with nothing anywhere saying so. */
  assets: "carry",

  tweets: "carry",
  glossary: "carry",
  /* Carries like its neighbours, and it is the one where a carried artefact
     can be more than dated: every quote holds a block id and a string that
     were both verified against the previous revision, so a carried list on a
     re-extracted article may name paragraphs that are gone and words that are
     no longer there. `stale` is computed at read time from `sourceHash` and
     the panel says so — which is the same bargain the sketch strikes below:
     something to look at, honestly labelled, until the step re-runs. */
  quotes: "carry",
  /* Carries like its four neighbours, and its staleness is answered the same
     way: `sourceHash` on the artefact against the blocks and tree now, computed
     at read time. What is different is that a carried `ideas` also survives a
     profile change — deliberately, because the artefact says which profile it
     was written for and `stepIsDone` compares it, so the *step* re-runs while
     the *reader* keeps something to look at until it does. */
  ideas: "carry",
  /* Carries, like its five neighbours, and its staleness is answered the same
     way: `sourceHash` on the artefact against the blocks and tree now, computed
     at read time. Carrying matters more here than for any of them — a re-ingest
     that dropped the picture would leave the band empty for two minutes and
     $0.20, where a carried one goes on being *drawn* and loses only the clicks
     whose block ids no longer resolve. That degradation is `readSketch`'s, and
     it is the reason a stale sketch is worth keeping rather than discarding. */
  sketch: "carry",
  /* Carries like the six above, and the same read-time `sourceHash` answers
     whether it is stale — with one input none of them has: the publication
     date. So a re-extraction that changes only the date leaves this artefact
     carried and correctly reported stale, which is what we want, because every
     year-less date in it was read against the old one. */
  timeline: "carry",
  /* Carried, like every other artefact column: a new revision starts with the
     questions the last one had, and the `quiz` step overwrites them if it runs.
     The `sourceHash` on the artefact is what tells the panel the article moved
     underneath them — carrying is not a claim that they are still current. */
  quiz: "carry",
  /* Carries like the seven above, and it is the one where carrying costs
     nothing at all: the plates are content-addressed objects in the blob store
     and the column holds only their hashes, so a new draft inherits pictures
     that are still there rather than references to something deleted.
     Staleness is answered at read time from `sourceHash` — against the
     **Sketch** rather than the article, src/illustrated.ts § `inputFingerprint`
     — so a re-ingest that moves the article leaves the picture carried, drawn,
     and honestly labelled until somebody redraws the Sketch. */
  illustrated: "carry",
  /* Carries like the eight above, and here the argument for carrying is the
     strongest in the table: **this artefact is not about the article, it is
     about the web**, so a re-extraction is no reason at all to lose it. Every
     other carried artefact is a paid reading of a text that has just changed;
     this one is a record of what other people wrote, and that does not stop
     being true when Readability re-cuts a paragraph.

     What a re-extraction does cost is the group-two rows' anchors — a
     `claimQuote` located in a block id that has moved — and `sourceHash` on the
     artefact is what tells the panel so at read time. Carrying is not a claim
     that it is current, and the honest degradation is a list still worth
     reading with some of its jumps gone, at up to $0.27 a run to buy back. */
  debate: "carry",
};

const MINTED = new Set(
  (Object.keys(REVISION_CARRY_POLICY) as (keyof typeof REVISION_CARRY_POLICY)[]).filter(
    (k) => REVISION_CARRY_POLICY[k] === "mint",
  ),
);
const DERIVED = new Set(
  (Object.keys(REVISION_CARRY_POLICY) as (keyof typeof REVISION_CARRY_POLICY)[]).filter(
    (k) => REVISION_CARRY_POLICY[k] === "derive",
  ),
);

/**
 * The columns a new draft copies, read off the schema rather than listed.
 *
 * Computed once at module load, and it **throws** rather than shrugging if the
 * live table has a column the policy map does not classify. That is the runtime
 * half of the guarantee the `Record` type gives at compile time, and it is not
 * redundant: a column added by a hand-written SQL migration is invisible to
 * TypeScript and would otherwise be silently dropped from every carry-forward,
 * which is the quietest possible way to lose a reader's glossary.
 */
function carriedColumns(): (keyof typeof articleRevisions.$inferSelect)[] {
  const declared = Object.keys(getTableColumns(articleRevisions)) as (keyof typeof articleRevisions.$inferSelect)[];
  const unclassified = declared.filter((name) => !(name in REVISION_CARRY_POLICY));
  if (unclassified.length) {
    throw new Error(
      `article_revisions has ${unclassified.length} column(s) with no carry-forward policy: ` +
        `${unclassified.join(", ")}. Add each to REVISION_CARRY_POLICY in src/store/pg-revisions.ts ` +
        `— a new column must not be carried or dropped by accident.`,
    );
  }
  return declared.filter((name) => !MINTED.has(name) && !DERIVED.has(name));
}

/* --------------------------------------------------- the derived scalars -- */

/**
 * **`deriveLibraryScalars` moved to src/library-scalars.ts on 2026-08-28**, and
 * is re-exported here rather than merely relocated.
 *
 * It moved because the shelf stopped recomputing these per request and started
 * reading the columns this file writes — which meant `describeArticle` in
 * src/api.ts, the **filesystem** store, needed the same function, and importing
 * this module there would drag drizzle and the pool into the path that exists
 * so the app runs without a database.
 *
 * It is re-exported because this is still part of this module's surface:
 * `PublishResult.scalars` is typed from it. (The second reason was
 * src/store/import.ts, a store module reaching for its neighbour; it was deleted
 * on 2026-09-01 with the rest of the importer.) See
 * docs/plans/260828c-library-read-latency.md § 1.
 */
export { deriveLibraryScalars, type LibraryScalars } from "../library-scalars.js";

/* ------------------------------------------------------------- the errors -- */

/**
 * **Whether this door is ever going to open**, which is the one thing about a
 * refusal that nobody could ask until 2026-09-07.
 *
 * `permanent` — the same job, retried, meets the identical refusal. A retry is
 * narrower than a re-run: it **skips every step that finished**, so a bad tree,
 * a `hierarchy` run against different blocks, or a revision that is not this
 * article's is read straight back off the same rows.
 *
 * `transient` — the article moved on underneath this draft. Nothing is wrong
 * with it or with the article; somebody published first, and the next attempt
 * starts from where the article now is.
 *
 * **Two, and there is no third.** The thirteen distinct reasons below are all
 * diagnostics already, and they already reach the log; the bit that was missing
 * was the one that decides whether to spend another model call. See
 * docs/plans/260907a-publish-refusal-reason-kinds-permanent-vs-transient.md
 * § Two kinds only for the per-reason enum that was deliberately not built.
 *
 * **The parameter is `refusal`, not `kind`**, because `FailureKind` in
 * src/messages.ts is already *the* `kind` on an error three files away, and two
 * meanings of one word at one call site is how the next reader gets it wrong.
 * It is not kept as a field — see the class below.
 */
export type RefusalKind = "permanent" | "transient";

/**
 * What each kind means to a reader, as a **total** map, so a third `RefusalKind`
 * cannot be added without a sentence for it — the discipline `KNOWN_KINDS` in
 * src/job-failure.ts and `RETRYABLE` in src/messages.ts already keep.
 */
const REFUSAL_FAILURES: Record<RefusalKind, ReaderFacingFailure> = {
  permanent: PUBLICATION_REFUSED,
  transient: PUBLICATION_MOVED_ON,
};

/**
 * A publication that was refused, with every reason at once.
 *
 * Every reason rather than the first, because the caller is a person looking at
 * a failed ingest: "the tree does not cover block 41" and "the tree was built
 * from different blocks" are one fix, and reporting them one run at a time
 * teaches whoever is fixing it that the check is unreliable.
 *
 * `status: 409` so src/routes.ts answers a conflict rather than a 500 — this is
 * a draft that is not fit to publish, not a server fault.
 *
 * ## Why it says which kind it is
 *
 * It carried `reasons` and nothing else for its first year, so `failureKindOf`
 * (src/job-failure.ts) found nothing to read and **every** refusal fell through
 * to `retry` — the compatibility default, which is the right way to be wrong
 * about a failure nobody classified and the wrong answer here.
 *
 * On 2026-09-05 a `checkTree` rule tightened over already-stored trees took
 * roughly one article in twenty off the air, permanently, and every attempt to
 * publish anything for one of them completed and **paid for** its model call
 * before reaching this door. Four refusals on `nagel-bat` in thirteen minutes —
 * $0.0378, $0.0348, $0.2454, $0.0365 — each one telling the reader that trying
 * again was worth a go. It was not: the failure was deterministic, permanent,
 * and charged.
 * docs/postmortems/260905f-a-tightened-tree-rule-wedged-every-article-that-already-broke-it.md.
 *
 * ## The three fields, and who reads each
 *
 * - **`failureKind` and `readerFailure`** are read by `failureKindOf` and
 *   `readerFailureOf` in src/job-failure.ts, and **only** by those two — that
 *   file's `KindedError` says so, and the rule is about *reading*: keeping
 *   "nobody said, so offer another go" in one place. Declaring them is what a
 *   throw site is supposed to do, and `TooLongForOnePass` (src/token-budget.ts)
 *   is the precedent for a *class* doing it, including why `stageFailure` is
 *   not the answer when the class itself is `instanceof`-significant. So this
 *   plugs into the seam rather than adding a second one — which is why
 *   `src/jobs.ts` needed no change at all.
 * - **`code`** is for monitoring. `SAFE_PROPS` in src/monitoring-scrub.ts
 *   forwards it to Sentry as a tag and `SAFE_ERROR_PROPS` in src/log.ts puts it
 *   on the log line, so two occurrences of a permanent refusal stop reading as
 *   noise. Derived from the reader sentence rather than written out again, so
 *   the two cannot drift.
 *
 * There is deliberately **no `refusal` field**. The discriminator is required at
 * every throw site, which is where the decision belongs, and `failureKind` and
 * `code` are already two copies of the answer — a third would be state nothing
 * reads. ⟨Sol, 2026-09-07⟩
 *
 * **What is deliberately not done: the code is not appended to `message`.** That
 * is the obvious way to make a refusal legible in Sentry and it is the one that
 * must not be taken. `authored` in src/monitoring-scrub.ts does not ask *is
 * there a code* — it treats a registered code as **proof that we wrote the whole
 * string**, and `sanitise` then forwards the message verbatim. This message
 * interpolates the **slug**, which is a path segment derived from the article's
 * own title (src/store/db-errors.ts makes the same point about a slug in an
 * error), and `reasons` is an unrestricted `string[]` that any future caller may
 * fill from anywhere. Appending a code would sell that certificate to all of it.
 * This is the six-hour hole of 2026-09-03 exactly, written up in
 * src/job-failure.ts § *The detail goes on verbatim*; the message stays free
 * text, stays withheld, and stays in the log where it belongs.
 *
 * ⟨Sol, 2026-09-07⟩ corrected the reason this note first gave — that a
 * `checkTree` **problem** can quote a nav label. It cannot: src/tree-invariants.ts
 * routes the nav-label complaint through `warn` into `advice`, and states as an
 * invariant that no `problems` string carries article prose. The conclusion is
 * unchanged; only its evidence was wrong, and a note resting on a false premise
 * is one somebody disproves and then deletes.
 */
export class PublishRefused extends Error {
  readonly status = 409;
  readonly reasons: readonly string[];
  /** The reader's sentence's bracketed code, for Sentry and the log. */
  readonly code: string | undefined;
  /** Read by `failureKindOf` in src/job-failure.ts, and by nothing else. */
  readonly failureKind: FailureKind;
  /** Read by `readerFailureOf` in src/job-failure.ts, and by nothing else. */
  readonly readerFailure: ReaderFacingFailure;
  constructor(slug: string, refusal: RefusalKind, reasons: readonly string[]) {
    super(`Refusing to publish "${slug}": ${reasons.join("; ")}`);
    this.name = "PublishRefused";
    this.reasons = reasons;
    const failure = REFUSAL_FAILURES[refusal];
    this.failureKind = failure.kind;
    this.readerFailure = failure;
    /* `?? undefined` rather than a fallback string: every message in
       src/messages.ts carries a registered code and tests/messages.test.ts
       fails if one does not, so this branch is unreachable — and an *empty*
       `code` tag in Sentry would be worse than no tag, while `undefined` is
       dropped by both allowlists. */
    this.code = codeOfMessage(failure.message) ?? undefined;
  }
}

/**
 * The fence said no: this job is not the one entitled to write.
 *
 * Thrown when the fenced `UPDATE` on `jobs` affects zero rows, which means the
 * attempt token is stale, the job is no longer `running`, or the job is gone.
 * **It is an error and never a quiet return**, because the caller's next line
 * would otherwise report a successful publication that did not happen.
 */
export class NotTheLiveAttempt extends Error {
  readonly status = 409;
  constructor(jobId: string) {
    super(`Job ${jobId} is not the live attempt — its draft was not published.`);
    this.name = "NotTheLiveAttempt";
  }
}

/**
 * The claim is still live, and the draft it was writing into is not its own.
 *
 * **The other half of a fence that used to raise one error for two events**, and
 * the difference is the whole of
 * docs/postmortems/260902f-a-lost-claim-that-was-never-lost-and-a-publication-that-was-never-buried.md:
 * `NotTheLiveAttempt` means somebody else owns this job, so walking away is
 * right; this means *nobody* else owns it — the row is still `running`, still
 * leased to this attempt — and the only thing that moved is
 * `jobs.draft_revision_id`. Walking away from that leaves the job wedged until
 * the lease lapses, with `claim` unable to take a `running` row and `Stop`
 * setting a `cancelling` flag no claimant is left to read.
 *
 * **Nothing in `src/` writes the pointer to null behind a live claim**, so when
 * this is raised the cause is almost always the foreign key: `draft_revision_id`
 * is `on delete set null` (src/db/schema.ts), and anything that deletes the
 * draft revision — a fixture reset, a hand-run script, a future *start this
 * article again* — takes the pointer out of the job row silently.
 *
 * `status: 409` so it passes src/store/db-errors.ts untouched, the way the doc
 * at the head of that file asks a new refusal to. The message names two ids we
 * minted and nothing else.
 */
export class JobDraftGone extends Error {
  readonly status = 409;
  constructor(
    readonly jobId: string,
    readonly expected: string,
    readonly found: string | null,
  ) {
    super(
      `Job ${jobId} still holds its claim but no longer points at revision ${expected} ` +
        `(it points at ${found ?? "no draft at all"}) — the draft was taken away underneath it.`,
    );
    this.name = "JobDraftGone";
  }
}

/* ---------------------------------------------------------------- helpers -- */

/** The article row, locked for the length of the transaction. */
async function lockArticle(
  tx: Tx,
  slug: string,
): Promise<typeof articles.$inferSelect | undefined> {
  const rows = await tx
    .select()
    .from(articles)
    .where(ownedSlug(slug))
    .limit(1)
    .for("update");
  return rows[0];
}

/**
 * The article row for this slug, **locked** — created first if it is not there.
 *
 * `lockArticle` can only lock a row that exists, and "there is no row yet" is
 * the ordinary state of a first ingest. That is fine for a reader; it is not
 * fine for the lock order, because *article lock before job lock, everywhere*
 * cannot be kept by a caller that had nothing to lock. So this makes the row
 * exist, and a caller that goes on to refuse the job simply rolls the insert
 * back with the rest of its transaction.
 *
 * It was `beginDraftIn`'s opening block until 2026-08-29 and moved out unchanged
 * when `openOrBeginJobDraft` came to need the same thing one step earlier. A
 * fresh insert is locked by definition: nobody else can see the row until this
 * transaction commits.
 *
 * **Exported for the transactional store session** (src/store/pg-session.ts),
 * which takes this lock at the top of every commit — including the commits that
 * will not publish and therefore have no other reason to want it. That is the
 * lock order being enforceable rather than argued: a transaction that took the
 * job lock first and reached `publishRevisionIn` later would still be
 * job→article, and being inside one transaction does not stop it deadlocking
 * with an article→job one.
 */
export async function lockOrCreateArticle(
  tx: Tx,
  slug: string,
): Promise<typeof articles.$inferSelect> {
  const found = await lockArticle(tx, slug);
  if (found) return found;

  /* **The one name an article may not be born with**, and it is checked here
     rather than in `isSlug` because this is the only line in the repo that
     brings an article address into existence — `POST /api/jobs` can name a slug
     directly (the "adopted" branch of `enqueue`, src/jobs.ts), so a check that
     lived only beside the minter would miss the path a client controls.

     **After the lock attempt and before the insert**, deliberately: an article
     that already holds the name on some deployment goes on being locked, read,
     re-extracted and repaired exactly as before. What is refused is *taking* the
     name, which is the only thing that could newly collide with `/read/public`.
     src/ingest.ts § `isReservedSlug` has the routing argument. */
  if (isReservedSlug(slug)) {
    /* `permanent`: the slug **is** the request. Every retry of this job asks for
       the same reserved name and is refused in the same line. */
    throw new PublishRefused(slug, "permanent", [
      `"${slug}" is an address the app already uses — /read/${slug} is the shelf of ` +
        "public articles, not an article. Choose another name.",
    ]);
  }

  /* **The short id is minted here because this is where the row is born.**
     The slug already ends in one (src/ingest.ts § `slugWithShortId`), so the
     ordinary case is to lift it out rather than mint a second — but a slug from
     before 2026-08-31, or one a reader later renames, has none, and the column
     is the copy that has to survive either. `?? mintId()` is what makes it a
     handle rather than a substring. src/db/schema.ts § `shortId`. */
  const inserted = await tx
    .insert(articles)
    .values({ ownerId: currentOwnerId(), slug, shortId: shortIdInSlug(slug) ?? mintId() })
    /* Another transaction may have inserted this slug between our lock
       attempt and here — the lock cannot protect a row that does not exist
       yet. `do nothing` plus a re-read is the honest handling; `do update`
       would rewrite somebody's shelf state to defaults. */
    .onConflictDoNothing({ target: articles.slug })
    .returning();
  const article = inserted[0] ?? (await lockArticle(tx, slug));
  if (article) return article;

  /* **Two readings of "we could not get this row", and they want different
     words.**

     `lockArticle` is owner-filtered (src/store/pg.ts § `ownedSlug`), and
     `articles.slug` is globally unique — so the ordinary way to get here is not
     a race at all: somebody else already owns this slug. The insert did nothing,
     the reread found nothing, and the generic message sent whoever hit it
     looking for a locking bug.

     Distinguished by asking, unfiltered, whether the row exists at all.
     GPT Sol raised the confusion reviewing the ownership work, 2026-08-27;
     what it does NOT do is let two readers keep the same URL, which is still an
     open question rather than a thing that works. */
  if (await slugIsTaken(slug, tx)) {
    /* `permanent`, and it is the known limit rather than a race: `articles.slug`
       is unique across the whole install, so nobody gives this name back. */
    throw new PublishRefused(slug, "permanent", [
      `the slug "${slug}" already belongs to another reader — ` +
        "slugs are unique across the whole install, which is a known limit",
    ]);
  }
  throw new Error(`Could not create or lock the article row for "${slug}".`);
}

/**
 * The blocks of one revision, in document order, as `Block`s.
 *
 * Not `src/store/pg.ts`'s `blocksFor`: that one runs the stored blocks through
 * the sanitiser, which is right for something on its way to a browser and wrong
 * here. `hashBlocks` and `checkTree` must see what is actually stored, or the
 * publication guard checks a tree against blocks the row does not contain.
 *
 * `fts` is never selected. It is a generated column, it is a lexeme dump, and
 * nothing in TypeScript is allowed to read it.
 */
async function storedBlocks(tx: Tx | Db, revisionId: string): Promise<Block[]> {
  const rows = await tx
    .select({
      id: revisionBlocks.blockId,
      tag: revisionBlocks.tag,
      kind: revisionBlocks.kind,
      level: revisionBlocks.level,
      text: revisionBlocks.text,
      words: revisionBlocks.words,
      html: revisionBlocks.html,
      gistable: revisionBlocks.gistable,
      note: revisionBlocks.note,
      role: revisionBlocks.role,
      treatment: revisionBlocks.treatment,
      noteId: revisionBlocks.noteId,
      contextId: revisionBlocks.contextId,
      contextType: revisionBlocks.contextType,
    })
    .from(revisionBlocks)
    .where(eq(revisionBlocks.revisionId, revisionId))
    .orderBy(asc(revisionBlocks.ordinal));

  return rows.map((row) => ({
    id: row.id,
    tag: row.tag,
    kind: row.kind as Block["kind"],
    ...(row.level === null ? {} : { level: row.level }),
    text: row.text,
    words: row.words,
    html: row.html,
    gistable: row.gistable,
    ...(row.note === null ? {} : { note: row.note }),
    ...(row.role === null ? {} : { role: row.role as NonNullable<Block["role"]> }),
    ...(row.treatment === null ? {} : { treatment: row.treatment as NonNullable<Block["treatment"]> }),
    ...(row.noteId === null ? {} : { noteId: row.noteId }),
    ...(row.contextId === null || row.contextType === null
      ? {}
      : { context: { id: row.contextId, type: row.contextType as "callout" } }),
  }));
}

/**
 * Point the job at its draft, or take the pointer away, **fenced**.
 *
 * One `UPDATE`, whose `WHERE` carries the whole condition: this job, this
 * attempt, `status = 'running'`, and a lease that has not lapsed. Checking the
 * token and then writing separately recreates exactly the race the token
 * exists to prevent.
 *
 * `AND status = 'running'` is not decoration. Without it, a rescued job's stale
 * worker publishes a draft the queue has already given up on — and reports
 * success.
 *
 * **Nor is the lease**, and this file was missing it until 2026-09-01: a
 * claimant whose deadline had passed could still move the pointer, and on the
 * publication path (`publishRevision` → `fenceJob(…, null)`) could still
 * publish, as long as it got there before the sweep. `liveAttempt` is that
 * whole condition, shared with src/store/pg-jobs.ts so the two cannot drift.
 * GPT Sol, 2026-09-01, finding 1 on the built stage 2.
 */
async function fenceJob(
  tx: Tx,
  jobId: string,
  attemptId: string,
  draftRevisionId: string | null,
): Promise<void> {
  const result = await tx
    .update(jobs)
    .set({ draftRevisionId })
    .where(liveAttempt(jobId, attemptId));
  // `rowCount === 1`, never `>= 1` and never ignored: zero rows here is the
  // fence doing its job, and it must reach the caller as a failure.
  if (result.rowCount !== 1) throw new NotTheLiveAttempt(jobId);
}

/* ----------------------------------------------------------- beginRevision -- */

export interface BeginRevisionOptions {
  readonly slug: string;
  /**
   * The job that will own this draft, if there is one.
   *
   * When given, `jobs.draft_revision_id` is set to the new draft inside the
   * same transaction and **fenced** on `attemptId` and `status = 'running'`, so
   * a worker whose lease has expired cannot take ownership of a fresh draft.
   * `attemptId` is required alongside it for the same reason src/db/schema.ts
   * gives for `jobs_running_is_fenced`: an attempt with no token fences nothing
   * while looking exactly like one that does.
   */
  readonly job?: { readonly id: string; readonly attemptId: string };
}

export interface BeginRevisionResult {
  readonly revisionId: string;
  readonly articleId: string;
  /** The revision it was copied from, or null for an article's first draft. */
  readonly basedOn: string | null;
  readonly blocksCopied: number;
  readonly stepRunsCopied: number;
}

/**
 * Start a new draft revision, as a copy of whatever is published now.
 *
 * One transaction, from the article lock to the last copied row. That is a
 * requirement rather than tidiness, for two reasons that outlive any one step:
 *
 * 1. **The article lock is the ordering, and it lasts exactly as long as the
 *    transaction does.** `lockOrCreateArticle` takes `FOR UPDATE` on the
 *    `articles` row, which is what serialises this against every other writer of
 *    the same article — another `beginDraftIn`, a `publishRevisionIn`, and
 *    `pgGlossaryStore.deleteGlossary` (src/store/pg-glossary.ts), which really
 *    does update a published revision in place. A copy spread over three
 *    transactions lets go of that lock twice, and the delete landing in either
 *    gap gives the draft its `glossary` from before the delete — which the next
 *    publication then writes back over the top of it.
 * 2. **A half-copied draft is readable, not merely untidy.** The steps that run
 *    next read *through* this draft: no `revision_blocks` rows and a model is
 *    handed an empty article; no copied `revision_step_runs` rows and `has` and
 *    `interrupted` (src/store/artifacts-pg.ts) answer that nothing has been done
 *    here, so a resumed job pays for every completed step again.
 *
 * **The reason given here until 2026-09-03 was neither of those**, and it was
 * false: *"`hierarchy`, `arc`, `tweets` and `glossary` update the published
 * revision in place"*. True when it was written, and untrue from the D1b work
 * onwards — every pipeline *job* takes the draft-and-publish path, this
 * function being where it starts, and `pgGlossaryStore.deleteGlossary` is the
 * one deliberate exception. (Per job, not per step: one draft carries every
 * step of a job — see `openOrBeginJobDraft` below.) It was a restatement of
 * src/db/schema.ts's own stale claim, which is how one wrong sentence became
 * three; see the correction there for what it cost.
 *
 * Creates the `articles` row if this slug has never been seen, so the caller
 * does not need a separate "does this article exist" dance — a brand-new URL and
 * a re-extraction take the same path, and only the presence of a current
 * revision differs.
 *
 * ## The revision id is minted, not derived
 *
 * `crypto.randomUUID()`. Nothing about a revision's contents may name it: a
 * derived id means two different extractions that happen to produce the same
 * blocks are the *same row*, so the second one overwrites the first in place —
 * which is exactly what "immutable in its text" is supposed to forbid.
 * (src/store/import.ts derived one, stopped, and was itself deleted on
 * 2026-09-01 — docs/plans/260831b-finish-the-database-move.md § Stage 4. Nothing
 * derives a revision id now, and nothing may start.)
 *
 * ## There is no lookback to a previous draft
 *
 * An earlier design carried from "this job's own previous draft" on a retry, so
 * that attempt 2 would not re-run attempt 1's finished steps. It is not built,
 * and the reason is worth keeping: Retry creates a **new job with a new id**, so
 * "this job's previous draft" resolves to nothing, and "the latest draft for
 * this slug" would pick up another job's draft and resurrect precisely what
 * copying-from-published exists to prevent. For a one-user first cut the boring
 * answer wins — **re-run the completed steps.** Paying for a few model calls on
 * a retry is safer and far simpler than an ungrounded lookback, and
 * `jobs.draft_revision_id` is the lineage that would make a better answer
 * possible later.
 */
export async function beginRevision(opts: BeginRevisionOptions): Promise<BeginRevisionResult> {
  requireSlug(opts.slug);
  return getDb().transaction((tx) => beginDraftIn(tx, opts), READ_COMMITTED);
}

/**
 * The body of `beginRevision`, taking the caller's transaction.
 *
 * Split out on 2026-08-27 so that `openOrBeginJobDraft` can do its lookup and
 * this minting **in one transaction** rather than two. Two would be a race with
 * teeth: between "this job has no draft" and "here is one", a second request
 * for the same job could get the same answer and mint a second draft, and the
 * later `fenceJob` would silently point the job at whichever won.
 *//**
 * **Every column of `revision_blocks` a draft carries forward, by name.**
 *
 * Strings, and **nothing typechecks them** — a column left out is silently
 * dropped from every `{ steps: ["extract"] }` draft, which for
 * `role`/`treatment`/`note_id` means a re-extracted article quietly puts its
 * bibliography back into the argument, and for `context_id`/`context_type`
 * means a callout re-reads as ordinary prose. Add here and to `storedBlocks`
 * together.
 *
 * `revision_id` is absent because the insert supplies the *new* one, and `fts`
 * because it is `generatedAlwaysAs`: naming it would either fail or freeze a
 * stale search vector. `tests/store-carried-columns.test.ts` asserts this list
 * against the table itself, which is the check the comment above it used to ask
 * a reader to perform by eye. GPT Sol, 2026-08-31.
 */
export const CARRIED_BLOCK_COLUMNS = [
  "article_id", "block_id", "ordinal", "tag", "kind", "level", "text", "words", "html",
  "gistable", "note", "role", "treatment", "note_id", "context_id", "context_type",
] as const;


async function beginDraftIn(
  tx: Tx,
  opts: BeginRevisionOptions,
): Promise<BeginRevisionResult> {
  const { slug } = opts;
  {
    const article = await lockOrCreateArticle(tx, slug);

    const revisionId = randomUUID();
    const basedOn = article.currentRevisionId;

    const carried = carriedColumns();
    if (basedOn) {
      /* The copy, as one `INSERT … SELECT`, so the source row is read and
         written inside the same statement. Column names are rendered from the
         schema rather than typed out, which is what makes a new column ride
         along without anybody editing this line. */
      const columnList = sql.join(
        carried.map((name) => sql.identifier(articleRevisions[name].name)),
        sql`, `,
      );
      /* **`based_on_revision_id` is written here, as a literal, and is not one
         of the copied columns.** It is the id this statement is selecting
         *from*, so the row records what it was actually made of rather than
         what its parent was made of — which is the difference between a lineage
         and a rumour. Inside this transaction, which holds the article lock, so
         the value cannot be a revision that stopped being current between the
         read above and the write here. */
      await tx.execute(sql`
        insert into ${articleRevisions} (${sql.identifier("id")}, ${sql.identifier("article_id")}, ${sql.identifier("status")}, ${sql.identifier("based_on_revision_id")}, ${columnList})
        select ${revisionId}::uuid, ${article.id}::uuid, 'draft', ${basedOn}::uuid, ${columnList}
        from ${articleRevisions}
        where ${articleRevisions.id} = ${basedOn}
      `);
    } else {
      /* No `basedOnRevisionId`: this is the article's first draft, copied from
         nothing, and null is the honest answer rather than a missing one. */
      await tx
        .insert(articleRevisions)
        .values({ id: revisionId, articleId: article.id, status: "draft" });
    }

    /* **The blocks carry too, and the three-column reading of this design
       missed it.** A `{ steps: ["extract"] }` job creates a revision and never
       runs `blocks`, so without this the draft has no paragraphs at all — and
       `publishRevision` would refuse it, correctly and uselessly.

       `fts` is omitted deliberately: it is `generatedAlwaysAs`, so Postgres
       recomputes it from the copied text. Naming it here would either fail or
       freeze a stale search vector. */
    const blockColumns = sql.join(
      CARRIED_BLOCK_COLUMNS.map((name) => sql.identifier(name)),
      sql`, `,
    );
    let blocksCopied = 0;
    let stepRunsCopied = 0;
    if (basedOn) {
      const copiedBlocks = await tx.execute(sql`
        insert into ${revisionBlocks} (${sql.identifier("revision_id")}, ${blockColumns})
        select ${revisionId}::uuid, ${blockColumns}
        from ${revisionBlocks}
        where ${revisionBlocks.revisionId} = ${basedOn}
      `);
      blocksCopied = copiedBlocks.rowCount ?? 0;

      /* **And the step runs, row for row, with `input_hash` unchanged.** That
         is what keeps the metadata page honest: the row then says *tweets ran
         against hash X* while the blocks hash Y, which is exactly the
         comparison that yields "present but not current". Drop this copy and
         the page reports a stage that never ran while the column beside it
         holds a thread. */
      const runColumns = sql.join(
        ["step_name", "input_hash", "implementation_version", "prompt_version", "model", "status", "started_at", "finished_at"].map(
          (name) => sql.identifier(name),
        ),
        sql`, `,
      );
      const copiedRuns = await tx.execute(sql`
        insert into ${revisionStepRuns} (${sql.identifier("revision_id")}, ${runColumns})
        select ${revisionId}::uuid, ${runColumns}
        from ${revisionStepRuns}
        where ${revisionStepRuns.revisionId} = ${basedOn}
      `);
      stepRunsCopied = copiedRuns.rowCount ?? 0;
    }

    if (opts.job) await fenceJob(tx, opts.job.id, opts.job.attemptId, revisionId);

    logger.info(
      { slug, revisionId, basedOn, blocksCopied, stepRunsCopied, jobId: opts.job?.id },
      "draft revision begun",
    );
    return { revisionId, articleId: article.id, basedOn, blocksCopied, stepRunsCopied };
  }
}

/* ------------------------------------------------- reopening a job's draft -- */

export interface OpenDraftResult extends BeginRevisionResult {
  /** True when this call minted the draft; false when it reopened the job's own. */
  readonly created: boolean;
}

/**
 * The draft **this job already owns**, or a new one if it has none.
 *
 * ## The bug this exists to prevent, which would have hit every ingest
 *
 * `advanceJob` runs exactly one step per HTTP request — that is the whole point
 * of it, and it is what lets each step have its own serverless invocation. So a
 * runner that called `beginRevision` per step would, on request 2:
 *
 * 1. mint a fresh revision id (it always does — see § The revision id is
 *    minted, not derived);
 * 2. copy from `articles.current_revision_id`, which for a *new* article is
 *    null, so the draft comes up empty;
 * 3. point `jobs.draft_revision_id` at it, throwing away the draft request 1
 *    had just written `fetch`'s output into.
 *
 * `extract` then looks for a raw document that is sitting in a revision nothing
 * points at any more. GPT Sol found this reviewing
 * docs/plans/260827j-transactional-stage-runner.md, and it is worth noticing that the
 * symptom would have been *"extract cannot find the raw document"* on every
 * fresh article — a message pointing at stage 2, from a fault in the runner.
 *
 * ## Why this is not the lookback `beginRevision` refuses
 *
 * That section rejects carrying from "the latest draft for this slug", because
 * it would pick up **another job's** draft and resurrect exactly what copying
 * from published prevents. This asks a different question, and the answer is a
 * fact rather than a guess: `jobs.draft_revision_id` names one row, that row was
 * written by this job, and the read is fenced on the live attempt. Retry still
 * mints a new job with a new id and therefore a new draft, which is the
 * behaviour that section chose.
 *
 * ## The four ways the recorded draft is not usable
 *
 * All four fall back to minting rather than throwing, because none of them is
 * the caller's fault and every one of them is a state the database can reach:
 * the pointer is null (the first step of a job); the revision has been swept
 * (`sweepAbandonedDrafts` spares job-referenced drafts, but `db:import` and a
 * cascade from `articles` do not); it is no longer a draft (something published
 * or failed it); or it belongs to a different article, which would mean the job
 * changed slug under us and is the one that would be a bug elsewhere.
 */
export async function openOrBeginJobDraft(opts: {
  readonly slug: string;
  readonly job: { readonly id: string; readonly attemptId: string };
}): Promise<OpenDraftResult> {
  const { slug, job } = opts;
  requireSlug(slug);

  return getDb().transaction(async (tx) => {
    /**
     * **The article lock, first, before the job — and it may find nothing.**
     *
     * *Article lock before job lock, everywhere.* That is the one order this
     * file keeps, and until 2026-08-29 this function was the exception to it:
     * it took job-then-article while `publishRevision` and `failRevision` took
     * article-then-job. The inversion was narrowly safe, on facts nobody could
     * check from here — the claim fence stops one job opening and committing
     * concurrently, and `settleExpired` cannot make the cycle because a
     * replacement job is a different row. D1b needs a single transaction that
     * opens a draft *and* publishes it, so the invariant is now enforceable
     * rather than argued: take the article first and no path can invert them.
     * GPT Sol, 2026-08-29, docs/plans/260827aa-delete-the-importer-d1b-design-sol.md.
     *
     * **`lockOrCreateArticle`, not `lockArticle`, and the difference is the
     * whole point of doing it here.** On a first ingest there is no row yet, so
     * a plain lock would take nothing and the two calls below would be
     * serialised by the *job* row again — with a worse ending than before: the
     * loser would come out of that wait holding "there is no article" from
     * before the winner committed, find a draft pointer that now names a real
     * revision, decide the pointer was unusable, and mint a second draft. That
     * is precisely the orphaned-draft bug this function exists to prevent. A row
     * that does not exist cannot be locked, so the row has to exist.
     */
    const article = await lockOrCreateArticle(tx, slug);

    /**
     * **Locked, not merely selected.**
     *
     * Fencing on the attempt is not enough on its own, which GPT Sol found in
     * the first version of this: two calls carrying the same live token both
     * read `draft_revision_id = null`, the *article* lock serialises them, and
     * the second one then mints R2 holding its stale null — leaving the job
     * pointing at R2 and R1 orphaned, which is the very bug this function
     * exists to prevent, one level in.
     *
     * `for update` on the job row makes the read-decide-write one critical
     * section, and that is what closes it, not the order the two locks are
     * taken in.
     *
     * It also closes the second race in that finding: an unlocked read could
     * see a live attempt and then have `settleExpired` fail the job while this
     * transaction waited for a lock, after which the reopen branch returned a
     * draft belonging to a job that was already over. Still closed with the
     * article taken first: `settleExpired` may commit while we wait for the
     * article row, but then this statement's own `status = 'running'` no longer
     * holds, no row comes back, and the call throws instead of proceeding.
     *
     * **And now the same is true when nothing has swept it yet**, which is the
     * case that condition could not cover. `liveAttempt` compares the lease
     * against `clock_timestamp()` rather than `now()` — deliberately, because
     * `now()` is frozen at transaction start and a transaction that crossed the
     * deadline *while waiting for these very locks* would otherwise be judged
     * on the time before it waited. src/store/job-fence.ts.
     */
    const [row] = await tx
      .select({ draftRevisionId: jobs.draftRevisionId, slug: jobs.slug })
      .from(jobs)
      .where(liveAttempt(job.id, job.attemptId))
      .limit(1)
      .for("update");
    if (!row) throw new NotTheLiveAttempt(job.id);

    /**
     * **A job may only open a draft for its own article.**
     *
     * The other four unusable-pointer cases fall back to minting because none
     * is anybody's fault. This one is: a live token with somebody else's slug
     * means a caller has mixed two jobs up, and minting would repoint a
     * perfectly good job at an article it has nothing to do with — which is
     * the same class of fault as `enqueue` renaming a slug out from under a
     * request. Refuse, loudly. GPT Sol, 2026-08-27.
     */
    if (row.slug !== slug) {
      throw new NotTheLiveAttempt(job.id);
    }

    if (row.draftRevisionId) {
      /* The row locked at the top of the transaction, not a second lock, and
         never `undefined` any more — which is why there is no "was there an
         article?" branch here. It was taken before the job row precisely so
         that this branch never has to take it. */
      const [draft] = await tx
        .select({
          id: articleRevisions.id,
          status: articleRevisions.status,
          /* **The lineage, read inside this transaction's article lock**, which
             is what makes the reopen branch's answer as exact as the mint's:
             nothing can publish between this read and the caller's use of it
             without taking the same lock. Reading it after the transaction —
             which is what the session used to do against
             `articles.current_revision_id` — left a gap in which a publication
             was mistaken for this draft's own base.

             **Nothing publishes on this answer any more**, and it is still
             worth returning: `publishRevisionIn` reads the column for itself,
             inside the transaction that moves the pointer, and
             tests/helpers/load-article.ts reports this as `LoadedArticle.basedOn`. */
          basedOn: articleRevisions.basedOnRevisionId,
        })
        .from(articleRevisions)
        .where(
          and(
            eq(articleRevisions.id, row.draftRevisionId),
            eq(articleRevisions.articleId, article.id),
          ),
        )
        .limit(1);
      if (draft?.status === "draft") {
        logger.debug({ slug, revisionId: draft.id, jobId: job.id }, "reopened this job's draft");
        return {
          revisionId: draft.id,
          articleId: article.id,
          /* **The row's own record of what it was copied from**, not a guess.
             This answered `null` until 2026-09-01 — "unknown from here, and
             `null` would be a lie" — and the caller filled the gap by reading
             the article's current revision, which is the number the publication
             guard is about to compare itself against and therefore always
             agreed with it. `based_on_revision_id` is written at mint and never
             carried, so the answer is a fact about this row. Null still means
             "copied from nothing", and for a draft minted before that column
             existed it means "nobody recorded it" — the guard refuses either
             way, which is the safe direction.

             The two counts are `0` because this call copied nothing; whatever
             the minting call copied is already in the row. */
          basedOn: draft.basedOn,
          blocksCopied: 0,
          stepRunsCopied: 0,
          created: false,
        };
      }
      logger.info(
        { slug, jobId: job.id, recorded: row.draftRevisionId, status: draft?.status ?? null },
        "the draft this job recorded is not usable — minting a new one",
      );
    }

    return { ...(await beginDraftIn(tx, opts)), created: true };
  }, READ_COMMITTED);
}

/* --------------------------------------------------------- recordStepRun -- */

/**
 * Say that a step ran against this draft, and what it ran against.
 *
 * An upsert on `(revision_id, step_name)`, because a carried row for the same
 * step is the ordinary case: the step is running *because* the carried one is
 * not current, and the new row has to replace it rather than collide with it.
 *
 * **`inputHash` is the step's own idea of its input, not one global hash.** The
 * plan assumed `hashBlocks` was the right stamp everywhere; it is not. `arc`,
 * `tweets` and `glossary` all read the *tree* as well as the blocks,
 * and src/labels.ts already keeps a separate `structureHash` precisely because
 * section boundaries can move without a single block changing. Making each
 * step's hash the right one belongs to that step's owner; this function does not
 * stand in the way of it, and does not pretend to have done it.
 */
/**
 * This job is running, holds this token, and owns this draft — or throw.
 *
 * Locked `for update`, so the answer cannot go stale between the check and
 * whatever the caller does next inside the same transaction. Shared by
 * `beginStepRun` and `finishStepRun` rather than written twice, which is the
 * lesson of docs/postmortems/260827d-toc-status-never-checked.md: two inline copies of
 * "is this row good" drift, and nothing says so.
 *
 * It takes the **job** lock and never the article lock. See the note on
 * `beginStepRun` about the two orders that already exist in this file.
 *
 * Exported for `writeArtefacts` (src/store/artifacts-pg.ts), which fences on
 * the same claim before it touches a column. That write is meant to share a
 * transaction with `finishStepRun`, so in the ordinary case the fence is taken
 * twice — deliberately, because "the write is safe because the call after it
 * checks" is a guarantee that lasts until somebody calls the write on its own.
 *
 * **Two conditions, two errors, and that is the fix for 260902f.** The `where`
 * used to carry `liveAttempt AND draft_revision_id = $revision` and raise one
 * `NotTheLiveAttempt` for either, so a claimant whose draft had been deleted out
 * from under it was told *somebody else owns this job* — and src/jobs.ts
 * believed it, walked away, and left a `running` row nothing could take, cancel
 * or finish before the lease. The two halves are told apart here, where the row
 * is already in hand, rather than guessed at by the caller. See `JobDraftGone`.
 */
export async function requireLiveJobOwnsDraft(
  tx: Tx,
  job: { id: string; attemptId: string },
  revisionId: string,
): Promise<void> {
  const draft = await liveJobDraft(tx, job);
  if (draft !== revisionId) throw new JobDraftGone(job.id, revisionId, draft);
}

/**
 * The draft this live claim points at — or throw, because the claim is not live.
 *
 * The read half of `requireLiveJobOwnsDraft`, exported because
 * src/store/pg-session.ts needs the same answer without the throw: an ending
 * that has to tidy a step run can only do so while the job still owns the draft
 * that step run is in, and the whole point of `JobDraftGone` is that it may not.
 *
 * Locked `for update` on the same terms the fence has always taken it, so a
 * caller that reads here and writes next is one critical section.
 */
export async function liveJobDraft(
  tx: Tx,
  job: { id: string; attemptId: string },
): Promise<string | null> {
  const [live] = await tx
    .select({ draftRevisionId: jobs.draftRevisionId })
    .from(jobs)
    .where(liveAttempt(job.id, job.attemptId))
    .for("update")
    .limit(1);
  if (!live) throw new NotTheLiveAttempt(job.id);
  return live.draftRevisionId;
}

/**
 * This step has started, and here is the claim that says who is running it.
 *
 * The Postgres half of `ArtifactStore.beginStep`, and the first thing that ever
 * writes `revision_step_runs.attempt_id`. On the filesystem the same fact is a
 * `data/<slug>/steps/<step>.running` file; here it is a row whose `status` is
 * `running` and whose `attempt_id` is the job's token.
 *
 * **It refuses unless the job is live *and* owns this draft.** Four conditions,
 * and the fourth is the one that is easy to leave out: a token can be perfectly
 * current and still belong to a job pointed at a different revision, and
 * writing a step run into somebody else's draft is a fault nothing downstream
 * could untangle. The row is locked `for update` so the check cannot go stale
 * between here and the write.
 *
 * **This function takes the job lock and never the article lock**, which is what
 * keeps it out of the deadlock that the two locks otherwise invite. Do not add
 * an article lock here without reading the next paragraph.
 *
 * **Article lock before job lock, everywhere.** That is the whole rule, and
 * since 2026-08-29 there is no exception to it: `openOrBeginJobDraft`,
 * `publishRevisionIn` and `failRevisionIn` all take the article first. (It was
 * an exception until then — that one took job-then-article, and GPT Sol's
 * finding that the file contradicted its own comment is
 * docs/plans/260827au-c1-c2-code-review-sol.md finding 2.) One lock is always safe, so
 * this function is free to take the job on its own; taking the *article* here,
 * after a caller already holds the job, is what would put the cycle back.
 *
 * **`NO_INPUT_HASH`, deliberately**, because a step that has not run yet has not
 * been *made from* anything. The real hash arrives with `finishStepRun`. Writing
 * a plausible-looking hash here would make a step that died mid-run look like
 * one that completed against those blocks.
 *
 * **And `prompt_version` and `model` are nulled here for exactly the same
 * reason** — since 2026-09-06, and their absence from this list was a real
 * fault rather than a narrowing. `values` is what the `onConflictDoUpdate`
 * below `SET`s, so a field missing from it survives the reopen: a value written
 * by an older code version stuck for the life of the row, and **three live
 * revisions carry `labels/1` on the row against `labels/2` in the artefact**
 * because of it. A running row has no completed provenance yet; claiming one is
 * the same mistake as the plausible-looking hash above, one column along.
 * ⟨GPT Sol's F2 on stage 2, the half of it that was taken.⟩
 *
 * Those three self-heal on their next `hierarchy` run. Nothing is migrated:
 * touching real rows is Greg's call, not this function's.
 */
export async function beginStepRun(
  opts: {
    revisionId: string;
    stepName: StepName;
    job: { id: string; attemptId: string };
    implementationVersion?: string;
  },
  tx: Tx,
): Promise<void> {
  const { revisionId, stepName, job } = opts;
  await requireLiveJobOwnsDraft(tx, job, revisionId);

  const values = {
    revisionId,
    stepName,
    inputHash: NO_INPUT_HASH,
    /* Cleared, not left alone — see the note above. `null` rather than absent,
       so the `onConflictDoUpdate` below actually writes over whatever an earlier
       run of this row recorded. */
    promptVersion: null,
    model: null,
    implementationVersion: opts.implementationVersion ?? PIPELINE_RUN,
    status: "running" as const,
    startedAt: new Date(),
    finishedAt: null,
    attemptId: job.attemptId,
  };
  await tx
    .insert(revisionStepRuns)
    .values(values)
    .onConflictDoUpdate({
      target: [revisionStepRuns.revisionId, revisionStepRuns.stepName],
      set: values,
      /* **A token may not reopen a run it has already ended.**
         
         Without this, two callers holding the same live capability — a retry
         that raced, a duplicated request — could turn `done/A` back into
         `running/A`, clear `finishedAt`, and replace the recorded hash with
         `unstamped`. The step would then look like one still in flight, and
         whatever it had already produced would be reported unfinished.

         A *different* attempt reopening the row is legitimate and stays
         allowed: that is what a re-run is, and the job lock taken above
         serialises it, so an attempt that gets this far is the live one.

         GPT Sol, 2026-08-27; docs/plans/260827au-c1-c2-code-review-sol.md finding 4. */
      setWhere: sql`${revisionStepRuns.status} = 'running' or ${revisionStepRuns.attemptId} is distinct from ${job.attemptId}::uuid`,
    });
}

/**
 * This step has ended, and only the attempt that started it may say so.
 *
 * One fenced `UPDATE`, which is what the filesystem adapter's own comment has
 * been asking for since it was written. Two conditions carry the whole
 * protocol, and they refuse different things:
 *
 * - **`attempt_id`** — somebody else's claim. A lapsed claimant whose lease was
 *   swept still holds a token and would otherwise finish a step the new
 *   claimant is in the middle of.
 * - **`status = 'running'`** — a step that has already ended. Finishing twice is
 *   not idempotent here: the second call would overwrite the first's stamp and
 *   timestamps with a later run's.
 *
 * **A null `attempt_id` is refused too, and that falls out rather than being
 * special-cased.** `attempt_id = $token` is never true of NULL in SQL, so a row
 * written by the importer or by a CLI — neither of which has a claim — cannot be
 * finished through this path. That is the rule `src/db/schema.ts` states for the
 * column: a step run that cannot prove who wrote it cannot prove it was not
 * somebody stale.
 *
 * `rowCount !== 1`, never `>= 1` and never ignored — zero rows here is the fence
 * working, and it has to reach the caller as a failure. The same shape as
 * `fenceJob` above, on purpose.
 */
export async function finishStepRun(
  opts: {
    revisionId: string;
    stepName: StepName;
    job: { id: string; attemptId: string };
    status: "done" | "error";
    inputHash?: string;
    implementationVersion?: string;
    promptVersion?: string | null;
    model?: string | null;
  },
  tx: Tx,
): Promise<void> {
  const { revisionId, stepName, job } = opts;
  const attemptId = job.attemptId;

  /* **The job's own fence, before the row's.** The step row only knows which
     token wrote it; it cannot know whether that token is still the live claim.
     `settleExpired` clears a lapsed job's token and settles it — errored, or
     cancelled if Stop had been pressed — without touching its step runs, so a
     swept worker that keeps going finds its row still `running/A`, matches on
     both of the conditions below, and commits `done` for a job that is over.

     Found in review of the built code, which is why this repo weights that
     above a plan review: the two row conditions look complete on their own.
     GPT Sol, 2026-08-27; docs/plans/260827au-c1-c2-code-review-sol.md finding 1. */
  await requireLiveJobOwnsDraft(tx, job, revisionId);

  const result = await tx
    .update(revisionStepRuns)
    .set({
      status: opts.status,
      finishedAt: new Date(),
      /* Only where the caller has one. A step with no stamp — `fetch`,
         `extract`, `blocks` — leaves `NO_INPUT_HASH` where `beginStepRun` put
         it, rather than having a hash invented for it on the way out. */
      ...(opts.inputHash === undefined ? {} : { inputHash: opts.inputHash }),
      ...(opts.implementationVersion === undefined
        ? {}
        : { implementationVersion: opts.implementationVersion }),
      ...(opts.promptVersion === undefined ? {} : { promptVersion: opts.promptVersion }),
      ...(opts.model === undefined ? {} : { model: opts.model }),
    })
    .where(
      and(
        eq(revisionStepRuns.revisionId, revisionId),
        eq(revisionStepRuns.stepName, stepName),
        eq(revisionStepRuns.attemptId, attemptId),
        eq(revisionStepRuns.status, "running"),
      ),
    );
  if (result.rowCount !== 1) throw new StepRunNotHeld(revisionId, stepName);
}

/**
 * Refused by `finishStepRun`: this attempt does not hold this step.
 *
 * Its own type rather than `NotTheLiveAttempt`, because the two are different
 * failures with different repairs. `NotTheLiveAttempt` means the *job* has moved
 * on; this means the step run is not in the state this caller believed — already
 * finished, held by another attempt, held by nobody, or never begun — and the
 * message deliberately does not guess which, since the fence cannot tell them
 * apart in one statement and a confident wrong guess is worse than none.
 */
export class StepRunNotHeld extends Error {
  readonly status = 409;
  constructor(revisionId: string, stepName: StepName) {
    super(
      `The ${stepName} step of revision ${revisionId} is not held as running by this attempt — ` +
        `it may have finished already, or been claimed by another.`,
    );
    this.name = "StepRunNotHeld";
  }
}

export async function recordStepRun(
  input: {
    revisionId: string;
    stepName: StepName;
    inputHash: string;
    implementationVersion: string;
    promptVersion?: string | null;
    model?: string | null;
    status: "running" | "done" | "error";
    startedAt?: Date | null;
    finishedAt?: Date | null;
  },
  tx: Tx | Db = getDb(),
): Promise<void> {
  const values = {
    revisionId: input.revisionId,
    stepName: input.stepName,
    inputHash: input.inputHash,
    implementationVersion: input.implementationVersion,
    promptVersion: input.promptVersion ?? null,
    model: input.model ?? null,
    status: input.status,
    startedAt: input.startedAt ?? null,
    finishedAt: input.finishedAt ?? null,
  };
  await tx
    .insert(revisionStepRuns)
    .values(values)
    .onConflictDoUpdate({
      target: [revisionStepRuns.revisionId, revisionStepRuns.stepName],
      set: values,
    });
}

/* -------------------------------------------------------- publishRevision -- */

/**
 * Every reason this draft must not become the article, or an empty list.
 *
 * **Out of the transaction callback on purpose, and it is not only tidiness.**
 * This is the list that grows: the raw-source reference is the next entry
 * (docs/plans/260827aa-delete-the-importer.md § The publication gate, as a truth table),
 * and a guard that lives inline in a hundred-line callback is one that gets
 * added to by whoever is passing rather than reviewed as a set. Everything here
 * is a *reason string*; nothing here writes.
 *
 * It collects rather than returning early, because a draft with three things
 * wrong should say three things. `PublishRefused` takes the list.
 */
/**
 * **Is the whole input to `checkTree` the one this draft was handed, untouched?**
 *
 * `checkTree` is a deterministic function of the **pair** `(blocks, tree)`, so
 * an exemption that compared only the tree would be a laundering path, and GPT
 * Sol found it before it shipped: copy a valid revision, leave the tree alone,
 * change one block's `kind` from `heading` to `text`, and you have caused a
 * fresh `checkTree` failure that a tree-only comparison would wave through —
 * `hashBlocks` fingerprints `id`, `text`, `role` and `treatment` and **not**
 * `kind`, so the hierarchy hash check does not catch it either
 * (`checkTree` reads `b.kind` at src/tree-invariants.ts:167 and :300).
 *
 * So both halves are compared, and both are compared **in the database**: two
 * booleans' worth of work, and neither the trees nor the block rows cross the
 * wire.
 *
 * - **The tree**, with `is not distinct from` over `jsonb`. That is *normalised
 *   semantic* equality, not byte equality — key order and whitespace cannot make
 *   an untouched tree look edited, which a `JSON.stringify` comparison would get
 *   wrong. Both null reads as unchanged; a draft with no tree is refused a line
 *   earlier anyway.
 * - **The blocks**, as a symmetric `EXCEPT ALL` over `CARRIED_BLOCK_COLUMNS` —
 *   the same exhaustive inventory `beginDraftIn` copies with, so a new block
 *   column joins this comparison by existing rather than by being remembered.
 *   `EXCEPT ALL` rather than `EXCEPT` keeps multiplicity, so the set operator
 *   cannot dedupe a difference away.
 *
 * Returns **false** when there is no base — the article's first publication —
 * which is the fail-closed answer: nothing was carried, so everything is new,
 * so everything is checked.
 *
 * **This is state-based, and deliberately says nothing about who wrote what.**
 * A `hierarchy` run that rebuilds a byte-identical tree over identical blocks
 * counts as unchanged, because by this definition it *is* unchanged. Proving
 * "built here" rather than "differs from the base" would need a provenance
 * marker maintained by the tree-writing seam, and the case is hypothetical: the
 * producer splices the bad shape away (`collapseRestatedRungs`), so a rebuild
 * cannot reproduce an invalid tree. GPT Sol raised it; recorded rather than
 * built.
 */
async function publicationInputUnchanged(
  tx: Tx,
  revisionId: string,
  basedOnRevisionId: string | null,
): Promise<boolean> {
  if (!basedOnRevisionId) return false;

  const blockColumns = sql.join(
    CARRIED_BLOCK_COLUMNS.map((name) => sql.identifier(name)),
    sql`, `,
  );
  const rows = await tx.execute<{ same: boolean }>(sql`
    select
      (d.${sql.identifier("tree")} is not distinct from b.${sql.identifier("tree")})
      and not exists (
        (select ${blockColumns} from ${revisionBlocks}
          where ${revisionBlocks.revisionId} = ${revisionId}::uuid
         except all
         select ${blockColumns} from ${revisionBlocks}
          where ${revisionBlocks.revisionId} = ${basedOnRevisionId}::uuid)
        union all
        (select ${blockColumns} from ${revisionBlocks}
          where ${revisionBlocks.revisionId} = ${basedOnRevisionId}::uuid
         except all
         select ${blockColumns} from ${revisionBlocks}
          where ${revisionBlocks.revisionId} = ${revisionId}::uuid)
      ) as same
    from ${articleRevisions} d, ${articleRevisions} b
    where d.${sql.identifier("id")} = ${revisionId}::uuid
      and b.${sql.identifier("id")} = ${basedOnRevisionId}::uuid
  `);
  return rows.rows[0]?.same === true;
}

async function reasonsNotToPublish(
  tx: Tx,
  revisionId: string,
  blocks: Block[],
  tree: Tree | null,
  /**
   * True when this draft's blocks *and* tree are exactly the ones the article is
   * already serving — see the branch that reads it below.
   */
  inputIsCarriedForward: boolean,
): Promise<PublicationVerdict> {
  const reasons: string[] = [];
  const carriedTreeProblems: string[] = [];

  if (!blocks.length) reasons.push("it has no blocks");
  if (!tree) reasons.push("it has no tree");
  // Nothing below can say anything useful without both.
  if (!blocks.length || !tree) return { reasons, carriedTreeProblems };

  /**
   * **A publication is judged on the tree it changes, not the tree it carries.**
   *
   * `beginDraftIn` copies the base revision's tree into every draft verbatim, so
   * a glossary or quotes or debate step — none of which looks at the tree —
   * arrives here holding the tree the article is *already serving*. Refusing that
   * publication protects nobody: the tree in question is in front of readers
   * either way, and the only thing the refusal removes is the glossary.
   *
   * On 2026-09-05 that cost eleven hours of availability. `c8e2cc7e` added a new
   * `checkTree` rule that morning and fixed the producer in the same commit
   * (`collapseRestatedRungs`, src/hierarchy.ts), but nothing migrated the trees
   * already stored — so roughly one article in twenty could no longer publish
   * *anything*, for ever, and each attempt completed and paid for its model call
   * before being refused at this line. Four times on `nagel-bat`, one of them
   * $0.2454, each reported to the reader as "trying again is worth a go".
   * docs/postmortems/260905f-a-tightened-tree-rule-wedged-every-article-that-already-broke-it.md.
   *
   * **This is deliberately narrow, and the narrowness is the point.** Only
   * `checkTree`'s problems are exempted, and only when the tree is unchanged.
   * A publication that builds or alters a tree is judged in full — which is
   * where this gate was always aimed, and what stops the exemption becoming a
   * way to launder a broken tree in by starting from a broken one
   * (tests/store-publish-guards.test.ts § "still refuses a bad tree that this
   * draft actually changed"). Re-running `hierarchy` still repairs the article,
   * because `buildTree` splices the shape away.
   *
   * It also fixes the class rather than the instance: the next invariant anybody
   * tightens over stored trees will report rather than wedge.
   */
  const { problems } = checkTree(blocks, tree);
  if (problems.length && inputIsCarriedForward) {
    /* Not silence: they come back as `carriedTreeProblems` and are logged by
       `logPublication`, **after** the caller's commit. Logging here would
       announce a publication that a later rollback — a lost fence, a failed job
       settlement — never made, in exactly the way the note above
       `logPublication` was written about. GPT Sol, this file's second review. */
    carriedTreeProblems.push(...problems.slice(0, 10));
    if (problems.length > 10) carriedTreeProblems.push(`… and ${problems.length - 10} more tree problems`);
  } else {
    // Capped, because a tree whose root range is wrong reports once per block and
    // the message would otherwise be a megabyte of prose in a log line.
    for (const problem of problems.slice(0, 10)) reasons.push(problem);
    if (problems.length > 10) reasons.push(`… and ${problems.length - 10} more tree problems`);
  }

  const runs = await tx
    .select()
    .from(revisionStepRuns)
    .where(and(eq(revisionStepRuns.revisionId, revisionId), eq(revisionStepRuns.stepName, "hierarchy")));
  const hierarchyRun = runs[0];
  const blocksHash = hashBlocks(blocks);

  /**
   * **Asked of `hierarchyCurrency` (src/store/artifacts.ts) since 2026-09-07**,
   * which `articleMetadata` in src/store/pg.ts also asks — so the metadata page
   * and the publication gate cannot answer it differently.
   *
   * That sentence used to be a comment in pg.ts and nothing else, and the half
   * it was wrong about is the one below: this guard read the hash and never the
   * status, so a `hierarchy` run that crashed left a matching hash and published.
   * docs/postmortems/260827d-toc-status-never-checked.md § What would have
   * caught the whole class asks for exactly this function, by name.
   *
   * The **sentences stay here**, because they are this caller's alone — the
   * metadata page draws a tick, and only a publication refusal has to tell
   * somebody what to do next. The `switch` is exhaustive, so a fifth reason
   * cannot be added to the shared function without landing here.
   */
  const currency = hierarchyCurrency(hierarchyRun, blocksHash);
  if (!currency.current) {
    /* **The status arms come before the hash one, and that ordering is the
       fix for 260827d rather than a tidy-up.** `recordStepRun`, which the
       importer and every CLI run use, records a real hash at the moment it says
       `running` — so a `hierarchy` that ran and *failed* used to publish, as
       long as the hash beside it matched.

       The fenced path does not: `beginStepRun` writes `NO_INPUT_HASH` on
       purpose, because a step that has not run yet has not been made from
       anything. So under the pipeline the status arms are reached by a row that
       could not have matched anyway — which makes them more necessary rather
       than less, since without them the hash arm would report "the tree was
       built from different blocks" about a step that never got as far as a
       tree, and send somebody to re-run the thing that has just told them it
       failed.

       Exhaustive on purpose: a fifth reason cannot be added to
       `hierarchyCurrency` without the compiler stopping here for a sentence. */
    switch (currency.why) {
      case "no-run":
        reasons.push(
          "there is no record of the hierarchy step running, so nothing can say the tree describes these blocks",
        );
        break;
      case "unfinished":
      case "errored":
        reasons.push(
          `the hierarchy step ${currency.why === "unfinished" ? "has not finished" : "ended in error"}, so its tree cannot be trusted to describe these blocks`,
        );
        break;
      case "different-blocks":
        reasons.push(
          `the tree was built from different blocks (hierarchy ran against ${currency.ranAgainst}, these blocks are ${blocksHash}) — re-run hierarchy`,
        );
        break;
      default: {
        /* The whole narrowed value, not `.why`: once every arm is covered
           `currency` is itself `never`, and reading a property off it is an
           error rather than the exhaustiveness proof it looks like. */
        const never: never = currency;
        throw new Error(`unhandled hierarchy currency ${JSON.stringify(never)}`);
      }
    }
  }

  return { reasons, carriedTreeProblems };
}

/**
 * **There is no "skip the lineage check" option here, on purpose.**
 *
 * The guard it would turn off is the one in `publishRevisionIn`, and the reason
 * that guard exists at all is that its predecessor lived in a single caller and
 * every other caller walked past it. An opt-out is that same hole with a name:
 * the caller who most needs the check is the one who has not thought about it,
 * and a field is what a passing agent reaches for when a fixture goes red.
 *
 * The session's `DraftBase` did carry one — a deliberate `how: "unknown"` arm —
 * and it is worth recording that **nothing ever constructed it**. It was built
 * for drafts whose lineage could not be recovered; the column made that case
 * impossible, and the arm went with the type on 2026-09-01.
 *
 * A caller that legitimately has no lineage is not stuck. `beginRevision` — the
 * one thing that mints a revision — records the base itself, so any draft made
 * the ordinary way can answer. Everything that publishes today goes through it:
 * the pipeline, tests/helpers/load-article.ts, the fixture corpus. If something
 * one day genuinely cannot, the answer is to give it a lineage rather than a
 * licence to bury a publication. GPT Sol, finding 1 of
 * docs/plans/260901d-stage3-code-review-sol.md.
 */
export interface PublishRevisionOptions {
  readonly slug: string;
  readonly revisionId: string;
  /** Fenced exactly as in `beginRevision`, and checked before the pointer moves. */
  readonly job?: { readonly id: string; readonly attemptId: string };
}

/**
 * What a publication produced — and everything `logPublication` needs.
 *
 * Named rather than written inline twice, because `publishRevision` and
 * `publishRevisionIn` return the same thing and a second copy is a second thing
 * to keep in step.
 */
export interface PublishRevisionResult {
  readonly revisionId: string;
  readonly previousRevisionId: string | null;
  readonly scalars: ReturnType<typeof deriveLibraryScalars>;
  /**
   * `checkTree` problems this publication was **not** refused for, because it
   * carried the blocks and tree forward unchanged — see the branch in
   * `reasonsNotToPublish`. Empty on almost every publication. `logPublication`
   * says them out loud after the commit; nothing else reads them.
   */
  readonly carriedTreeProblems: readonly string[];
  /**
   * The free `labels` job this publication queued, if it queued one.
   *
   * `null` covers both of the ordinary answers — the revision published `ready`,
   * so there was nothing to make; or a successor for this article was already
   * queued and this publication collapsed onto it. `logPublication` prints it;
   * nothing decides anything on it. See `publishRevisionIn`.
   */
  readonly successorJobId: string | null;
}

/** What `reasonsNotToPublish` decided: what refuses, and what merely worries. */
interface PublicationVerdict {
  readonly reasons: string[];
  readonly carriedTreeProblems: string[];
}

/**
 * Make a draft the article, or refuse and say why.
 *
 * ## What it refuses, and the one that is a behaviour change
 *
 * 1. **No blocks, or no tree.** A revision with either missing is not a
 *    readable article — the same bar src/api.ts set by requiring both
 *    `blocks.json` and `tree.json`.
 * 2. **A tree that does not describe these blocks.** Not "every id in a `range`
 *    exists" — that proves only *tree ids ⊆ block ids*, and two ordinary
 *    mistakes pass it: append a block keeping every old id, and no leaf covers
 *    the new one; reorder the same ids, and every endpoint still resolves while
 *    the ranges stop partitioning. So it is the full structural check,
 *    `checkTree` in src/tree-invariants.ts — root extent, singleton leaves,
 *    exact coverage, order, child partitioning. Editorial advice from that same
 *    check is deliberately ignored: refusing to publish an article because a
 *    nav label is five words would train everyone to route around this.
 * 3. **A tree built from different blocks.** The `hierarchy` step-run row's
 *    `input_hash` must equal `hashBlocks` of this draft's blocks. Without it, a
 *    text-only re-extraction that keeps every id publishes the old gists and nav
 *    labels **with no stale banner anywhere** — the tree is structurally
 *    perfect and describes an article nobody can read any more. A missing `hierarchy`
 *    row is refused too, because "I cannot tell" is not "it is fine".
 *
 * 4. **A draft whose base has moved.** `article_revisions.based_on_revision_id`
 *    records the revision the draft was copied from, and a publication may only
 *    move the pointer *off that revision*. Something else publishing while the
 *    draft was written — a job running for minutes, `db:import`, a script —
 *    means the draft's blocks, columns and step runs describe the old article,
 *    and moving the pointer now discards work nobody asked to lose, silently.
 *    Written up where it is enforced, in `publishRevisionIn`.
 *
 * **The third is a behaviour change and it is worth saying out loud:** a job of
 * `{ steps: ["blocks"] }` alone now fails where today it succeeds and quietly
 * diverges. The fix for anyone who hits it is to run `hierarchy` as well, which
 * `DEFAULT_INGEST_STEPS` and `cascadeForce` already do.
 *
 * This is the wrapper: one transaction of its own around `publishRevisionIn`,
 * and the log line **after** that transaction commits. See there for the order
 * inside it and for why the logging moved out.
 */
export async function publishRevision(
  opts: PublishRevisionOptions,
): Promise<PublishRevisionResult> {
  requireSlug(opts.slug);
  const published = await getDb().transaction((tx) => publishRevisionIn(tx, opts), READ_COMMITTED);
  logPublication(opts, published);
  return published;
}

/**
 * The body of `publishRevision`, taking the caller's transaction.
 *
 * Split out on 2026-08-29 for the same reason `beginDraftIn` was: a job's last
 * step has to write its artefacts, finish the step, publish the revision and
 * end the job **in one transaction**, and a function that opens its own cannot
 * be part of one. docs/plans/260827aa-delete-the-importer.md § D1b.
 *
 * ## The order inside the transaction
 *
 * Lock the article, validate, fence the job, *then* move the pointer. The fence
 * is checked for `rowCount === 1` before anything a reader can see changes, in
 * the same transaction, so a stale worker's publication is impossible rather
 * than merely unlikely.
 *
 * The article lock is taken here whether or not the caller already holds it.
 * Re-locking a row the same transaction already has is free, and this is the
 * function that must not depend on the caller having remembered — **article
 * lock before job lock, everywhere** (see `openOrBeginJobDraft`).
 *
 * ## It returns what to log instead of logging
 *
 * **This is the one part of the extraction that is not a pure move**, so it is
 * written down rather than left to be noticed. `logger.info` used to run inside
 * this transaction. That was harmless while the transaction was its own — it
 * committed a line later — but a caller's transaction can go on to fail during
 * job settlement, and then the log has announced a publication that never
 * happened, in a file whose whole subject is a reader seeing either the old
 * revision or the new one and never a mixture. So the caller calls
 * `logPublication` after **its** commit. GPT Sol, 2026-08-29,
 * docs/plans/260827aa-delete-the-importer-d1b-design-sol.md finding 5.
 */
export async function publishRevisionIn(
  tx: Tx,
  opts: PublishRevisionOptions,
): Promise<PublishRevisionResult> {
  const { slug, revisionId } = opts;
  requireSlug(slug);

  const article = await lockArticle(tx, slug);
  /* `permanent`: the row is gone or was never this reader's, and publishing
     cannot make one — `lockOrCreateArticle` is the only line that does. */
  if (!article) throw new PublishRefused(slug, "permanent", ["there is no such article"]);

  /* A named projection, not `select()`. The bare form takes every column of the
     revision — including, until 2026-09-01, `raw_bytes`, up to 32 MiB of source
     document pulled across the wire so that four fields could be checked and
     the tree read. This used to share one selector with every other revision
     read; since 2026-08-27 each read names its own columns, and `publish` wants
     four. See `REVISION_CARRY_POLICY` in src/store/pg.ts, and
     docs/plans/260827am-glossary-read-latency.md. */
  const found = await tx
    .select(REVISION_PROJECTIONS.publish)
    .from(articleRevisions)
    .where(eq(articleRevisions.id, revisionId))
    .limit(1);
  const draft = found[0];
  /**
   * **All three `permanent`, and they are one fact said three ways:** this
   * caller is holding a revision id that is not a publishable draft of this
   * article, and publishing cannot make it into one.
   *
   * The third was written `transient` first, on the reading that a retry mints
   * a fresh draft — `openOrBeginJobDraft` above replaces a recorded pointer
   * whose revision is no longer a `draft` — so the next attempt would get past
   * this line. True, and the wrong question. Reaching it at all means the
   * lifecycle is in a state that path exists to prevent, and the two ways it
   * can happen are the two this change is about: if the revision is already
   * `published`, a retry buys a second model call for work that is **already on
   * the shelf**; if it is `failed`, something settled the draft out from under
   * a live claim. Either is a defect worth recording, and neither is the
   * ordinary concurrency the moved-base branch below describes — whose sentence
   * to a reader, *something else finished while this was working*, would be
   * false here.
   *
   * The cost is stated rather than hidden: one withheld button, on a state
   * nothing ordinary produces. GPT Sol, reviewing 260907a, found the first
   * draft's answer inconsistent with its own two neighbours — a missing
   * revision can be re-minted by a new job too, and that one is `permanent`.
   */
  if (!draft) throw new PublishRefused(slug, "permanent", [`revision ${revisionId} does not exist`]);
  if (draft.articleId !== article.id)
    throw new PublishRefused(slug, "permanent", [
      `revision ${revisionId} belongs to another article`,
    ]);
  if (draft.status !== "draft")
    throw new PublishRefused(slug, "permanent", [
      `revision ${revisionId} is already ${draft.status}`,
    ]);

  /**
   * **A draft may only replace the revision it was copied from.**
   *
   * Both sides are read inside this transaction and under the article lock
   * taken above: `based_on_revision_id` is written once by `beginDraftIn` and
   * never changed, and `article.currentRevisionId` is the pointer the statement
   * at the bottom of this function is about to move. Nothing can publish
   * between the two reads without taking the same lock, so a mismatch means one
   * thing only — something published while this draft was being written, and
   * moving the pointer now would discard it.
   *
   * `null === null` is the article's **first** publication: copied from nothing,
   * over an article serving nothing. A `null` base against a live pointer is
   * refused, and that covers the other thing `null` means — a draft minted
   * before the column existed (drizzle/0047), whose lineage nobody recorded.
   * Fail-closed, at the cost of one re-run of whatever was in flight at that
   * deploy. See `basedOnRevisionId` in src/db/schema.ts.
   *
   * **Here, rather than in the caller, and that is the whole point.** Until
   * 2026-09-01 this comparison lived in `pgStoreSession.settleJob`, one
   * statement after `publishRevisionIn` returned — so it held for the pipeline
   * and for nobody else. Standalone `publishRevision` moved the pointer without
   * ever reading the column, and a script, `revisionLifecycle`
   * (src/store/revisions.ts) or the next caller nobody has written yet buried a
   * newer publication and reported success. A guard that lives in one caller is
   * a guard the next caller forgets. GPT Sol, finding 1 of
   * docs/plans/260901d-stage3-code-review-sol.md;
   * tests/pg-session-exact-base.test.ts case 5 is the red one.
   *
   * **There is no opt-out, and that is a decision rather than an omission** —
   * see `PublishRevisionOptions`.
   *
   * Ids only, no article text (docs/project/logging.md), and `PublishRefused`
   * rather than a plain `Error` so `guardDbStore` keeps the 409 instead of
   * scrubbing it into "this app asked its database for something it would not
   * do".
   */
  if (draft.basedOnRevisionId !== article.currentRevisionId) {
    /* **The one `transient` refusal that matters**, and the reason a refusal has
       kinds at all rather than a flag saying never retry one. Its own last
       sentence is the remedy — *start again from what is there* — and a retry is
       exactly that: a fresh draft off whatever the article is serving now. Take
       the button away here and the fix for the permanent case is a second bug. */
    throw new PublishRefused(slug, "transient", [
      `this draft (${revisionId}) was copied from revision ` +
        `${draft.basedOnRevisionId ?? "none"}, but the article is now serving ` +
        `${article.currentRevisionId ?? "none"} — something else published while this draft was ` +
        "being written, and publishing now would discard it. Nothing was published; " +
        "start again from what is there.",
    ]);
  }

  const blocks = await storedBlocks(tx, revisionId);
  const tree = draft.tree as Tree | null;
  /* Safe to ask against `basedOnRevisionId`: the branch above has just proved,
     under the article lock, that it is `article.currentRevisionId`. So "what this
     draft was copied from" and "what readers are being served" are the same row,
     and no second lock or read is needed to say so. */
  const carried = await publicationInputUnchanged(tx, revisionId, draft.basedOnRevisionId);
  const { reasons, carriedTreeProblems } = await reasonsNotToPublish(tx, revisionId, blocks, tree, carried);

  /**
   * **A refusal about input this draft *carried* cannot come out differently; a
   * refusal about input it *made* can.** One boolean, already computed above,
   * and it is the whole of the distinction at this door.
   *
   * `carried` means the blocks and the tree are exactly the base's. So the next
   * attempt — a fresh draft off the same base — copies the identical rows
   * forward (`beginDraftIn` copies `revision_blocks` *and* `revision_step_runs`,
   * `status` and `input_hash` included) and is refused in this same line. That
   * is a **permanently wedged article**: every mode refused, for ever, each
   * attempt having completed and paid for its model call first. It is the
   * `nagel-bat` shape of 2026-09-05, and it is what the `bug` kind is for.
   * `checkTree`'s own problems are exempted before they get here when the input
   * is carried — but the `hierarchy` run's status and hash are not, and a
   * poisoned run row on the base wedges the article exactly as a poisoned tree
   * did.
   *
   * **Not carried means the draft built or altered this pair, and then another
   * go is a fresh draw.** ⟨Sol, 2026-09-07⟩ This line said `permanent` flatly
   * until that review, on the reasoning that Retry skips every step that
   * finished. It does — but a *failed* attempt's draft is discarded and its
   * artefacts go with it, so the new attempt's freshness checks find nothing and
   * correctly re-run (docs/project/ingest-queue.md § What makes a failure
   * permanent). The case that shows it is the expensive one: a **first ingest**
   * whose `hierarchy` draws a tree `checkTree` rejects. There is no base, so
   * nothing is carried, so nothing is copied forward, and the next draw may well
   * be sound — while `permanent` would withhold the button *and* `retryJob`'s
   * own gate, leaving the reader no route to that article at all.
   *
   * The two kinds are not per-reason and there is no enum: it is one fact about
   * the draft, and every reason in the list is judged by it.
   */
  if (reasons.length) throw new PublishRefused(slug, carried ? "permanent" : "transient", reasons);

  const scalars = deriveLibraryScalars({ blocks, tree, excerpt: draft.excerpt });

  await tx
    .update(articleRevisions)
    .set({ status: "published", ...scalars })
    .where(eq(articleRevisions.id, revisionId));

  // The fence, before the pointer. A job that is no longer the live attempt
  // throws here, and the whole transaction — including the status change
  // above — rolls back with it.
  if (opts.job) await fenceJob(tx, opts.job.id, opts.job.attemptId, null);

  await tx
    .update(articles)
    .set({ currentRevisionId: revisionId })
    .where(eq(articles.id, article.id));

  /**
   * **A revision that publishes `pending` buys the job that finishes it — here,
   * in the transaction that published it.**
   *
   * `hierarchy` stopped calling `generateLabels` in stage 2a
   * (docs/plans/260906a-labels-leave-the-blocking-hierarchy-step.md), so an
   * article now reaches the shelf saying *"Paragraph labels are still
   * arriving"*. This is what makes that sentence temporary. Inside the
   * transaction, so the pointer and the successor become true together: a
   * publication that committed with nothing queued would leave that sentence up
   * for ever, and nothing on the server reaps a queued row to notice.
   *
   * **In the primitive rather than in `pgStoreSession.settleIn`, and this file
   * has already made that argument once** — the lineage check above lived in
   * that caller until 2026-09-01, and *a guard that lives in one caller is a
   * guard the next caller forgets*. The rule is about the revision, not about
   * the pipeline: any publication whose result is `pending` needs the job,
   * including `pg-glossary.ts`'s and standalone `publishRevision`'s. GPT Sol's
   * stated rule for this stage.
   *
   * **`=== "pending"` rather than `!== "ready"`**, so `failed` does not buy a job
   * on every publication of an article whose labels have already been tried and
   * lost. Re-running them is a step re-run the reader asks for.
   *
   * Nothing is driven from here — see `enqueueSuccessorIn`, and § *Who actually
   * runs the successor* in the plan: the browser's `jobEngine` drives every
   * queued job the signed-in owner has, from any page.
   */
  const successorJobId =
    draft.navLabelStatus === "pending"
      ? await enqueueSuccessorIn(tx, {
          ownerId: article.ownerId as OwnerId,
          slug,
          steps: ["labels"],
        })
      : null;

  return {
    revisionId,
    previousRevisionId: article.currentRevisionId,
    scalars,
    carriedTreeProblems,
    successorJobId,
  };
}

/**
 * The line a publication prints — **after** the transaction that made it.
 *
 * A function rather than five field names for each caller to get right, so that
 * every publication says the same thing however it was committed. See
 * `publishRevisionIn` for why it is not printed where it is decided.
 */
export function logPublication(
  opts: Pick<PublishRevisionOptions, "slug">,
  published: PublishRevisionResult,
): void {
  logger.info(
    {
      slug: opts.slug,
      revisionId: published.revisionId,
      previous: published.previousRevisionId,
      blocks: published.scalars.blockCount,
      words: published.scalars.wordCount,
      /* Absent on almost every publication. Present means this revision reached
         the shelf without its paragraph labels and bought the free job that
         finishes them — see `publishRevisionIn`. */
      ...(published.successorJobId ? { successorJobId: published.successorJobId } : {}),
    },
    "revision published",
  );
  /* After the commit, and only here. The article is now serving a tree that
     `checkTree` rejects — carried forward, not caused by this publication, and
     already in front of readers before it. Re-running `hierarchy` repairs it.
     docs/postmortems/260905f-a-tightened-tree-rule-wedged-every-article-that-already-broke-it.md. */
  if (published.carriedTreeProblems.length) {
    logger.warn(
      {
        slug: opts.slug,
        revisionId: published.revisionId,
        problems: published.carriedTreeProblems,
      },
      "published over a carried-forward tree that checkTree rejects — re-run hierarchy to repair it",
    );
  }
}

/* ----------------------------------------------------------- failRevision -- */

/**
 * Give up on a draft, leaving the reader on the revision they already had.
 *
 * It never touches `articles.current_revision_id`, and that is the whole point
 * of the draft: *"today a failed re-extraction overwrites a good article in
 * place"* is the sentence in src/db/schema.ts this exists to make untrue.
 *
 * The row is kept rather than deleted — it is the evidence of what failed, and
 * `sweepAbandonedDrafts` is what eventually reclaims the space. `reason` is
 * logged, not stored: `article_revisions` has no error column, and inventing one
 * for a string nothing reads would be a column to keep in step for ever.
 *
 * This is the wrapper: one transaction of its own around `failRevisionIn`, and
 * the log line **after** that transaction commits.
 */
export async function failRevision(opts: FailRevisionOptions): Promise<void> {
  requireSlug(opts.slug);
  const failed = await getDb().transaction((tx) => failRevisionIn(tx, opts), READ_COMMITTED);
  logDraftFailure(opts, failed);
}

export interface FailRevisionOptions {
  readonly slug: string;
  readonly revisionId: string;
  readonly reason: string;
  readonly job?: { readonly id: string; readonly attemptId: string };
}

/** How many rows the failure moved — nothing else about it is worth carrying. */
export interface FailRevisionResult {
  readonly changed: number | null;
}

/**
 * The body of `failRevision`, taking the caller's transaction.
 *
 * The other half of `publishRevisionIn`, and it exists for the same reason: on
 * a stage failure the same transaction has to mark the step, fail the draft and
 * end the job, so none of the three can open a transaction of its own.
 *
 * **It returns what to log instead of logging**, by the same rule and for the
 * same reason — see `publishRevisionIn`. The caller calls `logDraftFailure`
 * after its commit. A warning about a draft that a rollback then un-failed is
 * the more confusing of the two directions, because the row is still a live
 * draft afterwards and the log says it is not.
 *
 * Article lock first, before the job fence, as everywhere.
 */
export async function failRevisionIn(
  tx: Tx,
  opts: FailRevisionOptions,
): Promise<FailRevisionResult> {
  const { slug, revisionId } = opts;
  requireSlug(slug);

  const article = await lockArticle(tx, slug);
  if (!article) throw new Error(`No article "${slug}" to fail a revision of.`);

  /* Never the current one. A draft cannot be current — `publishRevision` is
     the only thing that moves the pointer and it publishes as it moves — but
     this is the statement that would destroy an article if that ever stopped
     being true, so it checks rather than trusting. We hold the article lock,
     so the value read here cannot change underneath the update below. */
  if (article.currentRevisionId === revisionId) {
    throw new Error(
      `Refusing to fail revision ${revisionId}: it is what "${slug}" is currently serving.`,
    );
  }

  const result = await tx
    .update(articleRevisions)
    .set({ status: "failed" })
    .where(
      and(
        eq(articleRevisions.id, revisionId),
        eq(articleRevisions.articleId, article.id),
        eq(articleRevisions.status, "draft"),
      ),
    );

  if (opts.job) await fenceJob(tx, opts.job.id, opts.job.attemptId, null);

  return { changed: result.rowCount };
}

/**
 * A `labels` job died; say so on **the revision it was working from**, and only
 * while that is still what readers are being served.
 *
 * ## Which revision, and why it is not the obvious one
 *
 * A failing job fails its **candidate draft** (`failRevisionIn` above), and that
 * draft is thrown away. The revision carrying `nav_label_status = 'pending'` —
 * the one on the shelf, saying *"Paragraph labels are still arriving"* — is the
 * draft's **base**, and nothing touches it on the failing path. So a successor
 * that fails leaves the sentence up for ever unless something writes `failed`
 * onto the base, which is what this is. Stage 1 built the `failed` state and its
 * reader-facing sentence; until now nothing wrote it.
 *
 * ## Only while the base is current
 *
 * Two reads under the article lock this takes: the draft's
 * `based_on_revision_id`, written once by `beginDraftIn` and never changed, and
 * `articles.current_revision_id`. If they differ, something published while this
 * job ran — and that newer revision has its own labels story and its own
 * successor. Writing `failed` onto whatever is current would tell a reader that
 * a publication they can see went wrong because a job about an older one did.
 * GPT Sol, F4 of the design review.
 *
 * ## And only over `pending`
 *
 * The `WHERE` carries it, so a base that is already `ready` — a labels re-run
 * asked for by hand against an article that has its labels — is not
 * downgraded by a failure, and a base already `failed` does not move.
 *
 * Returns the revision it moved, or `null`. **`null` is an ordinary answer** on
 * every one of the cases above, which is why it is not a throw: the caller wants
 * to know whether there is a line to log, not whether something went wrong.
 */
export async function markNavLabelsFailedIn(
  tx: Tx,
  slug: string,
  draftRevisionId: string,
): Promise<string | null> {
  requireSlug(slug);
  /* Taken here whether or not the caller holds it, for the reason
     `publishRevisionIn` gives: this is a function that must not depend on the
     caller having remembered. Re-locking a row this transaction already has is
     free. */
  const article = await lockArticle(tx, slug);
  if (!article) return null;

  const [draft] = await tx
    .select({ basedOnRevisionId: articleRevisions.basedOnRevisionId })
    .from(articleRevisions)
    .where(eq(articleRevisions.id, draftRevisionId))
    .limit(1);
  const base = draft?.basedOnRevisionId;
  /* `null` is a first ingest — copied from nothing, so there is no earlier
     revision wearing the `pending` sentence and nothing to correct. */
  if (!base || base !== article.currentRevisionId) return null;

  const result = await tx
    .update(articleRevisions)
    .set({ navLabelStatus: "failed" })
    .where(
      and(eq(articleRevisions.id, base), eq(articleRevisions.navLabelStatus, "pending")),
    );
  return result.rowCount === 1 ? base : null;
}

/**
 * The line `markNavLabelsFailedIn` prints — **after** its caller's commit, for
 * the reason `publishRevisionIn` gives at length: a `logger` call inside a
 * transaction announces something a later statement may roll back.
 */
export function logNavLabelsFailed(slug: string, revisionId: string): void {
  logger.warn(
    { slug, revisionId },
    "the paragraph labels failed; the published revision now says so",
  );
}

/**
 * The line a failed draft prints — **after** the transaction that failed it.
 *
 * `changed` is in it because zero is a real and interesting answer: the draft
 * was already failed, or already gone, and nothing moved.
 */
export function logDraftFailure(
  opts: Pick<FailRevisionOptions, "slug" | "revisionId" | "reason">,
  failed: FailRevisionResult,
): void {
  logger.warn(
    { slug: opts.slug, revisionId: opts.revisionId, reason: opts.reason, changed: failed.changed },
    "draft revision failed",
  );
}

/* ------------------------------------------------------------ the sweeper -- */

/**
 * Delete drafts nobody owns and nobody is going to publish.
 *
 * **Begin-time copying has a retention cost, and a review was right that nobody
 * had costed it.** A 360-block article is roughly 1.31 MiB of copied payload
 * before overhead. A crashed worker leaves a complete copied draft that nothing
 * else in this system would ever touch, because job rescue marks *jobs*. (It
 * was worse while `raw_bytes` was a column: another 32 MiB at the fetch
 * ceiling, copied per draft. That column was dropped on 2026-09-01 and the
 * document is an object in the `sources` bucket, referenced rather than
 * copied.)
 *
 * Three conditions, all of them: not `published`, not owned by any job, and
 * older than the cutoff. The article's current revision cannot match, because
 * `publishRevision` is the only thing that moves the pointer and it publishes
 * as it moves — but the status test covers that case anyway.
 *
 * `revision_blocks` and `revision_step_runs` cascade from the delete, and
 * `block_identities` deliberately does not: an id, once minted, is never
 * deleted. docs/project/block-ids.md.
 */
export async function sweepAbandonedDrafts(olderThanMs: number): Promise<number> {
  const db = getDb();
  const cutoff = new Date(Date.now() - olderThanMs);

  /* Two small reads and a set difference rather than one clever statement with
     two `NOT IN` subqueries. `NOT IN` against a column that can be NULL matches
     nothing at all — silently, and in the *safe* direction, so a sweep that had
     quietly stopped deleting anything would look exactly like a sweep with
     nothing to do. Drafts are few; correctness is worth the round trip. */
  const [candidates, owned, current] = await Promise.all([
    db
      .select({ id: articleRevisions.id })
      .from(articleRevisions)
      .where(
        and(
          inArray(articleRevisions.status, ["draft", "failed"]),
          lt(articleRevisions.createdAt, cutoff),
        ),
      ),
    db.select({ id: jobs.draftRevisionId }).from(jobs),
    db.select({ id: articles.currentRevisionId }).from(articles),
  ]);

  const spared = new Set(
    [...owned, ...current].map((row) => row.id).filter((id): id is string => id !== null),
  );
  const doomed = candidates.filter((row) => !spared.has(row.id));
  if (!doomed.length) return 0;

  await db.delete(articleRevisions).where(
    inArray(
      articleRevisions.id,
      doomed.map((r) => r.id),
    ),
  );
  logger.info({ swept: doomed.length, olderThanMs }, "abandoned draft revisions swept");
  return doomed.length;
}
