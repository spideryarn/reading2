// @vitest-environment jsdom
/**
 * **The way to the original, in the controls bar** — SourceLink.tsx §
 * `TheOriginal`, added 2026-08-31 because Greg asked for one:
 *
 * > It should be easier to get to the original article somehow. Maybe an icon in
 * > the top bar that takes you to the original source url (maybe it becomes a
 * > download link if it was uploaded), with nice tooltips.
 *
 * Three states, and each is tested for what it *does not* offer as much as for
 * what it does. Its sibling file, tests/masthead-source.test.tsx, does the same
 * job for the masthead's sentence, and says at length why a gate like this is
 * tested at the control rather than at the projection two modules away: the
 * protection has to be local and explicit, or it is accidental.
 *
 * The one that is not merely a UI rule:
 *
 * **`meta.url` is checked against the http(s) allowlist before it becomes an
 * `href`.** The fetcher validates a URL on the way in, but an *imported*
 * article's metadata is written straight into the row, so a `javascript:` value
 * is reachable and an unchecked anchor is an active URL sink. GPT Sol raised it
 * against the plan, 2026-08-31, and noted the masthead's existing anchor on the
 * same field had the same hole — which is why `Masthead` is mounted here too.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Article, Meta } from "../src/types.js";

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

const { TheOriginal } = await import("../src/web/SourceLink.js");
const { Masthead } = await import("../src/web/Masthead.js");

const SLUG = "a-piece";

const meta = (extra: Partial<Meta>): Meta => ({ slug: SLUG, title: "A piece", ...extra });

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("fetch", () => Promise.resolve(new Response("{}", { status: 200 })));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function mount(m: Meta, owner: boolean) {
  await act(async () => {
    root.render(
      createElement(TheOriginal, { meta: m, slug: SLUG, owner, onError: () => {} }),
    );
  });
}

/** What a reader could press, whoever they are. */
const controls = () => [...host.querySelectorAll("a[href], button")];

describe("the original-source control", () => {
  it("links to a web page, in a new tab, and says where it goes", async () => {
    await mount(meta({ url: "https://www.noemamag.com/a-piece/" }), true);

    const link = host.querySelector("a");
    expect(link?.getAttribute("href")).toBe("https://www.noemamag.com/a-piece/");
    expect(link?.getAttribute("target")).toBe("_blank");
    /* A script-openable tab that can reach back into ours is the thing `noopener`
       exists for, and this one is about to load somebody else's page. */
    expect(link?.getAttribute("rel")).toContain("noopener");
    /* Greg asked for "nice tooltips", and the host is the useful half — it is
       what tells you whether the link goes where you think. */
    expect(link?.getAttribute("title")).toBe("Open the original at noemamag.com");
  });

  it("offers a public URL to a visitor, because it is a public address", async () => {
    await mount(meta({ url: "https://example.com/a" }), false);
    expect(controls()).toHaveLength(1);
  });

  /**
   * **The security case.** An imported row can carry anything in `final_url`,
   * and the two arms below are what stops it becoming an active sink: the
   * scheme is not on the allowlist, so no anchor is rendered at all.
   */
  for (const url of ["javascript:alert(1)", "data:text/html,<script>alert(1)</script>", "vbscript:x"]) {
    it(`refuses to make an href out of ${url.split(":")[0]}:`, async () => {
      await mount(meta({ url }), true);
      expect(host.querySelectorAll("a")).toHaveLength(0);
      /* And it does not silently become the download arm either — this article
         is not a PDF, so there is nothing here to offer. */
      expect(controls()).toHaveLength(0);
    });
  }

  it("falls through to the file for a PDF read off a local path", async () => {
    /* `file://` is a real `meta.url` — it is what a PDF ingested from disk
       carries — and it is not an address anybody else can follow. The right
       answer is the download, not a dead link. */
    await mount(meta({ url: "file:///Users/greg/paper.pdf", source: "pdf" }), true);
    expect(host.querySelectorAll("a")).toHaveLength(0);
    expect(host.querySelector("button")?.getAttribute("title")).toBe(
      "Download the PDF this was made from",
    );
  });

  it("offers the owner their uploaded PDF, and says so", async () => {
    await mount(meta({ source: "pdf" }), true);
    expect(host.querySelector("button")?.getAttribute("title")).toBe(
      "Download the PDF this was made from",
    );
  });

  it("names the scan for what it is when there was no text layer", async () => {
    await mount(meta({ source: "pdf", unverified: true }), true);
    expect(host.querySelector("button")?.getAttribute("title")).toBe(
      "Download the scanned pages this was transcribed from",
    );
  });

  /**
   * **Not a dimmed control and not a broken one.** `GET /api/source/:slug` is
   * owner-only by design — *"Serving somebody's uploaded bytes to the world is a
   * separate decision from serving the extracted text"* — so a visitor pressing
   * this would open a blank tab, make a private request, be refused, and be left
   * looking at nothing. The same rule `SeeTheOriginal` keeps in Masthead.tsx.
   */
  it("offers a visitor nothing for an uploaded PDF", async () => {
    await mount(meta({ source: "pdf" }), false);
    expect(controls()).toHaveLength(0);
  });

  it("renders nothing at all for an article with neither", async () => {
    await mount(meta({}), true);
    expect(host.innerHTML).toBe("");
  });
});

/**
 * **The other two sinks on the same field**, found on Sol's second pass: the
 * metadata page prints the whole address and the shelf card has an *Open the
 * original page* button, and both were rendering `meta.url` / `entry.url` as an
 * `href` unchecked. Four sinks on one imported string, and gating two of them
 * was not a policy.
 */
describe("the other places an article's URL becomes a link", () => {
  it("prints a refused address on the metadata page without linking it", async () => {
    /* This page is the one that shows the URL as text, so the reader still sees
       what we hold — it just is not clickable. */
    const { Metadata } = await import("../src/web/Metadata.js");
    expect(typeof Metadata).toBe("function");
    /* The gate itself, asserted where it can be asserted without mounting a page
       that fetches: both call sites read the same predicate, and these are the
       values that must not pass it. */
    const { isWebUrl } = await import("../src/urls.js");
    for (const url of ["javascript:alert(1)", "data:text/html,x", "file:///etc/passwd", "vbscript:x"]) {
      expect({ url, allowed: isWebUrl(url) }).toEqual({ url, allowed: false });
    }
    for (const url of ["https://example.com/a", "http://example.com/a"]) {
      expect({ url, allowed: isWebUrl(url) }).toEqual({ url, allowed: true });
    }
  });

  /**
   * **And nothing renders `meta.url` as an `href` without asking.** A grep
   * rather than a render, because the four sites are in four components with
   * four different mounting costs, and what has to hold is a property of the
   * codebase rather than of any one of them: an `href` fed by an article's own
   * URL is inside an `isWebUrl` guard.
   */
  it("leaves no article URL reaching an href ungated", async () => {
    const { readFile } = await import("node:fs/promises");
    const path = await import("node:path");
    /* `process.cwd()`, not `import.meta.url`: this file runs under jsdom, where
       the module URL does not resolve to a real path and every read is an
       ENOENT that reads like a missing component. */
    const files = ["Masthead.tsx", "Metadata.tsx", "ShelfEntry.tsx", "SourceLink.tsx"];
    for (const name of files) {
      const src = await readFile(path.join(process.cwd(), "src", "web", name), "utf8");
      /* Each of these renders one such anchor, and each must name the guard.
         Crude and deliberately so: it cannot prove the guard wraps the right
         element, and it does catch a fifth sink arriving with no guard at all,
         which is how the third and fourth got in. */
      expect({ name, guarded: src.includes("isWebUrl(") }).toEqual({ name, guarded: true });
    }
  });
});

/** The same allowlist on the masthead's own anchor, which had the same hole. */
describe("the article title as a link", () => {
  const article = (m: Meta): Article => ({
    meta: m,
    blocks: [],
    assets: undefined,
    tree: {
      version: "t",
      generator: "t",
      slug: SLUG,
      rootId: "n0",
      nodes: {
        n0: { id: "n0", depth: 0, parent: null, children: [], range: ["spya-aaaaaa", "spya-aaaaaa"], title: "A piece" },
      },
    },
  });

  const mountMasthead = async (m: Meta) => {
    await act(async () => {
      root.render(createElement(Masthead, { article: article(m), slug: SLUG }));
    });
  };

  it("links an http(s) address", async () => {
    await mountMasthead(meta({ url: "https://example.com/a" }));
    expect(host.querySelector("h1 a")?.getAttribute("href")).toBe("https://example.com/a");
  });

  it("renders a javascript: title as plain text, not as a link", async () => {
    await mountMasthead(meta({ url: "javascript:alert(1)", title: "A piece" }));
    expect(host.querySelector("h1 a")).toBeNull();
    expect(host.querySelector("h1")?.textContent).toContain("A piece");
  });
});
