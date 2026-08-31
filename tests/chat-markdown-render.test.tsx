// @vitest-environment jsdom
/**
 * What a model's answer becomes in the DOM.
 *
 * **This is the whole safety net for the Markdown layer**, and since 2026-08-31
 * it is the only one: the parser is `mdast-util-from-markdown` now, and testing
 * a library's own conformance is not our job. What *is* our job is everything
 * around it, and all of it is only true on the screen:
 *
 *  - a bullet list is a `ul` of `li` — the reason this exists at all, since
 *    before 2026-08-31 it was one paragraph reading `- one - two - three`;
 *  - a citation chip is a chip wherever it lands, so the one contract the panel
 *    has (docs/project/block-ids.md) survives the structure around it;
 *  - a link is checked before it is drawn, and a bare one at the tail of a
 *    still-arriving answer is not drawn at all;
 *  - what is inside backticks reaches the page as characters;
 *  - an answer's heading never outranks the panel's own `h2`;
 *  - **nothing is ever HTML**, which is docs/project/security.md's whole point;
 *  - and the shapes that must NOT be interpreted still are not — a `-` starting
 *    a sentence, arithmetic, an identifier with underscores in it. Almost every
 *    answer has no Markdown in it, so those matter more than the rest.
 *
 * Several of these arrived as defects in a hand-rolled parser that lived for one
 * day — docs/plans/chat-markdown-review-sol.md. They are kept, pointed at the
 * library instead, because a case that was once wrong is the case worth keeping.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CitedMarkdown, CitedText } from "../src/web/Cited.js";
import { citableText } from "../src/citable.js";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

/** One article block, so a citation in these answers has somewhere to point. */
const BLOCKS = new Map([["spya-k3m9qt", "The paragraph the model cited."]]);

/** An answer, rendered as the chat panel renders one. */
function paint(text: string): void {
  act(() => {
    root.render(
      createElement(CitedMarkdown, { text, blocks: BLOCKS, onJump: () => {}, links: true }),
    );
  });
}

/** An answer mid-stream: its last characters may be half-written. */
function painting(text: string): void {
  act(() => {
    root.render(
      createElement(CitedMarkdown, {
        text,
        blocks: BLOCKS,
        onJump: () => {},
        links: true,
        live: true,
        partial: true,
      }),
    );
  });
}

/** The same text as the summary panel draws it: marks, no structure, no links. */
function summarise(text: string): void {
  act(() => {
    root.render(createElement(CitedText, { text, blocks: BLOCKS, onJump: () => {} }));
  });
}

const all = (sel: string) => [...host.querySelectorAll(sel)];
const text = () => host.textContent ?? "";

describe("the structure", () => {
  it("draws a bullet list as a list", () => {
    paint("Three reasons:\n\n- one\n- two\n- three");
    expect(all("ul.fmt-list")).toHaveLength(1);
    expect(all("ul.fmt-list > li").map((li) => li.textContent)).toEqual(["one", "two", "three"]);
    expect(all("p").map((p) => p.textContent)).toEqual(["Three reasons:"]);
  });

  it("keeps a numbered list's starting number", () => {
    // A model continuing a list across two answers numbers from 3, and
    // renumbering to 1 would contradict its own words.
    paint("3. third\n4. fourth");
    expect(host.querySelector("ol.fmt-list")?.getAttribute("start")).toBe("3");
  });

  it("nests a list inside its item", () => {
    paint("- outer\n  - inner");
    expect(all("ul li ul li").map((li) => li.textContent)).toEqual(["inner"]);
  });

  it("draws a quote, a rule and a code block", () => {
    paint("> quoted\n\n---\n\n```\ncode()\n```");
    expect(host.querySelector("blockquote.fmt-quote")?.textContent).toBe("quoted");
    expect(all("hr.fmt-rule")).toHaveLength(1);
    expect(host.querySelector("pre.fmt-pre code")?.textContent).toBe("code()");
  });

  it("renders an UNCLOSED fence as code, because that is the streaming case", () => {
    // The opening fence arrives seconds before the closing one. A reader
    // watching an answer land should see code appearing in a code block, not
    // three backticks that turn into one later. CommonMark says a fenced block
    // runs to the end of its container, so this is the spec rather than a
    // kindness — which is one of the reasons for using a real parser.
    painting("Here:\n\n```ts\nconst x =");
    expect(host.querySelector("pre.fmt-pre code")?.textContent).toBe("const x =");
  });

  it("never gives an answer a heading that outranks the panel's own", () => {
    // `.chat-head` has the `h2`. A `#` in an answer must not claim the page.
    paint("# Top\n\n###### Deep");
    expect(all("h1, h2, h3")).toHaveLength(0);
    expect(all(".fmt-h").map((h) => h.tagName)).toEqual(["H4", "H6"]);
  });

  it("keeps a hash that is part of the last word", () => {
    // `# Learn C#` rendered as "Learn C" under the hand-rolled parser.
    paint("# Learn C#");
    expect(host.querySelector(".fmt-h")?.textContent).toBe("Learn C#");
  });

  it("leaves an ordinary answer as the paragraphs it always was", () => {
    paint("One thought.\n\nAnother thought.");
    expect(all("p").map((p) => p.textContent)).toEqual(["One thought.", "Another thought."]);
    expect(all("ul, ol, pre, blockquote, hr, .fmt-h")).toHaveLength(0);
  });

  it("keeps a paragraph's own single newlines, which pre-wrap shows", () => {
    paint("A line.\nAnd its continuation.");
    expect(all("p")).toHaveLength(1);
    expect(text()).toBe("A line.\nAnd its continuation.");
  });
});

describe("the marks inside a block", () => {
  it("draws bold and italic, including one inside the other", () => {
    paint("A **firm** and an *emphasised* word, and **a firm *and* both**.");
    expect(host.querySelector("strong")?.textContent).toBe("firm");
    expect(all("em").map((e) => e.textContent)).toEqual(["emphasised", "and"]);
    expect(host.querySelector("strong em")).not.toBeNull();
    expect(text()).not.toContain("*");
  });

  it("lets emphasis cross a link, which the hand-rolled version could not", () => {
    // Review finding 3, and the one a block-level fix would not have reached.
    paint("**[The paper](https://a.example/x)** and *see [source](https://a.example/y) now*");
    expect(host.querySelector("strong a.cited-link")?.textContent).toBe("The paper");
    expect(host.querySelector("em a.cited-link")?.textContent).toBe("source");
    expect(text()).not.toContain("*");
  });

  it("keeps a citation chip working inside a list item", () => {
    paint("- because of this [spya-k3m9qt]");
    const chip = host.querySelector("li .cite .block-ref");
    expect(chip).not.toBeNull();
    expect(chip?.textContent).toContain("k3m9qt");
  });

  it("shows a code span as characters, and nothing else touches it", () => {
    paint("The id `spya-k3m9qt` and the markers `**` are literal.");
    expect(all("code.fmt-code").map((c) => c.textContent)).toEqual(["spya-k3m9qt", "**"]);
    // No chip: inside backticks an id is a string being discussed, not a place.
    expect(all(".cite")).toHaveLength(0);
    expect(all("strong")).toHaveLength(0);
  });

  it("does not let a link out of a code span", () => {
    paint("Write `https://example.com/` in the box.");
    expect(all("a.cited-link")).toHaveLength(0);
    expect(host.querySelector("code.fmt-code")?.textContent).toBe("https://example.com/");
  });

  it("keeps a link whose label contains code", () => {
    paint("[run `npm test`](https://a.example/x)");
    const link = host.querySelector("a.cited-link");
    expect(link?.getAttribute("href")).toBe("https://a.example/x");
    expect(link?.querySelector("code.fmt-code")?.textContent).toBe("npm test");
  });

  it("does not chip a block id inside a link's label", () => {
    // The label is the words the model chose for a destination. A chip in it
    // would put a second, differently-behaved thing inside something the
    // reader is about to press.
    paint("[spya-k3m9qt](https://a.example/x)");
    expect(all(".cite")).toHaveLength(0);
    expect(host.querySelector("a.cited-link")?.textContent).toContain("spya-k3m9qt");
  });
});

describe("the links a model wrote", () => {
  it("prints the real host beside the model's label", () => {
    // The label is the model's to choose and the host is the one part of a
    // link an untrusted page cannot dress up. docs/plans/chat-web-links.md.
    paint("[the paper](https://not-anthropic.example/x)");
    expect(host.querySelector(".cited-link-host")?.textContent).toBe("not-anthropic.example");
  });

  it("carries both rel tokens", () => {
    paint("[here](https://a.example/x)");
    expect(host.querySelector("a.cited-link")?.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("does not print the host twice for an angle autolink", () => {
    // `<https://…>` is core CommonMark — no remark-gfm needed — and arrives
    // with the address as its own label, so the host beside it would be the
    // same string again.
    paint("See <https://a.example/x> now.");
    expect(host.querySelector("a.cited-link")?.getAttribute("href")).toBe("https://a.example/x");
    expect(host.querySelector(".cited-link-host")).toBeNull();
    expect(text()).toBe("See https://a.example/x now.");
  });

  it("refuses a scheme that is not http(s), as characters", () => {
    /* The parser hands back whatever was between the brackets, so the scheme
       allowlist has to be applied where the anchor is built. A refused link
       loses nothing: the reader sees what the model typed. */
    paint("[click](javascript:alert(1))");
    expect(all("a")).toHaveLength(0);
    expect(text()).toBe("[click](javascript:alert(1))");
  });

  it("refuses an address with credentials in it", () => {
    paint("[here](https://user:pass@a.example/x)");
    expect(all("a")).toHaveLength(0);
    expect(text()).toContain("user:pass@a.example");
  });

  it("draws no link at all where the caller has not opted in", () => {
    // The summary panel's prompt has no rule governing what may be linked.
    summarise("[here](https://a.example/x) and https://a.example/y");
    expect(all("a")).toHaveLength(0);
    expect(text()).toContain("[here](https://a.example/x)");
  });
});

describe("what is still arriving", () => {
  it("does not link a half-written address at the end of a paragraph", () => {
    painting("Have a look at https://good.example");
    expect(all("a.cited-link")).toHaveLength(0);
  });

  it("does not link one at the end of a quote or a heading either", () => {
    /* The first version passed "finished" for both, so a bare URL still
       arriving inside a quote was drawn as a link — and `…good.example`
       becomes `…good.example.evil.example/x` two tokens later, which is a link
       the reader can press in the second before it changes. Found by a GPT Sol
       review, 2026-08-31. */
    painting("> See https://good.example");
    expect(all("a.cited-link")).toHaveLength(0);
    painting("# See https://good.example");
    expect(all("a.cited-link")).toHaveLength(0);
  });

  it("does link one that has finished, above the tail", () => {
    painting("See https://good.example/a\n\nand then https://good.example/b");
    expect(all("a.cited-link").map((a) => a.getAttribute("href"))).toEqual([
      "https://good.example/a",
    ]);
  });
});

describe("what must NOT be interpreted", () => {
  /* Almost every answer has no Markdown in it at all, so a rule that reads a
     `-` starting a sentence as a bullet damages far more replies than it
     improves. These are the cases that were hard to get right by hand — the
     last two were defects — and are free from a CommonMark parser. */
  it.each([
    ["arithmetic", "He multiplies it out as 2 * 3 * 4."],
    ["an identifier with underscores", "The flag is some_variable_name here."],
    ["accented words with underscores", "He writes café_naïve_été throughout."],
    ["a hash that is not a heading", "The #1 argument, he says."],
    ["an unpartnered pair of asterisks", "an unclosed ** marker"],
    ["a table, which we deliberately do not read", "| a | b |\n|---|---|\n| 1 | 2 |"],
  ])("leaves %s alone", (_what, source) => {
    paint(source);
    expect(text()).toBe(source);
    expect(all("ul, ol, .fmt-h, em, code, strong")).toHaveLength(0);
  });

  it("does not read a paragraph that starts with bold as a bullet", () => {
    // `**Bold start**` is the commonest opening a model writes, and a bullet
    // rule that did not require whitespace after the marker would eat it. The
    // bold itself is of course drawn — which is also the guard on the guards
    // above: a suite that only ever asserts "nothing happened" would pass with
    // the parser removed entirely.
    paint("**Bold start** of a sentence.");
    expect(all("ul, ol, li")).toHaveLength(0);
    expect(host.querySelector("strong")?.textContent).toBe("Bold start");
    expect(text()).toBe("Bold start of a sentence.");
  });

  it("DOES let a bold pair cross a soft line break, which is a change", () => {
    /* The hand-rolled `splitEmphasis` refused a newline inside a pair, on the
       reasoning that a stray `**` at the top of a paragraph would otherwise
       reach three sentences down and embolden everything between. CommonMark
       allows it, and the parser is right: a model that hard-wraps its prose
       writes `**a\nb**` and means it. Recorded because it is a deliberate
       behaviour that reversed — docs/plans/chat-markdown.md. */
    paint("a **b\nc** d");
    expect(host.querySelector("strong")?.textContent).toBe("b\nc");
  });
});

describe("it is never HTML", () => {
  it("renders markup in an answer as the characters the model wrote", () => {
    paint("He wrote <b>bold</b> and <script>alert(1)</script> in the piece.");
    expect(all("b, script")).toHaveLength(0);
    expect(text()).toContain("<b>bold</b>");
    expect(text()).toContain("<script>alert(1)</script>");
  });

  it("renders a whole block of markup as characters", () => {
    paint("<script>alert(1)</script>");
    expect(all("script")).toHaveLength(0);
    expect(text()).toBe("<script>alert(1)</script>");
  });

  it("renders markup inside a list item and a code block as characters too", () => {
    paint("- <img src=x onerror=1>\n\n```\n<script>alert(1)</script>\n```");
    expect(all("img, script")).toHaveLength(0);
    expect(host.querySelector("li")?.textContent).toBe("<img src=x onerror=1>");
    expect(host.querySelector("pre code")?.textContent).toBe("<script>alert(1)</script>");
  });

  it("does not fetch an image the model asked for", () => {
    /* `![alt](url)` is a real CommonMark construct and the parser returns it.
       An `<img src>` built from model output is a request to an address a
       hostile page chose — a tracking pixel at best. Drawn as characters. */
    paint("![alt](https://a.example/pixel.png)");
    expect(all("img")).toHaveLength(0);
    expect(text()).toBe("![alt](https://a.example/pixel.png)");
  });

  it("loses nothing to a construct it does not draw", () => {
    // Reference links and their definitions are core CommonMark and we render
    // neither. `sourceOf` means the reader still sees exactly what arrived.
    paint("See [foo][bar].\n\n[bar]: https://a.example/x");
    expect(text()).toContain("[foo][bar]");
    expect(text()).toContain("[bar]: https://a.example/x");
  });
});

describe("the client and the server agree about what a citation is", () => {
  /**
   * The invariant `splitLinks` exists for, checked end to end rather than
   * asserted in a comment.
   *
   * The server counts cited ids in an answer to log how many were real and how
   * many the model invented (`citedBlockIds` and `unknownCitedIds` in
   * src/converse.ts), and it does that by blanking every link first — because
   * `https://example.com/notes/spya-k3m9qt` carries an id shape that the reader
   * never sees as a chip. The client now finds links in **two** ways, the parser
   * for `[a](b)` and `<a>` and `splitLinks` for bare ones, so "both sides agree"
   * stopped being obvious the moment the library arrived.
   *
   * A chip on screen and a count in the log have to mean the same thing. Where
   * they drift, the number that gets watched is quietly wrong.
   */
  const serverCount = (answer: string) =>
    (citableText(answer).match(/spya-[a-z0-9]{6}/g) ?? []).length;
  const chipsOnScreen = (answer: string) => {
    paint(answer);
    return all(".cite .block-ref").length;
  };

  it.each([
    ["a plain citation", "He says so [spya-k3m9qt].", 1],
    ["an id inside a bare address", "See https://a.example/notes/spya-k3m9qt today.", 0],
    ["an id inside an angle autolink", "<https://a.example/notes/spya-k3m9qt>", 0],
    ["an id used as a link's label", "[spya-k3m9qt](https://a.example/x)", 0],
    ["an id inside a link's address", "[notes](https://a.example/spya-k3m9qt)", 0],
    ["an id beside raw HTML the model wrote", "He wrote <b>see spya-k3m9qt</b> here.", 1],
    ["an id in an image's alt text", "![see spya-k3m9qt](https://a.example/i.png)", 0],
    ["an id in a list item", "- because of [spya-k3m9qt]", 1],
    ["an id inside a code span", "the string `spya-k3m9qt`", 0],
    ["an id in a code span holding a newline", "the string `line\nspya-k3m9qt`", 0],
    ["an id inside a fenced code block", "```\nspya-k3m9qt\n```", 0],
    ["an id in a TITLED link's label", '[spya-k3m9qt](https://a.example/x "title")', 0],
    ["an id in emphasis at the end of a URL", "https://a.example/_spya-k3m9qt_", 1],
    ["an id in a quote", "> he says so [spya-k3m9qt]", 1],
    ["an id in a heading", "# on [spya-k3m9qt]", 1],
  ])("counts %s the same on both sides", (_what, answer, expected) => {
    expect(chipsOnScreen(answer)).toBe(expected);
    expect(serverCount(answer)).toBe(expected);
  });
});

describe("what the second review caught", () => {
  it("survives Markdown nested past anything a model writes", () => {
    /* The parser handles 4,000 nested quote markers in 140ms; the RENDER WALK
       does not — `RangeError: Maximum call stack size exceeded` at around 2,400
       levels, measured by the reviewer. In this panel that is not a bad answer,
       it is the whole conversation gone. The hand-rolled parser had a depth cap
       and deleting the parser deleted the cap, which is the shape of mistake a
       rewrite makes: the guard lived in the thing being replaced. */
    expect(() => paint(`${">".repeat(4000)} deep`)).not.toThrow();
    // And what is past the cap is still on the page, as characters.
    expect(text()).toContain("deep");
  });

  it("survives a list nested past the cap", () => {
    /* 200 rather than thousands, and the number is the point: `- ` repeated is
       one NESTED LIST per marker, and `mdast-util-from-markdown` is superlinear
       in nesting depth — 1,000 takes 0.9s and 3,000 takes 8.6s, measured here.
       That is the library's own cliff, not this walk's, it needs a model to
       write a line no model writes, and it is recorded in
       docs/plans/chat-markdown.md rather than defended against. What this test
       is for is the cap, which 200 clears twelve times over. */
    expect(() => paint(`${"- ".repeat(200)}deep`)).not.toThrow();
    expect(text()).toContain("deep");
  });

  it("keeps the blank line between two blocks it draws as source", () => {
    /* A node's position covers the node; the blank line BETWEEN two nodes
       belongs to neither, so two reference definitions in a row ran together
       as `[a]: https://a.example[b]: https://b.example`. Which made
       "`sourceOf` cannot lose text" false. */
    paint("[a]: https://a.example\n\n[b]: https://b.example");
    expect(text()).toBe("[a]: https://a.example\n\n[b]: https://b.example");
  });

  it("links a finished address when the answer's tail is a code block", () => {
    /* The greatest-offset text node is not always the end of the answer. Here
       the URL has finished arriving — a whole code block follows it — but it
       was being treated as half-written and left unlinked until the stream
       ended. Over-suppression rather than a premature link, but a flicker. */
    painting("https://a.example/x\n\n```\ncode\n```");
    expect(all("a.cited-link").map((a) => a.getAttribute("href"))).toEqual([
      "https://a.example/x",
    ]);
  });

  it("still refuses the address that really is the tail", () => {
    // The guard on the guard above.
    painting("```\ncode\n```\n\nsee https://a.example/x");
    expect(all("a.cited-link")).toHaveLength(0);
  });
});

describe("the summary panel, which reads marks but not structure", () => {
  it("reads bold and block ids", () => {
    summarise("He calls it **computational functionalism** [spya-k3m9qt].");
    expect(host.querySelector("strong")?.textContent).toBe("computational functionalism");
    expect(host.querySelector(".cite .block-ref")).not.toBeNull();
  });

  it("emits no block elements, because it sits inside a <p>", () => {
    summarise("One point.\n\nAnother point.");
    expect(all("p, ul, ol, h4, h5, h6, blockquote, pre, hr")).toHaveLength(0);
    // The blank line survives as a blank line — `.summ-text` is `pre-wrap`.
    expect(text()).toBe("One point.\n\nAnother point.");
  });

  it("shows a list's markers rather than deleting them", () => {
    /* The one thing flattening must not do. Rendering a list's items without
       their `- ` would silently delete characters the model wrote, which is
       the failure this whole area keeps having; showing the source is what the
       panel did before any of this existed. */
    summarise("Two things:\n\n- one\n- two");
    expect(all("ul, li")).toHaveLength(0);
    expect(text()).toContain("- one\n- two");
  });
});
