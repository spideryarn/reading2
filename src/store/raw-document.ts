/**
 * **The document an article was made from, out of wherever that revision keeps
 * it** — the two storage eras, told apart once.
 *
 * ## Why this is a module of its own
 *
 * It lived in src/store/export.ts, which is where it was written and where the
 * only caller was: `db:export` has to reproduce `raw.pdf` and its manifest. On
 * 2026-08-31 `GET /api/source/:slug` became the second caller — the reading
 * view's *view the original*, which until then read the bytes off the local
 * filesystem and so worked on a laptop and 404d on Vercel, which has no such
 * disk.
 *
 * Importing it from `export.ts` made a cycle: `export.ts` already reaches into
 * `pg.ts` for `ownedSlug`, and `pg.ts` would then reach back. So the shared part
 * moved here, to a file that imports neither — the fetcher's types, the
 * canonical key, and the blob-store interface, and nothing else. `export.ts`
 * re-exports all three names, so nothing that used them had to change.
 *
 * **Two readings of these four columns is the thing being prevented**, and it is
 * why the answer was extraction rather than a second small function beside the
 * route. GPT Sol made it a blocker on the plan: *"extract and reuse the existing
 * raw-document resolution instead of implementing a second interpretation of the
 * same revision fields"*. The two callers want identical answers to *which era
 * is this row in*, *is a dangling reference an error*, and *do we trust what the
 * bucket handed back* — and the second implementation of any of those is the one
 * that goes quietly wrong.
 *
 * docs/plans/plain-mode-and-the-way-out.md § 5.
 */

import { createHash } from "node:crypto";

import { type DocumentKind, sniffKind } from "../fetch.js";
import { canonicalKey, MAX_UPLOAD_BYTES } from "../source.js";
import type { RawSourceStore } from "./blobs.js";

/**
 * Refused: the revision points at an object the bucket does not have.
 *
 * Its own type because the repair depends on which half is wrong, and a bare
 * `Error` here would be read as "this article has no source document" — the one
 * thing it definitely does not mean. Either the bucket is the wrong one (see the
 * credentials note on `exportArticle`) or the object has been deleted out from
 * under a row that still references it.
 */
export class MissingRawObject extends Error {
  readonly status = 500;
  constructor(slug: string, key: string) {
    super(
      `"${slug}" points at "${key}" in the sources bucket and there is no such object. ` +
        "Refusing to export an article as though it never had a source document. " +
        "Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY name the project DATABASE_URL does.",
    );
    this.name = "MissingRawObject";
  }
}

/** Refused: the object under a content-addressed key is not what the key says. */
export class CorruptRawObject extends Error {
  readonly status = 500;
  constructor(slug: string, key: string, actual: string) {
    super(
      `"${slug}": the object at "${key}" hashes to ${actual}. The key IS the hash, so ` +
        "one of them is wrong and neither can be trusted. Refusing to write it out.",
    );
    this.name = "CorruptRawObject";
  }
}

/**
 * The document itself, from wherever this revision keeps it.
 *
 * **Two eras, and the newer one is authoritative where both answer.** Until
 * docs/plans/260827aa-delete-the-importer.md § C6 the payload was `article_revisions.raw_bytes`,
 * an 11 MiB `bytea`; now it is a *reference* — `raw_source_sha256` plus
 * `raw_source_kind` — with the bytes in the `sources` bucket. The column is
 * dropped at the demolition, so the reference branch is the one with a future
 * and the column branch is here only for rows written before the change.
 *
 * **The kind comes from the column, not from sniffing.** `rawFileName` exists
 * because there was no `raw_kind` column and the body was the only honest
 * authority; there is one now, written by the fetch that stored the object, and
 * a recorded answer beats re-deriving it. Sniffing stays for the legacy branch,
 * which has nothing else.
 *
 * **The bytes are re-hashed.** The key *is* the digest, so checking costs one
 * pass over a buffer already in memory and turns "the bucket handed us
 * something" into "the bucket handed us the right thing". `storeRawSource`
 * verifies on the way in for the same reason.
 */
/* **Exported since 2026-08-31**, and no longer only the exporter's. `sendSource`
   in src/routes.ts serves the same bytes to the reader who owns them, and it was
   reading them off the local filesystem — which Vercel does not have, so the
   link 404d in production while working perfectly on a laptop. What it needed
   was this function, not a second reading of the same four columns: the two eras,
   the refusal to fall through from a dangling reference to the legacy column,
   and the re-hash are all decisions somebody would have had to make again, and
   GPT Sol's review of that plan was blunt that a second interpretation of these
   fields is how the two come to disagree. docs/plans/plain-mode-and-the-way-out.md § 5. */
export async function readRawDocument(
  slug: string,
  revision: {
    rawBytes: Buffer | null;
    rawContentType: string | null;
    rawSourceSha256: string | null;
    rawSourceKind: string | null;
  },
  sources: RawSourceStore,
): Promise<{ bytes: Uint8Array; kind: DocumentKind; storedSha256: string | null } | null> {
  if (revision.rawSourceSha256 && revision.rawSourceKind) {
    const kind = revision.rawSourceKind as DocumentKind;
    const key = canonicalKey(revision.rawSourceSha256, kind);
    /* **Bounded, not merely trusted.** `get` treats `maxBytes` as a refusal
       rather than a truncation, and Supabase's adapter can decline on the
       `Content-Length` before it buffers anything. Without it, an oversized
       object under a referenced key — a service-key write, a backfill, a bucket
       whose policy drifted — is read into memory in full by a serverless
       process that then has to hash it, and a few concurrent requests exhaust
       it. `MAX_UPLOAD_BYTES` is the right ceiling because it is the largest
       object that can legitimately be under a canonical key: uploads stop
       there, and anything we fetched stopped at src/fetch.ts's own 32 MiB.
       GPT Sol asked for the bound twice, 2026-08-31. */
    const bytes = await sources.get(key, { maxBytes: MAX_UPLOAD_BYTES });
    /* **Throw, never fall through to `raw_bytes`.** A dangling reference and an
       article with no source document are different facts, and the whole point
       of the reference is that the row asserts the object exists. Quietly
       exporting the legacy column instead — or nothing — would make a broken
       bucket look like an article that was always sourceless. */
    if (!bytes) throw new MissingRawObject(slug, key);
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (actual !== revision.rawSourceSha256) throw new CorruptRawObject(slug, key, actual);
    return { bytes, kind, storedSha256: revision.rawSourceSha256 };
  }

  if (!revision.rawBytes) return null;
  return {
    bytes: revision.rawBytes,
    kind: sniffKind(revision.rawContentType, revision.rawBytes) === "pdf" ? "pdf" : "html",
    storedSha256: null,
  };
}
