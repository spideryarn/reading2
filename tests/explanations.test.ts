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
import { AUTO_MODE_STEPS } from "../src/auto-mode-steps.js";
import { cascadeForce } from "../src/jobs.js";
import { CAPABLE_MODEL } from "../src/models.js";
import { FORCE_ONLY_WHEN_NAMED, STEP_ORDER, sharesArticleCache } from "../src/pipeline.js";
import { hashProfile, PROFILE_RULES } from "../src/profile.js";
import { METADATA_RERUN_STEPS } from "../src/rerun-steps.js";
import { isBodyEvidence } from "../src/block-policy.js";
import { SHAPE, whyUnusableAsBaseline } from "../src/store/artifacts.js";
import type { Block, Explanations } from "../src/types.js";
import {
  ANSWER_TOKENS,
  EXPLANATIONS_OUTPUT_SCHEMA,
  ExplanationsBaselineUnusable,
  SCORE_CHARS,
  existingFor,
  isOutdated,
  noExplanationScoreDrops,
  panelRunKind,
  previousExplanationsFrom,
  renderAppendPrompt,
  EXPLANATIONS_SYSTEM,
  MAX_QUOTE_CHARS,
  MAX_WORDS,
  PROMPT_VERSION,
  bodyParagraphs,
  buildExplanations,
  emptyDropped,
  explanationCap,
  explanationId,
  generateExplanations,
  inputFingerprint,
  renderPrompt,
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

  it("counts text in the body, not headings or supplements", () => {
    const heading = block("spya-hhhhhh", "A heading", "heading");
    const supplement = { ...block("spya-ssssss", "A note"), treatment: "supplement" as const };
    expect(bodyParagraphs([A, heading, supplement, B])).toBe(2);
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

  it("uses the spaced verifier, so a word split in two is not a quotation", () => {
    const falling = block("spya-ffffff", "The argument will fall apart under its own weight.");
    const d = emptyDropped();
    expect(toExplanations([item(falling.id, "fall a part")], [falling], 15, d)).toEqual([]);
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
        null,
        item("spya-zzzzzz", "nothing"),
        item(A.id, "words not in A"),
        item(C.id, "The cost is high"),
        item(A.id, "latent variable", ""),
        item(C.id, "the author does not say why", "C."),
        item(B.id, "local entropy", "B."),
        item(A.id, "latent variable", "A."),
        item(A.id, "never sees z directly", "A again."),
      ],
      body,
      2,
      d,
    );
    /* No invalid row uses a slot. A's first valid row is over the cap, but it
       still owns the block, so its second valid row is repeated, not overCap. */
    expect(kept.map((e) => e.text)).toEqual(["B.", "C."]);
    expect(d.malformed).toBe(1);
    expect(d.unknownIds).toBe(1);
    expect(d.unquoted).toBe(1);
    expect(d.ambiguous).toBe(1);
    expect(d.badText).toBe(1);
    expect(d.overCap).toBe(1);
    expect(d.repeated).toBe(1);
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
    expect([...items.required].sort()).toEqual([
      "blockId",
      "centrality",
      "difficulty",
      "outside",
      "quote",
      "sure",
      "text",
    ]);
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
    const run = await generateExplanations({ power: "standard", article, cacheArticle: true, profile: null, previous: null });

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

    expect(run.explanations.sourceHash).toBe(inputFingerprint(article.blocks, article.tree, null));
    expect(run.explanations.profileHash).toBeNull();
    expect(run.explanations.explanations).toHaveLength(1);
    expect(run.explanations.explanations[0]?.quote).toBe(words);
    const messages = (call.body as { messages: { content: string }[] }).messages;
    expect(messages).toEqual([
      { role: "user", content: renderPrompt({ count: explanationCap(run.paragraphs), profile: null }) },
    ]);
    expect(JSON.stringify(messages)).not.toContain("=== ITS SHAPE ===");
  });

  it("does not go stale for tree details the request never sends", () => {
    const changedTree = structuredClone(example.tree);
    const root = changedTree.nodes[changedTree.rootId];
    if (!root) throw new Error("the fixture tree has no root");
    root.title = "A title only Structure sees";
    root.gist = "A gist only Structure sees.";
    expect(inputFingerprint(example.blocks, changedTree, example.meta)).toBe(
      inputFingerprint(example.blocks, example.tree, example.meta),
    );

    /* Without metadata, the slug is the rendered fallback title and therefore
       is a real request input rather than an ignored tree detail. */
    changedTree.slug = `${example.tree.slug}-changed`;
    expect(inputFingerprint(example.blocks, changedTree, null)).not.toBe(
      inputFingerprint(example.blocks, example.tree, null),
    );
  });

  it("puts the profile in the user message, never the system, and its hash in the stamp", async () => {
    const { quotable, words } = quotableIn(example);
    const profile = "A cardiologist reading outside her field, after the main argument.";
    answer = JSON.stringify({ explanations: [item(quotable.id, words, "Here is the missing step.")] });
    const run = await generateExplanations({ power: "standard", article: example, profile, previous: null });
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
    expect(AUTO_MODE_STEPS).not.toContain("explanations");
    expect(METADATA_RERUN_STEPS).not.toContain("explanations");
    expect(cascadeForce([...STEP_ORDER], new Set(["fetch"])).has("explanations")).toBe(false);
    expect(cascadeForce(["faq", "explanations"], new Set(["explanations"])).has("explanations")).toBe(true);
  });
});

/* ------------------------------------------------- explanations/2: scores -- */

describe("the two scores (explanations/2, plan 261029e)", () => {
  it("keeps both scores on a first pass, and stamps the pass", () => {
    const scores = noExplanationScoreDrops();
    const made = buildExplanations(
      { explanations: [{ ...item(A.id, "latent variable"), difficulty: 0.7, centrality: 0.4 }] },
      opts({ scores, now: "2026-10-29T00:00:00.000Z" }),
    );
    expect(made.version).toBe("explanations/2");
    expect(made.explanations[0]).toMatchObject({
      difficulty: 0.7,
      centrality: 0.4,
      addedAt: "2026-10-29T00:00:00.000Z",
    });
    expect(made.passes).toBe(1);
    expect(made.lastAdded).toBe(1);
    expect(made.generatedAt).toBe("2026-10-29T00:00:00.000Z");
    expect(scores).toEqual(noExplanationScoreDrops());
  });

  it("drops a bad score, not the explanation, and counts absent and rejected apart", () => {
    const scores = noExplanationScoreDrops();
    const kept = toExplanations(
      [
        { ...item(A.id, "latent variable"), difficulty: 1.4, centrality: "high" },
        { ...item(B.id, "local entropy"), centrality: 0.5 },
        { ...item(C.id, "the author does not say why"), difficulty: null, centrality: 0 },
      ],
      body,
      15,
      emptyDropped(),
      scores,
    );
    expect(kept).toHaveLength(3);
    expect(kept[0]).not.toHaveProperty("difficulty");
    expect(kept[0]).not.toHaveProperty("centrality");
    expect(kept[1]).toMatchObject({ centrality: 0.5 });
    expect(kept[1]).not.toHaveProperty("difficulty");
    /* Zero is a score. */
    expect(kept[2]).toMatchObject({ centrality: 0 });
    expect(scores).toEqual({
      difficultyAbsent: 1,
      difficultyRejected: 2,
      centralityAbsent: 0,
      centralityRejected: 1,
    });
  });

  it("does not count the scores of an explanation it refuses", () => {
    const scores = noExplanationScoreDrops();
    toExplanations([{ ...item("spya-zzzzzz", "x"), difficulty: "?" }], body, 15, emptyDropped(), scores);
    expect(scores).toEqual(noExplanationScoreDrops());
  });

  it("asks for the scores in the system block", () => {
    expect(EXPLANATIONS_SYSTEM).toContain('"difficulty"');
    expect(EXPLANATIONS_SYSTEM).toContain('"centrality"');
  });

  /* Sol F8: the budget is a hand sum per item, and it caps the answer. A full
     answer — every item at the longest quote, with both scores, laid out as a
     model lays it out — must fit, counting the sixty words as the hundred
     tokens the budget allows them and everything else at three characters a
     token. Without `SCORE_CHARS` in the sum, this fails. */
  it("budgets enough answer tokens for a full list with both scores", () => {
    const quote = "q".repeat(MAX_QUOTE_CHARS);
    const one = {
      blockId: "spya-k3m9qt",
      quote,
      text: "",
      sure: false,
      outside: false,
      difficulty: 0.35,
      centrality: 0.85,
    };
    const answer = JSON.stringify({ explanations: Array.from({ length: 15 }, () => one) }, null, 2);
    const perItemWords = 100;
    expect(Math.ceil(answer.length / 3) + 15 * perItemWords).toBeLessThanOrEqual(ANSWER_TOKENS);
    expect(SCORE_CHARS).toBeGreaterThanOrEqual(', "difficulty": 0.35, "centrality": 0.85'.length);
  });
});

/* ------------------------------------------ the first-pass message, pinned -- */

describe("the version bump leaves the first pass's message alone", () => {
  /* `inputFingerprint` hashes this message, so changing it would mark every
     `explanations/1` list stale — "an older version of the article" — which
     would be false. The bump must make them outdated instead. The literal
     hash below was computed by the `explanations/1` code on this fixture. */
  it("is byte-identical to explanations/1's, and so is the fingerprint", () => {
    expect(renderPrompt({ count: 4, profile: null })).toBe(
      "Find up to 4 places where this reader would get stuck, and explain each. Fewer is fine, and none is fine.",
    );
    const blocks = [
      { id: "spya-aaaaaa", kind: "text" as const, text: "The energy is minimised over the latent variable." },
      { id: "spya-bbbbbb", kind: "text" as const, text: "A fridge exports entropy." },
    ];
    const tree = { slug: "s", rootId: "r", nodes: {} } as unknown as Article["tree"];
    const meta = { title: "A title", url: "https://example.com/a" };
    expect(inputFingerprint(blocks as never, tree, meta as never)).toBe("37199c283b995cea");
  });
});

/* ------------------------------------------------------- outdated, older -- */

const list = (over: Partial<Explanations> = {}): Explanations => ({
  version: PROMPT_VERSION,
  generator: CAPABLE_MODEL,
  slug: "s",
  sourceHash: "h",
  profileHash: null,
  explanations: [],
  dropped: emptyDropped(),
  generatedAt: "2026-10-29T00:00:00.000Z",
  elapsedMs: 1,
  ...over,
});

describe("isOutdated: only an older prompt, Quotes' way (Sol F2)", () => {
  it("is true for an older version and false for this one", () => {
    expect(isOutdated(list({ version: "explanations/1" }))).toBe(true);
    expect(isOutdated(list())).toBe(false);
  });

  it("is false for a newer version and an unparseable one, so a rollback never downgrades", () => {
    expect(isOutdated(list({ version: "explanations/99" }))).toBe(false);
    expect(isOutdated(list({ version: "something else" }))).toBe(false);
  });

  it("is still true for another model generation", () => {
    expect(isOutdated(list({ generator: "claude-some-other-model" }))).toBe(true);
  });
});

/* ------------------------------------------ existingFor and the run button -- */

describe("panelRunKind agrees with existingFor (Sol F1)", () => {
  /** What `existingFor` says for the panel's press: the list's own profile setting. */
  const viaExistingFor = (e: Explanations, sourceNow: string, nowHash: string | null) => {
    const pressHash = e.profileHash == null ? null : nowHash;
    return existingFor(e, sourceNow, pressHash) ? "append" : "rewrite";
  };
  const CASES: {
    name: string;
    e: Explanations;
    sourceNow: string;
    nowHash: string | null;
    want: "append" | "rewrite";
  }[] = [
    { name: "a current plain list, reader with a profile", e: list(), sourceNow: "h", nowHash: "p1", want: "append" },
    { name: "a current plain list, reader without one", e: list(), sourceNow: "h", nowHash: null, want: "append" },
    { name: "a profiled list, same profile", e: list({ profileHash: "p1" }), sourceNow: "h", nowHash: "p1", want: "append" },
    { name: "a profiled list, profile changed", e: list({ profileHash: "p1" }), sourceNow: "h", nowHash: "p2", want: "rewrite" },
    /* The case the client's three flags got wrong: `profileChanged` is false
       here, and the press would rewrite. */
    { name: "a profiled list, no current profile", e: list({ profileHash: "p1" }), sourceNow: "h", nowHash: null, want: "rewrite" },
    { name: "an outdated list", e: list({ version: "explanations/1" }), sourceNow: "h", nowHash: null, want: "rewrite" },
    { name: "a list a newer build wrote", e: list({ version: "explanations/99" }), sourceNow: "h", nowHash: null, want: "append" },
    { name: "a stale list", e: list(), sourceNow: "moved", nowHash: null, want: "rewrite" },
  ];
  for (const c of CASES) {
    it(`${c.name}: ${c.want}`, () => {
      expect(panelRunKind({ explanations: c.e, stale: c.e.sourceHash !== c.sourceNow }, c.nowHash)).toBe(c.want);
      expect(viaExistingFor(c.e, c.sourceNow, c.nowHash)).toBe(c.want);
    });
  }
});

/* ------------------------------------------------- the baseline read (F5) -- */

describe("previousExplanationsFrom", () => {
  const storeSaying = (outcome: unknown) => ({ readBaseline: () => Promise.resolve(outcome) }) as never;

  it("is null for none, the list for one, and refuses one it cannot read", async () => {
    expect(await previousExplanationsFrom(storeSaying({ state: "absent" }), "s")).toBeNull();
    const l = list();
    expect(await previousExplanationsFrom(storeSaying({ state: "ok", value: l }), "s")).toBe(l);
    await expect(previousExplanationsFrom(storeSaying({ state: "unusable" }), "s")).rejects.toBeInstanceOf(
      ExplanationsBaselineUnusable,
    );
  });

  it("has a baseline rule, so a usable list is usable and one without a hash is not", () => {
    const one = buildExplanations({ explanations: [item(A.id, "latent variable")] }, opts());
    expect(whyUnusableAsBaseline("explanations", one)).toBeNull();
    expect(whyUnusableAsBaseline("explanations", { ...one, sourceHash: "" })).toMatch(/sourceHash/);
  });
});

/* ------------------------------------------------------------ Find more -- */

describe("Find more appends (plan 261029e § 2c)", () => {
  /** Distinct body blocks of the example article, each with words it holds once. */
  const places = (n: number) => {
    const found = example.blocks
      .filter((b) => isBodyEvidence(b) && b.kind === "text" && b.text.split(/\s+/).length > 14)
      .slice(0, n)
      .map((b) => ({ block: b, words: b.text.split(/\s+/).slice(3, 11).join(" ") }));
    if (found.length < n) throw new Error(`the fixture has fewer than ${n} quotable blocks`);
    return found;
  };
  const scored = (blockId: string, quote: string, text: string) => ({
    ...item(blockId, quote, text),
    difficulty: 0.6,
    centrality: 0.5,
  });
  const userMessage = (i: number) => {
    const call = sent[i];
    if (!call) throw new Error(`no call ${i}`);
    return (call.body as { messages: { content: string }[] }).messages[0]?.content ?? "";
  };
  /** Another quote from a block, still once in it: its first six words. */
  const opening = (b: Block) => b.text.split(/\s+/).slice(0, 6).join(" ");

  const firstPass = async (profile: string | null = null) => {
    const [x] = places(1);
    answer = JSON.stringify({ explanations: [scored(x!.block.id, x!.words, "First pass.")] });
    const run = await generateExplanations({ power: "standard", article: example, profile, previous: null });
    return run.explanations;
  };

  it("sends the places already explained, keeps the old ones unchanged, and merges in reading order", async () => {
    const before = await firstPass();
    const [x, y, z] = places(3);
    sent.length = 0;
    /* Out of reading order, one in a used block, and one new pair. */
    answer = JSON.stringify({
      explanations: [
        scored(z!.block.id, z!.words, "Third block."),
        scored(x!.block.id, opening(x!.block), "Again in a used block."),
        scored(y!.block.id, y!.words, "Second block."),
      ],
    });
    const run = await generateExplanations({ power: "standard", article: example, profile: null, previous: before });

    const message = userMessage(0);
    expect(message).toBe(
      renderAppendPrompt({
        count: explanationCap(run.paragraphs),
        profile: null,
        existing: before.explanations,
      }),
    );
    expect(message).toContain(`${x!.block.id}: ${JSON.stringify(x!.words)}`);
    expect(message).not.toBe(renderPrompt({ count: explanationCap(run.paragraphs), profile: null }));

    const after = run.explanations;
    expect(after.explanations.map((e) => e.text)).toEqual(["First pass.", "Second block.", "Third block."]);
    /* The old item is unchanged: id, scores and stamp. */
    expect(after.explanations[0]).toEqual(before.explanations[0]);
    const fresh = after.explanations.slice(1);
    expect(new Set(fresh.map((e) => e.addedAt)).size).toBe(1);
    expect(fresh[0]?.addedAt).toBe(after.generatedAt);
    expect(after.passes).toBe(2);
    expect(after.lastAdded).toBe(2);
    /* One per block across passes: the used block's second place is `repeated`. */
    expect(run.dropped.repeated).toBe(1);
    expect(after.dropped.repeated).toBe(1);
    expect(after.version).toBe(before.version);
    expect(after.sourceHash).toBe(before.sourceHash);
  });

  it("keeps `dropped` cumulative on the artefact and this pass's on the run", async () => {
    const before = { ...(await firstPass()), dropped: { ...emptyDropped(), unquoted: 2 } };
    const [, y] = places(2);
    answer = JSON.stringify({
      explanations: [scored(y!.block.id, y!.words, "New."), scored("spya-zzzzzz", "x", "Nowhere.")],
    });
    const run = await generateExplanations({ power: "standard", article: example, profile: null, previous: before });
    expect(run.dropped.unknownIds).toBe(1);
    expect(run.dropped.unquoted).toBe(0);
    expect(run.explanations.dropped).toMatchObject({ unknownIds: 1, unquoted: 2 });
  });

  it("an append that adds nothing is a real answer, not a failure", async () => {
    const before = await firstPass();
    answer = JSON.stringify({ explanations: [] });
    const run = await generateExplanations({ power: "standard", article: example, profile: null, previous: before });
    expect(run.explanations.explanations).toEqual(before.explanations);
    expect(run.explanations.lastAdded).toBe(0);
    expect(run.explanations.passes).toBe(2);
  });

  it("an append whose every place is in a used block adds nothing, and does not throw", async () => {
    const before = await firstPass();
    const [x] = places(1);
    answer = JSON.stringify({ explanations: [scored(x!.block.id, opening(x!.block), "Again.")] });
    const run = await generateExplanations({ power: "standard", article: example, profile: null, previous: before });
    expect(run.explanations.lastAdded).toBe(0);
    expect(run.dropped.repeated).toBe(1);
  });

  it("rewrites, with the first pass's message, when the profile has changed", async () => {
    const before = await firstPass("A physicist.");
    const [, y] = places(2);
    sent.length = 0;
    answer = JSON.stringify({ explanations: [scored(y!.block.id, y!.words, "For a chemist.")] });
    const run = await generateExplanations({
      power: "standard",
      article: example,
      profile: "A chemist.",
      previous: before,
    });
    expect(userMessage(0)).toBe(renderPrompt({ count: explanationCap(run.paragraphs), profile: "A chemist." }));
    expect(run.explanations.explanations.map((e) => e.text)).toEqual(["For a chemist."]);
    expect(run.explanations.passes).toBe(1);
    expect(run.explanations.profileHash).toBe(hashProfile("A chemist."));
  });

  it("rewrites an outdated list, and appends to one a newer build wrote", async () => {
    const before = await firstPass();
    const [, y] = places(2);
    answer = JSON.stringify({ explanations: [scored(y!.block.id, y!.words, "New.")] });
    const outdated = await generateExplanations({
      power: "standard",
      article: example,
      profile: null,
      previous: { ...before, version: "explanations/1" },
    });
    expect(outdated.explanations.passes).toBe(1);
    expect(outdated.explanations.version).toBe(PROMPT_VERSION);

    const newer = await generateExplanations({
      power: "standard",
      article: example,
      profile: null,
      previous: { ...before, version: "explanations/99" },
    });
    expect(newer.explanations.passes).toBe(2);
    expect(newer.explanations.version).toBe("explanations/99");
  });

  it("rewrites a stale list", async () => {
    const before = await firstPass();
    const [, y] = places(2);
    answer = JSON.stringify({ explanations: [scored(y!.block.id, y!.words, "New.")] });
    const run = await generateExplanations({
      power: "standard",
      article: example,
      profile: null,
      previous: { ...before, sourceHash: "moved" },
    });
    expect(run.explanations.passes).toBe(1);
    expect(run.explanations.explanations.map((e) => e.text)).toEqual(["New."]);
  });
});
