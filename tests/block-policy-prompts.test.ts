/**
 * **A word planted in a footnote, and where it is allowed to turn up.**
 *
 * The policy is not "notes are hidden from models". It is: hidden from
 * **automatic** model work — the arc, the glossary, the ideas, the thread, the
 * summaries, which describe the argument — and visible to **asked** model work
 * — explain, search and chat, where a reader has pointed at something and wants
 * an answer about it. Both halves in one file, because either alone passes on
 * code that does the wrong thing everywhere.
 *
 * ## Why this is the test that matters
 *
 * The obvious place to filter is inside `articleText` and `articleWithIds`, and
 * the two builders look exactly like the seam: bare text for the stages that do
 * not cite, ids for the stages that do. They are not that seam. `ideas` is
 * automatic **and** sends ids, so filtering in the builders is right three
 * times out of four and silently leaves the ideas stage reading the
 * bibliography — with a comment two lines above it explaining why it needs ids,
 * so the next person does not think to look. docs/plans/footnotes.md.
 *
 * ## And why there is a second token
 *
 * "The note is absent from the arc's prompt" is satisfied by a prompt that is
 * empty, by a stage that threw before building one, and by a mock that captured
 * nothing. So every assertion here is a pair: the body's word must be **there**
 * in the same captured bytes that the note's word is missing from.
 * docs/reusable/silent-success.md.
 *
 * The four automatic stages are driven for real — real files on disk, the real
 * generator — with `streamMessage` replaced by one that records the request and
 * throws. The three asked ones have exported, pure prompt builders and need no
 * such thing.
 */
import { cp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { Block, Meta, Tree } from "../src/types.js";

/** Distinctive enough that a hit cannot come from the fixture's own prose. */
const NOTE_WORD = "zibbleflux";
const BODY_WORD = "quibnarly";

/** Every request the stage under test made, flattened to text. */
const sent: string[] = [];

vi.mock("../src/messages-stream.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/messages-stream.js")>();
  return {
    ...real,
    streamMessage: (_task: string, body: unknown) => {
      sent.push(JSON.stringify(body));
      /* Thrown rather than answered with a canned message. The prompt is built
         before the call and that is the only thing under test; faking a reply
         would mean faking whatever each of four stages parses out of it, which
         is four more chances for this file to pass for a reason of its own. */
      throw new Error("no model calls in tests");
    },
  };
});

const ROOT = path.resolve(import.meta.dirname, "..");
const SLUG = "test-block-policy-prompts";
const DIR = path.join(ROOT, "data", SLUG);

let blocks: Block[];
let tree: Tree;
let meta: Meta;

beforeAll(async () => {
  await rm(DIR, { recursive: true, force: true });
  await cp(path.join(ROOT, "example"), DIR, { recursive: true });

  const file = path.join(DIR, "blocks.json");
  const parsed = JSON.parse(await readFile(file, "utf8")) as { blocks: Block[] };
  blocks = parsed.blocks;

  /* The **last** block becomes the note, so the root's range still ends on it
     and `textOf` still slices over it — which is the case summarise.ts has to
     filter for itself, and the one a prompt-builder filter would miss. */
  const note = blocks[blocks.length - 1]!;
  note.text = `A note about ${NOTE_WORD}, which nobody reads front to back.`;
  note.words = note.text.split(/\s+/).length;
  note.gistable = true;
  note.kind = "text";
  note.role = "footnote";
  note.treatment = "supplement";
  note.noteId = "note-1";

  /* The control. Its word must be in every prompt the note's word is missing
     from, or "absent" is a statement about the harness rather than the code. */
  const body = blocks[1]!;
  body.text = `The argument turns on ${BODY_WORD}, stated plainly.`;
  body.words = body.text.split(/\s+/).length;
  body.gistable = true;
  body.kind = "text";

  await writeFile(file, JSON.stringify({ blocks }));
  tree = JSON.parse(await readFile(path.join(DIR, "tree.json"), "utf8")) as Tree;
  meta = JSON.parse(await readFile(path.join(DIR, "meta.json"), "utf8")) as Meta;
});

afterAll(() => rm(DIR, { recursive: true, force: true }));

/** Run a stage that is about to fail on the mocked call, and return what it sent. */
async function promptOf(run: () => Promise<unknown>): Promise<string> {
  sent.length = 0;
  await run().catch(() => undefined);
  expect(sent.length).toBeGreaterThan(0);
  return sent.join("\n");
}

describe("the automatic stages never see the note", () => {
  it("arc", async () => {
    const { generateArc } = await import("../src/arc.js");
    const prompt = await promptOf(() => generateArc({ dir: DIR }));
    expect(prompt).toContain(BODY_WORD);
    expect(prompt).not.toContain(NOTE_WORD);
  });

  it("glossary", async () => {
    const { generateGlossary } = await import("../src/glossary.js");
    const prompt = await promptOf(() => generateGlossary({ dir: DIR }));
    expect(prompt).toContain(BODY_WORD);
    expect(prompt).not.toContain(NOTE_WORD);
  });

  it("tweets", async () => {
    const { generateTweets } = await import("../src/tweets.js");
    const prompt = await promptOf(() => generateTweets({ dir: DIR }));
    expect(prompt).toContain(BODY_WORD);
    expect(prompt).not.toContain(NOTE_WORD);
  });

  it("ideas — the one the obvious refactor gets wrong", async () => {
    /* `ideas` sends `articleWithIds`, the same builder explain, search and
       converse send, and it is automatic. Filtering inside the builder would be
       green on arc, glossary and tweets and would leave this one reading the
       bibliography. */
    const { generateIdeas } = await import("../src/ideas.js");
    const prompt = await promptOf(() => generateIdeas({ dir: DIR }));
    expect(prompt).toContain(BODY_WORD);
    expect(prompt).not.toContain(NOTE_WORD);
  });

  it("summaries — which build their text by slicing a range, not by calling a builder", async () => {
    /* `textOf` slices `blocks` over a node's range and filtered only on
       `b.text`, so the root — whose range ends at the last note — would carry
       the whole apparatus into the whole-article summary whatever the four
       stages above do. */
    const { generateSummaries } = await import("../src/summarise.js");
    const prompt = await promptOf(() => generateSummaries({ dir: DIR }));
    expect(prompt).toContain(BODY_WORD);
    expect(prompt).not.toContain(NOTE_WORD);
  });
});

describe("the asked stages still see the note", () => {
  /* The other half, and the half a refactor that "cleans up" the call sites
     silently breaks. A reader who selects a footnote and asks what it means
     must get an answer about the footnote. */

  it("explain", async () => {
    const { buildExplainMessages } = await import("../src/explain.js");
    const text = JSON.stringify(
      buildExplainMessages(meta, blocks, "a quoted phrase", blocks[0]!.id, false),
    );
    expect(text).toContain(NOTE_WORD);
    expect(text).toContain(BODY_WORD);
  });

  it("search", async () => {
    const { buildSearchMessages } = await import("../src/search.js");
    const text = JSON.stringify(buildSearchMessages(meta, blocks, "anything"));
    expect(text).toContain(NOTE_WORD);
    expect(text).toContain(BODY_WORD);
  });

  it("converse", async () => {
    const { buildConverseMessages } = await import("../src/converse.js");
    const text = JSON.stringify(
      buildConverseMessages({ meta, blocks, history: [], question: "What does the note say?" }),
    );
    expect(text).toContain(NOTE_WORD);
    expect(text).toContain(BODY_WORD);
  });
});

describe("the tree still covers the note", () => {
  it("gives it a leaf, because this stage changes labels and not shape", async () => {
    /* Stated here rather than left implicit: a reader still scrolls through the
       notes, the ToC still has to tile them, and the supplement node that gives
       them one visible row is the next stage. */
    const leaves = Object.values(tree.nodes).filter((n) => n.children.length === 0);
    const noteId = blocks[blocks.length - 1]!.id;
    expect(leaves.some((n) => n.range[0] === noteId)).toBe(true);
  });
});
