/**
 * **The one quote check both anchor routes use** — src/quote-in-block.ts.
 *
 * Node, not jsdom: this runs on the server, and must not reach for a DOM. The
 * route tests (tests/maths-quote-route.test.ts) prove it is wired into both
 * checks; this pins the rule itself, and above all **that the fast path never
 * loads temml** — every block without a formula must behave exactly as it did.
 */
import temml from "temml";
import { describe, expect, it, vi } from "vitest";
import { temmlRenderer } from "../src/maths-tex.js";
import { foldSpace, placeQuoteInBlock } from "../src/quote-in-block.js";

const real = temmlRenderer(temml);
const loaded = () => vi.fn(async () => real);
const stored = (text: string, html = `<p>${text}</p>`) => ({ text, html });

const PLAIN = "The mutual information   is never negative.";
const MATHS = String.raw`We define \(I(X;Y) = \sum_{x} P(x) \log_2 \frac{P(x)}{Q(x)}\) and use it below.`;

describe("placeQuoteInBlock", () => {
  it("accepts a quote of the stored text, whitespace folded, without loading temml", async () => {
    const load = loaded();
    expect(await placeQuoteInBlock(stored(PLAIN), { quote: "information is never", start: 4 }, load)).toBe("ok");
    expect(load).not.toHaveBeenCalled();
  });

  it("refuses words not in a block with no formula, without loading temml", async () => {
    const load = loaded();
    expect(await placeQuoteInBlock(stored(PLAIN), { quote: "not here", start: 0 }, load)).toBe("not-found");
    expect(await placeQuoteInBlock(stored(PLAIN), { quote: "never", start: 999 }, load)).toBe("past-end");
    expect(load).not.toHaveBeenCalled();
  });

  it("accepts a quote across a formula as the reader saw it drawn", async () => {
    const load = loaded();
    /* The symbols a browser gives that formula, read off temml rather than
       written down: `I(X;Y)=∑xP(x)log2…`. */
    const quote = "define I(X;Y)=";
    expect(await placeQuoteInBlock(stored(MATHS), { quote, start: 3 }, load)).toBe("ok");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("still accepts the TeX source of the same formula", async () => {
    expect(await placeQuoteInBlock(stored(MATHS), { quote: String.raw`\(I(X;Y)`, start: 10 }, loaded())).toBe("ok");
  });

  it("refuses words in neither form", async () => {
    expect(await placeQuoteInBlock(stored(MATHS), { quote: "define J(X)", start: 3 }, loaded())).toBe("not-found");
  });

  it("does not accept rendered symbols when markup split the delimiters across text nodes", async () => {
    const text = String.raw`We define \(x^2\) now.`;
    const html = String.raw`<p>We define \(<em>x^2</em>\) now.</p>`;
    expect(await placeQuoteInBlock({ text, html }, { quote: "define x2", start: 3 }, loaded())).toBe(
      "not-found",
    );
  });

  for (const [name, html] of [
    ["existing MathML", String.raw`<p>diagram <math><mtext>\(x^2\)</mtext></math></p>`],
    ["SVG", String.raw`<p>diagram <svg><text>\(x^2\)</text></svg></p>`],
  ] as const) {
    it(`does not render TeX text inside ${name} on the server`, async () => {
      const text = String.raw`diagram \(x^2\)`;
      expect(await placeQuoteInBlock({ text, html }, { quote: "diagram x2", start: 0 }, loaded())).toBe(
        "not-found",
      );
    });
  }

  it("accepts the mixed form a reader sees when one formula renders and another is split", async () => {
    const text = String.raw`first \(x^2\), second \(y^2\).`;
    const html = String.raw`<p>first \(x^2\), second \(<em>y^2</em>\).</p>`;
    expect(
      await placeQuoteInBlock(
        { text, html },
        { quote: String.raw`x2, second \(y^2\)`, start: 6 },
        loaded(),
      ),
    ).toBe("ok");
  });

  it("bounds the offset by the longer of the two forms", async () => {
    /* A user macro that expands to more characters than it costs. */
    const text = String.raw`\(\def\a{xxxxxxxxxxxxxxxxxxxx}\a\a\a\) end`;
    const rendered = `${"x".repeat(60)} end`;
    expect(rendered.length).toBeGreaterThan(text.length);
    const start = rendered.indexOf(" end");
    expect(start).toBeGreaterThan(text.length);
    expect(await placeQuoteInBlock(stored(text), { quote: "xxxx end", start }, loaded())).toBe("ok");
    expect(await placeQuoteInBlock(stored(text), { quote: "xxxx end", start: rendered.length + 1 }, loaded())).toBe(
      "past-end",
    );
  });

  it("falls back to the stored text when temml will not load", async () => {
    const failing = vi.fn(async () => {
      throw new Error("offline");
    });
    expect(await placeQuoteInBlock(stored(MATHS), { quote: "define I(X;Y)=", start: 3 }, failing)).toBe("not-found");
    expect(await placeQuoteInBlock(stored(MATHS), { quote: "and use it", start: 3 }, failing)).toBe("ok");
  });

  it("folds whitespace the way both checks always did", () => {
    expect(foldSpace("  a \n\t b  ")).toBe("a b");
  });
});
