// @vitest-environment jsdom
/**
 * **A mockup's id in a question is a link to its page** — plan 261028b,
 * Stage 3. Only an id of the fixed shape becomes a link, the link is built
 * from the id, and it is off unless asked for (a mockup's own body does not
 * ask). src/web/PlainTextBlocks.tsx.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PlainTextBlocks } from "../src/web/PlainTextBlocks.js";

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

function draw(text: string, linkMockups: boolean) {
  act(() => root.render(<PlainTextBlocks text={text} linkMockups={linkMockups} />));
}

describe("PlainTextBlocks linkMockups", () => {
  it("links a mockup id, in a new tab, and keeps the words around it", () => {
    draw("Compare m-n0gnmu with the other one.", true);
    const links = [...host.querySelectorAll("a")];
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["/admin/mockups/m-n0gnmu"]);
    expect(links[0]?.getAttribute("target")).toBe("_blank");
    expect(host.textContent).toBe("Compare m-n0gnmu with the other one.");
  });

  it("leaves a string that is not a mockup id alone", () => {
    /* `l` is outside the id alphabet (src/ids.ts); seven characters is not an id. */
    draw("m-llllll m-n0gnmuu xm-n0gnmu", true);
    expect(host.querySelectorAll("a")).toHaveLength(0);
  });

  it("links nothing inside a monospaced block, or when not asked", () => {
    draw("```\nm-n0gnmu\n```", true);
    expect(host.querySelectorAll("a")).toHaveLength(0);
    draw("See m-n0gnmu.", false);
    expect(host.querySelectorAll("a")).toHaveLength(0);
  });
});
