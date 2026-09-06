/**
 * The golden test `tests/fixtures/structures.html` was committed for and never got.
 *
 * `4bd4d94c` added that fixture alongside the nested-list fix in src/blocks.ts,
 * as a structural case the test article does not contain: a table, a bare
 * blockquote, `<pre>`, nested lists, a bare `<img>` in a `<p>`, an `<hr>`, and
 * ids the author's HTML already carried. The commit message says the fixture
 * "caught two bugs" — but no test ever opened it, so for eleven days it was 5KB
 * of pipeline output that nothing could go red about. Found while tidying the
 * root for open-sourcing
 * (docs/plans/260906b-tidy-the-repo-root-before-open-sourcing.md § 2), where the
 * pair moved out of a top-level `test/` that sat one letter from `tests/`.
 *
 * This is a **golden** test: it re-runs stage 3 over the captured HTML and
 * compares the whole result against the captured JSON. A golden's value is that
 * it notices changes nobody predicted, which is exactly what the hand-written
 * assertions in tests/blocks.test.ts cannot do.
 *
 * **If this goes red, read the diff before touching the fixture.** A changed
 * block means `splitIntoBlocks` now reads this HTML differently, and the
 * question is whether that is the improvement you meant. Re-cutting the JSON to
 * match is the right move only once you have answered it; doing that first turns
 * the golden back into decoration.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { splitIntoBlocks } from "../src/blocks.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(HERE, "fixtures");

const html = readFileSync(path.join(FIXTURES, "structures.html"), "utf8");
const expected = JSON.parse(
  readFileSync(path.join(FIXTURES, "structures.blocks.json"), "utf8"),
) as { blocks: { id: string; tag: string }[] };

describe("the structural fixture", () => {
  const { blocks } = splitIntoBlocks(html);

  it("still splits into exactly the captured blocks", () => {
    expect(blocks).toEqual(expected.blocks);
  });

  /* Named separately because `toEqual` over the whole array reports a count
     mismatch as a wall of JSON, and the count is the first thing you want. */
  it("still finds the same number of them", () => {
    expect(blocks).toHaveLength(expected.blocks.length);
  });

  /* The shapes this fixture exists for, asserted by name so a regression says
     which structure broke rather than only that something did. `table`, not
     `td`: a table is one block, not one per cell. */
  it("covers the structures the test article has none of", () => {
    const tags = new Set(blocks.map((b) => b.tag));
    for (const tag of ["table", "blockquote", "pre", "figure", "hr", "li"]) {
      expect(tags).toContain(tag);
    }
  });

  /* The nested-list fix `4bd4d94c` was written for: an <li> holding a sublist
     is both leaf and container, so the inner item is addressable rather than
     concatenated into its parent (docs/project/architecture.md). */
  it("still gives a nested list item its own block", () => {
    const texts = blocks.map((b) => b.text);
    expect(texts).toContain("Nested outer");
    expect(texts).toContain("Nested inner");
  });

  /* The one contract that matters: ids are minted once and preserved on every
     later run (docs/project/block-ids.md). Every element in this fixture's HTML
     already carries one, so re-running stage 3 over it must hand back the same
     ids rather than mint fresh ones — which is a property of this document, not
     of the algorithm, and so is worth pinning here.

     **The obvious probe does not exercise this.** Renaming an id in the fixture
     moves both sides of the comparison together and leaves this green (watched,
     2026-09-06); only the golden above catches that. What this one is for is
     stage 3 *minting* where the author supplied — probed by deleting an `id`
     attribute, which reddens this line and not the other four. */
  it("preserves every id the HTML already carried", () => {
    const inHtml = [...html.matchAll(/id="(spya-[a-z0-9]+)"/g)].map((m) => m[1]);
    expect(inHtml).not.toHaveLength(0);
    expect(blocks.map((b) => b.id)).toEqual(inHtml);
  });
});
