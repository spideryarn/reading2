/**
 * **Rate how hard one article is to read** — the call the `extract` step will
 * make on import, run on its own against a slug.
 *
 *     npx tsx scripts/rate-reading-difficulty.ts <slug>                  # dry run: print the rating
 *     npx tsx scripts/rate-reading-difficulty.ts <slug> --owner <uuid>   # an article that is not the environment owner's
 *     npx tsx scripts/rate-reading-difficulty.ts <slug> --write          # not built yet
 *
 * Plan docs/plans/261005j-reading-time-knows-difficulty-a-model-rates-language-and-ideas-at-import.md
 * § Where the rating comes from. This is the backfill for articles imported
 * before the rating existed, one article at a time.
 *
 * **Read the `Target:` line.** The shell's `DATABASE_URL` wins over
 * `.env.local` (src/env.ts § `resolveTargetUrl`), and the line says which
 * database the article was actually read from.
 *
 * **What a dry run changes**: nothing about the article. It makes one paid
 * call (about a tenth of a cent) and records it in the spend ledger of the
 * target database, in `cli` scope so it is never counted as a reader's spend,
 * attributed to the article's owner and slug. A paid call with no ledger row
 * is money `npm run cost` cannot see (src/cli-ledger.ts).
 *
 * What it reads: the article's current blocks, body only
 * (`ratingParagraphs` in src/reading-difficulty.ts, which is `isBodyEvidence`
 * from src/block-policy.ts), so footnotes and a bibliography are not rated.
 */
import { isLocalDatabaseUrl, withoutPassword } from "../src/db/ssl.js";
import { loadEnvLocal, resolveTargetUrl } from "../src/env.js";
import { isUuid } from "../src/ids.js";
import type { OwnerId } from "../src/owner.js";

loadEnvLocal();
const url = resolveTargetUrl({ shellWins: true });
if (!url) {
  console.error("DATABASE_URL is not set. Local: npm run db:start. See docs/project/supabase-local.md.");
  process.exit(1);
}
/* getDb() reads process.env; make it the database the Target line names. */
process.env.DATABASE_URL = url;

const argv = process.argv.slice(2);
const ownerAt = argv.indexOf("--owner");
const ownerArg = ownerAt >= 0 ? argv[ownerAt + 1] : undefined;
const slug = argv.find((a, i) => !a.startsWith("--") && (ownerAt < 0 || i !== ownerAt + 1));
if (!slug || (ownerAt >= 0 && (!ownerArg || !isUuid(ownerArg)))) {
  console.error("Usage: npx tsx scripts/rate-reading-difficulty.ts <slug> [--owner <uuid>] [--write]");
  process.exit(1);
}

/* Imported after the URL is settled, so nothing can open a pool on the other one. */
const { sql } = await import("drizzle-orm");
const { collectSpend, formatNanos, totalSpend } = await import("../src/ai-spend.js");
const { closeDb, getDb } = await import("../src/db/client.js");
const { environmentOwnerId, runAsOwner } = await import("../src/owner.js");
const { rateReadingDifficulty, ratingParagraphs, sampleForRating } = await import("../src/reading-difficulty.js");
const { costStore } = await import("../src/store/ai-calls.js");
const { currentShelfRevisions, readRevisionBlocks } = await import("../src/store/pg-shelf-terms.js");

const wordsIn = (text: string) => text.split(/\s+/).filter(Boolean).length;

async function main(articleSlug: string): Promise<number> {
  const where = await getDb().execute(sql`select current_database() as db`);
  const db = (where.rows[0] as { db?: string } | undefined)?.db;
  console.log(
    `Target: ${withoutPassword(url ?? "") ?? "(a DATABASE_URL that is not a parsable URL)"}  ` +
      `(database=${db}, ${isLocalDatabaseUrl(url ?? "") ? "local" : "REMOTE"})`,
  );

  if (argv.includes("--write")) {
    /* Before anything is read or bought: storing a rating is the next stage's
       work, and a `--write` that rated and then stored nothing would look like
       a backfill that ran. */
    console.error("--write: not built yet. Nothing was read, bought or stored.");
    return 2;
  }
  /* A dry run still writes: the call's row in the cost ledger. On a laptop
     that is nothing; on the remote it is a write to production that nobody
     asked for, made by a command that says it changes nothing. */
  if (!isLocalDatabaseUrl(url ?? "")) {
    console.error(
      "This is not a local database, and even a dry run writes one cost-ledger row. Nothing was read, bought or stored.",
    );
    return 2;
  }
  console.log("Mode: dry run (the article is not changed; one ledger row is written for the call)");

  const owner = (ownerArg ?? environmentOwnerId()) as OwnerId;
  return await runAsOwner(owner, async () => {
    /* The shelf's narrow readers, as scripts/shelf-terms-report.ts uses: the
       current revision's block text and its own title, and nothing else. */
    const entry = (await currentShelfRevisions({ archived: true })).find((e) => e.slug === articleSlug);
    if (!entry) {
      console.error(`No article ${articleSlug} with a readable current revision for owner ${owner}.`);
      return 1;
    }
    const paragraphs = ratingParagraphs(await readRevisionBlocks(entry));
    const words = paragraphs.reduce((n, p) => n + wordsIn(p), 0);
    const sampled = wordsIn(sampleForRating(paragraphs).replaceAll("[…]", ""));
    console.log(`Article: ${articleSlug}   owner ${owner}`);
    console.log(`Body: ${paragraphs.length} paragraphs, ${words.toLocaleString("en-GB")} words; the sample is ${sampled.toLocaleString("en-GB")} words`);

    const { result, report } = await collectSpend(
      () => rateReadingDifficulty(paragraphs, { ...(entry.title ? { title: entry.title } : {}) }),
      {
        attribution: { scopeKind: "cli", ownerId: owner, articleSlug },
        sink: (row) => costStore.record(row),
      },
    );
    if (result.kind === "rated") {
      console.log(`\nLanguage: ${result.language} of 5\nIdeas:    ${result.ideas} of 5\nReason:   ${result.reason}\nModel:    ${result.model}`);
    } else {
      console.log(`\nUnrated: ${result.why}`);
    }
    const { nanos, unpriced } = totalSpend(report.calls);
    console.log(
      `\nSpent: ${formatNanos(nanos)} over ${report.calls.length} model call(s)` +
        (unpriced > 0 ? ` — ${unpriced} reported no cost` : "") +
        (report.writeFailures > 0 ? ` — ${report.writeFailures} could not be written down` : "") +
        `\n       recorded in ${costStore.describe()}`,
    );
    return result.kind === "rated" ? 0 : 1;
  });
}

let code = 1;
try {
  code = await main(slug);
} finally {
  await closeDb();
}
process.exit(code);
