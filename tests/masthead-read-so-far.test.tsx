// @vitest-environment jsdom
/**
 * **The masthead says, coarsely, how much of the piece you have read** —
 * Greg, 2026-10-25 (`spya-e5477u`): *"At the top of the article, could you
 * somehow give a quick visual indication of roughly how much of it has been
 * read? … it can be a coarse estimate"*.
 * docs/plans/261025j-how-much-of-the-article-you-have-read-at-the-top.md.
 *
 * What a reader would notice if it broke: no mark beside the read time; a
 * percentage where a coarse word was promised; a mark with no band (still
 * loading, or nothing read) claiming something anyway.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Article } from "../src/types.js";
import type { ReadBand } from "../src/web/read-filter.js";

vi.mock("../src/web/lib/supabase.js", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { access_token: "t" } } }),
      refreshSession: async () => ({ data: { session: { access_token: "t" } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
  googleSignInAvailable: false,
}));

const { Masthead } = await import("../src/web/Masthead.js");

const SLUG = "a-read-paper";

const article = {
  highPowerSince: null,
  titleOverridden: false,
  meta: { slug: SLUG, title: "A paper" },
  blocks: [
    { id: "spya-aaaaaa", tag: "p", kind: "text", text: "A paragraph.", words: 2, html: "<p>A paragraph.</p>", gistable: true },
  ],
  assets: undefined,
  navLabelStatus: "ready",
  sourceGuess: undefined,
  tree: {
    version: "t",
    generator: "t",
    slug: SLUG,
    rootId: "n0",
    nodes: {
      n0: { id: "n0", depth: 0, parent: null, children: [], range: ["spya-aaaaaa", "spya-aaaaaa"], title: "A paper" },
    },
  },
} as unknown as Article;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  history.replaceState(null, "", `/read/${SLUG}`);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

async function mount(readBand: ReadBand | undefined) {
  await act(async () => {
    root.render(createElement(Masthead, { article, slug: SLUG, onRenamed: () => {}, readBand }));
  });
}

const mark = () => host.querySelector<HTMLButtonElement>(".facts .share-pie.read-so-far");
const readerSource = readFileSync(path.resolve(import.meta.dirname, "../src/web/reader/Reader.tsx"), "utf8");

describe("the read-so-far mark", () => {
  it("is wired from the owner's reading state into the masthead", () => {
    /* The pure band and Masthead tests would both pass if Reader stopped
       joining them. `owner?.` is also the visitor gate. */
    expect(readerSource).toContain("const readingLevels = owner?.readingTime.levels;");
    expect(readerSource).toContain("const readSoFarBand = useMemo(() => readBandFor(readSoFar), [readSoFar]);");
    expect(readerSource).toContain("readBand={readSoFarBand}");
  });

  it.each([
    ["started", "Read so far: started"],
    ["half", "Read so far: about half"],
    ["most", "Read so far: most of it"],
    ["finished", "Read so far: finished"],
  ] as const)("draws %s beside the read time, named in words", async (band, name) => {
    await mount(band);
    expect(mark()?.getAttribute("aria-label")).toBe(name);
    /* In the read time's own fact, so no dot separates the two. */
    expect(mark()?.closest(".facts > span")?.textContent).toMatch(/^~\d+ min$/);
  });

  it("draws the band as a whole quarter of the pie", async () => {
    await mount("half");
    const d = mark()?.querySelector("path.share-pie-part")?.getAttribute("d") ?? "";
    // Half a circle of radius 6 from twelve o'clock ends at six o'clock.
    expect(d).toMatch(/ 0 6 Z$/);
    await mount("finished");
    expect(mark()?.querySelector("circle.share-pie-part")).not.toBeNull();
  });

  it("never prints a percentage", async () => {
    for (const band of ["started", "half", "most", "finished"] as const) {
      await mount(band);
      expect(mark()?.getAttribute("aria-label")).not.toMatch(/\d/);
    }
  });

  it("draws nothing with no band, or with nothing read", async () => {
    await mount(undefined);
    expect(mark()).toBeNull();
    await mount("none");
    expect(mark()).toBeNull();
  });
});
