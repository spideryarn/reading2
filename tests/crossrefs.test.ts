/**
 * **The crossrefs stage's pure half, and the one request it sends** —
 * docs/plans/260930f-cross-reference-links-between-blocks-with-a-rich-hover-preview.md.
 *
 * Every rule in the plan's validation table has a case here, and each one is a
 * way the stage would be wrong quietly: a link the prose cannot place, or one
 * it places on the wrong words, looks exactly like a link that works
 * (docs/reusable/silent-success.md). Then the three root cases — a missing
 * list, an empty one, and one validation empties — which are three different
 * answers.
 */
import path from "node:path";

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { Article } from "../src/article-input.js";
import { SHAPE } from "../src/store/artifacts.js";
import type { Block, CrossrefsDropped } from "../src/types.js";
import {
  CROSSREFS_SYSTEM,
  MAX_LINKS,
  PROMPT_VERSION,
  buildCrossrefs,
  emptyDropped,
  generateCrossrefs,
  inputFingerprint,
  linkCap,
} from "../src/crossrefs.js";
import { STAGE_EFFORT } from "../src/models.js";

/* ------------------------------------------------------- the stubbed model -- */

let answer = "";
const sent: { task: string; body: unknown }[] = [];

vi.mock("../src/messages-stream.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/messages-stream.js")>();
  return {
    ...real,
    streamMessage: (task: string, body: unknown) => {
      sent.push({ task, body: JSON.parse(JSON.stringify(body)) });
      const message = {
        id: "msg_stub",
        type: "message",
        role: "assistant",
        model: "stub",
        content: [{ type: "text", text: answer, citations: null }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      };
      return {
        onText: () => undefined,
        aborted: () => false,
        finalMessage: () => Promise.resolve(message),
      };
    },
  };
});

beforeEach(() => {
  answer = "";
  sent.length = 0;
});

/* --------------------------------------------------------------- fixtures -- */

const block = (id: string, text: string, html = `<p>${text}</p>`): Block => ({
  id,
  tag: "p",
  kind: "text",
  text,
  words: text.split(/\s+/).length,
  html,
  gistable: true,
});

/* Twelve blocks in document order, eleven of them body (the last is a
   supplement the model is never shown), so the cap is `max(3, round(11 / 4))` = 3. */
const ABSTRACT = block(
  "spya-aaaaa0",
  "We find that sleep loss reduced recall by 38% in older adults, and that the effect held after one night.",
);
const INTRO = block("spya-aaaaa1", "Memory depends on sleep in ways that are still being mapped.");
const METHOD_A = block("spya-aaaaa2", "Participants over 60 slept in the lab for two nights.");
const METHOD_B = block("spya-aaaaa3", "Recall was measured with a list of forty words.");
const RESULT_A = block(
  "spya-aaaaa4",
  "Participants over 60 recalled 38% fewer words after one night without sleep.",
);
const RESULT_B = block("spya-aaaaa5", "The second experiment repeated this with younger adults.");
const RESULT_C = block("spya-aaaaa6", "Younger adults showed a smaller loss of 12%.");
const DISCUSSION = block(
  "spya-aaaaa7",
  "As the second experiment showed, age changes the size of the effect, and the effect is the effect.",
);
/* Its html carries the sentence twice — a hidden duplicate — so it occurs ONCE
   in `block.text` and TWICE in the rendered text the prose marks in. */
const HIDDEN = block(
  "spya-aaaaa8",
  "Recovery sleep restored most of the loss.",
  '<p>Recovery sleep restored most of the loss.<span style="display:none">Recovery sleep restored most of the loss.</span></p>',
);
const LIMITS = block("spya-aaaaa9", "The sample was small and mostly from one city.");
const FUTURE = block("spya-aaaab0", "Longer studies are needed.");
const NOTE: Block = {
  ...block("spya-aaaab1", "Funded by a grant from the sleep council."),
  treatment: "supplement",
};
const blocks: Block[] = [
  ABSTRACT,
  INTRO,
  METHOD_A,
  METHOD_B,
  RESULT_A,
  RESULT_B,
  RESULT_C,
  DISCUSSION,
  HIDDEN,
  LIMITS,
  FUTURE,
  NOTE,
];

const link = (from: string, phrase: unknown, to: string) => ({ from, phrase, to });

function build(links: unknown, dropped: CrossrefsDropped = emptyDropped()) {
  return buildCrossrefs(
    { links },
    { slug: "sleep", blocks, sourceHash: "h", elapsedMs: 1, power: "standard", dropped },
  );
}

/* A valid link to pad a list with, so a single drop does not empty the answer. */
const GOOD = link(ABSTRACT.id, "reduced recall by 38%", RESULT_A.id);

/* ------------------------------------------------------------- the table -- */

describe("every rule in the table is enforced, each with its counter", () => {
  it("keeps a good link, and stores the article's characters rather than the model's", () => {
    const d = emptyDropped();
    const out = build([link(ABSTRACT.id, "Reduced Recall by 38%", RESULT_A.id)], d);
    expect(out.links).toEqual([{ from: ABSTRACT.id, phrase: "reduced recall by 38%", to: RESULT_A.id }]);
    expect(d).toEqual(emptyDropped());
  });

  it("matches decoded entities and phrases split across inline markup", () => {
    const marked = block(
      ABSTRACT.id,
      "We found reduced recall by 38% & a lasting change.",
      "<p>We found <em>reduced recall</em> by 38% &amp; a lasting change.</p>",
    );
    const d = emptyDropped();
    const out = buildCrossrefs(
      { links: [link(marked.id, "Reduced recall by 38% & a lasting", RESULT_A.id)] },
      {
        slug: "marked",
        blocks: blocks.map((b) => (b.id === marked.id ? marked : b)),
        sourceHash: "h",
        elapsedMs: 1, power: "standard",
        dropped: d,
      },
    );

    expect(out.links).toEqual([
      { from: marked.id, phrase: "reduced recall by 38% & a lasting", to: RESULT_A.id },
    ]);
    expect(d).toEqual(emptyDropped());
  });

  it("does not invent spacing for a line break the DOM does not put in textContent", () => {
    const broken = block(
      ABSTRACT.id,
      "We found reduced recall by 38% in older adults.",
      "<p>We found reduced recall<br>by 38% in older adults.</p>",
    );
    const d = emptyDropped();
    const out = buildCrossrefs(
      {
        links: [
          link(DISCUSSION.id, "the second experiment showed", RESULT_B.id),
          link(broken.id, "reduced recall by 38%", RESULT_A.id),
        ],
      },
      {
        slug: "line-break",
        blocks: blocks.map((b) => (b.id === broken.id ? broken : b)),
        sourceHash: "h",
        elapsedMs: 1, power: "standard",
        dropped: d,
      },
    );

    expect(out.links).toEqual([
      { from: DISCUSSION.id, phrase: "the second experiment showed", to: RESULT_B.id },
    ]);
    expect(d.unquoted).toBe(1);
  });

  it("drops a `from` or `to` that is not a block of this article's body → unknownIds", () => {
    const d = emptyDropped();
    const out = build(
      [
        GOOD,
        link("spya-zzzzzz", "reduced recall by 38%", RESULT_A.id),
        link(DISCUSSION.id, "the second experiment showed", "spya-zzzzzz"),
        /* A real block, but a supplement: the model was never shown it. */
        link(ABSTRACT.id, "older adults", NOTE.id),
      ],
      d,
    );
    expect(out.links).toHaveLength(1);
    expect(d.unknownIds).toBe(3);
  });

  it("drops a link to itself, and to the block either side → nearby", () => {
    const d = emptyDropped();
    const out = build(
      [
        GOOD,
        link(RESULT_B.id, "The second experiment repeated", RESULT_B.id),
        link(RESULT_B.id, "The second experiment repeated", RESULT_C.id),
        link(RESULT_B.id, "The second experiment repeated", RESULT_A.id),
      ],
      d,
    );
    expect(out.links).toEqual([GOOD]);
    expect(d.nearby).toBe(3);
  });

  it("drops a phrase under two words or over twelve → length", () => {
    const d = emptyDropped();
    const out = build(
      [
        GOOD,
        link(DISCUSSION.id, "age", RESULT_A.id),
        link(
          ABSTRACT.id,
          "We find that sleep loss reduced recall by 38% in older adults, and",
          RESULT_A.id,
        ),
      ],
      d,
    );
    expect(out.links).toEqual([GOOD]);
    expect(d.length).toBe(2);
  });

  it("keeps a phrase of exactly two and exactly twelve words", () => {
    const d = emptyDropped();
    const out = build(
      [
        link(ABSTRACT.id, "We find that sleep loss reduced recall by 38% in older adults,", RESULT_A.id),
        link(DISCUSSION.id, "second experiment", RESULT_B.id),
      ],
      d,
    );
    expect(out.links).toHaveLength(2);
    expect(d.length).toBe(0);
  });

  it("drops a phrase that is not in `from` — even when it is in another block → unquoted", () => {
    const d = emptyDropped();
    const out = build(
      [
        GOOD,
        /* In RESULT_C, not in DISCUSSION. (RESULT_C is DISCUSSION's neighbour, so
           the target is another block, or `nearby` would catch it first.) */
        link(DISCUSSION.id, "a smaller loss of 12%", RESULT_A.id),
        /* A paraphrase. */
        link(DISCUSSION.id, "as experiment two demonstrated", RESULT_B.id),
        /* A word split in two: the forgiving pass would accept it. */
        link(DISCUSSION.id, "the sec ond experiment showed", RESULT_B.id),
      ],
      d,
    );
    expect(out.links).toEqual([GOOD]);
    expect(d.unquoted).toBe(3);
  });

  it("drops a phrase that occurs twice in `from` → ambiguous", () => {
    const d = emptyDropped();
    const out = build([GOOD, link(DISCUSSION.id, "the effect", RESULT_A.id)], d);
    expect(out.links).toEqual([GOOD]);
    expect(d.ambiguous).toBe(1);
  });

  it("counts occurrences in the RENDERED text, not in block.text", () => {
    /* Once in `block.text`, twice in the text the prose marks in. Checking
       `block.text` would keep a link the client could not place. */
    const d = emptyDropped();
    const out = build([GOOD, link(HIDDEN.id, "restored most of the loss", RESULT_A.id)], d);
    expect(out.links).toEqual([GOOD]);
    expect(d.ambiguous).toBe(1);
  });

  it("drops a phrase overlapping an earlier one in the same block; first in document order wins → overlap", () => {
    const d = emptyDropped();
    const out = build(
      [
        /* Listed first by the model, but it starts later in the block. */
        link(ABSTRACT.id, "recall by 38% in older adults", RESULT_A.id),
        link(ABSTRACT.id, "sleep loss reduced recall", METHOD_B.id),
        /* The same words again. */
        link(ABSTRACT.id, "sleep loss reduced recall", METHOD_B.id),
        /* Touching but not overlapping is fine. */
        link(ABSTRACT.id, "We find that", RESULT_A.id),
      ],
      d,
    );
    expect(out.links).toEqual([
      { from: ABSTRACT.id, phrase: "We find that", to: RESULT_A.id },
      { from: ABSTRACT.id, phrase: "sleep loss reduced recall", to: METHOD_B.id },
    ]);
    expect(d.overlap).toBe(2);
  });

  it("keeps at most the cap, in the model's order, and counts the rest → truncated", () => {
    expect(linkCap(11)).toBe(3);
    const d = emptyDropped();
    const out = build(
      [
        link(DISCUSSION.id, "the second experiment showed", RESULT_B.id),
        link(LIMITS.id, "The sample was small", METHOD_A.id),
        GOOD,
        link(INTRO.id, "Memory depends on sleep", RESULT_A.id),
        link(FUTURE.id, "Longer studies are needed", RESULT_C.id),
      ],
      d,
    );
    expect(out.links.map((l) => l.from)).toEqual([ABSTRACT.id, DISCUSSION.id, LIMITS.id]);
    expect(d.truncated).toBe(2);
  });

  it("the cap is min(60, max(3, round(blocks / 4)))", () => {
    expect(linkCap(0)).toBe(3);
    expect(linkCap(12)).toBe(3);
    expect(linkCap(40)).toBe(10);
    expect(linkCap(99)).toBe(25);
    expect(linkCap(1000)).toBe(MAX_LINKS);
    expect(MAX_LINKS).toBe(60);
  });

  it("drops a row it cannot read → malformed", () => {
    const d = emptyDropped();
    const out = build(
      [
        GOOD,
        null,
        "a string",
        { from: DISCUSSION.id, to: RESULT_B.id },
        link(DISCUSSION.id, 42, RESULT_B.id),
        { from: DISCUSSION.id, phrase: "the second experiment showed", to: 7 },
      ],
      d,
    );
    expect(out.links).toEqual([GOOD]);
    expect(d.malformed).toBe(5);
  });

  it("writes the links in document order, whatever order the model listed them in", () => {
    const out = build([
      link(DISCUSSION.id, "the second experiment showed", RESULT_B.id),
      GOOD,
    ]);
    expect(out.links.map((l) => l.from)).toEqual([ABSTRACT.id, DISCUSSION.id]);
  });
});

/* --------------------------------------------------------- the root cases -- */

describe("three empty outcomes, three different answers", () => {
  it("a missing `links` throws: a failed answer, not an empty one", () => {
    expect(() => buildCrossrefs({}, { slug: "s", blocks, sourceHash: "h", elapsedMs: 1, power: "standard", dropped: emptyDropped() })).toThrow(
      /no `links` array/,
    );
    expect(() => build("not a list")).toThrow(/no `links` array/);
  });

  it("an explicit empty list is kept, as a real answer", () => {
    const out = build([]);
    expect(out.links).toEqual([]);
    expect(out.version).toBe(PROMPT_VERSION);
    expect(SHAPE.crossrefs.ok(out.links)).toBe(true);
  });

  it("a list validation empties throws, with the counts, and writes nothing", () => {
    expect(() =>
      build([
        link("spya-zzzzzz", "reduced recall by 38%", RESULT_A.id),
        link(DISCUSSION.id, "the effect", RESULT_A.id),
      ]),
    ).toThrow(/named 2 links and none of them.*1 naming a block id.*1 whose phrase occurs more than once/);
  });

  it("stores what it dropped on the artefact", () => {
    const out = build([GOOD, link(DISCUSSION.id, "the effect", RESULT_A.id)]);
    expect(out.dropped.ambiguous).toBe(1);
  });
});

/* ------------------------------------------------------------ the request -- */

let example: Article;
beforeAll(async () => {
  const { readArticleFromDir } = await import("./helpers/article-from-dir.js");
  example = await readArticleFromDir(path.resolve(import.meta.dirname, "..", "example"));
});

describe("the request", () => {
  it("does not stale when only supplement or nested-tree data the request omits changes", () => {
    const changed = blocks.map((b) =>
      b.id === NOTE.id ? { ...b, text: "A different funding note the model is never shown." } : b,
    );
    const changedTree = structuredClone(example.tree);
    const nested = Object.values(changedTree.nodes).find((node) => node.depth === 2);
    if (!nested) throw new Error("fixture needs a nested node");
    nested.title = "A hidden nested title";

    expect(inputFingerprint(changed, example.tree, example.meta)).toBe(
      inputFingerprint(blocks, example.tree, example.meta),
    );
    expect(inputFingerprint(blocks, changedTree, example.meta)).toBe(
      inputFingerprint(blocks, example.tree, example.meta),
    );
  });

  it("validates against the maths text the browser will render, not the stored TeX", async () => {
    const maths = block(
      DISCUSSION.id,
      String.raw`The \(x^2\) result supports the claim.`,
      String.raw`<p>The \(x^2\) result supports the claim.</p>`,
    );
    const article: Article = {
      ...example,
      slug: "maths-crossref",
      blocks: blocks.map((b) => (b.id === DISCUSSION.id ? maths : b)),
    };
    answer = JSON.stringify({
      links: [
        GOOD,
        link(maths.id, String.raw`the \(x^2\) result`, RESULT_A.id),
      ],
    });

    const run = await generateCrossrefs({ article, power: "standard" });

    expect(run.crossrefs.links).toEqual([GOOD]);
    expect(run.dropped.unquoted).toBe(1);
  });

  it("sends Ideas' article bytes and an exact request fingerprint, at medium effort, under its own task", async () => {
    const article: Article = { ...example, meta: null };
    answer = JSON.stringify({ links: [] });
    const run = await generateCrossrefs({ article, cacheArticle: true, power: "standard" });

    answer = JSON.stringify({
      ideas: [],
    });
    const { generateIdeas } = await import("../src/ideas.js");
    await generateIdeas({ article, previous: null, cacheArticle: true, power: "standard" }).catch(
      () => undefined,
    );

    const [call, ideasCall] = sent;
    if (!call || !ideasCall) throw new Error("expected both calls");
    expect(call.task).toBe("crossrefs");
    const body = call.body as { system: unknown[]; output_config: { effort: string } };
    expect(body.system[0]).toEqual((ideasCall.body as { system: unknown[] }).system[0]);
    expect(body.system[1]).toEqual({ type: "text", text: CROSSREFS_SYSTEM });
    expect(body.output_config.effort).toBe("medium");
    expect(STAGE_EFFORT.crossrefs).toBe("medium");

    expect(run.crossrefs.sourceHash).toBe(inputFingerprint(article.blocks, article.tree, null));
    expect(run.crossrefs.links).toEqual([]);
  });
});
