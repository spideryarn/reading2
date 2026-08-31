/**
 * Stage 5a — what a reader's pointer finds in the prose: src/web/notes-view.ts.
 *
 * Two halves, and the second is what makes the first mean anything.
 *
 * **The decisions**, over DOM built by hand in the shapes stage 2 actually
 * produces — a marker, a superscript that is a power, a stamp whose target is
 * ordinary prose. These are the cases the corpus does not contain and cannot be
 * made to contain, because they are the ways the rule can be *wrong*.
 *
 * **The corpus**, through the real pipeline. `wiki_transformer` has one note
 * cited thirteen times and 170 markers; `gwern` has a note that is eight blocks
 * long. Neither shape can be invented convincingly, and a preview that clipped a
 * note to its first block, or a back-link resolution that collapsed thirteen
 * points of use into one, would pass every hand-built assertion above while
 * being visibly wrong on both fixtures.
 *
 * The DOM those tests run against is the markup `TableView` renders — one `<tr
 * data-block>` per block with the stored html inside a `.prose` div — because
 * `internalTarget` resolves against exactly that and nothing else.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { JSDOM } from "jsdom";
import { beforeAll, describe, expect, it } from "vitest";

import { splitIntoBlocks } from "../src/blocks.js";
import { runExtract } from "../src/extract.js";
import type { Block } from "../src/types.js";
import {
  buildNoteIndex,
  isBackLink,
  markReturnPath,
  noteMarkerAt,
  notePreviewHtml,
  type NoteBlock,
} from "../src/web/notes-view.js";

/** The markup TableView renders: one row per block, stored html in the cell. */
function render(blocks: readonly NoteBlock[]): Document {
  const rows = blocks
    .map((b) => `<tr data-block="${b.id}"><td><div class="prose">${b.html}</div></td></tr>`)
    .join("");
  return new JSDOM(`<table><tbody>${rows}</tbody></table>`).window.document;
}

const note = (over: Partial<NoteBlock> & { id: string; html: string }): NoteBlock => ({
  tag: "li",
  role: "footnote",
  treatment: "supplement",
  noteId: "spya-note-aaaaaaaaaa",
  ...over,
});
const body = (id: string, html: string): NoteBlock => ({ id, tag: "p", html });

const marker = (noteId: string, blockId: string, label = "1", markerId = "fnref1") =>
  `<sup><a href="#${blockId}" id="${markerId}" data-spya-note-ref="${noteId}">${label}</a></sup>`;

/* -------------------------------------------------------------------------- */
/* 1. Recognising a marker                                                     */
/* -------------------------------------------------------------------------- */

describe("noteMarkerAt", () => {
  const blocks = [
    body("spya-bdyaa2", `<p>A claim.${marker("spya-note-aaaaaaaaaa", "spya-ntyaa2")}</p>`),
    note({
      id: "spya-ntyaa2",
      html: `<li id="spya-ntyaa2" data-spya-note="spya-note-aaaaaaaaaa"><p>The note.</p> <a href="#spya-bdyaa2" data-spya-note-back="spya-note-aaaaaaaaaa">↩</a></li>`,
    }),
  ];
  const index = buildNoteIndex(blocks);

  it("finds the note from the marker, and from a click inside it", () => {
    const doc = render(blocks);
    const found = noteMarkerAt(doc.querySelector("sup a")!, doc, index);
    expect(found?.note.id).toBe("spya-note-aaaaaaaaaa");
    expect(found?.blockId).toBe("spya-ntyaa2");
    expect(found?.label).toBe("1");
  });

  /* Delegation hands the card the deepest node under the pointer, and Wikipedia
     wraps its marker's digits in two spans — so the element `read` gets is
     usually *inside* the anchor rather than the anchor itself. */
  it("finds it from a span inside the marker", () => {
    const nested = [
      body(
        "spya-bdyaa7",
        `<p>A claim.<sup><a href="#spya-ntyaa2" id="ref9" data-spya-note-ref="spya-note-aaaaaaaaaa"><span>[<span>1</span>]</span></a></sup></p>`,
      ),
      blocks[1] as NoteBlock,
    ];
    const doc = render(nested);
    const deepest = doc.querySelector("sup a span span")!;
    expect(noteMarkerAt(deepest, doc, buildNoteIndex(nested))?.note.id).toBe(
      "spya-note-aaaaaaaaaa",
    );
  });

  /* The rule this file exists to state. `x²` and `1ˢᵗ` and `Acme™` are all
     superscripts, and a marker detector keyed off `<sup>` calls every one of
     them a footnote. */
  it("refuses a superscript that is a power", () => {
    const powers = [
      body("spya-bdyaa3", `<p>e = mc<sup>2</sup>, and the 1<sup>st</sup> of them.</p>`),
      ...blocks,
    ];
    const doc = render(powers);
    expect(noteMarkerAt(doc.querySelector("sup")!, doc, buildNoteIndex(powers))).toBe(null);
  });

  /* The second half of the recognition rule, and the reason it is not just an
     attribute test: the attribute cannot be forged by a page — stage 2 scrubs
     every copy of it off the input — but a buggy pipeline could write one, and
     what catches that is resolving it and looking at what is really there. */
  it("refuses a stamp whose target is not a note block", () => {
    /* **The note it names is real, and in the index.** Without that the
       assertion passes for the wrong reason — an unknown note id is refused by
       any implementation, including one that never looks at the target at all,
       which is exactly the mutation this test exists to catch. */
    const forged = [
      body(
        "spya-bdyaa4",
        `<p>See<sup><a href="#spya-bdyaa5" data-spya-note-ref="spya-note-aaaaaaaaaa">1</a></sup></p>`,
      ),
      body("spya-bdyaa5", `<p>Ordinary prose that nobody classified.</p>`),
      blocks[1] as NoteBlock,
    ];
    const index = buildNoteIndex(forged);
    expect(index.byNote.has("spya-note-aaaaaaaaaa")).toBe(true);
    const doc = render(forged);
    expect(noteMarkerAt(doc.querySelector("sup a")!, doc, index)).toBe(null);
  });

  /* Both come from one stage-2 stamp, so they cannot honestly disagree. If they
     do, the honest answer is no card rather than a card about whichever note the
     href happened to reach. */
  it("refuses a stamp that names a different note from the block it lands on", () => {
    const crossed = [
      body(
        "spya-bdyaa6",
        `<p>See<sup><a href="#spya-ntyaa2" data-spya-note-ref="spya-note-bbbbbbbbbb">1</a></sup></p>`,
      ),
      blocks[1] as NoteBlock,
    ];
    const doc = render(crossed);
    expect(noteMarkerAt(doc.querySelector("sup a")!, doc, buildNoteIndex(crossed))).toBe(null);
  });

  /* All three fields are written together by one ancestor lookup in stage 3, so
     a block carrying `role` without `treatment` is a broken pipeline. Being
     tolerant of it is how an ordinary paragraph ends up previewed as a note. */
  it("refuses a block that claims one note field and not the others", () => {
    const half = [
      blocks[0] as NoteBlock,
      { ...(blocks[1] as NoteBlock), treatment: undefined },
    ];
    const index = buildNoteIndex(half);
    expect(index.byNote.size).toBe(0);
    const doc = render(half);
    expect(noteMarkerAt(doc.querySelector("sup a")!, doc, index)).toBe(null);
  });

  it("knows a back-link from a marker", () => {
    const doc = render(blocks);
    expect(isBackLink(doc.querySelector("a[data-spya-note-back]")!)).toBe(true);
    expect(isBackLink(doc.querySelector("sup a")!)).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* 2. A note is a range, and the preview shows all of it                       */
/* -------------------------------------------------------------------------- */

describe("the preview fragment", () => {
  const blocks: NoteBlock[] = [
    body("spya-bdyaa2", `<p>A claim.${marker("spya-note-aaaaaaaaaa", "spya-ntyaa2")}</p>`),
    note({
      id: "spya-ntyaa2",
      html: `<li id="spya-ntyaa2" data-spya-note="spya-note-aaaaaaaaaa"><p>First half, with <a href="https://example.test/x" id="out1">a link out</a> and <a href="#spya-bdyaa2" id="in1">one back into the piece</a>.</p> <a href="#spya-bdyaa2" data-spya-note-back="spya-note-aaaaaaaaaa">↩</a></li>`,
    }),
    note({
      id: "spya-ntyaa3",
      html: `<li id="spya-ntyaa3" data-spya-note="spya-note-aaaaaaaaaa">Second half, which a one-block preview would silently drop.</li>`,
    }),
  ];
  const index = buildNoteIndex(blocks);
  const doc = render(blocks);
  const html = notePreviewHtml(index.byNote.get("spya-note-aaaaaaaaaa")!, doc);

  it("gathers every block of the note, in document order", () => {
    expect(index.byNote.get("spya-note-aaaaaaaaaa")?.blocks.map((b) => b.id)).toEqual([
      "spya-ntyaa2",
      "spya-ntyaa3",
    ]);
    expect(html).toContain("First half");
    expect(html).toContain("Second half");
    expect(html.indexOf("First half")).toBeLessThan(html.indexOf("Second half"));
  });

  /* The trap, stated in docs/plans/footnotes.md before any of this was written:
     injecting stored block html duplicates block ids into a document where
     everything addresses text by id — including `internalTarget`'s own `[id="…"]`
     fallback, which takes the first in document order. */
  it("carries no id and no <a name> out of the article", () => {
    expect(html).not.toMatch(/\sid=/);
    expect(html).not.toMatch(/\sname=/);
    expect(html).not.toContain("data-spya-note=");
  });

  it("keeps the note's own links live", () => {
    expect(html).toContain(`href="https://example.test/x"`);
    expect(html).toContain(`href="#spya-bdyaa2"`);
  });

  /* A back-link inside a preview of the very note it belongs to points at the
     passage the reader is standing in. Wikipedia's are the run of `1 2 3 …` that
     opens the note, so this is thirteen useless links ahead of the first word. */
  it("drops the note's own back-links", () => {
    expect(html).not.toContain("data-spya-note-back");
    expect(html).not.toContain("↩");
  });

  it("does not truncate", () => {
    const long = {
      ...blocks[1],
      html: `<li id="spya-ntyaa2">${"word ".repeat(400)}</li>`,
    } as NoteBlock;
    const one = buildNoteIndex([long]);
    const out = notePreviewHtml(one.byNote.get("spya-note-aaaaaaaaaa")!, doc);
    expect(out.split("word").length - 1).toBe(400);
    expect(out).not.toContain("…");
  });
});

/* -------------------------------------------------------------------------- */
/* 3. Plural back-links                                                        */
/* -------------------------------------------------------------------------- */

describe("one note, several points of use", () => {
  const noteId = "spya-note-cccccccccc";
  const blocks: NoteBlock[] = [
    body("spya-fstaa2", `<p>One.${marker(noteId, "spya-ntyaa4", "1", "ref1")}</p>`),
    body(
      "spya-scdaa2",
      `<p>Two.${marker(noteId, "spya-ntyaa4", "2", "ref2")} and again${marker(noteId, "spya-ntyaa4", "3", "ref3")}</p>`,
    ),
    body("spya-thdaa2", `<p>Three.${marker(noteId, "spya-ntyaa4", "4", "ref4")}</p>`),
    note({
      id: "spya-ntyaa4",
      noteId,
      html:
        `<li id="spya-ntyaa4" data-spya-note="${noteId}">` +
        `<a href="#spya-fstaa2" data-spya-note-back="${noteId}">a</a> ` +
        `<a href="#spya-scdaa2" data-spya-note-back="${noteId}">b</a> ` +
        `<a href="#spya-thdaa2" data-spya-note-back="${noteId}">c</a> ` +
        `The note itself.</li>`,
    }),
  ];
  const index = buildNoteIndex(blocks);

  it("counts markers and citing passages separately", () => {
    const found = index.byNote.get(noteId);
    // Four markers in three passages: the second paragraph cites it twice.
    expect(found?.markers).toBe(4);
    expect(found?.citedBy).toEqual(["spya-fstaa2", "spya-scdaa2", "spya-thdaa2"]);
  });

  it("resolves the note from every point of use", () => {
    const doc = render(blocks);
    const found = [...doc.querySelectorAll("a[data-spya-note-ref]")].map(
      (a) => noteMarkerAt(a, doc, index)?.blockId,
    );
    expect(found).toEqual(["spya-ntyaa4", "spya-ntyaa4", "spya-ntyaa4", "spya-ntyaa4"]);
  });

  /* Each back-link goes somewhere different, and that is the whole point: a
     singular one reads as working right up until it takes you to the wrong one
     of thirteen. */
  it("sends each back-link to its own passage", () => {
    const doc = render(blocks);
    const backs = [...doc.querySelectorAll("a[data-spya-note-back]")].map((a) =>
      a.getAttribute("href"),
    );
    expect(backs).toEqual(["#spya-fstaa2", "#spya-scdaa2", "#spya-thdaa2"]);
    expect(new Set(backs).size).toBe(3);
  });

  it("marks only the way back the reader came, and undoes it", () => {
    const doc = render(blocks);
    const undo = markReturnPath(doc, { from: "spya-scdaa2", noteId });
    const marked = () => [...doc.querySelectorAll("a[data-came-from]")].map((a) => a.textContent);
    expect(marked()).toEqual(["b"]);
    undo();
    expect(marked()).toEqual([]);
  });

  it("marks nothing when the reader did not arrive from a marker", () => {
    const doc = render(blocks);
    markReturnPath(doc, null);
    expect(doc.querySelectorAll("a[data-came-from]").length).toBe(0);
  });

  /* The mirror of the case above, and the one that was wrong. Marking used to
     select on the href alone, so it asked "which back-links lead to the passage
     I left?" — and when that passage cites *two* notes, the answer is one
     back-link in each of them. A reader following the first marker then saw the
     second note claiming to be where they came from. One note cited thirteen
     times was the case that got tested; two notes cited once from one sentence
     is the case that was not. GPT Sol, F7. */
  it("marks one note when a single passage cites two", () => {
    const other = "spya-note-bbbbbbbbbb";
    const twoNotes: NoteBlock[] = [
      body(
        "spya-cite2a1",
        `<p>A claim${marker(noteId, "spya-ntyaa4", "1", "fnrefX")} and another` +
          `${marker(other, "spya-othaa5", "2", "fnrefY")}.</p>`,
      ),
      note({
        id: "spya-ntyaa4",
        html:
          `<li id="spya-ntyaa4" data-spya-note="${noteId}">` +
          `<a href="#spya-cite2a1" data-spya-note-back="${noteId}">first</a> The first note.</li>`,
      }),
      note({
        id: "spya-othaa5",
        noteId: other,
        html:
          `<li id="spya-othaa5" data-spya-note="${other}">` +
          `<a href="#spya-cite2a1" data-spya-note-back="${other}">second</a> The second note.</li>`,
      }),
    ];
    const doc = render(twoNotes);
    /* Precondition: both back-links really do point at the one passage, so a
       selector reading the href alone cannot tell them apart. Without this the
       test could pass because the fixture never built the ambiguity. */
    expect(
      [...doc.querySelectorAll("a[data-spya-note-back]")].map((a) => a.getAttribute("href")),
    ).toEqual(["#spya-cite2a1", "#spya-cite2a1"]);

    const undo = markReturnPath(doc, { from: "spya-cite2a1", noteId });
    const marked = () => [...doc.querySelectorAll("a[data-came-from]")].map((a) => a.textContent);
    expect(marked()).toEqual(["first"]);
    undo();
    expect(marked()).toEqual([]);

    // And the other direction, so this cannot pass by always picking the first.
    markReturnPath(doc, { from: "spya-cite2a1", noteId: other });
    expect(marked()).toEqual(["second"]);
  });
});

/* -------------------------------------------------------------------------- */
/* 4. The corpus, through the real pipeline                                    */
/* -------------------------------------------------------------------------- */

const FIXTURES = path.join(import.meta.dirname, "..", "evals", "extraction", "fixtures");
/** Real extractions of large pages, as tests/block-roles.test.ts does it. */
const SLOW = 180_000;

async function pipeline(fixture: string): Promise<Block[]> {
  const html = await readFile(path.join(FIXTURES, `${fixture}.html`), "utf-8");
  const result = await runExtract({
    html,
    url: `https://example.test/${fixture}`,
    slug: fixture,
  });
  return splitIntoBlocks(result.extractedHtml).blocks;
}

describe("wikipedia, which cites one note thirteen times", () => {
  let blocks: Block[];
  beforeAll(async () => {
    blocks = await pipeline("wiki_transformer");
  }, SLOW);

  it("resolves every marker in the article to a note", () => {
    const index = buildNoteIndex(blocks);
    const doc = render(blocks);
    const markers = [...doc.querySelectorAll("a[data-spya-note-ref]")];
    expect(markers.length).toBe(170);
    const unresolved = markers.filter((a) => noteMarkerAt(a, doc, index) === null);
    expect(unresolved.length).toBe(0);
    expect(index.byNote.size).toBe(121);
    /* jsdom takes ~7s over 170 `querySelector` resolutions against a 356-row
       document; a browser does one per hover against a native engine. */
  }, SLOW);

  /* **Thirteen markers, twelve passages, and the difference is not a rounding
     error.** Two of the thirteen sit in the same paragraph, so a count of
     "places this is cited" taken off the markers would be one too many and a
     count taken off the passages would be one short of the back-links. Measured
     2026-08-28 through this pipeline. */
  it("finds one note with thirteen points of use in twelve passages", () => {
    const index = buildNoteIndex(blocks);
    const most = [...index.byNote.values()].sort((a, b) => b.markers - a.markers)[0]!;
    expect(most.markers).toBe(13);
    expect(most.citedBy.length).toBe(12);
    expect(new Set(most.citedBy).size).toBe(12);

    // And its thirteen back-links go to those passages — plural, one per use.
    const doc = render(most.blocks);
    const backs = [...doc.querySelectorAll(`a[data-spya-note-back="${most.id}"]`)].map((a) =>
      a.getAttribute("href"),
    );
    expect(backs.length).toBe(13);
    expect(new Set(backs)).toEqual(new Set(most.citedBy.map((id) => `#${id}`)));
  });

  /* **The case the F7 fix could plausibly have broken.** Marking used to select
     on the href alone, and the change narrows it by also requiring the note id.
     Narrowing a selector is exactly how a fix aimed at one shape breaks its
     mirror, and this is the mirror: thirteen back-links in one note, of which
     the reader is owed precisely the one they came by. Real markup through the
     real pipeline, because thirteen back-links inside one Wikipedia note is not
     a shape worth inventing by hand. */
  it("still marks exactly one of the thirteen back-links, and the right one", () => {
    const index = buildNoteIndex(blocks);
    const most = [...index.byNote.values()].sort((a, b) => b.markers - a.markers)[0]!;
    const doc = render(most.blocks);
    expect(doc.querySelectorAll(`a[data-spya-note-back="${most.id}"]`).length).toBe(13);

    // The seventh passage of the twelve — arbitrary, and not the first, so this
    // cannot pass by picking whichever came earliest in the document.
    const from = most.citedBy[6]!;
    const undo = markReturnPath(doc, { from, noteId: most.id });
    const marked = [...doc.querySelectorAll(`a[${"data-came-from"}]`)];
    expect(marked.length).toBe(1);
    expect(marked[0]!.getAttribute("href")).toBe(`#${from}`);
    undo();
    expect(doc.querySelectorAll("a[data-came-from]").length).toBe(0);
  });

  it("previews a note without the run of back-links that opens it", () => {
    const index = buildNoteIndex(blocks);
    const most = [...index.byNote.values()].sort((a, b) => b.markers - a.markers)[0]!;
    const html = notePreviewHtml(most, render(blocks));
    expect(html).not.toContain("data-spya-note-back");
    expect(html).not.toMatch(/\sid=/);
    // The note's own words survive the stripping.
    expect(html.replace(/<[^>]+>/g, "").trim().length).toBeGreaterThan(30);
  });
});

describe("gwern, whose longest note is eight blocks", () => {
  let blocks: Block[];
  beforeAll(async () => {
    blocks = await pipeline("gwern");
  }, SLOW);

  it("shows every block of a multi-block note, not just the one the marker lands on", () => {
    const index = buildNoteIndex(blocks);
    expect(index.byNote.size).toBe(34);
    const longest = [...index.byNote.values()].sort(
      (a, b) => b.blocks.length - a.blocks.length,
    )[0]!;
    expect(longest.blocks.length).toBe(8);

    const doc = render(blocks);
    /* Compared with every space removed on both sides: the note's prose has
       inline links in it, so any tag-stripping that leaves a space behind
       disagrees with `textContent` about where the words run together — and the
       assertion would then be about the comparison rather than about the
       preview. */
    const flat = notePreviewHtml(longest, doc).replace(/<[^>]+>/g, "").replace(/\s+/g, "");
    const textOf = new Map(blocks.map((b) => [b.id, b.text]));
    let at = -1;
    for (const block of longest.blocks) {
      const found = flat.indexOf((textOf.get(block.id) ?? "").replace(/\s+/g, "").slice(0, 40));
      expect(found).toBeGreaterThan(at);
      at = found;
    }
  });

  it("lands the marker on the note's first block", () => {
    const index = buildNoteIndex(blocks);
    const doc = render(blocks);
    for (const a of doc.querySelectorAll("a[data-spya-note-ref]")) {
      const found = noteMarkerAt(a, doc, index);
      expect(found).not.toBe(null);
      expect(found?.blockId).toBe(found?.note.blocks[0]?.id);
    }
  }, SLOW);
});
