/**
 * Upload records as files under `data/_uploads/`, which is where they lived
 * before there was a seam.
 *
 * Lifted out of `src/upload-records.ts` rather than rewritten, so that a laptop
 * with no database behaves exactly as it did — including the two pieces of it
 * that are easy to mistake for incidental:
 *
 * **The claim is a create-only marker, not a read-then-write.** Finalising has
 * to be exactly once, and reading the record, seeing `pending` and writing
 * `claimed` has a gap in it that is however long the two awaits take.
 * `open(…, "wx")` is atomic at the kernel and works across *processes* rather
 * than only across the awaits in one, and losing the race is `EEXIST` — a
 * definite answer rather than a probable one. The Postgres adapter needs none
 * of this, which is the clearest single argument for the move.
 *
 * **Write, then rename.** A half-written record parses as nothing and takes the
 * account of what happened with it, which is worse than a missing one.
 */

import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { type RejectReason, type UploadStatus, canTransition } from "../source.js";
import {
  type ClaimResult,
  type SettleFields,
  type UploadRecord,
  type UploadStore,
  IllegalTransition,
  grantIsOver,
  isUploadId,
} from "./uploads.js";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const DIR = path.join(ROOT, "data", "_uploads");

function recordFile(id: string): string {
  /* `id` is a UUID we minted, and every caller reaching this has been through
     `isUploadId` — but this is the function that turns a string into a path, so
     it is the function that has to be sure. */
  if (!isUploadId(id)) throw new Error(`Not an upload id: ${JSON.stringify(id)}`);
  return path.join(DIR, `${id}.json`);
}

const claimFile = (id: string) => `${recordFile(id)}.claim`;

async function put(record: UploadRecord): Promise<void> {
  await mkdir(DIR, { recursive: true });
  const tmp = `${recordFile(record.id)}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  await rename(tmp, recordFile(record.id));
}

async function read(id: string, owner?: string): Promise<UploadRecord | null> {
  if (!isUploadId(id)) return null;
  let record: UploadRecord;
  try {
    record = JSON.parse(await readFile(recordFile(id), "utf8")) as UploadRecord;
  } catch {
    return null;
  }
  // Somebody else's reads as one that is not there — see `UploadStore.read`.
  if (owner !== undefined && record.owner !== owner) return null;
  return record;
}

export const fsUploadStore: UploadStore = {
  read,

  async create(record: UploadRecord): Promise<void> {
    await put(record);
  },

  async claim(id: string, options: { owner?: string; now?: Date } = {}): Promise<ClaimResult> {
    const now = options.now ?? new Date();
    const existing = await read(id, options.owner);
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
    /* The marker is the decision. The record then moves to `claimed` for the
       benefit of anything that only reads the record — the API, the sweep — and
       the two can disagree for the length of one await, which is why nothing
       treats the record's status as the lock. */
    const claimed: UploadRecord = { ...existing, status: "claimed" };
    await put(claimed);
    return { ok: true, record: claimed };
  },

  async settle(
    id: string,
    to: UploadStatus,
    fields: SettleFields = {},
  ): Promise<UploadRecord | null> {
    const existing = await read(id);
    if (!existing) return null;
    if (!canTransition(existing.status, to)) {
      throw new IllegalTransition(existing.status, to);
    }
    const next: UploadRecord = { ...existing, ...fields, status: to };
    await put(next);
    return next;
  },

  async reject(id: string, reason: RejectReason): Promise<boolean> {
    const existing = await read(id);
    if (!existing || !canTransition(existing.status, "rejected")) return false;
    await put({ ...existing, status: "rejected", reason });
    return true;
  },

  async noteSlug(id: string, slug: string): Promise<void> {
    const existing = await read(id);
    if (!existing) return;
    await put({ ...existing, slug });
  },

  async list(): Promise<UploadRecord[]> {
    const names = await readdir(DIR).catch(() => [] as string[]);
    const records = await Promise.all(
      names.filter((n) => n.endsWith(".json")).map((n) => read(n.slice(0, -".json".length))),
    );
    return records
      .filter((r): r is UploadRecord => r !== null)
      .sort((a, b) => b.mintedAt.localeCompare(a.mintedAt));
  },

  async forget(id: string): Promise<void> {
    await unlink(recordFile(id)).catch(() => undefined);
    await unlink(claimFile(id)).catch(() => undefined);
  },
};
