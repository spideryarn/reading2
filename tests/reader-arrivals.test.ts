/**
 * **An account is announced once, on its first request, and an account that
 * existed before the ledger never is.** src/arrivals.ts and
 * drizzle/20260930144303_reader_arrivals.sql.
 *
 * Against a real database, because one current claimant across the fleet is a
 * property of the primary key and `on conflict do nothing returning` — a fake
 * `record` would be testing itself.
 *
 * docs/plans/260930i-email-admin-on-sign-up-and-plan-upgrade.md.
 */
import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { forgetKnownArrivals, noteArrival } from "../src/arrivals.js";
import type { Verifier } from "../src/auth.js";
import type { SendResult } from "../src/email.js";
import { loadEnvLocal } from "../src/env.js";
import { handleApi } from "../src/routes.js";
import { pgReady } from "./helpers/pg-ready.js";
import { seedAuthUser } from "./helpers/seed-auth-user.js";

loadEnvLocal();

const { pool } = await pgReady({
  suite: "tests/reader-arrivals.test.ts",
  tables: ["spideryarn.reader_arrivals"],
  keepPool: true,
  max: 2,
});

const NEWCOMER = "a441e0a1-0000-4000-8000-0000000000a1";
const OLD_HAND = "a441e0a1-0000-4000-8000-0000000000a2";
const SENT: SendResult = { kind: "sent", id: null };

/** An `announce` that writes down whom it announced and answers `result`. */
function announcer(into: string[], result: SendResult = SENT): (id: string) => Promise<SendResult> {
  return async (id) => {
    into.push(id);
    return result;
  };
}

beforeAll(async () => {
  if (!pool) return;
  await seedAuthUser(pool, { id: NEWCOMER, email: "arrivals-new@example.invalid" });
  await seedAuthUser(pool, { id: OLD_HAND, email: "arrivals-old@example.invalid" });
});

beforeEach(async () => {
  forgetKnownArrivals();
  await pool?.query("delete from spideryarn.reader_arrivals where owner_id = any($1)", [
    [NEWCOMER, OLD_HAND],
  ]);
});

afterAll(async () => {
  if (!pool) return;
  await pool.query("delete from auth.users where id = any($1)", [[NEWCOMER, OLD_HAND]]).catch(() => {});
  await pool.end();
});

describe.skipIf(!pool)("noteArrival", () => {
  it("announces an account's first request, and only that one", async () => {
    const announced: string[] = [];
    const announce = announcer(announced);

    await noteArrival(NEWCOMER, { announce });
    expect(announced).toEqual([NEWCOMER]);

    /* The same instance again: the cache answers. */
    await noteArrival(NEWCOMER, { announce });
    /* Another instance, which has never seen them: the ledger answers. */
    forgetKnownArrivals();
    await noteArrival(NEWCOMER, { announce });
    expect(announced).toEqual([NEWCOMER]);
  });

  it("two instances racing announce once", async () => {
    const announced: string[] = [];
    const announce = announcer(announced);
    await Promise.all([noteArrival(NEWCOMER, { announce }), noteArrival(NEWCOMER, { announce })]);
    expect(announced).toEqual([NEWCOMER]);
  });

  it("a failed insert neither throws nor is remembered, so the next request asks again", async () => {
    const announced: string[] = [];
    const announce = announcer(announced);
    await expect(
      noteArrival(NEWCOMER, {
        record: async () => {
          throw new Error("database down");
        },
        announce,
      }),
    ).resolves.toBeUndefined();
    expect(announced).toEqual([]);

    await noteArrival(NEWCOMER, { announce });
    expect(announced).toEqual([NEWCOMER]);
  });

  it("a failed announcement does not throw", async () => {
    await expect(
      noteArrival(NEWCOMER, {
        announce: async () => {
          throw new Error("Resend down");
        },
      }),
    ).resolves.toBeUndefined();
  });

  /**
   * **A mail that did not go out is tried again on the next request.**
   * `sendEmail` never throws, so a Resend outage arrives as a value; ignoring it
   * left the row in place and that reader was never announced.
   * SPIDERYARN-READING2-79, docs/plans/261001b.
   */
  const undelivered: ReadonlyArray<[string, () => Promise<SendResult>]> = [
    ["Resend fails", async () => ({ kind: "failed", reason: "Resend answered 503" })],
    [
      "the announcement throws",
      async () => {
        throw new Error("Resend down");
      },
    ],
    ["production has no key", async () => ({ kind: "skipped", reason: "no RESEND_API_KEY" })],
  ];
  for (const [what, announceOnce] of undelivered) {
    it(`gives the claim back when ${what}, so the next request announces`, async () => {
      await noteArrival(NEWCOMER, { announce: announceOnce });
      expect(await arrived()).toBe(false);

      const announced: string[] = [];
      await noteArrival(NEWCOMER, { announce: announcer(announced) });
      expect(announced).toEqual([NEWCOMER]);
      expect(await arrived()).toBe(true);
    });
  }

  it("keeps the claim when the mail was skipped because this is not production", async () => {
    const announced: string[] = [];
    const announce = announcer(announced, { kind: "skipped", reason: "not production" });
    await noteArrival(NEWCOMER, { announce });
    forgetKnownArrivals();
    await noteArrival(NEWCOMER, { announce });
    expect(announced).toEqual([NEWCOMER]);
  });

  it("keeps overlapping requests cached until the failed announcement's claim is released", async () => {
    let markReleaseStarted = () => {};
    const releaseStarted = new Promise<void>((resolve) => {
      markReleaseStarted = resolve;
    });
    let allowRelease = () => {};
    const releaseAllowed = new Promise<void>((resolve) => {
      allowRelease = resolve;
    });

    const first = noteArrival(NEWCOMER, {
      announce: async () => ({ kind: "failed", reason: "Resend answered 503" }),
      release: async (ownerId) => {
        markReleaseStarted();
        await releaseAllowed;
        await pool!.query("delete from spideryarn.reader_arrivals where owner_id = $1", [ownerId]);
      },
    });
    await releaseStarted;

    /* This arrives while the failed sender still owns the ledger row. It must
       not re-cache that row immediately before the release deletes it. */
    const announced: string[] = [];
    await noteArrival(NEWCOMER, { announce: announcer(announced) });
    allowRelease();
    await first;

    await noteArrival(NEWCOMER, { announce: announcer(announced) });
    expect(announced).toEqual([NEWCOMER]);
  });

  it("a release that fails does not throw", async () => {
    await expect(
      noteArrival(NEWCOMER, {
        announce: async () => ({ kind: "failed", reason: "Resend answered 503" }),
        release: async () => {
          throw new Error("database down");
        },
      }),
    ).resolves.toBeUndefined();

    let askedAgain = false;
    await noteArrival(NEWCOMER, {
      record: async () => {
        askedAgain = true;
        return false;
      },
    });
    expect(askedAgain).toBe(true);
  });
});

describe.skipIf(!pool)("the migration's backfill", () => {
  /**
   * Private test databases seed their accounts after migrating, so running the
   * migration does not exercise this statement. Run it here, against an
   * account that exists and has no row. GPT Sol, plan review.
   */
  const sql = readFileSync(
    new URL("../drizzle/20260930144303_reader_arrivals.sql", import.meta.url),
    "utf8",
  );
  const backfill = sql.slice(sql.indexOf('INSERT INTO "spideryarn"."reader_arrivals"'));

  it("marks every existing account as already arrived, so none is announced", async () => {
    expect(backfill).toMatch(/^INSERT INTO[\s\S]*FROM "auth"."users"[\s\S]*DO NOTHING;\s*$/);
    /* Hosted auth rows are allowed to lack this timestamp. The ledger's column
       is not, so the migration must supply one rather than fail the deploy. */
    await pool!.query("update auth.users set created_at = null where id = $1", [OLD_HAND]);
    await pool!.query(backfill);

    const announced: string[] = [];
    await noteArrival(OLD_HAND, { announce: announcer(announced) });
    expect(announced).toEqual([]);
    const { rows } = await pool!.query(
      "select first_seen_at from spideryarn.reader_arrivals where owner_id = $1",
      [OLD_HAND],
    );
    expect(rows[0]?.first_seen_at).toBeInstanceOf(Date);

    /* Twice is harmless: it is how a re-run would behave. */
    await pool!.query(backfill);
  });
});

/* ----------------------------------------------------------- the wiring -- */

/** Drive `handleApi` with a fake request/response pair, as tests/billing-usage-route.test.ts does. */
async function get(url: string, verify: Verifier, onEnd: () => void = () => {}): Promise<number> {
  const req = Object.assign((async function* () {})(), {
    method: "GET",
    url,
    headers: { authorization: "Bearer test-token" },
  }) as unknown as IncomingMessage;
  let status = 0;
  const res = {
    set statusCode(v: number) {
      status = v;
    },
    get statusCode() {
      return status;
    },
    setHeader() {},
    end() {
      onEnd();
    },
  } as unknown as ServerResponse;
  await handleApi(req, res, verify);
  return status;
}

const signedIn: Verifier = async () => ({
  ok: true,
  claims: { sub: NEWCOMER, email: "arrivals-new@example.invalid", role: "authenticated" },
});
const refused: Verifier = async () => ({ ok: false, kind: "bad-token" });

async function arrived(): Promise<boolean> {
  const { rows } = await pool!.query("select 1 from spideryarn.reader_arrivals where owner_id = $1", [
    NEWCOMER,
  ]);
  return rows.length === 1;
}

describe.skipIf(!pool)("the route handler notes an arrival", () => {
  /**
   * **The composition root, not the function.** Every case above injects its
   * own seams; this one goes through the real `handleApi`, so deleting the call
   * in src/routes.ts reddens here. A request the gate refuses records nothing.
   */
  it("on an authenticated request that a route answered, and not on a refused one", async () => {
    expect(await get("/api/library", refused)).toBe(401);
    expect(await arrived()).toBe(false);

    expect(await get("/api/library", signedIn)).toBe(200);
    expect(await arrived()).toBe(true);
  });

  it("ends the response before a slow arrival insert, then keeps the invocation alive", async () => {
    const blocker = await pool!.connect();
    let transactionOpen = false;
    try {
      await blocker.query("begin");
      transactionOpen = true;
      await blocker.query("lock table spideryarn.reader_arrivals in access exclusive mode");

      let markEnded = () => {};
      const ended = new Promise<void>((resolve) => {
        markEnded = resolve;
      });
      let requestSettled = false;
      const request = get("/api/library", signedIn, markEnded).then((status) => {
        requestSettled = true;
        return status;
      });

      const endedBeforeBlockedInsert = await Promise.race([
        ended.then(() => true),
        new Promise<false>((resolve) => setTimeout(() => resolve(false), 1_000)),
      ]);
      expect(endedBeforeBlockedInsert).toBe(true);
      expect(requestSettled).toBe(false);

      await blocker.query("rollback");
      transactionOpen = false;
      expect(await request).toBe(200);
      expect(await arrived()).toBe(true);
    } finally {
      if (transactionOpen) await blocker.query("rollback").catch(() => {});
      blocker.release();
    }
  });
});
