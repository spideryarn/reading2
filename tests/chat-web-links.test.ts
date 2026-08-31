/**
 * A chat answer may now carry a link to the web — the splitter that finds one,
 * and the anchor it becomes.
 *
 * Greg, 2026-08-27: *"Allow chat responses to include hyperlinks to the web
 * (e.g. in response to searching the web if it found something useful)."*
 *
 * **This is model output reaching an `href`**, which is the one shape
 * docs/project/security.md is about, so the tests here are weighted towards the
 * ways it fails silently rather than towards the happy path:
 *
 *  - a URL that carries a **block-id shape** in its path, which is what forced
 *    links to be pulled out before citations (`splitLinks` says why at length);
 *  - a scheme that is not `http(s)`, which must render as the characters the
 *    model typed rather than as an attribute;
 *  - a bare URL at the end of an answer that is **still arriving**, which is
 *    half an address and would be a link to the wrong page for one frame;
 *  - and the attribute itself, in jsdom, because "we set `rel`" is exactly the
 *    kind of claim that is true in the source and false in the DOM.
 *
 * docs/plans/260827ao-chat-web-links.md.
 */
import { describe, expect, it } from "vitest";
import { splitCitations, splitLinks } from "../src/web/citations.js";
import { withoutWebLinks } from "../src/urls.js";

/** Compact enough to read a whole paragraph's parse in one line. */
const parse = (para: string, partial = false) =>
  splitLinks(para, partial).map((run) =>
    run.kind === "text" ? run.text : `link(${run.text}|${run.url})`,
  );

describe("splitLinks — the two shapes a model actually writes", () => {
  it("turns a Markdown link into a link, and keeps the prose either side", () => {
    expect(parse("The study is [in Nature](https://www.nature.com/articles/x1) if you want it.")).toEqual([
      "The study is ",
      "link(in Nature|https://www.nature.com/articles/x1)",
      " if you want it.",
    ]);
  });

  it("links a bare URL, labelled with itself", () => {
    expect(parse("See https://arxiv.org/abs/2212.13345 for the method.")).toEqual([
      "See ",
      "link(https://arxiv.org/abs/2212.13345|https://arxiv.org/abs/2212.13345)",
      " for the method.",
    ]);
  });

  it("handles both in one paragraph", () => {
    const runs = parse("[One](https://a.example/x) and then https://b.example/y too.");
    expect(runs).toEqual([
      "link(One|https://a.example/x)",
      " and then ",
      "link(https://b.example/y|https://b.example/y)",
      " too.",
    ]);
  });

  it("emits no empty text runs around a paragraph that is only a link", () => {
    expect(parse("https://a.example/x")).toEqual(["link(https://a.example/x|https://a.example/x)"]);
    expect(parse("[x](https://a.example/x)")).toEqual(["link(x|https://a.example/x)"]);
  });

  it("leaves a paragraph with no links exactly as it was", () => {
    const para = "He rejects substrate independence [spya-k3m9qt], which is the point.";
    expect(parse(para)).toEqual([para]);
  });
});

describe("splitLinks — the ordering bug it exists to prevent", () => {
  /* **The check, checked.** Every assertion below is "no chip was made", and a
     test that has never seen the chip is not evidence of anything — it would
     pass just as well against an id shape this article does not recognise, or
     against a `splitCitations` that had stopped matching bare runs. So this
     one goes the other way and pins the hazard itself: handed the URL, the
     citation splitter really does take the id out of the middle of it. That is
     what the ordering saves us from. docs/reusable/silent-success.md. */
  it("would be chipped by splitCitations alone — which is the whole hazard", () => {
    const known = new Map([["spya-k3m9qt", "The paragraph."]]);
    expect(
      splitCitations("Notes are at https://example.com/notes/spya-k3m9qt today.", known).map((s) =>
        s.kind === "text" ? s.text : `cite:${s.ids.join(",")}`,
      ),
    ).toEqual(["Notes are at https://example.com/notes/", "cite:spya-k3m9qt", " today."]);
  });

  /* `splitCitations` matches a bare run of ids by *shape*, and a URL is a
     string somebody else wrote. Parsed citations-first this address comes apart
     into a link to `…/notes/` and a chip pointing at a block this article does
     not have — silent, and the reader sees a broken link beside a chip that
     goes nowhere. */
  it("keeps an id-shaped path segment inside the address", () => {
    expect(parse("Notes are at https://example.com/notes/spya-k3m9qt today.")).toEqual([
      "Notes are at ",
      "link(https://example.com/notes/spya-k3m9qt|https://example.com/notes/spya-k3m9qt)",
      " today.",
    ]);
  });

  it("keeps an id-shaped segment inside a Markdown link's address too", () => {
    expect(parse("[the notes](https://example.com/spya-k3m9qt/x)")).toEqual([
      "link(the notes|https://example.com/spya-k3m9qt/x)",
    ]);
  });

  /* A label is the model's words for a destination, and the caller renders it
     as text. An id inside one is not a citation, and the splitter must hand the
     label back whole so the caller cannot accidentally chip it. */
  it("hands back a label containing an id shape whole", () => {
    expect(parse("[see spya-k3m9qt](https://a.example/x)")).toEqual([
      "link(see spya-k3m9qt|https://a.example/x)",
    ]);
  });
});

describe("splitLinks — parentheses, which real URLs contain", () => {
  it("keeps a Wikipedia disambiguator inside a Markdown link", () => {
    expect(parse("[Mercury](https://en.wikipedia.org/wiki/Mercury_(planet)) is the one.")).toEqual([
      "link(Mercury|https://en.wikipedia.org/wiki/Mercury_(planet))",
      " is the one.",
    ]);
  });

  it("keeps one in a bare URL", () => {
    expect(parse("https://en.wikipedia.org/wiki/Mercury_(planet) is the one.")).toEqual([
      "link(https://en.wikipedia.org/wiki/Mercury_(planet)|https://en.wikipedia.org/wiki/Mercury_(planet))",
      " is the one.",
    ]);
  });

  it("does not swallow a parenthesis the sentence opened", () => {
    expect(parse("(see https://a.example/x)")).toEqual([
      "(see ",
      "link(https://a.example/x|https://a.example/x)",
      ")",
    ]);
  });
});

describe("splitLinks — punctuation that followed the address", () => {
  it.each([
    ["ends a sentence.", "."],
    ["is next,", ","],
    ["then;", ";"],
    ["really?", "?"],
  ])("does not take trailing %s into the URL", (_label, mark) => {
    const runs = splitLinks(`Read https://a.example/x${mark}`);
    expect(runs).toEqual([
      { kind: "text", text: "Read " },
      { kind: "link", text: "https://a.example/x", url: "https://a.example/x" },
      { kind: "text", text: mark },
    ]);
  });

  it("does not take a closing quote", () => {
    expect(parse('He wrote "https://a.example/x" there.')).toEqual([
      'He wrote "',
      "link(https://a.example/x|https://a.example/x)",
      '" there.',
    ]);
  });
});

describe("splitLinks — the scheme allowlist", () => {
  /* `isWebUrl` is the same function the citation list and `article_links` use.
     A match that fails it must come back as the characters the model typed —
     not as an `href`, and not silently deleted either. */
  it.each([
    "[click me](javascript:alert(1))",
    "[mail him](mailto:someone@example.com)",
    "[the file](file:///etc/passwd)",
    "[data](data:text/html,<script>x</script>)",
  ])("leaves %s as text", (para) => {
    expect(parse(para)).toEqual([para]);
  });

  it("leaves a bare non-web scheme alone", () => {
    const para = "Write to someone@example.com or ftp://a.example/x for it.";
    expect(parse(para)).toEqual([para]);
  });

  it("refuses a scheme-only string", () => {
    // `new URL("https://")` throws, which `isWebUrl` catches — the property the
    // callers rely on is that anything surviving it will parse again on render.
    expect(parse("[x](https://)")).toEqual(["[x](https://)"]);
  });
});

describe("splitLinks — addresses that would go somewhere else", () => {
  /* `https://trusted.example@evil.example/` is a label built into the address:
     it reads as a link to `trusted.example` and lands on `evil.example`. There
     is no honest use for it in a chat answer, so it is not drawn as a link at
     all. */
  it.each([
    "[the paper](https://trusted.example@evil.example/x)",
    "https://trusted.example@evil.example/x",
    "[the paper](https://user:pw@evil.example/x)",
  ])("refuses credentials in %s", (para) => {
    expect(parse(para)).toEqual([para]);
  });

  /* Two levels of nesting are handled; deeper is refused rather than
     truncated, because a truncated address is a link to a *different* page and
     the reader cannot see that it happened. */
  it("keeps a doubly-nested parenthesis", () => {
    const url = "https://en.wikipedia.org/wiki/Foo_(bar_(baz))";
    expect(parse(`[Foo](${url})`)).toEqual([`link(Foo|${url})`]);
    expect(parse(url)).toEqual([`link(${url}|${url})`]);
  });

  it("leaves an address nested deeper than that as text, rather than truncating it", () => {
    const para = "https://en.wikipedia.org/wiki/Foo_(a_(b_(c)))";
    expect(parse(para)).toEqual([para]);
  });

  it("does not let bold markers into the address", () => {
    expect(parse("**https://x.example/y**")).toEqual([
      "**",
      "link(https://x.example/y|https://x.example/y)",
      "**",
    ]);
  });

  it("reads a shouted scheme", () => {
    expect(parse("See HTTPS://example.com/x now.")).toEqual([
      "See ",
      "link(HTTPS://example.com/x|HTTPS://example.com/x)",
      " now.",
    ]);
  });

  it("keeps a question mark that is query data", () => {
    expect(parse("Read https://x.example/search?q=why?")).toEqual([
      "Read ",
      "link(https://x.example/search?q=why?|https://x.example/search?q=why?)",
    ]);
  });

  it("still drops a full stop after a query", () => {
    expect(parse("Read https://x.example/search?q=why.")).toEqual([
      "Read ",
      "link(https://x.example/search?q=why|https://x.example/search?q=why)",
      ".",
    ]);
  });
});

describe("splitLinks — how long it takes on hostile input", () => {
  /* **A scaling test, not a timeout at one size.** The first version let a
     Markdown label contain `[`, so every opening bracket scanned the rest of
     the string for a `]` — quadratic, and this parser runs over every
     accumulated paragraph on every streamed token. A single generous timeout
     would have passed at 8k brackets and frozen the reader at 32k. Found by a
     GPT Sol review, 2026-08-27. */
  const time = (para: string): number => {
    const started = performance.now();
    splitLinks(para);
    return performance.now() - started;
  };

  it("grows roughly linearly in the number of unclosed brackets", () => {
    const small = `${"[".repeat(8_000)}x`;
    const large = `${"[".repeat(32_000)}x`;
    time(small); // warm, so the first call's compilation is not the measurement
    const ratio = (time(large) + 0.01) / (time(small) + 0.01);
    // Quadratic would be ~16×. Anything under 8 is comfortably not that.
    expect(ratio).toBeLessThan(8);
  });

  it.each([
    ["unclosed brackets", `${"[".repeat(60_000)}x`],
    ["unclosed parentheses", `[x](https://a.example/${"(".repeat(60_000)}`],
    ["bare address, open parentheses", `https://a.example/${"(".repeat(60_000)}`],
  ])("finishes promptly on 60k %s", (_what, para) => {
    expect(time(para)).toBeLessThan(500);
  });
});

describe("withoutWebLinks — what the server counts ids in", () => {
  /* The other half of the ordering rule. The renderer takes links out before
     it looks for citations; the server's `citedBlockIds` and `unknownCitedIds`
     have to do the same, or an id inside a URL is logged as a citation the
     reader never saw — or as a hallucination that never happened. */
  it("blanks a link without moving anything else", () => {
    const url = "https://example.com/notes/spya-k3m9qt";
    const para = `Notes are at ${url} today.`;
    expect(withoutWebLinks(para)).toBe(`Notes are at ${" ".repeat(url.length)} today.`);
  });

  it("leaves a real citation where it was", () => {
    expect(withoutWebLinks("He says so [spya-k3m9qt].")).toBe("He says so [spya-k3m9qt].");
  });

  it("blanks a Markdown link's label as well as its address", () => {
    // The label is not citation text either — the renderer never chips inside one.
    const md = "[spya-k3m9qt](https://a.example/x)";
    expect(withoutWebLinks(`See ${md}.`)).toBe(`See ${" ".repeat(md.length)}.`);
  });
});

/* `emphasise` and its "bold paired across the links" rule used to live here.
   Both went on 2026-08-31 with the hand-rolled inline parser: `mdast-util-from-
   markdown` gets `**[The paper](https://…)**` right by parsing it, so there is
   no pairing logic left to test. What the shapes it covered now assert is in
   tests/chat-markdown-render.test.tsx, against the DOM, which is where the
   claim "the reader sees bold" was always really being made.
   docs/plans/chat-markdown.md. */

describe("splitLinks — an answer that is still arriving", () => {
  const para = "The paper is at https://arxiv.org/abs/2212.133";

  it("leaves a bare URL touching the end as text while partial", () => {
    expect(parse(para, true)).toEqual([para]);
  });

  it("links the same string once anything follows it", () => {
    expect(parse(`${para} `, true)).toEqual([
      "The paper is at ",
      "link(https://arxiv.org/abs/2212.133|https://arxiv.org/abs/2212.133)",
      " ",
    ]);
  });

  it("links it once the answer has landed", () => {
    expect(parse(para, false)).toEqual([
      "The paper is at ",
      "link(https://arxiv.org/abs/2212.133|https://arxiv.org/abs/2212.133)",
    ]);
  });

  it("still links an earlier bare URL in the same partial paragraph", () => {
    expect(parse("From https://a.example/x and https://b.example/y", true)).toEqual([
      "From ",
      "link(https://a.example/x|https://a.example/x)",
      " and https://b.example/y",
    ]);
  });

  it("links a Markdown link at the end even while partial — its `)` is proof", () => {
    expect(parse("The paper is [here](https://a.example/x)", true)).toEqual([
      "The paper is ",
      "link(here|https://a.example/x)",
    ]);
  });
});
