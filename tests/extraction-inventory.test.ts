/**
 * The before-and-after inventory, checked against known answers.
 *
 * `evals/extraction/inventory.mts` is an eval harness rather than a shipped
 * feature, and it still gets a deterministic test — because it is an
 * *instrument*, everything downstream of it is a number it produced, and it has
 * already been confidently wrong three times. Each of the three has a case here
 * (`the three instrument bugs`), and each one was watched failing against the
 * version that had the bug before being kept.
 *
 * It calls no model and touches no network: `compare` takes the before and the
 * after as two strings, which is the reason it exists as a separate function.
 * See docs/plans/260827ab-readability-repair-pass.md.
 */
import { describe, expect, it } from "vitest";
import { compare } from "../evals/extraction/inventory.mjs";
import { gainedText } from "../evals/extraction/corpus.mjs";

const URL = "https://example.invalid/article";

/**
 * Paragraphs that share no eight-word run with each other.
 *
 * Written the obvious way first — one sentence with the number substituted in —
 * and every truncation case then passed while measuring nothing, because the
 * twenty words between the substitutions were identical in all six. Shared
 * phrasing is the matcher's hard case, so the fixture must not hand it a page
 * with none. `repetitive` below is the same trap on purpose.
 */
const WORDS = [
  "orchard lantern viaduct", "gravel puffin sextant", "marzipan tundra kelp",
  "cobalt jackdaw furlong", "pewter samphire glide", "quarry mistral bracken",
  "thistle beacon caravel", "lichen dovetail plume", "amber hurdle fennel",
  "walnut cistern gable",
];
const para = (n: number): string => {
  const w = WORDS[n % WORDS.length]!.split(" ");
  return (
    `The ${w[0]} of ${n} was first ${w[1]} in a season nobody recorded, and the ` +
    `${w[2]} it left behind is why paragraph ${n} reads as it does today, at length ${n * 7}.`
  );
};

const page = (bodies: string[]): string =>
  `<!doctype html><html><body><article>${bodies.join("")}</article></body></html>`;

describe("compare — the plain cases", () => {
  it("scores a faithful extraction as entirely kept", () => {
    const paras = [1, 2, 3, 4].map((n) => `<p>${para(n)}</p>`);
    const inv = compare(page(paras), paras.join(""), URL);
    expect(inv.totals.dropped).toBe(0);
    expect(inv.totals.kept).toBe(4);
    expect(inv.ratio).toBeCloseTo(1, 2);
  });

  it("finds a truncated tail as one run of dropped blocks", () => {
    const paras = [1, 2, 3, 4, 5, 6].map((n) => `<p>${para(n)}</p>`);
    const inv = compare(page(paras), paras.slice(0, 2).join(""), URL);
    expect(inv.totals.dropped).toBe(4);
    expect(inv.gaps[0]?.blocks).toBe(4);
    expect(inv.ratio).toBeLessThan(0.5);
  });

  it("reports boilerplate the extractor swallowed as a ratio over one", () => {
    /* The failure the character ratio catches and the block verdicts cannot:
       everything in the page was "kept", and that is the problem. */
    const body = [1, 2].map((n) => `<p>${para(n)}</p>`).join("");
    /* Written out rather than generated: `para(90)` and `para(0)` share a
       template, so nine of their words run together identically and the nav
       matched the body. The fixture kept catching the fixture. */
    const nav =
      `<nav><p>Subscribe to our weekly digest and never miss another dispatch from the newsroom.</p></nav>` +
      `<aside><p>Related coverage: eleven other stories our editors believe you may wish to open next.</p></aside>`;
    const inv = compare(page([body, nav]), body + nav, URL);
    expect(inv.totals.dropped).toBe(0);
    expect(inv.ratio).toBeCloseTo(1, 2);
    /* And with the nav correctly dropped, the ratio falls well below one. */
    const clean = compare(page([body, nav]), body, URL);
    expect(clean.ratio).toBeLessThan(inv.ratio - 0.2);
    expect(clean.totals.dropped).toBe(2);
  });
});

describe("the three instrument bugs", () => {
  it("sees an essay held in inline tags and separated by <br> (bug 1: the block-tag list)", () => {
    /* Paul Graham's HTML. Not one tag here is on any list of block elements, and
       the tag-list walker found 67 characters of a 3,000-character essay while
       printing ratio 100%. `coverage` is the assertion that matters. */
    const text = [1, 2, 3].map(para).join("<br><br>");
    const raw = `<!doctype html><html><body><table><tr><td><font size=2>${text}</font></td></tr></table></body></html>`;
    const inv = compare(raw, `<p>${[1, 2, 3].map(para).join("</p><p>")}</p>`, URL);
    expect(inv.totals.coverage).toBeGreaterThan(0.9);
    expect(inv.totals.dropped).toBe(0);
  });

  it("keeps a paragraph whole through a long link (bug 2: deepest-with-20-chars)", () => {
    /* A link whose anchor text is long enough to be a "block" shattered its
       paragraph into fragments that are contiguous in the document and in no
       string we build — 12,231 characters of the Noema essay were reported
       dropped when Readability had kept every word of it. */
    const withLink =
      `<p>Paragraph number 7 opens here and then cites ` +
      `<a href="/x">a source with a title far longer than twenty characters</a> ` +
      `and carries on afterwards for a good while longer still, unbroken.</p>`;
    const inv = compare(page([withLink]), withLink, URL);
    expect(inv.rows).toHaveLength(1);
    expect(inv.rows[0]?.tag).toBe("p");
    expect(inv.rows[0]?.verdict).toBe("kept");
  });

  it("calls a half-kept block partial rather than dropped (bug 3: the substring test)", () => {
    /* One long block, compared as a single string, is one character away from
       being reported entirely missing. Fractions give the honest answer, and
       give `partial` — a category the yes/no test could not express. */
    const long = `<p>${[1, 2, 3, 4].map(para).join(" ")}</p>`;
    const half = `<p>${[1, 2].map(para).join(" ")}</p>`;
    const inv = compare(page([long]), half, URL);
    expect(inv.rows[0]?.verdict).toBe("partial");
    expect(inv.rows[0]?.survived).toBeGreaterThan(0.3);
    expect(inv.rows[0]?.survived).toBeLessThan(0.7);
  });

  it("does not let one reflowed word condemn a whole block", () => {
    const long = `<p>${[1, 2, 3, 4].map(para).join(" ")}</p>`;
    const nudged = long.replace("subject 3", "subject three");
    const inv = compare(page([long]), nudged, URL);
    expect(inv.rows[0]?.verdict).toBe("kept");
  });
});

describe("structure, which characters cannot show", () => {
  it("counts a formula the extractor discarded even when its paragraph survives", () => {
    /* The Wikipedia case, in miniature: the prose comes through and every
       equation is gone. Compare text and this paragraph looks mostly fine;
       count elements and the article has lost its mathematics. */
    const withMath = `<p>${para(1)} <math><mi>x</mi></math> ${para(2)}</p>`;
    const withoutMath = `<p>${para(1)}  ${para(2)}</p>`;
    const inv = compare(page([withMath]), withoutMath, URL);
    /* The characters say the paragraph is basically fine — which it is. */
    expect(inv.rows[0]?.verdict).not.toBe("dropped");
    expect(inv.rows[0]?.survived).toBeGreaterThan(0.8);
    /* The structure says the article has lost its mathematics. Only one of
       these two numbers would tell a reader what happened to them. */
    expect(inv.structure.math).toEqual({ present: 1, kept: 0 });
  });

  it("says nothing about a tag the page does not have", () => {
    const inv = compare(page([`<p>${para(1)}</p>`]), `<p>${para(1)}</p>`, URL);
    expect(inv.structure.math).toBeUndefined();
    expect(inv.structure.table).toBeUndefined();
  });
});

describe("the fifth bug: multiplicity", () => {
  /* Found by a GPT Sol review of the built code, 2026-08-27. `verdict` runs
     per row and `indexOf` has no memory, so two source rows with the same text
     both matched the same single occurrence and both came back kept — with
     `keptChars` counting those characters twice and `dropped` at zero. */
  const line = para(5);
  const raw = `<!doctype html><html><body><article><p>${line}</p>` +
    `<aside><p>${line}</p></aside></article></body></html>`;

  it("does not report both copies as kept when the extraction holds one", () => {
    const inv = compare(raw, `<p>${line}</p>`, URL);
    expect(inv.rows).toHaveLength(2);
    expect(inv.totals.kept).toBe(1);
    expect(inv.totals.duplicate).toBe(1);
  });

  it("counts the characters once, not twice", () => {
    const inv = compare(raw, `<p>${line}</p>`, URL);
    expect(inv.totals.keptChars).toBe(inv.rows[0]!.chars);
  });

  it("keeps both when the extraction really does hold both", () => {
    const inv = compare(raw, `<p>${line}</p><p>${line}</p>`, URL);
    expect(inv.totals.kept).toBe(2);
    expect(inv.totals.duplicate).toBe(0);
  });
});

describe("what compare refuses to guess", () => {
  it("cannot see a tail lost inside one large block", () => {
    /* A documented limit rather than a bug, and it is here so nobody rediscovers
       it as a surprise: `kept` means 90% of the shingles survived in order, so a
       block can lose its last tenth and still be called kept. A block big enough
       makes that tenth consequential, and no gap is reported. Source-id
       provenance does not fix this either — it is a threshold, and the honest
       repair is to report `survived` rather than only the verdict. */
    const words = Array.from({ length: 400 }, (_, i) => `w${i}`).join(" ");
    const cut = words.split(" ").slice(0, 370).join(" ");
    const inv = compare(page([`<p>${words}</p>`]), `<p>${cut}</p>`, URL);
    expect(inv.rows[0]?.verdict).toBe("kept");
    expect(inv.rows[0]?.survived).toBeGreaterThan(0.9);
    expect(inv.gaps).toHaveLength(0);
  });

  it("will not judge a block too short to fingerprint", () => {
    const inv = compare(page(["<p>Read more</p>", "<p>2026</p>"]), "", URL);
    expect(inv.totals.short).toBe(inv.totals.blocks);
    expect(inv.totals.dropped).toBe(0);
  });

  it("does not mistake a page's JavaScript for its prose", () => {
    /* Every character of this page is inside a tag the walker skips. It reported
       one block, full coverage and nothing dropped, because `script` was
       filtered as a child while still sitting inside `body.textContent`. */
    const raw = `<!doctype html><html><body><script>${para(1)}</script></body></html>`;
    const inv = compare(raw, "", URL);
    expect(inv.totals.blocks).toBe(0);
    expect(inv.totals.coverage).toBe(0);
  });

  it("will not call a block kept because its words turn up scattered elsewhere", () => {
    /* The matcher's hard case, and the one an order-blind test gets wrong: the
       extraction holds every word of the block, in a different order, in other
       sentences. It did not keep the block. */
    const words = para(3).split(" ");
    const scrambled = [...words].reverse().join(" ");
    const inv = compare(page([`<p>${para(3)}</p>`]), `<p>${scrambled}</p>`, URL);
    expect(inv.rows[0]?.verdict).not.toBe("kept");
  });
});

/**
 * `gainedText` in evals/extraction/corpus.mts — the *other* half of the
 * instrument, and the half that was wrong three times.
 *
 * It answers "what did the un-hide arm add that stock did not have", and every
 * version of it until this one could be made to answer "nothing" while a
 * thousand characters of furniture came in. GPT Sol built all three cases; each
 * is one test below, and each was watched failing against the version of the
 * rule it defeated.
 *
 * The third one is why the rule counts occurrences rather than membership. An
 * `aria-hidden` **duplicate** — a second copy of a paragraph the article already
 * has — is the likeliest harm this arm can do, because `aria-hidden` is exactly
 * the attribute publishers put on a duplicated copy of something. A substring
 * test finds every word of it already present and reports nothing.
 */
describe("gainedText tells recovered article body from recovered furniture", () => {
  const sentence = (s: string, n: number): string =>
    `${s} — sentence ${n}, written out at a length that clears any floor the instrument applies.`;
  const body = (): string =>
    [1, 2, 3, 4].map((n) => `<p>${sentence("Ordinary article prose", n)}</p>`).join("");

  it("reports brand-new text", () => {
    const stock = `<div>${body()}</div>`;
    const unhid = `<div>${body()}<p>${sentence("A section that was collapsed", 9)}</p></div>`;
    const g = gainedText(stock, unhid);
    expect(g.passages).toHaveLength(1);
    expect(g.passages[0]).toContain("A section that was collapsed");
  });

  it("reports a DUPLICATE of text the article already has", () => {
    /* **Watched failing.** The previous rule asked `before.includes(text)` and
       returned nothing here, because every word of the duplicate is already in
       the stock article. Un-hiding admitted 1,700 characters and the runner
       printed "adds text on 0, loses text on 0". */
    const dup = `<p>${sentence("A paragraph the article already contains", 1)}</p>`;
    const stock = `<div>${dup}${body()}</div>`;
    const unhid = `<div>${dup}${body()}${dup}</div>`;
    const g = gainedText(stock, unhid);
    expect(g.passages).toHaveLength(1);
    expect(g.passages[0]).toContain("A paragraph the article already contains");
  });

  it("says nothing when the two arms are the same document", () => {
    const same = `<div>${body()}</div>`;
    expect(gainedText(same, same)).toEqual({ passages: [], unaccounted: 0 });
  });

  it("says nothing when only an attribute moved, which is the Wikipedia case", () => {
    /* 188 formula images lose `aria-hidden` and no text changes. A rule that
       fired on "the HTML differs" would cry wolf on every run of that fixture. */
    const stock = `<div>${body()}<p aria-hidden="true">${sentence("A caption", 5)}</p></div>`;
    const unhid = stock.replace(' aria-hidden="true"', "");
    const g = gainedText(stock, unhid);
    expect(g.passages).toEqual([]);
    expect(g.unaccounted).toBe(0);
  });

  it("counts a nested list once, in its outermost container", () => {
    const inner = [1, 2, 3].map((n) => `<li>${sentence("A nested item", n)}</li>`).join("");
    const stock = `<div>${body()}</div>`;
    const unhid = `<div>${body()}<ul><li>${sentence("An outer item", 0)}<ul>${inner}</ul></li></ul></div>`;
    /* One passage, not four: the outer `<li>` contains the three inner ones.
       Without the de-nesting this reported 94 additions on the constitution
       where stage 3 mints 96 blocks, and the two numbers looked like each other. */
    expect(gainedText(stock, unhid).passages).toHaveLength(1);
  });

  it("flags a change it cannot name, rather than reporting silence", () => {
    /* The backstop. Text arrives in a tag the selector does not cover, so no
       passage is produced — and `unaccounted` says so instead of the run looking
       clean. This is the shape all three bugs had from the outside. */
    const stock = `<div>${body()}</div>`;
    const unhid = `<div>${body()}<address>${sentence("Text in a tag the list does not cover", 7)}</address></div>`;
    const g = gainedText(stock, unhid);
    expect(g.passages).toEqual([]);
    expect(g.unaccounted).toBeGreaterThan(60);
  });
});
