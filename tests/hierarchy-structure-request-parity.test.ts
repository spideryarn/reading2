/**
 * Parity pin for the structure call — the exact bytes generateHierarchy sends.
 *
 * Written BEFORE the structureRequest extraction and seen passing against the
 * un-refactored src/hierarchy.ts, so the refactor is provably a pure extraction: the
 * pinned bytes are a snapshot of what production sent on 2026-08-30, copied
 * here once, not derived at run time from the code under test (an expectation
 * derived from the thing it checks agrees with every value of it).
 *
 * It exists because the eval executor (evals/hierarchy-structure/model-arms.ts)
 * builds the same request through the shared structureRequest export, and an
 * executor that drifted by one byte of prompt would be measuring a recipe the
 * pipeline does not ship — GPT Sol's finding 7, the phase-2 blocker.
 *
 * SEEN RED, 2026-08-30, twice, before being trusted: once with a single space
 * added to SYSTEM (the system-bytes assertion fired), once with EFFORT flipped
 * to "medium" (the output_config assertion fired). Both perturbations reverted.
 */

import { describe, expect, it, vi } from "vitest";
import { nullCheckpointStore } from "../src/store/checkpoints.js";
import type { Block } from "../src/types.js";

/* The capture. streamMessage is mocked to record the one body generateHierarchy
   hands it and then fail the call, so nothing model-shaped runs and nothing
   past the structure call (the label pass, the artefact writes) executes. */
const captured: { task: string; body: Record<string, unknown> }[] = [];

vi.mock("../src/messages-stream.js", () => ({
  streamMessage: (task: string, body: Record<string, unknown>) => {
    captured.push({ task, body });
    return {
      onText: () => {},
      finalMessage: () => Promise.reject(new Error("parity-sentinel: request captured")),
      aborted: () => false,
    };
  },
  wasRefused: () => false,
}));

const { generateHierarchy, structureRequest } = await import("../src/hierarchy.js");

/** The system prompt production sends, byte for byte. THE pin — do not "tidy" it. */
const EXPECTED_SYSTEM = `You are building a nested table of contents for an article. It goes all the
way down to individual paragraphs, and it will be rendered as a navigation sidebar.

You receive the article as a numbered list of blocks. Each block has an id
(e.g. spya-k3m9qt), a tag, and its text. Some are marked NOT-GISTABLE.

STRUCTURE

Produce a tree of INTERNAL nodes only. Every node covers a contiguous range of
blocks, and a node's children exactly partition its range — no gaps, no
overlaps, no reordering. The first child starts where its parent starts; the
last child ends where its parent ends.

- The article's own headings are HARD boundaries. A node must begin at a
  heading block wherever one exists. Never merge across a heading.
- Where a run between headings is longer than ~9 blocks, propose your own
  boundaries inside it at genuine topic shifts, and title those nodes.
- Aim for 5-9 children per node so each level is an even stride.
- Go 3 levels deep: root (depth 0), chapters (depth 1), sections (depth 2).
- Do NOT emit leaf nodes for individual blocks. Stop at the section level.

TITLES (internal nodes)

- 2-6 words. A title is a landmark, scanned at a glance.
- Where the author gave the section a heading, use that heading's text
  UNCHANGED and repeat it in "sourceHeading". Rewrite it ONLY if it shares no
  content word with its section body, or is a stock label ("Introduction",
  "Background", "Part Two"). Rewriting should be rare.
- No trailing punctuation.

GISTS (internal nodes)

- Exactly ONE sentence. This is what the reader sees at the zoom level above.
- It must be a CLAIM or a MOVE, not a topic label.
- Write a parent's gist from its children, not from the raw text.

OUTPUT

JSON only, no prose, no code fence:

{"root": {"title": "...", "gist": "...", "range": ["<firstBlockId>", "<lastBlockId>"],
          "sourceHeading": "...", "children": [ ... ]}}

Use only block ids that appear in the input. Do not invent ids.`;

const BLOCKS: Block[] = [
  { id: "spya-par001", tag: "h2", kind: "heading", level: 2, text: "First Part", words: 2, html: "<h2>First Part</h2>", gistable: true },
  { id: "spya-par002", tag: "p", kind: "text", text: "Some prose about turnips.", words: 4, html: "<p>Some prose about turnips.</p>", gistable: true },
  { id: "spya-par003", tag: "img", kind: "media", text: "A diagram.", words: 2, html: "<img>", gistable: false },
  { id: "spya-par004", tag: "h2", kind: "heading", level: 2, text: "Second Part", words: 2, html: "<h2>Second Part</h2>", gistable: true },
  { id: "spya-par005", tag: "p", kind: "text", text: "More prose entirely.", words: 3, html: "<p>More prose entirely.</p>", gistable: true },
];

/** What renderBlocks makes of those five, spelled out rather than recomputed. */
const EXPECTED_USER = [
  "[0] spya-par001 <h2>: First Part",
  "[1] spya-par002 <p>: Some prose about turnips.",
  "[2] spya-par003 <img> NOT-GISTABLE: A diagram.",
  "[3] spya-par004 <h2>: Second Part",
  "[4] spya-par005 <p>: More prose entirely.",
].join("\n\n");

/* estimateHierarchyTokens: 500 + (ceil(5/4) + 6) * 175 = 1900; budgetFor adds the
   40,000-token thinking headroom. Literals, not the formulae re-run. */
const EXPECTED_MAX_TOKENS = 41_900;

/* No temp directory: the stage takes the blocks themselves and writes nothing,
   so the fixture is the array above and the pinned bytes are unaffected. */

describe("the structure call's request", () => {
  it("sends exactly the pinned bytes and settings", async () => {
    captured.length = 0;
    await expect(
      generateHierarchy({ blocks: BLOCKS, slug: "fixture", checkpoints: nullCheckpointStore() }),
    ).rejects.toThrow(); // the mocked call fails on purpose, after capture
    expect(captured).toHaveLength(1);

    const { task, body } = captured[0]!;
    expect(task).toBe("hierarchy");
    expect(body.system).toBe(EXPECTED_SYSTEM);
    expect(body.messages).toEqual([{ role: "user", content: EXPECTED_USER }]);
    expect(body.thinking).toEqual({ type: "adaptive" });
    /* `medium` since 2026-08-30. Written out rather than read from `EFFORT`,
       which is the whole point of a pin: importing the constant would make this
       agree with any value the stage happens to hold. It fired when the value
       changed, which is it working. See the note on `EFFORT` in src/hierarchy.ts. */
    expect(body.output_config).toEqual({ effort: "medium" });
    expect(body.max_tokens).toBe(EXPECTED_MAX_TOKENS);
    // Nothing else rides along: the exact key set is part of the request.
    expect(Object.keys(body).sort()).toEqual([
      "max_tokens", "messages", "output_config", "system", "thinking",
    ]);
  });

  it("structureRequest is the same request - parity by construction, checked anyway", async () => {
    captured.length = 0;
    await expect(
      generateHierarchy({ blocks: BLOCKS, slug: "fixture", checkpoints: nullCheckpointStore() }),
    ).rejects.toThrow();
    const { body } = captured[0]!;
    const req = structureRequest(BLOCKS);
    expect(req.system).toBe(body.system);
    expect(req.user).toBe((body.messages as { content: string }[])[0]!.content);
    expect(req.maxTokens).toBe(body.max_tokens);
    expect(req.effort).toBe((body.output_config as { effort: string }).effort);
  });
});
