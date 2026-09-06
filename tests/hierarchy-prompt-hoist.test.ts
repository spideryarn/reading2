/**
 * **The three values that moved out of `src/hierarchy.ts` on 2026-09-05, pinned
 * where they landed.**
 *
 * `PROMPT_VERSION`, `PRODUCTION_EFFORT` and `renderBlocks` were hoisted into
 * [`src/hierarchy-prompt.ts`](../src/hierarchy-prompt.ts) so that
 * `src/hierarchy-expand.ts` could read them without a value import from
 * `hierarchy.ts` — which, once `hierarchy.ts` imports the deepening wave, closes
 * a cycle `npm run cycles` refuses.
 * docs/plans/260904d-deepen-fat-sections.md § stage 5.
 *
 * **A move that changed a value would be invisible and expensive.** The stamp is
 * in the structure checkpoint's key and the effort is inside the request that key
 * is a digest of, so a single character would miss every row ever written — every
 * reader's stored table of contents bought again, with nothing to see but the
 * bill. docs/reusable/silent-success.md.
 *
 * So the assertion is not "the values look right": it is the **key itself**,
 * `2993e1e4b2aaf1d6`, computed against the fixture below by the *pre-move*
 * `src/hierarchy.ts` taken out of git at `9afcc37f` and run beside the new one on
 * 2026-09-05. The two agreed. That hex is copied in here rather than derived, for
 * the reason `tests/hierarchy-structure-request-parity.test.ts` states about its
 * own pin: an expectation derived from the thing it checks agrees with every
 * value of it.
 *
 * The key covers the model too, and `MODEL_ENV_VAR.hierarchy` is `null`
 * (src/models.ts) — there is no environment override for this task, so the pin is
 * deterministic rather than merely usually right.
 */
import { describe, expect, it } from "vitest";

import {
  PRODUCTION_EFFORT,
  PROMPT_VERSION,
  canonicalStructureRequest,
  renderBlocks,
  structureRequest,
} from "../src/hierarchy.js";
import * as leaf from "../src/hierarchy-prompt.js";
import { checkpointKey } from "../src/source-hash.js";
import type { Block } from "../src/types.js";

/**
 * Four blocks, one of each thing `renderBlocks` treats differently: an authored
 * heading, ordinary prose, a `gistable: false` block that keeps its text, and a
 * supplement whose prose is withheld and whose id is not.
 */
const BLOCKS: Block[] = [
  { id: "spya-aaaaaa", tag: "h2", kind: "heading", text: "A Heading", words: 2, html: "<h2>A Heading</h2>", gistable: true },
  { id: "spya-bbbbbb", tag: "p", kind: "text", text: "Body prose here.", words: 3, html: "<p>x</p>", gistable: true },
  { id: "spya-cccccc", tag: "p", kind: "text", text: "A note.", words: 2, html: "<p>y</p>", gistable: false },
  {
    id: "spya-dddddd",
    tag: "p",
    kind: "text",
    text: "Bibliography entry.",
    words: 2,
    html: "<p>z</p>",
    gistable: true,
    treatment: "supplement",
  },
];

describe("hoisting the structure prompt's three values", () => {
  it("moved the stamp and the effort without moving either value", () => {
    expect(PROMPT_VERSION).toBe("toc/6");
    expect(PRODUCTION_EFFORT).toBe("low");
  });

  it("re-exports the very same values from src/hierarchy.ts", () => {
    /* Not equal values — the *same* binding. A second copy left behind in
       `hierarchy.ts` would satisfy an equality check and then drift. */
    expect(PROMPT_VERSION).toBe(leaf.PROMPT_VERSION);
    expect(PRODUCTION_EFFORT).toBe(leaf.PRODUCTION_EFFORT);
    expect(renderBlocks).toBe(leaf.renderBlocks);
  });

  it("prints the article the way it always did, marker for marker", () => {
    expect(renderBlocks(BLOCKS)).toBe(
      "[0] spya-aaaaaa <h2>: A Heading\n\n" +
        "[1] spya-bbbbbb <p>: Body prose here.\n\n" +
        "[2] spya-cccccc <p> NOT-GISTABLE: A note.\n\n" +
        "[3] spya-dddddd <p> NOT-GISTABLE: (withheld)",
    );
  });

  /**
   * **The key moved on 2026-09-05, and it was supposed to.**
   *
   * `2993e1e4b2aaf1d6` was the pre-move key, and it held from the hoist until
   * the Socratic `question` went into SYSTEM (SPIDERYARN-READING2-1V). That is
   * a real change to the bytes of the request, so the digest of those bytes
   * changes with it, and a checkpoint written under toc/4 is correctly no
   * longer found — an article part-way through the stage replays one call
   * rather than resuming onto a prompt that no longer asks the same thing.
   *
   * So this pin has done its job rather than failed at it. What it still
   * guards is the same thing it always did: that nobody moves these bytes
   * *without meaning to*. Change the number only alongside a deliberate change
   * to SYSTEM, `renderBlocks` or `EFFORT`, and say which in the message.
   */
  it("mints one stable key for the toc/6 structure request", () => {
    expect(checkpointKey(canonicalStructureRequest(structureRequest(BLOCKS).params))).toBe(
      "9022c4cb6b7395b1",
    );
  });
});
