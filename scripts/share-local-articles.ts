/**
 * **Make a few local articles public, the way the app would.**
 *
 *     npx tsx scripts/share-local-articles.ts <slug>…
 *     npx tsx scripts/share-local-articles.ts --private <slug>…
 *
 * There is nothing to develop `/read/public` against otherwise: a fresh local
 * database has **zero** public articles, and a listing with nothing in it looks
 * exactly like a listing that is broken.
 * docs/plans/260904b-pricing-page-and-public-showcase.md § Stage 3a.
 *
 * ## Why this is not a `psql` one-liner
 *
 * `update articles set visibility = 'public'` would produce a row the reader
 * cannot tell from a shared one and the *rest of the system* can:
 * `pgVisibilityStore.set` also stamps `public_at` — which the listing orders by
 * — and appends the `article_visibility_changes` row that records who shared it
 * and whether they confirmed the rights. A fixture built the other way is a
 * fixture that exercises an ordering against a column production fills in and
 * this one does not, and it leaves the audit table saying nobody ever shared
 * anything. Greg's own showcase flip is being done in the production UI for the
 * same reason (stage 4 of the plan).
 *
 * So this script is four lines around the one store method, and the store
 * method is the same one `PUT /api/article/:slug/visibility` calls.
 *
 * ## Local only, and it checks rather than trusts
 *
 * It **writes**, and what it writes is a public/private decision about somebody
 * else's reading. Pointed at production it would share real articles with no
 * human in the loop, which is not a thing a script gets to do — so it refuses
 * any `DATABASE_URL` that is not on this machine. `isLocalDatabaseUrl`
 * (src/db/ssl.ts) is the check, and it is the one that already knows about the
 * two ways a URL can *look* local and not be.
 *
 * ## Whose articles
 *
 * `pgVisibilityStore` resolves the slug through `ownedSlug`, so it can only
 * touch articles belonging to the owner in scope — the environment's
 * `SPIDERYARN_OWNER_ID`. A slug somebody else owns is a 404 here exactly as it
 * is over HTTP.
 */

import { isLocalDatabaseUrl } from "../src/db/ssl.js";
import { closeDb } from "../src/db/client.js";
import { loadEnvLocal } from "../src/env.js";
import { currentOwnerId, runInRequest, setRequestOwner, type OwnerId } from "../src/owner.js";
import { pgVisibilityStore } from "../src/store/pg-visibility.js";

loadEnvLocal();

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const to = args.includes("--private") ? "private" : "public";
  const slugs = args.filter((a) => !a.startsWith("--"));

  if (slugs.length === 0) {
    console.log("Usage: npx tsx scripts/share-local-articles.ts [--private] <slug>…");
    process.exitCode = 2;
    return;
  }

  const url = process.env.DATABASE_URL ?? "";
  if (!isLocalDatabaseUrl(url)) {
    /* The URL itself is never printed: it carries a password. */
    console.error(
      "Refusing to run: DATABASE_URL is not a local database. This script changes who can " +
        "read an article, and that decision belongs to the person who owns it.",
    );
    process.exitCode = 1;
    return;
  }
  /* Inside a request scope, because `pgVisibilityStore` writes the actor's owner
     id into the audit row and `currentOwnerId()` throws inside a scope nobody
     has filled. Read outside, where it still answers from the environment. */
  const owner = currentOwnerId() as OwnerId;
  for (const slug of slugs) {
    const state = await runInRequest(async () => {
      setRequestOwner(owner);
      return pgVisibilityStore.set(slug, to, to === "public");
    });
    console.log(`${slug}: ${state.visibility}${state.publicAt ? ` since ${state.publicAt}` : ""}`);
  }

  await closeDb();
}

await main();
