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
 * These write into the real `data/_uploads/`, the way the queue's own tests
 * write into `data/_jobs/`, and clean up after themselves by id.
 */
import { afterEach, describe, expect, it } from "vitest";
import { GRANT_TTL_MS, stagingKey } from "../src/source.js";
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

const made: string[] = [];
afterEach(async () => {
  for (const id of made.splice(0)) await forgetUpload(id);
});

/** A stand-in issuer. The real one is Supabase; nothing here is about Supabase. */
function issuer(ttlMs = GRANT_TTL_MS) {
  return async (key: string) => ({
    url: `https://storage.test/${key}?token=x`,
    expiresAt: new Date(Date.now() + ttlMs).toISOString(),
  });
}

const READER = "11111111-1111-4111-8111-111111111111";
const SOMEBODY_ELSE = "22222222-2222-4222-8222-222222222222";

async function mint(filename = "paper.pdf", ttlMs = GRANT_TTL_MS) {
  const minted = await mintUpload(
    { filename, bytes: 1024, sha256: "a".repeat(64), owner: READER },
    issuer(ttlMs),
    stagingKey,
  );
  made.push(minted.record.id);
  return minted;
}

describe("minting an upload", () => {
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

describe("claiming", () => {
  /**
   * The one that costs money if it is wrong. Two callers, no awaits between
   * them, and exactly one may win — which is why the decision is a create-only
   * file rather than a read of the record followed by a write of it.
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

describe("what a reader is told about an upload", () => {
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

describe("settling", () => {
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
