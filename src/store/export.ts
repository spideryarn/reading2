/**
 * Write Postgres back out as `data/<slug>/`. **This is the rollback.**
 *
 *     npm run db:export -- --out /tmp/rollback     # somewhere safe
 *     npm run db:export -- --out data              # over the real thing
 *
 * The importer is only half a door. Until this exists, moving to Postgres is a
 * decision nobody can undo — and docs/plans/postgres-migration.md § The order of
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
 * `raw.html` is written from `raw_bytes`, which for imported articles is the
 * UTF-8 re-encoding the filesystem already held rather than the original
 * response bytes — see src/store/import.ts. So a round trip through Postgres is
 * faithful to `data/`, not to the web page. Nothing here can fix that; the
 * bytes were thrown away by stage 1 long before this existed.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { and, asc, eq } from "drizzle-orm";

import { getDb } from "../db/client.js";
import {
  articleRevisions,
  articles,
  chatMessages,
  chatThreads,
  comments as commentsTable,
  glossaryLookups,
  revisionBlocks,
  searchRuns,
} from "../db/schema.js";
import { blocksArtefact } from "../blocks.js";
import { ownedByReader, ownedSlug } from "./pg.js";
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
 * Export one article into `<outRoot>/<slug>/`.
 *
 * Only the CURRENT revision. Older revisions are history, and a rollback wants
 * the article as it is being served, not an archive — see open question 4 in
 * docs/plans/postgres-migration.md about how many revisions to keep.
 */
export async function exportArticle(slug: string, target: ExportTarget): Promise<ExportResult> {
  const db = getDb();
  const rows = await db
    .select({ article: articles, revision: articleRevisions })
    .from(articles)
    .innerJoin(articleRevisions, eq(articleRevisions.id, articles.currentRevisionId))
    .where(ownedSlug(slug))
    .limit(1);

  const found = rows[0];
  if (!found) throw new Error(`${slug}: no article with a current revision in Postgres`);
  const { article, revision } = found;

  const dir = path.join(target.dataRoot, slug);
  await mkdir(dir, { recursive: true });
  const written: string[] = [];
  const put = async (name: string, value: unknown) => {
    await writeJson(path.join(dir, name), value);
    written.push(name);
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
    note: revision.note,
    source: revision.source,
    method: revision.extractMethod,
    pages: revision.pages,
    rawSha256: revision.rawSha256,
    unverified: revision.unverified,
    recall: revision.recall,
    pagesChecked: revision.pagesChecked,
  });
  if (revision.title) await put("meta.json", meta);

  /* blocks.json — `order by ordinal`, which is the whole ballgame. Ids are
     random and carry no position, so a missing ORDER BY here silently exports
     a shuffled article that still validates. */
  const blockRows = await db
    .select()
    .from(revisionBlocks)
    .where(eq(revisionBlocks.revisionId, revision.id))
    .orderBy(revisionBlocks.ordinal);

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
  }));
  /* `blocksArtefact`, for the same reason src/toc.ts uses it: the export is a
     rollback, and a rollback that writes artefacts the pipeline would not have
     written is not one. Without the stamp every exported article reads back
     stale. */
  if (blocks.length) await put("blocks.json", blocksArtefact(blocks));

  if (revision.tree) await put("tree.json", revision.tree);
  if (revision.arc) await put("arc.json", revision.arc);
  if (revision.tweets) await put("tweets.json", revision.tweets);
  if (revision.glossary) await put("glossary.json", revision.glossary);
  if (revision.summary) await put("summary.json", revision.summary);
  if (revision.ideas) await put("ideas.json", revision.ideas);
  if (revision.labels) await put("labels.json", revision.labels);

  if (revision.rawBytes) {
    await writeFile(path.join(dir, "raw.html"), revision.rawBytes);
    written.push("raw.html");
  }
  if (revision.stampedHtml) {
    /* stage 3's artefact lives in `output/`, not in `data/` — see
       docs/plans/postgres-migration.md § Stage 3 recovers ids from output/.
       Exporting it beside the article would put it somewhere nothing reads, and
       the next `npm run blocks` would re-mint every id. */
    await mkdir(target.outputRoot, { recursive: true });
    await writeFile(path.join(target.outputRoot, `${slug}.html`), revision.stampedHtml, "utf8");
    written.push(path.join(target.outputRoot, `${slug}.html`));
  }

  /* shelf.json — what the reader did to the card, from the four columns on
     `articles` rather than on the revision. Written only when there is
     something to say: an untouched article has no shelf file, and inventing an
     empty one would mean every round trip added a file the app never wrote —
     which the round-trip test checks for, and rightly. */
  const shelf = compact({
    archivedAt: article.archivedAt?.toISOString() ?? null,
    title: article.titleOverride,
    // Not `compact`ed away: zero is a real answer to "how many times", and a
    // shelf file that omits it would read back as `undefined` where the
    // filesystem store writes `0`.
    opens: article.opens,
    lastOpenedAt: article.lastOpenedAt?.toISOString() ?? null,
  });
  if (article.archivedAt || article.titleOverride || article.opens > 0) {
    await put("shelf.json", shelf);
  }

  /* Reader state. Each file wraps its payload in a single-key object, and
     getting that wrapper wrong is what made the importer lose 17 KB of
     comments while reporting success. Same shapes, written back the same way.

     `shelf.json` above is the one that does NOT wrap — it is the state itself,
     not a list of anything, and src/shelf.ts reads it that way. */
  /* **Every list here is ordered explicitly, and none of them was.**

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
  const commentRows = await db
    .select()
    .from(commentsTable)
    .where(eq(commentsTable.articleId, article.id))
    .orderBy(asc(commentsTable.createdAt), asc(commentsTable.id));
  if (commentRows.length) {
    const comments: Comment[] = commentRows.map((row) =>
      compact({
        id: row.id,
        blockId: row.blockId,
        quote: row.quote,
        start: row.start,
        createdAt: row.createdAt.toISOString(),
        status: row.status,
        answer: row.answer,
        citations: row.citations,
        searches: row.searches,
        model: row.model,
        error: row.error,
      }) as Comment,
    );
    await put("comments.json", { comments });
  }

  const threadRows = await db
    .select()
    .from(chatThreads)
    .where(eq(chatThreads.articleId, article.id))
    .orderBy(asc(chatThreads.createdAt), asc(chatThreads.id));
  if (threadRows.length) {
    const threads = [];
    for (const thread of threadRows) {
      /* `article_id` AND `thread_id`, never `thread_id` alone. A thread id is
         unique only within its article — `chat_threads`'s primary key is
         `(article_id, id)`, the same rule as block ids — so two articles can
         hold a thread called `thr-1`, and filtering on the id by itself would
         write both articles' messages into one article's rollback file. That is
         one reader's private conversation appearing under someone else's
         article, and the round-trip test would not have noticed: it exports one
         article at a time. */
      const messageRows = await db
        .select()
        .from(chatMessages)
        .where(and(eq(chatMessages.articleId, article.id), eq(chatMessages.threadId, thread.id)))
        .orderBy(chatMessages.ordinal);
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
            editedAt: row.editedAt?.toISOString() ?? null,
          }) as ChatMessage,
        ),
      });
    }
    await put("chat.json", { threads });
  }

  const runRows = await db
    .select()
    .from(searchRuns)
    .where(eq(searchRuns.articleId, article.id))
    .orderBy(asc(searchRuns.createdAt), asc(searchRuns.id));
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
      }) as SearchRun,
    );
    await put("searches.json", { runs });
  }

  const lookupRows = await db
    .select()
    .from(glossaryLookups)
    .where(eq(glossaryLookups.articleId, article.id))
    .orderBy(asc(glossaryLookups.entryId));
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
    await put("glossary-lookups.json", { lookups });
  }

  logger.info({ slug, files: written.length }, "article exported");
  return { slug, files: written };
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
