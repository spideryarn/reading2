/**
 * The artefact store, backed by Postgres — one draft revision, one job's claim.
 *
 * The other half of the seam src/store/artifacts-fs.ts opened. Same interface,
 * same questions, and the answers come from `article_revisions`,
 * `revision_blocks` and `revision_step_runs` instead of from `data/<slug>/`.
 *
 * This file is landing C of docs/plans/delete-the-importer.md, and it is what
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
 * GPT Sol, 2026-08-27; docs/plans/artifacts-pg-shape-sol.md.
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
 *    Here both `(blocks, blocks)` and `(toc, blocks)` are the same
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

import type { Db } from "../db/client.js";
import {
  articleRevisions,
  blockIdentities,
  revisionBlocks,
  revisionStepRuns,
} from "../db/schema.js";
import { sniffKind } from "../fetch.js";
import type { DocumentKind, RawManifest } from "../fetch.js";
import { log } from "../log.js";
import type { Block, Meta, StepName } from "../types.js";
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
  stampOf,
  whyUnusable,
} from "./artifacts.js";
import type {
  ArtifactKind,
  ArtifactMap,
  ArtifactParts,
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
  | "arc"
  | "tweets"
  | "glossary"
  | "summary"
  | "ideas";

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
 * place**, and the exact counterpart of `PATHS` in src/store/artifacts-fs.ts.
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
  toc: {
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
  arc: { arc: { at: "column", column: "arc" } },
  tweets: { tweets: { at: "column", column: "tweets" } },
  glossary: { glossary: { at: "column", column: "glossary" } },
  summary: { summary: { at: "column", column: "summary" } },
  ideas: { ideas: { at: "column", column: "ideas" } },
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
 * same call, and `src/store/import.ts` is what produces the state: it accepts a
 * missing `meta.json` and writes `title: null`.
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
    note: row.note,
    source: row.source as Meta["source"],
    method: row.extractMethod,
    pages: row.pages,
    rawSha256: row.rawSha256,
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
 * So the only question is the kind, and there are two places that can answer:
 *
 * 1. **`raw_source_kind`** — the media kind stored beside the digest of the
 *    object in the `sources` bucket. A recorded fact, and the one with a
 *    future.
 * 2. **Sniffing `raw_bytes`** — what `db:export` does, and only for rows that
 *    predate the source reference. `raw_bytes` is dropped at the end of this
 *    landing, so this branch dies with it; it is here so that the articles
 *    already in the database do not read as unfetched in the meantime.
 *
 * **When both answer and they disagree, that is corruption and it is refused.**
 * The two describe the same document — for a PDF the stored object *is* the
 * fetched bytes, and for HTML it is those bytes decoded — so they cannot
 * legitimately be different kinds. Silently preferring either one would hide a
 * row that needs a person. GPT Sol, 2026-08-28.
 *
 * `null` when nothing can answer. **A guessed kind would be worse than an
 * absent manifest**: the name it produces is the only thing that tells a later
 * reader which decoder to use, and an `.html` name on a PDF is exactly the bug
 * `db:export` shipped until 2026-08-27.
 */
function rawKindOf(row: RevisionRow, slug: string): DocumentKind | null {
  const referenced =
    row.rawSourceKind === "pdf" || row.rawSourceKind === "html" ? row.rawSourceKind : null;
  const sniffed = row.rawBytes ? sniffKind(row.rawContentType, row.rawBytes) : null;

  if (referenced && sniffed && referenced !== sniffed) {
    /* `warn`, not `debug`: this one does not resolve itself. Every later read
       answers "no raw document" for an article that plainly has one, and the
       only symptom is a `fetch` step that will not stay done. */
    alog.warn(
      { slug, referenced, sniffed },
      `raw document is two kinds at once for ${slug}: the source reference says ` +
        `${referenced} and the stored bytes look like ${sniffed}`,
    );
    return null;
  }
  return referenced ?? sniffed;
}

/**
 * `raw.json`, rebuilt from the columns — stage 1's manifest.
 *
 * **What cannot be rebuilt is absent rather than invented.** `origin`,
 * `uploadId` and `filename` live only in the manifest and have no column, so an
 * uploaded document reads back as a fetch. That is a real gap with a real cost
 * — `GET /api/source/:slug` and "can this be refreshed?" both want `origin` —
 * and it is C6's: `raw_filename` is where the reader's own name for an
 * uploaded file goes. An invented `origin: "url"` would
 * be a false statement every later reader would believe.
 *
 * `contentType`, `encoding` and `sha256` are `T | null` in `RawManifest` rather
 * than optional, so they are written even when null: the difference between "we
 * know it was null" and "we never recorded it" is what that type exists to
 * express.
 */
function readRaw(row: RevisionRow, slug: string): RawManifest | null {
  const kind = rawKindOf(row, slug);
  if (!kind) return null;
  const fetchedAt = row.fetchedAt ?? row.createdAt;
  return {
    kind,
    file: kind === "pdf" ? "raw.pdf" : "raw.html",
    ...(row.requestedUrl === null ? {} : { requestedUrl: row.requestedUrl }),
    ...(row.finalUrl === null ? {} : { url: row.finalUrl }),
    contentType: row.rawContentType,
    encoding: row.rawEncoding,
    /* The **stored** byte count is what `raw_sources.bytes` describes, and
       there is no column for it yet — C6. `raw_bytes` is the closest honest
       number today and is null for a revision whose document only ever went to
       the bucket, so this reads 0 rather than inventing one. */
    bytes: row.rawBytes?.byteLength ?? 0,
    sha256: row.rawSha256,
    ...(row.rawSourceSha256 === null ? {} : { storedSha256: row.rawSourceSha256 }),
    fetchedAt: fetchedAt.toISOString(),
  };
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
    })),
  };
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
  requireBound(ref, slug);
  const site = siteFor(step, kind);

  const value = await (async (): Promise<unknown> => {
    if (site.at === "blocks") return readBlocks(exec, ref.revisionId);
    const row = await revisionRow(exec, ref.revisionId);
    if (!row) return null;
    if (site.at === "column") return row[site.column];
    return site.of === "meta" ? readMeta(ref, row) : readRaw(row, slug);
  })();

  if (value === null || value === undefined) return null;
  const why = whyUnusable(kind, value);
  if (why) {
    /* `debug`, not `warn`: a half-ingested article is the ordinary state of one
       nobody has finished. And the reason names a field and never the value —
       that is article prose (docs/project/logging.md). */
    alog.debug({ slug, step, kind, why }, `artefact unusable: ${kind} for ${slug}`);
    return null;
  }
  return value as ArtifactMap[K];
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
 * ## `toc` has no special case, and an earlier version of the plan said it did
 *
 * The rule was going to be: for `toc`, compare the row's `input_hash` against
 * the stored blocks. It is wrong twice. It is a freshness rule, in the one
 * function that must not have one. And it re-runs `toc` whenever stage 3 has
 * run since — which moves the tree's boundaries, which silently drops every
 * `arc` and `summary` entry whose block range no longer matches a node
 * (src/web/tree.ts). That is the hazard the `toc` stamp was withdrawn to avoid,
 * reached by a different door. GPT Sol, 2026-08-28;
 * docs/plans/artifacts-pg-has-sol.md.
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
  /* Matching the file adapter: nothing requested is not "yes, all of nothing".
     A step whose `produces` is empty has not been shown to have run. */
  if (kinds.length === 0) return false;

  /* The row first, because it is one small indexed read and the common case in
     a re-run is that it says no — where reading the artefacts means pulling a
     megabyte of blocks back to find out the same thing. */
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
 * `status = 'running'`, which is what src/store/artifacts-fs.ts spends a marker
 * file to express. The interface's own comment predicted this would be the same
 * concept in both stores, and it is.
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
      /* The field names, never the values: an `inputHash` is a hash, but a
         `promptVersion` and a `model` are ours to log and the rule is one rule.
         `warn` because this does not resolve itself — the step will re-run on
         every job until somebody looks. */
      alog.warn(
        { slug, step, clashes },
        `the ${step} run row and its artefact disagree about ${clashes.join(" and ")} — ` +
          `no usable stamp for ${slug}`,
      );
      return null;
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
 * Which columns of `article_revisions` each assembled artefact owns.
 *
 * Written out rather than derived, because these are the columns `write` is
 * allowed to set and nothing else may be inferred from a `Meta` — a stage that
 * grows a field must be made to decide where it goes.
 */
const META_COLUMNS = [
  "title",
  "byline",
  "siteName",
  "lang",
  "finalUrl",
  "fetchedAt",
  "excerpt",
  "note",
  "source",
  "extractMethod",
  "pages",
  "unverified",
  "recall",
  "pagesChecked",
  "rawSha256",
] as const;

/** `meta.json` taken apart into the columns it came from — the inverse of `readMeta`. */
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
    finalUrl: meta.url ?? null,
    fetchedAt: meta.fetchedAt ? new Date(meta.fetchedAt) : null,
    excerpt: meta.excerpt ?? null,
    note: meta.note ?? null,
    source: meta.source ?? null,
    extractMethod: meta.method ?? null,
    pages: meta.pages ?? null,
    unverified: meta.unverified ?? null,
    recall: meta.recall ?? null,
    pagesChecked: meta.pagesChecked ?? null,
    rawSha256: meta.rawSha256 ?? null,
  };
  /* The declared list and the object above must not drift; `META_COLUMNS` is
     what `readMeta`'s inverse is checked against in the test. */
  const written = Object.keys(columns);
  const missing = META_COLUMNS.filter((c) => !written.includes(c));
  if (missing.length) throw new Error(`meta write is missing ${missing.join(", ")}`);
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
 * 2. **Delete, unconditionally.** `src/store/import.ts` puts its delete *inside*
 *    `if (blocks.length)`, so writing an empty set leaves the previous
 *    revision's inherited rows in place — the stage returns nothing, the old
 *    article survives, and the run reports done. That is a silent success of
 *    the worst kind, and it is the one behaviour this function deliberately
 *    does not copy.
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
      })),
    );
  }
}

/**
 * Refused: `raw` cannot be written yet, and saying so beats writing half of it.
 *
 * The manifest names a document, and putting the document somewhere is the
 * other half — the `raw_sources` row, the reference pair, and the byte count
 * that `raw_sources.bytes` needs and `RawManifest.bytes` is not. That is C6 of
 * docs/plans/delete-the-importer.md. Until it lands, a `write` that quietly
 * skipped this part would leave a `fetch` step reporting done beside a revision
 * that holds no document at all.
 */
export class RawNotWritable extends Error {
  readonly status = 501;
  constructor(slug: string) {
    super(
      `cannot write the raw manifest for "${slug}" yet: the source reference and the stored ` +
        `byte count land in C6 of docs/plans/delete-the-importer.md. Refusing rather than ` +
        `recording a fetch with no document behind it.`,
    );
    this.name = "RawNotWritable";
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
 * `toc` has no `PipelineStep.stamp`, and it must still be written with an
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
      throw new RawNotWritable(slug);
    }
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
 * Put the stamp on the running step-run row, fenced.
 *
 * Only the fields the caller declared, because `undefined` in a `StepStamp`
 * means *this step does not record that* and writing a null over a real value
 * would be a different claim. `NO_INPUT_HASH` stays where `beginStepRun` put it
 * for a step that declares no input.
 *
 * **The lock comes first and the update second, and they are not one
 * statement.** Three of a step's four stamp fields are optional and three steps
 * declare none of them at all, so `fetch`, `extract` and `blocks` arrive here
 * with an empty stamp — and an `UPDATE` with nothing to set is an error rather
 * than a no-op. Folding the fence into the update would therefore have made the
 * fence *conditional on the step having a stamp*, which is exactly backwards:
 * the steps with no stamp are the ones whose completion nothing else can check.
 *
 * `for update` holds the row for the rest of the caller's transaction, so
 * nothing moves between the check and the write.
 *
 * A missing row is `StepRunNotHeld`, and zero rows is the fence working: held
 * by another attempt, already ended, or never begun. A `write` with no
 * preceding `beginStep` is the last of those, and it is a protocol error rather
 * than something to tolerate — the artefacts would land with nothing recording
 * that a run produced them.
 */
async function recordStamp(
  ref: JobDraftRef,
  tx: Tx,
  step: StepName,
  stamp: StepStamp,
): Promise<void> {
  const held = and(
    eq(revisionStepRuns.revisionId, ref.revisionId),
    eq(revisionStepRuns.stepName, step),
    eq(revisionStepRuns.attemptId, ref.attemptId),
    eq(revisionStepRuns.status, "running"),
  );

  const [row] = await tx
    .select({ stepName: revisionStepRuns.stepName })
    .from(revisionStepRuns)
    .where(held)
    .for("update")
    .limit(1);
  if (!row) throw new StepRunNotHeld(ref.revisionId, step);

  const set = {
    ...(stamp.inputHash === undefined ? {} : { inputHash: stamp.inputHash }),
    ...(stamp.implementationVersion === undefined
      ? {}
      : { implementationVersion: stamp.implementationVersion }),
    ...(stamp.promptVersion === undefined ? {} : { promptVersion: stamp.promptVersion }),
    ...(stamp.model === undefined ? {} : { model: stamp.model }),
  };
  if (Object.keys(set).length === 0) return;

  const result = await tx.update(revisionStepRuns).set(set).where(held);
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
    ...readOnlyPgArtifacts(ref, tx),
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
