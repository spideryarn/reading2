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

import { and, asc, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";

import { describeArticle, titleFor } from "../api.js";
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
import {
  isStale as ideasAreStale,
  inputFingerprint as ideasFingerprint,
  PROMPT_VERSION as IDEAS_PROMPT_VERSION,
} from "../ideas.js";
import { isSlug } from "../ingest.js";
import { CAPABLE_MODEL } from "../models.js";
import { currentOwnerId } from "../owner.js";
import { STEP_ORDER, STEPS } from "../pipeline.js";
import { sanitizeStoredBlocks } from "../sanitize.js";
import { hashBlocks } from "../source-hash.js";
import { isStale as summariesStale } from "../summarise.js";
import { isStale as tweetsStale } from "../tweets.js";
import type {
  Arc,
  Article,
  ArticleMetadata,
  StageState,
  Block,
  Glossary,
  GlossaryFound,
  Ideas,
  IdeasFound,
  LibraryEntry,
  ListOptions,
  Meta,
  ShelfState,
  StepName,
  Summaries,
  SummariesFound,
  ThreadFound,
  Tree,
  TweetThread,
} from "../types.js";
import { sameStamp } from "./artifacts.js";
import type { ArticleReader } from "./contracts.js";
import { pgReaderStore } from "./pg-reader.js";

/** A 404 shaped exactly like src/api.ts's, so routes.ts cannot tell them apart. */
export function notFound(slug: string): Error {
  return Object.assign(new Error(`No article artefacts for "${slug}".`), { status: 404 });
}

/** A slug that is about to reach a query, or a 400 — the same guard src/api.ts keeps. */
export function requireSlug(slug: string): void {
  if (isSlug(slug)) return;
  throw Object.assign(new Error(`Not a slug: ${JSON.stringify(slug)}`), { status: 400 });
}

/**
 * The four shelf columns, as the shape `describeArticle` wants.
 *
 * Conditional spreads because `exactOptionalPropertyTypes` is on and Postgres
 * hands back `null` where the file simply had no key — the single biggest
 * source of near-miss parity failures in this store, per the file header.
 */
export function shelfFrom(article: typeof articles.$inferSelect): ShelfState {
  return {
    ...(article.archivedAt ? { archivedAt: article.archivedAt.toISOString() } : {}),
    ...(article.titleOverride ? { title: article.titleOverride } : {}),
    opens: article.opens,
    ...(article.lastOpenedAt ? { lastOpenedAt: article.lastOpenedAt.toISOString() } : {}),
    ...(article.purpose ? { purpose: article.purpose } : {}),
  };
}

/**
 * **The one way to name an article: by slug AND by owner.**
 *
 * `articles.slug` is globally unique, so `eq(articles.slug, slug)` on its own
 * finds *anybody's* article — which was fine for exactly as long as there was
 * one person. Since the gate started admitting real Supabase accounts
 * (src/auth.ts, 2026-08-27) it is the difference between a private shelf and a
 * shared one, and the failure is silent in the worst way: the query works, a
 * real article comes back, and it is somebody else's.
 *
 * A predicate rather than twelve hand-written `and(...)`s, for two reasons.
 * There were five near-identical `articleIdFor` helpers across the pg modules
 * and no way to tell by looking whether all five had been done. And
 * tests/owner-isolation.test.ts can now assert that **no file under src/store/
 * writes `eq(articles.slug, …)` outside this one** — so the thirteenth site,
 * written months from now by somebody who never read this comment, fails a test
 * instead of leaking a library.
 *
 * The 404 that follows a miss is the right answer as well as the convenient
 * one: "there is no such article" is all a stranger should learn about a slug
 * they do not own. A 403 would confirm it exists.
 */
export function ownedSlug(slug: string) {
  return and(eq(articles.slug, slug), eq(articles.ownerId, currentOwnerId()));
}

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * **Does this slug exist for anybody at all?** The one sanctioned unfiltered
 * lookup, and it lives here so that the guard above can have no exemptions.
 *
 * It is not a way to reach somebody else's article — it returns a boolean and
 * nothing else. It exists because `articles.slug` is globally unique, so
 * "`ownedSlug` found nothing" has two very different causes: there is no such
 * article, or there is one and it is not yours. `beginRevision` needs to tell
 * those apart, because the second one deserves a sentence saying so rather than
 * "could not create or lock the article row".
 *
 * If you are reaching for this to *read* something, you want `ownedSlug`.
 */
export async function slugIsTaken(slug: string, db: Db | Tx = getDb()): Promise<boolean> {
  const rows = await db
    .select({ id: articles.id })
    .from(articles)
    .where(eq(articles.slug, slug))
    .limit(1);
  return rows.length > 0;
}

/** Every article this reader owns — the `where` for a list rather than a lookup. */
export function ownedByReader() {
  return eq(articles.ownerId, currentOwnerId());
}

/** One article's current published revision, or undefined. */
async function currentRevision(slug: string) {
  const db = getDb();
  const rows = await db
    .select({ article: articles, revision: articleRevisions })
    .from(articles)
    .innerJoin(articleRevisions, eq(articleRevisions.id, articles.currentRevisionId))
    .where(ownedSlug(slug))
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

  const blocks = rows.map((row) => ({
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

  /* The same guard src/api.ts puts on the filesystem reader, because there are
     two `loadArticle`s and guarding one of them passes every test — the fs half
     is genuinely protected, the suite is green, and the store that is in the
     middle of *replacing* the filesystem serves old HTML unchecked.

     `undefined` for the stamp, deliberately, and not because nobody got round
     to it: there is no column to keep one in yet, and absent reads as stale,
     which cleans. That is the safe direction and the honest one — it costs a
     re-clean on every Postgres article load until the column exists, and the
     alternative is claiming a cleanliness nothing has checked.

     The column belongs on `article_revisions` rather than `revision_blocks`
     when it lands: a revision is exactly one blocks.json and one cleaning pass,
     so per-block would store the same integer several hundred times and invite
     a revision whose own blocks disagree about when they were cleaned. See
     docs/project/security.md § There are two stores. */
  return sanitizeStoredBlocks(blocks, undefined).blocks;
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
    /* PDF provenance. Null on every web page, so the spread pattern above is
       load-bearing here too: `source: null` in `meta.json` is not the same
       artefact as no `source` key, and the round-trip test compares them.
       docs/plans/pdf-ingestion.md. */
    ...(revision.source === null ? {} : { source: revision.source as "pdf" }),
    ...(revision.extractMethod === null ? {} : { method: revision.extractMethod }),
    ...(revision.pages === null ? {} : { pages: revision.pages }),
    ...(revision.rawSha256 === null ? {} : { rawSha256: revision.rawSha256 }),
    ...(revision.unverified === null ? {} : { unverified: revision.unverified }),
    ...(revision.recall === null ? {} : { recall: revision.recall }),
    ...(revision.pagesChecked === null ? {} : { pagesChecked: revision.pagesChecked }),
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
 *
 * **`Record<StepName, …>`, and no `?? []` at the lookup.** It was
 * `Record<string, …>` with a fallback, which made a step nobody had added here
 * come out as an empty list — a row on the metadata page saying the artefact is
 * stored nowhere, which reads like a finding rather than like the omission it
 * is. Exhaustive over `StepName` means adding a step to the pipeline fails the
 * typecheck here instead. Found in a review of the built seam, 2026-08-26.
 */
const STEP_STORAGE: Record<StepName, string[]> = {
  fetch: ["article_revisions.raw_bytes"],
  extract: ["article_revisions.title", "article_revisions.extracted_html"],
  blocks: ["revision_blocks", "block_identities"],
  toc: ["article_revisions.tree", "article_revisions.labels"],
  arc: ["article_revisions.arc"],
  tweets: ["article_revisions.tweets"],
  glossary: ["article_revisions.glossary"],
  summary: ["article_revisions.summary"],
  ideas: ["article_revisions.ideas"],
};

/**
 * What the library calls `addedAt`, as SQL.
 *
 * **`coalesce(fetched_at, articles.created_at)`, never `fetched_at` alone.** On
 * the filesystem `addedAt` is `meta.fetchedAt` where stage 2 recorded one and
 * the mtime of `blocks.json` otherwise, and src/store/import.ts seeds both
 * `created_at` columns from that same mtime so the two agree exactly.
 *
 * Ordering on `fetched_at` by itself puts every article that never got one at
 * the TOP, because Postgres sorts NULLs first under DESC. That is what this
 * query did, and the parity test passed anyway: the one article with a null
 * `fetched_at` happens to be the newest. Exported so the test can exercise the
 * real expression against data that is not lucky — asserting the property
 * against the articles we happen to have could not fail.
 *
 * ## The fallback is the ARTICLE's created_at, not the revision's
 *
 * It was the revision's, and that was safe only while no article had ever been
 * re-extracted. `beginRevision` (src/store/pg-revisions.ts) mints a fresh
 * `created_at` for every new revision — it has to, or the retention sweep would
 * judge a brand-new draft by its ancestor's age — so with the old fallback,
 * re-extracting an article whose `meta.json` never had a `fetchedAt` would jump
 * it to the top of the shelf. Nothing about that has a symptom: the shelf is
 * simply in a different order than it was, and both halves succeeded.
 *
 * "When was this added" is a fact about the article, and `articles.created_at`
 * is the column that already holds it. A review named the fix in these words;
 * the plan's original reasoning had it exactly backwards, blaming the *copy*
 * for a reordering that only minting can cause.
 */
export const ADDED_AT = sql`coalesce(${articleRevisions.fetchedAt}, ${articles.createdAt})`;

/**
 * Is the stored `ideas` artefact one we would write again today?
 *
 * **A function rather than a fifth arm of `isCurrent`**, and not only because
 * it took that switch past Biome's complexity ceiling: it is the only step
 * whose answer needs four values rather than three, so inlining it would have
 * made the longest arm of a switch the one carrying the exception.
 *
 * Without this the step fell through to `default: true` and **every completed
 * run reported itself current** — on the metadata page and in filesystem /
 * Postgres parity — while `loadIdeas` a few hundred lines below was correctly
 * calling the same artefact stale. Two answers to one question, and the
 * confident one was wrong. GPT Sol's review of the built code, 2026-08-27.
 */
function ideasAreCurrent(
  revision: { ideas: unknown; tree: unknown },
  blocks: readonly Block[],
): boolean {
  const found = revision.ideas as Ideas | null;
  const tree = revision.tree as Tree | null;
  if (!found || !tree || blocks.length === 0) return false;
  /* The blocks AND the tree — src/ideas.ts § `inputFingerprint`. This artefact
     is written from the skeleton as much as from the paragraphs, so a
     re-sectioned article is a different question even when every block is
     byte-identical. */
  const profile =
    found.profileHash !== undefined ? { profileHash: found.profileHash } : {};
  return sameStamp(
    {
      inputHash: found.sourceHash,
      promptVersion: found.version,
      model: found.generator,
      ...profile,
    },
    {
      inputHash: ideasFingerprint(blocks, tree),
      promptVersion: IDEAS_PROMPT_VERSION,
      model: CAPABLE_MODEL,
      /* The artefact's own value on both sides, deliberately. The profile the
         pipeline would stamp with today is resolved per job (src/jobs.ts) and
         this read has no access to it; a guess here would mark every profiled
         artefact stale on a page that only lists which stages have run. The
         reader is told about a changed profile by `loadIdeas`'s
         `profileChanged`, and whether to RE-RUN is decided by the stamp in
         src/pipeline.ts, which does know. */
      ...profile,
    },
  );
}

export const pgArticleReader: Pick<
  ArticleReader,
  | "loadArticle"
  | "listArticles"
  | "articleMetadata"
  | "loadTweets"
  | "loadGlossary"
  | "loadSummaries"
  | "loadIdeas"
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
      /* Through `titleFor`, so the reading view's masthead calls a renamed
         article what the shelf calls it. The filesystem store does the same at
         the same seam; a review found this applied to the card only. */
      meta: titleFor(metaFrom(slug, found.revision, blocks), shelfFrom(found.article)),
      blocks,
      tree: tree as Tree,
      ...(arc ? { arc: arc as Arc } : {}),
    };
  },

  async listArticles(opts: ListOptions = {}): Promise<LibraryEntry[]> {
    const db = getDb();
    const rows = await db
      .select({ article: articles, revision: articleRevisions })
      .from(articles)
      .innerJoin(articleRevisions, eq(articleRevisions.id, articles.currentRevisionId))
      /* `is null` / `is not null`, never `= null`. The archived half is asked
         for by name so that both halves come out of this one query and cannot
         disagree about what an article is — the same reason src/api.ts filters
         after its walk rather than skipping during it. */
      .where(
        and(
          /* **Yours, not everyone's.** Without this the shelf is the union of
             every account's, which is what it was until 2026-08-27 — see
             `ownedSlug` above for why that is worse than it sounds. */
          ownedByReader(),
          opts.archived ? isNotNull(articles.archivedAt) : isNull(articles.archivedAt),
          /* `_`-prefixed slugs are not articles, exactly as in src/api.ts:
             `data/_jobs/` is the ingest queue's directory, and the filesystem
             walk has always skipped the prefix. Postgres had no equivalent, so
             the two libraries disagreed about any slug starting with an
             underscore — invisible until a test fixture used one, and then
             visible only as tests/store-parity.test.ts failing in a full run
             and passing alone. Answering Sol's question 1: this is one of the
             things nothing was comparing.

             `left(slug, 1)` rather than `not like`, because `_` is LIKE's
             single-character wildcard: `not like '_%'` excludes every slug with
             at least one character, which is all of them. Written that way
             first, and the library came back empty. Escaping it works and reads
             like a typo. */
          sql`left(${articles.slug}, 1) <> '_'`,
        ),
      )
      .orderBy(desc(ADDED_AT));

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
          // The TypeScript half of `ADDED_AT`, and it has to agree with it —
          // one of them orders the list and the other prints the date on the
          // card, so a difference shows up as a card dated 2020 sitting at the
          // top of a list sorted by "newest first".
          addedAt: (row.revision.fetchedAt ?? row.article.createdAt).toISOString(),
          shelf: shelfFrom(row.article),
          /* `!= null` on a column we already selected, not four more queries.
             The filesystem store answers the same question with four `stat`s
             and neither of them parses the artefact — the tooltip asks whether
             a glossary exists, not how many terms are in it. */
          has: {
            arc: row.revision.arc != null,
            tweets: row.revision.tweets != null,
            glossary: row.revision.glossary != null,
            summary: row.revision.summary != null,
          },
        }),
      );
    }
    return entries;
  },

  /**
   * Which stages have run **and still describe this article**.
   *
   * `revision_step_runs` answers the first half: it exists precisely to say
   * "has this stage run", and reading it keeps the honest distinction the
   * filesystem loses, between a step that never ran and a step that ran and
   * produced nothing.
   *
   * ## Why the row saying `done` is not enough, and the bug that proves it
   *
   * This used to be `status === 'done'` and nothing else. The filesystem
   * computes *present **and** current* — `stepIsDone` in src/pipeline.ts is
   * `has()` plus a stamp comparison — and the two agreed only because no
   * revision had ever been superseded and the importer stamps every row `done`.
   *
   * Carry-forward is what makes them disagree, on its first day. A new draft
   * copies the previous revision's glossary **and its step-run row, with
   * `input_hash` unchanged**, which is exactly right: the row then says *the
   * glossary ran against hash X* while the blocks hash Y. On disk the reader is
   * offered "regenerate"; here they were shown a green tick over a glossary
   * describing text that has since changed. Note that the parity test cannot
   * catch this, for the same reason it cannot catch carry-forward at all —
   * there is no re-extraction in between.
   *
   * ## What "current" means per step, and the one half that is still missing
   *
   * `toc` is checked the way `publishRevision` checks it, so the metadata page
   * and the publication guard cannot disagree: the recorded `input_hash` must
   * equal `hashBlocks` of this revision's blocks.
   *
   * `tweets`, `glossary` and `summary` carry their own `sourceHash`, so they
   * are checked against the artefact itself rather than against the step row —
   * the artefact is what a reader would actually be served.
   *
   * **The prompt-version and model half of the comparison is only done for the
   * glossary**, and that is a known, narrow divergence rather than an oversight:
   * `src/tweets.ts` and `src/summarise.ts` keep their `PROMPT_VERSION` module
   * private, so nothing outside them can say what stamp they *would* write.
   * The fix is theirs and a review already named it — each stage exports an
   * `expectedStamp(blocks)` factory and keeps the constant private. Until then
   * a model change makes those two steps re-runnable on disk and still
   * green here.
   *
   * `fetch`, `extract`, `blocks` and `arc` have no currency rule in **either**
   * store — nothing they write records what it was made from — so they are the
   * step row alone, exactly as on the filesystem.
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
    const byStep = new Map(runs.map((r) => [r.stepName, r]));

    /* Read once, outside the loop: four of the eight checks need the blocks,
       and asking for a 360-row table four times to answer one page is the kind
       of thing that only shows up in production. */
    const blocks = await blocksFor(found.revision.id);
    const blocksHash = blocks.length ? hashBlocks(blocks) : null;
    const { revision } = found;

    /** Is this step's output one we would write again today? */
    const isCurrent = (step: StepName): boolean => {
      switch (step) {
        case "toc": {
          if (!revision.tree || !blocksHash) return false;
          return byStep.get("toc")?.inputHash === blocksHash;
        }
        case "tweets": {
          const thread = revision.tweets as TweetThread | null;
          return Boolean(thread && !tweetsStale(thread, blocks));
        }
        case "glossary": {
          const glossary = revision.glossary as Glossary | null;
          if (!glossary) return false;
          // The one of the three that can be checked in full, because its
          // prompt version is exported. `sameStamp` rather than three
          // comparisons written out again — one definition of "current".
          return sameStamp(
            {
              inputHash: glossary.sourceHash,
              promptVersion: glossary.version,
              model: glossary.generator,
            },
            {
              ...(blocksHash ? { inputHash: blocksHash } : {}),
              promptVersion: PROMPT_VERSION,
              model: CAPABLE_MODEL,
            },
          );
        }
        case "summary": {
          const summaries = revision.summary as Summaries | null;
          return Boolean(summaries && !summariesStale(summaries, blocks));
        }
        case "ideas":
          return ideasAreCurrent(revision, blocks);
        default:
          // fetch, extract, blocks, arc — nothing to compare, in either store.
          return true;
      }
    };

    const stages: StageState[] = STEP_ORDER.map((step) => {
      const run = byStep.get(step);
      return {
        step,
        label: STEPS[step].label,
        outputs: STEP_STORAGE[step],
        done: run?.status === "done" && isCurrent(step),
        /* `finished_at` ONLY, and never `started_at`.

           The first version fell back to `started_at` for a run that is going
           or died mid-way, which is what that column is for elsewhere
           (src/db/schema.ts). A cross-model review took it apart: `ranAt` has
           to mean the same thing in both stores or the one sentence the UI
           writes about it is false in one of them, and the filesystem's answer
           is an mtime — *when this stage last wrote something*. A run that
           started and died wrote nothing anybody should believe, and it is not
           `done` here either, so a timestamp against it would be the store
           answering a question the reader did not ask with the one they did.

           No `bytes`: there are no files here, and a row count or a jsonb
           length would be a different measurement wearing the same label. */
        ranAt: run?.finishedAt?.toISOString() ?? null,
        bytes: null,
      };
    });

    const commentRows = await db
      .select({ id: commentsTable.id })
      .from(commentsTable)
      .where(eq(commentsTable.articleId, found.article.id));

    /* `profile` and `purpose` for the same reason `comments` above is read
       here rather than from a second endpoint. `profile` is global
       (`reader_profiles`) and `purpose` is this article's own (`articles.
       purpose`, via `shelfFrom`) — docs/plans/reader-profile.md. */
    const profile = await pgReaderStore.readProfile();

    return {
      slug,
      // The filesystem reports a repo-relative directory; there isn't one.
      dir: `spideryarn.article_revisions/${found.revision.id}`,
      stages,
      comments: commentRows.length,
      profile,
      purpose: shelfFrom(found.article).purpose ?? null,
      /* Off the same `shelfFrom` as `purpose`, so the two stores answer this
         from the same derivation rather than from two readings of one column. */
      archivedAt: shelfFrom(found.article).archivedAt ?? null,
    };
  },

  async loadTweets(slug: string): Promise<ThreadFound> {
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

  async loadGlossary(slug: string): Promise<GlossaryFound> {
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

  async loadSummaries(slug: string): Promise<SummariesFound> {
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

  async loadIdeas(slug: string): Promise<IdeasFound> {
    requireSlug(slug);
    const found = await currentRevision(slug);
    if (!found) throw notFound(slug);

    const ideas = found.revision.ideas as Ideas | null;
    if (!ideas) {
      throw Object.assign(
        new Error(`No ideas for "${slug}" yet. Find them with \`npm run ideas -- ${slug}\`.`),
        { status: 404 },
      );
    }
    const blocks = await blocksFor(found.revision.id);
    /* **The tree as well as the blocks**, which is what makes this one line
       longer than its three neighbours. `ideas` is written from the skeleton as
       much as from the paragraphs (src/ideas.ts § `inputFingerprint`), so a
       re-sectioned article is a different question even when every block is
       byte-identical — and a blocks-only comparison here would report it
       current while the filesystem store reported it stale. Two stores
       disagreeing about staleness is precisely what the parity tests exist to
       catch, and precisely the kind of thing that looks fine until it doesn't. */
    const tree = found.revision.tree as Tree | null;
    return {
      ideas,
      stale: !tree || ideasAreStale(ideas, blocks, tree),
      outdated: ideas.version !== IDEAS_PROMPT_VERSION,
    };
  },
};
