/**
 * In `postgres` mode, a write with nowhere to go must say so.
 *
 * ## The bug this pins
 *
 * `SPIDERYARN_STORE=postgres` moves articles, comments and the shelf to
 * Postgres. Chat and meaning-search have no Postgres store wired, and until
 * 2026-08-26 they did not notice: `src/chat.ts` and `src/searches.ts` write
 * with `node:fs/promises` and never read the flag. So a conversation, or a
 * saved search, **was written to a file, reported success, and was invisible to
 * every Postgres read** — `src/store/index.ts`'s own header calls that the worst
 * available outcome, because it loses the data while telling the reader it
 * did not.
 *
 * The two glossary writes had been refusing loudly all along, through
 * `notMigrated`. What made this hard to see is that the obvious fix does not
 * work: `notMigrated` lives in `src/store/index.ts` and can only refuse a call
 * that comes through it, and `src/routes.ts` imports these writes straight from
 * the two modules. Two plans proposed extending it anyway. The guard has to be
 * where the write is.
 *
 * ## Why it asserts the status rather than the sentence
 *
 * `src/routes.ts` reads `status` off a thrown error to pick the response, so
 * **501 is the behaviour** and the wording is not. A refusal that came back as
 * a 500 would read to anybody watching as "this broke", rather than "this is
 * not built here yet", which is what `docs/project/deployment.md` already says
 * about both features in production.
 *
 * No database needed: this is about which branch a flag chooses.
 */

import { describe, expect, it, vi } from "vitest";

const SLUG = "not-migrated-fixture";

/**
 * `SPIDERYARN_STORE=postgres`, set before any import runs.
 *
 * `vi.hoisted` rather than a plain statement, for the reason written out at
 * length in tests/db-error-scrub.test.ts: `src/store/live.ts` reads the flag the
 * first time anything imports it, and imports are hoisted above every statement
 * in a file. Nothing imported here reaches `live.ts` statically *today* — and
 * that is precisely the kind of fact that stops being true when somebody adds
 * an import three files away, which is how it stopped being true over there.
 */
const PREVIOUS_FLAG = vi.hoisted(() => {
  const previous = process.env.SPIDERYARN_STORE;
  process.env.SPIDERYARN_STORE = "postgres";
  return previous;
});

const chat = await import("../src/chat.js");
const searches = await import("../src/searches.js");
const { STORE } = await import("../src/store/live.js");

/* Put back straight after the imports: vitest reuses a worker across test files
   and does not reset `process.env` between them. */
if (PREVIOUS_FLAG === undefined) delete process.env.SPIDERYARN_STORE;
else process.env.SPIDERYARN_STORE = PREVIOUS_FLAG;

describe("the flag these tests depend on", () => {
  it("is set, because a refusal that never fires looks like a passing test", () => {
    /* Only for the read assertion at the bottom. The write assertions fail
       loudly if the flag is wrong — the write succeeds and no error is thrown.
       The read one would go quietly green, since `[]` is also what the
       filesystem answers for an article nobody has chatted about. */
    expect(STORE).toBe("postgres");
  });
});

const statusOf = async (write: Promise<unknown>): Promise<unknown> => {
  const thrown = await write.catch((err: unknown) => err);
  expect(thrown, "the write was supposed to be refused").toBeInstanceOf(Error);
  return (thrown as { status?: number }).status;
};

describe("a chat write in postgres mode", () => {
  it("refuses rather than writing a file nothing will read back", async () => {
    const begin = chat.beginTurn(SLUG, {
      threadId: "spya-thr222",
      question: "What does this mean?",
    });
    expect(await statusOf(begin)).toBe(501);
  });

  it("refuses every other write too, because they share one save", async () => {
    /* Named individually rather than trusted to the shared funnel. The funnel
       is what makes the guard cheap; the test is what stops a future write that
       skips it going quiet again. */
    expect(await statusOf(chat.renameThread(SLUG, "spya-thr111", "A name"))).toBe(501);
    expect(await statusOf(chat.deleteThread(SLUG, "spya-thr111"))).toBe(501);
    expect(await statusOf(chat.update(SLUG, (threads) => threads))).toBe(501);
  });
});

describe("a meaning-search write in postgres mode", () => {
  it("refuses rather than writing a file nothing will read back", async () => {
    expect(await statusOf(searches.beginRun(SLUG, "every passage about cost"))).toBe(501);
  });

  it("refuses every other write too", async () => {
    expect(await statusOf(searches.deleteRun(SLUG, "spya-run111"))).toBe(501);
    expect(await statusOf(searches.update(SLUG, (runs) => runs))).toBe(501);
  });
});

describe("what the guard deliberately does not do", () => {
  it("lets reads answer, rather than 501ing the whole reading view", async () => {
    /* A read of an article with no chat file returns `[]`, and in `postgres`
       mode that answer is *correct* rather than merely quiet: nothing writes
       chat rows to Postgres, so the Postgres side is empty too. Refusing the
       read would put an error banner on every article for a feature whose only
       honest answer is "there are none".

       This is the line that changes when step 10 lands. Once `pgChatStore` is
       wired, a read that still comes off the disk IS wrong, and this
       expectation should become the opposite one. */
    expect(await chat.loadThreads(SLUG)).toEqual([]);
    expect(await searches.loadRuns(SLUG)).toEqual([]);
  });
});
