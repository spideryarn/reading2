/**
 * **`visibleText` against a real HTML parser, over markup written to break it.**
 *
 * The manifest integrity check needs the text of a fixture, and it needs it in
 * milliseconds: JSDOM over the twelve committed fixtures took **44 seconds and
 * timed out** on this box, so the production path is a hand-written scanner
 * (`evals/extraction/visible-text.mts`) and JSDOM lives here, in the test, where
 * it only ever sees strings a few dozen characters long.
 *
 * ## Why this file exists rather than a note saying it was checked
 *
 * The scanner's predecessor was five regexes, and the evidence offered for it
 * was *"66 needles over 12 manifests, 0 disagreements"*. GPT Sol's review named
 * that for what it is — **corpus-compatible, not parser-correct** — and listed
 * the shapes today's corpus happens not to contain. He was right about every one
 * of them: `THE_REGEX_GOT_THESE_WRONG` below is the twenty-seven cases where the
 * old chain disagreed with the parser, kept as a red-first record rather than
 * deleted, because *"the corpus does not contain it"* is a fact with a date on
 * it and the corpus keeps growing.
 *
 * The reference below is not `textContent`. It implements the same intended
 * semantics as the scanner — dropped elements vanish, an inline element
 * concatenates its children with no separator, every other element is wrapped in
 * a space — so that a disagreement means a *tokenizing* difference and not a
 * difference of intent. Where the two still disagree, `DIVERGENCES` says so
 * explicitly, with the reason, rather than the case being left out.
 *
 * No network, no model, no database.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { JSDOM, VirtualConsole } from "jsdom";
import { describe, expect, it } from "vitest";

import { SCORABLE_FIXTURES } from "../evals/extraction/corpus.mjs";
import { visibleText } from "../evals/extraction/visible-text.mjs";

const norm = (s: string): string => s.replace(/\s+/g, " ").trim();

/* Same two lists the scanner uses, restated rather than imported: a reference
   that shares its tables with the implementation can only prove the
   implementation is itself. */
const INLINE = new Set([
  "a", "abbr", "b", "bdi", "bdo", "big", "br", "cite", "code", "data", "del", "dfn", "em",
  "font", "i", "img", "ins", "kbd", "mark", "q", "s", "samp", "small", "span", "strike",
  "strong", "sub", "sup", "time", "tt", "u", "var", "wbr", "ruby", "rt", "rp",
]);
const DROPPED = new Set(["script", "style", "noscript", "template"]);

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

/** The intended semantics, expressed over a tree a browser engine built. */
function render(node: Node): string {
  if (node.nodeType === TEXT_NODE) return node.nodeValue ?? "";
  if (node.nodeType !== ELEMENT_NODE) return "";
  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  if (DROPPED.has(tag)) return "";
  let inner = "";
  for (const child of Array.from(el.childNodes)) inner += render(child);
  return INLINE.has(tag) ? inner : ` ${inner} `;
}

/**
 * **The oracle.** JSDOM parses the string with a spec-conformant tokenizer and
 * tree builder; `render` then applies this file's semantics to the result. Only
 * ever called on the tiny strings below.
 */
function reference(html: string): string {
  const dom = new JSDOM(html, { virtualConsole: new VirtualConsole() });
  return norm(render(dom.window.document.documentElement));
}

/**
 * **The implementation this replaced**, copied verbatim from `textOfFixture` so
 * that what it got wrong is recorded rather than remembered. Nothing in the
 * production path calls this.
 */
const LEGACY_INLINE =
  "a|abbr|b|bdi|bdo|big|br|cite|code|data|del|dfn|em|font|i|img|ins|kbd|mark|q|s|samp|" +
  "small|span|strike|strong|sub|sup|time|tt|u|var|wbr|ruby|rt|rp";

const LEGACY_ENTITIES: Record<string, string | undefined> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’",
  mdash: "—", ndash: "–", hellip: "…", eacute: "é", copy: "©",
};

/**
 * Its own failure counts as a disagreement, because it has one: an out-of-range
 * numeric escape reaches `String.fromCodePoint` unguarded and **throws**, which
 * over a fixture would have been a red manifest rather than a wrong answer.
 */
function legacyTagStrip(html: string): string {
  try {
    return legacyTagStripUnguarded(html);
  } catch (err) {
    return `THREW: ${err instanceof Error ? err.message : String(err)}`;
  }
}

function legacyTagStripUnguarded(html: string): string {
  return norm(
    html
      .replace(/<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(new RegExp(`</?(?:${LEGACY_INLINE})\\b[^>]*>`, "gi"), "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
      .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(Number.parseInt(h, 16)))
      .replace(/&([a-z]+);/gi, (whole, name: string) => LEGACY_ENTITIES[name.toLowerCase()] ?? whole),
  );
}

/**
 * Every case here must agree with the parser exactly. Sol's list is in it —
 * unlisted entities, semicolonless entities, CDATA, `<textarea>`, `>` inside a
 * quoted attribute, script end-tag edge cases — plus everything else that came
 * up while writing the scanner.
 */
const CASES: { name: string; html: string }[] = [
  { name: "attr-gt", html: `<p title="x > Privacy policy">hello</p>` },
  { name: "attr-lt-gt-single-quoted", html: `<p title='a < b > c'>hi</p>` },
  { name: "attr-holding-markup", html: `<div data-x="<p>fake</p>">real</div>` },
  { name: "attr-unquoted", html: `<a href=/x/y>link</a> tail` },
  { name: "attr-unquoted-apostrophe", html: `<a href=/x?a=b'c>link</a> tail` },
  { name: "attr-across-newlines", html: `<p\n  title="x >\n  y"\n  class=z>hi</p>` },
  { name: "attr-spaced-equals", html: `<p title = "x > y">hi</p>` },
  { name: "entity-trade-frac12", html: `<p>Widget&trade; and &frac12; a loaf</p>` },
  { name: "entity-numeric", html: `<p>Don&#8217;t and Don&#x2019;t</p>` },
  { name: "entity-numeric-unterminated", html: `<p>Don&#8217t</p>` },
  { name: "entity-numeric-leading-zeros", html: `<p>&#000065;&#x0041;</p>` },
  { name: "entity-numeric-out-of-range", html: `<p>a&#1114112;b</p>` },
  { name: "entity-semicolonless", html: `<p>AT&amp;T &copy 2026, 5 &lt 6, a&nbspb</p>` },
  { name: "entity-longest-match", html: `<p>&notin; vs &notit; vs &ampere;</p>` },
  { name: "entity-c1-numeric", html: `<p>&#147;curly&#148; &#151; dash</p>` },
  { name: "entity-case-sensitive", html: `<p>&COPY; &copy; &Copy;</p>` },
  { name: "entity-unknown-name", html: `<p>&bogus; &amp;</p>` },
  { name: "entity-bare-ampersand", html: `<p>Tom & Jerry</p>` },
  { name: "entity-escaped-markup", html: `<p>&lt;p&gt;not a tag&lt;/p&gt;</p>` },
  { name: "entity-in-attribute-only", html: `<p title="&trade;">plain</p>` },
  { name: "cdata-plain", html: `<p>a<![CDATA[x]]>b</p>` },
  { name: "textarea-raw-text", html: `<p>before</p><textarea><p>not a tag</p></textarea><p>after</p>` },
  { name: "textarea-entities", html: `<p>a</p><textarea>&amp;&lt;</textarea>` },
  { name: "title-raw-text", html: `<title>a < b &amp; c</title><p>body</p>` },
  { name: "script-split-end-tag", html: `<p>a</p><script>var s = "</scr" + "ipt>";</script><p>b</p>` },
  { name: "script-spaced-end-tag", html: `<p>a</p><script>x = 1;</script ><p>b</p>` },
  { name: "script-slashed-end-tag", html: `<p>a</p><script>x = 1;</script/><p>b</p>` },
  { name: "script-end-tag-in-string", html: `<p>a</p><script>var s = "</script>";</script><p>b</p>` },
  { name: "script-lookalike-end-tag", html: `<p>a</p><script>x = "</scriptish>";</script><p>b</p>` },
  { name: "script-gt-in-attribute", html: `<script type="text/javascript" data-x="a>b">var x = 1 > 0;</script><p>ok</p>` },
  { name: "script-unclosed", html: `<p>a</p><script>x = 1;` },
  { name: "style-holding-end-tag", html: `<style>p{content:"</p>"}</style><p>text</p>` },
  { name: "noscript-in-body", html: `<p>x</p><noscript><p>enable js</p></noscript><p>real</p>` },
  { name: "template", html: `<template><p>tmpl</p></template><p>real</p>` },
  { name: "inline-nesting", html: `<p>the <code>accumulate</code>, and <em>more</em> here</p>` },
  { name: "inline-token-spans", html: `<p><span class="k">accum</span><span class="o">ulate</span>(<span class="n">x</span>)</p>` },
  { name: "inline-empty", html: `<p>a<span></span>b</p>` },
  { name: "inline-void", html: `<p>a<br/>b<img src=x alt="y > z">c</p>` },
  { name: "comment-holding-markup", html: `<p>a<!-- <p>hidden</p> -->b</p>` },
  { name: "comment-unterminated", html: `<p>a</p><!-- <p>b</p>` },
  { name: "unmatched-lt", html: `<p>if a < b then</p>` },
  { name: "lt-gt-in-prose", html: `<p>a < b > c</p>` },
  { name: "lt-at-end", html: `<p>ends with a <` },
  { name: "adjacent-blocks", html: `<div>one</div><div>two</div>` },
  { name: "block-inside-p", html: `<p>a<div>b</div>c</p>` },
  { name: "table", html: `<table><tr><td>x</td><td>y</td></tr></table>` },
  { name: "doctype", html: `<!DOCTYPE html><p>hi</p>` },
  { name: "processing-instruction", html: `<?xml version="1.0"?><p>hi</p>` },
  { name: "empty-end-tag", html: `<p>a</></p><p>b</p>` },
  { name: "uppercase-tags", html: `<P>A<CODE>b</CODE>,</P>` },
  { name: "custom-element", html: `<my-widget>inside</my-widget>tail` },
  { name: "nbsp-run", html: `<p>a&nbsp;b</p>` },
  { name: "plain-text", html: `no markup at all` },
  { name: "empty", html: `` },
];

/**
 * **Where the scanner deliberately disagrees with the parser**, with what it
 * produces and why that is the answer we want. Each is a place where matching
 * the parser would mean building a tree, and none of them can occur in a needle
 * a person typed off the rendered page.
 */
const DIVERGENCES: { name: string; html: string; scanner: string; why: string }[] = [
  {
    name: "cdata-in-html-with-inner-gt",
    html: `<p>a<![CDATA[x > y]]>b</p>`,
    scanner: "ab",
    why:
      "A parser treats CDATA in HTML content as a bogus comment ending at the FIRST '>', " +
      "so it leaks 'y]]>' into the text. Dropping the section whole is the reading of " +
      "'no markers in the visible text' that a needle search wants.",
  },
  {
    name: "cdata-in-svg",
    html: `<svg><![CDATA[hello]]></svg>`,
    scanner: "",
    why:
      "Inside foreign content CDATA is real and its contents are text. Knowing that " +
      "needs an element stack; the contents of a CDATA section in an inline SVG are " +
      "style or script data, never prose, so dropping them costs nothing.",
  },
  {
    name: "stray-end-tag",
    html: `<p>a</p>b</div>c`,
    scanner: "a b c",
    why:
      "A parser ignores an end tag that closes nothing, joining 'b' and 'c'. Without a " +
      "stack the scanner cannot tell that one from a real close, and a spurious space " +
      "is the safe direction: it never welds two words together.",
  },
  {
    name: "html5-only-entities",
    html: `<p>&bigstar; &Sub;</p>`,
    scanner: "&bigstar; &Sub;",
    why:
      "The table is the HTML 4 set plus the numeric escapes, not HTML 5's 2,231 names. " +
      "A needle is written from what a reader sees and nobody types '&bigstar;'. " +
      "Anything outside the table is left alone, exactly as an unknown entity is.",
  },
  {
    name: "noscript-before-body",
    html: `<noscript><p>enable js</p></noscript><p>real</p>`,
    scanner: "real",
    why:
      "With scripting disabled a parser closes a <noscript> that appears before the body " +
      "and hoists its contents out of the head, so they survive. In body position — the " +
      "only place it occurs on a real page — the two agree; see noscript-in-body above.",
  },
];

/**
 * **The cases the regex chain got wrong.** Twenty of them were recorded on
 * 2026-09-05 by running it against the reference over the first version of the
 * table, *before* the scanner existed — that was the red the rewrite was
 * started on. The remaining seven are cases added while writing the scanner,
 * scored the same way. This list is the evidence for the rewrite and a floor
 * under it: if it shrinks, somebody has quietly deleted a case Sol named.
 *
 * `entity-numeric-out-of-range` is the one that is not a wrong answer. The old
 * chain **throws** on `&#1114112;`, which over a fixture would have been a red
 * manifest nobody could read.
 */
const THE_REGEX_GOT_THESE_WRONG = [
  "attr-across-newlines",
  "attr-gt",
  "attr-holding-markup",
  "attr-lt-gt-single-quoted",
  "attr-spaced-equals",
  "cdata-in-svg",
  "cdata-plain",
  "comment-holding-markup",
  "comment-unterminated",
  "entity-c1-numeric",
  "entity-case-sensitive",
  "entity-longest-match",
  "entity-numeric-out-of-range",
  "entity-numeric-unterminated",
  "entity-semicolonless",
  "entity-trade-frac12",
  "html5-only-entities",
  "inline-void",
  "lt-gt-in-prose",
  "noscript-before-body",
  "script-slashed-end-tag",
  "script-spaced-end-tag",
  "script-unclosed",
  "stray-end-tag",
  "textarea-raw-text",
  "title-raw-text",
  "unmatched-lt",
];

const ALL = [...CASES, ...DIVERGENCES.map(({ name, html }) => ({ name, html }))];

describe("visibleText against a real parser", () => {
  it("has a table worth running", () => {
    /* An empty table passes every loop below in silence. */
    expect(CASES.length).toBeGreaterThanOrEqual(40);
    expect(new Set(ALL.map((c) => c.name)).size).toBe(ALL.length);
  });

  for (const { name, html } of CASES) {
    it(name, () => {
      expect(visibleText(html)).toBe(reference(html));
    });
  }

  for (const { name, html, scanner, why } of DIVERGENCES) {
    it(`diverges: ${name}`, () => {
      expect(visibleText(html), why).toBe(scanner);
      /* And the divergence is real rather than stale — if the parser comes to
         agree, this fails and the case moves up into CASES. */
      expect(reference(html), why).not.toBe(scanner);
    });
  }
});

describe("the regex chain this replaced", () => {
  it("got exactly these wrong, which is why there is a scanner", () => {
    const wrong = ALL.filter(({ html }) => legacyTagStrip(html) !== reference(html))
      .map(({ name }) => name)
      .sort();
    expect(wrong).toEqual(THE_REGEX_GOT_THESE_WRONG);
  });

  it("leaked an attribute into the visible text, precisely as reported", () => {
    /* Sol's headline example, spelled out rather than left inside a set
       comparison: the needle 'Privacy policy' would have been findable in the
       page's text on the strength of a title attribute. */
    const html = `<p title="x > Privacy policy">hello</p>`;
    expect(legacyTagStrip(html)).toBe(`Privacy policy">hello`);
    expect(visibleText(html)).toBe("hello");
  });
});

describe("over the committed fixtures", () => {
  const DIR = path.join("evals", "extraction", "fixtures");

  it("reads every one of them, in milliseconds rather than seconds", () => {
    const named = readdirSync(DIR)
      .filter((f) => f.endsWith(".manifest.json"))
      .map((f) => f.replace(/\.manifest\.json$/, ""));
    expect(named.length).toBeGreaterThanOrEqual(10);

    const sources = named.map((name) => {
      const entry = SCORABLE_FIXTURES.find((f) => f.name === name);
      if (!entry) throw new Error(`${name}: not in SCORABLE_FIXTURES`);
      return { name, html: readFileSync(path.join(DIR, entry.file), "utf-8") };
    });
    const bytes = sources.reduce((sum, s) => sum + s.html.length, 0);

    const started = performance.now();
    const texts = sources.map(({ name, html }) => ({ name, text: visibleText(html) }));
    const elapsed = performance.now() - started;

    /**
     * **Two of the fixtures are not articles**, and their whole point is that
     * they are almost empty: `medium-about` is a 404 shell with 281 characters of
     * visible text, `pmc-article` a reCAPTCHA wall with 165. Their manifests say
     * `notAnArticle` and assert that stage 2 refuses them. Judged by the floor
     * below they would look like a broken scanner, so they are held to a much
     * lower one and named rather than skipped.
     */
    const NOT_ARTICLES = new Set(["medium-about", "pmc-article"]);
    for (const { name, text } of texts) {
      /* Substantial, because "" satisfies every `mustNotContain` there is —
         which is the failure this whole check exists to make impossible. */
      expect(text.length, `${name}: barely any text`).toBeGreaterThan(
        NOT_ARTICLES.has(name) ? 100 : 2_000,
      );
    }

    /* **A leak probe rather than a search for markup**, because markup is
       legitimately *in* the text of some of these: `mdn_cache.html` writes
       `&lt;script` three times in a code sample, so `not.toContain("<script")`
       fails on a fixture the scanner handled correctly. Planting a string that
       occurs nowhere else, in the two places whose contents must never surface,
       cannot be satisfied by prose. */
    const inAttribute = "SPYA-LEAK-FROM-AN-ATTRIBUTE";
    const inScript = "SPYA-LEAK-FROM-A-SCRIPT";
    for (const { name, html } of sources) {
      const probed = `${html}<p title="> ${inAttribute}">visible</p><script>${inScript}</script>`;
      const text = visibleText(probed);
      expect(text, `${name}: an attribute reached the text`).not.toContain(inAttribute);
      expect(text, `${name}: a script reached the text`).not.toContain(inScript);
      /* And the probe went in where it could have been seen — a marker the
         scanner never met is a control that proves nothing. */
      expect(text.endsWith("visible"), `${name}: the probe did not land`).toBe(true);
    }

    /* Printed, not asserted: it is a stopwatch on a shared box, and a threshold
       here would be a test that fails when somebody else is compiling. The
       number it replaced was 44,000ms; on 2026-09-05 this printed
       `12 fixtures, 3.7 MB, 297 ms total, 24.7 ms each`.

       **Vitest's default reporter swallows a passing test's stdout**, so run
       `npx vitest run tests/extraction-visible-text.test.ts --reporter=verbose`
       to see it. */
    console.log(
      `visibleText: ${sources.length} fixtures, ${(bytes / 1e6).toFixed(1)} MB, ` +
        `${elapsed.toFixed(0)} ms total, ${(elapsed / sources.length).toFixed(1)} ms each`,
    );
  });
});
