/**
 * **One upload attempt, written down** — from the grant we mint to the bytes we
 * verified, or the reason we would not take them.
 *
 * ## Why this is on the filesystem and not in Postgres
 *
 * docs/plans/pdf-upload-and-storage.md specifies an `uploads` table, and it will
 * get one. It has not got one *yet*, and the reason is that the thing it sits
 * beside has not either: **the ingest queue itself is filesystem-backed**.
 * src/jobs.ts writes `data/_jobs/<id>.json` and the `jobs` table in
 * src/db/schema.ts is unused, because moving the queue into Postgres is its own
 * piece of work (docs/plans/job-queue-rethink.md). An upload record is queue
 * state — it is created, claimed and finished inside one ingest, and it is
 * meaningless once the article exists.
 *
 * Putting it in Postgres ahead of the queue would buy nothing and cost two
 * things: a migration in a schema file several agents share, and a second
 * durability story for a subsystem whose first one is `data/_jobs/`. So it goes
 * where its neighbours are, and it moves when they move. The state machine
 * itself — `canTransition`, `grantExpired`, `sweepable` — lives in
 * src/source.ts and is storage-agnostic on purpose, which is what makes that
 * move a change of adapter rather than a change of rules.
 *
 * ## The claim is a create-only file, not a read-then-write
 *
 * Finalising has to be **exactly once**: two tabs, or one impatient
 * double-click, otherwise both pass the same checks and both queue a job that
 * spends model money. Reading the record, seeing `pending`, and writing
 * `claimed` has a gap in it that is however long the two `await`s take.
 *
 * So the claim is `open(…, "wx")` on a marker beside the record — an atomic
 * create-only at the kernel, which is the same primitive the blob store's
 * `putIfAbsent` uses and works across processes rather than only across the
 * awaits in one. Losing the race is `EEXIST`, and that is a definite answer
 * rather than a probable one.
 */
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  type RejectReason,
  type UploadStatus,
  canTransition,
  cleanFilename,
  grantExpired,
} from "./source.js";
import { MAX_UPLOAD_BYTES } from "./uploads.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const DIR = path.join(ROOT, "data", "_uploads");

/**
 * What we know about one upload, and **which half of it we believe**.
 *
 * The `claimed…` fields are what the browser said. They are recorded so that a
 * mismatch can be *reported* — "the file that arrived is not the file you
 * chose" is a useful sentence — and they are never treated as identity. The
 * unprefixed `sha256` and `bytes` are ours, computed over what actually landed,
 * and they only exist after `verified`.
 */
export interface UploadRecord {
  id: string;
  /**
   * Who asked for it.
   *
   * **Recorded and checked, even though it decides nothing today.** There is
   * one owner in this installation (`currentOwnerId`, src/owner.ts) and the
   * shelf is not owner-filtered either, so an upload having an owner is
   * currently no more of a boundary than an article having one. It is here for
   * the reason the plan gave when it was still hypothetical: *the day it stops
   * being trivial is the day it matters*, and adding a column to a live state
   * machine is more work than starting with one. GPT Sol, 2026-08-27, on the
   * identity being verified and then discarded.
   */
  owner: string;
  /** Cleaned by `cleanFilename`. Display only — nothing derives a key from it. */
  filename: string;
  claimedBytes: number;
  claimedSha256: string;
  status: UploadStatus;
  mintedAt: string;
  /**
   * When the grant stops working — **the token's clock, not this row's.**
   *
   * Sol's correction, 2026-08-26: a record's creation time can precede the
   * token's `iat`, so a sweep counting from `mintedAt` counts from the wrong
   * clock and can delete an object while a grant over its key is still live —
   * which re-arms that grant. Storing what the issuer told us removes the
   * arithmetic entirely.
   */
  grantExpiresAt: string;
  /** Our hash, over the bytes we read. Present only once `verified`. */
  sha256?: string;
  bytes?: number;
  /** Why we would not take it. Present only once `rejected`. */
  reason?: RejectReason;
  /** The article it became, once one exists. */
  slug?: string;
}

function recordFile(id: string): string {
  /* `id` is a UUID we minted, and every caller reaching this has been through
     `isUploadId` — but this is the function that turns a string into a path, so
     it is the function that has to be sure. */
  if (!isUploadId(id)) throw new Error(`Not an upload id: ${JSON.stringify(id)}`);
  return path.join(DIR, `${id}.json`);
}

const claimFile = (id: string) => `${recordFile(id)}.claim`;

/** A UUID as `crypto.randomUUID` writes one. The only shape an upload id ever has. */
export function isUploadId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)
  );
}

/**
 * **Can a record written by one request be read by the next one?**
 *
 * On this laptop, yes: one process, one disk, and `data/_uploads/` outlives the
 * request that wrote it. On Vercel, no — a function's filesystem is neither
 * durable nor shared, and minting a grant and queueing the job are *two*
 * requests that may not even run on the same machine. The second one would
 * answer `404 No such upload` for a file that had uploaded perfectly.
 *
 * That is a real gap and it is the reason this feature is not deployable yet.
 * It is stated here, and refused at the door, rather than discovered three
 * minutes into an 11 MB upload — which is the difference between a limitation
 * and [a silent success](../docs/reusable/silent-success.md). GPT Sol,
 * 2026-08-27, and the fix is the same one the queue itself needs: shared
 * durable storage, which arrives with docs/plans/job-queue-rethink.md.
 *
 * Deliberately **not** keyed on "is the filesystem writable" — it is, on
 * Vercel, and that is precisely what makes this fail quietly.
 */
export function recordsSurviveTheRequest(): boolean {
  return !process.env.VERCEL;
}

let writeCounter = 0;

/** Write, then rename — a half-written record parses as nothing and loses the whole attempt. */
async function put(record: UploadRecord): Promise<void> {
  await mkdir(DIR, { recursive: true });
  const target = recordFile(record.id);
  const tmp = `${target}.${process.pid}.${++writeCounter}.tmp`;
  await writeFile(tmp, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  await rename(tmp, target);
}

/**
 * The record, or `null` — **and `null` for somebody else's, too.**
 *
 * `owner` is optional in the signature so that the two callers who genuinely
 * have no reader to check against (the tests, and `listUploads`) do not have to
 * invent one. Every route passes it. Not-found and not-yours are deliberately
 * the same answer: telling a stranger that an id exists but is not theirs is
 * telling them the id exists.
 */
export async function readUpload(id: string, owner?: string): Promise<UploadRecord | null> {
  if (!isUploadId(id)) return null;
  let record: UploadRecord;
  try {
    record = JSON.parse(await readFile(recordFile(id), "utf8")) as UploadRecord;
  } catch {
    return null;
  }
  /* A record written before uploads had owners has none, and there is exactly
     one reader, so treating it as theirs is right rather than lenient. It stops
     being right the day there are two, which is the day `owner` stops being
     optional here. */
  if (owner !== undefined && record.owner !== undefined && record.owner !== owner) return null;
  return record;
}

/**
 * The record as a caller may see it, with the grant's expiry applied.
 *
 * **Asked of the grant rather than of the file**, because the file is only ever
 * as fresh as the last thing that wrote it: an upload nobody has touched is
 * still `pending` on disk long after its token stopped working. Nothing is
 * written here — a read that rewrote records would make `GET` a mutation — so
 * the stored status stays `pending` and the answer is still `expired`.
 */
export function asOf(record: UploadRecord, now: Date = new Date()): UploadRecord {
  return record.status === "pending" && grantIsOver(record, now)
    ? { ...record, status: "expired" }
    : record;
}

/**
 * Has the window closed? **Asked of `grantExpiresAt`, which is the issuer's own
 * number**, never of `mintedAt + GRANT_TTL_MS`.
 *
 * One function because the two callers must not disagree, and for a day they
 * did: this file recorded the issuer's expiry — exactly as the earlier review
 * asked, so that a sweep could not count from the wrong clock — and then
 * `claimUpload` went on deriving its own from `mintedAt`. `GET /api/uploads/:id`
 * would say `expired` while a claim still succeeded. Storing a value and then
 * not consuming it is worse than never storing it, because the doc says it is
 * used. GPT Sol, 2026-08-27.
 */
function grantIsOver(record: UploadRecord, now: Date): boolean {
  const ends = Date.parse(record.grantExpiresAt);
  /* An unparseable timestamp is a record we cannot reason about, and the safe
     reading of "I do not know when this expires" is "it has". `GRANT_TTL_MS` is
     the fallback bound, from the one thing we do know. */
  return Number.isFinite(ends)
    ? now.getTime() >= ends
    : grantExpired(new Date(record.mintedAt), now);
}

export interface MintedUpload {
  record: UploadRecord;
  /** Where the browser PUTs, token already in the query string. */
  url: string;
  expiresAt: string;
}

/**
 * Record an upload attempt and hand back the grant for it.
 *
 * The cap is checked **before** anything is minted, so an over-large file is
 * refused in a second rather than after a 50 MB transfer — and it is the cap in
 * src/uploads.ts, which is the same one the browser's file picker already used
 * to refuse it locally.
 */
export async function mintUpload(
  claim: { filename: string; bytes: number; sha256: string; owner: string },
  grant: (key: string) => Promise<{ url: string; expiresAt: string }>,
  stagingKeyFor: (id: string) => string,
): Promise<MintedUpload> {
  const record: UploadRecord = {
    id: crypto.randomUUID(),
    owner: claim.owner,
    filename: cleanFilename(claim.filename) ?? "document.pdf",
    claimedBytes: claim.bytes,
    claimedSha256: claim.sha256,
    status: "pending",
    mintedAt: new Date().toISOString(),
    // Overwritten by what the issuer actually says below. Only a placeholder so
    // the object is complete before the await.
    grantExpiresAt: new Date().toISOString(),
  };
  const signed = await grant(stagingKeyFor(record.id));
  record.grantExpiresAt = signed.expiresAt;
  await put(record);
  return { record, url: signed.url, expiresAt: signed.expiresAt };
}

/** Why a claim did not happen. Each one is a different sentence to the reader. */
export type ClaimFailure = "unknown" | "expired" | "taken";

/**
 * Take exclusive ownership of an upload, or say who got there first.
 *
 * The marker file is the decision — created before anything is read, so two
 * callers cannot both see `pending`. The record is then moved to `claimed` for
 * the benefit of anything that only reads the record.
 */
export async function claimUpload(
  id: string,
  options: { owner?: string; now?: Date } = {},
): Promise<{ ok: true; record: UploadRecord } | { ok: false; why: ClaimFailure }> {
  const now = options.now ?? new Date();
  const existing = await readUpload(id, options.owner);
  if (!existing) return { ok: false, why: "unknown" };
  if (existing.status !== "pending") return { ok: false, why: "taken" };
  if (grantIsOver(existing, now)) return { ok: false, why: "expired" };

  await mkdir(DIR, { recursive: true });
  try {
    await writeFile(claimFile(id), `${new Date().toISOString()}\n`, { flag: "wx" });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") return { ok: false, why: "taken" };
    throw err;
  }
  const claimed: UploadRecord = { ...existing, status: "claimed" };
  await put(claimed);
  return { ok: true, record: claimed };
}

/**
 * Move an upload to a terminal state.
 *
 * Refuses an illegal transition loudly rather than writing it, because the
 * whole value of `canTransition` is that it is consulted. A `verified` upload
 * being verified again is a bug in the caller, not a no-op to absorb.
 */
export async function settleUpload(
  id: string,
  to: UploadStatus,
  fields: Partial<Pick<UploadRecord, "sha256" | "bytes" | "reason" | "slug">> = {},
): Promise<UploadRecord | null> {
  const existing = await readUpload(id);
  if (!existing) return null;
  if (!canTransition(existing.status, to)) {
    throw new Error(`An upload cannot go from ${existing.status} to ${to}.`);
  }
  const next: UploadRecord = { ...existing, ...fields, status: to };
  await put(next);
  return next;
}

/**
 * Refuse an upload, and **say nothing if it is already refused.**
 *
 * `settleUpload` throws on an illegal transition on purpose, and that strictness
 * is right for the callers that are making a decision. This one is not: it is
 * the acquisition step recording a check that failed, and that step can run a
 * second time — a reader presses Retry, or `advanceJob` walks the list again —
 * over an upload it already rejected. Throwing there would replace a clear
 * "that file isn't a PDF" with a state-machine error about the state machine,
 * which tells the reader nothing and hides the real reason.
 *
 * Returns whether it wrote anything, so a caller that cares can tell a first
 * refusal from a repeat.
 */
export async function rejectUpload(id: string, reason: RejectReason): Promise<boolean> {
  const existing = await readUpload(id);
  if (!existing || !canTransition(existing.status, "rejected")) return false;
  await put({ ...existing, status: "rejected", reason });
  return true;
}

/** Note the article an upload became, without moving its state. */
export async function noteSlug(id: string, slug: string): Promise<void> {
  const existing = await readUpload(id);
  if (!existing) return;
  await put({ ...existing, slug });
}

/** Every record on disk, newest first. For the sweep, and for tests. */
export async function listUploads(): Promise<UploadRecord[]> {
  const names = await readdir(DIR).catch(() => [] as string[]);
  const records = await Promise.all(
    names
      .filter((n) => n.endsWith(".json"))
      .map((n) => readUpload(n.slice(0, -".json".length))),
  );
  return records
    .filter((r): r is UploadRecord => r !== null)
    .sort((a, b) => b.mintedAt.localeCompare(a.mintedAt));
}

/** Forget one attempt entirely. The staging object is somebody else's problem — see the sweep. */
export async function forgetUpload(id: string): Promise<void> {
  await unlink(recordFile(id)).catch(() => undefined);
  await unlink(claimFile(id)).catch(() => undefined);
}

/** Re-exported so a caller checking a claimed size does not import two modules to do it. */
export { MAX_UPLOAD_BYTES };
