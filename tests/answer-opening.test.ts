/**
 * **How an answer begins, in plain words** — `answerOpening` in
 * src/answer-opening.ts. It is the one line a chat's mark shows under a Debate
 * claim, a Glossary entry and a Citations row, and the
 * collapsed floating chat's second line.
 *
 * The defect these were written against (queue item `qi-ezpyknnv`): that line
 * was the answer's raw first line, so the reader saw `**bold**` and
 * `[spya-k3m9qt]` in it.
 * docs/plans/261006f-chat-mark-latest-line-without-references-or-markdown.md.
 */
import { describe, expect, it } from "vitest";

import { answerOpening } from "../src/answer-opening.js";
import { summarise } from "../src/routes.js";
import type { ChatThread } from "../src/types.js";

describe("answerOpening", () => {
  it("leaves plain prose exactly as it was", () => {
    const plain = "He never really answers the question, which is the interesting part.";
    expect(answerOpening(plain)).toBe(plain);
  });

  it("takes a block reference out, brackets and all, and tidies the hole", () => {
    expect(answerOpening("Qualia are the felt qualities of experience [spya-k3m9qt].")).toBe(
      "Qualia are the felt qualities of experience.",
    );
    expect(answerOpening("The piece says so [spya-k3m9qt, spya-p7w2dn] twice.")).toBe(
      "The piece says so twice.",
    );
    expect(answerOpening("See spya-k3m9qt above.")).toBe("See above.");
  });

  it("takes the markdown out of bold, italics, code and a link, keeping their words", () => {
    expect(answerOpening("**Qualia** are the *felt* qualities of `experience`.")).toBe(
      "Qualia are the felt qualities of experience.",
    );
    expect(answerOpening("As [Dennett argues](https://example.com/quining), they are not.")).toBe(
      "As Dennett argues, they are not.",
    );
  });

  it("takes the marker off a heading, a list item and a quotation", () => {
    expect(answerOpening("## Short answer\n\nNo.")).toBe("Short answer");
    expect(answerOpening("- **First**, the bound holds [spya-k3m9qt].\n- Second, it is tight.")).toBe(
      "First, the bound holds.",
    );
    expect(answerOpening("1. One thing.\n2. Another.")).toBe("One thing.");
    expect(answerOpening("> The hard problem is hard.\n\nSo he says.")).toBe(
      "The hard problem is hard.",
    );
  });

  it("is the first line only", () => {
    expect(answerOpening("Because the sum telescopes.\n\nAnd a second paragraph.")).toBe(
      "Because the sum telescopes.",
    );
    expect(answerOpening("Because the sum telescopes.\nAnd a second line.")).toBe(
      "Because the sum telescopes.",
    );
  });

  it("skips an opening that has no words left, for the first one that has", () => {
    /* A line that is only a citation or a rule used to be the whole preview. */
    expect(answerOpening("[spya-k3m9qt]\n\nThe passage defines it.")).toBe("The passage defines it.");
    expect(answerOpening("---\n\n**Yes.**")).toBe("Yes.");
  });

  it("skips such a line inside one paragraph too", () => {
    /* One paragraph to the parser. Reading only its first line gave nothing,
       and the mark said "No answer yet" over an answer. GPT Sol, plan review F1. */
    expect(answerOpening("[spya-k3m9qt]\nThe answer is yes.")).toBe("The answer is yes.");
  });

  it("gives code and raw HTML their own characters, as the chat draws them", () => {
    expect(answerOpening("```js\nconst n = 2;\n```")).toBe("const n = 2;");
    expect(answerOpening("<div>\nWhich games?")).toBe("<div>");
  });

  it("survives markdown nested past anything a model writes", () => {
    /* The parser takes this; an uncapped recursive walk of its tree is a
       stack overflow. Same cap as src/web/Cited.tsx § MAX_DEPTH. */
    expect(answerOpening(`${">".repeat(4000)} deep`)).toContain("deep");
  });

  it("is undefined, not an empty string, when nothing has words", () => {
    expect(answerOpening("")).toBeUndefined();
    expect(answerOpening("  \n\n ")).toBeUndefined();
    expect(answerOpening("[spya-k3m9qt]")).toBeUndefined();
  });

  it("leaves an id inside a URL alone", () => {
    const text = "As at https://example.com/notes/spya-k3m9qt which explains it.";
    expect(answerOpening(text)).toContain("https://example.com/notes/spya-k3m9qt");
  });

  it("keeps a link's label, even when it contains an id-shaped string", () => {
    expect(answerOpening("[See spya-k3m9qt](https://example.com/source)")).toBe("See spya-k3m9qt");
    expect(answerOpening("[spya-k3m9qt][ref]\n\n[ref]: https://example.com/source")).toBe("spya-k3m9qt");
    expect(answerOpening("[`https://example.com/a*spya-k3m9qt`](https://example.com/source)")).toBe(
      "https://example.com/a*spya-k3m9qt",
    );
  });

  it("does not invent a citation by joining markdown leaves", () => {
    expect(answerOpening("[spya-](https://example.com/source)k3m9qt is literal.")).toBe(
      "spya-k3m9qt is literal.",
    );
    expect(answerOpening("spya-**k3m9qt** is literal.")).toBe("spya-k3m9qt is literal.");
  });

  it("keeps literal ids in code, image alt text and raw HTML", () => {
    expect(answerOpening("Use `spya-k3m9qt` as a key.")).toBe("Use spya-k3m9qt as a key.");
    expect(answerOpening("```\nspya-k3m9qt\n```")).toBe("spya-k3m9qt");
    expect(answerOpening("![spya-k3m9qt diagram](https://example.com/image.png)")).toBe("spya-k3m9qt diagram");
    expect(answerOpening('<div id="spya-k3m9qt">')).toBe('<div id="spya-k3m9qt">');
  });

  it("gives deeply nested markdown plain words without a recursive fallback", () => {
    expect(answerOpening(`${"> ".repeat(13)}**Deep** answer [spya-k3m9qt].`)).toBe("Deep answer.");
    expect(answerOpening(`${">".repeat(4000)} **Deep** answer [spya-k3m9qt].`)).toBe("Deep answer.");
  });

  it("decodes escapes and entities and handles CRLF and reference definitions", () => {
    expect(answerOpening("\\*literal\\* and &amp; entities.")).toBe("*literal* and & entities.");
    expect(answerOpening("[spya-k3m9qt]\r\n**Yes**\r\nNext.")).toBe("Yes");
    expect(answerOpening("[Label][ref]\n\n[ref]: https://example.com/source")).toBe("Label");
    expect(answerOpening("- [spya-k3m9qt]\n  - **Nested** answer.\n- Other.")).toBe("Nested answer.");
  });

  describe("a long answer is read only as far as its opening", () => {
    /* The parser's cost is the whole answer's length, and the summaries route
       pays it once per thread (GPT Sol, code review F8: 18 ms for 4 KB on the
       box). So only the head is parsed, cut at a blank line. */
    const filler = "Another **paragraph** with [a link](https://example.com).\n\n".repeat(60);

    it("gives the same opening", () => {
      expect(answerOpening(`**Opening** answer [spya-k3m9qt].\n\n${filler}`)).toBe("Opening answer.");
    });

    it("does not see a link definition past the cut, and shows the label's source instead", () => {
      /* The price, pinned so it is a decision and not a surprise. A short
         answer still resolves its definition (the test above this block). */
      expect(answerOpening(`Opening [Label][ref].\n\n${filler}[ref]: https://example.com/source`)).toBe(
        "Opening [Label][ref].",
      );
    });

    it("reads on when the head has no words", () => {
      expect(answerOpening(`${"---\n\n".repeat(500)}**Yes.**`)).toBe("Yes.");
    });
  });

  it("keeps an asterisk or a bracket that is not markdown", () => {
    expect(answerOpening("The bound is 2 * n [see above].")).toBe("The bound is 2 * n [see above].");
  });
});

describe("a thread's summary", () => {
  const AT = "2026-10-06T00:00:00.000Z";
  const thread = (answers: { text: string; status: "done" | "pending" }[]): ChatThread => ({
    id: "spya-thrd01",
    kind: "chat",
    title: "what is a quale",
    createdAt: AT,
    updatedAt: AT,
    messages: answers.flatMap((a, i) => [
      { id: `spya-q0000${i}`, role: "user" as const, text: "and?", createdAt: AT, status: "done" as const },
      { id: `spya-a0000${i}`, role: "assistant" as const, text: a.text, createdAt: AT, status: a.status },
    ]),
  });

  it("carries the newest finished answer's opening in plain words", () => {
    const s = summarise(
      thread([
        { text: "An older answer.", status: "done" },
        { text: "**Qualia** are the felt qualities of experience [spya-k3m9qt].\n\nMore.", status: "done" },
        { text: "Half of a th", status: "pending" },
      ]),
    );
    expect(s.lastLine).toBe("Qualia are the felt qualities of experience.");
    expect(s.turns).toBe(3);
  });

  it("carries the stored conversation gist without replacing the answer fallback", () => {
    const s = summarise({ ...thread([{ text: "The latest answer.", status: "done" }]), gist: "What the chat covered." });
    expect(s.gist).toBe("What the chat covered.");
    expect(s.lastLine).toBe("The latest answer.");
    expect("gist" in summarise(thread([]))).toBe(false);
  });

  it("never shows a Learn answer's hint the reader has not opened", () => {
    /* The body sits in an HTML block here, so a cut that skipped HTML made the
       hidden hint the preview. GPT Sol, plan review F3. */
    const learn: ChatThread = {
      ...thread([{ text: "<div>\nWhich games?\n\nHint: Chess and Go.", status: "done" }]),
      kind: "learn",
    };
    expect(summarise(learn).lastLine).toBe("<div>");
    const ruled: ChatThread = {
      ...thread([{ text: "---\n\nWhich games?\n\nHint: Chess and Go.", status: "done" }]),
      kind: "learn",
    };
    expect(summarise(ruled).lastLine).toBe("Which games?");
    /* Nothing but a hidden hint would be left: no line, not the hint. */
    const bare: ChatThread = {
      ...thread([{ text: "[spya-k3m9qt]?\n\nHint: Chess and Go.", status: "done" }]),
      kind: "learn",
    };
    expect("lastLine" in summarise(bare)).toBe(false);
  });

  it("omits the line when the answer has no words to show", () => {
    expect("lastLine" in summarise(thread([{ text: "[spya-k3m9qt]", status: "done" }]))).toBe(false);
    expect("lastLine" in summarise(thread([]))).toBe(false);
  });
});
