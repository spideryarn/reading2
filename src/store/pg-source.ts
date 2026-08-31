/**
 * **The reader's own file, out of Postgres** — the other half of
 * `GET /api/source/:slug`.
 *
 * The row does not hold the document. It holds a **reference** to it:
 * `raw_source_sha256` plus `raw_source_kind`, which name a content-addressed
 * object in the `sources` bucket (`canonicalKey` in src/source.ts). So this is
 * two reads — one small `SELECT`, then one object — and the second one only
 * happens for an article that really is a PDF.
 *
 * ## Why the route needed this at all
 *
 * `sendSource` used to call `fsLocations(slug)` and read `data/<slug>/raw.pdf`
 * unconditionally, whatever `SPIDERYARN_STORE` said. It was the last
 * unconditional filesystem read in src/routes.ts, and it failed two ways at
 * once: under `postgres` it answered *"that article did not come from a PDF"*
 * about an article whose PDF is sitting in the bucket, and on a deployment it
 * was the **jobless caller of `dataRoot()`** that
 * [data-root.ts](data-root.ts) § *Deployed with no job is an error,
 * deliberately* names by route. docs/plans/finish-the-database-move.md, stage 1.
 *
 * ## Two eras, and both are served
 *
 * Before docs/plans/delete-the-importer.md § C6 the payload was
 * `article_revisions.raw_bytes`, a `bytea` up to 32 MiB, and there was nothing
 * pointing out of the row. **Every article the importer has ever written is
 * one of those** — src/store/import.ts writes `raw_bytes` and no
 * `raw_source_sha256` — so a reader that understood only references would 404
 * the whole local corpus while reporting nothing wrong.
 *
 * The column is dropped in stage 5 of that plan, and the second query below
 * goes with it. It is a *second* query, guarded by `source = 'pdf'`, precisely
 * so that the ordinary path never selects a 32 MiB column it is not going to
 * use — which is the entire reason the reference exists.
 *
 * ## Why a dangling reference throws
 *
 * Same rule, and the same sentence, as `readRawDocument` in
 * [export.ts](export.ts): *"a dangling reference and an article with no source
 * document are different facts, and the whole point of the reference is that
 * the row asserts the object exists."* Answering `null` would tell the one
 * reader who is looking at a scan that there is no scan
 * (docs/reusable/silent-success.md).
 */

import { createHash } from "node:crypto";

import { eq } from "drizzle-orm";

import { getDb } from "../db/client.js";
import { articleRevisions, articles } from "../db/schema.js";
import { canonicalKey } from "../source.js";
import { postgresBlobStore, type RawSourceStore } from "./blobs.js";
import type { SourceStore } from "./contracts.js";
import { ownedSlug } from "./owned-slug.js";

/**
 * The reference and the two facts needed to decide whether to follow it —
 * **and nothing wide**.
 *
 * Taking its builder like `currentRevisionQuery` and `lockedArticleQuery` do,
 * so a test can read the SQL this sends rather than a constant beside it. The
 * clause that matters is `ownedSlug`: `articles.slug` is globally unique, so an
 * unfiltered lookup would hand a stranger somebody else's paper, and
 * tests/owner-isolation.test.ts greps this whole directory to make sure nobody
 * writes the unfiltered spelling.
 *
 * `innerJoin` on `current_revision_id`, so an article whose ingest has never
 * published finds no row — which is `null`, the same answer as no article.
 */
export function sourceReferenceQuery(
  db: Pick<ReturnType<typeof getDb>, "select">,
  slug: string,
) {
  return db
    .select({
      revisionId: articleRevisions.id,
      source: articleRevisions.source,
      rawSourceSha256: articleRevisions.rawSourceSha256,
      rawSourceKind: articleRevisions.rawSourceKind,
    })
    .from(articles)
    .innerJoin(articleRevisions, eq(articleRevisions.id, articles.currentRevisionId))
    .where(ownedSlug(slug))
    .limit(1);
}

/**
 * The bucket said something a reader cannot be given.
 *
 * **`status: 500`, and that number is load-bearing rather than decorative**:
 * `guardDbStore` (db-errors.ts) replaces every error that is not on its
 * allowlist with *"this app asked its database for something it would not do"*,
 * and the allowlist's last clause is *has a numeric `status`*. Without it the
 * one sentence naming the key — the only thing anybody can act on — is scrubbed
 * on the way out of a store that never touched the database for it.
 */
function unusableObject(slug: string, key: string, why: string): Error {
  return Object.assign(
    new Error(
      `"${slug}" points at the object "${key}", and ${why}. The row asserts that object ` +
        "exists, so this is a fault rather than an article without a source document. " +
        "See src/store/pg-source.ts.",
    ),
    { status: 500 },
  );
}

/**
 * **The bucket that matches the database**, resolved per call rather than at
 * import.
 *
 * `postgresBlobStore` refuses rather than falling back — rows in Postgres with
 * their bytes in `data/_blobs/` is a split brain, not a degraded configuration
 * (blobs.ts). Calling it lazily keeps that refusal a request-time error in the
 * route rather than a module-load throw that takes the server down, and keeps
 * this module importable by a test that never reaches the bucket.
 */
function matchingBucket(): RawSourceStore {
  return postgresBlobStore("this article's rows are in Postgres");
}

/**
 * The store, with the bucket injectable.
 *
 * A factory beside a singleton, exactly as `createFsArtifactStore` sits beside
 * `fsArtifacts`. The two cases worth testing hardest here — *the object is
 * missing* and *the object is the wrong bytes* — are far easier to make than to
 * find, and neither should need a Supabase container running to exercise.
 */
export function createPgSourceStore(sources: () => RawSourceStore = matchingBucket): SourceStore {
  return {
    async readPdf(slug: string): Promise<Uint8Array | null> {
      const [row] = await sourceReferenceQuery(getDb(), slug);
      /* Not yours, not there, or never published. All three are `null`: the
         route's sentence is the same for each, and telling them apart would
         confirm to a stranger that somebody else's article exists. */
      if (!row) return null;

      if (row.rawSourceSha256 !== null && row.rawSourceKind !== null) {
        /* **The kind comes from the column, never from sniffing.** It is what
           the fetch that stored the object recorded about the bytes it stored,
           and a recorded answer beats re-deriving one. */
        if (row.rawSourceKind !== "pdf") return null;
        const key = canonicalKey(row.rawSourceSha256, "pdf");
        const bytes = await sources().get(key);
        if (!bytes) throw unusableObject(slug, key, "there is nothing there");
        /* **The key IS the digest, so this checks rather than assumes.**
           `storeRawSource` verifies on the way in, which proves what was
           written; this proves what came back. One pass over a buffer already
           in memory — about 60 ms at the 32 MiB ceiling, against a document
           the reader is about to download anyway — and the whole reason this
           route exists is somebody checking a transcription against the ink.
           Handing them a different document than the one the row names would
           defeat the only verification the feature offers. */
        const actual = createHash("sha256").update(bytes).digest("hex");
        if (actual !== row.rawSourceSha256) {
          throw unusableObject(slug, key, `its bytes hash to ${actual}`);
        }
        return bytes;
      }

      /* The era before the bucket. `source` is the only thing on this row that
         says what kind of document it was, and it is checked BEFORE the second
         query so that a web page never drags its whole `raw_bytes` column
         across the wire to be thrown away. Dies with the column in stage 5 of
         docs/plans/finish-the-database-move.md. */
      if (row.source !== "pdf") return null;
      const [legacy] = await getDb()
        .select({ rawBytes: articleRevisions.rawBytes })
        .from(articleRevisions)
        .where(eq(articleRevisions.id, row.revisionId))
        .limit(1);
      return legacy?.rawBytes ? new Uint8Array(legacy.rawBytes) : null;
    },
  };
}

/** The one the server uses: the bucket that matches `DATABASE_URL`. */
export const pgSourceStore: SourceStore = createPgSourceStore();
