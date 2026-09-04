/**
 * One upload attempt's life — src/upload-records.ts, over the rules in
 * src/source.ts.
 *
 * Three things here are worth more than the rest, and each of them is a bug
 * that would only show up under a real reader:
 *
 *  - **claiming is exactly once**, so a double-clicked button does not queue two
 *    jobs and pay for two transcriptions;
 *  - **an expired grant reads as expired without the record being rewritten**,
 *    so polling cannot quietly be a mutation;
 *  - **refusing an already-refused upload is silent**, because the acquisition
 *    step really can run twice and a state-machine error there would replace
 *    "that file isn't a PDF" with something about state machines.
 *
 * These used to write into the real `data/_uploads/`, the way the queue's own
 * tests wrote into `data/_jobs/`. They now write `spideryarn.uploads` rows —
 * stage B of
 * docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md
 * — and the three claims above are the better for it, because each of them is a
 * *different implementation* on this side: the exactly-once claim is a
 * conditional `UPDATE` and its `rowCount` where the filesystem had a create-only
 * marker, and the expiry is a `timestamptz` comparison where it had a JSON
 * field. `tests/store-uploads-parity.test.ts` is where the two adapters are held
 * to one contract; this file is the seam above them, on the store that is
 * staying. They still clean up after themselves by id.
 *
 * ## The mutations, watched rather than reasoned — 2026-09-04
 *
 * One per claim above, because the three are three different mechanisms on this
 * side and a mutation of one says nothing about the others. All three in
 * `src/store/pg-uploads.ts`; all three red.
 *
 * **1 — exactly once.** `claim`: `const conditions = [eq(uploads.id, id),
 * eq(uploads.status, "pending")];` made `const conditions = [eq(uploads.id,
 * id)];` — the conditional `UPDATE` left with no precondition, so both racers
 * win the row. **1 failed of 12**: *lets exactly one of two simultaneous
 * callers through*, `expected [ true, true ] to have a length of 1 but got 2`.
 * Only that one. *says which of the three ways it failed* stays green because
 * it only exercises `unknown` and `expired`; **`taken` is asserted in exactly
 * one place in this file**, and it is the line this mutation broke.
 *
 * **2 — the grant's own clock.** `claim`, the expiry clause deleted:
 * `conditions.push(lt(sql`${now}::timestamptz`, uploads.grantExpiresAt));`
 * removed, so an expired grant still claims. **2 failed of 12** — *says which
 * of the three ways it failed* and *expires a claim on the grant's own clock,
 * not on ours*, both `expected false to be 'expired'`.
 *
 * **3 — a repeat refusal is silent.** `reject`: `return moved.length === 1;`
 * made `if (moved.length !== 1) throw new IllegalTransition("rejected",
 * "rejected"); return true;` — the state-machine error the method exists to
 * absorb. **1 failed of 12**: *swallows a second refusal of the same upload*.
 *
 * **What the three do not cover.** They reach `claim` and `reject` and leave
 * `settle` almost untouched: `sourcesFor` decides every legal transition and
 * nothing above perturbs that table, so *refuses a transition the state machine
 * does not allow* rests on one direction of one edge. Mutation 1 removed the
 * *status* precondition and not the **owner** one beside it — `eq(uploads
 * .ownerId, options.owner)` is only ever asserted through *will not hand
 * somebody else's upload over*, which claims a fresh record and would survive a
 * `WHERE` that had lost its status clause. And none of the three touches
 * `asOf`, which is pure and store-blind: *reports an expired grant without
 * rewriting the record* is a claim about a `GET` not writing, and no mutation
 * of the adapter's read path was run against it.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * `SPIDERYARN_STORE=postgres` before **any** import.
 *
 * `src/upload-records.ts` picks its adapter **once, at module load** — `const
 * store: UploadStore = STORE === "postgres" ? pgUploadStore : fsUploadStore` —
 * and imports are hoisted above every statement in a module, so a plain
 * assignment here would leave every case below on the filesystem records with
 * nothing saying so.
 */
const HOISTED = vi.hoisted(() => {
  const previousStore = process.env.SPIDERYARN_STORE;
  process.env.SPIDERYARN_STORE = "postgres";
  return { previousStore };
});

import { closeDb, getDb } from "../src/db/client.js";
import { loadEnvLocal } from "../src/env.js";
import { GRANT_TTL_MS, stagingKey } from "../src/source.js";
import { STORE } from "../src/store/live.js";
import {
  asOf,
  claimUpload,
  forgetUpload,
  isUploadId,
  mintUpload,
  readUpload,
  rejectUpload,
  settleUpload,
} from "../src/upload-records.js";
import { pgReady } from "./helpers/pg-ready.js";
import { seedAuthUser } from "./helpers/seed-auth-user.js";

/* Put the flag back straight after the imports: vitest reuses a worker across
   files and does not reset `process.env` between them. */
if (HOISTED.previousStore === undefined) delete process.env.SPIDERYARN_STORE;
else process.env.SPIDERYARN_STORE = HOISTED.previousStore;

loadEnvLocal();

const { reachable } = await pgReady({
  suite: "tests/upload-records.test.ts",
  tables: ["spideryarn.uploads"],
});

const when = reachable ? describe : describe.skip;

describe("the store these tests are actually talking to", () => {
  it("is the Postgres one", () => {
    /* Not gated on `reachable`: a control that vanishes when the database is
       missing vanishes exactly when it matters. The filesystem records answer
       every call below perfectly happily, and every claim this file makes would
       then be a claim about the adapter being deleted. */
    expect(STORE).toBe("postgres");
  });
});

const made: string[] = [];
afterEach(async () => {
  for (const id of made.splice(0)) await forgetUpload(id);
});

afterAll(async () => {
  if (reachable) await closeDb();
});

/** A stand-in issuer. The real one is Supabase; nothing here is about Supabase. */
function issuer(ttlMs = GRANT_TTL_MS) {
  return async (key: string) => ({
    url: `https://storage.test/${key}?token=x`,
    expiresAt: new Date(Date.now() + ttlMs).toISOString(),
  });
}

/**
 * **The reader whose uploads these are**, and a real `auth.users` row since the
 * move: `uploads.owner_id` carries a foreign key, so a made-up uuid fails the
 * *insert* rather than anything under test, and every case here would then fail
 * the same way and prove nothing.
 *
 * `SOMEBODY_ELSE` is deliberately **not** seeded. It is only ever a *reader* —
 * the two cases below ask for and try to claim an upload as him — so it never
 * reaches the writing side of a foreign key, exactly as `STRANGER` does in
 * tests/store-uploads-parity.test.ts. `tests/store-migration-registry.ts` §
 * `OWNER_AUDIT` carries the verdict for both.
 */
const READER = "11111111-1111-4111-8111-111111111111";
const SOMEBODY_ELSE = "22222222-2222-4222-8222-222222222222";

beforeAll(async () => {
  if (!reachable) return;
  await seedAuthUser(getDb(), {
    id: READER,
    email: "upload-records-reader@spideryarn.local",
    onConflictDoNothing: true,
  });
});

async function mint(filename = "paper.pdf", ttlMs = GRANT_TTL_MS) {
  const minted = await mintUpload(
    { filename, bytes: 1024, sha256: "a".repeat(64), owner: READER },
    issuer(ttlMs),
    stagingKey,
  );
  made.push(minted.record.id);
  return minted;
}

when("minting an upload", () => {
  it("gives it an id of ours and a grant for a key derived from that id", async () => {
    const minted = await mint();
    expect(isUploadId(minted.record.id)).toBe(true);
    expect(minted.url).toContain(`staging/${minted.record.id}`);
    expect(minted.record.status).toBe("pending");
  });

  /**
   * The filename is a stranger's string. It is kept to show the reader and it
   * is never part of a key — `stagingKey` is built from the id alone, so this
   * is belt and braces on `cleanFilename` rather than the only guard.
   */
  it("cleans the name it was given and keeps the path out of it", async () => {
    const minted = await mint("../../etc/passwd.pdf");
    expect(minted.record.filename).toBe("passwd.pdf");
    expect(minted.url).not.toContain("passwd");
  });

  /**
   * **The expiry comes from the issuer, not from our clock.** Sol's correction:
   * a record's creation time can precede the token's `iat`, so counting from
   * `mintedAt` counts from the wrong clock — and a sweep that deletes an object
   * while a grant over its key is live *re-arms* that grant.
   */
  it("records the expiry the issuer stated rather than deriving one", async () => {
    const minted = await mintUpload(
      { filename: "a.pdf", bytes: 10, sha256: "b".repeat(64), owner: READER },
      issuer(60_000),
      stagingKey,
    );
    made.push(minted.record.id);
    const stated = Date.parse(minted.record.grantExpiresAt) - Date.now();
    expect(stated).toBeGreaterThan(30_000);
    expect(stated).toBeLessThan(GRANT_TTL_MS / 2);
  });
});

when("claiming", () => {
  /**
   * The one that costs money if it is wrong. Two callers, no awaits between
   * them, and exactly one may win — which is why the decision is a single
   * conditional `UPDATE` and its `rowCount`, rather than a read of the record
   * followed by a write of it. (On the filesystem records it was a create-only
   * marker, atomic at the kernel; same guarantee, no shared code, which is what
   * tests/store-uploads-parity.test.ts exists to keep honest.)
   */
  it("lets exactly one of two simultaneous callers through", async () => {
    const { record } = await mint();
    const [a, b] = await Promise.all([claimUpload(record.id), claimUpload(record.id)]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    const loser = a.ok ? b : a;
    expect(loser.ok === false && loser.why).toBe("taken");
    expect((await readUpload(record.id))?.status).toBe("claimed");
  });

  it("says which of the three ways it failed", async () => {
    const missing = await claimUpload("00000000-0000-4000-8000-000000000000");
    expect(missing.ok === false && missing.why).toBe("unknown");

    const { record } = await mint();
    const late = await claimUpload(record.id, { now: new Date(Date.now() + GRANT_TTL_MS + 1000) });
    expect(late.ok === false && late.why).toBe("expired");
  });

  /**
   * **A short grant, so this fails if the check goes back to `mintedAt + TTL`.**
   *
   * The version of this test that advanced by the full `GRANT_TTL_MS` stayed
   * green either way, which is exactly what let the two disagree for a day:
   * `grantExpiresAt` was recorded, `asOf` read it, and `claimUpload` quietly
   * derived its own from our clock. Sixty seconds and sixty-one is the only
   * gap that can tell them apart.
   */
  it("expires a claim on the grant's own clock, not on ours", async () => {
    const { record } = await mint("short.pdf", 60_000);
    const late = await claimUpload(record.id, { now: new Date(Date.now() + 61_000) });
    expect(late.ok === false && late.why).toBe("expired");
    expect(asOf(record, new Date(Date.now() + 61_000)).status).toBe("expired");
  });

  /**
   * Not-yours reads as not-found, deliberately: telling a stranger that an id
   * exists but is not theirs is telling them the id exists. It decides nothing
   * today — one owner, and a shelf that is not owner-filtered either — and the
   * day it stops being trivial is the day it matters.
   */
  it("will not hand somebody else's upload over, or let them claim it", async () => {
    const { record } = await mint();
    expect(await readUpload(record.id, SOMEBODY_ELSE)).toBeNull();
    const stolen = await claimUpload(record.id, { owner: SOMEBODY_ELSE });
    expect(stolen.ok === false && stolen.why).toBe("unknown");
    /* And the real reader is unaffected — a refused claim must not have taken
       the one claim there is. */
    expect((await claimUpload(record.id, { owner: READER })).ok).toBe(true);
  });
});

when("what a reader is told about an upload", () => {
  /**
   * A record nobody has touched is still `pending` on disk long after its token
   * stopped working. `asOf` answers about the *grant* — and writes nothing, so
   * a `GET` stays a `GET`.
   */
  it("reports an expired grant without rewriting the record", async () => {
    const minted = await mintUpload(
      { filename: "a.pdf", bytes: 10, sha256: "c".repeat(64), owner: READER },
      async (key) => ({ url: `https://x.test/${key}`, expiresAt: new Date(Date.now() - 1).toISOString() }),
      stagingKey,
    );
    made.push(minted.record.id);
    expect(asOf(minted.record).status).toBe("expired");
    expect((await readUpload(minted.record.id))?.status).toBe("pending");
  });
});

when("settling", () => {
  it("refuses a transition the state machine does not allow", async () => {
    const { record } = await mint();
    await expect(settleUpload(record.id, "verified")).rejects.toThrow(/cannot go from pending/);
  });

  it("records our hash on the way to verified, not the claimed one", async () => {
    const { record } = await mint();
    await claimUpload(record.id);
    const ours = "d".repeat(64);
    await settleUpload(record.id, "verified", { sha256: ours, bytes: 99, slug: "paper" });
    const read = await readUpload(record.id);
    expect(read?.sha256).toBe(ours);
    expect(read?.claimedSha256).toBe("a".repeat(64));
    expect(read?.slug).toBe("paper");
  });

  /**
   * The acquisition step can run twice — Retry, or `advanceJob` walking the
   * list again — and a second refusal must be a no-op rather than an error
   * about the state machine, which would hide the reason the reader needs.
   */
  it("swallows a second refusal of the same upload", async () => {
    const { record } = await mint();
    await claimUpload(record.id);
    expect(await rejectUpload(record.id, "not-a-pdf")).toBe(true);
    expect(await rejectUpload(record.id, "not-a-pdf")).toBe(false);
    expect((await readUpload(record.id))?.reason).toBe("not-a-pdf");
  });
});
