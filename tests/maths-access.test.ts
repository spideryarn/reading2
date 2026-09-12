// @vitest-environment jsdom
/**
 * **The maths-rendered article is the one every draw gets** — the doorway in
 * src/web/article/access.ts § `resolveAccess`, the plan's F10.
 *
 * `rehostImages` hands back two draws, and when the second one rejects the
 * doorway falls back to the article it gave the first. If that fallback were a
 * different local from the one that went through `renderArticleMaths`, an
 * image that failed to load would put raw TeX back on the page — silently, and
 * only on articles that have both pictures and maths.
 *
 * Mocked at the two module boundaries the doorway stands on: the transport
 * (`apiFetch`) and the rehosting (`rehostImages`). `renderArticleMaths` and its
 * real, lazily imported temml are deliberately not mocked — that the default
 * loader works at all is part of what this proves.
 */
import { describe, expect, it, vi } from "vitest";
import type { Article } from "../src/types.js";

const apiFetch = vi.fn();
vi.mock("../src/web/lib/api.js", () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  readJson: async (res: Response) => res.json(),
}));
vi.mock("../src/web/public-api.js", () => ({ loadPublicArticle: vi.fn(), publicFetch: vi.fn() }));
const rehostImages = vi.fn();
vi.mock("../src/web/rehost.js", () => ({
  beginArticleLoad: () => {
    throw new Error("the test hands resolveAccess its own load");
  },
  rehostImages: (...args: unknown[]) => rehostImages(...args),
}));

const { resolveAccess } = await import("../src/web/article/access.js");

describe("resolveAccess and rendered maths", () => {
  it("the fallback after a failed second draw is the maths-rendered article", async () => {
    const raw = {
      slug: "maths",
      title: "Maths",
      blocks: [{ id: "spya-aaaaaa", tag: "p", kind: "paragraph", text: "", words: 0, html: String.raw`<p>\(x^2\)</p>`, gistable: true }],
    };
    apiFetch.mockResolvedValue(new Response(JSON.stringify(raw), { status: 200 }));
    rehostImages.mockImplementation(async (article: Article) => ({
      article,
      images: Promise.reject(new Error("the images did not arrive")),
    }));
    const load = { signal: new AbortController().signal, mint: () => "", release: () => {} };

    const { access, withImages } = await resolveAccess("maths", true, load);
    const given = rehostImages.mock.calls[0]?.[0] as Article;
    expect(given.blocks[0]!.html, "rehostImages was handed the rendered article").toContain("<math");
    expect(access.kind).toBe("owned");

    const fallback = await withImages;
    expect(fallback?.kind).toBe("owned");
    expect(fallback && "article" in fallback ? fallback.article : null).toBe(given);
  });
});
