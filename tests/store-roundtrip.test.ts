/**
 * `data/` → Postgres → `data/` loses nothing.
 *
 * The exporter is the rollback (src/store/export.ts), and a rollback nobody has
 * ever run is not a rollback. This runs it: import every article, export it to
 * a temporary directory, and compare every artefact against the original.
 *
 * ## Semantic equality, not byte equality, and why that is the right bar
 *
 * The files do NOT come back byte-identical, and they cannot. `tree`, `arc`,
 * `tweets`, `glossary`, `summary` and `labels` are stored as **JSONB**, and
 * JSONB does not preserve key order — it is a parsed representation, not the
 * text you handed it. So a round trip reorders keys inside objects while
 * changing nothing about what they mean.
 *
 * That is worth stating rather than working around, because the obvious
 * "improvement" — storing these as `text` to keep the bytes — would cost every
 * query that ever wants to look inside one, to buy a `git diff` that is tidier
 * during a rollback nobody expects to run. So: keys are sorted before
 * comparison, and everything else must match exactly.
 *
 * Skips loudly when there is no database — see tests/db-schema.test.ts.
 */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDb } from "../src/db/client.js";
import { loadEnvLocal } from "../src/env.js";
import { isSpideryarnId } from "../src/ids.js";
import { exportArticle } from "../src/store/export.js";
import { importArticle } from "../src/store/import.js";

loadEnvLocal();

const ROOT = path.resolve(import.meta.dirname, "..");

/** Every artefact a round trip should preserve. */
const ARTEFACTS = [
  "meta.json",
  "blocks.json",
  "tree.json",
  "arc.json",
  "tweets.json",
  "glossary.json",
  "summary.json",
  "labels.json",
  "comments.json",
  "chat.json",
  "searches.json",
  "glossary-lookups.json",
  "shelf.json",
] as const;

/** Sort every object's keys, recursively. See the header for why. */
function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, sorted(v)]),
    );
  }
  return value;
}

/**
 * Put the reader-state lists in one known order, on both sides.
 *
 * A table has no array order, so a round trip cannot promise to return
 * `comments.json`'s. It usually did, by the accident of Postgres handing back
 * rows in the order they were written — and the accident ran out the day
 * src/store/import.ts started deleting and re-inserting reader state. Nor was
 * the accident ever right: data/noema-.../comments.json has a hand-written
 * comment sitting out of date order, so the file's order is *insertion* order,
 * and no column records it.
 *
 * That is fine, and worth saying why rather than just sorting and moving on.
 * Nothing reads the array order: src/web/comment-nav.ts sorts comments into
 * document order before the reader sees any of them, breaking ties on
 * `createdAt` then `id` — the same chain used here and in src/store/export.ts.
 * So the promise this test makes is "every row comes back, unchanged", not
 * "the file is byte-identical", which is the same bar the JSONB key order
 * already set. GPT Sol raised it in review, 2026-08-26.
 *
 * Chat MESSAGES are deliberately not reordered: `chat_messages.ordinal` does
 * record their position, so their order is a real promise and sorting them here
 * would hide the day it breaks.
 */
function canonical(artefact: string, value: unknown): unknown {
  const key = { "comments.json": "comments", "searches.json": "runs", "chat.json": "threads" }[
    artefact
  ];
  if (!key || !value || typeof value !== "object") return value;
  const raw = (value as Record<string, unknown>)[key];
  if (!Array.isArray(raw)) return value;
  /* A comment whose anchor is not a block id cannot exist in Postgres —
     `block_identities` has a format check and `comments.json` does not, and
     something wrote one on `data/writes` anchored to `zzzz00`. The importer
     skips it and says so, so it cannot come back, and dropping it from the
     original is the honest comparison rather than a lowered bar. Delete the
     corrupt row and this stops matching anything. */
  const list: unknown[] =
    key === "comments"
      ? raw.filter((c) => isSpideryarnId((c as { blockId?: string }).blockId ?? ""))
      : raw;
  const rank = (x: unknown) => {
    const o = x as { createdAt?: string; id?: string };
    return `${o.createdAt ?? ""}|${o.id ?? ""}`;
  };
  return {
    ...value,
    [key]: [...list].sort((a, b) => rank(a).localeCompare(rank(b))),
  };
}

async function readJsonIfPresent(file: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}

let reachable = false;
let slugs: readonly string[] = [];

if (process.env.DATABASE_URL) {
  const { Pool } = await import("pg");
  /* 10 seconds, not 2. At 2s this probe timed out under nothing worse than a
     dev server holding connections, and the whole suite skipped — inside a run
     that still printed a green "1103 passed". A parity suite that opts itself
     out when the machine is busy is worse than one that fails, because the
     signal it gives is indistinguishable from success. */
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: 10_000,
  });
  let why = "";
  try {
    const probe = await pool.query(
      "select to_regclass('spideryarn.revision_blocks') is not null as ready",
    );
    reachable = probe.rows[0]?.ready === true;
    if (!reachable) why = "the spideryarn schema is not there — run npm run db:migrate";
  } catch (err) {
    reachable = false;
    why = `could not reach it: ${(err as Error).message}`;
  }
  await pool.end();

  /* Said out loud. DATABASE_URL being SET and the database being unreachable is
     a different situation from having no database at all, and only the first
     one means somebody's Docker is off while they believe these ran. */
  if (!reachable) {
    console.warn(`\n  ⚠ DATABASE_URL is set but these tests are skipping: ${why}\n`);
  }

  if (reachable) {
    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(path.join(ROOT, "data"), { withFileTypes: true });
    const found: string[] = [];
    for (const entry of entries) {
      // `_` is the queue's; `test-` is another test file's fixture, created and
      // removed concurrently — see tests/store-parity.test.ts for the full note.
      if (!entry.isDirectory() || entry.name.startsWith("_") || entry.name.startsWith("test-")) {
        continue;
      }
      const files: string[] = await readdir(path.join(ROOT, "data", entry.name)).catch(
        () => [] as string[],
      );
      if (files.includes("blocks.json") && files.includes("tree.json")) found.push(entry.name);
    }
    slugs = found;
  }
}

const when = reachable ? describe : describe.skip;

let out = "";

when("a round trip through Postgres", () => {
  beforeAll(async () => {
    out = await mkdtemp(path.join(tmpdir(), "spideryarn-rollback-"));
    for (const slug of slugs) {
      await importArticle(slug);
      await exportArticle(slug, {
        dataRoot: path.join(out, "data"),
        // Inside the temp directory, explicitly. See ExportTarget.
        outputRoot: path.join(out, "output"),
      });
    }
  }, 120_000);

  afterAll(async () => {
    if (out) await rm(out, { recursive: true, force: true });
    await closeDb();
  });

  it("has something to round-trip", () => {
    expect(slugs.length).toBeGreaterThan(0);
  });

  describe.each(slugs)("%s", (slug) => {
    it.each(ARTEFACTS)("preserves %s exactly", async (artefact) => {
      const original = await readJsonIfPresent(path.join(ROOT, "data", slug, artefact));
      const returned = await readJsonIfPresent(path.join(out, "data", slug, artefact));

      if (original === undefined) {
        /* Absent must stay absent. An exporter that invents an empty
           `comments.json` where there was none would look harmless and would
           mean every article came back with a file the pipeline never wrote —
           and `stepIsDone` is an existence check, so an invented file makes a
           step report itself finished. */
        expect(returned).toBeUndefined();
        return;
      }

      expect(returned).toBeDefined();
      expect(sorted(canonical(artefact, returned))).toEqual(
        sorted(canonical(artefact, original)),
      );
    });
  });

  it("puts the id-stamped HTML back in output/, not beside the article", async () => {
    // Stage 3 reads and writes ids into `output/<slug>.html`, NOT into
    // `data/<slug>/` — docs/plans/postgres-migration.md § Stage 3 recovers ids
    // from output/. Exporting it beside the article would put it somewhere
    // nothing reads, and the next `npm run blocks` would re-mint every id.
    const beside = await readJsonIfPresent(path.join(out, "data", slugs[0] ?? "", "stamped.html"));
    expect(beside).toBeUndefined();
  });
});
