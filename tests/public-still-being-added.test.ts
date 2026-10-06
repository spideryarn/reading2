// @vitest-environment jsdom
/**
 * **`409 still-being-added` is a third answer of the public article read** —
 * src/web/public-api.ts § `loadPublicArticle`, passed through by
 * src/web/article/access.ts § `findArticle`;
 * docs/plans/261005l-permalink-and-share-while-an-article-is-importing.md
 * § Stage 2, 2c.
 *
 * The server answers it for a shared article whose import has not published
 * (src/still-being-added.ts). What is pinned on this side: only that code
 * becomes the answer, any other 409 is the failure it always was, and the two
 * steps hand it on for a signed-out visitor, a signed-in reader, and one whose
 * session could not be confirmed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ShareKey } from "../src/share-key.js";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const STILL = () => json({ error: "This article is still being added. [pub-adding]", code: "still-being-added" }, 409);

/** What the owned route answers. */
let owned: () => Response = () => json({ error: "No such article" }, 404);
const ownedCalls: string[] = [];
vi.mock("../src/web/lib/api.js", async (importActual) => ({
  ...(await importActual<typeof import("../src/web/lib/api.js")>()),
  apiFetch: async (url: string) => {
    ownedCalls.push(url);
    return owned();
  },
}));
vi.mock("../src/web/lib/prefetch-article.js", () => ({ takePreloaded: async () => null }));

const { loadPublicArticle } = await import("../src/web/public-api.js");
const { resolveAccess } = await import("../src/web/article/access.js");

/** What the public route answers, and every address it was asked at. */
let publicAnswer: () => Response = STILL;
const asked: string[] = [];

const load = () => ({ signal: new AbortController().signal, mint: () => "", release: () => {} });

beforeEach(() => {
  asked.length = 0;
  ownedCalls.length = 0;
  owned = () => json({ error: "No such article" }, 404);
  publicAnswer = STILL;
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal("fetch", async (url: string) => {
    asked.push(url);
    return publicAnswer();
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("loadPublicArticle", () => {
  it("answers still-being-added for a 409 with that code", async () => {
    expect(await loadPublicArticle("a-paper")).toEqual({ kind: "still-being-added" });
    expect(asked).toEqual(["/api/public/article/a-paper"]);
  });

  it("sends a private link's key with it", async () => {
    const key = "AAAAAAAAAAAAAAAAAAAAAA" as ShareKey;
    expect(await loadPublicArticle("a-paper", undefined, key)).toEqual({ kind: "still-being-added" });
    expect(asked).toEqual([`/api/public/article/a-paper?key=${key}`]);
  });

  it.each([
    ["another code", { error: "Not read through yet", code: "not-processed" }],
    ["no code", { error: "Conflict" }],
    ["a code that is not a string", { error: "Conflict", code: 409 }],
  ])("throws for a 409 with %s, as it always did", async (_name, body) => {
    publicAnswer = () => json(body, 409);
    await expect(loadPublicArticle("a-paper")).rejects.toThrow(body.error);
  });

  it("still answers not-shared for a 404, and throws for a 500", async () => {
    publicAnswer = () => json({ error: "Not found" }, 404);
    expect(await loadPublicArticle("a-paper")).toEqual({ kind: "not-shared" });
    publicAnswer = () => json({ error: "boom" }, 500);
    await expect(loadPublicArticle("a-paper")).rejects.toThrow("boom");
  });
});

describe("the two-step passes it through", () => {
  it("signed out: the public route alone, and its answer", async () => {
    const { access } = await resolveAccess("a-paper", null, load());
    expect(access).toEqual({ kind: "still-being-added" });
    expect(ownedCalls).toEqual([]);
  });

  it("signed in, not theirs or not published: the owned 404, then the public answer", async () => {
    const { access, withImages } = await resolveAccess("a-paper", "reader-1", load());
    expect(access).toEqual({ kind: "still-being-added" });
    expect(ownedCalls).toEqual(["/api/article/a-paper"]);
    expect(await withImages).toBeNull();
  });

  it("a session that could not be confirmed still gets the public answer, not a sign-in page", async () => {
    owned = () => json({ error: "Unauthorised" }, 401);
    const { access } = await resolveAccess("a-paper", "reader-1", load());
    expect(access).toEqual({ kind: "still-being-added" });
  });

  it("a 404 from both is not-shared, as before", async () => {
    publicAnswer = () => json({ error: "Not found" }, 404);
    const { access } = await resolveAccess("a-paper", "reader-1", load());
    expect(access).toEqual({ kind: "not-shared" });
  });
});
