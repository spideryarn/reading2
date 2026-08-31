/**
 * Put one filesystem article into Postgres the way the pipeline would.
 *
 * ## Why this is not `importArticle`
 *
 * `db:import` is being deleted (docs/plans/260827aa-delete-the-importer.md § C7), and
 * three suites used it purely as a fixture loader. The replacement is not a
 * smaller importer — that would be a second files → Postgres implementation,
 * exercised only by tests and therefore free to drift from the path production
 * actually runs. It is the *real* write path, driven over a fixture:
 *
 * 1. the raw document put in the bucket with `storeRawSource`, which is what
 *    stage 1 does before it writes a manifest naming the object;
 * 2. a running `jobs` row, because every artefact write is fenced on one;
 * 3. `openOrBeginJobDraft`, the same call `advanceJob` makes;
 * 4. `copyArtefacts` from the filesystem store to `pgArtifactsIn`, which is
 *    `beginStep` → `write` → `finishStep` per step, in pipeline order;
 * 5. `publishRevision`, with its guards run rather than routed around;
 * 6. the job removed, so the next call can start one for this article.
 *
 * **One thing here is deliberately not production's shape**, and the claim is
 * narrowed rather than dropped: production runs *one step per transaction*, so
 * that each serverless invocation commits its own work. This wraps the whole
 * copy in one, because a fixture that committed step by step could leave an
 * article half-loaded behind a failure and the next suite to read it would fail
 * somewhere unrelated. Every *statement* is the production statement; the
 * transaction boundary around them is the fixture's. GPT Sol, 2026-08-28.
 *
 * ## What this does not carry
 *
 * `ArtifactStore` owns artefacts and nothing else, so **no reader state** comes
 * across: comments, chat, searches, glossary lookups, the shelf. A suite that
 * needs any of it must seed it separately — and must not be given a way to do it
 * from here. Sol's finding, and the reason is sharper than "separation of
 * concerns": `pgCommentStore.create` can only make a *current, unanswered*
 * comment, `pgShelfStore.patch` cannot set `opens` or a historical `archivedAt`,
 * and chat creation mints its own message ids. So "restore reader state through
 * the live stores" is not achievable for most of it, and a loader option that
 * pretended otherwise would be an importer growing back one field at a time.
 *
 * **`created_at` is today unless you say otherwise.** A draft minted by this
 * function was minted *now*, and the filesystem's idea of when the article
 * arrived is the blocks file's mtime. Where a suite compares the two stores'
 * library entries, that difference is the whole assertion, so `createdAt` is an
 * explicit option rather than something quietly inferred — a fixture that
 * guessed would make "today" pass for history and the parity claim would be
 * about nothing.
 *
 * **And `extractedHtml` is still stage 3's HTML, not stage 2's.** The filesystem
 * store maps both `extractedHtml` and `stampedHtml` to the same `output/<slug>.html`
 * (src/store/artifacts-fs.ts), because stage 3 overwrites stage 2's file in
 * place. Copying therefore puts post-stage-3 HTML in the stage-2 column. This is
 * **not fixed here** and saying so is the point: nothing reads that column today
 * — `Article` does not expose it and `db:export` writes `stamped_html` — so a
 * loader that nulled it would be inventing a policy the pipeline does not have.
 * On the real path the column is honest, because `extract` writes it before
 * `blocks` overwrites the file.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import { eq } from "drizzle-orm";

import { getDb } from "../../src/db/client.js";
import { articles, jobs } from "../../src/db/schema.js";
import type { RawManifest } from "../../src/fetch.js";
import { mintId } from "../../src/ids.js";
import { type OwnerId, currentOwnerId, runAsOwner } from "../../src/owner.js";
import { createFsArtifactStore } from "../../src/store/artifacts-fs.js";
import { pgArtifactsIn } from "../../src/store/artifacts-pg.js";
import { storeRawSource } from "../../src/store/blobs.js";
import { insertWhenSlotFree } from "./running-slot.js";
import { withRunLock } from "./run-lock.js";
import { mintAttempt } from "../../src/store/jobs.js";
import {
  PublishRefused,
  openOrBeginJobDraft,
  publishRevision,
} from "../../src/store/pg-revisions.js";
import type { JobStep, StepName } from "../../src/types.js";
import { copyArtefacts } from "../../src/store/copy-artefacts.js";

const ROOT = path.resolve(import.meta.dirname, "..", "..");

/** What the load produced, so a caller can assert on it rather than assume. */
export interface LoadedArticle {
  readonly articleId: string;
  readonly revisionId: string;
  /**
   * The steps that actually had something to copy — **the thing to assert on**.
   * A silent no-op over an article the filesystem has never heard of returns an
   * empty array, and a fixture that loaded nothing is the failure this repo
   * keeps meeting (docs/reusable/silent-success.md).
   */
  readonly copied: readonly StepName[];
  /**
   * The revision this draft was copied from, or `null` for an article the
   * database has never published.
   *
   * **Exposed because it is the only way to tell a real load from a carried
   * one.** `beginDraftIn` copies columns, block rows and step-run rows forward,
   * so an article a previous run published can read back perfectly from columns
   * this path never wrote. A suite whose subject is "the artefact store can put
   * an article into Postgres" must assert this is `null`, or it is measuring
   * whatever loaded the article last time. GPT Sol, 2026-08-28.
   */
  readonly basedOn: string | null;
  /** False when `publish` was off, or when the gate refused and `publish` was `"try"`. */
  readonly published: boolean;
  /** The gate's own reasons, when it refused. Empty otherwise. */
  readonly refusedBecause: readonly string[];
}

export interface LoadOptions {
  /**
   * What `articles.created_at` should say. Left alone when absent, which means
   * "now" — see the note above about history.
   *
   * **`articles`, not `article_revisions`.** The library sorts on
   * `ADDED_AT = coalesce(article_revisions.fetched_at, articles.created_at)`
   * (src/store/pg.ts), so the revision's own timestamp is not the one any order
   * depends on. The first version of this set the wrong table and would have
   * looked like it worked, since nothing reads the column it was setting.
   */
  readonly createdAt?: Date;
  /**
   * `true` (the default) publishes and throws if the gate refuses.
   * `"try"` reports a **refusal** on the result instead of throwing, for a suite
   * whose subject *is* the gate. Only `PublishRefused` is caught: a lost fence,
   * a dropped connection or an ordinary bug still throws, because turning those
   * into "the gate said no" would let a broken database read as a policy answer.
   * `false` leaves the revision a draft.
   */
  readonly publish?: boolean | "try";
  /**
   * Whose article it is. Defaults to `currentOwnerId()`, which outside a request
   * is the environment's owner.
   *
   * **It really does control ownership**, because the whole load runs inside
   * `runAsOwner`. Passing it to the `jobs` row alone would have been a lie:
   * `beginDraftIn` stamps `articles.owner_id` from `currentOwnerId()`, so a
   * caller naming a different owner would have got a job belonging to one person
   * and an article belonging to another. Sol caught that shape, 2026-08-28.
   */
  readonly ownerId?: OwnerId;
}

/** A job's step list has to be non-empty and well-formed; nothing reads these. */
const FIXTURE_STEPS: JobStep[] = [
  { name: "toc", label: "Building the table of contents", status: "pending" },
];

/**
 * Put the raw document in the bucket, the way stage 1 does before it writes a
 * manifest naming it.
 *
 * **Without this the loader was quietly relying on somebody else's backfill.**
 * `copyArtefacts` moves `raw.json`, which is a *reference* — `storedSha256` is
 * the key of an object in the `sources` bucket — and the Postgres adapter writes
 * the reference without ever checking the object is there. So a fixture whose
 * bytes had not already been stored produced a revision pointing at nothing, and
 * every read of the manifest still succeeded. The corpus happened to have been
 * backfilled, which is exactly why it went unnoticed. GPT Sol, 2026-08-28.
 *
 * Content-addressed and create-only, so re-running is free: the second call is a
 * dedup hit against the identical bytes.
 *
 * Returns quietly when there is no manifest — `data/constitution` has none, and
 * an article with no stage-1 output is a legitimate fixture, not a failure.
 */
async function storeRawBytesFor(slug: string): Promise<void> {
  const at = path.join(ROOT, "data", slug, "raw.json");
  let manifest: RawManifest;
  try {
    manifest = JSON.parse(await readFile(at, "utf8")) as RawManifest;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }
  if (!manifest.storedSha256) return;

  const bytes = await readFile(path.join(ROOT, "data", slug, manifest.file));
  const { sha256 } = await storeRawSource(bytes, manifest.kind);
  /* **The manifest's key must be the key of the bytes beside it.** Both are on
     disk and either could have been edited, so a fixture where they disagree is
     one that would write a reference to somebody else's document. Loud here
     rather than mysterious three assertions later. */
  if (sha256 !== manifest.storedSha256) {
    throw new Error(
      `data/${slug}: raw.json says the stored object is ${manifest.storedSha256}, but ` +
        `${manifest.file} beside it hashes to ${sha256}. One of the two has been edited.`,
    );
  }
}

/**
 * Start a running job for this article, run `body`, and take the job away again.
 *
 * **The wait for a free turn is not defensive padding**, and it now lives in
 * `insertWhenSlotFree` — see `./running-slot.ts` for which two refusals it
 * covers and why waiting cannot clear a wedged row. It moved there on
 * 2026-08-28 because a suite that had never met this grew the same failure:
 * one of it, not one per file that gets bitten.
 *
 * **And the job is started under `withRunLock`, not merely waited for.** Waiting
 * on the constraint is *unfair* — it polls, so under contention one caller
 * starves and spends the whole 20s budget. `./run-lock.ts` serialises the
 * suites properly; this is how the two callers that cannot afford a file-scope
 * hold — `store-parity`, and `store-roundtrip` at 63 seconds — join that queue
 * for the length of a fixture load instead of a suite.
 *
 * The two are kept together on purpose. The lock excludes the suites that agree
 * to take it; `insertWhenSlotFree` still covers everything that never will — a
 * dev server mid-ingest, a real job. Neither replaces the other.
 *
 * **For the five callers that already hold the lock for their file**, the take
 * below is a no-op: `withRunLock` returns early when this process is the holder.
 * Without that it would be a second connection asking for its own key, and would
 * poll to the deadline. See `./run-lock.ts` and `tests/run-lock.test.ts`.
 *
 * **The job is deleted rather than marked done.** Marking it `done` in a
 * `finally` would claim success for a body that threw, and — worse — an
 * unfenced update could overwrite a job something else had already failed,
 * leaving synthetic history that reads as a real ingest. Deleting the row says
 * the true thing: this job never existed.
 *
 * The delete matches on `jobs.id` **alone**, not on the attempt token — this
 * docstring claimed otherwise until GPT Sol read the two together on
 * 2026-08-28. That is safe here only because the id is minted inside this call
 * and names nothing else; it is not a fence, and nothing should rely on it as
 * one.
 */
async function withRunningJob<T>(
  slug: string,
  ownerId: OwnerId,
  body: (job: { id: string; attemptId: string }) => Promise<T>,
): Promise<T> {
  const db = getDb();
  /* The lock wraps the whole window — insert, body, delete — and not just the
     insert. Holding it only for the insert would let a sibling start its own
     job on this article the moment this one had, which is the race
     `jobs_active_slug` then reports as somebody else's failure. */
  return await withRunLock(`loading ${slug}`, async () => {
    const job = await insertWhenSlotFree(slug, async () => {
      const started = { id: mintId(), attemptId: mintAttempt() };
      await db.insert(jobs).values({
        id: started.id,
        ownerId,
        slug,
        steps: FIXTURE_STEPS,
        status: "running",
        attemptId: started.attemptId,
        leaseExpiresAt: new Date(Date.now() + 600_000),
        workKey: `fixture-${started.id}`,
      });
      return started;
    });
    try {
      return await body(job);
    } finally {
      await db.delete(jobs).where(eq(jobs.id, job.id));
    }
  });
}

/**
 * Load `slug` from `data/` into Postgres, published by default.
 *
 * Idempotent in the way the pipeline is idempotent: each call mints a fresh
 * draft from whatever is published, copies over it and publishes again. It does
 * not compare against what is already there, and it is not trying to — see
 * `LoadedArticle.basedOn` for why a caller usually wants to know.
 */
export async function loadArticleIntoPg(
  slug: string,
  opts: LoadOptions = {},
): Promise<LoadedArticle> {
  const { publish = true, ownerId = currentOwnerId() } = opts;

  return runAsOwner(ownerId, async () => {
    await storeRawBytesFor(slug);

    const fs = createFsArtifactStore();
    const db = getDb();

    return withRunningJob(slug, ownerId, async (job) => {
      const draft = await openOrBeginJobDraft({ slug, job });
      const ref = {
        slug,
        articleId: draft.articleId,
        revisionId: draft.revisionId,
        jobId: job.id,
        attemptId: job.attemptId,
      };

      const copied = await db.transaction((tx) => copyArtefacts(fs, pgArtifactsIn(ref, tx), slug));

      /* **Refuse a copy that moved nothing, before publishing it.** Carry-forward
         means a draft opened from a published revision already holds that
         revision's blocks, tree and step runs — so publishing after copying zero
         steps republishes the *old* article and reports success. The filesystem
         directory could have been empty, or misspelled, or half-written, and the
         result would be indistinguishable from a load that worked. Sol found
         this, and it is the same shape as everything else in this landing. */
      if (copied.length === 0) {
        throw new Error(
          `nothing to load for "${slug}": the filesystem store has no complete step for it. ` +
            "Publishing now would republish whatever is already in Postgres and call it a load.",
        );
      }

      const base = { ...ref, copied, basedOn: draft.basedOn };

      if (opts.createdAt) {
        await db
          .update(articles)
          .set({ createdAt: opts.createdAt })
          .where(eq(articles.id, draft.articleId));
      }

      if (publish === false) return { ...base, published: false, refusedBecause: [] };

      try {
        await publishRevision({ slug, revisionId: draft.revisionId, job });
        return { ...base, published: true, refusedBecause: [] };
      } catch (err) {
        if (publish !== "try" || !(err instanceof PublishRefused)) throw err;
        return { ...base, published: false, refusedBecause: err.reasons };
      }
    });
  });
}
