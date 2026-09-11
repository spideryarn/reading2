/**
 * **`GET /api/admin/feedback/:owner/:id/screenshot`, end to end through the
 * route** — the one binary route that had no test of its success at all.
 *
 * tests/routes.test.ts pins the gate (a non-administrator is a 403) and the
 * id shapes (a 400 before the store). Nothing asserted what the administrator
 * actually *gets*: the status, the headers, the bytes. It was written for
 * cluster H of docs/plans/260908f-prioritised-spideryarn-codebase-improvements.md,
 * pinned before the six binary writers were folded into one
 * (docs/plans/260911e-one-binary-response-writer.md), and it asserts the
 * response as three separate claims — headers as an exact set, the length off
 * multibyte bytes, and HEAD — plus the missing and refused cases around them.
 *
 * **The store is faked, not the route**, source-route's shape: the one call
 * being varied is `adminStore.readFeedbackScreenshotAcrossOwners`, recorded so
 * "the gate refused before the store was asked" is answerable. Everything else
 * in `src/store/index.js` is passed through. What the store reads, across
 * owners, is tests/admin-feedback-store.test.ts.
 *
 * No database.
 */

import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ADMIN_USER_ID_LOCAL } from "../src/admin.js";
import type { Verifier } from "../src/auth.js";
import { acceptAny, AUTHED_HEADERS } from "./helpers/authed.js";
import { charCountDiffers, withMultibyteTail } from "./helpers/binary-response.js";

const seen = vi.hoisted(() => ({
  calls: [] as string[],
  /** What the store hands back this time. Set by each test. */
  screenshot: null as Uint8Array | null,
}));

vi.mock("../src/store/index.js", async () => {
  const actual = await vi.importActual<typeof import("../src/store/index.js")>(
    "../src/store/index.js",
  );
  return {
    ...actual,
    adminStore: {
      ...actual.adminStore,
      readFeedbackScreenshotAcrossOwners: async (owner: string, id: string) => {
        seen.calls.push(`readFeedbackScreenshotAcrossOwners(${owner}, ${id})`);
        return seen.screenshot;
      },
    },
  };
});

const { handleApi } = await import("../src/routes.js");

/** Somebody signed in who is not the administrator. Minted, so no fixture id is shared. */
const acceptSomebodyElse: Verifier = async () => ({
  ok: true,
  claims: {
    sub: randomUUID(),
    email: "somebody-else@example.test",
    role: "authenticated",
    is_anonymous: false,
  },
});

interface Sent {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
}

async function request(
  urlPath: string,
  options: { method?: string; verify?: Verifier } = {},
): Promise<Sent> {
  const req = Object.assign((async function* () {})(), {
    method: options.method ?? "GET",
    url: urlPath,
    headers: AUTHED_HEADERS,
  }) as unknown as IncomingMessage;

  const headers: Record<string, string> = {};
  const chunks: Buffer[] = [];
  let status = 0;

  const res = {
    get statusCode() {
      return status;
    },
    set statusCode(v: number) {
      status = v;
    },
    writableEnded: false,
    destroyed: false,
    setHeader(name: string, value: unknown) {
      headers[name.toLowerCase()] = String(value);
    },
    flushHeaders() {},
    on() {},
    writeHead(code: number) {
      status = code;
    },
    write(chunk: string | Buffer) {
      chunks.push(Buffer.from(chunk as never));
      return true;
    },
    end(chunk?: string | Buffer) {
      if (chunk) chunks.push(Buffer.from(chunk as never));
      (this as { writableEnded: boolean }).writableEnded = true;
    },
  } as unknown as ServerResponse;

  await handleApi(req, res, options.verify ?? acceptAny);
  return { status, headers, body: Buffer.concat(chunks) };
}

/**
 * A PNG signature and then the multibyte tail. The route does not decode the
 * screenshot — src/feedback-image.ts rebuilt it on the way in — so these bytes
 * only have to be bytes, and ones whose character count is not their length.
 */
const PNG = withMultibyteTail(Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a));
const REPORT = "spya-k3m9qt";
const URL_OF = `/api/admin/feedback/${ADMIN_USER_ID_LOCAL}/${REPORT}/screenshot`;

beforeEach(() => {
  seen.calls.length = 0;
  seen.screenshot = null;
});

describe("a feedback report's screenshot, for the administrator", () => {
  it("carries exactly these headers, with no cache at all", async () => {
    seen.screenshot = PNG;
    const sent = await request(URL_OF);
    expect(sent.status).toBe(200);
    /* `private, no-store`: somebody else's screen, served across owners. A
       picture's usual year-long immutable would be the wrong policy here. */
    expect(sent.headers).toEqual({
      "content-type": "image/png",
      "content-length": String(PNG.byteLength),
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
    });
    expect(seen.calls).toEqual([`readFeedbackScreenshotAcrossOwners(${ADMIN_USER_ID_LOCAL}, ${REPORT})`]);
  });

  it("counts the bytes it sends, not the characters they decode to", async () => {
    expect(charCountDiffers(PNG), "the fixture must tell bytes from characters").toBe(true);
    seen.screenshot = PNG;
    const sent = await request(URL_OF);
    expect(Buffer.from(PNG).equals(sent.body)).toBe(true);
    expect(sent.headers["content-length"]).toBe(String(PNG.byteLength));
  });

  it("names no disposition — shown on the page, not downloaded", async () => {
    seen.screenshot = PNG;
    const sent = await request(URL_OF);
    expect(sent.headers["content-disposition"]).toBeUndefined();
  });

  it("does not answer a HEAD, and never asks the store for one", async () => {
    seen.screenshot = PNG;
    const sent = await request(URL_OF, { method: "HEAD" });
    expect(sent.status).toBe(404);
    expect(sent.headers["content-type"]).not.toBe("image/png");
    expect(sent.body.includes(Buffer.from(PNG))).toBe(false);
    expect(seen.calls).toEqual([]);
  });

  it("404s a report with no screenshot, as JSON rather than an empty picture", async () => {
    seen.screenshot = null;
    const sent = await request(URL_OF);
    expect(sent.status).toBe(404);
    expect(sent.headers["content-type"]).toBe("application/json");
  });

  it("refuses a non-administrator before the store is asked", async () => {
    seen.screenshot = PNG;
    const sent = await request(URL_OF, { verify: acceptSomebodyElse });
    expect(sent.status).toBe(403);
    expect(sent.body.includes(Buffer.from(PNG))).toBe(false);
    expect(seen.calls).toEqual([]);
  });

  it("refuses an id that is not a report id before the store is asked", async () => {
    seen.screenshot = PNG;
    const sent = await request(`/api/admin/feedback/${ADMIN_USER_ID_LOCAL}/not-an-id/screenshot`);
    expect(sent.status).toBe(400);
    expect(seen.calls).toEqual([]);
  });
});
