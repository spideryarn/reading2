/**
 * The Postgres store. Same questions as src/store/fs.ts, same answers.
 *
 * "Same answers" is meant literally and is tested literally: tests/store-parity.test.ts
 * asks both stores for every article in `data/` and compares the **API-shaped**
 * result — the `Article` the client receives — not SQL rows. Comparing rows
 * passes while the thing the client gets has changed shape, which is the
 * failure this whole exercise exists to catch.
 *
 * ## Three things here are easy to get subtly wrong
 *
 * 1. **`exactOptionalPropertyTypes` is on.** An absent property and a property
 *    explicitly set to `undefined` are different types, and they serialise
 *    differently: `JSON.stringify({a: undefined})` is `{}`, but the property is
 *    there for `in` and for `Object.keys`. Postgres gives back `null` where the
 *    file had *nothing*, so every optional field is a conditional spread. This
 *    is the single biggest source of near-miss parity failures.
 * 2. **Errors carry a status.** `src/routes.ts` turns `status: 404` into a 404;
 *    an untagged throw becomes a 500. So "no such article" must be tagged here
 *    exactly as it is in src/api.ts, or a missing article starts reporting as a
 *    server fault.
 * 3. **Staleness is computed at read time, never stored.** A flag written when
 *    the artefact was generated is right up until the moment it matters.
 *
 * ## What is deliberately NOT here
 *
 * A fallback to the filesystem. Nothing in this file may catch an error and
 * call into src/store/fs.ts — see docs/plans/postgres-storage-implementation.md
 * § Rules. It would hide exactly the divergence the parity test is looking for.
 */

import { asc, desc, eq } from "drizzle-orm";

import { describeArticle } from "../api.js";
import { getDb } from "../db/client.js";
import {
  articleRevisions,
  articles,
  comments as commentsTable,
  glossaryLookups,
  revisionBlocks,
  revisionStepRuns,
} from "../db/schema.js";
import { isStale as glossaryIsStale, PROMPT_VERSION } from "../glossary.js";
import { isSlug } from "../ingest.js";
import { STEP_ORDER, STEPS } from "../pipeline.js";
import { isStale as summariesStale } from "../summarise.js";
import { isStale as tweetsStale } from "../tweets.js";
import type {
  Arc,
  Article,
  ArticleMetadata,
  StageState,
  Block,
  Glossary,
  GlossaryResponse,
  LibraryEntry,
  Meta,
  Summaries,
  SummariesResponse,
  ThreadResponse,
  Tree,
  TweetThread,
} from "../types.js";
import type { ArticleReader } from "./contracts.js";

/** A 404 shaped exactly like src/api.ts's, so routes.ts cannot tell them apart. */
function notFound(slug: string): Error {
  return Object.assign(new Error(`No article artefacts for "${slug}".`), { status: 404 });
}

/** A slug that is about to reach a query, or a 400 — the same guard src/api.ts keeps. */
function requireSlug(slug: string): void {
  if (isSlug(slug)) return;
  throw Object.assign(new Error(`Not a slug: ${JSON.stringify(slug)}`), { status: 400 });
}

/** One article's current published revision, or undefined. */
async function currentRevision(slug: string) {
  const db = getDb();
  const rows = await db
    .select({ article: articles, revision: articleRevisions })
    .from(articles)
    .innerJoin(articleRevisions, eq(articleRevisions.id, articles.currentRevisionId))
    .where(eq(articles.slug, slug))
    .limit(1);
  return rows[0];
}

/**
 * A revision's blocks, in document order.
 *
 * **`order by ordinal`, and nothing else.** Block ids are random and carry no
 * position, so if this clause is dropped the rows come back in whatever order
 * the planner likes — which for a small table is usually insertion order, so it
 * looks right in development and reorders the article in production. That is
 * why `ordinal` is written explicitly from the array index rather than inferred.
 */
async function blocksFor(revisionId: string): Promise<Block[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(revisionBlocks)
    .where(eq(revisionBlocks.revisionId, revisionId))
    .orderBy(asc(revisionBlocks.ordinal));

  return rows.map((row) => ({
    id: row.blockId,
    tag: row.tag,
    kind: row.kind as Block["kind"],
    // Conditional spreads throughout: the file simply had no `level` key, and
    // `level: undefined` is a different type under exactOptionalPropertyTypes.
    ...(row.level === null ? {} : { level: row.level }),
    text: row.text,
    words: row.words,
    html: row.html,
    gistable: row.gistable,
    ...(row.note === null ? {} : { note: row.note }),
  }));
}

/**
 * Rebuild `Meta` from the revision's columns.
 *
 * The fallback matters: `src/api.ts` invents a title from the article's own
 * first `h1` when `meta.json` is absent, and keeps the slug only as a last
 * resort. An imported article with no `meta.json` has `title` null, so without
 * the same fallback here the reading view would show a slug where the
 * filesystem showed a heading — a visible, silent divergence.
 */
function metaFrom(
  slug: string,
  revision: typeof articleRevisions.$inferSelect,
  blocks: Block[],
): Meta {
  const title =
    revision.title ??
    blocks.find((b) => b.kind === "heading" && b.level === 1)?.text ??
    slug;

  return {
    slug,
    title,
    ...(revision.byline === null ? {} : { byline: revision.byline }),
    ...(revision.siteName === null ? {} : { siteName: revision.siteName }),
    ...(revision.lang === null ? {} : { lang: revision.lang }),
    ...(revision.finalUrl === null ? {} : { url: revision.finalUrl }),
    ...(revision.fetchedAt === null ? {} : { fetchedAt: revision.fetchedAt.toISOString() }),
    ...(revision.excerpt === null ? {} : { excerpt: revision.excerpt }),
    ...(revision.note === null ? {} : { note: revision.note }),
  };
}

/**
 * Where each pipeline step's output lives once it is in Postgres.
 *
 * `StageState.outputs` is repo-relative file paths on the filesystem side. It
 * cannot be here, and pretending otherwise would be worse than the change: the
 * metadata page's job is to say where an artefact actually is, and after the
 * cutover the answer is a column, not a path. **This is a deliberate,
 * user-visible divergence between the two stores** — the one place the
 * migration does not preserve behaviour exactly — and it is listed as such in
 * docs/plans/postgres-storage-implementation.md rather than left for somebody
 * to find on the page.
 */
const STEP_STORAGE: Record<string, string[]> = {
  fetch: ["article_revisions.raw_bytes"],
  extract: ["article_revisions.title", "article_revisions.extracted_html"],
  blocks: ["revision_blocks", "block_identities"],
  toc: ["article_revisions.tree", "article_revisions.labels"],
  arc: ["article_revisions.arc"],
  tweets: ["article_revisions.tweets"],
  glossary: ["article_revisions.glossary"],
  summary: ["article_revisions.summary"],
};

export const pgArticleReader: Pick<
  ArticleReader,
  | "loadArticle"
  | "listArticles"
  | "articleMetadata"
  | "loadTweets"
  | "loadGlossary"
  | "loadSummaries"
> = {
  async loadArticle(slug: string): Promise<Article> {
    requireSlug(slug);
    const found = await currentRevision(slug);
    if (!found) throw notFound(slug);

    const blocks = await blocksFor(found.revision.id);
    const tree = found.revision.tree;
    // A revision with no tree is not a readable article — the same bar
    // src/api.ts sets by requiring both blocks.json and tree.json.
    if (!tree || !blocks.length) throw notFound(slug);

    const arc = found.revision.arc;
    return {
      meta: metaFrom(slug, found.revision, blocks),
      blocks,
      tree: tree as Tree,
      ...(arc ? { arc: arc as Arc } : {}),
    };
  },

  async listArticles(): Promise<LibraryEntry[]> {
    const db = getDb();
    const rows = await db
      .select({ article: articles, revision: articleRevisions })
      .from(articles)
      .innerJoin(articleRevisions, eq(articleRevisions.id, articles.currentRevisionId))
      .orderBy(desc(articleRevisions.fetchedAt));

    const entries: LibraryEntry[] = [];
    for (const row of rows) {
      const tree = row.revision.tree;
      if (!tree) continue;
      const blocks = await blocksFor(row.revision.id);
      if (!blocks.length) continue;

      const [{ count } = { count: 0 }] = await db
        .select({ count: commentsTable.id })
        .from(commentsTable)
        .where(eq(commentsTable.articleId, row.article.id))
        .then((rs) => [{ count: rs.length }]);

      /* `describeArticle` rather than a second derivation. It is already pure
         and already documented as staying put "when the reads move to SQL", so
         both stores compute a word count exactly one way. Two implementations
         of one derivation is the divergence this migration exists to prevent —
         and the stored `word_count` column is a cache of this, not a rival to it. */
      entries.push(
        describeArticle({
          slug: row.article.slug,
          meta: metaFrom(row.article.slug, row.revision, blocks),
          blocks,
          tree: tree as Tree,
          comments: count,
          addedAt: (row.revision.fetchedAt ?? row.revision.createdAt).toISOString(),
        }),
      );
    }
    return entries;
  },

  /**
   * Which stages have run.
   *
   * **`done` comes from `revision_step_runs`, not from a column being non-null.**
   * That table exists precisely to answer "has this stage run" — and reading it
   * keeps the honest distinction the filesystem loses, between a step that
   * never ran and a step that ran and produced nothing. `stepIsDone` on the
   * filesystem is an existence check, which is the bug the table was designed
   * not to inherit.
   */
  async articleMetadata(slug: string): Promise<ArticleMetadata> {
    requireSlug(slug);
    const found = await currentRevision(slug);
    if (!found) throw notFound(slug);

    const db = getDb();
    const runs = await db
      .select()
      .from(revisionStepRuns)
      .where(eq(revisionStepRuns.revisionId, found.revision.id));
    const doneSteps = new Set(runs.filter((r) => r.status === "done").map((r) => r.stepName));

    const stages: StageState[] = STEP_ORDER.map((step) => ({
      step,
      label: STEPS[step].label,
      outputs: STEP_STORAGE[step] ?? [],
      done: doneSteps.has(step),
    }));

    const commentRows = await db
      .select({ id: commentsTable.id })
      .from(commentsTable)
      .where(eq(commentsTable.articleId, found.article.id));

    return {
      slug,
      // The filesystem reports a repo-relative directory; there isn't one.
      dir: `spideryarn.article_revisions/${found.revision.id}`,
      stages,
      comments: commentRows.length,
    };
  },

  async loadTweets(slug: string): Promise<ThreadResponse> {
    requireSlug(slug);
    const found = await currentRevision(slug);
    if (!found) throw notFound(slug);

    const thread = found.revision.tweets as TweetThread | null;
    if (!thread) {
      throw Object.assign(
        new Error(`No thread for "${slug}" yet. Write one with \`npm run tweets -- ${slug}\`.`),
        { status: 404 },
      );
    }
    const blocks = await blocksFor(found.revision.id);
    return { thread, stale: tweetsStale(thread, blocks) };
  },

  async loadGlossary(slug: string): Promise<GlossaryResponse> {
    requireSlug(slug);
    const found = await currentRevision(slug);
    if (!found) throw notFound(slug);

    const glossary = found.revision.glossary as Glossary | null;
    if (!glossary) {
      throw Object.assign(
        new Error(`No glossary for "${slug}" yet. Write one with \`npm run glossary -- ${slug}\`.`),
        { status: 404 },
      );
    }
    const blocks = await blocksFor(found.revision.id);

    /* Lookups are attached HERE, at the read seam, exactly as src/api.ts does
       it — not stored on the entry. Forgetting this would not fail; it would
       quietly drop every "checked on the web" answer from the panel while the
       glossary itself looked perfectly correct. */
    const db = getDb();
    const stored = await db
      .select()
      .from(glossaryLookups)
      .where(eq(glossaryLookups.articleId, found.article.id));
    const byEntry = new Map(
      stored.map((row) => [
        row.entryId,
        {
          answer: row.answer,
          citations: row.citations,
          searches: row.searches,
          model: row.model,
          at: row.at.toISOString(),
        },
      ]),
    );
    const entries = glossary.entries.map((entry) => {
      const lookup = byEntry.get(entry.id);
      return lookup ? { ...entry, lookup } : entry;
    });

    return {
      glossary: { ...glossary, entries },
      stale: glossaryIsStale(glossary, blocks),
      /* A different fact from `stale`, and it needs its own field because it
         needs its own sentence: `stale` means the article moved underneath
         these terms; this means the article is the same and we would write them
         differently now. */
      outdated: glossary.version !== PROMPT_VERSION,
    };
  },

  async loadSummaries(slug: string): Promise<SummariesResponse> {
    requireSlug(slug);
    const found = await currentRevision(slug);
    if (!found) throw notFound(slug);

    const summaries = found.revision.summary as Summaries | null;
    if (!summaries) {
      throw Object.assign(
        new Error(
          `No summaries for "${slug}" yet. Write them with \`npm run summarise -- ${slug}\`.`,
        ),
        { status: 404 },
      );
    }
    const blocks = await blocksFor(found.revision.id);
    return { summaries, stale: summariesStale(summaries, blocks) };
  },
};
