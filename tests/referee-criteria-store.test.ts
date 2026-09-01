/**
 * Where a referee's criteria are kept — `withCriterion` and the filesystem
 * store in src/referee-criteria-store.ts, and the Postgres store beside it.
 *
 * Three things are under test and they are deliberately different in kind:
 *
 * 1. **`withCriterion` as a pure decision.** It holds the three-condition retry
 *    rule this repo carries a postmortem for
 *    (docs/postmortems/260826f-search-retry-remints-instead-of-resetting.md) plus one
 *    addition of its own — a reset adopts the new config — and both stores call
 *    it, so pinning it here pins it for both.
 * 2. **A round trip through the filesystem store**, with a negative valence in
 *    it. That is the second half of the journey tests/referee-criteria-run.test.ts
 *    walks the first half of: model bytes → validator → outcome, and now
 *    outcome → disk → back. Together they are the whole path the plan predicts
 *    will silently lose a minus sign.
 * 3. **Parity with the Postgres store**, when there is a database. Skipped
 *    loudly when there is not, for the reason tests/db-schema.test.ts explains:
 *    a skipped test protects nothing, so the run must say "skipped" rather than
 *    "passed".
 *
 * Writes under `data/<throwaway slug>/`, which is gitignored, and removes it.
 */

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { closeDb, getDb } from "../src/db/client.js";
import {
  articleRevisions,
  articles,
  blockIdentities,
  revisionBlocks,
} from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { currentOwnerId } from "../src/owner.js";
import type { RefereeCriterionConfig, RefereeResult } from "../src/referee-criteria.js";
import {
  beginCriterion,
  deleteCriterion,
  finishCriterion,
  loadCriteria,
  recolourCriterion,
  withColour,
  withCriterion,
} from "../src/referee-criteria-store.js";
import { pgRefereeCriteriaStore } from "../src/store/pg-referee-criteria.js";
import { fsRefereeCriteriaStore } from "../src/store/fs.js";
import { MAX_CRITERIA, type SavedCriterion } from "../src/saved-criteria.js";
import { pgReady } from "./helpers/pg-ready.js";

loadEnvLocal();

const SLUG = "test-referee-criteria-store";
const DIR = path.resolve(import.meta.dirname, "..", "data", SLUG);

const SINGLE: RefereeCriterionConfig = { kind: "single" };
const DIVERGING: RefereeCriterionConfig = {
  kind: "diverging",
  poles: { against: "a control is missing", favour: "the controls settle it" },
  scale: "rg",
};

/** A stored diverging result whose valence is the number this file is about. */
const NEGATIVE: RefereeResult = {
  kind: "diverging",
  blockId: "spya-k3m9qt",
  quote: "no negative control",
  start: 3,
  confidence: 90,
  reasoning: "the control is missing",
  valence: -80,
};

const row = (over: Partial<SavedCriterion> = {}): SavedCriterion => ({
  id: "spya-aaaaaa",
  criterion: "Are the controls adequate?",
  config: SINGLE,
  createdAt: "2026-09-01T00:00:00.000Z",
  status: "done",
  results: [],
  ...over,
});

/* -------------------------------------------------------- the pure rule -- */

describe("withCriterion — which row a request produces", () => {
  it("mints a row when the id is free", () => {
    const { row: made, kind } = withCriterion([], "Controls?", SINGLE, "spya-bbbbbb", "t");
    expect(kind).toBe("minted");
    expect(made.id).toBe("spya-bbbbbb");
    expect(made.status).toBe("pending");
    expect(made.results).toEqual([]);
  });

  it("mints a fresh id rather than colliding with a row that has not failed", () => {
    const existing = [row({ status: "done" })];
    const { row: made, kind } = withCriterion(existing, "Are the controls adequate?", SINGLE, "spya-aaaaaa", "t");
    expect(kind).toBe("minted");
    expect(made.id).not.toBe("spya-aaaaaa");
  });

  it("resets a failed row of the same id and the same criterion", () => {
    const existing = [row({ status: "error", error: "boom", model: "m", colour: 3 })];
    const { row: made, kind } = withCriterion(existing, "Are the controls adequate?", SINGLE, "spya-aaaaaa", "t");
    expect(kind).toBe("reset");
    expect(made.id).toBe("spya-aaaaaa");
    // Rebuilt field by field: the failed attempt cannot survive underneath.
    expect(made.error).toBeUndefined();
    expect(made.model).toBeUndefined();
    // The colour is a property of the question, not of the attempt — and the
    // two stores disagreeing about that is a bug src/searches.ts already had.
    expect(made.colour).toBe(3);
    expect(made.createdAt).toBe("2026-09-01T00:00:00.000Z");
  });

  it("refuses to reset under a different criterion, however the id matches", () => {
    const existing = [row({ status: "error" })];
    const { kind } = withCriterion(existing, "Something else entirely", SINGLE, "spya-aaaaaa", "t");
    expect(kind).toBe("minted");
  });

  /* The one deliberate difference from `withRun`. A diverging criterion whose
     run failed because its poles were nonsense is exactly the row a referee
     edits and runs again; answering the fixed question with the broken
     configuration would be the worst available outcome. */
  it("adopts the new config on a reset, because that is what a referee fixes", () => {
    const broken: RefereeCriterionConfig = {
      kind: "diverging",
      poles: { against: "x", favour: "y" },
      scale: "br",
    };
    const existing = [row({ status: "error", config: broken })];
    const { row: made } = withCriterion(existing, "Are the controls adequate?", DIVERGING, "spya-aaaaaa", "t");
    expect(made.config).toEqual(DIVERGING);
  });

  it("keeps at most MAX_CRITERIA, oldest first", () => {
    let rows: SavedCriterion[] = [];
    for (let i = 0; i < MAX_CRITERIA + 3; i++) {
      rows = withCriterion(rows, `c${i}`, SINGLE, undefined, `t${i}`).criteria;
    }
    expect(rows).toHaveLength(MAX_CRITERIA);
    expect(rows[0]?.criterion).toBe("c3");
  });

  it("clears a colour by removing the key rather than storing a null", () => {
    const [cleared] = withColour([row({ colour: 2 })], "spya-aaaaaa", null);
    expect(cleared && "colour" in cleared).toBe(false);
  });

  it("refuses a colour neither store would write", () => {
    expect(() => withColour([row()], "spya-aaaaaa", 1.5)).toThrow();
    expect(() => withColour([row()], "spya-aaaaaa", -1)).toThrow();
  });
});

/* ------------------------------------------------------ the files, alone -- */

describe("the filesystem store", () => {
  beforeEach(() => rm(DIR, { recursive: true, force: true }));
  afterEach(() => rm(DIR, { recursive: true, force: true }));

  /**
   * **The second half of the headline journey.** −80 has to be −80 after a
   * round trip through JSON on disk, because the failure the plan predicts is
   * silent at every step: nothing errors, the row reads back, and the panel
   * shows "counts neither way" for a passage the model said counts heavily
   * against.
   */
  it("a negative valence survives being written and read back", async () => {
    const begun = await beginCriterion(SLUG, "Are the controls adequate?", DIVERGING);
    await finishCriterion(SLUG, begun.id, { status: "done", results: [NEGATIVE], model: "m" });

    const back = await loadCriteria(SLUG);
    const stored = back[0]?.results[0];
    expect(stored?.kind).toBe("diverging");
    if (stored?.kind === "diverging") expect(stored.valence).toBe(-80);

    // And in the bytes on disk, not only in what the loader handed back.
    const raw = await readFile(path.join(DIR, "referee-criteria.json"), "utf8");
    expect(raw).toContain('"valence": -80');
  });

  it("keeps the poles and the scale across a write", async () => {
    const begun = await beginCriterion(SLUG, "Controls?", DIVERGING);
    await finishCriterion(SLUG, begun.id, { status: "done", results: [] });
    const back = await loadCriteria(SLUG);
    expect(back[0]?.config).toEqual(DIVERGING);
  });

  it("never lets a finish change the question it is answering", async () => {
    const begun = await beginCriterion(SLUG, "Controls?", DIVERGING);
    await finishCriterion(SLUG, begun.id, {
      status: "done",
      results: [],
      criterion: "something else",
      config: SINGLE,
    } as Partial<SavedCriterion>);
    const back = await loadCriteria(SLUG);
    expect(back[0]?.criterion).toBe("Controls?");
    expect(back[0]?.config).toEqual(DIVERGING);
  });

  it("does not resurrect a row deleted while the model was thinking", async () => {
    const begun = await beginCriterion(SLUG, "Controls?", SINGLE);
    await deleteCriterion(SLUG, begun.id);
    await finishCriterion(SLUG, begun.id, { status: "done", results: [] });
    expect(await loadCriteria(SLUG)).toEqual([]);
  });

  it("recolours a row, and ignores an id that names nothing", async () => {
    const begun = await beginCriterion(SLUG, "Controls?", SINGLE);
    await recolourCriterion(SLUG, begun.id, 4);
    expect((await loadCriteria(SLUG))[0]?.colour).toBe(4);
    await recolourCriterion(SLUG, "spya-nobody", 2);
    expect(await loadCriteria(SLUG)).toHaveLength(1);
  });

  it("sweeps a pending row this process is no longer running", async () => {
    const begun = await beginCriterion(SLUG, "Controls?", SINGLE);
    const swept = await fsRefereeCriteriaStore.sweepPending(SLUG, {
      keep: new Set<string>(),
      graceMs: 0,
    });
    expect(swept.find((c) => c.id === begun.id)?.status).toBe("error");
  });

  it("leaves a pending row this process IS running alone", async () => {
    const begun = await beginCriterion(SLUG, "Controls?", SINGLE);
    const kept = await fsRefereeCriteriaStore.sweepPending(SLUG, {
      keep: new Set([begun.id]),
      graceMs: 0,
    });
    expect(kept.find((c) => c.id === begun.id)?.status).toBe("pending");
  });
});

/* ------------------------------------------------------------- parity ---- */

/* `pgReady` warns loudly for us when there is no database — a skipped test
   protects nothing, so the run has to say "skipped" rather than "passed". */
const { reachable } = await pgReady({
  suite: "tests/referee-criteria-store.test.ts",
  tables: ["spideryarn.referee_criteria"],
});
const when = reachable ? describe : describe.skip;

when("the two stores answer identically", () => {
  const PSLUG = "test-referee-criteria-parity";
  const PDIR = path.resolve(import.meta.dirname, "..", "data", PSLUG);
  const ARTICLE_ID = "00000000-0000-4000-8000-0000000rc001".replace("r", "a").replace("c", "b");
  const REVISION_ID = "00000000-0000-4000-8000-0000000ab002";

  /**
   * **A real article on BOTH sides**, which is the whole point of the fixture.
   *
   * The first version of this gave Postgres an article with no revision and the
   * filesystem a directory with no blocks, and `sourceHash` was the first field
   * to notice: one store hashed an empty list and the other had nothing to hash.
   * Neither store was wrong; the fixture was. The alternative — excluding
   * `sourceHash` from the comparison — removes the divergence by removing the
   * check. tests/store-reader-state-parity.test.ts arrived at the same fixture
   * for the same reason, and this is that one, narrowed to what criteria need.
   */
  const BLOCKS = [
    {
      id: "spya-parqty",
      tag: "p",
      kind: "text",
      text: "We ran no negative control.",
      words: 5,
      html: "<p>We ran no negative control.</p>",
      gistable: true,
    },
  ] as const;

  beforeEach(async () => {
    const db = getDb();
    await db.delete(articles).where(eq(articles.slug, PSLUG));
    await db.insert(articles).values({ id: ARTICLE_ID, ownerId: currentOwnerId(), slug: PSLUG });
    // No `ownerId` on a revision — ownership lives on `articles`, and a revision
    // is reached through its article.
    await db.insert(articleRevisions).values({
      id: REVISION_ID,
      articleId: ARTICLE_ID,
      status: "published",
    });
    /* The ids exist as identities first: `revision_blocks` has a foreign key
       onto `block_identities`, which is the spine enforcing itself.
       docs/project/block-ids.md. */
    await db
      .insert(blockIdentities)
      .values(BLOCKS.map((b) => ({ articleId: ARTICLE_ID, blockId: b.id })));
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
    await db
      .update(articles)
      .set({ currentRevisionId: REVISION_ID })
      .where(eq(articles.id, ARTICLE_ID));

    await rm(PDIR, { recursive: true, force: true });
    await mkdir(PDIR, { recursive: true });
    await writeFile(path.join(PDIR, "blocks.json"), JSON.stringify({ blocks: BLOCKS }), "utf8");
    /* `tree.json` too: `hashDir` in src/searches.ts requires it before it will
       hash a directory, for the same reason `articleDir` does. */
    await writeFile(
      path.join(PDIR, "tree.json"),
      JSON.stringify({ rootId: BLOCKS[0].id, nodes: {} }),
      "utf8",
    );
  });

  afterAll(async () => {
    await getDb().delete(articles).where(eq(articles.slug, PSLUG));
    await closeDb();
    await rm(PDIR, { recursive: true, force: true });
  });

  /** The wire form — what `src/routes.ts` would send — with the id normalised. */
  const wire = (rows: SavedCriterion[]) =>
    JSON.parse(JSON.stringify(rows)).map((r: SavedCriterion) => ({ ...r, id: "#0" }));

  it("walks one criterion through begin, finish, fail, retry, finish, delete", async () => {
    const stores = [
      ["files", fsRefereeCriteriaStore],
      ["postgres", pgRefereeCriteriaStore],
    ] as const;
    const now = () => "2026-09-01T00:00:00.000Z";
    const seen: Record<string, unknown[]> = { files: [], postgres: [] };

    for (const [name, store] of stores) {
      const trace: unknown[] = [];
      const first = await store.begin(PSLUG, "Are the controls adequate?", DIVERGING, undefined, now);
      trace.push(wire([first.row]));

      await store.finish(PSLUG, first.row.id, { status: "error", error: "boom" }, first.attempt);
      trace.push(wire(await store.load(PSLUG)));

      /* The retry: the same id, the same criterion, a row that failed. Both
         stores must reset rather than mint, and both must clear the error. */
      const again = await store.begin(
        PSLUG,
        "Are the controls adequate?",
        DIVERGING,
        first.row.id,
        now,
      );
      expect(again.row.id).toBe(first.row.id);
      trace.push(wire([again.row]));

      await store.finish(
        PSLUG,
        again.row.id,
        { status: "done", results: [NEGATIVE], model: "m" },
        again.attempt,
      );
      trace.push(wire(await store.load(PSLUG)));

      await store.recolour(PSLUG, again.row.id, 5);
      trace.push(wire(await store.load(PSLUG)));

      trace.push(wire(await store.remove(PSLUG, again.row.id)));
      seen[name] = trace;
    }

    expect(seen.postgres).toEqual(seen.files);
  });

  it("both stores hand back a valence of −80 rather than 0", async () => {
    for (const store of [fsRefereeCriteriaStore, pgRefereeCriteriaStore]) {
      const begun = await store.begin(PSLUG, "Controls?", DIVERGING);
      await store.finish(PSLUG, begun.row.id, { status: "done", results: [NEGATIVE] }, begun.attempt);
      const back = await store.load(PSLUG);
      const stored = back.find((c) => c.id === begun.row.id)?.results[0];
      expect(stored?.kind).toBe("diverging");
      if (stored?.kind === "diverging") expect(stored.valence).toBe(-80);
      await store.remove(PSLUG, begun.row.id);
    }
  });

  it("refuses a bad colour the same way on both sides — a 400, not a store failure", async () => {
    for (const store of [fsRefereeCriteriaStore, pgRefereeCriteriaStore]) {
      await expect(store.recolour(PSLUG, "spya-aaaaaa", 1.5)).rejects.toMatchObject({ status: 400 });
    }
  });
});
