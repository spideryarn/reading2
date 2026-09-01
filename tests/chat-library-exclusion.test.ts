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
 * ## Why this runs against Postgres
 *
 * It used to build both fixtures as directories under `data/`, because that is
 * what the filesystem adapter reads. Stage 4 takes that adapter away
 * (docs/plans/260831b-finish-the-database-move.md), so both articles are now
 * throwaway copies of the committed corpus in Postgres, with their blocks
 * rewritten on the way in — tests/helpers/scratch-article.ts § `mutate`.
 *
 * **And it is now testing the half that ships.** `excludeSlug` is a contract on
 * both adapters and this file only ever exercised one of them; the Postgres
 * query is the one production runs. See docs/project/chat-tools.md.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/** `SPIDERYARN_STORE=postgres` before any import — see tests/chat-route.test.ts. */
const PREVIOUS_STORE_FLAG = vi.hoisted(() => {
  const previous = process.env.SPIDERYARN_STORE;
  process.env.SPIDERYARN_STORE = "postgres";
  return previous;
});

import { closeDb } from "../src/db/client.js";
import { loadEnvLocal } from "../src/env.js";
import type { Block, Meta } from "../src/types.js";
import { asTestOwner, TEST_OWNER } from "./helpers/authed.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";

loadEnvLocal();

/** The article the reader has open, and one they read last month. */
const OPEN = "test-chat-lib-open";
const OTHER = "test-chat-lib-other";

const { reachable } = await pgReady({
  suite: "tests/chat-library-exclusion.test.ts",
  tables: ["spideryarn.revision_blocks"],
});

const { MAX_LIBRARY_HITS, runTool } = await import("../src/chat-tools.js");
const { STORE } = await import("../src/store/index.js");

if (PREVIOUS_STORE_FLAG === undefined) delete process.env.SPIDERYARN_STORE;
else process.env.SPIDERYARN_STORE = PREVIOUS_STORE_FLAG;

const when = reachable ? describe : describe.skip;

/** A word no real article contains, so a hit cannot be a coincidence. */
const RARE = "zibbleflux";

/**
 * How many matching paragraphs the open article gets.
 *
 * It has to beat whatever the tool over-fetches, or the old code would pass
 * this by luck rather than by being right: the over-fetch was 8 × 4 = 32, so 34
 * is comfortably over the line — and the assertion below is written against
 * `MAX_LIBRARY_HITS` rather than 32, so raising the cap does not quietly turn
 * this test green.
 */
const CROWD = 34;

/**
 * Which corpus article stands in — **and it is not the default one.**
 *
 * `CROWD` paragraphs have to exist before they can be rewritten, and `writes`
 * (the usual scratch source) has nineteen blocks. This one has ninety-five. The
 * fixture used `example/`, which has thirty-four, and the number above was
 * chosen against it — so a smaller source would make `CROWD` unreachable and the
 * over-fetch argument false without anything saying so.
 *
 * **Not `constitution`, which has eighty-four and would have done.** Its
 * `labels.json` carries no `sourceHash`, so it has no `hierarchy` input hash and
 * `publishRevision` refuses it — *pristine*, before this file touches anything.
 * It is the one article in the committed corpus that cannot be loaded into
 * Postgres at all.
 */
const SOURCE = "openai-huggingface";

/**
 * Rewrite one article's blocks so the assertions are about words this file put
 * there. Handed to `scratchArticleInPg` as its `mutate`, so it happens before
 * the load and the database gets these blocks rather than the corpus's.
 */
const withTexts = (texts: string[]) => async (dir: string) => {
  const file = path.join(dir, "blocks.json");
  const { blocks } = JSON.parse(await readFile(file, "utf8")) as { blocks: Block[] };

  /* **Every block is kept, and only its text is rewritten.** The filesystem
     version of this dropped the rest with `blocks.slice(0, texts.length)`,
     which the old store did not mind. `publishRevision` does: the tree names
     block ids by range, so a load that deleted them is refused with
     `range end "spya-…" not in blocks.json` — the guard doing exactly its job,
     against a fixture the fs store had let through for a year. Headings are
     skipped for the same reason: `sourceHeading` on a tree node has to still
     match a heading block inside its range. */
  let n = 0;
  const rewritten = blocks.map((block) => {
    if (n >= texts.length || block.kind === "heading") return block;
    const text = texts[n++] as string;
    return { ...block, text, html: `<p>${text}</p>`, words: text.split(/\s+/).length, gistable: true };
  });
  if (n < texts.length) {
    throw new Error(
      `the fixture "${SOURCE}" has ${n} non-heading blocks and this test needs ${texts.length}`,
    );
  }
  await writeFile(file, JSON.stringify({ blocks: rewritten }));
};

const ctx = {
  slug: OPEN,
  meta: { title: "The open article", url: "https://example.com/open" } as Meta,
  blocks: [] as Block[],
};

let open: ScratchArticle | undefined;

/**
 * The loud article, seeded once for the file.
 *
 * The quiet one is seeded **inside each test** and removed again, because the
 * two cases want different contents for it and they must not both be in the
 * library at once: the first case asserts that the *buried* passage is found,
 * and a second quiet article standing beside it would fill the cap with easier
 * hits and the assertion would be about the wrong article. The filesystem
 * version got this for free by rebuilding both directories per test.
 */
beforeAll(async () => {
  if (!reachable) return;
  /* The open article shouts: every paragraph is nothing but the word, so every
     one of them outranks the thin paragraph in the other. */
  open = await scratchArticleInPg(OPEN, {
    from: SOURCE,
    ownerId: TEST_OWNER,
    mutate: withTexts(Array.from({ length: CROWD }, () => `${RARE} ${RARE} ${RARE} ${RARE}.`)),
  });
  /* **The seed is asserted, not assumed**: an article whose blocks did not take
     would make every case below "nothing found", which is the exact failure this
     file is about and would read as a regression. */
  expect(open.copied).toContain("hierarchy");
  expect(open.blocks.filter((b) => b.text.includes(RARE))).toHaveLength(CROWD);
}, 60_000);

afterAll(async () => {
  await open?.remove();
  await closeDb();
});

/** The quiet article, for the length of one test. */
async function withQuiet<T>(texts: string[], body: (slug: string) => Promise<T>): Promise<T> {
  const slug = OTHER;
  const made = await scratchArticleInPg(slug, {
    from: SOURCE,
    ownerId: TEST_OWNER,
    mutate: withTexts(texts),
  });
  try {
    return await body(slug);
  } finally {
    await made.remove();
  }
}

describe("the store these tests are actually talking to", () => {
  it("is the Postgres one", () => {
    expect(STORE).toBe("postgres");
  });
});

when("search_library, when the open article floods the index", () => {
  it("still finds the passage in another article", async () => {
    /* The other article whispers: one mention in a long paragraph, which the
       length damping puts at the very bottom of the list. It is the hit the
       reader actually wants and the only one the tool is allowed to show. */
    await withQuiet(
      [`A single ${RARE} ${"buried among a good many other words ".repeat(30)}`],
      async (slug) => {
        const out = await asTestOwner(() => runTool("search_library", { query: RARE }, ctx));
        expect(out.detail).not.toBe("nothing found");
        expect(out.content).toContain(slug);
        expect(out.content).not.toContain(OPEN);
      },
    );
  }, 60_000);

  it("fills the list with other articles rather than with the open one", async () => {
    // Enough elsewhere to fill the cap, so a result list short of it means the
    // open article ate the budget before the exclusion ran.
    await withQuiet(
      Array.from({ length: MAX_LIBRARY_HITS + 2 }, (_, i) => `A quiet ${RARE}, the ${i}th of them.`),
      async () => {
        const out = await asTestOwner(() => runTool("search_library", { query: RARE }, ctx));
        expect(out.detail).toContain(`${MAX_LIBRARY_HITS} passages`);
        expect(out.content).not.toContain(OPEN);
      },
    );
  }, 60_000);
});
