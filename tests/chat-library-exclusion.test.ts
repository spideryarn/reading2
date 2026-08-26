/**
 * `search_library` must not drop everything when the reader's own article is
 * the loudest thing in the index.
 *
 * The tool searches the whole library and then removes the article the reader
 * already has open — it is in the prompt in full, so offering it back as
 * "something else you have read" is wrong. The bug was the ORDER of those two
 * steps: the store capped first and the tool filtered second, so an article
 * that supplied every hit in the capped list left the reader with
 * "nothing found" while a perfectly good match sat one place below the cut.
 *
 * Over-fetching (asking the store for `MAX_LIBRARY_HITS * 4`) narrowed the
 * window and did not close it, which is what this file is about: the fixture
 * below deliberately gives the open article MORE matches than the over-fetch,
 * so the mitigation cannot save it. The fix is `excludeSlug` on the store
 * contract — the exclusion happens inside the query, before the cap.
 *
 * Against real files under `data/`, because that is what the filesystem
 * adapter reads. Both fixtures are `test-` prefixed so tests/store-parity.test.ts
 * skips them while they exist. See docs/project/chat-tools.md.
 */
import { cp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MAX_LIBRARY_HITS, runTool } from "../src/chat-tools.js";
import type { Block, Meta } from "../src/types.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const EXAMPLE = path.join(ROOT, "example");

/** The article the reader has open, and one they read last month. */
const OPEN = "test-chat-lib-open";
const OTHER = "test-chat-lib-other";
const DIRS = [OPEN, OTHER].map((slug) => path.join(ROOT, "data", slug));

/** A word no real article contains, so a hit cannot be a coincidence. */
const RARE = "zibbleflux";

/**
 * How many matching paragraphs the open article gets.
 *
 * It has to beat whatever the tool over-fetches, or the old code would pass
 * this by luck rather than by being right. `example` has 34 blocks and the
 * over-fetch was 8 × 4 = 32, so the fixture is comfortably over the line — and
 * the assertion below is written against `MAX_LIBRARY_HITS` rather than 32, so
 * raising the cap does not quietly turn this test green.
 */
const CROWD = 34;

/**
 * One article's `blocks.json`, rewritten so the assertions are about words this
 * file put there. Copied from `example` so every other artefact an article
 * needs is present and valid.
 */
async function makeArticle(dir: string, texts: string[]): Promise<void> {
  await cp(EXAMPLE, dir, { recursive: true });
  const file = path.join(dir, "blocks.json");
  const { blocks } = JSON.parse(await readFile(file, "utf8")) as { blocks: Block[] };
  if (blocks.length < texts.length) throw new Error("the fixture has fewer blocks than this test needs");

  const kept = blocks.slice(0, texts.length).map((block, i) => ({
    ...block,
    text: texts[i] as string,
    html: `<p>${texts[i]}</p>`,
    words: (texts[i] as string).split(/\s+/).length,
    gistable: true,
    kind: "text",
  }));
  await writeFile(file, JSON.stringify({ blocks: kept }));
}

const ctx = {
  slug: OPEN,
  meta: { title: "The open article", url: "https://example.com/open" } as Meta,
  blocks: [] as Block[],
};

afterEach(() => Promise.all(DIRS.map((dir) => rm(dir, { recursive: true, force: true }))));

describe("search_library, when the open article floods the index", () => {
  it("still finds the passage in another article", async () => {
    /* The open article shouts: every paragraph is nothing but the word, so
       every one of them outranks the thin paragraph below. */
    await makeArticle(
      path.join(ROOT, "data", OPEN),
      Array.from({ length: CROWD }, () => `${RARE} ${RARE} ${RARE} ${RARE}.`),
    );
    /* The other article whispers: one mention in a long paragraph, which the
       length damping puts at the very bottom of the list. It is the hit the
       reader actually wants and the only one the tool is allowed to show. */
    await makeArticle(path.join(ROOT, "data", OTHER), [
      `A single ${RARE} ${"buried among a good many other words ".repeat(30)}`,
    ]);

    const out = await runTool("search_library", { query: RARE }, ctx);

    expect(out.detail).not.toBe("nothing found");
    expect(out.content).toContain(OTHER);
    expect(out.content).not.toContain(OPEN);
  });

  it("fills the list with other articles rather than with the open one", async () => {
    // Enough elsewhere to fill the cap, so a result list short of it means the
    // open article ate the budget before the exclusion ran.
    await makeArticle(
      path.join(ROOT, "data", OPEN),
      Array.from({ length: CROWD }, () => `${RARE} ${RARE} ${RARE} ${RARE}.`),
    );
    await makeArticle(
      path.join(ROOT, "data", OTHER),
      Array.from({ length: MAX_LIBRARY_HITS + 2 }, (_, i) => `A quiet ${RARE}, the ${i}th of them.`),
    );

    const out = await runTool("search_library", { query: RARE }, ctx);

    expect(out.detail).toContain(`${MAX_LIBRARY_HITS} passages`);
    expect(out.content).not.toContain(OPEN);
  });
});
