/**
 * **The reader's own tags on their articles** — the Postgres half.
 *
 * One table, `article_tags` (src/db/schema.ts), lowercase so a tag is its own
 * identity. The spelling rules are src/tags.ts; this file is ownership, the
 * cap, and the order of operations. Plan
 * docs/plans/261003d-your-own-tags-on-articles-on-the-shelf-and-the-metadata-page.md.
 *
 * Every read and write goes through the owned article (`ownedSlug`,
 * `ownedByReader`), because the table has no `owner_id` of its own: a tag is
 * the reader's because the article is.
 */

import { and, count, eq, inArray } from "drizzle-orm";

import { getDb } from "../db/client.js";
import { articles, articleTags } from "../db/schema.js";
import { normaliseTag, compareTags, TAGS_PER_ARTICLE, TAGS_PER_EDIT } from "../tags.js";
import { READ_COMMITTED } from "./isolation.js";
import { guardDbStore } from "./db-errors.js";
import { violatesCheckConstraint } from "./db-errors.js";
import { tagsForArticles } from "./tag-rows.js";
import { notFound, ownedByReader, ownedSlug, requireSlug } from "./pg.js";

/** What one edit asks for. Remove runs before add, so a body naming both is refused. */
export interface TagChange {
  add?: readonly string[];
  remove?: readonly string[];
}

/** One tag the reader uses, and on how many of their articles (archived included). */
export interface TagUse {
  tag: string;
  count: number;
}

function refuse(message: string): Error {
  return Object.assign(new Error(message), { status: 400 });
}

/** Keep a future JS/CHECK spelling mismatch a reader refusal, not a 500. */
export function rethrowTagWriteError(error: unknown): never {
  if (violatesCheckConstraint(error, "article_tags_spelling")) {
    throw refuse("That tag does not meet the spelling rules.");
  }
  throw error;
}

/**
 * The change, normalised and checked, **before** any database work — so an
 * oversized or contradictory body costs nothing and touches nothing.
 */
export function normaliseChange(change: TagChange): { add: string[]; remove: string[] } {
  const side = (raw: readonly string[] | undefined): string[] => {
    if (!raw) return [];
    if (raw.length > TAGS_PER_EDIT) throw refuse(`At most ${TAGS_PER_EDIT} tags in one edit.`);
    const out = new Set<string>();
    for (const r of raw) {
      const spelled = normaliseTag(r);
      if (!spelled.ok) throw refuse(spelled.reason);
      out.add(spelled.tag);
    }
    return [...out];
  };
  const add = side(change.add);
  const remove = side(change.remove);
  const both = add.find((t) => remove.includes(t));
  if (both !== undefined) throw refuse(`“${both}” is both added and removed.`);
  if (add.length === 0 && remove.length === 0) throw refuse("Nothing to change");
  return { add, remove };
}

const rawPgTagStore = {
  /**
   * Add and remove tags on one of the reader's articles; the tags after.
   *
   * **The article row is locked first.** It exists, so `for update` holds
   * (sql.md § `SELECT … FOR UPDATE` cannot lock a row that is not there is
   * about the opposite case), and that serialises every edit of one article's
   * tags — which is what makes the cap a fact: two edits each starting from 29
   * cannot both add one. The count is taken after the writes, inside the lock,
   * and a total past the cap rolls the whole edit back.
   */
  async edit(slug: string, change: TagChange): Promise<string[]> {
    requireSlug(slug);
    const { add, remove } = normaliseChange(change);
    return getDb().transaction(async (tx) => {
      const [article] = await tx
        .select({ id: articles.id })
        .from(articles)
        .where(ownedSlug(slug))
        .for("update")
        .limit(1);
      if (!article) throw notFound(slug);

      if (remove.length > 0) {
        await tx
          .delete(articleTags)
          .where(and(eq(articleTags.articleId, article.id), inArray(articleTags.tag, remove)));
      }
      if (add.length > 0) {
        try {
          await tx
            .insert(articleTags)
            .values(add.map((tag) => ({ articleId: article.id, tag })))
            .onConflictDoNothing({ target: [articleTags.articleId, articleTags.tag] });
        } catch (error) {
          rethrowTagWriteError(error);
        }
      }
      const rows = await tx
        .select({ tag: articleTags.tag })
        .from(articleTags)
        .where(eq(articleTags.articleId, article.id));
      if (rows.length > TAGS_PER_ARTICLE) {
        throw refuse(`An article can carry at most ${TAGS_PER_ARTICLE} tags.`);
      }
      return rows.map((r) => r.tag).sort(compareTags);
    }, READ_COMMITTED);
  },

  /** Every tag the reader uses, with how many of their articles carry it. */
  async readerTags(): Promise<TagUse[]> {
    const rows = await getDb()
      .select({ tag: articleTags.tag, count: count() })
      .from(articleTags)
      .innerJoin(articles, eq(articles.id, articleTags.articleId))
      .where(ownedByReader())
      .groupBy(articleTags.tag);
    return rows
      .map((r) => ({ tag: r.tag, count: Number(r.count) }))
      .sort((a, b) => compareTags(a.tag, b.tag));
  },

  /** The tags on one of the reader's articles, sorted. */
  async tagsFor(slug: string): Promise<string[]> {
    requireSlug(slug);
    const db = getDb();
    const [article] = await db
      .select({ id: articles.id })
      .from(articles)
      .where(ownedSlug(slug))
      .limit(1);
    if (!article) throw notFound(slug);
    return (await tagsForArticles(db, [article.id])).get(article.id) ?? [];
  },
};

/* Guarded at its export, as every Postgres store is (tests/store-guarded.test.ts). */
export const pgTagStore = guardDbStore("tags", rawPgTagStore);
