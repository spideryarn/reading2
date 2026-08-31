/**
 * Stage 2's debug page must not be a loaded gun either.
 *
 * `npm run extract -- <url>` writes `output/<slug>.html` and the next thing a
 * person does is open it in a browser. That file used to come straight from
 * Readability, so everything docs/project/security.md says about stage 3
 * applied to it and nothing had been done about it. The window is only between
 * stage 2 and stage 3 — stage 3 rewrites the same file with clean HTML — but
 * "run extract, then eyeball the HTML" is the whole point of the file.
 *
 * **The debug page has four holes, not one.** The known one is the article body.
 * The other three are the metadata, which is interpolated into the template as
 * raw markup: the title into `<title>` and `<h1>`, the byline and site name into
 * a `<div>`, and the language into an *attribute* on `<html>`. Readability hands
 * all four back as strings it took the textContent of, which reads as safe and
 * is not — a title of `Real&lt;/title&gt;&lt;img …&gt;` decodes to
 * `Real</title><img …>` and closes our element for us.
 *
 * Every payload below is checked against real Readability output first, in the
 * "still gets through Readability" block. Without that, this file would go green
 * the day Readability started stripping one of them — proving nothing, and
 * looking exactly like a passing test.
 */
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import { beforeAll, describe, expect, it } from "vitest";
import { runExtract } from "../src/extract.js";
import { splitIntoBlocks } from "../src/blocks.js";
import { sanitizeHtml } from "../src/sanitize.js";

/**
 * Readability throws a page away unless there is enough of it, so the payloads
 * have to sit in a real article. Eight paragraphs either side is comfortably
 * over the threshold.
 */
const prose = (n: number) =>
  Array.from(
    { length: n },
    (_, i) =>
      `<p>Paragraph ${i} of ordinary prose, long enough that Readability keeps this article rather than deciding the page is a navigation shell with nothing in it. It carries on for a sentence or two more.</p>`,
  ).join("\n");

/* The markers are what the assertions look for. Each is unique, so a failure
   names the hole rather than saying "something executable is in there". */
const PAGE = `<!doctype html>
<html lang='en" onmouseover="alert(1)'>
<head>
<title>Real&lt;/title&gt;&lt;img src=x onerror=alert("TITLEPAYLOAD")&gt;</title>
<meta name="author" content="Ann Author&quot;&gt;&lt;img src=x onerror=alert('BYLINEPAYLOAD')&gt;">
</head>
<body><article>
${prose(8)}
<p>a <img src="/nope.png" onerror="alert('IMGPAYLOAD')"> b</p>
<p>a <span onmouseover="alert('SPANPAYLOAD')">x</span> b</p>
<p><iframe src="https://www.youtube.com.evil.test/embed/x"></iframe></p>
<p><iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe></p>
<p><a href="https://ok.example/the-real-link">a real link, which must survive</a></p>
${prose(8)}
</article></body></html>`;

const SOURCE = "https://source.example/a";

/**
 * **The assertions parse the page rather than grepping it**, and that is the
 * whole design of this file.
 *
 * Escaping is the fix for three of the four holes, and escaping *keeps the
 * words*: the written page contains the text `onmouseover="alert(1)"` inside a
 * `lang` attribute value, and `<img …onerror…>` inside the byline's text. Both
 * are inert — they are one attribute value and one text node — and both make a
 * regex over the source say "executable". A grep-based test here would be red
 * on a correct fix and would then be "fixed" by weakening it.
 *
 * So the question asked is the one that matters: build the document the way a
 * browser will, and ask what is in it.
 */
const executableAttrs = (doc: Document): string[] =>
  Array.from(doc.querySelectorAll("*")).flatMap((el) =>
    Array.from(el.attributes)
      .filter((a) => /^on/i.test(a.name) || /^\s*(javascript|vbscript):/i.test(a.value))
      .map((a) => `<${el.tagName.toLowerCase()} ${a.name}>`),
  );

let page: string;
let doc: Document;

beforeAll(async () => {
  /* **`result.extractedHtml`, not a file.** Stage 2 returns the page now, so
     there is no temp directory here at all — and the thing under test is the
     same string either way: `debugPage`'s output IS the extractedHtml artefact
     (src/extract.ts ExtractResult). */
  page = (await runExtract({ html: PAGE, url: SOURCE, slug: "hostile" })).extractedHtml;
  doc = new JSDOM(page).window.document;
});

describe("what still gets through Readability", () => {
  /* The positive controls. Each asserts the hole is real *in Readability's own
     output*, so the assertions further down are measuring the fix rather than
     measuring Readability's mood. */
  const article = () => {
    const parsed = new Readability(new JSDOM(PAGE, { url: SOURCE }).window.document).parse();
    if (!parsed) throw new Error("Readability rejected the fixture — rewrite it, not the test");
    return parsed;
  };

  it("leaves handlers in the article body", () => {
    const content = article().content ?? "";
    expect(content, "Readability now strips these — the body test below proves nothing").toContain(
      "IMGPAYLOAD",
    );
    expect(content).toContain("SPANPAYLOAD");
    // Not a bare hostile host — Readability drops those. A *lookalike*
    // survives, because its embed test is a substring one, which is precisely
    // the case docs/project/security.md says the origin check exists for.
    expect(content).toContain("youtube.com.evil.test");
  });

  it("hands back a title that closes its own element", () => {
    // The entities decode, so what Readability calls text is markup again the
    // moment it is written into a template.
    expect(article().title).toContain("</title>");
    expect(article().title).toContain("TITLEPAYLOAD");
  });

  it("hands back a byline that is an img tag", () => {
    expect(article().byline).toContain("BYLINEPAYLOAD");
  });

  it("hands back the page's own lang attribute, quotes and all", () => {
    expect(article().lang).toContain("onmouseover");
  });
});

describe("the debug page stage 2 writes", () => {
  it("builds a document with no handler and no scripting URL in it", () => {
    expect(executableAttrs(doc)).toEqual([]);
    expect(doc.querySelector("script")).toBeNull();
  });

  it("strips the handlers out of the body", () => {
    expect(page).not.toContain("IMGPAYLOAD");
    expect(page).not.toContain("SPANPAYLOAD");
  });

  it("drops a lookalike embed, and keeps the real one", () => {
    const frames = Array.from(doc.querySelectorAll("iframe"));
    expect(frames.map((f) => f.getAttribute("src"))).toEqual([
      "https://www.youtube.com/embed/dQw4w9WgXcQ",
    ]);
    expect(frames[0]?.getAttribute("sandbox")).toBe("allow-scripts allow-same-origin");
    expect(page).not.toContain("evil.test");
  });

  it("does not let the title close its own element", () => {
    // The payload survives as *text*, which is the point of escaping — what
    // must not survive is a second element. `document.title` is the parser's
    // answer to "where did <title> actually end".
    expect(doc.title).toContain("TITLEPAYLOAD");
    expect(doc.head.querySelector("img")).toBeNull();
    expect(doc.querySelector("h1")?.querySelector("*")).toBeNull();
    expect(doc.querySelector("h1")?.textContent).toContain("</title>");
  });

  it("does not let the byline become a tag", () => {
    const meta = doc.querySelector(".meta");
    expect(meta?.textContent).toContain("BYLINEPAYLOAD");
    expect(meta?.querySelector("img")).toBeNull();
  });

  it("does not let the lang attribute grow a handler", () => {
    // The whole hostile string ends up as one attribute value rather than
    // becoming a second attribute — so the parser sees one attribute, not two.
    expect(Array.from(doc.documentElement.attributes, (a) => a.name)).toEqual(["lang"]);
    expect(doc.documentElement.getAttribute("lang")).toContain("onmouseover");
  });

  /* The other half of a security test: prove it did not simply delete the
     article. A page with nothing in it passes every assertion above. */
  it("still contains the article", () => {
    expect(page).toContain("Paragraph 0 of ordinary prose");
    expect(doc.querySelector('a[href="https://ok.example/the-real-link"]')).not.toBeNull();
    expect(doc.querySelector(".meta")?.textContent).toContain("Ann Author");
    expect(doc.querySelectorAll("p").length).toBeGreaterThan(16);
  });

  /* Our own stylesheet lives in the head and the policy forbids `<style>`, so
     sanitising the whole document instead of the body would take the debug
     page's looks with it — and the page would still open, which is how that
     mistake would survive. */
  it("keeps the template's own stylesheet and charset", () => {
    expect(page).toContain('<meta charset="utf-8">');
    expect(page).toMatch(/<style>[\s\S]*max-width: 700px/);
  });
});

describe("what stage 3 makes of it", () => {
  /* Stage 3 reads this same file and sanitises it again before minting ids, so
     a clean stage 2 must be invisible to it. If it is not, stage 2 has changed
     the spine — which is the one thing in this project that may not move. */
  /* Stage 3 sanitises whatever it is handed, so a body stage 2 already cleaned
     and the same body raw must come out as the same blocks. Compared on the
     article body alone rather than on the whole debug page, because the page's
     `<h1>` and byline line legitimately *do* change — that is the metadata fix,
     not a stage-3 regression, and folding the two together would let a real
     change to the spine hide behind an expected one. */
  it("makes the same blocks from a cleaned body as from a raw one", () => {
    const parsed = new Readability(new JSDOM(PAGE, { url: SOURCE }).window.document).parse();
    const raw = parsed?.content ?? "";
    const wrap = (body: string) => `<!doctype html><html><body>${body}</body></html>`;

    const fromRaw = splitIntoBlocks(wrap(raw));
    const fromClean = splitIntoBlocks(wrap(sanitizeHtml(raw)));

    // Ids are minted at random, so two runs never agree on them — that is the
    // design (docs/project/block-ids.md), not drift. Everything else about the
    // markup must match exactly, which is the assertion with content in it.
    const shape = (r: typeof fromRaw) =>
      r.blocks.map((b) => ({ ...b, id: "", html: b.html.replace(/ id="spya-\w+"/g, "") }));

    expect(shape(fromClean)).toEqual(shape(fromRaw));
    expect(fromClean.stats).toEqual(fromRaw.stats);
  });

  it("is a no-op the second time, so the file stops churning", async () => {
    const first = splitIntoBlocks(page);
    const second = splitIntoBlocks(first.html);
    expect(second.html).toBe(first.html);
    expect(second.stats.minted).toBe(0);
  });
});
