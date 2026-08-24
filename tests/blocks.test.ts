/**
 * Pipeline stage 3 — src/blocks.ts. Two things matter here and both are
 * silent when they break: what counts as a block (docs/project/architecture.md),
 * and whether an id survives re-extraction (docs/project/block-ids.md).
 */
import { describe, expect, it } from "vitest";
import { splitIntoBlocks } from "../src/blocks.js";
import { isSpideryarnId } from "../src/ids.js";

const ARTICLE = `
  <article>
    <h1>Soul Machine</h1>
    <p>The first paragraph carries the argument.</p>
    <p>The second paragraph continues it at some length.</p>
    <ul>
      <li>Outer item
        <ul><li>Inner item</li></ul>
      </li>
    </ul>
    <figure><img src="/diagram.png" alt="a diagram"></figure>
    <p>Figure 1: A modern version of a McCulloch-Pitts neuron.</p>
    <pre><code>const x = 1;</code></pre>
    <hr>
  </article>
`;

describe("splitIntoBlocks", () => {
  const { blocks, stats } = splitIntoBlocks(ARTICLE);
  const byText = (needle: string) => blocks.find((b) => b.text.includes(needle))!;

  it("gives every block a valid id, all distinct", () => {
    expect(blocks.length).toBeGreaterThan(0);
    for (const b of blocks) expect(isSpideryarnId(b.id), b.text).toBe(true);
    expect(new Set(blocks.map((b) => b.id)).size).toBe(blocks.length);
  });

  it("counts what it minted", () => {
    expect(stats.total).toBe(blocks.length);
    expect(stats.minted).toBe(blocks.length);
    expect(stats.reused + stats.carried).toBe(0);
  });

  it("emits blocks in document order", () => {
    const order = blocks.map((b) => b.text);
    expect(order.indexOf("Soul Machine")).toBeLessThan(order.indexOf("The first paragraph carries the argument."));
  });

  it("classifies a heading with its level", () => {
    const h = byText("Soul Machine");
    expect(h.kind).toBe("heading");
    expect(h.level).toBe(1);
  });

  it("makes each list item its own block, nested ones included", () => {
    // The <ul> is a container, not a block; the nested item must not be
    // swallowed into its parent's text.
    const outer = byText("Outer item");
    const inner = byText("Inner item");
    expect(outer.tag).toBe("li");
    expect(inner.tag).toBe("li");
    expect(outer.text).not.toContain("Inner item");
  });

  it("marks media, rules and captions ungistable so the ToC writes no row for them", () => {
    for (const b of blocks.filter((b) => b.kind === "media" || b.tag === "hr")) {
      expect(b.gistable, b.tag).toBe(false);
    }
    const caption = byText("A modern version");
    expect(caption.kind).toBe("caption");
    expect(caption.gistable).toBe(false);
  });

  it("keeps prose gistable", () => {
    expect(byText("The first paragraph").gistable).toBe(true);
  });
});

describe("id stability", () => {
  it("reuses ids already written into the HTML", () => {
    const first = splitIntoBlocks(ARTICLE);
    const second = splitIntoBlocks(first.html);
    expect(second.blocks.map((b) => b.id)).toEqual(first.blocks.map((b) => b.id));
    expect(second.stats.minted).toBe(0);
    expect(second.stats.reused).toBe(second.stats.total);
  });

  it("carries ids across re-extraction, where the HTML arrives with none", () => {
    // This is the case random ids exist for: stage 2 rewrites the document from
    // Readability, so the ids are gone and only the previous blocks.json knows
    // them. Matching is on text, so an inserted paragraph must not shift anyone.
    const first = splitIntoBlocks(ARTICLE);
    const reExtracted = ARTICLE.replace(
      "<p>The second paragraph",
      "<p>A paragraph inserted by a later edit.</p>\n<p>The second paragraph",
    );
    const second = splitIntoBlocks(reExtracted, first.blocks);

    const idOf = (r: typeof first, needle: string) =>
      r.blocks.find((b) => b.text.includes(needle))!.id;

    for (const survivor of ["Soul Machine", "The first paragraph", "The second paragraph", "Inner item"]) {
      expect(idOf(second, survivor), survivor).toBe(idOf(first, survivor));
    }
    expect(isSpideryarnId(idOf(second, "inserted by a later edit"))).toBe(true);
  });

  it("re-mints blocks that carry neither text nor a src — currently just <hr>", () => {
    // Not a bug so much as the honest limit of matching on content: a rule has
    // no content. It is gistable:false and never gets a ToC row, so nothing
    // points at it — but a leaf anchored to one does go stale across a
    // re-extraction. Pinned here so a future fix is a deliberate one.
    const first = splitIntoBlocks(ARTICLE);
    const second = splitIntoBlocks(ARTICLE, first.blocks);
    const rule = (r: typeof first) => r.blocks.find((b) => b.tag === "hr")!.id;
    expect(rule(second)).not.toBe(rule(first));
    expect(second.stats.minted).toBe(1);
    expect(second.stats.carried).toBe(second.stats.total - 1);
  });

  it("carries a figure's id on its src, since it has no text to match on", () => {
    const first = splitIntoBlocks(ARTICLE);
    const second = splitIntoBlocks(ARTICLE, first.blocks);
    const figure = (r: typeof first) => r.blocks.find((b) => b.html.includes("/diagram.png"))!.id;
    expect(figure(second)).toBe(figure(first));
  });

  it("gives an edited paragraph a fresh id rather than guessing", () => {
    const first = splitIntoBlocks(ARTICLE);
    const edited = ARTICLE.replace("carries the argument", "carries a different argument entirely");
    const second = splitIntoBlocks(edited, first.blocks);
    const before = first.blocks.find((b) => b.text.includes("first paragraph"))!.id;
    const after = second.blocks.find((b) => b.text.includes("first paragraph"))!.id;
    expect(after).not.toBe(before);
  });

  it("never hands one id to two blocks that read identically", () => {
    // Two paragraphs with the same words are indistinguishable to the matcher.
    // Consuming each previous id once is what stops both claiming the same one —
    // duplicate ids would corrupt every artefact keyed on them.
    const twice = `<article><p>Time is short.</p><p>Time is short.</p></article>`;
    const first = splitIntoBlocks(twice);
    const second = splitIntoBlocks(twice, first.blocks);
    expect(new Set(second.blocks.map((b) => b.id)).size).toBe(second.blocks.length);
    expect(second.stats.carried).toBe(2);
  });
});

/**
 * Captions are excluded by their marker, never by their length. The temptation
 * is to treat short paragraphs as chrome — but the test article's "Given all
 * this, what should we do?" is seven words of genuine argument and pivots the
 * whole piece, while one of its captions runs to 94 words. Length tells you
 * nothing here, and a word-count rule would silently drop real prose out of the
 * ToC. See docs/project/table-of-contents.md.
 */
describe("caption detection is by marker, not by length", () => {
  const { blocks } = splitIntoBlocks(`
    <article>
      <p>Given all this, what should we do?</p>
      <p>Figure 2: A modern version of a McCulloch-Pitts neuron. Input signals arrive
         weighted, are summed, and the unit fires when the total clears a threshold,
         which is the abstraction the whole computational story rests upon.</p>
      <p>Credits</p>
    </article>
  `);
  const byText = (needle: string) => blocks.find((b) => b.text.includes(needle))!;

  it("keeps a short paragraph that is actually an argument", () => {
    const pivot = byText("what should we do");
    expect(pivot.words).toBeLessThan(10);
    expect(pivot.gistable).toBe(true);
  });

  it("drops a long caption, despite it being longer than the prose", () => {
    const caption = byText("McCulloch-Pitts");
    expect(caption.words).toBeGreaterThan(30);
    expect(caption.kind).toBe("caption");
    expect(caption.gistable).toBe(false);
  });

  it("drops a standalone boilerplate label", () => {
    expect(byText("Credits").gistable).toBe(false);
  });
});
