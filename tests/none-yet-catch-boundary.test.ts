/** The real dispatcher and error scrubber, with injected store outcomes.
 * No database or socket: the Postgres contract remains in
 * none-yet-is-not-a-404-route.test.ts. These cases pin the catch's boundary. */
import type { IncomingMessage, ServerResponse } from "node:http";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ArtefactNotMadeYet } from "../src/store/artefact-not-made-yet.js";
import { CitationsListNotFound } from "../src/store/citations-list-not-found.js";
import { NONE_YET_AS_NULL_HEADER } from "../src/types.js";
import { acceptAny, AUTHED_HEADERS } from "./helpers/authed.js";

const stores = vi.hoisted(() => ({
  loadQuiz: vi.fn(), loadCrossrefs: vi.fn(), loadCitations: vi.fn(),
  attempts: vi.fn(), candidates: vi.fn(), profile: vi.fn(),
}));

vi.mock("../src/store/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/store/index.js")>();
  const { guardDbStore } = await import("../src/store/db-errors.js");
  const loads = guardDbStore("none-yet-test", {
    loadQuiz: stores.loadQuiz, loadCrossrefs: stores.loadCrossrefs, loadCitations: stores.loadCitations,
  });
  return {
    ...actual, ...loads,
    readerStore: { ...actual.readerStore, readProfile: stores.profile },
    shelfStore: { ...actual.shelfStore, read: async () => ({ opens: 0 }) },
    quizAttemptStore: { ...actual.quizAttemptStore, latestForBatch: stores.attempts },
    citedCandidates: stores.candidates,
  };
});

const { handleApi } = await import("../src/routes.js");
const SLUG = "catch-boundary";
const RESPONSES = {
  quiz: { quiz: { slug: SLUG, batchId: "batch", questions: [] }, stale: false, outdated: false },
  crossrefs: { crossrefs: { slug: SLUG, links: [] }, stale: false, outdated: false },
  citations: { citations: { slug: SLUG, citations: [] }, stale: false, outdated: false },
};
const READS = [
  ["quiz", stores.loadQuiz], ["crossrefs", stores.loadCrossrefs], ["citations", stores.loadCitations],
] as const;

beforeEach(() => {
  vi.resetAllMocks();
  stores.profile.mockResolvedValue(null);
  stores.attempts.mockResolvedValue([]);
  stores.candidates.mockResolvedValue([]);
  for (const [kind, load] of READS) load.mockResolvedValue(RESPONSES[kind]);
});

async function get(kind: string, asks = true, authed = true) {
  const req = Object.assign((async function* () {})(), {
    method: "GET", url: `/api/${kind}/${SLUG}`,
    headers: { ...(authed ? AUTHED_HEADERS : {}), ...(asks ? { [NONE_YET_AS_NULL_HEADER]: "1" } : {}) },
  }) as unknown as IncomingMessage;
  let body = "";
  const headers = new Map<string, string>();
  const res = {
    statusCode: 0, writableEnded: false, destroyed: false,
    setHeader(name: string, value: string) { headers.set(name.toLowerCase(), String(value)); },
    on() {},
    write(chunk: string) { body += chunk; return true; },
    end(chunk = "") { body += chunk; this.writableEnded = true; },
  };
  await handleApi(req, res as unknown as ServerResponse, acceptAny);
  return { status: res.statusCode, body, headers };
}

describe.each(READS)("%s catch boundary", (kind, load) => {
  it("requires authentication before loading, even with the header", async () => {
    expect((await get(kind, true, false)).status).toBe(401);
    expect(load).not.toHaveBeenCalled();
  });

  it("preserves the typed absence through guardDbStore and sends JSON null", async () => {
    load.mockRejectedValue(kind === "citations" ? new CitationsListNotFound() : new ArtefactNotMadeYet("none yet"));
    const res = await get(kind);
    expect(res.status).toBe(200);
    expect(res.body).toBe("null");
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(stores.attempts).not.toHaveBeenCalled();
    expect(stores.candidates).not.toHaveBeenCalled();
  });

  for (const asks of [false, true]) {
    it(`leaves a generic 404 alone (header=${asks})`, async () => {
      load.mockRejectedValue(Object.assign(new Error("missing article"), { status: 404 }));
      const res = await get(kind, asks);
      expect(res.status).toBe(404);
      expect(JSON.parse(res.body)).toEqual({ error: "missing article" });
      expect(res.headers.get("cache-control")).toBe("private, no-store");
    });

    it(`does not convert a store fault to absence (header=${asks})`, async () => {
      load.mockRejectedValue(new Error("broken storage"));
      const res = await get(kind, asks);
      expect(res.status).toBeGreaterThanOrEqual(500);
      expect(JSON.parse(res.body)).toHaveProperty("error");
      expect(res.headers.get("cache-control")).toBe("private, no-store");
    });

    it(`returns a made artefact (header=${asks})`, async () => {
      const res = await get(kind, asks);
      expect(res.status).toBe(200);
      expect(JSON.parse(res.body)).toMatchObject(RESPONSES[kind]);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
    });
  }
});

it("a quiz kept-answer failure, even a typed absence, leaves the questions with attempts: null", async () => {
  stores.attempts.mockRejectedValue(new ArtefactNotMadeYet("not a quiz absence"));
  const res = await get("quiz");
  expect(res.status).toBe(200);
  expect(JSON.parse(res.body)).toMatchObject({ ...RESPONSES.quiz, attempts: null });
});

it("a citations matching failure, even a typed absence, leaves the list", async () => {
  stores.candidates.mockRejectedValue(new ArtefactNotMadeYet("not a citations absence"));
  const res = await get("citations");
  expect(res.status).toBe(200);
  expect(JSON.parse(res.body)).toMatchObject(RESPONSES.citations);
});

it("a profile failure after a successful quiz load remains a failure", async () => {
  stores.profile.mockRejectedValue(new Error("profile failed"));
  const res = await get("quiz");
  expect(res.status).toBe(500);
  expect(JSON.parse(res.body)).toHaveProperty("error");
});
