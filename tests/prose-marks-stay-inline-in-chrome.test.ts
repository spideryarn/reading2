// @vitest-environment jsdom
/**
 * **A mark in the prose never breaks the line it is on, in Chrome.**
 *
 * Greg, 2026-10-03 (spya-trg9kz), of a paragraph in an Entropy paper: *"the
 * formatting gets a bit messed up around footnotes … weird line breaks."* Every
 * cited clause sat on lines of its own, with the comma after it starting the
 * next one. Nothing was wrong with the stored block. The chips a model's answer
 * cites blocks with were styled by a bare `.cite { display: inline-flex }`
 * (mode-band.css), and a citation's mark in the prose is `<mark class="cite">`
 * — so the chip's rule made every citation mark an atomic box, which goes to
 * the next line whole when it does not fit and sends what follows it to the
 * line after. Invisible on a mark as short as `[113]`, plain on a whole clause.
 * docs/postmortems/261003e-two-components-sharing-one-bare-class-name.md.
 *
 * Only a browser can see a line break, so this is one Chrome with the reader's
 * sheets inlined, after tests/masthead-facts-wrap-in-chrome.test.tsx. The
 * marks are `annotateHtml`'s own, over the opening of the block Greg linked to.
 *
 * Skipped where there is no Chrome; the box and Greg's Mac both have one.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { chromePath } from "../scripts/browser-sign-in.js";
import { annotateHtml, type Mark, type MarkKind } from "../src/web/annotate.js";
import { readerCss, readerCssNoComments } from "./helpers/stylesheets.js";

const chrome = (() => {
  try {
    return chromePath();
  } catch {
    return null;
  }
})();

const CSS = `${readFileSync(path.resolve(process.cwd(), "styles/tokens.css"), "utf8")}\n${readerCss()}`;

/** The opening of production's `spya-tgqpmx`, as stored. */
const TEXT =
  "The considerable literature on (behavioral) memory transplants across animal bodies reveals that the ability to reinterpret memories functions between Selflets that are not somatically contiguous (not part of the same organism persisting through time). The results observed when pieces of, or extracts of, the brains of trained animals are moved into naïve subjects [111–119], and the (as yet uncertain) reported claims of memories transferred via heart/lung transplants [120,121], point to an even deeper kind of remapping capacity.";
const HTML = `<p id="spya-tgqpmx">${TEXT}</p>`;

/** The two clauses the citations were drawn on in Greg's screenshot. */
const CLAUSES = [
  "results observed when pieces of, or extracts of, the brains of trained animals are moved into naïve subjects [111–119]",
  "the (as yet uncertain) reported claims of memories transferred via heart/lung transplants [120,121]",
];

/* Every kind, so a seventh cannot arrive untested: a missing key fails to compile. */
const KINDS: Record<MarkKind, true> = { cmt: true, chat: true, term: true, hit: true, cite: true, xref: true };

function marked(kind: MarkKind): string {
  const marks: Mark[] = CLAUSES.map((clause, i) => {
    const start = TEXT.indexOf(clause);
    if (start < 0) throw new Error("the fixture's clause is not in its text");
    return { id: `m${i}`, kind, start, end: start + clause.length };
  });
  return annotateHtml(HTML, marks);
}

const page = (prose: string, extraCss = "") =>
  `<style>${CSS}${extraCss}</style><div class="reader"><table><tbody><tr><td class="text" style="width: 600px"><div class="prose">${prose}</div></td></tr></tbody></table></div>`;

/** The rule this file exists to stop coming back, under any class a mark wears. */
const oldRule = (kind: MarkKind) => `.${kind} { display: inline-flex; gap: 0.2rem; margin: 0 0.1rem; }`;

describe.skipIf(chrome === null)("a mark in the prose, in Chrome", () => {
  it("flows with the sentence: the comma after it stays on the line it ends on", { timeout: 120_000 }, async () => {
    const { chromium } = await import("playwright-core");
    if (chrome === null) throw new Error("no Chrome, and this test should have been skipped");
    const browser = await chromium.launch({ headless: true, executablePath: chrome, args: ["--no-sandbox"] });
    try {
      const p = await browser.newPage({ viewport: { width: 900, height: 900 } });
      const look = (html: string) =>
        p.setContent(html).then(() =>
          p.evaluate(() =>
            [...document.querySelectorAll("mark")].map((mark) => {
              /* A Range over the words, not the element's own rects: an atomic
                 box is one rect however many lines its text takes. */
              const tops = (node: Node, from?: number, to?: number) => {
                const r = document.createRange();
                r.selectNodeContents(node);
                if (from !== undefined && to !== undefined) {
                  r.setStart(node, from);
                  r.setEnd(node, to);
                }
                return [...r.getClientRects()].filter((b) => b.width > 0).map((b) => Math.round(b.top));
              };
              const inside = tops(mark);
              const before = mark.previousSibling;
              const after = mark.nextSibling;
              return {
                display: getComputedStyle(mark).display,
                lines: new Set(inside).size,
                /* The word before the mark and the mark's first line; the mark's
                   last line and the comma after it. */
                startsOnTheLineBefore:
                  before !== null && tops(before, (before.textContent ?? "").length - 4, (before.textContent ?? "").length).at(-1) === inside[0],
                nextCarriesOn: after !== null && tops(after, 0, 1)[0] === inside.at(-1),
              };
            }),
          ),
        );

      for (const kind of Object.keys(KINDS) as MarkKind[]) {
        const prose = marked(kind);
        expect(prose.match(/<mark /g), `${kind}: the fixture drew no marks`).toHaveLength(CLAUSES.length);

        /* The control: with the chip's old rule forced onto this class the
           fixture must break the line. Without it, a column wide enough to
           hold a clause would pass over nothing. */
        const broken = await look(page(prose, oldRule(kind)));
        expect(broken.map((m) => m.display), `${kind}: the control`).toEqual(["inline-flex", "inline-flex"]);
        expect(broken.some((m) => !m.startsOnTheLineBefore || !m.nextCarriesOn), `${kind}: the fixture no longer reproduces the break`).toBe(true);

        const drawn = await look(page(prose));
        for (const m of drawn) {
          expect(m.display, `mark.${kind} is not an inline`).toBe("inline");
          expect(m.lines, `${kind}: the clause should wrap, or the column is too wide to test anything`).toBeGreaterThan(1);
          expect(m.startsOnTheLineBefore, `mark.${kind} starts on a line of its own`).toBe(true);
          expect(m.nextCarriesOn, `the words after mark.${kind} were sent to the next line`).toBe(true);
        }
      }
    } finally {
      await browser.close().catch(() => {});
    }
  });
});

/**
 * **The class of bug, where there is no Chrome to see the instance.** A class a
 * `<mark>` wears belongs to marks: a rule that names one on anything else also
 * styles the author's prose, whatever it was written for. `.cite` was the
 * chat answer's chips for three weeks before it was a citation's mark as well.
 */
describe("the classes a prose mark wears", () => {
  /** Keep enclosing functions when a comma or space separates their arguments. */
  const context = (prefix: string) => {
    let start = 0;
    let bracket = 0;
    let quote = "";
    const opens: number[] = [];
    for (let i = 0; i < prefix.length; i++) {
      const c = prefix[i];
      if (c === "\\") {
        i++;
        continue;
      }
      if (quote !== "") {
        if (c === quote) quote = "";
        continue;
      }
      if (c === '"' || c === "'") {
        quote = c;
        continue;
      }
      if (c === "[") bracket++;
      else if (c === "]") bracket--;
      if (bracket > 0) continue;
      if (c === "(") opens.push(i);
      else if (c === ")" && opens.pop() === undefined) return null;
      else if (opens.length === 0 && /[\s,>+~{}]/.test(c ?? "")) start = i + 1;
    }
    return { compound: prefix.slice(start), opens: opens.map((i) => i - start), bracket, quote };
  };

  /** Every occurrence, including an earlier `.kind` in the same compound. */
  const naming = (css: string, kind: MarkKind) =>
    [...css.matchAll(new RegExp(`\\.${kind}(?![\\w-])`, "g"))].flatMap((m) => {
      const start = Math.max(css.lastIndexOf("{", m.index), css.lastIndexOf("}", m.index)) + 1;
      const found = context(css.slice(start, m.index + m[0].length));
      if (found === null) throw new Error(`unbalanced selector near .${kind}`);
      /* A string or attribute value mentioning a class is not a class selector. */
      return found.bracket > 0 || found.quote !== "" ? [] : [found.compound];
    });
  /**
   * Is the element this class sits on constrained to a `<mark>`? `compound` ends
   * at the class. `mark.cite` and `mark.hit.cite` are; so is the class inside
   * `:has(…)`, which styles something else. `:not(…)` must have a mark host
   * (`mark.term:not(.xref`); `:is(…)` and `:where(…)` may require a mark inside.
   * Examine the outer function first so a nested positive mention cannot
   * escape an enclosing negation. A `mark`
   * that is only mentioned is not enough: `:not(mark.xref).cite` matches a
   * citation's mark and constrains nothing (GPT Sol, plan review).
   */
  const onAMark = (compound: string): boolean => {
    const found = context(compound);
    if (found === null) return false;
    compound = found.compound;
    const open = found.opens[0] ?? -1;
    if (open < 0) return /^mark(?![\w-])/.test(compound);
    const fn = /:(has|not|is|where)$/.exec(compound.slice(0, open));
    if (fn === null) return false;
    if (fn[1] === "has") return true;
    const hostIsMark = onAMark(compound.slice(0, fn.index));
    return hostIsMark || (fn[1] !== "not" && onAMark(compound.slice(open + 1)));
  };

  it("are named by the reader's sheets only on a mark", () => {
    const css = readerCssNoComments();
    for (const kind of Object.keys(KINDS) as MarkKind[]) {
      const found = naming(css, kind);
      expect(found.length, `no rule names .${kind} at all, so this checks nothing`).toBeGreaterThan(0);
      expect(found.filter((compound) => !onAMark(compound)), `.${kind} is styled on something that is not a <mark>`).toEqual([]);
    }
  });

  it("is a check that can fail: the chip's old rule is caught", () => {
    const css = ".chat-reply .cite .block-ref { color: red } mark.cite, td.text:has(mark.hit.cite) { color: blue } .cite-chips {}";
    expect(naming(css, "cite")).toEqual([".cite", "mark.cite", "td.text:has(mark.hit.cite"]);
    expect(naming(css, "cite").filter((compound) => !onAMark(compound))).toEqual([".cite"]);
    /* A mark that is mentioned, not required. */
    expect(onAMark(":not(mark.xref).cite")).toBe(false);
    expect(onAMark("span:is(.cite")).toBe(false);
    /* The host is a mark, or the class is only looked for inside something else. */
    expect(onAMark("mark.term:not(.xref")).toBe(true);
    expect(onAMark("td.text:has(.hit")).toBe(true);
    expect(onAMark("mark:is(.term,.cite")).toBe(true);
    expect(onAMark("mark:not(.term, .cite")).toBe(true);
  });

  it.each([
    ":not(mark.xref,mark.term).cite",
    ":not(mark.xref, mark.term).cite",
    ":is(.cite):not(mark.xref.cite)",
    ":not(mark.xref.cite)",
    ":not(:is(mark.hit.cite))",
    ":not(:has(.cite))",
    ":not(.foo,mark.cite.foo)",
    ":not(.foo, mark.cite.foo)",
    ":not(.foo,:has(.cite))",
    ":is(mark.xref,.cite)",
  ])("rejects %s, which would make a citation mark atomic again", (selector) => {
    const mark = document.createElement("mark");
    mark.className = "cite";
    expect(mark.matches(selector), "the counterexample must reach a real citation mark").toBe(true);
    const found = naming(`${readerCssNoComments()}\n${selector} { display: inline-flex }`, "cite");
    expect(found.filter((compound) => !onAMark(compound)).length).toBeGreaterThan(0);
  });
});
