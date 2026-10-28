/**
 * **The Explanations step's pure half, and the one request it sends** —
 * docs/plans/261028c-explanations-of-confusing-passages-and-sources-feeding-the-margin.md
 * § The step.
 *
 * Every case is a way the step would be wrong quietly. An explanation beside
 * words the article never printed, or beside words it printed twice so a later
 * underline cannot tell which, looks exactly like one that works
 * (docs/reusable/silent-success.md). So what is pinned is what has no visible
 * symptom: the words stored are the article's; a quote that is ambiguous in its
 * block is gone; the caps hold; the empty outcomes are different answers; the
 * profile reaches the user message and the stamp and nowhere else.
 */
import path from "node:path";

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { Article } from "../src/article-input.js";
import { cascadeForce } from "../src/jobs.js";
import { CAPABLE_MODEL } from "../src/models.js";
import { FORCE_ONLY_WHEN_NAMED, STEP_ORDER, sharesArticleCache } from "../src/pipeline.js";
import { hashProfile, PROFILE_RULES } from "../src/profile.js";
import { articleWithIdsFingerprint } from "../src/source-hash.js";
import { SHAPE } from "../src/store/artifacts.js";
import type { Block } from "../src/types.js";
import {
  EXPLANATIONS_OUTPUT_SCHEMA,
  EXPLANATIONS_SYSTEM,
  MAX_QUOTE_CHARS,
  MAX_WORDS,
  PROMPT_VERSION,
  buildExplanations,
  emptyDropped,
  explanationCap,
  explanationId,
  generateExplanations,
  toExplanations,
} from "../src/explanations.js";
import { paperwork } from "../src/paperwork.js";
import { plainWords } from "../src/plain-words.js";

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

const block = (id: string, text: string, kind: Block["kind"] = "text"): Block => ({
  id,
  tag: "p",
  kind,
  text,
  words: text.split(/\s+/).length,
  html: `<p>${text}</p>`,
  gistable: true,
});

const A = block(
  "spya-aaaaaa",
  "The energy is minimised over the latent variable, so the model never sees z directly.",
);
const B = block(
  "spya-bbbbbb",
  "A fridge can lower its local entropy only by exporting more to its surroundings.",
);
const C = block(
  "spya-cccccc",
  "The cost is high. The cost is high, and the author does not say why it matters.",
);
const body: Block[] = [A, B, C];

const item = (
  blockId: string,
  quote: string,
  text = "The model is not given z; it tries every value and keeps the best fit.",
  extra: { sure?: unknown; outside?: unknown } = {},
) => ({ blockId, quote, text, sure: true, outside: false, ...extra });

const opts = (overrides: Partial<Parameters<typeof buildExplanations>[1]> = {}) => ({
  slug: "s",
  blocks: body,
  sourceHash: "h",
  power: "standard" as const,
  profileHash: null,
  elapsedMs: 1,
  dropped: emptyDropped(),
  ...overrides,
});

/* --------------------------------------------------------------- helpers -- */

describe("explanationCap", () => {
  it("is one per six paragraphs, at least three and at most fifteen", () => {
    expect(explanationCap(0)).toBe(3);
    expect(explanationCap(6)).toBe(3);
    expect(explanationCap(24)).toBe(4);
    expect(explanationCap(25)).toBe(5);
    expect(explanationCap(1_000)).toBe(15);
  });
});

describe("explanationId", () => {
  it("is stable for the same block and words, and different otherwise", () => {
    expect(explanationId(A.id, "latent variable")).toBe(explanationId(A.id, "latent variable"));
    expect(explanationId(A.id, "latent variable")).not.toBe(explanationId(B.id, "latent variable"));
    expect(explanationId(A.id, "latent variable")).not.toBe(explanationId(A.id, "the latent variable"));
    expect(explanationId(A.id, "x")).toMatch(/^[0-9a-f]{16}$/);
  });
});

/* -------------------------------------------------------- the checks -- */

describe("an explanation is kept only if the article backs it up", () => {
  it("keeps a valid one, storing the article's characters, not the model's", () => {
    const d = emptyDropped();
    /* Extra spaces at the ends and a different case: findQuote's spaced pass
       finds it, and what is stored is the block's own slice. */
    const [kept, ...rest] = toExplanations(
      [item(A.id, "  minimised over the LATENT variable ")],
      body,
      15,
      d,
    );
    expect(rest).toEqual([]);
    expect(kept).toEqual({
      id: explanationId(A.id, "minimised over the latent variable"),
      blockId: A.id,
      quote: "minimised over the latent variable",
      text: "The model is not given z; it tries every value and keeps the best fit.",
      sure: true,
      outside: false,
    });
    expect(d).toEqual(emptyDropped());
  });

  it("keeps `sure` and `outside` as the model set them", () => {
    const [kept] = toExplanations(
      [item(A.id, "latent variable", "Unsure whether z is discrete; the piece never says.", { sure: false, outside: true })],
      body,
      15,
      emptyDropped(),
    );
    expect(kept).toMatchObject({ sure: false, outside: true });
  });

  it("drops an id that is not a body block", () => {
    const d = emptyDropped();
    expect(toExplanations([item("spya-zzzzzz", "latent variable")], body, 15, d)).toEqual([]);
    expect(d.unknownIds).toBe(1);
  });

  it("drops a quote that is not in the block it names", () => {
    const d = emptyDropped();
    /* In B, not A. */
    expect(toExplanations([item(A.id, "exporting more to its surroundings")], body, 15, d)).toEqual([]);
    expect(d.unquoted).toBe(1);
  });

  it("drops a quote that occurs more than once in its block", () => {
    const d = emptyDropped();
    expect(toExplanations([item(C.id, "The cost is high")], body, 15, d)).toEqual([]);
    expect(d.ambiguous).toBe(1);
    /* Case and spacing do not make two occurrences into one. */
    expect(toExplanations([item(C.id, "the COST  is high")], body, 15, emptyDropped())).toEqual([]);
    /* More words make it unique, and then it is kept. */
    const kept = toExplanations([item(C.id, "The cost is high, and the author")], body, 15, emptyDropped());
    expect(kept).toHaveLength(1);
  });

  it("drops an over-long quote rather than cutting it", () => {
    const long = block("spya-dddddd", `${"word ".repeat(80)}end.`);
    const d = emptyDropped();
    expect(toExplanations([item(long.id, long.text)], [long], 15, d)).toEqual([]);
    expect(long.text.length).toBeGreaterThan(MAX_QUOTE_CHARS);
    expect(d.tooLong).toBe(1);
  });

  it("drops a text over the word limit, and an empty one", () => {
    const d = emptyDropped();
    const tooMany = Array.from({ length: MAX_WORDS + 1 }, (_, i) => `w${i}`).join(" ");
    const exactly = Array.from({ length: MAX_WORDS }, (_, i) => `w${i}`).join(" ");
    expect(toExplanations([item(A.id, "latent variable", tooMany)], body, 15, d)).toEqual([]);
    expect(toExplanations([item(B.id, "local entropy", "   ")], body, 15, d)).toEqual([]);
    expect(d.badText).toBe(2);
    expect(toExplanations([item(A.id, "latent variable", exactly)], body, 15, emptyDropped())).toHaveLength(1);
  });

  it("drops a row whose labels are not booleans, or which is not an object", () => {
    const d = emptyDropped();
    expect(
      toExplanations([item(A.id, "latent variable", undefined, { sure: "yes" }), null, "x"], body, 15, d),
    ).toEqual([]);
    expect(d.malformed).toBe(3);
  });

  it("keeps one per block, the first", () => {
    const d = emptyDropped();
    const kept = toExplanations(
      [item(A.id, "latent variable", "First."), item(A.id, "never sees z directly", "Second.")],
      body,
      15,
      d,
    );
    expect(kept.map((e) => e.text)).toEqual(["First."]);
    expect(d.repeated).toBe(1);
  });

  it("applies the cap after every other rule, in the model's order, then stores in reading order", () => {
    const d = emptyDropped();
    const kept = toExplanations(
      [
        item("spya-zzzzzz", "nothing"),
        item(C.id, "the author does not say why", "C."),
        item(B.id, "local entropy", "B."),
        item(A.id, "latent variable", "A."),
      ],
      body,
      2,
      d,
    );
    /* The invented id did not use a slot; A was third valid and is over the cap. */
    expect(kept.map((e) => e.text)).toEqual(["B.", "C."]);
    expect(d.unknownIds).toBe(1);
    expect(d.overCap).toBe(1);
  });
});

/* -------------------------------------------------------- the artefact -- */

describe("the artefact", () => {
  it("is stored with its stamp, its drops and when it was made", () => {
    const o = opts({ profileHash: "p" });
    o.dropped.unknownIds = 0;
    const made = buildExplanations(
      { explanations: [item(A.id, "latent variable"), item("spya-zzzzzz", "x")] },
      o,
    );
    expect(made.version).toBe(PROMPT_VERSION);
    expect(made.generator).toBe(CAPABLE_MODEL);
    expect(made.sourceHash).toBe("h");
    expect(made.profileHash).toBe("p");
    expect(made.explanations).toHaveLength(1);
    expect(made.dropped.unknownIds).toBe(1);
    expect(Number.isNaN(Date.parse(made.generatedAt))).toBe(false);
    expect(SHAPE.explanations.field).toBe("explanations");
    expect(SHAPE.explanations.ok(made.explanations)).toBe(true);
  });

  it("caps from the body's paragraphs", () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      block(`spya-p${String(i).padStart(5, "0")}`, `Paragraph number ${i} says something odd.`),
    );
    const made = buildExplanations(
      { explanations: many.map((b) => item(b.id, "says something odd")) },
      opts({ blocks: many }),
    );
    expect(made.explanations).toHaveLength(explanationCap(30));
    expect(made.dropped.overCap).toBe(30 - explanationCap(30));
  });

  it("an empty list is a real answer", () => {
    const made = buildExplanations({ explanations: [] }, opts());
    expect(made.explanations).toEqual([]);
  });

  it("no list at all is a failed answer", () => {
    expect(() => buildExplanations({}, opts())).toThrow(/no `explanations` array/);
  });

  it("fails, with the counts, when the model wrote some and every one was dropped", () => {
    expect(() =>
      buildExplanations(
        { explanations: [item("spya-zzzzzz", "x"), item(C.id, "The cost is high")] },
        opts(),
      ),
    ).toThrow(/wrote 2 explanations and none.*1 naming a block.*1 whose words occur more than once/);
  });
});

/* -------------------------------------------------------- the prompt -- */

describe("the prompt and schema", () => {
  it("carries the shared rules", () => {
    expect(EXPLANATIONS_SYSTEM).toContain(plainWords("explain"));
    expect(EXPLANATIONS_SYSTEM).toContain(paperwork("pick"));
    expect(EXPLANATIONS_SYSTEM).toContain(PROFILE_RULES);
  });

  it("has no block-id enum, and requires every field", () => {
    const json = JSON.stringify(EXPLANATIONS_OUTPUT_SCHEMA);
    expect(json).not.toContain("enum");
    const items = EXPLANATIONS_OUTPUT_SCHEMA.properties.explanations.items;
    expect([...items.required].sort()).toEqual(["blockId", "outside", "quote", "sure", "text"]);
  });
});

/* ------------------------------------------------------------ the request -- */

let example: Article;
beforeAll(async () => {
  const { readArticleFromDir } = await import("./helpers/article-from-dir.js");
  example = await readArticleFromDir(path.resolve(import.meta.dirname, "..", "example"));
});

describe("the request", () => {
  const quotableIn = (article: Article) => {
    const quotable = article.blocks.find((b) => b.text.split(/\s+/).length > 12);
    if (!quotable) throw new Error("the fixture has no block long enough to quote");
    return { quotable, words: quotable.text.split(/\s+/).slice(2, 10).join(" ") };
  };

  it("is Ideas' article block up to the breakpoint, and hashes the real null meta", async () => {
    const article: Article = { ...example, meta: null };
    const { quotable, words } = quotableIn(article);
    answer = JSON.stringify({ explanations: [item(quotable.id, words, "The step skipped here is this.")] });
    const run = await generateExplanations({ power: "standard", article, cacheArticle: true, profile: null });

    /* Only Ideas' request is wanted; its answer to an empty list is its own business. */
    answer = JSON.stringify({ ideas: [] });
    const { generateIdeas } = await import("../src/ideas.js");
    await generateIdeas({ power: "standard", article, previous: null, cacheArticle: true }).catch(
      () => undefined,
    );

    const [call, ideasCall] = sent;
    if (!call || !ideasCall) throw new Error("expected both calls");
    expect(call.task).toBe("explanations");
    const system = (c: (typeof sent)[number]) => (c.body as { system: unknown[] }).system;
    expect(system(call)[0]).toEqual(system(ideasCall)[0]);
    expect(system(call)[0]).toMatchObject({ cache_control: { type: "ephemeral" } });
    expect(system(call)[1]).toEqual({ type: "text", text: EXPLANATIONS_SYSTEM });

    expect(run.explanations.sourceHash).toBe(articleWithIdsFingerprint(article.blocks, article.tree, null));
    expect(run.explanations.profileHash).toBeNull();
    expect(run.explanations.explanations).toHaveLength(1);
    expect(run.explanations.explanations[0]?.quote).toBe(words);
    expect(JSON.stringify((call.body as { messages: unknown }).messages)).not.toContain("WHO IS READING");
  });

  it("puts the profile in the user message, never the system, and its hash in the stamp", async () => {
    const { quotable, words } = quotableIn(example);
    const profile = "A cardiologist reading outside her field, after the main argument.";
    answer = JSON.stringify({ explanations: [item(quotable.id, words, "Here is the missing step.")] });
    const run = await generateExplanations({ power: "standard", article: example, profile });
    const [call] = sent;
    if (!call) throw new Error("no call");
    const body = call.body as { system: { text: string }[]; messages: { content: string }[] };
    expect(body.messages[0]?.content).toContain(profile);
    expect(body.system.map((s) => s.text).join("\n")).not.toContain(profile);
    expect(run.explanations.profileHash).toBe(hashProfile(profile));
  });

  it("shares no cached article with another stage, its schema being its own", () => {
    expect(sharesArticleCache("explanations", ["ideas", "faq", "relations"])).toBe(false);
  });
});

describe("forcing", () => {
  it("is not swept in by an earlier forced step", () => {
    expect(FORCE_ONLY_WHEN_NAMED.has("explanations")).toBe(true);
    expect(cascadeForce([...STEP_ORDER], new Set(["fetch"])).has("explanations")).toBe(false);
    expect(cascadeForce(["faq", "explanations"], new Set(["explanations"])).has("explanations")).toBe(true);
  });
});
