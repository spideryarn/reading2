/**
 * Shelf state — archive, rename, count an open (src/shelf.ts), and what the
 * shelf does with it (`listArticles`).
 *
 * Runs against real files under `data/`, which is gitignored, because that is
 * what the code under test actually reads. Each test builds its own throwaway
 * article and removes it afterwards.
 *
 * **The test worth reading first is "survives a re-extraction".** The whole
 * reason a renamed title is an override in `shelf.json` rather than an edit to
 * `meta.json` is that stage 2 rewrites `meta.json` on every run — so a rename
 * stored there would work perfectly, and be silently undone weeks later. That
 * test is the guard, and it fails if anybody "tidies" the override away.
 */
import { cp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listArticles } from "../src/api.js";
import { loadShelf, recordOpen, setArchived, setTitle } from "../src/shelf.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const SLUG = "test-shelf-fixture";
const DIR = path.join(ROOT, "data", SLUG);
const EXAMPLE = path.join(ROOT, "example");

/** A complete-enough article: the fixture's artefacts under a throwaway slug. */
async function makeArticle(): Promise<void> {
  await cp(EXAMPLE, DIR, { recursive: true });
}

afterEach(() => rm(DIR, { recursive: true, force: true }));

describe("shelf state", () => {
  it("is empty, not an error, for an article nobody has touched", async () => {
    expect(await loadShelf(SLUG)).toEqual({ opens: 0 });
  });

  it("archives and un-archives", async () => {
    const archived = await setArchived(SLUG, true);
    expect(archived.archivedAt).toBeTruthy();
    expect(await loadShelf(SLUG)).toEqual(archived);

    const back = await setArchived(SLUG, false);
    expect(back.archivedAt).toBeUndefined();
  });

  it("keeps the original date when archiving something already archived", async () => {
    // Undo is one click away, and pressing Delete twice must not quietly reset
    // the clock on "when did I get rid of this".
    const first = await setArchived(SLUG, true, new Date("2026-01-01T00:00:00.000Z"));
    const second = await setArchived(SLUG, true, new Date("2026-06-01T00:00:00.000Z"));
    expect(second.archivedAt).toBe(first.archivedAt);
  });

  it("stores a title, and clears it on blank", async () => {
    expect((await setTitle(SLUG, "  My own name  ")).title).toBe("My own name");
    expect((await setTitle(SLUG, "   ")).title).toBeUndefined();
    expect((await setTitle(SLUG, "Again")).title).toBe("Again");
    expect((await setTitle(SLUG, null)).title).toBeUndefined();
  });

  it("refuses a title longer than the cap", async () => {
    await expect(setTitle(SLUG, "x".repeat(400))).rejects.toThrow(/characters or fewer/);
  });

  it("counts opens and remembers the last one", async () => {
    await recordOpen(SLUG, new Date("2026-01-01T00:00:00.000Z"));
    const state = await recordOpen(SLUG, new Date("2026-02-02T00:00:00.000Z"));
    expect(state.opens).toBe(2);
    expect(state.lastOpenedAt).toBe("2026-02-02T00:00:00.000Z");
  });

  it("does not lose a write when two happen at once", async () => {
    /* The read-modify-write is serialised per process, and this is why: without
       the chain the second read starts before the first write lands, and one of
       the two opens silently does not happen — with both reporting success. */
    await Promise.all(Array.from({ length: 10 }, () => recordOpen(SLUG)));
    expect((await loadShelf(SLUG)).opens).toBe(10);
  });

  it("keeps archived and renamed independent of each other", async () => {
    await setTitle(SLUG, "Renamed");
    await setArchived(SLUG, true);
    const state = await loadShelf(SLUG);
    expect(state.title).toBe("Renamed");
    expect(state.archivedAt).toBeTruthy();
  });
});

describe("the shelf reads it", () => {
  it("prefers the reader's title over the extractor's", async () => {
    await makeArticle();
    const before = (await listArticles()).find((a) => a.slug === SLUG);
    expect(before).toBeDefined();
    expect(before?.titleOverridden).toBeUndefined();

    await setTitle(SLUG, "What I call it");
    const after = (await listArticles()).find((a) => a.slug === SLUG);
    expect(after?.title).toBe("What I call it");
    expect(after?.titleOverridden).toBe(true);
  });

  it("survives a re-extraction rewriting meta.json", async () => {
    /* **The test this file exists for.** Stage 2 rewrites meta.json on every
       run, so a renamed title stored THERE would be silently undone by the next
       `npm run extract` — a bug that reports success and comes back weeks
       later. The override lives in shelf.json, so this passes. */
    await makeArticle();
    await setTitle(SLUG, "What I call it");

    const metaFile = path.join(DIR, "meta.json");
    const meta = JSON.parse(await readFile(metaFile, "utf8"));
    await writeFile(metaFile, JSON.stringify({ ...meta, title: "Whatever the site calls it" }));

    const entry = (await listArticles()).find((a) => a.slug === SLUG);
    expect(entry?.title).toBe("What I call it");
  });

  it("takes an archived article off the shelf and puts it in the other half", async () => {
    await makeArticle();
    expect((await listArticles()).some((a) => a.slug === SLUG)).toBe(true);

    await setArchived(SLUG, true);
    expect((await listArticles()).some((a) => a.slug === SLUG)).toBe(false);
    expect((await listArticles({ archived: true })).some((a) => a.slug === SLUG)).toBe(true);

    await setArchived(SLUG, false);
    expect((await listArticles()).some((a) => a.slug === SLUG)).toBe(true);
  });

  it("carries opens and the built-artefact flags onto the entry", async () => {
    await makeArticle();
    await recordOpen(SLUG);
    const entry = (await listArticles()).find((a) => a.slug === SLUG);
    expect(entry?.opens).toBe(1);
    expect(entry?.lastOpenedAt).toBeTruthy();
    // The fixture has an arc but no thread, glossary or summaries.
    expect(entry?.has.arc).toBe(true);
    expect(entry?.has.tweets).toBe(false);
  });

  it("refuses a slug that is not a slug, rather than sanitising it", async () => {
    await expect(loadShelf("../../etc/passwd")).rejects.toThrow(/Not a valid slug/);
    await expect(setArchived("..", true)).rejects.toThrow(/Not a valid slug/);
  });
});
