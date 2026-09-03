/**
 * The Illustrated brief's reader — src/illustrated-plate.ts.
 *
 * The brief is the only thing between a model's free text and a *second*
 * model's prompt, and between a model's claim and a row the reader is invited
 * to click. Nothing downstream can catch a bad vignette: the image renders, the
 * row jumps somewhere, and both look like a design choice
 * (docs/reusable/silent-success.md).
 *
 * The rule under test throughout is `readSketch`'s: **a vignette survives
 * intact or it is dropped and counted.** Nothing is repaired.
 *
 * The case that matters most is `a quote lifted from another block` — the
 * correction GPT Sol made to the plan on 2026-09-03. The 2026-09-03 spike
 * searched the whole article, which accepts a quote from somewhere the vignette
 * does not claim to be about, and the reader would then be shown a real
 * sentence beside a jump to a block that does not contain it.
 */
import { describe, expect, it } from "vitest";

import {
  ILLUSTRATED_VERSION,
  MAX_DEPICTS_CHARS,
  readIllustrated,
  type Illustrated,
} from "../src/illustrated-plate.js";
import type { BlockId } from "../src/types.js";

const LADDER =
  "Aristotle's Scala Naturae put minerals at the bottom and angels at the top, " +
  "and every argument about machine consciousness is still climbing it.";
const CUP =
  "Seth picks up a coffee cup and asks what it is like to be the cup, which is " +
  "a question that sounds silly until you try to say why.";
const JAR = "A brain in a jar would still, on this account, be having a bad afternoon.";

const BLOCKS = new Map<BlockId, string>([
  ["spya-aaaaaa", LADDER],
  ["spya-bbbbbb", CUP],
  ["spya-cccccc", JAR],
]);

const OPTS = { blockText: BLOCKS };

/** A vignette that passes every check, so a case can vary exactly one thing. */
function good(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    node: "n1",
    block: "spya-aaaaaa",
    quote: "minerals at the bottom and angels at the top",
    depicts: "A gilded ladder up the left margin, minerals on the bottom rung.",
    ...over,
  };
}

function brief(vignettes: unknown[], over: Record<string, unknown> = {}): unknown {
  return {
    style: "An illuminated manuscript page, because the essay's own idiom is vellum and gold.",
    plates: [
      {
        sceneId: "overview",
        title: "The whole argument",
        prompt: "A vellum page, top to bottom: the ladder, the cup, the jar.",
        vignettes,
        ...over,
      },
    ],
  };
}

describe("readIllustrated", () => {
  it("keeps a vignette whose quote really is in the block it names", () => {
    const { illustrated, report } = readIllustrated(brief([good()]), OPTS);
    expect(report.faults).toEqual([]);
    expect(report.written).toBe(1);
    expect(report.kept).toBe(1);
    expect(illustrated.version).toBe(ILLUSTRATED_VERSION);
    expect(illustrated.plates[0]?.vignettes[0]).toEqual({
      node: "n1",
      block: "spya-aaaaaa",
      quote: "minerals at the bottom and angels at the top",
      depicts: "A gilded ladder up the left margin, minerals on the bottom rung.",
    });
  });

  it("drops a vignette whose block the article has not got", () => {
    const { illustrated, report } = readIllustrated(
      brief([good({ block: "spya-zzzzzz" })]),
      OPTS,
    );
    expect(illustrated.plates[0]?.vignettes).toEqual([]);
    expect(report.kept).toBe(0);
    expect(report.faults).toHaveLength(1);
    expect(report.faults[0]?.what).toContain("spya-zzzzzz");
  });

  /**
   * **The review finding, made explicit.** The quote below is a real, verbatim,
   * contiguous run of the article's own words — it is just in a different block
   * from the one the vignette names. An article-wide search passes it.
   */
  it("drops a quote that is in the article but not in the block it names", () => {
    const lifted = good({
      block: "spya-aaaaaa",
      quote: "what it is like to be the cup",
    });
    // The premise: this really is somewhere in the article.
    expect(BLOCKS.get("spya-bbbbbb")).toContain("what it is like to be the cup");

    const { report } = readIllustrated(brief([lifted]), OPTS);
    expect(report.kept).toBe(0);
    expect(report.faults[0]?.what).toBe("quote is not in block spya-aaaaaa");
  });

  it("drops a quote under the floor, so \"the\" cannot match everything", () => {
    const { report } = readIllustrated(
      brief([good({ quote: "the" }), good({ quote: "at the top and" })]),
      OPTS,
    );
    expect(report.written).toBe(2);
    expect(report.kept).toBe(0);
    expect(report.faults).toHaveLength(2);
    for (const f of report.faults) expect(f.what).toContain("floor");
  });

  /**
   * `quote-match.ts` already folds curly quotes and all three dashes, which is
   * why this file adds no normaliser of its own. Two of the 2026-09-03 spike's
   * three "false positives" were its own naive `String.includes`; this pins
   * that they are not this validator's.
   */
  it("matches through curly quotes and em dashes without a second normaliser", () => {
    const blocks = new Map<BlockId, string>([
      ["spya-dddddd", "The brain’s own account — tie‑breakers and all — is late."],
    ]);
    const { report } = readIllustrated(
      brief([
        good({
          block: "spya-dddddd",
          quote: "The brain's own account - tie‑breakers and all",
        }),
      ]),
      { blockText: blocks },
    );
    expect(report.faults).toEqual([]);
    expect(report.kept).toBe(1);
  });

  it("drops a depicts over the cap or carrying a bidi override", () => {
    const { report } = readIllustrated(
      brief([
        good({ depicts: "x".repeat(MAX_DEPICTS_CHARS + 1) }),
        good({ depicts: "A ladder‮ and then the reversed part." }),
      ]),
      OPTS,
    );
    expect(report.kept).toBe(0);
    expect(report.faults[0]?.what).toContain("over the");
    expect(report.faults[1]?.what).toContain("control or bidi");
  });

  it("counts what it dropped and what it kept, per plate and per vignette", () => {
    const raw = {
      style: "An illuminated page.",
      plates: [
        {
          sceneId: "overview",
          title: "All of it",
          prompt: "A vellum page.",
          vignettes: [good(), good({ block: "spya-nope00" }), good({ quote: "no" })],
        },
        // No prompt: nothing to draw, so the plate goes and its vignettes with it.
        { sceneId: "zoom-1", title: "Half of it", vignettes: [good()] },
        // A second plate of a scene already drawn.
        { sceneId: "overview", title: "Again", prompt: "A second vellum page.", vignettes: [] },
      ],
    };
    const { illustrated, report } = readIllustrated(raw, OPTS);
    expect(report.platesWritten).toBe(3);
    expect(report.platesKept).toBe(1);
    /* Four, not three: `written` is what the model wrote, and the vignette on
       the promptless plate was written before that plate was dropped. Counting
       only the survivors' siblings would make a run where every plate failed
       look like a run where the model wrote nothing. */
    expect(report.written).toBe(4);
    expect(report.kept).toBe(1);
    expect(illustrated.plates).toHaveLength(1);
    expect(report.faults.map((f) => f.where)).toEqual([
      "plate[0].vignettes[1]",
      "plate[0].vignettes[2]",
      "plate[1]",
      "plate[2]",
    ]);
  });

  it("hands back an empty brief rather than throwing on rubbish", () => {
    for (const raw of [null, 42, "a string", []]) {
      const { illustrated, report } = readIllustrated(raw, OPTS);
      expect(illustrated.plates).toEqual([]);
      expect(report.faults.length).toBeGreaterThan(0);
    }
  });

  /**
   * A stored artefact goes back through the same reader the fresh answer did —
   * that is what makes the browser's revalidation the same check as the
   * server's, rather than a second, looser one.
   */
  it("round-trips a stored artefact, keeping its image record and provenance", () => {
    const stored: Illustrated = {
      version: ILLUSTRATED_VERSION,
      generator: "anthropic/claude-sonnet-5",
      illustrator: "openai/gpt-image-2",
      slug: "noema",
      sourceHash: "abc123",
      profileHash: null,
      style: "An illuminated page.",
      plates: [
        {
          sceneId: "overview",
          title: "All of it",
          prompt: "A vellum page.",
          vignettes: [good() as never],
          image: { sha256: "a".repeat(64), ext: "jpeg", bytes: 74_000, width: 1024, height: 1536 },
        },
        {
          sceneId: "zoom-1",
          title: "Half of it",
          prompt: "Another vellum page.",
          vignettes: [],
          failed: "the illustrator could not be reached",
        },
      ],
    };
    const { illustrated, report } = readIllustrated(stored, OPTS);
    expect(report.faults).toEqual([]);
    expect(illustrated.plates[0]?.image?.sha256).toBe("a".repeat(64));
    expect(illustrated.plates[1]?.failed).toBe("the illustrator could not be reached");
    expect(illustrated.profileHash).toBeNull();
    expect(illustrated.generator).toBe("anthropic/claude-sonnet-5");
  });
});
