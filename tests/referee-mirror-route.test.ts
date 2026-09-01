/**
 * **`POST /api/referee/mirror/:slug` — the route that makes Mirror reachable.**
 *
 * Stage 5b of docs/plans/260831an-referee-mode-for-peer-reviewers.md. The
 * prompt, the call and the validator have been committed since `bd2f38e` and
 * nothing in the running app called them; this file is half of what says they
 * are wired up, and src/web/MirrorPanel.tsx's tests are the other half.
 *
 * No server and no network: `handleApi` is a plain function over a request and
 * a response, the same harness tests/routes.test.ts and
 * tests/referee-criteria-routes.test.ts use.
 *
 * ## Nothing here reaches a model, and that is a property rather than a hope
 *
 * Two of the four cases fail before a header is written — a bad method and a
 * slug with no article — so they cannot get near one. The other two **do** open
 * the stream and run `mirrorStream`, and they still cost nothing, because of
 * the guard that module puts above its own key check: *a referee with no
 * comment that has a body or a placement is an empty answer nobody pays for.*
 * That is the case this file is mostly about, since it is also the commonest
 * one a real referee will hit — and the one where "we did nothing" and "the
 * feature is broken" look identical from outside.
 *
 * If somebody deletes that guard, these two tests do not quietly start spending
 * money: `OPENROUTER_API_KEY` is absent under vitest, so the run throws
 * `NOT_CONFIGURED` and arrives as an `error` frame, and the `done` assertions
 * go red.
 *
 * Writes under `data/<throwaway slug>/`, which is gitignored, and removes it.
 */

import { cp, rm } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { handleApi } from "../src/routes.js";
import { createComment } from "../src/comments.js";
import type { MirrorInput, MirrorRemark } from "../src/referee-mirror-types.js";
import { acceptAny, AUTHED_HEADERS } from "./helpers/authed.js";

const SLUG = "test-referee-mirror-route";
const DIR = path.resolve(import.meta.dirname, "..", "data", SLUG);
/** The committed fixture, so the article has real block ids to anchor to. */
const EXAMPLE = path.resolve(import.meta.dirname, "..", "example");

const URL_FOR = (slug: string) => `/api/referee/mirror/${slug}`;

beforeEach(async () => {
  await rm(DIR, { recursive: true, force: true });
  await cp(EXAMPLE, DIR, { recursive: true });
});
afterEach(() => rm(DIR, { recursive: true, force: true }));

interface Reply {
  status: number;
  /** True once anything wrote a response header — i.e. a stream was opened. */
  streamed: boolean;
  /** Every frame, in order, as `sse` in src/routes.ts wrote it. */
  frames: { name: string; data: Record<string, unknown> }[];
  /** The JSON body, for the failures that never open a stream. */
  body: Record<string, unknown>;
}

/** Split the raw SSE text back into frames, ignoring `: ping` heartbeats. */
function parseFrames(text: string): { name: string; data: Record<string, unknown> }[] {
  const out: { name: string; data: Record<string, unknown> }[] = [];
  for (const chunk of text.split("\n\n")) {
    const name = /^event: (.+)$/m.exec(chunk)?.[1];
    const data = /^data: (.+)$/m.exec(chunk)?.[1];
    if (name && data) out.push({ name, data: JSON.parse(data) as Record<string, unknown> });
  }
  return out;
}

/**
 * Drive `handleApi` with a fake request/response pair that **can** be streamed
 * to — `tests/routes.test.ts`'s `callStreaming`, which is where every field
 * here is explained.
 */
async function call(method: string, url: string, body?: unknown): Promise<Reply> {
  const payload = body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
  const req = Object.assign(
    (async function* () {
      yield* payload;
    })(),
    { method, url, headers: AUTHED_HEADERS },
  ) as unknown as IncomingMessage;

  let status = 0;
  let streamed = false;
  let text = "";
  const res = {
    set statusCode(v: number) {
      status = v;
    },
    get statusCode() {
      return status;
    },
    writableEnded: false,
    destroyed: false,
    setHeader() {},
    on() {},
    flushHeaders() {},
    writeHead(code: number) {
      streamed = true;
      status = code;
    },
    write(chunk: string) {
      text += chunk;
    },
    end(chunk?: string) {
      if (chunk) text += chunk;
    },
  } as unknown as ServerResponse;

  await handleApi(req, res, acceptAny);
  return {
    status,
    streamed,
    frames: streamed ? parseFrames(text) : [],
    body: streamed ? {} : (JSON.parse(text || "{}") as Record<string, unknown>),
  };
}

/** The one terminal frame a run is allowed to end with. */
function terminal(reply: Reply): { name: string; data: Record<string, unknown> } {
  const ends = reply.frames.filter((f) => f.name === "done" || f.name === "error");
  expect(
    ends.length,
    `exactly one terminal frame, got ${reply.frames.map((f) => f.name).join(", ") || "none"}`,
  ).toBe(1);
  return ends[0] as { name: string; data: Record<string, unknown> };
}

describe("what the route refuses before it writes a header", () => {
  it("is a 404 for a slug with no article, with nothing streamed", async () => {
    const reply = await call("POST", URL_FOR("test-referee-mirror-no-such-article"));
    expect(reply.streamed).toBe(false);
    expect(reply.status).toBe(404);
  });

  it("has no GET — reading is not what this route does", async () => {
    /* A run is a model call the referee asks for, so it is a POST and there is
       nothing to fetch. A GET must be an ordinary 404 rather than a stream. */
    const reply = await call("GET", URL_FOR(SLUG));
    expect(reply.streamed).toBe(false);
    expect(reply.status).toBe(404);
  });
});

describe("a referee with nothing written", () => {
  it("answers with an empty run rather than a failure, and pays nothing", async () => {
    const reply = await call("POST", URL_FOR(SLUG));
    expect(reply.streamed).toBe(true);

    const end = terminal(reply);
    /* **`done`, not `error`.** Nothing is wrong: there is nothing to mirror.
       This is the assertion that would go red if the early return in
       `mirrorStream` were removed, because the run would then reach the key
       check and throw. */
    expect(end.name).toBe("done");
    expect(end.data.remarks).toEqual([]);
    expect(end.data.coverage).toEqual({ asked: false, reason: "nothing-to-mirror" });
  });

  it("counts the bookmarks it left behind rather than dropping them silently", async () => {
    /* A bookmark is a mark on a passage with nothing written under it. Mirror
       skips it — there is no claim of the referee's to remark on — and the
       count is what lets the panel say so instead of showing a blank. */
    await createComment(SLUG, {
      blockId: "spya-k3m9qt",
      quote: "the",
      start: 0,
    });

    const reply = await call("POST", URL_FOR(SLUG));
    const end = terminal(reply);
    expect(end.name).toBe("done");
    const input = end.data.input as MirrorInput;
    expect(input.skippedBookmarks).toBe(1);
    expect(input.comments).toEqual([]);
    expect(end.data.remarks as MirrorRemark[]).toEqual([]);
  });
});
