/**
 * The two stores must answer identically for chat, searches and lookups.
 *
 * `tests/store-parity.test.ts` does this for reads. These are **writes**, so
 * the comparison is a scripted sequence rather than a snapshot: drive both
 * stores through the same steps against the same fixed clock, and compare the
 * wire form after every one. A single end-state comparison would miss anything
 * that goes wrong and is then overwritten — a retry that keeps the previous
 * attempt's citations is invisible by the time the next answer lands.
 *
 * ## Ids are normalised, and that is the one concession
 *
 * Both stores mint ids from `Math.random`, so they cannot produce the same
 * ones, and only `withEdit` takes a seedable generator. Rather than thread a
 * seeded random through both adapters — which would be test scaffolding
 * reaching into production code — every `spya-xxxxxx` is replaced by `#0`,
 * `#1`, … in order of first appearance. That keeps everything structural: the
 * order of messages, which message a later step refers to, whether two fields
 * name the *same* id, statuses, text, titles, timestamps, `editedAt`,
 * `discarded` counts. What it gives up is the literal id, which is random and
 * therefore never comparable anyway.
 *
 * Because the mapping is by first appearance, an ordering bug shows up here as
 * a *renumbering* — which is a real failure, not a masked one.
 *
 * ## The fixture is `test-`-prefixed, and it cannot be `_`-prefixed
 *
 * `_test-…` was the first choice, because `importableSlugs` skips a leading
 * underscore. It does not work: `isSlug` is stricter than the slug check the
 * file stores use — `/^[a-z0-9][a-z0-9-]*$/`, no underscore — so every Postgres
 * store 400s on it while the filesystem store accepts it happily. That
 * divergence is real and is worth knowing about; it is not what this test is
 * for.
 *
 * `test-` is what the other fixtures here use and what
 * tests/store-parity.test.ts skips by name. The directory also holds no
 * `blocks.json`, so `importableSlugs` would not return it either — belt and
 * braces, because vitest runs files concurrently.
 *
 * Skips loudly when there is no database — see tests/db-schema.test.ts.
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { closeDb, getDb } from "../src/db/client.js";
import { articleRevisions, articles, blockIdentities, revisionBlocks } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { currentOwnerId } from "../src/owner.js";
import { fsChatStore, fsGlossaryLookupStore, fsSearchStore } from "../src/store/fs.js";
import { pgChatStore } from "../src/store/pg-chat.js";
import { pgGlossaryLookupStore } from "../src/store/pg-lookups.js";
import { pgSearchStore } from "../src/store/pg-searches.js";

loadEnvLocal();

const ROOT = path.resolve(import.meta.dirname, "..");
const SLUG = "test-reader-state-parity";
const ARTICLE_ID = "00000000-0000-4000-8000-00000000ab00";
/** Its one published revision — see the fixture below, which fills both stores. */
const REVISION_ID = "00000000-0000-4000-8000-00000000ab01";
const THREAD = "spya-thread";

let reachable = false;

if (process.env.DATABASE_URL) {
  const { Pool } = await import("pg");
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 2,
    connectionTimeoutMillis: 10_000,
  });
  let why = "";
  try {
    const probe = await pool.query(
      "select to_regclass('spideryarn.chat_messages') is not null as ready",
    );
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

/** Replace every minted id with `#n`, numbered by first appearance. */
function normalise(value: unknown, seen = new Map<string, string>()): unknown {
  if (typeof value === "string") {
    if (!/^spya-[a-z0-9]{6}$/.test(value)) return value;
    const known = seen.get(value);
    if (known) return known;
    const placeholder = `#${seen.size}`;
    seen.set(value, placeholder);
    return placeholder;
  }
  if (Array.isArray(value)) return value.map((v) => normalise(v, seen));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, normalise(v, seen)]),
    );
  }
  return value;
}

/**
 * The wire form, with ids normalised and the attempt token dropped.
 *
 * `attempt` is the one field the two stores are *supposed* to disagree about:
 * Postgres mints one per model call and the filesystem has none, deliberately
 * and permanently. It is also not wire form at all — the route holds it and it
 * never reaches a client — so comparing it would be asserting that a documented
 * difference is not there.
 *
 * Removed by name rather than by letting `JSON.stringify` drop the `undefined`
 * side, because that would have compared "absent" against "a uuid" and passed
 * only by accident of one of them being nullish.
 */
function wire(value: unknown): unknown {
  return normalise(JSON.parse(JSON.stringify(value, (key, v) => (key === "attempt" ? undefined : v))));
}

/** A clock both stores are driven by, so a timestamp is a fact not a race. */
function clock(): () => string {
  const start = Date.parse("2026-08-01T00:00:00.000Z");
  let n = 0;
  return () => new Date(start + 1000 * n++).toISOString();
}

when("the filesystem and Postgres stores agree about the reader's state", () => {
  /**
   * The two paragraphs both stores are made to agree about.
   *
   * Ids from the real alphabet — `abcdefghjkmnpqrstuvwxyz023456789`, no `i`,
   * `l`, `o` or `1`. An invalid one is not rejected; the store quietly mints its
   * own, and the test is then about something else.
   */
  const BLOCKS = [
    { id: "spya-parqty", tag: "p", kind: "text", text: "A spandrel is a leftover.", words: 4,
      html: "<p>A spandrel is a leftover.</p>", gistable: true },
    { id: "spya-parqtz", tag: "p", kind: "text", text: "A pendentive carries a dome.", words: 5,
      html: "<p>A pendentive carries a dome.</p>", gistable: true },
  ] as const;

  /**
   * **A real article on BOTH sides**, which is the whole point of the fixture.
   *
   * It used to be an article that existed in Postgres with no revision, and did
   * not exist on disk at all — two different situations being compared, which
   * `sourceHash` was the first field to notice. The filesystem store's
   * `currentSourceHash` falls through to `example/` for a slug with no
   * directory, mirroring what `articleDir` actually serves the reader; Postgres
   * has no fixture fallback and answered `undefined`. Neither store was wrong.
   * The fixture was.
   *
   * The alternative was excluding `sourceHash` from the comparison, which
   * removes the divergence by removing the check. Giving both stores the same
   * two paragraphs costs a revision row and a `blocks.json`, and makes every
   * field that depends on the article's content testable rather than this one
   * field untestable.
   */
  beforeEach(async () => {
    const db = getDb();
    await db.delete(articles).where(eq(articles.slug, SLUG));
    await db.insert(articles).values({ id: ARTICLE_ID, ownerId: currentOwnerId(), slug: SLUG });
    await db.insert(articleRevisions).values({
      id: REVISION_ID,
      articleId: ARTICLE_ID,
      ownerId: currentOwnerId(),
      status: "published",
    });
    /* The ids exist as identities first — `revision_blocks` has a foreign key
       onto `block_identities`, which is the spine enforcing itself: an id is
       minted once for an article and every later revision points at the same
       one. See docs/project/block-ids.md. */
    await db.insert(blockIdentities).values(
      BLOCKS.map((b) => ({ articleId: ARTICLE_ID, blockId: b.id })),
    );
    await db.insert(revisionBlocks).values(
      BLOCKS.map((b, ordinal) => ({
        articleId: ARTICLE_ID,
        revisionId: REVISION_ID,
        blockId: b.id,
        ordinal,
        tag: b.tag,
        kind: b.kind,
        text: b.text,
        words: b.words,
        html: b.html,
        gistable: b.gistable,
      })),
    );
    await db.update(articles).set({ currentRevisionId: REVISION_ID }).where(eq(articles.id, ARTICLE_ID));

    const dir = path.join(ROOT, "data", SLUG);
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "blocks.json"), JSON.stringify({ blocks: BLOCKS }), "utf8");
    /* `tree.json` too: `hashDir` in src/searches.ts requires it before it will
       hash a directory, for the same reason `articleDir` does — a half-finished
       ingest must not be fingerprinted while the reader is shown the fixture. */
    await writeFile(path.join(dir, "tree.json"), JSON.stringify({ rootId: BLOCKS[0].id, nodes: {} }), "utf8");
  });

  afterAll(async () => {
    await getDb().delete(articles).where(eq(articles.slug, SLUG));
    await closeDb();
    await rm(path.join(ROOT, "data", SLUG), { recursive: true, force: true });
  });

  it("walks one conversation through begin, finish, begin, retry, edit, rename", async () => {
    /* The sequence is the design's, and every step is chosen for something it
       can break: the second `begin` proves a later question does not rename the
       thread, `retry` proves the previous attempt's fields are cleared, `edit`
       proves what is discarded, and `rename` proves the clock the panel sorts
       by does not move. */
    const at = () => clock();

    const script = async (store: typeof fsChatStore) => {
      const now = at();
      const snapshots: unknown[] = [];
      const take = async (label: string, value?: unknown) => {
        snapshots.push({ label, returned: value, threads: await store.load(SLUG) });
      };

      const one = await store.begin(SLUG, { threadId: THREAD, question: "What is a spandrel?" }, now);
      await take("begin one", one);

      await store.finish(
        SLUG,
        THREAD,
        one.reply.id,
        {
          status: "done",
          text: "The space between two arches.",
          citations: [{ url: "https://example.com/arch" }],
          searches: 2,
          model: "a-model",
        },
        { now, attempt: one.attempt },
      );
      await take("finish one");

      const two = await store.begin(SLUG, { threadId: THREAD, question: "And a pendentive?" }, now);
      await take("begin two", two);

      await store.finish(SLUG, THREAD, two.reply.id, { status: "error", error: "fell over" }, {
        now,
        attempt: two.attempt,
      });
      await take("finish two, badly");

      const retried = await store.retry(SLUG, THREAD, two.reply.id, now);
      await take("retry two", retried);

      await store.finish(SLUG, THREAD, retried.reply.id, { status: "done", text: "A triangle." }, {
        now,
        attempt: retried.attempt,
      });
      await take("finish the retry");

      const edited = await store.edit(SLUG, THREAD, two.user.id, "And a squinch?", { now });
      await take("edit the second question", edited);

      await store.finish(SLUG, THREAD, edited.reply.id, { status: "done", text: "A corner arch." }, {
        now,
        attempt: edited.attempt,
      });
      await take("finish after the edit");

      await take("rename", await store.rename(SLUG, THREAD, "Vaulting"));
      return snapshots;
    };

    const fromFiles = await script(fsChatStore);
    await rm(path.join(ROOT, "data", SLUG), { recursive: true, force: true });
    const fromPg = await script(pgChatStore);

    expect(fromPg).toHaveLength(fromFiles.length);
    // Compared step by step so the failure names the step, not the end state.
    for (const [i, step] of fromFiles.entries()) {
      const label = (step as { label: string }).label;
      expect(wire(fromPg[i]), `chat parity diverged at: ${label}`).toEqual(wire(step));
    }
  });

  it("walks one search through begin, finish, fail, retry, finish, delete", async () => {
    const script = async (store: typeof fsSearchStore) => {
      const now = clock();
      const snapshots: unknown[] = [];
      const take = async (label: string, value?: unknown) => {
        snapshots.push({ label, returned: value, runs: await store.load(SLUG) });
      };

      const first = await store.begin(SLUG, "mentions of arches", "spya-run002", now);
      await take("begin", first.run);
      await store.finish(SLUG, first.run.id, { status: "done", hits: [], model: "m" }, first.attempt);
      await take("finish");

      const second = await store.begin(SLUG, "mentions of vaults", undefined, now);
      await take("begin another", second.run);
      await store.finish(SLUG, second.run.id, { status: "error", error: "fell over" }, second.attempt);
      await take("fail it");

      // The retry branch: same id, same criterion, and a row that failed.
      const retried = await store.begin(SLUG, "mentions of vaults", second.run.id, now);
      await take("retry", retried.run);
      await store.finish(SLUG, retried.run.id, { status: "done", hits: [], model: "m2" }, retried.attempt);
      await take("finish the retry");

      await take("delete the first", await store.remove(SLUG, first.run.id));
      return snapshots;
    };

    const fromFiles = await script(fsSearchStore);
    await rm(path.join(ROOT, "data", SLUG), { recursive: true, force: true });
    const fromPg = await script(pgSearchStore);

    for (const [i, step] of fromFiles.entries()) {
      const label = (step as { label: string }).label;
      expect(wire(fromPg[i]), `search parity diverged at: ${label}`).toEqual(wire(step));
    }
  });

  it("agrees about a term looked up twice", async () => {
    const script = async (store: typeof fsGlossaryLookupStore) => {
      const snapshots: unknown[] = [];
      snapshots.push(
        await store.save(SLUG, "spya-term22", {
          answer: "the first answer",
          citations: [],
          searches: 0,
          model: "old",
          at: "2026-08-01T00:00:00.000Z",
        }),
      );
      snapshots.push(
        await store.save(SLUG, "spya-term33", {
          answer: "another term",
          citations: [{ url: "https://example.com/x" }],
          searches: 2,
          model: "old",
          at: "2026-08-01T00:00:01.000Z",
        }),
      );
      // Re-checking the same term must replace, not be ignored.
      snapshots.push(
        await store.save(SLUG, "spya-term22", {
          answer: "the second answer",
          citations: [],
          searches: 1,
          model: "new",
          at: "2026-08-02T00:00:00.000Z",
        }),
      );
      snapshots.push(await store.load(SLUG));
      return snapshots;
    };

    const fromFiles = await script(fsGlossaryLookupStore);
    await rm(path.join(ROOT, "data", SLUG), { recursive: true, force: true });
    const fromPg = await script(pgGlossaryLookupStore);
    expect(wire(fromPg)).toEqual(wire(fromFiles));
  });
});
