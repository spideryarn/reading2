/**
 * # The article shapes the corpus never had
 *
 * Two postmortems ended at the same sentence — *the corpus never had this
 * shape, so the bug was invisible* — and each asked for a fixture rather than a
 * fix. These are those shapes, named so that the next test wanting a hostile
 * article imports one instead of inventing a third.
 *
 * Built by docs/plans/260908a-adversarial-fixtures-for-four-postmortems.md,
 * which records per assertion how each was made to fail.
 *
 * **The comments here are pointers, not summaries.** The postmortems hold the
 * story and there is one home per fact; repeating it would make a second copy
 * of the project's history to keep in step.
 *
 * **None of this is anybody's prose.** Every sentence is invented and the markup
 * is the *shape* of the real page, the same rule 260830a's own reproduction
 * used.
 */
import type { Block, Tree } from "../../src/types.js";

/** Any ordinary paragraph. Twelve words, so no fragment rule is near it. */
export const SENTENCE = "This paragraph makes a claim and then supports it with an example.";

/**
 * An old hand-written HTML page whose only heading is its title.
 *
 * **Asked for by docs/postmortems/260830a-the-article-with-one-heading.md** —
 * "an old-HTML page in the corpus", "a fixture with a one-word block", and "a
 * fixture whose only heading is its title", which are all this one page. A
 * 23-block article spent 16 model calls and $0.39 and never produced a table of
 * contents.
 *
 * Three features, each load-bearing:
 *
 * - **no `<p>` elements**, `<br /><br />` between paragraphs;
 * - **`<b>` where an `<h2>` would go**, so `Notes` is a section header the
 *   reader can see and no `kind: "heading"` block backs;
 * - **a footnote marker written as `[<a name="f1n">1</a>]`**, which the splitter
 *   promotes to the separate one-word blocks `[1]`, `[` and `1`.
 *
 * The `<h1>` is deliberately present: the postmortem is about an article with
 * *one* heading, its title, and the gap between that one and the several a
 * reader perceives is the whole of its symptom 2.
 */
export const OLD_HTML_ONE_HEADING =
  `<h1>The Need To Read</h1>` +
  `<div>${SENTENCE}<span>[1]</span><br /><br />${SENTENCE}<br /><br />` +
  `<b>Notes</b><br /><br />[<a name="f1n">1</a>] ${SENTENCE}</div>`;

/**
 * A page whose media was stripped, leaving lead-ins pointing at nothing.
 *
 * **Asked for by docs/postmortems/260830e-nav-labels-asked-58-got-57.md** — "a
 * test with a hostile **article**, not a hostile response". Stage 3 leaves an
 * empty non-gistable `<p>` where each code cell was, stranding bare lead-ins;
 * one of the real article's fifteen was the single word `or`, and the label
 * prompt's two instructions are jointly unsatisfiable for it.
 *
 * Both fates are kept, because the interesting assertion is that they differ:
 * an emptied `<p>` is excluded from a batch and `or` is not.
 */
export const STRIPPED_MEDIA_LEAD_INS =
  `<div><p>Sometimes it is less obvious, but it still seems fairly clear.</p>` +
  `<p></p><p>But what about in a case like this:</p><p></p><p>or</p><p></p>` +
  `<p>It looks awfully similar to the cases we saw above.</p></div>`;

/**
 * Ids for a synthetic block, drawn from the real alphabet.
 *
 * `src/ids.ts` is `abcdefghjkmnpqrstuvwxyz023456789` — no `i`, `l`, `o` or `1`,
 * because those are what people misread copying an id out of a URL, and
 * `drizzle/0002` enforces it as a CHECK. `spya-fix001` looks right and is not;
 * the committed corpus learned that the hard way, and an earlier draft of this
 * very file made the same mistake in a comment explaining the mistake.
 *
 * Asserted rather than assumed, in tests/adversarial-shapes.test.ts.
 */
const ALPHABET = "abcdefghjkmnpqrstuvwxyz023456789";

export function syntheticId(index: number): string {
  let n = index;
  let out = "";
  for (let i = 0; i < 6; i += 1) {
    out = ALPHABET[n % ALPHABET.length] + out;
    n = Math.floor(n / ALPHABET.length);
  }
  return `spya-${out}`;
}

/**
 * A root and one leaf per block — the least structure a batch can be planned
 * over, and **a tree `checkTree` actually accepts.**
 *
 * That last part is the point of it living here rather than being written out
 * per test. A tree that is merely good enough for the function under test is how
 * a test comes to pass for a reason nobody intended: `generateLabels` does not
 * validate its tree, so an invalid one works fine and the test's comment quietly
 * becomes false. Every consumer of this asserts `checkTree(...).problems` is
 * empty before it relies on it. GPT Sol's stage review, 2026-09-08.
 *
 * No `as unknown as Tree` anywhere: the shape is built to the real type, so a
 * change to `Tree` reaches this through the compiler rather than past it.
 */
export function flatTree(blocks: Block[], slug: string): Tree {
  const first = blocks[0];
  const last = blocks[blocks.length - 1];
  if (first === undefined || last === undefined) {
    throw new Error("flatTree needs at least one block");
  }
  const nodes: Tree["nodes"] = {
    n0001: {
      id: "n0001",
      depth: 0,
      parent: null,
      children: blocks.map((_, i) => `n${String(i + 2).padStart(4, "0")}`),
      range: [first.id, last.id],
      title: "Whole piece",
      gist: "It makes a claim and then supports it.",
    },
  };
  blocks.forEach((b, i) => {
    const id = `n${String(i + 2).padStart(4, "0")}`;
    nodes[id] = { id, depth: 1, parent: "n0001", children: [], range: [b.id, b.id], title: "" };
  });
  return { version: "toc/1", generator: "adversarial-shapes", slug, rootId: "n0001", nodes };
}

/** A block as stage 3 emits one, with an id `isSpideryarnId` accepts. */
export function block(index: number, text: string, tag = "p"): Block {
  const id = syntheticId(index);
  return {
    id,
    tag,
    kind: tag.startsWith("h") ? "heading" : "text",
    text,
    words: text.trim().split(/\s+/).filter(Boolean).length,
    html: `<${tag} id="${id}">${text}</${tag}>`,
    gistable: true,
  };
}
