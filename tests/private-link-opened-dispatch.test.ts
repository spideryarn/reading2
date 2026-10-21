/**
 * **The one write in the closed room, as dispatch sees it** — plan 261021d § 4.
 *
 * `POST /api/public/private-link-opened/:slug?key=` counts a signed-out open of
 * a private link. What has to hold, and what each case is the witness for:
 *
 * - POST reaches `countSignedOutOpen` with the slug and the **parsed** key, and
 *   answers 204 with no body;
 * - without a usable key it answers the same 204 and writes nothing;
 * - GET and HEAD are refused 405 with `Allow: POST` — a write a prefetch or an
 *   unfurler could make is the thing the read-only rule exists to prevent;
 * - it is answered inside the public namespace, `no-store`, for an anonymous
 *   request, and never reaches the authenticated table (a 401 would say so).
 *
 * The store is mocked: the spy is the witness that the route matched, as
 * `readerRan` is in tests/public-dispatch.test.ts. The write itself is
 * tested against Postgres in tests/private-link-opens-pg.test.ts.
 */
import type { IncomingMessage, ServerResponse } from "node:http";

import { beforeEach, describe, expect, it, vi } from "vitest";

const countSignedOutOpen = vi.fn(async (_slug: string, _key: string) => {});
vi.mock("../src/store/private-link-signed-out-opens.js", () => ({
  countSignedOutOpen: (slug: string, key: string) => countSignedOutOpen(slug, key),
  SIGNED_OUT_OPEN_THROTTLE_SECONDS: 2,
}));

const { handleApi } = await import("../src/routes.js");
const { PRIVATE_LINK_OPENED, PUBLIC_ROUTE_NAMES } = await import("../src/public/route-names.js");
const { acceptAny } = await import("./helpers/authed.js");

const KEY = "abcdefghijklmnopqrstuv";

async function call(method: string, url: string) {
  const req = Object.assign((async function* () {})(), { method, url, headers: {} }) as unknown as IncomingMessage;
  let status = 0;
  let text: string | undefined;
  const sent: Record<string, string> = {};
  const res = {
    set statusCode(v: number) {
      status = v;
    },
    get statusCode() {
      return status;
    },
    setHeader(name: string, value: string) {
      sent[name] = value;
    },
    end(chunk?: string) {
      text = chunk;
    },
  } as unknown as ServerResponse;
  const handled = await handleApi(req, res, acceptAny);
  return { handled, status, headers: sent, text };
}

beforeEach(() => countSignedOutOpen.mockClear());

describe("POST /api/public/private-link-opened/:slug", () => {
  it("counts with the slug and the parsed key, and answers 204 with no body", async () => {
    const r = await call("POST", `${PRIVATE_LINK_OPENED.path("a-piece-spya-k3m9qt")}?key=${KEY}`);
    expect(r.status).toBe(204);
    expect(r.text).toBeUndefined();
    expect(r.headers["Cache-Control"]).toBe("no-store");
    expect(countSignedOutOpen).toHaveBeenCalledTimes(1);
    expect(countSignedOutOpen).toHaveBeenCalledWith("a-piece-spya-k3m9qt", KEY);
  });

  it("writes nothing without a usable key, and says the same 204", async () => {
    for (const url of [
      PRIVATE_LINK_OPENED.path("a-piece"),
      `${PRIVATE_LINK_OPENED.path("a-piece")}?key=short`,
      `${PRIVATE_LINK_OPENED.path("a-piece")}?key=${"!".repeat(22)}`,
    ]) {
      const r = await call("POST", url);
      expect(r.status, url).toBe(204);
    }
    expect(countSignedOutOpen).not.toHaveBeenCalled();
  });

  it("refuses every other method with 405 and Allow: POST, and writes nothing", async () => {
    for (const method of ["GET", "HEAD", "PUT", "PATCH", "DELETE"]) {
      const r = await call(method, `${PRIVATE_LINK_OPENED.path("a-piece")}?key=${KEY}`);
      expect(r.status, method).toBe(405);
      expect(r.headers.Allow, method).toBe("POST");
    }
    expect(countSignedOutOpen).not.toHaveBeenCalled();
  });

  it("refuses a malformed slug before anything is written", async () => {
    const r = await call("POST", `${PRIVATE_LINK_OPENED.path("%E0%A4%A")}?key=${KEY}`);
    expect(r.status).toBe(400);
    expect(countSignedOutOpen).not.toHaveBeenCalled();
  });

  /** It is not a read route, so no sweep driven off the read inventory treats it as one. */
  it("is not in the read inventory, and every read route still refuses POST", async () => {
    expect(PUBLIC_ROUTE_NAMES.some((r) => r.name === PRIVATE_LINK_OPENED.name)).toBe(false);
    const r = await call("POST", `/api/public/article/a-piece?key=${KEY}`);
    expect(r.status).toBe(405);
    expect(countSignedOutOpen).not.toHaveBeenCalled();
  });
});
