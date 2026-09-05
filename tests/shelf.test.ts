/**
 * Reading a fixture's `shelf.json` — what is left of `src/shelf.ts`.
 *
 * **This file used to be the filesystem shelf store's own suite**, and on
 * 2026-09-05 that store was deleted with the rest of the filesystem store
 * (docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md,
 * the stage-G section). `patchShelf`, `setArchived`, `setTitle` and `recordOpen`
 * went with it; `loadShelf` did not, because `tests/helpers/seed-reader-state.ts`
 * and `tests/store-parity.test.ts` still read a fixture's `data/<slug>/shelf.json`
 * through it to seed the columns Postgres keeps. That is a fixture reader, and
 * these three cases are what says it still reads.
 *
 * **Where the fourteen went, one by one**, because a deleted assertion leaves
 * nothing behind to go red:
 *
 * - **Ported into `tests/store-shelf-pg.test.ts` § the shelf's writes**, seven
 *   of them, because `pg-shelf.ts` re-states each rule and nothing was driving
 *   it: the title cap, blank-clears-the-title, and all four `purpose` rules
 *   (stored, cleared on blank, line endings settled, cap refused, absent key
 *   left alone), plus `lastOpenedAt`.
 * - **Already there**: archive and un-archive (§ *moves the article between the
 *   two halves*), the first archive date surviving a second Archive, title
 *   stored and cleared, both fields in one write, the bad slug.
 * - **Abolished rather than dropped**: *"does not lose a write when two happen
 *   at once"* was about the per-process queue in `src/shelf.ts`. Postgres
 *   computes `opens + 1` itself, and § *counts concurrent opens without losing
 *   any* is the stronger claim in its place.
 * - **Dropped, and named**: *"survives a re-extraction, like the title"*. On
 *   disk the hazard was real and specific — stage 2 rewrites `meta.json` on
 *   every run, so a title stored there would be silently undone weeks later. In
 *   Postgres the override is a column on `articles` and an extraction writes a
 *   *revision*, so the same accident cannot be spelled. The nearest live guard
 *   is § *renames, and the reading view agrees with the card*, which shows the
 *   override applied on top of whatever the current revision says. A full
 *   equivalent would have to publish a second revision, and nothing in that
 *   suite builds one.
 *
 * Runs against real files under `data/`, which is gitignored, because that is
 * what `loadShelf` reads. Each test builds its own throwaway article and
 * removes it afterwards.
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadShelf } from "../src/shelf.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const SLUG = "test-shelf-fixture";
const DIR = path.join(ROOT, "data", SLUG);

async function writeShelf(state: unknown): Promise<void> {
  await mkdir(DIR, { recursive: true });
  await writeFile(path.join(DIR, "shelf.json"), `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

afterEach(() => rm(DIR, { recursive: true, force: true }));

describe("reading a shelf.json", () => {
  it("is empty, not an error, for an article nobody has touched", async () => {
    // A missing file is the ordinary case — most articles have never been
    // archived or renamed — and a seeder that threw on one would be unable to
    // seed the majority of a corpus.
    expect(await loadShelf(SLUG)).toEqual({ opens: 0 });
  });

  it("reads back every field the columns need, and drops the ones it does not", async () => {
    /* The five that `seedShelfFromFiles` writes onto `articles`. `opens` is
       coerced rather than trusted, because a negative or non-numeric count off
       a hand-edited file would go into an `integer` column and be read back
       forever as the number of times somebody opened the article. */
    await writeShelf({
      archivedAt: "2026-01-01T00:00:00.000Z",
      title: "My own name",
      opens: -3,
      lastOpenedAt: "2026-02-02T00:00:00.000Z",
      purpose: "the evidence",
      leftover: "not a field",
    });
    expect(await loadShelf(SLUG)).toEqual({
      archivedAt: "2026-01-01T00:00:00.000Z",
      title: "My own name",
      opens: 0,
      lastOpenedAt: "2026-02-02T00:00:00.000Z",
      purpose: "the evidence",
    });
  });

  it("throws on a file that will not parse, rather than reporting an empty shelf", async () => {
    /* The highest-stakes line in the module, and the reason it is not a
       `catch (…) { return EMPTY }`: the file holds a title the reader typed and
       a flag that hides a card, so quietly answering `{ opens: 0 }` would
       un-archive an article and un-rename it in the same breath. It is also
       one of the drivers in tests/parse-json.test.ts, where what matters is
       that the log line names `shelf.json` without quoting a byte of it. */
    await mkdir(DIR, { recursive: true });
    await writeFile(path.join(DIR, "shelf.json"), "{ not json", "utf8");
    await expect(loadShelf(SLUG)).rejects.toThrow();
  });
});

describe("a slug that is not a slug", () => {
  it("refuses a slug that is not a slug, rather than sanitising it", async () => {
    await expect(loadShelf("../../etc/passwd")).rejects.toThrow(/Not a valid slug/);
  });
});
