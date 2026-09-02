/**
 * The cross-owner feedback read: everybody's reports, newest first, keyed by the
 * pair, and a refusal on the filesystem.
 *
 * Five properties, and each is a thing that would be **silently wrong** rather
 * than loudly broken:
 *
 * 1. **It really does cross owners.** The point of the page, and the one thing
 *    an owner-scoped copy-paste would quietly undo — a page showing only Greg's
 *    own reports looks exactly like one showing everybody's, right up until
 *    somebody else files one.
 * 2. **A report is `(owner_id, id)`.** The id is minted by a browser and two
 *    readers may legitimately hold the same one, so a read keyed on the id alone
 *    hands back the wrong person's report. GPT Sol found that in the first
 *    draft, 2026-09-02, and the collision is *chosen*, not stumbled into: a
 *    caller picks any syntactically valid id it likes.
 * 3. **The projection is a fence, not an inheritance.** The exact set of keys
 *    is pinned, so a column added to the reader's own report does not cross
 *    owners the same day.
 * 4. **The order is total and the cursor walks it.** Equal timestamps and equal
 *    ids both happen; a keyset built on less than the whole key skips rows, and
 *    the report this page exists to find is precisely an old one nobody knew
 *    about.
 * 5. **Postgres only, and it says so.** An empty array from the filesystem
 *    branch would be a page saying *nobody has reported a bug* — the exact
 *    silent success docs/reusable/silent-success.md is about, on the one feature
 *    whose job is to tell us things are broken.
 *
 * docs/plans/260902l-admin-feedback-page.md.
 *
 * Skips loudly when there is no database — tests/helpers/pg-ready.ts.
 */

import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { closeDb, getDb } from "../src/db/client.js";
import { feedback as feedbackTable } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { mintId } from "../src/ids.js";
import { runAsOwner, type OwnerId } from "../src/owner.js";
import { adminStore } from "../src/store/index.js";
import type { NewFeedback } from "../src/store/contracts.js";
import { pgFeedbackStore } from "../src/store/pg-feedback.js";
import {
  listFeedbackAcrossOwners,
  readFeedbackAcrossOwners,
  readFeedbackScreenshotAcrossOwners,
} from "../src/store/pg-admin-feedback.js";
import { ADMIN_FEEDBACK_MAX, decodeFeedbackCursor, encodeFeedbackCursor } from "../src/types.js";
import { pgReady } from "./helpers/pg-ready.js";
import { seedAuthUser } from "./helpers/seed-auth-user.js";

loadEnvLocal();

/* ------------------------------------------------ the filesystem refusal -- */

/**
 * **Outside the `when`, and no database needed.** `adminStore` is selected at
 * module load from `SPIDERYARN_STORE`, which is unset under `npm test` — so
 * what this file imports is the refusal itself.
 */
describe("the admin feedback read on the filesystem", () => {
  it("refuses the list with a 501 and a sentence, rather than an empty inbox", async () => {
    /* Wrapped in an async call: the refusal is a synchronous throw from a
       promise-shaped method, and what a route's `await` sees is what matters. */
    const refused = (async () => adminStore.listFeedbackAcrossOwners(10, null))();
    await expect(refused).rejects.toMatchObject({ status: 501 });
    /* The sentence, not just the status. An empty array would render as "nobody
       has filed a report yet", which is a lie that looks like good news. */
    await expect(refused).rejects.toThrow(/needs Postgres/);
  });

  it("refuses one report and one screenshot the same way", async () => {
    const owner = "00000000-0000-4000-8000-00000000fc01";
    await expect(
      (async () => adminStore.readFeedbackAcrossOwners(owner, mintId()))(),
    ).rejects.toMatchObject({ status: 501 });
    await expect(
      (async () => adminStore.readFeedbackScreenshotAcrossOwners(owner, mintId()))(),
    ).rejects.toMatchObject({ status: 501 });
  });
});

/* ------------------------------------------------------------ the cursor -- */

/**
 * Pure, so it needs no database — and worth its own block, because the one
 * answer this parser must never give is the *third* one read as the first.
 */
describe("the page cursor", () => {
  const cursor = {
    createdAt: "2026-09-02T15:22:01.000Z",
    ownerId: "001bb7a0-7720-4f1b-8b9d-1ee6e63d132a",
    id: "spya-us5kzc",
  };

  it("round-trips", () => {
    expect(decodeFeedbackCursor(encodeFeedbackCursor(cursor))).toEqual(cursor);
  });

  it("says absent and malformed are different answers", () => {
    /* Absent is "start at the top", which is a request. Malformed is a mistake,
       and reading it as the first would hand the reader page 1 while they
       pressed *Load older* — a request that looks like it worked and silently
       skipped everything in between. */
    expect(decodeFeedbackCursor(null)).toBeNull();
    expect(decodeFeedbackCursor("")).toBeNull();
    for (const bad of [
      "nonsense",
      "a|b",
      "a|b|c|d",
      /* Each part wrong in turn: a timestamp that will not parse, an owner that
         is not a uuid, an id that is not one of ours. */
      `nope|${cursor.ownerId}|${cursor.id}`,
      `${cursor.createdAt}|not-a-uuid|${cursor.id}`,
      `${cursor.createdAt}|${cursor.ownerId}|not-an-id`,
    ]) {
      expect(decodeFeedbackCursor(bad), bad).toBe("malformed");
    }
  });
});

/* --------------------------------------------------------- the real one -- */

/**
 * Two owners, seeded here — `feedback.owner_id` references `auth.users(id)`, so
 * a made-up uuid files nothing, and the cross-owner property needs a genuine
 * second reader rather than one who merely reads nothing.
 *
 * Ids of their own rather than the development owner's: this suite asserts on
 * *how many* reports came back, so it must not be counting rows somebody else
 * left behind.
 *
 * **BOB sorts below ALICE as a string**, which the tie-break cases below rely
 * on: `desc(owner_id)` puts `…fc02` before `…fc01`.
 */
const ALICE = "00000000-0000-4000-8000-00000000fc01" as OwnerId;
const BOB = "00000000-0000-4000-8000-00000000fc02" as OwnerId;

const { reachable } = await pgReady({
  suite: "tests/admin-feedback-store.test.ts",
  tables: ["spideryarn.feedback"],
});

const when = reachable ? describe : describe.skip;

function report(over: Partial<NewFeedback> & { id: string }): NewFeedback {
  return {
    reporterEmail: "reporter@example.invalid",
    /* One field since 2026-09-02 — docs/plans/260902m-one-feedback-box-with-a-kind-toggle-and-dictation.md
       collapsed the three boxes into one. This fixture read three until the two
       features met in a merge. */
    body: "Open an article and press the button; I expected a dialog and got nothing at all",
    /* Required rather than optional on `NewFeedback`, and `null` is a real
       answer: the toggle has no default, so "they did not say" is a third
       state and not a missing field. src/types.ts § FEEDBACK_KINDS. */
    kind: null,
    consented: false,
    routeKind: "read",
    slug: "some-article",
    buildCommit: "abc1234",
    environment: "development",
    requestVercelId: "lhr1::abcde-1234567890-0123456789ab",
    diagnostics: null,
    screenshot: null,
    ...over,
  };
}

async function clear(): Promise<void> {
  const db = getDb();
  for (const owner of [ALICE, BOB]) {
    await db.delete(feedbackTable).where(eq(feedbackTable.ownerId, owner));
  }
}

/**
 * This suite's own reports, and only those.
 *
 * **Filtered rather than assumed.** `npm test` runs against a shared local
 * database that other suites and other agents write to, so an assertion on a
 * raw count is an assertion about the whole machine.
 */
async function ours(limit = ADMIN_FEEDBACK_MAX) {
  const page = await listFeedbackAcrossOwners(limit, null);
  return page.reports.filter((r) => r.ownerId === ALICE || r.ownerId === BOB);
}

when("the admin feedback read on Postgres", () => {
  beforeEach(async () => {
    await seedAuthUser(getDb(), {
      id: ALICE,
      email: "alice@example.invalid",
      onConflictDoNothing: true,
    });
    await seedAuthUser(getDb(), {
      id: BOB,
      email: "bob@example.invalid",
      onConflictDoNothing: true,
    });
    await clear();
  });

  afterAll(async () => {
    await clear();
    await closeDb();
  });

  it("returns both owners' reports from one call", async () => {
    const alice = mintId();
    const bob = mintId();
    await runAsOwner(ALICE, () =>
      pgFeedbackStore.submit(report({ id: alice, reporterEmail: "alice@example.invalid" })),
    );
    await runAsOwner(BOB, () =>
      pgFeedbackStore.submit(report({ id: bob, reporterEmail: "bob@example.invalid" })),
    );

    const seen = await ours();
    expect(seen.map((r) => r.id).sort()).toEqual([alice, bob].sort());
    expect(new Set(seen.map((r) => r.ownerId))).toEqual(new Set([ALICE, BOB]));

    /* And the reader's own read is still owner-scoped — the reason the
       cross-owner reads are separate methods rather than a relaxed
       `FeedbackStore.read`. Relaxing that one would relax it for the dialog. */
    expect(await runAsOwner(ALICE, () => pgFeedbackStore.read(bob))).toBeNull();
  });

  /**
   * **The blocker GPT Sol found.** Two owners, one id, two different reports —
   * which the schema deliberately permits and tests/feedback-store.test.ts
   * already proves. A read keyed on the id alone answers with whichever row the
   * planner happened to reach first, and the caller cannot tell.
   */
  it("does not confuse two owners' reports that share one id", async () => {
    const id = mintId();
    const aliceShot = Uint8Array.of(1, 1, 1, 1);
    const bobShot = Uint8Array.of(2, 2, 2, 2, 2, 2);
    await runAsOwner(ALICE, () =>
      pgFeedbackStore.submit(report({ id, body: "what Alice saw", screenshot: aliceShot })),
    );
    await runAsOwner(BOB, () =>
      pgFeedbackStore.submit(report({ id, body: "what Bob saw", screenshot: bobShot })),
    );

    /* Both are in the list, as two rows. A `key` on the id alone would draw
       one card here, which is the same bug one layer up. */
    const seen = await ours();
    expect(seen.filter((r) => r.id === id)).toHaveLength(2);

    /* And each read gets its own owner's report and its own owner's bytes. */
    expect((await readFeedbackAcrossOwners(ALICE, id))?.body).toBe("what Alice saw");
    expect((await readFeedbackAcrossOwners(BOB, id))?.body).toBe("what Bob saw");
    expect(await readFeedbackScreenshotAcrossOwners(ALICE, id)).toEqual(Buffer.from(aliceShot));
    expect(await readFeedbackScreenshotAcrossOwners(BOB, id)).toEqual(Buffer.from(bobShot));
  });

  /**
   * **The fence, pinned.** Not "these fields are present" but "these and no
   * others" — the whole reason `pg-admin-feedback.ts` writes its projection out
   * by hand rather than importing `REPORT_COLUMNS`.
   */
  it("returns exactly the agreed keys, and never the blob or the bytes", async () => {
    const id = mintId();
    await runAsOwner(ALICE, () =>
      pgFeedbackStore.submit(
        report({
          id,
          consented: true,
          diagnostics: { version: 1, payload: { secret: "should not be in the list" } },
          screenshot: Uint8Array.of(9, 9, 9),
        }),
      ),
    );

    const listed = (await ours()).find((r) => r.id === id);
    expect(Object.keys(listed ?? {}).sort()).toEqual(
      [
        "actual",
        "buildCommit",
        "consented",
        "createdAt",
        "diagnosticsVersion",
        "environment",
        "expected",
        "id",
        "mirrorAttemptedAt",
        "mirroredAt",
        "ownerId",
        "reporterEmail",
        "requestVercelId",
        "routeKind",
        "screenshotBytes",
        "sentryEventId",
        "slug",
        "steps",
      ].sort(),
    );
    /* Size, not bytes; version, not blob. Both are size decisions with a real
       number behind them — see the store's header. */
    expect(listed?.screenshotBytes).toBe(3);
    expect(listed?.diagnosticsVersion).toBe(1);

    /* The blob comes from the one-report read, which is what the card opens. */
    const full = await readFeedbackAcrossOwners(ALICE, id);
    expect(full?.diagnostics).toEqual({
      version: 1,
      payload: { secret: "should not be in the list" },
    });
  });

  it("puts the newest first, and pages backwards through the whole order", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const id = mintId();
      ids.push(id);
      await runAsOwner(ALICE, () => pgFeedbackStore.submit(report({ id, body: `step ${i}` })));
    }
    const newestFirst = [...ids].reverse();

    /* Insertion order would pass a test that only checked membership, which is
       why this checks the sequence. */
    expect((await ours()).map((r) => r.id)).toEqual(newestFirst);

    /* Two pages of two, then the rest — and the union is the whole list with
       nothing repeated and nothing skipped. A keyset built on `created_at`
       alone would drop a row wherever two share a millisecond. */
    const walked: string[] = [];
    let cursor = null as Awaited<ReturnType<typeof listFeedbackAcrossOwners>>["nextCursor"];
    for (let page = 0; page < 5; page++) {
      const got = await listFeedbackAcrossOwners(2, cursor);
      walked.push(...got.reports.filter((r) => r.ownerId === ALICE).map((r) => r.id));
      cursor = got.nextCursor;
      if (!cursor) break;
    }
    expect(walked).toEqual(newestFirst);
  });

  /**
   * The tie-break, made to actually happen: three reports written at one
   * instant, across two owners, one id shared. Without `owner_id` and `id` in
   * both the order and the cursor, a page boundary landing inside this group
   * repeats a row or skips one.
   */
  it("keeps a stable order when the timestamps are equal", async () => {
    const shared = mintId();
    const other = mintId();
    for (const [owner, id] of [
      [ALICE, shared],
      [BOB, shared],
      [ALICE, other],
    ] as const) {
      await runAsOwner(owner, () => pgFeedbackStore.submit(report({ id })));
    }
    /* Forced to one instant, which is the case the order has to survive and
       which a test cannot reliably produce by writing quickly. */
    await getDb()
      .update(feedbackTable)
      .set({ createdAt: new Date("2026-09-01T00:00:00.000Z") })
      .where(sql`${feedbackTable.ownerId} in (${ALICE}, ${BOB})`);

    const inOneGo = (await ours()).map((r) => `${r.ownerId}:${r.id}`);
    /* Walked one at a time, the cursor must reproduce the same sequence
       exactly. This is the assertion that fails if either half of the key is
       missing from the order or from `after()`. */
    const walked: string[] = [];
    let cursor = null as Awaited<ReturnType<typeof listFeedbackAcrossOwners>>["nextCursor"];
    for (let page = 0; page < 6; page++) {
      const got = await listFeedbackAcrossOwners(1, cursor);
      walked.push(
        ...got.reports
          .filter((r) => r.ownerId === ALICE || r.ownerId === BOB)
          .map((r) => `${r.ownerId}:${r.id}`),
      );
      cursor = got.nextCursor;
      if (!cursor) break;
    }
    expect(walked).toEqual(inOneGo);
    expect(new Set(walked).size).toBe(walked.length);
  });

  it("says there are more only when it has seen one more", async () => {
    await clear();
    for (let i = 0; i < 3; i++) {
      await runAsOwner(ALICE, () => pgFeedbackStore.submit(report({ id: mintId() })));
    }
    /* **The boundary**, which is the whole reason `hasMore` is not
       `reports.length === limit`. Asking for exactly as many as exist must say
       there are no more — as long as this suite's rows are the only ones, which
       `clear()` above and a fresh database make true. */
    const exactly = await listFeedbackAcrossOwners(3, null);
    if (exactly.reports.every((r) => r.ownerId === ALICE)) {
      expect(exactly.hasMore).toBe(false);
      expect(exactly.nextCursor).toBeNull();
    }
    const short = await listFeedbackAcrossOwners(2, null);
    expect(short.reports).toHaveLength(2);
    expect(short.hasMore).toBe(true);
    expect(short.nextCursor).not.toBeNull();
  });

  it("hands back null for a report with no screenshot, and for a pair that is not a report", async () => {
    const bare = mintId();
    await runAsOwner(ALICE, () => pgFeedbackStore.submit(report({ id: bare })));
    expect(await readFeedbackScreenshotAcrossOwners(ALICE, bare)).toBeNull();
    /* An id nobody filed, and a real id under the wrong owner: both are the
       same `null`, which the route turns into one 404. */
    expect(await readFeedbackScreenshotAcrossOwners(ALICE, mintId())).toBeNull();
    expect(await readFeedbackAcrossOwners(BOB, bare)).toBeNull();
  });

  it("clamps a nonsensical limit rather than passing it to the driver", async () => {
    await runAsOwner(ALICE, () => pgFeedbackStore.submit(report({ id: mintId() })));
    /* Zero, negative and fractional all arrive from a query string, and none of
       them means "none". The floor is 1 and the ceiling is ADMIN_FEEDBACK_MAX. */
    for (const limit of [0, -5, 1.5, Number.NaN, 10_000]) {
      const got = await listFeedbackAcrossOwners(limit, null);
      expect(Array.isArray(got.reports), String(limit)).toBe(true);
    }
    expect((await listFeedbackAcrossOwners(0, null)).reports.length).toBeLessThanOrEqual(1);
  });
});
