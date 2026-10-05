// @vitest-environment jsdom
/**
 * **A private link's key through the access hook**: which requests get it,
 * and that an answer fetched under one key is never shown under another.
 * docs/plans/261005e-share-an-article-with-some-people-a-private-link-first.md.
 *
 * tests/public-network-trace.test.tsx drives the same thing through the whole
 * app and reads the network. It cannot see the one render this file is about:
 * the first render after the key changes, before the effect that clears the
 * old answer has run. So the hook is rendered here by a probe that writes down
 * what it was handed on every render.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PublicArticle } from "../src/public-types.js";
import { parseShareKey, type ShareKey } from "../src/share-key.js";
import type { Article } from "../src/types.js";

const apiFetch = vi.fn();
vi.mock("../src/web/lib/api.js", () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  readJson: async (res: Response) => res.json(),
  detailsOf: () => ({}),
}));
vi.mock("../src/web/lib/prefetch-article.js", () => ({ takePreloaded: async () => null }));
const loadPublicArticle = vi.fn();
vi.mock("../src/web/public-api.js", () => ({
  loadPublicArticle: (...args: unknown[]) => loadPublicArticle(...args),
  publicFetch: vi.fn(),
}));
const rehostFootings: unknown[] = [];
const load = () => ({ signal: new AbortController().signal, mint: () => "", release: () => {} });
vi.mock("../src/web/rehost.js", () => ({
  beginArticleLoad: () => load(),
  rehostImages: async (article: Article, _slug: string, footing: unknown) => {
    rehostFootings.push(footing);
    return { article, images: Promise.resolve(null) };
  },
}));

const { resolveAccess, useArticleAccess } = await import("../src/web/article/access.js");

const SLUG = "a-piece";
const KEY_A = parseShareKey("AbCdEfGhIjKlMnOpQrStUv") as ShareKey;
const KEY_B = parseShareKey("ZyXwVuTsRqPoNmLkJiHgFe") as ShareKey;

function payload(sharedBy?: "public" | "link"): PublicArticle {
  return {
    meta: { slug: SLUG, title: "A piece" },
    blocks: [],
    tree: { version: "t", generator: "t", slug: SLUG, rootId: "n0", nodes: {} },
    navLabelStatus: "ready",
    comments: [],
    searches: [],
    ...(sharedBy ? { sharedBy } : {}),
  } as unknown as PublicArticle;
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  apiFetch.mockReset();
  loadPublicArticle.mockReset();
  rehostFootings.length = 0;
});

describe("which requests carry the key", () => {
  it("puts it on the public request and on the visitor's pictures", async () => {
    loadPublicArticle.mockResolvedValue({ kind: "ok", body: payload("link") });
    const { access } = await resolveAccess(SLUG, null, load(), KEY_A);

    expect(access.kind).toBe("public");
    expect(loadPublicArticle).toHaveBeenCalledWith(SLUG, expect.any(AbortSignal), KEY_A);
    expect(rehostFootings).toEqual([{ kind: "link", key: KEY_A }]);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("asks exactly as before when there is no key", async () => {
    loadPublicArticle.mockResolvedValue({ kind: "ok", body: payload("public") });
    await resolveAccess(SLUG, null, load());

    expect(loadPublicArticle).toHaveBeenCalledWith(SLUG, expect.any(AbortSignal), null);
    expect(rehostFootings).toEqual(["public"]);
  });

  /* The owner is on the owner's routes, whatever the address carries. */
  it("gives an owner's requests no key, on the article or its pictures", async () => {
    apiFetch.mockResolvedValue(new Response(JSON.stringify(payload()), { status: 200 }));
    const { access } = await resolveAccess(SLUG, "owner-1", load(), KEY_A);

    expect(access.kind).toBe("owned");
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(String(apiFetch.mock.calls[0]?.[0])).toBe(`/api/article/${SLUG}`);
    expect(JSON.stringify(apiFetch.mock.calls)).not.toContain(KEY_A);
    expect(loadPublicArticle).not.toHaveBeenCalled();
    expect(rehostFootings).toEqual(["owned"]);
  });

  /* Signed in, not the owner: the owned route says 404 without ever seeing the
     key, and the public route is then asked as a stranger's browser asks it. */
  it("lets a signed-in reader who is not the owner through on the key", async () => {
    apiFetch.mockResolvedValue(new Response("{}", { status: 404 }));
    loadPublicArticle.mockResolvedValue({ kind: "ok", body: payload("link") });
    const { access } = await resolveAccess(SLUG, "somebody-else", load(), KEY_A);

    expect(access.kind).toBe("public");
    expect(JSON.stringify(apiFetch.mock.calls)).not.toContain(KEY_A);
    expect(loadPublicArticle).toHaveBeenCalledWith(SLUG, expect.any(AbortSignal), KEY_A);
  });

  it("reads a refused key as not shared", async () => {
    loadPublicArticle.mockResolvedValue({ kind: "not-shared" });
    const { access } = await resolveAccess(SLUG, null, load(), KEY_A);
    expect(access.kind).toBe("not-shared");
  });
});

describe("which way in the page is told", () => {
  it.each([
    ["link", "link"],
    ["public", "public"],
    /* A server older than the field knew one way in. */
    [undefined, "public"],
  ] as const)("reads sharedBy %s as %s", async (sent, drawn) => {
    loadPublicArticle.mockResolvedValue({ kind: "ok", body: payload(sent) });
    const { access } = await resolveAccess(SLUG, null, load(), KEY_A);
    if (access.kind !== "public") throw new Error(`no article: ${access.kind}`);
    expect(access.sharedBy).toBe(drawn);
  });
});

describe("an answer belongs to the key it was fetched under", () => {
  let host: HTMLDivElement;
  let root: Root;
  /** Every render: the key the hook was called with, and what it answered. */
  const seen: string[] = [];

  function Probe({ shareKey }: { shareKey: ShareKey | null }) {
    const access = useArticleAccess(SLUG, null, 0, shareKey);
    seen.push(`${shareKey ?? "none"}:${access.kind}`);
    return null;
  }

  async function show(shareKey: ShareKey | null): Promise<void> {
    await act(async () => root.render(createElement(Probe, { shareKey })));
    for (let i = 0; i < 4; i++) {
      await act(async () => {
        await new Promise((go) => setTimeout(go, 0));
      });
    }
  }

  beforeEach(() => {
    seen.length = 0;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it("never hands a render one key's answer under another key", async () => {
    /* A answers; B never does, so anything drawn for B but `loading` could
       only be A's answer left over. */
    loadPublicArticle.mockImplementation((_slug: string, _signal: AbortSignal, key: ShareKey | null) =>
      key === KEY_A ? Promise.resolve({ kind: "ok", body: payload("link") }) : new Promise(() => {}),
    );

    await show(KEY_A);
    expect(seen, "the control: A's answer was drawn").toContain(`${KEY_A}:public`);

    await show(KEY_B);
    const underB = seen.filter((line) => line.startsWith(`${KEY_B}:`));
    expect(underB.length, "the hook must have rendered under the new key").toBeGreaterThan(0);
    expect(new Set(underB)).toEqual(new Set([`${KEY_B}:loading`]));
    expect(loadPublicArticle).toHaveBeenLastCalledWith(SLUG, expect.any(AbortSignal), KEY_B);
  });

  it("and the same when the key is taken off the address", async () => {
    loadPublicArticle.mockImplementation((_slug: string, _signal: AbortSignal, key: ShareKey | null) =>
      key === KEY_A ? Promise.resolve({ kind: "ok", body: payload("link") }) : new Promise(() => {}),
    );
    await show(KEY_A);
    await show(null);
    const without = seen.filter((line) => line.startsWith("none:"));
    expect(new Set(without)).toEqual(new Set(["none:loading"]));
    expect(loadPublicArticle).toHaveBeenLastCalledWith(SLUG, expect.any(AbortSignal), null);
  });
});
