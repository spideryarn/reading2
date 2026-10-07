/**
 * **A handler that throws after its response has started gets no second
 * answer** — `serveApi`'s catch in src/routes.ts, SVO3 in
 * docs/investigations/261006d-seventh-sweep-depth-server-request-path-opus.md.
 *
 * The catch used to call `send` whatever state the response was in. On a stream
 * whose headers were out, `send` set `statusCode = 500` and then `setHeader`
 * threw `ERR_HTTP_HEADERS_SENT`: the throw escaped `handleApi`, the request
 * line said 500 for a response the reader received as 200, and `src/vercel.ts`'s
 * outer catch filed a second Sentry event about headers, not about the fault.
 *
 * **A real `ServerResponse` on an in-memory socket, on purpose.** Every other
 * route test here hands `handleApi` an object with a no-op `setHeader`, and a
 * no-op cannot throw `ERR_HTTP_HEADERS_SENT` — so none of them could have seen
 * this. The handler is the public dispatcher, replaced: it is the first thing
 * `serveApi` calls inside its `try`, before the gate, so nothing here needs a
 * session or a database, and the catch under test is the real one.
 *
 * **Watched red on 2026-10-07**, before the `res.headersSent` guard: the first
 * two cases rejected with `ERR_HTTP_HEADERS_SENT` and `statusCode` read 500.
 * The last case is the control — a throw before any header is still the JSON
 * 500 it always was — and it is what a guard that returned early always would
 * turn red.
 */
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { Writable } from "node:stream";
import { beforeEach, expect, it, vi } from "vitest";

const stage = vi.hoisted(() => ({
  serve: (async () => {}) as (res: import("node:http").ServerResponse) => Promise<void>,
  lines: [] as { level: string; fields: Record<string, unknown>; msg: string }[],
}));

vi.mock("../src/monitoring.js", async (original) => ({
  ...(await original<typeof import("../src/monitoring.js")>()),
  captureFailure: vi.fn(),
}));
vi.mock("../src/public/routes.js", async (original) => ({
  ...(await original<typeof import("../src/public/routes.js")>()),
  isPublicNamespace: (path: string) => path.startsWith("/api/public/"),
  servePublicApi: ({ res }: { res: import("node:http").ServerResponse }) => stage.serve(res),
}));
vi.mock("../src/log.js", async (original) => {
  const actual = await original<typeof import("../src/log.js")>();
  return {
    ...actual,
    log: (component: Parameters<typeof actual.log>[0]) => {
      const real = actual.log(component);
      if (component !== "http") return real;
      const note = (level: string) => (fields: object | string, msg?: string) => {
        if (typeof fields === "string") return;
        stage.lines.push({ level, fields: fields as Record<string, unknown>, msg: msg ?? "" });
      };
      return { ...real, info: note("info"), warn: note("warn"), error: note("error") };
    },
  };
});

const { captureFailure } = await import("../src/monitoring.js");
const { handleApi } = await import("../src/routes.js");

/** A response whose bytes land in a string, as they would on a wire. */
function exchange(): { req: IncomingMessage; res: ServerResponse; wire: () => string } {
  let bytes = "";
  const sink = new Writable({
    write(chunk: Buffer, _encoding, done) {
      bytes += chunk.toString("utf8");
      done();
    },
  });
  const req = new IncomingMessage(new Socket());
  req.method = "GET";
  req.url = "/api/public/anything";
  const res = new ServerResponse(req);
  res.assignSocket(sink as unknown as Socket);
  return { req, res, wire: () => bytes };
}

function startStream(res: ServerResponse): void {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream");
  res.flushHeaders();
  res.write("event: delta\ndata: {}\n\n");
}

const fault = new TypeError("the lease release failed");

beforeEach(() => {
  vi.clearAllMocks();
  stage.lines.length = 0;
});

it("a stream that finished and then threw is left as the 200 it was", async () => {
  stage.serve = async (res) => {
    startStream(res);
    res.end("event: done\ndata: {}\n\n");
    throw fault;
  };
  const { req, res, wire } = exchange();
  /* The promise resolving is the first assertion: before the guard this
     rejected with ERR_HTTP_HEADERS_SENT. */
  await expect(handleApi(req, res)).resolves.toBe(true);
  expect(wire().startsWith("HTTP/1.1 200 OK")).toBe(true);
  expect(wire()).not.toContain('"error"');
  expect(res.statusCode).toBe(200);
  /* One capture, of the original fault — not of a header error. */
  expect(vi.mocked(captureFailure).mock.calls.map((c) => c[0])).toEqual([fault]);
  /* One request line, saying what the reader received, and carrying the fault. */
  expect(stage.lines.map((l) => l.fields.status)).toEqual([200]);
  expect(stage.lines[0]?.fields.err).toBe(fault);
});

it("a stream still open when its handler threw is ended, and nothing is written into it", async () => {
  stage.serve = async (res) => {
    startStream(res);
    throw fault;
  };
  const { req, res, wire } = exchange();
  await expect(handleApi(req, res)).resolves.toBe(true);
  expect(res.writableEnded).toBe(true);
  expect(res.statusCode).toBe(200);
  expect(wire().startsWith("HTTP/1.1 200 OK")).toBe(true);
  expect(wire()).not.toContain('"error"');
  expect(vi.mocked(captureFailure).mock.calls.map((c) => c[0])).toEqual([fault]);
  expect(stage.lines.map((l) => l.fields.status)).toEqual([200]);
});

it("a response the reader already dropped is not ended a second time", async () => {
  let ended = 0;
  stage.serve = async (res) => {
    startStream(res);
    res.destroy();
    const end = res.end.bind(res);
    res.end = ((...args: Parameters<typeof end>) => {
      ended += 1;
      return end(...args);
    }) as typeof res.end;
    throw fault;
  };
  const { req, res } = exchange();
  await expect(handleApi(req, res)).resolves.toBe(true);
  expect(ended).toBe(0);
  expect(vi.mocked(captureFailure).mock.calls.map((c) => c[0])).toEqual([fault]);
});

it("a refusal thrown after the headers is not reported, and still writes nothing", async () => {
  stage.serve = async (res) => {
    startStream(res);
    throw Object.assign(new Error("No such thing."), { status: 404 });
  };
  const { req, res, wire } = exchange();
  await expect(handleApi(req, res)).resolves.toBe(true);
  expect(res.statusCode).toBe(200);
  expect(wire()).not.toContain("No such thing.");
  expect(captureFailure).not.toHaveBeenCalled();
});

it("control: a throw before any header is still the JSON 500, reported once", async () => {
  stage.serve = async () => {
    throw fault;
  };
  const { req, res, wire } = exchange();
  await expect(handleApi(req, res)).resolves.toBe(true);
  expect(res.statusCode).toBe(500);
  expect(wire().startsWith("HTTP/1.1 500")).toBe(true);
  expect(wire()).toContain('"error"');
  expect(vi.mocked(captureFailure).mock.calls.map((c) => c[0])).toEqual([fault]);
  expect(stage.lines.map((l) => [l.level, l.fields.status])).toEqual([["error", 500]]);
});
