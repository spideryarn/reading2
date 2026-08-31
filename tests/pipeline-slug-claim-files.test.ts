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
/* Same reason, and the same `await`: `freeUploadSlug` reaches `slugIsSpokenFor`,
   which asks the artefact store, which reads `STORE`. */
const { freeUploadSlug } = await import("../src/jobs.js");

const WITH_URL = "test-files-slug-claim";
const UPLOADED = "test-files-slug-claim-upload";
const URL = "https://example.test/files-slug-claim";
/** A slug an upload has already taken — see the last describe in this file. */
const CLAIMED = "test-files-slug-claim-paper";

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

  /**
   * **An upload getting its own slug back on a retry, which nothing tested.**
   *
   * `slugIsSpokenFor` (src/jobs.ts) asks `articleExists` and then reads the
   * `fetch` manifest, and the manifest read is the entire content of the `mine`
   * argument: without it, retrying a job whose `paper.pdf` already reached
   * stage 3 finds `data/paper/` occupied — by itself — steps aside to
   * `paper-2`, re-runs from the top, and pays for the transcription again.
   *
   * That was unguarded until 2026-08-31. `tests/uploads-api.test.ts` injects a
   * fake `claimed`, and `tests/pipeline-slug-claim-files.test.ts` never called
   * `freeUploadSlug` at all — so replacing the manifest read with a literal
   * `null` left both green. Found by making exactly that mutation.
   *
   * The two cases are one property said twice, and neither is worth having
   * alone: the same fixture must be *mine* for one upload id and *somebody
   * else's* for another. A test with only the first passes if the function
   * always says free; a test with only the second passes if it always says
   * taken.
   */
  describe("an uploaded article's own slug", () => {
    const OWNER = "upload-that-owns-it";

    beforeAll(async () => {
      const dir = path.join(scratch, "data", CLAIMED);
      await mkdir(dir, { recursive: true });
      await writeFile(
        path.join(dir, "meta.json"),
        JSON.stringify({ slug: CLAIMED, title: "paper.pdf" }),
        "utf8",
      );
      /* Through `PATHS.fetch.raw`'s filename rather than a spelling of our own:
         from 2026-08-31 the artefact store is what writes this file, and the
         read under test goes through the same store. */
      await writeFile(
        path.join(dir, "raw.json"),
        JSON.stringify({
          kind: "pdf",
          file: "raw.pdf",
          origin: "upload",
          uploadId: OWNER,
          bytes: 1,
          sha256: "0".repeat(64),
          fetchedAt: new Date().toISOString(),
        }),
        "utf8",
      );
    });

    it("comes back to the upload that made it, so a retry costs nothing", async () => {
      expect(await freeUploadSlug(CLAIMED, OWNER)).toBe(CLAIMED);
    });

    it("and is stepped around by any other upload of the same filename", async () => {
      expect(await freeUploadSlug(CLAIMED, "some-other-upload")).toBe(`${CLAIMED}-2`);
    });
  });
});
