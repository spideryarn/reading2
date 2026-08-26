/**
 * The lookup sidecar — src/glossary-lookups.ts.
 *
 * This file exists because review caught the plan putting reader-initiated
 * state inside a pipeline artefact. `glossary.json` is written by one stage
 * with a bare `writeFile`, and that stage holds its read across a ninety-second
 * model call — so a second writer cannot be made safe by any in-process lock,
 * and a crash mid-write leaves JSON that `readGlossary` swallows into `null`,
 * which the panel then reports as "nobody has found the terms for this one
 * yet". The reader's whole glossary, gone, silently.
 *
 * What is tested here is the part that has a right answer: the file round-trips,
 * a second lookup does not eat the first, and a missing file is the ordinary
 * case rather than a fault.
 */
import { afterAll, describe, expect, it } from "vitest";
import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadLookups, saveLookup } from "../src/glossary-lookups.js";
import type { GlossaryLookup } from "../src/types.js";

/* The module resolves `data/<slug>` against `process.cwd()`, so a test slug is
   a real directory under the repo's own data/. Named with a prefix nothing else
   uses, and removed afterwards. */
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

describe("glossary lookups", () => {
  it("is empty for an article nobody has checked a term on", async () => {
    // The ordinary case, not a fault. Most articles have had no term checked,
    // and a missing file must not make the glossary itself look broken.
    expect(await loadLookups(scratchSlug())).toEqual({});
  });

  it("round-trips one lookup, keyed by entry id", async () => {
    const slug = scratchSlug();
    await saveLookup(slug, "spya-k3m9qt", lookup("Who they are."));
    const back = await loadLookups(slug);
    expect(back["spya-k3m9qt"]?.answer).toBe("Who they are.");
    expect(back["spya-k3m9qt"]?.citations).toEqual([{ url: "https://example.com/a", title: "A" }]);
  });

  it("does not lose the first of two lookups started together", async () => {
    /* The failure `serialised` exists for, and the reason it is copied from
       src/comments.ts rather than reinvented: without the chain the second read
       starts before the first write lands, and the first answer vanishes with
       no error anywhere, because both writes succeeded. */
    const slug = scratchSlug();
    await Promise.all([
      saveLookup(slug, "spya-aaaaaa", lookup("First.")),
      saveLookup(slug, "spya-bbbbbb", lookup("Second.")),
    ]);
    const back = await loadLookups(slug);
    expect(Object.keys(back).sort()).toEqual(["spya-aaaaaa", "spya-bbbbbb"]);
  });

  it("replaces a term's own lookup and leaves the others alone", async () => {
    const slug = scratchSlug();
    await saveLookup(slug, "spya-aaaaaa", lookup("Old."));
    await saveLookup(slug, "spya-bbbbbb", lookup("Other."));
    await saveLookup(slug, "spya-aaaaaa", lookup("New."));
    const back = await loadLookups(slug);
    expect(back["spya-aaaaaa"]?.answer).toBe("New.");
    expect(back["spya-bbbbbb"]?.answer).toBe("Other.");
  });

  it("treats an unreadable file as no lookups rather than as a failure", async () => {
    /* Deliberately unlike `glossary.json`, whose unreadability the panel
       reports as "nobody has found the terms yet". This is a side file the
       glossary does not need: a bad one must cost the reader their lookups, not
       their glossary. */
    const slug = scratchSlug();
    await saveLookup(slug, "spya-aaaaaa", lookup("Fine."));
    const file = path.join(process.cwd(), "data", slug, "glossary-lookups.json");
    await writeFile(file, "{ truncated", "utf8");
    expect(await loadLookups(slug)).toEqual({});
  });

  it("refuses to write over a file it could not read", async () => {
    /* The second half of the corrupt-file story, and the dangerous half. The
       read degrades to `{}` so a bad side file does not cost the reader their
       glossary — and a write that merged into that `{}` and renamed it over the
       top would then discard every answer they had paid for, at the moment they
       were least likely to notice, because the lookup they just asked for
       appears exactly as expected. Found in review. */
    const slug = scratchSlug();
    await saveLookup(slug, "spya-aaaaaa", lookup("Paid for."));
    const file = path.join(process.cwd(), "data", slug, "glossary-lookups.json");
    await writeFile(file, "{ truncated", "utf8");
    await expect(saveLookup(slug, "spya-bbbbbb", lookup("New."))).rejects.toThrow(/could not be read/);
    // And the unreadable file is left exactly as it was, to be recovered.
    expect(await readFile(file, "utf8")).toBe("{ truncated");
  });

  it("leaves no temp file behind", async () => {
    // The write is temp-then-rename, so a crash cannot leave a half-file where
    // the real one was. A successful write must not leave the neighbour either.
    const slug = scratchSlug();
    await saveLookup(slug, "spya-aaaaaa", lookup("Fine."));
    const dir = path.join(process.cwd(), "data", slug);
    expect((await readdir(dir)).filter((f) => f.includes(".tmp"))).toEqual([]);
  });

  it("refuses a slug that is not one", async () => {
    // Path traversal, refused where src/comments.ts refuses it and for the same
    // reason — see docs/project/security.md.
    await expect(saveLookup("../../etc", "spya-aaaaaa", lookup("x"))).rejects.toThrow(/valid slug/);
  });
});
