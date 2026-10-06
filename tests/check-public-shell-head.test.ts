/**
 * **scripts/check-public-shell.ts's HEAD request, against a server that answers
 * HEAD correctly and one that does not.**
 *
 * The check "HEAD matches GET" failed against production on 2026-10-06 while
 * the site was fine: curl was sent `--request HEAD`, which changes the word on
 * the request line and nothing else, so curl waited for the `Content-Length`
 * bytes a HEAD response never sends and timed out. The fix has two ways to be
 * wrong, and there is a route here for each: `/honest` (no body — the request
 * must come back clean and quickly), and `/lying` and `/chunked` (bytes after a
 * HEAD — they must reach the judge, or "HEAD returned a body" can never fire).
 * docs/plans/261006f-check-public-shell-head-request-waits-for-a-body.md.
 *
 * The server is a **child process**: `curlRequest` is `spawnSync`, which blocks
 * this process's event loop, so a server in here could never answer. It is raw
 * `node:net` because Node's `http` server strips the body from a HEAD response
 * for you. It closes the connection only when asked to, as a keep-alive server
 * does.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { curlRequest, judgeHeadMatchesGet } from "../scripts/check-public-shell.js";

const BODY = "<html>the shell</html>";
/** An empty chunked body: five bytes on the wire that decode to nothing. */
const CHUNK_END = "0\r\n\r\n";

const SERVER = `
const net = require("node:net");
const BODY = ${JSON.stringify(BODY)};
const server = net.createServer((socket) => {
  let seen = "";
  socket.on("error", () => {});
  socket.on("data", (chunk) => {
    seen += chunk.toString("latin1");
    for (;;) {
      const end = seen.indexOf("\\r\\n\\r\\n");
      if (end < 0) return;
      const request = seen.slice(0, end);
      seen = seen.slice(end + 4);
      const [method, target] = request.split("\\r\\n")[0].split(" ");
      const close = /^connection:\\s*close\\s*$/im.test(request);
      const isHead = method === "HEAD";
      const head =
        "HTTP/1.1 200 OK\\r\\nContent-Type: text/html\\r\\nx-spideryarn-shell-sha256: abc\\r\\n" +
        "Content-Length: " + Buffer.byteLength(BODY) + "\\r\\n" +
        (isHead && target === "/chunked" ? "Transfer-Encoding: chunked\\r\\n" : "") +
        (close ? "Connection: close\\r\\n" : "") + "\\r\\n";
      const after = !isHead ? BODY : target === "/lying" ? BODY : target === "/chunked" ? "0\\r\\n\\r\\n" : "";
      socket.write(head + after);
      if (close) { socket.end(); return; }
    }
  });
});
server.listen(0, "127.0.0.1", () => console.log(server.address().port));
`;

let child: ChildProcess;
let origin = "";

beforeAll(async () => {
  child = spawn(process.execPath, ["-e", SERVER], { stdio: ["ignore", "pipe", "inherit"] });
  const port = await new Promise<string>((resolve, reject) => {
    child.stdout!.once("data", (d: Buffer) => resolve(d.toString().trim()));
    child.once("exit", (code) => reject(new Error(`the fake server exited ${code} before listening`)));
  });
  origin = `http://127.0.0.1:${port}`;
});

afterAll(() => {
  child?.kill();
});

/** Short, so the red run of the honest case is five seconds and not thirty. */
const MAX_TIME = 5;

describe("check-public-shell's HEAD request", () => {
  it("the fake server is what it claims: GET has the body on both routes", () => {
    for (const route of ["/honest", "/lying", "/chunked"]) {
      const getR = curlRequest(`${origin}${route}`, "GET", MAX_TIME);
      expect(getR.curlError).toBeNull();
      expect(getR.bodyText).toBe(BODY);
    }
  });

  it("a correct HEAD (Content-Length, no body) comes back clean and passes", () => {
    const getR = curlRequest(`${origin}/honest`, "GET", MAX_TIME);
    const headR = curlRequest(`${origin}/honest`, "HEAD", MAX_TIME);
    expect(headR.curlError).toBeNull();
    expect(headR.head.status).toBe(200);
    expect(headR.bodyBuffer.length).toBe(0);
    expect(judgeHeadMatchesGet(getR, headR)).toEqual([]);
  }, 20_000);

  it("a HEAD that wrongly carries a body is still caught", () => {
    const getR = curlRequest(`${origin}/lying`, "GET", MAX_TIME);
    const headR = curlRequest(`${origin}/lying`, "HEAD", MAX_TIME);
    expect(headR.curlError).toBeNull();
    expect(headR.bodyText).toBe(BODY);
    expect(judgeHeadMatchesGet(getR, headR)).toEqual([`HEAD returned a body of ${Buffer.byteLength(BODY)} bytes, expected none`]);
  }, 20_000);

  /* GPT Sol's plan review, F1: curl decodes a transfer encoding before it writes
     the body file, so these five bytes would arrive as none and the HEAD would
     pass. `--raw` is what keeps them. */
  it("bytes that decode to nothing are still bytes: an empty chunked body after a HEAD is caught", () => {
    const getR = curlRequest(`${origin}/chunked`, "GET", MAX_TIME);
    const headR = curlRequest(`${origin}/chunked`, "HEAD", MAX_TIME);
    expect(headR.curlError).toBeNull();
    expect(headR.bodyText).toBe(CHUNK_END);
    expect(judgeHeadMatchesGet(getR, headR)).toEqual([`HEAD returned a body of ${CHUNK_END.length} bytes, expected none`]);
  }, 20_000);
});
