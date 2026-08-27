// @vitest-environment jsdom
/**
 * The anchor a chat answer's link actually becomes.
 *
 * The splitter has its own tests (chat-web-links.test.ts) and they are about
 * *strings*. This file is about the four things that are true in the source and
 * can be false in the DOM, which is the only place they matter:
 *
 *  - the `href` is the URL the model wrote, and nothing has been prepended to it;
 *  - `rel` carries **both** tokens — `noopener` is about the opened tab and
 *    `noreferrer` is about our reader's history, and they are different promises;
 *  - the class the hover-card selector matches is on the element, because the
 *    preview Greg asked for is wired by that class alone (ProseHoverCard.tsx)
 *    and a renamed class would take it away silently;
 *  - a rejected scheme produces **no anchor at all** — the model's characters,
 *    as text.
 *
 * docs/plans/chat-web-links.md.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CitedText } from "../src/web/Cited.js";

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

/** One paragraph of model prose, rendered as chat renders it. */
function paint(text: string, blocks = new Map<string, string>()): void {
  act(() => {
    root.render(createElement(CitedText, { text, blocks, onJump: () => {}, links: true }));
  });
}

/** The same paragraph as the summary panel renders it — links off. */
function paintWithoutLinks(text: string): void {
  act(() => {
    root.render(
      createElement(CitedText, { text, blocks: new Map<string, string>(), onJump: () => {} }),
    );
  });
}

/* `a.cited-link`, not `a` — a citation chip is an anchor too (`BlockRef`
   renders `/?at=…` so the id is a real address you can copy), and a bare `a`
   here would be counting the chips as links. The same conflation, in the hover
   machinery rather than in a test, is why the card's selector had to be
   narrowed: see ProseHoverCard.tsx. */
const links = () => [...host.querySelectorAll("a.cited-link")];

describe("a link in a chat answer, in the DOM", () => {
  it("carries the model's URL, both rel tokens and the hover class", () => {
    paint("The study is [in Nature](https://www.nature.com/articles/x1).");
    const [a] = links();
    expect(a).toBeTruthy();
    expect(a?.getAttribute("href")).toBe("https://www.nature.com/articles/x1");
    expect(a?.textContent).toBe("in Nature");
    expect(a?.getAttribute("target")).toBe("_blank");
    const rel = a?.getAttribute("rel") ?? "";
    expect(rel.split(/\s+/)).toEqual(expect.arrayContaining(["noopener", "noreferrer"]));
    expect(a?.classList.contains("cited-link")).toBe(true);
  });

  it("keeps the prose either side of it", () => {
    paint("Before [it](https://a.example/x) after.");
    // The host rides along after the label — see below for why it is there.
    expect(host.textContent).toBe("Before ita.example after.");
  });

  /* The label is the model's to choose and the model has been reading pages we
     do not control, so the destination has to be legible without a gesture: a
     card takes 320ms of rest to open and a click does not wait for it. */
  it("prints the real host beside a label that could be lying", () => {
    paint("Read [the Anthropic paper](https://not-anthropic.example/x).");
    expect(host.querySelector(".cited-link-host")?.textContent).toBe("not-anthropic.example");
  });

  it("does not print the host when the label already is the address", () => {
    paint("See https://a.example/x now.");
    expect(host.querySelector(".cited-link-host")).toBeNull();
  });

  it("refuses an address with credentials in it, which is a label in disguise", () => {
    const para = "Read [the paper](https://trusted.example@evil.example/x).";
    paint(para);
    expect(host.querySelectorAll("a")).toHaveLength(0);
    expect(host.textContent).toBe(para);
  });

  it("bolds a link the model wrapped in asterisks, rather than printing them", () => {
    paint("**[The paper](https://a.example/x)**");
    expect(host.textContent).toBe("The papera.example");
    expect(host.querySelector("strong a.cited-link")?.getAttribute("href")).toBe(
      "https://a.example/x",
    );
  });

  it("bolds a run that spans a link", () => {
    paint("**see [here](https://a.example/x) now**");
    expect(host.textContent).not.toContain("**");
    expect(host.querySelectorAll("strong").length).toBeGreaterThan(0);
  });

  it("renders a bare URL as its own label", () => {
    paint("See https://arxiv.org/abs/2212.13345 for it.");
    const [a] = links();
    expect(a?.getAttribute("href")).toBe("https://arxiv.org/abs/2212.13345");
    expect(a?.textContent).toBe("https://arxiv.org/abs/2212.13345");
  });

  it("emboldens inside a label, and does not print the asterisks", () => {
    paint("[the **hard** problem](https://a.example/x)");
    const [a] = links();
    expect(a?.querySelector("strong")?.textContent).toBe("hard");
    expect(a?.textContent).toBe("the hard problem");
  });
});

describe("what never becomes an anchor", () => {
  it.each([
    ["javascript:", "[click](javascript:alert(1))"],
    ["mailto:", "[write](mailto:someone@example.com)"],
    ["data:", "[open](data:text/html,hello)"],
  ])("leaves a %s label as the text the model wrote", (_scheme, para) => {
    paint(para);
    expect(host.querySelectorAll("a")).toHaveLength(0);
    expect(host.textContent).toBe(para);
  });

  it("does not chip a block id that lives inside a URL", () => {
    /* The ordering rule, seen from the DOM: the id is a real one, so a
       citations-first parse would have made a chip out of it *and* cut the
       address in half. One anchor, no chips, the URL whole. */
    const blocks = new Map([["spya-k3m9qt", "The paragraph."]]);
    paint("Notes: https://example.com/notes/spya-k3m9qt there.", blocks);
    expect(host.querySelectorAll(".cite")).toHaveLength(0);
    expect(links()[0]?.getAttribute("href")).toBe("https://example.com/notes/spya-k3m9qt");
  });

  it("draws nothing linkable when the caller did not ask for links", () => {
    /* The summary panel's call. Its model reads the same untrusted article and
       its prompt has no rule about where an address may come from, so the
       `href` sink is not opened for it. Cited.tsx § links. */
    const para = "The study is [in Nature](https://www.nature.com/articles/x1).";
    paintWithoutLinks(para);
    expect(host.querySelectorAll("a")).toHaveLength(0);
    expect(host.textContent).toBe(para);
  });

  it("still chips a real citation beside a link", () => {
    const blocks = new Map([["spya-k3m9qt", "The paragraph."]]);
    paint("He says so [spya-k3m9qt], and the study is [here](https://a.example/x).", blocks);
    expect(host.querySelectorAll(".cite")).toHaveLength(1);
    expect(links()[0]?.getAttribute("href")).toBe("https://a.example/x");
  });
});
