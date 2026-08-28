/**
 * **One upload attempt, written down** — from the grant we mint to the bytes we
 * verified, or the reason we would not take them.
 *
 * This file used to *be* the filesystem implementation. It is now the seam: the
 * functions the rest of the app calls, over whichever
 * [`UploadStore`](store/uploads.ts) is live. The move happened because minting a
 * grant and queueing the job are **two HTTP requests**, and on a serverless host
 * they may not run on the same machine — so a record on a function's local disk
 * is one the second request cannot find. See
 * docs/plans/durable-queue-and-uploads.md.
 *
 * ## What did not move, and why that is the point
 *
 * The state machine. `canTransition`, `grantExpired` and `sweepable` are in
 * [`src/source.ts`](source.ts) and know nothing about where a record is kept —
 * which is what made this a change of adapter rather than a change of rules. It
 * was written that way before either adapter existed, on the reasoning that the
 * day it stops being trivial is the day it matters.
 *
 * ## What each adapter has to get right
 *
 * Finalising is **exactly once**: two tabs, or one impatient double-click,
 * otherwise both pass the same checks and both queue a job that spends model
 * money. On the filesystem that needs a create-only marker beside the record;
 * in Postgres it is one conditional `UPDATE`. Both are in the adapters, and
 * `tests/store-uploads-parity.test.ts` runs the same race against each.
 */
import type { RejectReason, UploadStatus } from "./source.js";
import { STORE } from "./store/live.js";
import { cleanFilename } from "./source.js";
import { fsUploadStore } from "./store/uploads-fs.js";
import { pgUploadStore } from "./store/pg-uploads.js";
import {
  type ClaimResult,
  type SettleFields,
  type UploadRecord,
  type UploadStore,
  grantIsOver,
} from "./store/uploads.js";

export type { ClaimFailure, UploadRecord } from "./store/uploads.js";
export { isUploadId } from "./store/uploads.js";

/**
 * Which store is live.
 *
 * Selected here rather than in `src/store/index.ts` for the reason that file's
 * neighbour [`live.ts`](store/live.ts) gives about itself: `index.ts` imports
 * `fs.ts`, which imports half the app, and `src/pipeline.ts` — which calls this
 * module from inside a step — is in that half. `npm run check` gates on cycles,
 * so that is a red build rather than a note. This module imports two leaf
 * adapters and the flag, and closes nothing.
 */
const store: UploadStore = STORE === "postgres" ? pgUploadStore : fsUploadStore;

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
  const id = crypto.randomUUID();
  /* **The grant is minted before the row is written**, and that order matters:
     an issuer that refuses leaves nothing behind, where the other order leaves a
     `pending` record for an upload that can never happen and a sweep to notice
     it. The row carries what the issuer said its expiry was, never our own
     arithmetic over `mintedAt`. */
  const signed = await grant(stagingKeyFor(id));
  const record: UploadRecord = {
    id,
    owner: claim.owner,
    filename: cleanFilename(claim.filename) ?? "document.pdf",
    claimedBytes: claim.bytes,
    claimedSha256: claim.sha256,
    status: "pending",
    mintedAt: new Date().toISOString(),
    grantExpiresAt: signed.expiresAt,
  };
  await store.create(record);
  return { record, url: signed.url, expiresAt: signed.expiresAt };
}

/** **Somebody else's upload reads as one that is not there** — see `UploadStore.read`. */
export function readUpload(id: string, owner?: string): Promise<UploadRecord | null> {
  return store.read(id, owner);
}

/**
 * The record as a caller may see it, with the grant's expiry applied.
 *
 * **Asked of the grant rather than of the row**, because the row is only ever as
 * fresh as the last thing that wrote it: an upload nobody has touched is still
 * `pending` long after its token stopped working. Nothing is written here — a
 * read that rewrote records would make `GET` a mutation — so the stored status
 * stays `pending` and the answer is still `expired`.
 */
export function asOf(record: UploadRecord, now: Date = new Date()): UploadRecord {
  return record.status === "pending" && grantIsOver(record, now)
    ? { ...record, status: "expired" }
    : record;
}

/** Take exclusive ownership of an upload, or say who got there first. */
export function claimUpload(
  id: string,
  options: { owner?: string; now?: Date } = {},
): Promise<ClaimResult> {
  return store.claim(id, options);
}

/** Move an upload to a terminal state, refusing an illegal transition loudly. */
export function settleUpload(
  id: string,
  to: UploadStatus,
  fields: SettleFields = {},
): Promise<UploadRecord | null> {
  return store.settle(id, to, fields);
}

/** Refuse an upload, and say nothing if it is already refused. */
export function rejectUpload(id: string, reason: RejectReason): Promise<boolean> {
  return store.reject(id, reason);
}

/** Note the article an upload became, without moving its state. */
export function noteSlug(id: string, slug: string): Promise<void> {
  return store.noteSlug(id, slug);
}

/** Every record, newest first. For the sweep, and for tests. */
export function listUploads(): Promise<UploadRecord[]> {
  return store.list();
}

/** Forget one attempt entirely. The staging object is left alone — see the sweep. */
export function forgetUpload(id: string): Promise<void> {
  return store.forget(id);
}

/**
 * **Can a record written by one request be read by the next one?**
 *
 * A property of the *store*, not of the host — which is the correction this
 * function needed. It used to ask `!process.env.VERCEL`, which was right about
 * the only two cases that existed then and wrong as a rule: what makes an
 * upload work is a store that outlives the request, and Postgres is that
 * wherever it runs.
 *
 * Deliberately **not** keyed on "is the filesystem writable" — it is, on Vercel,
 * and that is precisely what makes the failure quiet. The refusal happens at the
 * door rather than three minutes into an 11 MB upload, which is the difference
 * between a limitation and [a silent success](../docs/reusable/silent-success.md).
 *
 * **This staying true is not the same as uploading working.** The pipeline's
 * stages still write `data/<slug>/*.json`, so an upload that got past this on a
 * serverless host would still fail at the first step boundary — the artefacts
 * have to move too. docs/plans/durable-queue-and-uploads.md § The dependency.
 */
export function recordsSurviveTheRequest(): boolean {
  return STORE === "postgres" || !process.env.VERCEL;
}
