/**
 * Stage 3 gets the previous run's blocks from the **store**, not from a path.
 *
 * This is the file that stands behind
 * docs/project/block-ids.md#surviving-stage-2-which-is-the-case-that-actually-matters
 * once the artefacts stop being files. Stage 3 keeps a paragraph's id across a
 * re-extraction by matching this run's blocks against the previous run's, and
 * until 2026-08-28 it got the previous run by reading
 * `output/<slug>.blocks.json` inside a `try/catch` whose `catch` said *first run
 * for this article*. The day the pipeline's artefacts move to Postgres that read
 * fails on every run, every article silently becomes a first ingest, and every
 * comment, saved search and ToC row in the database stops naming anything.
 * Nothing throws. See docs/plans/delete-the-importer.md § Three stages carry
 * identity in a file.
 *
 * ## Each of these was watched failing, and against what
 *
 * A check that has never been red is not evidence
 * (docs/reusable/silent-success.md), and the shape of bug here is precisely one
 * that agrees with the code. So:
 *
 * | mutation | what fails |
 * |---|---|
 * | `previousBlocksFrom` returns `undefined` instead of reading | *carries every id across a re-extraction…* (both stores) |
 * | drop the `hasEarlierBlocks` question | *refuses to mint when a baseline it should have had is missing* |
 * | swallow a throwing store read | *lets an infrastructure fault through untouched* |
 * | drop `assertIdsCarried` | *stops a run that kept none of the previous ids* |
 *
 * ## The Postgres half needs a database and says so
 *
 * It skips loudly when there is none, like every other Postgres suite here —
 * and the skip matters, because "0 failures" from a suite that never ran looks
 * exactly like a pass.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";

import {
  BLOCKS_INPUT_HTML,
  BaselineMissing,
  IdsNotCarried,
  blocksArtefact,
  previousBlocksFrom,
  runBlocks,
} from "../src/blocks.js";
import { createFsArtifactStore } from "../src/store/artifacts-fs.js";
import type { ArtifactStore } from "../src/store/artifacts.js";
import type { JobDraftRef } from "../src/store/artifacts-pg.js";
import type { Db } from "../src/db/client.js";
import { mintId } from "../src/ids.js";
import { mintAttempt } from "../src/store/jobs.js";
import { insertWhenSlotFree } from "./helpers/running-slot.js";
import type { Block, OwnerId } from "../src/types.js";

/** The transaction type, derived the same way `src/store/artifacts-pg.ts` derives it. */
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Thrown to unwind a fixture transaction; never an error anybody has to see. */
class RollBack extends Error {}

/* ------------------------------------------------------------ the article -- */

/**
 * What stage 2 hands over: two paragraphs and a heading, no ids anywhere.
 *
 * **No ids is the whole point.** Readability writes a fresh document on every
 * extraction, so after a re-extraction there is nothing in the HTML to preserve
 * and the `isSpideryarnId` branch in `splitIntoBlocks` has nothing to do. Every
 * id in the second run has to come from the baseline or be minted, which is the
 * one condition under which this test can tell the two apart.
 */
const EXTRACTED = `<!doctype html><html><body>
<h2>The opening</h2>
<p>A first paragraph, which does not change between the two runs.</p>
<p>A second paragraph, which does not change either.</p>
</body></html>`;

/* -------------------------------------------------------- the filesystem -- */

interface Workspace {
  root: string;
  dir: string;
  htmlFile: string;
  store: ArtifactStore;
}

/**
 * A store over a throwaway directory, laid out the way the real one is:
 * stage 3's `a.blocks.json` beside the HTML, stage 4's inside `data/`.
 */
async function aWorkspace(): Promise<Workspace> {
  const root = await mkdtemp(path.join(tmpdir(), "spya-baseline-"));
  const dir = path.join(root, "data");
  await mkdir(dir, { recursive: true });
  const htmlFile = path.join(root, "a.html");
  return { root, dir, htmlFile, store: createFsArtifactStore(() => ({ dir, htmlFile })) };
}

const idsIn = (blocks: readonly Block[]): string[] => blocks.map((b) => b.id);

describe("the baseline, over the filesystem store", () => {
  const cleanUp: string[] = [];
  afterAll(async () => {
    for (const root of cleanUp) await rm(root, { recursive: true, force: true });
  });

  const workspace = async (): Promise<Workspace> => {
    const w = await aWorkspace();
    cleanUp.push(w.root);
    return w;
  };

  it("carries every id across a re-extraction, taking the baseline from the store", async () => {
    const { dir, htmlFile, store } = await workspace();

    // Run one: a genuine first ingest. Nothing to carry, so everything mints.
    await writeFile(htmlFile, EXTRACTED, "utf-8");
    const first = await runBlocks({ htmlFile, previous: undefined });
    expect(first.stats.minted).toBe(3);
    expect(first.stats.carried).toBe(0);
    /* Stage 4's copy, which is what `hasEarlierBlocks` reads on this store. It
       exists here because a real article has been through stage 4 by now. */
    await writeFile(
      path.join(dir, "blocks.json"),
      JSON.stringify(blocksArtefact(first.blocks)),
      "utf-8",
    );

    /* Stage 2 runs again and overwrites the HTML with an id-free document —
       the case random ids exist for. */
    await writeFile(htmlFile, EXTRACTED, "utf-8");

    const previous = await previousBlocksFrom(store, "a");
    expect(idsIn(previous ?? [])).toEqual(idsIn(first.blocks));

    const second = await runBlocks({ htmlFile, previous });
    expect(second.stats.carried).toBe(3);
    expect(second.stats.minted).toBe(0);
    /* The exact ids, in order — not a count of survivors. Two runs that each
       produced three ids and share none of them would pass a count. */
    expect(idsIn(second.blocks)).toEqual(idsIn(first.blocks));
  });

  it("refuses to mint when a baseline it should have had is missing", async () => {
    const { dir, htmlFile, store } = await workspace();
    await writeFile(htmlFile, EXTRACTED, "utf-8");
    const first = await runBlocks({ htmlFile, previous: undefined });

    /* Stage 4's copy still lists every id this article ever had; stage 3's own
       copy — the baseline — has gone. block-ids.md calls that file a source
       artefact rather than a cache for exactly this reason. */
    await writeFile(
      path.join(dir, "blocks.json"),
      JSON.stringify(blocksArtefact(first.blocks)),
      "utf-8",
    );
    await rm(htmlFile.replace(/\.html$/, ".blocks.json"));

    await expect(previousBlocksFrom(store, "a")).rejects.toBeInstanceOf(BaselineMissing);
  });

  it("mints quietly when this really is a first ingest", async () => {
    const { store } = await workspace();
    /* Nothing on disk at all: no baseline and no earlier run to say there
       should have been one. This is the case that must NOT throw, and it is
       what stops the rule above turning every new article into an error. */
    await expect(previousBlocksFrom(store, "a")).resolves.toBeUndefined();
  });

  it("lets an infrastructure fault through untouched, rather than calling it a first ingest", async () => {
    const { store } = await workspace();
    const broken: ArtifactStore = {
      ...store,
      read: () => Promise.reject(new Error("connection terminated unexpectedly")),
    };
    /* The difference that matters: a store that cannot answer is not a store
       that answered "nothing". Swallowing this is how a database hiccup becomes
       permanent identity loss. */
    await expect(previousBlocksFrom(broken, "a")).rejects.toThrow(/connection terminated/);
  });

  it("asks the store, and does not fall back to reading the file itself", async () => {
    const { htmlFile, store } = await workspace();
    await writeFile(htmlFile, EXTRACTED, "utf-8");
    const first = await runBlocks({ htmlFile, previous: undefined });

    /* The baseline is sitting on disk exactly where the old code read it from.
       A store that says there is none must win, or the seam is decorative and
       landing D will take the files away without anything noticing. */
    const empty: ArtifactStore = { ...store, read: () => Promise.resolve(null) };
    await expect(previousBlocksFrom(empty, "a")).resolves.toBeUndefined();
    expect(JSON.parse(await readFile(first.jsonFile, "utf-8")).blocks).toHaveLength(3);
  });
});

/* ------------------------------------------------------------- the guard -- */

describe("the runtime guard", () => {
  const cleanUp: string[] = [];
  afterAll(async () => {
    for (const root of cleanUp) await rm(root, { recursive: true, force: true });
  });

  /** A previous run of a completely different article, so nothing can match. */
  const strangers: Block[] = [
    {
      id: "spya-zzzzz2",
      tag: "p",
      kind: "text",
      text: "Words from somewhere else entirely.",
      words: 5,
      html: "<p>Words from somewhere else entirely.</p>",
      gistable: true,
    },
  ];

  it("stops a run that kept none of the previous ids", async () => {
    const w = await aWorkspace();
    cleanUp.push(w.root);
    await writeFile(w.htmlFile, EXTRACTED, "utf-8");

    /* A non-empty baseline and a non-empty output that share nothing. Every
       anchor into this article would be pointing at a block that no longer
       exists, and the step would have reported success. */
    await expect(runBlocks({ htmlFile: w.htmlFile, previous: strangers })).rejects.toBeInstanceOf(
      IdsNotCarried,
    );
  });

  it("refuses before it writes, so the previous artefacts survive the refusal", async () => {
    const w = await aWorkspace();
    cleanUp.push(w.root);
    await writeFile(w.htmlFile, EXTRACTED, "utf-8");
    const jsonFile = w.htmlFile.replace(/\.html$/, ".blocks.json");
    await writeFile(jsonFile, JSON.stringify(blocksArtefact(strangers)), "utf-8");

    await expect(runBlocks({ htmlFile: w.htmlFile, previous: strangers })).rejects.toThrow();

    /* Still the baseline, not half of a run that was refused. A guard that
       destroys what it is protecting is worse than no guard. */
    const after = JSON.parse(await readFile(jsonFile, "utf-8"));
    expect(idsIn(after.blocks)).toEqual(["spya-zzzzz2"]);
    expect(await readFile(w.htmlFile, "utf-8")).toBe(EXTRACTED);
  });

  it("says nothing on a first ingest, where minting everything is correct", async () => {
    const w = await aWorkspace();
    cleanUp.push(w.root);
    await writeFile(w.htmlFile, EXTRACTED, "utf-8");
    const run = await runBlocks({ htmlFile: w.htmlFile, previous: undefined });
    expect(run.stats.minted).toBe(3);
  });

  it("says nothing when even one id survives, because a threshold would be a guess", async () => {
    const w = await aWorkspace();
    cleanUp.push(w.root);
    await writeFile(w.htmlFile, EXTRACTED, "utf-8");
    const first = await runBlocks({ htmlFile: w.htmlFile, previous: undefined });

    /* One paragraph unchanged, the rest of the baseline unrecognisable. A real
       partial loss, deliberately not an error — the numbers are in the step's
       log line instead. */
    const survivor = first.blocks[1]!;
    await writeFile(w.htmlFile, EXTRACTED, "utf-8");
    const run = await runBlocks({
      htmlFile: w.htmlFile,
      previous: [...strangers, survivor],
    });
    expect(idsIn(run.blocks)).toContain(survivor.id);
  });
});

/* --------------------------------------------------- which HTML stage 3 eats -- */

describe("the HTML stage 3 consumes", () => {
  it("is stage 2's, and never stage 3's own previous output", () => {
    /* Not a tautology, and not a style preference. On the filesystem the two
       are the same path and nobody could choose; in Postgres they are two
       columns, and reading `stampedHtml` would hand stage 3 last week's
       paragraphs already carrying this week's ids — a clean-looking run that
       re-publishes the previous article. Landing D reads this constant. */
    expect(BLOCKS_INPUT_HTML).toBe("extractedHtml");
  });
});

/* --------------------------------------- the argument that must not go missing -- */

/**
 * **Nothing in `src/` may call `splitIntoBlocks` with one argument.**
 *
 * The trap this closes, which is specific and worth stating: landing D deletes
 * `dir` and `htmlFile` from `StepContext`, so the code that calls stage 3 *has*
 * to be edited — that part is safe, because it will not compile. What is not
 * safe is the shape of the edit. `splitIntoBlocks(html, previous?: Block[])`
 * takes its baseline **optionally**, so a conversion that reads the HTML from
 * the store and writes `splitIntoBlocks(html)` compiles cleanly, runs green,
 * and silently re-mints every id in the article.
 *
 * `runBlocks`'s `previous` is required, which closes the production path the
 * strong way. This closes the one underneath it.
 *
 * **Why a grep and not a required parameter.** Making the second argument
 * required would touch 81 call sites across four test files — one of which
 * belongs to another session's in-flight work — and those tests pass one
 * argument *legitimately*: they are exercising the first-ingest path, which is a
 * real case. Forcing all of them to write `, undefined` would be noise that
 * looks like rigour and teaches nothing. The precedent for reading the source
 * instead is `tests/sanitize-stale-artefact.test.ts`, for the reason it gives:
 * a rule stated in one function is not a rule the codebase follows.
 *
 * **The honest limit.** This checks the *call shape*, not the value. Somebody
 * can still pass `undefined` explicitly and this will not stop them — but then
 * they have written the word, and the difference between an omission and a
 * decision is the entire point of the check.
 */
describe("the baseline argument", () => {
  it("is never omitted by anything in src/", async () => {
    const { readdir } = await import("node:fs/promises");
    const root = path.join(import.meta.dirname, "..", "src");

    const files: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(full);
        else if (entry.name.endsWith(".ts")) files.push(full);
      }
    };
    await walk(root);

    /* A call with no comma before its closing bracket — `splitIntoBlocks(x)` —
       and not `splitIntoBlocks(x, y)`. The declaration is skipped by requiring
       something other than a type annotation in front of the bracket. */
    const oneArgument = /\bsplitIntoBlocks\(\s*[^,()]*\)/;
    const offenders: string[] = [];
    for (const file of files) {
      const source = await readFile(file, "utf-8");
      source.split("\n").forEach((line, i) => {
        if (/function splitIntoBlocks/.test(line)) return;
        if (oneArgument.test(line)) offenders.push(`${path.relative(root, file)}:${i + 1}`);
      });
    }

    expect(offenders).toEqual([]);
  });

  it("would notice — the check is run against a call that omits it", () => {
    /* A check that has never been red is not evidence, and a grep over a
       directory that happens to be clean is exactly that. So the pattern is
       exercised here on both shapes, in this file, where it cannot go stale
       without failing. */
    const oneArgument = /\bsplitIntoBlocks\(\s*[^,()]*\)/;
    expect(oneArgument.test("  const r = splitIntoBlocks(html);")).toBe(true);
    expect(oneArgument.test("  const r = splitIntoBlocks(html, previous);")).toBe(false);
  });
});

/* ------------------------------------------------------------- Postgres -- */

const { loadEnvLocal } = await import("../src/env.js");
loadEnvLocal();

/**
 * **These have never run, and the reason is written here rather than only in
 * somebody's report.**
 *
 * As of 2026-08-28 they cannot execute on a laptop whose database is behind
 * `drizzle/0027_block_roles.sql`. That migration adds `role`, `treatment` and
 * `note_id` to `revision_blocks`, and `readBlocks` in
 * `src/store/artifacts-pg.ts` selects all three — so *every* read of a block row
 * fails with `column "role" does not exist`, whatever the test is about. The
 * repo's own drift guard says the same thing independently
 * (`tests/db-schema-drift.test.ts`).
 *
 * **What has to be true before this describe block can run:**
 *
 * 1. `drizzle/0027_block_roles.sql` is applied to the database in
 *    `DATABASE_URL` — `npm run db:migrate`, after reading its `Target:` line.
 * 2. Nothing else is holding the single `running` job slot (`withClaim` below
 *    waits it out, up to 20 seconds).
 *
 * The probe checks for the column itself, not merely for the table, precisely
 * so that a half-migrated database **skips loudly** instead of producing three
 * red lines that read like a bug in the code under test. A suite that reports
 * "0 failures" because it never ran is the thing this project keeps writing
 * postmortems about, so the console line is not optional decoration.
 */
let reachable = false;
let why = "DATABASE_URL is not set — run npm run db:start (docs/project/supabase-local.md)";
if (process.env.DATABASE_URL) {
  const { Pool } = await import("pg");
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: 10_000,
  });
  try {
    const probe = await pool.query(
      "select to_regclass('spideryarn.revision_blocks') is not null as ready",
    );
    reachable = probe.rows[0]?.ready === true;
    if (!reachable) why = "the spideryarn schema is not there — run npm run db:migrate";
    if (reachable) {
      /* The column, not the table. `readBlocks` selects it, so without it every
         read fails for a reason that has nothing to do with the baseline. */
      const migrated = await pool.query(
        "select 1 from information_schema.columns where table_schema = 'spideryarn' " +
          "and table_name = 'revision_blocks' and column_name = 'role'",
      );
      reachable = migrated.rowCount === 1;
      if (!reachable) {
        why =
          "drizzle/0027_block_roles.sql is not applied — revision_blocks has no `role` column, " +
          "and src/store/artifacts-pg.ts selects it, so every block read fails. " +
          "Run `npm run db:migrate` (check its Target: line first) and these will run.";
      }
    }
  } catch (err) {
    reachable = false;
    why = `could not reach it: ${(err as Error).message}`;
  }
  await pool.end();
}
/* **Unconditional, and it took a run to notice why.** The first version warned
   only inside the `if`, so the one case that produces no warning at all was a
   missing `DATABASE_URL` — a silent skip, which is the exact thing this block is
   supposed to make impossible. Every road to `reachable === false` says why. */
if (!reachable) console.warn(`\n  ⚠ the Postgres half of this file is SKIPPING: ${why}\n`);
const when = reachable ? describe : describe.skip;

/**
 * **One test that always runs, and whose name is the reason.**
 *
 * `describe.skip` hides four cases behind the word "skipped", and the console
 * warning above turned out not to survive vitest's default reporter — module-level
 * output during collection is not shown. So the state is put where it cannot be
 * missed: in a test name, which every reporter prints. A reader scanning a run
 * sees *why* the Postgres half did not execute rather than a silent count.
 */
describe("the Postgres half of this file", () => {
  it(
    reachable
      ? "is running — the database has the columns src/store/artifacts-pg.ts selects"
      : `is NOT RUNNING, and these assertions have not executed: ${why}`,
    () => {
      /* Deliberately not `expect(reachable).toBe(true)`. A missing database is
         not a failure — it is a fact about this laptop, and the name has just
         stated it. Failing here would make `npm test` red for everybody without
         a local Postgres, which is not what the skip is for. */
      expect(typeof why).toBe("string");
    },
  );
});

when("the baseline, over the Postgres store", () => {
  const SLUG = "test-blocks-baseline";
  const FRESH_SLUG = "test-blocks-baseline-new";

  let db: Awaited<ReturnType<typeof importDb>>["db"];
  let mod: Awaited<ReturnType<typeof importDb>>;

  async function importDb() {
    const client = await import("../src/db/client.js");
    const schema = await import("../src/db/schema.js");
    const pg = await import("../src/store/artifacts-pg.js");
    const revisions = await import("../src/store/pg-revisions.js");
    const admin = await import("../src/admin.js");
    const owner = await import("../src/owner.js");
    return { db: client.getDb(), client, schema, pg, revisions, admin, owner };
  }

  /* Ids from the alphabet `block_identities_id_format` allows, and deliberately
     not in the order the paragraphs appear: an assertion that reads back the
     ids in document order cannot be satisfied by an accident of sorting. */
  const H = "spya-zbaaa2";
  const P1 = "spya-mbaaa2";
  const P2 = "spya-cbaaa2";

  /** The published article, exactly as stage 3 left it three paragraphs ago. */
  const PUBLISHED: { blockId: string; ordinal: number; tag: string; text: string }[] = [
    { blockId: H, ordinal: 0, tag: "h2", text: "The opening" },
    { blockId: P1, ordinal: 1, tag: "p", text: "A first paragraph, which does not change between the two runs." },
    { blockId: P2, ordinal: 2, tag: "p", text: "A second paragraph, which does not change either." },
  ];

  let articleId = "";
  let publishedId = "";
  const roots: string[] = [];

  async function wipe(slug: string): Promise<void> {
    const { schema } = mod;
    const rows = await db
      .select({ id: schema.articles.id })
      .from(schema.articles)
      .where(eq(schema.articles.slug, slug));
    for (const { id } of rows) {
      await db.execute(sql`update ${schema.articles} set current_revision_id = null where id = ${id}::uuid`);
      await db.delete(schema.revisionBlocks).where(eq(schema.revisionBlocks.articleId, id));
      await db.delete(schema.articleRevisions).where(eq(schema.articleRevisions.articleId, id));
      await db.delete(schema.blockIdentities).where(eq(schema.blockIdentities.articleId, id));
      await db.delete(schema.articles).where(eq(schema.articles.id, id));
    }
  }

  beforeAll(async () => {
    mod = await importDb();
    db = mod.db;
    const { schema, admin } = mod;
    await wipe(SLUG);
    await wipe(FRESH_SLUG);

    const [article] = await db
      .insert(schema.articles)
      .values({ ownerId: admin.ADMIN_USER_ID, slug: SLUG })
      .returning();
    if (!article) throw new Error("could not create the fixture article");
    articleId = article.id;

    const [revision] = await db
      .insert(schema.articleRevisions)
      .values({ articleId, status: "published", extractedHtml: EXTRACTED })
      .returning();
    if (!revision) throw new Error("could not create the fixture revision");
    publishedId = revision.id;

    await db
      .insert(schema.blockIdentities)
      .values(PUBLISHED.map((b) => ({ articleId, blockId: b.blockId })));

    /* **Column names spelled out, not a drizzle `.values()`.** Drizzle names
       every column of the table, including ones a pending migration has not
       added to this database yet, so a fixture written that way fails for a
       reason that has nothing to do with what it is testing. `beginDraftIn`
       writes its copy the same way and for the same kind of reason. */
    for (const b of PUBLISHED) {
      await db.execute(sql`
        insert into ${schema.revisionBlocks}
          (article_id, revision_id, block_id, ordinal, tag, kind, text, words, html, gistable)
        values (${articleId}::uuid, ${publishedId}::uuid, ${b.blockId}, ${b.ordinal},
                ${b.tag}, 'text', ${b.text}, ${b.text.split(" ").length},
                ${`<${b.tag} id="${b.blockId}">${b.text}</${b.tag}>`}, true)
      `);
    }

    /* The pointer `hasEarlierBlocks` reads. Set directly rather than through
       `publishRevision`, which wants a tree, labels and a step run — none of
       which this is about. */
    await db.execute(
      sql`update ${schema.articles} set current_revision_id = ${publishedId}::uuid where id = ${articleId}::uuid`,
    );

    await db
      .insert(schema.articles)
      .values({ ownerId: admin.ADMIN_USER_ID, slug: FRESH_SLUG })
      .onConflictDoNothing();
  }, 60_000);

  afterAll(async () => {
    if (mod) {
      await wipe(SLUG);
      await wipe(FRESH_SLUG);
      await mod.client.closeDb();
    }
    for (const root of roots) await rm(root, { recursive: true, force: true });
  });

  /**
   * A draft based on the published revision, and a store bound to it.
   *
   * **`runAsOwner`, explicitly.** `lockArticle` filters by `currentOwnerId()`,
   * which outside a request falls back to `SPIDERYARN_OWNER_ID` — and
   * `vite.config.ts` loads `.env.local` into vitest, so a suite that relied on
   * that would pass on this laptop and fail on one where the variable names
   * somebody else. Naming the owner here is the only version of this that is
   * about the code rather than about the environment.
   */
  async function aDraft(slug: string) {
    const { pg, revisions, admin, owner } = mod;
    /* `asOwnerId` is module-private, and the brand exists so an owner cannot be
       invented by accident — which is what a test fixture is doing here on
       purpose, with a uuid the migrations put in `auth.users`. */
    const begun = await owner.runAsOwner(admin.ADMIN_USER_ID as OwnerId, () =>
      revisions.beginRevision({ slug }),
    );
    void pg;
    return { begun, revisionId: begun.revisionId, articleId: begun.articleId };
  }

  /**
   * A live claim on a draft, and everything it touches rolled back.
   *
   * **`writeArtefacts` will not write without one.** It calls
   * `requireLiveJobOwnsDraft` first — this job, this attempt, still `running`,
   * still pointed at this draft — so a test that wants the production write path
   * has to supply a real job row rather than a plausible-looking `JobDraftRef`.
   * That is the check doing its job, and it is exactly why the store cannot be
   * hand-built here.
   *
   * `jobs_only_one_running` is a unique index over the whole table, so at most
   * one `running` row exists anywhere — including another `npm test` on the same
   * laptop. `insertWhenSlotFree` waits for it instead of failing with a
   * duplicate-key error that points at the wrong suite.
   */
  async function withClaim(
    slug: string,
    revisionId: string,
    articleId: string,
    body: (tx: Tx, ref: JobDraftRef) => Promise<void>,
  ): Promise<void> {
    const { schema } = mod;
    await insertWhenSlotFree(slug, async () => {
      const id = mintId();
      const attemptId = mintAttempt();
      try {
        await db.transaction(async (tx) => {
          await tx.insert(schema.jobs).values({
            id,
            ownerId: mod.admin.ADMIN_USER_ID,
            slug,
            steps: [{ name: "blocks", label: "Splitting into blocks", status: "pending" }],
            status: "running",
            attemptId,
            leaseExpiresAt: new Date(Date.now() + 600_000),
            workKey: `wk-${id}`,
            draftRevisionId: revisionId,
          });
          await body(tx, { slug, articleId, revisionId, jobId: id, attemptId });
          throw new RollBack();
        });
      } catch (err) {
        if (!(err instanceof RollBack)) throw err;
      }
    });
  }

  it("carries every id through stage 3 and back out of the store it wrote them to", async () => {
    const { begun, revisionId, articleId } = await aDraft(SLUG);
    /* `beginDraftIn` copies the published revision's block rows into the new
       draft before any stage runs — the baseline is already there, and this is
       the number that says so. */
    expect(begun.blocksCopied).toBe(3);

    const root = await mkdtemp(path.join(tmpdir(), "spya-baseline-pg-"));
    roots.push(root);
    const htmlFile = path.join(root, "a.html");
    /* Stage 2's output: the same words, no ids anywhere. */
    await writeFile(htmlFile, EXTRACTED, "utf-8");

    await withClaim(SLUG, revisionId, articleId, async (tx, ref) => {
      const store = mod.pg.pgArtifactsIn(ref, tx);

      const previous = await previousBlocksFrom(store, SLUG);
      expect(previous?.map((b) => b.id)).toEqual([H, P1, P2]);

      const run = await runBlocks({ htmlFile, previous });
      expect(run.stats.minted).toBe(0);
      expect(run.blocks.map((b) => b.id)).toEqual([H, P1, P2]);

      /* **Through `writeArtefacts`, which is the point of this test.** Stopping
         at `runBlocks` would prove the matcher works and say nothing about the
         path landing D actually takes: `write` deletes every block row for this
         revision and inserts the new ones, so an id that survived the match and
         then failed to survive the write would look identical from outside. */
      await store.beginStep(SLUG, "blocks");
      await store.write(SLUG, "blocks", { blocks: { blocks: run.blocks }, stampedHtml: run.html }, {});

      const readBack = await store.read(SLUG, "blocks", "blocks");
      /* The exact ids, in document order, read out of the table the write put
         them in. This is the assertion the whole change exists for. */
      expect(readBack?.blocks.map((b) => b.id)).toEqual([H, P1, P2]);
      expect(readBack?.blocks.map((b) => b.text)).toEqual(PUBLISHED.map((b) => b.text));
    });
  }, 60_000);

  it("stays idempotent — a second stage 3 over the rows the first one wrote", async () => {
    /* The case the plan's existing acceptance list cannot reach: item 8 runs the
       pipeline with `data/<slug>/` empty, and a *fresh* ingest mints everything
       by design, so it cannot tell "carries ids correctly" from "re-mints every
       time". This runs the stage a second time against unchanged text and
       asserts the same exact ids, not merely that some were carried. */
    const { revisionId, articleId } = await aDraft(SLUG);
    const root = await mkdtemp(path.join(tmpdir(), "spya-baseline-pg2-"));
    roots.push(root);
    const htmlFile = path.join(root, "a.html");

    await withClaim(SLUG, revisionId, articleId, async (tx, ref) => {
      const store = mod.pg.pgArtifactsIn(ref, tx);
      await store.beginStep(SLUG, "blocks");

      await writeFile(htmlFile, EXTRACTED, "utf-8");
      const first = await runBlocks({ htmlFile, previous: await previousBlocksFrom(store, SLUG) });
      await store.write(SLUG, "blocks", { blocks: { blocks: first.blocks }, stampedHtml: first.html }, {});

      /* Stage 2 runs again and hands over an id-free document, exactly as
         Readability does. The only way the ids can come back is the baseline. */
      await writeFile(htmlFile, EXTRACTED, "utf-8");
      const second = await runBlocks({ htmlFile, previous: await previousBlocksFrom(store, SLUG) });
      await store.write(SLUG, "blocks", { blocks: { blocks: second.blocks }, stampedHtml: second.html }, {});

      expect(second.stats.minted).toBe(0);
      const readBack = await store.read(SLUG, "blocks", "blocks");
      expect(readBack?.blocks.map((b) => b.id)).toEqual([H, P1, P2]);
    });
  }, 60_000);

  it("refuses to mint when the draft's carried baseline is not there", async () => {
    const { revisionId, articleId } = await aDraft(SLUG);
    const { schema } = mod;
    /* The carry-forward did not happen — a failed copy, a bad migration, a
       hand-edit. The article has a published revision, so this is not a first
       ingest, and minting would orphan every anchor into it. */
    await db
      .delete(schema.revisionBlocks)
      .where(eq(schema.revisionBlocks.revisionId, revisionId));

    await withClaim(SLUG, revisionId, articleId, async (tx, ref) => {
      const store = mod.pg.pgArtifactsIn(ref, tx);
      await expect(previousBlocksFrom(store, SLUG)).rejects.toBeInstanceOf(BaselineMissing);
    });
  }, 60_000);

  it("mints quietly for an article with no published revision", async () => {
    const { begun, revisionId, articleId } = await aDraft(FRESH_SLUG);
    expect(begun.basedOn).toBeNull();
    expect(begun.blocksCopied).toBe(0);

    await withClaim(FRESH_SLUG, revisionId, articleId, async (tx, ref) => {
      const store = mod.pg.pgArtifactsIn(ref, tx);
      await expect(previousBlocksFrom(store, FRESH_SLUG)).resolves.toBeUndefined();
    });
  }, 60_000);
});
