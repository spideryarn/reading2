/**
 * The HTTP surface — src/routes.ts. See docs/project/comments.md.
 *
 * No server and no network: `handleApi` is a plain function over a request and
 * a response, which is the point of it not being Vite-specific. Nothing here
 * reaches the model — the requests under test are rejected before they get
 * anywhere near one.
 *
 * Writes under `data/<throwaway slug>/`, which is gitignored, and removes it.
 */
import { rm } from "node:fs/promises";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { handleApi } from "../src/routes.js";
import { createComment, loadComments } from "../src/comments.js";

const SLUG = "test-routes-fixture";
const DIR = path.resolve(import.meta.dirname, "..", "data", SLUG);
afterEach(() => rm(DIR, { recursive: true, force: true }));

interface Reply {
  handled: boolean;
  status: number;
  body: { error?: string; comments?: { id: string; status: string; error?: string }[] };
}

/** Drive `handleApi` with a fake request/response pair. */
async function call(method: string, url: string, body?: unknown): Promise<Reply> {
  const payload = body === undefined ? [] : [Buffer.from(typeof body === "string" ? body : JSON.stringify(body))];
  const req = Object.assign(
    (async function* () {
      yield* payload;
    })(),
    { method, url },
  ) as unknown as IncomingMessage;

  let status = 0;
  let text = "";
  const res = {
    set statusCode(v: number) {
      status = v;
    },
    get statusCode() {
      return status;
    },
    setHeader() {},
    end(chunk: string) {
      text = chunk;
    },
  } as unknown as ServerResponse;

  const handled = await handleApi(req, res);
  return { handled, status, body: text ? JSON.parse(text) : {} };
}

describe("what a failure is reported as", () => {
  // Every one of these used to come back 404, which sent the reader looking for
  // a missing article instead of the thing that was actually wrong.
  it("calls a malformed body 400, not 404", async () => {
    const r = await call("POST", `/api/comments/${SLUG}`, "{");
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/valid JSON/);
  });

  it("calls an oversized body 413", async () => {
    const r = await call("POST", `/api/comments/${SLUG}`, { blockId: "x".repeat(70_000) });
    expect(r.status).toBe(413);
  });

  it("calls a missing field 400", async () => {
    const r = await call("POST", `/api/comments/${SLUG}`, { blockId: "spya-k3m9qt" });
    expect(r.status).toBe(400);
  });

  it("serves any slug, because an unknown one falls back to the example fixture", async () => {
    // Not a missing-article test: `loadArticle` tries `data/<slug>/` and then
    // `example/`, so in a dev checkout every slug resolves (src/api.ts). The
    // 404 path is exercised by the tagged error there, not reachable from here.
    const r = await call("GET", "/api/article/no-such-article-anywhere");
    expect(r.status).toBe(200);
  });

  it("is not ours if the path is not /api/", async () => {
    expect((await call("GET", "/index.html")).handled).toBe(false);
  });
});

describe("the anchor offset must be a real offset", () => {
  // A negative start silently drew the mark a few characters left of the words
  // it belonged to. Refusing it at the door is cheaper than defending every
  // reader of the value. See src/web/annotate.ts § resolveMark.
  // Not NaN: `JSON.stringify` turns it into `null`, so it never arrives as a
  // number at all and is caught by the missing-field check above.
  for (const start of [-1, 1.5]) {
    it(`rejects start = ${start}`, async () => {
      const r = await call("POST", `/api/comments/${SLUG}`, {
        blockId: "spya-k3m9qt",
        quote: "the hard problem",
        start,
      });
      expect(r.status).toBe(400);
      expect(r.body.error).toMatch(/non-negative integer/);
      // Nothing was written: a refused request must not leave a comment behind.
      expect(await loadComments(SLUG)).toEqual([]);
    });
  }
});

describe("a pending comment nobody is answering", () => {
  it("comes back as an error the reader can retry, not an eternal spinner", async () => {
    // What a crash mid-answer leaves on disk. Since `pending` is written before
    // the model call, this is indistinguishable from a live request *on disk* —
    // only the running process knows, and this one is not answering it.
    const orphan = await createComment(SLUG, {
      blockId: "spya-k3m9qt",
      quote: "the hard problem",
      start: 12,
    });
    expect(orphan.status).toBe("pending");

    const r = await call("GET", `/api/comments/${SLUG}`);
    expect(r.status).toBe(200);
    expect(r.body.comments?.[0]?.status).toBe("error");
    expect(r.body.comments?.[0]?.error).toMatch(/server stopped/);

    // And it is written down, so a second reader sees the same thing.
    expect((await loadComments(SLUG))[0]?.status).toBe("error");
  });

  it("leaves an already-answered comment alone", async () => {
    await createComment(SLUG, { blockId: "spya-k3m9qt", quote: "q", start: 0, id: "spya-k3m9qt" });
    await call("GET", `/api/comments/${SLUG}`);
    const first = await call("GET", `/api/comments/${SLUG}`);
    // Swept once, then stable — the sweep must not keep rewriting the file.
    expect(first.body.comments?.[0]?.status).toBe("error");
    expect(first.body.comments).toHaveLength(1);
  });
});
