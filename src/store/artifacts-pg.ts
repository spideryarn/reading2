/**
 * The artefact store, backed by Postgres — one draft revision, one job's claim.
 *
 * This was the other half of the seam src/store/artifacts-fs.ts opened, until
 * that file was deleted 2026-09-05 and Postgres became the only store. Same
 * interface, same questions, and the answers come from `article_revisions`,
 * `revision_blocks` and `revision_step_runs` instead of from `data/<slug>/`.
 *
 * This file is landing C of docs/plans/260827aa-delete-the-importer.md, and it is what
 * replaces `db:import` — not by being a better importer, but by being the thing
 * the pipeline writes through, so that there stops being a second path into the
 * database that only tests exercise.
 *
 * ## It binds a resolved reference, never a resolver
 *
 * `createFsArtifactStore` takes `locate(slug)`, and copying that surface here
 * was the first design and was wrong. `locate` is pure and deterministic;
 * `openOrBeginJobDraft` locks two rows, may mint a revision, and fences a live
 * job. That must happen **once per advance**, in the coordinator, not lazily
 * behind whichever store method the caller happened to reach first. So the
 * store is constructed from a `JobDraftRef` that has already been resolved.
 * GPT Sol, 2026-08-27; docs/plans/260827ac-artifacts-pg-shape-sol.md.
 *
 * `slug` still travels in every method signature, and it is not decoration: it
 * is asserted against the bound reference **before anything is read or
 * written**, so a store built for draft A and called with slug B throws rather
 * than quietly answering about A.
 *
 * ## The executor is a capability, and it has no default
 *
 * Every function here takes `Db | Tx` explicitly. There is deliberately no
 * `?? getDb()`, because a default makes forgetting the caller's transaction
 * *compile and succeed* — the artefact write commits, the job fence then fails,
 * and the row is there with nothing owning it. The same review rejected an
 * optional `tx` argument on `write` for the same reason.
 *
 * ## The four differences from the filesystem, said out loud
 *
 * A documented difference beats a false parity claim; this plan has produced
 * three of those already.
 *
 * 1. **`blocks` has one home, not two.** On disk `output/<slug>.blocks.json`
 *    (stage 3) and `data/<slug>/blocks.json` (stage 4) are separate files, and
 *    stage 4's copy exists so the tree and its blocks are a guaranteed pair.
 *    Here both `(blocks, blocks)` and `(hierarchy, blocks)` are the same
 *    `revision_blocks` rows, which cannot disagree.
 * 2. **`extractedHtml` and `stampedHtml` have two homes, not one.** On disk
 *    they are one path written twice, so stage 3 destroys stage 2's output and
 *    reading the "extracted" HTML back gives you the stamped one. Two columns
 *    here, and this side is the honest one.
 * 3. **Corruption is a different animal.** A JSONB column cannot be half
 *    written, so the shape checks (`whyUnusable`, shared with the file
 *    adapter) are doing less work here. What protects this store is the
 *    transaction; what protects that one is the atomic rename plus the parse.
 * 4. **An artefact of zero blocks reads as absent.** See `readBlocks`.
 */
import { and, asc, eq } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import type { Db } from "../db/client.js";
import {
  articleRevisions,
  articles,
  blockIdentities,
  rawSources,
  revisionBlocks,
  revisionStepRuns,
} from "../db/schema.js";
import { CONTENT_TYPE } from "./blobs.js";
import type { DocumentKind, RawManifest } from "../fetch.js";
import { log } from "../log.js";
import type { Block, Meta, NavLabelStatus, StepName } from "../types.js";
import {
  StepRunNotHeld,
  beginStepRun,
  finishStepRun,
  requireLiveJobOwnsDraft,
} from "./pg-revisions.js";
import {
  NO_INPUT_HASH,
  PIPELINE_RUN,
  STAMP_SOURCE,
  assertStampAgrees,
  metaRawSha256,
  stampOf,
  whyUnusable,
  whyUnusableAsBaseline,
} from "./artifacts.js";
import type {
  ArtifactKind,
  ArtifactMap,
  ArtifactOutcome,
  ArtifactParts,
  ArtifactReads,
  ArtifactStore,
  StepStamp,
} from "./artifacts.js";

const alog = log("store");

/** The stamp fields a run row and its artefact can both claim to know. */
const SHARED_STAMP_FIELDS = ["inputHash", "promptVersion", "model"] as const;

/** A transaction, spelled the way the two store modules already spell it. */
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** Either will do for a read; only a `Tx` will do for the atomic write. */
export type Executor = Db | Tx;

/**
 * The draft one job owns, resolved once by `openOrBeginJobDraft`.
 *
 * Five fields, and the last two are the ones a first draft left out.
 * `articleId` is needed because both of `revision_blocks`'s foreign keys are
 * composite — a block cannot be attached to a revision of a different article,
 * and the article id travels in both keys to say so. `jobId` and `attemptId`
 * are needed because `revision_step_runs.attempt_id` **is** the job's attempt
 * token: `beginStepRun`, `finishStepRun` and the job transition all fence on
 * it, and a store that could not produce it would have to be handed it again
 * by every caller.
 */
export interface JobDraftRef {
  readonly slug: string;
  readonly articleId: string;
  readonly revisionId: string;
  readonly jobId: string;
  readonly attemptId: string;
}

/**
 * Refused before anything was read: this store is not about that article.
 *
 * Its own error type because the repair is specific and unusual — a caller has
 * a store bound to one draft and a slug from somewhere else, which means two
 * articles have got crossed somewhere upstream. Answering about the bound one
 * anyway would be the worst possible outcome: a plausible artefact for the
 * wrong piece, with nothing anywhere saying so.
 */
export class WrongArticle extends Error {
  readonly status = 500;
  constructor(bound: string, asked: string) {
    super(
      `this artefact store is bound to the draft of "${bound}" and was asked about "${asked}" — ` +
        `refusing rather than answering about the wrong article`,
    );
    this.name = "WrongArticle";
  }
}

function requireBound(ref: JobDraftRef, slug: string): void {
  if (slug !== ref.slug) throw new WrongArticle(ref.slug, slug);
}

/* ------------------------------------------------------------- the map -- */

/** A column of `article_revisions` that holds one whole artefact. */
type WholeColumn =
  | "extractedHtml"
  | "stampedHtml"
  | "tree"
  | "labels"
  | "assets"
  | "arc"
  | "tweets"
  | "glossary"
  | "ideas"
  | "quotes"
  | "timeline"
  | "quiz"
  | "sketch"
  | "illustrated"
  | "debate";

/**
 * Where one `(step, kind)` lives in Postgres.
 *
 * Three shapes rather than one, because two artefacts are not a column:
 * `blocks` is a table, and `meta` and `raw` are each several columns that have
 * to be reassembled into the object the pipeline knows.
 */
export type Site =
  | { readonly at: "column"; readonly column: WholeColumn }
  | { readonly at: "blocks" }
  | { readonly at: "assembled"; readonly of: "meta" | "raw" };

/**
 * Every place this project puts a pipeline artefact in Postgres. **The one
 * place** — until 2026-09-05 it was also the exact counterpart of `PATHS` in
 * src/store/artifacts-fs.ts; now that file is gone, this is the only such
 * table there is.
 *
 * Keyed by step and then by kind, for the same reason that one is: `blocks`
 * appears under two steps and the HTML appears as two kinds. The keys of the
 * two maps must match exactly, step for step and kind for kind, or one store
 * silently knows about an artefact the other does not —
 * tests/store-artefacts-pg.test.ts compares them, which is a parity oracle
 * that is not the importer.
 */
export const STORAGE: {
  [S in StepName]: Partial<Record<ArtifactKind, Site>>;
} = {
  fetch: {
    /** Six columns and a derived filename — see `readRawManifest`. */
    raw: { at: "assembled", of: "raw" },
  },
  extract: {
    /**
     * **Its own column, unlike the filesystem**, where stage 3 overwrites this
     * with the stamped HTML and the original is simply gone. `db:import`
     * records that loss by storing null here; the pipeline writing through this
     * store does not have to.
     */
    extractedHtml: { at: "column", column: "extractedHtml" },
    meta: { at: "assembled", of: "meta" },
  },
  blocks: {
    blocks: { at: "blocks" },
    stampedHtml: { at: "column", column: "stampedHtml" },
  },
  hierarchy: {
    tree: { at: "column", column: "tree" },
    labels: { at: "column", column: "labels" },
    /**
     * **The same rows as `blocks`/`blocks` above**, not a second copy.
     *
     * On disk these are two files on purpose: stage 3 checks its own so a
     * `{ steps: ["blocks"] }` job can skip itself, and stage 4 writes a copy so
     * the tree and the blocks it was built from are guaranteed to be a pair.
     * One table cannot express the first and does not need the second — there
     * is one set of rows and it is the article's blocks.
     */
    blocks: { at: "blocks" },
  },
  /* One column, like the arc — the manifest is a document, and the objects it
     names live in the `sources` bucket rather than in a table. There is
     deliberately no `raw_sources` row per image: that table exists so
     `article_revisions` can foreign-key to *the document*, and an image is not
     the document. docs/plans/260829b-hosting-the-articles-images.md § Where the bytes go. */
  assets: { assets: { at: "column", column: "assets" } },
  arc: { arc: { at: "column", column: "arc" } },
  tweets: { tweets: { at: "column", column: "tweets" } },
  glossary: { glossary: { at: "column", column: "glossary" } },
  ideas: { ideas: { at: "column", column: "ideas" } },
  quotes: { quotes: { at: "column", column: "quotes" } },
  timeline: { timeline: { at: "column", column: "timeline" } },
  quiz: { quiz: { at: "column", column: "quiz" } },
  sketch: { sketch: { at: "column", column: "sketch" } },
  illustrated: { illustrated: { at: "column", column: "illustrated" } },
  debate: { debate: { at: "column", column: "debate" } },
};

/** The site for one `(step, kind)`, or a clear error rather than `undefined`. */
export function siteFor(step: StepName, kind: ArtifactKind): Site {
  const site = STORAGE[step]?.[kind];
  if (!site) throw new Error(`${step} does not produce ${kind}`);
  return site;
}

/* ---------------------------------------------------------- reassembly -- */

/** The revision columns a `read` may need, selected as one row. */
type RevisionRow = typeof articleRevisions.$inferSelect;

async function revisionRow(exec: Executor, revisionId: string): Promise<RevisionRow | undefined> {
  const [row] = await exec
    .select()
    .from(articleRevisions)
    .where(eq(articleRevisions.id, revisionId))
    .limit(1);
  return row;
}

/** Drop the keys whose value is null or undefined, so absent stays absent. */
function compact<T extends object>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== null && v !== undefined),
  ) as T;
}

/**
 * `meta.json`, rebuilt from the columns it was taken apart into.
 *
 * **Absence is keyed on `title === null`**, and both halves of that need
 * saying. There is no "is there a meta" column to read, and `Meta.title` is the
 * one required field in src/types.ts besides the slug — so a revision with a
 * null title has nothing that would make a usable `meta`. `db:export` makes the
 * same call. **What produces the state** is `metaColumns` below, which writes
 * `title: meta.title ?? null` — and, before it ever runs, a draft revision that
 * has existed since `beginRevision` and has not reached stage 2 yet.
 * (`src/store/import.ts` was the named producer until 2026-09-01: it accepted a
 * missing `meta.json` and wrote `title: null`. It is deleted; the state is not.)
 *
 * **`=== null`, not truthiness**, which is not pedantry. An empty-string title
 * is a different fact — extraction ran and produced nothing usable — and it
 * should read back as the empty title it is rather than as an absent artefact.
 * Only `null` means nothing was recorded. GPT Sol, 2026-08-28.
 *
 * The filesystem decoder keys on `slug` instead. That check cannot be
 * reproduced here and does not need to be: `slug` is not a column, it comes
 * from the bound reference, and so it can never be the thing that is missing.
 */
function readMeta(ref: JobDraftRef, row: RevisionRow): Meta | null {
  if (row.title === null) return null;
  return compact({
    slug: ref.slug,
    title: row.title,
    byline: row.byline,
    siteName: row.siteName,
    lang: row.lang,
    url: row.finalUrl,
    fetchedAt: row.fetchedAt?.toISOString(),
    excerpt: row.excerpt,
    publishedAt: row.publishedAt,
    note: row.note,
    source: row.source as Meta["source"],
    method: row.extractMethod,
    pages: row.pages,
    /* Not `row.rawSha256`. The column is stage 1's hash of whatever it fetched
       and an HTML page has one; `Meta.rawSha256` is PDFs only. */
    rawSha256: metaRawSha256(row),
    unverified: row.unverified,
    recall: row.recall,
    pagesChecked: row.pagesChecked,
  } as Meta);
}

/**
 * Which of `raw.html` / `raw.pdf` this revision's document would be called.
 *
 * **`RawManifest.file` is an internal name derived from the kind**, always —
 * `html` → `raw.html`, `pdf` → `raw.pdf`. It is not the reader's own filename,
 * which is `RawManifest.filename` and gets the `raw_filename` column in C6. An
 * earlier version of this comment had those two confused; GPT Sol, 2026-08-28.
 *
 * So the only question is the kind, and **`raw_source_kind` is the one place
 * that answers it** — the media kind stored beside the digest of the object in
 * the `sources` bucket, a fact recorded by the fetch that stored the bytes.
 *
 * There used to be a second answer: sniffing `raw_bytes`, for rows that predated
 * the source reference, with a refusal when the two disagreed because that
 * combination is corruption rather than a preference to be had. `raw_bytes` was
 * dropped on 2026-09-01 (docs/plans/260831b-finish-the-database-move.md § *Stage
 * 4*) and the sniffing branch went with it, disagreement and all.
 *
 * `null` when nothing can answer. **A guessed kind would be worse than an
 * absent manifest**: the name it produces is the only thing that tells a later
 * reader which decoder to use, and an `.html` name on a PDF is exactly the bug
 * `db:export` shipped until 2026-08-27.
 */
function rawKindOf(row: RevisionRow): DocumentKind | null {
  return row.rawSourceKind === "pdf" || row.rawSourceKind === "html" ? row.rawSourceKind : null;
}

/**
 * `raw.json`, rebuilt from the columns — stage 1's manifest.
 *
 * **What cannot be rebuilt is absent rather than invented.** `origin` and
 * `uploadId` have no column: `origin` is derivable (both URLs are null exactly
 * when the document was uploaded) and is not yet wired up; `uploadId` is not
 * durably recoverable at all, because publication clears `jobs.draft_revision_id`
 * and a job can be deleted, so the revision keeps no link back. That is a
 * promise this adapter does not make rather than one it fakes — an invented
 * `origin: "url"` would be a false statement every later reader would believe.
 *
 * `contentType`, `encoding` and `sha256` are `T | null` in `RawManifest` rather
 * than optional, so they are written even when null: the difference between "we
 * know it was null" and "we never recorded it" is what that type exists to
 * express.
 *
 * **The stored size comes from `raw_sources`, not from here**, which is why
 * this takes a second row. `raw_sources.bytes` describes the object at
 * `storedSha256`, and it is the only place that number lives.
 */
function readRaw(row: RevisionRow, source: { bytes: number } | null): RawManifest | null {
  const kind = rawKindOf(row);
  if (!kind) return null;
  const fetchedAt = row.fetchedAt ?? row.createdAt;
  return {
    kind,
    file: kind === "pdf" ? "raw.pdf" : "raw.html",
    ...(row.requestedUrl === null ? {} : { requestedUrl: row.requestedUrl }),
    ...(row.finalUrl === null ? {} : { url: row.finalUrl }),
    ...(row.rawFilename === null ? {} : { filename: row.rawFilename }),
    contentType: row.rawContentType,
    encoding: row.rawEncoding,
    /* **`raw_byte_count`, and now nothing else.** This read `0` until
       2026-08-28 — the column had just been added for exactly this number and
       the reader was not changed to use it, so a manifest that went in saying
       4096 came back saying 0. And a test asserted the 0. It fell back to
       `raw_bytes.byteLength` for revisions older than the column; `raw_bytes`
       was dropped on 2026-09-01 and `0` is what such a revision reads as now —
       which is the honest answer, since nothing records the number. */
    bytes: row.rawByteCount ?? 0,
    sha256: row.rawSha256,
    ...(row.rawSourceSha256 === null ? {} : { storedSha256: row.rawSourceSha256 }),
    ...(source === null ? {} : { storedBytes: source.bytes }),
    fetchedAt: fetchedAt.toISOString(),
  };
}

/** The `raw_sources` row this revision points at, if it points at one. */
async function sourceRowFor(
  exec: Executor,
  row: RevisionRow,
): Promise<{ bytes: number } | null> {
  if (row.rawSourceSha256 === null || row.rawSourceKind === null) return null;
  const [source] = await exec
    .select({ bytes: rawSources.bytes })
    .from(rawSources)
    .where(and(eq(rawSources.sha256, row.rawSourceSha256), eq(rawSources.kind, row.rawSourceKind)))
    .limit(1);
  return source ?? null;
}

/**
 * The blocks of this revision, in document order.
 *
 * **`order by ordinal`, and it is the whole ballgame.** Block ids are random
 * and carry no position (docs/project/block-ids.md), so a missing ORDER BY here
 * returns a shuffled article that passes every check downstream.
 *
 * **Zero rows reads as absent, not as an article of no blocks**, and that is a
 * deliberate difference from the filesystem, where an absent file and a file
 * containing `{"blocks": []}` are distinguishable. There is no such
 * distinction here — no rows is no rows — so the question is which of the two
 * it should be read as, and "absent" is the safe one. `inputHashFor` in
 * src/pipeline.ts does `if (!file?.blocks) return null`, which an empty array
 * passes; every late step would then be compared against `hashBlocks([])`, a
 * real-looking fingerprint of nothing. The consequence is worth stating: after
 * `write(slug, "blocks", { blocks: [] })` — which C5 makes a delete-all — `has`
 * answers false, so the step does not report itself done. A `blocks` step that
 * produced nothing has not produced its artefact.
 */
async function readBlocks(
  exec: Executor,
  revisionId: string,
): Promise<{ blocks: Block[] } | null> {
  const rows = await exec
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

  if (rows.length === 0) return null;
  return {
    blocks: rows.map((row) => ({
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
    })),
  };
}

/**
 * Is there a published revision behind this draft — the `basedOn` that
 * `beginDraftIn` copied its block rows from?
 *
 * **`articles.current_revision_id`, still, and now by choice rather than for
 * want of anything better.** The honest source used to be the article's current
 * publication, because the draft recorded no lineage — which is exactly the
 * value `beginDraftIn` read as `basedOn` when it made this draft, and which only
 * moves when something publishes.
 *
 * That makes the answer sound in the direction that matters. A published
 * revision cannot exist without blocks — `publishRevision` refuses a revision
 * with none — so a non-null pointer means block rows really were copied into
 * this draft, and stage 3 finding none means the carry-forward did not happen.
 *
 * The one case it can be wrong about is a first ingest for a slug that somebody
 * *else's* job published in between, which would turn a genuine mint into a
 * refusal. That is the safe direction, and it needs two concurrent ingests of
 * one article.
 *
 * **`article_revisions.based_on_revision_id` exists since 2026-09-01**
 * (drizzle/0047), written by `beginDraftIn` and never carried, and reading it
 * off `ref.revisionId` would answer this question exactly rather than nearly —
 * closing the concurrent-first-ingest case above. It is deliberately not done
 * here: the column landed to close the publication race (the lineage check in
 * `publishRevisionIn`, src/store/pg-revisions.ts), the current answer is already wrong
 * only in the safe direction, and changing what a stage decides to skip deserves
 * its own change and its own test.
 */
async function articleHasPublishedBlocks(exec: Executor, articleId: string): Promise<boolean> {
  const [row] = await exec
    .select({ current: articles.currentRevisionId })
    .from(articles)
    .where(eq(articles.id, articleId))
    .limit(1);
  return row?.current != null;
}

/* --------------------------------------------------------------- read -- */

/**
 * One artefact, or `null` for the answers that mean *this cannot be used*.
 *
 * Absent and unusable are both `null`, matching the file adapter. Anything
 * else — a connection that dropped, a permission Postgres refused — propagates,
 * because a swallowed error here would report an unfetched article and the
 * pipeline would pay for a model call to fix something no model call can fix.
 *
 * The shape check is `whyUnusable`, the **same table** the file adapter uses.
 * It catches less here (a JSONB column cannot be half-written) and it is run
 * anyway, because the rule it enforces is what the two stores agree about.
 */
export async function readArtefact<K extends ArtifactKind>(
  ref: JobDraftRef,
  exec: Executor,
  slug: string,
  step: StepName,
  kind: K,
): Promise<ArtifactMap[K] | null> {
  const outcome = await readArtefactOutcome(ref, exec, slug, step, kind);
  return outcome.state === "ok" ? outcome.value : null;
}

/**
 * The same read, saying **which** of the two `null`s it found.
 *
 * `readArtefact` above is this function with the answer flattened, so the two
 * cannot disagree about a column: one query, one shape check, one log line.
 *
 * The distinction is real here and not merely mirrored from the filesystem. A
 * JSONB column cannot be half-written, so `unusable` is never a truncation — it
 * is a value that is *there* and that `whyUnusable` will not accept, which is
 * what an older writer or a hand-edit leaves behind. For the two stages that
 * inherit their ids from their own previous artefact (src/glossary.ts,
 * src/ideas.ts) that is the state where minting a fresh identity set would
 * silently throw away ids that are sitting right there in the column.
 *
 * **A missing revision row is `absent`**, which is the behaviour `readArtefact`
 * has always had and is worth naming rather than inheriting by accident: this
 * store is bound to a draft, so the row not being there is not a corrupt
 * artefact and there is nothing for a person to restore.
 */
export async function readArtefactOutcome<K extends ArtifactKind>(
  ref: JobDraftRef,
  exec: Executor,
  slug: string,
  step: StepName,
  kind: K,
): Promise<ArtifactOutcome<ArtifactMap[K]>> {
  requireBound(ref, slug);
  const site = siteFor(step, kind);

  const value = await (async (): Promise<unknown> => {
    if (site.at === "blocks") return readBlocks(exec, ref.revisionId);
    const row = await revisionRow(exec, ref.revisionId);
    if (!row) return null;
    if (site.at === "column") return row[site.column];
    if (site.of === "meta") return readMeta(ref, row);
    return readRaw(row, await sourceRowFor(exec, row));
  })();

  if (value === null || value === undefined) return { state: "absent" };
  const why = whyUnusable(kind, value);
  if (why) {
    /* `debug`, not `warn`: a half-ingested article is the ordinary state of one
       nobody has finished. And the reason names a field and never the value —
       that is article prose (docs/project/logging.md). */
    alog.debug({ slug, step, kind, why }, `artefact unusable: ${kind} for ${slug}`);
    return { state: "unusable" };
  }
  return { state: "ok", value: value as ArtifactMap[K] };
}

/**
 * The same read again, with the **baseline** question on top of the shape one.
 *
 * A layer rather than a flag on `readArtefactOutcome`, so that `readArtefact` —
 * which is `read`, and which the metadata page and `stepIsDone` reach through —
 * cannot pick up the stricter rule by accident. `has` and `read` still mean
 * *the artefact survived being written*; only this means *it can carry identity
 * forward*.
 *
 * The check itself is `whyUnusableAsBaseline`, the **same table** the file
 * adapter uses, which is the whole claim: a glossary with a null `sourceHash`
 * in a JSONB column and one in a truncated file are the same answer, and it is
 * `unusable` in both. Before 2026-08-28 it was `ok` in both, and the stage
 * minted every entry id and reported success.
 */
async function baselineOutcome<K extends ArtifactKind>(
  ref: JobDraftRef,
  exec: Executor,
  slug: string,
  step: StepName,
  kind: K,
): Promise<ArtifactOutcome<ArtifactMap[K]>> {
  const outcome = await readArtefactOutcome(ref, exec, slug, step, kind);
  if (outcome.state !== "ok") return outcome;
  const why = whyUnusableAsBaseline(kind, outcome.value);
  if (why) {
    alog.debug({ slug, step, kind, why }, `baseline unusable: ${kind} for ${slug}`);
    return { state: "unusable" };
  }
  return outcome;
}

/* ---------------------------------------------------------------- has -- */

/** The `revision_step_runs` row for one step of the bound draft, if there is one. */
async function runRowFor(
  ref: JobDraftRef,
  exec: Executor,
  step: StepName,
): Promise<typeof revisionStepRuns.$inferSelect | undefined> {
  const [row] = await exec
    .select()
    .from(revisionStepRuns)
    .where(
      and(eq(revisionStepRuns.revisionId, ref.revisionId), eq(revisionStepRuns.stepName, step)),
    )
    .limit(1);
  return row;
}

/**
 * Does the store hold **all** of `kinds` for this step, in a state that can be
 * read back — and did a run of this step actually finish?
 *
 * ## Presence and completion. Never freshness.
 *
 * Two conditions, and the second is the one the filesystem cannot ask:
 *
 * 1. Every requested kind reads back and passes the shared shape check.
 * 2. `revision_step_runs` holds a row for this step with `status = 'done'`.
 *
 * **There is no comparison against an expected stamp**, and there must not be.
 * `has` is handed no expected stamp, and what counts as current is
 * step-specific — `ideas` hashes blocks *and* tree. Teaching this function that
 * would put the pipeline's logic in the storage layer. Freshness stays in
 * `stepIsDone` (src/pipeline.ts), which compares `stampFor` against what the
 * step would produce now.
 *
 * ## Why the run row is needed here and not on the filesystem
 *
 * On disk, an artefact being there is very nearly proof that this step put it
 * there. In Postgres it is not: `beginDraftIn` copies the previous published
 * revision's columns and block rows into a new draft, so **a value can be
 * present without this step having produced it**. The row is what tells the two
 * apart — and `beginDraftIn` copies the step runs forward too, in the same
 * transaction, so a coherent revision stays coherent.
 *
 * ## `hierarchy` has no special case, and an earlier version of the plan said it did
 *
 * The rule was going to be: for `hierarchy`, compare the row's `input_hash` against
 * the stored blocks. It is wrong twice. It is a freshness rule, in the one
 * function that must not have one. And it re-runs `hierarchy` whenever stage 3 has
 * run since — which moves the tree's boundaries, which silently drops every
 * `arc` entry whose block range no longer matches a node (src/web/tree.ts). That is the hazard the `hierarchy` stamp was withdrawn to avoid,
 * reached by a different door. GPT Sol, 2026-08-28;
 * docs/plans/260828b-artifacts-pg-has-sol.md.
 *
 * The gap it was trying to close is real — neither store can tell a carried
 * tree from a freshly built one — and it belongs to the runner, which knows at
 * run time that a step is about to run and can invalidate what depends on it.
 */
export async function hasArtefacts(
  ref: JobDraftRef,
  exec: Executor,
  slug: string,
  step: StepName,
  kinds: readonly ArtifactKind[],
): Promise<boolean> {
  requireBound(ref, slug);
  /* **Every pair validated first, before any early return.** `siteFor` throws
     for a `(step, kind)` no step produces, and the file adapter throws for it
     unconditionally — but reading the run row first made this one *state
     dependent*: `has("arc", ["glossary"])` returned false while no arc run
     existed and threw once one did. A check that changes its mind about whether
     an argument is valid is worse than either answer. GPT Sol, 2026-08-28. */
  for (const kind of kinds) siteFor(step, kind);

  /* Matching the file adapter: nothing requested is not "yes, all of nothing".
     A step whose `produces` is empty has not been shown to have run. */
  if (kinds.length === 0) return false;

  /* The row before the artefacts, because it is one small indexed read and the
     common case in a re-run is that it says no — where reading the artefacts
     means pulling a megabyte of blocks back to find out the same thing. */
  const run = await runRowFor(ref, exec, step);
  if (run?.status !== "done") return false;

  for (const kind of kinds) {
    if ((await readArtefact(ref, exec, slug, step, kind)) === null) return false;
  }
  return true;
}

/**
 * Did a run of this step start and never finish?
 *
 * `status = 'running'`, which is what src/store/artifacts-fs.ts used to spend a
 * marker file to express, before that file was deleted 2026-09-05. The
 * interface's own comment predicted this would be the same concept in both
 * stores, and it was — there is only one store now.
 *
 * A row that ended in `error` is **not** interrupted: it finished, badly. The
 * distinction matters because `stepIsDone` refuses an interrupted step outright
 * while an errored one falls through to the ordinary presence check — which is
 * right, since a step that failed may have left nothing, and `has` will say so.
 */
export async function stepInterrupted(
  ref: JobDraftRef,
  exec: Executor,
  slug: string,
  step: StepName,
): Promise<boolean> {
  requireBound(ref, slug);
  return (await runRowFor(ref, exec, step))?.status === "running";
}

/* ----------------------------------------------------------- stampFor -- */

/**
 * Refused: the run row and the artefact do not agree about what made it.
 *
 * Its own type because the repair is specific and there is no safe default. The
 * artefact is the *authority* on its own freshness — the file adapter reads it
 * and nothing else — but a disagreement is a fact about the row, and resolving
 * it silently in the artefact's favour is how a stale artefact gets served for
 * ever. `writeArtefacts` refuses to create this state; this is what to do when
 * a store already holds it, which the importer and every CLI run can produce.
 */
export class StampDisagrees extends Error {
  readonly status = 409;
  constructor(slug: string, step: StepName, fields: readonly string[]) {
    super(
      `the ${step} run row for "${slug}" and its artefact disagree about ${fields.join(", ")}, ` +
        `so there is no usable stamp. Re-run the step, or fix the row.`,
    );
    this.name = "StampDisagrees";
  }
}

/**
 * What the store recorded about this step's last run.
 *
 * **Two sources, and only one of them may answer.** `revision_step_runs` is the
 * row the run wrote; the artefact itself carries `sourceHash`, `version`,
 * `generator` and — only in `ideas` — `profileHash`, for which there is no
 * column at all. That is why the row cannot simply be ignored.
 *
 * The rule, which a review corrected twice:
 *
 * 1. **The artefact is the authority on freshness.** The file adapter reads the
 *    artefact and nothing else, so this is what parity means; and the artefact
 *    is the thing being judged, so it is the truth about itself.
 * 2. **The row contributes exactly one field: a real `implementationVersion`.**
 *    It may not fill in `inputHash`, `promptVersion` or `model` where the
 *    artefact has none — an `arc.json` carries no `sourceHash`, and letting the
 *    row supply one would give Postgres freshness evidence the filesystem does
 *    not have, so the same article would be current in one store and stale in
 *    the other.
 * 3. **A disagreement is refused, not resolved.** Where the row and the artefact
 *    both record a field and the values differ, there is no usable stamp: this
 *    returns `null` and warns. Picking whichever looks current is how a stale
 *    artefact gets served for ever. GPT Sol, 2026-08-28.
 *
 * **The two sentinels are dropped rather than handed back.** `input_hash` and
 * `implementation_version` are NOT NULL columns, so a step that records nothing
 * about its input still has to put something there — `NO_INPUT_HASH`
 * (`"unstamped"`) and `PIPELINE_RUN` (`"pipeline"`). `PIPELINE_RUN` does carry a
 * real distinction in the database — a pipeline row is not an importer row, and
 * the importer only ever deletes its own — but it is not an implementation
 * version and must not be compared as one.
 *
 * `null` when nothing at all was recorded, which is what the file adapter
 * returns for `fetch`, `extract` and `blocks`.
 */
export async function stampForStep(
  ref: JobDraftRef,
  exec: Executor,
  slug: string,
  step: StepName,
): Promise<StepStamp | null> {
  requireBound(ref, slug);

  const run = await runRowFor(ref, exec, step);

  /* The row's own reading of the three shared fields — used to *check* the
     artefact, never to stand in for it. */
  const fromRow: StepStamp = {};
  if (run) {
    if (run.inputHash !== NO_INPUT_HASH) fromRow.inputHash = run.inputHash;
    if (run.promptVersion !== null) fromRow.promptVersion = run.promptVersion;
    if (run.model !== null) fromRow.model = run.model;
  }

  const kind = STAMP_SOURCE[step];
  const artefact = kind ? await readArtefact(ref, exec, slug, step, kind) : null;
  const fromArtefact = artefact === null ? null : stampOf(artefact);

  if (fromArtefact) {
    const clashes = SHARED_STAMP_FIELDS.filter(
      (f) =>
        fromRow[f] !== undefined && fromArtefact[f] !== undefined && fromRow[f] !== fromArtefact[f],
    );
    if (clashes.length > 0) {
      /* **Thrown, not returned as `null`.** `null` already means "nothing was
         recorded", and the two are not the same answer: every caller reads a
         null stamp as *re-run this step*, which quietly resolves the clash in
         favour of the artefact — the exact outcome this rule exists to forbid.
         `copyArtefacts` makes it concrete: it turns a null stamp into `{}` and
         copies the artefact anyway, so the destination ends up holding the
         artefact's own stamp and no record that anything disagreed.
         GPT Sol, 2026-08-28.

         The field names go into the message and never the values: an
         `inputHash` is a hash and harmless, but a `promptVersion` and a `model`
         are ours to name and the rule is one rule. */
      throw new StampDisagrees(slug, step, clashes);
    }
  }

  const stamp: StepStamp = { ...(fromArtefact ?? {}) };
  if (run && run.implementationVersion !== PIPELINE_RUN) {
    stamp.implementationVersion = run.implementationVersion;
  }
  return Object.keys(stamp).length === 0 ? null : stamp;
}

/* --------------------------------------------------------------- write -- */

/**
 * The columns `meta` owns — **stage 2's own reading of the piece, and nothing
 * else.**
 *
 * ## What is deliberately not here, and why it matters
 *
 * `meta.json` also carries `url`, `fetchedAt` and `rawSha256`, and all three
 * are **stage 1's facts that stage 2 copied**. Writing them from here would let
 * `extract` overwrite what `fetch` recorded, and each of the three would be
 * wrong in its own way:
 *
 * - **`fetchedAt` would be the extraction time.** `src/extract.ts` writes
 *   `new Date().toISOString()` into it — stage 2's clock, not stage 1's. The
 *   shelf sorts on this column, so an article re-extracted today would jump to
 *   the top of the library as though it had just arrived.
 * - **`rawSha256` would be nulled out for every web page.** `Meta.rawSha256` is
 *   a PDF field; an HTML `meta` has none, and `?? null` would clear the hash
 *   `fetch` had just written.
 * - **`finalUrl` is stage 1's answer** to where the redirects ended, and stage 2
 *   only ever sees what it was handed.
 *
 * `readMeta` still reads all three back out of the columns, because that is
 * what `meta.json` holds on disk and parity is the point. The rule is that one
 * step *writes* each column and another may *report* it.
 *
 * Written out rather than derived, because these are the columns `write` is
 * allowed to set: a stage that grows a field must be made to decide where it
 * goes.
 */
const META_COLUMNS = [
  "title",
  "byline",
  "siteName",
  "lang",
  "excerpt",
  "publishedAt",
  "note",
  "source",
  "extractMethod",
  "pages",
  "unverified",
  "recall",
  "pagesChecked",
] as const;

/** `meta.json` taken apart into the columns it owns — the inverse of `readMeta`. */
function metaColumns(meta: Meta): Partial<typeof articleRevisions.$inferInsert> {
  /* **Every column named, and `?? null` on every one of them.** A field the
     stage stopped producing has to *clear* its column, not leave last
     extraction's value sitting beside this one's — which is what an
     absent-key-means-leave-it write would do, and it would read perfectly. */
  const columns: Partial<typeof articleRevisions.$inferInsert> = {
    title: meta.title ?? null,
    byline: meta.byline ?? null,
    siteName: meta.siteName ?? null,
    lang: meta.lang ?? null,
    excerpt: meta.excerpt ?? null,
    /* **The publisher's own string, verbatim** — never re-parsed, never passed
       through `Date`, and the column is `text` for that reason
       (src/db/schema.ts). Normalising it to UTC moves the calendar day, and the
       calendar day is what the timeline reads a year-less date against.

       `?? null` matters more here than for its neighbours: this field is absent
       on every article extracted before 2026-08-31, and it must also be able to
       go BACK to absent — a publisher who removes the date from a page has to
       clear the column, not leave the old one sitting beside the new
       extraction, or the timeline would go on filling in a year the article no
       longer claims. */
    publishedAt: meta.publishedAt ?? null,
    note: meta.note ?? null,
    source: meta.source ?? null,
    extractMethod: meta.method ?? null,
    pages: meta.pages ?? null,
    unverified: meta.unverified ?? null,
    recall: meta.recall ?? null,
    pagesChecked: meta.pagesChecked ?? null,
  };
  /* The declared list and the object above must not drift; `META_COLUMNS` is
     what the test checks the two halves against. */
  const written = Object.keys(columns);
  const missing = META_COLUMNS.filter((c) => !written.includes(c));
  const extra = written.filter((c) => !(META_COLUMNS as readonly string[]).includes(c));
  if (missing.length || extra.length) {
    throw new Error(
      `the meta write and META_COLUMNS disagree: missing ${missing.join(", ") || "none"}, ` +
        `unexpected ${extra.join(", ") || "none"}`,
    );
  }
  return columns;
}

/**
 * The columns `raw` owns — everything stage 1 learned, and the pointer to the
 * document itself.
 */
const RAW_COLUMNS = [
  "requestedUrl",
  "finalUrl",
  "fetchedAt",
  "rawContentType",
  "rawEncoding",
  "rawSha256",
  "rawByteCount",
  "rawFilename",
  "rawSourceSha256",
  "rawSourceKind",
] as const;

/**
 * Refused: this manifest names no object, so writing it would record a fetch
 * with no document behind it.
 *
 * `storedSha256` is the key of the object in the `sources` bucket. A manifest
 * without one is either older than the bucket or was rebuilt from columns by
 * `db:export`, and in both cases **we do not hold the document**. Writing the
 * rest of it would leave a `fetch` step reporting done beside a revision whose
 * `raw_source_sha256` is null — and `article_revisions_raw_source_both` would
 * not even complain, because null-and-null is a legal pair meaning "we do not
 * have the source".
 *
 * `scripts/backfill-raw-manifests.ts` is the repair for an existing corpus: it
 * stores the bytes that are already on disk and adds the two fields.
 */
export class NoStoredDocument extends Error {
  readonly status = 422;
  constructor(slug: string) {
    super(
      `the raw manifest for "${slug}" has no storedSha256, so it names no object in the ` +
        `sources bucket. Refusing rather than recording a fetch with no document behind it — ` +
        `run scripts/backfill-raw-manifests.ts if the bytes are still on disk.`,
    );
    this.name = "NoStoredDocument";
  }
}

/**
 * Refused: the `raw_sources` row disagrees with the manifest about the object.
 *
 * The row is **shared** — every revision that fetched the same document points
 * at it — so a disagreement is not this revision's problem to resolve. Same
 * digest and same kind must mean the same bytes, therefore the same count and
 * the same canonical content type; if they differ, one of the two is describing
 * something else and a person has to look.
 */
export class RawSourceDisagrees extends Error {
  readonly status = 409;
  constructor(sha256: string, kind: string, differences: string) {
    super(
      `the raw_sources row for ${kind} ${sha256.slice(0, 12)}… already says ${differences}. ` +
        `Two things cannot hash to one name, so this needs a person rather than a winner.`,
    );
    this.name = "RawSourceDisagrees";
  }
}

/**
 * Record the document's row, and hand back the columns that point at it.
 *
 * Two writes, and the order is the foreign key's: `raw_sources` first, because
 * `article_revisions_raw_source_fk` is a composite key onto `(sha256, kind)`
 * and a reference to a row that is not there is refused by the database. That
 * refusal is the design working — a half-pointer is the thing the schema exists
 * to prevent.
 *
 * **The object itself is not written here.** `storeRawSource` put it in the
 * bucket at fetch time, outside any transaction, keyed by its own contents —
 * which is safe precisely because the name is the checksum, so writing twice is
 * a no-op and an object nothing references is one we keep on purpose. What this
 * writes is the *row*, inside the caller's transaction, so the reference and
 * the artefacts land together or not at all.
 *
 * ## Insert first, then read back and compare — not select, then insert
 *
 * `raw_sources` is keyed `(sha256, kind)`: **one row per document**, shared by
 * every article ever made from those bytes. So the row this write wants may be
 * being written by somebody else at the same moment — the same URL added by two
 * readers, the same PDF uploaded twice, a refresh racing an add.
 *
 * This used to be `select … for update`, then insert if nothing came back, and
 * **a `for update` over no rows locks nothing**. Two concurrent first-writers of
 * one document both selected nothing, both inserted, and the loser got
 * `duplicate key value violates unique constraint "raw_sources_sha256_kind_pk"`
 * — which rolled back its *whole* transaction, losing the revision write and not
 * just this row. It bit only on the first write of a given document, which is
 * why a laptop never sees it: after that the row is always there. Reproduced,
 * not argued: sixteen concurrent loads of one unseen document gave 15, 7 and 15
 * failures of 16 over three runs.
 *
 * `insert … on conflict do nothing` needs no row to exist in order to be safe,
 * because the unique index is the thing doing the excluding. A racing writer
 * makes this a no-op instead of an error.
 *
 * **Then the row is read back, and it is the row in the table that is compared**
 * — never the values we tried to insert. If the comparison used those, a racing
 * writer's row would enter the table without anything ever checking it, which is
 * precisely the corruption the check exists to stop: two different documents
 * sharing a hash row, one of them silently getting the other's size.
 *
 * **This rests on `read committed`, and the caller now asks for it.** `do
 * nothing` is only an escape from a concurrent writer at that level. Measured
 * on 2026-09-01: at `repeatable read` an `insert … on conflict do nothing` that
 * meets a conflicting row from outside its own snapshot raises `40001 could not
 * serialize access due to concurrent update` at the **insert** — both when it
 * waits for an uncommitted writer and when the winner had already committed —
 * so the read back below is never reached at all. Nothing in `src/` retries
 * `40001`, so that aborts the whole revision commit, which is the same loss
 * this rewrite was for. A `default_transaction_isolation` set on the role or
 * the database would do it silently, and nothing would fail on a laptop.
 *
 * This function owns no transaction, so it still cannot set the level itself;
 * it says what it needs and **the transaction that opens is pinned**, in
 * src/store/pg-session.ts § `READ_COMMITTED` — all three of `commit`,
 * `settleJob` and `beginStep`. Until 2026-09-01 that was a comment and nothing
 * else, and GPT Sol's final review (finding 3,
 * docs/plans/260901d-final-review-sol.md) is right that a stated dependency
 * nobody enforces is not a defence. tests/store-session-isolation.test.ts is
 * the check: it drives the real `commit` down a connection that defaults to
 * `repeatable read` and asks the transaction what level it actually got.
 *
 * **The other callers of `writeArtefacts` are not pinned** and are all tests —
 * tests/helpers/load-article.ts's `copyArtefacts`, and the race suite's own
 * `getDb().transaction`. They inherit the database default, which is the thing
 * production no longer does.
 *
 * ## `verified_at` is not touched when the row is already there
 *
 * The column means *"when the bytes at this key were last shown to hash to
 * it"*. **This function verifies nothing** — it is handed a `RawManifest`,
 * which is a file, and a file is not proof that an object exists. An earlier
 * version set `verified_at` to `now()` on every write, which meant that
 * pointing a revision at a hash was enough to certify an object nobody had
 * looked at. GPT Sol found it by noticing the tests invent hashes and never put
 * an object behind them.
 *
 * So: on insert, `verified_at` is the manifest's own `fetchedAt`, which is when
 * `storeRawSource` did the verifying — traceable, and never later than the
 * truth. `do nothing` rather than `do update` is what keeps that true, because
 * nothing here has re-verified anything. The sweeper that re-verifies is the
 * thing entitled to move it.
 *
 * And when a row is already there the two describable facts are **compared**,
 * not ignored: same digest and kind must mean the same bytes.
 */
async function writeRawSource(
  tx: Tx,
  slug: string,
  manifest: RawManifest,
): Promise<Partial<typeof articleRevisions.$inferInsert>> {
  const { storedSha256, kind } = manifest;
  if (!storedSha256) throw new NoStoredDocument(slug);

  /* `storedBytes` and `bytes` are two different numbers and only one of them
     describes the object — see `RawManifest`. A manifest with a stored hash and
     no stored size is one this adapter has never written, and guessing with the
     network count would put a wrong size on a shared row. */
  if (manifest.storedBytes === undefined) {
    throw new NoStoredDocument(slug);
  }

  await tx
    .insert(rawSources)
    .values({
      sha256: storedSha256,
      kind,
      bytes: manifest.storedBytes,
      contentType: CONTENT_TYPE[kind],
      verifiedAt: new Date(manifest.fetchedAt),
    })
    /* **Targeted at the primary key**, so this swallows the one conflict it is
       about and nothing else. An untargeted `do nothing` would also absorb a
       future constraint, quietly, and the write would report success having
       stored nothing. `lockOrCreateArticle` (src/store/pg-revisions.ts) targets
       for the same reason. */
    .onConflictDoNothing({ target: [rawSources.sha256, rawSources.kind] });

  const [stored] = await tx
    .select({ bytes: rawSources.bytes, contentType: rawSources.contentType })
    .from(rawSources)
    .where(and(eq(rawSources.sha256, storedSha256), eq(rawSources.kind, kind)))
    .limit(1);

  /* Not reachable under `read committed`: the insert above either put the row
     there or waited for the transaction that did. Nor, it turns out, under
     `repeatable read` — that raises `40001` at the insert and never gets here
     (see the note above). What is left is a delete landing in the gap, and
     nothing in the request path deletes from this table. So this is a fault
     worth naming rather than a `!` that would one day be a null reference with
     no explanation, and the level is still named in it because a wrong level is
     the first thing anybody reading it will want ruled out. */
  if (!stored) {
    throw new Error(
      `the raw_sources row for ${storedSha256} (${kind}) was not there on the read back, writing ` +
        `"${slug}". Either something is deleting from that table under a live write, or this ` +
        `transaction is not running at read committed — see writeRawSource, and ` +
        `READ_COMMITTED in src/store/pg-session.ts, which is where the commit path pins it.`,
    );
  }

  const differences: string[] = [];
  if (stored.bytes !== manifest.storedBytes) {
    differences.push(`${stored.bytes} bytes and this says ${manifest.storedBytes}`);
  }
  if (stored.contentType !== CONTENT_TYPE[kind]) {
    differences.push(`content type ${stored.contentType} and this kind is ${CONTENT_TYPE[kind]}`);
  }
  if (differences.length) {
    throw new RawSourceDisagrees(storedSha256, kind, differences.join(", and "));
  }

  const columns: Partial<typeof articleRevisions.$inferInsert> = {
    requestedUrl: manifest.requestedUrl ?? null,
    finalUrl: manifest.url ?? null,
    fetchedAt: new Date(manifest.fetchedAt),
    rawContentType: manifest.contentType,
    rawEncoding: manifest.encoding,
    rawSha256: manifest.sha256,
    rawByteCount: manifest.bytes,
    rawFilename: manifest.filename ?? null,
    rawSourceSha256: storedSha256,
    rawSourceKind: kind,
  };
  const written = Object.keys(columns);
  const missing = RAW_COLUMNS.filter((c) => !written.includes(c));
  if (missing.length) throw new Error(`raw write is missing ${missing.join(", ")}`);
  return columns;
}

/**
 * Replace this revision's blocks, wholesale.
 *
 * Three statements, and the order and the conditions are all load-bearing:
 *
 * 1. **Identities upsert, first and never deleted.** `revision_blocks` has a
 *    foreign key onto `block_identities`, so a block whose identity was never
 *    minted fails loudly — which is the intended behaviour, because it means
 *    stage 3 re-minted instead of carrying ids forward
 *    (docs/project/block-ids.md).
 * 2. **Delete, unconditionally.** `src/store/import.ts` (deleted 2026-09-01) put
 *    its delete *inside* `if (blocks.length)`, so writing an empty set left the
 *    previous revision's inherited rows in place — the stage returns nothing,
 *    the old article survives, and the run reports done. That is a silent
 *    success of the worst kind, and it is the one behaviour this function
 *    deliberately does not copy. tests/store-artefacts-pg.test.ts § "deletes
 *    every block when it is handed none" is the check, watched red by moving
 *    this delete back inside that condition.
 * 3. **Insert only when there is something to insert**, because an empty
 *    `INSERT … VALUES` is a syntax error rather than a no-op.
 *
 * `ordinal` is written from the array index. Block ids are random and carry no
 * position, so if this is wrong there is nothing left to recover the order from.
 */
async function writeBlocks(ref: JobDraftRef, tx: Tx, blocks: readonly Block[]): Promise<void> {
  if (blocks.length) {
    await tx
      .insert(blockIdentities)
      .values(blocks.map((b) => ({ articleId: ref.articleId, blockId: b.id })))
      .onConflictDoNothing();
  }

  await tx.delete(revisionBlocks).where(eq(revisionBlocks.revisionId, ref.revisionId));

  if (blocks.length) {
    await tx.insert(revisionBlocks).values(
      blocks.map((b, index) => ({
        articleId: ref.articleId,
        revisionId: ref.revisionId,
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
        contextId: b.context?.id ?? null,
        contextType: b.context?.type ?? null,
      })),
    );
  }
}

/**
 * Write everything this step produced, and record what it was made from.
 *
 * ## One transaction, and the type is what enforces it
 *
 * `tx`, not `Db | Tx`. A `write` that could run outside a transaction would
 * commit the artefacts and then discover, one call later, that the job fence
 * refuses — leaving a revision full of a stale worker's output with nothing
 * owning it. The reads may take either executor; this may not, and the
 * typechecker is where that is said, because a comment saying it is a comment
 * somebody can be in a hurry past.
 *
 * ## Three things happen, in this order
 *
 * 1. **The job fence.** `requireLiveJobOwnsDraft` — this job, this attempt,
 *    still running, still pointed at this draft. Taken here even though the
 *    `finishStepRun` that follows takes it too, because "the write is safe
 *    because the call after it checks" holds only until somebody calls the
 *    write on its own.
 * 2. **The stamp is checked against the artefacts**, exactly as the file
 *    adapter checks it — `assertStampAgrees`, shared. Here it matters more:
 *    the file store has nowhere to put a stamp that contradicts the artefact,
 *    and this one has a whole column, so a contradiction would survive and
 *    `stampFor` would have to choose.
 * 3. **The artefacts, then the stamp.** Every part goes to its site, and then
 *    the running step-run row is located — fenced on the attempt and on
 *    `status = 'running'`, so this cannot record against a step somebody else
 *    is running or one that has already ended — and given whatever stamp
 *    fields the caller declared.
 *
 * `finishStep` flips that row to `done` afterwards and leaves the stamp where
 * this put it.
 *
 * ## The one stamp field the caller must supply that no `stamp()` produces
 *
 * `hierarchy` has no `PipelineStep.stamp`, and it must still be written with an
 * `inputHash` of `hashBlocks(blocks)` — because `reasonsNotToPublish` compares
 * that column against the stored blocks and refuses the publication when they
 * differ. Having no expected stamp and recording no input are different things.
 * GPT Sol, 2026-08-28.
 */
export async function writeArtefacts(
  ref: JobDraftRef,
  tx: Tx,
  slug: string,
  step: StepName,
  parts: ArtifactParts,
  stamp: StepStamp,
): Promise<void> {
  requireBound(ref, slug);
  await requireLiveJobOwnsDraft(tx, { id: ref.jobId, attemptId: ref.attemptId }, ref.revisionId);

  const entries = Object.entries(parts) as [ArtifactKind, ArtifactMap[ArtifactKind]][];
  /* Checked for **all** parts before **any** of them is written. A check
     interleaved with the writes would leave the earlier artefacts in place and
     roll back only because the caller's transaction happens to be one — which
     is true today and is not a thing to depend on. */
  for (const [kind, value] of entries) {
    if (value === undefined) continue;
    assertStampAgrees(slug, step, kind, value, stamp);
  }

  /* **The step-run row is locked here, before any artefact table is touched.**
     It used to be taken at the end, with the stamp, and the transaction made
     that *safe* — a late `StepRunNotHeld` rolls everything back. It was still
     wrong: a call with no `beginStep` would replace every block row of an
     article and insert a `raw_sources` row before discovering a protocol error
     it could have discovered first, and any database error raised on the way
     would mask the refusal that actually explains it. GPT Sol, 2026-08-28. */
  await lockStepRun(ref, tx, step);

  /* One `UPDATE` for all the column-shaped parts, rather than one each: they
     are columns of the same row, and a step that writes two of them (`extract`)
     should not be able to land one and not the other. */
  let columns: Partial<typeof articleRevisions.$inferInsert> = {};
  for (const [kind, value] of entries) {
    if (value === undefined) continue;
    const site = siteFor(step, kind);
    if (site.at === "column") {
      columns = { ...columns, [site.column]: value };
    } else if (site.at === "blocks") {
      await writeBlocks(ref, tx, (value as ArtifactMap["blocks"]).blocks);
    } else if (site.of === "meta") {
      columns = { ...columns, ...metaColumns(value as Meta) };
    } else {
      columns = { ...columns, ...(await writeRawSource(tx, slug, value as RawManifest)) };
    }
  }

  /* **Writing the labels sets where the labels are** — the one column in this
     statement that is not an artefact, and the seam
     docs/plans/260906a-labels-leave-the-blocking-hierarchy-step.md stage 2 will
     edit rather than invent.
     Here rather than in the step, because it has to be *atomic with the
     artefact*: a revision that publishes saying `ready` over labels that did not
     land is exactly the half-written state this one `UPDATE` exists to make
     impossible, and a second write from the caller would have its own window.
     Today `labels` is written by one step, `hierarchy`, which cannot finish
     without producing a full set — `assertEveryBlockLabelled` and
     `assertInsideCoverageFloor` are inside `generateLabels` — so `ready` is
     simply true, and this changes nothing anybody can see. When the labels get
     their own step, this is where the rule gains its second arm: the
     `hierarchy` step writes a stamped-but-empty manifest and `pending`, and the
     `labels` step writes the real one and `ready`.
     `parts.labels` rather than `step === "hierarchy"`, so the rule follows the
     artefact rather than the name of whoever wrote it — which is the whole
     change stage 2 makes. `copyArtefacts` goes through here too, and a copied
     labels file is a real one. */
  if (parts.labels !== undefined) {
    columns = { ...columns, navLabelStatus: "ready" satisfies NavLabelStatus };
  }

  if (Object.keys(columns).length) {
    await tx
      .update(articleRevisions)
      .set(columns)
      .where(eq(articleRevisions.id, ref.revisionId));
  }

  await recordStamp(ref, tx, step, stamp);
}

/**
 * Take the running step-run row for this attempt, or refuse.
 *
 * `SELECT … FOR UPDATE` on the primary key, held for the rest of the caller's
 * transaction — so nothing can change the row's attempt or status between this
 * and the update that follows, and the two statements are as safe as one.
 *
 * Zero rows is the fence working: held by another attempt, already ended, or
 * never begun. A `write` with no preceding `beginStep` is the last of those,
 * and it is a protocol error rather than something to tolerate — the artefacts
 * would land with nothing recording that a run produced them.
 */
async function lockStepRun(ref: JobDraftRef, tx: Tx, step: StepName): Promise<void> {
  const [row] = await tx
    .select({ stepName: revisionStepRuns.stepName })
    .from(revisionStepRuns)
    .where(heldBy(ref, step))
    .for("update")
    .limit(1);
  if (!row) throw new StepRunNotHeld(ref.revisionId, step);
}

/** This revision's row for this step, running under this attempt. Nothing else. */
function heldBy(ref: JobDraftRef, step: StepName): SQL | undefined {
  return and(
    eq(revisionStepRuns.revisionId, ref.revisionId),
    eq(revisionStepRuns.stepName, step),
    eq(revisionStepRuns.attemptId, ref.attemptId),
    eq(revisionStepRuns.status, "running"),
  );
}

/**
 * Put the stamp on the running step-run row.
 *
 * Only the fields the caller declared, because `undefined` in a `StepStamp`
 * means *this step does not record that* and writing a null over a real value
 * would be a different claim. `NO_INPUT_HASH` stays where `beginStepRun` put it
 * for a step that declares no input.
 *
 * **The lock was taken at the top of `write`**, so this does not re-check
 * whether the row is held — it holds it. Three steps declare no stamp at all,
 * and an `UPDATE` with nothing to set is an error rather than a no-op, so
 * folding the fence into this statement would have made the fence *conditional
 * on the step having a stamp*: exactly backwards, since those are the steps
 * whose completion nothing else can check.
 */
async function recordStamp(
  ref: JobDraftRef,
  tx: Tx,
  step: StepName,
  stamp: StepStamp,
): Promise<void> {
  const set = {
    ...(stamp.inputHash === undefined ? {} : { inputHash: stamp.inputHash }),
    ...(stamp.implementationVersion === undefined
      ? {}
      : { implementationVersion: stamp.implementationVersion }),
    ...(stamp.promptVersion === undefined ? {} : { promptVersion: stamp.promptVersion }),
    ...(stamp.model === undefined ? {} : { model: stamp.model }),
  };
  if (Object.keys(set).length === 0) return;

  const result = await tx.update(revisionStepRuns).set(set).where(heldBy(ref, step));
  if (result.rowCount !== 1) throw new StepRunNotHeld(ref.revisionId, step);
}

/* ------------------------------------------------------- the two views -- */

/**
 * What can be asked of the store outside the atomic write.
 *
 * The four questions that need no transaction: `stepIsDone` asks all of them
 * (src/pipeline.ts), and so does the metadata page. `write`, `beginStep` and
 * `finishStep` are deliberately absent — see below.
 */
export type ReadOnlyArtifactStore = Pick<
  ArtifactStore,
  "has" | "read" | "stampFor" | "interrupted"
>;

/**
 * The read-only view, over any executor.
 *
 * `Db` is fine here: a read that sees a slightly older snapshot than the write
 * that follows it is the ordinary state of a pipeline deciding what to skip,
 * and the fenced write is what makes the decision safe rather than the read.
 */
export function readOnlyPgArtifacts(ref: JobDraftRef, exec: Executor): ReadOnlyArtifactStore {
  return {
    has: (slug, step, kinds) => hasArtefacts(ref, exec, slug, step, kinds),
    read: (slug, step, kind) => readArtefact(ref, exec, slug, step, kind),
    stampFor: (slug, step) => stampForStep(ref, exec, slug, step),
    interrupted: (slug, step) => stepInterrupted(ref, exec, slug, step),
  };
}

/**
 * The six reads a **stage** may make, over any executor.
 *
 * `ReadOnlyArtifactStore`'s four plus the two that only the stages inheriting
 * identity from their own previous artefact ask for. It is the Postgres half of
 * `ArtifactReads` (src/store/artifacts.ts), which is the type the run phase gets
 * instead of the whole mutable store — so `write`, `beginStep` and `finishStep`
 * are not merely undeclared here, they are unreachable.
 *
 * **`readBaseline` is a method, not an arrow property**, and so is `read` inside
 * the view this spreads. Both are generic over `ArtifactKind`, and the arrow
 * form loses the type parameter and hands every caller back `unknown` — the
 * mistake `readsOf` in src/store/session.ts already wrote down.
 *
 * `Db` is fine here for the same reason it is fine for the read-only view: a
 * read that sees a slightly older snapshot than the write that follows it is the
 * ordinary state of a pipeline deciding what to skip, and the fenced write is
 * what makes the decision safe.
 */
export function readsPgArtifacts(ref: JobDraftRef, exec: Executor): ArtifactReads {
  return {
    ...readOnlyPgArtifacts(ref, exec),
    readBaseline<K extends ArtifactKind>(slug: string, step: StepName, kind: K) {
      return baselineOutcome(ref, exec, slug, step, kind);
    },
    async hasEarlierBlocks(slug: string) {
      requireBound(ref, slug);
      return articleHasPublishedBlocks(exec, ref.articleId);
    },
  };
}

/**
 * The whole store, bound to one transaction.
 *
 * **`tx`, and there is no overload taking a `Db`.** An artefact write that
 * could commit on its own would commit before the job fence and the step
 * transition it belongs with — and that is not a hypothetical ordering
 * problem, it is the entire reason this landing exists. The type is where it is
 * said, because a default executor makes forgetting the caller's transaction
 * both compile and succeed.
 *
 * ## `beginStep` returns the attempt it already has
 *
 * On the filesystem the token is minted per marker file, because there is
 * nothing else to identify the run. Here the run **is** the job's attempt:
 * `revision_step_runs.attempt_id` is the same value as `jobs.attempt_id`, which
 * is what `finishStepRun` fences on. So `beginStep` hands back `ref.attemptId`,
 * and `finishStep` refuses anything else before it goes near the database — the
 * interface's own comment predicted that "it should end up being literally the
 * same value", and it has.
 *
 * ## `finishStep` is stricter here than the interface allows for
 *
 * The interface says clearing a marker that is not there, or belongs to
 * somebody else, "is not an error". That is the *filesystem's* tolerance, and
 * it exists because a step can complete without the store having seen it start
 * — every artefact written before markers existed, and every stage run from its
 * own CLI. Neither of those can happen on this path: a run through the
 * transactional runner always begins its step. So a `finishStep` with nothing
 * to finish is a protocol error and says so, rather than returning quietly and
 * leaving a step that never reports itself done.
 */
export function pgArtifactsIn(ref: JobDraftRef, tx: Tx): ArtifactStore {
  const job = { id: ref.jobId, attemptId: ref.attemptId };
  return {
    /* All six reads, from the one definition. `readBaseline` and
       `hasEarlierBlocks` are still absent from `ReadOnlyArtifactStore`, which is
       a scope decision rather than a technical one: the only callers are the two
       stages that inherit ids from their own previous artefact, and both run
       inside the job's transaction. */
    ...readsPgArtifacts(ref, tx),
    write: (slug, step, parts, stamp) => writeArtefacts(ref, tx, slug, step, parts, stamp),
    async beginStep(slug, step) {
      requireBound(ref, slug);
      await beginStepRun({ revisionId: ref.revisionId, stepName: step, job }, tx);
      return ref.attemptId;
    },
    async finishStep(slug, step, attempt) {
      requireBound(ref, slug);
      if (attempt !== ref.attemptId) {
        /* Refused before the database, because the fenced UPDATE would refuse
           it too and this way the message says which of the two things went
           wrong. A store bound to attempt A being handed attempt B is a caller
           bug, not a race. */
        throw new StepRunNotHeld(ref.revisionId, step);
      }
      await finishStepRun(
        { revisionId: ref.revisionId, stepName: step, job, status: "done" },
        tx,
      );
    },
  };
}
