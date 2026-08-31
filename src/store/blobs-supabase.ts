/**
 * The Supabase Storage half of the blob seam — and **the reason it is written
 * against `fetch` rather than `@supabase/supabase-js`**.
 *
 * Every status this file cares about is one the SDK flattens. Measured against
 * the running container on 2026-08-27, the Storage API answers **HTTP 400** for
 * both of the two cases this module exists to tell apart:
 *
 *     absent     → 400  {"statusCode":"404","error":"not_found","code":"NoSuchKey"}
 *     duplicate  → 400  {"statusCode":"409","error":"Duplicate","code":"KeyAlreadyExists"}
 *
 * So `res.status === 404` **never fires**, and a version of this written from
 * the obvious reading of the docs would report a missing object as an
 * operational failure and a successful dedup as a bad request. The real status
 * is in the body, under `statusCode`, as a *string*. That is the one thing to
 * know before editing anything here.
 *
 * See docs/plans/260826u-pdf-upload-and-storage.md § What was measured, not read.
 */
import type { BlobHead, PutResult, RawSourceStore, UploadGrants } from "./blobs.js";

/**
 * The bucket, declared in supabase/config.toml.
 *
 * `sources`, not `pdfs`: it holds the document an article was made from, which
 * is what `GET /api/source/:slug` already names, and PDFs are only the first
 * kind. Private, with a 50 MiB object cap.
 *
 * **The MIME allowlist IS enforced, against the service key too.** This comment
 * claimed the opposite for a day, citing a measurement — that a PDF-only bucket
 * had accepted `text/html`, `image/png` and `application/x-nonsense` from our
 * own server. That measurement was wrong, and the way it was wrong is the
 * interesting part: `blobStore()` falls back to the filesystem without both env
 * vars, and `fsBlobs` ignores `contentType` entirely, so the probe's bytes went
 * to `data/_blobs/` and never touched Storage at all. The container's request
 * log covers its whole life and contains none of those uploads.
 * docs/postmortems/260828a-the-config-file-is-not-the-bucket.md.
 *
 * Re-measured against the running container on 2026-08-29, with the bucket
 * declaring the five types it declares today:
 *
 *     image/png              → 200
 *     application/x-nonsense → 415  mime type ... is not supported
 *     image/svg+xml          → 415  mime type ... is not supported
 *
 * So the allowlist is a real line for everything written here, and one that
 * holds independently of our own checks — `looksLikePdf` and the SHA-256
 * comparison in `acquireUpload` are the other line, not the only one. It is
 * also why SVG cannot be stored today even by mistake, which is the decision
 * docs/plans/260829b-hosting-the-articles-images.md made in code and this enforces in
 * infrastructure.
 *
 * [silent-success](docs/reusable/silent-success.md): the natural check is to
 * read `supabase/config.toml`, which agrees with the code and says nothing
 * about whether anybody enforces it — and the natural *probe* is the one above,
 * which can quietly measure the filesystem instead. `scripts/check-buckets.ts`
 * reads the live bucket, which is the only thing that answers the question.
 */
const BUCKET = "sources";

/** How long a signed upload grant lives, as Supabase mints it. Not configurable. */
const GRANT_SECONDS = 7200;

interface StorageFailure {
  /** The **real** status, as a string, which the HTTP status does not carry. */
  statusCode?: string;
  error?: string;
  message?: string;
  code?: string;
}

/**
 * The status Storage actually meant, whatever it put on the response line.
 *
 * Returns the HTTP status when the body says nothing, so an outage — a proxy
 * 502 with an HTML body, say — is still reported as itself rather than as a
 * missing object.
 */
async function realStatus(res: Response): Promise<number> {
  if (res.ok) return res.status;
  let body: StorageFailure | null = null;
  try {
    body = (await res.clone().json()) as StorageFailure;
  } catch {
    return res.status;
  }
  const stated = Number(body?.statusCode);
  return Number.isFinite(stated) && stated > 0 ? stated : res.status;
}

async function fail(res: Response, what: string): Promise<Error> {
  const status = await realStatus(res);
  let detail = "";
  try {
    const body = (await res.clone().json()) as StorageFailure;
    detail = body?.message ?? body?.error ?? "";
  } catch {
    detail = (await res.clone().text().catch(() => "")).slice(0, 200);
  }
  /* The key is deliberately not interpolated. A staging key carries an upload
     id and a canonical key is a content hash; neither is a secret, but this
     message reaches a log and the rule there is to say what happened rather
     than which document it happened to. src/log.ts. */
  return new Error(`Storage ${what} failed (${status})${detail ? `: ${detail}` : ""}`);
}

export function supabaseBlobs(baseUrl: string, serviceKey: string): RawSourceStore & UploadGrants {
  const api = `${baseUrl.replace(/\/$/, "")}/storage/v1`;
  const auth = { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey };
  // Every key we ever pass is built by `stagingKey` or `canonicalKey` in
  // src/source.ts, both of which validate a UUID or a hex hash — so there is
  // nothing of a caller's in a path here, and nothing to escape.
  const at = (key: string) => `${api}/object/${BUCKET}/${key}`;

  return {
    async head(key) {
      const res = await fetch(`${api}/object/info/${BUCKET}/${key}`, { headers: auth });
      if (res.ok) {
        const info = (await res.json()) as { size?: number; content_type?: string };
        return { bytes: info.size ?? 0, contentType: info.content_type ?? null } satisfies BlobHead;
      }
      if ((await realStatus(res)) === 404) return null;
      throw await fail(res, "head");
    },

    async get(key, options) {
      const res = await fetch(at(key), { headers: auth, signal: options?.signal ?? null });
      if (!res.ok) {
        if ((await realStatus(res)) === 404) return null;
        throw await fail(res, "get");
      }
      /* **Checked before the body is read, and again after.** `Content-Length`
         is what the server claims and is enough to refuse a 60 MB object
         without transferring it; the length of what actually arrived is the
         only number that is true, and a chunked response has no header at all.
         Refusing on either is cheap. Truncating on neither is the point — half
         a PDF hashes to a real-looking number that answers a different
         question. */
      const max = options?.maxBytes;
      const claimed = Number(res.headers.get("content-length"));
      if (max !== undefined && Number.isFinite(claimed) && claimed > max) {
        void res.body?.cancel();
        throw new Error(`That object is ${claimed} bytes and the limit is ${max}.`);
      }
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (max !== undefined && bytes.byteLength > max) {
        throw new Error(`That object is ${bytes.byteLength} bytes and the limit is ${max}.`);
      }
      return bytes;
    },

    async putIfAbsent(key, bytes, contentType): Promise<PutResult> {
      /* `POST`, not `PUT`. Storage's `POST` is create-only and answers 409 for
         an existing key; `PUT` upserts. The difference is the whole guarantee,
         so it is not a style choice — and `x-upsert: false` is sent as well,
         belt and braces, because the default has changed under people before. */
      const res = await fetch(at(key), {
        method: "POST",
        headers: { ...auth, "Content-Type": contentType, "x-upsert": "false" },
        body: bytes as unknown as BodyInit,
      });
      if (res.ok) return "stored";
      if ((await realStatus(res)) === 409) return "already-there";
      throw await fail(res, "put");
    },

    async remove(key) {
      const res = await fetch(at(key), { method: "DELETE", headers: auth });
      if (res.ok) return;
      if ((await realStatus(res)) === 404) return;
      throw await fail(res, "delete");
    },

    async sign(key) {
      const res = await fetch(`${api}/object/upload/sign/${BUCKET}/${key}`, {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: "{}",
      });
      if (!res.ok) throw await fail(res, "sign");
      const body = (await res.json()) as { url?: string; token?: string };
      if (!body.url || !body.token) throw new Error("Storage signed nothing back.");
      return {
        /* Absolute, because the browser is what uses it and it has no idea
           where our Storage lives. `body.url` comes back as a path under
           `/storage/v1`, token already attached. */
        url: `${api}${body.url}`,
        token: body.token,
        expiresAt: new Date(Date.now() + GRANT_SECONDS * 1000).toISOString(),
      };
    },
  };
}
