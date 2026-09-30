/**
 * **The in-stream quote guard for Citations' *Investigate*** —
 * src/investigate-quote-guard.ts, docs/plans/260930a-citations-investigate-one-work-on-demand.md
 * § No quotes from sources, checked inside the stream.
 *
 * The property: **no quote-shaped text reaches the reader before code has
 * found it in an allowed text.** So every case here feeds deltas and checks
 * what was *released*, not only the verdict — a guard that said "stop" after
 * releasing the span would pass a verdict-only test.
 */
import { describe, expect, it } from "vitest";

import { createQuoteGuard, type GuardStep, QUOTE_SPAN_CAP } from "../src/investigate-quote-guard.js";

const ARTICLE = [
  "GPT-3's architecture is small & shallow compared to what's possible, and the curve keeps going.",
  "Hernandez and Brown measured the algorithmic efficiency of neural networks.",
  "The scaling hypothesis says bigger is better.",
];
const TITLE = "Measuring the Algorithmic Efficiency of Neural Networks";

/** Feed the deltas; return what was released, and the first failure if any. */
function run(deltas: string[], allowed: readonly string[] = [...ARTICLE, TITLE]) {
  const guard = createQuoteGuard(allowed);
  let released = "";
  let failed: { cause: Extract<GuardStep, { ok: false }>["cause"] } | null = null;
  for (const d of deltas) {
    const step = guard.push(d);
    released += step.text;
    if (!step.ok) {
      failed = { cause: step.cause };
      break;
    }
  }
  if (!failed) {
    const step = guard.end();
    released += step.text;
    if (!step.ok) failed = { cause: step.cause };
  }
  return { released, failed };
}

describe("the investigate quote guard", () => {
  it("passes plain prose through as it arrives, without holding it", () => {
    const guard = createQuoteGuard(ARTICLE);
    expect(guard.push("Does it back the claim?\nThe abstract on ")).toEqual({
      ok: true,
      text: "Does it back the claim?\nThe abstract on ",
    });
    expect(guard.push("arxiv.org describes a network.")).toEqual({ ok: true, text: "arxiv.org describes a network." });
    expect(guard.end()).toEqual({ ok: true, text: "" });
  });

  it("releases the work's own title in quotation marks (the probe's first false positive)", () => {
    const text = `The paper, titled "${TITLE}," is described on openai.com as finding a trend.`;
    const { released, failed } = run([text.slice(0, 20), text.slice(20, 50), text.slice(50)]);
    expect(failed).toBeNull();
    expect(released).toBe(text);
  });

  it("releases an article quote with a comma inside the closing mark (the probe's second)", () => {
    const text = `when it says the architecture is “small & shallow compared to what’s possible,” implying more.`;
    const { released, failed } = run([text]);
    expect(failed).toBeNull();
    expect(released).toBe(text);
  });

  it("stops at a quotation from a source, and never releases the quoted words", () => {
    const { released, failed } = run([
      "The abstract on arxiv.org says the model ",
      '"achieves state of the art on every ',
      'benchmark we tried" and more.',
    ]);
    expect(failed).toEqual({ cause: "not-found" });
    expect(released).toBe("The abstract on arxiv.org says the model ");
    expect(released).not.toContain("achieves");
  });

  it("holds from the opening mark even when the delta ends right after it", () => {
    const guard = createQuoteGuard(ARTICLE);
    expect(guard.push('It says "')).toEqual({ ok: true, text: "It says " });
    expect(guard.push("bigger is")).toEqual({ ok: true, text: "" });
    expect(guard.push(' better" plainly.')).toEqual({ ok: true, text: '"bigger is better" plainly.' });
  });

  it("stops an opening mark that is never closed, at the end of the stream", () => {
    const { released, failed } = run(["The page says ", '"bigger is better and so on']);
    expect(failed).toEqual({ cause: "unclosed" });
    expect(released).toBe("The page says ");
  });

  it(`stops a held span once it runs past ${QUOTE_SPAN_CAP} characters, without waiting for the end`, () => {
    const guard = createQuoteGuard(ARTICLE);
    expect(guard.push("Before “")).toEqual({ ok: true, text: "Before " });
    expect(guard.push("x".repeat(QUOTE_SPAN_CAP - 1))).toEqual({ ok: true, text: "" });
    expect(guard.push("yy")).toEqual({ ok: false, cause: "unclosed", text: "" });
  });

  it("guards curly single quotation marks (U+2018 … U+2019)", () => {
    expect(run(["It is ‘bigger is better’ here."]).failed).toBeNull();
    const source = run(["The page calls it ‘a landmark result for the field’ today."]);
    expect(source.failed).toEqual({ cause: "not-found" });
    expect(source.released).toBe("The page calls it ");
  });

  it("does not let an apostrophe close a single-quoted span early", () => {
    /* ‘what’s possible’ — the ’ after "what" is an apostrophe (a letter
       follows), so the span is the whole phrase, and it is the article's. */
    expect(run(["The phrase ‘compared to what’s possible’ is the article's."]).failed).toBeNull();
    /* The leak this closes: a span "a source" that is fine, then an
       unchecked tail. The whole span must be checked, and it is not there. */
    const leak = run(["It says ‘the scaling hypothesis’s critics are all wrong’ now."]);
    expect(leak.failed).toEqual({ cause: "not-found" });
    expect(leak.released).toBe("It says ");
  });

  it("waits for the next delta when a single-quoted span's ’ is the last character", () => {
    const guard = createQuoteGuard(ARTICLE);
    expect(guard.push("So ‘bigger is better’")).toEqual({ ok: true, text: "So " });
    expect(guard.push(" it says.")).toEqual({ ok: true, text: "‘bigger is better’ it says." });
  });

  it("leaves apostrophes and straight single quotes alone", () => {
    const text = "The author’s view, and it's the paper's claim, isn’t the page’s.";
    expect(run([text])).toEqual({ released: text, failed: null });
  });

  it("toggles on the straight double quote", () => {
    const text = 'First "bigger is better" then "small & shallow" and done.';
    expect(run([text])).toEqual({ released: text, failed: null });
  });

  it("stops a block-quote line whose words are not allowed, and releases none of it", () => {
    const { released, failed } = run([
      "Does it back the claim?\n",
      "> We find that performance scales ",
      "smoothly with compute.\nMore prose.",
    ]);
    expect(failed).toEqual({ cause: "not-found" });
    expect(released).toBe("Does it back the claim?\n");
  });

  it("holds an indented block-quote line too, including across the delta that ends at the indent", () => {
    const guard = createQuoteGuard(ARTICLE);
    expect(guard.push("Lead\n  ")).toEqual({ ok: true, text: "Lead\n" });
    expect(guard.push("> made up words\n")).toEqual({ ok: false, cause: "not-found", text: "" });
  });

  it("releases a line that merely contains > and does not start with it", () => {
    const text = "Here x > y holds, and\nthat is all.";
    expect(run([text])).toEqual({ released: text, failed: null });
  });

  it("does not treat an empty pair of quotation marks as a quote", () => {
    expect(run(['An empty "" pair.'])).toEqual({ released: 'An empty "" pair.', failed: null });
  });

  it("stays failed after a failure, and never releases anything more", () => {
    const guard = createQuoteGuard(ARTICLE);
    expect(guard.push('ok "not in the article" then')).toEqual({ ok: false, cause: "not-found", text: "ok " });
    expect(guard.push(" more plain prose")).toEqual({ ok: false, cause: "not-found", text: "" });
    expect(guard.end()).toEqual({ ok: false, cause: "not-found", text: "" });
  });

  it("checks against the allowed texts it was given, and nothing else", () => {
    const quote = "a verified sentence from the extract that Look it up checked";
    const text = `The abstract on arxiv.org says "${quote}" here.`;
    expect(run([text]).failed).toEqual({ cause: "not-found" });
    expect(run([text], [...ARTICLE, quote]).failed).toBeNull();
  });
});
