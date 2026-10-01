/**
 * **An article keeps only the `data-*` attributes and classes we name** — the
 * rule in src/sanitize-policy.ts since 2026-10-01, and the reason it exists.
 *
 * Until then the policy was a denylist: every annotation attribute and class the
 * reading view trusts had to be added to it by hand, and six versions of the
 * policy were exactly that, four of them caught by a reviewer rather than by the
 * change that needed them. SPIDERYARN-READING2-5Z was the next: `data-block-link`
 * and the `xref` mark were not listed, so an imported article could open our
 * preview card on words we never linked (GPT Sol, 260930f code review 2, D3).
 *
 * **What the tests below can and cannot catch**, said plainly because the first
 * draft of this header overclaimed (GPT Sol, plan review, finding 1). The rule
 * fails closed, so a *new* marking is stripped with no edit anywhere, and these
 * tests stay green for it: that is the point, not a gap. What can still go
 * wrong is a **collision**: the app starting to key something off a name an
 * article is *allowed* to keep. So the tests scan the source for every `data-…`
 * name and every class the app uses, put each on an element, and ask the real
 * sanitiser whether it survives. Anything that survives must be on a declared
 * list, and the browser may read only the pipeline's own `data-spya-*` names
 * among the survivors. A collision goes red the day it is written.
 *
 * docs/plans/261001a-article-markup-keeps-only-what-we-allow-of-data-attributes-and-classes.md
 */
import { globSync, readFileSync } from "node:fs";
import path from "node:path";
import temml from "temml";
import { describe, expect, it } from "vitest";
import { temmlRenderer } from "../src/maths-tex.js";
import { RESERVED_ATTRS } from "../src/reserved.js";
import { sanitizeHtml } from "../src/sanitize.js";
import {
  ARTICLE_CLASSES,
  ARTICLE_DATA_ATTRS,
  TEMML_CLASSES,
} from "../src/sanitize-policy.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const MATHML = `xmlns="http://www.w3.org/1998/Math/MathML"`;

/** Source files, never tests: a test naming a forged attribute is not a marking. */
function sourceFiles(pattern: string): string[] {
  return globSync(pattern, { cwd: ROOT }).filter((f) => !/\.test\.tsx?$/.test(f));
}

const dataName = /\bdata-[a-z][a-z0-9]*(?:-[a-z0-9]+)*/g;

/** `dataset.fooBar` is the attribute `data-foo-bar`. */
function datasetName(property: string): string {
  return `data-${property.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
}

/**
 * Every `data-…` name spelled under `glob`, plus the two common ways source
 * names one without spelling it: `dataset.foo` and `RESERVED_ATTRS.foo`.
 */
function dataNamesInSource(glob = "src/**/*.{ts,tsx,css}"): Map<string, string> {
  const found = new Map<string, string>();
  const add = (name: string | undefined, file: string) => {
    if (name && !found.has(name)) found.set(name, file);
  };
  for (const file of sourceFiles(glob)) {
    const text = readFileSync(path.join(ROOT, file), "utf8");
    for (const m of text.matchAll(dataName)) add(m[0], file);
    for (const m of text.matchAll(/\.dataset\.([a-z][a-zA-Z0-9]*)\b/g)) {
      if (m[1]) add(datasetName(m[1]), file);
    }
    for (const m of text.matchAll(/\.dataset\[\s*["']([a-z][a-zA-Z0-9]*)["']\s*\]/g)) {
      if (m[1]) add(datasetName(m[1]), file);
    }
    for (const m of text.matchAll(/RESERVED_ATTRS\.([a-zA-Z][a-zA-Z0-9]*)\b/g)) {
      const key = m[1] as keyof typeof RESERVED_ATTRS | undefined;
      if (key) add(RESERVED_ATTRS[key], file);
    }
  }
  return found;
}

/**
 * The class names in the preludes of a stylesheet — the text before each `{`,
 * so a `url(…)` or a number inside a declaration is never read as a class.
 */
function classSelectors(css: string): Set<string> {
  const out = new Set<string>();
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of bare.matchAll(/([^{};]+)\{/g)) {
    const prelude = m[1] ?? "";
    if (prelude.trim().startsWith("@")) continue; // @media, @font-face, @layer
    for (const c of prelude.matchAll(/\.(-?[a-zA-Z_][\w-]*)/g)) if (c[1]) out.add(c[1]);
  }
  return out;
}

type AddClass = (c: string | undefined, file: string) => void;

function addClassTokens(value: string, file: string, add: AddClass): void {
  for (const tok of value.split(/\s+/)) add(tok, file);
}

function classesInWebCode(text: string, file: string, add: AddClass): void {
  const selectorClasses = (sel: string) => {
    for (const c of sel.matchAll(/\.(-?[a-zA-Z_][\w-]*)/g)) add(c[1], file);
  };
  for (const m of text.matchAll(/(?:closest|matches|querySelector(?:All)?)\(\s*(["'`])([^"'`]*)\1/g)) {
    selectorClasses(m[2] ?? "");
  }
  for (const m of text.matchAll(/[A-Z_]*SELECTOR[A-Z_]*\s*(?::[^=]+)?=\s*(["'`])([^"'`]*)\1/g)) {
    selectorClasses(m[2] ?? "");
  }
  for (const m of text.matchAll(/[A-Z_]*CLASS(?:ES)?[A-Z_]*\s*(?::[^=]+)?=\s*(["'`])([^"'`]*)\1/g)) {
    addClassTokens(m[2] ?? "", file, add);
  }
  for (const m of text.matchAll(/className(?:=\{?|:\s*)(["'`])([^"'`]*)\1/g)) {
    addClassTokens((m[2] ?? "").replace(/\$\{[^}]*\}/g, " "), file, add);
  }
  for (const m of text.matchAll(/\.className\s*=\s*(["'`])([^"'`]*)\1/g)) {
    addClassTokens(m[2] ?? "", file, add);
  }
  for (const m of text.matchAll(/setAttribute\(\s*["']class["']\s*,\s*(["'`])([^"'`]*)\1/g)) {
    addClassTokens(m[2] ?? "", file, add);
  }
  for (const m of text.matchAll(/classList\.(?:add|remove|toggle|contains)\(\s*(["'`])([^"'`]*)\1/g)) {
    add(m[2], file);
  }
}

/**
 * Every class the app keys anything off or writes, with the first file that
 * does. Seven spellings, because a scanner that reads one misses the others —
 * `XREF_SELECTOR` is a constant, not a `closest()` argument, and the first
 * version found it only because the stylesheet also names it:
 *
 *  - class selectors in our own stylesheets;
 *  - selectors handed to `closest`, `matches` or `querySelector(All)`;
 *  - string constants whose name ends in `SELECTOR`;
 *  - string constants whose name contains `CLASS`;
 *  - `className` string and template literals (their static tokens);
 *  - direct `.className = "…"` and `setAttribute("class", "…")` writes;
 *  - `classList.add/remove/toggle/contains("…")`.
 */
function appClasses(): Map<string, string> {
  const found = new Map<string, string>();
  const add = (c: string | undefined, file: string) => {
    if (c && /^-?[a-zA-Z_][\w-]*$/.test(c) && !found.has(c)) found.set(c, file);
  };
  for (const file of sourceFiles("src/web/**/*.css")) {
    for (const c of classSelectors(readFileSync(path.join(ROOT, file), "utf8"))) add(c, file);
  }
  for (const file of sourceFiles("src/web/**/*.{ts,tsx}")) {
    classesInWebCode(readFileSync(path.join(ROOT, file), "utf8"), file, add);
  }
  return found;
}

describe("the 5Z forgeries", () => {
  it("strips a forged block link, which opened our preview card on the publisher's words", () => {
    const out = sanitizeHtml(
      `<p><a href="#x" data-block-link="spya-k3m9qt" data-block-preview="on">a</a>` +
        `<span data-block-link="spya-k3m9qt" data-block-missing="">b</span></p>`,
    );
    expect(out).toBe(`<p><a href="#x">a</a><span>b</span></p>`);
  });

  it("strips a forged cross-reference mark, attribute and class both", () => {
    expect(sanitizeHtml(`<p><mark class="xref" data-xref="n0-1">c</mark></p>`)).toBe(
      "<p><mark>c</mark></p>",
    );
  });

  it("strips the app's chrome classes, which click handlers look for with closest()", () => {
    /* `Reader.tsx` asks `closest(".mode-band")` and TermJump asks
       `matches(".blk-permalink, …")`. Neither was ever on the old list. */
    expect(sanitizeHtml(`<p class="mode-band"><span class="blk-permalink gloss-list">d</span></p>`)).toBe(
      "<p><span>d</span></p>",
    );
  });

  it("uses namespaces, including an HTML integration point inside MathML", () => {
    const out = sanitizeHtml(
      `<math ${MATHML}><mi class="mode-band xref tml-left">x</mi>` +
        `<mtext><span class="xref tml-left">y</span></mtext></math>`,
    );
    expect(out).toContain(`<mi class="tml-left">x</mi>`);
    expect(out).toContain(`<mtext><span>y</span></mtext>`);
    expect(out).not.toContain("mode-band");
    expect(out).not.toContain("xref");
  });

  it("gives SVG only the namespace-independent article classes", () => {
    const out = sanitizeHtml(
      `<svg><g class="pdf-uncertain xref tml-left"><text>x</text></g></svg>`,
    );
    expect(out).toContain(`<g class="pdf-uncertain">`);
    expect(out).not.toContain("xref");
    expect(out).not.toContain("tml-left");
  });

  it("does not let Temml's vocabulary onto an HTML element", () => {
    expect(sanitizeHtml(`<p class="upstrike tml-display">e</p>`)).toBe("<p>e</p>");
  });
});

describe("what the article must keep", () => {
  it("keeps every attribute of the pipeline's own data-spya-* namespace", () => {
    for (const attr of Object.values(RESERVED_ATTRS)) {
      expect(sanitizeHtml(`<p ${attr}="v">x</p>`), attr).toBe(`<p ${attr}="v">x</p>`);
    }
  });

  it("keeps the two addresses gwern writes behind an archive link, which citations read", () => {
    const html = `<p><a href="https://gwern.net/doc/x.pdf" data-url-original="https://arxiv.org/abs/1706.03762" data-href-mobile="https://m.example/x">t</a></p>`;
    expect(sanitizeHtml(html)).toBe(html);
  });

  it("keeps the class our PDF renderer writes", () => {
    expect(sanitizeHtml(`<p class="pdf-uncertain">f</p>`)).toBe(`<p class="pdf-uncertain">f</p>`);
  });

  it("keeps a block id, which is not a data-* attribute and never was", () => {
    expect(sanitizeHtml(`<p id="spya-k3m9qt">g</p>`)).toBe(`<p id="spya-k3m9qt">g</p>`);
  });

  it("declares only the pipeline namespace and the two publisher addresses", () => {
    expect([...ARTICLE_DATA_ATTRS].sort()).toEqual(
      [...Object.values(RESERVED_ATTRS), "data-href-mobile", "data-url-original"].sort(),
    );
    expect([...ARTICLE_CLASSES]).toEqual(["pdf-uncertain"]);
  });
});

describe("completeness: no marking the app uses survives unless it is declared", () => {
  const dataNames = dataNamesInSource();
  const classes = appClasses();

  it("has something to check — a scanner that finds nothing passes everything", () => {
    for (const name of ["data-block-link", "data-xref", "data-comment", "data-cite"]) {
      expect(dataNames.has(name), name).toBe(true);
    }
    for (const c of ["xref", "cite", "term", "mode-band", "blk-permalink"]) {
      expect(classes.has(c), c).toBe(true);
    }
    expect(dataNames.size).toBeGreaterThan(80);
    expect(classes.size).toBeGreaterThan(300);
  });

  it("strips every data-* name spelled in src/ unless ARTICLE_DATA_ATTRS declares it", () => {
    const survivors: string[] = [];
    for (const [name, file] of dataNames) {
      const kept = sanitizeHtml(`<span ${name}="v">x</span>`).includes(name);
      if (kept !== ARTICLE_DATA_ATTRS.includes(name)) survivors.push(`${name} (${file})`);
    }
    expect(survivors).toEqual([]);
  });

  it("lets browser source name no surviving data-* but the pipeline's own stamps", () => {
    /* The collision this rule can still suffer (Sol, plan review, finding 1):
       the reading view starting to trust a name an article is allowed to keep.
       `data-url-original` in src/web would be exactly that — a publisher's
       attribute with our meaning on it — and goes red here. The four below are
       ours, and scrubbed from a stranger's markup on the way in
       (src/reserved.ts). */
    const web = dataNamesInSource("src/web/**/*.{ts,tsx,css}");
    const trusted = [...web.keys()].filter((n) => ARTICLE_DATA_ATTRS.includes(n)).sort();
    expect(trusted).toEqual([
      "data-spya-note",
      "data-spya-note-back",
      "data-spya-note-ref",
      "data-spya-pdf-figure",
    ]);
  });

  it("strips every class the app uses from an HTML element unless ARTICLE_CLASSES declares it", () => {
    const survivors: string[] = [];
    for (const [c, file] of classes) {
      const kept = sanitizeHtml(`<p class="${c}">x</p>`).includes("class=");
      if (kept !== ARTICLE_CLASSES.includes(c)) survivors.push(`${c} (${file})`);
    }
    expect(survivors).toEqual([]);
  });

  it("strips every class the app uses from a MathML element unless Temml owns it", () => {
    const survivors: string[] = [];
    for (const [c, file] of classes) {
      const kept = sanitizeHtml(`<math ${MATHML}><mi class="${c}">x</mi></math>`).includes("class=");
      const declared = TEMML_CLASSES.includes(c) || ARTICLE_CLASSES.includes(c);
      if (kept !== declared) survivors.push(`${c} (${file})`);
    }
    expect(survivors).toEqual([]);
  });

  it("uses no Temml class name for anything of its own but Temml's display maths", () => {
    /* A class of ours that shared a name with Temml's would survive on a MathML
       element. Today the only overlap is our own rule *for* Temml's output
       (`.prose math.tml-display`, prose.css). A new one goes red here. */
    expect([...classes.keys()].filter((c) => TEMML_CLASSES.includes(c))).toEqual(["tml-display"]);
  });
});

describe("Temml's vocabulary, pinned to the stylesheet that gives it meaning", () => {
  it("TEMML_CLASSES is exactly the class selectors in Temml-Local.css", () => {
    /* A Temml upgrade that adds a class turns this red, rather than letting
       maths quietly lose a style once the sanitiser strips it. */
    const css = readFileSync(path.join(ROOT, "node_modules/temml/dist/Temml-Local.css"), "utf8");
    expect([...TEMML_CLASSES].sort()).toEqual([...classSelectors(css)].sort());
  });

  it("keeps every declared Temml class on MathML, and none on HTML", () => {
    for (const c of TEMML_CLASSES) {
      expect(sanitizeHtml(`<math ${MATHML}><mi class="${c}">x</mi></math>`), c).toContain(
        `class="${c}"`,
      );
      expect(sanitizeHtml(`<span class="${c}">x</span>`), c).toBe("<span>x</span>");
    }
  });

  it("keeps every styled class emitted by a representative real-renderer battery", () => {
    /* Not *every* class Temml writes: `mord`, `tml-tag`, `tml-tageqn` and a few
       more are hooks for Temml's own `postProcess` and for Firefox, which we do
       not call and whose rules are not in Temml-Local.css. Unstyled, they draw
       nothing, so dropping them changes no pixel.

       Nor does this battery claim to make Temml emit all 58 stylesheet classes:
       it currently exercises 28. The synthetic test above covers the whole
       declared set; the expected tokens here make each real feature a positive
       control rather than letting six unrelated `tml-display`s satisfy a count. */
    const render = temmlRenderer(temml);
    const battery: Array<{ tex: string; expected: string[] }> = [
      { tex: "\\frac{a}{b}", expected: ["tml-display"] },
      { tex: "\\sqrt{x^2}", expected: ["tml-sml-pad"] },
      {
        tex: "\\begin{aligned} a&=b\\\\ c&=d\\end{aligned}",
        expected: ["tml-jot", "tml-left", "tml-right"],
      },
      {
        tex: "\\cancel{z}\\bcancel{y}\\xcancel{w}\\sout{v}",
        expected: ["tml-cancel", "tml-xcancel", "downstrike", "upstrike", "sout"],
      },
      {
        tex: "\\vec{v}\\widehat{abc}\\widetilde{xyz}\\overline{ab}\\underline{cd}",
        expected: ["tml-vec", "tml-hat-3", "tml-tilde-3", "tml-overline", "tml-underline"],
      },
      {
        tex: "\\boxed{x}\\fbox{y}\\phase{30^\\circ}\\longdiv{5}\\angl{n}",
        expected: ["tml-fbox", "phasor-angle", "longdiv-arc", "actuarial"],
      },
      {
        tex: "\\mathcal{A}\\mathscr{B}\\textcircled{c}",
        expected: ["mathcal", "mathscr", "textcircle"],
      },
      { tex: "\\begin{equation}x\\tag{1}\\end{equation}", expected: ["tml-left", "tml-right"] },
      { tex: "a'\\;b\\,c\\quad d", expected: ["tml-prime"] },
    ];
    const seen = new Set<string>();
    for (const { tex, expected } of battery) {
      const html = render(tex, true);
      expect(html, tex).not.toBeNull();
      if (html === null) continue;
      const styled = (s: string) =>
        [...s.matchAll(/class="([^"]*)"/g)]
          .map((m) => (m[1] ?? "").split(/\s+/).filter((c) => TEMML_CLASSES.includes(c)).join(" "))
          .filter((c) => c !== "")
          .join("|");
      const emitted = styled(html);
      for (const c of expected) expect(emitted, `${tex} did not exercise ${c}`).toContain(c);
      for (const c of emitted.split(/[ |]/).filter(Boolean)) seen.add(c);
      expect(styled(sanitizeHtml(html)), tex).toBe(styled(html));
    }
    expect(seen.size).toBe(28);
  });
});
