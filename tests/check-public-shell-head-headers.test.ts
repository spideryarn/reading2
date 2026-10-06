/** HEAD ignores curl's length framing; the judge must validate the dumped fields itself. */
import { describe, expect, it } from "vitest";
import { judgeHeadMatchesGet, parseHeaderDump } from "../scripts/check-public-shell.js";

const BODY = Buffer.from("<html>the shell</html>");
const response = (lengths: string[], bodyBuffer = Buffer.alloc(0)) => ({
  head: parseHeaderDump(
    "HTTP/1.1 200 OK\r\nx-spideryarn-shell-sha256: abc\r\n" +
      lengths.map((length) => `Content-Length: ${length}\r\n`).join("") + "\r\n",
  ),
  bodyBuffer,
});
const getR = response([String(BODY.length)], BODY);

describe("check-public-shell's HEAD length validation", () => {
  it.each(["22.0", "2.2e1", "+22", "0x16"])("rejects a nondecimal length even when Number(%s) equals GET's length", (length) => {
    expect(judgeHeadMatchesGet(getR, response([length]))).toEqual([
      `content-length: invalid decimal byte count '${length}'`,
    ]);
  });

  it("rejects a conflicting second Content-Length even when the first matches GET", () => {
    expect(judgeHeadMatchesGet(getR, response(["22", "23"]))).toEqual([
      "content-length: HEAD said 23, GET's body is actually 22 bytes",
    ]);
  });

  it("accepts a decimal length with leading zeros", () => {
    expect(judgeHeadMatchesGet(getR, response(["022"]))).toEqual([]);
  });

  it("accepts repeated identical valid lengths", () => {
    expect(judgeHeadMatchesGet(getR, response(["22", "22"]))).toEqual([]);
  });
});
