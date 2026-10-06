/**
 * **A rescued table in the middle of a list item — the fallback's false loss.**
 *
 * Rule A of src/protect.ts rescued these tables all along, and the fallback took
 * the rescue back. The four summary tables in the introduction of arXiv
 * 2610.01658v1 (and six in its appendix) each sit inside an `<li>`. LaTeXML
 * classes them `ltx_guessed_headers`, Readability deletes them on
 * `unlikelyCandidates` (Readability.js:1119) — rule A's own branch — and rule A
 * stamps all ten. But the six appendix items carry on after their table, so the
 * control's run is *"words before, words after"* and the treatment's is *"words
 * before, the table's cells, words after"*: not a substring, read as six lost
 * runs, and the control shipped with no tables. `kept` said
 * `a-table-called-header-rolled-back`.
 *
 * A run is now also retained when it is whole in the treatment **once the
 * treatment's tables are taken out** (`proseRetention`). The disaster the
 * fallback exists for is untouched: there the table has been flattened into a
 * `<div>` and the prose is in neither reading. Both are here.
 *
 * The fixtures are the two real lists, cut from the page
 * (tests/fixtures/latexml/). The rest of the fallback's tests are in
 * tests/extract-protect.test.ts.
 * docs/plans/261005l-an-arxiv-link-of-any-shape-imports-the-paper-and-a-source-resolver-other-sources-can-join.md § fix 4.
 */
import { readFileSync } from "node:fs";
import { JSDOM, VirtualConsole } from "jsdom";
import { beforeAll, describe, expect, it } from "vitest";

import { runExtract } from "../src/extract.js";
import { loadMathsRenderer } from "../src/maths-server.js";
import { RULES, proseRetention, protectionIsDisabled, withProtectionDisabled } from "../src/protect.js";

beforeAll(loadMathsRenderer);

const dom = (html: string): Document => new JSDOM(html, { virtualConsole: new VirtualConsole() }).window.document;
const body = (html: string) => dom(`<!doctype html><html><body>${html}</body></html>`).body;
const fx = (name: string) => readFileSync(new URL(`./fixtures/latexml/${name}.html`, import.meta.url), "utf8");

const long = (n: number) =>
  `Sentence ${n} of the committee's report, which runs on for long enough to be prose rather ` +
  `than a label, and says nothing anybody will remember.`;

const PROSE = (n: number) =>
  `LIST-PROSE-${n}. The committee met in Braemar on a wet Tuesday and spent the whole morning arguing ` +
  `about the figures below, which nobody had checked and everybody had quoted, and the argument turned ` +
  `on whether the ${n}th column was measured in the same year as the first. It was not.`;
const proseCount = (html: string) => (html.match(/LIST-PROSE-\d/g) ?? []).length;

describe("a rescued table in the middle of a list item", { timeout: 120_000 }, () => {
  it("proseRetention: a run a table interrupts is retained; a run that is gone is not", () => {
    const TABLE = `<table><tr><th>Basis</th><th>Convergence</th></tr><tr><td>T.U.</td><td>Quenched</td></tr></table>`;
    const control = body(`<ol><li><p>${long(1)}</p> ${long(2)}</li></ol>`);
    /* RED before the fix: `{ runs: 2, lost: 1, retained: false }`. */
    expect(proseRetention(control, body(`<ol><li><p>${long(1)}</p>${TABLE} ${long(2)}</li></ol>`))).toEqual({
      runs: 2,
      lost: 0,
      retained: true,
    });
    /* The words after the table really gone: still lost. */
    expect(proseRetention(control, body(`<ol><li><p>${long(1)}</p>${TABLE}</li></ol>`))).toEqual({
      runs: 2,
      lost: 1,
      retained: false,
    });
    /* The table flattened into `<div>`s, which is what winning candidacy does to
       it: its cells are then text in the way, and the run is still lost. */
    const flattened = TABLE.replace(/<(\/?)(?:table|tr|th|td)>/g, "<$1div>");
    expect(flattened).not.toContain("<table");
    expect(proseRetention(control, body(`<ol><li><p>${long(1)}</p>${flattened} ${long(2)}</li></ol>`)).retained).toBe(false);
    /* Words that are gone from the prose and partly inside a table are not
       found by taking the tables out. */
    const inCell = `<table><tr><td>${long(2).slice(0, 60)}</td></tr></table>`;
    expect(proseRetention(control, body(`<ol><li><p>${long(1)}</p>${inCell}</li></ol>`)).retained).toBe(false);
  });

  const para = (n: number) => `<div class="ltx_para"><p class="ltx_p">${PROSE(n)}</p></div>`;
  const paper = (lists: string) =>
    `<!doctype html><html lang="en"><head><title>Are random random walks normal?</title></head><body>
<article class="ltx_document"><h1 class="ltx_title ltx_title_document">Are random random walks normal?</h1>
<section class="ltx_section"><h2 class="ltx_title ltx_title_section">1. Introduction</h2>${[1, 2, 3, 4].map(para).join("")}
${lists}${[5, 6, 7, 8].map(para).join("")}</section></article></body></html>`;

  it("the introduction and appendix of 2610.01658v1: ten tables rescued, and the rescue stands", async () => {
    const html = paper(fx("list-item-tables") + fx("list-item-tables-appendix"));
    const run = () => runExtract({ html, url: "https://arxiv.org/html/2610.01658v1", slug: "list-tables" });
    const on = await run();
    const off = await withProtectionDisabled(run);
    expect(protectionIsDisabled()).toBe(false);
    /* Without the pass Readability deletes all ten: this is rule A's branch. */
    expect(dom(off.extractedHtml).querySelectorAll("table")).toHaveLength(0);
    expect(off.extractedHtml).not.toContain("Quenched");
    expect(proseCount(off.extractedHtml)).toBe(8);
    /* RED before the fix: `{ "a-table-called-header-rolled-back": 10 }`, no tables. */
    expect(on.kept).toEqual({ [RULES.headerNamedTable]: 10 });
    const doc = dom(on.extractedHtml);
    expect(doc.querySelectorAll("table")).toHaveLength(10);
    expect(doc.querySelectorAll("li table")).toHaveLength(10);
    expect(on.extractedHtml.match(/Quenched/g)).toHaveLength(3);
    /* And every paragraph round them is still there. */
    expect(proseCount(on.extractedHtml)).toBe(8);
    expect(on.extractedHtml).toContain("This corresponds to the totally unordered case.");
  });

  it("still rolls back when a table inside a list item would cost the page its prose", async () => {
    const cell = (i: number, c: number) =>
      `Reported figure for region ${i + 1}, column ${c}, as revised by the clerk in March ${1990 + (i % 30)}`;
    const rows = Array.from(
      { length: 40 },
      (_, i) => `<tr><td>${cell(i, 1)}</td><td>${cell(i, 2)}</td><td>${cell(i, 3)}</td><td>${cell(i, 4)}</td></tr>`,
    ).join("");
    const p = (n: number) => `<p>${PROSE(n)}</p>`;
    const html = `<!doctype html><html><head><title>The Braemar figures</title></head><body><div id="wrapper">
<h1>The Braemar figures</h1>${p(1)}${p(2)}
<ol><li>${p(3)}<table class="ltx_tabular ltx_guessed_headers"><tr><th>Region</th><th>1994</th><th>1995</th><th>Note</th></tr>${rows}</table>
The item carries on after its table, at length, so that its words stand either side of the rescue and the committee can be seen to have gone on arguing well past the last row.</li></ol>
${p(4)}${p(5)}</div></body></html>`;
    const run = () => runExtract({ html, url: "https://example.invalid/adv", slug: "adv" });
    const stamped = await run();
    const control = await withProtectionDisabled(run);
    expect(proseCount(control.extractedHtml)).toBe(5);
    expect(dom(control.extractedHtml).querySelectorAll("table")).toHaveLength(0);
    /* The rescued table wins the page: the stamp is taken back and the control ships. */
    expect(stamped.kept).toEqual({ [RULES.headerNamedTableRolledBack]: 1 });
    expect(proseCount(stamped.extractedHtml)).toBe(5);
    expect(stamped.length).toBe(control.length);
  });
});
