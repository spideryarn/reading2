/**
 * Put a reader's own state into Postgres for a fixture — **and nothing else.**
 *
 * ## Why this is separate from the loader, and must stay separate
 *
 * `tests/helpers/load-article.ts` drives the *real* write path: every byte it
 * moves goes through `ArtifactStore`, which is production's seam. That is what
 * makes a test built on it worth more than one built on `db:import`.
 *
 * `ArtifactStore` owns artefacts and deliberately owns nothing a reader made —
 * no comments, no chat, no searches, no glossary lookups, no shelf. So a suite
 * that compares the two stores' *library cards* needs that state put there some
 * other way, and this is the other way.
 *
 * **It is a seeder, not half an importer, and the difference is the name.**
 * `loadArticleIntoPg` must never call anything in this file. GPT Sol's ruling,
 * 2026-08-28: the moment a loader can also restore reader state, it is the
 * importer growing back one field at a time, and the honesty of "this went
 * through the production path" is gone.
 *
 * ## Why it writes columns rather than going through the live stores
 *
 * The first instinct — "restore it through `pgShelfStore` and `pgCommentStore`,
 * so even the seeding is production code" — is not achievable, and pretending
 * otherwise would produce a fixture that quietly held *different* state from
 * the one on disk:
 *
 * - `pgShelfStore.patch` (src/store/pg-shelf.ts) cannot set `opens` to a given
 *   number, cannot set `lastOpenedAt`, and archives with `now()`. The corpus has
 *   articles opened 874 times and archived last week.
 * - `pgCommentStore.create` (src/store/pg-comments.ts) makes a *current,
 *   unanswered* comment with today's timestamp. Half the corpus's comments are
 *   answered, and the shape of an answered one is what a parity test is for.
 *
 * So these write the rows directly, and say so. A seeder that is honest about
 * being a seeder is fine; a seeder wearing a store's clothes is not.
 *
 * ## Which root it reads, and why it cannot be told
 *
 * **This file names no directory, and that is the problem rather than the
 * solution.** Every read here goes through `loadShelf`, `loadComments`,
 * `loadThreads`, `loadRuns` and `loadLookups`, and each of those modules holds
 * its own root at module scope:
 *
 * ```
 * src/shelf.ts, src/comments.ts, src/chat.ts, src/searches.ts
 *   const ROOT = path.resolve(import.meta.dirname, "..");   // the repository
 * src/glossary-lookups.ts
 *   const ROOT = process.cwd();
 * ```
 *
 * None of them consults `SPIDERYARN_DATA_ROOT`, so **there is no way to point
 * this seeder at the committed corpus** the way `./load-article.ts` is now
 * pointed at it. Its companion takes a `root` and defaults to
 * `tests/fixtures/data-root/`; this one goes wherever those five constants say.
 *
 * That is survivable for the suites that *clone* a corpus slug under a scratch
 * `test-` name, because the clone is written into the repository root anyway
 * and both halves then agree — which is why `tests/chat-anchor.test.ts` and
 * `tests/helpers-seed-reader-state.test.ts` pass `root: ROOT` to the loader.
 * It is **not** survivable for `tests/store-parity.test.ts` and
 * `tests/store-roundtrip.test.ts`, which read corpus slugs where they lie:
 * artefacts from the corpus and reader state from a developer's `data/` would
 * be two different articles compared against each other. Both are therefore
 * still pinned to `data/`, and they are the two suites the corpus was most
 * meant to serve.
 *
 * The fix is five lines in `src/`, not here: those constants become
 * `dataRoot()` (src/store/data-root.ts), which is where the same bug in
 * src/store/artifacts-fs.ts and src/store/import.ts was already fixed — and
 * which would also close the deployment half of it, since two levels above a
 * bundled `api-dist/vercel.js` is `/var`. Out of scope for the sub-stage that
 * wrote this note (2026-09-01);
 * docs/plans/260901b-committed-fixture-corpus.md.
 */
import { eq } from "drizzle-orm";

import { loadThreads } from "../../src/chat.js";
import { loadComments } from "../../src/comments.js";
import { getDb } from "../../src/db/client.js";
import {
  articles,
  blockIdentities,
  chatMessages,
  chatThreads,
  comments as commentsTable,
  glossaryLookups,
  searchRuns,
} from "../../src/db/schema.js";
import { loadLookups } from "../../src/glossary-lookups.js";
import { isSpideryarnId } from "../../src/ids.js";
import { currentOwnerId } from "../../src/owner.js";
import { loadRuns } from "../../src/searches.js";
import { loadShelf } from "../../src/shelf.js";

/**
 * Find the article row for `slug`, or say which call was missing.
 *
 * Both seeders need an article that already exists, because reader state hangs
 * off one. Seeding before loading is the ordinary mistake and it would
 * otherwise surface as an empty update — a silent no-op, which is the failure
 * this repo keeps meeting (docs/reusable/silent-success.md).
 */
async function articleIdFor(slug: string): Promise<string> {
  const db = getDb();
  const [row] = await db
    .select({ id: articles.id })
    .from(articles)
    .where(eq(articles.slug, slug))
    .limit(1);
  if (!row) {
    throw new Error(
      `no article row for "${slug}": seed reader state AFTER loadArticleIntoPg, not before. ` +
        "Comments hang off an article and the shelf columns are on it.",
    );
  }
  return row.id;
}

/**
 * Copy `data/<slug>/shelf.json` onto the five shelf columns.
 *
 * All five are written every time, `null` included. An absent-key-means-leave-it
 * update would let a previous run's `archivedAt` survive a shelf file that no
 * longer has one, and the test would compare today's files against last week's
 * state — the exact failure mode the parity suite exists to rule out.
 *
 * Returns what it wrote, so a caller can assert the state is not all defaults.
 */
export async function seedShelfFromFiles(slug: string): Promise<{
  archivedAt: Date | null;
  titleOverride: string | null;
  opens: number;
  lastOpenedAt: Date | null;
  purpose: string | null;
}> {
  const articleId = await articleIdFor(slug);
  const shelf = await loadShelf(slug);
  const values = {
    archivedAt: shelf.archivedAt ? new Date(shelf.archivedAt) : null,
    titleOverride: shelf.title ?? null,
    opens: shelf.opens,
    lastOpenedAt: shelf.lastOpenedAt ? new Date(shelf.lastOpenedAt) : null,
    purpose: shelf.purpose ?? null,
  };
  await getDb().update(articles).set(values).where(eq(articles.id, articleId));
  return values;
}

/** What `seedCommentsFromFiles` did, in enough detail to assert on. */
export interface SeededComments {
  /** Rows actually inserted. */
  readonly inserted: number;
  /**
   * Ids dropped because the anchor is not a block id.
   *
   * `comments.json` has no format check and something once wrote a comment on
   * `data/writes` anchored to `zzzz00`; `block_identities` *does* have one, and
   * `comments_identity_fk` would refuse the insert. The importer skipped these
   * too, by the same rule — so the filesystem's comment count is legitimately
   * one higher, and a suite comparing counts has to subtract exactly this.
   */
  readonly unanchored: readonly string[];
}

/**
 * Copy `data/<slug>/comments.json` into the `comments` table.
 *
 * Every field, including the answer, the citations, the model and the
 * timestamps — because an answered comment is a shape the live store cannot
 * make and is precisely what a parity comparison should be looking at.
 *
 * **Replaces, rather than adding to.** The rows for this article are deleted
 * first, so running twice leaves what running once leaves. Scoped to the one
 * article by `article_id`.
 */
export async function seedCommentsFromFiles(slug: string): Promise<SeededComments> {
  const articleId = await articleIdFor(slug);
  const db = getDb();
  const ownerId = currentOwnerId();

  const all = await loadComments(slug);
  const unanchored = all.filter((c) => !isSpideryarnId(c.blockId));
  const anchored = all.filter((c) => isSpideryarnId(c.blockId));

  /* **Mint the identities first, exactly as `db:import` did.**
   *
     `comments_identity_fk` points at `block_identities`, and a comment may name
     a block the current revision no longer has — that is the whole design
     (docs/project/block-ids.md): the paragraph can go, the reader's mark stays.
     Writing the blocks mints identities for the blocks that are *in* this
     revision, which is not the same set.

     Without this the insert fails on the foreign key **after** the delete above
     has already run, so the article loses the comments it had and gains none.
     It passed anyway on this machine because identities are never deleted and
     every fixture's comments already had one from an earlier run — which is the
     same carry-forward that made the first parity sweep report a byte-identical
     article it could not have produced. GPT Sol, 2026-08-28. */
  if (anchored.length) {
    await db
      .insert(blockIdentities)
      .values([...new Set(anchored.map((c) => c.blockId))].map((blockId) => ({ articleId, blockId })))
      .onConflictDoNothing();
  }

  await db.delete(commentsTable).where(eq(commentsTable.articleId, articleId));

  if (anchored.length) {
    await db.insert(commentsTable).values(
      anchored.map((c) => ({
        articleId,
        id: c.id,
        ownerId,
        blockId: c.blockId,
        quote: c.quote,
        start: c.start,
        /* `?? null` on each of the optional ones: absent on disk and null in
           the column are the same fact, and leaving `undefined` here would let
           the column default decide instead of the file. */
        body: c.body ?? null,
        updatedAt: c.updatedAt === undefined ? null : new Date(c.updatedAt),
        threadId: c.threadId ?? null,
        status: c.status,
        answer: c.answer ?? null,
        citations: c.citations ?? null,
        searches: c.searches ?? null,
        model: c.model ?? null,
        error: c.error ?? null,
        createdAt: new Date(c.createdAt),
      })),
    );
  }

  return { inserted: anchored.length, unanchored: unanchored.map((c) => c.id) };
}

/**
 * Copy `data/<slug>/chat.json` into `chat_threads` and `chat_messages`.
 *
 * **The anchors mint identities first.** A thread anchored to a paragraph
 * points at `block_identities` through the same foreign key comments use, and
 * an anchor may name a block this revision no longer has — which is the whole
 * design (docs/project/block-ids.md): the paragraph can go, the conversation
 * stays. So the identity is minted whether or not the block is in the current
 * text, exactly as `db:import` did it.
 *
 * `ordinal` comes from the array index, not from `createdAt`: a user turn and
 * the pending assistant turn answering it are written together and collide
 * within the millisecond.
 */
export async function seedChatFromFiles(slug: string): Promise<{ threads: number; messages: number }> {
  const articleId = await articleIdFor(slug);
  const db = getDb();
  const ownerId = currentOwnerId();
  const threads = await loadThreads(slug);

  await db.delete(chatMessages).where(eq(chatMessages.articleId, articleId));
  await db.delete(chatThreads).where(eq(chatThreads.articleId, articleId));

  const anchors = [...new Set(threads.flatMap((t) => (t.anchor ? [t.anchor.blockId] : [])))];
  if (anchors.length) {
    await db
      .insert(blockIdentities)
      .values(anchors.map((blockId) => ({ articleId, blockId })))
      .onConflictDoNothing();
  }

  let messages = 0;
  for (const thread of threads) {
    await db.insert(chatThreads).values({
      articleId,
      id: thread.id,
      ownerId,
      title: thread.title,
      createdAt: new Date(thread.createdAt),
      updatedAt: new Date(thread.updatedAt),
      /* `"quote" in anchor` rather than `anchor.quote`: the union's block-only
         arm has no such property, so reading one off it is a type error rather
         than a silent undefined. */
      anchorBlockId: thread.anchor?.blockId ?? null,
      anchorQuote: thread.anchor && "quote" in thread.anchor ? thread.anchor.quote : null,
      anchorStart: thread.anchor && "start" in thread.anchor ? thread.anchor.start : null,
      /* A `chat.json` written before Remember mode has no `kind`, and the column
         is `not null`. `"chat"` is the default `normaliseKind` applies in
         src/chat.ts and the one the column declares. */
      kind: thread.kind === "remember" ? "remember" : "chat",
    });
    for (const [ordinal, message] of thread.messages.entries()) {
      await db.insert(chatMessages).values({
        articleId,
        threadId: thread.id,
        id: message.id,
        ordinal,
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
        /* Without this a restore drops the stance from every review answer and
           says nothing — the failure src/store/export.ts records beside its own
           copy of this field. */
        stance: message.stance ?? null,
        createdAt: new Date(message.createdAt),
      });
      messages += 1;
    }
  }
  return { threads: threads.length, messages };
}

/**
 * Copy `data/<slug>/searches.json` into `search_runs`.
 *
 * `sourceHash` and `colour` are carried deliberately. `isStale` reads an absent
 * hash as *out of date*, so dropping it would put the "answered against an
 * older version" banner on every saved search for ever; `colour` is the one
 * field on a run that neither the model nor the pipeline wrote.
 */
export async function seedSearchRunsFromFiles(slug: string): Promise<number> {
  const articleId = await articleIdFor(slug);
  const db = getDb();
  const ownerId = currentOwnerId();
  const runs = await loadRuns(slug);

  await db.delete(searchRuns).where(eq(searchRuns.articleId, articleId));
  for (const run of runs) {
    await db.insert(searchRuns).values({
      articleId,
      id: run.id,
      ownerId,
      criterion: run.criterion,
      status: run.status,
      hits: run.hits,
      sourceHash: run.sourceHash ?? null,
      colour: run.colour ?? null,
      model: run.model ?? null,
      error: run.error ?? null,
      createdAt: new Date(run.createdAt),
    });
  }
  return runs.length;
}

/** Copy `data/<slug>/glossary-lookups.json` into `glossary_lookups`. */
export async function seedGlossaryLookupsFromFiles(slug: string): Promise<number> {
  const articleId = await articleIdFor(slug);
  const db = getDb();
  const ownerId = currentOwnerId();
  const lookups = await loadLookups(slug);

  await db.delete(glossaryLookups).where(eq(glossaryLookups.articleId, articleId));
  const entries = Object.entries(lookups);
  for (const [entryId, lookup] of entries) {
    await db.insert(glossaryLookups).values({
      articleId,
      entryId,
      ownerId,
      answer: lookup.answer,
      citations: lookup.citations,
      searches: lookup.searches,
      model: lookup.model,
      at: new Date(lookup.at),
    });
  }
  return entries.length;
}

/**
 * All five, in the order the foreign keys want.
 *
 * **Chat before comments**, because `Comment.threadId` names a conversation and
 * an archive's comments can only be read against threads that are already in.
 * There is deliberately no foreign key on that column
 * (docs/plans/260828a-comments-and-bookmarks.md), so nothing *fails* if the order is
 * wrong — which is exactly why it is written down here rather than left to a
 * constraint to enforce. GPT Sol found the same two blocks the wrong way round
 * in `db:import`, 2026-08-28.
 *
 * For a suite whose subject is the *artefact* seam, call the individual ones —
 * seeding state a test does not look at makes it slower and no more honest.
 */
export async function seedReaderStateFromFiles(slug: string): Promise<void> {
  await seedShelfFromFiles(slug);
  await seedChatFromFiles(slug);
  await seedCommentsFromFiles(slug);
  await seedSearchRunsFromFiles(slug);
  await seedGlossaryLookupsFromFiles(slug);
}
