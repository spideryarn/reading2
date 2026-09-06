/**
 * Reading a fixture's `glossary-lookups.json` — what is left of
 * `src/glossary-lookups.ts`.
 *
 * **This file used to be the lookup sidecar's own suite.** `saveLookup` went on
 * 2026-09-05 with the rest of the filesystem store
 * (docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md,
 * the stage-G section); `loadLookups` did not, because
 * `tests/helpers/seed-reader-state.ts` still reads a fixture's file through it
 * to seed `glossary_lookups` rows.
 *
 * **Where the eight went:**
 *
 * - **Already in `tests/store-lookups-pg.test.ts`**: the round trip keyed by
 *   entry id, replacing a term's own answer, the empty-not-absent read, and the
 *   non-slug refusal.
 * - **Abolished rather than dropped**, because they were properties of one JSON
 *   file rewritten whole: *"does not lose the first of two lookups started
 *   together"* (the per-process queue — Postgres writes one row, and
 *   § *leaves every other term alone* is the stronger claim), *"refuses to write
 *   over a file it could not read"* and *"leaves no temp file behind"* (there is
 *   no whole-file rewrite to be caught half-done).
 *
 * The argument the old header made — that reader-initiated state must not live
 * inside a pipeline artefact — is unchanged and now lives in the module's own
 * docstring, because it still decides the shape of the table.
 *
 * The module resolves `data/<slug>` against `process.cwd()`, so these write real
 * directories under the repo's own `data/` and remove them afterwards.
 */
import { afterAll, describe, expect, it } from "vitest";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadLookups } from "../src/glossary-lookups.js";
import type { GlossaryLookup } from "../src/types.js";

const slugs: string[] = [];
afterAll(async () => {
  for (const slug of slugs) {
    await rm(path.join(process.cwd(), "data", slug), { recursive: true, force: true });
  }
});

let n = 0;
function scratchSlug(): string {
  const slug = `zz-test-lookups-${process.pid}-${n++}`;
  slugs.push(slug);
  return slug;
}

const lookup = (answer: string): GlossaryLookup => ({
  answer,
  citations: [{ url: "https://example.com/a", title: "A" }],
  searches: 1,
  model: "a-model",
  at: "2026-08-26T00:00:00.000Z",
});

async function writeLookups(slug: string, body: string): Promise<void> {
  const dir = path.join(process.cwd(), "data", slug);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "glossary-lookups.json"), body, "utf8");
}

describe("reading a glossary-lookups.json", () => {
  it("is empty for an article nobody has checked a term on", async () => {
    // The ordinary case, not a fault. Most articles have had no term checked,
    // and a seeder that threw on one could not seed most of a corpus.
    expect(await loadLookups(scratchSlug())).toEqual({});
  });

  it("reads back the lookups, keyed by entry id", async () => {
    const slug = scratchSlug();
    await writeLookups(slug, JSON.stringify({ lookups: { "spya-k3m9qt": lookup("Who they are.") } }));
    const back = await loadLookups(slug);
    expect(back["spya-k3m9qt"]?.answer).toBe("Who they are.");
    expect(back["spya-k3m9qt"]?.citations).toEqual([{ url: "https://example.com/a", title: "A" }]);
  });

  it("treats an unreadable file as no lookups rather than as a failure", async () => {
    /* Deliberately unlike `glossary.json`, whose unreadability the panel
       reports as "nobody has found the terms yet". This is a side file the
       glossary does not need: a bad one must cost the reader their lookups, not
       their glossary. It is also the one place `parseJsonFrom` is reached with a
       model's prose about the article — tests/parse-json.test.ts is where that
       matters. */
    const slug = scratchSlug();
    await writeLookups(slug, "{ truncated");
    expect(await loadLookups(slug)).toEqual({});
  });

  it("refuses a slug that is not one", async () => {
    // Path traversal, refused before the read rather than after it — see
    // docs/project/security.md.
    await expect(loadLookups("../../etc")).rejects.toThrow(/valid slug/);
  });
});
