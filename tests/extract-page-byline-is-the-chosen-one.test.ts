/**
 * The line under the title in stage 2's page names the same people as
 * `meta.byline`. It used to print Readability's own guess, which on a LaTeXML
 * page (arXiv's HTML) was a cited author or the word "and" while `meta.byline`
 * held the paper's authors.
 * docs/investigations/261005e-arxiv-html-rendering-against-its-pdf-through-our-pipeline.md
 */
import { describe, expect, it } from "vitest";

import { runExtract } from "../src/extract.js";

const PROSE = Array.from(
  { length: 12 },
  (_, i) =>
    `<div class="ltx_para"><p class="ltx_p">Paragraph ${i} of the paper says something long enough for the reader to count it as prose, about glueballs and form factors and how they are measured.</p></div>`,
).join("\n");

const PAGE = `<!doctype html><html lang="en"><head><title>A paper about glueballs</title></head><body>
<article class="ltx_document">
<h1 class="ltx_title ltx_title_document">A paper about glueballs</h1>
<div class="ltx_authors">
<span class="ltx_creator ltx_role_author"><span class="ltx_personname">Ada Lovelace</span><span class="ltx_author_notes"><span class="ltx_contact ltx_role_affiliation">Departamento de Fisica, Centro de Ciencias Fisicas e Matematicas, Universidade Federal de Santa Catarina, Florianopolis, Brazil, and the Laboratory of Theoretical Physics</span></span></span>
<span class="ltx_author_before">and</span>
<span class="ltx_creator ltx_role_author"><span class="ltx_personname">Grace Hopper</span></span>
</div>
<section class="ltx_section"><h2 class="ltx_title ltx_title_section">1 Introduction</h2>
${PROSE}
</section>
<section class="ltx_bibliography"><h2 class="ltx_title ltx_title_bibliography">References</h2>
<ul class="ltx_biblist"><li class="ltx_bibitem"><span class="ltx_bibblock"><span class="ltx_text ltx_bib_author">L. F. Abbott</span> (1982) Introduction to the background field method.</span></li></ul>
</section>
</article></body></html>`;

describe("the byline line in stage 2's page", () => {
  it("names the authors meta.byline names", async () => {
    const out = await runExtract({ html: PAGE, url: "https://arxiv.org/html/2610.01988v1", slug: "glueballs" });
    expect(out.meta.byline).toContain("Ada Lovelace");
    expect(out.meta.byline).toContain("Grace Hopper");
    const line = /<div class="meta">([\s\S]*?)<\/div>/.exec(out.extractedHtml)?.[1] ?? "";
    expect(line).toContain("Ada Lovelace");
    expect(line).toContain("Grace Hopper");
    expect(line).not.toContain("Abbott");
  });
});
