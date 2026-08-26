/**
 * A failed Drizzle query must not carry the reader's words out of the store.
 *
 * ## The hazard, stated as a test rather than a paragraph
 *
 * `drizzle-orm` builds a failed query's error as
 *
 *     Failed query: insert into "comments" … values ($1, $2, $3)
 *     params: <every bound value>
 *
 * — and the bound values here are **the reader's selected quote** and **the
 * model's whole answer**. That message reaches three places at once:
 * `src/routes.ts` sends `err.message` to the client, hands the same error to
 * `logRequest`, and on the comment and search completion paths copies it into
 * the row's `error` column, where the next failed query flattens it in again
 * one level deeper.
 *
 * Pino's redaction cannot help. It matches key paths, and by this point the
 * values are text inside `message` and `stack`.
 *
 * So the first test below **proves the hazard is real** — it binds a sentinel
 * and asserts Drizzle hands it back. That one is green before and after; it
 * exists so that a future Drizzle release which stops doing this is noticed
 * rather than assumed. The rest assert the seam translates it.
 *
 * See docs/plans/error-boundary.md and docs/project/logging.md.
 *
 * Skips loudly when there is no database — see tests/db-schema.test.ts.
 */

import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * `SPIDERYARN_STORE=postgres`, set before **any** import runs.
 *
 * `vi.hoisted` and not a plain statement, and this is the trap rather than a
 * style choice. `src/store/live.ts` reads the flag once, the first time anything
 * imports it — and imports are hoisted above every statement in a module, so
 * `process.env.SPIDERYARN_STORE = "postgres"` written as an ordinary line runs
 * *after* the import below has already evaluated `live.ts` and settled the
 * answer to `files`. Which import? `store/db-errors.js` → `src/chat.ts` →
 * `src/store/live.ts`, a chain that did not exist when this file was written
 * and appeared two hours later.
 *
 * The symptom was not an error. Every assertion here ran against the
 * *filesystem* comment store, where a NUL byte in a quote is just a character,
 * so `create` **succeeded** and the test complained that an insert it expected
 * to fail had not. A test silently exercising the wrong store is the shape
 * docs/reusable/silent-success.md is about, arriving inside the fix for it.
 */
const PREVIOUS_FLAG = vi.hoisted(() => {
  const previous = process.env.SPIDERYARN_STORE;
  process.env.SPIDERYARN_STORE = "postgres";
  return previous;
});

import { closeDb, getDb } from "../src/db/client.js";
import { articles, comments as commentsTable } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { kindOfMessage, STORAGE_BUSY, STORAGE_FAILED, worthRetrying } from "../src/messages.js";
import { guardDbStore } from "../src/store/db-errors.js";
import { currentOwnerId } from "../src/owner.js";

loadEnvLocal();

const SLUG = "db-error-scrub-fixture";
/* `e1`, not `e0`: tests/store-chat-pg.test.ts already owns `e0`, vitest runs
   test files in parallel, and this file's afterAll deletes the article by id —
   so sharing one made all 20 of that file's tests 404 on a row this file had
   just removed underneath it. It passed alone, which is what made it look like
   a flake in somebody else's work. tests/fixture-ids.test.ts now refuses a
   duplicate. */
/* `e5`, and it has moved twice. `e0` is tests/store-chat-pg.test.ts's, and
   `e1` is tests/store-writes-land-in-postgres.test.ts's — both collisions were
   found by tests/fixture-ids.test.ts rather than by the 404s they cause twenty
   lines away in somebody else's file. Read that test before picking one. */
const ARTICLE_ID = "00000000-0000-4000-8000-0000000000e5";

/** One unmistakable string, standing in for the article and the reader's quote. */
const SENTINEL = "SENTINEL-e7f2-the-readers-own-words";

/**
 * A NUL byte, which is how this test makes a query fail on demand.
 *
 * Postgres rejects `U+0000` in a text value (`22021`), so a quote containing
 * one fails at the `insert` — after the parameter has been bound, which is the
 * only kind of failure that can leak it. No fixture corruption, no dropped
 * table, nothing to clean up.
 */
const NUL = "\u0000";

let reachable = false;

if (process.env.DATABASE_URL) {
  const { Pool } = await import("pg");
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: 10_000,
  });
  let why = "";
  try {
    const probe = await pool.query("select to_regclass('spideryarn.comments') is not null as ready");
    reachable = probe.rows[0]?.ready === true;
    if (!reachable) why = "the spideryarn schema is not there — run npm run db:migrate";
  } catch (err) {
    reachable = false;
    why = `could not reach it: ${(err as Error).message}`;
  }
  await pool.end();
  if (!reachable) console.warn(`\n  ⚠ DATABASE_URL is set but these tests are skipping: ${why}\n`);
}

const when = reachable ? describe : describe.skip;

/**
 * The store as `SPIDERYARN_STORE=postgres` selects it — asserted, not assumed.
 *
 * The flag comes from the `vi.hoisted` block at the top; see the note there for
 * why it cannot be an ordinary statement. The check is the other half of the
 * same lesson: without it, this file passed for two hours while running every
 * assertion against the filesystem store, because a failure to *select* the
 * Postgres store looks exactly like the Postgres store behaving well.
 */
const { commentStore, STORE } = await import("../src/store/index.js");

/* Put back straight after the import, because vitest reuses a worker process
   across test files and `process.env` is not reset between them — the modules
   above have already captured the flag, so nothing here needs it any more, and
   leaving it set hands the next file a store it did not ask for. */
if (PREVIOUS_FLAG === undefined) delete process.env.SPIDERYARN_STORE;
else process.env.SPIDERYARN_STORE = PREVIOUS_FLAG;

describe("the store these tests are actually talking to", () => {
  it("is the Postgres one", () => {
    expect(STORE).toBe("postgres");
  });
});

/**
 * Every string an error could put on a wire, in a log line, or in a stored
 * column — its own text, its properties, and the `cause` chain behind it.
 *
 * Deliberately wider than what any single channel writes down. `safeError` in
 * src/log.ts keeps `message`, `stack` and the `cause` chain; `JSON.stringify`
 * of an error keeps its enumerable own properties, which is where Drizzle puts
 * `params`. Asserting over the union means a test that stays true when one of
 * those channels changes its mind about what it keeps.
 */
function everyStringIn(value: unknown, depth = 0): string[] {
  if (depth > 4 || value === null || value === undefined) return [];
  if (typeof value === "string") return [value];
  if (typeof value !== "object") return [];
  const out: string[] = [];
  if (value instanceof Error) {
    out.push(value.name, value.message, value.stack ?? "");
    out.push(...everyStringIn(value.cause, depth + 1));
  }
  for (const v of Object.values(value as Record<string, unknown>)) {
    out.push(...everyStringIn(v, depth + 1));
  }
  return out;
}

when("a failed query in the Postgres store", () => {
  beforeAll(async () => {
    const db = getDb();
    await db
      .insert(articles)
      // No `currentRevisionId`, so the library cannot see it and the parity
      // test cannot be made flaky by it. Same trick as tests/store-comments.
      .values({ id: ARTICLE_ID, ownerId: currentOwnerId(), slug: SLUG })
      .onConflictDoNothing();

    /* Checked rather than trusted — see the same block in
       tests/store-writes-land-in-postgres.test.ts for what `onConflictDoNothing`
       hides when two files share a fixture id. These two files did. */
    const [row] = await db
      .select({ id: articles.id })
      .from(articles)
      .where(eq(articles.slug, SLUG))
      .limit(1);
    if (row?.id !== ARTICLE_ID) {
      throw new Error(
        `The fixture article for "${SLUG}" is ${row?.id ?? "missing"}, not ${ARTICLE_ID}. ` +
          "Another test file is probably using the same id with a different slug.",
      );
    }
  });

  afterEach(async () => {
    await getDb().delete(commentsTable).where(eq(commentsTable.articleId, ARTICLE_ID));
  });

  afterAll(async () => {
    const db = getDb();
    await db.delete(commentsTable).where(eq(commentsTable.articleId, ARTICLE_ID));
    await db.delete(articles).where(eq(articles.id, ARTICLE_ID));
    await closeDb();
  });

  it("is exactly the hazard: Drizzle writes every bound value into the message", async () => {
    /* Not a test of our code. It pins the third-party behaviour the seam exists
       to contain, so that "we can stop scrubbing now" has to be argued rather
       than assumed. */
    const thrown = await getDb()
      .execute(sql`select cast(${`${SENTINEL}${NUL}`} as text)`)
      .catch((err: unknown) => err);

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain(SENTINEL);
  });

  it("does not carry the reader's quote out of the store", async () => {
    const thrown = await commentStore
      .create(SLUG, {
        id: "spya-scrb22",
        blockId: "spya-blk222",
        quote: `${SENTINEL}${NUL}`,
        start: 0,
      })
      .catch((err: unknown) => err);

    expect(thrown, "the insert was supposed to fail").toBeInstanceOf(Error);
    for (const text of everyStringIn(thrown)) {
      expect(text, "a bound parameter escaped the store").not.toContain(SENTINEL);
    }
  });

  it("says something a reader can read, with a code behind it", async () => {
    /* The message is what src/routes.ts sends to the client and what the
       comment and search completion paths store in the row's `error` column. So
       it has to be one of the sentences in src/messages.ts — which also means
       `worthRetrying` can classify it, instead of returning "offer the retry"
       for a database constraint that will refuse the same write for ever. */
    const thrown = (await commentStore
      .create(SLUG, {
        id: "spya-scrb33",
        blockId: "spya-blk333",
        quote: `${SENTINEL}${NUL}`,
        start: 0,
      })
      .catch((err: unknown) => err)) as Error;

    expect(kindOfMessage(thrown.message), thrown.message).not.toBeNull();
  });

  it("keeps the SQLSTATE, because that is the part worth logging", async () => {
    /* `code` is on `SAFE_ERROR_PROPS` in src/log.ts, so this is the one
       diagnostic that survives into the log line without anybody adding a
       field. `22021` is "invalid byte sequence" — five characters that say what
       happened, carrying none of what it happened to. */
    const thrown = (await commentStore
      .create(SLUG, {
        id: "spya-scrb44",
        blockId: "spya-blk444",
        quote: `${SENTINEL}${NUL}`,
        start: 0,
      })
      .catch((err: unknown) => err)) as { code?: string };

    expect(thrown.code).toBe("22021");
  });

  it("still lets a tagged 404 through as itself", async () => {
    /* The over-correction this guards against: translating *everything* would
       turn "no such article" into "the database failed", and a reader who
       mistyped a slug would be told this app is broken. src/routes.ts reads the
       `status` property to pick the response, so that property is the test. */
    const thrown = await commentStore
      .create("no-such-article-here", {
        id: "spya-scrb55",
        blockId: "spya-blk555",
        quote: "ordinary words",
        start: 0,
      })
      .catch((err: unknown) => err);

    expect((thrown as { status?: number }).status).toBe(404);
  });
});

/**
 * The guard itself, on a store that is a few lines of test.
 *
 * Not gated on a database, and that is the point of writing it this way: the
 * branch that decides **whether the reader is offered another go** cannot be
 * driven from a real failure without arranging a deadlock, and an untested
 * branch that decides a button is how this codebase got here in the first place
 * (docs/plans/simplification-audit.md — "a rule can be documented, implemented
 * and tested and still not reach the screen").
 *
 * The assertions go through `worthRetrying` rather than pinning a sentence,
 * because copy is meant to stay rewritable — docs/project/copy.md.
 */
describe("the guard, without a database", () => {
  /** A store of one method, which throws whatever it is given. */
  const throwing = (err: unknown) =>
    guardDbStore("probe", {
      async run(): Promise<void> {
        throw err;
      },
    });

  const failureFrom = async (err: unknown): Promise<Error> =>
    (await throwing(err)
      .run()
      .catch((e: unknown) => e)) as Error;

  it("offers another go for a deadlock, which is the one worth retrying", async () => {
    /* `40001` is serialisation failure: two writers, one loses, and retrying is
       the remedy the database is asking for. It arrives under Drizzle's wrapper,
       so this also pins that the SQLSTATE is found by walking `cause` rather
       than by reading the error that was thrown. */
    const wrapped = new Error("Failed query: …\nparams: …", {
      cause: Object.assign(new Error("deadlock detected"), { code: "40001" }),
    });

    expect(worthRetrying((await failureFrom(wrapped)).message)).toBe(true);
  });

  it("does not offer one for a constraint that will refuse the same row again", async () => {
    const wrapped = new Error("Failed query: …\nparams: …", {
      cause: Object.assign(new Error("violates foreign key constraint"), { code: "23503" }),
    });

    expect(worthRetrying((await failureFrom(wrapped)).message)).toBe(false);
  });

  it("offers one when the connection never got there", async () => {
    /* No SQLSTATE at all — `pg` fails with Node's errno before Postgres has
       said anything. Called permanent, this would tell a reader that a database
       which was briefly unreachable is a bug in the app. */
    const refused = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });

    expect(worthRetrying((await failureFrom(refused)).message)).toBe(true);
  });

  it("scrubs an error that has nothing to do with Drizzle", async () => {
    /* The allowlist, doing the thing a detector could not: a store throwing its
       own message with a value interpolated into it is not on anybody's list of
       third-party error shapes, and is covered anyway.

       **Asserting the classified sentence, not merely the sentinel's absence.**
       Absence was satisfied for a while by the scrubber throwing its own
       `TypeError` — the sentinel really was gone, and so was the classification,
       the `[db-*]` code and the diagnostic log. A test that asks only "is the
       secret gone" is answered perfectly by a crash. Found by GPT Sol,
       2026-08-26. */
    const homegrown = new Error(`bad row: ${SENTINEL}`);
    const failure = await failureFrom(homegrown);

    expect(failure.message).not.toContain(SENTINEL);
    expect(failure.name).toBe("StoreFailure");
    expect(failure.message).toBe(STORAGE_FAILED.message);
    expect(kindOfMessage(failure.message)).not.toBeNull();
  });

  it("classifies a connection failure as its own sentence, not as a crash", async () => {
    /* The same hole from the other side. `ECONNREFUSED` carries an errno rather
       than a SQLSTATE, so nothing in the chain has one — which used to make the
       scrubber dereference `undefined`. `worthRetrying` said "true" about the
       resulting TypeError and the retryability test was satisfied by it. */
    const refused = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
    const failure = await failureFrom(refused);

    expect(failure.name).toBe("StoreFailure");
    expect(failure.message).toBe(STORAGE_BUSY.message);
  });

  it("keeps the frames and drops the line that carries the message", async () => {
    /* What makes the scrub affordable. The message is gone; the stack still
       says which file and line threw, which is most of what a bug in a store
       was going to tell you. */
    const stack = (await failureFrom(new Error(`bad row: ${SENTINEL}`))).stack ?? "";

    expect(stack).not.toContain(SENTINEL);
    expect(stack).toMatch(/^\s+at /m);
  });

  it("lets a tagged failure through with its own words", async () => {
    /* `notMigrated`'s 501 and the reader's 404 both say something true and
       chosen. Translating them would replace a useful sentence with a generic
       one and lose the status with it. */
    const tagged = Object.assign(new Error("Looking a term up has no Postgres implementation yet."), {
      status: 501,
    });

    expect(await failureFrom(tagged)).toBe(tagged);
  });

  it("catches a throw that happens before anything is awaited", async () => {
    /* A store method may validate its arguments and throw synchronously, which
       a `.catch()` on the returned promise never sees — there is no promise. */
    const store = guardDbStore("probe", {
      run(): Promise<void> {
        throw new Error(`bad argument: ${SENTINEL}`);
      },
    });

    let thrown: unknown;
    try {
      void store.run();
    } catch (err) {
      thrown = err;
    }
    expect((thrown as Error).message).not.toContain(SENTINEL);
  });
});

describe("wrapping a store that has no methods to wrap", () => {
  it("refuses, rather than handing back an empty guard", () => {
    /* The failure this shape invites: `Object.entries` sees own enumerable
       properties, and a class's methods are on the prototype. A store written
       as a class would come back wrapped in nothing at all, and the wrapping
       would report success. */
    class Store {
      async run(): Promise<void> {}
    }

    expect(() => guardDbStore("probe", new Store())).toThrow(/no methods/);
  });
});
