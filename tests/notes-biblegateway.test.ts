/**
 * Bible Gateway's cross-references, through the real stage 2 and stage 3.
 *
 * A reader imported Romans 1:18-32 on 2026-10-10 and got twenty-three `(A)`…`(W)`
 * markers, drawn as links, that did nothing: no card on hover, no jump on a
 * click. Each one pointed at an `<li id="cen-NIV-…">` in the page's "Cross
 * references" list, and Readability had dropped that list as link-dense
 * furniture while keeping the markers. So every href named an id the stored
 * article no longer had.
 *
 * The list is the publisher's own apparatus, shaped exactly like footnotes — a
 * lettered marker, an ordered list of notes, each note linking back to the verse
 * — so src/notes.ts recognises it as one more footnote shape, and a marker gets
 * the note card links.md describes.
 *
 * The fixture is the served markup, trimmed to the passage (see its header).
 */

import { describe, expect, it, beforeAll } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { JSDOM } from "jsdom";
import { runExtract } from "../src/extract.js";
import { splitIntoBlocks } from "../src/blocks.js";
import { canonicaliseNotes, type NoteStats } from "../src/notes.js";
import type { Block } from "../src/types.js";

const FIXTURE = path.join(
  import.meta.dirname,
  "fixtures",
  "biblegateway",
  "romans-1-18-32.html",
);

interface Run {
  byId: Map<string, Block>;
  doc: Document;
  notes: NoteStats;
}

let run: Run;
let source: Document;

beforeAll(async () => {
  const html = await readFile(FIXTURE, "utf-8");
  source = new JSDOM(html).window.document;
  const extract = await runExtract({
    html,
    url: "https://www.biblegateway.com/passage/?search=Romans%201%3A18-32&version=NIV",
    slug: "passage",
  });
  const split = splitIntoBlocks(extract.extractedHtml);
  run = {
    byId: new Map(split.blocks.map((b) => [b.id, b])),
    doc: new JSDOM(split.html).window.document,
    notes: extract.notes,
  };
}, 60_000);

/** The block an element sits inside. */
function blockOf(el: Element): Block | undefined {
  for (let p: Element | null = el; p; p = p.parentElement) {
    const block = run.byId.get(p.id);
    if (block) return block;
  }
  return undefined;
}

const landsOn = (a: Element): Block | undefined => {
  const href = a.getAttribute("href") ?? "";
  return href.startsWith("#") ? run.byId.get(href.slice(1)) : undefined;
};

describe("Bible Gateway cross-references", () => {
  it("no in-article link is left pointing at nothing", () => {
    /* The symptom the reader met, asserted directly: a `#fragment` that no block
       answers to is a link that looks live and does nothing. */
    const dangling = Array.from(run.doc.querySelectorAll("a[href^='#']"))
      .filter((a) => landsOn(a) === undefined)
      .map((a) => `${a.textContent} → ${a.getAttribute("href")}`);
    expect(dangling).toEqual([]);
  });

  it("every cross-reference in the source becomes a note, with its marker", () => {
    const notes = source.querySelectorAll(".crossrefs li[id^='cen-']").length;
    const markers = source.querySelectorAll("sup.crossreference a[href^='#cen-']").length;
    expect(notes).toBe(23);
    expect(run.notes.notes).toBe(notes);
    expect(run.notes.markers).toBe(markers);
    expect(run.notes.shapes.biblegateway).toBe(notes);
    expect(run.doc.querySelectorAll("a[data-spya-note-ref]")).toHaveLength(markers);
  });

  it.each([
    /* Verse 18 is the first after a heading, and Bible Gateway puts that verse's
       id on the heading's span rather than on the verse — so its back-link
       points at the heading, not at the marker. */
    { label: "A", citing: "The wrath of God", note: "Jn 3:36; Ro 5:9" },
    { label: "W", citing: "but also approve", note: "Ps 50:18; Lk 11:48" },
  ])("marker ($label) in “$citing” lands on its cross-reference", ({ label, citing, note }) => {
    const marker = Array.from(run.doc.querySelectorAll("a[data-spya-note-ref]")).find(
      (a) => a.textContent === label && (blockOf(a)?.text ?? "").includes(citing),
    );
    expect(marker, `no marker ${label} in a block containing "${citing}"`).toBeDefined();
    const landed = landsOn(marker!);
    expect(landed?.text).toContain(note);
    expect(landed?.html).toContain(`data-spya-note="${marker!.getAttribute("data-spya-note-ref")}"`);
  });

  it("the verse's own words are unchanged around the marker", () => {
    /* The marker is rewritten, its brackets are not: `(A)` must still read
       `(A)`, or every verse's block text — and so its id — would change. */
    const verse = Array.from(run.byId.values()).find((b) => b.text.includes("The wrath of God"));
    expect(verse?.text).toContain("The wrath of God(A) is being revealed");
  });

  it("every back-link lands on a block that cites its note", () => {
    const backs = Array.from(run.doc.querySelectorAll("[data-spya-note-back]"));
    expect(backs.length).toBe(run.notes.markers);
    const lost = backs.filter((back) => {
      const noteId = back.getAttribute("data-spya-note-back") ?? "";
      return !(landsOn(back)?.html ?? "").includes(`data-spya-note-ref="${noteId}"`);
    });
    expect(lost.map((b) => b.outerHTML)).toEqual([]);
  });

  it("the author's verse links, including the first after a heading, return to their citing block", () => {
    const notes = Array.from(run.doc.querySelectorAll("[data-spya-note]"));
    expect(notes).toHaveLength(23);
    for (const note of notes) {
      const noteId = note.getAttribute("data-spya-note");
      const verse = Array.from(note.querySelectorAll("a")).find(
        (a) => /^Romans 1:/.test(a.textContent ?? ""),
      );
      expect(verse, `no authored verse link in ${noteId}`).toBeDefined();
      expect(landsOn(verse!)?.html, verse!.outerHTML).toContain(
        `data-spya-note-ref="${noteId}"`,
      );
    }
    expect(run.notes.synthesised).toBe(0);
  });
});

// Synthetic negatives: similar class names alone are not publisher evidence.
describe("Bible Gateway recognition boundaries", () => {
  it.each([
    { marker: "footnote", id: "fen-history", list: "footnotes" },
    { marker: "crossreference", id: "cen-history", list: "crossrefs" },
    { marker: "footnote", id: "cen-NIV-27949A", list: "crossrefs" },
    { marker: "crossreference", id: "fen-NIV-27949a", list: "footnotes" },
    { marker: "crossreference", id: "cen-NIV-27949A", list: "footnotes" },
    { marker: "footnote", id: "fen-NIV-27949a", list: "crossrefs" },
  ])("leaves ordinary content at $id with $marker / $list alone", ({ marker, id, list }) => {
    const doc = new JSDOM(
      `<article><p>Prose <sup class="${marker}"><a href="#${id}">a</a></sup>.</p>` +
      `<div class="${list}"><ol><li id="${id}">Ordinary list content with several words.</li></ol></div></article>`,
    ).window.document;
    const before = doc.body.innerHTML;
    expect(canonicaliseNotes(doc).notes).toBe(0);
    expect(doc.body.innerHTML).toBe(before);
  });

  it("keeps a [a] footnote's label, prose and authored return link", async () => {
    // Minimal fen markup, rather than a claim that this is an untrimmed live page.
    const context = " This paragraph continues the author's argument in ordinary prose, keeping enough context for a reader to understand the surrounding passage.".repeat(5);
    const html = `<article><div><p><span id="en-NIV-26043">The light shines in the darkness, ` +
      `and the darkness has not overcome<sup class="footnote">[<a href="#fen-NIV-26043a">a</a>]</sup> it. ` +
      `${context}</span></p></div>` +
      `<div class="footnotes"><ol><li id="fen-NIV-26043a"><a href="#en-NIV-26043">John 1:5</a> Or <i>understood</i></li></ol></div></article>`;
    const extract = await runExtract({ html, url: "https://example.test/footnotes", slug: "footnotes" });
    expect(extract.notes).toMatchObject({ notes: 1, markers: 1, backlinks: 1, synthesised: 0, shapes: { biblegateway: 1 } });
    const split = splitIntoBlocks(extract.extractedHtml);
    const doc = new JSDOM(split.html).window.document;
    const marker = doc.querySelector("[data-spya-note-ref]");
    expect(marker?.parentElement?.textContent).toBe("[a]");
    const note = split.blocks.find((b) => b.id === marker?.getAttribute("href")?.slice(1));
    expect(note?.text).toBe("John 1:5 Or understood");
    const back = doc.querySelector("[data-spya-note-back]");
    expect(back?.textContent).toBe("John 1:5");
    const citing = split.blocks.find((b) => b.id === back?.getAttribute("href")?.slice(1));
    expect(citing?.html).toContain(`data-spya-note-ref="${marker?.getAttribute("data-spya-note-ref")}"`);
  });
});
