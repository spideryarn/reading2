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

import { createQuoteGuard, type GuardStep, PARAGRAPH_HOLD_CAP, QUOTE_SPAN_CAP } from "../src/investigate-quote-guard.js";

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

/** Every two-way boundary, plus the most fragmented stream the guard can see. */
function runsAcrossSplits(text: string, allowed: readonly string[] = [...ARTICLE, TITLE]) {
  return [
    ...Array.from({ length: text.length + 1 }, (_, split) => run([text.slice(0, split), text.slice(split)], allowed)),
    run([...text], allowed),
  ];
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

  it("does not release an allowed prefix before a plural-possessive apostrophe", () => {
    /* The first `’` belongs to "dogs’ owners"; it is not the closing mark.
       Finding the shorter "the dogs" in the article must not release that
       prefix and let the unchecked rest of the source quotation through. */
    const text = "It says ‘the dogs’ owners fabricated every result’ here.";
    const allowed = ["The article discusses the dogs, but makes no such claim."];
    for (let split = 0; split <= text.length; split += 1) {
      const leak = run([text.slice(0, split), text.slice(split)], allowed);
      expect(leak.failed, `split at ${split}`).toEqual({ cause: "not-found" });
      expect(leak.released, `split at ${split}`).toBe("It says ");
    }
  });

  it("holds a curly-single quote and the prose after it to the end of the paragraph, then releases it", () => {
    /* Changed with the paragraph hold: this used to release at the first
       unambiguous close. A later `’` could still widen the span, so nothing
       after a `‘` is sent before the paragraph ends. */
    const guard = createQuoteGuard(ARTICLE);
    expect(guard.push("So ‘bigger is better’")).toEqual({ ok: true, text: "So " });
    expect(guard.push(" it says.")).toEqual({ ok: true, text: "" });
    expect(guard.end()).toEqual({ ok: true, text: "‘bigger is better’ it says." });
  });

  it("releases a verified curly-single quote containing a plural possessive", () => {
    const text = "It says ‘the dogs’ owners objected’";
    expect(run([text], ["The article says the dogs’ owners objected to the change."])).toEqual({
      released: text,
      failed: null,
    });
  });

  it("does not mistake ordinary right apostrophes or an s-ending quoted term for a possessive, across chunk splits", () => {
    const cases = [
      { text: "The authors’ claim is narrow.", allowed: ARTICLE },
      { text: "The article uses ‘fitness’ as its term.", allowed: ["The article defines fitness precisely."] },
      { text: "The article says ‘fitness’ is useful.", allowed: ["The article defines fitness precisely."] },
      { text: "It calls this ‘fitness’.", allowed: ["The article defines fitness precisely."] },
    ];
    for (const { text, allowed } of cases) {
      for (const [split, result] of runsAcrossSplits(text, allowed).entries()) {
        expect(result, `${JSON.stringify(text)}, split ${split}`).toEqual({ released: text, failed: null });
      }
    }
  });

  it("does not release an allowed s-ending term when a later close makes it the prefix of a source quote", () => {
    const text = "It says ‘fitness’ is a fabricated result’ here.";
    for (const [split, result] of runsAcrossSplits(text, ["The article defines fitness precisely."]).entries()) {
      expect(result.failed, `split ${split}`).toEqual({ cause: "not-found" });
      expect(result.released, `split ${split}`).toBe("It says ");
    }
  });

  it("refuses a later plural possessive after an s-ending term, but keeps two allowed quoted terms apart", () => {
    /* Changed with the paragraph hold: `authors’` is the farthest close
       before the next ‘, so "fitness’ is the authors" is checked and refused —
       the documented false refusal. Without the possessive, both pass. */
    const allowed = ["The article defines fitness and loss precisely."];
    const refused = "It says ‘fitness’ is the authors’ term, while ‘loss’ is ours.";
    for (const [split, result] of runsAcrossSplits(refused, allowed).entries()) {
      expect(result, `split ${split}`).toEqual({ released: "It says ", failed: { cause: "not-found" } });
    }
    const accepted = "It says ‘fitness’ is the term, while ‘loss’ is ours.";
    for (const [split, result] of runsAcrossSplits(accepted, allowed).entries()) {
      expect(result, `split ${split}`).toEqual({ released: accepted, failed: null });
    }
  });

  it("releases an allowed quoted term followed by unquoted prose when no later close arrives", () => {
    /* Changed with the paragraph hold: this was refused as ambiguous. With
       no later `’`, the only quote-shaped span is ‘the dogs’, which is
       allowed; "owners fabricated every result" is unquoted prose. */
    const text = "It says ‘the dogs’ owners fabricated every result";
    const allowed = ["The article discusses the dogs, but makes no such claim."];
    for (const [split, result] of runsAcrossSplits(text, allowed).entries()) {
      expect(result, `split ${split}`).toEqual({ released: text, failed: null });
    }
  });

  it("leaves apostrophes and straight single quotes alone", () => {
    const text = "The author’s view, and it's the paper's claim, isn’t the page’s.";
    expect(run([text])).toEqual({ released: text, failed: null });
  });

  it("toggles on the straight double quote", () => {
    const text = 'First "bigger is better" then "small & shallow" and done.';
    expect(run([text])).toEqual({ released: text, failed: null });
  });

  it("does not let mismatched straight and curly marks close a held span", () => {
    const curly = run(['It says “bigger is better"', ' and fabricated” now.']);
    expect(curly).toEqual({ released: "It says ", failed: { cause: "not-found" } });
    const straight = run(['It says "bigger is better”', ' and fabricated" now.']);
    expect(straight).toEqual({ released: "It says ", failed: { cause: "not-found" } });
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

/**
 * The paragraph hold for curly single quotes, and every line-break character
 * as a block-quote boundary — the rules that replaced the C-1/D-1 `’`
 * heuristics after the re-check (docs/plans/260930a-citations-investigate-guard-recheck-sol.md).
 * Each case runs under every two-way split and character by character.
 */
describe("the investigate quote guard: paragraph hold and line breaks", () => {
  const FITNESS = ["The article defines fitness precisely."];

  function expectEverySplit(text: string, allowed: readonly string[], expected: ReturnType<typeof run>) {
    for (const [split, result] of runsAcrossSplits(text, allowed).entries()) {
      expect(result, `${JSON.stringify(text)}, split ${split}`).toEqual(expected);
    }
  }

  it("guards a blockquote after a CR line ending (G-1)", () => {
    const text = "Safe prose\r> fabricated line";
    for (const chunks of [[text], ["Safe prose\r", "> fabricated line"], [...text]]) {
      expect(run(chunks, [])).toEqual({ released: "Safe prose\r", failed: { cause: "not-found" } });
    }
    expectEverySplit(text, [], { released: "Safe prose\r", failed: { cause: "not-found" } });
  });

  it("guards a blockquote indented by any Unicode space, not only space and tab (re-check 2, G-1)", () => {
    for (const indent of [" ", " ", "　", "​", "﻿", "  \t"]) {
      const text = `${indent}> fabricated line`;
      expectEverySplit(text, [], { released: "", failed: { cause: "not-found" } });
      const after = `Safe prose\n${indent}> fabricated line`;
      expectEverySplit(after, [], { released: "Safe prose\n", failed: { cause: "not-found" } });
    }
  });

  it("guards a blockquote after any invisible character, as a class (Opus check, item 2)", () => {
    for (const hidden of ["‎", "‏", "‪", "⁦", "؜", "­", "͏", "̀", "ㅤ", "⠀", "\u{E0020}"]) {
      const text = `Some prose here.\n${hidden}> fabricated line`;
      expectEverySplit(text, [], { released: "Some prose here.\n", failed: { cause: "not-found" } });
    }
  });

  it("guards a full-width block-quote mark", () => {
    for (const mark of ["＞", "﹥"]) {
      expectEverySplit(`${mark} fabricated line`, [], { released: "", failed: { cause: "not-found" } });
    }
  });

  it("holds the quotation marks of other languages (Opus check, item 1)", () => {
    const fabricated = "the results were entirely fabricated by the team";
    for (const [open, close] of [
      ["«", "»"],
      ["‹", "›"],
      ["„", "“"],
      ["„", "”"],
      ["「", "」"],
      ["『", "』"],
      ["＂", "＂"],
      ["〝", "〞"],
      ["»", "«"],
      ["”", "”"],
    ]) {
      const text = `Some prose here. ${open}${fabricated}${close} ok`;
      expectEverySplit(text, [], { released: "Some prose here. ", failed: { cause: "not-found" } });
    }
  });

  it("releases the article's own words in a language's own marks", () => {
    const text = "The piece says «The article defines fitness precisely.» and moves on.";
    expectEverySplit(text, ["The article defines fitness precisely."], { released: text, failed: null });
  });

  it("guards a blockquote after U+2028, U+2029 and CRLF line endings", () => {
    for (const lb of [" ", " ", "\r\n"]) {
      const text = `Safe prose${lb}> fabricated line`;
      expectEverySplit(text, [], { released: `Safe prose${lb}`, failed: { cause: "not-found" } });
    }
  });

  it("accepts an s-ending quoted term followed by any word (G-2)", () => {
    const text = "The article says ‘fitness’ means health.";
    expectEverySplit(text, ["fitness"], { released: text, failed: null });
  });

  it("accepts an s-ending quoted term followed by long prose (G-3)", () => {
    const text = `The article says ‘fitness’ is ${"ordinary prose ".repeat(35)}`;
    expectEverySplit(text, ["fitness"], { released: text, failed: null });
  });

  it("accepts a title followed by a comma, and a sentence-final close", () => {
    expectEverySplit("He cites ‘Principia’, then moves on.", ["Principia"], {
      released: "He cites ‘Principia’, then moves on.",
      failed: null,
    });
    expectEverySplit("It calls this ‘fitness’", FITNESS, { released: "It calls this ‘fitness’", failed: null });
  });

  it("refuses the plural-possessive attack: the farthest close covers the whole span (C-1)", () => {
    expectEverySplit("It says ‘the dogs’ owners fabricated every result’ here.", ["the dogs"], {
      released: "It says ",
      failed: { cause: "not-found" },
    });
  });

  it("refuses a quoted term followed by a plural possessive in the same paragraph — a documented false refusal", () => {
    /* The farthest close after ‘ is authors’, so the span checked is
       "fitness’ and the authors", which is not in the article. Accepted: it
       costs a retry, and telling this apart from C-1 is what kept leaking. */
    expectEverySplit("It says ‘fitness’ and the authors’ claim is narrow.", FITNESS, {
      released: "It says ",
      failed: { cause: "not-found" },
    });
  });

  it("still guards a straight double quote inside a held paragraph", () => {
    const text = 'It says ‘fitness’ and "fabricated words" here.';
    expectEverySplit(text, FITNESS, { released: "It says ‘fitness’ and ", failed: { cause: "not-found" } });
  });

  it("still guards a block-quote line inside a held paragraph", () => {
    const text = "It says ‘fitness’ is it.\n> fabricated line\n\nMore.";
    expectEverySplit(text, FITNESS, { released: "It says ‘fitness’ is it.\n", failed: { cause: "not-found" } });
  });

  it("releases the held paragraph at a blank line, and guards what follows it afresh", () => {
    const guard = createQuoteGuard(FITNESS);
    expect(guard.push("It says ‘fitness’ is it.")).toEqual({ ok: true, text: "It says " });
    expect(guard.push("\r\n\r\nNext ")).toEqual({ ok: true, text: "‘fitness’ is it.\r\n\r\nNext " });
    expect(guard.push("‘made up’ words")).toEqual({ ok: true, text: "" });
    expect(guard.end()).toEqual({ ok: false, cause: "not-found", text: "" });
    const text = "It says ‘fitness’ is it.\n \n> fabricated";
    expectEverySplit(text, FITNESS, { released: "It says ‘fitness’ is it.\n \n", failed: { cause: "not-found" } });
  });

  it("never holds a ’ that has no ‘ before it in the paragraph", () => {
    const guard = createQuoteGuard([]);
    expect(guard.push("The authors’ claim, what’s more, ends’")).toEqual({
      ok: true,
      text: "The authors’ claim, what’s more, ends’",
    });
  });

  it("refuses a ‘ with no candidate close as unclosed", () => {
    expectEverySplit("It says ‘fitness and what’s more", FITNESS, {
      released: "It says ",
      failed: { cause: "unclosed" },
    });
  });

  it(`refuses a paragraph held past ${PARAGRAPH_HOLD_CAP} characters as unclosed, without waiting for the end`, () => {
    const guard = createQuoteGuard(["the dogs"]);
    expect(guard.push("‘the dogs’ ")).toEqual({ ok: true, text: "" });
    expect(guard.push("x".repeat(PARAGRAPH_HOLD_CAP - "‘the dogs’ ".length))).toEqual({ ok: true, text: "" });
    expect(guard.push("x")).toEqual({ ok: false, cause: "unclosed", text: "" });
  });
});
