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

import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { ADMIN_EMAIL_LOCAL, ADMIN_USER_ID_LOCAL, isAdmin } from "../src/admin.js";
import { closeDb, getDb } from "../src/db/client.js";
import { feedback as feedbackTable } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { mintId } from "../src/ids.js";
import { runAsOwner, type OwnerId } from "../src/owner.js";
import type { NewFeedback } from "../src/store/contracts.js";
import { pgFeedbackStore } from "../src/store/pg-feedback.js";
import {
  listFeedbackAcrossOwners,
  readFeedbackAcrossOwners,
  readFeedbackScreenshotAcrossOwners,
  setFeedbackIgnoredAcrossOwners,
} from "../src/store/pg-admin-feedback.js";
import { ADMIN_FEEDBACK_MAX, decodeFeedbackCursor, encodeFeedbackCursor } from "../src/types.js";
import { reportSql } from "../scripts/feedback-reporter.js";
import { ANSWERS_DEPLOYED_SQL, answersSql, classifyAnswers } from "../scripts/feedback-questions.js";
import { listSql, showSql } from "../scripts/feedback-unswept.js";
import { pgReady } from "./helpers/pg-ready.js";
import { seedAuthUser } from "./helpers/seed-auth-user.js";

loadEnvLocal();

/* An `the admin feedback read on the filesystem` block stood here until
   2026-09-05: two cases about `adminStore`'s filesystem *refusal* — a 501 and a
   sentence rather than an empty inbox, because an empty array renders as
   "nobody has filed a report yet", which is a lie that looks like good news.
   The refusal went with the store it was refusing for
   (docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md
   § F). The first of the two also *listed real rows* from the private database
   once the flag was gone, which is how it was noticed. */

/* ------------------------------------------------------------ the cursor -- */

/**
 * Pure, so it needs no database — and worth its own block, because the one
 * answer this parser must never give is the *third* one read as the first.
 */
describe("the page cursor", () => {
  /* **This suite's own owner id, not a real one.** It was Greg's production
     account for a while — the report that prompted this whole page — and
     tests/fixture-ids.test.ts refused it, correctly: `admin.test.ts` already
     declares that uuid, and the guard cannot tell a pure string from a row
     somebody is about to insert. Nothing here touches a database; using a uuid
     this file already owns keeps that true without an exemption. */
  const cursor = {
    createdAt: "2026-09-02T15:22:01.000000Z",
    ownerId: "00000000-0000-4000-8000-00000000fc01",
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

await pgReady({
  suite: "tests/admin-feedback-store.test.ts",
  tables: ["spideryarn.feedback"],
});

function report(over: Partial<NewFeedback> & { id: string }): NewFeedback {
  return {
    reporterEmail: "reporter@example.invalid",
    /* **One box since 2026-09-02** — docs/plans/260902m-one-feedback-box-with-a-kind-toggle-and-dictation.md
       collapsed the three answers into one `body`. This fixture read three
       until the two features met in a merge. */
    body: "Open an article and press the button; I expected a dialog and got nothing",
    /* **Unset, and that is the default a reader gets** — Greg, 2026-09-02:
       *"don't default to Problem. Default to null/unknown."* The fixture
       starts where a reader starts, so the null case is the one most tests
       here exercise without having to ask for it. */
    kind: null,
    consented: false,
    url: "https://www.spideryarn.com/read/a-piece",
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

describe("the admin feedback read on Postgres", () => {
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
      pgFeedbackStore.submit(
        report({ id, body: "what Alice saw", kind: "problem", screenshot: aliceShot }),
      ),
    );
    await runAsOwner(BOB, () =>
      pgFeedbackStore.submit(
        report({ id, body: "what Bob saw", kind: "suggestion", screenshot: bobShot }),
      ),
    );

    /* Both are in the list, as two rows. A `key` on the id alone would draw
       one card here, which is the same bug one layer up. */
    const seen = await ours();
    expect(seen.filter((r) => r.id === id)).toHaveLength(2);

    /* And each read gets its own owner's report and its own owner's bytes. */
    /* **Values, not just shapes.** `kind` is asserted here as well as `body`,
       because a projection that dropped `kind` entirely — or mapped every
       report to one value — would compile, and the exact-key fence below
       would pass if it were updated to match the mistake. GPT Sol,
       2026-09-02. */
    const alice = await readFeedbackAcrossOwners(ALICE, id);
    const bob = await readFeedbackAcrossOwners(BOB, id);
    expect([alice?.body, alice?.kind]).toEqual(["what Alice saw", "problem"]);
    expect([bob?.body, bob?.kind]).toEqual(["what Bob saw", "suggestion"]);
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
        "body",
        "buildCommit",
        "consented",
        "createdAt",
        "diagnosticsVersion",
        "environment",
        "kind",
        "id",
        "ignoredAt",
        "mirrorAttemptedAt",
        "mirroredAt",
        "ownerId",
        "reporterEmail",
        "requestVercelId",
        "url",
        "screenshotBytes",
        "sentryEventId",
        "slug",
      ].sort(),
    );
    /* Size, not bytes; version, not blob. Both are size decisions with a real
       number behind them — see the store's header. */
    expect(listed?.screenshotBytes).toBe(3);
    expect(listed?.diagnosticsVersion).toBe(1);
    /* **The values, because the key list alone cannot catch a projection that
       selects the right column and hands back the wrong one.** `kind` is `null`
       here — the fixture leaves the toggle unset, as a reader does — and `null`
       must survive the round trip as itself rather than becoming a default. */
    expect(listed?.body).toContain("press the button");
    expect(listed?.kind).toBeNull();

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
   * The tie-break, made to actually happen: three reports at one instant, across
   * two owners, one id shared. Without `owner_id` and `id` in both the order and
   * the cursor, a page boundary landing inside this group repeats a row or skips
   * one.
   *
   * **Moved to the front of the whole table rather than pinned to a fixed date.**
   * `npm test` runs against a database other suites and other agents are writing
   * to, so a walk from the top with a small page size may never reach a group
   * parked in the middle — which is how the first version of this test failed:
   * it asserted a real property and could not see it. One second past the newest
   * row there is, so the group is the first page whatever else is in the table.
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
    /* One instant, and ahead of everything — the case the order has to survive,
       and one a test cannot reliably produce by writing quickly. */
    await getDb().execute(sql`
      update spideryarn.feedback
         set created_at = (select max(created_at) from spideryarn.feedback) + interval '1 second'
       where owner_id in (${ALICE}, ${BOB})
    `);

    const mine = (r: { ownerId: string }) => r.ownerId === ALICE || r.ownerId === BOB;
    const inOneGo = (await ours()).map((r) => `${r.ownerId}:${r.id}`);
    expect(inOneGo).toHaveLength(3);

    /* Walked one at a time, the cursor must reproduce that sequence exactly.
       This is the assertion that fails if either half of the key is missing from
       the order or from `after()` — verified by deleting `desc(ownerId)` and
       watching it go red, 2026-09-02. */
    const walked: string[] = [];
    let cursor = null as Awaited<ReturnType<typeof listFeedbackAcrossOwners>>["nextCursor"];
    for (let page = 0; page < 4; page++) {
      const got = await listFeedbackAcrossOwners(1, cursor);
      walked.push(...got.reports.filter(mine).map((r) => `${r.ownerId}:${r.id}`));
      cursor = got.nextCursor;
      if (!cursor) break;
    }
    expect(walked).toEqual(inOneGo);
    expect(new Set(walked).size).toBe(walked.length);
  });

  /**
   * **`hasMore` is a fact about the whole table**, not about this suite's rows —
   * so the boundary is measured against a real count rather than assumed.
   *
   * The first version of this test asked for three and expected `hasMore` to be
   * false because it had written three. On a shared local database that is
   * simply untrue, and the test was asserting something about the machine rather
   * than about the store.
   *
   * **And measuring the count was still not enough — it wrote one row.** On the
   * shared database the table always held several, so `n - 1` below was a
   * sensible limit; on a private test database with an empty `feedback` table
   * `n` is 1 and `n - 1` is **zero**, which the store legitimately clamps to one
   * (`clamps a nonsensical limit`, above) and the length assertion fails. Two
   * rows, so the boundary the case is named for is inside the store's range
   * whatever the table started with. Found by running this suite against a
   * factory-minted database, 2026-09-03; stage T-C.
   */
  it("says there are more only when it has seen one more", async () => {
    await runAsOwner(ALICE, () => pgFeedbackStore.submit(report({ id: mintId() })));
    await runAsOwner(ALICE, () => pgFeedbackStore.submit(report({ id: mintId() })));
    const [{ n = 0 } = {}] = (
      await getDb().execute<{ n: number }>(
        sql`select count(*)::int as n from spideryarn.feedback`,
      )
    ).rows;
    expect(n, "two rows were written, so a limit of n - 1 is a real page").toBeGreaterThan(1);

    /* Exactly as many as exist: nothing beyond the page, so no cursor. This is
       the boundary `reports.length === limit` gets wrong, and the whole reason
       the store asks for one row more than it returns. */
    const exact = await listFeedbackAcrossOwners(n, null);
    expect(exact.reports).toHaveLength(n);
    expect(exact.hasMore).toBe(false);
    expect(exact.nextCursor).toBeNull();

    /* One short: there is more, and a cursor to reach it with. */
    const short = await listFeedbackAcrossOwners(n - 1, null);
    expect(short.reports).toHaveLength(n - 1);
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

  /**
   * **Readers only** — Greg, 2026-10-01 (SPIDERYARN-READING2-87): *"show only
   * non-admin suggestions (i.e. suggestions from people other than me)."* The
   * administrator here is the local one, `ADMIN_USER_ID_LOCAL`, whose own rows
   * this leaves alone: only the report it adds is removed afterwards.
   * docs/plans/261001l-….
   */
  it("leaves the administrators' own reports out of the readers' inbox, page after page", async () => {
    await seedAuthUser(getDb(), {
      id: ADMIN_USER_ID_LOCAL,
      email: ADMIN_EMAIL_LOCAL,
      onConflictDoNothing: true,
    });
    const mine = mintId();
    const theirs: string[] = [];
    try {
      for (let i = 0; i < 3; i++) {
        const id = mintId();
        theirs.push(id);
        await runAsOwner(ALICE, () => pgFeedbackStore.submit(report({ id })));
      }
      /* **The administrator's report last, so it is the newest**: the walk
         below stops once it has seen Alice's three, and a report older than
         them would never be reached — a `not.toContain` that passed by not
         looking. */
      await runAsOwner(ADMIN_USER_ID_LOCAL as OwnerId, () =>
        pgFeedbackStore.submit(report({ id: mine })),
      );

      /* Everyone: both. The default is everyone, said and unsaid. */
      for (const page of [
        await listFeedbackAcrossOwners(ADMIN_FEEDBACK_MAX, null),
        await listFeedbackAcrossOwners(ADMIN_FEEDBACK_MAX, null, "everyone"),
      ]) {
        const ids = page.reports.map((r) => r.id);
        expect(ids).toContain(mine);
        expect(ids).toEqual(expect.arrayContaining(theirs));
      }

      /* Readers: walked in pages of one, so the filter has to survive the
         cursor. Every report kept is one `isAdmin` refuses — the same list,
         so the two cannot drift apart. */
      const walked: string[] = [];
      let cursor = null as Awaited<ReturnType<typeof listFeedbackAcrossOwners>>["nextCursor"];
      for (let n = 0; n < ADMIN_FEEDBACK_MAX; n++) {
        const got = await listFeedbackAcrossOwners(1, cursor, "readers");
        for (const r of got.reports) {
          expect(isAdmin(r.ownerId), r.ownerId).toBe(false);
          walked.push(r.id);
        }
        cursor = got.nextCursor;
        if (!cursor) break;
        /* The table is shared; three of Alice's are all this needs to see. */
        if (theirs.every((id) => walked.includes(id))) break;
      }
      expect(walked).not.toContain(mine);
      expect(walked).toEqual(expect.arrayContaining(theirs));
    } finally {
      await getDb()
        .delete(feedbackTable)
        .where(and(eq(feedbackTable.ownerId, ADMIN_USER_ID_LOCAL), eq(feedbackTable.id, mine)));
    }
  });

  /**
   * **Ignore** — Greg, 2026-10-03 (`spya-g95x4j`): *"I just saw feedback that I
   * wished I could delete, and there wasn't a way to do it, or at least mark it
   * as to be ignored."* The first write this file has, and the only one: one
   * nullable timestamp on the pair. docs/plans/261003j-….
   */
  describe("marking a report as ignored", () => {
    it("stamps the report, shows it in the list, and takes it back", async () => {
      const id = mintId();
      await runAsOwner(ALICE, () => pgFeedbackStore.submit(report({ id })));
      expect((await ours()).find((r) => r.id === id)?.ignoredAt).toBeNull();

      const marked = await setFeedbackIgnoredAcrossOwners(ALICE, id, true);
      expect(marked?.id).toBe(id);
      expect(typeof marked?.ignoredAt).toBe("string");
      /* The list and the answer are one projection, so the card can redraw
         from either. */
      expect((await ours()).find((r) => r.id === id)?.ignoredAt).toBe(marked?.ignoredAt);

      const undone = await setFeedbackIgnoredAcrossOwners(ALICE, id, false);
      expect(undone?.ignoredAt).toBeNull();
      expect((await ours()).find((r) => r.id === id)?.ignoredAt).toBeNull();
    });

    it("keeps the first moment when asked twice, and changes nothing else on the row", async () => {
      const id = mintId();
      await runAsOwner(ALICE, () => pgFeedbackStore.submit(report({ id, body: "ASDF1" })));
      const before = (await ours()).find((r) => r.id === id);

      const first = await setFeedbackIgnoredAcrossOwners(ALICE, id, true);
      await new Promise((go) => setTimeout(go, 15));
      const second = await setFeedbackIgnoredAcrossOwners(ALICE, id, true);
      expect(second?.ignoredAt).toBe(first?.ignoredAt);
      /* The report is never edited: the mark is the whole of the write. */
      expect({ ...second, ignoredAt: null }).toEqual(before);
    });

    it("marks one owner's report and not the other's under the same id", async () => {
      const id = mintId();
      await runAsOwner(ALICE, () => pgFeedbackStore.submit(report({ id })));
      await runAsOwner(BOB, () => pgFeedbackStore.submit(report({ id })));

      await setFeedbackIgnoredAcrossOwners(ALICE, id, true);
      const both = (await ours()).filter((r) => r.id === id);
      expect(both.find((r) => r.ownerId === ALICE)?.ignoredAt).not.toBeNull();
      expect(both.find((r) => r.ownerId === BOB)?.ignoredAt).toBeNull();
    });

    /**
     * **The reader of the mark, against a real table, in all three states.**
     * `scripts/feedback-unswept.ts` reads production, and reaches `dev` before
     * the deploy that adds `ignored_at` there, so its select has to answer on
     * a table without the column. Here: this database's table (column present,
     * set and unset) and a temporary copy with the column dropped.
     */
    it("is read by the sweep's own select, with the column and without it", async () => {
      const marked = mintId();
      const plain = mintId();
      await runAsOwner(ALICE, () => pgFeedbackStore.submit(report({ id: marked })));
      await runAsOwner(ALICE, () => pgFeedbackStore.submit(report({ id: plain })));
      await setFeedbackIgnoredAcrossOwners(ALICE, marked, true);
      type Row = { id: string; ignored_at: unknown; id_occurrences: number };

      await getDb().transaction(async (tx) => {
        const since = new Date(Date.now() - 3_600_000).toISOString();
        const withColumn = (await tx.execute(
          sql.raw(listSql().replace("$1", `'${since}'::timestamptz`)),
        )) as unknown as { rows: Row[] };
        const byId = new Map(withColumn.rows.map((r) => [r.id, r]));
        expect(byId.get(marked)?.ignored_at).not.toBeNull();
        expect(byId.get(marked)?.ignored_at).toBeDefined();
        expect(byId.get(plain)?.ignored_at).toBeNull();
        expect(byId.get(plain)?.id_occurrences).toBe(1);

        await tx.execute(
          sql.raw(
            `create temp table feedback_before_ignore on commit drop as
               select * from spideryarn.feedback where owner_id = '${ALICE}'`,
          ),
        );
        await tx.execute(sql.raw("alter table feedback_before_ignore drop column ignored_at"));
        for (const statement of [
          listSql("feedback_before_ignore").replace("$1", `'${since}'::timestamptz`),
          showSql("feedback_before_ignore").replace("$1", `'${marked}'`),
        ]) {
          const without = (await tx.execute(sql.raw(statement))) as unknown as { rows: Row[] };
          expect(without.rows.map((r) => r.id)).toContain(marked);
          /* No column, so nothing is ignored, and nothing failed. */
          expect(without.rows.every((r) => r.ignored_at === null)).toBe(true);
        }
      });
    });

    /**
     * **The report's number, read the same way** (261007d): the scripts reach
     * `dev` before the deploy that adds `feedback.number` to production. With
     * the column, every select carries it and a number finds its row; without,
     * every select still answers, with no number, and a number finds nothing.
     */
    it("reads the number with the column, and answers without it", async () => {
      const filed = mintId();
      await runAsOwner(ALICE, () => pgFeedbackStore.submit(report({ id: filed })));
      type Row = { id: string; number: number | null };
      const since = new Date(Date.now() - 3_600_000).toISOString();
      const literal = (statement: string, value: string) => sql.raw(statement.replace("$1", value));

      await getDb().transaction(async (tx) => {
        const rowsOf = async (statement: string, value: string) =>
          ((await tx.execute(literal(statement, value))) as unknown as { rows: Row[] }).rows;

        const listed = await rowsOf(listSql(), `'${since}'::timestamptz`);
        const number = listed.find((r) => r.id === filed)?.number as number;
        expect(Number.isSafeInteger(number) && number > 0, "the list carries the number").toBe(true);
        expect((await rowsOf(showSql(), `'${filed}'`)).map((r) => r.number)).toEqual([number]);
        /* By number: exactly that row, from either script's select. */
        expect((await rowsOf(showSql(undefined, "number"), String(number))).map((r) => r.id)).toEqual([filed]);
        expect((await rowsOf(reportSql("number"), String(number))).map((r) => r.id)).toEqual([filed]);
        expect((await rowsOf(reportSql("id"), `'${filed}'`)).map((r) => r.number)).toEqual([number]);

        await tx.execute(
          sql.raw(
            `create temp table feedback_before_number on commit drop as
               select * from spideryarn.feedback where owner_id = '${ALICE}'`,
          ),
        );
        await tx.execute(sql.raw("alter table feedback_before_number drop column number, drop column ignored_at"));
        const T = "feedback_before_number";
        for (const [statement, value] of [
          [listSql(T), `'${since}'::timestamptz`],
          [showSql(T), `'${filed}'`],
          [reportSql("id", T), `'${filed}'`],
        ] as const) {
          const without = await rowsOf(statement, value);
          expect(without.map((r) => r.id)).toContain(filed);
          expect(without.every((r) => r.number === null), "no column, so no number, and nothing failed").toBe(true);
        }
        /* A number names nothing there, and saying so is the caller's job (NUMBERED_SQL). */
        expect(await rowsOf(showSql(T, "number"), String(number))).toEqual([]);
        expect(await rowsOf(reportSql("number", T), String(number))).toEqual([]);
      });
    });

    /**
     * **The replies' reader, against a real table** (261007d stage 2).
     * `scripts/feedback-questions.ts --answers` reads production and reaches
     * `dev` before the deploy that creates `feedback_question_answers`, so it
     * asks whether the table exists first. Here: this database's table, a
     * name that is not a table, and the select itself over two owners' rows.
     */
    it("is read by the questions script's two selects: the table asked about, then every owner's replies", async () => {
      const mine = mintId();
      const theirs = mintId();
      await runAsOwner(ALICE, () =>
        pgFeedbackStore.submitAnswer({ id: mine, questionId: "q-k3m9qt", body: "Alice's reply", environment: "test" }),
      );
      await runAsOwner(BOB, () =>
        pgFeedbackStore.submitAnswer({ id: theirs, questionId: "q-k3m9qt", body: "Bob's reply", environment: "test" }),
      );
      type Row = { id: string; owner_id: string; question_id: string; body: string; environment: string; created_at: string | Date };
      try {
        await getDb().transaction(async (tx) => {
          const deployed = (await tx.execute(sql.raw(ANSWERS_DEPLOYED_SQL))) as unknown as { rows: { deployed: unknown }[] };
          expect(deployed.rows).toEqual([{ deployed: true }]);
          /* The same statement about a table that is not there: false, and no error. */
          const absent = (await tx.execute(
            sql.raw(ANSWERS_DEPLOYED_SQL.replace("feedback_question_answers", "feedback_question_answers_not_yet")),
          )) as unknown as { rows: { deployed: unknown }[] };
          expect(absent.rows).toEqual([{ deployed: false }]);

          const read = (await tx.execute(sql.raw(answersSql()))) as unknown as { rows: Row[] };
          const ours = read.rows.filter((row) => row.id === mine || row.id === theirs);
          /* Across owners, as an agent must see them: the script, not the store, decides whose count. */
          expect(ours.map((row) => [row.owner_id, row.body]).sort()).toEqual(
            [
              [ALICE, "Alice's reply"],
              [BOB, "Bob's reply"],
            ].sort(),
          );
          expect(ours.every((row) => row.question_id === "q-k3m9qt" && !Number.isNaN(new Date(row.created_at).getTime()))).toBe(true);
          /* And what the script makes of rows a local stack wrote: it cannot tell. */
          const verdict = classifyAnswers(
            ours.map((row) => ({
              id: row.id,
              ownerId: row.owner_id,
              questionId: row.question_id,
              body: row.body,
              environment: row.environment,
              createdAt: new Date(row.created_at),
            })),
            [],
          );
          expect(verdict.kind).toBe("cannot-tell");
        });
      } finally {
        for (const [owner, id] of [[ALICE, mine], [BOB, theirs]] as const) {
          await getDb().execute(
            sql`delete from spideryarn.feedback_question_answers where owner_id = ${owner} and id = ${id}`,
          );
        }
      }
    });

    it("answers null for a pair that is not a report, and writes nothing", async () => {
      const id = mintId();
      await runAsOwner(ALICE, () => pgFeedbackStore.submit(report({ id })));
      expect(await setFeedbackIgnoredAcrossOwners(BOB, id, true)).toBeNull();
      expect((await ours()).find((r) => r.id === id)?.ignoredAt).toBeNull();
    });
  });
});
