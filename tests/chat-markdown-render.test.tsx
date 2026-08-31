// @vitest-environment jsdom
/**
 * What a model's answer actually becomes in the DOM.
 *
 * The parser has its own tests (chat-markdown.test.ts) and they are about
 * *data*. This file is about the things that are true in markdown.ts and can
 * still be false on the screen:
 *
 *  - a bullet list is a `ul` of `li`, which is the whole reason this exists —
 *    before 2026-08-31 it was one paragraph reading `- one - two - three`;
 *  - a citation chip inside a list item is still a chip, so the one contract
 *    the panel has (docs/project/block-ids.md) survives the new structure;
 *  - what is inside backticks reaches the page as **characters**, not as a
 *    chip, a link or bold — the ordering in `splitCode`, seen from outside;
 *  - an answer's heading never outranks the panel's own `h2`;
 *  - and none of it is HTML. Model output that contains markup arrives as text
 *    with the angle brackets in it, which is docs/project/security.md's whole
 *    point and the reason we did not reach for a Markdown library.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CitedMarkdown } from "../src/web/Cited.js";

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

const all = (sel: string) => [...host.querySelectorAll(sel)];

describe("the structure", () => {
  it("draws a bullet list as a list", () => {
    paint("Three reasons:\n\n- one\n- two\n- three");
    expect(all("ul.fmt-list")).toHaveLength(1);
    expect(all("ul.fmt-list > li").map((li) => li.textContent)).toEqual(["one", "two", "three"]);
    // The lead-in is still its own paragraph, and the items are not in it.
    expect(all("p")).toHaveLength(1);
    expect(host.querySelector("p")?.textContent).toBe("Three reasons:");
  });

  it("keeps a numbered list's starting number", () => {
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

  it("never gives an answer a heading that outranks the panel's own", () => {
    // `.chat-head` has the `h2`. A `#` in an answer must not claim the page.
    paint("# Top\n\n###### Deep");
    expect(all("h1, h2, h3")).toHaveLength(0);
    expect(all(".fmt-h").map((h) => h.tagName)).toEqual(["H4", "H6"]);
  });

  it("leaves an ordinary answer as the paragraphs it always was", () => {
    paint("One thought.\n\nAnother thought.");
    expect(all("p").map((p) => p.textContent)).toEqual(["One thought.", "Another thought."]);
    expect(all("ul, ol, pre, blockquote, hr, .fmt-h")).toHaveLength(0);
  });
});

describe("the marks inside a block", () => {
  it("keeps a citation chip working inside a list item", () => {
    paint("- because of this [spya-k3m9qt]");
    const chip = host.querySelector("li .cite .block-ref");
    expect(chip).not.toBeNull();
    expect(chip?.textContent).toContain("k3m9qt");
  });

  it("draws bold and italic", () => {
    paint("A **firm** and an *emphasised* word.");
    expect(host.querySelector("strong")?.textContent).toBe("firm");
    expect(host.querySelector("em")?.textContent).toBe("emphasised");
  });

  it("shows a code span as characters, and nothing else touches it", () => {
    paint("The id `spya-k3m9qt` and the markers `**` are literal.");
    expect(all("code.fmt-code").map((c) => c.textContent)).toEqual(["spya-k3m9qt", "**"]);
    // No chip: inside backticks an id is a string being discussed, not a place.
    expect(all(".cite")).toHaveLength(0);
    expect(all("strong")).toHaveLength(0);
  });

  it("keeps a bold run bold ACROSS a code span", () => {
    /* The bug this file's own first draft shipped, found before a reviewer
       did. Code spans were split off before emphasis, so the two text runs
       either side held one `**` each, neither paired — the whole thing lost
       its bold and printed four asterisks. Exactly the link bug from
       2026-08-27, six days later, which is why `splitInline` now returns one
       run list and `emphasise` pairs across all of it. */
    paint("A **run with `code` in it** here.");
    expect(host.textContent).not.toContain("*");
    const bolds = [...host.querySelectorAll("strong")].map((b) => b.textContent);
    expect(bolds.join("|")).toContain("run with ");
    expect(bolds.join("|")).toContain("code");
    expect(bolds.join("|")).toContain(" in it");
    // And it is still a code span, not prose that happens to be bold.
    expect(host.querySelector("strong code.fmt-code")?.textContent).toBe("code");
  });

  it("does not let a link out of a code span", () => {
    paint("Write `https://example.com/` in the box.");
    expect(all("a.cited-link")).toHaveLength(0);
    expect(host.querySelector("code.fmt-code")?.textContent).toBe("https://example.com/");
  });
});

describe("what is still arriving", () => {
  /** An answer mid-stream: the last characters may be half-written. */
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

  it("does not link a half-written address at the end of a paragraph", () => {
    painting("Have a look at https://good.example");
    expect(all("a.cited-link")).toHaveLength(0);
  });

  it("does not link one at the end of a quote or a heading either", () => {
    /* `drawBlock` passed `partial: false` to both, so a bare URL still
       arriving was drawn as a link — and `…good.example` becomes
       `…good.example.evil.example/x` two tokens later, which is a link the
       reader can press in the second before it changes. Found by a GPT Sol
       review, 2026-08-31. It is the same rule paragraphs already followed. */
    painting("> See https://good.example");
    expect(all("a.cited-link")).toHaveLength(0);
    painting("# See https://good.example");
    expect(all("a.cited-link")).toHaveLength(0);
  });

  it("does link one that has finished, above the tail", () => {
    // The flag is about the END of an answer. Everything above it has landed,
    // and refusing those links would be a different bug.
    painting("See https://good.example/a\n\nand then https://good.example/b");
    expect(all("a.cited-link").map((a) => a.getAttribute("href"))).toEqual([
      "https://good.example/a",
    ]);
  });
});

describe("it is never HTML", () => {
  it("renders markup in an answer as the characters the model wrote", () => {
    paint("He wrote <b>bold</b> and <script>alert(1)</script> in the piece.");
    expect(all("b, script")).toHaveLength(0);
    expect(host.textContent).toContain("<b>bold</b>");
    expect(host.textContent).toContain("<script>alert(1)</script>");
  });

  it("renders markup inside a list item and a code block as characters too", () => {
    paint("- <img src=x onerror=1>\n\n```\n<script>alert(1)</script>\n```");
    expect(all("img, script")).toHaveLength(0);
    expect(host.querySelector("li")?.textContent).toBe("<img src=x onerror=1>");
    expect(host.querySelector("pre code")?.textContent).toBe("<script>alert(1)</script>");
  });
});
