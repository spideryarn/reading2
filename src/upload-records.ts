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
 * docs/plans/260827h-durable-queue-and-uploads.md.
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
import { cleanFilename } from "./source.js";
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
 * The upload store, bound here rather than in `src/store/index.ts`.
 *
 * To avoid an import cycle: `index.ts` imported `fs.ts`, which imported half the
 * app, and `src/pipeline.ts` — which calls this module from inside a step — is
 * in that half. `npm run check` gates on cycles, so that is a red build rather
 * than a note. This module imports one leaf adapter and closes nothing.
 *
 * It was `STORE === "postgres" ? pgUploadStore : fsUploadStore` until
 * 2026-09-05, when the filesystem store went.
 */
const store: UploadStore = pgUploadStore;

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

/**
 * Take exclusive ownership of an upload, or say who got there first.
 *
 * `arrived` — *the object is in Storage, and I have just looked* — suppresses
 * the grant-expiry refusal and nothing else. Only `POST /api/jobs` may pass it,
 * because only that route does the `head` that makes it true. See
 * `UploadStore.claim` for why the expiry has nothing left to protect once it is.
 */
export function claimUpload(
  id: string,
  options: { owner?: string; now?: Date; arrived?: boolean } = {},
): Promise<ClaimResult> {
  return store.claim(id, options);
}

/**
 * **The reader pressed Stop, and the server is told.**
 *
 * `pending → expired`, which the state machine already allows (`NEXT` in
 * src/source.ts) and which is the honest name for what has happened: this
 * upload's grant is over as far as we are concerned, and nothing will ever be
 * made from it.
 *
 * Without it, Stop was a client-side fact and nothing more, and two things
 * followed. A reload of `/add/upload/<id>` after a Stop found a `pending` record
 * with no object and sat there **polling for the two hours of the grant**,
 * telling the reader their file was still on its way — measured in a browser on
 * 2026-09-03. And a Stop pressed after the object had quietly landed (the
 * ambiguous-completion case `retry` exists for) left a record a second tab could
 * still queue, so *"nothing was added"* was not a claim we were entitled to
 * make. GPT Sol, finding 2.
 *
 * **It races `claimUpload`, and the store decides.** `settle` refuses an illegal
 * transition, so an upload already `claimed` by a queue request that got there
 * first stays claimed and this answers false — the ingest wins, which is right:
 * the Stop arrived after the thing it was trying to stop. The caller reports
 * that as *too late*, not as an error.
 */
export async function cancelUpload(id: string, owner: string): Promise<boolean> {
  const record = await store.read(id, owner);
  /* Somebody else's upload, or none — `read` answers null for both, and a
     stranger learns nothing either way. */
  if (record?.status !== "pending") return false;
  try {
    await store.settle(id, "expired", {});
    return true;
  } catch {
    /* The claim won the race in the moment between the read and the settle.
       Not an error: the ingest is under way and the reader will see it. */
    return false;
  }
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
 * **True unconditionally since 2026-09-05**, and kept rather than deleted along
 * with the branch. It read `STORE === "postgres" || !process.env.VERCEL`, and
 * with one store the first half is always true. What it names is a real
 * precondition of `POST /api/uploads` — src/routes.ts answers 503 on it — and a
 * question the answer to which is *"yes, because the store is durable"* is worth
 * a function rather than a deleted line: the day something makes it false again,
 * there is one place to say so. Tightening it out of existence is stage H.
 */
export function recordsSurviveTheRequest(): boolean {
  return true;
}
