/**
 * **Write the shelf pie's cached denominator for every article already read**
 * — plan docs/plans/261025l-shelf-cards-show-the-how-much-read-pie.md.
 *
 * The cache (`read_so_far_words`) is written by the reading-time flush, so an
 * article read before that shipped has no row, and its card no pie, until its
 * owner reads it for another minute. This fills those rows in, through the very
 * function the flush calls (`refreshShelfWords`), run as each article's owner,
 * so a backfilled row and a flushed one cannot differ. Rerunnable: a fresh row
 * is skipped by its basis.
 *
 *   npx tsx scripts/read-so-far-backfill.ts            # local, dry run
 *   npx tsx scripts/read-so-far-backfill.ts --write    # local, writes
 *   npx tsx scripts/read-so-far-backfill.ts --prod     # production, dry run
 *   npx tsx scripts/read-so-far-backfill.ts --prod --write
 *
 * It writes only this cache: additive, derived from what is stored, and
 * deleted with its article. It prints counts, never a slug, an owner or a
 * figure: which articles somebody has read is theirs (privacy.md § Reading time).
 */
import { and, eq, exists, isNotNull, ne, or, isNull, sql } from "drizzle-orm";

import { getDb } from "../src/db/client.js";
import { articleRevisions, articles, readSoFarWords, readingTime } from "../src/db/schema.js";
import { isLocalDatabaseUrl, withoutPassword } from "../src/db/ssl.js";
import { loadEnvLocal, readEnvProd } from "../src/env.js";
import { isMain } from "../src/is-main.js";
import { type OwnerId, runAsOwner } from "../src/owner.js";
import { pgReadingTimeStore } from "../src/store/pg-reading-time.js";
import { readSoFarBasis } from "../src/store/read-so-far-basis.js";

/** The articles with reading time whose cached row is missing or stale, as slug and owner. */
export async function staleReadSoFar(): Promise<{ slug: string; ownerId: string }[]> {
  return getDb()
    .select({ slug: articles.slug, ownerId: articles.ownerId })
    .from(articles)
    .innerJoin(articleRevisions, eq(articleRevisions.id, articles.currentRevisionId))
    .leftJoin(readSoFarWords, eq(readSoFarWords.articleId, articles.id))
    .where(
      and(
        isNotNull(articles.currentRevisionId),
        ne(articles.processing, "minimal"),
        exists(getDb().select({ one: sql`1` }).from(readingTime).where(eq(readingTime.articleId, articles.id))),
        or(isNull(readSoFarWords.basis), ne(readSoFarWords.basis, readSoFarBasis())),
      ),
    )
    .orderBy(articles.id);
}

export async function backfill(write: boolean): Promise<Record<"stale" | "written" | "fresh" | "raced" | "failed", number>> {
  const stale = await staleReadSoFar();
  const counts = { stale: stale.length, written: 0, fresh: 0, raced: 0, failed: 0 };
  if (!write) return counts;
  for (const { slug, ownerId } of stale) {
    try {
      counts[await runAsOwner(ownerId as OwnerId, () => pgReadingTimeStore.refreshShelfWords(slug))]++;
    } catch {
      counts.failed++;
    }
  }
  return counts;
}

async function main(argv: readonly string[]): Promise<number> {
  const write = argv.includes("--write");
  const prod = argv.includes("--prod");
  /* Loaded first, then overridden: `.env.local` beats the shell
     (src/env.ts), so production has to be set after it, explicitly. */
  loadEnvLocal();
  if (prod) {
    const env = readEnvProd();
    if (!env?.values.DATABASE_URL) {
      console.error("No DATABASE_URL in .env.prod.");
      return 2;
    }
    process.env.DATABASE_URL = env.values.DATABASE_URL;
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set. Local: npm run db:start. See docs/project/supabase-local.md.");
    return 2;
  }
  console.log(`Target: ${withoutPassword(url) ?? "(a DATABASE_URL that is not a parsable URL)"}`);
  console.log(`        ${isLocalDatabaseUrl(url) ? "local" : "REMOTE — PRODUCTION"}`);
  console.log(write ? "Mode: --write" : "Mode: dry run (nothing is written; --write to apply)");
  const c = await backfill(write);
  console.log(`articles read with no fresh cached row: ${c.stale}`);
  if (write) console.log(`written ${c.written} · already fresh ${c.fresh} · raced ${c.raced} · failed ${c.failed}`);
  return c.failed > 0 ? 1 : 0;
}

if (isMain(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err: unknown) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(2);
    },
  );
}
