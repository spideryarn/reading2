/**
 * The blocks and marks we read out of a model's answer.
 *
 * The panel used to split an answer on blank lines and interpret `**bold**`,
 * and nothing else. So a bullet list — which the prompt in src/converse.ts
 * explicitly permits — arrived as one paragraph, and the only thing keeping it
 * off a single line reading `- one - two - three` was a `white-space: pre-wrap`
 * in the stylesheet with a comment apologising for itself. This is the parser
 * that fixed that (src/web/markdown.ts), plus the two inline marks that came
 * with it (src/web/citations.ts).
 *
 * **What these tests are really protecting is the ordinary answer.** Almost
 * every reply has no Markdown in it at all, and a parser that reads a `-` at
 * the start of a sentence as a bullet, or `2 * 3 * 4` as an italic run, would
 * damage far more answers than it improves. So most of what is below is about
 * what must NOT be interpreted.
 *
 * The DOM half is tests/chat-markdown-render.test.tsx.
 */
import { describe, expect, it } from "vitest";
import { parseBlocks } from "../src/web/markdown.js";
import { splitCode, splitEmphasis, splitInline, splitItalic } from "../src/web/citations.js";

/** The kinds a string parses to, in order — enough for most assertions. */
const kinds = (text: string) => parseBlocks(text).map((b) => b.kind);

/** The text of a paragraph block, for the "nothing was interpreted" cases. */
function onePara(text: string): string {
  const blocks = parseBlocks(text);
  expect(blocks).toHaveLength(1);
  const only = blocks[0];
  if (only?.kind !== "para") throw new Error(`expected one paragraph, got ${only?.kind}`);
  return only.text;
}

describe("an answer with no Markdown in it", () => {
  it("comes back as the paragraphs it went in as", () => {
    expect(parseBlocks("One thought.\n\nAnother thought.")).toEqual([
      { kind: "para", text: "One thought." },
      { kind: "para", text: "Another thought." },
    ]);
  });

  it("keeps a paragraph's own single newlines", () => {
    // `.chat-turn.model p` is `pre-wrap`, so these are breaks the reader sees.
    // Collapsing them here would silently reformat every answer that has them.
    expect(onePara("A line.\nAnd its continuation.")).toBe("A line.\nAnd its continuation.");
  });

  it("treats three or more newlines as one break, as the old splitter did", () => {
    expect(kinds("One.\n\n\n\nTwo.")).toEqual(["para", "para"]);
  });

  it("leaves a paragraph that merely starts with bold alone", () => {
    // `**Bold** thing` is the commonest opening a model writes, and a bullet
    // rule that did not require whitespace after the marker would eat it.
    expect(onePara("**Bold start** of a sentence.")).toBe("**Bold start** of a sentence.");
  });

  it("leaves a dash that is punctuation alone", () => {
    expect(onePara("He says so -- twice, in fact.")).toBe("He says so -- twice, in fact.");
  });

  it("leaves a hash that is not a heading alone", () => {
    expect(onePara("The #1 argument, he says.")).toBe("The #1 argument, he says.");
  });
});

describe("lists", () => {
  it("reads a bullet list as items, not as one paragraph", () => {
    expect(parseBlocks("- one\n- two\n- three")).toEqual([
      {
        kind: "list",
        ordered: false,
        start: 1,
        items: [
          [{ kind: "para", text: "one" }],
          [{ kind: "para", text: "two" }],
          [{ kind: "para", text: "three" }],
        ],
      },
    ]);
  });

  it("takes all three bullet characters", () => {
    for (const mark of ["-", "*", "+"]) {
      expect(kinds(`${mark} one\n${mark} two`)).toEqual(["list"]);
    }
  });

  it("keeps the number a numbered list starts at", () => {
    // A model continuing a list across two answers numbers from 3, and
    // renumbering it to 1 would contradict its own words.
    const [list] = parseBlocks("3. third\n4. fourth");
    expect(list).toMatchObject({ kind: "list", ordered: true, start: 3 });
  });

  it("nests by indentation", () => {
    const [list] = parseBlocks("- outer\n  - inner\n- next");
    expect(list).toMatchObject({
      kind: "list",
      items: [
        [{ kind: "para", text: "outer" }, { kind: "list", items: [[{ kind: "para", text: "inner" }]] }],
        [{ kind: "para", text: "next" }],
      ],
    });
  });

  it("gives an item its second paragraph", () => {
    const [list] = parseBlocks("- one\n\n  still one\n- two");
    expect(list).toMatchObject({
      items: [
        [
          { kind: "para", text: "one" },
          { kind: "para", text: "still one" },
        ],
        [{ kind: "para", text: "two" }],
      ],
    });
  });

  it("ends at a sentence in column zero rather than swallowing it", () => {
    // CommonMark's lazy continuation, refused on purpose: a closing sentence
    // after a list is a paragraph, and reading it as more of the last bullet
    // is the mistake a reader notices immediately.
    expect(kinds("- one\n- two\nAnd that is the argument.")).toEqual(["list", "para"]);
  });

  it("does not start a list from a switch of marker kind", () => {
    expect(kinds("- bullet\n1. number")).toEqual(["list", "list"]);
  });
});

describe("the other blocks", () => {
  it("reads a heading and its level", () => {
    expect(parseBlocks("### Why it matters")).toEqual([
      { kind: "heading", level: 3, text: "Why it matters" },
    ]);
  });

  it("needs a space after the hashes", () => {
    expect(onePara("#hashtag, apparently")).toBe("#hashtag, apparently");
  });

  it("reads a quote, and parses what is inside it", () => {
    expect(parseBlocks("> he writes\n> two lines")).toEqual([
      { kind: "quote", blocks: [{ kind: "para", text: "he writes\ntwo lines" }] },
    ]);
  });

  it("reads a fenced code block with its language", () => {
    expect(parseBlocks("```ts\nconst x = 1;\n```")).toEqual([
      { kind: "code", lang: "ts", text: "const x = 1;" },
    ]);
  });

  it("reads an UNCLOSED fence as code, because that is the streaming case", () => {
    // The opening fence arrives seconds before the closing one. A reader
    // watching an answer land should see code appearing in a code block, not
    // three backticks that turn into one later.
    expect(parseBlocks("```\nhalf a line")).toEqual([{ kind: "code", lang: "", text: "half a line" }]);
  });

  it("does not read a fence's contents as anything else", () => {
    const [code] = parseBlocks("```\n- not a bullet\n# not a heading\n```");
    expect(code).toEqual({ kind: "code", lang: "", text: "- not a bullet\n# not a heading" });
  });

  it("reads a rule, and prefers it to a bullet", () => {
    expect(kinds("---")).toEqual(["rule"]);
    expect(kinds("- - -")).toEqual(["rule"]);
    expect(kinds("***")).toEqual(["rule"]);
  });
});

/**
 * Every one of these is a defect a GPT Sol review found in the first version,
 * on 2026-08-31 — docs/plans/chat-markdown-review-sol.md. They are together
 * rather than filed under the shape each belongs to, because what they have in
 * common is the thing worth remembering: **six of the seven were text the model
 * wrote that never reached the reader**, which is the failure this whole file
 * is meant to be watching for and which I had already written two paragraphs
 * about before shipping them.
 */
describe("what the review caught", () => {
  it("keeps a hash that is part of the last word", () => {
    // `# Learn C#` came out as "Learn C". A closing sequence of hashes must be
    // preceded by whitespace; without that rule the language loses its name.
    expect(parseBlocks("# Learn C#")).toEqual([{ kind: "heading", level: 1, text: "Learn C#" }]);
  });

  it("still drops a real closing sequence", () => {
    expect(parseBlocks("## Title ##")).toEqual([{ kind: "heading", level: 2, text: "Title" }]);
  });

  it("does not let a fence with an info string close a block", () => {
    // The closer reused the opener's pattern, so ```js read as a close and the
    // `js` was deleted. A closing fence may carry nothing but the fence.
    const blocks = parseBlocks("```ts\nbody\n```js\nafter\n```");
    expect(blocks).toEqual([{ kind: "code", lang: "ts", text: "body\n```js\nafter" }]);
  });

  it("keeps a paragraph's leading spaces, which pre-wrap shows", () => {
    expect(onePara("  leading spaces")).toBe("  leading spaces");
  });

  it("parses a list with a great many blank lines in reasonable time", () => {
    /* Every blank line used to slice and rescan the whole remaining input, so
       a long answer was quadratic — and this runs again on every streamed
       token. 8,000 blank lines took 665ms before; the budget here is loose
       enough not to be flaky and tight enough to catch the old shape. */
    const gap = Array.from({ length: 8000 }, () => "").join("\n");
    const started = Date.now();
    parseBlocks(`- one\n${gap}\n- two`);
    expect(Date.now() - started).toBeLessThan(150);
  });

  it("refuses to recurse itself to death", () => {
    // 6,000 quote markers threw RangeError, which in the panel is not a bad
    // answer — it is the whole conversation gone. Depth is capped instead, and
    // what is past the cap stays as text.
    expect(() => parseBlocks(`${">".repeat(6000)} deep`)).not.toThrow();
    expect(() => parseBlocks(`${"- ".repeat(4000)}deep`)).not.toThrow();
  });
});

describe("code spans", () => {
  it("lifts a backticked run out of the prose", () => {
    expect(splitCode("use `foo(x)` here")).toEqual([
      { kind: "text", text: "use " },
      { kind: "code", text: "foo(x)" },
      { kind: "text", text: " here" },
    ]);
  });

  it("keeps what is inside away from every other mark", () => {
    // The whole point of the ordering: a code span is shown as written, so its
    // asterisks are asterisks and a block id in it is a string, not a chip.
    expect(splitCode("`**spya-k3m9qt**`")).toEqual([{ kind: "code", text: "**spya-k3m9qt**" }]);
  });

  it("leaves a lone backtick literal", () => {
    expect(splitCode("one ` alone")).toEqual([{ kind: "text", text: "one ` alone" }]);
  });
});

describe("italics", () => {
  const italics = (text: string) => splitItalic(text).filter((r) => r.italic).map((r) => r.text);

  it("reads both markers", () => {
    expect(italics("a *word* and a _word_")).toEqual(["word", "word"]);
  });

  it("leaves arithmetic alone", () => {
    expect(italics("2 * 3 * 4")).toEqual([]);
  });

  it("leaves an identifier's underscores alone", () => {
    expect(italics("some_variable_name")).toEqual([]);
  });

  it("leaves an unclosed bold pair alone", () => {
    // `splitEmphasis` deliberately leaves an unpartnered `**` literal, and
    // matching half of one here would quietly undo that.
    expect(italics("an unclosed ** marker")).toEqual([]);
  });

  it("takes a run of several words", () => {
    expect(italics("he calls it *the hard problem* throughout")).toEqual(["the hard problem"]);
  });

  it("treats an accented letter as a letter", () => {
    // `\w` is ASCII, so `café_naïve_été` had its middle word italicised and
    // both underscores deleted. The repo already had the right pattern for
    // this in src/term-match.ts.
    expect(italics("café_naïve_été")).toEqual([]);
    expect(italics("ça marche *très bien* ici")).toEqual(["très bien"]);
  });
});

describe("emphasis inside emphasis", () => {
  it("lets a bold run contain an italic one", () => {
    // `**this is *italic* too**` printed every one of its asterisks, because
    // the bold pattern refused any `*` in its contents at all.
    const runs = splitEmphasis("**this is *italic* too**");
    expect(runs).toEqual([{ text: "this is *italic* too", bold: true }]);
    // and the inner pair is then the italic pass's, as it always was.
    expect(splitItalic(runs[0]?.text ?? "").filter((r) => r.italic).map((r) => r.text)).toEqual([
      "italic",
    ]);
  });

  it("still leaves an unpartnered pair literal", () => {
    expect(splitEmphasis("an unclosed ** marker")).toEqual([
      { text: "an unclosed ** marker", bold: false },
    ]);
  });
});

describe("links and code spans in one paragraph", () => {
  it("keeps a link whose label contains code", () => {
    /* Code spans were lifted out before links were looked for, so
       `[run `npm test`](url)` was torn into five pieces and the reader saw the
       brackets and the raw address. Both marks are found over the same string
       now, and a link wins where they overlap. */
    const runs = splitInline("[run `npm test`](https://example.com/x)", true);
    expect(runs).toEqual([
      { kind: "link", text: "run `npm test`", url: "https://example.com/x" },
    ]);
  });

  it("does not make a link out of an address inside backticks", () => {
    // The reason code is looked for first at all. This must not regress while
    // fixing the case above.
    expect(splitInline("type `https://example.com/` in the box", true)).toEqual([
      { kind: "text", text: "type " },
      { kind: "code", text: "https://example.com/" },
      { kind: "text", text: " in the box" },
    ]);
  });
});
