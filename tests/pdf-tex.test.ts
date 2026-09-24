/**
 * **The PDF check reads maths written as TeX** — docs/plans/260924b-pdf-transcriber-writes-maths-as-tex.md.
 *
 * The transcriber is now asked for `\(…\)` and `\[…\]`. Until the check was
 * taught to read them, a maths chunk transcribed that way failed as markup
 * (`\frac`, `\sum`) and as invention (`Y_{t+1}` is a "number" nowhere on the
 * page), was asked a second paid time, and was never checkpointed (F1 of
 * docs/plans/260912d-plan-review-sol.md). These tests pin both halves: TeX inside
 * a recognised span is compared as the words a reader would read off the page,
 * and TeX anywhere else is still markup.
 *
 * The page is a hand-written copy of what pdf.js hands back for equation (1) of
 * Newman et al., *Entropy* 24(7) 930 — the paper behind Greg's report — with a
 * subscript glued to its base (`Yt+1`) and the stacked fraction split over
 * lines, exactly as the real text layer holds them.
 */
import { describe, expect, it } from "vitest";
import type { Pass0, PdfRecord } from "../src/pdf.js";
import { check } from "../src/pdf-score.js";
import { structuralIssues } from "../src/pdf-integrity.js";
import { mathsAsText, plainMaths } from "../src/pdf-tex.js";
import { PROMPT_VERSION, SYSTEM } from "../src/pdf-read.js";

const PAGE = [
  "Mutual information [12] can measure the dependence in the spiking between two neurons:",
  "I(X; Y) := ∑",
  "x∈X",
  "y∈Y",
  "P(x, y) log2",
  "P(x|y)",
  "P(x) (1)",
  "where P(x, y) is the probability distribution of the joint state of X and Y, P(x) is the marginal",
  "probability of X, and P(x|y) is the conditional probability X = x given that Y = y.",
  "Transfer entropy [11] is well suited to measuring how much the past activity of one",
  "neuron (e.g., Xp) accounts for the immediate future activity of another neuron (e.g., Yt+1),",
  "conditioned on Y’s own past (Yp), with α = 0.05 and 10−3 s bins.",
].join("\n");

const pass: Pass0 = {
  pages: [{ page: 1, text: PAGE, words: PAGE.split(/\s+/).length, items: [] }],
  isScan: false,
  metaTitle: null,
  furniture: new Set(),
};

const para = (text: string): PdfRecord => ({
  page: 1,
  type: "paragraph",
  text,
  continues: false,
  uncertain: false,
});

/** The page as the new prompt asks for it: prose as printed, maths as delimited TeX. */
const AS_TEX = [
  "Mutual information [12] can measure the dependence in the spiking between two neurons:",
  String.raw`\[ I(X;Y) := \sum_{x \in X} \sum_{y \in Y} P(x,y) \log_2 \frac{P(x|y)}{P(x)} \] (1)`,
  String.raw`where \(P(x,y)\) is the probability distribution of the joint state of \(X\) and \(Y\), \(P(x)\) is the marginal probability of \(X\), and \(P(x|y)\) is the conditional probability \(X = x\) given that \(Y = y\).`,
  String.raw`Transfer entropy [11] is well suited to measuring how much the past activity of one neuron (e.g., \(X_p\)) accounts for the immediate future activity of another neuron (e.g., \(Y_{t+1}\)), conditioned on Y’s own past (\(Y_p\)), with \(\alpha = 0.05\) and \(10^{-3}\) s bins.`,
].map(para);

describe("a maths page transcribed as TeX", () => {
  it("passes the check, with no markup and nothing invented", () => {
    const result = check(AS_TEX, [1], pass);
    expect(result.overall.markup).toEqual([]);
    expect(result.overall.invented).toEqual([]);
    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.overall.recall).toBeGreaterThanOrEqual(0.95);
  });

  it("still flags TeX outside a recognised span — dollars, a missing closer, bare TeX", () => {
    for (const text of [
      String.raw`The ratio is $\frac{a}{b}$ here.`,
      String.raw`The variable is $x_1$ here.`,
      String.raw`The variable is $x$ here.`,
      String.raw`The display is $$x + 1$$ here.`,
      String.raw`The ratio is \(\frac{a}{b} here.`,
      String.raw`The ratio is \frac{a}{b} here.`,
    ]) {
      const result = check([...AS_TEX, para(text)], [1], pass);
      expect(result.overall.markup.length, text).toBeGreaterThan(0);
    }
  });

  it("still catches a number invented inside a span", () => {
    const result = check([...AS_TEX, para(String.raw`so \(\alpha = 0.07\) instead`)], [1], pass);
    expect(result.overall.invented).toContain("0.07");
  });

  it("still catches a subscript the model changed", () => {
    const changed = AS_TEX.map((r) => ({ ...r, text: r.text.replace("Y_{t+1}", "Y_{t+2}") }));
    expect(check(changed, [1], pass).overall.invented).toContain("Yt+2");
  });
});

describe("the comparison form of a span", () => {
  const words = (s: string) => mathsAsText(s).replace(/\s+/g, " ").trim();

  it("drops control words and structure and keeps the operands", () => {
    expect(words(String.raw`\(\frac{a}{b}\)`)).toBe("a b");
    expect(words(String.raw`\(\sum_{i=1}^{n} x_i\)`)).toBe("i=1 n xi");
  });

  it("glues a sub- or superscript to its base, as pdf.js does", () => {
    expect(words(String.raw`\(x_{1}\)`)).toBe("x1");
    expect(words(String.raw`\(x_{\mathrm{max}}\)`)).toBe("xmax");
    expect(words(String.raw`\(\log_2 n\)`)).toBe("log2 n");
    expect(words(String.raw`\(\alpha_1\)`)).toBe("α1");
  });

  it("keeps \\text prose, Greek letters and printed braces", () => {
    expect(words(String.raw`\(\text{for all } i\)`)).toBe("for all i");
    expect(words(String.raw`\(\beta\)`)).toBe("β");
    expect(words(String.raw`\(\{1\}\{2\}\)`)).toBe("{1}{2}");
  });

  it("drops an environment's name and an array's column spec, which are not on the page", () => {
    expect(words(String.raw`\[\begin{aligned} a &= b \\ c &= d \end{aligned}\]`)).toBe("a = b c = d");
    expect(words(String.raw`\[\begin{array}{cc} 1 & 2 \end{array}\]`)).toBe("1 2");
    expect(words(String.raw`\[\begin{aligned}[t] a &= b \end{aligned}\]`)).toBe("a = b");
    expect(words(String.raw`\[\begin{alignedat}{2} a &= b & c &= d \end{alignedat}\]`)).toBe(
      "a = b c = d",
    );
  });

  it("handles optional roots, escaped delimiters, line breaks and an invisible left delimiter", () => {
    expect(words(String.raw`\(\sqrt[3]{x}\)`)).toBe("[3] x");
    expect(words(String.raw`\(\left. x \right\}\)`)).toBe("x }");
    expect(words(String.raw`\(\{a \\ b\}\)`)).toBe("{a b}");
  });

  it("leaves text outside a span, and a dollar span, exactly as it was", () => {
    const prose = String.raw`Prose with $x_1$ and \frac{a}{b} in it.`;
    expect(mathsAsText(prose)).toBe(prose);
  });
});

/* G2 of the plan review: a span is read as words only if stage 1 would draw it
   as visible maths. Otherwise it stays text, and its control words are markup. */
describe("a span the reader would not see as its words stays text", () => {
  const sentence = "the omitted sentence of 1863";
  for (const tex of [
    String.raw`\(\phantom{${sentence}}\)`,
    String.raw`\(x\hspace{999em}\)`,
    String.raw`\[x\label{spya-aaaaaa}\tag{1}\]`,
    String.raw`\(\href{https://example.test}{x}\)`,
    String.raw`\(\fracc{a}{b}\)`,
    String.raw`\(\frac{a}{b\)`,
    String.raw`\(\frac{a}\)`,
    String.raw`\(\left( x\)`,
    String.raw`\[\begin{aligned} a \end{matrix}\]`,
    String.raw`\[\begin{tabular}{cc} a & b \end{tabular}\]`,
    String.raw`\(\text{a whole sentence of prose that was moved inside a formula for no reason}\)`,
    String.raw`\(\text{one two {three four five six seven eight nine ten eleven twelve}}\)`,
    String.raw`\(${"x+".repeat(2100)}x\)`,
  ]) {
    it(`leaves ${tex.slice(0, 50)} as source`, () => {
      expect(mathsAsText(tex)).toBe(tex);
    });
  }

  it("so the check still calls an invisible sentence markup", () => {
    const result = check([...AS_TEX, para(String.raw`\(\phantom{${sentence}}\)`)], [1], pass);
    expect(result.overall.markup).toContain(String.raw`\phantom`);
  });

  it("does not let a TeX comment make omitted source count as visible transcription", () => {
    const omitted = PAGE.replace(/\n/gu, " ");
    const hiddenInComment = para(`\\(x % ${omitted}\ny\\)`);
    const result = check([hiddenInComment], [1], pass);

    expect(result.ok).toBe(false);
    expect(result.overall.markup).toContain(String.raw`\(`);
  });
});

/* G3: the page-presence floor counts what a formula prints, not its command names. */
describe("a formula in place of a page of prose", () => {
  it("does not clear the three-word presence floor with \\frac, \\sum and \\sqrt", () => {
    const formula = { ...para(String.raw`\[\frac{1}{2}+\sum_{1}^{2}+\sqrt{4}\]`) };
    const issues = structuralIssues([formula], [1], pass);
    expect(issues.map((i) => i.code)).toContain("page-empty");
  });
});

/* G6: the masthead, the shelf and the tab print the title as a string. */
describe("a title or byline with maths in it", () => {
  it("reads as the words it prints, with nothing around them", () => {
    expect(plainMaths(String.raw`The \(p\)-adic numbers`)).toBe("The p-adic numbers");
    expect(plainMaths(String.raw`\(\alpha\) decay in \(x_{1}\) space`)).toBe("α decay in x1 space");
    expect(plainMaths("A title with no maths")).toBe("A title with no maths");
    expect(plainMaths("  A  title with no maths  ")).toBe("  A  title with no maths  ");
  });
});

describe("the prompt asks for TeX in the delimiters stage 1 draws", () => {
  it("holds the four delimiters with one backslash each, not zero or two", () => {
    for (const d of ["\\(", "\\)", "\\[", "\\]"]) expect(SYSTEM).toContain(` ${d}`);
    expect(SYSTEM).not.toContain("\\\\(");
    expect(SYSTEM).not.toMatch(/no LaTeX, no links/);
  });

  it("is named as a new version, so an article says which prompt read it", () => {
    expect(PROMPT_VERSION).toBe("pdf-v4");
  });
});
