// @vitest-environment jsdom
/**
 * **The owner's reading view asks where an upload lives on the web — once.**
 * src/web/useSourceGuess.ts; docs/plans/260929g-canonical-link-for-an-uploaded-paper.md
 * § Decisions 2.
 *
 * The server holds the real once-per-upload claim; what the client owes it is
 * not to hammer it. So: one POST per mount for an upload with no settled
 * answer, none for a settled one or a web article — and none twice under
 * `<StrictMode>`, which runs every effect twice in development and is on in
 * main.tsx. Every case below mounts inside it for that reason.
 *
 * A visitor never mounts this hook (it lives in `OwnedArticle`); the trace that
 * proves a signed-out browser sends no POST is tests/public-network-trace.test.tsx,
 * which also carries the owner's end-to-end case through the real `App`.
 */
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Article, Meta, SourceGuess } from "../src/types.js";

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

const { useSourceGuess } = await import("../src/web/useSourceGuess.js");

const SLUG = "an-upload";
const FOUND: SourceGuess = {
  status: "found",
  url: "https://arxiv.org/abs/2401.01234",
  host: "arxiv.org",
  kind: "canonical",
  matchedBy: "arxiv",
};

const UPLOAD: Partial<Meta> = { source: "pdf", filename: "paper.pdf" };

function article(meta: Partial<Meta>, sourceGuess: SourceGuess | undefined): Article {
  return {
    meta: { slug: SLUG, title: "A paper", ...meta },
    blocks: [],
    assets: undefined,
    navLabelStatus: "ready",
    sourceGuess,
    tree: {
      version: "t",
      generator: "t",
      slug: SLUG,
      rootId: "n0",
      nodes: { n0: { id: "n0", depth: 0, parent: null, children: [], title: "A paper" } },
    },
  } as unknown as Article;
}

let host: HTMLDivElement;
let root: Root;
let posts: string[];
/** What the route answers; a function so a case can make it fail. */
let answer: () => Promise<Response>;
/** The hook's return value, as last rendered. */
let seen: SourceGuess | null;

function Harness({ a }: { a: Article }) {
  seen = useSourceGuess(SLUG, a);
  return null;
}

async function mount(a: Article) {
  await act(async () => {
    root.render(createElement(StrictMode, null, createElement(Harness, { a })));
  });
  /* Let the POST and its body settle. */
  for (let i = 0; i < 4; i++) {
    await act(async () => {
      await new Promise((go) => setTimeout(go, 0));
    });
  }
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  posts = [];
  seen = null;
  answer = async () =>
    new Response(JSON.stringify(FOUND), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    if ((init?.method ?? "GET") === "POST") posts.push(String(input));
    return answer();
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("useSourceGuess", () => {
  it.each([
    ["nobody has looked", undefined],
    ["a search is under way", { status: "searching" } as const],
  ])("asks exactly once when %s, under StrictMode", async (_name, guess) => {
    await mount(article(UPLOAD, guess));

    expect(posts).toEqual([`/api/source-guess/${SLUG}`]);
    /* And hands the answer back, so the page can draw it without a reload. */
    expect(seen).toEqual(FOUND);
  });

  it("does not ask again when the article re-renders as a new object", async () => {
    await mount(article(UPLOAD, undefined));
    await mount(article(UPLOAD, undefined));
    await mount(article({ ...UPLOAD, title: "Renamed" }, undefined));

    expect(posts).toHaveLength(1);
  });

  it.each([
    ["a found guess", FOUND],
    ["a settled none", { status: "none" } as const],
  ])("never asks when the payload already has %s", async (_name, guess) => {
    await mount(article(UPLOAD, guess));

    expect(posts).toEqual([]);
    expect(seen).toBeNull();
  });

  it("never asks for a web article, even a PDF", async () => {
    await mount(article({ source: "pdf", url: "https://example.com/p.pdf" }, undefined));
    expect(posts).toEqual([]);
  });

  it("never asks for an article that did not come off a disk", async () => {
    await mount(article({}, undefined));
    expect(posts).toEqual([]);
  });

  /**
   * **The positive control for the silence above**: an uploaded HTML file is
   * an upload too (`cameOffADisk` reads `filename`, not only `source`), so a
   * hook that asked only for PDFs would pass every "never" case and fail here.
   */
  it("asks for an uploaded HTML file too", async () => {
    await mount(article({ filename: "page.html" }, undefined));
    expect(posts).toHaveLength(1);
  });

  it("is silent on failure, and does not retry on the same page", async () => {
    answer = async () => new Response(JSON.stringify({ error: "busy" }), { status: 429 });
    await mount(article(UPLOAD, undefined));
    await mount(article(UPLOAD, { status: "searching" }));

    expect(posts).toHaveLength(1);
    expect(seen).toBeNull();
  });

  it("does not layer a 'searching' answer over the payload", async () => {
    answer = async () =>
      new Response(JSON.stringify({ status: "searching" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    await mount(article(UPLOAD, undefined));

    expect(posts).toHaveLength(1);
    expect(seen).toBeNull();
  });

  it("refuses an answer whose shape is wrong rather than drawing it", async () => {
    answer = async () =>
      new Response(JSON.stringify({ status: "found", url: 7 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    await mount(article(UPLOAD, undefined));

    expect(seen).toBeNull();
  });
});
