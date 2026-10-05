/** The real search handler, with store/model leaves replaced: no database or paid calls. */
import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { beforeEach, expect, it, vi } from "vitest";
import type { SearchKind, SearchRun } from "../src/types.js";
import { acceptAny, AUTHED_HEADERS } from "./helpers/authed.js";

const leaves = vi.hoisted(() => ({
  capture: vi.fn(),
  begin: vi.fn(),
  finish: vi.fn(),
  model: vi.fn(),
}));
vi.mock("../src/monitoring.js", async (original) => ({
  ...await original<typeof import("../src/monitoring.js")>(), captureFailure: leaves.capture,
}));
vi.mock("../src/minimal-paper.js", async (original) => ({
  ...await original<typeof import("../src/minimal-paper.js")>(), processingOf: async () => undefined,
}));
vi.mock("../src/arrivals.js", async (original) => ({
  ...await original<typeof import("../src/arrivals.js")>(), noteArrival: async () => {},
}));
vi.mock("../src/store/index.js", async (original) => ({
  ...await original<typeof import("../src/store/index.js")>(),
  searchStore: { begin: leaves.begin, finish: leaves.finish },
  loadArticle: async () => ({ meta: {}, blocks: [] }),
}));
vi.mock("../src/search.js", async (original) => ({
  ...await original<typeof import("../src/search.js")>(), findPassagesStream: leaves.model,
}));
vi.mock("../src/quick-search.js", async (original) => ({
  ...await original<typeof import("../src/quick-search.js")>(), quickPassagesStream: leaves.model,
}));
const { handleApi } = await import("../src/routes.js");

beforeEach(() => {
  vi.clearAllMocks();
  leaves.begin.mockImplementation(async (_slug, _sourceHash: string, criterion: string, kind: SearchKind) => ({
    run: { id: "spya-run002", criterion, kind, createdAt: "2026-10-02T00:00:00.000Z", status: "pending", hits: [] },
    attempt: "attempt-1",
  }));
  leaves.finish.mockResolvedValue(undefined);
});

it.each(["quick", "meaning"] as const)("closed %s connections preserve their failure-reporting policy", async (kind) => {
  let started!: () => void;
  const ready = new Promise<void>((resolve) => { started = resolve; });
  let reject!: (err: Error) => void;
  const held = new Promise<never>((_resolve, fail) => { reject = fail; });
  let modelSignal: AbortSignal | undefined;
  leaves.model.mockImplementation(async function* (request: { signal?: AbortSignal }) {
    modelSignal = request.signal;
    started();
    yield await held;
  });
  const req = Object.assign((async function* () {
    yield Buffer.from(JSON.stringify({ criterion: "why", kind }));
  })(), { method: "POST", url: "/api/search/a-paper", headers: AUTHED_HEADERS }) as unknown as IncomingMessage;
  const response = Object.assign(new EventEmitter(), {
    writableEnded: false, destroyed: false, statusCode: 200,
    setHeader() {}, writeHead() {}, flushHeaders() {}, write() {},
    end() { this.writableEnded = true; },
  });
  const pending = handleApi(req, response as unknown as ServerResponse, acceptAny);
  await ready;
  response.destroyed = true;
  response.emit("close");
  expect(modelSignal?.aborted).toBe(kind === "quick" ? true : undefined);
  const error = new Error("model failed after disconnect");
  reject(error);
  await pending;
  expect(leaves.finish).toHaveBeenCalledWith("a-paper", "spya-run002", expect.objectContaining({ status: "error" } satisfies Partial<SearchRun>), "attempt-1");
  if (kind === "quick") expect(leaves.capture).not.toHaveBeenCalled();
  else expect(leaves.capture).toHaveBeenCalledWith(error, expect.objectContaining({ route: "search" }));
});
