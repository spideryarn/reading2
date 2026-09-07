/**
 * A chat or search write must reach Postgres and **must not touch the disk**.
 *
 * ## The bug this is the regression test for
 *
 * Until 2026-08-26, `SPIDERYARN_STORE=postgres` moved articles, comments and the
 * shelf to Postgres while chat and meaning-search carried on writing
 * `data/<slug>/chat.json` and `data/<slug>/searches.json` — because
 * `src/routes.ts` imported their writes straight from `src/chat.ts` and
 * `src/searches.ts`, which call `node:fs/promises` and never read the flag. A
 * conversation was **written, reported successful, and invisible to every
 * read**. `src/store/index.ts`'s header calls that the worst available outcome,
 * because it loses the data while telling the reader it did not.
 *
 * It was fixed twice, and the second fix deleted the first. The interim was a
 * 501 from each module's own `save()`; the real answer is step 10 of
 * docs/plans/260826e-postgres-storage-implementation.md — `chatStore` and `searchStore`
 * in `src/store/index.ts`, which routes.ts now calls.
 *
 * **This file survived that change on purpose, and its predecessor did not.**
 * A test that asserted "the write is refused" pinned the scaffolding, so the
 * proper fix turned it red — it was testing *how* the bug was avoided rather
 * than that it was. What both fixes have in common, and what any third one would
 * also have to satisfy, is the two assertions below: the write comes back out of
 * Postgres, and no file appears. That is the requirement. Refusing satisfied
 * half of it; wiring satisfies both.
 *
 * So the file assertion is not belt-and-braces. It is the half that fails if
 * somebody re-imports `src/chat.ts` directly in a route, which is exactly how
 * this happened the first time.
 *
 * Skips loudly when there is no database — see tests/db-schema.test.ts.
 */

import { existsSync } from "node:fs";
import path from "node:path";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDb, getDb } from "../src/db/client.js";
import { articles } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { currentOwnerId } from "../src/owner.js";
import { pgReady } from "./helpers/pg-ready.js";

loadEnvLocal();

const SLUG = "store-writes-fixture";
/* `e6`. `e1` was taken by tests/store-export-isolation.test.ts, which spells
   its uuid as an object property rather than a `const`, so the first version of
   tests/fixture-ids.test.ts could not see the clash. Both files insert and tear
   down that article. Found by a GPT Sol review, 2026-08-26; the guard now reads
   every uuid literal rather than one declaration shape. */
const ARTICLE_ID = "00000000-0000-4000-8000-0000000000e6";
const ROOT = path.resolve(import.meta.dirname, "..");

await pgReady({
  suite: "tests/store-writes-land-in-postgres.test.ts",
  tables: ["spideryarn.chat_threads"],
});

const { chatStore, searchStore } = await import("../src/store/index.js");

/* Put back straight after the import: vitest reuses a worker across test files
   and does not reset `process.env` between them, so leaving it set hands the
   next file a store it did not ask for. The modules above have already captured
   the flag, so nothing here needs it any more. */

describe("a write in postgres mode", () => {
  /* The fixture is set up and torn down **around both tests**, not inside the
     first one. Vitest runs an `afterAll` when its own block finishes, so a
     fixture owned by the first `describe` is deleted before the second one
     starts — and the second then fails with a 404 that looks like the store
     being broken rather than the article being gone. Cost twenty minutes here;
     worth the four lines of nesting. */
  beforeAll(async () => {
    const db = getDb();
    await db
      .insert(articles)
      // No `currentRevisionId`, so the library cannot see it and the parity
      // test cannot be made flaky by it. Same trick as tests/store-comments.
      .values({ id: ARTICLE_ID, ownerId: currentOwnerId(), slug: SLUG })
      .onConflictDoNothing();

    /* **`onConflictDoNothing` is the quiet half of this pattern**, and it cost
       an hour on 2026-08-26. Two test files that share a fixture id insert
       different slugs under the same primary key: the second one does nothing,
       says nothing, and every test in it then 404s on a slug that "was just
       inserted" — while the first file's `afterAll` deletes the row by id and
       takes the other's article with it. Alone, both files pass. So the insert
       is checked rather than trusted, and a collision fails here with the two
       ids in front of you instead of as a 404 twenty lines later. */
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

  afterAll(async () => {
    const db = getDb();
    // Threads and messages go with the article — the foreign keys cascade.
    await db.delete(articles).where(eq(articles.id, ARTICLE_ID));
    await closeDb();
  });

  it("puts a conversation in Postgres, and leaves no file behind", async () => {
    const turn = await chatStore.begin(SLUG, {
      threadId: "spya-thr333",
      question: "What does this mean?",
    });

    const threads = await chatStore.load(SLUG);
    expect(threads.map((t) => t.id)).toContain(turn.thread.id);

    expect(
      existsSync(path.join(ROOT, "data", SLUG, "chat.json")),
      "the conversation was written to a file, where no Postgres read will find it",
    ).toBe(false);
  });

  it("puts a saved search in Postgres, and leaves no file behind", async () => {
    const { run } = await searchStore.begin(SLUG, "every passage about cost");

    const runs = await searchStore.load(SLUG);
    expect(runs.map((r) => r.id)).toContain(run.id);

    expect(
      existsSync(path.join(ROOT, "data", SLUG, "searches.json")),
      "the saved search was written to a file, where no Postgres read will find it",
    ).toBe(false);
  });
});
