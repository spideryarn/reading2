/**
 * The life of a revision: begin a draft, fill it in, publish it or fail it.
 *
 * **There was no publication path before this file.** The only code that ever
 * made a revision current was the tail of `importArticle`'s transaction, which
 * is a migration tool. So the schema's promise — *the pipeline builds a draft
 * and publishes it in one step, so a reader sees either the previous published
 * revision or the complete new one and never a mixture* — had nothing behind
 * it. This is that path. docs/plans/postgres-storage-implementation.md § Step 11
 * half A.
 *
 * ## Why it is `pg-revisions.ts` and not `revisions.ts`
 *
 * The plan said `src/store/revisions.ts`. Every unprefixed file in this
 * directory is either store-agnostic (`contracts.ts`) or the filesystem
 * (`fs.ts`, `artifacts-fs.ts`), and every Postgres adapter is `pg-*` —
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
 * The copy is expressed as a **denylist** (`REVISION_COLUMN_POLICY`) rather than
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
import { log } from "../log.js";
import { currentOwnerId } from "../owner.js";
import { hashBlocks } from "../source-hash.js";
import { checkTree } from "../tree-invariants.js";
import type { Block, StepName, Tree } from "../types.js";
import { REVISION_PROJECTIONS, ownedSlug, requireSlug, slugIsTaken } from "./pg.js";
import { NO_INPUT_HASH, PIPELINE_RUN } from "./artifacts.js";

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
 * `published_at`, `based_on_revision_id`, `job_id` or `attempt_id` would be
 * actively harmful copied: new content inheriting an old certification, or an
 * old worker's ownership. So the map is exhaustive and an unclassified column is
 * an error rather than a carry.
 */
export const REVISION_COLUMN_POLICY: Record<
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
  note: "carry",

  // Stage 1: what was fetched, and what came back.
  requestedUrl: "carry",
  finalUrl: "carry",
  fetchedAt: "carry",
  rawBytes: "carry",
  rawContentType: "carry",
  rawEncoding: "carry",
  rawSha256: "carry",
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
   * database refuses a copy that takes only one. docs/plans/raw-bytes-in-storage.md.
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
  arc: "carry",

  tweets: "carry",
  glossary: "carry",
  summary: "carry",
  /* Carries like its four neighbours, and its staleness is answered the same
     way: `sourceHash` on the artefact against the blocks and tree now, computed
     at read time. What is different is that a carried `ideas` also survives a
     profile change — deliberately, because the artefact says which profile it
     was written for and `stepIsDone` compares it, so the *step* re-runs while
     the *reader* keeps something to look at until it does. */
  ideas: "carry",
};

const MINTED = new Set(
  (Object.keys(REVISION_COLUMN_POLICY) as (keyof typeof REVISION_COLUMN_POLICY)[]).filter(
    (k) => REVISION_COLUMN_POLICY[k] === "mint",
  ),
);
const DERIVED = new Set(
  (Object.keys(REVISION_COLUMN_POLICY) as (keyof typeof REVISION_COLUMN_POLICY)[]).filter(
    (k) => REVISION_COLUMN_POLICY[k] === "derive",
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
  const unclassified = declared.filter((name) => !(name in REVISION_COLUMN_POLICY));
  if (unclassified.length) {
    throw new Error(
      `article_revisions has ${unclassified.length} column(s) with no carry-forward policy: ` +
        `${unclassified.join(", ")}. Add each to REVISION_COLUMN_POLICY in src/store/pg-revisions.ts ` +
        `— a new column must not be carried or dropped by accident.`,
    );
  }
  return declared.filter((name) => !MINTED.has(name) && !DERIVED.has(name));
}

/* --------------------------------------------------- the derived scalars -- */

/**
 * The five numbers the library prints, from the two artefacts they describe.
 *
 * **One function, called by both the pipeline and the importer**, because a
 * review found they had already diverged: `describeArticle` (src/api.ts) falls
 * back to `meta.excerpt` for the blurb and the importer did not, so an article
 * with no root gist had a blurb on the filesystem and none in Postgres. Two
 * implementations of one derivation is the divergence this whole migration
 * exists to make impossible.
 *
 * `excerpt` is the third rung of that fallback and is passed in rather than
 * read, so this stays pure and testable without a database.
 */
export function deriveLibraryScalars(input: {
  blocks: readonly Pick<Block, "words">[];
  tree: Tree | null;
  excerpt?: string | null | undefined;
}): {
  wordCount: number;
  blockCount: number;
  partCount: number;
  sectionCount: number;
  rootGist: string | null;
} {
  const { blocks, tree } = input;
  let partCount = 0;
  let sectionCount = 0;
  if (tree) {
    // One pass rather than two filters, matching `describeArticle`.
    for (const node of Object.values(tree.nodes)) {
      if (node.depth === 1) partCount++;
      else if (node.depth === 2) sectionCount++;
    }
  }
  const root = tree ? tree.nodes[tree.rootId] : undefined;
  return {
    wordCount: blocks.reduce((n, b) => n + b.words, 0),
    blockCount: blocks.length,
    partCount,
    sectionCount,
    rootGist: root?.gist ?? root?.summary ?? input.excerpt ?? null,
  };
}

/* ------------------------------------------------------------- the errors -- */

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
 */
export class PublishRefused extends Error {
  readonly status = 409;
  readonly reasons: readonly string[];
  constructor(slug: string, reasons: readonly string[]) {
    super(`Refusing to publish "${slug}": ${reasons.join("; ")}`);
    this.name = "PublishRefused";
    this.reasons = reasons;
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
  }));
}

/**
 * Point the job at its draft, or take the pointer away, **fenced**.
 *
 * One `UPDATE`, whose `WHERE` carries the whole condition: this job, this
 * attempt, and `status = 'running'`. Checking the token and then writing
 * separately recreates exactly the race the token exists to prevent.
 *
 * `AND status = 'running'` is not decoration. Without it, a rescued job's stale
 * worker publishes a draft the queue has already given up on — and reports
 * success.
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
    .where(and(eq(jobs.id, jobId), eq(jobs.attemptId, attemptId), eq(jobs.status, "running")));
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
 * requirement rather than tidiness: `toc`, `arc`, `tweets`, `glossary` and
 * `summary` update the *published* revision in place, so a copy spread over
 * three transactions could take the blocks from before an in-place update and
 * the columns from after it.
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
 * src/store/import.ts used to derive one and no longer does; see its header for
 * why that had to be decided in the same change.
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
  return getDb().transaction((tx) => beginDraftIn(tx, opts));
}

/**
 * The body of `beginRevision`, taking the caller's transaction.
 *
 * Split out on 2026-08-27 so that `openOrBeginJobDraft` can do its lookup and
 * this minting **in one transaction** rather than two. Two would be a race with
 * teeth: between "this job has no draft" and "here is one", a second request
 * for the same job could get the same answer and mint a second draft, and the
 * later `fenceJob` would silently point the job at whichever won.
 */
async function beginDraftIn(
  tx: Tx,
  opts: BeginRevisionOptions,
): Promise<BeginRevisionResult> {
  const { slug } = opts;
  {
    let article = await lockArticle(tx, slug);
    if (!article) {
      const inserted = await tx
        .insert(articles)
        .values({ ownerId: currentOwnerId(), slug })
        /* Another transaction may have inserted this slug between our lock
           attempt and here — the lock cannot protect a row that does not exist
           yet. `do nothing` plus a re-read is the honest handling; `do update`
           would rewrite somebody's shelf state to defaults. */
        .onConflictDoNothing({ target: articles.slug })
        .returning();
      article = inserted[0] ?? (await lockArticle(tx, slug));
      if (!article) {
        /* **Two readings of "we could not get this row", and they want
           different words.**
         *
           `lockArticle` is owner-filtered (src/store/pg.ts § `ownedSlug`), and
           `articles.slug` is globally unique — so the ordinary way to get here
           is not a race at all: somebody else already owns this slug. The
           insert did nothing, the reread found nothing, and the generic message
           sent whoever hit it looking for a locking bug.

           Distinguished by asking, unfiltered, whether the row exists at all.
           GPT Sol raised the confusion reviewing the ownership work, 2026-08-27;
           what it does NOT do is let two readers keep the same URL, which is
           still an open question rather than a thing that works. */
        if (await slugIsTaken(slug, tx)) {
          throw new PublishRefused(slug, [
            `the slug "${slug}" already belongs to another reader — ` +
              "slugs are unique across the whole install, which is a known limit",
          ]);
        }
        throw new Error(`Could not create or lock the article row for "${slug}".`);
      }
    }

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
      await tx.execute(sql`
        insert into ${articleRevisions} (${sql.identifier("id")}, ${sql.identifier("article_id")}, ${sql.identifier("status")}, ${columnList})
        select ${revisionId}::uuid, ${article.id}::uuid, 'draft', ${columnList}
        from ${articleRevisions}
        where ${articleRevisions.id} = ${basedOn}
      `);
    } else {
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
      ["article_id", "block_id", "ordinal", "tag", "kind", "level", "text", "words", "html", "gistable", "note"].map(
        (name) => sql.identifier(name),
      ),
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
 * docs/plans/transactional-stage-runner.md, and it is worth noticing that the
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
     * **Locked, not merely selected, and locked before the article.**
     *
     * Fencing on the attempt is not enough on its own, which GPT Sol found in
     * the first version of this: two calls carrying the same live token both
     * read `draft_revision_id = null`, the *article* lock serialises them, and
     * the second one then mints R2 holding its stale null — leaving the job
     * pointing at R2 and R1 orphaned, which is the very bug this function
     * exists to prevent, one level in.
     *
     * `for update` on the job row makes the read-decide-write one critical
     * section. And it is taken **first**, before `lockArticle`, so that every
     * caller takes the two locks in the same order — job then article — which
     * is what stops two of them deadlocking against each other.
     *
     * It also closes the second race in that finding: an unlocked read could
     * see a live attempt and then have `failExpired` fail the job while this
     * transaction waited for the article lock, after which the reopen branch
     * returned a draft belonging to a job that was already over. `failExpired`
     * cannot touch a row this transaction holds.
     */
    const [row] = await tx
      .select({ draftRevisionId: jobs.draftRevisionId, slug: jobs.slug })
      .from(jobs)
      .where(and(eq(jobs.id, job.id), eq(jobs.attemptId, job.attemptId), eq(jobs.status, "running")))
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
      const article = await lockArticle(tx, slug);
      const [draft] = article
        ? await tx
            .select({ id: articleRevisions.id, status: articleRevisions.status })
            .from(articleRevisions)
            .where(
              and(
                eq(articleRevisions.id, row.draftRevisionId),
                eq(articleRevisions.articleId, article.id),
              ),
            )
            .limit(1)
        : [];
      if (article && draft?.status === "draft") {
        logger.debug({ slug, revisionId: draft.id, jobId: job.id }, "reopened this job's draft");
        return {
          revisionId: draft.id,
          articleId: article.id,
          /* Unknown from here, and `null` would be a lie — it means "this
             article's first draft". The two counts are `0` because this call
             copied nothing; whatever the minting call copied is already in the
             row. A caller that needs the lineage reads the revision. */
          basedOn: null,
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
  });
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
 * `tweets`, `glossary` and `summary` all read the *tree* as well as the blocks,
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
 * lesson of docs/postmortems/toc-status-never-checked.md: two inline copies of
 * "is this row good" drift, and nothing says so.
 *
 * It takes the **job** lock and never the article lock. See the note on
 * `beginStepRun` about the two orders that already exist in this file.
 */
async function requireLiveJobOwnsDraft(
  tx: Tx,
  job: { id: string; attemptId: string },
  revisionId: string,
): Promise<void> {
  const [live] = await tx
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      and(
        eq(jobs.id, job.id),
        eq(jobs.attemptId, job.attemptId),
        eq(jobs.status, "running"),
        eq(jobs.draftRevisionId, revisionId),
      ),
    )
    .for("update")
    .limit(1);
  if (!live) throw new NotTheLiveAttempt(job.id);
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
 * `openOrBeginJobDraft` takes job-then-article; `publishRevision` and
 * `failRevision` take article-then-job. That inversion is real and predates
 * this function — `openOrBeginJobDraft`'s claim that "every caller takes the two
 * in one order" is not true of the file it sits in. GPT Sol, 2026-08-27;
 * docs/plans/c1-c2-code-review-sol.md finding 2.
 *
 * **`NO_INPUT_HASH`, deliberately**, because a step that has not run yet has not
 * been *made from* anything. The real hash arrives with `finishStepRun`. Writing
 * a plausible-looking hash here would make a step that died mid-run look like
 * one that completed against those blocks.
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

         GPT Sol, 2026-08-27; docs/plans/c1-c2-code-review-sol.md finding 4. */
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
     `failExpired` clears a lapsed job's token and marks it errored without
     touching its step runs, so a swept worker that keeps going finds its row
     still `running/A`, matches on both of the conditions below, and commits
     `done` for a job that has already failed.

     Found in review of the built code, which is why this repo weights that
     above a plan review: the two row conditions look complete on their own.
     GPT Sol, 2026-08-27; docs/plans/c1-c2-code-review-sol.md finding 1. */
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
 * (docs/plans/delete-the-importer.md § The publication gate, as a truth table),
 * and a guard that lives inline in a hundred-line callback is one that gets
 * added to by whoever is passing rather than reviewed as a set. Everything here
 * is a *reason string*; nothing here writes.
 *
 * It collects rather than returning early, because a draft with three things
 * wrong should say three things. `PublishRefused` takes the list.
 */
async function reasonsNotToPublish(
  tx: Tx,
  revisionId: string,
  blocks: Block[],
  tree: Tree | null,
): Promise<string[]> {
  const reasons: string[] = [];

  if (!blocks.length) reasons.push("it has no blocks");
  if (!tree) reasons.push("it has no tree");
  // Nothing below can say anything useful without both.
  if (!blocks.length || !tree) return reasons;

  const { problems } = checkTree(blocks, tree);
  // Capped, because a tree whose root range is wrong reports once per block and
  // the message would otherwise be a megabyte of prose in a log line.
  for (const problem of problems.slice(0, 10)) reasons.push(problem);
  if (problems.length > 10) reasons.push(`… and ${problems.length - 10} more tree problems`);

  const runs = await tx
    .select()
    .from(revisionStepRuns)
    .where(and(eq(revisionStepRuns.revisionId, revisionId), eq(revisionStepRuns.stepName, "toc")));
  const toc = runs[0];
  const blocksHash = hashBlocks(blocks);

  if (!toc) {
    reasons.push(
      "there is no record of the toc step running, so nothing can say the tree describes these blocks",
    );
  } else if (toc.status !== "done") {
    /* **Before the hash, and instead of it.** `revision_step_runs.status` is
       `running`, `done` or `error`, and this branch did not exist until
       2026-08-27: the guard read the row, compared `input_hash` and stopped, so
       a `toc` that ran and *failed* published as long as the hash beside it
       matched — and `recordStepRun`, which is what the importer and every CLI
       run use, does record a real hash at the moment it says `running`.

       The fenced path does not: `beginStepRun` writes `NO_INPUT_HASH` on
       purpose, because a step that has not run yet has not been made from
       anything. So under the pipeline this branch is reached by a row that
       could not have matched anyway — which makes it more necessary rather than
       less, since without it the *next* branch would report "the tree was built
       from different blocks" about a step that never got as far as a tree.

       `else if` rather than a second reason, because the hash cannot be trusted
       to mean anything here and "the tree was built from different blocks —
       re-run toc" would send somebody to re-run the thing that has just told us
       it failed. */
    reasons.push(
      `the toc step ${toc.status === "running" ? "has not finished" : "ended in error"}, so its tree cannot be trusted to describe these blocks`,
    );
  } else if (toc.inputHash !== blocksHash) {
    reasons.push(
      `the tree was built from different blocks (toc ran against ${toc.inputHash}, these blocks are ${blocksHash}) — re-run toc`,
    );
  }

  return reasons;
}

export interface PublishRevisionOptions {
  readonly slug: string;
  readonly revisionId: string;
  /** Fenced exactly as in `beginRevision`, and checked before the pointer moves. */
  readonly job?: { readonly id: string; readonly attemptId: string };
}

/**
 * Make a draft the article, or refuse and say why.
 *
 * ## What it refuses, and the one that is a behaviour change
 *
 * 1. **No blocks, or no tree.** A revision with either missing is not a
 *    readable article — the same bar src/api.ts sets by requiring both
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
 * 3. **A tree built from different blocks.** The `toc` step-run row's
 *    `input_hash` must equal `hashBlocks` of this draft's blocks. Without it, a
 *    text-only re-extraction that keeps every id publishes the old gists and nav
 *    labels **with no stale banner anywhere** — the tree is structurally
 *    perfect and describes an article nobody can read any more. A missing `toc`
 *    row is refused too, because "I cannot tell" is not "it is fine".
 *
 * **The third is a behaviour change and it is worth saying out loud:** a job of
 * `{ steps: ["blocks"] }` alone now fails where today it succeeds and quietly
 * diverges. The fix for anyone who hits it is to run `toc` as well, which
 * `DEFAULT_INGEST_STEPS` and `cascadeForce` already do.
 *
 * ## The order inside the transaction
 *
 * Lock the article, validate, fence the job, *then* move the pointer. The fence
 * is checked for `rowCount === 1` before anything a reader can see changes, in
 * the same transaction, so a stale worker's publication is impossible rather
 * than merely unlikely.
 */
export async function publishRevision(opts: PublishRevisionOptions): Promise<{
  revisionId: string;
  previousRevisionId: string | null;
  scalars: ReturnType<typeof deriveLibraryScalars>;
}> {
  const { slug, revisionId } = opts;
  requireSlug(slug);
  const db = getDb();

  return db.transaction(async (tx) => {
    const article = await lockArticle(tx, slug);
    if (!article) throw new PublishRefused(slug, ["there is no such article"]);

    /* A named projection, not `select()`. The bare form takes `raw_bytes` too —
       up to 32 MiB of source document, pulled across the wire so that four
       fields can be checked and the tree read. This used to share one selector
       with every other revision read; since 2026-08-27 each read names its own
       columns, and `publish` wants four. See `REVISION_COLUMN_POLICY` in
       src/store/pg.ts, and docs/plans/glossary-read-latency.md. */
    const found = await tx
      .select(REVISION_PROJECTIONS.publish)
      .from(articleRevisions)
      .where(eq(articleRevisions.id, revisionId))
      .limit(1);
    const draft = found[0];
    if (!draft) throw new PublishRefused(slug, [`revision ${revisionId} does not exist`]);
    if (draft.articleId !== article.id)
      throw new PublishRefused(slug, [`revision ${revisionId} belongs to another article`]);
    if (draft.status !== "draft")
      throw new PublishRefused(slug, [`revision ${revisionId} is already ${draft.status}`]);

    const blocks = await storedBlocks(tx, revisionId);
    const tree = draft.tree as Tree | null;
    const reasons = await reasonsNotToPublish(tx, revisionId, blocks, tree);

    if (reasons.length) throw new PublishRefused(slug, reasons);

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

    logger.info(
      {
        slug,
        revisionId,
        previous: article.currentRevisionId,
        blocks: scalars.blockCount,
        words: scalars.wordCount,
      },
      "revision published",
    );
    return { revisionId, previousRevisionId: article.currentRevisionId, scalars };
  });
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
 */
export async function failRevision(opts: {
  slug: string;
  revisionId: string;
  reason: string;
  job?: { id: string; attemptId: string };
}): Promise<void> {
  const { slug, revisionId } = opts;
  requireSlug(slug);
  const db = getDb();

  await db.transaction(async (tx) => {
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

    logger.warn(
      { slug, revisionId, reason: opts.reason, changed: result.rowCount },
      "draft revision failed",
    );
  });
}

/* ------------------------------------------------------------ the sweeper -- */

/**
 * Delete drafts nobody owns and nobody is going to publish.
 *
 * **Begin-time copying has a retention cost, and a review was right that nobody
 * had costed it.** A 360-block article is roughly 1.31 MiB of copied payload
 * before overhead, and `raw_bytes` can be 32 MiB at the fetch ceiling. TOAST
 * means this is not a row-size problem — it is a storage, WAL and cleanup
 * problem, and a crashed worker leaves a complete copied draft that nothing
 * else in this system would ever touch, because job rescue marks *jobs*.
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
