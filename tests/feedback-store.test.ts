/**
 * The feedback store: one report, filed once, so many an hour, and nobody else's.
 *
 * Four properties, and each one is a thing that would be silently wrong rather
 * than loudly broken if it went:
 *
 * 1. **Idempotent.** The same client-minted id twice files one report. Without
 *    it a double-clicked Submit is two rows and — once the Sentry mirror lands —
 *    two copies of one bug, because feedback events are not deduped there.
 * 2. **Capped, and the cap is inside the transaction.** `count` then `insert` is
 *    raceable: concurrent requests all see the same count and all insert. The
 *    owner-scoped advisory lock is what makes the cap mean the cap. The
 *    administrator has no cap at all, and that is its own test.
 * 3. **Owned.** One reader cannot read another's report, and their ids cannot
 *    collide — the key is `(owner_id, id)` and the id is minted by a browser.
 * 4. **Postgres only.** The filesystem branch refuses with a 501, and the
 *    refusal has to be a sentence rather than a silence:
 *    `tests/store-parity.test.ts` does not discover a new contract by itself, so
 *    nothing else would catch a files adapter quietly returning success.
 *
 * And one rule that is not a property of the store but of this whole feature:
 * **log lengths, never text**. The last test reads what the logger actually
 * wrote.
 *
 * docs/plans/260831aj-feedback-button-and-bug-reports-to-sentry.md.
 *
 * Skips loudly when there is no database — tests/helpers/pg-ready.ts.
 */

import { and, eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The log level, raised before any import, for the reason
 * tests/helpers/log-capture.ts spells out: `level()` in src/log.ts is read once
 * at that module's load, vitest sets `NODE_ENV=test`, and a silent logger writes
 * nothing — so the "never the reader's words" assertion at the bottom would pass
 * against any amount of prose going into a log line.
 *
 * `info` and not `warn`, because the line under test is an `info`. A more
 * verbose level from the command line is left alone.
 */
const HOISTED = vi.hoisted(() => {
  const previousLevel = process.env.LOG_LEVEL;
  if (
    previousLevel === undefined ||
    ["silent", "fatal", "error", "warn"].includes(previousLevel)
  ) {
    process.env.LOG_LEVEL = "info";
  }
  return { previousLevel };
});

import { closeDb, getDb } from "../src/db/client.js";
/**
 * **Statically, not with a dynamic `import()` inside the test.** Importing
 * the whole store layer inside an `it` puts five seconds of module transform
 * inside a five-second test timeout on a busy machine.
 */
import { feedback as feedbackTable } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { mintId } from "../src/ids.js";
import { runAsOwner, type OwnerId } from "../src/owner.js";
import {
  FEEDBACK_HOURLY_CAP,
  FEEDBACK_WINDOW_MS,
  feedbackHourlyCap,
  type NewFeedback,
} from "../src/store/contracts.js";
import {
  FEEDBACK_ENVIRONMENTS,
  FEEDBACK_KINDS,
  MAX_FEEDBACK_BODY_CHARS,
  MAX_FEEDBACK_URL_CHARS,
  type FeedbackEnvironment,
  type FeedbackKind,
} from "../src/types.js";
import { pgFeedbackStore } from "../src/store/pg-feedback.js";
import { ADMIN_USER_ID_LOCAL, ADMIN_USER_ID_PROD } from "../src/admin.js";
import { logLinesWhile } from "./helpers/log-capture.js";
import { pgReady } from "./helpers/pg-ready.js";
import { seedAuthUser } from "./helpers/seed-auth-user.js";

/* Put the level back straight after the imports: vitest reuses a worker across
   files and does not reset `process.env` between them, and src/log.ts has read
   it by now. */
if (HOISTED.previousLevel === undefined) delete process.env.LOG_LEVEL;
else process.env.LOG_LEVEL = HOISTED.previousLevel;

loadEnvLocal();

/* A `the feedback store on the filesystem` block stood here until 2026-09-05.
   `feedbackStore` had a Postgres implementation and a filesystem *refusal* —
   there is no feedback table on a filesystem, and a button that accepts a report
   and drops it teaches the one reader who tried to tell us something that
   telling us does nothing. It asserted the 501 and the sentence *"your report
   was not saved"*.

   The refusal went with the store it was refusing for
   (docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md
   § F), and with the flag gone this file imports `pgFeedbackStore`: the case
   filed a real report into the private database and then failed for having not
   thrown — which is what caught it. Nothing is lost that still exists. */

/* ------------------------------------------------------- who is capped -- */

/**
 * **No database needed either**, and worth pinning apart from the store: that an
 * administrator has no cap is a decision, and one that reverted by accident
 * would look exactly like the store forgetting to ask.
 */
describe("the hourly cap", () => {
  it("holds an ordinary reader to the tripled cap", () => {
    /* The number, spelled out. Every store test below reads the constant, so
       all of them would stay green if it quietly went back to ten. */
    expect(FEEDBACK_HOURLY_CAP).toBe(30);
    expect(feedbackHourlyCap(ALICE)).toBe(30);
  });

  it("holds an administrator to nothing at all, on either project", () => {
    /* `null`, not a large number: the store skips the counting query entirely
       on this answer, so an `Infinity` here would be a different behaviour. */
    expect(feedbackHourlyCap(ADMIN_USER_ID_LOCAL)).toBeNull();
    expect(feedbackHourlyCap(ADMIN_USER_ID_PROD)).toBeNull();
  });
});

/* --------------------------------------------------------- the real one -- */

/**
 * **Two owners, both seeded here.** `feedback.owner_id` really does reference
 * `auth.users(id)` (drizzle/0040), so a made-up uuid cannot file anything — and
 * the collision half of this suite needs a *second* reader who can actually
 * write, not merely one who reads nothing.
 *
 * Seeded with raw SQL against the local database, the way tests/db-schema.test.ts
 * seeds its owner, and removed again in `afterAll`. Deliberately not the
 * development owner: the rate cap counts rows per owner over the last hour, so a
 * suite that shared `DEV_OWNER_ID` with anything else would be counting rows it
 * did not write.
 */
const ALICE = "00000000-0000-4000-8000-00000000fb01" as OwnerId;
const BOB = "00000000-0000-4000-8000-00000000fb02" as OwnerId;

await pgReady({
  suite: "tests/feedback-store.test.ts",
  tables: ["spideryarn.feedback"],
});

/** A minimal, valid report. Overrides on top, so each test says only what it means. */
function report(over: Partial<NewFeedback> & { id: string }): NewFeedback {
  return {
    reporterEmail: "reporter@example.invalid",
    body: "Open an article and press the button, and nothing at all happens",
    kind: "problem",
    consented: false,
    url: "https://www.spideryarn.com/read/a-piece?q=footnotes",
    slug: "some-article",
    buildCommit: "abc1234",
    environment: "development",
    requestVercelId: "lhr1::abcde-1234567890-0123456789ab",
    diagnostics: null,
    screenshot: null,
    ...over,
  };
}

async function seedUser(id: string, email: string): Promise<void> {
  await seedAuthUser(getDb(), { id, email, onConflictDoNothing: true });
}

/**
 * **Open every connection the pool will hold, before racing anything through
 * it.**
 *
 * Without this the concurrency tests below are not concurrent, and they say they
 * are — which is the failure mode this whole file is written against. `pg`
 * creates connections lazily and one at a time, so the first `Promise.all`
 * against a cold pool hands the first transaction a socket and makes the other
 * five wait for sockets that are still being opened; by the time they have one,
 * the first has committed. Measured, 2026-08-31, with the advisory lock deleted:
 * cold, six concurrent submits of one id gave `created` and five `duplicate`
 * and the test stayed green; warm, the same six gave four uniqueness violations
 * every run out of five.
 *
 * `poolMax()` in src/db/client.ts is five unless `DATABASE_POOL_MAX` says
 * otherwise, and a transaction needs exactly one connection, so five is how many
 * of these can genuinely overlap.
 */
const POOL_MAX = Number(process.env.DATABASE_POOL_MAX) || 5;

async function warmPool(): Promise<void> {
  await Promise.all(Array.from({ length: POOL_MAX }, () => getDb().execute(sql`select 1`)));
}

async function clear(): Promise<void> {
  const db = getDb();
  for (const owner of [ALICE, BOB]) {
    await db.delete(feedbackTable).where(eq(feedbackTable.ownerId, owner));
  }
}

/**
 * **Which constraint a write violated**, read out of the log line the guard
 * writes.
 *
 * Not off the message: Drizzle puts the whole failed query — and its bound
 * parameters, which here are the reader's own words — into `Error.message`, and
 * that is the entire reason `guardDbStore` exists (src/store/db-errors.ts).
 *
 * **And not off `err.cause` either, which is what this did until 2026-09-03.**
 * That worked only because this file imported `pgFeedbackStore` directly, and a
 * raw store still had the driver's error hanging off it; the route, which gets
 * `feedbackStore` through src/store/index.ts, has never seen one. So the test
 * was asserting on a field that the production path could not reach — the same
 * gap docs/postmortems/260901d-a-409-and-a-404-arrived-as-500.md is about, one
 * layer up. Guarding every adapter at its own export closed it and made this
 * red, which is the useful direction.
 *
 * The constraint name is not lost, and that is the point: `scrubDbError` drops
 * the free text and emits the diagnostics it kept as **fields** — `sqlstate`,
 * `table`, `constraint`, `routine` — which is where an operator reads them in
 * production too. This now asserts on exactly that.
 *
 * Returns a sentence rather than `undefined` in every way this can come out
 * empty — the write succeeded, nothing logged, or two constraints in one
 * capture — because an empty capture satisfies any assertion you can write
 * against it, which is the trap tests/helpers/log-capture.ts spells out.
 */
async function violation(body: () => Promise<unknown>): Promise<string> {
  let threw = false;
  const written = await logLinesWhile(async () => {
    try {
      await body();
    } catch {
      threw = true;
    }
  });
  if (!threw) return "(the write was accepted)";

  const named = [...written.matchAll(/"constraint":"([^"]+)"/g)].flatMap((m) => m[1] ?? []);
  if (named.length === 0) return `(no constraint logged; the capture was ${written.length} chars)`;
  if (named.length > 1) return `(${named.length} constraints logged: ${named.join(", ")})`;
  return named[0] ?? "";
}

/** How many rows this owner has, counted outside the store. */
async function rowsFor(owner: OwnerId, id?: string): Promise<number> {
  const rows = await getDb()
    .select({ id: feedbackTable.id })
    .from(feedbackTable)
    .where(
      id === undefined
        ? eq(feedbackTable.ownerId, owner)
        : and(eq(feedbackTable.ownerId, owner), eq(feedbackTable.id, id)),
    );
  return rows.length;
}

describe("the Postgres feedback store", { timeout: 30_000 }, () => {
  beforeAll(async () => {
    await seedUser(ALICE, "feedback-alice@example.invalid");
    await seedUser(BOB, "feedback-bob@example.invalid");
    /* **`ADMIN_USER_ID_LOCAL` is not seeded here**, though the test below files
       as it: every private lane already has that account, from
       `seedLocalAccounts` in tests/helpers/seed-local-accounts.ts. Seeding it a
       second time worked and said something false — that this suite owned the
       row — which GPT Sol caught, 2026-09-04. */
    await warmPool();
    await clear();
  });

  afterEach(clear);

  afterAll(async () => {
    await clear();
    /* The users go last: `on delete restrict` means a leftover report would
       block this, which is the constraint doing its job rather than a nuisance. */
    await getDb().execute(sql`delete from auth.users where id in (${ALICE}, ${BOB})`);
    await closeDb();
  });

  it("stores a report and reads it back, whole", async () => {
    const id = mintId();
    const written = await runAsOwner(ALICE, () =>
      pgFeedbackStore.submit(
        report({
          id,
          consented: true,
          diagnostics: { version: 2, payload: { blockIds: ["spya-k3m9qt"], columns: 3 } },
          screenshot: new Uint8Array([137, 80, 78, 71]),
        }),
      ),
    );
    expect(written.kind).toBe("created");

    const stored = await runAsOwner(ALICE, () => pgFeedbackStore.read(id));
    /* Field by field rather than a shape check: every one of these is a column
       somebody will read months later, and a store that dropped one would pass
       "it came back". */
    expect(stored?.body).toBe("Open an article and press the button, and nothing at all happens");
    expect(stored?.kind).toBe("problem");
    expect(stored?.reporterEmail).toBe("reporter@example.invalid");
    expect(stored?.consented).toBe(true);
    expect(stored?.url).toBe("https://www.spideryarn.com/read/a-piece?q=footnotes");
    expect(stored?.slug).toBe("some-article");
    expect(stored?.buildCommit).toBe("abc1234");
    expect(stored?.environment).toBe("development");
    expect(stored?.requestVercelId).toBe("lhr1::abcde-1234567890-0123456789ab");
    /* The blob and its version survive as one thing, which is the point of
       storing the version in its own column rather than inside the blob. */
    expect(stored?.diagnostics).toEqual({
      version: 2,
      payload: { blockIds: ["spya-k3m9qt"], columns: 3 },
    });
    /* The bytes are not read back; that a screenshot exists, and how big, is. */
    expect(stored?.screenshotBytes).toBe(4);
    expect(stored?.mirroredAt).toBeNull();
    expect(stored?.sentryEventId).toBeNull();
    expect(Number.isNaN(Date.parse(stored?.createdAt ?? ""))).toBe(false);
  });

  it("files one report when the same id arrives twice", async () => {
    const id = mintId();
    const first = await runAsOwner(ALICE, () =>
      pgFeedbackStore.submit(report({ id, body: "the first telling" })),
    );
    const second = await runAsOwner(ALICE, () =>
      pgFeedbackStore.submit(report({ id, body: "a different telling" })),
    );

    expect(first.kind).toBe("created");
    expect(second.kind).toBe("duplicate");
    /* **The stored report, not the one just submitted.** A retry that differs
       in its text must not overwrite what the reader first sent, and reporting
       the *new* text back would hide that it had been ignored. */
    if (second.kind !== "duplicate") throw new Error("unreachable");
    expect(second.report.body).toBe("the first telling");
    /* And the row count, because "returns duplicate" and "wrote nothing" are
       two claims and only one of them is about the database. */
    expect(await rowsFor(ALICE)).toBe(1);
  });

  it("refuses the report past the cap in an hour, and takes the one before it", async () => {
    const kinds: string[] = [];
    for (let i = 0; i < FEEDBACK_HOURLY_CAP; i++) {
      const filed = await runAsOwner(ALICE, () => pgFeedbackStore.submit(report({ id: mintId() })));
      kinds.push(filed.kind);
    }
    /* The positive control. Without it a store that refused everything from the
       first report would pass the assertion below. */
    expect(kinds).toEqual(Array(FEEDBACK_HOURLY_CAP).fill("created"));

    const overflow = await runAsOwner(ALICE, () =>
      pgFeedbackStore.submit(report({ id: mintId() })),
    );
    expect(overflow.kind).toBe("limited");
    if (overflow.kind !== "limited") throw new Error("unreachable");
    /* Somewhere inside the window, and not zero — a `retryAfterMs` of 0 is a
       header that tells the client to try again immediately, for ever. */
    expect(overflow.retryAfterMs).toBeGreaterThan(0);
    expect(overflow.retryAfterMs).toBeLessThanOrEqual(FEEDBACK_WINDOW_MS);
    expect(await rowsFor(ALICE)).toBe(FEEDBACK_HOURLY_CAP);
  });

  it("files past the cap for an administrator, who has none", async () => {
    /* **The one account the cap is not for.** It exists to stop a loop and one
       account hammering; the administrator files reports on purpose all
       afternoon while testing, which is what put this here — Greg, 2026-09-04,
       having been refused mid-session. */
    const filed: string[] = [];
    try {
      const kinds: string[] = [];
      for (let i = 0; i < FEEDBACK_HOURLY_CAP + 1; i++) {
        const id = mintId();
        filed.push(id);
        const answer = await runAsOwner(ADMIN_USER_ID_LOCAL as OwnerId, () =>
          pgFeedbackStore.submit(report({ id })),
        );
        kinds.push(answer.kind);
      }
      /* All of them, including the one past the cap that is `limited` for
         anybody else — which is the assertion the test above makes. */
      expect(kinds).toEqual(Array(FEEDBACK_HOURLY_CAP + 1).fill("created"));

      /* **And the rows, counted outside the store.** `created` thirty-one times
         is what the store *said*; an admin branch that answered `created`
         without inserting would satisfy every assertion above it. GPT Sol asked
         for this one, 2026-09-04, and it is the rule
         docs/reusable/silent-success.md states. */
      const stored: number[] = [];
      for (const id of filed) stored.push(await rowsFor(ADMIN_USER_ID_LOCAL as OwnerId, id));
      expect(stored).toEqual(Array(FEEDBACK_HOURLY_CAP + 1).fill(1));
    } finally {
      /* **By id, never by owner.** `clear()` deletes ALICE and BOB outright
         because this suite seeded them and owns everything they have. This
         account is the lane's, seeded for every suite that runs in it, so this
         removes exactly the rows it wrote and leaves the account alone. */
      for (const id of filed) {
        await getDb()
          .delete(feedbackTable)
          .where(
            and(
              eq(feedbackTable.ownerId, ADMIN_USER_ID_LOCAL as OwnerId),
              eq(feedbackTable.id, id),
            ),
          );
      }
    }
  });

  it("still calls a retry a duplicate once the cap is reached", async () => {
    /* The ordering inside the transaction, asserted rather than described.
       Idempotency is checked before the count, so the reader whose submit
       timed out and was retried is told their report is filed — which it is —
       rather than being told they are rate-limited and losing it. */
    const first = mintId();
    await runAsOwner(ALICE, () => pgFeedbackStore.submit(report({ id: first })));
    for (let i = 1; i < FEEDBACK_HOURLY_CAP; i++) {
      await runAsOwner(ALICE, () => pgFeedbackStore.submit(report({ id: mintId() })));
    }
    /* The window is full. A new id would be refused... */
    const fresh = await runAsOwner(ALICE, () => pgFeedbackStore.submit(report({ id: mintId() })));
    expect(fresh.kind).toBe("limited");
    /* ...and the retry of one already filed is not. */
    const retry = await runAsOwner(ALICE, () => pgFeedbackStore.submit(report({ id: first })));
    expect(retry.kind).toBe("duplicate");
  });

  it("keeps one reader's reports away from another, id for id", async () => {
    const id = mintId();
    const mine = await runAsOwner(ALICE, () =>
      pgFeedbackStore.submit(report({ id, body: "what Alice saw" })),
    );
    /* **The same id, a different owner.** The key is composite, so this is a
       second report and not a duplicate — a single-column unique index would
       hand Bob a 409 about a report he cannot see, and a global primary key
       would make one reader's minted id able to block another's. */
    const theirs = await runAsOwner(BOB, () =>
      pgFeedbackStore.submit(report({ id, body: "what Bob saw" })),
    );
    expect([mine.kind, theirs.kind]).toEqual(["created", "created"]);
    expect(await rowsFor(ALICE, id)).toBe(1);
    expect(await rowsFor(BOB, id)).toBe(1);

    /* Each reads their own, by the same id. */
    expect((await runAsOwner(ALICE, () => pgFeedbackStore.read(id)))?.body).toBe("what Alice saw");
    expect((await runAsOwner(BOB, () => pgFeedbackStore.read(id)))?.body).toBe("what Bob saw");

    /* And a report Bob does not have is simply not found — the same rule as
       `ownedSlug`: 404 rather than a 403 that confirms it exists. */
    const alicesOnly = mintId();
    await runAsOwner(ALICE, () => pgFeedbackStore.submit(report({ id: alicesOnly })));
    expect(await runAsOwner(BOB, () => pgFeedbackStore.read(alicesOnly))).toBeNull();
  });

  it("does not let one reader's reports eat another's allowance", async () => {
    /* The lock and the count are both owner-scoped. If either were global, Bob
       filing ten would silence Alice — and the symptom would be a feedback
       button that stops working for everybody when one person has a bad day. */
    for (let i = 0; i < FEEDBACK_HOURLY_CAP; i++) {
      await runAsOwner(BOB, () => pgFeedbackStore.submit(report({ id: mintId() })));
    }
    const alice = await runAsOwner(ALICE, () => pgFeedbackStore.submit(report({ id: mintId() })));
    expect(alice.kind).toBe("created");
  });

  it("records the attempt and the acknowledgement as two different facts", async () => {
    const id = mintId();
    await runAsOwner(ALICE, () => pgFeedbackStore.submit(report({ id })));

    /* Handed over, and nothing more. This is the state a report is left in when
       Sentry is down, and it is the state that makes
       `mirror_attempted_at is not null and mirrored_at is null` mean something. */
    await runAsOwner(ALICE, () => pgFeedbackStore.markMirrorAttempted(id));
    const handed = await runAsOwner(ALICE, () => pgFeedbackStore.read(id));
    expect(Number.isNaN(Date.parse(handed?.mirrorAttemptedAt ?? ""))).toBe(false);
    expect(handed?.mirroredAt).toBeNull();
    expect(handed?.sentryEventId).toBeNull();

    const marked = await runAsOwner(ALICE, () =>
      pgFeedbackStore.markMirrored(id, "0123456789abcdef"),
    );
    expect(marked).toBe(true);
    const stored = await runAsOwner(ALICE, () => pgFeedbackStore.read(id));
    expect(stored?.sentryEventId).toBe("0123456789abcdef");
    expect(Number.isNaN(Date.parse(stored?.mirroredAt ?? ""))).toBe(false);

    /* **A second mark does not overwrite the first**, and says so. Two
       acknowledgements for one report should not happen; if they ever do, the
       first is the true one and the second is a thing to be able to see. */
    const again = await runAsOwner(ALICE, () => pgFeedbackStore.markMirrored(id, "deadbeef"));
    expect(again).toBe(false);
    expect((await runAsOwner(ALICE, () => pgFeedbackStore.read(id)))?.sentryEventId).toBe(
      "0123456789abcdef",
    );

    /* Somebody else's report is not markable, for the same reason it is not
       readable. Nothing throws — there is simply no such row for this owner. */
    expect(await runAsOwner(BOB, () => pgFeedbackStore.markMirrored(id, "deadbeef"))).toBe(false);
  });

  /* ------------------------------------------------------- really at once -- */

  /**
   * **The two tests the advisory lock exists for, and until now nothing had
   * one.**
   *
   * > The duplicate and cap tests are sequential. Delete the advisory-lock
   * > statement and all of them still pass.
   * >
   * > — GPT Sol's code review, 2026-08-31
   *
   * Which was exactly true, and is the shape docs/reusable/silent-success.md
   * warns about: a claim with a green test underneath it that cannot go red for
   * the reason the claim is about. Both of these were run against
   * src/store/pg-feedback.ts with the `pg_advisory_xact_lock` line deleted, and
   * both went red — the first with a uniqueness violation, the second with
   * eleven `created`.
   *
   * `Promise.all`, and not merely `await` in a loop: the whole property is that
   * the transactions overlap. The pool is five connections by default
   * (src/db/client.ts) and each transaction needs exactly one, so eleven of
   * these queue rather than deadlock.
   */
  it("files one report when the same id arrives at the same moment, not merely twice", async () => {
    const id = mintId();
    const answers = await Promise.all(
      Array.from({ length: POOL_MAX }, (_unused, i) =>
        runAsOwner(ALICE, () => pgFeedbackStore.submit(report({ id, body: `telling ${i}` }))),
      ),
    );
    const kinds = answers.map((one) => one.kind).sort();
    expect(kinds.filter((kind) => kind === "created")).toHaveLength(1);
    expect(kinds.filter((kind) => kind === "duplicate")).toHaveLength(POOL_MAX - 1);
    /* And the database agrees, which is the half that is not about return
       values: without the lock the losers raise a uniqueness violation on the
       composite primary key rather than answering `duplicate`. */
    expect(await rowsFor(ALICE, id)).toBe(1);
  });

  it("takes exactly ten when eleven arrive at the same moment", async () => {
    const answers = await Promise.all(
      Array.from({ length: FEEDBACK_HOURLY_CAP + 1 }, () =>
        runAsOwner(ALICE, () => pgFeedbackStore.submit(report({ id: mintId() }))),
      ),
    );
    const kinds = answers.map((one) => one.kind);
    expect(kinds.filter((kind) => kind === "created")).toHaveLength(FEEDBACK_HOURLY_CAP);
    expect(kinds.filter((kind) => kind === "limited")).toHaveLength(1);
    /* The cap is about rows, so the rows are what is counted. `count` then
       `insert` without the lock lets every one of these see the same count and
       insert anyway, which is the whole reason the lock is there. */
    expect(await rowsFor(ALICE)).toBe(FEEDBACK_HOURLY_CAP);
  });

  /**
   * **The closed vocabulary, and the caps, checked against the database
   * rather than against themselves.**
   *
   * There were two vocabularies until 2026-09-02, when `route_kind` became a
   * URL and stopped being one — src/db/schema.ts § `url`.
   * `FEEDBACK_ENVIRONMENTS` and
   * `MAX_FEEDBACK_ANSWER_CHARS` live in src/types.ts, where the dialog and the
   * route read them, and the CHECK constraints in src/db/schema.ts write the
   * same values out by hand — because building them from these arrays would make
   * the schema import src/types.ts at runtime, and src/store/public-slug.ts
   * imports the schema, so the public read path's import graph would grow a node
   * (tests/public-imports.test.ts).
   *
   * Two copies, then, and this is what keeps them honest: a value added to a
   * union and not to the CHECK goes red here, at the insert, which is where it
   * would have hurt. Written after that trade was made, not before.
   */
  it("takes every environment the types allow", async () => {
    for (const environment of FEEDBACK_ENVIRONMENTS) {
      const filed = await runAsOwner(ALICE, () =>
        pgFeedbackStore.submit(report({ id: mintId(), environment })),
      );
      expect([environment, filed.kind]).toEqual([environment, "created"]);
      await clear();
    }
    /* The other half, and the reason the loop above is not merely a slow way of
       asserting nothing: the constraint really does refuse what is not in the
       list. Cast, because this is the one caller allowed to be wrong. */
    expect(
      await violation(() =>
        runAsOwner(ALICE, () =>
          pgFeedbackStore.submit(
            report({ id: mintId(), environment: "somewhere-else" as FeedbackEnvironment }),
          ),
        ),
      ),
    ).toBe("feedback_environment");
  });

  /**
   * **The cap on the address, from the database's side.**
   *
   * `route_kind` was a closed vocabulary until 2026-09-02, and the loop above
   * used to walk it. There is nothing to walk now — a URL has no vocabulary —
   * so what is left to hold is the pair of things `feedback_url_shape` really
   * promises: `null` is allowed (a bundle older than the change), and 2048 is
   * the ceiling. `MAX_FEEDBACK_URL_CHARS` in src/types.ts is the same number,
   * and this is the test that notices when the two stop agreeing.
   */
  it("takes an address of exactly the cap, refuses one more, and allows none at all", async () => {
    const pad = (n: number) => `https://www.spideryarn.com/read/a?q=${"x".repeat(n)}`;
    const exact = pad(MAX_FEEDBACK_URL_CHARS - pad(0).length);
    expect(exact).toHaveLength(MAX_FEEDBACK_URL_CHARS);

    const filed = await runAsOwner(ALICE, () =>
      pgFeedbackStore.submit(report({ id: mintId(), url: exact })),
    );
    expect(filed.kind).toBe("created");
    await clear();

    expect(
      await violation(() =>
        runAsOwner(ALICE, () => pgFeedbackStore.submit(report({ id: mintId(), url: `${exact}x` }))),
      ),
    ).toBe("feedback_url_shape");
    await clear();

    /* `null` is a real answer rather than a hole: src/db/schema.ts § `url`
       files an old client's report instead of refusing it. */
    const old = await runAsOwner(ALICE, () =>
      pgFeedbackStore.submit(report({ id: mintId(), url: null })),
    );
    expect(old.kind).toBe("created");
  });

  it("takes a body of exactly the database's cap, and refuses one character more", async () => {
    /* **`MAX_FEEDBACK_BODY_CHARS`, not `MAX_FEEDBACK_ANSWER_CHARS`, and the gap
       between them is the point.** The reader meets the smaller one, in the
       route and in the dialog. The column has to admit the larger, because the
       migration that made one box out of three glued three separately-capped
       answers together — a 4,000 CHECK would have made a row that was legal when
       it was filed illegal afterwards. */
    const atTheCap = "x".repeat(MAX_FEEDBACK_BODY_CHARS);
    const filed = await runAsOwner(ALICE, () =>
      pgFeedbackStore.submit(report({ id: mintId(), body: atTheCap })),
    );
    expect(filed.kind).toBe("created");
    /* One over, and the database is what says no — a paste of an entire article
       must not be able to become an attachment on its way to Sentry, and a rule
       enforced only in TypeScript holds only for the callers that went through
       that TypeScript. */
    expect(
      await violation(() =>
        runAsOwner(ALICE, () => pgFeedbackStore.submit(report({ id: mintId(), body: `${atTheCap}x` }))),
      ),
    ).toBe("feedback_body_shape");
  });

  it("files a report under every kind there is, and under none", async () => {
    /* The same shape as the route-kind loop above, and for the same reason: the
       CHECK in src/db/schema.ts writes the vocabulary out by hand, so this is
       what stops the two lists drifting apart. Null is in the domain and not in
       the list — Greg asked for the toggle to start unset, so "they did not say"
       is an answer this table has to take. */
    for (const kind of [...FEEDBACK_KINDS, null]) {
      const filed = await runAsOwner(ALICE, () =>
        pgFeedbackStore.submit(report({ id: mintId(), kind })),
      );
      expect([kind, filed.kind]).toEqual([kind, "created"]);
      await clear();
    }
    expect(
      await violation(() =>
        runAsOwner(ALICE, () =>
          pgFeedbackStore.submit(report({ id: mintId(), kind: "grumble" as FeedbackKind })),
        ),
      ),
    ).toBe("feedback_kind");
  });

  it("refuses diagnostics the reader did not consent to", async () => {
    /* The tick-box is the whole argument for this feature being an exception to
       src/monitoring-scrub.ts's rule, so it is a constraint rather than an
       intention. A store that forgot to pass `consented` through would otherwise
       file the blob and look fine. */
    expect(
      await violation(() =>
        runAsOwner(ALICE, () =>
          pgFeedbackStore.submit(
            report({
              id: mintId(),
              consented: false,
              diagnostics: { version: 1, payload: { viewport: [1200, 800] } },
            }),
          ),
        ),
      ),
    ).toBe("feedback_diagnostics_consented");
  });

  it("logs how much the reader wrote, never what they wrote", async () => {
    /* The hard rule of this whole feature, and the one most likely to be undone
       by somebody adding a helpful field to a log line. docs/project/logging.md. */
    const id = mintId();
    const SECRET = "thaumaturgical";
    const words = { body: `A ${SECRET} account of what I did, and what I saw instead` };
    const logged = await logLinesWhile(async () => {
      await runAsOwner(ALICE, () =>
        pgFeedbackStore.submit(
          report({ id, ...words, reporterEmail: `${SECRET}@example.invalid` }),
        ),
      );
    });

    /* **The positive control first.** Every way this test can be wrong — the
       level left silent, the store not logging at all, pino writing some other
       way — produces an empty capture, and an empty capture satisfies every
       `not.toContain` below. tests/helpers/log-capture.ts says so at length. */
    expect(logged).toContain("feedback report filed");
    expect(logged).toContain(id);
    expect(logged).not.toContain(SECRET);
    /* The length is the useful part, and it is what is there instead: how much
       somebody wrote is a fact about the app, what they wrote is theirs. */
    const chars = words.body.length;
    expect(logged).toContain(`"chars":${chars}`);
  });
});
