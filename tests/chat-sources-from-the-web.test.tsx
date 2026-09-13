// @vitest-environment jsdom
/**
 * **"From the web" over the sources under an answer — and over nothing else.**
 *
 * Report 3D asked for an answer that is *"crystal clear about what is and what
 * is not from the article"*. A block id is a chip, a web link has its host
 * beside it; the list of the search's pages under the answer had no heading, so
 * nothing on screen said those were the web half.
 *
 * The heading must never stand over an empty list. The list is filtered by
 * `isWebUrl` before it is drawn, so an array holding only a non-web URL is
 * non-empty *and* draws nothing — a heading inside the old
 * `citations.length > 0` guard would have been a label over nothing (Sol F10).
 * docs/plans/260913b-chat-and-comment-questions-reach-for-the-web-and-the-citations-list.md.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSources } from "../src/web/ChatPanel.js";
import type { Citation } from "../src/types.js";

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

function paint(citations: Citation[] | undefined): void {
  act(() => {
    root.render(createElement(WebSources, { citations }));
  });
}

describe("the sources under an answer", () => {
  it("are headed 'From the web' when there is a web page to list", () => {
    paint([{ url: "https://www.nature.com/articles/x1", title: "A study" }]);
    expect(host.querySelector(".chat-sources-label")?.textContent).toBe("From the web");
    const links = [...host.querySelectorAll(".chat-sources a")];
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["https://www.nature.com/articles/x1"]);
  });

  it("list only the web pages when a stored row also holds a non-web URL", () => {
    paint([
      { url: "javascript:alert(1)", title: "bad" },
      { url: "https://a.example/x" },
    ]);
    expect(host.querySelector(".chat-sources-label")?.textContent).toBe("From the web");
    expect([...host.querySelectorAll(".chat-sources a")].map((a) => a.getAttribute("href"))).toEqual([
      "https://a.example/x",
    ]);
  });

  it("uses the host when an older stored source has an empty title", () => {
    paint([{ url: "https://evidence.example/paper", title: "   " }]);
    expect(host.querySelector(".chat-sources a")?.textContent).toBe("evidence.example");
  });

  it.each([
    ["undefined", undefined],
    ["an empty list", []],
    ["only a javascript: URL", [{ url: "javascript:alert(1)", title: "click" }]],
    ["only an ftp: URL", [{ url: "ftp://files.example/x" }]],
  ] as const)("draw nothing at all for %s", (_label, citations) => {
    paint(citations as Citation[] | undefined);
    expect(host.textContent).not.toContain("From the web");
    expect(host.querySelector(".chat-sources")).toBeNull();
  });
});
