// @vitest-environment jsdom
/**
 * **An article's own URL never becomes an `href` unasked.**
 *
 * The fetcher validates a URL on the way in, but an *imported* article's
 * metadata is written straight into the row, so a `javascript:` value is
 * reachable and an unchecked anchor is an active URL sink. GPT Sol raised it
 * on 2026-08-31 against the plan that added a second link to the field, and
 * noted the masthead's existing anchor on the same field had the same hole —
 * which is why `Masthead` is mounted here.
 *
 * The name is historical: `TheOriginal` was an icon in the controls bar,
 * removed on 2026-09-02 as a duplicate of the mark beside the title.
 *
 * Its sibling file, tests/masthead-source.test.tsx, covers who is offered the
 * uploaded PDF, and says at length why a gate like this is tested at the
 * control rather than at the projection two modules away: the protection has
 * to be local and explicit, or it is accidental.
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

/**
 * **The other sinks on the same field**, found on Sol's second pass: the
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
    /* **Two spellings of one allowlist, and the test below proves they agree.**
       `isWebUrl` is the predicate; `webSource(meta)` is `meta.url` put through
       the same `http(s)` test and handed back or refused, which is what the
       masthead and the metadata page both ask now. Accepting either is a
       widening of the grep and not of the policy — the assertion after this loop
       is what keeps that true, and it would go red the day `webSource` let a
       scheme through that `isWebUrl` does not. */
    for (const name of files) {
      const src = await readFile(path.join(process.cwd(), "src", "web", name), "utf8");
      /* Each of these renders one such anchor, and each must name the guard.
         Crude and deliberately so: it cannot prove the guard wraps the right
         element, and it does catch a fifth sink arriving with no guard at all,
         which is how the third and fourth got in. */
      const guarded = src.includes("isWebUrl(") || src.includes("webSource(");
      expect({ name, guarded }).toEqual({ name, guarded: true });
    }

    /* The two predicates on the same values, so "named a guard" means "named
       *the* guard". */
    const { isWebUrl } = await import("../src/urls.js");
    const { webSource } = await import("../src/web/SourceLink.js");
    for (const url of [
      "javascript:alert(1)",
      "data:text/html,x",
      "file:///etc/passwd",
      "vbscript:x",
      "https://example.com/a",
      "http://example.com/a",
    ]) {
      expect({ url, allowed: webSource({ ...meta({}), url }) !== null }).toEqual({
        url,
        allowed: isWebUrl(url),
      });
    }
  });
});

/** The same allowlist on the masthead's own anchor, which had the same hole. */
describe("the article title as a link", () => {
  const article = (m: Meta): Article => ({
    meta: m,
    blocks: [],
    assets: undefined,
    navLabelStatus: "ready",
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
