/**
 * **Where an article's raw document came from, and how an upload becomes one.**
 *
 * Step 0 of docs/plans/pdf-upload-and-storage.md — the model, before any route
 * or adapter exists, because the review of that plan was blunt that routes
 * cannot be built before the invariant is settled.
 *
 * Everything here is pure. No storage client, no database, no `fetch`. That is
 * deliberate: these are the rules, and rules that can only be exercised through
 * a running Supabase are rules nobody tests.
 *
 * ## The two axes, which are not the same axis
 *
 * A raw document has an **origin** (a URL we fetched, or a file a reader
 * uploaded) and a **media kind** (HTML or PDF). They vary independently, and
 * conflating them is the mistake this file exists to prevent:
 *
 *     origin ─┬─ url ──────┬─ html   ← the ordinary case
 *             │            └─ pdf    ← a PDF someone linked to
 *             └─ upload ───┴─ pdf    ← the new one
 *
 * `Meta.source` in src/types.ts already means `"pdf"` — that is the media kind,
 * and it must NOT be overloaded to mean "uploaded". The plan's first draft did
 * exactly that and the cross-family review caught it.
 *
 * ## Content addressing, and the security property it buys
 *
 * Greg's call, 2026-08-26: one source object per distinct SHA-256, shared
 * across readers and across revisions; articles are per-reader and are not
 * shared. So the canonical key IS the hash.
 *
 * That turns out to close a hole rather than merely save space, and the
 * reasoning is worth keeping because it is not obvious. A Supabase signed
 * upload grant is a bearer credential that lives for two hours and is **not**
 * one-time: measured against the running stack, replaying it while the object
 * exists gives `409`, but replaying it *after the object is deleted* succeeds.
 * So a grant outlives the object it created, and anything that deletes an
 * object re-arms the grant over its key.
 *
 * The invariant that makes that harmless:
 *
 * > **A grant is only ever minted for a staging key. A canonical key is never
 * > writable by a grant.**
 *
 * An upload lands at `staging/<uploadId>`, is read exactly once, hashed, and
 * promoted to `sha256/<hash>`. After that we never read the staging key again,
 * so a replayed grant can only litter a location nothing consults. And a
 * canonical object cannot be substituted, because its name is a statement about
 * its contents: swapping the bytes would change the key.
 *
 * See docs/plans/pdf-upload-and-storage.md § What was measured, not read.
 */
import type { DocumentKind } from "./fetch.js";

/* ------------------------------------------------------------- the axes -- */

/**
 * Where a raw document came from. **Origin, not media kind.**
 *
 * Discriminated so that the typechecker, rather than a reviewer, finds the
 * places that assume a URL exists. There are more of those than anybody
 * estimates: `requireUrl` in src/pipeline.ts, `RawManifest` in src/fetch.ts
 * (which requires two URLs and a fetch timestamp), `freeSlug` in src/jobs.ts
 * (which is keyed on the URL and is skipped entirely without one), and
 * `sameWork` (which cannot tell two uploads apart).
 */
export type SourceOrigin =
  | {
      kind: "url";
      /** What the reader typed or clicked, before redirects. */
      requestedUrl: string;
      /** Where we ended up. The one to keep — see `FetchedDocument.url`. */
      url: string;
      fetchedAt: string;
    }
  | {
      kind: "upload";
      /** Our id for the upload attempt, never the client's. */
      uploadId: string;
      /**
       * What the reader called the file, kept only to show them.
       *
       * **Never part of any object key.** It is a stranger's string: it can
       * contain slashes, `..`, control characters, or 4 KB of nothing. It is
       * cleaned by `cleanFilename` before it is stored or displayed, and the
       * key is derived from ids and hashes that we generated.
       */
      filename: string;
      uploadedAt: string;
    };

/**
 * A raw document, identified by what it contains rather than where it sits.
 *
 * `sha256` is required here and is the **server-computed** hash over the bytes
 * we actually read — not the one the browser claimed. The client's hash is a
 * checksum of the transfer, and calling it identity is how a verified document
 * and an extracted document come to be different files.
 */
export interface RawDocument {
  media: DocumentKind;
  origin: SourceOrigin;
  contentType: string | null;
  /** HTML only; `null` for a PDF, matching `RawManifest`. */
  encoding: string | null;
  bytes: number;
  sha256: string;
}

/* ---------------------------------------------------------------- keys -- */

/** Lower-case hex, 64 characters. Anything else is not a SHA-256. */
const SHA256_RE = /^[0-9a-f]{64}$/;

/** Our own upload ids: a UUID, lower-case, as Postgres hands them back. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const EXTENSION: Record<DocumentKind, string> = { html: "html", pdf: "pdf" };

/**
 * Where a browser is allowed to write.
 *
 * **The only kind of key a grant is ever minted for.** Derived from an id we
 * generated, so there is nothing of the caller's in it — the rule the plan
 * calls load-bearing: *never accept a client-supplied object path*.
 */
export function stagingKey(uploadId: string): string {
  if (!UUID_RE.test(uploadId)) {
    throw new Error(`Not an upload id: ${JSON.stringify(uploadId)}`);
  }
  return `staging/${uploadId}`;
}

/**
 * Where a verified document lives for good. **Never writable by a grant.**
 *
 * The key is the hash, so two readers uploading identical bytes converge on one
 * object without anything having to compare them, and a re-run cannot leak a
 * second copy. It also means the name is a claim about the contents that can be
 * checked, which is what makes the grant-replay window harmless.
 */
export function canonicalKey(sha256: string, media: DocumentKind): string {
  if (!SHA256_RE.test(sha256)) {
    throw new Error(`Not a SHA-256: ${JSON.stringify(sha256)}`);
  }
  return `sha256/${sha256}.${EXTENSION[media]}`;
}

/** True for a key a grant may be minted against. Used as a guard, not a hint. */
export function isStagingKey(key: string): boolean {
  return /^staging\/[0-9a-f-]{36}$/.test(key);
}

/* --------------------------------------------------------------- limits -- */

/**
 * 50 MB — Greg's cap, and the ceiling Supabase's free plan puts on one object.
 * The two landing on the same number is luck, but it means v1 needs no plan
 * change and any later raise needs one.
 */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

/**
 * How long a Supabase signed upload grant lives. **Measured, not configurable:**
 * the token's payload decodes to `exp - iat === 7200`.
 */
export const GRANT_TTL_MS = 2 * 60 * 60 * 1000;

/**
 * How long an abandoned staging object must sit before a sweep may remove it.
 *
 * **Strictly longer than `GRANT_TTL_MS`, and that is the whole point.** Deleting
 * an object re-arms any grant still live over its key, so a sweep that runs
 * inside the TTL races the browser it is cleaning up after. An hour of slack on
 * top of two hours costs nothing; getting it wrong costs a re-upload nobody
 * asked for at a key somebody might still read.
 */
export const SWEEP_GRACE_MS = GRANT_TTL_MS + 60 * 60 * 1000;

/* ------------------------------------------------- the upload's lifetime -- */

/**
 * One upload attempt, from minted grant to verified source.
 *
 *     pending ──claim──► claimed ──verify──► verified   (terminal, happy)
 *        │                  │
 *        │                  └────────────────► rejected  (terminal)
 *        └──(TTL passes)───────────────────────► expired  (terminal)
 *
 * `claimed` exists so that finalising is **exactly once** rather than
 * idempotent-ish. Two tabs, or one impatient double-click, otherwise both pass
 * the same checks and both enqueue a job that spends model money. The
 * transition is a conditional update — `WHERE id = $1 AND status = 'pending'` —
 * so the database decides the winner, not the order two requests happen to
 * arrive in.
 */
export type UploadStatus = "pending" | "claimed" | "verified" | "rejected" | "expired";

const NEXT: Record<UploadStatus, readonly UploadStatus[]> = {
  pending: ["claimed", "expired"],
  claimed: ["verified", "rejected"],
  verified: [],
  rejected: [],
  expired: [],
};

/** Whether an upload may move from one state to another. Terminal states are terminal. */
export function canTransition(from: UploadStatus, to: UploadStatus): boolean {
  return NEXT[from].includes(to);
}

/**
 * Has this grant's window closed?
 *
 * Asked of the *grant*, not of the row, because the row is only ever as fresh
 * as the last time something looked at it. An upload nobody has touched is
 * still `pending` in the table long after its token stopped working.
 */
export function grantExpired(mintedAt: Date, now: Date): boolean {
  return now.getTime() - mintedAt.getTime() >= GRANT_TTL_MS;
}

/** Whether a staging object is old enough that removing it cannot re-arm a live grant. */
export function sweepable(mintedAt: Date, now: Date): boolean {
  return now.getTime() - mintedAt.getTime() >= SWEEP_GRACE_MS;
}

/* ---------------------------------------------------- checking the bytes -- */

/** `%PDF-`. What a PDF starts with, whatever the upload claimed it was. */
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d];

/**
 * Does this actually begin like a PDF?
 *
 * The bucket's MIME allowlist checks the type the *uploader claimed*. This
 * checks the bytes. They are different questions, and only one of them is
 * answered by somebody with an interest in the answer.
 */
export function looksLikePdf(bytes: Uint8Array): boolean {
  if (bytes.length < PDF_MAGIC.length) return false;
  return PDF_MAGIC.every((b, i) => bytes[i] === b);
}

/**
 * A filename fit to store and to show, or `null` if there is nothing left.
 *
 * Takes the basename, drops control characters, collapses whitespace and bounds
 * the length. `..` and any directory part are gone by construction rather than
 * by a blocklist — we keep the last segment and never the path. This value is
 * display-only in any case; nothing derives a key or a slug from it directly.
 */
export function cleanFilename(raw: string): string | null {
  const last = raw.split(/[/\\]/).pop() ?? "";
  // biome-ignore lint/suspicious/noControlCharactersInRegex: removing them is the point
  const cleaned = last.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim();
  return cleaned === "" || cleaned === "." || cleaned === ".." ? null : cleaned.slice(0, 200);
}

/**
 * Why an upload was refused, in the words the reader gets.
 *
 * One place, so the four refusals cannot drift apart, and phrased the way
 * docs/project/copy.md asks: what happened, whose problem it is, what to do.
 */
export type RejectReason = "too-big" | "not-a-pdf" | "checksum-mismatch" | "missing";

export function rejectionMessage(reason: RejectReason): string {
  switch (reason) {
    case "too-big":
      return (
        `That file is larger than ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB, which is the ` +
        `most we can take. Nothing was uploaded. [up-big]`
      );
    case "not-a-pdf":
      return "That file isn't a PDF, whatever it is called. Try a different file. [up-pdf]";
    case "checksum-mismatch":
      return (
        "The file that arrived isn't quite the file that was sent — something went wrong in " +
        "transit. Try uploading it again. [up-sum]"
      );
    case "missing":
      return (
        "We never received that file. The upload may have been interrupted, or it may have taken " +
        "longer than two hours. Try again. [up-gone]"
      );
  }
}
