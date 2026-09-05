/**
 * What stage 3 puts in a block's **`text`** — the field nobody looks at and
 * everything reads.
 *
 * `html` is what the reading view renders (src/web/TableView.tsx renders
 * `block.html`), so the two bugs pinned here were invisible on the page and
 * corrupted everything downstream of it: word counts, search, every AI prompt,
 * and the ToC's decision about what deserves a row.
 *
 * See docs/plans/260904e-extraction-repair-evals-and-llm-post-processing.md § A.
 */
import { describe, expect, it } from "vitest";
import { idChurn, splitIntoBlocks } from "../src/blocks.js";
import type { Block } from "../src/types.js";

describe("a code block keeps its lines", () => {
  /**
   * The bug, and it has been there since `extractText` was written: the function
   * ends `.replace(/\s+/g, " ")`, which is right for prose — where a newline in
   * the markup is not a newline in the sentence — and destroys the only thing
   * code has. Python's `itertools` recipes arrived as one unbroken line; so did
   * RFC 8259's ABNF and every one of Whitman's 400 poems, which Project
   * Gutenberg sets in `<pre>`.
   */
  const CODE = `<article><pre><code>def total(rows):
    n = 0
    for row in rows:
        n += row
    return n
</code></pre></article>`;

  const { blocks } = splitIntoBlocks(CODE);
  const code = blocks.find((b) => b.kind === "code")!;

  it("keeps the newlines", () => {
    expect(code.text.split("\n")).toHaveLength(5);
  });

  it("keeps the indentation, at every depth", () => {
    const lines = code.text.split("\n");
    expect(lines[1]).toBe("    n = 0");
    expect(lines[3]).toBe("        n += row");
  });

  it("drops the blank line the author left at the end, and nothing else", () => {
    expect(code.text.startsWith("def total")).toBe(true);
    expect(code.text.endsWith("return n")).toBe(true);
  });

  it("reads a <br> inside a <pre> as the line break it is", () => {
    const { blocks: b } = splitIntoBlocks(
      "<article><pre>first line<br>second line</pre></article>",
    );
    expect(b.find((x) => x.kind === "code")!.text).toBe("first line\nsecond line");
  });

  it("reads a highlighter's per-line <div> as a line break too", () => {
    // Prism, Shiki and friends wrap each line in its own element; the text
    // nodes then carry no newline at all.
    const { blocks: b } = splitIntoBlocks(
      "<article><pre><div>alpha</div><div>beta</div></pre></article>",
    );
    expect(b.find((x) => x.kind === "code")!.text).toBe("alpha\nbeta");
  });

  /**
   * **A blank line is content, and this test exists because it was briefly
   * deleted.**
   *
   * The first version of `codeText` filtered blank lines out, on the argument
   * that `articleWithIds` and `articleText` (src/article-prompt.ts) join blocks
   * with `"\n\n"`, so a block carrying one would split itself in two inside a
   * prompt and the second half would arrive with no `[i] spya-…:` prefix.
   *
   * That argument did not survive review (GPT Sol, 2026-09-05). Nothing in
   * production parses those prompts by splitting on `"\n\n"`, and the two stages
   * that cite block ids as *evidence* — Ideas and Quiz — validate that the text
   * they quote occurs in the block they cite, so the misattribution described
   * cannot land there. What the deletion did cost was measured: **223 of 674**
   * code blocks on the fixture corpus have an internal blank line, and **153 of
   * Whitman's 400 poem blocks** lost their stanza breaks. A stanza break is
   * meaning.
   *
   * The residual risk is real but narrow and is not designed around here: Sketch
   * validates the id alone, so a model could in principle hang the second half
   * of a split code block on the following id. See `codeText` in src/blocks.ts.
   */
  it("keeps a blank line, because a stanza break and a paragraph of code are meaning", () => {
    const { blocks: b } = splitIntoBlocks(
      "<article><pre><code>first();\n\nsecond();</code></pre></article>",
    );
    expect(b.find((x) => x.kind === "code")!.text).toBe("first();\n\nsecond();");
  });

  it("keeps a run of blank lines exactly as the author left it", () => {
    const { blocks: b } = splitIntoBlocks(
      "<article><pre><code>first();\n\n\nsecond();</code></pre></article>",
    );
    expect(b.find((x) => x.kind === "code")!.text).toBe("first();\n\n\nsecond();");
  });

  /**
   * Whitman, as Project Gutenberg sets him: one `<pre>` per poem, stanzas
   * separated by a blank line. 153 of the 400 poem blocks on the corpus have at
   * least one, and this is that shape in miniature.
   */
  it("keeps a stanza break", () => {
    const { blocks: b } = splitIntoBlocks(
      "<article><pre>I celebrate myself, and sing myself,\nAnd what I assume you shall assume,\n\nMy tongue, every atom of my blood,\nForm'd from this soil, this air.</pre></article>",
    );
    expect(b.find((x) => x.kind === "code")!.text.split("\n\n")).toHaveLength(2);
  });

  /**
   * **An inserted break where the source already had one is the same break.**
   *
   * `codeText` puts a separator in front of every block-level element, because a
   * highlighter that wraps each line in its own `<div>` leaves no newline in the
   * text at all. Once blank lines are kept, that insertion can fabricate one:
   * markup indented as `<div>a</div>\n<div>b</div>` carries a real newline
   * *between* the divs, and a naive insertion would render it `a\n\nb` — a blank
   * line the page does not show and the author did not write.
   */
  it("does not invent a blank line out of the newline between two per-line divs", () => {
    const { blocks: b } = splitIntoBlocks(
      "<article><pre><div>alpha</div>\n<div>beta</div></pre></article>",
    );
    expect(b.find((x) => x.kind === "code")!.text).toBe("alpha\nbeta");
  });

  it("keeps the indentation after a <br>, which the break-run collapse could have eaten", () => {
    const { blocks: b } = splitIntoBlocks(
      "<article><pre>if x:<br>    return 1</pre></article>",
    );
    expect(b.find((x) => x.kind === "code")!.text).toBe("if x:\n    return 1");
  });

  /**
   * **The two shapes the `<pre>` branch does not reach**, pinned so they are a
   * documented limitation rather than a surprise — and so that whoever fixes
   * either has to change an expectation rather than nothing. GPT Sol,
   * 2026-09-05, who was right that "preserves code layout" was too broad a
   * claim. See `codeText` in src/blocks.ts.
   */
  it("still loses the layout of code inside a <blockquote>, because the quote is terminal", () => {
    const { blocks: b } = splitIntoBlocks(
      "<article><blockquote><pre><code>def f():\n    return 1</code></pre></blockquote></article>",
    );
    const quote = b.find((x) => x.kind === "quote")!;
    // `collectElements` does not descend into a blockquote, so `extractText`
    // sees a BLOCKQUOTE and takes the prose branch: newline and indentation go
    // together.
    expect(quote.text).toBe("def f(): return 1");
  });

  it("gives a <table> inside a <pre> one cell per line, and no row structure at all", () => {
    const { blocks: b } = splitIntoBlocks(
      "<article><pre><table><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></table>tail</pre></article>",
    );
    // Cells land on their own lines; the row boundary is indistinguishable from
    // the cell boundary, and `tail` is glued to the last cell because nothing
    // inserts a break *after* an element.
    expect(b.find((x) => x.kind === "code")!.text).toBe("a\nb\nc\ndtail");
  });

  it("leaves prose alone — a newline in the markup is not one in the sentence", () => {
    const { blocks: b } = splitIntoBlocks(
      "<article><p>One sentence,\n  then the rest of it.</p></article>",
    );
    expect(b[0]!.text).toBe("One sentence, then the rest of it.");
  });

  it("does not churn a code block's id across a re-extraction", () => {
    const first = splitIntoBlocks(CODE);
    const again = splitIntoBlocks(CODE, first.blocks);
    expect(idChurn(first.blocks, again.blocks).reminted).toBe(0);
  });
});

/**
 * **The transition this change actually has to survive: a stored article split
 * before the `<pre>` branch existed, re-extracted after it.**
 *
 * The test above runs the new extraction twice, which is a different and much
 * easier question — GPT Sol's finding 4, 2026-09-05. It proves nothing about the
 * old-to-new step, and Sol demonstrated that by removing the whitespace
 * normalisation from `exactKey` and `legacyKey` in a temporary copy: that test
 * stayed green while a constructed legacy case re-minted every id.
 *
 * So `legacyBlocks` below is what the store really holds for every code-bearing
 * article ingested before 2026-09-05 — the same blocks, the same `html`, and a
 * `text` that `extractText` had flattened with `/\s+/g → " "`. That is the
 * *only* difference, because the `<pre>` change touched `text` and nothing else.
 *
 * Why it carries: `exactKey` normalises whitespace itself before hashing, so the
 * collapsed legacy text and the new multi-line text spell the same key. If that
 * ever stops being true, every code-bearing article re-mints on its next
 * re-extraction and takes every comment, highlight and saved position anchored
 * there with it (docs/project/block-ids.md).
 */
describe("a code block's id survives the old-to-new transition", () => {
  /** `extractText` as it was before the `<pre>` branch: one flat line. */
  const asStoredBefore = (blocks: Block[]): Block[] =>
    blocks.map((b) => ({ ...b, text: b.text.replace(/\s+/gu, " ").trim() }));

  const PAGE = `<article><p>Before.</p><pre><code>def total(rows):
    n = 0
    return n</code></pre><p>Between.</p><pre><code>def total(rows):
    n = 0
    return n</code></pre><p>After.</p></article>`;

  /**
   * **Two identical code blocks, deliberately**, because that is what forces the
   * question through pass one.
   *
   * A lone block would still carry on the folded key even with the exact key
   * broken, so a single-`<pre>` fixture cannot tell a working compatibility path
   * from a broken one. Repeated text makes the folded bucket ambiguous, and an
   * ambiguous bucket re-mints by design (`carryOverIds` in src/blocks.ts) — so
   * with the exact key broken these two ids go, which is exactly the failure Sol
   * constructed.
   */
  it("carries both ids when the previous run's text was whitespace-collapsed", () => {
    const legacy = asStoredBefore(splitIntoBlocks(PAGE).blocks);
    expect(
      legacy.filter((b) => b.kind === "code").map((b) => b.text),
      "the legacy fixture must really be flattened, or this tests nothing",
    ).toEqual(["def total(rows): n = 0 return n", "def total(rows): n = 0 return n"]);

    const now = splitIntoBlocks(PAGE, legacy);
    expect(idChurn(legacy, now.blocks)).toEqual({
      before: legacy.length,
      after: legacy.length,
      carried: legacy.length,
      reminted: 0,
      lost: 0,
    });
    // And each id landed back on its own passage rather than swapping with its twin.
    expect(now.blocks.map((b) => b.id)).toEqual(legacy.map((b) => b.id));
    expect(now.blocks.filter((b) => b.kind === "code")[0]!.text).toContain("\n    n = 0");
  });

  /**
   * The same transition for a block whose blank lines the first version of
   * `codeText` deleted and this one keeps — a Whitman stanza, in miniature. Its
   * stored text is the flattened form either way, so the id has to carry across
   * *both* revisions of the function.
   */
  it("carries an id across the blank-line revert as well", () => {
    const STANZA = `<article><pre>I celebrate myself, and sing myself,

My tongue, every atom of my blood.</pre></article>`;
    const legacy = asStoredBefore(splitIntoBlocks(STANZA).blocks);
    const now = splitIntoBlocks(STANZA, legacy);
    expect(now.blocks[0]!.text).toContain("\n\n");
    expect(idChurn(legacy, now.blocks).reminted).toBe(0);
  });
});

describe("a block with nothing readable in it is not gistable", () => {
  it("was already right about ordinary whitespace", () => {
    const { blocks } = splitIntoBlocks("<article><p>   \n  </p><p>Real prose here.</p></article>");
    const empty = blocks.find((b) => b.text.trim() === "");
    expect(empty?.gistable).toBe(false);
  });

  /**
   * A zero-width space is not `\s`, so `text.length === 0` was false and the
   * block went to the ToC, the summaries and the tree as content. One French
   * Wikipedia page carries 181 of these.
   */
  it("is now right about a zero-width space", () => {
    const { blocks } = splitIntoBlocks("<article><p>​</p><p>Real prose here.</p></article>");
    const zero = blocks.find((b) => b.text.includes("​"));
    expect(zero, "the zero-width block should still be a block").toBeDefined();
    expect(zero!.gistable).toBe(false);
  });

  it("is right about the rest of the invisible family", () => {
    // ZWNJ, ZWJ, word joiner, BOM, soft hyphen. Found by position, not by text:
    // a leading U+FEFF does not survive jsdom's parser at all, so that block
    // arrives with an empty string and was already `gistable: false`.
    for (const ch of ["‌", "‍", "⁠", "﻿", "­"]) {
      const { blocks } = splitIntoBlocks(`<article><p>${ch}</p><p>Prose.</p></article>`);
      expect(blocks.map((b) => b.text.trim()), JSON.stringify(ch)).toHaveLength(2);
      expect(blocks[0]!.gistable, JSON.stringify(ch)).toBe(false);
      expect(blocks[1]!.gistable, JSON.stringify(ch)).toBe(true);
    }
  });

  /**
   * **It is still a block, and it still draws a row.** `gistable: false` stops
   * the ToC, the summaries and the tree writing about it; it does not remove it
   * from the prose, which renders every block in the list
   * (src/web/TableView.tsx). Fixing the blank row is a rendering decision and
   * deliberately not part of this change — pinned here so that whoever makes it
   * has to change an expectation rather than nothing.
   */
  it("is still emitted as a block, blank row and all", () => {
    const { blocks } = splitIntoBlocks("<article><p>​</p><p>Real prose here.</p></article>");
    expect(blocks).toHaveLength(2);
  });

  it("does not touch a block that has a zero-width space inside real words", () => {
    const { blocks } = splitIntoBlocks("<article><p>Deep​learning is the topic.</p></article>");
    expect(blocks[0]!.gistable).toBe(true);
  });
});

describe("idChurn", () => {
  const b = (id: string) => ({ id });

  it("counts what carried and what was minted fresh", () => {
    const churn = idChurn([b("spya-a"), b("spya-b")], [b("spya-a"), b("spya-c")]);
    expect(churn).toEqual({ before: 2, after: 2, carried: 1, reminted: 1, lost: 1 });
  });

  it("calls a first run all-minted rather than dividing by nothing", () => {
    expect(idChurn([], [b("spya-a")])).toEqual({
      before: 0, after: 1, carried: 0, reminted: 1, lost: 0,
    });
  });

  it("counts a block that lost its id as lost, not as carried", () => {
    expect(idChurn([b("spya-a"), b("spya-b")], [b("spya-a")])).toEqual({
      before: 2, after: 1, carried: 1, reminted: 0, lost: 1,
    });
  });
});
