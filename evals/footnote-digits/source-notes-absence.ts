/**
 * Offline reproduction of the source-note provenance gap, and of what closes
 * its measured consequence.
 *
 * Run from the repository root:
 *   node --import tsx evals/footnote-digits/source-notes-absence.ts
 *
 * Uses synthetic records and markup only; no store, network or credentials.
 * `hasNotes` is still false for a source that has a note: that half is the
 * unresolved gap, and the first assertions pin it. The consequence GPT Sol's C5
 * demonstrated — a wrong reference entry paired by a footnote's number — is
 * refused since `citesMostOfListGlued`: one glued number against a ten-entry
 * list is not a paper that cites by glued numbers. With a one-entry list the
 * pairing still passes; that residue is asserted last.
 */
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { splitIntoBlocks } from "../../src/blocks.js";
import { emptyDrops, hasNotes, noScoreDrops, toDrafts } from "../../src/bibliography.js";
import { canonicaliseNotes } from "../../src/notes.js";
import type { PdfRecord } from "../../src/pdf.js";
import { renderHtml } from "../../src/pdf-read.js";
import type { Block } from "../../src/types.js";

const record = (page: number, type: PdfRecord["type"], text: string): PdfRecord => ({
  page, type, text, continues: false, uncertain: false,
});

const TEN = new Map<number, string>();
for (let n = 1; n <= 10; n++) TEN.set(n, `Author${n}. Another Work ${n}. 2001.`);
TEN.set(2, "Smith. Memory Effects. 2020.");

/** A self-consistent wrong numbered-entry claim, against a list of `entries`. */
function attachWrongEntry(blocks: Block[], entries: Map<number, string> = TEN) {
  const body = blocks.find((b) => b.text.startsWith("Studies of memory2"));
  assert.ok(body, "The synthetic citing paragraph must survive extraction.");
  assert.equal(hasNotes(blocks), false, "Recognised blocks falsely imply that source notes are absent.");
  const drops = emptyDrops();
  const drafts = toDrafts([{
    title: "Memory Effects",
    authors: "Smith",
    year: "2020",
    why: "Invoked as evidence",
    entry: 2,
    mentions: [{ blockId: body.id, quote: "Studies of memory" }],
  }], blocks, drops, noScoreDrops(), { entries });
  assert.equal(drafts.length, 1);
  if (entries.size === 1) {
    /* The residue: a list this short is covered by one stray number. */
    assert.equal(drafts[0]!.entry, "Smith. Memory Effects. 2020.");
    assert.equal(drops.entryMismatch, 0);
  } else {
    assert.equal(drafts[0]!.entry, undefined, "The footnote's number must not pair the work with entry 2.");
    assert.equal(drops.entryMismatch, 1);
  }
  return { recognisedNotes: hasNotes(blocks), entry: drafts[0]!.entry ?? null, mismatches: drops.entryMismatch };
}

// The source contains a real note, but two marker candidates make its placement
// ambiguous. renderNotes intentionally leaves an uncited first-page note out.
const pdfSource = [
  record(1, "paragraph", "Studies of memory2 support the claim, and studies of memory2 are controversial."),
  record(1, "footnote", "2 A methodological qualification, not a reference."),
];
assert.equal(pdfSource.filter((r) => r.type === "footnote").length, 1);
const pdfBlocks = splitIntoBlocks(renderHtml(pdfSource, "Synthetic paper", "c".repeat(64))).blocks;
assert.equal(pdfBlocks.some((b) => b.text.includes("methodological qualification")), false);
const pdf = attachWrongEntry(pdfBlocks);

// The source's marker and note target exist. Without a backlink this publisher
// shape is deliberately unsupported by the canonicaliser; the note stays prose.
const web = new JSDOM(`<article>
  <p>Studies of memory<a role="doc-noteref" href="#fn2">2</a> support the claim.</p>
  <ol><li id="fn2">A real methodological note with no backlink.</li></ol>
</article>`).window.document;
assert.equal(web.querySelectorAll('[role="doc-noteref"]').length, 1);
assert.ok(web.getElementById("fn2"));
const stats = canonicaliseNotes(web);
assert.equal(stats.notes, 0);
const webBlocks = splitIntoBlocks(web.body.innerHTML).blocks;
assert.ok(webBlocks.some((b) => b.text.includes("real methodological note")));
const unsupportedWeb = attachWrongEntry(webBlocks);

const residue = attachWrongEntry(pdfBlocks, new Map([[2, "Smith. Memory Effects. 2020."]]));

console.log(JSON.stringify({
  finding: "A source note can disappear from recognised note evidence. Its number no longer pairs a wrong entry from a ten-entry list; it still does from a one-entry list.",
  residue,
  pdf: { sourceNotes: 1, ...pdf },
  unsupportedWeb: { sourceNotes: 1, canonicalNotes: stats.notes, ...unsupportedWeb },
}, null, 2));
