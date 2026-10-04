/**
 * **A PDF's footnotes, shown and linked** — `renderHtml` in src/pdf-read.ts
 * writes the same canonical note markup src/notes.ts writes for a web page, so
 * stage 3 and the reading view treat them exactly as they treat a web article's.
 *
 * The cases are real record sequences from PDFs on production (the survey of
 * every cached `pdf-chunk`, 2026-09-30), cut to a sentence. No PDF is committed.
 * docs/plans/260930k-pdf-footnotes-shown-and-linked.md.
 */
import { describe, expect, it } from "vitest";
import { splitIntoBlocks } from "../src/blocks.js";
import type { PdfRecord } from "../src/pdf.js";
import { renderHtml } from "../src/pdf-read.js";
import { buildNoteIndex } from "../src/web/notes-view.js";

const RAW_SHA = "c".repeat(64);

const r = (page: number, type: PdfRecord["type"], text: string, continues = false): PdfRecord => ({
  page,
  type,
  text,
  continues,
  uncertain: false,
});

const render = (records: PdfRecord[]) => renderHtml(records, "T", RAW_SHA);

/** Each marker as `label → the note's text`, read off the finished blocks. */
function links(records: PdfRecord[]) {
  const { blocks } = splitIntoBlocks(render(records));
  const notes = blocks.filter((b) => b.role === "footnote");
  const out: string[] = [];
  for (const block of blocks) {
    for (const m of block.html.matchAll(/<a [^>]*data-spya-note-ref="([^"]+)"[^>]*>([^<]*)<\/a>/g)) {
      const note = notes.find((n) => n.noteId === m[1]);
      out.push(`${m[2]} → ${note?.text.replace(/\s*↩$/, "") ?? "(nothing)"}`);
    }
  }
  return out;
}

/** The notes as listed at the end, in order. */
const listed = (records: PdfRecord[]) =>
  splitIntoBlocks(render(records))
    .blocks.filter((b) => b.role === "footnote")
    .map((b) => b.text.replace(/\s*↩$/, ""));

describe("a footnote at the foot of its page", () => {
  const records = [
    r(3, "paragraph", "Most researchers are physicalists or nonphysicalists13 [Birth, 2022], and many address Chalmers’s hard problem.14 Others do not."),
    r(3, "footnote", "13 The distinction is contested."),
    r(3, "footnote", "14 Chalmers (1995) coined the phrase."),
  ];

  it("links each marker to its note, and takes the label off the note", () => {
    expect(links(records)).toEqual([
      "13 → The distinction is contested.",
      "14 → Chalmers (1995) coined the phrase.",
    ]);
  });

  it("gives the notes the role stage 3 and the reading view key on, and keeps them out of the prose", () => {
    const { blocks } = splitIntoBlocks(render(records));
    const notes = blocks.filter((b) => b.role === "footnote");
    expect(notes).toHaveLength(2);
    for (const n of notes) {
      expect(n.treatment).toBe("supplement");
      expect(n.noteId).toMatch(/^spya-note-[0-9a-f]{10}/);
    }
    /* The marker's href follows the note to its block id, like a web article's. */
    const para = blocks[0]!;
    const hrefs = [...para.html.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs).toEqual(notes.map((n) => n.id));
    /* And the back-link goes to the paragraph that cites it. */
    expect(notes[0]!.html).toMatch(new RegExp(`href="#${para.id}"`));
  });

  it("links a marker inside an editorial bracket (Kuhn, p. 60)", () => {
    expect(
      links([
        r(60, "paragraph", "The Greek word kokkos [bare/naked grain/ kernel35], which he adopts."),
        r(60, "footnote", "35 From the Greek."),
      ]),
    ).toEqual(["35 → From the Greek."]);
  });

  it("links a superscript marker and a marker after closing punctuation", () => {
    expect(
      links([
        r(5, "paragraph", "The task exceeds working memory limits³. Later work (Buckner, 2013),4 thus mattered."),
        r(5, "footnote", "³ Cowan (2001)."),
        r(5, "footnote", "4 See also the review."),
      ]),
    ).toEqual(["³ → Cowan (2001).", "4 → See also the review."]);
  });
});

describe("endnotes on a page of their own", () => {
  it("links markers on earlier pages to notes printed after the references (MDPI Entropy)", () => {
    expect(
      links([
        r(3, "paragraph", "They are epistemically vulnerable4 agents, with cognitive Selfhood5. Second, it is continuously maintained."),
        r(4, "paragraph", "The surrounding information6 is compressed."),
        r(18, "reference", "21. Wibral, M.; Priesemann, V. Partial information decomposition. Brain Cogn. 2017, 112, 25–38."),
        r(18, "footnote", "4 Vulnerable to being wrong."),
        r(18, "footnote", "5 In the sense of a model of itself."),
        r(18, "footnote", "6 From the environment."),
      ]),
    ).toEqual([
      "4 → Vulnerable to being wrong.",
      "5 → In the sense of a model of itself.",
      "6 → From the environment.",
    ]);
  });
});

/**
 * The MDPI Entropy paper again, on a fresh import, 2026-10-04: the model typed
 * the middle page of its three "Notes" pages as `paragraph`, every record
 * opening with the next label. Shapes are the real ones; the words are not.
 * docs/plans/261004j-footnote-digits-census-root-cause-and-re-import-measurement.md.
 */
describe("a page of endnotes the model typed as paragraphs", () => {
  const prose = r(3, "paragraph", "They stop17 here, which is remarkable18 is the claim, and so are memories19 , and more20.");
  const notesPage = [r(17, "heading1", "Notes"), r(17, "footnote", "16 This is because."), r(17, "footnote", "17 They can.")];
  const paragraphs = (records: PdfRecord[]) =>
    splitIntoBlocks(render(records))
      .blocks.filter((b) => b.role !== "footnote")
      .map((b) => b.text);

  it("lists them as notes and links their markers, past a running header at the page turn", () => {
    const records = [
      prose,
      ...notesPage,
      r(18, "publisher", "Entropy 2024, 26, 481"),
      r(18, "paragraph", "18 There may be."),
      r(18, "paragraph", "19 This may."),
      r(19, "footnote", "20 For instance."),
    ];
    expect(links(records)).toEqual([
      "17 → They can.",
      "18 → There may be.",
      "19 → This may.",
      "20 → For instance.",
    ]);
    expect(listed(records)).toEqual(["This is because.", "They can.", "There may be.", "This may.", "For instance."]);
    /* And not twice: nothing of them is left in the body. */
    expect(paragraphs(records).join("\n")).not.toMatch(/There may be|This may/);
  });

  it("does so when the notes end on that page, with no footnote record after it", () => {
    const records = [prose, ...notesPage, r(18, "paragraph", "18 There may be."), r(18, "paragraph", "19 This may.")];
    expect(listed(records)).toEqual(["This is because.", "They can.", "There may be.", "This may."]);
  });

  it("joins a `continues` paragraph onto the note before it", () => {
    const records = [
      prose,
      ...notesPage,
      r(18, "paragraph", "18 There may be"),
      r(18, "paragraph", "more to say.", true),
      r(18, "paragraph", "19 This may."),
    ];
    expect(listed(records)).toEqual(["This is because.", "They can.", "There may be more to say.", "This may."]);
  });

  it("leaves the whole page alone when one paragraph on it is ordinary prose", () => {
    const records = [
      prose,
      ...notesPage,
      r(18, "paragraph", "18 There may be."),
      r(18, "paragraph", "19 This may."),
      r(18, "paragraph", "Ordinary prose sits here."),
    ];
    expect(listed(records)).toEqual(["This is because.", "They can."]);
    expect(paragraphs(records)).toEqual(expect.arrayContaining(["18 There may be.", "19 This may.", "Ordinary prose sits here."]));
  });

  it("leaves a numbered paragraph alone when no footnote record comes before it", () => {
    const records = [prose, r(17, "heading1", "Notes"), r(18, "paragraph", "18 There may be."), r(18, "paragraph", "19 This may.")];
    expect(listed(records)).toEqual([]);
    expect(paragraphs(records)).toEqual(expect.arrayContaining(["18 There may be.", "19 This may."]));
  });

  it("leaves it alone when a heading, not furniture, lies between the footnote and it", () => {
    const records = [prose, ...notesPage, r(18, "heading2", "Results"), r(18, "paragraph", "18 There may be.")];
    expect(listed(records)).toEqual(["This is because.", "They can."]);
    expect(paragraphs(records)).toContain("18 There may be.");
  });

  it("leaves it alone when the label skips — 17, then 19", () => {
    const records = [prose, ...notesPage, r(18, "paragraph", "19 This may."), r(18, "paragraph", "20 For instance.")];
    expect(listed(records)).toEqual(["This is because.", "They can."]);
    expect(paragraphs(records)).toEqual(expect.arrayContaining(["19 This may.", "20 For instance."]));
  });

  it.each([false, true])("keeps numbered body instructions after an ordinary page footnote (Notes heading: %s)", (heading) => {
    const records = [
      ...(heading ? [r(4, "heading1", "Notes")] : []),
      r(5, "paragraph", "The claim has a qualification5."),
      r(5, "footnote", "5 A qualification."),
      r(6, "listitem", "6 Apply the treatment to every patient."),
      r(6, "listitem", "7 Measure the outcome."),
    ];
    expect(listed(records)).toEqual(["A qualification."]);
    expect(paragraphs(records)).toEqual(expect.arrayContaining([
      "6 Apply the treatment to every patient.", "7 Measure the outcome.",
    ]));
  });

  it("keeps numbered body prose after a title page containing only an affiliation note", () => {
    const records = [
      r(1, "heading1", "A study of memory"),
      r(1, "footnote", "1 Department of Neuroscience."),
      r(2, "listitem", "2 Recruit participants."),
      r(2, "listitem", "3 Collect the measurements."),
    ];
    expect(paragraphs(records)).toEqual(expect.arrayContaining([
      "2 Recruit participants.", "3 Collect the measurements.",
    ]));
  });

  it("keeps a numbered body page across a gap in the supplied pages", () => {
    const records = [prose, ...notesPage, r(25, "paragraph", "18 Participants were enrolled.")];
    expect(paragraphs(records)).toContain("18 Participants were enrolled.");
  });

  it("carries a retyped note's continuation across a page turn", () => {
    const records = [
      prose, ...notesPage,
      r(18, "paragraph", "18 There may be."),
      r(18, "paragraph", "19 This may need"),
      r(19, "publisher", "Running header"),
      r(19, "paragraph", "more explanation.", true),
      r(19, "paragraph", "20 For instance."),
    ];
    expect(listed(records)).toEqual([
      "This is because.", "They can.", "There may be.", "This may need more explanation.", "For instance.",
    ]);
    expect(paragraphs(records).join(" ")).not.toContain("more explanation.");
  });

  it("recovers a page beginning with a continuation of a typed endnote", () => {
    const records = [
      prose, ...notesPage,
      r(18, "paragraph", "the rest of note seventeen.", true),
      r(18, "paragraph", "18 There may be."),
    ];
    expect(listed(records)).toEqual([
      "This is because.", "They can. the rest of note seventeen.", "There may be.",
    ]);
  });

  it("recovers the full measured 18–32 sequence without mutating the transcription", () => {
    const records = [prose, ...notesPage,
      ...Array.from({ length: 15 }, (_, i) => r(18, "paragraph", `${18 + i} Note body ${18 + i}.`)),
      r(19, "footnote", "33 The next note."),
    ];
    const before = structuredClone(records);
    expect(listed(records)).toHaveLength(18);
    expect(paragraphs(records).join(" ")).not.toContain("Note body");
    expect(records).toEqual(before);
  });

  it("leaves a page's one continued body paragraph alone, though a footnote ended the page before", () => {
    const records = [
      r(5, "paragraph", "A sentence5 that runs on"),
      r(5, "footnote", "5 A note."),
      r(6, "paragraph", "over the page turn.", true),
    ];
    expect(listed(records)).toEqual(["A note."]);
    expect(paragraphs(records).join(" ")).toContain("over the page turn.");
  });
});

describe("a space the model put between a marker and the punctuation after it", () => {
  /* Kept on purpose: dropping it changes the block's text, and an article split
     before its notes were linked keeps its ids only on unchanged text — it cost
     10 of 77 ids on the real paper (`withMarkers`, plan 261004j). */
  it("is kept when the marker is linked, so the block's text does not change", () => {
    const html = render([
      lead,
      r(2, "paragraph", "We keep making up stories9 . This holds for memories10 , and for time steps11 ? Yes."),
      r(2, "footnote", "9 One."),
      r(2, "footnote", "10 Two."),
      r(2, "footnote", "11 Three."),
    ]);
    expect(html).toMatch(/stories<sup><a [^>]+>9<\/a><\/sup> \. This/);
    expect(html).toMatch(/memories<sup><a [^>]+>10<\/a><\/sup> , and/);
    expect(html).toMatch(/steps<sup><a [^>]+>11<\/a><\/sup> \? Yes/);
    const { blocks } = splitIntoBlocks(html);
    expect(blocks.some((b) => b.text.includes("stories9 . This holds for memories10 , and"))).toBe(true);
  });

  it("is kept after digits nothing links, and before a word", () => {
    const html = render([
      lead,
      r(2, "paragraph", "We keep making up stories9 . This report2 says so."),
      r(2, "footnote", "2 IPCC, 2021."),
    ]);
    expect(html).toContain("stories9 . This");
    expect(html).toMatch(/report<sup><a [^>]+>2<\/a><\/sup> says/);
  });
});

describe("footnotes and endnotes in one paper", () => {
  it("links both, though the notes arrive 1, 3, 2 and the markers read 1, 2, 3 (GPT Sol, F1)", () => {
    expect(
      links([
        r(1, "paragraph", "The first claim.1"),
        r(1, "footnote", "1 A footnote."),
        r(2, "paragraph", "The second claim.2"),
        r(3, "paragraph", "The third claim.3"),
        r(3, "footnote", "3 Another footnote."),
        r(9, "reference", "Smith, J. (2020). A book."),
        r(9, "footnote", "2 An endnote."),
      ]),
    ).toEqual(["1 → A footnote.", "2 → An endnote.", "3 → Another footnote."]);
  });
});

/** Page 1 carries uncited notes away as front matter, so these cases start on page 2. */
const lead = r(1, "paragraph", "Page one.");

describe("digits that are not markers", () => {
  it("does not take a decimal, a thousands separator, a citation list or maths", () => {
    const records = [
      lead,
      r(2, "paragraph", "The clubs had 2.7 times more links, 1,000 of them, as shown in [1,2]; with \\(x_2\\) fixed."),
      r(2, "footnote", "7 A note nothing here cites."),
      r(2, "footnote", "2 Another."),
      r(2, "footnote", "1 And another."),
    ];
    expect(links(records)).toEqual([]);
    expect(listed(records)).toEqual(["A note nothing here cites.", "Another.", "And another."]);
  });

  it("does not take a digit on a capital — CO2, BRCA1, CD4 (GPT Sol, F2)", () => {
    const records = [
      lead,
      r(2, "paragraph", "Emissions of CO2 rose, BRCA1 and CD4 too, as the report2 says."),
      r(2, "footnote", "2 IPCC, 2021."),
    ];
    expect(render(records)).toMatch(/CO2 rose, BRCA1 and CD4 too, as the report<sup><a [^>]+>2<\/a><\/sup> says/);
  });

  it("does take a lower-case formula written outside maths, which is the cost the plan names (log2)", () => {
    expect(
      render([lead, r(2, "paragraph", "Take log2 of it, as the report2 says."), r(2, "footnote", "2 IPCC, 2021.")]),
    ).toContain("report2 says");
  });

  it("does not treat zero as a note label", () => {
    const records = [
      lead,
      r(2, "paragraph", "The implementation calls these version0 and release⁰."),
      r(2, "footnote", "0 This is not a numbered note."),
      r(2, "footnote", "⁰ Nor is this."),
    ];
    expect(links(records)).toEqual([]);
    expect(listed(records)).toEqual(["0 This is not a numbered note.", "⁰ Nor is this."]);
  });

  it("links a superscript after a number or another superscript, where plain digits would be refused", () => {
    expect(
      links([
        lead,
        r(2, "paragraph", "It was published in 2020.¹ Both claims stand.²,³"),
        r(2, "footnote", "¹ First."),
        r(2, "footnote", "² Second."),
        r(2, "footnote", "³ Third."),
      ]),
    ).toEqual(["¹ → First.", "² → Second.", "³ → Third."]);
  });

  it("leaves a footnote unlinked when its page has two places it could be (GPT Sol, F2)", () => {
    const records = [
      lead,
      r(2, "paragraph", "Rats had lesions3 and controls had none3."),
      r(2, "footnote", "3 Which is it?"),
    ];
    expect(links(records)).toEqual([]);
    expect(listed(records)).toEqual(["Which is it?"]);
  });

  it("does not look on another page for an ordinary footnote", () => {
    expect(
      links([
        r(1, "paragraph", "An earlier sentence ending with a glued figure3 on page one."),
        r(2, "paragraph", "Page two says nothing about it."),
        r(2, "footnote", "3 A note whose marker was lost."),
      ]),
    ).toEqual([]);
  });

  it("leaves a verse-range note and a letter label listed, unlinked, as printed (Dhammapada, J Neurosci)", () => {
    const records = [
      lead,
      r(109, "paragraph", "Verses 1 and 2 are paired.1"),
      r(109, "footnote", "1-2: The fact that the word mano is paired here with dhamma."),
      r(109, "footnote", "a To test the effect of disrupting the overall structure."),
    ];
    expect(links(records)).toEqual([]);
    expect(listed(records)).toEqual([
      "1-2: The fact that the word mano is paired here with dhamma.",
      "a To test the effect of disrupting the overall structure.",
    ]);
  });
});

describe("a note nothing cites", () => {
  const records = [
    lead,
    r(33, "paragraph", "Seth's marker was lost in transcription."),
    r(33, "footnote", "25 Seth first heard the phrase from Chris Frith."),
    r(33, "footnote", "† A symbol keeps its mark."),
  ];

  it("carries its printed number to the reading view, so the view does not count it as 1 (GPT Sol, F4)", () => {
    const { blocks } = splitIntoBlocks(render(records));
    const index = buildNoteIndex(blocks);
    const labels = [...index.byNote.values()].map((n) => `${n.label}: ${n.blocks[0]!.text}`);
    expect(labels).toEqual(["25: Seth first heard the phrase from Chris Frith.", "2: † A symbol keeps its mark."]);
  });

  it("keeps the same id whether or not its marker is found", () => {
    const cited = splitIntoBlocks(
      render([lead, r(33, "paragraph", "Seth said so.25"), r(33, "footnote", "25 Seth first heard the phrase from Chris Frith.")]),
    ).blocks.find((b) => b.role === "footnote");
    const uncited = splitIntoBlocks(render(records)).blocks.find((b) => b.role === "footnote");
    expect(cited?.noteId).toBe(uncited?.noteId);
  });
});

describe("the first page's notes", () => {
  it("leaves out an affiliation printed as a footnote, which nothing in the prose cites (GPT Sol, F3)", () => {
    const records = [
      r(1, "heading1", "Temporal Context Reinstatement"),
      r(1, "paragraph", "Human episodic memory is ordered.1"),
      r(1, "footnote", "1Max Planck Institute for Software Systems, Saarbrucken, Germany"),
      r(1, "footnote", "2 This one is cited.") ,
    ];
    /* The affiliation's label is 1 and so is a marker, so it would link if it
       could; what keeps it out when it cannot is being uncited on page 1. */
    const affiliation = [
      r(1, "heading1", "Temporal Context Reinstatement"),
      r(1, "paragraph", "Human episodic memory is ordered, as shown2."),
      r(1, "footnote", "1Max Planck Institute for Software Systems, Saarbrucken, Germany"),
      r(1, "footnote", "2 This one is cited."),
    ];
    expect(listed(affiliation)).toEqual(["This one is cited."]);
    expect(links(records)).toHaveLength(1);
  });
});

describe("a note continued onto the next page", () => {
  it("is one note", () => {
    expect(
      links([
        r(33, "paragraph", "Seth calls it controlled hallucination.25"),
        r(33, "footnote", "25 Seth first heard the phrase from Chris Frith and traced it"),
        r(34, "paragraph", "The next page carries on."),
        r(34, "footnote", "back to a seminar given in the 1990s.", true),
      ]),
    ).toEqual(["25 → Seth first heard the phrase from Chris Frith and traced it back to a seminar given in the 1990s."]);
  });
});

describe("an article with no footnotes to show", () => {
  it("gets no notes section at all", () => {
    expect(render([r(1, "paragraph", "Nothing to see.")])).not.toContain("<section");
    expect(render([r(1, "paragraph", "Nothing cites it."), r(1, "footnote", "1 Affiliation.")])).not.toContain("<section");
  });
});
