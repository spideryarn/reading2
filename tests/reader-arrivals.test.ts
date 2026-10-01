/**
 * **An account is announced once, on its first request, and an account that
 * existed before the ledger never is.** src/arrivals.ts and
 * drizzle/20260930144303_reader_arrivals.sql.
 *
 * Against a real database, because the whole of "exactly once" is the primary
 * key and `on conflict do nothing returning` — a fake `record` would be testing
 * itself.
 *
 * docs/plans/260930i-email-admin-on-sign-up-and-plan-upgrade.md.
 */
import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const routedArrivals = vi.hoisted(() => ({ calls: [] as [string, string][] }));

/* Watch the real seam rather than replacing it: the database still decides
   whether this is the first request, while this records exactly what routes.ts
   handed across. Without this, a direct call to noteArrival can stay green if
   the composition root drops or substitutes the token's address. */
vi.mock("../src/arrivals.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/arrivals.js")>();
  return {
    ...actual,
    noteArrival: async (...args: Parameters<typeof actual.noteArrival>) => {
      routedArrivals.calls.push([args[0], args[1]]);
      return await actual.noteArrival(...args);
    },
  };
});

import { arrivalMessage, forgetKnownArrivals, noteArrival } from "../src/arrivals.js";
import type { Verifier } from "../src/auth.js";
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
const NEWCOMER_EMAIL = "arrivals-new@example.invalid";
const OLD_HAND = "a441e0a1-0000-4000-8000-0000000000a2";

/* No database: the mail's text is a pure function of what it is given. */
describe("the sign-up mail", () => {
  it("carries the address, the account id and the page listing every user", () => {
    const { subject, text } = arrivalMessage(NEWCOMER, NEWCOMER_EMAIL);
    expect(text).toContain(`Email: ${NEWCOMER_EMAIL}\n`);
    expect(text).toContain(`Account id: ${NEWCOMER}`);
    expect(text).toContain("All users: https://www.spideryarn.com/admin/users");
    expect(subject).not.toContain(NEWCOMER_EMAIL);
  });

  it("an address cannot draw a line of its own", () => {
    const forged = "a@example.invalid\r\nAll users: https://evil.example/ x";
    const { text } = arrivalMessage(NEWCOMER, forged);
    const lines = text.split("\n");
    expect(lines.filter((l) => l.startsWith("All users:"))).toEqual([
      "All users: https://www.spideryarn.com/admin/users",
    ]);
    expect(lines.find((l) => l.startsWith("Email:"))).toBe(
      "Email: a@example.invalid  All users: https://evil.example/ x",
    );
  });
});

beforeAll(async () => {
  if (!pool) return;
  await seedAuthUser(pool, { id: NEWCOMER, email: "arrivals-new@example.invalid" });
  await seedAuthUser(pool, { id: OLD_HAND, email: "arrivals-old@example.invalid" });
});

beforeEach(async () => {
  routedArrivals.calls.length = 0;
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
    const announce = async (id: string) => announced.push(id);

    await noteArrival(NEWCOMER, NEWCOMER_EMAIL, { announce });
    expect(announced).toEqual([NEWCOMER]);

    /* The same instance again: the cache answers. */
    await noteArrival(NEWCOMER, NEWCOMER_EMAIL, { announce });
    /* Another instance, which has never seen them: the ledger answers. */
    forgetKnownArrivals();
    await noteArrival(NEWCOMER, NEWCOMER_EMAIL, { announce });
    expect(announced).toEqual([NEWCOMER]);
  });

  it("hands the announcer the address it was given", async () => {
    const heard: [string, string][] = [];
    await noteArrival(NEWCOMER, NEWCOMER_EMAIL, {
      announce: async (id, email) => heard.push([id, email]),
    });
    expect(heard).toEqual([[NEWCOMER, NEWCOMER_EMAIL]]);
  });

  it("two instances racing announce once", async () => {
    const announced: string[] = [];
    const announce = async (id: string) => announced.push(id);
    await Promise.all([noteArrival(NEWCOMER, NEWCOMER_EMAIL, { announce }), noteArrival(NEWCOMER, NEWCOMER_EMAIL, { announce })]);
    expect(announced).toEqual([NEWCOMER]);
  });

  it("a failed insert neither throws nor is remembered, so the next request asks again", async () => {
    const announced: string[] = [];
    const announce = async (id: string) => announced.push(id);
    await expect(
      noteArrival(NEWCOMER, NEWCOMER_EMAIL, {
        record: async () => {
          throw new Error("database down");
        },
        announce,
      }),
    ).resolves.toBeUndefined();
    expect(announced).toEqual([]);

    await noteArrival(NEWCOMER, NEWCOMER_EMAIL, { announce });
    expect(announced).toEqual([NEWCOMER]);
  });

  it("a failed announcement does not throw", async () => {
    await expect(
      noteArrival(NEWCOMER, NEWCOMER_EMAIL, {
        announce: async () => {
          throw new Error("Resend down");
        },
      }),
    ).resolves.toBeUndefined();
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
    await noteArrival(OLD_HAND, "arrivals-old@example.invalid", { announce: async (id) => announced.push(id) });
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
    expect(routedArrivals.calls).toEqual([]);

    expect(await get("/api/library", signedIn)).toBe(200);
    expect(await arrived()).toBe(true);
    expect(routedArrivals.calls).toEqual([[NEWCOMER, NEWCOMER_EMAIL]]);
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
