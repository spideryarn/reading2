/**
 * **Where an article's raw document came from, and how an upload becomes one.**
 *
 * Step 0 of docs/plans/260826u-pdf-upload-and-storage.md — the model, before any route
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
 * See docs/plans/260826u-pdf-upload-and-storage.md § What was measured, not read.
 */
import type { AssetExt } from "./assets.js";
import type { DocumentKind } from "./fetch.js";
import {
  type ReaderFacingFailure,
  UPLOAD_CHECKSUM,
  UPLOAD_MISSING,
  UPLOAD_UNREADABLE_FILE,
  UPLOAD_TOO_BIG,
  UPLOAD_TOO_MANY_PAGES,
} from "./messages.js";
import { MAX_UPLOAD_BYTES } from "./uploads.js";

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

/**
 * Everything the `sources` bucket holds, and so everything a canonical key can
 * name: the two document kinds, plus the image formats we host.
 *
 * **The bucket is one flat content-addressed space and this is the whole of the
 * naming scheme for it.** Widening it here rather than adding a second key
 * minter is what keeps the invariant the plan calls load-bearing — a grant is
 * only ever minted for a `staging/<uuid>` key, a canonical key is never
 * writable by one, and the bytes at a canonical name can always be re-checked
 * against the name (docs/plans/260829b-hosting-the-articles-images.md).
 *
 * **An image gets no `raw_sources` row**, and that is a separate decision from
 * this one. That table exists so `article_revisions` can foreign-key to *the
 * document* a revision was made from; an image is not the document, so
 * `raw_sources.kind`'s `check (kind in ('pdf','html'))` stays exactly as it is
 * and the `assets` manifest is the record instead.
 */
export type StoredKind = DocumentKind | AssetExt;

const EXTENSION: Record<StoredKind, string> = {
  html: "html",
  pdf: "pdf",
  png: "png",
  jpeg: "jpeg",
  gif: "gif",
};

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
export function canonicalKey(sha256: string, media: StoredKind): string {
  if (!SHA256_RE.test(sha256)) {
    throw new Error(`Not a SHA-256: ${JSON.stringify(sha256)}`);
  }
  return `sha256/${sha256}.${EXTENSION[media]}`;
}

/**
 * True for a key a grant may be minted against. Used as a guard, not a hint.
 *
 * **Reuses the exact UUID matcher rather than approximating it.** The first
 * version tested `[0-9a-f-]{36}` — the right length and the right alphabet, and
 * it accepts `staging/------------------------------------`, thirty-six
 * hyphens. Nothing downstream would have minted a grant for that, so it was not
 * exploitable; it was a guard that had quietly stopped describing the thing it
 * guards, which is how the change after next becomes exploitable. Found by the
 * cross-family review.
 */
export function isStagingKey(key: string): boolean {
  const rest = key.startsWith("staging/") ? key.slice("staging/".length) : null;
  return rest !== null && UUID_RE.test(rest);
}

/* --------------------------------------------------------------- limits -- */

/**
 * The cap lives in src/uploads.ts and is **re-exported, not redeclared.**
 *
 * That module is the one the browser's file picker already imports, and it has
 * no dependencies precisely so both sides can share it. A second `50 * 1024 *
 * 1024` here would be two constants that agree today: the picker would go on
 * accepting a file the server had started refusing, both test suites would stay
 * green, and the disagreement would surface as somebody holding a 60 MB scan.
 * Found by the cross-family review, which noticed the duplication before it
 * had a chance to drift.
 */
export { MAX_UPLOAD_BYTES };

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
  /**
   * `expired` is reachable from `claimed`, and it has to be.
   *
   * A worker that claims an upload and then dies leaves a row nothing can move
   * again, because only that worker was going to verify it. The review called
   * this out: without this edge the row is stuck for ever and the reader is
   * told nothing.
   *
   * **And the recovery is a new upload, never a resumed one.** Re-reading the
   * staging object after a crash is the one sequence that defeats content
   * addressing — the grant is still live, so the bytes at that key may no
   * longer be the bytes we hashed. Expiring and asking for a fresh upload id
   * costs the reader one re-upload and costs us nothing we cannot reason about.
   */
  claimed: ["verified", "rejected", "expired"],
  verified: [],
  rejected: [],
  expired: [],
};

/**
 * Every status an upload can be in — **derived from `NEXT`, never written out
 * again.**
 *
 * It exists so that the `uploads_status` CHECK in the database has something to
 * be asserted against that cannot itself drift. A draft of that constraint
 * listed four of these five, and four would have passed every test and every
 * migration and then failed at the first expiry with a violation nobody could
 * read. A third hand-typed copy in the test would have had the same problem, so
 * the test reads this. tests/db-schema.test.ts.
 */
export const UPLOAD_STATUSES = Object.keys(NEXT) as UploadStatus[];

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
 * Why an upload was refused. **The words live in src/messages.ts.**
 *
 * The reason is a domain fact and belongs here; the sentence a reader sees is
 * copy and belongs in the one file docs/project/copy.md says holds all of it.
 * Keeping them apart is not tidiness — `tests/messages.test.ts` walks every
 * exported `ReaderFacingFailure` and checks its bracketed code reads back to
 * the kind it was declared with, and a message defined out here is a message
 * that check never sees.
 *
 * It nearly mattered. **On 2026-08-26, when there were four of these**, none of
 * their codes was in `CODE_KINDS`, and an unrecognised code means *offer another
 * go* — so "that file isn't a PDF" would have arrived with a Retry button that
 * could not possibly work, which is the failure
 * docs/postmortems/260826a-toc-max-tokens.md exists about. Found by the
 * cross-family review. (The count is dated rather than dropped because it is
 * about that day; `REJECT_REASONS` below is the live one.)
 */
export type RejectReason =
  | "too-big"
  /**
   * **The bytes are neither a PDF nor a web page** — the name is older than the
   * meaning, and stays.
   *
   * A PDF was the only legal upload until 2026-09-07
   * (docs/plans/260907b-upload-an-html-file-and-a-url-for-a-pdf.md). These strings go
   * into `uploads.reason`, which is `text` with no check constraint, so a new
   * spelling would need no migration — and would still orphan every row already
   * written under this one, in exchange for nothing a reader ever sees. The
   * sentence is `UPLOAD_UNREADABLE_FILE` and it says the true thing.
   */
  | "not-a-pdf"
  | "checksum-mismatch"
  | "missing"
  | "too-many-pages";

const REJECTIONS: Record<RejectReason, ReaderFacingFailure> = {
  "too-big": UPLOAD_TOO_BIG,
  "not-a-pdf": UPLOAD_UNREADABLE_FILE,
  "checksum-mismatch": UPLOAD_CHECKSUM,
  missing: UPLOAD_MISSING,
  /**
   * **The one reason whose sentence the reader never sees**, and it is here for
   * the state machine rather than for the copy.
   *
   * The page count is only known where it was counted, and this map is static
   * (see the header above), so the *job* carries `pdfTooManyPages(count, limit)`
   * and this carries the reason the record has to record. `rejected` needs a
   * reason or the `uploads_rejected_has_reason` check refuses the row — which is
   * the whole point of writing one down.
   *
   * "Not normally" until 2026-09-04, when it was checked: the refusal is written
   * onto the row by `refuseAnOverlongPdf` rather than through `refuse`, so this
   * failure is never handed to a reader by any path there is. It is kept because
   * this map's **totality** is what makes a new reason without a sentence a
   * compiler error, and that is worth more than a deleted paragraph — the
   * argument in full is at `UPLOAD_TOO_MANY_PAGES` in src/messages.ts, along with
   * the drift it costs.
   */
  "too-many-pages": UPLOAD_TOO_MANY_PAGES,
};

/**
 * Every reason there is — **derived, never written out again**, for the reason
 * `UPLOAD_STATUSES` above is: `tests/source.test.ts` walks these asserting that
 * each has its own bracketed code and reads back to the kind it was declared
 * with, and a second hand-typed list is a list that goes on agreeing with
 * itself while missing whatever was added last.
 */
export const REJECT_REASONS = Object.keys(REJECTIONS) as RejectReason[];

/** The whole failure — the sentence and whether another go is worth offering. */
export function rejectionFailure(reason: RejectReason): ReaderFacingFailure {
  return REJECTIONS[reason];
}

/** Just the sentence, for callers that only render. */
export function rejectionMessage(reason: RejectReason): string {
  return REJECTIONS[reason].message;
}
