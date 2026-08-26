/**
 * **Where a raw document's bytes live** — the seam, and the two things you may
 * do at it.
 *
 * Step 3 of docs/plans/pdf-upload-and-storage.md § Build order, revised. The
 * shape here is deliberately **two interfaces rather than one**, and that is
 * the review's correction rather than my first draft:
 *
 * > If the filesystem adapter cannot implement `signUpload`, `signUpload` does
 * > not belong on the same interface as `get`/`put` — a health check cannot
 * > repair a shape that lies.
 * >
 * > — GPT Sol, 2026-08-26
 *
 * So `RawSourceStore` is "hold these bytes and give them back", which both
 * adapters do honestly, and `UploadGrants` is "let a browser write straight to
 * the object store", which **only Supabase Storage can do at all**. There is no
 * filesystem grant issuer, not even a token one, because the only way to write
 * one is a URL pointing back at our own server — and that reintroduces the
 * 4.5 MB Vercel body limit under a name saying it does not exist, which is the
 * failure this repo keeps writing up (docs/reusable/silent-success.md).
 *
 * `uploadGrants()` returning `null` is therefore a real answer: *this
 * installation cannot take uploads*. The route says so in a sentence.
 *
 * ## Why selection does not read `SPIDERYARN_STORE`
 *
 * That variable chooses where **articles** are read from (src/store/live.ts),
 * which is a different question with a different answer. Blobs follow the
 * credentials: if this process has a Supabase service key, the bytes go to
 * Supabase, because that is the only place a browser can put them. Otherwise
 * they go under `data/_blobs/`, which is enough for tests and for a laptop with
 * no container running — and cannot mint a grant, so nothing can accidentally
 * depend on it in production.
 */
import type { DocumentKind } from "../fetch.js";
import { fsBlobs } from "./blobs-fs.js";
import { supabaseBlobs } from "./blobs-supabase.js";

/** What `head` can say about an object without moving its bytes. */
export interface BlobHead {
  bytes: number;
  contentType: string | null;
}

/**
 * Whether a create-only write actually created anything.
 *
 * A discriminant rather than a boolean or a swallowed 409, because **"it was
 * already there" is the dedup hit** — two readers uploading identical bytes
 * converge on one canonical object — and a caller that cannot tell cannot log
 * it, count it, or notice when it stops happening.
 */
export type PutResult = "stored" | "already-there";

export interface RawSourceStore {
  /**
   * Size and type, or `null` if there is no such object.
   *
   * **`null` means absent and nothing else.** Every other failure throws. The
   * distinction is the one src/store/artifacts-fs.ts already draws and the one
   * Sol asked for by name: a Storage 503 read as "absent" turns a transient
   * outage into "your file never arrived", which is a lie the reader acts on by
   * uploading 11 MB again.
   */
  head(key: string): Promise<BlobHead | null>;
  /**
   * The bytes, or `null` if absent.
   *
   * `maxBytes` is a **refusal, not a truncation**: an object larger than it
   * throws rather than returning a prefix, because a prefix of a PDF is a
   * corrupt PDF that hashes to something plausible.
   */
  get(key: string, options?: { maxBytes?: number; signal?: AbortSignal }): Promise<Uint8Array | null>;
  /**
   * Write only if nothing is there. Never overwrites.
   *
   * The canonical key is the content hash, so an overwrite could only ever be
   * one of two things: the same bytes again, or a lie about what the name
   * means. Create-only makes the second impossible rather than unlikely.
   */
  putIfAbsent(key: string, bytes: Uint8Array, contentType: string): Promise<PutResult>;
  remove(key: string): Promise<void>;
}

/** A path-bound, short-lived write grant for a browser. Supabase only. */
export interface UploadGrants {
  /**
   * **Only ever called with a staging key** — see `stagingKey` in src/source.ts.
   * A canonical key is never writable by a grant, which is what makes the
   * measured "a deleted object re-arms its grant" harmless.
   *
   * **It takes no content type**, and that is a fact about Storage rather than
   * a simplification: a mint accepts no body options at all — a request asking
   * for `{"upsert":true}` was measured coming back `upsert:false` — so the type
   * is enforced by the bucket's own allowlist when the browser PUTs, and a
   * parameter here would be one we quietly dropped.
   */
  sign(key: string): Promise<{ url: string; token: string; expiresAt: string }>;
}

/** The content type an object of this media kind is stored with. */
export const CONTENT_TYPE: Record<DocumentKind, string> = {
  pdf: "application/pdf",
  html: "text/html",
};

function configured(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url, key } : null;
}

/** Where the bytes go on this installation. Never null — the filesystem always works. */
export function blobStore(): RawSourceStore {
  const supabase = configured();
  return supabase ? supabaseBlobs(supabase.url, supabase.key) : fsBlobs();
}

/**
 * Who can hand a browser a write grant, or `null` if nobody here can.
 *
 * Null is not an error condition to be papered over. It is the honest answer on
 * a laptop with no Supabase container, and the caller's job is to say so.
 */
export function uploadGrants(): UploadGrants | null {
  const supabase = configured();
  return supabase ? supabaseBlobs(supabase.url, supabase.key) : null;
}
