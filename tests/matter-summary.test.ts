/**
 * **A summary the author put at the front folds like the abstract** — an
 * executive summary, *Key points*, *Highlights*, *Significance*, *Author
 * summary* (Greg's answer to q-r8kumx, "B"; plan 261025f). Found by the label
 * rule alone (src/matter.ts § `summaryAt`, src/matter-labels.ts), named on its
 * stub from a closed map (src/matter-summary.ts). The three shapes the 261018b
 * corpus has fold; every placement and extent guard has a case that fails it.
 */
import { describe, expect, it } from "vitest";

import {
  MAX_RANGE_WORDS,
  admitMatter,
  type MatterArticle,
  combineMatter,
  matterRequest,
  parseMatterAnswer,
  stretchEvidence,
  summaryAt,
} from "../src/matter.js";
import type { MatterBlock } from "../src/matter-current.js";
import { matterByLabels, type LabelsArticle } from "../src/matter-labels.js";
import { isSummaryLabel, summaryStubLabel } from "../src/matter-summary.js";
import type { Block } from "../src/types.js";
import { stubCount, stubLabel, stubWhat } from "../src/web/matter-view.js";

const wordsOf = (t: string) => t.split(/\s+/u).filter(Boolean).length;
const PROSE =
  "We argue that the question is open, and that it has been studied for decades by people who disagree about what the evidence shows and why it matters for the rest of the field.";
const prose = (i: number) => `${PROSE} Paragraph ${i}.`;
const REF = (i: number) => `Author ${i}, A. (2019). A study of things. Journal of Studies, 12, 1–10. doi:10.1000/x${i}`;

let counter = 0;
const block = (text: string, kind = "text", level?: number): MatterBlock & Block =>
  ({
    id: `spya-s${String(counter++).padStart(5, "0")}`,
    kind,
    ...(level === undefined ? {} : { level }),
    tag: kind === "heading" ? `h${level ?? 2}` : "p",
    text,
    words: wordsOf(text),
    html: `<p>${text}</p>`,
    gistable: true,
  }) as MatterBlock & Block;

type Named = LabelsArticle & { at: Record<string, number>; blocks: (MatterBlock & Block)[] };

/** An article from named blocks: `[name | null, block]` in order, then a long body and references. */
function article(front: [string | null, MatterBlock & Block][], bodySections = 10): Named {
  const blocks: (MatterBlock & Block)[] = [];
  const at: Record<string, number> = {};
  const push = (name: string | null, b: MatterBlock & Block) => {
    if (name) at[name] = blocks.length;
    blocks.push(b);
  };
  for (const [name, b] of front) push(name, b);
  for (let s = 0; s < bodySections; s++) {
    push(s === 0 ? "body" : null, block(`${s + 2} Section ${s + 2}`, "heading", 2));
    for (let k = 0; k < 20; k++) push(null, block(prose(s * 20 + k)));
  }
  push("refsHeading", block("References", "heading", 2));
  for (let r = 0; r < 30; r++) push(null, block(REF(r)));
  return { blocks, meta: { title: "Consciousness in Artificial Intelligence" }, at };
}

const summaries = (a: LabelsArticle) => matterByLabels(a, new Set()).stretches.filter((s) => s.kinds.includes("summary"));
const span = (a: Named, s: { from: string; to: string }) => [a.blocks.findIndex((b) => b.id === s.from), a.blocks.findIndex((b) => b.id === s.to)];

/** arXiv 2308.08708, as stored: every label a paragraph, no heading before the contents. */
function reportedShape(): Named {
  return article([
    ["title", block("Consciousness in Artificial Intelligence: Insights from the Science of Consciousness")],
    [null, block("Patrick Butlin, University of Oxford; Robert Long, Center for AI Safety")],
    ["ackLabel", block("Acknowledgements")],
    [null, block("We thank Jane Roe and the members of the lab for comments on drafts, and the reviewers for careful reading.")],
    [null, block("SMF was supported by a Wellcome/Royal Society Sir Henry Dale Fellowship (206648/Z/17/Z).")],
    ["summaryLabel", block("Executive Summary")],
    ["summaryFirst", block(prose(900))],
    [null, block("We take our principal contributions in this report to be:")],
    [null, block("1. Showing that the assessment of consciousness in AI is scientifically tractable.")],
    [null, block(prose(901))],
    ["summaryLast", block(prose(902))],
    ["contents", block("Contents", "heading", 6)],
    [null, block("1 Introduction")],
    [null, block("2 Scientific Theories")],
    [null, block("1 Introduction", "heading", 2)],
    [null, block(prose(903))],
  ]);
}

describe("isSummaryLabel and the stub's name", () => {
  it("knows the five labels and their variants, numbered or not, and not Summary", () => {
    for (const l of ["Executive Summary", "KEY POINTS", "Key points:", "Highlights", "Research highlights", "Significance", "Significance Statement", "Author summary", "1. Executive summary"]) {
      expect(isSummaryLabel(l), l).toBe(true);
    }
    for (const l of ["Summary", "8. Summary", "TL;DR", "In brief", "Key findings", "Executive summary of the debate so far, and what it shows"]) {
      expect(isSummaryLabel(l), l).toBe(false);
    }
    expect(summaryStubLabel("EXECUTIVE SUMMARY")).toBe("Executive summary");
    expect(summaryStubLabel("Key Points:")).toBe("Key points");
    expect(summaryStubLabel("Something the page wrote")).toBe("Summary");
  });

  it("names the stub by the label, counts words, and says what it is", () => {
    expect(stubLabel(["summary"], "Executive Summary")).toBe("Executive summary");
    expect(stubLabel(["summary"], "Significance")).toBe("Significance");
    expect(stubLabel(["summary"])).toBe("Summary");
    const blocks = [block("Highlights"), block("One two three."), block("Four five.")];
    expect(stubCount({ start: 0, end: 2, kinds: ["summary"] }, blocks)).toBe("6 words");
    expect(stubWhat(["summary"])).toMatch(/own summary/u);
  });
});

describe("a front summary folds", () => {
  it("under a paragraph label, to the next heading, and the thanks before it stop at its label (arXiv 2308.08708)", () => {
    const a = reportedShape();
    const s = summaries(a);
    expect(s).toHaveLength(1);
    expect(span(a, s[0]!)).toEqual([a.at.summaryLabel, a.at.summaryLast]);
    const r = matterByLabels(a, new Set());
    const ack = r.stretches.find((x) => x.kinds.includes("acknowledgements"))!;
    expect(span(a, ack)[1]).toBeLessThan(a.at.summaryLabel!);
  });

  it("under a heading, after only lesser headings and labels (NIST AI 100-1)", () => {
    const a = article([
      [null, block("Update Schedule and Versions", "heading", 2)],
      [null, block(prose(800))],
      [null, block("Table of Contents", "heading", 2)],
      [null, block("1 Framing Risk 4")],
      [null, block("2 Audience 9")],
      [null, block("3 AI Risks and Trustworthiness 12")],
      ["summaryLabel", block("Executive Summary", "heading", 1)],
      [null, block(prose(801))],
      [null, block(prose(802))],
      ["summaryLast", block(prose(803))],
      [null, block("Part 1: Foundational Information", "heading", 1)],
      [null, block(prose(804))],
    ]);
    const s = summaries(a);
    expect(s).toHaveLength(1);
    expect(span(a, s[0]!)).toEqual([a.at.summaryLabel, a.at.summaryLast]);
  });

  it("with a structured summary's own sub-headings (JAMA's Question, Findings, Meaning)", () => {
    const a = article([
      ["summaryLabel", block("Key Points", "heading", 2)],
      [null, block("Question", "heading", 3)],
      [null, block(prose(810))],
      [null, block("Findings", "heading", 3)],
      [null, block(prose(811))],
      [null, block("Meaning", "heading", 3)],
      ["summaryLast", block(prose(812))],
      [null, block("Abstract", "heading", 2)],
      [null, block(prose(813))],
    ]);
    expect(span(a, summaries(a)[0]!)).toEqual([a.at.summaryLabel, a.at.summaryLast]);
  });

  it("with question sub-headings over bullets (PLOS Medicine's Author summary), but not over prose", () => {
    const li = (text: string) => ({ ...block(text), tag: "li", html: `<li>${text}</li>` }) as MatterBlock & Block;
    const shape = (under: (t: string) => MatterBlock & Block) =>
      article([
        ["summaryLabel", block("Author summary", "heading", 2)],
        [null, block("Why was this study done?", "heading", 3)],
        [null, under("Hospital stays after surgery vary widely between hospitals.")],
        [null, block("What did the researchers do and find?", "heading", 3)],
        [null, under("We compared 1,200 patients across nine hospitals.")],
        ["summaryLast", under("Stays were longest where follow-up was weakest.")],
        [null, block("Citation: Verma AA, Guo Y (2018) Hospital stays. PLoS Med 15(6): e1002584.")],
        [null, block("Introduction", "heading", 2)],
      ]);
    const a = shape(li);
    expect(span(a, summaries(a)[0]!)).toEqual([a.at.summaryLabel, a.at.summaryLast]);
    const prosy = shape((t) => block(t));
    expect(summaries(prosy)).toEqual([]);
  });

  it("as a list, to its last item: the unheaded introduction after it stays showing", () => {
    const li = (text: string) => ({ ...block(text), tag: "li", html: `<li>${text}</li>` }) as MatterBlock & Block;
    const a = article([
      ["summaryLabel", block("Highlights")],
      [null, li("Astrocytes change more with age than neurons do.")],
      ["summaryLast", li("The change is regional.")],
      [null, block(prose(814))],
      [null, block(prose(815))],
    ]);
    expect(span(a, summaries(a)[0]!)).toEqual([a.at.summaryLabel, a.at.summaryLast]);
  });

  it("stopping at a Keywords line inside its section (Europe PMC's Significance)", () => {
    const a = article([
      [null, block("Laura E Clarke, Shane A Liddelow, Chandrani Chakraborty")],
      ["summaryLabel", block("Significance", "heading", 2)],
      ["summaryLast", block(prose(820))],
      ["keywords", block("Keywords: astrocytes, aging, microglia, RNA sequencing, cognitive decline")],
      [null, block("Abstract", "heading", 2)],
      [null, block(prose(821))],
    ]);
    expect(span(a, summaries(a)[0]!)).toEqual([a.at.summaryLabel, a.at.summaryLast]);
  });

  it("after a Figures heading over pictures, and stopping at the Citation line in its section (PLOS)", () => {
    const a = article([
      [null, block("Predictive coding networks for temporal prediction", "heading", 2)],
      [null, block("Beren Millidge, Mufeng Tang")],
      [null, block("Figures", "heading", 2)],
      [null, block("", "media")],
      [null, block("", "media")],
      [null, block("Abstract", "heading", 2)],
      [null, block(`${prose(1270)} ${prose(1271)}`)],
      ["summaryLabel", block("Author summary", "heading", 2)],
      [null, block(prose(1272))],
      ["summaryLast", block(prose(1273))],
      [null, block("Citation: Millidge B, Tang M (2024) Predictive coding networks for temporal prediction. PLoS Comput Biol 20(4): e1011183.")],
      [null, block("Received: May 15, 2023; Accepted: March 12, 2024; Published: April 1, 2024")],
      [null, block("Introduction", "heading", 2)],
    ]);
    a.meta.title = "Predictive coding networks for temporal prediction";
    expect(span(a, summaries(a)[0]!)).toEqual([a.at.summaryLabel, a.at.summaryLast]);
  });

  it("but through a structured summary's inline parts (Question: …, Findings: …)", () => {
    const a = article([
      ["summaryLabel", block("Key Points", "heading", 2)],
      [null, block("Question: Is the change in astrocytes with age larger than the change in neurons?")],
      [null, block("Findings: In this cohort of 1,200 adults, it was larger in every region measured.")],
      ["summaryLast", block("Meaning: Astrocytes may be a target for slowing cognitive decline.")],
      [null, block("Abstract", "heading", 2)],
    ]);
    expect(span(a, summaries(a)[0]!)).toEqual([a.at.summaryLabel, a.at.summaryLast]);
  });

  it("stopping at an IEEE 'Index Terms—' line", () => {
    const a = article([
      ["summaryLabel", block("Significance Statement", "heading", 2)],
      ["summaryLast", block(prose(1280))],
      [null, block("Index Terms—astrocytes, aging, microglia")],
      [null, block("Introduction", "heading", 2)],
    ]);
    expect(span(a, summaries(a)[0]!)).toEqual([a.at.summaryLabel, a.at.summaryLast]);
  });

  it("stopping at a numbered section title left as a paragraph", () => {
    const a = article([
      ["summaryLabel", block("Key points")],
      ["summaryLast", block(prose(830))],
      [null, block("1 Introduction")],
      [null, block(prose(831))],
    ]);
    expect(span(a, summaries(a)[0]!)).toEqual([a.at.summaryLabel, a.at.summaryLast]);
  });
});

describe("a summary label that is not a front summary stays showing", () => {
  const reasonAt = (a: Named, name: string) => summaryAt(a as MatterArticle, a.at[name]!);

  it("after a heading of the article's own at its level (Key points after Introduction)", () => {
    const a = article([
      [null, block("Introduction", "heading", 2)],
      [null, block(prose(840))],
      ["label", block("Key points", "heading", 2)],
      [null, block(prose(841))],
    ]);
    expect(summaries(a)).toEqual([]);
    expect(reasonAt(a, "label")).toBe("a heading of the article's own before the summary");
  });

  it("under a section of the body (Highlights under Results)", () => {
    const a = article([
      [null, block("Results", "heading", 2)],
      [null, block(prose(850))],
      ["label", block("Highlights", "heading", 3)],
      [null, block(prose(851))],
    ]);
    expect(summaries(a)).toEqual([]);
  });

  it("as a paragraph label after any heading of the article's own, even a lesser one", () => {
    const a = article([
      [null, block("Background", "heading", 4)],
      [null, block(prose(860))],
      ["label", block("Highlights")],
      [null, block(prose(861))],
    ]);
    expect(summaries(a)).toEqual([]);
  });

  it("past the opening window, with no heading before it", () => {
    const front: [string | null, MatterBlock & Block][] = Array.from({ length: 80 }, (_, i): [null, MatterBlock & Block] => [null, block(prose(870 + i))]);
    front.push(["label", block("Key points")], [null, block(prose(999))]);
    const a = article(front, 2);
    expect(summaries(a)).toEqual([]);
    expect(reasonAt(a, "label")).toBe("a summary label past the opening");
  });

  it("when its heading's section holds body sections a coarse level gave it", () => {
    const a = article([
      ["label", block("Executive Summary", "heading", 1)],
      [null, block(prose(880))],
      [null, block("Introduction", "heading", 2)],
      [null, block(prose(881))],
      [null, block("Methods", "heading", 2)],
      [null, block(prose(882))],
      [null, block("Part II", "heading", 1)],
    ]);
    expect(summaries(a)).toEqual([]);
    expect(reasonAt(a, "label")).toBe("a heading of the article's own inside the summary");
  });

  it("after unheaded prose of the article's own, even with the levels inverted", () => {
    const opening: [string | null, MatterBlock & Block][] = Array.from({ length: 10 }, (_, i): [null, MatterBlock & Block] => [null, block(prose(890 + i))]);
    const a = article([...opening, ["label", block("2. Highlights")], [null, block(prose(895))]]);
    expect(summaries(a)).toEqual([]);
    expect(reasonAt(a, "label")).toBe("the article's own prose before the summary");
    const inverted = article([
      [null, block("Introduction", "heading", 2)],
      ...opening,
      ["label", block("Key points", "heading", 1)],
      [null, block(prose(896))],
    ]);
    expect(summaries(inverted)).toEqual([]);
  });

  it("but an abstract before it is not the article's own prose (PLOS: Abstract, then Author summary)", () => {
    const a = article([
      [null, block("Abstract", "heading", 2)],
      [null, block(`${prose(897)} ${prose(898)} ${prose(899)} ${prose(900)}`)],
      ["summaryLabel", block("Author summary", "heading", 2)],
      ["summaryLast", block(prose(901))],
    ]);
    expect(span(a, summaries(a)[0]!)).toEqual([a.at.summaryLabel, a.at.summaryLast]);
  });

  it("over the word cap: whole or not at all", () => {
    const front: [string | null, MatterBlock & Block][] = [["label", block("Executive summary")]];
    const n = Math.ceil(MAX_RANGE_WORDS / wordsOf(prose(0))) + 1;
    for (let i = 0; i < n; i++) front.push([null, block(prose(1000 + i))]);
    const a = article(front, 20);
    expect(summaries(a)).toEqual([]);
    expect(reasonAt(a, "label")).toBe("a summary over the word cap");
  });

  it("with nothing under it", () => {
    const a = article([["label", block("Highlights", "heading", 2)], [null, block("Abstract", "heading", 2)], [null, block(prose(1100))]]);
    expect(summaries(a)).toEqual([]);
  });
});

describe("the model is not asked for summaries", () => {
  it("leaves summary out of the request's schema, so the request is what it was", () => {
    const body = JSON.stringify(matterRequest(reportedShape()));
    expect(body).not.toContain('"summary"');
    expect(body).toContain('"abstract"');
  });

  it("refuses an answer that claims one", () => {
    const answer = { choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ stretches: [{ type: "range", from: "a", to: "b", kinds: ["summary"] }] }) } }] };
    expect(() => parseMatterAnswer(answer)).toThrow(/refused/u);
  });
});

describe("what stops a summary is a label, not a word", () => {
  it("runs past a sentence that opens 'Subjects' or 'Abstract' and past a numbered point", () => {
    const a = article([
      ["summaryLabel", block("Significance")],
      [null, block("Subjects were adults aged 60 and over, followed for ten years, and their decline was measured twice.")],
      [null, block("Abstract reasoning declined less than memory did.")],
      ["summaryLast", block("1. Reduce latency")],
      [null, block("1 Introduction", "heading", 2)],
    ]);
    expect(span(a, summaries(a)[0]!)).toEqual([a.at.summaryLabel, a.at.summaryLast]);
  });
});

describe("the model's request gives summary labels no weight", () => {
  it("lists a Highlights heading between the windows as any heading, not first like a known label", () => {
    const blocks: (MatterBlock & Block)[] = [block("A long report"), ...Array.from({ length: 40 }, (_, i) => block(prose(1300 + i)))];
    for (let h = 0; h < 200; h++) blocks.push(block(h === 100 ? "Highlights" : h === 101 ? "References" : `Section ${h} on a long and specific subject`, "heading", 2), block(prose(1400 + h)));
    for (let i = 0; i < 100; i++) blocks.push(block(prose(1700 + i)));
    const input = JSON.stringify(matterRequest({ blocks, meta: {} }));
    expect(input).toContain('\\"text\\":\\"References\\"');
    expect(input).not.toContain('\\"text\\":\\"Highlights\\"');
  });
});

describe("combineMatter keeps a summary its own stub", () => {
  it("keeps a summary whole when the model called its bullets contents", () => {
    const li = (text: string) => ({ ...block(text), tag: "li", html: `<li>${text}</li>` }) as MatterBlock & Block;
    /* Bullets that repeat the article's own section headings pass as an unlabelled contents list. */
    const a = article([
      ["summaryLabel", block("Key points", "heading", 2)],
      ["first", li("2 Section 2")],
      [null, li("3 Section 3")],
      ["summaryLast", li("4 Section 4")],
    ]);
    const model = admitMatter(a, [{ type: "range", from: a.blocks[a.at.first!]!.id, to: a.blocks[a.at.summaryLast!]!.id, kinds: ["contents"] }]);
    expect(model.stretches.map((x) => x.kinds)).toEqual([["contents"]]);
    const u = combineMatter(a, model, matterByLabels(a, new Set()), new Set());
    const front = u.stretches.filter((x) => span(a, x)[0]! <= a.at.summaryLast!);
    expect(front.map((x) => [span(a, x), x.kinds])).toEqual([[[a.at.summaryLabel, a.at.summaryLast], ["summary"]]]);
  });

  it("does not take a one-line stretch of another kind into it", () => {
    const li = (text: string) => ({ ...block(text), tag: "li", html: `<li>${text}</li>` }) as MatterBlock & Block;
    /* A list summary ends at its last item, so the DOI line after it touches it from outside. */
    const a = article([
      ["summaryLabel", block("Highlights", "heading", 2)],
      [null, li(prose(1260))],
      ["summaryLast", li(prose(1261))],
      ["doi", block("doi:10.1000/xyz123")],
      [null, block("Introduction", "heading", 2)],
    ]);
    const dates = { item: 0, start: a.at.doi!, end: a.at.doi! + 1, kinds: ["dates" as const], headedBy: null, shape: "range" as const };
    const u = combineMatter(a, { held: [dates] }, matterByLabels(a, new Set()), new Set());
    expect(u.stretches.map((x) => [span(a, x), x.kinds])).toContainEqual([[a.at.summaryLabel, a.at.summaryLast], ["summary"]]);
  });

  it("holds a stretch claiming summary to its label's run", () => {
    const a = reportedShape();
    expect(stretchEvidence(a, a.at.summaryLabel!, a.at.summaryLast! + 1, ["summary"])).toBeNull();
    expect(stretchEvidence(a, a.at.summaryLabel!, a.at.summaryLast! + 2, ["summary"])).not.toBeNull();
    expect(stretchEvidence(a, a.at.summaryFirst!, a.at.summaryLast! + 1, ["summary"])).not.toBeNull();
  });

  it("keeps two summaries back to back as two stubs, each named by its label", () => {
    const a = article([
      ["exec", block("Executive summary", "heading", 2)],
      ["execLast", block(prose(1250))],
      ["key", block("Key points", "heading", 2)],
      ["keyLast", block(prose(1251))],
    ]);
    const u = combineMatter(a, { held: [] }, matterByLabels(a, new Set()), new Set());
    const s = u.stretches.filter((x) => x.kinds.includes("summary"));
    expect(s.map((x) => span(a, x))).toEqual([[a.at.exec, a.at.execLast], [a.at.key, a.at.keyLast]]);
    expect(s.map((x) => stubLabel(x.kinds, a.blocks[span(a, x)[0]!]!.text))).toEqual(["Executive summary", "Key points"]);
  });

  it("does not join a one-line neighbour into it", () => {
    const a = article([
      ["summaryLabel", block("Significance", "heading", 2)],
      ["summaryLast", block(prose(1200))],
      ["keywords", block("Keywords: astrocytes, aging")],
      [null, block("Abstract", "heading", 2)],
      [null, block(prose(1201))],
    ]);
    const labels = matterByLabels(a, new Set());
    const u = combineMatter(a, { held: [] }, labels, new Set());
    const s = u.stretches.find((x) => x.kinds.includes("summary"))!;
    expect(s.kinds).toEqual(["summary"]);
    expect(span(a, s)).toEqual([a.at.summaryLabel, a.at.summaryLast]);
  });
});
