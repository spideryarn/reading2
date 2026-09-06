/**
 * Write Postgres back out as `data/<slug>/`. **This is the rollback.**
 *
 *     npm run db:export -- --out /tmp/rollback     # somewhere safe
 *     npm run db:export -- --out data              # over the real thing
 *
 * The importer is only half a door. Until this exists, moving to Postgres is a
 * decision nobody can undo — and docs/plans/260825f-postgres-migration.md § The order of
 * work is explicit that the filesystem adapter, the importer and the exporter
 * are all kept for one release after cutover *and then* deleted. This is the
 * third of the three.
 *
 * ## It defaults to writing somewhere else
 *
 * `--out` has no default and the CLI refuses without it. Overwriting `data/`
 * is a real thing to want during a rollback and a terrible thing to do by
 * accident — the files under `data/` are the belt-and-braces backup that Greg
 * chose to keep, and an exporter that clobbers them by default would quietly
 * destroy the only copy that is not in the database it is being used to escape.
 *
 * ## What it cannot put back
 *
 * `raw.html` is written from the object in the `sources` bucket, which for a
 * page that was not already UTF-8 is the *decoded* text rather than the original
 * response bytes — `writeRaw` in src/fetch.ts stores what it decoded, which is
 * why `raw_sha256` and `storedSha256` answer different questions. So a round
 * trip through Postgres is faithful to what we kept, not to the web page.
 * Nothing here can fix that; the original bytes were thrown away at stage 1.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { eq } from "drizzle-orm";

import { getDb } from "../db/client.js";
import { articleRevisions, articles } from "../db/schema.js";
/* **The queries moved out on 2026-09-01**, and only the queries. Everything
   below still projects those rows into the filesystem store's layout exactly as
   it did — the rollback is pinned byte for byte by tests/store-roundtrip.test.ts,
   so this file's job is the lossy projection and article-rows.ts's job is the
   faithful read. docs/plans/260901h-export-article-data.md § The design. */
import {
  ArticleNotFound,
  type RollbackTable,
  messagesOfThread,
  readArticleRows,
} from "./article-rows.js";
/* Pure — it reaches for `quote-match` and `urls` and nothing else — so naming
   the union's two spellings in one place costs this file no dependency it did
   not already have. */
import { configFromRow } from "../referee-criteria.js";
import type { SavedCriterion } from "../saved-criteria.js";
import { blocksArtefact } from "../blocks.js";
import { type RawManifest, sniffKind } from "../fetch.js";
import { metaRawSha256 } from "./artifacts.js";
import { type RawSourceStore, postgresBlobStore } from "./blobs.js";
/* **Moved to a module of its own on 2026-08-31**, and re-exported below so that
   every existing importer — and tests/store-export-raw.test.ts — is unchanged.
   `GET /api/source/:slug` became a second caller and importing it from here
   would have made a cycle: this file reaches into `pg.ts` for `ownedByReader`,
   and `pg.ts` would then have reached back. raw-document.ts has the reasoning. */
import { CorruptRawObject, MissingRawObject, readRawDocument } from "./raw-document.js";
export { CorruptRawObject, MissingRawObject, readRawDocument };
/* Re-exported for the same reason: a caller that wants to tell "no such
   article" apart from a real failure should not have to know which file the
   query walk lives in. */
export { ArticleNotFound };
import { ownedByReader } from "./pg.js";
import { log } from "../log.js";
import type { Block, ChatAnchor, ChatMessage, Comment, SearchRun } from "../types.js";

const logger = log("store");

/**
 * Where an export puts things.
 *
 * `outputRoot` is separate and explicit because `output/` is a **sibling** of
 * `data/` in the repo, not a child of it — stage 3 reads and writes ids into
 * `output/<slug>.html`. Deriving it as `<outRoot>/../output` was the first
 * version and it was wrong in the way that only shows up off the happy path:
 * exporting to a temporary directory then wrote HTML into that directory's
 * PARENT, which for `mkdtemp` is the system temp root. It worked, and it
 * littered somewhere nobody would look.
 */
export interface ExportTarget {
  /** Where `<slug>/` directories go. The equivalent of `data/`. */
  readonly dataRoot: string;
  /** Where `<slug>.html` goes. The equivalent of `output/`. */
  readonly outputRoot: string;
}

/** What one article's export wrote. */
export interface ExportResult {
  readonly slug: string;
  readonly files: readonly string[];
  /**
   * **Which tables this run actually took rows out of** — observed, not declared.
   *
   * `ARTICLE_TABLE_COVERAGE` below is a claim about what the export does; this
   * is what it did. They are checked against each other in
   * tests/store-export-covers-tables.test.ts, which is the whole point: the
   * first version of that check searched this file's *source text* for
   * `put("<filename>"`, which a comment satisfies and which a table declared
   * into somebody else's file satisfies too. A set the code appends to while
   * writing cannot be satisfied by either. GPT Sol, 2026-09-01.
   */
  readonly tables: readonly ExportedTable[];
}

/**
 * **The coverage record moved to [article-rows.ts](article-rows.ts) on
 * 2026-09-01, and is re-exported here so its old importers are unchanged.**
 *
 * It belongs beside the query walk rather than beside this projection, because
 * there are now two projections of one article — this rollback, and the zip a
 * reader downloads ([export-bundle.ts](export-bundle.ts)) — and a record kept
 * beside either one would only make that one answerable for a new table. The
 * two also genuinely disagree: `block_identities` is omitted here and required
 * there. `TableCoverage` has the reasoning.
 *
 * `ExportedTable` keeps its name: it means "a table THIS file writes", which is
 * exactly `RollbackTable` now that there is a second output to distinguish it
 * from, and it is what `put` accepts.
 */
export {
  ARTICLE_TABLE_COVERAGE,
  type ArticleTable,
  type Destination,
  type TableCoverage,
} from "./article-rows.js";
export type ExportedTable = RollbackTable;

/**
 * Where the source documents come from, or a refusal — **never `data/_blobs`**.
 *
 * The whole of an export's difficulty is that a revision row holds a
 * *reference* to its source document, so half the backup comes out of Postgres
 * and half out of a bucket. `blobStore()` picks that bucket from the presence of
 * two credentials and falls back to the filesystem when either is missing,
 * which here means reading a directory that has never held these objects: the
 * export omits every source document, or throws `MissingRawObject` on rows that
 * are perfectly fine. **A backup that looks complete and is not**, in the tool
 * you reach for after losing something.
 *
 * So the export asks `postgresBlobStore` (src/store/blobs.ts) instead, which
 * refuses rather than falls back — the same constructor `src/store/index.ts`
 * uses at boot, because there is only one such pair.
 *
 * One function rather than an inline default, because
 * [`scripts/db-export.ts`](../../scripts/db-export.ts) has to call it **before**
 * the first article is written. A default parameter fires on the first
 * `exportArticle`, by which time an earlier slug's directory is already on disk.
 * docs/plans/260827aa-delete-the-importer.md § `db:export` must fail closed.
 */
export function exportBlobStore(): RawSourceStore {
  return postgresBlobStore("db:export reads article rows out of Postgres");
}

/**
 * JSON exactly as the pipeline writes it: two-space indent, trailing newline.
 *
 * Not cosmetic. A round trip that reformats every artefact makes `git diff`
 * useless for telling "the data changed" from "the writer changed", which is
 * the one question you are asking during a rollback.
 */
/**
 * A thread row's three anchor columns as a `{ anchor? }` fragment.
 *
 * Deliberately a near-duplicate of `anchorOf` in src/store/pg-chat.ts rather
 * than an import from it: export reads the database directly, without going
 * through the store, which is what makes it usable to dump an article whose
 * store is not the live one. See the note at the top of this file.
 */
function anchorFragment(t: {
  anchorBlockId: string | null;
  anchorQuote: string | null;
  anchorStart: number | null;
}): { anchor?: ChatAnchor } {
  if (!t.anchorBlockId) return {};
  if (t.anchorQuote === null || t.anchorStart === null) {
    return { anchor: { blockId: t.anchorBlockId } };
  }
  return { anchor: { blockId: t.anchorBlockId, quote: t.anchorQuote, start: t.anchorStart } };
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

/** Drop nulls, so an absent field is absent rather than explicitly null. */
function compact<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== null && v !== undefined),
  ) as Partial<T>;
}

/**
 * What to call the raw document, decided **the way stage 1 decided it**.
 *
 * One classifier, not two. The first version of this reached for `looksLikePdf`
 * (src/source.ts), which requires `%PDF-` at byte zero — while `sniffKind`
 * deliberately accepts a header a little way in, because *"real files sometimes
 * carry a little junk in front"*. So stage 1 would take such a file as a PDF and
 * the export would write it out as `raw.html`: the exact bug this whole change
 * exists to fix, one layer along, and invisible because no fixture here has one.
 * GPT Sol found it reviewing the fix, 2026-08-27.
 *
 * Passing the stored content type in rather than `null` matters for the other
 * direction: `sniffKind` uses it to refuse a `%PDF-1.7` sitting in the middle of
 * a page the server called HTML, which is an article *about* PDFs.
 *
 * `null` — bytes it cannot place — falls back to HTML, which is what every
 * article predating manifests already is.
 */
export function rawFileName(contentType: string | null, bytes: Uint8Array): string {
  return sniffKind(contentType, bytes) === "pdf" ? "raw.pdf" : "raw.html";
}

/**
 * Write the raw document and its manifest, and say which files were written.
 *
 * Its own function because `exportArticle` was already long and this pushed it
 * past the complexity gate — but also because the two belong together: the
 * manifest's `file` field must name the file written beside it, and a reader
 * checking that promise should not have to hold the rest of an export in their
 * head to do it.
 */
async function writeRawDocument(
  dir: string,
  slug: string,
  revision: {
    rawContentType: string | null;
    rawEncoding: string | null;
    rawSha256: string | null;
    rawByteCount: number | null;
    rawFilename: string | null;
    rawSourceSha256: string | null;
    rawSourceKind: string | null;
    requestedUrl: string | null;
    finalUrl: string | null;
    fetchedAt: Date | null;
    createdAt: Date;
  },
  sources: RawSourceStore,
): Promise<string[]> {
  const document = await readRawDocument(slug, revision, sources);
  if (!document) return [];

  const { bytes, kind, storedSha256 } = document;
  const file = kind === "pdf" ? "raw.pdf" : "raw.html";
  await writeFile(path.join(dir, file), bytes);

  /* raw.json — stage 1's manifest, rebuilt from the columns. It was not
     exported at all, which meant a round trip lost the content type, the
     encoding, the hash and the two URLs, and left the file's own name as the
     only surviving fact about it.

     **Not `compact`ed**, unlike `meta.json` above: `contentType`, `encoding`
     and `sha256` are `T | null` in `RawManifest` rather than optional, so a
     null dropped here comes back as a *missing* key, and the difference
     between "we know it was null" and "we never recorded it" is exactly what
     that type exists to express (src/fetch.ts).

     **`storedSha256` and `storedBytes` are what make this loadable again**, and
     they are the reason this function had to learn about the bucket at all.
     src/store/artifacts-pg.ts refuses a manifest without them (`NoStoredDocument`),
     because a manifest naming no object would record a fetch with no document
     behind it. Omit them and `db:export` produces a directory that nothing can
     read back — a round trip that looks complete and is not. `readRawDocument`
     answers `null` rather than `storedSha256: null` when the row names no
     object, so this function has already returned by then.

     **`bytes` is the network count, from its own column.** Not
     `bytes.byteLength`, which is the size of what we *stored* — the same two
     numbers `storedBytes` and `bytes` exist to keep apart, since `writeRaw`
     stores the decoded string and any page that was not already UTF-8 differs.
     The fallback to the buffer length is for a revision written before
     `raw_byte_count` existed, which never distinguished the two numbers
     anyway.

     `origin`/`uploadId` remain genuinely unrecoverable and are therefore absent
     rather than invented: they live only in the manifest and have no column, so
     an exported upload still reads back as a fetch. `filename` now survives —
     `raw_filename` was added for it in § C6.

     **`backfilled` is always set, and that is not a hedge.** Every manifest
     this writes is a *reconstruction from columns*, never a copy of the file
     stage 1 wrote — which is what `backfilled` already means (src/fetch.ts). It
     also stops the export claiming a distinction the schema cannot make: there
     is no column saying whether stage 1 wrote a manifest at all, so
     `data/writes` (which has one) and `data/constitution` (which does not) are
     indistinguishable by the time the bytes are in Postgres. */
  const manifest: RawManifest = {
    kind,
    file,
    ...(revision.requestedUrl === null ? {} : { requestedUrl: revision.requestedUrl }),
    ...(revision.finalUrl === null ? {} : { url: revision.finalUrl }),
    ...(revision.rawFilename === null ? {} : { filename: revision.rawFilename }),
    contentType: revision.rawContentType,
    encoding: revision.rawEncoding,
    bytes: revision.rawByteCount ?? bytes.byteLength,
    sha256: revision.rawSha256,
    storedSha256,
    storedBytes: bytes.byteLength,
    fetchedAt: (revision.fetchedAt ?? revision.createdAt).toISOString(),
    backfilled:
      "Rebuilt from the database by db:export. Provenance beyond the two URLs " +
      "was not stored, so origin and uploadId are absent rather than invented.",
  };
  await writeJson(path.join(dir, "raw.json"), manifest);
  return [file, "raw.json"];
}

/**
 * Export one article into `<outRoot>/<slug>/`.
 *
 * Only the CURRENT revision. Older revisions are history, and a rollback wants
 * the article as it is being served, not an archive — see open question 4 in
 * docs/plans/260825f-postgres-migration.md about how many revisions to keep.
 */
export async function exportArticle(
  slug: string,
  target: ExportTarget,
  /* **Injected, and defaulted at the call rather than inside.** The default is
     the bucket that matches the database, so an ordinary caller writes nothing
     extra; a test can hand in a store it controls without reaching for the
     environment. Not optional deeper down — `writeRawDocument` takes it as a
     required argument, so a future caller cannot forget it and silently get
     `blobStore()`'s filesystem fallback. */
  sources: RawSourceStore = exportBlobStore(),
): Promise<ExportResult> {
  /* One owner-scoped read, up front. It throws `ArticleNotFound` — a subclass
     of `Error` carrying the message this function has always thrown for a slug
     that is not this reader's, so `npm run db:export`'s output is unchanged and
     a route can still tell the case apart. */
  const rows = await readArticleRows(slug);
  const { article, revision } = rows;

  const dir = path.join(target.dataRoot, slug);
  await mkdir(dir, { recursive: true });
  const written: string[] = [];
  /**
   * Write an artefact, and **say which table it came out of**.
   *
   * `from` is not decoration and it is not a comment: it is the runtime half of
   * `ARTICLE_TABLE_COVERAGE`. It goes into `ExportResult.tables`, which is what
   * tests/store-export-covers-tables.test.ts asks — instead of asking this
   * file's source text, which said `put("comments.json"` whether or not the call
   * ran, and whether or not the table declaring that file was the one writing it.
   */
  const wroteFrom = new Set<ExportedTable>();
  const put = async (
    /* An array where one file is built from two tables — `chat.json` is threads
       and their messages — so that "which tables did this run write?" stays an
       honest answer rather than the first table that happened to name the file. */
    from: ExportedTable | readonly ExportedTable[],
    name: string,
    value: unknown,
  ) => {
    await writeJson(path.join(dir, name), value);
    written.push(name);
    for (const table of typeof from === "string" ? [from] : from) wroteFrom.add(table);
  };

  /* meta.json — rebuilt from the columns, with absent fields absent. `slug`
     first so the file reads the way stage 2 writes it. */
  const meta = compact({
    slug,
    title: revision.title,
    byline: revision.byline,
    siteName: revision.siteName,
    lang: revision.lang,
    url: revision.finalUrl,
    fetchedAt: revision.fetchedAt?.toISOString() ?? null,
    excerpt: revision.excerpt,
    /* **Verbatim, never re-parsed** — the column is `text` holding the
       publisher's own ISO string in their own frame, and putting it through a
       `Date` here would move the calendar day, which is the whole content of
       the field. Placed where stage 2 writes it, so the round trip is
       byte-identical. src/db/schema.ts § `publishedAt`. */
    publishedAt: revision.publishedAt,
    note: revision.note,
    source: revision.source,
    method: revision.extractMethod,
    pages: revision.pages,
    /* Not `revision.rawSha256`. `raw.json` beside this file gets that column —
       it is stage 1's hash and every fetch has one. `Meta.rawSha256` is PDFs
       only, and writing the column here put the field into the `meta.json` of
       every HTML article an export touched. src/store/artifacts.ts. */
    rawSha256: metaRawSha256(revision),
    unverified: revision.unverified,
    recall: revision.recall,
    pagesChecked: revision.pagesChecked,
  });
  if (revision.title) await put("article_revisions", "meta.json", meta);

  /* blocks.json — in document order, which is the whole ballgame. Ids are
     random and carry no position, so rows arriving unordered would silently
     export a shuffled article that still validates. The `order by ordinal` that
     guarantees it is in `readArticleRows`. */
  const blockRows = rows.blocks;

  const blocks: Block[] = blockRows.map((row) => ({
    id: row.blockId,
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
  /* `blocksArtefact`, for the same reason src/hierarchy.ts uses it: the export is a
     rollback, and a rollback that writes artefacts the pipeline would not have
     written is not one. Without the stamp every exported article reads back
     stale. */
  if (blocks.length) await put("revision_blocks", "blocks.json", blocksArtefact(blocks));

  if (revision.tree) await put("article_revisions", "tree.json", revision.tree);
  if (revision.arc) await put("article_revisions", "arc.json", revision.arc);
  /* The manifest only. The image bytes it names are content-addressed objects in
     the `sources` bucket, and this export writes an article's *artefacts* — the
     document's own bytes come back through `writeRawDocument` below and nothing
     else does. An exported article therefore names objects it can only fetch
     from the bucket it came from, which is the same contract `raw_source_sha256`
     already has. docs/plans/260829b-hosting-the-articles-images.md. */
  if (revision.assets) await put("article_revisions", "assets.json", revision.assets);
  if (revision.tweets) await put("article_revisions", "tweets.json", revision.tweets);
  if (revision.glossary) await put("article_revisions", "glossary.json", revision.glossary);
  /* No `summary.json`: stage 5e, the `summary` artefact kind and the column
     that held it all went on 2026-08-31 (docs/plans/260831s-gist-only-summaries.md). */
  if (revision.ideas) await put("article_revisions", "ideas.json", revision.ideas);
  if (revision.quotes) await put("article_revisions", "quotes.json", revision.quotes);
  if (revision.timeline) await put("article_revisions", "timeline.json", revision.timeline);
  if (revision.quiz) await put("article_revisions", "quiz.json", revision.quiz);
  if (revision.sketch) await put("article_revisions", "sketch.json", revision.sketch);
  if (revision.illustrated)
    await put("article_revisions", "illustrated.json", revision.illustrated);
  if (revision.labels) await put("article_revisions", "labels.json", revision.labels);

  written.push(...(await writeRawDocument(dir, slug, revision, sources)));

  if (revision.stampedHtml) {
    /* stage 3's artefact lives in `output/`, not in `data/` — see
       docs/plans/260825f-postgres-migration.md § Stage 3 recovers ids from output/.
       Exporting it beside the article would put it somewhere nothing reads, and
       the next `npm run blocks` would re-mint every id. */
    await mkdir(target.outputRoot, { recursive: true });
    await writeFile(path.join(target.outputRoot, `${slug}.html`), revision.stampedHtml, "utf8");
    written.push(path.join(target.outputRoot, `${slug}.html`));
  }

  /* shelf.json — what the reader did to the card, from the five columns on
     `articles` rather than on the revision. Written only when there is
     something to say: an untouched article has no shelf file, and inventing an
     empty one would mean every round trip added a file the app never wrote —
     which the round-trip test checks for, and rightly.

     **`purpose` was missing from both halves of this until 2026-08-28**, and it
     is the reader's own words — "why you're reading this one", the per-article
     half of docs/plans/260826t-reader-profile.md. It was absent from the object, so an
     article with other shelf state exported a file with the purpose quietly
     gone; and absent from the condition, so an article whose *only* state was a
     purpose exported no shelf file at all. Nothing caught it because no
     `shelf.json` in `data/` carries one, and every assertion in
     tests/store-roundtrip.test.ts compares against that corpus. This is the
     rollback tool, so the loss was permanent.

     The condition is now "any of the five", written from the same object rather
     than as a second list that can fall behind it. `opens` is excluded from the
     `some` because it is always present and `0` is not something to say. */
  const shelf = compact({
    archivedAt: article.archivedAt?.toISOString() ?? null,
    title: article.titleOverride,
    // Not `compact`ed away: zero is a real answer to "how many times", and a
    // shelf file that omits it would read back as `undefined` where the
    // filesystem store writes `0`.
    opens: article.opens,
    lastOpenedAt: article.lastOpenedAt?.toISOString() ?? null,
    purpose: article.purpose,
  });
  if (article.opens > 0 || Object.keys(shelf).some((key) => key !== "opens")) {
    await put("articles", "shelf.json", shelf);
  }

  /* Reader state. Each file wraps its payload in a single-key object, and
     getting that wrapper wrong is what made the importer lose 17 KB of
     comments while reporting success. Same shapes, written back the same way.

     `shelf.json` above is the one that does NOT wrap — it is the state itself,
     not a list of anything, and src/shelf.ts reads it that way. */
  /* **Every list here is ordered explicitly, and none of them was.** The
     `order by` itself now lives in `readArticleRows`, which is the only place
     these rows are read; this note stays because it is the reason it is there.

     A `select` with no `order by` returns rows in whatever order Postgres finds
     them, which is usually the order they were written and is guaranteed to be
     nothing. The round-trip test passed on that for weeks; the day
     src/store/import.ts started deleting and re-inserting reader state, the
     physical order changed and searches.json came back shuffled. An export
     whose row order moves on its own makes `git diff` useless during a
     rollback, which is the one moment anybody is reading it.

     `created_at, id` is the order, and `id` is there so that two rows written
     in the same millisecond cannot swap between exports. It is NOT the array
     order the file originally had — data/noema-.../comments.json has a
     hand-written comment sitting out of date order, and nothing can recover
     that from a table. It does not matter: src/web/comment-nav.ts sorts
     comments into document order before showing them, using this same
     `createdAt` then `id` chain to break ties, so the file's array order is
     insertion order and nothing reads it. GPT Sol raised both the missing
     order and the array-order claim in review, 2026-08-26. */
  const commentRows = rows.comments;
  if (commentRows.length) {
    const comments: Comment[] = commentRows.map((row) =>
      compact({
        id: row.id,
        blockId: row.blockId,
        quote: row.quote,
        start: row.start,
        createdAt: row.createdAt.toISOString(),
        /* The reader's own three. `compact` drops the nulls, so a bookmark
           exports without a `body` key rather than with a null one — which is
           what the filesystem store writes and what the round-trip compares. */
        body: row.body,
        updatedAt: row.updatedAt?.toISOString() ?? null,
        threadId: row.threadId,
        /* **The referee's own mark, and the sign is the whole content of it.**
           `compact` drops a null, so an ordinary reading note exports without
           either key — which is what both stores write. There is no clamp and
           no `?? 0` anywhere on this line: a valence of −80 that came back as
           `0` would read as "the referee felt neither way", and a rollback is
           the one moment nobody is in a position to notice.
           These two were added to the table on 2026-08-31 and were missing here
           from the day they existed — the same way `tools` and `stance` went
           missing from the chat export, and for the same reason: this row is
           built from named fields. `tests/store-export-covers-tables.test.ts`
           now fails when a new article-scoped table appears; it cannot see a
           new *column*, so this comment is the reminder that the row above is a
           hand-written list. */
        criterionId: row.criterionId,
        valence: row.valence,
        status: row.status,
        answer: row.answer,
        citations: row.citations,
        searches: row.searches,
        model: row.model,
        error: row.error,
      }) as Comment,
    );
    await put("comments", "comments.json", { comments });
  }

  const threadRows = rows.chatThreads;
  if (threadRows.length) {
    const threads = [];
    /* Counted rather than assumed. `chat.json` is written from two tables and a
       thread with no messages is a real state, so an export that recorded
       `chat_messages` on the strength of a thread row would be claiming coverage
       it had not exercised — which is the shape of thing this whole record
       exists to stop. */
    let messagesSeen = 0;
    for (const thread of threadRows) {
      /* Grouping only — the rows in hand are this article's alone, because
         `readArticleRows` reads them by `article_id`. That is load-bearing and
         not a detail of where the query sits: a thread id is unique only within
         its article (`chat_threads`'s primary key is `(article_id, id)`, the
         same rule as block ids), so two articles can hold a thread called
         `thr-1`, and a read keyed on the thread id alone would write both
         articles' messages into one article's rollback file. That is one
         reader's private conversation appearing under someone else's article,
         and the round-trip test would not have noticed: it exports one article
         at a time. */
      const messageRows = messagesOfThread(rows, thread.id);
      messagesSeen += messageRows.length;
      threads.push({
        id: thread.id,
        title: thread.title,
        createdAt: thread.createdAt.toISOString(),
        updatedAt: thread.updatedAt.toISOString(),
        /* Spread a fragment rather than set a key, so an unanchored thread has
           no `anchor` at all — the filesystem store omits it, and this file and
           that one are compared byte for byte. Building the thread from named
           fields is exactly how `tools` went missing from an export once
           already; the anchor is the same trap one row up. */
        ...anchorFragment(thread),
        /* **Always written, unlike the anchor above and `stopped` below**, and
           the difference is that `ChatThread.kind` is *required*. Both stores
           therefore always have one: `withTurn` sets it on every thread it
           creates, and `normaliseKind` in src/chat.ts supplies `"chat"` when a
           file written before this field existed is read — so the next write of
           that file has it too.

           Emitting it only for Remember threads was the first attempt and was
           wrong:
           tests/store-roundtrip.test.ts compares this file against the one the
           filesystem store wrote, byte for byte, and that one carries
           `"kind": "chat"`. A file that predates the field and has not been
           written since is the one case where the two differ, and it converges
           the moment anything touches it — the same transitional state `tools`
           passed through. */
        kind: thread.kind === "remember" ? ("remember" as const) : ("chat" as const),
        messages: messageRows.map((row) =>
          compact({
            id: row.id,
            role: row.role,
            text: row.text,
            createdAt: row.createdAt.toISOString(),
            status: row.status,
            citations: row.citations,
            searches: row.searches,
            /* Null becomes an absent key via `compact`, which is what the
               filesystem store writes for an answer that used no tools — and
               those two have to agree exactly, because
               tests/store-roundtrip.test.ts compares the bytes. */
            tools: row.tools,
            model: row.model,
            error: row.error,
            // `false` is the default and the file simply had no key.
            stopped: row.stopped ? true : null,
            /* **The field this file's own comment warned about**, four lines
               up: `tools` went missing from an export exactly this way once
               already, because the row is built from named fields and a new one
               is easy not to add. A Remember thread exported without its stances
               and imported back is a conversation whose every answer has lost
               the instruction that produced it, and nothing reports an error.
               GPT Sol's review of docs/plans/260827ah-review-mode.md, finding 6. */
            stance: row.stance,
            /* Beside `stance` and for the identical reason its comment gives:
               this projection is built from named fields, so a new column is
               easy not to add and its absence is silent. `false` becomes an
               absent key via `compact`, which is what the filesystem store
               writes for a question nobody pressed "?" for. */
            help: row.help ? true : null,
            editedAt: row.editedAt?.toISOString() ?? null,
          }) as ChatMessage,
        ),
      });
    }
    await put(
      messagesSeen ? (["chat_threads", "chat_messages"] as const) : "chat_threads",
      "chat.json",
      { threads },
    );
  }

  const runRows = rows.searchRuns;
  if (runRows.length) {
    const runs: SearchRun[] = runRows.map((row) =>
      compact({
        id: row.id,
        criterion: row.criterion,
        createdAt: row.createdAt.toISOString(),
        status: row.status,
        hits: row.hits,
        model: row.model,
        error: row.error,
        /* The article the run was answered against. Dropping it here would
           make a round trip through Postgres quietly reset every saved search
           to "we cannot tell", which reads as *out of date* — src/searches.ts
           § isStale. `compact` turns a null back into an absent key. */
        sourceHash: row.sourceHash,
        /* The reader's colour choice, for the same reason: dropping it puts
           every hand-coloured search back on its automatic hue, which is a
           change to what the page looks like that nothing announces. */
        colour: row.colour,
      }) as SearchRun,
    );
    await put("search_runs", "searches.json", { runs });
  }

  /* referee-criteria.json — the referee's own criteria and what each turned up.
     `src/referee-criteria-store.ts` writes this file, and it is exported here
     for the reason everything else is: without it a rollback loses the criteria
     silently, and a criterion is the referee's own words about somebody else's
     unpublished paper.

     **The config comes back through `configFromRow`**, not by copying four
     columns into an object: the kind, the two poles and the scale are a
     discriminated union in TypeScript and a `referee_criteria_diverging_shape`
     check in Postgres, and there is exactly one function that knows how the two
     spellings correspond. A row it cannot read — a kind from a later version —
     is skipped and counted rather than exported half-formed, because a
     criterion whose `config` is nonsense reads back as one the panel cannot
     draw.

     `comments.criterion_id` points at these rows, so an export that wrote the
     comments and dropped the criteria would produce a `data/` directory whose
     referee marks name criteria that are not there. */
  const criterionRows = rows.refereeCriteria;
  if (criterionRows.length) {
    const criteria: SavedCriterion[] = [];
    let unreadable = 0;
    for (const row of criterionRows) {
      const config = configFromRow(row);
      if (!config) {
        unreadable++;
        continue;
      }
      criteria.push(
        compact({
          id: row.id,
          criterion: row.criterion,
          config,
          createdAt: row.createdAt.toISOString(),
          status: row.status,
          /* Not `compact`ed away by accident: `results` is `not null default
             []`, and an empty array is a real answer — "this criterion ran and
             found nothing" — which is a different fact from a criterion that
             never ran. `compact` drops only null and undefined, so `[]` stays. */
          results: row.results,
          model: row.model,
          error: row.error,
          sourceHash: row.sourceHash,
          colour: row.colour,
        }) as SavedCriterion,
      );
    }
    if (unreadable) {
      /* Loud, because the alternative is a rollback quietly one criterion
         short. Ids and a count only — a criterion is prose. */
      logger.warn({ slug, unreadable }, "criteria skipped: config could not be read");
    }
    if (criteria.length) await put("referee_criteria", "referee-criteria.json", { criteria });
  }

  /* referee-claims.json — the paper's own claims and where it takes each one
     up. The shape on disk is `{ run }` rather than a bare run, because that is
     what the filesystem claims store wrote and what a restore would have to
     read back. That store (`src/referee-claims-store.ts`, with its
     `loadClaimsRun` reading `parsed.run`) was deleted on 2026-09-05 and this
     wrapper outlived it: the bytes are a rollback format now, and changing the
     envelope would silently invalidate every export already written.

     **One row and no id**, unlike every other table here: a referee asks the
     paper what it claims exactly once, so there is nothing to order and nothing
     to loop over. `referee_claims` is an interim table
     (drizzle/0051_referee_claims.sql); when Claims becomes the pipeline artefact
     the plan wants, this block moves up to the `article_revisions` group above
     and the coverage entry moves with it.

     `claims` is JSONB and is written back verbatim. There is no `configFromRow`
     equivalent to fail on, because there is no discriminated union in the row —
     the shape is validated by `validateClaims` on the way in. */
  const claimsRow = rows.refereeClaims[0];
  if (claimsRow) {
    await put("referee_claims", "referee-claims.json", {
      run: compact({
        status: claimsRow.status,
        createdAt: claimsRow.createdAt.toISOString(),
        /* Not `compact`ed away: `claims` is `not null default []`, and an empty
           array is a real answer — a run that failed, or one still pending —
           which is a different fact from a run that was never made. `compact`
           drops only null and undefined, so `[]` stays. */
        claims: claimsRow.claims,
        model: claimsRow.model,
        /* `compact` drops it when null, which is right: null means *not
           recorded*, and `"claimsOmitted": null` on disk would read as a
           recorded zero. */
        claimsOmitted: claimsRow.claimsOmitted,
        error: claimsRow.error,
        sourceHash: claimsRow.sourceHash,
      }),
    });
  }

  const lookupRows = rows.glossaryLookups;
  if (lookupRows.length) {
    const lookups: Record<string, unknown> = {};
    for (const row of lookupRows) {
      lookups[row.entryId] = {
        answer: row.answer,
        citations: row.citations,
        searches: row.searches,
        model: row.model,
        at: row.at.toISOString(),
      };
    }
    await put("glossary_lookups", "glossary-lookups.json", { lookups });
  }

  logger.info({ slug, files: written.length, tables: wroteFrom.size }, "article exported");
  return { slug, files: written, tables: [...wroteFrom] };
}

/** Every article Postgres can export: one with a current revision. */
export async function exportableSlugs(): Promise<string[]> {
  const db = getDb();
  const rows = await db
    .select({ slug: articles.slug })
    .from(articles)
    .innerJoin(articleRevisions, eq(articleRevisions.id, articles.currentRevisionId))
    /* Export what you own. This runs from the CLI, where `currentOwnerId()`
       reads the environment — so it is `SPIDERYARN_OWNER_ID` that decides whose
       library `npm run db:export` writes out, and that is the intended knob. */
    .where(ownedByReader());
  return rows.map((r) => r.slug);
}
