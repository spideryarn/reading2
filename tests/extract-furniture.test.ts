/**
 * Stage 2 deletes one narrow class of platform-generated control before
 * Readability sees the page, and **the whole value of the rule is in what it
 * declines.**
 *
 * The class, the licence Greg spent on it and the reasoning are on
 * `removePlatformFurniture` in src/furniture.ts and in
 * docs/plans/260904e-extraction-repair-evals-and-llm-post-processing.md § C4.
 * What is pinned here is the guard, because a delete that takes an author's
 * sentence with it is invisible: nothing downstream throws, the article is
 * simply shorter, and the natural check — "did the `[edit]` links go?" — says
 * yes either way.
 *
 * So the negatives below outnumber the positives roughly three to one, and each
 * one is a page shape where the *same class name* means something else. They
 * were written against a deliberately unguarded version of the recogniser and
 * watched to go red before the guard existed; a guard that stops mattering
 * would turn them green-by-vacuity, which is why every negative also asserts
 * that the element it protects is still *findable*, not merely that nothing
 * crashed.
 *
 * `acx.html` is the free adversary at the bottom: 133,669 characters of real
 * essay carrying none of this markup, byte-identical after the pass. It proves
 * one thing and not more — that today's rules do not fire on a page that merely
 * *reads* like one — and it could not prove a text-reading rule safe in general,
 * only that it is not tripped by anything ACX happens to say. ⟨Sol, 2026-09-06,
 * correcting an earlier version of this sentence.⟩
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM, VirtualConsole } from "jsdom";
import { describe, expect, it } from "vitest";
import { removePlatformFurniture } from "../src/furniture.js";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "../evals/extraction/fixtures");

const doc = (html: string): Document =>
  new JSDOM(`<body>${html}</body>`, { virtualConsole: new VirtualConsole() }).window.document;

/** Run the recogniser and hand back both the counts and the document it left. */
function run(html: string): { removed: Record<string, number>; d: Document; body: string } {
  const d = doc(html);
  const removed = removePlatformFurniture(d) as Record<string, number>;
  return { removed, d, body: d.body.innerHTML };
}

describe("removePlatformFurniture — the class that may be deleted", () => {
  it("takes MediaWiki's [edit] span out of a heading and leaves the heading", () => {
    const { removed, d } = run(
      '<div class="mw-heading mw-heading2"><h2 id="History">History</h2>' +
        '<span class="mw-editsection"><span class="mw-editsection-bracket">[</span>' +
        '<a href="/w/index.php?title=X&amp;action=edit&amp;section=1"><span>edit</span></a>' +
        '<span class="mw-editsection-bracket">]</span></span></div>',
    );
    expect(removed).toEqual({ "span.mw-editsection": 1 });
    expect(d.querySelector("h2")?.textContent).toBe("History");
  });

  it("takes MediaWiki's empty-element marker", () => {
    const { removed, d } = run(
      '<p>Body.</p><span class="mw-empty-elt"><link rel="mw:PageProp/Category" href="./Category:X"></span>',
    );
    expect(removed).toEqual({ ".mw-empty-elt": 1 });
    expect(d.querySelectorAll(".mw-empty-elt")).toHaveLength(0);
    expect(d.querySelector("p")?.textContent).toBe("Body.");
  });

  it("takes Sphinx's permalink anchor and leaves the heading's words", () => {
    const { removed, d } = run(
      '<h1 id="itertool-functions">Itertool Functions' +
        '<a class="headerlink" href="#itertool-functions" title="Link to this heading">¶</a></h1>',
    );
    expect(removed).toEqual({ "a.headerlink": 1 });
    expect(d.querySelector("h1")?.textContent).toBe("Itertool Functions");
  });

  it("takes PLOS's reference buttons and leaves the citation they sit under", () => {
    const { removed, d } = run(
      "<ol><li>Collins FS, Tabak LA (2014) NIH plans to enhance reproducibility. Nature 505: 612–613." +
        '<ul class="reflinks"><li><a href="#" target="_new">View Article</a></li>' +
        '<li><a href="#" target="_new">PubMed/NCBI</a></li>' +
        '<li><a href="#" target="_new">Google Scholar</a></li></ul></li></ol>',
    );
    expect(removed).toEqual({ "ul.reflinks": 1 });
    expect(d.querySelector("ol > li")?.textContent).toContain(
      "Collins FS, Tabak LA (2014) NIH plans to enhance reproducibility. Nature 505: 612–613.",
    );
    expect(d.querySelector("ol > li")?.textContent).not.toContain("View Article");
  });

  it("counts per selector, and says nothing about a selector that matched nothing", () => {
    const { removed } = run(
      '<div class="mw-heading"><h2>A</h2><span class="mw-editsection">' +
        '<a href="/w/index.php?action=edit">edit</a></span></div>' +
        '<div class="mw-heading"><h2>B</h2><span class="mw-editsection">' +
        '<a href="/w/index.php?action=edit">edit</a></span></div>' +
        '<h2 id="c">C<a class="headerlink" href="#c">¶</a></h2>',
    );
    expect(removed).toEqual({ "span.mw-editsection": 2, "a.headerlink": 1 });
  });
});

/**
 * **The negatives.** Every one of these is markup a real publisher writes where
 * the class name does not mean what the rule assumes, and every one must come
 * out of the recogniser untouched.
 */
describe("removePlatformFurniture — what it must decline", () => {
  /**
   * **The four shapes GPT Sol reproduced on 2026-09-06**, each of which the
   * guard as originally specified deleted. `querySelector` asks about
   * *descendants*, so the matched element's own tag and its own direct text were
   * never checked at all; and a fragment href is not enough to tell a permalink
   * from a link somebody wrote a sentence into.
   */
  it("declines a paragraph that calls itself .mw-editsection — the element's own tag counts", () => {
    const { removed, d } = run('<p class="mw-editsection">An author paragraph about editing sections.</p>');
    expect(removed).toEqual({});
    expect(d.querySelector("p.mw-editsection")?.textContent).toContain("An author paragraph");
  });

  it("declines a table row that calls itself .mw-editsection — cells are not in the block list", () => {
    const { removed, d } = run(
      '<table><tbody><tr class="mw-editsection"><td>China</td><td>19,373,586</td></tr></tbody></table>',
    );
    expect(removed).toEqual({});
    expect(d.querySelector("tr.mw-editsection")?.textContent).toContain("19,373,586");
  });

  it("declines an a.headerlink in running prose — a permalink hangs off a heading", () => {
    const { removed, d } = run(
      '<p>See <a class="headerlink" href="#methods">the methods and their caveats</a>.</p>',
    );
    expect(removed).toEqual({});
    expect(d.querySelector("a.headerlink")?.textContent).toBe("the methods and their caveats");
  });

  it("declines a ul.reflinks that is the whole of its item — a control strip sits beside content", () => {
    const { removed, d } = run(
      '<ul class="reflinks"><li><a href="/paper">Smith J (2020), the paper\'s whole title</a></li></ul>',
    );
    expect(removed).toEqual({});
    expect(d.querySelector("ul.reflinks")?.textContent).toContain("the paper's whole title");
  });

  it("declines a nested ul.reflinks whose item carries nothing else", () => {
    const { removed, d } = run(
      '<ol><li><ul class="reflinks"><li><a href="/paper">Smith J (2020), a wholly linked citation</a></li></ul></li></ol>',
    );
    expect(removed).toEqual({});
    expect(d.querySelector("ul.reflinks")?.textContent).toContain("a wholly linked citation");
  });

  /**
   * **The second round, 2026-09-06.** Restricting `.mw-editsection` to a `<span>`
   * and `a.headerlink` to a heading closed the shapes Sol built first and left
   * the *reason* they worked: the guards proved where an element sits, never
   * what it is for. Each of these is that gap, and each is measured against what
   * the corpus actually contains rather than guessed at.
   */
  it("declines a .mw-editsection span used inline in a sentence", () => {
    const { removed, d } = run(
      '<p>The <span class="mw-editsection">author’s own analysis</span> matters here.</p>',
    );
    expect(removed).toEqual({});
    expect(d.querySelector("p")?.textContent).toContain("author’s own analysis");
  });

  it("declines a .mw-editsection span in a heading wrapper that links nowhere near an edit form", () => {
    const { removed, d } = run(
      '<div class="mw-heading"><h2>History</h2><span class="mw-editsection">' +
        '<a href="/donate">Support this article</a></span></div>',
    );
    expect(removed).toEqual({});
    expect(d.querySelector("span.mw-editsection")?.textContent).toBe("Support this article");
  });

  it("declines an a.headerlink that points somewhere other than its own heading", () => {
    const { removed, d } = run(
      '<h2 id="overview">Overview — see <a class="headerlink" href="#methods">methods and caveats</a></h2>',
    );
    expect(removed).toEqual({});
    expect(d.querySelector("a.headerlink")?.textContent).toBe("methods and caveats");
  });

  it("takes an a.headerlink that points at the section its heading opens — Sphinx does this", () => {
    const { removed, d } = run(
      '<section id="module-itertools"><h1>itertools<a class="headerlink" href="#module-itertools">¶</a></h1></section>',
    );
    expect(removed).toEqual({ "a.headerlink": 1 });
    expect(d.querySelector("h1")?.textContent).toBe("itertools");
  });

  it("declines a ul.reflinks beside nothing but an ordinal — a label is not a citation", () => {
    const { removed, d } = run(
      '<ol><li id="ref1"><span class="label">1.</span>' +
        '<ul class="reflinks"><li><a href="/paper">Smith J, the complete paper title</a></li></ul></li></ol>',
    );
    expect(removed).toEqual({});
    expect(d.querySelector("ul.reflinks")?.textContent).toContain("the complete paper title");
  });

  it("declines a .mw-empty-elt carrying a title or an aria-labelledby", () => {
    expect(run('<span class="mw-empty-elt" title="Correction details"></span>').removed).toEqual({});
    expect(run('<span class="mw-empty-elt" aria-labelledby="diagram-label"></span>').removed).toEqual({});
  });

  it("declines a .mw-empty-elt that IS an image — the matched element is not a descendant of itself", () => {
    const { removed, d } = run('<img class="mw-empty-elt" src="chart.png" alt="A chart of the results">');
    expect(removed).toEqual({});
    expect(d.querySelector("img.mw-empty-elt")).not.toBeNull();
  });

  it("declines a .mw-empty-elt whose only content is an accessible name", () => {
    const { removed, d } = run('<span class="mw-empty-elt" role="img" aria-label="A diagram of the model"></span>');
    expect(removed).toEqual({});
    expect(d.querySelector(".mw-empty-elt")?.getAttribute("aria-label")).toBe("A diagram of the model");
  });

  it("declines a .mw-editsection-classed div that wraps a paragraph", () => {
    const { removed, d } = run(
      '<div class="mw-editsection"><p>An editor writing about the editing of sections.</p></div>',
    );
    expect(removed).toEqual({});
    expect(d.querySelector("div.mw-editsection > p")?.textContent).toBe(
      "An editor writing about the editing of sections.",
    );
  });

  it("declines a ul.reflinks whose li holds citation text as well as a link", () => {
    const { removed, d } = run(
      '<ul class="reflinks"><li><a href="#">View Article</a></li>' +
        '<li>Smith J (2019) A paper with its own words. Journal 1: 2–3. <a href="#">doi</a></li></ul>',
    );
    expect(removed).toEqual({});
    expect(d.querySelector("ul.reflinks")?.textContent).toContain(
      "Smith J (2019) A paper with its own words.",
    );
  });

  it("declines a ul.reflinks whose li wraps its link in a paragraph", () => {
    const { removed, d } = run('<ul class="reflinks"><li><p><a href="#">View Article</a></p></li></ul>');
    expect(removed).toEqual({});
    expect(d.querySelector("ul.reflinks p")).not.toBeNull();
  });

  /**
   * `el.children` skips text nodes, so a check written only over the `<li>`s
   * would have deleted this sentence and reported a success.
   */
  it("declines a ul.reflinks carrying loose text of its own, outside any li", () => {
    const { removed, d } = run(
      '<ul class="reflinks">Smith J (2019) A paper with its own words.<li><a href="#">View Article</a></li></ul>',
    );
    expect(removed).toEqual({});
    expect(d.querySelector("ul.reflinks")?.textContent).toContain("A paper with its own words.");
  });

  it("declines a ul.reflinks whose li carries two links — the shape is one bare link or nothing", () => {
    const { removed, d } = run(
      '<ul class="reflinks"><li><a href="#">Half a</a> <a href="#">sentence</a></li></ul>',
    );
    expect(removed).toEqual({});
    expect(d.querySelector("ul.reflinks")).not.toBeNull();
  });

  /**
   * The `<tr>` found in `wiki_gdp_table.html` on 2026-09-06 is why this test
   * exists. MediaWiki writes `class="mw-empty-elt"` on a genuinely empty table
   * row, and `td` is not in the block-descendant list — so the guard the plan
   * specified would have accepted a row full of real cells and deleted it, out
   * of the one table this whole plan is trying to rescue. The extra guard is
   * the class name read literally: *empty* means empty.
   */
  it("declines a .mw-empty-elt table row that is not empty — the GDP-table hole", () => {
    const { removed, d } = run(
      '<table><tbody><tr class="mw-empty-elt"><td>China</td><td>19,373,586</td></tr></tbody></table>',
    );
    expect(removed).toEqual({});
    expect(d.querySelector("tr.mw-empty-elt")?.textContent).toContain("19,373,586");
  });

  /** `textContent` is blank for a picture, so emptiness has to be asked twice. */
  it("declines a .mw-empty-elt holding an image, which has no text to be empty of", () => {
    const { removed, d } = run('<span class="mw-empty-elt"><img src="diagram.png" alt="The architecture"></span>');
    expect(removed).toEqual({});
    expect(d.querySelector(".mw-empty-elt img")).not.toBeNull();
  });

  it("declines a .mw-empty-elt that carries words", () => {
    const { removed, d } = run('<span class="mw-empty-elt">This element is not, in fact, empty.</span>');
    expect(removed).toEqual({});
    expect(d.querySelector(".mw-empty-elt")?.textContent).toContain("not, in fact, empty");
  });

  it("declines an a.headerlink that leaves the page — a permalink points at itself", () => {
    const { removed, d } = run(
      '<p>See <a class="headerlink" href="https://example.com/methods">the full methodology</a>.</p>',
    );
    expect(removed).toEqual({});
    expect(d.querySelector("a.headerlink")?.textContent).toBe("the full methodology");
  });

  it("leaves a <footer> inside a blockquote quoting a webpage — no rule reads a tag name", () => {
    const { removed, d } = run(
      "<blockquote><p>The quoted claim.</p><footer>— Someone, <cite>Their Site</cite></footer></blockquote>",
    );
    expect(removed).toEqual({});
    expect(d.querySelector("blockquote footer")?.textContent).toContain("Someone");
  });

  it("leaves a misused role=doc-endnotes alone — no rule reads a role", () => {
    const { removed, d } = run(
      '<section role="doc-endnotes"><p>Actually the closing argument of the piece.</p></section>',
    );
    expect(removed).toEqual({});
    expect(d.querySelector('[role="doc-endnotes"] p')?.textContent).toContain("closing argument");
  });

  /**
   * `.ambox` and `.navbox` are the line C4 draws. They *say something* — a
   * publisher's statement about the piece — and stay for stage D to classify.
   * They are also the adversary the plan already names: a navbox-classed real
   * table.
   */
  it("leaves .ambox maintenance banners and .navbox navigation alone", () => {
    const { removed, d } = run(
      '<table class="ambox"><tbody><tr><td>This article needs additional citations.</td></tr></tbody></table>' +
        '<table class="navbox"><tbody><tr><td>Related topics</td></tr></tbody></table>',
    );
    expect(removed).toEqual({});
    expect(d.querySelectorAll("table")).toHaveLength(2);
    expect(d.querySelector(".ambox")?.textContent).toContain("needs additional citations");
  });

  it("leaves a nested match alone when its ancestor was declined", () => {
    const { removed, d } = run(
      '<div class="mw-editsection"><p>Prose.<span class="mw-empty-elt"></span></p></div>',
    );
    /* The inner span is genuinely empty and would go on its own; what must not
       happen is the outer div going with it. */
    expect(removed).toEqual({ ".mw-empty-elt": 1 });
    expect(d.querySelector("div.mw-editsection > p")?.textContent).toBe("Prose.");
  });
});

/**
 * The heading wrapper MediaWiki builds to hold a heading and its edit link, and
 * what happens to it once the edit link is gone. See
 * `hoistEmptiedHeadingWrapper` — this is not tidiness, it is the difference
 * between 1 empty block on `wiki_transformer.html` and 95.
 */
describe("removePlatformFurniture — MediaWiki's emptied heading wrapper", () => {
  it("hands the heading up and drops the wrapper the edit link was the rest of", () => {
    const { removed, d } = run(
      '<section><div class="mw-heading mw-heading2"><h2 id="History">History</h2>' +
        '<span class="mw-editsection"><a href="/w/index.php?action=edit">edit</a></span></div>' +
        "<p>Body.</p></section>",
    );
    expect(removed).toEqual({ "span.mw-editsection": 1 });
    expect(d.querySelector("div.mw-heading")).toBeNull();
    expect(d.querySelector("section > h2")?.textContent).toBe("History");
    expect(d.querySelector("section > h2")?.id).toBe("History");
  });

  it("leaves a wrapper that still holds something besides its heading", () => {
    const { removed, d } = run(
      '<div class="mw-heading"><h2>History</h2><p>A note under the heading.</p>' +
        '<span class="mw-editsection"><a href="/w/index.php?action=edit">edit</a></span></div>',
    );
    expect(removed).toEqual({ "span.mw-editsection": 1 });
    expect(d.querySelector("div.mw-heading > p")?.textContent).toBe("A note under the heading.");
  });

  it("leaves a wrapper carrying words of its own beside the heading", () => {
    const { removed, d } = run(
      '<div class="mw-heading"><h2>History</h2> — and a stray sentence.' +
        '<span class="mw-editsection"><a href="/w/index.php?action=edit">edit</a></span></div>',
    );
    expect(removed).toEqual({ "span.mw-editsection": 1 });
    expect(d.querySelector("div.mw-heading")?.textContent).toContain("a stray sentence");
  });

  it("does not unwrap an ordinary div that happens to be left holding one heading", () => {
    const { removed, d } = run(
      '<div class="admonition"><h2>Note</h2><span class="mw-editsection">' +
        '<a href="/w/index.php?action=edit">edit</a></span></div>',
    );
    expect(removed).toEqual({});
    expect(d.querySelector("div.admonition > h2")?.textContent).toBe("Note");
  });

  /**
   * The wrapper carries `class` and nothing else on all 103 in the corpus, and
   * `replaceWith` throws away everything a wrapper has. Sol's example, 2026-09-06:
   * `<div class="mw-heading admonition" id="topic" lang="ar" dir="rtl">` loses
   * its fragment target, its language, its direction and — confirmed by running
   * the callout pass afterwards — its classification as a callout.
   */
  it("declines to unwrap a heading wrapper carrying anything but MediaWiki's own classes", () => {
    const { removed, d } = run(
      '<div class="mw-heading admonition" id="topic" lang="ar" dir="rtl"><h2>Important note</h2>' +
        '<span class="mw-editsection"><a href="/w/index.php?action=edit">edit</a></span></div>',
    );
    expect(removed).toEqual({ "span.mw-editsection": 1 });
    const wrapper = d.querySelector("div.mw-heading");
    expect(wrapper).not.toBeNull();
    expect(wrapper?.id).toBe("topic");
    expect(wrapper?.getAttribute("lang")).toBe("ar");
    expect(wrapper?.classList.contains("admonition")).toBe(true);
  });
});

describe("removePlatformFurniture — on real pages", () => {
  /**
   * The free adversary, found 2026-09-06: `acx.html` uses the phrase *"just a
   * moment"* twice in ordinary prose, and carries none of this markup. A rule
   * that ever reads words instead of class names reddens here.
   */
  it("changes nothing at all on acx.html, a 133k-character essay with none of this markup", async () => {
    const html = await readFile(path.join(FIXTURES, "acx.html"), "utf-8");
    const d = new JSDOM(html, {
      url: "https://www.astralcodexten.com/",
      virtualConsole: new VirtualConsole(),
    }).window.document;
    const before = d.documentElement.outerHTML;
    expect(removePlatformFurniture(d)).toEqual({});
    expect(d.documentElement.outerHTML).toBe(before);
  });

  /**
   * **The test that is easy to leave out and is the one that matters.** A rule
   * that deleted the reference list along with its buttons would look exactly
   * like a success: the `View Article` chrome is gone and the article is
   * shorter. These two citation strings are what separates the two outcomes.
   */
  it("keeps PLOS's citations while its reference buttons go", async () => {
    const html = await readFile(path.join(FIXTURES, "plos_biology.html"), "utf-8");
    const d = new JSDOM(html, {
      url: "https://journals.plos.org/plosbiology/article?id=10.1371/journal.pbio.1002165",
      virtualConsole: new VirtualConsole(),
    }).window.document;
    expect(removePlatformFurniture(d)).toEqual({ "ul.reflinks": 26 });
    const text = d.body.textContent ?? "";
    expect(text).toContain("Collins FS, Tabak LA (2014) NIH plans to enhance reproducibility");
    expect(text).toContain("Landis SC, Amara SG, Asadullah K, Austin CP, Blumenstein R");
    expect(text).not.toContain("View Article");
  });
});
