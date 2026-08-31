/**
 * **The checkpoint store: a retry must not buy the work twice.**
 *
 * docs/plans/260827aa-delete-the-importer.md § B3. `labels-progress.json` and
 * `pdf-chunks/<key>.json` exist so a run that dies eight batches into a book
 * costs one batch rather than eight; landing D takes the directory they live in
 * away. src/store/checkpoints.ts is the seam that replaces it.
 *
 * ## What the first test measures, and why it is shaped like that
 *
 * The failure this whole design is defending against is invisible. Key a
 * checkpoint on the revision — which is the obvious answer, and the one the
 * plan originally wrote down — and every retry looks under an id that did not
 * exist when the work was done. Nothing errors, nothing warns, every lookup
 * simply misses, and the only symptom is a larger bill.
 *
 * So the first test **counts the calls**, not the rows. A test that asserted "a
 * row exists after the write" would pass with the lookup broken, because the
 * row does exist. `spent` is the effect; a row is the cause.
 * docs/reusable/silent-success.md § Measure the effect, not the cause.
 *
 * And the second attempt runs on a **different store instance** — a fresh
 * object, and on the Postgres side a genuinely new draft revision inserted
 * between the two — because a retry is a new process reading work a dead one
 * left behind. A single instance would pass with any amount of in-memory
 * cheating.
 *
 * ## Each of these was watched failing, and against what
 *
 * A check that has never been red is not evidence. Every mutation below was
 * applied to the real source, the suite was run, the named test was watched
 * failing, and the mutation was reverted. Where a mutation is a deletion it is
 * named by what was deleted, because a scripted replacement that matched
 * nothing would have left a green run reported as evidence.
 *
 * **30 of the 33 cases here have been watched red. Three have not**, and they
 * are named in full below rather than summarised — an earlier version of this
 * header said "every one", which was not true and which GPT Sol caught by
 * counting. An evidence record that overstates itself makes every other claim
 * in it worth less.
 *
 * | mutation | what fails |
 * |---|---|
 * | `read` in checkpoints-fs.ts returns `new Map()` before touching the disk | *a retry on a different store instance does not buy the work twice* (spent 5, wanted 3) |
 * | `write` in checkpoints-fs.ts writes to `entry.json` instead of `${key}.json` | *keeps many entries under one namespace*, *first write wins* |
 * | `nsDir` drops its `namespace` argument | *two namespaces do not see each other's keys* |
 * | `createFsCheckpointStore` ignores `dir` and uses a constant | *two articles do not see each other's entries* |
 * | `link(tmp, file)` becomes `rename(tmp, file)` | *first write wins* |
 * | `readEntry`'s `catch` throws instead of returning `null` | *a half-written entry is a miss, not a throw* |
 * | `rename(tmp, file)` goes back to `link` + an `EEXIST` shrug | *the last write wins*, *heals a broken entry after exactly one repurchase* |
 * | `checkpointJson` returns the string `"undefined"` instead of refusing | *refuses a value that will not serialise…* (both adapters) |
 * | `checkpointJson` is called after `mkdir` rather than before | *refuses a value that will not serialise…* — and **only** that one, which is what makes it a test of the ordering rather than of the refusal |
 * | `readEntry`'s `readFile` goes back to a blanket `.catch(() => null)` | *lets a real filesystem fault through instead of calling it a miss* |
 * | `absentOr` swallows every errno, not just `ENOENT` | *lets a real fault through the sweep instead of reporting nothing to do* |
 * | `absentOr` rethrows `ENOENT` too | *reports nothing…when the articles root is simply absent*, and all four sweep cases |
 * | the `CHECKPOINT_KEY_RE` branch of `assertCheckpointRequest` is deleted | *refuses a key that would escape the directory*, *refuses an upper-case key* |
 * | the `slug !== bound.slug` branch of `assertCheckpointRequest` is deleted | *refuses a slug that is not the one it was built for* |
 * | `utimes` in `read` is deleted | *a sweep keeps an old entry that was used today* |
 * | `dryRun` in `sweepFsCheckpoints` defaults to `false` | *a sweep says what it would delete and deletes nothing* |
 * | `assertCheckpointRequest` is not called by `write` | *refuses a key that would escape the directory* (the write half) |
 *
 * The Postgres mutations are in the second half of this file, against the
 * Postgres source, and are listed there.
 *
 * **The three with no mutation, named.**
 *
 * 1. *returns an empty map for an empty key list* — on the filesystem the early
 *    return is **unobservable by construction**: `for (const key of [])` does
 *    nothing whether or not it fires, so there is no behaviour to break. The
 *    test is named for what it proves, and the Postgres half of the same
 *    question has its own test that *does* go red (below).
 * 2. *the database refuses a key the code refuses* — breaking it means dropping
 *    a CHECK, which is DDL this suite may not do. It carries its own control
 *    instead: a third insert that must be **accepted**, so a table that refused
 *    everything could not pass it.
 * 3. *deleting the article takes its checkpoints with it* — breaking it means
 *    dropping the FK, also DDL. **It has no control, and it is the weakest
 *    assertion in this file.** It would go red if the FK were missing
 *    altogether, which is something; it would not notice `on delete set null`.
 *
 * **And the harness lied once, which is worth recording.** The first run of
 * every mutation above used `vitest --reporter=basic`, which does not exist in
 * vitest 4 — so vitest failed to start, no test ran, and the harness reported
 * "NO TALLY" for all six controls. That is the fourth way a control lies in
 * docs/reusable/silent-success.md, and the only thing that caught it was
 * reading the output rather than the exit code.
 *
 * ## The Postgres half needs a database AND migration 0028, and says so out loud
 *
 * Same probe and same `process.stderr.write` as tests/glossary-ideas-baseline.test.ts
 * and tests/store-artefacts-pg.test.ts: vitest's default reporter swallows
 * `console.warn` from anything that is not failing, so a suite that skipped in
 * silence reads exactly like one that passed. The probe asks for the
 * `checkpoints` table by name rather than only for the schema, because *the
 * database is up* and *this table exists* are different questions and only the
 * second one is this file's.
 */

import { mkdtemp, mkdir, readFile, readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";

import {
  CHECKPOINT_KEY_RE,
  CHECKPOINT_NAMESPACES,
  CHECKPOINT_RETENTION_DAYS,
  type CheckpointStore,
  checkpointCutoff,
} from "../src/store/checkpoints.js";
import { createFsCheckpointStore, sweepFsCheckpoints } from "../src/store/checkpoints-fs.js";
import { failIfPostgresRequired, type MissingKind } from "./helpers/pg-ready.js";

/* ------------------------------------------------------------ the fixture -- */

/**
 * What one finished batch looks like. Shaped like `LabelCheckpointEntry` but
 * declared here rather than imported: the store does not know what a batch is,
 * and a test that borrowed the real type would quietly be asserting that it
 * does.
 */
interface Batch {
  fingerprint: string;
  labels: Record<string, string>;
}

/**
 * **The paid call, and the only thing worth counting.**
 *
 * Every test that is about reuse asserts on `spent`, never on the presence of a
 * row. A row is there whether or not anything can find it again.
 */
let spent = 0;
function buyLabels(key: string): Batch {
  spent += 1;
  return { fingerprint: key, labels: { "spya-aaaa11": `label for ${key}` } };
}

/**
 * One attempt at labelling: read what is already paid for, buy the rest.
 *
 * This is `runLabels` in src/labels.ts reduced to its checkpoint behaviour —
 * compute every key from the plan up front, ask the store once, buy each miss
 * and record it the moment it lands. `stopAfter` is how an attempt dies
 * half-way, which is the state the whole store exists to survive.
 */
async function attempt(
  store: CheckpointStore,
  slug: string,
  keys: readonly string[],
  stopAfter = Number.POSITIVE_INFINITY,
): Promise<Batch[]> {
  const have = await store.read<Batch>(slug, "toc-labels", keys);
  const out: Batch[] = [];
  for (const key of keys) {
    const hit = have.get(key);
    if (hit) {
      out.push(hit);
      continue;
    }
    if (out.length >= stopAfter) throw new Error("the attempt died here");
    const bought = buyLabels(key);
    await store.write(slug, "toc-labels", key, bought);
    out.push(bought);
  }
  return out;
}

const KEYS = ["a1b2c3d4e5f60718", "0f1e2d3c4b5a6978", "9876543210abcdef"];

/* -------------------------------------------------------------- filesystem -- */

describe("the checkpoint store, on the filesystem", () => {
  const roots: string[] = [];

  async function workspace(slug = "test-article"): Promise<{
    dir: string;
    store: () => CheckpointStore;
    slug: string;
  }> {
    const root = await mkdtemp(path.join(tmpdir(), "spya-checkpoint-"));
    roots.push(root);
    const dir = path.join(root, slug);
    await mkdir(dir, { recursive: true });
    return {
      dir,
      slug,
      /* A **function**, so every caller gets a fresh instance. A retry is a new
         process, and a test that reused one object would pass on a store that
         did nothing but remember. */
      store: () => createFsCheckpointStore({ slug, articleId: FAKE_ARTICLE_ID }, dir),
    };
  }

  afterAll(async () => {
    for (const root of roots) await rm(root, { recursive: true, force: true });
  });

  it("a retry on a different store instance does not buy the work twice", async () => {
    const { store, slug } = await workspace();
    spent = 0;

    /* Attempt one dies after two of the three batches — the 429 eight batches
       into a book that src/hierarchy.ts's comment is about. */
    await expect(attempt(store(), slug, KEYS, 2)).rejects.toThrow("the attempt died here");
    expect(spent).toBe(2);

    /* Attempt two: a new job, a new process, a new store object. */
    const finished = await attempt(store(), slug, KEYS);

    expect(finished.map((b) => b.fingerprint)).toEqual(KEYS);
    /* Three keys, three calls, ever. Five is the bug this whole design is for,
       and five is what a revision-keyed lookup would have produced. */
    expect(spent).toBe(3);
  });

  it("still buys a question nobody has asked before", async () => {
    const { store, slug } = await workspace();
    spent = 0;
    await attempt(store(), slug, [KEYS[0] as string]);
    expect(spent).toBe(1);
    /* The control for the test above: if reuse were unconditional — a store
       that answered every key with the first value it had — this would be 1 and
       the suite would be proving nothing. */
    await attempt(store(), slug, [KEYS[0] as string, KEYS[1] as string]);
    expect(spent).toBe(2);
  });

  it("keeps many entries under one namespace", async () => {
    const { store, slug } = await workspace();
    for (const key of KEYS) await store().write(slug, "toc-labels", key, { fingerprint: key });
    const back = await store().read<Batch>(slug, "toc-labels", KEYS);
    /* One row per `(namespace)` — the "last entry wins" table the plan warns
       about — passes every single-key assertion and fails this one. */
    expect([...back.keys()].sort()).toEqual([...KEYS].sort());
  });

  it("two namespaces do not see each other's keys", async () => {
    const { store, slug } = await workspace();
    const key = KEYS[0] as string;
    await store().write(slug, "toc-labels", key, { from: "labels" });
    await store().write(slug, "pdf-chunk", key, { from: "chunks" });
    expect(await store().read(slug, "toc-labels", [key])).toEqual(
      new Map([[key, { from: "labels" }]]),
    );
    expect(await store().read(slug, "pdf-chunk", [key])).toEqual(
      new Map([[key, { from: "chunks" }]]),
    );
  });

  it("two articles do not see each other's entries", async () => {
    const one = await workspace("test-article-one");
    const two = await workspace("test-article-two");
    const key = KEYS[0] as string;
    await one.store().write(one.slug, "toc-labels", key, { from: "one" });
    expect(await two.store().read(two.slug, "toc-labels", [key])).toEqual(new Map());
  });

  it("the last write wins", async () => {
    const { store, slug } = await workspace();
    const key = KEYS[0] as string;
    await store().write(slug, "toc-labels", key, { answer: "first" });
    await store().write(slug, "toc-labels", key, { answer: "second" });
    /* `write` is only ever called after a failed read, so the newer value is
       always the better-informed one. Keeping the first threw away exactly the
       answers that were bought because the stored one was useless — see the
       healing test below, which is what that bug actually looked like. */
    expect(await store().read(slug, "toc-labels", [key])).toEqual(
      new Map([[key, { answer: "second" }]]),
    );
  });

  /**
   * **A broken entry costs one repurchase, not one per attempt for ever.**
   *
   * This is the test GPT Sol asked for by name, and it is the specification for
   * the bug it found. The first version of this store used `link()` so the
   * first write would win: a half-written entry read as a miss, the caller
   * re-bought the work, `link` refused with `EEXIST` because the broken file was
   * still there, and the EEXIST branch bumped the file's mtime — so the sweep,
   * the one thing that would eventually have removed it, was taught it was hot.
   * Every attempt paid again, for ever, and nothing errored.
   *
   * It is strictly worse than what it replaced.
   * docs/postmortems/260828e-pdf-chunk-cache-corrupt-entry.md is about a corrupt entry
   * that wedged an article **loudly**; that is a bug you find in an afternoon. A
   * quiet permanent charge is one you find in the billing.
   *
   * So the assertion is on `spent` across *three* attempts, not on the file's
   * contents. Two would not have caught it: the repurchase happens either way,
   * and it is the third attempt that separates "healed" from "paying for ever".
   */
  it("heals a broken entry after exactly one repurchase", async () => {
    const { dir, store, slug } = await workspace("test-heal");
    const key = KEYS[0] as string;
    const at = path.join(dir, "checkpoints", "toc-labels");
    await mkdir(at, { recursive: true });
    await writeFile(path.join(at, `${key}.json`), '{"fingerprint": "half', "utf-8");

    spent = 0;
    await attempt(store(), slug, [key]);
    expect(spent).toBe(1);

    /* The second attempt must find the answer the first one paid for. */
    await attempt(store(), slug, [key]);
    expect(spent).toBe(1);

    /* And the third, because "paying for ever" and "paid once more" are
       different bugs and only a third attempt tells them apart. */
    await attempt(store(), slug, [key]);
    expect(spent).toBe(1);
  });

  it("refuses a value that will not serialise, rather than writing the word undefined", async () => {
    const { dir, store, slug } = await workspace("test-unserialisable");
    const key = KEYS[0] as string;
    /* `JSON.stringify(undefined)` is `undefined`, and a template literal turns
       that into a file containing the nine characters `undefined` — which
       parses as nothing, reads back as a miss, and (before the fix above) could
       never be replaced. Postgres refused the same value, so the two stores
       disagreed about a legal write. GPT Sol, 2026-08-29. */
    await expect(store().write(slug, "toc-labels", key, undefined)).rejects.toThrow(
      /must serialise to JSON/,
    );
    await expect(store().write(slug, "toc-labels", key, () => 1)).rejects.toThrow(
      /must serialise to JSON/,
    );
    /* And nothing was created on the way to the refusal — not the entry, not a
       temp file, not even the directory. The first version of this serialised
       after `mkdir`, so a refused write still left a directory behind; the
       refusal belongs before any I/O, like the slug assertion. */
    const at = path.join(dir, "checkpoints", "toc-labels");
    await expect(readdir(at)).rejects.toThrow(/ENOENT/);
  });

  it("lets a real filesystem fault through instead of calling it a miss", async () => {
    const { dir, store, slug } = await workspace("test-eisdir");
    const key = KEYS[0] as string;
    /* `EISDIR`, not `ENOENT`: a directory where the entry should be is an
       unreadable entry, and the blanket catch this replaces turned every errno
       into "no checkpoint" — an unreadable disk reporting itself as a first run
       and the caller paying for a whole book to find out. */
    await mkdir(path.join(dir, "checkpoints", "toc-labels", `${key}.json`), { recursive: true });
    await expect(store().read(slug, "toc-labels", [key])).rejects.toThrow(/EISDIR/);
  });

  it("lets a real fault through the sweep instead of reporting nothing to do", async () => {
    const { dir } = await workspace("test-sweep-fault");
    /* A file where the articles root should be. `readdir` gives ENOTDIR, and
       the blanket catch this replaces turned that into `{ swept: 0 }` and a
       success line — which is exactly what a healthy tree with nothing old in
       it reports. A sweep that cannot see anything must not look like a sweep
       with nothing to do. */
    const notARoot = path.join(dir, "not-a-root");
    await writeFile(notARoot, "", "utf-8");
    await expect(
      sweepFsCheckpoints(notARoot, checkpointCutoff(CHECKPOINT_RETENTION_DAYS)),
    ).rejects.toThrow(/ENOTDIR/);
  });

  it("reports nothing, and does not throw, when the articles root is simply absent", async () => {
    const { dir } = await workspace("test-sweep-absent");
    /* The other half of the rule, and the reason it is `ENOENT` only rather
       than "propagate everything": a machine that has never ingested anything
       has no `data/` at all, and that is not a fault. */
    const missing = path.join(dir, "no-such-root");
    expect(await sweepFsCheckpoints(missing, checkpointCutoff(CHECKPOINT_RETENTION_DAYS))).toEqual({
      swept: 0,
      bytes: 0,
    });
  });

  it("a half-written entry is a miss, not a throw", async () => {
    const { dir, store, slug } = await workspace();
    const key = KEYS[0] as string;
    const at = path.join(dir, "checkpoints", "toc-labels");
    await mkdir(at, { recursive: true });
    /* Exactly what the postmortem found on disk: a process killed part-way
       through `writeFile`. Before the fix this threw a SyntaxError out of the
       whole extract step, on every later attempt, for ever —
       docs/postmortems/260828e-pdf-chunk-cache-corrupt-entry.md. */
    await writeFile(path.join(at, `${key}.json`), '{"records": [{"page": 1', "utf-8");
    await expect(store().read(slug, "toc-labels", [key])).resolves.toEqual(new Map());
  });

  it("refuses a key that would escape the directory", async () => {
    const { store, slug } = await workspace();
    for (const bad of ["../../etc/passwd", "..", "a/b", "a.json", ""]) {
      await expect(store().read(slug, "toc-labels", [bad])).rejects.toThrow(/usable checkpoint key/);
      await expect(store().write(slug, "toc-labels", bad, {})).rejects.toThrow(
        /usable checkpoint key/,
      );
    }
  });

  it("refuses an upper-case key", async () => {
    const { store, slug } = await workspace();
    /* macOS filesystems are case-insensitive, so `AB` and `ab` would be one
       file and two rows — one store working and the other quietly not. A
       refusal both stores share is the only way the two cannot diverge. */
    await expect(store().write(slug, "toc-labels", "ABCD1234", {})).rejects.toThrow(
      /usable checkpoint key/,
    );
    expect(CHECKPOINT_KEY_RE.test("abcd1234")).toBe(true);
    expect(CHECKPOINT_KEY_RE.test("ABCD1234")).toBe(false);
  });

  it("refuses a slug that is not the one it was built for", async () => {
    const { dir, slug } = await workspace();
    const store = createFsCheckpointStore({ slug, articleId: FAKE_ARTICLE_ID }, dir);
    await expect(store.read("some-other-article", "toc-labels", KEYS)).rejects.toThrow(
      /bound to "test-article"/,
    );
    await expect(store.write("some-other-article", "toc-labels", KEYS[0] as string, {})).rejects.toThrow(
      /bound to "test-article"/,
    );
    /* And nothing was written on the way to the refusal. */
    expect(await readdir(path.join(dir), { withFileTypes: true })).toEqual([]);
  });

  it("refuses a namespace nobody declared", async () => {
    const { store, slug } = await workspace();
    await expect(
      // @ts-expect-error — the point of the test is the runtime refusal.
      store().write(slug, "made-up", KEYS[0] as string, {}),
    ).rejects.toThrow(/not a checkpoint namespace/);
    expect(CHECKPOINT_NAMESPACES).toEqual(["toc-labels", "pdf-chunk"]);
  });

  /**
   * **Named for what it proves, which is less than the first name claimed.**
   *
   * It was called *"reads nothing, and asks nothing"*, and it did not show the
   * second half: deleting the adapter's early return leaves it green. On the
   * filesystem that is not even fixable, because the early return is
   * unobservable by construction — `for (const key of [])` does nothing either
   * way, so there is no I/O to detect the absence of. The early return there is
   * decoration.
   *
   * The Postgres one *is* observable, and has its own test below that goes red
   * without it. GPT Sol found the overclaim, 2026-08-29.
   */
  it("returns an empty map for an empty key list", async () => {
    const { store, slug } = await workspace();
    expect(await store().read(slug, "toc-labels", [])).toEqual(new Map());
  });

  /* ------------------------------------------------------------- the sweep -- */

  it("a sweep says what it would delete and deletes nothing", async () => {
    const { dir, store, slug } = await workspace("test-sweep-dry");
    const root = path.dirname(dir);
    const key = KEYS[0] as string;
    await store().write(slug, "toc-labels", key, { answer: "old" });
    await age(path.join(dir, "checkpoints", "toc-labels", `${key}.json`), 200);

    const report = await sweepFsCheckpoints(root, checkpointCutoff(CHECKPOINT_RETENTION_DAYS));
    expect(report.swept).toBe(1);
    expect(report.bytes).toBeGreaterThan(0);
    /* Still there. A sweep that deletes on its first run is one whose cutoff
       nobody has ever seen the effect of. */
    expect(await store().read(slug, "toc-labels", [key])).toEqual(
      new Map([[key, { answer: "old" }]]),
    );
  });

  it("a sweep deletes what nothing has asked for in a long time", async () => {
    const { dir, store, slug } = await workspace("test-sweep-real");
    const root = path.dirname(dir);
    const key = KEYS[0] as string;
    await store().write(slug, "toc-labels", key, { answer: "old" });
    await age(path.join(dir, "checkpoints", "toc-labels", `${key}.json`), 200);

    const report = await sweepFsCheckpoints(root, checkpointCutoff(CHECKPOINT_RETENTION_DAYS), {
      dryRun: false,
    });
    expect(report.swept).toBe(1);
    expect(await store().read(slug, "toc-labels", [key])).toEqual(new Map());
  });

  it("a sweep keeps an old entry that was used today", async () => {
    const { dir, store, slug } = await workspace("test-sweep-hot");
    const root = path.dirname(dir);
    const key = KEYS[0] as string;
    await store().write(slug, "toc-labels", key, { answer: "hot" });
    const file = path.join(dir, "checkpoints", "toc-labels", `${key}.json`);
    await age(file, 200);

    /* **The whole reason `last_used_at` exists.** This entry was written two
       hundred days ago and read a moment ago. Sweeping on when it was created
       deletes exactly the entries that were earning their keep, and the bill is
       the only place it shows up. */
    expect(await store().read(slug, "toc-labels", [key])).toEqual(
      new Map([[key, { answer: "hot" }]]),
    );

    const report = await sweepFsCheckpoints(root, checkpointCutoff(CHECKPOINT_RETENTION_DAYS), {
      dryRun: false,
    });
    expect(report.swept).toBe(0);
    expect(await store().read(slug, "toc-labels", [key])).toEqual(
      new Map([[key, { answer: "hot" }]]),
    );
  });

  it("a sweep leaves everything that is not a checkpoint alone", async () => {
    const { dir, store, slug } = await workspace("test-sweep-neighbours");
    const root = path.dirname(dir);
    const key = KEYS[0] as string;
    await store().write(slug, "toc-labels", key, { answer: "old" });
    await age(path.join(dir, "checkpoints", "toc-labels", `${key}.json`), 200);
    /* The artefacts the sweep sits next to, aged past the cutoff too. A sweep
       that walked the article directory rather than `checkpoints/` would take
       the article with it, and would report the same number either way. */
    const bystander = path.join(dir, "tree.json");
    await writeFile(bystander, "{}", "utf-8");
    await age(bystander, 200);

    const report = await sweepFsCheckpoints(root, checkpointCutoff(CHECKPOINT_RETENTION_DAYS), {
      dryRun: false,
    });
    expect(report.swept).toBe(1);
    expect(await readFile(bystander, "utf-8")).toBe("{}");
  });
});

/** Backdate a file's mtime, which is the filesystem's `last_used_at`. */
async function age(file: string, days: number): Promise<void> {
  const when = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  await utimes(file, when, when);
  const info = await stat(file);
  /* The control on the control: `utimes` on a path that does not exist throws,
     but a wrong path built by hand would be caught here rather than by a sweep
     that quietly found nothing. */
  if (info.mtime.getTime() > Date.now() - 60_000) throw new Error(`${file} was not aged`);
}

/**
 * Not a real uuid anywhere the filesystem store can see, and it does not have
 * to be: `articleId` is required on the reference so that a call site cannot
 * build a filesystem store today and find it has nothing to give the Postgres
 * one tomorrow. The Postgres half below uses a real one.
 */
const FAKE_ARTICLE_ID = "00000000-0000-0000-0000-000000000000";

/* ---------------------------------------------------------------- Postgres -- */

const { loadEnvLocal } = await import("../src/env.js");
loadEnvLocal();

/**
 * Whether the Postgres half can run, and — if not — a sentence the reporter
 * will actually print. See tests/blocks-baseline.test.ts for the six mechanisms
 * that were measured before `process.stderr.write` was chosen.
 *
 * It asks for the `checkpoints` table by name. *The database is up* and *this
 * table exists* are different questions, and a probe that only asked the first
 * would let every assertion below fail for a reason that has nothing to do with
 * the store.
 */
let reachable = false;
let why = "DATABASE_URL is not set — run npm run db:start (docs/project/supabase-local.md)";
/** Which fix the reader needs, for `REQUIRE_POSTGRES=1`. tests/helpers/pg-ready.ts. */
let kind: MissingKind = "no-url";
if (process.env.DATABASE_URL) {
  const { Pool } = await import("pg");
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: 10_000,
  });
  kind = "migration";
  try {
    const probe = await pool.query(
      "select to_regclass('spideryarn.checkpoints') is not null as ready",
    );
    reachable = probe.rows[0]?.ready === true;
    if (!reachable) {
      why =
        "there is no spideryarn.checkpoints table — migration 0028 has not been applied. " +
        "Run `npm run db:migrate` (read its Target: line first) and these will run.";
    }
  } catch (err) {
    reachable = false;
    kind = "unreachable";
    why = `could not reach it: ${(err as Error).message}`;
  }
  await pool.end();
}
if (!reachable) {
  process.stderr.write(
    `\n  ⚠ the Postgres half of tests/store-checkpoints.test.ts is NOT RUNNING.\n` +
      `    These assertions have not executed: ${why}\n\n`,
  );
  /* …and under REQUIRE_POSTGRES=1 that warning is not enough: fail. */
  failIfPostgresRequired("tests/store-checkpoints.test.ts", why, kind);
}
const when = reachable ? describe : describe.skip;

/**
 * **The mutations the Postgres half was watched failing against.**
 *
 * | mutation | what fails |
 * |---|---|
 * | `read` drops `eq(checkpoints.articleId, ref.articleId)` from its `where` | *two articles do not see each other's entries, in Postgres* |
 * | `read` drops `eq(checkpoints.namespace, namespace)` | *two namespaces do not see each other's keys, in Postgres* |
 * | `read`'s `set` becomes `{ lastUsedAt: sql\`last_used_at\` }` — an update that stamps nothing | *a hit stamps last_used_at*, *a sweep keeps an old entry that was used today, in Postgres* |
 * | `onConflictDoUpdate`'s `set` drops `value` again | *the last write wins, in Postgres*, *heals an unusable row after exactly one repurchase* |
 * | the empty-key early return is disabled | *asks the database nothing for an empty key list* |
 * | `guardDbStore` is removed from the returned store | *hand out a guarded checkpoint store* (in `tests/store-guarded.test.ts`) |
 * | `CheckpointRequestError` comes off the guard's allowlist | *refuses a value that will not serialise, in Postgres too*, and *lets a checkpoint's own refusal through as itself* |
 * | `sweepPgCheckpoints`' `dryRun` defaults to `false` | *a sweep keeps an old entry that was used today, in Postgres* |
 * | the sweep's `where` uses `createdAt` instead of `lastUsedAt` | *a sweep keeps an old entry that was used today, in Postgres* |
 * | the store prefixes every key with the article's **newest revision id** | *a retry after a new revision does not buy the work twice* |
 * | the failing attempt writes through its own `tx` instead of the store | *a checkpoint survives the rollback of the attempt that wrote it* |
 *
 * **The last two are the point of the exercise, so read their messages.** The
 * revision-keyed one fails with `expected 5 to be 3` — the retry re-bought all
 * three batches on top of the two already paid for, which is the bug's exact
 * signature and the reason this file counts paid calls rather than rows. The
 * transaction one is a mutation of the *test*, not the source: it replaces the
 * store's write with what a transaction-joining store would do, which is the
 * only way to express that bug against a store that has no `tx` parameter to
 * misuse.
 */
when("the checkpoint store, in Postgres", () => {
  const SLUG = "test-checkpoint-store";
  const OTHER_SLUG = "test-checkpoint-store-other";

  let mod: Awaited<ReturnType<typeof importDb>>;
  let db: Awaited<ReturnType<typeof importDb>>["db"];
  let articleId = "";
  let otherArticleId = "";
  let store: (id?: string, slug?: string) => CheckpointStore;

  async function importDb() {
    const client = await import("../src/db/client.js");
    const schema = await import("../src/db/schema.js");
    const pg = await import("../src/store/checkpoints-pg.js");
    const admin = await import("../src/admin.js");
    return { db: client.getDb(), client, schema, pg, admin };
  }

  async function wipe(slug: string): Promise<void> {
    const { schema } = mod;
    const rows = await db
      .select({ id: schema.articles.id })
      .from(schema.articles)
      .where(eq(schema.articles.slug, slug));
    for (const { id } of rows) {
      await db.execute(
        sql`update ${schema.articles} set current_revision_id = null where id = ${id}::uuid`,
      );
      await db.delete(schema.checkpoints).where(eq(schema.checkpoints.articleId, id));
      await db.delete(schema.articleRevisions).where(eq(schema.articleRevisions.articleId, id));
      await db.delete(schema.articles).where(eq(schema.articles.id, id));
    }
  }

  beforeAll(async () => {
    mod = await importDb();
    db = mod.db;
    const { schema, admin } = mod;
    await wipe(SLUG);
    await wipe(OTHER_SLUG);
    const [a] = await db
      .insert(schema.articles)
      .values({ ownerId: admin.ADMIN_USER_ID_LOCAL, slug: SLUG })
      .returning();
    const [b] = await db
      .insert(schema.articles)
      .values({ ownerId: admin.ADMIN_USER_ID_LOCAL, slug: OTHER_SLUG })
      .returning();
    if (!a || !b) throw new Error("could not create the fixture articles");
    articleId = a.id;
    otherArticleId = b.id;
    store = (id = articleId, slug = SLUG) => mod.pg.createPgCheckpointStore({ slug, articleId: id });
  }, 60_000);

  /**
   * **One article, many tests, and first-write-wins between them.**
   *
   * Every test here writes through the same article, and the store keeps the
   * *first* value under a key — so a test that reused a key from an earlier one
   * would read the earlier one's answer back and fail with a diff that has
   * nothing to do with what it was testing. That is not a flaw in the store; it
   * is the store doing exactly what `first write wins` promises, and it cost
   * two failures before this wipe existed. Keys below are still distinct per
   * test, which is belt and braces on purpose.
   */
  beforeEach(async () => {
    await db.delete(mod.schema.checkpoints).where(eq(mod.schema.checkpoints.articleId, articleId));
    await db
      .delete(mod.schema.checkpoints)
      .where(eq(mod.schema.checkpoints.articleId, otherArticleId));
  });

  afterAll(async () => {
    if (!mod) return;
    await wipe(SLUG);
    await wipe(OTHER_SLUG);
    await mod.client.closeDb();
  });

  /** Every checkpoint row for the fixture article, in nobody's particular order. */
  async function rowsFor(id = articleId) {
    const { schema } = mod;
    return db.select().from(schema.checkpoints).where(eq(schema.checkpoints.articleId, id));
  }

  /**
   * **The one that is the point of the exercise.**
   *
   * A retry is a new job and a new job begins a new draft revision, so this
   * inserts one between the two attempts. A store that keyed on the revision —
   * the plan's own first answer — would find nothing on the second attempt, buy
   * every batch again, and pass every other test in this file.
   */
  it("a retry after a new revision does not buy the work twice", async () => {
    const { schema } = mod;
    await db.delete(schema.checkpoints).where(eq(schema.checkpoints.articleId, articleId));
    spent = 0;

    const [first] = await db
      .insert(schema.articleRevisions)
      .values({ articleId, status: "draft" })
      .returning();
    expect(first).toBeTruthy();

    await expect(attempt(store(), SLUG, KEYS, 2)).rejects.toThrow("the attempt died here");
    expect(spent).toBe(2);

    /* The retry: a new job, and therefore a new draft revision. */
    const [second] = await db
      .insert(schema.articleRevisions)
      .values({ articleId, status: "draft" })
      .returning();
    expect(second?.id).not.toBe(first?.id);

    const finished = await attempt(store(), SLUG, KEYS);
    expect(finished.map((b) => b.fingerprint)).toEqual(KEYS);
    expect(spent).toBe(3);
    expect(await rowsFor()).toHaveLength(3);
  });

  it("two articles do not see each other's entries, in Postgres", async () => {
    const key = KEYS[0] as string;
    await store().write(SLUG, "toc-labels", key, { from: "one" });
    expect(await store(otherArticleId, OTHER_SLUG).read(OTHER_SLUG, "toc-labels", [key])).toEqual(
      new Map(),
    );
  });

  it("two namespaces do not see each other's keys, in Postgres", async () => {
    const key = KEYS[1] as string;
    await store().write(SLUG, "toc-labels", key, { from: "labels" });
    await store().write(SLUG, "pdf-chunk", key, { from: "chunks" });
    expect(await store().read(SLUG, "toc-labels", [key])).toEqual(
      new Map([[key, { from: "labels" }]]),
    );
    expect(await store().read(SLUG, "pdf-chunk", [key])).toEqual(
      new Map([[key, { from: "chunks" }]]),
    );
  });

  it("the last write wins, in Postgres", async () => {
    const key = KEYS[2] as string;
    await store().write(SLUG, "toc-labels", key, { answer: "first" });
    await store().write(SLUG, "toc-labels", key, { answer: "second" });
    expect(await store().read(SLUG, "toc-labels", [key])).toEqual(
      new Map([[key, { answer: "second" }]]),
    );
  });

  /**
   * **The Postgres half of the healing test**, and it needs a different broken
   * entry from the filesystem's.
   *
   * `jsonb` cannot hold anything that will not parse, so the row this store can
   * be stuck with is not corrupt — it is *valid JSON the caller cannot use*: an
   * entry written under an older shape, or by a writer whose bug has since been
   * fixed. `usableCheckpoint` in src/labels.ts discards exactly that, field by
   * field, and returns a miss. So the caller re-buys, and before the fix
   * `onConflictDoUpdate` kept the unusable row and threw the new answer away —
   * on every attempt, for ever.
   *
   * `attempt` cannot express that, because it treats any hit as good. This one
   * validates, which is what both real callers do.
   */
  it("heals an unusable row after exactly one repurchase, in Postgres", async () => {
    const key = "0011223344556677";
    /* Valid JSON, valid jsonb, and not something a caller can use. */
    await store().write(SLUG, "toc-labels", key, { wrong: "shape" });

    let bought = 0;
    async function validatingAttempt(): Promise<void> {
      const have = await store().read<Batch>(SLUG, "toc-labels", [key]);
      const hit = have.get(key);
      /* The caller's own gate, not the store's — the store never looks at a
         value's shape, deliberately. */
      if (hit && typeof hit.fingerprint === "string") return;
      bought += 1;
      await store().write(SLUG, "toc-labels", key, buyLabels(key));
    }

    await validatingAttempt();
    expect(bought).toBe(1);
    await validatingAttempt();
    await validatingAttempt();
    /* One, not three. Three is the bug. */
    expect(bought).toBe(1);
  });

  /**
   * **Asks the database nothing at all for an empty key list**, proved by an
   * effect rather than by instrumentation.
   *
   * The store is built against an `articleId` that is not a uuid. If `read`
   * issues its statement, Postgres rejects the bound parameter with `22P02`
   * (`invalid input syntax for type uuid`) and this throws. If the early return
   * fires, nothing is sent and the empty map comes back. No spy, no mock, no
   * counter that could itself be wrong — the database is the witness.
   *
   * The control is the second half: the *same* store with a non-empty key list
   * must throw, or this test would pass against a `read` that never queried at
   * all and it would be proving nothing.
   */
  it("asks the database nothing for an empty key list", async () => {
    const bogus = mod.pg.createPgCheckpointStore({ slug: SLUG, articleId: "not-a-uuid" });
    expect(await bogus.read(SLUG, "toc-labels", [])).toEqual(new Map());
    await expect(bogus.read(SLUG, "toc-labels", [KEYS[0] as string])).rejects.toThrow();
  });

  it("refuses a value that will not serialise, in Postgres too", async () => {
    /* The parity half of the filesystem test above: one shared `checkpointJson`
       means the two stores cannot disagree about what is writable, which they
       did before — Postgres refused `undefined` and the filesystem wrote the
       word. */
    await expect(store().write(SLUG, "toc-labels", "aabb00112233ffee", undefined)).rejects.toThrow(
      /must serialise to JSON/,
    );
  });

  it("a hit stamps last_used_at", async () => {
    const { schema } = mod;
    const key = "aabbccddeeff0011";
    await store().write(SLUG, "toc-labels", key, { answer: "x" });
    /* Backdated by hand, because the test cannot wait ninety days and the point
       is the *difference* between created and last used. */
    const long = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000);
    await db
      .update(schema.checkpoints)
      .set({ createdAt: long, lastUsedAt: long })
      .where(
        and(eq(schema.checkpoints.articleId, articleId), eq(schema.checkpoints.key, key)),
      );

    expect(await store().read(SLUG, "toc-labels", [key])).toEqual(new Map([[key, { answer: "x" }]]));

    const [row] = await db
      .select()
      .from(schema.checkpoints)
      .where(and(eq(schema.checkpoints.articleId, articleId), eq(schema.checkpoints.key, key)));
    expect(row?.createdAt.getTime()).toBe(long.getTime());
    /* Read a moment ago, so a sweep on `last_used_at` keeps it and a sweep on
       `created_at` would have deleted the entry that was earning its keep. */
    expect(row?.lastUsedAt.getTime()).toBeGreaterThan(long.getTime());
    expect(row?.lastUsedAt.getTime()).toBeGreaterThan(Date.now() - 60_000);
  });

  it("the database refuses a key the code refuses", async () => {
    const { schema } = mod;
    /**
     * Straight past the TypeScript guard, at the table. Three copies of one
     * rule — the regex, the CHECK, and the filesystem's file name — and the
     * point of the third copy is that the first one can be edited away.
     *
     * **The constraint's name is in the `cause`, not the message.** Drizzle
     * wraps a failed query in a `DrizzleQueryError` whose message is the SQL
     * and *every bound parameter* — which is why `guardDbStore` exists
     * (src/store/db-errors.ts). Asserting on the wrapper's message would pass
     * for any failure at all, including a connection that dropped.
     */
    async function refusal(values: Record<string, unknown>): Promise<string> {
      try {
        // @ts-expect-error — deliberately bad values; the table is the gate here.
        await db.insert(schema.checkpoints).values(values);
      } catch (err) {
        const cause = (err as { cause?: { constraint?: string } }).cause;
        return cause?.constraint ?? `no constraint name: ${(err as Error).message.slice(0, 40)}`;
      }
      return "IT WAS ACCEPTED";
    }
    expect(
      await refusal({ articleId, namespace: "toc-labels", key: "../../etc/passwd", value: {} }),
    ).toBe("checkpoints_key_format");
    expect(await refusal({ articleId, namespace: "made-up", key: "abc123", value: {} })).toBe(
      "checkpoints_namespace",
    );
    /* The control: the same insert with nothing wrong with it is accepted, so a
       table that refused everything could not pass this test. */
    expect(
      await refusal({ articleId, namespace: "toc-labels", key: "abc123", value: {} }),
    ).toBe("IT WAS ACCEPTED");
  });

  /**
   * **The property the whole table exists for**, and it is the one thing an
   * artefact-store test cannot check: a checkpoint written while an attempt was
   * running must survive that attempt failing.
   *
   * The store uses `getDb()` — the pool — so the write is on a different
   * connection from the transaction, and the rollback cannot reach it. An
   * optional `tx` parameter, or a default of the ambient transaction, would
   * make this test the only thing standing between here and a checkpoint store
   * that preserves nothing.
   */
  it("a checkpoint survives the rollback of the attempt that wrote it", async () => {
    const { schema } = mod;
    const key = "1122334455667788";
    class RollBack extends Error {}
    await expect(
      db.transaction(async (tx) => {
        await tx
          .insert(schema.articleRevisions)
          .values({ articleId, status: "draft" })
          .returning();
        /* Inside the failing attempt, exactly where a stage writes one. */
        await store().write(SLUG, "toc-labels", key, { answer: "paid for" });
        throw new RollBack("the attempt failed");
      }),
    ).rejects.toThrow(RollBack);

    expect(await store().read(SLUG, "toc-labels", [key])).toEqual(
      new Map([[key, { answer: "paid for" }]]),
    );
  });

  it("a sweep keeps an old entry that was used today, in Postgres", async () => {
    const { schema } = mod;
    const hot = "00aa11bb22cc33dd";
    const cold = "44ee55ff66007711";
    const long = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000);
    for (const key of [hot, cold]) {
      await store().write(SLUG, "toc-labels", key, { answer: key });
      await db
        .update(schema.checkpoints)
        .set({ createdAt: long, lastUsedAt: long })
        .where(and(eq(schema.checkpoints.articleId, articleId), eq(schema.checkpoints.key, key)));
    }
    /* One of them gets used. */
    await store().read(SLUG, "toc-labels", [hot]);

    const before = checkpointCutoff(CHECKPOINT_RETENTION_DAYS);
    const dry = await mod.pg.sweepPgCheckpoints(before);
    expect(dry.swept).toBe(1);
    /**
     * Dry by default: still both there — checked with a **plain select, not
     * through the store**, and that is not fussiness. `read` stamps
     * `last_used_at`, so asking the store whether the cold entry is still there
     * makes it warm, and the sweep below then keeps it. The first version of
     * this test did exactly that and failed for a reason that had nothing to do
     * with the sweep. A check that changes what it is checking.
     */
    expect(await rowsFor()).toHaveLength(2);

    await mod.pg.sweepPgCheckpoints(before, { dryRun: false });
    expect((await rowsFor()).map((r) => r.key)).toEqual([hot]);
  });

  it("deleting the article takes its checkpoints with it", async () => {
    const { schema, admin } = mod;
    const slug = "test-checkpoint-cascade";
    await wipe(slug);
    const [a] = await db
      .insert(schema.articles)
      .values({ ownerId: admin.ADMIN_USER_ID_LOCAL, slug })
      .returning();
    if (!a) throw new Error("could not create the fixture article");
    const s = store(a.id, slug);
    await s.write(slug, "pdf-chunk", "deadbeefdeadbeef", { records: [] });
    expect(await rowsFor(a.id)).toHaveLength(1);

    /* A checkpoint holds a transcription of the reader's own document, so this
       is privacy work and not tidiness: it must not wait for a sweep. */
    await db.delete(schema.articles).where(eq(schema.articles.id, a.id));
    expect(await rowsFor(a.id)).toHaveLength(0);
  });
});
