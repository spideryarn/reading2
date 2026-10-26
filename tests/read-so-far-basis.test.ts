/**
 * **The shelf pie's cache knows when the fold rules change** — plan
 * docs/plans/261025l-shelf-cards-show-the-how-much-read-pie.md, GPT Sol's plan
 * review: the basis fingerprints the stored inputs, and a change to the code
 * that reads them changes no stored input. `READ_SO_FAR_RECIPE` is in the
 * basis for that, and is bumped by hand.
 *
 * A hand-bumped version is a sentence until something checks it. This pins a
 * hash of every focused module that can change what folds or counts beside the
 * recipe. Editing one fails here: bump `READ_SO_FAR_RECIPE` in
 * src/store/read-so-far-basis.ts if the change can move which blocks fold,
 * then update the hash below either way.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { READ_SO_FAR_RECIPE } from "../src/store/read-so-far-basis.js";

const hashOf = (file: string) =>
  createHash("sha256").update(readFileSync(new URL(`../${file}`, import.meta.url))).digest("hex").slice(0, 16);

describe("READ_SO_FAR_RECIPE", () => {
  it("is pinned beside the fold rules it stands for", () => {
    expect({
      recipe: READ_SO_FAR_RECIPE,
      "src/authors.ts": hashOf("src/authors.ts"),
      "src/block-policy.ts": hashOf("src/block-policy.ts"),
      "src/matter-current.ts": hashOf("src/matter-current.ts"),
      "src/web/front-matter.ts": hashOf("src/web/front-matter.ts"),
      "src/web/masthead-echo.ts": hashOf("src/web/masthead-echo.ts"),
      "src/web/matter-view.ts": hashOf("src/web/matter-view.ts"),
      "src/web/read-filter.ts": hashOf("src/web/read-filter.ts"),
    }).toEqual({
      recipe: "rsf/1",
      "src/authors.ts": "4869233d97790730",
      "src/block-policy.ts": "0b7aaa23eae2e49a",
      "src/matter-current.ts": "f60f63648292dc89",
      "src/web/front-matter.ts": "2dfc6d84266726a8",
      "src/web/masthead-echo.ts": "c2114c5d18ef454a",
      "src/web/matter-view.ts": "95fee6e09a27ebc7",
      "src/web/read-filter.ts": "4cdc329567048a3c",
    });
  });
});
