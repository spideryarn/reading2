/**
 * Move `data/<slug>/` into Postgres, without losing an id or an ordinal.
 *
 *     npm run db:import           # every article
 *     npm run db:import writes    # one
 *
 * The counterpart is src/store/export.ts, which writes the directories back
 * out. **The exporter is the rollback mechanism**, so the two are written and
 * tested together — an importer with no way back is a one-way door, and this
 * migration is explicitly not one until the cutover has held for a release.
 * See docs/plans/postgres-migration.md § The order of work.
 *
 * ## Idempotent, and what that actually means here
 *
 * Running this twice must leave the database in the state one run leaves it —
 * not "converge on something equivalent". The rule that gives that is the same
 * one the pipeline follows: **a new revision only when the text changes.** Same
 * article, same blocks, same revision row, updated in place; changed blocks,
 * new revision, which is correct — that is a different extraction.
 *
 * The revision id itself used to be *derived* from the blocks, which encoded
 * that rule in a hash. It no longer is: ids are minted, opaque, and name
 * nothing about the contents, because `beginRevision` (src/store/pg-revisions.ts)
 * mints one too and two paths disagreeing about what a revision id means is
 * worse than either answer. See `revisionId` below for the whole argument. The
 * ARTICLE id is still derived from the slug, and that asymmetry is deliberate.
 *
 * Convergence is the property, and it is stronger than "does not crash on a
 * second run". A field that is written on the first import and left alone on
 * the second breaks it silently, which is what `article_revisions` did until
 * 2026-08-26: see the note on `revisionValues` below, and on the step rows
 * further down. `data/` is the truth while the pipeline still writes it, so a
 * re-import must be able to notice a DELETION as well as an addition — of a
 * comment, of an artefact, and (with `--prune`) of a whole article.
 *
 * ## What cannot be imported, and is not pretended
 *
 * - **`raw_content_type` and `raw_encoding` are null unless there is a
 *   manifest.** `data/<slug>/raw.html` is not raw: src/pipeline.ts writes a
 *   *decoded string* there and threw away the bytes, the content type and the
 *   sniffed encoding. For a fetch made since `raw.json` existed they survive in
 *   the manifest and are imported from it; for an older one they are gone, and
 *   inventing `text/html; charset=utf-8` would make a guess indistinguishable
 *   from a fact. A *backfilled* manifest counts as gone — see `recovered`.
 * - **`extracted_html` is null for every imported row.** Stage 2 writes
 *   `output/<slug>.html` and stage 3 overwrites the same path with the
 *   id-stamped version, so the intermediate no longer exists on disk. Only
 *   `stamped_html` survives, and that is what is imported.
 *
 * What is genuinely lost is recorded on the result, so the caller can report it
 * rather than discovering it later as a null column.
 *
 * ## Where `data/` is
 *
 * `dataRoot()`, called at the point of use. This file used to hold
 * `const ROOT = path.resolve(import.meta.dirname, "../..")`, which is the
 * repository root from `src/store/` and `/var` from the bundle — see
 * src/store/data-root.ts. Nothing about that changes for `npm run db:import`,
 * which is a local command and gets the same repository root it always did.
 */

import { createHash, randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { loadThreads } from "../chat.js";
import { loadComments } from "../comments.js";
import { getDb } from "../db/client.js";
import { loadLookups } from "../glossary-lookups.js";
import { readRaw, type RawManifest } from "../fetch.js";
import { loadShelf } from "../shelf.js";
import { loadRuns } from "../searches.js";
import {
  articleRevisions,
  articles,
  blockIdentities,
  chatMessages,
  chatThreads,
  comments as commentsTable,
  glossaryLookups,
  jobs,
  revisionBlocks,
  revisionStepRuns,
  searchRuns,
} from "../db/schema.js";
import { isSpideryarnId } from "../ids.js";
import { NOTE_ID_PATTERN } from "../notes.js";
import { log } from "../log.js";
import { currentOwnerId, type OwnerId } from "../owner.js";
import { parseJsonFrom } from "../parse-json.js";
import { dataRoot } from "./data-root.js";
import { hashBlocks } from "../source-hash.js";
import { NotTheLiveAttempt, deriveLibraryScalars } from "./pg-revisions.js";
import type { LabelsFile } from "../labels.js";
import type { Assets } from "../assets.js";
import type { Sketch } from "../sketch-scene.js";
import type { Arc, Block, Glossary, Ideas, Meta, Summaries, Tree, TweetThread } from "../types.js";
import { and, asc, count, eq, inArray, ne } from "drizzle-orm";

const logger = log("store");

/**
 * The `implementation_version` every step row this file writes carries.
 *
 * A marker rather than a version: these rows are inferred from an artefact
 * being on disk, not recorded when a step ran. It is also what makes the
 * withdrawal below safe — the importer deletes only rows wearing its own name,
 * so a real pipeline record can never be destroyed by a migration tool.
 */
const IMPORTED = "imported";

/** What one article's import did, in enough detail to report honestly. */
export interface ImportResult {
  readonly slug: string;
  readonly articleId: string;
  readonly revisionId: string;
  readonly blocks: number;
  readonly comments: number;
  readonly chatThreads: number;
  readonly chatMessages: number;
  readonly searchRuns: number;
  readonly glossaryLookups: number;
  /** Artefacts that were not on disk. Absent is ordinary, not a fault. */
  readonly absent: readonly string[];
  /** Comments dropped because their anchor is not a block id. Always look. */
  readonly unanchoredComments: readonly string[];
  /** Fields that exist in the schema and cannot be recovered from files. */
  readonly unrecoverable: readonly string[];
}

/**
 * A uuid derived from a string, so the same input always names the same row.
 *
 * **Not RFC 4122 §4.3, and an earlier version of this comment said it was.**
 * A real v5 is SHA-1 over a namespace uuid concatenated with a name; this is
 * SHA-256 over NUL-separated strings with the version and variant nibbles
 * stamped on afterwards. GPT Sol caught the mislabel in review, 2026-08-26.
 * Nothing is wrong with the value — the nibbles make it a *valid* uuid, which
 * is all Postgres asks of a `uuid` column, and SHA-256 truncated to 128 bits
 * has more collision resistance than SHA-1 does — but calling it v5 invites
 * somebody to "simplify" it into a library call that produces different ids for
 * the same input, which would re-import every article as a new revision.
 *
 * The `5` is therefore a lie of convenience: it makes the value look like what
 * it is used for. v8 (RFC 9562, "custom") is the honest version number and is
 * what this should be if the ids are ever regenerated; changing it now would
 * change every derived id, so it waits for a migration that wants that anyway.
 */
function derivedUuid(...parts: string[]): string {
  const hash = createHash("sha256").update(parts.join("\0")).digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  // Non-null assertions: a 16-byte Buffer has both of these indices, and
  // `noUncheckedIndexedAccess` cannot know that.
  bytes[6] = (bytes[6]! & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // RFC 4122 variant
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

/** Read a JSON artefact, or undefined when it simply is not there. */
async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return parseJsonFrom<T>(await readFile(file, "utf8"), path.relative(dataRoot(), file));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}

async function readMaybe(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}

async function readMaybeBytes(file: string): Promise<Buffer | undefined> {
  try {
    return await readFile(file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}

/**
 * The manifest, but only where it still describes the bytes we are storing.
 *
 * **A backfilled manifest does not.** Backfill writes one for an article
 * fetched before manifests existed: the original bytes are gone, only the
 * decoded string survives, and so its `encoding` describes the UTF-8
 * re-encoding sitting in `raw.html` rather than what the server actually sent.
 * Copying that into `raw_encoding` would turn a known unknown into a confident
 * wrong answer — the exact trap `sha256: null` exists to avoid on the same
 * file. src/fetch.ts § `RawManifest`.
 */
function provenance(manifest: RawManifest | null): RawManifest | null {
  return manifest?.backfilled ? null : manifest;
}

/**
 * The fingerprint of the blocks, computed the way src/source-hash.ts does it.
 *
 * Imported here rather than reimplemented, because two ways of computing "the
 * same" hash can only ever disagree — which is the reason that module exists at
 * all. It is what makes the revision id deterministic.
 */
async function blocksFingerprint(blocks: Block[]): Promise<string> {
  const { hashBlocks } = await import("../source-hash.js");
  return hashBlocks(blocks);
}

/** The two closed axes, spelled out here because a `Block` from a file is a claim, not a type. */
const ROLES = new Set(["footnote", "reference", "acknowledgment", "credit", "appendix"]);
const TREATMENTS = new Set(["supplement"]);

/**
 * Refuse the whole import if any block's `role` or `treatment` is not one of
 * ours. **Rejected, not dropped, and the choice matters.**
 *
 * Dropping would be the friendlier-looking option and it is the worse one: a
 * block that arrives claiming to be apparatus and is stored as body is
 * *silently reclassified as argument*, which is the exact failure the whole
 * feature exists to prevent — summarised, embedded, and on the clock, with
 * every count still looking plausible (docs/plans/footnotes.md). An import is a
 * file somebody handed us, so a value we do not recognise means the file was
 * written by something we do not understand, and the honest answer is to stop.
 *
 * The CHECK constraint would also stop it — but as a Postgres constraint
 * violation naming `revision_blocks_role`, from inside a transaction, with no
 * block id in it. This is the guard; the constraint is the backstop.
 *
 * ## Each field being legal is not the same as the block being coherent
 *
 * The first version checked the three fields **in isolation**, and GPT Sol's
 * review of stage 3 found that the failure this function exists to prevent
 * walked straight in through the door that left open. Two shapes, both of which
 * every value passes on its own:
 *
 * - `role: "footnote"` with **no `treatment`**. Legal role, absent treatment,
 *   and `isBody` reads an absent treatment as body — so the block declares
 *   itself apparatus in the one column nothing reads and is summarised,
 *   embedded, labelled and put on the clock as argument. Which is silent
 *   reclassification, arriving as a *well-formed* import.
 * - `noteId: "anything at all"`. Stage 2 mints ten hex digits and stage 3
 *   refuses anything else (`noteFieldsFor` in src/blocks.ts gates on
 *   `NOTE_ID_PATTERN`), so a value in any other shape did not come from this
 *   pipeline. Stage 5 resolves a marker to a note by that id; an arbitrary
 *   string there is a hover card resolving to nothing, or to the wrong note.
 *
 * So the cross-field rules are checked too. `NOTE_ID_PATTERN` is imported from
 * src/notes.ts rather than restated, because two spellings of "what an id looks
 * like" can only ever disagree — and the day they do, the minting half and the
 * validating half each look correct.
 *
 * **`role: "appendix"` is deliberately allowed without a treatment.** An
 * appendix may be real prose worth gisting, which is the case one closed set
 * could not express and the reason there are two axes at all (`Block.role` in
 * src/types.ts). The implication runs from `"footnote"` only, because that is
 * the one role v1 assigns and the only one whose meaning is settled.
 *
 * **And `treatment: "supplement"` with no role stays legal**, which is the
 * asymmetry to notice rather than tidy away: apparatus we cannot name the kind
 * of is still apparatus, and every predicate already treats it correctly. It is
 * the reverse direction — a claim of apparatus that the predicates read as body
 * — that is unsafe.
 *
 * **A third rule was considered and left out**, and it is worth the paragraph
 * because it looks like it belongs: `noteId` present ⇒ `treatment:
 * "supplement"`. It has the same shape as the first rule — a block declaring
 * membership of a note while every predicate reads it as argument — and
 * `noteFieldsFor` cannot produce it, since the container check gates all three
 * fields together. It is not enforced for two reasons found by trying it.
 * First, it rejects the five-role fixture in tests/block-roles.test.ts, whose
 * `appendix` block deliberately carries a `noteId` and no treatment; that fixture
 * is arguably wrong, but it is not this function's place to decide so. Second,
 * stage 5 has to resolve a marker to its note, and a `noteId` on the *marker's*
 * block — which is body — is one of the shapes that could be reached for.
 * Foreclosing it from the import validator, before the stage that needs it has
 * been built, is the wrong order.
 *
 * ## Should a CHECK constraint back this?
 *
 * It could: all three are columns of one row, so
 * `check (role <> 'footnote' or treatment = 'supplement')` is expressible, and
 * the same is true of the `note_id` shape. **Not added here**, for two reasons.
 * The first is scope: it needs a migration, and this stage is not applying one.
 * The second is that a constraint is a *backstop* and this is the *guard* — the
 * constraint would fail as a violation naming `revision_blocks_role`, inside a
 * transaction, with no block id in it, which is the position the existing
 * single-column CHECKs already occupy. The recommendation is that the pair ride
 * along with the next migration this feature needs rather than becoming one of
 * their own; recorded in docs/plans/footnotes.md.
 */
export function checkNoteFields(slug: string, blocks: Block[]): void {
  for (const [index, b] of blocks.entries()) {
    const where = `block ${index} (${b.id ?? "no id"})`;
    if (b.role !== undefined && !ROLES.has(b.role)) {
      throw new Error(`${slug}: ${where} has an unrecognised role ${JSON.stringify(b.role)}`);
    }
    if (b.treatment !== undefined && !TREATMENTS.has(b.treatment)) {
      throw new Error(
        `${slug}: ${where} has an unrecognised treatment ${JSON.stringify(b.treatment)}`,
      );
    }
    if (b.noteId !== undefined && typeof b.noteId !== "string") {
      throw new Error(`${slug}: ${where} has a noteId that is not a string`);
    }

    /* The cross-field rules. `role` is checked against the closed set above, so
       by here `"footnote"` means what it says. */
    if (b.role === "footnote" && b.treatment !== "supplement") {
      throw new Error(
        `${slug}: ${where} is a footnote with treatment ${JSON.stringify(b.treatment)} — ` +
          `a footnote is apparatus, and stored without treatment "supplement" every predicate ` +
          `would read it as argument`,
      );
    }
    /* **A footnote must say which note it belongs to.** Stage 3 considered a
       `noteId` rule and left it out, in the other direction (`noteId` present ⇒
       supplement) and for two reasons that were good at the time. This is the
       implication that actually bites, and stage 5a is what made it bite:
       `noteIndex` in src/web/notes-view.ts keys on a non-empty `noteId`, so a
       footnote stored without one is removed from the argument *and* absent
       from the index — its marker opens nothing. Neither of the stage-3
       reasons covers it: the five-role fixture's `appendix` carries a `noteId`
       without the footnote role, and a marker's own block is body. GPT Sol's
       review of stage 4, 2026-08-28. */
    if (b.role === "footnote" && b.noteId === undefined) {
      throw new Error(
        `${slug}: ${where} is a footnote with no noteId — stage 5 resolves a marker to its ` +
          `note by that id, so the note would be stored but unreachable`,
      );
    }
    if (b.noteId !== undefined && !NOTE_ID_PATTERN.test(b.noteId)) {
      throw new Error(
        `${slug}: ${where} has a noteId ${JSON.stringify(b.noteId)} that stage 2 could not have ` +
          `minted (${NOTE_ID_PATTERN.source})`,
      );
    }
  }
}

/**
 * The statuses that mean a job is still working.
 *
 * The same two `ACTIVE` names in src/store/pg-jobs.ts, written out again
 * because that one is module-private and this file must not reach into the job
 * store to widen it. Both are also what `jobs_active_slug` is partial on, so
 * the database's idea of "in flight" and this one are the same list in three
 * places — if a fourth status ever joins them, `tests/store-import-active-job.
 * test.ts` is where the disagreement shows up.
 */
const ACTIVE_JOB = ["queued", "running"] as const;

/** The transaction handle drizzle hands the callback. */
type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

/**
 * The id of a job still working on this owner's slug, or undefined for none.
 *
 * **Takes `tx`, and that is the whole point of the function.** The obvious call
 * is `pgJobStore.activeForSlug`, which asks the identical question — and it
 * calls `getDb()` itself, so it would run on a different connection, outside
 * the caller's transaction, seeing a snapshot the caller's row lock says
 * nothing about. A check that cannot see what the lock is holding is a check
 * that agrees with whatever raced it.
 *
 * **Call it AFTER locking the article row, never before.** The order is the
 * guard: with the lock first, anything that wants to enqueue against this
 * article has to wait for this transaction to end, so the answer here cannot go
 * stale before the write that depends on it. Ask first and lock second and the
 * window is back, exactly as wide as it was.
 *
 * One thing it cannot do, said out loud: for a slug with **no article row yet**
 * there is nothing to lock, so a job enqueued in parallel with a first import
 * is still possible. The refusal below still catches every job that already
 * exists; serialising that last case needs a lock on something that exists
 * before the article does, which is a bigger change than this guard.
 *
 * `exempt` is the job **making** this call — see `verifyImportingJob`.
 */
async function activeJobHolds(
  tx: Tx,
  slug: string,
  owner: OwnerId,
  exempt?: ImportingJob,
): Promise<string | undefined> {
  /* Verified FIRST, and its verified id is what the query below excludes. An
     id taken straight from the caller would be a claim; this is a fact read
     out of the same transaction. */
  const exemptId = exempt ? await verifyImportingJob(tx, slug, owner, exempt) : undefined;
  const [row] = await tx
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      and(
        eq(jobs.ownerId, owner),
        eq(jobs.slug, slug),
        inArray(jobs.status, ACTIVE_JOB),
        ...(exemptId === undefined ? [] : [ne(jobs.id, exemptId)]),
      ),
    )
    .limit(1);
  return row?.id;
}

/**
 * The job on whose behalf `importArticleIn` is being called.
 *
 * Both fields, always. The id alone names a row; the attempt token is what says
 * *this* worker still owns it — `jobs_running_is_fenced` in src/db/schema.ts
 * makes the same argument about the same pair, and `fenceJob`
 * (src/store/pg-revisions.ts) carries both into one `UPDATE` for it.
 */
export interface ImportingJob {
  readonly id: string;
  readonly attemptId: string;
}

/**
 * Confirm the exempt job really is the live attempt for this owner and slug.
 *
 * **The exemption exists because the finalizer would otherwise refuse itself.**
 * A job's last step publishes inside its own transaction, and that job is
 * `running` for this slug — so `activeJobHolds` would find it and throw. It
 * therefore names itself, and the question is how much naming yourself is
 * allowed to buy. GPT Sol, reviewing the D1b design, 2026-08-29:
 *
 * > The job-id exemption is safe only if the transaction **positively verifies
 * > that the exempt job is the currently running job for that owner, slug and
 * > attempt**. Merely adding `jobs.id != exemptId` lets any internal caller
 * > suppress the holder it names.
 *
 * So this is a positive check with four clauses, and every one of them is load
 * bearing — each is a distinct thing an exemption could otherwise be used to
 * suppress, and each has its own case in tests/store-import-in-transaction.test.ts:
 *
 * - **`status = 'running'`** — a *queued* job is exactly the holder the guard
 *   protects: it owns a draft it has not begun. Exempting it is the whole bug.
 * - **`slug`** — a job running against a different article says nothing about
 *   this one. This is the clause a lazy `id != exemptId` skips without looking
 *   wrong.
 * - **`attempt_id`** — a worker whose lease was rescued and reissued still
 *   remembers its old token, and is the one thing a stale worker cannot forge.
 * - **`owner_id`** — `jobs_active_slug` is on (owner, slug), so another
 *   reader's ingest of the same slug is a legitimate active row, and naming it
 *   would be one owner reaching across the isolation every other slug-to-article
 *   query keeps.
 *
 * **Refuses rather than silently declining to exempt.** Not exempting would
 * look safe and is not: a caller naming a job that is not running is a stale
 * worker, and if no *other* job holds the slug the import would then proceed —
 * a suppression attempt turning into a successful write. `NotTheLiveAttempt` is
 * the error `fenceJob` already throws for the identical situation, so a
 * finalizer handles one outcome rather than two spellings of it.
 *
 * **`for update`, so the answer cannot go stale inside the transaction.** Same
 * reasoning as `activeJobHolds`' own docstring: a check that does not hold what
 * it checked agrees with whatever raced it. Taken *after* the article lock,
 * never before — **article lock before job lock, everywhere**
 * (`lockOrCreateArticle`, src/store/pg-revisions.ts).
 */
async function verifyImportingJob(
  tx: Tx,
  slug: string,
  owner: OwnerId,
  job: ImportingJob,
): Promise<string> {
  const [row] = await tx
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      and(
        eq(jobs.id, job.id),
        eq(jobs.attemptId, job.attemptId),
        eq(jobs.status, "running"),
        eq(jobs.slug, slug),
        eq(jobs.ownerId, owner),
      ),
    )
    .limit(1)
    .for("update");
  if (!row) throw new NotTheLiveAttempt(job.id);
  return row.id;
}

/* ------------------------------------------------- the two halves, and why -- */

/**
 * Everything `data/<slug>/` says, parsed and checked — and nothing else.
 *
 * The reading half of the import. It touches no database and takes no
 * transaction, so a caller can read first and then write inside a transaction
 * of its own; `importArticleIn` below is that write.
 *
 * **Every derived value the write needs is computed here**, not there — the
 * fingerprint, the article id, the library scalars, `createdAt`. They are pure
 * functions of the files, and computing them outside the transaction keeps the
 * transaction as short as the writes themselves.
 *
 * `absent` and `unrecoverable` are collected here too, because both are
 * statements about the FILES rather than about what the database did with them.
 */
export interface ArticleFiles {
  readonly slug: string;
  /** Derived from the slug, so the same directory always names the same row. */
  readonly articleId: string;
  readonly blocks: Block[];
  readonly tree: Tree;
  readonly meta: Meta | undefined;
  readonly arc: Arc | undefined;
  readonly assets: Assets | undefined;
  readonly tweets: TweetThread | undefined;
  readonly glossary: Glossary | undefined;
  readonly summaries: Summaries | undefined;
  readonly ideas: Ideas | undefined;
  readonly sketch: Sketch | undefined;
  readonly labels: LabelsFile | undefined;
  /* Reader state, typed from the loaders themselves rather than restated. The
     whole reason these are read through `loadComments` and friends is that the
     importer must not have its own opinion about the shape of those files, and
     a hand-written type here would be exactly that opinion. */
  readonly storedComments: Awaited<ReturnType<typeof loadComments>>;
  readonly unanchored: Awaited<ReturnType<typeof loadComments>>;
  readonly chat: Awaited<ReturnType<typeof loadThreads>>;
  readonly runs: Awaited<ReturnType<typeof loadRuns>>;
  readonly lookups: Awaited<ReturnType<typeof loadLookups>>;
  readonly shelf: Awaited<ReturnType<typeof loadShelf>>;
  readonly manifest: RawManifest | null;
  /** The manifest, but only where it still describes these bytes — `provenance`. */
  readonly recovered: RawManifest | null;
  readonly rawBytes: Buffer | undefined;
  readonly stampedHtml: string | undefined;
  readonly createdAt: Date;
  readonly fingerprint: string;
  readonly scalars: ReturnType<typeof deriveLibraryScalars>;
  readonly absent: readonly string[];
  readonly unrecoverable: readonly string[];
}

/** What the write half did. The rest of `ImportResult` comes from the files. */
export interface ImportedRevision {
  readonly articleId: string;
  readonly revisionId: string;
}

/** The job on whose behalf a write is being made, if there is one. */
export interface ImportArticleInOptions {
  readonly files: ArticleFiles;
  readonly ownerId: OwnerId;
  /**
   * The job calling this, so that it does not refuse itself.
   *
   * Verified rather than trusted — `verifyImportingJob`. Absent for
   * `npm run db:import`, which is a person at a terminal and owns no job.
   */
  readonly job?: ImportingJob;
}

/**
 * Read one article's directory. **No database, no transaction.**
 *
 * Split out of `importArticle` on 2026-08-29, for the same reason
 * `publishRevisionIn` was split out of `publishRevision`: a job's last step has
 * to write its artefacts, publish the article and end the job in ONE
 * transaction, and a function that opens its own cannot be part of one. The
 * files can be read long before that transaction opens, and should be —
 * `readFile` inside a transaction holds a row lock across a disk.
 * docs/plans/delete-the-importer.md § D1b.
 */
export async function readArticleFiles(slug: string): Promise<ArticleFiles> {
  const dir = path.join(dataRoot(), "data", slug);
  const absent: string[] = [];
  const unrecoverable: string[] = [];

  const blocksFile = await readJson<{ blocks: Block[] }>(path.join(dir, "blocks.json"));
  const tree = await readJson<Tree>(path.join(dir, "tree.json"));
  if (!blocksFile || !tree) {
    throw new Error(
      `${slug}: needs both blocks.json and tree.json to import; ` +
        `${blocksFile ? "tree.json" : "blocks.json"} is missing`,
    );
  }
  const blocks = blocksFile.blocks;
  checkNoteFields(slug, blocks);

  const meta = await readJson<Meta>(path.join(dir, "meta.json"));
  if (!meta) absent.push("meta.json");
  const arc = await readJson<Arc>(path.join(dir, "arc.json"));
  if (!arc) absent.push("arc.json");
  const assets = await readJson<Assets>(path.join(dir, "assets.json"));
  if (!assets) absent.push("assets.json");
  const tweets = await readJson<TweetThread>(path.join(dir, "tweets.json"));
  if (!tweets) absent.push("tweets.json");
  const glossary = await readJson<Glossary>(path.join(dir, "glossary.json"));
  if (!glossary) absent.push("glossary.json");
  const summaries = await readJson<Summaries>(path.join(dir, "summary.json"));
  if (!summaries) absent.push("summary.json");
  const ideas = await readJson<Ideas>(path.join(dir, "ideas.json"));
  if (!ideas) absent.push("ideas.json");
  const sketch = await readJson<Sketch>(path.join(dir, "sketch.json"));
  if (!sketch) absent.push("sketch.json");
  const labels = await readJson<LabelsFile>(path.join(dir, "labels.json"));
  if (!labels) absent.push("labels.json");
  /* ## Reader state is read through the app's OWN loaders, never by reopening
     the file here.

     This is not tidiness. The first version of this function read
     `comments.json` as a `Comment[]`; the file is actually
     `{ "comments": [...] }`, so the parse "succeeded", the array was
     `undefined`, the length check said absent, and a 17 KB file of the
     reader's questions imported as zero comments **while reporting success**.
     Every one of these four files wraps its payload in a single-key object, so
     that mistake was available four times over.

     `loadComments`, `loadThreads`, `loadRuns` and `loadLookups` already know
     each file's real shape, already return `[]` for a missing file, and are
     already the functions the app trusts. Reading through them means the
     importer cannot disagree with the reader about what is on disk — which is
     the entire property an importer needs. See docs/reusable/silent-success.md. */
  const allComments = await loadComments(slug);
  if (!allComments.length) absent.push("comments.json");
  /* **A comment whose anchor is not a block id cannot be imported, and one bad
     row must not stop the migration.**

     `block_identities` has a format check, so `spya-xxxxxx` is enforced by the
     database. The filesystem store enforces nothing, and something wrote a
     comment on `data/writes` anchored to `zzzz00` on 2026-08-26 — which the
     file accepted in silence and the constraint refused, taking the whole
     import down with it. Both halves of that are worth knowing: there is a
     writer somewhere producing anchors that are not block ids, and the file
     store will never tell you.

     Skipped rather than fatal, because this is a migration tool and one
     malformed row out of eleven should not block ten good ones — the same
     partial-salvage rule the summaries stage already follows. Skipped rather
     than repaired, because there is nothing to repair it to: the anchor names
     no paragraph, so there is no right answer to guess. Counted and logged, so
     "the import lost a comment" can never be something you find out later. */
  const storedComments = allComments.filter((c) => isSpideryarnId(c.blockId));
  const unanchored = allComments.filter((c) => !isSpideryarnId(c.blockId));
  if (unanchored.length) {
    // Ids only. The quote is the reader's selected prose — docs/project/logging.md.
    logger.warn(
      { slug, comments: unanchored.map((c) => c.id), count: unanchored.length },
      "comments skipped: anchor is not a block id",
    );
  }
  const chat = await loadThreads(slug);
  if (!chat.length) absent.push("chat.json");
  const runs = await loadRuns(slug);
  if (!runs.length) absent.push("searches.json");
  const lookups = await loadLookups(slug);
  if (!Object.keys(lookups).length) absent.push("glossary-lookups.json");

  /* Shelf state — archived, renamed, opened. Onto `articles` rather than onto
     the revision, which is the whole point of it: re-importing must not
     un-archive an article or forget the reader's title. src/shelf.ts.

     Not added to `absent`: every other file here is something the pipeline or
     the reader produced, and its absence is worth reporting. A shelf file is
     absent for every article nobody has touched, which is most of them, so
     listing it would make the importer's summary noisier for no information. */
  const shelf = await loadShelf(slug);

  /* Whichever file stage 1's manifest names — `raw.html` for a web page,
     `raw.pdf` for a PDF (docs/plans/pdf-ingestion.md). Articles fetched before
     `raw.json` existed have no manifest and are all HTML, so that is the
     fallback. A manifest also *recovers* the content type and encoding, which
     is why the "unrecoverable" note below is now conditional: for a fetch made
     since 2026-08-26 they are simply there. */
  const manifest = await readRaw(dir);
  const rawName = manifest?.file ?? "raw.html";
  const rawBytes = await readMaybeBytes(path.join(dir, rawName));
  const recovered = provenance(manifest);
  if (!rawBytes) absent.push(rawName);
  else if (!recovered?.contentType) unrecoverable.push("raw_content_type", "raw_encoding");

  const stampedHtml = await readMaybe(path.join(dataRoot(), "output", `${slug}.html`));
  if (!stampedHtml) absent.push(`output/${slug}.html`);
  unrecoverable.push("extracted_html");

  /**
   * `addedAt` in the library is `meta.fetchedAt` where stage 2 recorded one and
   * **the mtime of blocks.json otherwise** — the noema article's meta.json says
   * so in its own `note`, having been hand-written without a `fetchedAt`
   * because nobody knows it.
   *
   * So the revision's `createdAt` is seeded from that same mtime rather than
   * from `now()`. The Postgres reader falls back `fetchedAt ?? createdAt`, and
   * this is what makes that fallback land on the identical value instead of on
   * the moment the import happened to run. Without it the library would quietly
   * reorder itself the first time anybody imported.
   */
  const blocksStat = await stat(path.join(dir, "blocks.json"));
  const createdAt = meta?.fetchedAt ? new Date(meta.fetchedAt) : blocksStat.mtime;

  const fingerprint = await blocksFingerprint(blocks);
  const articleId = derivedUuid("article", slug);

  /* The library's scalars, through the SAME function the pipeline publishes
     with (src/store/pg-revisions.ts). It was eight lines of arithmetic here and
     they had already drifted: `describeArticle` in src/api.ts falls back to
     `meta.excerpt` for the blurb and this did not, so an article whose tree root
     has no gist got a blurb on the filesystem and none in Postgres. A review
     found it, and the fix is one derivation rather than two that agree today. */
  const scalars = deriveLibraryScalars({ blocks, tree, excerpt: meta?.excerpt });

  return {
    slug,
    articleId,
    blocks,
    tree,
    meta,
    arc,
    assets,
    tweets,
    glossary,
    summaries,
    ideas,
    sketch,
    labels,
    storedComments,
    unanchored,
    chat,
    runs,
    lookups,
    shelf,
    manifest,
    recovered,
    rawBytes,
    stampedHtml,
    createdAt,
    fingerprint,
    scalars,
    absent,
    unrecoverable,
  };
}

/**
 * Write one article into Postgres, **inside the caller's transaction**.
 *
 * The other half of `readArticleFiles`, and the reason the split exists. Every
 * statement below belongs to `tx`, so a caller that fails afterwards leaves
 * nothing published — which is the property the pipeline's finalizer needs:
 * publish the article and set `jobs.status = 'done'` together, or neither.
 * `tests/store-import-in-transaction.test.ts` is that property, written as a
 * rollback.
 *
 * It is the former body of `importArticle`'s `db.transaction(...)`, moved
 * unchanged apart from taking its values from `opts.files` and returning the
 * revision id rather than assigning it to a closure. **Nothing was reordered.**
 * The article lock comes before the jobs query, the reader-state deletes come
 * before the reinserts, comments come after chat, and the pointer moves last —
 * each of those is load bearing and each is argued where it happens.
 *
 * It logs nothing. `importArticle` prints its line after **its** commit, by the
 * same rule `publishRevisionIn` follows: a log line inside a caller's
 * transaction announces a publication that a later rollback un-does.
 */
export async function importArticleIn(
  tx: Tx,
  opts: ImportArticleInOptions,
): Promise<ImportedRevision> {
  const { ownerId } = opts;
  const {
    slug,
    articleId,
    blocks,
    tree,
    meta,
    arc,
    assets,
    tweets,
    glossary,
    summaries,
    ideas,
    sketch,
    labels,
    storedComments,
    chat,
    runs,
    lookups,
    shelf,
    manifest,
    recovered,
    rawBytes,
    stampedHtml,
    createdAt,
    fingerprint,
    scalars,
  } = opts.files;
  let revisionId = "";
  /* **Refuse to import over somebody else's article.**
   *
     `articleId` is derived from the slug, so an import for a slug that is
     already there resolves to the *existing* row whoever owns it — and the
     upsert below then updates that row, deletes its comments, chat, searches
     and lookups by `articleId`, and reinserts them stamped with this
     importer's owner. One `npm run db:import` with the wrong
     `SPIDERYARN_OWNER_ID` and another reader's article has quietly changed
     hands, with every write reporting success.

     GPT Sol found it reviewing the ownership work, 2026-08-27, and it is a
     fair hit: the isolation added that day covered every path from a slug to
     an article *through the store*, and this is the CLI going round the side.

     A read-and-refuse rather than an owner-scoped upsert, deliberately. An
     upsert that simply did not match would insert a second row and hit the
     unique constraint on `slug`, which reads as a database error rather than
     as the answer to a question nobody asked out loud. This says the thing. */
  const [existing] = await tx
    .select({ ownerId: articles.ownerId })
    .from(articles)
    .where(eq(articles.id, articleId))
    .limit(1)
    /* `for update`, and the lock has to be taken HERE rather than after the
       jobs query below — see `activeJobHolds`. */
    .for("update");
  if (existing && existing.ownerId !== ownerId) {
    throw new Error(
      `${slug}: that slug already belongs to a different owner in Postgres. ` +
        "Importing would take their article, and everything anchored to it. " +
        "Check SPIDERYARN_OWNER_ID. See src/store/import.ts.",
    );
  }

  /* **Refuse to import under a job that is still working.**
   *
     The article row is locked by the select above; this is the second half of
     the pair, and both halves are inside this transaction. A queued or
     running job for this owner and slug owns a draft revision it is about to
     write into, and the pointer move at the end of this transaction would
     replace the base that draft was carried forward from — quietly, with
     every write reporting success and the reader's job finishing onto an
     article that is no longer the one it started from.

     GPT Sol raised it against the D1b design, 2026-08-29: "both operations
     should lock the article, then refuse any queued/running job for that
     owner and slug before changing revisions or reader state."

     A throw rather than a skip, because this function is handed one slug and
     has no other answer to give. `pruneOrphans` below does the same check and
     skips, for the opposite reason.

     `opts.job` is the one job this refusal does not apply to — the finalizer
     calling us, which is itself running for this slug and would otherwise
     refuse itself. It is checked against the jobs table before it excuses
     anything: `verifyImportingJob`. */
  const holder = await activeJobHolds(tx, slug, ownerId, opts.job);
  if (holder) {
    throw new Error(
      `${slug}: there is a queued or running job for that slug (${holder}), and importing ` +
        "would replace the revision it is building on. Wait for it to finish, or stop it. " +
        "See src/store/import.ts.",
    );
  }

  await tx
    .insert(articles)
    .values({
      id: articleId,
      ownerId,
      slug,
      /* The article's own added-time, seeded from the same value as the
         revision's. The shelf orders on `coalesce(revision.fetched_at,
         article.created_at)` (`ADDED_AT`, src/store/pg.ts), so leaving this
         at `now()` would put every article with no `fetchedAt` at the top of
         the library on the day it was imported. */
      createdAt,
      archivedAt: shelf.archivedAt ? new Date(shelf.archivedAt) : null,
      titleOverride: shelf.title ?? null,
      opens: shelf.opens,
      lastOpenedAt: shelf.lastOpenedAt ? new Date(shelf.lastOpenedAt) : null,
    })
    /* Do NOT "update" the id on conflict. `articleId` is derived from the
       slug, so a slug that is already there already has this id — and an
       upsert that rewrote a primary key would cascade through every foreign
       key pointing at it, which is a very expensive way to say "already
       imported".

       The four shelf columns ARE updated, and that is not an inconsistency:
       the id is identity and the shelf state is content. Re-running the
       importer after archiving something on disk must carry the archive over,
       or the round trip loses it — silently, since both halves succeed. */
    .onConflictDoUpdate({
      target: articles.id,
      set: {
        createdAt,
        archivedAt: shelf.archivedAt ? new Date(shelf.archivedAt) : null,
        titleOverride: shelf.title ?? null,
        opens: shelf.opens,
        lastOpenedAt: shelf.lastOpenedAt ? new Date(shelf.lastOpenedAt) : null,
      },
    });

  /* **Which revision this import lands on, and why it is no longer derived
     from the blocks.**

     It used to be `derivedUuid("revision", slug, hashBlocks(blocks))`, which
     made the id a function of the content — so two extractions that happened
     to produce identical blocks were the SAME ROW, and the second overwrote
     the first in place. That is exactly what "immutable in its text" forbids,
     and once `beginRevision` (src/store/pg-revisions.ts) started minting a
     fresh uuid the importer was the only thing left deriving one. Two paths
     disagreeing about what a revision id *means* is worse than either answer,
     so it was decided in the same change: **a revision id is opaque, minted
     once, and names nothing about the contents.**

     What survives is the rule the derivation was standing in for, and it is
     the same rule the pipeline follows: **a new revision only when the text
     changes.** So this asks the question directly instead of encoding it in a
     hash — does the current published revision hold these same blocks?

     - Yes → update it in place. That keeps the importer's contract, which is
       that re-running it converges rather than accumulating, and it is what
       makes a corrected `meta.json` land on the article you are looking at.
     - No → mint a new revision and move the pointer at the end of this
       transaction, exactly as the first import does.

     `derivedUuid("article", slug)` stays, and the asymmetry is deliberate: an
     article really is identified by its slug, and a stable article id is what
     lets the importer, the exporter and the tests address the same row twice.

     **This is still the importer's licence, not the schema's.** Updating a
     published row in place is a migration tool's privilege — the files win —
     and it is the same reason cutover is a step rather than a flag flip. */
  const currentBlocks = await tx
    /* Four columns, not two — the third of the three narrow fingerprint
       reads. `hashBlocks` folds in `role` and `treatment`
       (src/source-hash.ts), so a two-column read here would compare a full
       new hash against an old narrow one and mint a fresh revision on every
       single import, for ever. */
    .select({
      id: revisionBlocks.blockId,
      text: revisionBlocks.text,
      role: revisionBlocks.role,
      treatment: revisionBlocks.treatment,
    })
    .from(revisionBlocks)
    .innerJoin(articles, eq(articles.currentRevisionId, revisionBlocks.revisionId))
    .where(eq(articles.id, articleId))
    .orderBy(asc(revisionBlocks.ordinal));
  const current = await tx
    .select({ id: articles.currentRevisionId })
    .from(articles)
    .where(eq(articles.id, articleId));
  const currentRevisionId = current[0]?.id ?? null;
  const sameText =
    currentRevisionId !== null &&
    currentBlocks.length > 0 &&
    hashBlocks(currentBlocks) === fingerprint;
  revisionId = sameText && currentRevisionId ? currentRevisionId : randomUUID();

  /* **One object, used for both branches, and that is the whole fix.**

     `article_revisions` says "immutable once published", and the revision id
     is `slug + hashBlocks(blocks)` — so a change to `meta.json` alone hashes
     to the SAME revision and lands in the `on conflict do update` branch. That
     branch used to list twelve of these columns. A corrected title, a byline
     that was missing, the URL after a redirect, the raw bytes: all of them
     kept the first run's value for ever, while the tree sitting beside them
     updated. Nothing said so, because both halves succeeded. GPT Sol found it
     in review, 2026-08-26.

     Two other fixes were on the table and both were rejected:

     - **Fingerprint the whole revision**, so a metadata edit mints a new
       revision and published rows really are immutable. It is the tidy answer
       and it is the wrong shape for this schema: `revision_step_runs` is keyed
       by `revision_id` precisely so that the pipeline can fill a revision in
       one step at a time. If the id moved whenever `arc.json` or
       `glossary.json` changed, every completed step would be orphaned by the
       next one, and each re-run would duplicate the blocks and the raw bytes
       under a new id. The revision is one EXTRACTION — `slug` plus the blocks
       is exactly the identity of that.
     - **Refuse to touch a published revision.** That reads as the safe
       option and it makes the migration tool useless: re-running the importer
       after fixing a typo, or after re-running one late stage, is the normal
       case during a migration, and the honest response to it is to converge,
       not to error.

     So: the revision id stays the extraction's identity, and the row becomes
     a pure function of the files — written the same way whether it is the
     first import or the fifth. Sharing one object rather than keeping two
     lists in step is the point; a column added to the insert alone was how
     this happened, and now there is no insert alone to add it to.

     **This is the importer's licence, not the schema's.** Immutability is
     still what the pipeline must honour once it owns this table; the importer
     is a migration tool whose contract is that the files win — the same rule
     the reader-state delete below already follows, and the same reason
     cutover is a step rather than a flag flip. */
  const revisionValues = {
    status: "published",
    title: meta?.title ?? null,
    byline: meta?.byline ?? null,
    siteName: meta?.siteName ?? null,
    lang: meta?.lang ?? null,
    excerpt: meta?.excerpt ?? null,
    note: meta?.note ?? null,
    /* The manifest is the only thing that ever knew these two apart: `meta`
       has one `url` and it is the one stage 2 saw, which is the FINAL url.
       So `finalUrl` prefers `meta` — an exporter rebuilds `meta.json` from
       it and the round trip has to come back byte-identical — and
       `requestedUrl` prefers the manifest, which is the only place the
       pre-redirect url survives at all. */
    requestedUrl: manifest?.requestedUrl ?? meta?.url ?? null,
    finalUrl: meta?.url ?? manifest?.url ?? null,
    fetchedAt: meta?.fetchedAt ? new Date(meta.fetchedAt) : null,
    // In the update branch too, or a re-import leaves the first run's value
    // behind and the library's order silently depends on which import ran first.
    createdAt,
    rawBytes: rawBytes ?? null,
    // Null where there is no manifest, and that null is the honest answer —
    // see the header, and `recovered` above for why a backfilled one does not count.
    rawContentType: recovered?.contentType ?? null,
    rawEncoding: recovered?.encoding ?? null,
    rawSha256: recovered?.sha256 ?? null,
    /* PDF provenance — all null for a web page, which is most of them.
       `meta` rather than the manifest: the manifest says what was FETCHED,
       these say how it was READ, and only stage 2 knows that.
       docs/plans/pdf-ingestion.md. */
    source: meta?.source ?? null,
    extractMethod: meta?.method ?? null,
    pages: meta?.pages ?? null,
    unverified: meta?.unverified ?? null,
    recall: meta?.recall ?? null,
    pagesChecked: meta?.pagesChecked ?? null,
    // Genuinely gone: stage 3 overwrites stage 2's file at the same path.
    extractedHtml: null,
    stampedHtml: stampedHtml ?? null,
    tree,
    arc: arc ?? null,
    assets: assets ?? null,
    tweets: tweets ?? null,
    glossary: glossary ?? null,
    summary: summaries ?? null,
    ideas: ideas ?? null,
    sketch: sketch ?? null,
    labels: labels ?? null,
    ...scalars,
  } as const;

  await tx
    .insert(articleRevisions)
    .values({ id: revisionId, articleId, ...revisionValues })
    .onConflictDoUpdate({ target: articleRevisions.id, set: { ...revisionValues } });

  // Identities FIRST, and never deleted. revision_blocks has a foreign key
  // onto this, so a block whose identity was not minted fails loudly — which
  // is what we want, because that means stage 3 re-minted instead of carrying
  // ids forward. See docs/project/block-ids.md.
  if (blocks.length) {
    await tx
      .insert(blockIdentities)
      .values(blocks.map((b) => ({ articleId, blockId: b.id })))
      .onConflictDoNothing();

    // Replaced wholesale for this revision: an import is authoritative about
    // what this extraction contained, and a leftover row from a previous run
    // with different blocks would be a paragraph nothing points at.
    await tx.delete(revisionBlocks).where(eq(revisionBlocks.revisionId, revisionId));

    // `ordinal` IS document order, written from the array index. Block ids are
    // random and carry no position, so if this is wrong there is nothing left
    // to recover the order from.
    await tx.insert(revisionBlocks).values(
      blocks.map((b, index) => ({
        articleId,
        revisionId,
        blockId: b.id,
        ordinal: index,
        tag: b.tag,
        kind: b.kind,
        level: b.level ?? null,
        text: b.text,
        words: b.words,
        html: b.html,
        gistable: b.gistable,
        note: b.note ?? null,
        role: b.role ?? null,
        treatment: b.treatment ?? null,
        noteId: b.noteId ?? null,
      })),
    );
  }

  /* **The files win, so the rows the files no longer have must go.**

     Every reader-state insert below is `on conflict do nothing`, which makes
     a re-import add and never change. That is right for a row that is already
     identical and wrong for one the reader has since deleted: `data/` is the
     source of truth while the pipeline still writes it, so a comment removed
     from `comments.json` has to leave the database too. Without this the
     database only ever grows, and it grew — `data/writes/comments.json` held
     two comments while Postgres held three, and tests/store-parity.test.ts
     went red for a real reason on 2026-08-26. GPT Sol had named the cause in
     review that morning: "reader-state rows use ON CONFLICT DO NOTHING, so
     edits and deletions in files are also ignored".

     **This direction reverses at cutover, and that is the danger.** Once the
     app writes comments to Postgres rather than to files, running the
     importer would delete every comment written since the last export — the
     database would be made to match a file that is no longer being kept up to
     date. The importer is a migration tool, not a sync; see
     docs/plans/postgres-storage-implementation.md.

     Deleted inside the same transaction as the inserts, so there is no moment
     at which a reader sees an article with its questions missing.

     `block_identities` is deliberately NOT cleaned up: identities are never
     deleted, which is the one rule the comment anchor depends on. */
  await tx.delete(commentsTable).where(eq(commentsTable.articleId, articleId));
  await tx.delete(chatMessages).where(eq(chatMessages.articleId, articleId));
  await tx.delete(chatThreads).where(eq(chatThreads.articleId, articleId));
  await tx.delete(searchRuns).where(eq(searchRuns.articleId, articleId));
  await tx.delete(glossaryLookups).where(eq(glossaryLookups.articleId, articleId));

  /* Reader state. All three hang off the ARTICLE, never off the revision:
     a re-extraction must not delete a conversation, a saved search, or a
     looked-up term, for the same reason it must not delete a comment. */

  /* **Every block either kind of mark names, minted in one statement.**
     A comment and an anchored conversation both point at the block IDENTITY,
     and both foreign keys are just as unforgiving: import an archive whose
     marked paragraph is no longer in this revision and the insert takes the
     whole transaction down with it. That is the design — the paragraph can
     go, the mark stays — so the identity has to exist first, whether or not
     this revision still contains the block.

     One statement over the union of the two, rather than two lists
     maintained in parallel: the comments used to mint theirs separately a few
     lines earlier, which is the shape that lets one of them fall behind. */
  const anchoredBlocks = [
    ...new Set([
      ...storedComments.map((c) => c.blockId),
      ...chat.flatMap((t) => (t.anchor ? [t.anchor.blockId] : [])),
    ]),
  ];
  if (anchoredBlocks.length) {
    await tx
      .insert(blockIdentities)
      .values(anchoredBlocks.map((blockId) => ({ articleId, blockId })))
      .onConflictDoNothing();
  }

  for (const thread of chat) {
    await tx
      .insert(chatThreads)
      .values({
        articleId,
        id: thread.id,
        ownerId,
        title: thread.title,
        createdAt: new Date(thread.createdAt),
        updatedAt: new Date(thread.updatedAt),
        /* `"quote" in anchor` rather than `anchor.quote`: the union's
           block-only arm has no such property, so reading one off it is a
           type error rather than a silent undefined. */
        anchorBlockId: thread.anchor?.blockId ?? null,
        anchorQuote: thread.anchor && "quote" in thread.anchor ? thread.anchor.quote : null,
        anchorStart: thread.anchor && "start" in thread.anchor ? thread.anchor.start : null,
        /* A `chat.json` written before review mode has no `kind`; the column
           is `not null`, so it needs one here rather than a null. `"chat"` is
           the same default `normaliseKind` applies in src/chat.ts and the same
           one the column declares — three places, all saying chat, because
           the alternative to a default here is a failed import of every
           pre-existing file. */
        kind: thread.kind === "review" ? "review" : "chat",
      })
      .onConflictDoNothing();

    // `ordinal` from the array index, exactly as for blocks: `createdAt`
    // cannot order these because a user turn and the pending assistant turn
    // answering it are written together and collide within the millisecond.
    for (const [index, message] of thread.messages.entries()) {
      await tx
        .insert(chatMessages)
        .values({
          articleId,
          threadId: thread.id,
          id: message.id,
          ordinal: index,
          role: message.role,
          text: message.text,
          status: message.status,
          citations: message.citations ?? null,
          searches: message.searches ?? null,
          tools: message.tools ?? null,
          model: message.model ?? null,
          error: message.error ?? null,
          stopped: message.stopped ?? false,
          editedAt: message.editedAt ? new Date(message.editedAt) : null,
          /* See the note beside this field in src/store/export.ts: without
             it, a restore drops the stance from every review answer and says
             nothing. */
          stance: message.stance ?? null,
          createdAt: new Date(message.createdAt),
        })
        .onConflictDoNothing();
    }
  }

  /* **Comments last, and that is a rule rather than a tidy-up.**
     `Comment.threadId` names a conversation, so an archive's comments can
     only be read against threads that are already in. There is deliberately
     no foreign key on that column (docs/plans/comments-and-bookmarks.md § no
     foreign key), so nothing *fails* if this runs first — which is exactly
     why the order is written down here rather than left to a constraint to
     enforce. GPT Sol found this block sitting before the chat inserts,
     2026-08-28.

     The identities these anchor to were minted with the chat anchors' above,
     in one statement over the union: the paragraph can go, the mark stays. */
  for (const comment of storedComments) {
    await tx
      .insert(commentsTable)
      .values({
        articleId,
        id: comment.id,
        ownerId,
        blockId: comment.blockId,
        quote: comment.quote,
        start: comment.start,
        /* The reader's own three. `?? null` on each, because absent in the
           archive and null in the column are the same fact, and leaving
           `undefined` would let the column default decide instead. */
        body: comment.body ?? null,
        updatedAt: comment.updatedAt === undefined ? null : new Date(comment.updatedAt),
        threadId: comment.threadId ?? null,
        status: comment.status,
        answer: comment.answer ?? null,
        citations: comment.citations ?? null,
        searches: comment.searches ?? null,
        model: comment.model ?? null,
        error: comment.error ?? null,
        createdAt: new Date(comment.createdAt),
      })
      .onConflictDoNothing();
  }

  for (const run of runs) {
    await tx
      .insert(searchRuns)
      .values({
        articleId,
        id: run.id,
        ownerId,
        criterion: run.criterion,
        status: run.status,
        hits: run.hits,
        /* The article this run was answered against. Dropping it on import
           would not read as "unknown" — `isStale` reads an absent hash as
           *out of date*, so every saved search on every imported article
           would carry the "answered against an older version" banner
           permanently, for no reason. tests/store-roundtrip.test.ts catches
           it, but only once a real `searches.json` under some article
           carries the field, which is why this is written now rather than
           waited for. (That sentence named the glob directly until the `*`
           and `/` closed this comment three lines early.) */
        sourceHash: run.sourceHash ?? null,
        // The reader's own colour choice — the same round-trip rule as the
        // hash above, and the only field on a run neither the model nor the
        // pipeline wrote.
        colour: run.colour ?? null,
        model: run.model ?? null,
        error: run.error ?? null,
        createdAt: new Date(run.createdAt),
      })
      .onConflictDoNothing();
  }

  for (const [entryId, lookup] of Object.entries(lookups)) {
    await tx
      .insert(glossaryLookups)
      .values({
        articleId,
        entryId,
        ownerId,
        answer: lookup.answer,
        citations: lookup.citations,
        searches: lookup.searches,
        model: lookup.model,
        at: new Date(lookup.at),
      })
      .onConflictDoNothing();
  }

  /* Which steps produced output.
     `revision_step_runs` is what answers "has this stage run", and the
     metadata page reads it — so without these rows every imported article
     would report every stage as never having run, which is both wrong and
     alarming. `implementation_version` says `imported` rather than a real
     version because that is the truth: these rows are inferred from the
     artefacts being present, not recorded when the step ran. A step whose
     artefact is absent gets NO NEW row, which is the honest distinction
     between "did not run" and "ran and produced nothing".

     **An inferred row is withdrawn when its artefact goes.** These used only
     ever to be added, so deleting `arc.json` and re-importing left a `done`
     row behind and the metadata page went on reporting a stage whose output
     does not exist — the same shape as the reader-state bug above, where
     `on conflict do nothing` made a re-import unable to notice a deletion.
     GPT Sol found it in review, 2026-08-26.

     **Scoped to `implementation_version = 'imported'`, which is the importer
     saying it only clears up after itself.** The reader-state deletes above
     are unconditional because a file really is the truth about a reader's
     comment today. This table is different: the pipeline is about to own it
     for real, and once it does, a `done` row for a step whose FILE is missing
     is CORRECT — the file stopped being where the output lives. A migration
     tool must not be able to delete that record, so it deletes only rows
     carrying its own marker. Nothing else writes `imported`. */
  const produced: { step: string; present: boolean }[] = [
    { step: "fetch", present: Boolean(rawBytes) },
    { step: "extract", present: Boolean(meta) },
    { step: "blocks", present: blocks.length > 0 },
    { step: "toc", present: Boolean(tree) },
    { step: "assets", present: Boolean(assets) },
    { step: "arc", present: Boolean(arc) },
    { step: "tweets", present: Boolean(tweets) },
    { step: "glossary", present: Boolean(glossary) },
    { step: "summary", present: Boolean(summaries) },
    { step: "ideas", present: Boolean(ideas) },
    { step: "sketch", present: Boolean(sketch) },
  ];
  const withdrawn = produced.filter((p) => !p.present).map((p) => p.step);
  if (withdrawn.length) {
    await tx
      .delete(revisionStepRuns)
      .where(
        and(
          eq(revisionStepRuns.revisionId, revisionId),
          inArray(revisionStepRuns.stepName, withdrawn),
          eq(revisionStepRuns.implementationVersion, IMPORTED),
        ),
      );
  }
  for (const { step, present } of produced) {
    if (!present) continue;
    await tx
      .insert(revisionStepRuns)
      .values({
        revisionId,
        stepName: step,
        inputHash: fingerprint,
        implementationVersion: IMPORTED,
        status: "done",
      })
      /* Nothing to update: for a given revision the blocks — and so the
         fingerprint — cannot change, and a row already here under a real
         implementation version is a pipeline record that outranks this one. */
      .onConflictDoNothing();
  }

  // The pointer moves LAST, so nothing observes a half-built revision. Not
  // deferrable and not needing to be: insert article, insert revision, update
  // pointer, and no intermediate state violates anything.
  await tx
    .update(articles)
    .set({ currentRevisionId: revisionId })
    .where(eq(articles.id, articleId));

  return { articleId, revisionId };
}

/**
 * Import one article's directory.
 *
 * Everything happens in **one transaction**, because publication is the atomic
 * unit: a reader sees either the previous published revision or the complete
 * new one, never a mixture. That is the property today's filesystem store does
 * not have — a failed re-extraction overwrites a good article in place.
 *
 * Since 2026-08-29 it is `readArticleFiles` and `importArticleIn` composed, and
 * this function is what keeps `npm run db:import` exactly what it was: read the
 * directory, open one transaction, write, log after the commit. The two halves
 * exist so that the pipeline's job finalizer can do the same writes inside a
 * transaction that also ends the job — see `importArticleIn`.
 */
export async function importArticle(
  slug: string,
  ownerId: OwnerId = currentOwnerId(),
): Promise<ImportResult> {
  const files = await readArticleFiles(slug);
  const { articleId, revisionId } = await getDb().transaction((tx) =>
    importArticleIn(tx, { files, ownerId }),
  );

  // After the commit, never inside it: see `importArticleIn`.
  logger.info(
    {
      slug,
      blocks: files.blocks.length,
      comments: files.storedComments.length,
      absent: files.absent.length,
    },
    "article imported",
  );

  return {
    slug,
    articleId,
    revisionId,
    blocks: files.blocks.length,
    comments: files.storedComments.length,
    unanchoredComments: files.unanchored.map((c) => c.id),
    chatThreads: files.chat.length,
    chatMessages: files.chat.reduce((n, thread) => n + thread.messages.length, 0),
    searchRuns: files.runs.length,
    glossaryLookups: Object.keys(files.lookups).length,
    absent: files.absent,
    unrecoverable: [...new Set(files.unrecoverable)],
  };
}

/** Every directory under `data/` that looks like an article. */
export async function importableSlugs(): Promise<string[]> {
  const { readdir } = await import("node:fs/promises");
  const root = dataRoot();
  const entries = await readdir(path.join(root, "data"), { withFileTypes: true });
  const found: string[] = [];
  for (const entry of entries) {
    // `_`-prefixed directories are not articles — `data/_jobs/` is the queue's.
    if (!entry.isDirectory() || entry.name.startsWith("_")) continue;
    const blocks = await readMaybe(path.join(root, "data", entry.name, "blocks.json"));
    const tree = await readMaybe(path.join(root, "data", entry.name, "tree.json"));
    if (blocks && tree) found.push(entry.name);
  }
  return found;
}

/* ---------------------------------------------------------------- prune -- */

/**
 * An article Postgres still has and `data/` no longer does, with what it holds.
 *
 * The counts are the point of the type: a person is about to be asked whether
 * to delete this, and "1 article" and "1 article, 11 of your questions" are
 * different questions.
 */
export interface Orphan {
  readonly slug: string;
  readonly articleId: string;
  readonly comments: number;
  readonly chatThreads: number;
  readonly searchRuns: number;
  readonly glossaryLookups: number;
}

/**
 * Which slugs the database has that the disk does not — the whole rule, as a
 * pure function of two lists.
 *
 * **Separated out because the dangerous failure is not "prunes too little".**
 * It is `data/` being momentarily unreadable, or the process running from the
 * wrong directory, and the tool then concluding that every article has been
 * deleted. That decision is worth being able to test with no database and no
 * filesystem in the way, so it lives here rather than inside the query.
 *
 * An empty disk **throws** rather than returning nothing. Returning nothing
 * would be perfectly safe today and would silently stop pruning for ever the
 * day the scan breaks — [silent-success](../../docs/reusable/silent-success.md)
 * exactly. An empty *database* is not an error: that is a fresh machine.
 *
 * This is only the first of two checks. Being on this list makes a slug a
 * candidate; `findOrphans` then asks the filesystem directly whether the
 * directory is really gone, because `importableSlugs` deliberately omits
 * directories that exist — `_`-prefixed ones, and any article whose extraction
 * is half-written.
 */
export function orphanSlugs(inDatabase: readonly string[], onDisk: readonly string[]): string[] {
  if (!inDatabase.length) return [];
  if (!onDisk.length) {
    throw new Error(
      "refusing to prune: no directory under data/ has both blocks.json and tree.json. " +
        "That is far more likely a wrong working directory or an unreadable data/ " +
        "than every article having been deleted, and the difference is unrecoverable.",
    );
  }
  const have = new Set(onDisk);
  return inDatabase.filter((slug) => !have.has(slug));
}

/** Present, really gone, or we could not tell — and the three are not two. */
async function directoryState(dir: string): Promise<"present" | "gone" | "unknown"> {
  try {
    return (await stat(dir)).isDirectory() ? "present" : "unknown";
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "ENOENT" ? "gone" : "unknown";
  }
}

/**
 * Every article this owner has in Postgres whose `data/` directory has gone.
 *
 * **`npm run db:import` has only ever added and updated.** `importArticle`
 * reconciles the slug it is handed and has no way to notice that a DIFFERENT
 * one has vanished, so a deleted article kept its row, kept its current
 * revision, and went on being listed and served by src/store/pg.ts. It is also
 * the confirmed cause of the parity suite failing in full runs and passing
 * alone for an afternoon: `labels-checkpoint-check` was left behind by
 * somebody's checkpoint run and neither store could explain the other.
 *
 * ## Two independent checks, because this is the input to a delete
 *
 * 1. `orphanSlugs` above — in the database, not in `importableSlugs()`.
 * 2. `stat` on the directory itself, which must say ENOENT.
 *
 * They disagree often and on purpose. `importableSlugs` skips `_`-prefixed
 * directories (`data/_jobs/` is the queue's) and skips any article missing
 * `blocks.json` or `tree.json` — a re-extraction part-way through, a stage that
 * failed, another process mid-write. Every one of those is a directory that is
 * still there, and none of them means "the reader deleted this". Anything the
 * second check cannot confirm is **skipped and logged**, never pruned: a
 * momentary EACCES or EIO must cost nothing.
 *
 * Scoped to one owner. Nothing here ever considers a row it does not own.
 */
export async function findOrphans(ownerId: OwnerId = currentOwnerId()): Promise<Orphan[]> {
  // Throws if `data/` cannot be read at all, which is the right answer: the
  // whole judgement rests on that listing being complete.
  const onDisk = await importableSlugs();
  const db = getDb();
  const rows = await db
    .select({ id: articles.id, slug: articles.slug })
    .from(articles)
    .where(eq(articles.ownerId, ownerId));

  const byId = new Map(rows.map((r) => [r.slug, r.id]));
  const found: Orphan[] = [];
  for (const slug of orphanSlugs(
    rows.map((r) => r.slug),
    onDisk,
  )) {
    const state = await directoryState(path.join(dataRoot(), "data", slug));
    if (state !== "gone") {
      logger.debug({ slug, state }, "not pruning: its directory is still there");
      continue;
    }
    const articleId = byId.get(slug);
    if (!articleId) continue;
    /* Four `count(*)`s, spelled out rather than passed a table through a
       helper: the four tables are four different drizzle types, and the only
       way to share one call is a cast that tells the typechecker something
       untrue about which columns exist. Repetition is the cheaper lie to nobody. */
    const [nComments] = await db
      .select({ n: count() })
      .from(commentsTable)
      .where(eq(commentsTable.articleId, articleId));
    const [nThreads] = await db
      .select({ n: count() })
      .from(chatThreads)
      .where(eq(chatThreads.articleId, articleId));
    const [nRuns] = await db
      .select({ n: count() })
      .from(searchRuns)
      .where(eq(searchRuns.articleId, articleId));
    const [nLookups] = await db
      .select({ n: count() })
      .from(glossaryLookups)
      .where(eq(glossaryLookups.articleId, articleId));
    found.push({
      slug,
      articleId,
      comments: nComments?.n ?? 0,
      chatThreads: nThreads?.n ?? 0,
      searchRuns: nRuns?.n ?? 0,
      glossaryLookups: nLookups?.n ?? 0,
    });
  }
  return found;
}

/**
 * Delete these articles and everything under them. **This loses data.**
 *
 * Takes the orphans rather than finding them, so that the decision and the
 * deletion are two calls with a person in between: `npm run db:import` lists
 * them on every run and removes them only when asked with `--prune`. A default
 * that deleted would be one mistyped working directory away from taking the
 * reader's questions with it, and there is no export to get them back from —
 * the directory they would have been exported to is the thing that has gone.
 *
 * One `delete` per article and the cascades work out the order themselves.
 * Removing the rows by hand fails on `comments_identity_fk` and then on
 * `revision_blocks_identity_fk`: neither is `on delete cascade`, on purpose, so
 * that an identity cannot be dropped while something still points at it. The
 * pointer has to let go first, since `articles.current_revision_id` is an
 * ordinary FK onto a table that cascades from `articles`.
 *
 * Each article is its own transaction. A failure part-way leaves the rest of
 * the list alone rather than rolling back work already reported as done.
 */
export async function pruneOrphans(orphans: readonly Orphan[]): Promise<Orphan[]> {
  const db = getDb();
  const removed: Orphan[] = [];
  for (const orphan of orphans) {
    /* **Stat again, here, immediately before the delete.** `findOrphans` also
       checked — but that was a different moment, and what is between the two is
       a listing, four `count(*)`s per article, and however long the operator
       spent reading the list. A directory that came back in that window is not
       an orphan any more.
 
       This is not a hypothetical on this machine: the repository lives inside a
       Dropbox folder, so a directory can go and return without anybody
       intending anything, and another session re-running a stage does the same.
       Two checks a minute apart are one observation repeated, not two
       independent ones — raised by a GPT Sol review, 2026-08-26.
 
       Same rule as before: only ENOENT is gone. Anything else, including a
       directory that has reappeared, is skipped and said out loud, because the
       thing on the other side of this is an irreversible delete of everything
       the reader wrote about that article. */
    const state = await directoryState(path.join(dataRoot(), "data", orphan.slug));
    if (state !== "gone") {
      logger.warn(
        { slug: orphan.slug, state },
        "not pruning after all: its directory is back, or cannot be read",
      );
      continue;
    }
    /* **And a third check, on the database rather than the disk: is a job still
       working on it?**

       An orphan is an article whose directory has gone, and a job that is
       queued or running for that slug is about to write a draft revision onto
       it — a re-ingest of an article somebody deleted from `data/` is exactly
       that shape. The delete below cascades, so pruning here takes the article
       out from under a live job and there is nothing to put back.

       Skipped, not fatal, and that is the difference from `importArticle`: this
       loops over a list a person has already agreed to, and one busy article
       must not stop the other nine being removed. Same shape as the
       directory-came-back check above, for the same reason — and said out loud,
       because an orphan silently left behind reads as a prune that worked. */
    const busy = await db.transaction(async (tx) => {
      /* Lock FIRST, then ask about jobs — see `activeJobHolds`. Unlike the
         importer there is always a row to lock here: an orphan came out of
         `articles`. If it has gone in the meantime there is nothing left to
         prune, and saying so beats deleting nothing and reporting a removal. */
      const [row] = await tx
        .select({ ownerId: articles.ownerId })
        .from(articles)
        .where(eq(articles.id, orphan.articleId))
        .limit(1)
        .for("update");
      if (!row) return "the row has already gone";
      const holder = await activeJobHolds(tx, orphan.slug, row.ownerId as OwnerId);
      if (holder) return `a job is still working on it (${holder})`;

      await tx
        .update(articles)
        .set({ currentRevisionId: null })
        .where(eq(articles.id, orphan.articleId));
      await tx.delete(articles).where(eq(articles.id, orphan.articleId));
      return undefined;
    });
    if (busy) {
      logger.warn({ slug: orphan.slug, why: busy }, "not pruning after all");
      continue;
    }
    logger.warn(
      {
        slug: orphan.slug,
        comments: orphan.comments,
        chatThreads: orphan.chatThreads,
        searchRuns: orphan.searchRuns,
        glossaryLookups: orphan.glossaryLookups,
      },
      "article pruned: its data/ directory has gone",
    );
    removed.push(orphan);
  }
  return removed;
}
