/**
 * **The `illustrated` artefact through the real Postgres write path, and back
 * out of `loadIllustrated`.**
 *
 * The registration is exercised on the filesystem by
 * tests/illustrated-step-registration.test.ts. This file exists because that is
 * not enough, and the repo has already shipped one feature broken for exactly
 * this reason: a stage exercised only on files is a stage whose column, whose
 * projection and whose read policy have never run. Three things here can only
 * be wrong in Postgres —
 *
 *  - **the column**, `article_revisions.illustrated`, and whether `STORAGE`
 *    points at it;
 *  - **the projection**, and whether `REVISION_READ_POLICY` grants
 *    `loadIllustrated` the `sketch` column it needs. This one is the reason the
 *    file is worth its length: this read is the only one in the store that
 *    compares its artefact with *another artefact's* column, so a projection
 *    that took only its own would answer `stale` on every article that has an
 *    illustration, for ever, with nothing going red;
 *  - **the carry**, and whether a new draft inherits the plates.
 *
 * `SPIDERYARN_STORE` is not consulted here: this file talks to
 * `pgArticleReader` directly, which is the store the app uses when that
 * variable says `postgres`.
 *
 * Skips loudly when there is no database, for the reason
 * tests/db-schema.test.ts explains at length.
 */
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { eq } from "drizzle-orm";

import { closeDb, getDb } from "../src/db/client.js";
import { articles, jobs } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { inputFingerprint as illustratedFingerprint } from "../src/illustrated.js";
import type { Illustrated } from "../src/illustrated-plate.js";
import { inputFingerprint as sketchFingerprint } from "../src/sketch.js";
import type { Sketch } from "../src/sketch-scene.js";
import type { Block, Meta, Tree } from "../src/types.js";
import { pgArticleReader } from "../src/store/pg.js";
import { loadArticleIntoPg } from "./helpers/load-article.js";
import { FIXTURE_ROOT, requireFixture } from "./helpers/require-fixture.js";
import { pgReady } from "./helpers/pg-ready.js";
import { takeRunLock } from "./helpers/run-lock.js";

loadEnvLocal();

const ROOT = path.resolve(import.meta.dirname, "..");
const FROM = "writes";
const SLUG = "test-illustrated-pg";

requireFixture(FROM, [
  "raw.json",
  "meta.json",
  "blocks.json",
  "tree.json",
  "labels.json",
  "output.html",
  "output.blocks.json",
]);

const { reachable } = await pgReady({
  suite: "tests/illustrated-pg.test.ts",
  tables: ["spideryarn.article_revisions"],
});
const when = reachable ? describe : describe.skip;

/** This file starts a job, so it takes the shared run lock. */
const runLock = reachable ? await takeRunLock("tests/illustrated-pg.test.ts") : undefined;

/**
 * **Remove the rows as well as the files, before every case.**
 *
 * `illustrated` carries into a new draft (`REVISION_CARRY_POLICY`), so a case
 * that reused the published revision from the case before it would read the
 * *previous* fixture's plates back and pass whatever this one wrote — the
 * failure tests/helpers/load-article.ts warns about by name, and it faked two
 * results here before this hook existed.
 */
async function forget(): Promise<void> {
  await rm(path.join(ROOT, "data", SLUG), { recursive: true, force: true });
  await rm(path.join(ROOT, "output", `${SLUG}.html`), { force: true });
  await rm(path.join(ROOT, "output", `${SLUG}.blocks.json`), { force: true });
  if (!reachable) return;
  const db = getDb();
  await db.delete(jobs).where(eq(jobs.slug, SLUG));
  await db.update(articles).set({ currentRevisionId: null }).where(eq(articles.slug, SLUG));
  await db.delete(articles).where(eq(articles.slug, SLUG));
}

beforeEach(forget);
afterAll(async () => {
  await runLock?.release();
  await forget();
  await closeDb();
});

/* ------------------------------------------------------------ the fixture -- */

/**
 * **`sourceHash` is the real one, computed from the fixture's own blocks and
 * tree**, not a placeholder.
 *
 * It has to be. `loadIllustrated` reports `stale` when the Sketch has gone
 * stale as well as when the plates have, so a Sketch carrying an invented hash
 * makes every case here read stale for a reason that has nothing to do with the
 * thing under test — which is how the first draft of this file "passed" its
 * negative control and failed its positive one.
 */
function sketchFixture(
  fingerprint: string,
  title = "Two arguments, one conclusion",
): Sketch {
  return {
    version: "sketch/1",
    generator: "claude-opus-5",
    slug: SLUG,
    sourceHash: fingerprint,
    profileHash: null,
    title,
    caption: "What the piece argues, in two moves.",
    scenes: [
      {
        id: "overview",
        title: "The whole argument",
        height: 600,
        items: [
          { kind: "node", id: "n1", shape: "box", x: 10, y: 10, w: 100, h: 40, text: "The claim", size: "md" },
        ],
      },
    ],
  } as Sketch;
}

/**
 * An illustration stamped against a given Sketch, with one plate that has a
 * picture and one whose call failed.
 *
 * **Both states, because the column has to carry both.** A run that keeps the
 * plates it paid for and records the failure on the one it did not is the whole
 * of the v1 orphan policy, and a JSONB round-trip that dropped `failed` — or,
 * worse, dropped `image` — would leave the panel unable to say which picture is
 * missing.
 */
function illustratedFor(sketch: Sketch): Illustrated {
  return {
    version: "illustrated/1",
    generator: "claude-opus-5",
    illustrator: "openai/gpt-image-2",
    slug: SLUG,
    sourceHash: illustratedFingerprint(sketch),
    profileHash: null,
    style: "An illuminated manuscript page, because the essay's own idiom is vellum and gold.",
    plates: [
      {
        sceneId: "overview",
        title: "The whole argument",
        prompt: "A single vellum page, top to bottom, with the claim at its head.",
        vignettes: [],
        image: { sha256: "a1".repeat(32), ext: "jpeg", bytes: 159_513, width: 1024, height: 1536 },
      },
      {
        sceneId: "inside",
        title: "Inside the claim",
        prompt: "The same hand, one panel, the evidence beneath the claim.",
        vignettes: [],
        failed: "the images endpoint answered with no picture in it",
      },
    ],
  } as Illustrated;
}

/**
 * Clone the corpus article under a test slug, and drop a Sketch and an
 * illustration into it before it is loaded.
 *
 * The two artefacts are written as files rather than generated, for the reason
 * tests/store-artefacts-pg.test.ts gives about its own fixtures: a literal
 * cannot agree with a bug in the code it is checking. What is on trial here is
 * the trip through the database, not the stage.
 */
async function makeFixture(
  build: (fingerprint: string) => { sketch: Sketch; illustrated: Illustrated },
): Promise<string> {
  const dir = path.join(ROOT, "data", SLUG);
  await rm(dir, { recursive: true, force: true });
  await cp(path.join(FIXTURE_ROOT, "data", FROM), dir, { recursive: true });

  for (const name of await readdir(dir)) {
    if (!name.endsWith(".json")) continue;
    const at = path.join(dir, name);
    const value: unknown = JSON.parse(await readFile(at, "utf8"));
    if (value && typeof value === "object" && (value as { slug?: string }).slug === FROM) {
      (value as { slug: string }).slug = SLUG;
      await writeFile(at, JSON.stringify(value, null, 2));
    }
  }
  /* `output/` is gitignored, so a fresh clone has no such directory yet. */
  await mkdir(path.join(ROOT, "output"), { recursive: true });
  await cp(
    path.join(FIXTURE_ROOT, "output", `${FROM}.html`),
    path.join(ROOT, "output", `${SLUG}.html`),
  );
  await cp(
    path.join(FIXTURE_ROOT, "output", `${FROM}.blocks.json`),
    path.join(ROOT, "output", `${SLUG}.blocks.json`),
  );
  /* Read back what was just written, so the fingerprint is over the same bytes
     the loader will put in the database. `SKETCH_PROMPT_VERSION` is not needed
     — `sketchIsStale` compares `sourceHash` alone. */
  const read = async <T>(name: string): Promise<T> =>
    JSON.parse(await readFile(path.join(dir, name), "utf8")) as T;
  const { blocks } = await read<{ blocks: Block[] }>("blocks.json");
  const tree = await read<Tree>("tree.json");
  const meta = await read<Meta>("meta.json");
  const { sketch, illustrated } = build(sketchFingerprint(blocks, tree, meta));

  await writeFile(path.join(dir, "sketch.json"), JSON.stringify(sketch, null, 2));
  await writeFile(path.join(dir, "illustrated.json"), JSON.stringify(illustrated, null, 2));
  return dir;
}

/* ---------------------------------------------------------------- the trip -- */

when("the illustrated artefact through Postgres", () => {
  it("survives the write path and comes back current", async () => {
    await makeFixture((fp) => {
      const sketch = sketchFixture(fp);
      return { sketch, illustrated: illustratedFor(sketch) };
    });
    await loadArticleIntoPg(SLUG, { root: ROOT });

    const found = await pgArticleReader.loadIllustrated(SLUG);
    const illustrated = found.illustrated as Illustrated;

    expect(illustrated.style).toMatch(/illuminated manuscript/);
    expect(illustrated.plates).toHaveLength(2);
    /* **Both plate states**, and the hash to the byte: a JSONB round trip that
       silently coerced a number or dropped a key would show up here rather than
       as a broken picture three screens away. */
    expect(illustrated.plates[0]?.image).toEqual({
      sha256: "a1".repeat(32),
      ext: "jpeg",
      bytes: 159_513,
      width: 1024,
      height: 1536,
    });
    expect(illustrated.plates[1]?.image).toBeUndefined();
    expect(illustrated.plates[1]?.failed).toMatch(/no picture in it/);

    /* **Not stale, and this is the assertion the projection has to earn.**
       Answering it needs the `sketch` column, which is another artefact's — a
       projection that took only `illustrated` would compute the fingerprint
       from nothing and report every illustration stale for ever. */
    expect(found.stale, "a fresh illustration must not read as stale").toBe(false);
    expect(found.outdated).toBe(false);
  }, 60_000);

  it("reads as stale when the Sketch on the revision is not the one it was painted from", async () => {
    /* **The negative control**, and it is the one that says the comparison is
       real rather than hard-coded `false`. Every block, every heading and every
       byte of the article is identical between the two runs; only the scene has
       changed. */
    await makeFixture((fp) => ({
      /* Both Sketches are current against the article; they differ from each
         other. So the only thing that can make this stale is the comparison
         under test. */
      sketch: sketchFixture(fp, "Three arguments, one conclusion"),
      illustrated: illustratedFor(sketchFixture(fp)),
    }));
    await loadArticleIntoPg(SLUG, { root: ROOT });

    const found = await pgArticleReader.loadIllustrated(SLUG);
    expect(found.stale, "an illustration of a superseded scene must read as stale").toBe(true);
  }, 60_000);

  it("404s for an article that has never been painted", async () => {
    const dir = await makeFixture((fp) => {
      const sketch = sketchFixture(fp);
      return { sketch, illustrated: illustratedFor(sketch) };
    });
    await rm(path.join(dir, "illustrated.json"));
    await loadArticleIntoPg(SLUG, { root: ROOT });

    await expect(pgArticleReader.loadIllustrated(SLUG)).rejects.toMatchObject({ status: 404 });
  }, 60_000);
});
