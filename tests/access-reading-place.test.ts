// @vitest-environment jsdom
/**
 * **The owner's place, as the article read hands it on** — access.ts §
 * `resolveAccess` and `savedPlaceFrom`; plan 261029f § As built.
 *
 * Block identities outlive a re-extraction, so the server can name a paragraph
 * today's body does not have; arriving at it is impossible, so it is the top
 * (GPT Sol's build review, F5). A field that is not a well-formed id is the
 * top too, and an absent one, from an older server, is "never opened".
 *
 * Mocked at the transport and the rehosting, as tests/maths-access.test.ts is.
 */
import { describe, expect, it, vi } from "vitest";
import type { Article } from "../src/types.js";

const apiFetch = vi.fn();
vi.mock("../src/web/lib/api.js", () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  readJson: async (res: Response) => res.json(),
}));
vi.mock("../src/web/public-api.js", () => ({ loadPublicArticle: vi.fn(), publicFetch: vi.fn() }));
vi.mock("../src/web/rehost.js", () => ({
  beginArticleLoad: () => {
    throw new Error("the test hands resolveAccess its own load");
  },
  rehostImages: async (article: Article) => ({ article, images: Promise.resolve(null) }),
}));

const { resolveAccess } = await import("../src/web/article/access.js");

const BLOCK = "spya-aaaaaa";

async function placeFor(readingPlace: unknown): Promise<unknown> {
  const raw = {
    slug: "placed",
    title: "Placed",
    blocks: [{ id: BLOCK, tag: "p", kind: "paragraph", text: "", words: 0, html: "<p>Hello</p>", gistable: true }],
    ...(readingPlace === undefined ? {} : { readingPlace }),
  };
  apiFetch.mockResolvedValue(new Response(JSON.stringify(raw), { status: 200 }));
  const load = { signal: new AbortController().signal, mint: () => "", release: () => {} };
  return (await resolveAccess("placed", "reader-1", load)).readingPlace;
}

describe("the owned answer's readingPlace", () => {
  it("is the paragraph, when the article still has it", async () => {
    expect(await placeFor({ block: BLOCK })).toEqual({ block: BLOCK });
  });

  it("is the top when today's body has no such paragraph", async () => {
    expect(await placeFor({ block: "spya-zzzzz9" })).toEqual({ block: null });
  });

  it("is the top when the id is not one", async () => {
    expect(await placeFor({ block: "../x" })).toEqual({ block: null });
    expect(await placeFor({ block: null })).toEqual({ block: null });
  });

  it("is never-opened when the field is absent or null", async () => {
    expect(await placeFor(undefined)).toBeNull();
    expect(await placeFor(null)).toBeNull();
  });
});
