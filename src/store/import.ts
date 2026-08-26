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
 * not "converge on something equivalent". So the revision id is **derived from
 * the content** rather than minted: same article, same blocks, same revision
 * row, upserted in place. A second run with changed blocks makes a second
 * revision, which is correct — that is a different extraction.
 *
 * ## What cannot be imported, and is not pretended
 *
 * - **`raw_content_type` and `raw_encoding` are null for every imported row.**
 *   `data/<slug>/raw.html` is not raw: src/pipeline.ts writes a *decoded string*
 *   there and throws away the bytes, the content type and the sniffed encoding.
 *   The bytes we store are therefore UTF-8 re-encoded, not what the server sent.
 *   Recording the loss is the honest move; inventing `text/html; charset=utf-8`
 *   would make a guess indistinguishable from a fact.
 * - **`extracted_html` is null for every imported row.** Stage 2 writes
 *   `output/<slug>.html` and stage 3 overwrites the same path with the
 *   id-stamped version, so the intermediate no longer exists on disk. Only
 *   `stamped_html` survives, and that is what is imported.
 *
 * Both are recorded on the result so the caller can report them rather than
 * discovering them later as null columns.
 */

import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { loadThreads } from "../chat.js";
import { loadComments } from "../comments.js";
import { getDb } from "../db/client.js";
import { loadLookups } from "../glossary-lookups.js";
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
  revisionBlocks,
  revisionStepRuns,
  searchRuns,
} from "../db/schema.js";
import { isSpideryarnId } from "../ids.js";
import { log } from "../log.js";
import { currentOwnerId, type OwnerId } from "../owner.js";
import { parseJsonFrom } from "../parse-json.js";
import type { LabelsFile } from "../labels.js";
import type { Arc, Block, Glossary, Meta, Summaries, Tree, TweetThread } from "../types.js";
import { eq } from "drizzle-orm";

const ROOT = path.resolve(import.meta.dirname, "../..");
const logger = log("store");

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
    return parseJsonFrom<T>(await readFile(file, "utf8"), path.relative(ROOT, file));
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

/**
 * Import one article's directory.
 *
 * Everything happens in **one transaction**, because publication is the atomic
 * unit: a reader sees either the previous published revision or the complete
 * new one, never a mixture. That is the property today's filesystem store does
 * not have — a failed re-extraction overwrites a good article in place.
 */
export async function importArticle(slug: string, ownerId: OwnerId = currentOwnerId()): Promise<ImportResult> {
  const dir = path.join(ROOT, "data", slug);
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

  const meta = await readJson<Meta>(path.join(dir, "meta.json"));
  if (!meta) absent.push("meta.json");
  const arc = await readJson<Arc>(path.join(dir, "arc.json"));
  if (!arc) absent.push("arc.json");
  const tweets = await readJson<TweetThread>(path.join(dir, "tweets.json"));
  if (!tweets) absent.push("tweets.json");
  const glossary = await readJson<Glossary>(path.join(dir, "glossary.json"));
  if (!glossary) absent.push("glossary.json");
  const summaries = await readJson<Summaries>(path.join(dir, "summary.json"));
  if (!summaries) absent.push("summary.json");
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

  const rawBytes = await readMaybeBytes(path.join(dir, "raw.html"));
  if (!rawBytes) absent.push("raw.html");
  else unrecoverable.push("raw_content_type", "raw_encoding");

  const stampedHtml = await readMaybe(path.join(ROOT, "output", `${slug}.html`));
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
  const revisionId = derivedUuid("revision", slug, fingerprint);

  // The library's scalars, computed once here rather than by a directory walk
  // per request — the discipline `LibraryEntry` was already written to.
  const wordCount = blocks.reduce((n, b) => n + b.words, 0);
  let partCount = 0;
  let sectionCount = 0;
  for (const node of Object.values(tree.nodes)) {
    if (node.depth === 1) partCount++;
    else if (node.depth === 2) sectionCount++;
  }
  const rootGist = tree.nodes[tree.rootId]?.gist ?? tree.nodes[tree.rootId]?.summary;

  const db = getDb();
  await db.transaction(async (tx) => {
    await tx
      .insert(articles)
      .values({
        id: articleId,
        ownerId,
        slug,
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
          archivedAt: shelf.archivedAt ? new Date(shelf.archivedAt) : null,
          titleOverride: shelf.title ?? null,
          opens: shelf.opens,
          lastOpenedAt: shelf.lastOpenedAt ? new Date(shelf.lastOpenedAt) : null,
        },
      });

    await tx
      .insert(articleRevisions)
      .values({
        id: revisionId,
        articleId,
        status: "published",
        title: meta?.title ?? null,
        byline: meta?.byline ?? null,
        siteName: meta?.siteName ?? null,
        lang: meta?.lang ?? null,
        excerpt: meta?.excerpt ?? null,
        note: meta?.note ?? null,
        requestedUrl: meta?.url ?? null,
        finalUrl: meta?.url ?? null,
        fetchedAt: meta?.fetchedAt ? new Date(meta.fetchedAt) : null,
        createdAt,
        rawBytes: rawBytes ?? null,
        rawContentType: null,
        rawEncoding: null,
        extractedHtml: null,
        stampedHtml: stampedHtml ?? null,
        tree,
        arc: arc ?? null,
        tweets: tweets ?? null,
        glossary: glossary ?? null,
        summary: summaries ?? null,
        labels: labels ?? null,
        wordCount,
        blockCount: blocks.length,
        partCount,
        sectionCount,
        rootGist: rootGist ?? null,
      })
      .onConflictDoUpdate({
        target: articleRevisions.id,
        set: {
          tree,
          arc: arc ?? null,
          tweets: tweets ?? null,
          glossary: glossary ?? null,
          summary: summaries ?? null,
          labels: labels ?? null,
          stampedHtml: stampedHtml ?? null,
          // In the update branch too, or a re-import leaves the first run's
          // value behind and the library's order silently depends on which
          // import happened first.
          createdAt,
          wordCount,
          blockCount: blocks.length,
          partCount,
          sectionCount,
          rootGist: rootGist ?? null,
        },
      });

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

    // Comments anchor to the identity, so any block id they name has to exist
    // as an identity even if this revision no longer contains it. That is the
    // whole design: the paragraph can go, the question stays.
    if (storedComments.length) {
      const named = [...new Set(storedComments.map((c) => c.blockId))];
      await tx
        .insert(blockIdentities)
        .values(named.map((blockId) => ({ articleId, blockId })))
        .onConflictDoNothing();

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
    }

    /* Reader state. All three hang off the ARTICLE, never off the revision:
       a re-extraction must not delete a conversation, a saved search, or a
       looked-up term, for the same reason it must not delete a comment. */

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
            createdAt: new Date(message.createdAt),
          })
          .onConflictDoNothing();
      }
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

       Only no *new* row: unlike the reader-state tables above, these are not
       cleared first, so a step whose artefact has since been deleted keeps
       reporting itself done. GPT Sol found that in review, 2026-08-26. It is
       left alone because the pipeline is about to own this table for real
       (docs/plans/postgres-storage-implementation.md, "What is not done") and
       inferring rows from files is the temporary half. */
    const produced: { step: string; present: boolean }[] = [
      { step: "fetch", present: Boolean(rawBytes) },
      { step: "extract", present: Boolean(meta) },
      { step: "blocks", present: blocks.length > 0 },
      { step: "toc", present: Boolean(tree) },
      { step: "arc", present: Boolean(arc) },
      { step: "tweets", present: Boolean(tweets) },
      { step: "glossary", present: Boolean(glossary) },
      { step: "summary", present: Boolean(summaries) },
    ];
    for (const { step, present } of produced) {
      if (!present) continue;
      await tx
        .insert(revisionStepRuns)
        .values({
          revisionId,
          stepName: step,
          inputHash: fingerprint,
          implementationVersion: "imported",
          status: "done",
        })
        .onConflictDoNothing();
    }

    // The pointer moves LAST, so nothing observes a half-built revision. Not
    // deferrable and not needing to be: insert article, insert revision, update
    // pointer, and no intermediate state violates anything.
    await tx
      .update(articles)
      .set({ currentRevisionId: revisionId })
      .where(eq(articles.id, articleId));
  });

  logger.info(
    { slug, blocks: blocks.length, comments: storedComments.length, absent: absent.length },
    "article imported",
  );

  return {
    slug,
    articleId,
    revisionId,
    blocks: blocks.length,
    comments: storedComments.length,
    unanchoredComments: unanchored.map((c) => c.id),
    chatThreads: chat.length,
    chatMessages: chat.reduce((n, thread) => n + thread.messages.length, 0),
    searchRuns: runs.length,
    glossaryLookups: Object.keys(lookups).length,
    absent,
    unrecoverable: [...new Set(unrecoverable)],
  };
}

/** Every directory under `data/` that looks like an article. */
export async function importableSlugs(): Promise<string[]> {
  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(path.join(ROOT, "data"), { withFileTypes: true });
  const found: string[] = [];
  for (const entry of entries) {
    // `_`-prefixed directories are not articles — `data/_jobs/` is the queue's.
    if (!entry.isDirectory() || entry.name.startsWith("_")) continue;
    const blocks = await readMaybe(path.join(ROOT, "data", entry.name, "blocks.json"));
    const tree = await readMaybe(path.join(ROOT, "data", entry.name, "tree.json"));
    if (blocks && tree) found.push(entry.name);
  }
  return found;
}
