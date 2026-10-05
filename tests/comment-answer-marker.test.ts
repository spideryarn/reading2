/** The real answer route releases its live key even when opening SSE fails. */
import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { expect, it, vi } from "vitest";
import { acceptAny, AUTHED_HEADERS } from "./helpers/authed.js";

const leaves = vi.hoisted(() => ({ sweep: vi.fn(), model: vi.fn() }));
vi.mock("../src/monitoring.js", async (original) => ({
  ...(await original<typeof import("../src/monitoring.js")>()),
  captureFailure: vi.fn(),
}));
vi.mock("../src/arrivals.js", async (original) => ({
  ...(await original<typeof import("../src/arrivals.js")>()),
  noteArrival: async () => {},
}));
vi.mock("../src/store/index.js", async (original) => ({
  ...(await original<typeof import("../src/store/index.js")>()),
  loadArticle: async () => ({ meta: {}, blocks: [] }),
  commentStore: {
    beginAnswer: async (_slug: string, id: string) => ({
      comment: { id, blockId: "spya-bck002", quote: "a question", status: "pending" },
      attempt: "attempt-1",
    }),
    sweepPending: leaves.sweep,
  },
}));
vi.mock("../src/explain.js", async (original) => ({
  ...(await original<typeof import("../src/explain.js")>()),
  explainStream: leaves.model,
}));
const { handleApi } = await import("../src/routes.js");

function request(method: string, url: string, body?: unknown): IncomingMessage {
  return Object.assign(
    (async function* () {
      if (body !== undefined) yield Buffer.from(JSON.stringify(body));
    })(),
    { method, url, headers: AUTHED_HEADERS },
  ) as unknown as IncomingMessage;
}

it.each(["headers", "begin"] as const)("releases a comment's key when its %s write throws", async (failure) => {
  const slug = `comment-marker-${failure}`;
  const id = failure === "headers" ? "spya-hdr002" : "spya-beg002";
  let broke = false;
  let written = "";
  const events = new EventEmitter();
  const response = Object.assign(events, {
    writableEnded: false,
    destroyed: false,
    statusCode: 200,
    setHeader() {},
    writeHead(_status: number, headers?: Record<string, string>) {
      if (failure === "headers" && headers?.["Content-Type"]?.startsWith("text/event-stream")) {
        broke = true;
        throw new Error("cannot open SSE");
      }
    },
    flushHeaders() {},
    write(chunk: string) {
      written += chunk;
      if (failure === "begin" && chunk.startsWith("event: begin")) {
        broke = true;
        throw new Error("cannot write begin");
      }
    },
    end(chunk?: string) {
      if (chunk) written += chunk;
      this.writableEnded = true;
      events.emit("close");
    },
  });
  await handleApi(
    request("POST", `/api/comments/${slug}/${id}/answer`, { useProfile: false }),
    response as unknown as ServerResponse,
    acceptAny,
  );
  expect(broke, `the request never reached the intended failure: ${written}`).toBe(true);
  expect(leaves.model).not.toHaveBeenCalled();

  leaves.sweep.mockResolvedValue([]);
  const sweepResponse = { setHeader() {}, writeHead() {}, end() {} } as unknown as ServerResponse;
  await handleApi(
    request("GET", `/api/comments/${slug}`),
    sweepResponse,
    acceptAny,
  );
  const [sweptSlug, keep] = leaves.sweep.mock.lastCall!;
  expect(sweptSlug).toBe(slug);
  expect([...keep], "a dead answer still protects its comment from every sweep").toEqual([]);
});
