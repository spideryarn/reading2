/** Real answer route, with store/model leaves replaced; no database or model calls.
 * The store's UPDATE and subsequent list read are separate statements. A new
 * attempt can begin between them, so a successful write may return a pending row.
 */
import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { beforeEach, expect, it, vi } from "vitest";
import type { Comment } from "../src/types.js";
import { acceptAny, AUTHED_HEADERS } from "./helpers/authed.js";

const leaves = vi.hoisted(() => ({ begin: vi.fn(), patch: vi.fn(), load: vi.fn(), fail: false }));
vi.mock("../src/monitoring.js", async (original) => ({
  ...await original<typeof import("../src/monitoring.js")>(), captureFailure: vi.fn(),
}));
vi.mock("../src/minimal-paper.js", async (original) => ({
  ...await original<typeof import("../src/minimal-paper.js")>(), processingOf: async () => undefined,
}));
vi.mock("../src/arrivals.js", async (original) => ({
  ...await original<typeof import("../src/arrivals.js")>(), noteArrival: async () => {},
}));
vi.mock("../src/store/index.js", async (original) => ({
  ...await original<typeof import("../src/store/index.js")>(),
  commentStore: { beginAnswer: leaves.begin, patch: leaves.patch, load: leaves.load },
  loadArticle: async () => ({ meta: {}, blocks: [] }),
}));
vi.mock("../src/explain.js", async (original) => ({
  ...await original<typeof import("../src/explain.js")>(),
  async *explainStream() {
    yield { type: "delta", text: "this attempt's answer" };
    if (leaves.fail) throw new Error("model failed");
    yield { type: "done", answer: "this attempt's answer", citations: [], searches: 0, model: "test/model" };
  },
}));
const { handleApi } = await import("../src/routes.js");

const opening: Comment = {
  id: "spya-p7w2dn", blockId: "spya-k3m9qt", quote: "the words", start: 0,
  createdAt: "2026-10-07T00:00:00.000Z", status: "pending", body: "old note",
};

beforeEach(() => {
  vi.clearAllMocks();
  leaves.fail = false;
  leaves.begin.mockResolvedValue({ comment: opening, attempt: "attempt-a" });
});

async function terminal(): Promise<Comment> {
  const req = Object.assign((async function* () {
    yield Buffer.from(JSON.stringify({ useProfile: false }));
  })(), {
    method: "POST", url: `/api/comments/a-paper/${opening.id}/answer`, headers: AUTHED_HEADERS,
  }) as unknown as IncomingMessage;
  let written = "";
  const response = Object.assign(new EventEmitter(), {
    writableEnded: false, destroyed: false, statusCode: 200,
    setHeader() {}, writeHead() {}, flushHeaders() {},
    write(chunk: string) { written += chunk; return true; },
    end(chunk?: string) { written += chunk ?? ""; this.writableEnded = true; },
  });
  await handleApi(req, response as unknown as ServerResponse, acceptAny);
  const frame = written.split("\n\n").find((block) => block.startsWith("event: done"));
  if (!frame) throw new Error(`no terminal frame: ${written}`);
  return JSON.parse(frame.slice(frame.indexOf("data: ") + 6)) as Comment;
}

it("frames the matching row, even when another comment precedes it", async () => {
  const target = { ...opening, body: "new note", status: "done" as const, answer: "this attempt's answer" };
  leaves.patch.mockResolvedValue([{ ...target, id: "spya-t7r4wz", body: "another note" }, target]);
  expect(await terminal()).toEqual(target);
});

it.each([false, true])("a newer claim after a successful write cannot end this stream pending (failure=%s)", async (fail) => {
  leaves.fail = fail;
  // A's UPDATE succeeded; B claimed and cleared the answer before listFor read.
  leaves.patch.mockResolvedValue([{ ...opening, body: "new note", colour: "blue" }]);
  const framed = await terminal();
  expect(framed.status, "a terminal frame left a spinner with nobody watching the replacement").toBe(fail ? "error" : "done");
  expect(framed).toMatchObject({ id: opening.id, body: "new note", colour: "blue", answer: "this attempt's answer" });
});

it("keeps a newer terminal answer from the read, rather than replacing it with this attempt", async () => {
  const newer = { ...opening, body: "new note", status: "done" as const, answer: "B already finished" };
  leaves.patch.mockResolvedValue([newer]);
  expect(await terminal()).toEqual(newer);
});

it("still ends the stream when the successfully written row was then deleted", async () => {
  leaves.patch.mockResolvedValue([]);
  expect(await terminal()).toMatchObject({ id: opening.id, status: "done", answer: "this attempt's answer" });
});
