/**
 * **The scoped expansion protocol** — the prompt's settled precedence, the
 * request's cache order, the strict reading of an answer, and the record kept
 * of every candidate.
 *
 * None of this makes a model call, and that is the point: every fault it is
 * written against is one that produces a perfectly good-looking tree. An answer
 * missing its verdict builds the same tree as one that said "finished"; a
 * request whose cacheable prefix is one byte too short costs eight per cent
 * more and reports nothing; an answer covering three of four parents leaves a
 * stretch of the article silently unasked. docs/reusable/silent-success.md, and
 * docs/plans/260904d-deepen-fat-sections.md § stage 4.
 *
 * **The three `expand-*.json` files are load-bearing here.** They are real
 * Sonnet 5 answers to the stage-2 spike — the only recorded scoped expansions
 * that exist — and they are the reason the happy path is tested against
 * something a model actually wrote rather than against a fixture written to
 * pass. They were produced by the spike's looser format, and `asWireFormat`
 * below says exactly what it translates and what it does not.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  CASCADE_RECIPE,
  type CascadeNode,
  ExpansionRefused,
  type ExpansionDecision,
  type ExpansionTarget,
  type ModelVerdict,
  normaliseExpansion,
  planExpansionBatches,
} from "../src/hierarchy-cascade.js";
import {
  EXPAND_EFFORT,
  EXPAND_HEADROOM,
  EXPAND_PROMPT_VERSION,
  EXPAND_SYSTEM,
  expansionPrefixIsCacheable,
  type CandidateRecord,
  expansionOverhead,
  expansionRequest,
  expectedChildren,
  overrodeVerdict,
  parseExpansionAnswer,
  recordCandidate,
  renderFrozenOutline,
  type TargetBriefing,
  tallyVerdicts,
} from "../src/hierarchy-expand.js";
import { CACHE_FLOOR_TOKENS } from "../src/article-prompt.js";
import { PROMPT_VERSION, STRUCTURE_HEADROOM } from "../src/hierarchy.js";
import type { BuildReport, ModelNode } from "../src/hierarchy.js";
import { THINKING_HEADROOM } from "../src/token-budget.js";
import type { Block } from "../src/types.js";

/* ------------------------------------------------------------- fixtures -- */

/** The id alphabet from src/ids.ts, so every fixture id passes `isSpideryarnId`. */
const ALPHABET = "abcdefghjkmnpqrstuvwxyz023456789";

function blockId(i: number): string {
  return `spya-b${ALPHABET[Math.floor(i / 32) % 32]}${ALPHABET[i % 32]}000`;
}

function para(i: number): Block {
  return {
    id: blockId(i),
    tag: "p",
    kind: "text",
    text: `Paragraph ${String(i).padStart(4, "0")} says something about the matter at hand.`,
    words: 12,
    html: `<p id="${blockId(i)}">Paragraph ${i}</p>`,
    gistable: true,
  };
}

function heading(i: number): Block {
  return { ...para(i), tag: "h2", kind: "heading", level: 2, text: `Heading ${i}` };
}

/** Apparatus: `renderBlocks` withholds its prose and prints the id alone. */
function note(i: number): Block {
  return { ...para(i), treatment: "supplement", role: "footnote" };
}

function article(length: number, shape: (i: number) => Block = para): Block[] {
  return Array.from({ length }, (_, i) => shape(i));
}

function pending(from: number, to: number, title = `Part ${from}`): CascadeNode {
  return { title, gist: `A claim about part ${from}.`, range: [blockId(from), blockId(to)], status: "pending" };
}

function target(from: number, to: number, where: string): ExpansionTarget {
  return { node: pending(from, to), where };
}

function briefing(from: number, to: number, where: string): TargetBriefing {
  return {
    target: target(from, to, where),
    ancestors: [
      { title: "The Whole Work", gist: "It argues one thing at length." },
      { title: "Chapter Two", gist: "It narrows to the second half." },
    ],
  };
}

const OUTLINE = renderFrozenOutline({
  title: "The Whole Work",
  gist: "It argues one thing at length.",
  range: [blockId(0), blockId(99)],
  children: [
    { title: "Chapter One", gist: "It sets the scene.", range: [blockId(0), blockId(49)] },
    { title: "Chapter Two", gist: "It narrows to the second half.", range: [blockId(50), blockId(99)] },
  ],
} satisfies ModelNode);

function emptyReport(): BuildReport {
  return { repairs: [], droppedChildren: [], droppedHeadings: [], collapsedRungs: [] };
}

/** `{"sections": [{"section": 1, "children": [...]}]}`, for the cases that need one. */
function wire(children: unknown[], section = 1): string {
  return JSON.stringify({ sections: [{ section, children }] });
}

function child(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    start: blockId(0),
    title: "A Title",
    gist: "It claims something.",
    verdict: "finished",
    why: "One sustained argument.",
    ...over,
  };
}

/** What was refused, and under which reason — one helper so no test forgets the second half. */
function refusalFrom(run: () => unknown): ExpansionRefused {
  try {
    run();
  } catch (err) {
    if (err instanceof ExpansionRefused) return err;
    throw err;
  }
  throw new Error("expected an ExpansionRefused, and nothing was thrown");
}

/* ------------------------------------------------------------ the prompt -- */

describe("the scoped prompt", () => {
  /**
   * **The pin, and it is a pin rather than a description.** This sentence is
   * the plan's own wording, adopted verbatim after the spike ran the same call
   * twice and got 10 children one time and 20 the next. The collision it
   * settles is invisible in everything downstream: both answers tile, both
   * build, and only a reader comparing the tree with the book's contents page
   * would ever know which one arrived.
   */
  it("says which of the two colliding rules wins, in the plan's words", () => {
    expect(EXPAND_SYSTEM).toContain(
      "- An authored heading always begins a child, and no child may contain more than\n" +
        "  one authored heading. Aim for 5-9 children only where you are inventing the\n" +
        "  boundaries yourself; if the headings give you more, return more.",
    );
  });

  it("asks for a verdict by name, and says an answer without one is discarded", () => {
    expect(EXPAND_SYSTEM).toContain(`"verdict": exactly "needs-deeper" or "finished"`);
    /* The spike's boolean is gone. A `needsDeeper` left anywhere in the prompt
       would invite the model to send the field the parser refuses. */
    expect(EXPAND_SYSTEM).not.toContain("needsDeeper");
  });

  /**
   * **The rule the derivation always enforced and the prompt never stated.**
   *
   * `normaliseExpansion` consumes array order as document order: a child whose
   * start is not strictly after the previous kept one's marks no split point and
   * is dropped. That is right — a starts-only answer has nothing to fall back on
   * — but nothing in the prompt asked for the order, so a model listing five
   * perfectly good children as 0, 8, 4, 12, 16 loses a real section of the
   * article, silently, with a valid tree over it.
   *
   * Asking for it costs a sentence. ⟨GPT Sol's review of stage 4, F3.⟩
   */
  it("asks for the children in document order", () => {
    expect(EXPAND_SYSTEM).toContain(
      "- List children in document order. After the first child, each \"start\" must\n" +
        "  occur strictly later in the section than the previous child's start.",
    );
  });

  /**
   * **What that sentence is worth**, in the derivation it is written for. Five
   * scoped, in-parent, otherwise-valid starts in the order the reviewer sent
   * them: the section beginning at block 4 is dropped, and its prose is absorbed
   * by the child before it under someone else's title.
   *
   * This passes with or without the prompt rule — it is the derivation's
   * behaviour and it is not changing. It is here so that whoever reads the rule
   * can see the cost of leaving it out.
   */
  it("loses a whole section when the children arrive out of order", () => {
    const report = emptyReport();
    const built = normaliseExpansion({
      children: [0, 8, 4, 12, 16].map((at) => ({
        start: blockId(at),
        title: `Starting at ${at}`,
        gist: "It claims something.",
      })),
      parent: [blockId(0), blockId(19)],
      blocks: article(20),
      where: "root > child 1",
      report,
    });
    expect(built.map((c) => c.node.title)).toEqual([
      "Starting at 0",
      "Starting at 8",
      "Starting at 12",
      "Starting at 16",
    ]);
    expect(report.droppedChildren).toEqual(["root > child 1 > child 3"]);
  });

  it("tells the model not to send an empty sourceHeading", () => {
    /* Run B sent `"sourceHeading": ""` on children the author gave no heading,
       and `buildTree` counts an unbackable claim — the empty string included,
       deliberately — into `droppedHeadings`. Left alone it makes that figure
       read high on every scoped answer. */
    expect(EXPAND_SYSTEM).toContain(`Omit "sourceHeading" entirely`);
  });
});

describe("the constants a scoped call is made with", () => {
  /**
   * **Not `STRUCTURE_HEADROOM`.** 64,000 was measured on the call that reads
   * every block of the longest article we have; a scoped call reads one section
   * and the three real ones spent under 2,000 output tokens each, thinking
   * included. Copying the bigger number by reflex is the mistake
   * docs/postmortems/260826a-toc-max-tokens.md is about — adaptive thinking
   * expands into whatever room it is given.
   */
  it("reserves the general thinking headroom, not the whole-document call's", () => {
    expect(EXPAND_HEADROOM).toBe(THINKING_HEADROOM);
    expect(EXPAND_HEADROOM).toBeLessThan(STRUCTURE_HEADROOM);
  });

  it("stamps a version of its own, separate from the whole-document prompt's", () => {
    expect(EXPAND_PROMPT_VERSION).not.toBe(PROMPT_VERSION);
  });

  /**
   * **The stamp moved when the question did**, and this is the pin on that.
   *
   * `expand/1` asked for children without saying they must be in document order;
   * `expand/2` asks for the order. A stored answer written under the first was
   * answering a different question, and the stamp is inside the checkpoint key
   * precisely so it cannot be resumed onto by the second.
   */
  it("is at expand/2, since the prompt began asking for document order", () => {
    expect(EXPAND_PROMPT_VERSION).toBe("expand/2");
  });

  /**
   * The floor is a property of the model, not of us, and the estimate is four
   * characters to a token — so a prefix within a few percent of it could fall
   * either side. This pins which side of the line the function draws, which is
   * the only thing about it that is ours to decide.
   */
  it("draws the cache floor at the model's own threshold", () => {
    const room = CACHE_FLOOR_TOKENS * 4 - EXPAND_SYSTEM.length;
    expect(expansionPrefixIsCacheable("x".repeat(room - 4))).toBe(false);
    expect(expansionPrefixIsCacheable("x".repeat(room))).toBe(true);
  });
});

/* ----------------------------------------------------------- the request -- */

describe("the expansion request", () => {
  const blocks = article(40);

  it("puts the rules and the frozen outline before anything call-specific", () => {
    const request = expansionRequest({
      briefings: [briefing(10, 19, "root > child 2"), briefing(20, 29, "root > child 3")],
      blocks,
      outline: OUTLINE,
      recipe: CASCADE_RECIPE,
    });

    /* A breakpoint is a POSITION: everything from the top of the request
       through the marked part is the prefix. So the shared half may not
       mention a target, and the marker must be on the first part. */
    expect(request.shared).toContain("Chapter One");
    expect(request.shared).not.toContain("root > child 2");
    expect(request.shared).not.toContain(blockId(10));
    expect(request.own).toContain("SECTION 1 OF 2");
    expect(request.own).toContain("SECTION 2 OF 2");

    const content = request.params.messages[0]!.content as {
      text: string;
      cache_control?: unknown;
    }[];
    expect(content).toHaveLength(2);
    expect(content[0]!.text).toBe(request.shared);
    expect(content[0]!.cache_control).toEqual({ type: "ephemeral" });
    expect(content[1]!.text).toBe(request.own);
    expect(content[1]!.cache_control).toBeUndefined();
    expect(request.params.system).toBe(EXPAND_SYSTEM);
    expect(request.params.output_config).toEqual({ effort: EXPAND_EFFORT });
  });

  it("shows each target its chain, ending with the target itself", () => {
    const request = expansionRequest({
      briefings: [briefing(10, 19, "root > child 2")],
      blocks,
      outline: OUTLINE,
      recipe: CASCADE_RECIPE,
    });
    expect(request.own).toContain(
      "  The Whole Work — It argues one thing at length.\n" +
        "  ↳ Chapter Two — It narrows to the second half.\n" +
        "  ↳ Part 10 — A claim about part 10.",
    );
  });

  it("renders blocks the way the whole-document call does, apparatus withheld", () => {
    const withNote = [...article(10), note(10), ...article(9).map((_, i) => para(11 + i))];
    const request = expansionRequest({
      briefings: [briefing(8, 12, "root > child 1")],
      blocks: withNote,
      outline: OUTLINE,
      recipe: CASCADE_RECIPE,
    });
    /* The id travels and the prose does not — the one thing a second renderer
       would be free to forget. Numbering restarts at 0 within the slice, which
       is what the prompt tells the model to expect. */
    expect(request.own).toContain(`[2] ${blockId(10)} <p> NOT-GISTABLE: (withheld)`);
    expect(request.own).toContain(`[0] ${blockId(8)} <p>: Paragraph 0008`);
  });

  /**
   * The number `estimatedCacheable` exists to make readable. A zero in
   * `cache_read_input_tokens` is what a working cache reports on its first call
   * too, so without this flag nobody can tell the two apart — which is how
   * src/labels.ts came to write a marker that did nothing for months.
   */
  it("reports whether the prefix clears the model's floor, rather than assuming it", () => {
    const short = expansionRequest({
      briefings: [briefing(10, 19, "root > child 2")],
      blocks,
      outline: OUTLINE,
      recipe: CASCADE_RECIPE,
    });
    expect(short.estimatedCacheable).toBe(false);

    /* A book's outline is ten chapters with a sentence each, which is still not
       a kilobyte — so this asserts the flag can go true, not that it does on any
       real article. Stage 5 measures the real one. */
    const long = expansionRequest({
      briefings: [briefing(10, 19, "root > child 2")],
      blocks,
      outline: `${OUTLINE}\n${"3. A Chapter — It says something at some length about the matter.\n".repeat(60)}`,
      recipe: CASCADE_RECIPE,
    });
    expect(long.estimatedCacheable).toBe(true);
  });

  /**
   * **The failure this catches costs a whole paid call and returns nothing.**
   * Under the settled precedence a twenty-heading section answers with twenty
   * children, and `predictedChildren` caps at nine — so a budget taken from it
   * alone would size the answer at less than half what the model is being told
   * to write.
   */
  it("sizes max_tokens by the headings when they beat the fan-out target", () => {
    const dense = article(40, (i) => (i % 2 === 0 ? heading(i) : para(i)));
    const plain = article(40);
    const briefings = [briefing(0, 39, "root > child 1")];

    expect(expectedChildren(pending(0, 39), dense, CASCADE_RECIPE)).toBe(20);
    expect(expectedChildren(pending(0, 39), plain, CASCADE_RECIPE)).toBe(5);

    const withHeadings = expansionRequest({ briefings, blocks: dense, outline: OUTLINE, recipe: CASCADE_RECIPE });
    const without = expansionRequest({ briefings, blocks: plain, outline: OUTLINE, recipe: CASCADE_RECIPE });
    expect(withHeadings.maxTokens).toBeGreaterThan(without.maxTokens);
    expect(withHeadings.maxTokens - without.maxTokens).toBe((20 - 5) * 200);
  });

  it("refuses to assemble a request with no targets at all", () => {
    expect(() =>
      expansionRequest({ briefings: [], blocks, outline: OUTLINE, recipe: CASCADE_RECIPE }),
    ).toThrow(/at least one target/);
  });
});

describe("the overhead the packer is given", () => {
  const blocks = article(60);
  const briefings = [briefing(0, 9, "root > child 1"), briefing(10, 39, "root > child 2")];

  /**
   * `UNMEASURED_OVERHEAD`'s zeros make the hard request bound degenerate to the
   * evidence total, which is fine for a packing test and not fine in a wave.
   * These two numbers are what make `planExpansionBatches` honest about the
   * whole request.
   */
  it("measures the prefix and the per-target header off the real strings", () => {
    const overhead = expansionOverhead({ briefings, blocks, outline: OUTLINE });
    expect(overhead.prefixTokens).toBeGreaterThan(400);

    /* The per-target figure is the header and the chain, NOT the slice: a
       thirty-block target and a ten-block one differ by their evidence, which
       `estimateEvidenceTokens` counts separately. If this ever started
       including the blocks, every batch would be counted twice over. */
    expect(overhead.perTargetTokens).toBeLessThan(120);
    expect(overhead.perTargetTokens).toBeGreaterThan(0);
  });

  it("is the shape planExpansionBatches takes", () => {
    const calls = planExpansionBatches(
      briefings.map((b) => b.target),
      blocks,
      CASCADE_RECIPE,
      expansionOverhead({ briefings, blocks, outline: OUTLINE }),
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]!.kind).toBe("batch");
  });
});

/* ------------------------------------------------------------- the parse -- */

describe("reading a scoped answer strictly", () => {
  it("accepts the ordinary answer and hands it on as proposed children", () => {
    const sections = parseExpansionAnswer(
      wire([child({ start: blockId(0) }), child({ start: blockId(5), verdict: "needs-deeper" })]),
      1,
    );
    expect(sections).toHaveLength(1);
    expect(sections[0]!.section).toBe(1);
    expect(sections[0]!.children.map((c) => c.verdict)).toEqual(["finished", "needs-deeper"]);

    /* The parsed child IS a `ProposedChild`, which is the whole reason
       `ExpansionAnswerChild` extends it rather than restating it: the answer
       goes straight into the derivation with nothing in between to drop a
       field. */
    const report = emptyReport();
    const built = normaliseExpansion({
      children: sections[0]!.children,
      parent: [blockId(0), blockId(9)],
      blocks: article(10),
      where: "root > child 1",
      report,
    });
    expect(built.map((c) => c.node.range)).toEqual([
      [blockId(0), blockId(4)],
      [blockId(5), blockId(9)],
    ]);

    /* **And each node arrives holding the answer it was built from**, which is
       what makes the verdict a property of a child rather than of a position in
       a second array. `toBe`, not `toEqual`: the proposal is carried by identity,
       so a field this derivation has never heard of cannot be lost on the way
       through. */
    expect(built.map((c) => c.proposed.verdict)).toEqual(["finished", "needs-deeper"]);
    expect(built[0]!.proposed).toBe(sections[0]!.children[0]);
    expect(built[1]!.proposed).toBe(sections[0]!.children[1]);
  });

  /**
   * **The one this plan is named after.** A boolean that goes missing reads as
   * `false`, and `false` here means "finished" — so the node stops being asked
   * about, the tree is valid, and nothing anywhere says a word.
   */
  it("refuses a child with no verdict, under its own reason", () => {
    const missing = child();
    delete missing.verdict;
    const refusal = refusalFrom(() => parseExpansionAnswer(wire([missing, child()]), 1));
    expect(refusal.reason).toBe("missing-verdict");
    expect(refusal.message).toContain("section 1 > child 1");
    /* Nothing was derived, so nothing is claimed to have been. */
    expect(refusal.planned.repairs).toEqual([]);
    expect(refusal.planned.droppedChildren).toEqual([]);
  });

  it("refuses an explicit undefined verdict too", () => {
    /* `JSON.parse` cannot produce this, but a hit read back off a checkpoint or
       a fake executor can, and `"verdict" in child` alone would accept it. */
    const refusal = refusalFrom(() =>
      parseExpansionAnswer(
        JSON.stringify({ sections: [{ section: 1, children: [{ ...child(), verdict: undefined }] }] }),
        1,
      ),
    );
    expect(refusal.reason).toBe("missing-verdict");
  });

  it("refuses a verdict that is not one of the two spellings", () => {
    const refusal = refusalFrom(() => parseExpansionAnswer(wire([child({ verdict: "deeper" })]), 1));
    expect(refusal.reason).toBe("bad-verdict");
  });

  it("refuses the spike's boolean rather than reading it", () => {
    /* The format this replaced. `true` is meaningful to a human reading it and
       is exactly the value a lenient parser would quietly translate — so the
       refusal is what stops the old format working well enough that nobody
       notices the new one is not being sent. */
    for (const verdict of [true, false, null, 1]) {
      const refusal = refusalFrom(() => parseExpansionAnswer(wire([child({ verdict })]), 1));
      expect(refusal.reason).toBe(verdict === null ? "bad-verdict" : "bad-verdict");
    }
  });

  /**
   * **The late failure this makes early.** Every child a scoped call proposes
   * becomes an internal body node — `buildTree` grows its leaves under it, and
   * deepening never sees a supplement, which is the one exemption the rule
   * makes. So `checkTree` fails the whole article at `assertTreeSound` over one
   * absent sentence, *after* the entire cascade has been paid for. Re-asking one
   * batch is a few cents.
   */
  it("refuses a child with no gist, rather than leaving it to checkTree", () => {
    for (const gist of [undefined, ""]) {
      const broken = child();
      if (gist === undefined) delete broken.gist;
      else broken.gist = gist;
      const refusal = refusalFrom(() => parseExpansionAnswer(wire([broken]), 1));
      expect(refusal.reason).toBe("malformed-answer");
      expect(refusal.message).toContain(`"gist"`);
    }
  });

  it("refuses a child with no start, and one with no title", () => {
    for (const field of ["start", "title"] as const) {
      const broken = child();
      delete broken[field];
      const refusal = refusalFrom(() => parseExpansionAnswer(wire([broken]), 1));
      expect(refusal.reason).toBe("malformed-answer");
      expect(refusal.message).toContain(`"${field}"`);
    }
  });

  /**
   * **Whitespace is not content, and the length test used to think it was.**
   *
   * `"   ".length === 0` is false, so three spaces passed a check whose own
   * comment justified itself by saying `buildTree` applies its own truthiness a
   * moment later — and `"   "` is truthy in JavaScript. A gist of spaces reached
   * the tree as a real gist and rendered as a blank internal node the reader can
   * navigate to; a title of spaces is a blank row in the spine. Neither is what
   * a re-ask costs, and both are what a strict schema is for.
   *
   * Every kind of blank a model can actually emit, not only the space: a
   * newline, a tab and a non-breaking space are all things a wrapped answer has
   * produced. ⟨GPT Sol's review of stage 4, F4.⟩
   */
  it("refuses a start, a title or a gist that is only whitespace", () => {
    for (const field of ["start", "title", "gist"] as const) {
      for (const blank of ["   ", "\n", "\t", " ", " \n\t "]) {
        const refusal = refusalFrom(() =>
          parseExpansionAnswer(wire([child({ [field]: blank })]), 1),
        );
        expect(refusal.reason).toBe("malformed-answer");
        expect(refusal.message).toContain(`"${field}"`);
      }
    }
  });

  it("refuses children that are not an array, and a child that is not an object", () => {
    const notArray = refusalFrom(() =>
      parseExpansionAnswer(JSON.stringify({ sections: [{ section: 1, children: {} }] }), 1),
    );
    expect(notArray.reason).toBe("malformed-answer");
    expect(notArray.message).toContain("not an array");

    const notObject = refusalFrom(() => parseExpansionAnswer(wire(["a string"]), 1));
    expect(notObject.reason).toBe("malformed-answer");
  });

  it("refuses an answer that is not JSON, as a retryable refusal rather than a stage failure", () => {
    /* A truncated answer is the most retryable fault on this path, and
       `MalformedJson` would escape a `catch (e instanceof ExpansionRefused)`
       and become a failed step. Its message is content-free by construction, so
       carrying it costs nothing. */
    const refusal = refusalFrom(() => parseExpansionAnswer('{"sections": [{"section": 1,', 1));
    expect(refusal.reason).toBe("malformed-answer");
    expect(refusal.message).toContain("cut off");
  });

  it("refuses an answer that leaves one of its parents out", () => {
    const refusal = refusalFrom(() => parseExpansionAnswer(wire([child()], 1), 3));
    expect(refusal.reason).toBe("target-mismatch");
    expect(refusal.message).toContain("2, 3");
  });

  it("refuses an answer that covers a parent twice, or one nobody asked about", () => {
    const twice = refusalFrom(() =>
      parseExpansionAnswer(
        JSON.stringify({
          sections: [
            { section: 1, children: [child()] },
            { section: 1, children: [child()] },
          ],
        }),
        2,
      ),
    );
    expect(twice.reason).toBe("target-mismatch");

    const unknown = refusalFrom(() => parseExpansionAnswer(wire([child()], 4), 2));
    expect(unknown.reason).toBe("target-mismatch");
  });

  it("returns the sections in request order whatever order they arrived in", () => {
    const answer = JSON.stringify({
      sections: [
        { section: 2, children: [child({ title: "Second" })] },
        { section: 1, children: [child({ title: "First" })] },
      ],
    });
    const sections = parseExpansionAnswer(answer, 2);
    expect(sections.map((s) => s.section)).toEqual([1, 2]);
    expect(sections[0]!.children[0]!.title).toBe("First");
  });
});

/* ------------------------------------------- the real recorded answers ---- */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RECORDED = path.join(HERE, "../evals/results/hierarchy-waves-2026-09-04");

function recorded(name: string): string {
  return (JSON.parse(readFileSync(path.join(RECORDED, `${name}.json`), "utf-8")) as { raw: string })
    .raw;
}

/**
 * **The spike's format, translated into the wire's — and nothing else.**
 *
 * Two things changed between the spike and this stage, and both are format
 * rather than content:
 *
 * 1. `{"children": [...]}` became `{"sections": [{"section": 1, "children": …}]}`,
 *    because `planExpansionBatches` packs up to four parents into one call and
 *    the answer needs to say which parent it is talking about.
 * 2. `"needsDeeper": true|false` became `"verdict": "needs-deeper"|"finished"`,
 *    for the reason the whole file is about.
 *
 * Everything a model actually decided — the block ids, their order, the titles,
 * the gists, the `sourceHeading` claims, the empty ones Darwin's run sent, the
 * reasons — travels through untouched. That is what makes these worth using as
 * fixtures: no fixture written by hand would have thought to send eight empty
 * `sourceHeading`s.
 *
 * **The untranslated file does not parse**, and that is asserted below rather
 * than worked around: it is the same evidence read the other way.
 */
function asWireFormat(raw: string): string {
  const { children } = JSON.parse(raw) as { children: Record<string, unknown>[] };
  return JSON.stringify({
    sections: [
      {
        section: 1,
        children: children.map(({ needsDeeper, ...rest }) => ({
          ...rest,
          verdict: needsDeeper === true ? "needs-deeper" : "finished",
        })),
      },
    ],
  });
}

describe("against the three real answers the spike recorded", () => {
  const CASES = [
    { file: "expand-moby-0", children: 10, deeper: 6 },
    { file: "expand-moby-0b", children: 20, deeper: 1 },
    { file: "expand-darwin-0", children: 10, deeper: 0 },
  ] as const;

  for (const { file, children, deeper } of CASES) {
    it(`reads ${file} once its verdict field is in the new spelling`, () => {
      const sections = parseExpansionAnswer(asWireFormat(recorded(file)), 1);
      expect(sections[0]!.children).toHaveLength(children);
      expect(sections[0]!.children.filter((c) => c.verdict === "needs-deeper")).toHaveLength(deeper);
    });

    it(`refuses ${file} in the spike's own format`, () => {
      const refusal = refusalFrom(() => parseExpansionAnswer(recorded(file), 1));
      /* Not "missing-verdict": the spike's answer has no `sections` at all, so
         the shape fails before any child is read. Both halves of the format
         moved, and the refusal names the one it meets first. */
      expect(refusal.reason).toBe("malformed-answer");
    });
  }

  /**
   * **Presence, not truthiness.** Darwin's run sent `"sourceHeading": ""` on
   * eight of its ten children, and `buildTree` counts a claim it cannot back —
   * the empty string deliberately included — into `droppedHeadings`, because *"a
   * number, or a string of spaces, is a claim this stage threw away too"*. A
   * parser that dropped the empty ones would make the cascade report fewer
   * dropped headings than the incumbent would on identical output, silently. No
   * fixture written by hand would have thought to send eight of these.
   */
  it("carries an empty sourceHeading through rather than tidying it away", () => {
    const children = parseExpansionAnswer(asWireFormat(recorded("expand-darwin-0")), 1)[0]!.children;
    expect(children.filter((c) => c.sourceHeading === "")).toHaveLength(8);
    expect(children.filter((c) => c.sourceHeading === undefined)).toHaveLength(0);
  });

  it("refuses a recorded answer that has been re-wrapped but not re-spelled", () => {
    /* The dangerous half-migration: somebody wraps the old answers in
       `sections` and leaves `needsDeeper` alone. A lenient parser would read
       every child as finished and the cascade would stop after one wave with
       nothing to say. */
    const { children } = JSON.parse(recorded("expand-moby-0")) as { children: unknown[] };
    const refusal = refusalFrom(() =>
      parseExpansionAnswer(JSON.stringify({ sections: [{ section: 1, children }] }), 1),
    );
    expect(refusal.reason).toBe("missing-verdict");
  });

  /**
   * The finding the prompt above was written to remove, kept as a measurement:
   * one input, one prompt, two runs, and a fan-out that differed by a factor of
   * two. If a later prompt change makes these agree, this is where to notice.
   */
  it("records the variance the precedence rule exists to remove", () => {
    const a = parseExpansionAnswer(asWireFormat(recorded("expand-moby-0")), 1)[0]!.children;
    const b = parseExpansionAnswer(asWireFormat(recorded("expand-moby-0b")), 1)[0]!.children;
    expect(b.length).toBe(a.length * 2);
    expect(a.filter((c) => c.verdict === "needs-deeper").length).toBeGreaterThan(
      b.filter((c) => c.verdict === "needs-deeper").length,
    );
  });
});

/* --------------------------------------------------- the instrumentation -- */

describe("what was decided about a candidate", () => {
  const plain = article(40);
  /** Eight blocks, two authored headings: under the floor and over the heading rule. */
  const twoHeadings = article(40, (i) => (i === 10 || i === 14 ? heading(i) : para(i)));

  it("names the bound that overruled the model, and nothing where none did", () => {
    const cases: [ModelVerdict | null, ExpansionDecision, string | null][] = [
      ["finished", { decision: "expand", because: "authored-heading" }, "authored-heading"],
      ["finished", { decision: "expand", because: "forced-open" }, "forced-open"],
      ["needs-deeper", { decision: "stop", because: "depth-cap" }, "depth-cap"],
      ["needs-deeper", { decision: "stop", because: "divisibility-floor" }, "divisibility-floor"],
      /* The model got what it asked for: nothing overrode anything. */
      ["needs-deeper", { decision: "expand", because: "verdict" }, null],
      ["finished", { decision: "stop", because: "verdict" }, null],
      ["needs-deeper", { decision: "expand", because: "authored-heading" }, null],
      ["finished", { decision: "stop", because: "divisibility-floor" }, null],
      /* Nobody was asked, so nobody was overruled — the same correction
         `decideExpansion` made when it split `unassessed-ceiling` out. */
      [null, { decision: "expand", because: "unassessed-ceiling" }, null],
      [null, { decision: "stop", because: "no-verdict" }, null],
      [null, { decision: "expand", because: "authored-heading" }, null],
    ];
    for (const [raw, decision, expected] of cases) {
      expect([raw, decision.because, overrodeVerdict(raw, decision)]).toEqual([
        raw,
        decision.because,
        expected,
      ]);
    }
  });

  it("records the decision it actually took, with the counters behind it", () => {
    const record = recordCandidate({
      node: pending(10, 17),
      where: "root > child 2",
      wave: 2,
      depth: 2,
      blocks: twoHeadings,
      recipe: CASCADE_RECIPE,
      verdict: "finished",
      retries: 1,
      fanOut: 3,
    });
    /* Eight structural blocks — under the divisibility floor — and two authored
       headings, so the heading rule beats the floor and the model's "finished"
       is overruled. The eight-block two-heading node, which is the plan's own
       worked example of the precedence. */
    expect(record.structuralBlocks).toBe(8);
    expect(record.authoredHeadings).toBe(2);
    expect(record.effective).toEqual({ decision: "expand", because: "authored-heading" });
    expect(record.overriddenBy).toBe("authored-heading");
    expect(record.rawVerdict).toBe("finished");
    expect(record.wave).toBe(2);
    expect(record.retries).toBe(1);
    expect(record.fanOut).toBe(3);
    expect(record.effort).toBe(EXPAND_EFFORT);
    /* Off the constant, not the literal: this is asserting that the record
       carries *both* stamps, and pinning the scoped one's value here would make
       every prompt bump a two-file edit for no gain. `expand/2` is pinned once,
       under "the constants a scoped call is made with". */
    expect(record.promptVersion).toContain(EXPAND_PROMPT_VERSION);
    expect(record.promptVersion).toContain(PROMPT_VERSION);
    expect(record.model.length).toBeGreaterThan(0);
  });

  it("says nobody was asked rather than saying finished", () => {
    const record = recordCandidate({
      node: pending(0, 3),
      where: "root > child 1",
      wave: 1,
      depth: 1,
      blocks: plain,
      recipe: CASCADE_RECIPE,
    });
    expect(record.rawVerdict).toBeNull();
    expect(record.fanOut).toBeNull();
    expect(record.overriddenBy).toBeNull();
    expect(record.effective.because).toBe("divisibility-floor");
  });

  /**
   * **The number the plan asks for as a first-class figure**: a model that
   * always says "deeper" turns a bounded cascade into a bill, and the raw yes
   * rate is the only thing that shows it before the invoice does.
   */
  it("counts the raw and effective yes rates, and which bound did the work", () => {
    const records: CandidateRecord[] = [
      recordCandidate({ node: pending(0, 19), where: "a", wave: 2, depth: 1, blocks: plain, recipe: CASCADE_RECIPE, verdict: "needs-deeper" }),
      recordCandidate({ node: pending(20, 39), where: "b", wave: 2, depth: 1, blocks: plain, recipe: CASCADE_RECIPE, verdict: "finished" }),
      recordCandidate({ node: pending(10, 17), where: "c", wave: 2, depth: 1, blocks: twoHeadings, recipe: CASCADE_RECIPE, verdict: "finished" }),
      recordCandidate({ node: pending(0, 19), where: "d", wave: 1, depth: 1, blocks: plain, recipe: CASCADE_RECIPE }),
    ];
    const tally = tallyVerdicts(records);
    expect(tally).toEqual({
      candidates: 4,
      rawYes: 1,
      rawNo: 2,
      unassessed: 1,
      /* a expands on its verdict and c on the heading rule. b is twenty plain
         paragraphs the model called finished, and 240 words is under the
         ceiling, so its verdict stands. **d is the interesting one**: twenty
         blocks, well over the floor, and it stops — because nobody has been
         asked and an unassessed node under the ceiling errs towards not
         spending money it was never told to. It is `no-verdict`, not
         `verdict`, and that is the distinction the whole union exists for. */
      effectiveYes: 2,
      overrides: {
        "authored-heading": 1,
        "depth-cap": 0,
        "divisibility-floor": 0,
        "forced-open": 0,
      },
    });
  });
});

/* ============================================ one repeat against another == */

/**
 * **`where` is not a repeat-stable identity, and question 1 is built on
 * pairing.**
 *
 * `where` is an ordinal path derived from the answer's own fan-out, so two
 * repeats that split the same parent at *different points* both emit
 * `root > child 1` — and a boundary that moved is silently paired as "the same
 * node" and read as a stable verdict. That corrupts the one question most
 * likely to retire the feature. ⟨GPT Sol's second review of stage 5a,
 * finding 6.⟩
 *
 * The fix a record can carry is its **derived range**; the pairing and the
 * classification of what will not pair are `evals/deepen/report.ts` §
 * `compareRepeats`, which refuses to compare a record without one
 * (`requireRanges`). This is the half that has to exist for that to work.
 */
describe("what makes one repeat's records pairable with another's", () => {
  const plain = article(60);

  it("carries the derived range, which is block ids and therefore safe to write down", () => {
    const record = recordCandidate({
      node: pending(10, 17),
      where: "root > child 1 > child 1",
      wave: 2,
      depth: 2,
      blocks: plain,
      recipe: CASCADE_RECIPE,
      verdict: "finished",
    });
    expect(record.range).toEqual([blockId(10), blockId(17)]);
  });

  /* Two runs that split one parent at different points produce the identical
     ordinal paths, so the range is the only thing that tells them apart. */
  it("gives two different splits of one parent different identities", () => {
    const at = (from: number, to: number): CandidateRecord =>
      recordCandidate({
        node: pending(from, to),
        where: "root > child 1 > child 2",
        wave: 2,
        depth: 2,
        blocks: plain,
        recipe: CASCADE_RECIPE,
        verdict: "finished",
      });
    const a = at(20, 39);
    const b = at(30, 39);
    expect(a.where).toBe(b.where);
    expect(a.range).not.toEqual(b.range);
  });

  it("carries one for a node nobody was asked about too", () => {
    const record = recordCandidate({
      node: pending(0, 19),
      where: "root > child 1",
      wave: 1,
      depth: 1,
      blocks: plain,
      recipe: CASCADE_RECIPE,
    });
    expect(record.range).toEqual([blockId(0), blockId(19)]);
  });
});
