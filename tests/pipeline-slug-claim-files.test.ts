/**
 * **The other half of tests/pipeline-slug-claim.test.ts: with `SPIDERYARN_STORE`
 * unset, both functions still answer from `data/<slug>/meta.json`.**
 *
 * A laptop running the filesystem store must behave exactly as it did before
 * the Postgres branch existed, and "exactly as before" is the kind of claim
 * that goes unchecked because nobody has a reason to doubt it.
 *
 * Two files rather than two describes, because `STORE` is read once at module
 * load (src/store/live.ts) and one module therefore cannot see both stores.
 *
 * ## Why the fixtures are in a temp tree
 *
 * `SPIDERYARN_DATA_ROOT` (src/store/data-root.ts) is the override made for
 * exactly this. Writing `data/test-…/` into the repository instead would put a
 * stranger on the shelf for as long as the fixture lived, and `listArticles`
 * enumerates that directory — tests/pipeline-artifact-store.test.ts has the
 * story of three unrelated suites going red only when the whole run happened
 * together.
 *
 * It is also the reason these two functions no longer resolve `data/` from a
 * module-scope `path.resolve(import.meta.dirname, "..")`. That constant is the
 * bug src/store/data-root.ts was written to end: it is the repository root on a
 * laptop and `/var` inside the Vercel bundle, and it ignores the override that
 * every other filesystem path in the pipeline honours — including
 * `contextPaths`, which `slugIsSpokenFor` (src/jobs.ts) calls one line after
 * `articleExists`. The two now agree about where `data/` is.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

/** Unset means `files` — src/store/live.ts § `storeFromEnv`. */
delete process.env.SPIDERYARN_STORE;

/**
 * Imported here rather than inside each test, and the `await` is the point:
 * `STORE` is a module-load constant, so this import must happen *after* the
 * line above and cannot be a hoisted static import. Doing it once at module
 * scope also keeps the cost of loading the whole pipeline graph — every stage,
 * every model client — out of the first test's five-second budget, which is
 * what made it time out when this file ran alongside five others.
 */
const { articleExists, urlForSlug } = await import("../src/pipeline.js");

const WITH_URL = "test-files-slug-claim";
const UPLOADED = "test-files-slug-claim-upload";
const URL = "https://example.test/files-slug-claim";

describe("the filesystem store still answers from meta.json", () => {
  let scratch = "";
  let before: string | undefined;

  beforeAll(async () => {
    scratch = await mkdtemp(path.join(tmpdir(), "spya-slug-claim-files-"));
    before = process.env.SPIDERYARN_DATA_ROOT;
    process.env.SPIDERYARN_DATA_ROOT = scratch;

    for (const [slug, meta] of [
      [WITH_URL, { slug: WITH_URL, title: "A fetched page", url: URL }],
      [UPLOADED, { slug: UPLOADED, title: "A file somebody uploaded" }],
    ] as const) {
      const dir = path.join(scratch, "data", slug);
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, "meta.json"), JSON.stringify(meta), "utf8");
    }
  });

  afterAll(async () => {
    if (before === undefined) delete process.env.SPIDERYARN_DATA_ROOT;
    else process.env.SPIDERYARN_DATA_ROOT = before;
    if (scratch) await rm(scratch, { recursive: true, force: true });
  });

  it("finds an article whose meta.json is on disk", async () => {
    expect(await articleExists(WITH_URL)).toBe(true);
  });

  it("reads the URL out of it", async () => {
    expect(await urlForSlug(WITH_URL)).toBe(URL);
  });

  /**
   * **The distinction the two functions exist to keep**, and the reason
   * `freeUploadSlug` asks `articleExists` rather than `urlForSlug`: an upload
   * has no URL, so `undefined` from `urlForSlug` must not read as "no article".
   */
  it("still knows an uploaded article is there, with no URL in it", async () => {
    expect(await articleExists(UPLOADED)).toBe(true);
    expect(await urlForSlug(UPLOADED)).toBeUndefined();
  });

  it("and says nothing is there when nothing is", async () => {
    expect(await articleExists("test-files-slug-claim-absent")).toBe(false);
    expect(await urlForSlug("test-files-slug-claim-absent")).toBeUndefined();
  });
});
