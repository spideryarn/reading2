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
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
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

/**
 * **A temp directory, deliberately not `data/`.**
 *
 * The four stages under test take an explicit `dir`, so nothing here needs the
 * corpus — and living in it was an active hazard rather than a neutral choice.
 * `store-parity`, `store-roundtrip`, `chat-anchor` and `store-artefact-manifest`
 * each enumerate *every* directory under `data/` and load what they find through
 * the real write path; a fixture that is a complete article gets swept into
 * somebody else's suite, and this one is a copy of `example/`.
 *
 * It showed up exactly as `tests/helpers/corpus-lock.ts` describes: clean runs,
 * then two, then six, then eight failures, all of them a stage throwing before
 * it built a prompt. Nothing about the policy under test.
 */
let DIR: string;

let blocks: Block[];
let tree: Tree;
let meta: Meta;

beforeAll(async () => {
  DIR = await mkdtemp(path.join(tmpdir(), "block-policy-prompts-"));
  await cp(path.join(ROOT, "example"), DIR, { recursive: true });

  const file = path.join(DIR, "blocks.json");
  const parsed = JSON.parse(await readFile(file, "utf8")) as { blocks: Block[] };
  blocks = parsed.blocks;

  /* The **last two** blocks become one note, so the root's range still ends on
     it and `textOf` still slices over it — which is the case summarise.ts has
     to filter for itself, and the one a prompt-builder filter would miss.

     **Two rather than one, and that is the difference between this file testing
     the labels prompt and not testing it.** `renderBatch` prints a context
     window of `CONTEXT_BLOCKS` — one — either side of a batch's span, and on
     this fixture the last *labellable* block is index 31. A single note at index
     33 is two past it: outside the window, absent from the prompt, and the
     assertion passes on code that sends the whole bibliography. Measured, with
     the guard removed, before this line was written (`output/labels-probe.mts`).
     A real article's apparatus is a run of blocks beginning immediately after
     the body, which is what this now is. */
  const noteRun = blocks.slice(-2);
  for (const [i, note] of noteRun.entries()) {
    note.text = `A note about ${NOTE_WORD}, part ${i + 1}, which nobody reads front to back.`;
    note.words = note.text.split(/\s+/).length;
    note.gistable = true;
    note.kind = "text";
    note.role = "footnote";
    note.treatment = "supplement";
    /* One `noteId` across both, because a note is a RANGE of blocks and not a
       block — docs/plans/footnotes.md § A note is a range of blocks. */
    note.noteId = "note-1";
  }

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
  /* The thrown error is **kept**, not swallowed. Every stage here is expected
     to throw — the mock does it deliberately — so `.catch(() => undefined)`
     looks right and is what this had first. Then a stage that failed *before*
     building a prompt gave `sent.length === 0` and an assertion reading
     "expected 0 to be greater than 0", which says nothing about the cause. The
     guard was doing its job and the diagnosis was missing. */
  const thrown = await run().then(
    () => null,
    (err: unknown) => err,
  );
  const why = thrown instanceof Error ? thrown.message : String(thrown);
  expect(
    sent.length,
    `the stage sent no request before failing — ${why}`,
  ).toBeGreaterThan(0);
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
    /* `previous: null` — a first pass, which is what this fixture is. The
       argument is required so that landing D cannot drop it silently; here it
       is the honest value rather than a placeholder. src/glossary.ts. */
    const prompt = await promptOf(() => generateGlossary({ dir: DIR, previous: null }));
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
    const prompt = await promptOf(() => generateIdeas({ dir: DIR, previous: null }));
    expect(prompt).toContain(BODY_WORD);
    expect(prompt).not.toContain(NOTE_WORD);
  });

  it("the table of contents — the largest call in the pipeline", async () => {
    /* **The one the policy's own claim was false for.** `renderBlocks` sends
       every block's text and marks a block NOT-GISTABLE when `!b.gistable` — and
       a prose footnote *is* gistable, so a note was not even marked, let alone
       withheld. The model could then invent sections and gists over the
       apparatus, and `buildTree` copies those gists straight through into the
       arc, the tweets, the glossary and the ideas, all of whose own evidence is
       filtered. GPT Sol's review of stage 3, 2026-08-28.
       The fix is stage 4's own ordering: the tree is built over the body alone
       and the supplement node is appended afterwards (src/supplement.ts), so
       the model is never handed a note at all. Handing it one with a label
       would not have been a fix. */
    const { generateToc } = await import("../src/toc.js");
    const prompt = await promptOf(() =>
      generateToc({ blocksPath: path.join(DIR, "blocks.json"), outDir: DIR }),
    );
    expect(prompt).toContain(BODY_WORD);
    expect(prompt).not.toContain(NOTE_WORD);
  });

  it("the table of contents, even for an article the split gives up on", async () => {
    /* **The hole the first fix left.** Building the tree over the body alone
       withholds the notes only while `splitBlocks` finds them — and it refuses
       the whole split when a note is stranded in the middle of the article
       (src/supplement.ts), handing the model every block again. Zero of the
       seven committed fixtures are that shape, so nothing would have caught
       this; `renderBlocks` withholds a supplement's prose itself, and this is
       the only input that exercises that line. */
    const dir = await mkdtemp(path.join(tmpdir(), "block-policy-prompts-stranded-"));
    try {
      await cp(path.join(ROOT, "example"), dir, { recursive: true });
      const stranded = blocks.map((b) => ({ ...b }));
      /* One note in the middle of the argument, which is what a sidenote whose
         stamp landed mid-prose looks like. */
      const mid = stranded[5]!;
      mid.text = `A stranded note about ${NOTE_WORD}, mid-argument.`;
      mid.words = mid.text.split(/\s+/).length;
      mid.role = "footnote";
      mid.treatment = "supplement";
      mid.noteId = "note-2";
      await writeFile(path.join(dir, "blocks.json"), JSON.stringify({ blocks: stranded }));

      const { splitBlocks } = await import("../src/supplement.js");
      // The precondition, asserted rather than assumed: this really is the
      // fallback path, or the test is about the ordinary one all over again.
      expect(splitBlocks(stranded).groups).toEqual([]);

      const { generateToc } = await import("../src/toc.js");
      const prompt = await promptOf(() =>
        generateToc({ blocksPath: path.join(dir, "blocks.json"), outDir: dir }),
      );
      expect(prompt).toContain(BODY_WORD);
      expect(prompt).not.toContain(NOTE_WORD);
      // And the block is still nameable, or no node could cover it.
      expect(prompt).toContain(mid.id);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("the nav labels — every batch of them", async () => {
    /* **The second one, and marking is not hiding.** `renderBatch` prints a
       context window of `CONTEXT_BLOCKS` either side of the batch, in full, and
       the last batch of a noted article always reaches into the notes — they
       sit immediately after the body. Moving the marker to `isStructural` was
       right and was not enough: the block's own text went out beneath it.

       The tree here is the fixture's own — a *pre*-stage-4 tree, in which the
       note has an ordinary leaf under a body section. That is the stricter
       input on purpose: `renderBatch` must refuse the prose whatever shape the
       tree is in, rather than relying on stage 4 having run. */
    const { generateLabels } = await import("../src/labels.js");
    const prompt = await promptOf(() =>
      generateLabels({ tree, blocks, slug: "block-policy-prompts" }),
    );
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

  it("summaries — and the apparatus is not offered as a part of the argument", async () => {
    /* **Withholding the prose was not enough, and the test above cannot see
       it.** That one runs against the fixture's own *pre*-stage-4 tree, which
       has no supplement node in it — so it says nothing about the shape stage 4
       actually produces. With a supplement appended, `skeletonOf` walked
       `root.children` and printed

           PART 4: Notes
             gist: (none)

       into the whole-article prompt: the model is told the apparatus is a part
       it must account for, and invited to explain the empty one. The note text
       was absent the whole time, which is exactly why a NOTE_WORD assertion
       stays green through it. GPT Sol's review of stage 4, 2026-08-28. */
    const dir = await mkdtemp(path.join(tmpdir(), "block-policy-prompts-skeleton-"));
    try {
      await cp(path.join(ROOT, "example"), dir, { recursive: true });
      await writeFile(path.join(dir, "blocks.json"), JSON.stringify({ blocks }));

      const { splitBlocks, appendSupplement, isSupplementNode } = await import(
        "../src/supplement.js"
      );
      const { groups } = splitBlocks(blocks);
      /* The precondition, asserted rather than assumed: without a supplement
         node in the tree this test is the one above wearing a second hat. */
      expect(groups.length).toBe(1);
      const base = JSON.parse(await readFile(path.join(dir, "tree.json"), "utf8")) as Tree;
      const withNotes = appendSupplement(base, groups);
      const supplement = Object.values(withNotes.nodes).find((n) => isSupplementNode(n));
      expect(supplement).toBeDefined();
      await writeFile(path.join(dir, "tree.json"), JSON.stringify(withNotes));

      const { generateSummaries } = await import("../src/summarise.js");
      const prompt = await promptOf(() => generateSummaries({ dir }));

      expect(prompt).toContain(BODY_WORD);
      expect(prompt).not.toContain(NOTE_WORD);
      /* The node's own title, as the skeleton would print it. Matched with the
         PART prefix rather than bare, because "Notes" is an ordinary word that
         may legitimately appear in an article's prose. */
      expect(prompt).not.toMatch(
        new RegExp(`PART \\d+: ${supplement!.title!.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}`),
      );
      // And no part is offered with an empty gist, which is the same fact from
      // the other side and does not depend on the title.
      expect(prompt).not.toContain("gist: (none)");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
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
