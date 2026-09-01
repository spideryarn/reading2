/**
 * The feedback store: one report, filed once, ten an hour, and nobody else's.
 *
 * Four properties, and each one is a thing that would be silently wrong rather
 * than loudly broken if it went:
 *
 * 1. **Idempotent.** The same client-minted id twice files one report. Without
 *    it a double-clicked Submit is two rows and — once the Sentry mirror lands —
 *    two copies of one bug, because feedback events are not deduped there.
 * 2. **Capped, and the cap is inside the transaction.** `count` then `insert` is
 *    raceable: concurrent requests all see the same count and all insert. The
 *    owner-scoped advisory lock is what makes ten mean ten.
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
 * **Statically, not with a dynamic `import()` inside the test.** Nothing here
 * needs the store flag changed — `SPIDERYARN_STORE` is unset under `npm test`,
 * which is exactly the files branch this file is asking about — and importing
 * the whole store layer inside an `it` puts five seconds of module transform
 * inside a five-second test timeout on a busy machine.
 */
import { feedbackStore } from "../src/store/index.js";
import { feedback as feedbackTable } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { mintId } from "../src/ids.js";
import { runAsOwner, type OwnerId } from "../src/owner.js";
import {
  FEEDBACK_HOURLY_CAP,
  FEEDBACK_WINDOW_MS,
  type NewFeedback,
} from "../src/store/contracts.js";
import {
  FEEDBACK_ENVIRONMENTS,
  FEEDBACK_ROUTE_KINDS,
  MAX_FEEDBACK_ANSWER_CHARS,
  type FeedbackRouteKind,
} from "../src/types.js";
import { pgFeedbackStore } from "../src/store/pg-feedback.js";
import { logLinesWhile } from "./helpers/log-capture.js";
import { pgReady } from "./helpers/pg-ready.js";

/* Put the level back straight after the imports: vitest reuses a worker across
   files and does not reset `process.env` between them, and src/log.ts has read
   it by now. */
if (HOISTED.previousLevel === undefined) delete process.env.LOG_LEVEL;
else process.env.LOG_LEVEL = HOISTED.previousLevel;

loadEnvLocal();

/* ------------------------------------------------ the filesystem refusal -- */

/**
 * **No database needed, and outside the `when` on purpose.**
 *
 * This is the half that has to hold on a fresh clone: `feedbackStore` is
 * selected at module load from `SPIDERYARN_STORE`, which is unset under
 * `npm test`, so what this file imports is the refusal itself.
 */
describe("the feedback store on the filesystem", () => {
  it("refuses to file a report, with a 501 and a sentence", async () => {
    /* Wrapped in an async call, because the refusal is a **synchronous** throw
       from a promise-shaped method — the shape `visibilityOnFiles` already
       establishes, and the shape a route's `await store.submit(...)` inside a
       try/catch sees either way. Asserting on the bare call would be asserting
       on how the refusal is spelled rather than on what a caller gets. */
    const refused = (async () => feedbackStore.submit(report({ id: mintId() })))();
    /* `status: 501`, because src/routes.ts reads `status` off the error and a
       500 would tell the reader something broke rather than that this store
       cannot do it. And the sentence, because the dialog shows it: "your report
       was not saved" is the only honest thing to say. */
    await expect(refused).rejects.toMatchObject({ status: 501 });
    await expect(refused).rejects.toThrow(/not saved/);
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

const { reachable } = await pgReady({
  suite: "tests/feedback-store.test.ts",
  tables: ["spideryarn.feedback"],
});

const when = reachable ? describe : describe.skip;

/** A minimal, valid report. Overrides on top, so each test says only what it means. */
function report(over: Partial<NewFeedback> & { id: string }): NewFeedback {
  return {
    reporterEmail: "reporter@example.invalid",
    steps: "Open an article and press the button",
    expected: "A dialog",
    actual: "Nothing at all",
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

async function seedUser(id: string, email: string): Promise<void> {
  await getDb().execute(sql`
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
    values (${id}, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            ${email}, 'x', now(), now())
    on conflict (id) do nothing`);
}

async function clear(): Promise<void> {
  const db = getDb();
  for (const owner of [ALICE, BOB]) {
    await db.delete(feedbackTable).where(eq(feedbackTable.ownerId, owner));
  }
}

/**
 * **Which constraint a write violated**, taken off the error's `cause`.
 *
 * Not off the message: Drizzle puts the whole failed query — and its bound
 * parameters, which here are the reader's own words — into `Error.message`, and
 * that is the entire reason `guardDbStore` exists (src/store/db-errors.ts). The
 * store is wrapped in it at the seam; these tests call the raw store, so they
 * read the structured field rather than matching prose that must not be shown to
 * anybody.
 *
 * Returns a sentence rather than `undefined` when the write *succeeded*, so a
 * constraint that has quietly stopped firing reads as what it is instead of as
 * "expected undefined".
 */
async function violation(body: () => Promise<unknown>): Promise<string> {
  try {
    await body();
  } catch (err) {
    return (err as { cause?: { constraint?: string } }).cause?.constraint ?? String(err);
  }
  return "(the write was accepted)";
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

when("the Postgres feedback store", { timeout: 30_000 }, () => {
  beforeAll(async () => {
    await seedUser(ALICE, "feedback-alice@example.invalid");
    await seedUser(BOB, "feedback-bob@example.invalid");
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
    expect(stored?.steps).toBe("Open an article and press the button");
    expect(stored?.expected).toBe("A dialog");
    expect(stored?.actual).toBe("Nothing at all");
    expect(stored?.reporterEmail).toBe("reporter@example.invalid");
    expect(stored?.consented).toBe(true);
    expect(stored?.routeKind).toBe("read");
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
      pgFeedbackStore.submit(report({ id, actual: "the first telling" })),
    );
    const second = await runAsOwner(ALICE, () =>
      pgFeedbackStore.submit(report({ id, actual: "a different telling" })),
    );

    expect(first.kind).toBe("created");
    expect(second.kind).toBe("duplicate");
    /* **The stored report, not the one just submitted.** A retry that differs
       in its text must not overwrite what the reader first sent, and reporting
       the *new* text back would hide that it had been ignored. */
    if (second.kind !== "duplicate") throw new Error("unreachable");
    expect(second.report.actual).toBe("the first telling");
    /* And the row count, because "returns duplicate" and "wrote nothing" are
       two claims and only one of them is about the database. */
    expect(await rowsFor(ALICE)).toBe(1);
  });

  it("refuses the eleventh report in an hour, and takes the tenth", async () => {
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
      pgFeedbackStore.submit(report({ id, actual: "what Alice saw" })),
    );
    /* **The same id, a different owner.** The key is composite, so this is a
       second report and not a duplicate — a single-column unique index would
       hand Bob a 409 about a report he cannot see, and a global primary key
       would make one reader's minted id able to block another's. */
    const theirs = await runAsOwner(BOB, () =>
      pgFeedbackStore.submit(report({ id, actual: "what Bob saw" })),
    );
    expect([mine.kind, theirs.kind]).toEqual(["created", "created"]);
    expect(await rowsFor(ALICE, id)).toBe(1);
    expect(await rowsFor(BOB, id)).toBe(1);

    /* Each reads their own, by the same id. */
    expect((await runAsOwner(ALICE, () => pgFeedbackStore.read(id)))?.actual).toBe("what Alice saw");
    expect((await runAsOwner(BOB, () => pgFeedbackStore.read(id)))?.actual).toBe("what Bob saw");

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

  it("records that Sentry took it, and only then", async () => {
    const id = mintId();
    await runAsOwner(ALICE, () => pgFeedbackStore.submit(report({ id })));
    await runAsOwner(ALICE, () => pgFeedbackStore.markMirrored(id, "0123456789abcdef"));
    const stored = await runAsOwner(ALICE, () => pgFeedbackStore.read(id));
    expect(stored?.sentryEventId).toBe("0123456789abcdef");
    expect(Number.isNaN(Date.parse(stored?.mirroredAt ?? ""))).toBe(false);

    /* Somebody else's report is not markable, for the same reason it is not
       readable. Nothing throws — there is simply no such row for this owner. */
    await runAsOwner(BOB, () => pgFeedbackStore.markMirrored(id, "deadbeef"));
    expect((await runAsOwner(ALICE, () => pgFeedbackStore.read(id)))?.sentryEventId).toBe(
      "0123456789abcdef",
    );
  });

  /**
   * **The two closed vocabularies, and the cap, checked against the database
   * rather than against themselves.**
   *
   * `FEEDBACK_ROUTE_KINDS`, `FEEDBACK_ENVIRONMENTS` and
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
  it("takes every route kind and every environment the types allow", async () => {
    for (const routeKind of FEEDBACK_ROUTE_KINDS) {
      const filed = await runAsOwner(ALICE, () =>
        pgFeedbackStore.submit(report({ id: mintId(), routeKind })),
      );
      expect([routeKind, filed.kind]).toEqual([routeKind, "created"]);
      await clear();
    }
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
            report({ id: mintId(), routeKind: "somewhere-else" as FeedbackRouteKind }),
          ),
        ),
      ),
    ).toBe("feedback_route_kind");
  });

  it("takes an answer of exactly the cap, and refuses one character more", async () => {
    const atTheCap = "x".repeat(MAX_FEEDBACK_ANSWER_CHARS);
    const filed = await runAsOwner(ALICE, () =>
      pgFeedbackStore.submit(report({ id: mintId(), steps: atTheCap })),
    );
    expect(filed.kind).toBe("created");
    /* One over, and the database is what says no — a paste of an entire article
       must not be able to become an attachment on its way to Sentry, and a rule
       enforced only in TypeScript holds only for the callers that went through
       that TypeScript. */
    expect(
      await violation(() =>
        runAsOwner(ALICE, () => pgFeedbackStore.submit(report({ id: mintId(), steps: `${atTheCap}x` }))),
      ),
    ).toBe("feedback_steps_shape");
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
    const words = {
      steps: `A ${SECRET} account of what I did`,
      expected: `Something ${SECRET}`,
      actual: `Nothing ${SECRET} at all`,
    };
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
    const chars = words.steps.length + words.expected.length + words.actual.length;
    expect(logged).toContain(`"chars":${chars}`);
  });
});
