/**
 * The two upload stores, asked the same questions.
 *
 * Two adapters exist so that a laptop and production behave the same, and the
 * only way that claim means anything is if one test file drives both. So every
 * case below runs twice, and the ones that matter are the ones where the two
 * implementations are genuinely *different code*:
 *
 * **The claim race.** Finalising has to be exactly once — two tabs, or one
 * double-click, otherwise both pass the same checks and both queue a job that
 * spends model money. The filesystem does it with a create-only marker
 * (`open(…, "wx")`, atomic at the kernel); Postgres does it with a conditional
 * `UPDATE` and `rowCount`. Same guarantee, no shared code, so the test has to be
 * shared instead.
 *
 * **The shape that comes back.** A row has `null` where a record has *nothing*,
 * and `UploadRecord`'s optional fields are checked with `!== undefined` all over
 * the app. A `null` leaking out of the Postgres adapter would read as present-
 * and-empty in some places and be serialised onto the wire in others, where the
 * client's own type says it cannot be. So the round-trip is asserted with
 * `toEqual` against an object that simply has no such key.
 *
 * See docs/plans/durable-queue-and-uploads.md.
 */
import { afterEach, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { loadEnvLocal } from "../src/env.js";
import { closeDb } from "../src/db/client.js";
import type { UploadRecord, UploadStore } from "../src/store/uploads.js";
import { fsUploadStore } from "../src/store/uploads-fs.js";
import { pgUploadStore } from "../src/store/pg-uploads.js";

loadEnvLocal();

/**
 * The probe runs at MODULE LOAD so the skip is a real vitest skip and the run
 * says "skipped" rather than showing a green tick for having checked nothing.
 * docs/reusable/silent-success.md.
 */
let pgReachable = false;
if (process.env.DATABASE_URL) {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: 10_000,
  });
  try {
    const probe = await pool.query("select to_regclass('spideryarn.uploads') is not null as ready");
    pgReachable = probe.rows[0]?.ready === true;
  } catch {
    pgReachable = false;
  }
  await pool.end();
}

/** The dev owner. A real `auth.users` row, because `uploads_owner_fk` is real. */
const OWNER = "00000000-0000-4000-8000-000000000001";
const STRANGER = "00000000-0000-4000-8000-0000000000ff";

const made: { store: UploadStore; id: string }[] = [];
afterEach(async () => {
  for (const { store, id } of made.splice(0)) await store.forget(id);
});

/** A minted-but-untouched record, whose id nothing else in the suite will use. */
function pending(store: UploadStore, over: Partial<UploadRecord> = {}): UploadRecord {
  const id = crypto.randomUUID();
  made.push({ store, id });
  return {
    id,
    owner: OWNER,
    filename: "paper.pdf",
    claimedBytes: 1234,
    claimedSha256: "a".repeat(64),
    status: "pending",
    mintedAt: new Date().toISOString(),
    grantExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
    ...over,
  };
}

const stores: [string, UploadStore, boolean][] = [
  ["the filesystem store", fsUploadStore, true],
  ["Postgres", pgUploadStore, pgReachable],
];

for (const [name, store, available] of stores) {
  describe.skipIf(!available)(name, () => {
    it("hands back exactly what it was given, with nothing turned into null", async () => {
      const record = pending(store);
      await store.create(record);
      const read = await store.read(record.id);
      expect(read).toEqual(record);
      /* Said twice on purpose. `toEqual` ignores an explicit `undefined`, so it
         would pass for a record carrying `sha256: undefined` — and the thing
         that must not happen is `null`, which `toEqual` would catch, and a key
         that exists at all, which it would not. */
      expect(read && "sha256" in read).toBe(false);
      expect(read && "slug" in read).toBe(false);
    });

    it("reads somebody else's upload as one that is not there", async () => {
      const record = pending(store);
      await store.create(record);
      expect(await store.read(record.id, OWNER)).not.toBeNull();
      expect(await store.read(record.id, STRANGER)).toBeNull();
    });

    it("refuses an id that is not an upload id, rather than looking for it", async () => {
      // The filesystem adapter turns an id into a path, so this is the guard
      // that stops `../../etc/passwd` being one. Postgres has no directories to
      // walk out of and answers the same way, which is what makes it parity.
      expect(await store.read("../../secrets")).toBeNull();
      expect(await store.read("")).toBeNull();
    });

    /**
     * **The one that matters.** Two callers, one winner, and the loser learns it
     * lost rather than overwriting the winner.
     *
     * Started together with `Promise.all` rather than one after the other,
     * because a sequential pair passes against a read-then-write that has a race
     * in it — which is exactly the implementation this is here to reject.
     */
    it("lets exactly one of two simultaneous claims win", async () => {
      const record = pending(store);
      await store.create(record);

      const both = await Promise.all([store.claim(record.id, {}), store.claim(record.id, {})]);
      expect(both.filter((r) => r.ok)).toHaveLength(1);
      const lost = both.find((r) => !r.ok);
      expect(lost && !lost.ok && lost.why).toBe("taken");
      expect((await store.read(record.id))?.status).toBe("claimed");
    });

    it("says which of the three reasons a claim failed", async () => {
      expect((await store.claim(crypto.randomUUID(), {})).ok).toBe(false);
      const missing = await store.claim(crypto.randomUUID(), {});
      expect(!missing.ok && missing.why).toBe("unknown");

      const stale = pending(store, {
        grantExpiresAt: new Date(Date.now() - 1000).toISOString(),
      });
      await store.create(stale);
      const late = await store.claim(stale.id, {});
      expect(!late.ok && late.why).toBe("expired");
      // And it did not move: a refused claim must not leave the record claimed.
      expect((await store.read(stale.id))?.status).toBe("pending");
    });

    it("will not claim somebody else's upload, and does not say it exists", async () => {
      const record = pending(store);
      await store.create(record);
      const theirs = await store.claim(record.id, { owner: STRANGER });
      expect(!theirs.ok && theirs.why).toBe("unknown");
      expect((await store.read(record.id))?.status).toBe("pending");
    });

    it("carries the evidence through a settle", async () => {
      const record = pending(store);
      await store.create(record);
      await store.claim(record.id, {});
      const done = await store.settle(record.id, "verified", {
        sha256: "b".repeat(64),
        bytes: 4321,
        slug: "paper",
      });
      expect(done).toMatchObject({
        status: "verified",
        sha256: "b".repeat(64),
        bytes: 4321,
        slug: "paper",
      });
      // `bytes` is a number on both sides. In Postgres it is `integer` rather
      // than `bigint` for exactly this reason: node-pg hands an int8 back as a
      // *string*, and every comparison downstream would quietly start lying.
      expect(typeof done?.bytes).toBe("number");
    });

    it("refuses an illegal transition loudly, and a missing record quietly", async () => {
      const record = pending(store);
      await store.create(record);
      // pending → verified skips the claim, which is the step that makes
      // finalising exactly once. Throwing is the point: a caller making this
      // decision has a bug, and absorbing it would hide it.
      await expect(store.settle(record.id, "verified", { sha256: "c".repeat(64), bytes: 1 }))
        .rejects.toThrow(/cannot go from pending to verified/);
      // A record that is not there is not a bug in the caller — it is a 404.
      expect(await store.settle(crypto.randomUUID(), "verified", {})).toBeNull();
    });

    it("refuses an upload once, and says nothing the second time", async () => {
      const record = pending(store);
      await store.create(record);
      await store.claim(record.id, {});
      expect(await store.reject(record.id, "not-a-pdf")).toBe(true);
      /* The acquisition step can run again — a reader presses Retry, or
         `advanceJob` walks the list once more — so a repeat has to be a quiet
         `false` rather than a state-machine error standing where "that file
         isn't a PDF" should be. */
      expect(await store.reject(record.id, "not-a-pdf")).toBe(false);
      expect((await store.read(record.id))?.reason).toBe("not-a-pdf");
    });

    it("notes the slug without moving the state", async () => {
      const record = pending(store);
      await store.create(record);
      await store.noteSlug(record.id, "some-article");
      expect(await store.read(record.id)).toMatchObject({
        slug: "some-article",
        status: "pending",
      });
    });

    it("lists newest first, and forgets one completely", async () => {
      const older = pending(store, { mintedAt: new Date(Date.now() - 60_000).toISOString() });
      const newer = pending(store);
      await store.create(older);
      await store.create(newer);

      const ids = (await store.list()).map((u) => u.id);
      expect(ids.indexOf(newer.id)).toBeLessThan(ids.indexOf(older.id));

      await store.forget(newer.id);
      expect(await store.read(newer.id)).toBeNull();
      /* Forgetting has to take the claim marker with it on the filesystem side,
         or a re-used id could never be claimed again. Nothing re-uses an id
         today; this is the assertion that keeps that from mattering. */
      await store.create({ ...newer, status: "pending" });
      expect((await store.claim(newer.id, {})).ok).toBe(true);
    });
  });
}

/** Shut the shared pool so vitest does not hang on an open handle. */
process.on("beforeExit", () => {
  void closeDb();
});
