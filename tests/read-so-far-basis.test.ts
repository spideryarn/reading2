/**
 * **The shelf pie's cache knows when the fold rules change** — plan
 * docs/plans/261025l-shelf-cards-show-the-how-much-read-pie.md, GPT Sol's plan
 * review: the basis fingerprints the stored inputs, and a change to the code
 * that reads them changes no stored input. `READ_SO_FAR_RECIPE` is in the
 * basis for that, and is bumped by hand.
 *
 * A hand-bumped version is a sentence until something checks it. This pins a
 * hash of the two files that are wholly about what folds on arrival beside the
 * recipe. Editing either fails here: bump `READ_SO_FAR_RECIPE` in
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
      "src/web/front-matter.ts": hashOf("src/web/front-matter.ts"),
      "src/web/masthead-echo.ts": hashOf("src/web/masthead-echo.ts"),
    }).toEqual({
      recipe: "rsf/1",
      "src/web/front-matter.ts": "2dfc6d84266726a8",
      "src/web/masthead-echo.ts": "c2114c5d18ef454a",
    });
  });
});
