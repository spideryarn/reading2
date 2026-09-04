/**
 * The Illustrated brief's two readers — src/illustrated-plate.ts.
 *
 * The brief is the only thing between a model's free text and a *second*
 * model's prompt, and between a model's claim and a row the reader is invited
 * to click. Nothing downstream can catch a bad vignette: the image renders, the
 * row jumps somewhere, and both look like a design choice
 * (docs/reusable/silent-success.md).
 *
 * The rule under test throughout is `readSketch`'s: **a vignette survives
 * intact or it is dropped and counted.** Nothing is repaired silently.
 *
 * Two cases matter more than the rest, and both came from GPT Sol:
 *
 *  - **`a quote lifted from another block`** (2026-09-03, on the plan). The
 *    spike searched the whole article, which accepts a quote from somewhere the
 *    vignette does not claim to be about, and the reader would then be shown a
 *    real sentence beside a jump to a block that does not contain it.
 *  - **`a brief may not name an image`** (2026-09-03, on the code). `sha256`
 *    addresses a blob in a store shared by every article, so a reader that let
 *    a model write one let a prompt-injected brief claim somebody else's
 *    picture. That is why there are two readers rather than one.
 */
import { describe, expect, it } from "vitest";

import {
  ILLUSTRATED_VERSION,
  type Illustrated,
  MAX_DEPICTS_CHARS,
  MAX_PLATES_READ,
  MAX_VIGNETTES,
  readModelBrief,
  readStoredIllustrated,
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

const OPTS = { blockText: BLOCKS, sceneIds: ["overview", "zoom-1"] };

/** Real runs of two other blocks' own words, so a second vignette can pass. */
const CUP_QUOTE = "asks what it is like to be the cup";
const JAR_QUOTE = "picks up a coffee cup and asks what";

const IMAGE = {
  sha256: "a".repeat(64),
  ext: "jpeg",
  bytes: 74_000,
  width: 1024,
  height: 1536,
} as const;

/** A vignette that passes every check, so a case can vary exactly one thing. */
function good(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    node: "n1",
    block: "spya-aaaaaa",
    quote: "minerals at the bottom and angels at the top",
    depicts: "A gilded ladder up the left margin, minerals on the bottom rung.",
    /* **Every vignette a fixture builds carries one**, because since
       `illustrated/3` a brief without titles is a brief that will be drawn
       wordless, and a fixture missing one would make every unrelated case in
       this file assert against a plate that had quietly lost its lettering. */
    title: "Scala Naturae",
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

/** The scenes a one-plate brief is read against. */
const ONE = { blockText: BLOCKS, sceneIds: ["overview"] };

/**
 * **One version, under two names, and they must never drift apart.**
 *
 * `readModelBrief` stamps `ILLUSTRATED_VERSION` onto the artefact; src/store/pg.ts
 * answers `outdated` by comparing that field against `PROMPT_VERSION`. They were
 * two literals until 2026-09-03, equal by coincidence, and bumping one of them
 * for a prompt change made every freshly drawn artefact report `outdated: true`
 * for ever — the reader would be told the picture was out of date the instant it
 * arrived. They are the same constant now; this fails if anyone re-splits them.
 */
it("stamps the artefact with the version the store compares against", async () => {
  const { PROMPT_VERSION } = await import("../src/illustrated.js");
  expect(PROMPT_VERSION).toBe(ILLUSTRATED_VERSION);
  const { illustrated } = readModelBrief(brief([good()]), ONE);
  expect(illustrated.version).toBe(PROMPT_VERSION);
});

describe("readModelBrief", () => {
  it("keeps a vignette whose quote really is in the block it names", () => {
    const { illustrated, report } = readModelBrief(brief([good()]), ONE);
    expect(report.faults).toEqual([]);
    expect(report.written).toBe(1);
    expect(report.kept).toBe(1);
    expect(illustrated.version).toBe(ILLUSTRATED_VERSION);
    expect(illustrated.plates[0]?.vignettes[0]).toEqual({
      node: "n1",
      block: "spya-aaaaaa",
      quote: "minerals at the bottom and angels at the top",
      depicts: "A gilded ladder up the left margin, minerals on the bottom rung.",
      /* Upper-cased on the way in, so the caption in the picture and the caption
         in the reader's row are the same characters. */
      title: "SCALA NATURAE",
    });
  });

  it("drops a vignette whose block the article has not got", () => {
    const { illustrated, report } = readModelBrief(brief([good({ block: "spya-zzzzzz" })]), ONE);
    /* The plate goes with it: nothing anchors it in the article any more. */
    expect(illustrated.plates).toEqual([]);
    expect(report.kept).toBe(0);
    expect(report.faults[0]?.what).toContain("spya-zzzzzz");
  });

  /**
   * **The review finding, made explicit.** The quote below is a real, verbatim,
   * contiguous run of the article's own words — it is just in a different block
   * from the one the vignette names. An article-wide search passes it.
   */
  it("drops a quote that is in the article but not in the block it names", () => {
    const lifted = good({ block: "spya-aaaaaa", quote: "what it is like to be the cup" });
    // The premise: this really is somewhere in the article.
    expect(BLOCKS.get("spya-bbbbbb")).toContain("what it is like to be the cup");

    const { report } = readModelBrief(brief([lifted]), ONE);
    expect(report.kept).toBe(0);
    expect(report.faults[0]?.what).toBe("quote is not in block spya-aaaaaa");
  });

  /**
   * **`"spaced"` and not `"forgiving"`, proved by the case that separates
   * them.** `findQuote`'s forgiving pass deletes whitespace, so *fall a part*
   * would match an article saying *fall apart* — a model that approximated the
   * text, passing as a model that copied it. Change the mode in
   * src/illustrated-plate.ts and this test is the one that goes red; nothing
   * else in this file distinguishes them.
   */
  it("refuses a quote the model re-spaced rather than copied", () => {
    const blocks = new Map<BlockId, string>([
      ["spya-eeeeee", "The consensus was always going to fall apart under its own weight."],
    ]);
    const { report } = readModelBrief(
      brief([good({ block: "spya-eeeeee", quote: "going to fall a part under its own weight" })]),
      { blockText: blocks, sceneIds: ["overview"] },
    );
    expect(report.kept).toBe(0);
    expect(report.faults[0]?.what).toBe("quote is not in block spya-eeeeee");
  });

  it('drops a quote under the floor, so "the" cannot match everything', () => {
    const { report } = readModelBrief(
      brief([good({ quote: "the" }), good({ quote: "at the top and" })]),
      ONE,
    );
    expect(report.written).toBe(2);
    expect(report.kept).toBe(0);
    /* Five: both vignettes, then the plate that had nothing left anchoring it,
       then the scene that ended up with no plate, then the empty plate set. */
    expect(report.faults).toHaveLength(5);
    expect(report.faults[0]?.what).toContain("floor");
    expect(report.faults[1]?.what).toContain("floor");
  });

  /** The prompt asks for 4–20 words. A "quote" that is a paragraph is not one. */
  it("drops a quote over the twenty words the prompt asks for", () => {
    const long = LADDER.split(/\s+/).slice(0, 21).join(" ");
    const { report } = readModelBrief(brief([good({ quote: long })]), ONE);
    expect(report.kept).toBe(0);
    expect(report.faults[0]?.what).toContain("over the 20");
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
    const { report } = readModelBrief(
      brief([good({ block: "spya-dddddd", quote: "The brain's own account - tie‑breakers and all" })]),
      { blockText: blocks, sceneIds: ["overview"] },
    );
    expect(report.faults).toEqual([]);
    expect(report.kept).toBe(1);
  });

  it("drops a depicts over the cap or carrying a bidi override", () => {
    const { report } = readModelBrief(
      brief([
        good({ depicts: "x".repeat(MAX_DEPICTS_CHARS + 1) }),
        good({ depicts: "A ladder‮ and then the reversed part." }),
      ]),
      ONE,
    );
    expect(report.kept).toBe(0);
    expect(report.faults[0]?.what).toContain("over the");
    expect(report.faults[1]?.what).toContain("control or bidi");
  });

  /**
   * `U+061C` ARABIC LETTER MARK sits outside every range the other bidi
   * controls are in and does the same job as `U+200F`. It passed until the
   * 2026-09-03 review went looking for it.
   */
  it("drops the one bidi control that used to get through", () => {
    const { report } = readModelBrief(brief([good({ depicts: "A ladder؜ reversed." })]), ONE);
    expect(report.kept).toBe(0);
    expect(report.faults[0]?.what).toContain("control or bidi");
  });

  /** `node` is optional; rubbish in it is not "optional", it is rubbish. */
  it("drops a vignette whose node id is not one", () => {
    const { report } = readModelBrief(brief([good({ node: "n".repeat(200) })]), ONE);
    expect(report.kept).toBe(0);
    expect(report.faults[0]?.what).toContain("node is");
  });

  it("drops the same vignette written twice", () => {
    const { illustrated, report } = readModelBrief(brief([good(), good()]), ONE);
    expect(illustrated.plates[0]?.vignettes).toHaveLength(1);
    expect(report.written).toBe(2);
    expect(report.kept).toBe(1);
    expect(report.faults[0]?.what).toContain("the same vignette again");
  });

  /**
   * **The finding that made this two functions.** Both fields are storage's,
   * and `sha256` names a blob in a store shared by every article this app has
   * ever drawn.
   */
  it("refuses a brief that claims an image or a failure, and loses the whole plate", () => {
    for (const forged of [{ image: IMAGE }, { failed: "anything" }, { image: IMAGE, failed: "x" }]) {
      const { illustrated, report } = readModelBrief(brief([good()], forged), ONE);
      expect(illustrated.plates).toEqual([]);
      expect(report.faults.map((f) => f.what)).toContain(
        "a brief may not name an image or a failure — the whole plate is dropped",
      );
    }
  });

  /**
   * **The anchor floor.** This mode's whole claim is that the picture comes
   * from the article; a plate whose every anchor was dropped is a picture of
   * nothing, and drawing it spends money to find that out.
   */
  it("does not draw a plate every one of whose vignettes was dropped", () => {
    const { illustrated, report } = readModelBrief(brief([good({ block: "spya-nope00" })]), ONE);
    expect(illustrated.plates).toEqual([]);
    expect(report.faults.map((f) => f.what)).toContain("no vignette survived — nothing anchors this plate");
  });

  it("faults a brief with no plates in it at all", () => {
    const { report } = readModelBrief({ style: "An illuminated page.", plates: [] }, ONE);
    expect(report.faults.map((f) => f.what)).toContain(
      "no plate survived — there is nothing to draw",
    );
  });

  /**
   * **Order is the Sketch's.** Given the model's list in the wrong order the
   * overview would otherwise be drawn second — and the *zoom* plate would become
   * the style reference every later plate is drawn against, which is a silent
   * reordering of the whole run.
   */
  it("puts the plates back in the Sketch's order, whatever order the model wrote them in", () => {
    const raw = {
      style: "An illuminated page.",
      plates: [
        { sceneId: "zoom-1", title: "Half", prompt: "The second page.", vignettes: [good()] },
        { sceneId: "overview", title: "All", prompt: "The first page.", vignettes: [good()] },
      ],
    };
    const { illustrated, report } = readModelBrief(raw, OPTS);
    expect(illustrated.plates.map((p) => p.sceneId)).toEqual(["overview", "zoom-1"]);
    expect(report.faults).toEqual([]);
  });

  it("drops a plate for a scene the Sketch has not got, and says which", () => {
    const raw = {
      style: "An illuminated page.",
      plates: [
        { sceneId: "overview", title: "All", prompt: "The first page.", vignettes: [good()] },
        { sceneId: "zoom-9", title: "Nowhere", prompt: "A page of nothing.", vignettes: [good()] },
      ],
    };
    const { illustrated, report } = readModelBrief(raw, OPTS);
    expect(illustrated.plates.map((p) => p.sceneId)).toEqual(["overview"]);
    expect(report.faults.map((f) => f.what)).toContain(
      'no scene in the Sketch has the id "zoom-9" — not drawn',
    );
    /* And the scene nothing was written for is a fault of its own. */
    expect(report.faults.map((f) => f.where)).toContain("zoom-1");
    /* The report is reconcilable against what came back — the vignette on the
       dropped plate is `written` and not `kept`. */
    expect(report.written).toBe(2);
    expect(report.kept).toBe(1);
    expect(report.kept).toBe(
      illustrated.plates.reduce((n, p) => n + p.vignettes.length, 0),
    );
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
        // A second plate of a scene already read.
        { sceneId: "overview", title: "Again", prompt: "A second vellum page.", vignettes: [] },
      ],
    };
    const { illustrated, report } = readModelBrief(raw, OPTS);
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
      /* The scene the model wrote a plate for and then lost it. */
      "zoom-1",
    ]);
  });

  /** A title is decoration, so it does not cost the plate — and the repair is reported. */
  it("keeps a plate with an unusable title, and says the title went", () => {
    const { illustrated, report } = readModelBrief(
      brief([good()], { title: "t".repeat(500) }),
      ONE,
    );
    expect(illustrated.plates[0]?.title).toBe("");
    expect(report.faults[0]?.what).toContain("the plate is nameless");
  });

  /**
   * **Caption every drawn vignette, or none** — the half of the rule that lives
   * in the reader, and the one that can only be enforced here.
   *
   * The one thing `google/gemini-3.1-flash-image` misspelt across the whole
   * 2026-09-04 spike was a word nobody supplied: given a composition drawing
   * eleven things and a caption list naming ten, it lettered the eleventh
   * itself, and `MALL TISSUE BLOB` — `SMALL` with its first letter eaten — is
   * the only wrong string in 111. A dropped vignette makes exactly that gap,
   * because the composition prose still describes the thing it was written to
   * draw, so the plate goes out with an uncaptioned scene on it.
   *
   * By the time `imagePrompt` sees the plate the drop is gone and the count is
   * unrecoverable, which is why the decision is here.
   */
  describe("caption every drawn vignette, or none", () => {
    /**
     * **The dropped vignette keeps its caption, and that is the whole
     * correction.** The first version of this rule stripped every title from a
     * plate that lost one — and the plate came back lettered anyway, because
     * the brief model writes its titles into the composition prose as well.
     * Measured 2026-09-04 on a real run: ten of eleven scenes lettered
     * correctly, and one caption repeated on the twelfth. So the list covers
     * what was **drawn**, which includes the drop.
     */
    it("captions the vignette that was dropped, because it is still drawn", () => {
      const { illustrated } = readModelBrief(
        brief([
          good({ title: "The Ladder" }),
          good({ block: "spya-bbbbbb", quote: "not a sentence in that block at all", title: "The Cup" }),
        ]),
        ONE,
      );
      const plate = illustrated.plates[0];
      /* The reader's list is the survivors — the drop protects the navigation. */
      expect(plate?.vignettes).toHaveLength(1);
      expect(plate?.vignettes[0]?.quote).toBe("minerals at the bottom and angels at the top");
      /* The illustrator's list is what is on the page. */
      expect(plate?.lettering?.map((c) => c.title)).toEqual(["THE LADDER", "THE CUP"]);
      /* Each bound to its own scene, because a floating title is untested. */
      expect(plate?.lettering?.[0]?.where).toContain("A gilded ladder");
    });

    it("letters nothing at all when one vignette simply has no title", () => {
      const { illustrated, report } = readModelBrief(
        brief([good({ title: "The Ladder" }), good({ block: "spya-bbbbbb", quote: JAR_QUOTE, title: undefined })]),
        ONE,
      );
      const plate = illustrated.plates[0];
      expect(plate?.lettering).toBeUndefined();
      /* And the reader's rows lose their captions with it, so the row never
         shows a word that is not on the picture. */
      expect(plate?.vignettes).toHaveLength(2);
      expect(plate?.vignettes.map((v) => v.title)).toEqual([undefined, undefined]);
      expect(report.faults.map((f) => f.what).join(" ")).toContain("no lettering at all");
    });

    it("keeps them all when nothing was dropped and every vignette has one", () => {
      const { illustrated, report } = readModelBrief(
        brief([good({ title: "The Ladder" }), good({ block: "spya-bbbbbb", quote: CUP_QUOTE, title: "The Cup" })]),
        ONE,
      );
      expect(illustrated.plates[0]?.vignettes.map((v) => v.title)).toEqual([
        "THE LADDER",
        "THE CUP",
      ]);
      expect(illustrated.plates[0]?.lettering?.map((c) => c.title)).toEqual([
        "THE LADDER",
        "THE CUP",
      ]);
      expect(report.faults).toEqual([]);
    });

    /**
     * **A stored artefact is exempt, and that is not an oversight.** Its
     * pictures are painted and the captions are in the pixels; a re-read drops
     * vignettes because block ids moved under a re-extracted article, which has
     * nothing to do with what was drawn. Stripping there would take the caption
     * out of the reader's row while it was still on the plate in front of them.
     */
    it("leaves a stored plate's titles alone when a re-read drops a vignette", () => {
      const { illustrated } = readStoredIllustrated(
        brief(
          [good({ title: "The Ladder" }), good({ block: "spya-nope00", title: "The Cup" })],
          { image: IMAGE },
        ),
        ONE,
      );
      expect(illustrated.plates[0]?.vignettes.map((v) => v.title)).toEqual(["THE LADDER"]);
      /* **And no caption list is invented for it.** What was really asked of
         the illustrator included the vignette this re-read just dropped;
         rebuilding the list from the survivors would produce a shorter one and
         call it the record. Nothing on this path reads it. */
      expect(illustrated.plates[0]?.lettering).toBeUndefined();
    });

    /**
     * **Characters, not words**, and the difference was measured. A four-word
     * cap sat here for one afternoon and cost two whole plates every caption
     * they had, over `ALL ROADS TO HUGGING FACE` and `HUGGING FACE HOLDS THE
     * ANSWER` — 25 and 29 characters, both of which letter perfectly. Words are
     * a proxy; the character count is the thing that decides whether a caption
     * fits under a small scene.
     */
    it("lets a five-word title through, and refuses one too long to letter", () => {
      const fine = readModelBrief(brief([good({ title: "all roads to hugging face" })]), ONE);
      expect(fine.illustrated.plates[0]?.lettering?.[0]?.title).toBe("ALL ROADS TO HUGGING FACE");
      expect(fine.report.faults).toEqual([]);

      const long = readModelBrief(brief([good({ title: "t".repeat(41) })]), ONE);
      expect(long.illustrated.plates[0]?.lettering).toBeUndefined();
      expect(long.illustrated.plates[0]?.vignettes[0]?.title).toBeUndefined();
      expect(long.report.faults.map((f) => f.what).join(" ")).toContain("over the 40 cap");
    });

    /** A caption in the picture and a caption in the row must be one string. */
    it("upper-cases the title once, where both readers of it will see the same one", () => {
      const { illustrated } = readModelBrief(brief([good({ title: "Face in the bun" })]), ONE);
      expect(illustrated.plates[0]?.vignettes[0]?.title).toBe("FACE IN THE BUN");
    });
  });

  it("hands back an empty brief rather than throwing on rubbish", () => {
    for (const raw of [null, 42, "a string", []]) {
      const { illustrated, report } = readModelBrief(raw, ONE);
      expect(illustrated.plates).toEqual([]);
      expect(report.faults.length).toBeGreaterThan(0);
    }
  });

  /**
   * **A cap on the work, not only on the output.** Parsing runs `findQuote`
   * over every vignette of every plate, and it runs in the browser. A stored
   * artefact claiming thousands of either would otherwise be an afternoon's
   * work before a single one was rejected.
   */
  it("stops reading long before a hostile artefact stops offering", () => {
    const plates = Array.from({ length: MAX_PLATES_READ + 3 }, (_, i) => ({
      sceneId: i === 0 ? "overview" : `zoom-${i}`,
      title: "A plate",
      prompt: "A vellum page.",
      vignettes: Array.from({ length: MAX_VIGNETTES + 5 }, (_, j) => good({ node: `n${j}` })),
    }));
    const { report } = readModelBrief({ style: "A page.", plates }, ONE);
    expect(report.faults.map((f) => f.what)).toContain(
      `3 plate(s) past the ${MAX_PLATES_READ} cap were not read`,
    );
    expect(report.faults.map((f) => f.what)).toContain(
      `5 vignette(s) past the ${MAX_VIGNETTES} cap were not read`,
    );
  });
});

describe("readStoredIllustrated", () => {
  /**
   * A stored artefact goes back through a reader with the same checks — that is
   * what makes the browser's revalidation the same check as the server's,
   * rather than a second, looser one. What differs is only what a model may
   * say.
   */
  it("round-trips an artefact, keeping its image record and provenance", () => {
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
          image: IMAGE,
        },
        {
          sceneId: "zoom-1",
          title: "Half of it",
          prompt: "Another vellum page.",
          vignettes: [good() as never],
          failed: "the illustrator could not be reached",
        },
      ],
    };
    const { illustrated, report } = readStoredIllustrated(stored, OPTS);
    expect(report.faults).toEqual([]);
    expect(illustrated.plates[0]?.image?.sha256).toBe(IMAGE.sha256);
    expect(illustrated.plates[1]?.failed).toBe("the illustrator could not be reached");
    expect(illustrated.profileHash).toBeNull();
    expect(illustrated.generator).toBe("anthropic/claude-sonnet-5");
  });

  /** A state no run produces. The picture claim is the dangerous half. */
  it("drops the picture from a plate that claims both a picture and a failure", () => {
    const { illustrated, report } = readStoredIllustrated(
      brief([good()], { image: IMAGE, failed: "the illustrator could not be reached" }),
      ONE,
    );
    expect(illustrated.plates[0]?.image).toBeUndefined();
    expect(illustrated.plates[0]?.failed).toBe("the illustrator could not be reached");
    expect(report.faults[0]?.what).toContain("the picture is dropped");
  });

  it("refuses an image record whose numbers are not numbers of a picture", () => {
    for (const image of [
      { ...IMAGE, width: 1024.5 },
      { ...IMAGE, height: 40_000 },
      { ...IMAGE, bytes: 64 * 1024 * 1024 },
      { ...IMAGE, sha256: "not-a-hash" },
      /* **`png` is a plate now and `gif` is not**, which is the point of the
         closed set: `ext` reaches `canonicalKey` and the `Content-Type` header,
         so a third value would be a lookup miss or a lie about the bytes.
         src/illustrated-plate.ts § `readImage`. */
      { ...IMAGE, ext: "gif" },
      { ...IMAGE, ext: "webp" },
    ]) {
      const { illustrated, report } = readStoredIllustrated(brief([good()], { image }), ONE);
      expect(illustrated.plates[0]?.image, JSON.stringify(image)).toBeUndefined();
      expect(report.faults[0]?.what).toContain("the image record is not one");
    }
  });

  /**
   * **PNG is a plate too, since 2026-09-04.** The illustrator changed to one
   * that ignores `output_format` and returns PNG whatever it is asked, so an
   * article now holds records of both kinds — and every reader of one, the
   * route and the panel included, takes the extension from the record rather
   * than assuming. A reader that still hard-coded `"jpeg"` would drop every
   * plate the current illustrator has painted, silently, as "no picture yet".
   */
  it("reads back a PNG plate record as readily as a JPEG one", () => {
    for (const ext of ["jpeg", "png"] as const) {
      const { illustrated, report } = readStoredIllustrated(
        brief([good()], { image: { ...IMAGE, ext } }),
        ONE,
      );
      expect(illustrated.plates[0]?.image, ext).toEqual({ ...IMAGE, ext });
      expect(report.faults, ext).toEqual([]);
    }
  });

  /**
   * **The one place the two readers disagree about dropping.** Block ids move
   * under an artefact when an article is re-extracted, and a picture that was
   * paid for and exists must not disappear because a quote stopped matching —
   * it loses its rows, and the fault says so.
   */
  it("keeps a paid-for plate whose anchors have stopped matching", () => {
    const { illustrated, report } = readStoredIllustrated(
      brief([good({ block: "spya-nope00" })], { image: IMAGE }),
      ONE,
    );
    expect(illustrated.plates).toHaveLength(1);
    expect(illustrated.plates[0]?.vignettes).toEqual([]);
    expect(illustrated.plates[0]?.image?.sha256).toBe(IMAGE.sha256);
    expect(report.faults.map((f) => f.what)).toContain(
      "no vignette survived — the picture has no rows under it",
    );
  });
});
