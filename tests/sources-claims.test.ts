/**
 * **Debate's claims list: the step's pure half, and the one request it sends**
 * — docs/plans/261008i-debate-claims-picked-by-the-reader.md § 2.
 *
 * A list of eight plausible claims under quotations the article never printed
 * looks exactly like one that works (docs/reusable/silent-success.md), so what
 * is pinned is what has no visible symptom: the words shown are the
 * article's; a claim with nothing to point at is gone and counted; the order
 * is the article's; the cap holds and counts what it cut; the three empty
 * outcomes are three different answers; and the request searches nothing.
 */
import path from "node:path";

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { Article } from "../src/article-input.js";
import { cascadeForce } from "../src/jobs.js";
import { CAPABLE_MODEL } from "../src/models.js";
import { FORCE_ONLY_WHEN_NAMED, STEP_ORDER, DEFAULT_INGEST_STEPS } from "../src/pipeline.js";
import { SHAPE } from "../src/store/artifacts.js";
import type { Block, SourcesClaimListDropped } from "../src/types.js";
import {
  SOURCES_CLAIMS_SYSTEM,
  MAX_LISTED_CLAIMS,
  MAX_QUOTE_CHARS,
  MAX_STATEMENT_CHARS,
  PROMPT_VERSION,
  buildSourcesClaimList,
  emptyDropped,
  generateSourcesClaims,
  inputFingerprint,
  isOutdated,
  toListedClaims,
} from "../src/sources-claims.js";
import { plainWords } from "../src/plain-words.js";
import { paperwork } from "../src/paperwork.js";
import { PROMPT_VERSION as RECEPTION_PROMPT_VERSION } from "../src/reception.js";

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

const block = (id: string, text: string): Block => ({
  id,
  tag: "p",
  kind: "text",
  text,
  words: text.split(/\s+/).length,
  html: `<p>${text}</p>`,
  gistable: true,
});

/** In document order — `spya-aaaaaa` is first on the page. */
const A = block("spya-aaaaaa", "Memories can survive metamorphosis. The caterpillar’s brain is   largely dissolved.");
const B = block("spya-bbbbbb", "RNA from trained animals transferred the training to untrained ones.");
const C = block("spya-cccccc", "The self is continuously rebuilt, and nothing in it is fixed.");
const blocks: Block[] = [A, B, C];

const drops = (): SourcesClaimListDropped => emptyDropped();
const claim = (blockId: string, quote: string, statement = "Something an outsider could dispute.") => ({
  blockId,
  quote,
  statement,
});

/* ------------------------------------------------------------- the claims -- */

describe("a listed claim is believed only if the article backs it up", () => {
  it("drops and counts a claim whose quote is not in its block", () => {
    const d = drops();
    const out = toListedClaims(
      [
        claim(B.id, "RNA from trained animals transferred the training"),
        /* A paraphrase: the article never says this. */
        claim(A.id, "Memories outlast the brain that made them"),
        /* Real words, but from a different block than the one named. */
        claim(A.id, "nothing in it is fixed"),
      ],
      blocks,
      d,
    );
    expect(out.map((c) => c.blockId)).toEqual([B.id]);
    expect(d.unquoted).toBe(2);
  });

  it("drops and counts a claim naming a block that is not in the article", () => {
    const d = drops();
    expect(toListedClaims([claim("spya-zzzzzz", "Memories can survive")], blocks, d)).toEqual([]);
    expect(d.unknownIds).toBe(1);
  });

  it("rejects a word split in two, as the referee rule does (`spaced`, not forgiving)", () => {
    const d = drops();
    expect(toListedClaims([claim(B.id, "un trained ones")], blocks, d)).toEqual([]);
    expect(d.unquoted).toBe(1);
  });

  it("stores the article's characters, never the model's retyping", () => {
    /* The model straightened the curly apostrophe and folded the run of
       spaces; the spaced matcher finds it, and what is stored is the page. */
    const d = drops();
    const [only] = toListedClaims(
      [claim(A.id, "The caterpillar's brain is largely dissolved")],
      blocks,
      d,
    );
    expect(only?.quote).toBe("The caterpillar’s brain is   largely dissolved");
    expect(A.text).toContain(only?.quote);
  });

  it("keeps the statement as the model's own line, and drops an overlong one as malformed", () => {
    const d = drops();
    const out = toListedClaims(
      [
        claim(A.id, "Memories can survive metamorphosis", "A memory can outlast the brain that formed it."),
        claim(C.id, "The self is continuously rebuilt", "x".repeat(MAX_STATEMENT_CHARS + 1)),
      ],
      blocks,
      d,
    );
    expect(out.map((c) => c.statement)).toEqual(["A memory can outlast the brain that formed it."]);
    expect(d.malformed).toBe(1);
  });

  it("drops a quote over the cap rather than cutting it", () => {
    const long = block("spya-dddddd", `${"word ".repeat(80)}end.`);
    const d = drops();
    expect(toListedClaims([claim(long.id, long.text)], [long], d)).toEqual([]);
    expect(long.text.length).toBeGreaterThan(MAX_QUOTE_CHARS);
    expect(d.tooLong).toBe(1);
  });

  it("counts a second claim on the same words of the same block as a duplicate", () => {
    const d = drops();
    const out = toListedClaims(
      [claim(C.id, "continuously rebuilt"), claim(C.id, "continuously rebuilt", "Said again.")],
      blocks,
      d,
    );
    expect(out).toHaveLength(1);
    expect(d.duplicate).toBe(1);
  });
});

describe("the list's order and size", () => {
  it("is in document order, whatever order the model listed them in", () => {
    const out = toListedClaims(
      [
        claim(C.id, "nothing in it is fixed"),
        claim(A.id, "largely dissolved"),
        claim(B.id, "RNA from trained animals"),
        claim(A.id, "Memories can survive metamorphosis"),
      ],
      blocks,
      drops(),
    );
    expect(out.map((c) => [c.blockId, c.quote])).toEqual([
      [A.id, "Memories can survive metamorphosis"],
      [A.id, "largely dissolved"],
      [B.id, "RNA from trained animals"],
      [C.id, "nothing in it is fixed"],
    ]);
  });

  it(`keeps at most ${MAX_LISTED_CLAIMS}, the model's first, and counts what it cut`, () => {
    const many = block("spya-eeeeee", "one two three four five six seven eight nine ten eleven twelve thirteen");
    const words = many.text.split(" ");
    /* Ten distinct quotes from one block: every prefix of its words, two and up. */
    const raw = Array.from({ length: 10 }, (_, i) => claim(many.id, words.slice(0, i + 2).join(" ")));
    const d = drops();
    const out = toListedClaims(raw, [many], d);
    expect(out).toHaveLength(MAX_LISTED_CLAIMS);
    expect(d.overCap).toBe(10 - MAX_LISTED_CLAIMS);
    /* The two cut are the model's last two, the longest prefixes. */
    expect(out.map((c) => c.quote)).not.toContain(words.slice(0, 11).join(" "));
  });

  it("mints a distinct id for every claim", () => {
    const out = toListedClaims(
      [claim(A.id, "Memories can survive"), claim(B.id, "RNA from trained"), claim(C.id, "The self")],
      blocks,
      drops(),
    );
    expect(new Set(out.map((c) => c.id)).size).toBe(3);
    for (const c of out) expect(c.id).toMatch(/^spya-[a-z0-9]{6}$/);
  });
});

/* ------------------------------------------------------- the three empties -- */

describe("the artefact", () => {
  const opts = () => ({
    slug: "s",
    blocks,
    sourceHash: "h",
    power: "standard" as const,
    elapsedMs: 1,
    dropped: drops(),
  });

  it("fails when the answer has no claims array: a failed answer, not an empty one", () => {
    expect(() => buildSourcesClaimList({}, opts())).toThrow(/no `claims` array/);
  });

  it("keeps an empty list as a real answer, which the store accepts", () => {
    const list = buildSourcesClaimList({ claims: [] }, opts());
    expect(list.claims).toEqual([]);
    expect(list.version).toBe(PROMPT_VERSION);
    expect(list.generator).toBe(CAPABLE_MODEL);
    expect(list.sourceHash).toBe("h");
    const shape = SHAPE["sources-claims"];
    expect(shape.field).toBe("claims");
    expect(shape.ok(list.claims)).toBe(true);
  });

  it("fails, with the counts, when the model listed claims and every one was dropped", () => {
    expect(() =>
      buildSourcesClaimList(
        { claims: [claim("spya-zzzzzz", "x"), claim(A.id, "Memories outlast brains")] },
        opts(),
      ),
    ).toThrow(/listed 2 claims.*1 naming a block id.*1 whose quote/);
  });

  it("stores what validation dropped, as counts", () => {
    const list = buildSourcesClaimList(
      { claims: [claim(A.id, "Memories can survive"), claim(A.id, "not in the article at all")] },
      opts(),
    );
    expect(list.claims).toHaveLength(1);
    expect(list.dropped.unquoted).toBe(1);
  });
});

/* ------------------------------------------------------------ the request -- */

let example: Article;
beforeAll(async () => {
  const { readArticleFromDir } = await import("./helpers/article-from-dir.js");
  example = await readArticleFromDir(path.resolve(import.meta.dirname, "..", "example"));
});

describe("the request", () => {
  it("sends the article with ids and the instructions, asks the web nothing, and hashes the real meta", async () => {
    const article: Article = { ...example, meta: null };
    const quotable = article.blocks.find((b) => b.text.split(/\s+/).length > 8);
    if (!quotable) throw new Error("the fixture has no block long enough to quote");
    const words = quotable.text.split(/\s+/).slice(0, 6).join(" ");
    answer = JSON.stringify({ claims: [claim(quotable.id, words, "A claim, plainly.")] });
    const run = await generateSourcesClaims({ power: "standard", article, cacheArticle: true });

    expect(sent).toHaveLength(1);
    expect(sent[0]?.task).toBe("sources-claims");
    const body = sent[0]?.body as {
      system: { text: string }[];
      tools?: unknown;
      messages: { content: string }[];
    };
    expect(body.tools).toBeUndefined();
    expect(JSON.stringify(body)).not.toMatch(/web_search|"plugins"/);
    expect(body.system[1]?.text).toBe(SOURCES_CLAIMS_SYSTEM);
    expect(run.claimList.claims).toHaveLength(1);
    expect(run.claimList.sourceHash).toBe(inputFingerprint(article.blocks, article.tree, null));
  });

  it("fingerprints only the body and head bytes the request sends", () => {
    const changedTree = structuredClone(example.tree);
    const root = changedTree.nodes[changedTree.rootId];
    if (!root) throw new Error("the fixture tree has no root");
    root.title = `${root.title} (renamed)`;

    const supplement = { ...A, id: "spya-dddddd", treatment: "supplement" as const };
    const now = inputFingerprint(blocks, example.tree, example.meta);
    expect(inputFingerprint(blocks, changedTree, example.meta)).toBe(now);
    expect(inputFingerprint([...blocks, supplement], example.tree, example.meta)).toBe(now);
    expect(inputFingerprint([{ ...A, text: `${A.text} Changed.` }, B, C], example.tree, example.meta)).not.toBe(
      now,
    );

    const noMeta = inputFingerprint(blocks, example.tree, null);
    expect(inputFingerprint(blocks, changedTree, null)).toBe(noMeta);
    expect(inputFingerprint(blocks, { ...example.tree, slug: "a-new-fallback-title" }, null)).not.toBe(noMeta);
  });

  it("carries the shared plain-words and paperwork sections", () => {
    expect(SOURCES_CLAIMS_SYSTEM).toContain(plainWords("explain"));
    expect(SOURCES_CLAIMS_SYSTEM).toContain(paperwork("pick"));
  });

  it("has its own prompt version, not Debate's", () => {
    expect(PROMPT_VERSION).toMatch(/^debate-claims\//);
    expect(PROMPT_VERSION).not.toBe(RECEPTION_PROMPT_VERSION);
  });

  it("calls a different capable-model generation outdated", () => {
    expect(isOutdated({ version: PROMPT_VERSION, generator: CAPABLE_MODEL })).toBe(false);
    expect(isOutdated({ version: PROMPT_VERSION, generator: "an-older-capable-model" })).toBe(true);
  });
});

/* ------------------------------------------------------------ the pipeline -- */

describe("its place in the pipeline", () => {
  it("is off the default ingest, so pasting a URL never buys it", () => {
    expect(STEP_ORDER).toContain("sources-claims");
    expect(DEFAULT_INGEST_STEPS).not.toContain("sources-claims");
  });

  it("is never swept in by forcing an earlier step", () => {
    expect(FORCE_ONLY_WHEN_NAMED.has("sources-claims")).toBe(true);
    expect(cascadeForce([...STEP_ORDER], new Set(["fetch"])).has("sources-claims")).toBe(false);
    expect(cascadeForce(["reception", "sources-claims"], new Set(["reception"])).has("sources-claims")).toBe(false);
    /* Named, it is forced like anything else. */
    expect(cascadeForce(["sources-claims"], new Set(["sources-claims"])).has("sources-claims")).toBe(true);
  });
});
