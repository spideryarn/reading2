// @vitest-environment jsdom
/**
 * **The reading view on a private link re-reads the article when the reader's
 * sign-in has just made it theirs** — src/web/article/useClaimSharedArticle.ts,
 * called by `ArticlePage`. docs/plans/261011n-author-gift-link-and-article-ownership-transfer.md
 * § D3; Tests 4.
 *
 * What is pinned:
 *
 * - a signed-in visitor by a link's key asks `GET /api/billing/usage` once,
 *   then re-reads: another simultaneous usage request may have won the claim;
 * - on failure, re-read once because the claim may already have committed
 *   before the response was lost;
 * - never for a signed-out reader, nor for one not visiting by a link;
 * - once per slug and reader, however often the page renders.
 *
 * `apiFetch` is replaced; the server's half is tests/claim-starter-article.test.ts.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let calls: Array<{ url: string; madeFor: string | null | undefined }> = [];
let answer: () => Promise<Response> = async () => json({ claimedArticles: [] });

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

vi.mock("../src/web/lib/api.js", async (importActual) => ({
  ...(await importActual<typeof import("../src/web/lib/api.js")>()),
  apiFetch: (url: string, _init?: RequestInit, madeFor?: string | null) => {
    calls.push({ url, madeFor });
    return answer();
  },
}));

import { shouldCheckSharedArticleClaim, useClaimSharedArticle } from "../src/web/article/useClaimSharedArticle.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLElement;
let rereads = 0;
const reread = () => {
  rereads += 1;
};

function Probe(props: { slug: string; readerId: string | null; byLink: boolean; tick?: number }) {
  useClaimSharedArticle(props.slug, props.readerId, props.byLink, reread);
  return null;
}

async function draw(props: { slug: string; readerId: string | null; byLink: boolean; tick?: number }): Promise<void> {
  await act(async () => {
    root.render(createElement(Probe, props));
  });
  /* Let the fetch and its body settle. */
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

beforeEach(() => {
  calls = [];
  rereads = 0;
  answer = async () => json({ claimedArticles: [] });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("useClaimSharedArticle", () => {
  it("checks a signed-in dead link because another request may just have cleared its key", () => {
    expect(shouldCheckSharedArticleClaim({ kind: "not-shared" }, true)).toBe(true);
    expect(shouldCheckSharedArticleClaim({ kind: "not-shared" }, false)).toBe(false);
    expect(shouldCheckSharedArticleClaim({ kind: "public", sharedBy: "link" }, true)).toBe(true);
    expect(shouldCheckSharedArticleClaim({ kind: "public", sharedBy: "public" }, true)).toBe(false);
  });

  it("re-reads when this slug moved to the reader", async () => {
    answer = async () => json({ plan: {}, claimedArticles: ["the-gift"] });
    await draw({ slug: "the-gift", readerId: "bob", byLink: true });
    expect(calls).toEqual([{ url: "/api/billing/usage", madeFor: "bob" }]);
    expect(rereads).toBe(1);
  });

  it("re-reads when this request moved nothing, because another request may have won the claim", async () => {
    answer = async () => json({ claimedArticles: ["another"] });
    await draw({ slug: "the-gift", readerId: "bob", byLink: true });
    expect(calls).toHaveLength(1);
    expect(rereads).toBe(1);
  });

  it("re-reads when the call fails, because the claim may already have committed", async () => {
    answer = async () => {
      throw new Error("offline");
    };
    await draw({ slug: "the-gift", readerId: "bob", byLink: true });
    expect(calls).toHaveLength(1);
    expect(rereads).toBe(1);
  });

  it("asks nothing of a signed-out reader, or one not visiting by a link", async () => {
    answer = async () => json({ claimedArticles: ["the-gift"] });
    await draw({ slug: "the-gift", readerId: null, byLink: true });
    await draw({ slug: "the-gift", readerId: "bob", byLink: false });
    expect(calls).toEqual([]);
    expect(rereads).toBe(0);
  });

  it("asks once per slug and reader, however often it renders", async () => {
    await draw({ slug: "the-gift", readerId: "bob", byLink: true, tick: 1 });
    await draw({ slug: "the-gift", readerId: "bob", byLink: true, tick: 2 });
    await draw({ slug: "the-gift", readerId: "bob", byLink: false });
    await draw({ slug: "the-gift", readerId: "bob", byLink: true });
    expect(calls).toHaveLength(1);
    await draw({ slug: "another", readerId: "bob", byLink: true });
    expect(calls).toHaveLength(2);
    await draw({ slug: "the-gift", readerId: "bob", byLink: true });
    expect(calls).toHaveLength(2);
  });
});
