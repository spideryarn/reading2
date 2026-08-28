/**
 * Searching every article at once — the filesystem half (src/library-search.ts).
 *
 * Against real files under `data/`, because that is what the code reads. The
 * fixture is copied to a throwaway slug with known text written into it, so the
 * assertions are about words we put there rather than about whatever the Noema
 * article happens to say this week.
 *
 * The Postgres half is not exercised here — it needs a running database, and it
 * lives with the other store tests. What the two are allowed to disagree about
 * is written down in src/store/contracts.ts: the same *set* of block ids for a
 * single-word query, and nothing about the order.
 */
import { cp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { searchLibrary } from "../src/library-search.js";
import { setArchived } from "../src/shelf.js";
import type { Block } from "../src/types.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const SLUG = "test-library-search";
const DIR = path.join(ROOT, "data", SLUG);
const EXAMPLE = path.join(ROOT, "example");

/** A distinctive word, so a hit cannot be a coincidence from a real article. */
const RARE = "zibbleflux";

async function makeArticle(sentences: string[]): Promise<string[]> {
  await cp(EXAMPLE, DIR, { recursive: true });
  const file = path.join(DIR, "blocks.json");
  const { blocks } = JSON.parse(await readFile(file, "utf8")) as { blocks: Block[] };

  const ids: string[] = [];
  sentences.forEach((text, i) => {
    const block = blocks[i];
    if (!block) throw new Error("the fixture has fewer blocks than this test needs");
    block.text = text;
    block.words = text.split(/\s+/).length;
    block.gistable = true;
    block.kind = "text";
    ids.push(block.id);
  });

  await writeFile(file, JSON.stringify({ blocks }));
  return ids;
}

afterEach(() => rm(DIR, { recursive: true, force: true }));

describe("searching the library", () => {
  it("finds a passage by its words, and says which article it is in", async () => {
    const [id] = await makeArticle([`The ${RARE} is a thing nobody has written about.`]);
    const { hits } = await searchLibrary(RARE, 10);
    const mine = hits.filter((h) => h.slug === SLUG);
    expect(mine).toHaveLength(1);
    expect(mine[0]?.blockId).toBe(id);
    // The whole paragraph, not a window — the client cuts it. See LibraryHit.text.
    expect(mine[0]?.text).toContain(RARE);
  });

  /**
   * **A footnote is findable, and that is the policy rather than an oversight.**
   *
   * `isSearchable` is the one of the five predicates in src/block-policy.ts
   * that includes supplements — a note is often the best sentence in a piece —
   * and it is the one an over-eager refactor breaks by making the five agree.
   * The plan listed the Postgres half's hard-coded `gistable = true` as work to
   * do, and it was wrong (GPT Sol's decision 4); this test is the point of that
   * row. tests/block-policy.test.ts guards the SQL side.
   */
  it("still finds a passage inside a footnote", async () => {
    const [note] = await makeArticle([`The ${RARE} appears only in an endnote.`]);
    const file = path.join(DIR, "blocks.json");
    const { blocks } = JSON.parse(await readFile(file, "utf8")) as { blocks: Block[] };
    const target = blocks.find((b) => b.id === note)!;
    target.role = "footnote";
    target.treatment = "supplement";
    target.noteId = "note-1";
    await writeFile(file, JSON.stringify({ blocks }));

    const { hits } = await searchLibrary(RARE, 10);
    expect(hits.filter((h) => h.slug === SLUG).map((h) => h.blockId)).toContain(note);
  });

  it("still refuses a heading, so the predicate is not simply true", async () => {
    // The negative sentinel beside it: `isSearchable` reads `gistable`, and a
    // predicate that returned true for everything would pass the test above.
    const [id] = await makeArticle([`A ${RARE} heading.`]);
    const file = path.join(DIR, "blocks.json");
    const { blocks } = JSON.parse(await readFile(file, "utf8")) as { blocks: Block[] };
    blocks.find((b) => b.id === id)!.gistable = false;
    await writeFile(file, JSON.stringify({ blocks }));

    const { hits } = await searchLibrary(RARE, 10);
    expect(hits.filter((h) => h.slug === SLUG).map((h) => h.blockId)).not.toContain(id);
  });

  it("returns nothing for a query no article contains", async () => {
    await makeArticle([`The ${RARE} is a thing nobody has written about.`]);
    const { hits } = await searchLibrary("qwertyuiopasdfgh", 10);
    expect(hits).toEqual([]);
  });

  it("requires every term, not any of them", async () => {
    const [both, one] = await makeArticle([
      `A ${RARE} and a wobbleton together.`,
      `A ${RARE} on its own.`,
    ]);
    const { hits } = await searchLibrary(`${RARE} wobbleton`, 10);
    const ids = hits.filter((h) => h.slug === SLUG).map((h) => h.blockId);
    expect(ids).toContain(both);
    expect(ids).not.toContain(one);
  });

  it("honours a quoted phrase", async () => {
    const [together, apart] = await makeArticle([
      `The ${RARE} machine is here.`,
      `The ${RARE} is not a machine at all.`,
    ]);
    const { hits } = await searchLibrary(`"${RARE} machine"`, 10);
    const ids = hits.filter((h) => h.slug === SLUG).map((h) => h.blockId);
    expect(ids).toContain(together);
    expect(ids).not.toContain(apart);
  });

  it("folds case and accents, so godel finds Gödel", async () => {
    const [id] = await makeArticle([`Gödel and the ${RARE} walk in.`]);
    const { hits } = await searchLibrary("godel", 10);
    expect(hits.filter((h) => h.slug === SLUG).map((h) => h.blockId)).toContain(id);
  });

  it("ranks a denser paragraph above a longer, thinner one", async () => {
    const [dense, thin] = await makeArticle([
      `${RARE} ${RARE} ${RARE}.`,
      `${RARE} ${"and some other words ".repeat(30)}`,
    ]);
    const { hits } = await searchLibrary(RARE, 10);
    const mine = hits.filter((h) => h.slug === SLUG).map((h) => h.blockId);
    expect(mine.indexOf(dense as string)).toBeLessThan(mine.indexOf(thin as string));
  });

  it("says when it capped the list rather than pretending that was all", async () => {
    await makeArticle(Array.from({ length: 5 }, (_, i) => `${RARE} number ${i}.`));
    const { hits, capped } = await searchLibrary(RARE, 2);
    expect(hits).toHaveLength(2);
    expect(capped).toBe(true);
  });

  it("leaves an archived article out of the index entirely", async () => {
    await makeArticle([`The ${RARE} is here.`]);
    expect((await searchLibrary(RARE, 10)).hits.some((h) => h.slug === SLUG)).toBe(true);

    // Not filtered from the results — out of the index. A hit that opens an
    // article you deleted reads as a ghost.
    await setArchived(SLUG, true);
    expect((await searchLibrary(RARE, 10)).hits.some((h) => h.slug === SLUG)).toBe(false);
  });

  it("leaves an excluded article out before the cap, not after it", async () => {
    /* The order is the whole point. Five matches in this article and a cap of
       two: if the exclusion ran over the results it would take two hits from
       here and hand back nothing. Because it runs inside the search, the two
       places go to whatever else the library has. See LibrarySearchOptions in
       src/store/contracts.ts. */
    await makeArticle(Array.from({ length: 5 }, (_, i) => `${RARE} number ${i}.`));

    const all = await searchLibrary(RARE, 2);
    expect(all.hits.every((h) => h.slug === SLUG)).toBe(true);

    const without = await searchLibrary(RARE, 2, { excludeSlug: SLUG });
    expect(without.hits.some((h) => h.slug === SLUG)).toBe(false);
    // And `capped` now describes the list the caller actually got, rather than
    // a longer one it was never shown.
    expect(without.capped).toBe(false);
  });

  it("excludes nothing when asked for a slug that is not there", async () => {
    await makeArticle([`The ${RARE} is here.`]);
    const { hits } = await searchLibrary(RARE, 10, { excludeSlug: "no-such-article" });
    expect(hits.some((h) => h.slug === SLUG)).toBe(true);
  });

  it("ignores an empty query rather than returning the whole library", async () => {
    await makeArticle([`The ${RARE} is here.`]);
    expect((await searchLibrary("   ", 10)).hits).toEqual([]);
    // A single character matches everything and ranks nothing, so it is dropped
    // as a term — leaving no terms at all.
    expect((await searchLibrary("a", 10)).hits).toEqual([]);
  });
});
