/**
 * **`hashBlocks` after roles**, which is two promises pulling opposite ways.
 *
 * The first: assigning a role changes no text and no range, so unless the
 * fingerprint sees it, every summary, idea, glossary entry, tweet thread,
 * vector set and similarity artefact computed *before* footnotes were
 * classified goes on reporting itself current — the article's summary silently
 * written over its own bibliography, with every freshness check agreeing that
 * nothing needs redoing. docs/plans/footnotes.md § Reclassification must
 * invalidate the caches.
 *
 * The second: today's whole corpus carries no roles, and it must not be
 * mass-invalidated into re-running every paid stage on every article. So the
 * function has an explicit legacy branch, and the test for it is a **pinned hex
 * string computed from the code before the change**, not a round trip — a round
 * trip is satisfied by any self-consistent algorithm, including a new one.
 *
 * GPT Sol's decision 5 (docs/plans/footnotes-stage345-upfront-sol.md).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { hashBlocks, type BlockFingerprint } from "../src/source-hash.js";
import type { Block } from "../src/types.js";

/**
 * Computed by running the **pre-change** `hashBlocks` over `example/blocks.json`
 * on 2026-08-28, before a line of this stage was written. Its whole value is
 * that it was not produced by the code it is checking.
 */
const EXAMPLE_HASH = "21189fa4eb0bceca";
/** Same provenance, over two hand-built blocks — the shape most tests use. */
const TWO_BLOCK_HASH = "66d8a4e76744ae83";

const TWO = [
  { id: "spya-aaaaaa", text: "One." },
  { id: "spya-bbbbbb", text: "Two." },
];

describe("the corpus that predates roles", () => {
  const blocks: Block[] = JSON.parse(readFileSync("example/blocks.json", "utf8")).blocks;

  it("has no roles, which is what makes the next assertion mean anything", () => {
    expect(blocks.some((b) => b.role || b.treatment)).toBe(false);
  });

  it("hashes byte for byte as it did before roles existed", () => {
    expect(hashBlocks(blocks)).toBe(EXAMPLE_HASH);
  });

  it("hashes two hand-built blocks as it did before", () => {
    expect(hashBlocks(TWO)).toBe(TWO_BLOCK_HASH);
  });

  it("reads a Postgres null exactly as a missing field", () => {
    /* The real difference between the two stores: the filesystem carries an
       absent key and Postgres carries a null column. If these two branched
       differently, one store would report every artefact stale against the
       other for ever, and both would look right on their own. */
    const nulled = TWO.map((b) => ({ ...b, role: null, treatment: null }));
    expect(hashBlocks(nulled)).toBe(TWO_BLOCK_HASH);
  });
});

describe("a role is part of the fingerprint", () => {
  it("changes the hash when nothing but a role is added", () => {
    const before = hashBlocks(TWO);
    const after = hashBlocks([
      TWO[0]!,
      { ...TWO[1]!, role: "footnote", treatment: "supplement" },
    ]);
    expect(after).not.toBe(before);
  });

  it("changes the hash when only the treatment changes", () => {
    /* Both axes, separately. One test over both fields together passes if only
       one of them reaches the canonical form. */
    const roled = [TWO[0]!, { ...TWO[1]!, role: "footnote" as const }];
    const both = [TWO[0]!, { ...TWO[1]!, role: "footnote" as const, treatment: "supplement" as const }];
    expect(hashBlocks(both)).not.toBe(hashBlocks(roled));
  });

  it("does not change when the same roles are respelled as nulls", () => {
    /* Annotated at the declaration rather than cast at the call. Without it
       TypeScript widens the array to a union of two object shapes, which is a
       real distinction here — one element is the absent spelling and the other
       is the present one, and the whole point is that both are the same type. */
    /* The key **absent**, not present and undefined. `exactOptionalPropertyTypes`
       is on, so the two are different types here — and absent is the spelling
       the filesystem store actually writes. */
    const undef: BlockFingerprint[] = [
      { ...TWO[0]! },
      { ...TWO[1]!, role: "footnote", treatment: "supplement" },
    ];
    const nulled: BlockFingerprint[] = [
      { ...TWO[0]!, role: null, treatment: null },
      { ...TWO[1]!, role: "footnote", treatment: "supplement" },
    ];
    expect(hashBlocks(nulled)).toBe(hashBlocks(undef));
  });

  it("is not fooled by text that contains the legacy separators", () => {
    /* The legacy form is `id \t text` joined by newlines, so two blocks can be
       spelled as one. The framed form has a version prefix and control
       separators for exactly this; asserted rather than assumed. */
    const smuggled = [
      { id: "spya-aaaaaa", text: "One.\nspya-bbbbbb\tTwo.", role: "footnote" as const },
    ];
    const honest = [
      { id: "spya-aaaaaa", text: "One.", role: "footnote" as const },
      { id: "spya-bbbbbb", text: "Two.", role: "footnote" as const },
    ];
    expect(hashBlocks(smuggled)).not.toBe(hashBlocks(honest));
  });
});

describe("the narrow fingerprint reads see the same four fields", () => {
  /**
   * The failure this is about: a narrow query that selects `id` and `text`
   * only, compared against a full hash. `tests/store-block-reads.test.ts`
   * asserts that parity — over blocks that carry no roles, where it holds
   * whatever the code does. This is the role-bearing case, which is the one
   * that can actually fail.
   */
  const full: Block[] = [
    { id: "spya-aaaaaa", tag: "p", kind: "text", text: "One.", words: 1,
      html: "<p>One.</p>", gistable: true },
    { id: "spya-bbbbbb", tag: "li", kind: "text", text: "A note.", words: 2,
      html: "<li>A note.</li>", gistable: true,
      role: "footnote", treatment: "supplement", noteId: "n1" },
  ];

  it("agrees between the whole block and the four columns", () => {
    const narrow = full.map((b) => ({
      id: b.id,
      text: b.text,
      role: b.role ?? null,
      treatment: b.treatment ?? null,
    }));
    expect(hashBlocks(narrow)).toBe(hashBlocks(full));
  });

  it("disagrees if a read drops the two role columns", () => {
    /* The control. Without it the assertion above passes on a `hashBlocks` that
       ignores roles entirely, which is the version this whole file exists to
       stop coming back. */
    const twoColumn = full.map((b) => ({ id: b.id, text: b.text }));
    expect(hashBlocks(twoColumn)).not.toBe(hashBlocks(full));
  });
});

describe("the classified framing is a framing, not a rarer delimiter", () => {
  /* GPT Sol broke the first version of this, and it is the failure that would
     have hurt most: two *different* articles with one fingerprint means both
     agree that nothing has changed, so every cached artefact on both stays
     current for ever. The first version separated fields with U+0000 and blocks
     with U+0001 on the reasoning that control codepoints do not occur in prose.
     But a block's text is whatever the page said — none of it is ours — so an
     unescaped separator is a collision waiting for a page that contains one.
     docs/plans/footnotes-stage3-review-sol.md. */
  const NUL = "\u0000";
  const SOH = "\u0001";

  it("does not collide when a block's own text contains the delimiters", () => {
    const two = [
      { id: "spya-aaaaaa", text: "first", role: "footnote", treatment: "supplement" },
      { id: "spya-bbbbbb", text: "second", role: "footnote", treatment: "supplement" },
    ];
    /* One block whose text spells out everything the two-block version would
       have serialised after it: the delimiters, the second id, and its fields. */
    const one = [
      {
        id: "spya-aaaaaa",
        text: `first${NUL}footnote${NUL}supplement${SOH}spya-bbbbbb${NUL}second`,
        role: "footnote",
        treatment: "supplement",
      },
    ];
    expect(hashBlocks(one)).not.toBe(hashBlocks(two));
  });

  it("still tells two ordinary classified articles apart", () => {
    /* The control. An implementation that returned a constant, or hashed only
       the block count, would pass the assertion above and fail here. */
    const a = [{ id: "spya-aaaaaa", text: "first", role: "footnote", treatment: "supplement" }];
    const b = [{ id: "spya-aaaaaa", text: "second", role: "footnote", treatment: "supplement" }];
    expect(hashBlocks(a)).not.toBe(hashBlocks(b));
  });

  it("keeps text and role on different sides of the seam", () => {
    /* A block whose *text* is the role string must not hash the same as a block
       whose role is that string — the shape a delimiter-based format gets wrong
       in the other direction. */
    const textCarriesIt = [{ id: "spya-aaaaaa", text: "footnote", role: null, treatment: "supplement" }];
    const roleCarriesIt = [{ id: "spya-aaaaaa", text: "", role: "footnote", treatment: "supplement" }];
    expect(hashBlocks(textCarriesIt)).not.toBe(hashBlocks(roleCarriesIt));
  });
});
