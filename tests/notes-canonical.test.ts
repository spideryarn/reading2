/**
 * Stage 2 canonicalises every footnote shape into one, before Readability —
 * src/notes.ts, and docs/plans/260828o-footnotes.md for the measurements it came from.
 *
 * **These run the real pipeline over the real fixtures.** `runExtract` (jsdom,
 * Readability, the sanitiser) and then `splitIntoBlocks`, over the committed
 * pages in evals/extraction/fixtures/. That is deliberate and it is why the file
 * is slow: every direct-to-`splitIntoBlocks` test written against invented
 * post-Readability HTML would stay green if Readability started throwing the
 * notes container away, which is the failure this feature is most exposed to.
 *
 * **Nothing here asserts a count as evidence.** The bug this stage fixes
 * reported `stats.retargeted: 36 of 36` on a Substack post where every one of
 * the eighteen body→note markers landed on a block whose entire text was a
 * digit. So each fixture names a **sentence that cites a note** and the **words
 * of the note it cites**, and asserts that following the marker gets from one to
 * the other. Counts appear only as consistency checks beside that.
 *
 * The two left-alone fixtures matter as much, and they are left alone for
 * different reasons. `gutenberg.html` is not a footnote system: its three `<sup>`
 * are the abbreviation mark in "Mr." **`ar5iv.html` is one** — LaTeXML writes
 * real footnotes, with real prose in them, marked `ltx_role_footnote` — and this
 * stage covers four publishers' shapes, of which LaTeXML is not one. Its notes
 * are rendered inline with no id/href pair at all, so there is no marker to
 * rewrite and nothing to move. It is asserted here as **a shape we deliberately
 * do not support**, not as a page with no footnotes in it: an earlier version of
 * this file claimed the latter, which pinned a known omission as correctness.
 *
 * Both nonetheless report a healthy `stats.retargeted` — 85 and 162 — from
 * ordinary cross-references, so `retargeted > 0` is not evidence of anything.
 * Both are asserted as **byte-identical Readability output** with the pass on and
 * off, which is the only form of "untouched" that cannot quietly weaken.
 */

import { describe, expect, it, beforeAll } from "vitest";
import { JSDOM, VirtualConsole } from "jsdom";
import { Readability } from "@mozilla/readability";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { runExtract, unhideCollapsedSections } from "../src/extract.js";
import { canonicaliseNotes, type NoteStats } from "../src/notes.js";
import { splitIntoBlocks } from "../src/blocks.js";
import { sanitizeHtml } from "../src/sanitize.js";
import type { Block } from "../src/types.js";

const FIXTURES = path.join(import.meta.dirname, "..", "evals", "extraction", "fixtures");
/** Large pages through a real extraction. Nothing here is close to vitest's 5s default. */
const SLOW = 120_000;

interface Run {
  blocks: Block[];
  byId: Map<string, Block>;
  doc: Document;
  notes: NoteStats;
}

/** One extraction per fixture for the whole file — `gutenberg.html` is 852 KB. */
const runs = new Map<string, Promise<Run>>();

function pipeline(fixture: string): Promise<Run> {
  const existing = runs.get(fixture);
  if (existing) return existing;
  const started = (async (): Promise<Run> => {
    const html = await readFile(path.join(FIXTURES, fixture), "utf-8");
    const extract = await runExtract({
      html,
      url: `https://example.test/${fixture}`,
      slug: fixture,
    });
    const split = splitIntoBlocks(extract.extractedHtml);
    return {
      blocks: split.blocks,
      byId: new Map(split.blocks.map((b) => [b.id, b])),
      doc: new JSDOM(split.html).window.document,
      notes: extract.notes,
    };
  })();
  runs.set(fixture, started);
  return started;
}

/** The block a marker sits inside — the sentence that cites the note. */
function citingBlock(run: Run, marker: Element): Block | undefined {
  for (let el = marker.parentElement; el; el = el.parentElement) {
    const block = run.byId.get(el.id);
    if (block) return block;
  }
  return undefined;
}

/** The block a marker points at — where a reader lands. */
function targetBlock(run: Run, marker: Element): Block | undefined {
  const href = marker.getAttribute("href") ?? "";
  return href.startsWith("#") ? run.byId.get(href.slice(1)) : undefined;
}

const markersIn = (run: Run): Element[] =>
  Array.from(run.doc.querySelectorAll("a[data-spya-note-ref]"));

/**
 * Four shapes, four sentences, four notes. Each row is a claim about the
 * article's *words*: the marker in this sentence takes a reader to a block
 * containing these words.
 */
const JOURNEYS: ReadonlyArray<{
  fixture: string;
  what: string;
  /** A phrase from the paragraph that cites the note. */
  citing: string;
  /** The marker's own text within that paragraph. */
  label: string;
  /** Words that must be in the block the marker resolves to. */
  note: string;
  /** Which adapter recognises this page — see ANCHOR_SHAPES in src/notes.ts. */
  shape: "gwern" | "wikipedia" | "substack" | "tufte";
  /**
   * How many notes and how many markers the **source** has, counted from the
   * publisher's own markup rather than from what this code produced. A count
   * taken over our own output cannot see a note the detector missed.
   */
  source: (doc: Document) => { notes: number; markers: number };
}> = [
  {
    fixture: "gwern.html",
    what: "the anchor wraps the sup, notes in a trailing <ol>",
    citing: "the long-awaited followup to GPT-2",
    label: "1",
    note: "the arithmetic benchmark appears to greatly understate",
    shape: "gwern",
    source: (d) => ({
      notes: d.querySelectorAll("[role='doc-endnotes'] li[id^=fn]").length,
      markers: d.querySelectorAll("a[role='doc-noteref']").length,
    }),
  },
  {
    fixture: "wiki_transformer.html",
    what: "the sup wraps the anchor, and a second reference group reading [note 1]",
    citing: "A key breakthrough was LSTM",
    label: "[note 1]",
    note: "Gated recurrent units (2014) further reduced its complexity.",
    shape: "wikipedia",
    source: (d) => ({
      notes: d.querySelectorAll("li[id^='cite_note-']").length,
      markers: d.querySelectorAll("sup.mw-ref > a[href^='#cite_note-']").length,
    }),
  },
  {
    fixture: "acx_footnotes.html",
    what: "Substack: no <sup> at all, and the note used to arrive as two blocks",
    citing: "in places thick with the author",
    label: "1",
    note: "Yes, in a work of fiction. Many footnotes spawn their own footnotes",
    shape: "substack",
    source: (d) => ({
      notes: d.querySelectorAll("div.footnote").length,
      markers: d.querySelectorAll("a.footnote-anchor").length,
    }),
  },
  {
    fixture: "tufte.html",
    what: "Tufte: a <label>, a checkbox and a <span>, all three deleted downstream",
    citing: "his extensive use of sidenotes",
    label: "4",
    note: "This is a sidenote.",
    shape: "tufte",
    /* Every sidenote, plus the margin notes that are not really figure captions
       — a margin note holding a picture stays with its picture. */
    source: (d) => ({
      notes:
        d.querySelectorAll("span.sidenote").length +
        Array.from(d.querySelectorAll("span.marginnote")).filter(
          (s) => !s.querySelector("img") && !s.closest("figure"),
        ).length,
      markers:
        d.querySelectorAll("span.sidenote").length +
        Array.from(d.querySelectorAll("span.marginnote")).filter(
          (s) => !s.querySelector("img") && !s.closest("figure"),
        ).length,
    }),
  },
];

describe.each(JOURNEYS)("$fixture — $what", (journey) => {
  let run: Run;
  beforeAll(async () => {
    run = await pipeline(journey.fixture);
  }, SLOW);

  it("a named marker in a named sentence resolves to the note's own words", () => {
    const marker = markersIn(run).find(
      (m) =>
        (m.textContent ?? "").trim() === journey.label &&
        (citingBlock(run, m)?.text ?? "").includes(journey.citing),
    );
    /* Without this, "found no marker" and "every marker is correct" are the same
       green — the vacuous-collector shape in docs/reusable/silent-success.md. */
    expect(
      marker,
      `no marker "${journey.label}" in a block containing "${journey.citing}"`,
    ).toBeDefined();

    const landed = targetBlock(run, marker!);
    expect(landed, "the marker's href resolves to no block at all").toBeDefined();
    expect(landed!.text).toContain(journey.note);
  });

  it("the block a marker lands on is the note, not a stub", () => {
    /* The check that would have caught the live Substack bug. Every one of its
       eighteen markers resolved, and every one of them resolved onto a block
       whose entire text was a single digit. */
    const stubs = markersIn(run)
      .map((m) => targetBlock(run, m))
      .filter((b) => b === undefined || b.words <= 2);
    expect(stubs).toHaveLength(0);
  });

  it("every marker lands on a block carrying the note stamp, and on the noteId it names", () => {
    for (const marker of markersIn(run)) {
      const landed = targetBlock(run, marker);
      expect(landed).toBeDefined();
      expect(landed!.html).toContain("data-spya-note=");
    }
    /* The marker's `data-spya-note-ref` and the note's `data-spya-note` are the
       identity that survives renumbering — they must name the same note even
       though stage 3 has since renamed the *anchor* to a block id. */
    const noteIds = new Set(
      Array.from(run.doc.querySelectorAll("[data-spya-note]"), (el) =>
        el.getAttribute("data-spya-note"),
      ),
    );
    for (const marker of markersIn(run)) {
      expect(noteIds.has(marker.getAttribute("data-spya-note-ref"))).toBe(true);
    }
  });

  it("no block is left whose whole text is a footnote number", () => {
    /* Substack's shape produced eighteen of these — `<a>1</a>` and the note's
       prose as two sibling blocks — and they were gistable, so they took ToC
       rows and reading time as well as the markers. */
    const digits = run.blocks.filter((b) => /^[\s[(]*\d{1,4}[\s\])]*$/.test(b.text));
    expect(digits.map((b) => b.text)).toEqual([]);
  });

  it("every note is gathered into the one container", () => {
    const containers = Array.from(run.doc.querySelectorAll("[data-spya-notes]"));
    expect(containers).toHaveLength(1);
    /* "One container exists" was the whole of this assertion once, which says
       nothing about the notes. Every stamped note has to be inside it, or a note
       left behind in the body prose passes. */
    const notes = Array.from(run.doc.querySelectorAll("[data-spya-note]"));
    expect(notes.length).toBeGreaterThan(0);
    const strays = notes.filter((n) => !containers[0]!.contains(n));
    expect(strays.map((n) => (n.textContent ?? "").slice(0, 60))).toEqual([]);
    // Tufte's mechanism is made of them, and neither is ever admitted.
    expect(
      run.doc.querySelectorAll("[data-spya-notes] label, [data-spya-notes] input"),
    ).toHaveLength(0);
  });

  it("every back-link lands on a block that cites its note", () => {
    /* The return journey, asserted on its destination rather than on its
       existence. Pointing the synthesised back-link at `#missing` left all fifty
       tests green: the shared assertions counted back-links and the Tufte test
       read one's visible text, and neither followed one anywhere. Substack's and
       Tufte's return links could have stopped working in silence.

       Stage 3 retargets an author anchor onto the block that contains it, so a
       working back-link resolves to a block whose html holds a marker naming the
       same note. */
    const backs = Array.from(run.doc.querySelectorAll("[data-spya-note-back]"));
    expect(backs.length).toBeGreaterThan(0);
    const lost: string[] = [];
    for (const back of backs) {
      const noteId = back.getAttribute("data-spya-note-back") ?? "";
      const href = back.getAttribute("href") ?? "";
      const landed = href.startsWith("#") ? run.byId.get(href.slice(1)) : undefined;
      if (!landed) lost.push(`${noteId} → ${href || "(no href)"} resolves to no block`);
      else if (!landed.html.includes(`data-spya-note-ref="${noteId}"`)) {
        lost.push(`${noteId} → ${href} lands on a block that does not cite it`);
      }
    }
    expect(lost).toEqual([]);
  });

  it("finds as many notes as the source has, counted from the source's own markup", async () => {
    /* Counting our own output cannot see a note the detector missed. So this
       counts the publisher's markup in the raw fixture and demands the same
       number — and demands they were all recognised by the one adapter that is
       supposed to cover this page, so a shape quietly falling through to another
       is visible too. */
    const html = await readFile(path.join(FIXTURES, journey.fixture), "utf-8");
    const source = journey.source(
      new JSDOM(html, { virtualConsole: new VirtualConsole() }).window.document,
    );
    expect(source.notes).toBeGreaterThan(0);
    expect(run.notes.notes).toBe(source.notes);
    expect(run.notes.markers).toBe(source.markers);
    expect(run.notes.shapes[journey.shape]).toBe(source.notes);
    // One back-link per marker, never one per note.
    expect(run.notes.backlinks).toBe(run.notes.markers);
    // Every note stamped in the final document, one for one with what was found.
    expect(run.doc.querySelectorAll("[data-spya-note]")).toHaveLength(source.notes);
  }, SLOW);
});

describe("wiki_transformer.html — a note cited thirteen times", () => {
  let run: Run;
  beforeAll(async () => {
    run = await pipeline("wiki_transformer.html");
  }, SLOW);

  it("keeps one back-link per use, not one per note", () => {
    /* Wikipedia's `^ a b c` is one note with three markers; this fixture has one
       with thirteen. A singular back-link reads exactly like a working feature,
       which is why this is asserted on the most-cited note rather than on any. */
    const byNote = new Map<string, Element[]>();
    for (const m of markersIn(run)) {
      const id = m.getAttribute("data-spya-note-ref")!;
      byNote.set(id, [...(byNote.get(id) ?? []), m]);
    }
    const [noteId, markers] = [...byNote].sort((a, b) => b[1].length - a[1].length)[0]!;
    expect(markers.length).toBeGreaterThanOrEqual(13);

    const note = targetBlock(run, markers[0]!);
    expect(note!.text).toContain("Attention is All You Need");

    const backs = Array.from(
      run.doc.querySelectorAll(`[data-spya-note-back="${noteId}"]`),
      (a) => a.getAttribute("href") ?? "",
    );
    expect(backs).toHaveLength(markers.length);

    /* Each back-link has to land somewhere a reader was actually reading. Stage
       3 retargets them onto the containing block, so several markers in one
       paragraph legitimately share a destination — what must not happen is a
       back-link resolving to nothing, or to the notes container. */
    for (const href of backs) {
      const landed = run.byId.get(href.slice(1));
      expect(landed, `back-link ${href} resolves to no block`).toBeDefined();
      expect(landed!.html).not.toContain("data-spya-note=");
    }
    expect(new Set(backs).size).toBeGreaterThan(1);
  });

  it("every citing sentence keeps its own words", () => {
    const citing = markersIn(run)
      .map((m) => citingBlock(run, m)?.text ?? "")
      .filter(Boolean);
    expect(citing.some((t) => t.includes("A key breakthrough was LSTM"))).toBe(true);
    expect(
      citing.some((t) => t.includes("Transformers have the advantage of having no recurrent units")),
    ).toBe(true);
  });
});

/* ------------------------------------------------------------------ negatives */

/** Readability's own output, with the pass on and off. */
function readabilityContent(html: string, canonicalise: boolean): string {
  const dom = new JSDOM(html, {
    url: "https://example.test/x",
    virtualConsole: new VirtualConsole(),
  });
  unhideCollapsedSections(dom.window.document);
  if (canonicalise) canonicaliseNotes(dom.window.document);
  return new Readability(dom.window.document).parse()?.content ?? "";
}

describe("the two fixtures this stage leaves alone", () => {
  it.each([
    [
      "ar5iv.html",
      18,
      "LaTeXML footnotes — a real system, and one of the four adapters does not cover it",
    ],
    ["gutenberg.html", 3, 'not a footnote system at all: the superscripts are the "Mr." mark'],
  ])("%s is left byte-identical — %s", async (fixture, sups) => {
    const html = await readFile(path.join(FIXTURES, fixture), "utf-8");
    expect(readabilityContent(html, true)).toBe(readabilityContent(html, false));

    const run = await pipeline(fixture);
    expect(run.notes).toEqual({
      notes: 0,
      markers: 0,
      backlinks: 0,
      synthesised: 0,
      shapes: { gwern: 0, wikipedia: 0, substack: 0, tufte: 0 },
    });
    expect(run.doc.querySelectorAll("[data-spya-notes]")).toHaveLength(0);
    expect(run.doc.querySelectorAll("[data-spya-note], [data-spya-note-ref]")).toHaveLength(0);
    // The superscripts they do have are still there, and still theirs.
    expect(run.doc.querySelectorAll("sup").length).toBeGreaterThanOrEqual(sups);
  }, SLOW);

  it("ar5iv's footnotes are real, and that is why this is an omission and not a negative", async () => {
    /* Said out loud, in the fixture's own markup, so nobody reads the
       byte-identical assertion above as "there was nothing here". LaTeXML's
       inline footnotes are the direct answer to "what does the round-trip rule
       miss": they never link back, because they are never anywhere else. */
    const html = await readFile(path.join(FIXTURES, "ar5iv.html"), "utf-8");
    const doc = new JSDOM(html, { virtualConsole: new VirtualConsole() }).window.document;
    const notes = Array.from(doc.querySelectorAll("[class*='ltx_role_footnote']"));
    expect(notes.length).toBeGreaterThan(0);
    // With prose in them, not just a marker — this is content we are not carrying.
    const worded = notes.filter((n) => (n.textContent ?? "").trim().split(/\s+/).length > 5);
    expect(worded.length).toBeGreaterThan(0);
    // And none of them round-trips, which is why the four adapters cannot see them.
    expect(doc.querySelectorAll("a[href^='#footnote']")).toHaveLength(0);
  });

  it("the byte-identical check can fail — the four real shapes all change", async () => {
    /* A comparison that has never come out unequal is not evidence. */
    for (const fixture of JOURNEYS.map((j) => j.fixture)) {
      const html = await readFile(path.join(FIXTURES, fixture), "utf-8");
      expect(
        readabilityContent(html, true),
        `${fixture} came through the pass unchanged`,
      ).not.toBe(readabilityContent(html, false));
    }
  }, SLOW);
});

/* ------------------------------------------------ ids across a re-extraction */

/** The same wrapper both sides of a comparison, so the only difference is the pass. */
const page = (content: string): string => `<!doctype html><html><body>${content}</body></html>`;

/**
 * **The migration test, and the one the first version of this file was missing.**
 *
 * Every article already on the shelf was extracted *without* this pass. Turning
 * it on re-extracts them, and stage 3 recovers a block's id by matching its tag
 * and its text (`exactKey`, src/blocks.ts). So any change this pass makes to the
 * *words* of a block costs that block its id, and with it every comment anchored
 * to it and every saved reading position.
 *
 * Measured by GPT Sol on the first implementation: **0 of 34** Gwern note blocks
 * and 31 of 121 Wikipedia ones were re-minted, because the pass threw away the
 * author's own back-link and wrote its own. Gwern's reads `↩︎` — U+21A9 plus a
 * variation selector — and ours read `↩`, and the folded fallback key keeps
 * combining marks deliberately, so both keys missed.
 *
 * So: extract each fixture as the shelf has it today, then extract it again with
 * the pass on and the old blocks offered for carry-over, and require that not one
 * note block and not one citing paragraph is re-minted.
 */
describe.each([
  ["gwern.html", 34],
  ["wiki_transformer.html", 121],
])("%s — turning the pass on keeps every note's block id", (fixture, sourceNotes) => {
  it("re-mints neither a note block nor a citing paragraph", async () => {
    const html = await readFile(path.join(FIXTURES, fixture), "utf-8");
    const before = splitIntoBlocks(page(readabilityContent(html, false))).blocks;
    const after = splitIntoBlocks(page(readabilityContent(html, true)), before).blocks;
    const known = new Set(before.map((b) => b.id));

    const notes = after.filter((b) => b.html.includes("data-spya-note="));
    /* Without this, "the pass recognised nothing" and "every id survived" are
       the same green. */
    expect(notes.length).toBe(sourceNotes);
    expect(
      notes.filter((b) => !known.has(b.id)).map((b) => b.text.slice(0, 70)),
      `${notes.length} note blocks, and these lost their ids`,
    ).toEqual([]);

    const citing = after.filter((b) => b.html.includes("data-spya-note-ref="));
    expect(citing.length).toBeGreaterThan(0);
    expect(
      citing.filter((b) => !known.has(b.id)).map((b) => b.text.slice(0, 70)),
      "these paragraphs cite a note and lost their ids",
    ).toEqual([]);
  }, SLOW);
});

/* ------------------------------------------------------- the rules, synthetic */

const parse = (html: string): Document =>
  new JSDOM(`<body><article>${html}</article></body>`, {
    virtualConsole: new VirtualConsole(),
  }).window.document;

/**
 * Pandoc's shape, which is Gwern's, and the one the synthetic tests are written
 * in: the marker says `role="doc-noteref"` and the notes sit in a
 * `role="doc-endnotes"` section. Round-tripping alone is not enough to be
 * recognised — see "leaves a numbered round-tripping link alone" below — so a
 * synthetic fixture has to say what shape it is, exactly as the real pages do.
 */
const NOTE = (id: string, back: string, text: string) =>
  `<section role="doc-endnotes"><ol><li id="${id}">${text} ` +
  `<a href="#${back}" role="doc-backlink">↩︎</a></li></ol></section>`;
const MARKER = (id: string, target: string, label = "1") =>
  `<a href="#${target}" id="${id}" role="doc-noteref"><sup>${label}</sup></a>`;

describe("canonicaliseNotes, rule by rule", () => {
  it("recognises the plain marker-and-note pair", () => {
    const doc = parse(`<p>Prose ${MARKER("r1", "n1")}.</p>${NOTE("n1", "r1", "A note with words in it.")}`);
    const stats = canonicaliseNotes(doc);
    expect(stats.notes).toBe(1);
    expect(doc.querySelector("[data-spya-notes]")?.textContent).toContain("A note with words in it.");
  });

  it("scrubs a forged stamp off the page it arrived on, template contents included", () => {
    /* A hostile article that could keep one of these would have body prose
       dressed as trusted apparatus. A DOM query does not enter a `<template>`,
       so the second half of this is the one that has been got wrong before. */
    const doc = parse(
      `<p data-spya-note="forged" data-spya-note-ref="forged" data-spya-notes="">Ordinary prose.</p>` +
        `<template><p data-spya-note="forged-inside-a-template">Hidden.</p></template>` +
        `<p>Real ${MARKER("r1", "n1")}.</p>${NOTE("n1", "r1", "A note with words in it.")}`,
    );
    canonicaliseNotes(doc);
    expect(doc.body.innerHTML).not.toContain("forged");
    for (const t of Array.from(doc.querySelectorAll("template"))) {
      expect((t as HTMLTemplateElement).content.querySelectorAll("[data-spya-note]")).toHaveLength(
        0,
      );
    }
    // …and the real one still worked, so this is not passing by doing nothing.
    expect(doc.querySelectorAll("[data-spya-note]")).toHaveLength(1);
  });

  it("never admits a form control into a note, whatever the page put in one", () => {
    const doc = parse(
      `<p>Real ${MARKER("r1", "n1")}.</p>` +
        `<section role="doc-endnotes"><ol><li id="n1">A note with words <label for="x">L</label>` +
        `<input id="x"><button>B</button> in it. <a href="#r1" role="doc-backlink">↩︎</a></li></ol></section>`,
    );
    canonicaliseNotes(doc);
    const container = doc.querySelector("[data-spya-notes]")!;
    expect(container.querySelectorAll("label, input, button")).toHaveLength(0);
    expect(container.textContent).toContain("A note with words");
  });

  it("leaves a cross-reference alone, even one that round-trips", () => {
    /* A table of contents links to a chapter and the chapter links back, which
       is a round trip by any loose reading of the rule. It is not a footnote,
       and the thing that says so is that the back-link aims at a *block*: a real
       back-link aims at the marker, or at the `<sup>` around it. */
    const doc = parse(
      `<div id="toc"><p>Chapter <a href="#c1">1</a></p></div>` +
        `<div id="c1"><p>Chapter one, with enough words to be prose. <a href="#toc">Contents</a></p></div>`,
    );
    expect(canonicaliseNotes(doc).notes).toBe(0);
    expect(doc.querySelectorAll("[data-spya-notes]")).toHaveLength(0);
  });

  it("leaves a link whose text is a phrase alone", () => {
    /* Full footnote markup, and still refused: a marker is a number, a letter or
       a dagger, never a sentence. */
    const doc = parse(
      `<p>See <a href="#n1" id="r1" role="doc-noteref">the appendix on measurement</a>.</p>` +
        NOTE("n1", "r1", "An appendix with words in it."),
    );
    expect(canonicaliseNotes(doc).notes).toBe(0);
  });

  it("leaves a marker with no back-link alone — a stated limit, not an oversight", () => {
    const doc = parse(
      `<p>Prose ${MARKER("r1", "n1")}.</p>` +
        `<section role="doc-endnotes"><ol><li id="n1">A note with words and no way home.</li></ol></section>`,
    );
    expect(canonicaliseNotes(doc).notes).toBe(0);
  });

  it("gives one note one identity however many places cite it", () => {
    const doc = parse(
      `<p>First ${MARKER("r1", "n1")}.</p><p>Second ${MARKER("r2", "n1")}.</p>` +
        `<section role="doc-endnotes"><ol><li id="n1">A note with words in it. ` +
        `<a href="#r1" role="doc-backlink">a</a> <a href="#r2" role="doc-backlink">b</a></li></ol></section>`,
    );
    const stats = canonicaliseNotes(doc);
    expect(stats).toMatchObject({ notes: 1, markers: 2, backlinks: 2 });
    const ids = Array.from(doc.querySelectorAll("[data-spya-note-ref]"), (a) =>
      a.getAttribute("data-spya-note-ref"),
    );
    expect(new Set(ids).size).toBe(1);
    expect(ids[0]).toBe(doc.querySelector("[data-spya-note]")?.getAttribute("data-spya-note"));
  });

  it("gives a note an id that does not move when the numbering does", () => {
    /* An author inserting a note at the top renumbers everything below it. The
       note's identity is a hash of its own words, so it does not follow. */
    const before = parse(
      `<p>A ${MARKER("r1", "n1")}.</p>${NOTE("n1", "r1", "The note that was always second.")}`,
    );
    const after = parse(
      `<p>New ${MARKER("r0", "n0")}.</p><p>A ${MARKER("r1", "n1", "2")}.</p>` +
        `<section role="doc-endnotes"><ol>` +
        `<li id="n0">A brand new note with words. <a href="#r0" role="doc-backlink">↩︎</a></li>` +
        `<li id="n1">The note that was always second. <a href="#r1" role="doc-backlink">↩︎</a></li>` +
        `</ol></section>`,
    );
    canonicaliseNotes(before);
    canonicaliseNotes(after);
    const idOf = (doc: Document, words: string) =>
      Array.from(doc.querySelectorAll("[data-spya-note]"))
        .find((el) => (el.textContent ?? "").includes(words))
        ?.getAttribute("data-spya-note");
    expect(idOf(after, "always second")).toBe(idOf(before, "always second"));
  });

  it("resolves a duplicated id the way a browser does — the first one wins", () => {
    /* CMS output repeats an id more often than anyone would like, and a page can
       do it on purpose. A browser, and stage 3 (src/blocks.ts), take the first in
       document order. Taking the last means a marker whose link resolves
       correctly today gets rewritten to point at a *different* element: a correct
       link made confidently wrong, which is worse than leaving it alone. */
    const doc = parse(
      `<p>Prose ${MARKER("r1", "n1")}.</p><section role="doc-endnotes"><ol>` +
        `<li id="n1">The first note, and the one a browser resolves. <a href="#r1" role="doc-backlink">↩︎</a></li>` +
        `<li id="n1">The second note, which nothing points at. <a href="#r1" role="doc-backlink">↩︎</a></li>` +
        `</ol></section>`,
    );
    canonicaliseNotes(doc);
    const gathered = doc.querySelector("[data-spya-notes]")?.textContent ?? "";
    expect(gathered).toContain("The first note");
    expect(gathered).not.toContain("The second note");
  });

  it("leaves a numbered round-tripping link alone when nothing says it is a footnote", () => {
    /* Round-tripping is validation, not recognition. On its own it is satisfied
       by any two elements that link to each other, and acting on it is how a
       reciprocal link into ordinary prose got that prose hoisted out of the
       article and dressed as apparatus. */
    const doc = parse(
      `<p>Prose <a href="#n1" id="r1">1</a>.</p>` +
        `<ol><li id="n1">A paragraph with several words in it. <a href="#r1">back</a></li></ol>`,
    );
    expect(canonicaliseNotes(doc).notes).toBe(0);
    expect(doc.querySelectorAll("[data-spya-notes]")).toHaveLength(0);
    expect(doc.body.textContent).toContain("A paragraph with several words in it.");
  });

  it.each([
    ["the cell itself", `<td id="fn1">A cell of ordinary tabular content. BACK</td>`],
    ["a paragraph in the cell", `<td><p id="fn1">A cell of ordinary tabular content. BACK</p></td>`],
  ])("never takes a note out of a table — %s", (_what, cell) => {
    /* Reproduced by GPT Sol against the first implementation: the table
       disappeared and its cell was moved into Notes. Worse than doing nothing.
       Two topologies, because the tag rule catches the first one and only the
       excluded-ancestor rule catches the second. */
    const doc = parse(
      `<p>Prose <a href="#fn1" id="fnref1" role="doc-noteref">1</a>.</p><table><tbody><tr>` +
        cell.replace("BACK", `<a href="#fnref1" role="doc-backlink">↩︎</a>`) +
        `</tr></tbody></table>`,
    );
    expect(canonicaliseNotes(doc).notes).toBe(0);
    expect(doc.querySelector("table"), "the table was removed").not.toBeNull();
    expect(doc.querySelector("td")?.textContent).toContain("A cell of ordinary tabular content.");
  });

  it.each([
    [
      "a figure caption",
      `<figure><img src="x.png" alt=""><p id="fn1">Ordinary figure caption with several words. BACK</p></figure>`,
      "figure",
    ],
    [
      "prose in a <details>",
      `<details><summary>More</summary><p id="fn1">Ordinary disclosed prose with several words. BACK</p></details>`,
      "details",
    ],
    [
      "a bare paragraph in a div",
      `<div><p id="fn1">Ordinary body prose with several words. BACK</p></div>`,
      "div",
    ],
  ])("never promotes %s to a note on the strength of its id alone", (_what, markup, tag) => {
    /* `id="fn1"` and a reciprocal `id="fnref1"` are all a page needs to write —
       no role, no class, no forged attribute — and the first repair still took
       this one: the figure was emptied and its caption moved into Notes as
       `shapes.gwern: 1`. The fix is topology on the target side, not a longer
       blacklist: a pandoc note is an `<li>` in a list, or it is in a
       `doc-endnotes`/`.footnotes` container. A caption is neither. */
    const doc = parse(
      `<p>Prose <a href="#fn1" id="fnref1">1</a>.</p>` +
        markup.replace("BACK", `<a href="#fnref1">↩︎</a>`),
    );
    expect(canonicaliseNotes(doc).notes).toBe(0);
    expect(doc.querySelectorAll("[data-spya-notes]")).toHaveLength(0);
    expect(doc.querySelector(tag)?.textContent, `${tag} was emptied`).toContain("Ordinary");
  });

  it("still recognises a pandoc note that carries no role at all", () => {
    /* The other half of that rule, and the reason it is topology rather than
       "require `role=doc-noteref`": only 21 of gwern.html's 34 markers carry the
       role, so demanding it would lose thirteen real notes. An `<li>` in a list
       whose id reads `fn…` is enough. */
    const doc = parse(
      `<p>Prose <a href="#fn1" id="fnref1">1</a>.</p>` +
        `<ol><li id="fn1">A note with words in it. <a href="#fnref1">↩︎</a></li></ol>`,
    );
    expect(canonicaliseNotes(doc)).toMatchObject({ notes: 1, shapes: { gwern: 1 } });
  });

  it("hashes a note's identity from what a reader can see, not from what is hidden in it", () => {
    /* `noteId` used to be hashed before the form controls, `<script>` and
       `<style>` were stripped, so editing text nobody can read changed the
       note's identity while every visible word of it stayed the same. */
    const note = (hidden: string) =>
      parse(
        `<p>Prose ${MARKER("r1", "n1")}.</p>` +
          `<section role="doc-endnotes"><ol><li id="n1">A note with words in it.${hidden} ` +
          `<a href="#r1" role="doc-backlink">↩︎</a></li></ol></section>`,
      );
    const idOf = (doc: Document) => {
      canonicaliseNotes(doc);
      return doc.querySelector("[data-spya-note]")?.getAttribute("data-spya-note");
    };
    const plain = idOf(note(""));
    expect(plain).toBeDefined();
    expect(idOf(note("<script>var a = 1;</script>"))).toBe(plain);
    expect(idOf(note("<style>p { color: red }</style>"))).toBe(plain);
    // …and a visible word still does change it, so this is not passing vacuously.
    expect(idOf(note(" And another sentence."))).not.toBe(plain);
  });

  it("a note's identity does not follow the number of times it is cited", () => {
    /* Wikipedia's back-links read `1 2 3` — one per use — so hashing them in
       would give a note a new identity the day it is cited once more. */
    const cited = (n: number) =>
      parse(
        Array.from({ length: n }, (_, i) => `<p>Prose ${MARKER(`r${i}`, "n1")}.</p>`).join("") +
          `<section role="doc-endnotes"><ol><li id="n1">A note with words in it. ` +
          Array.from(
            { length: n },
            (_, i) => `<a href="#r${i}" role="doc-backlink">${i + 1}</a> `,
          ).join("") +
          `</li></ol></section>`,
      );
    const idOf = (doc: Document) => {
      canonicaliseNotes(doc);
      return doc.querySelector("[data-spya-note]")?.getAttribute("data-spya-note");
    };
    const twice = idOf(cited(2));
    expect(twice).toBeDefined();
    expect(idOf(cited(3))).toBe(twice);
  });

  it("never takes a note out of a nav, header, footer or aside", () => {
    /* The same reproduction with navigation prose: hoisted out of `<nav>` and
       presented as a note. */
    for (const tag of ["nav", "header", "footer", "aside"]) {
      const doc = parse(
        `<p>Prose <a href="#fn1" id="fnref1" role="doc-noteref">1</a>.</p>` +
          `<${tag}><p id="fn1">Ordinary chrome with several words in it. ` +
          `<a href="#fnref1" role="doc-backlink">↩︎</a></p></${tag}>`,
      );
      expect(canonicaliseNotes(doc).notes, `${tag} was treated as a note`).toBe(0);
      expect(doc.querySelector(tag)?.textContent).toContain("Ordinary chrome");
    }
  });

  it("keeps the author's own back-link, exactly as they wrote it", () => {
    /* Gwern's back-link is `↩︎` — U+21A9 followed by a variation selector, which
       is invisible and which the id carry-over key preserves. Replacing it with a
       bare `↩` changes the note block's text, and a block whose text changed
       loses its id on the next re-extraction. */
    const doc = parse(
      `<p>Prose ${MARKER("r1", "n1")}.</p>` +
        `<section role="doc-endnotes"><ol><li id="n1">A note with words in it. ` +
        `<a href="#r1" class="footnote-back" role="doc-backlink">↩︎</a></li></ol></section>`,
    );
    canonicaliseNotes(doc);
    const backs = Array.from(doc.querySelectorAll("[data-spya-note-back]"));
    expect(backs).toHaveLength(1);
    expect(backs[0]!.textContent).toBe("↩︎");
    // Stamped in place, not replaced: the href the author wrote still resolves.
    expect(backs[0]!.getAttribute("href")).toBe("#r1");
    expect(doc.querySelector("#r1")).not.toBeNull();
  });

  it("a synthesised back-link has text a reader can see", () => {
    /* Tufte has no back-link of its own, so ours is the only one there is.
       Deleting the line that writes its text left all thirty-four of the first
       version's tests green, and every back-link on the page invisible. */
    const doc = parse(
      `<p>His use of sidenotes<label for="sn-1" class="margin-toggle sidenote-number"></label>` +
        `<input type="checkbox" id="sn-1" class="margin-toggle">` +
        `<span class="sidenote">This is a sidenote with several words in it.</span> is extensive.</p>`,
    );
    expect(canonicaliseNotes(doc).notes).toBe(1);
    const back = doc.querySelector("[data-spya-note-back]");
    expect(back, "no back-link was synthesised at all").not.toBeNull();
    expect((back!.textContent ?? "").trim().length, "the back-link is invisible").toBeGreaterThan(0);
    expect(back!.textContent).toBe("↩");

    // …and it goes somewhere: the marker that cites this very note.
    const href = back!.getAttribute("href") ?? "";
    expect(href.startsWith("#"), `back-link href is ${href || "(none)"}`).toBe(true);
    const marker = doc.getElementById(href.slice(1));
    expect(marker, `back-link points at #${href.slice(1)}, which is not in the document`).not.toBeNull();
    expect(marker!.getAttribute("data-spya-note-ref")).toBe(
      back!.getAttribute("data-spya-note-back"),
    );
  });

  it("keeps our stamps through the sanitiser — checked, not assumed", () => {
    /* `data-*` survives DOMPurify by default and is not in ARTICLE_CONFIG's
       FORBID_ATTR, but this whole design rests on that being true of *these*
       names, so it is asserted here rather than inherited from a comment. */
    const out = sanitizeHtml(
      `<section data-spya-notes=""><ol><li id="spya-note-abc" data-spya-note="spya-note-abc">` +
        `Note. <a data-spya-note-back="spya-note-abc" href="#spya-noteref-1">↩</a></li></ol></section>` +
        `<p><sup><a data-spya-note-ref="spya-note-abc" id="spya-noteref-1" href="#spya-note-abc">1</a></sup></p>`,
    );
    for (const attr of [
      "data-spya-notes",
      "data-spya-note=",
      "data-spya-note-ref",
      "data-spya-note-back",
    ]) {
      expect(out).toContain(attr);
    }
  });
});
