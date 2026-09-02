/**
 * **`/read/:slug` is served inside a request scope**, like every other route.
 *
 * `docs/project/security-map.md` § the tripwire says the unauthenticated
 * surface is safe partly because *no owner is ever set in that scope*, so a
 * stray owner-scoped read hits `currentOwnerId()` and **throws** rather than
 * quietly answering as whoever `SPIDERYARN_OWNER_ID` names. That is a runtime
 * tripwire rather than a convention, and it is worth having precisely because
 * the alternative answer available at that point is a real person's data.
 *
 * It did not exist on the page path. `handleApi` opens the scope for `/api/*`
 * (src/routes.ts), and `serve` in src/vercel.ts called `servePublicReadPage`
 * **beside** it rather than through it — so outside any scope `currentOwnerId()`
 * takes its third branch and returns `environmentOwnerId()` (src/owner.ts).
 * The page was held only by the import-graph test, which proves the owner's
 * reads are unreachable from `src/public/` and says nothing about what a future
 * edit to this file could reach.
 * docs/plans/260902j-public-read-only-access-audit-and-improvements.md § S2.
 *
 * **The wrap is in src/vercel.ts and must stay there.** Putting it in
 * `src/public/page.ts` would pull `src/owner.ts` into the public import graph,
 * which `tests/public-imports.test.ts` forbids by name — the closed room stays
 * closed and the transport does the wrapping.
 */
import type { IncomingMessage, ServerResponse } from "node:http";

import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What the page handler saw about its own scope, recorded rather than asserted
 * in place.
 *
 * `servePublicReadPage` is stubbed because the question here is *where it runs*,
 * not what it writes; the four lines of I/O it really does are
 * tests/public-read-page.test.ts's job. A spy that asks `currentOwnerId()` on
 * the caller's behalf is the smallest thing that can tell the two worlds apart:
 * inside a request with an empty box it throws, outside one it answers.
 */
const seen = vi.hoisted(() => ({
  inRequest: null as boolean | null,
  ownerAnswer: null as string | null,
  ownerThrew: null as string | null,
  calls: 0,
}));

/**
 * Sentry, stubbed to nothing.
 *
 * `handler`'s `finally` awaits `flushMonitoring()`, which is a real network
 * drain with a timeout of its own; unstubbed it is the whole of this test's
 * runtime and none of its subject. `withMonitoringScope` has to keep calling
 * its callback, though — a stub that swallowed it would make every assertion
 * below vacuous, which is what the call count guards against.
 */
vi.mock("../src/monitoring.js", () => ({
  initMonitoring: () => undefined,
  flushMonitoring: async () => undefined,
  captureFailure: () => undefined,
  withMonitoringScope: async <T>(fn: () => Promise<T>) => fn(),
}));

vi.mock("../src/public/page.js", () => ({
  builtShell: () => "<!doctype html><html><head></head><body></body></html>",
  servePublicReadPage: async () => {
    /* Imported here rather than at the top of the file: `vi.mock` is hoisted
       above the imports, so a module read at factory time would be the one
       thing this file cannot rely on having loaded. */
    const owner = await import("../src/owner.js");
    seen.calls += 1;
    seen.inRequest = owner.inRequest();
    try {
      seen.ownerAnswer = owner.currentOwnerId();
    } catch (e) {
      seen.ownerThrew = (e as Error).message;
    }
  },
}));

/** Enough of a response for `serve` to write a 400 or a 404 into, and no more. */
function fakeRes(): ServerResponse {
  return {
    statusCode: 200,
    setHeader: () => undefined,
    end: () => undefined,
  } as unknown as ServerResponse;
}

const get = (url: string): IncomingMessage => ({ method: "GET", url }) as IncomingMessage;

describe("the public reading page, and the scope it is served in", () => {
  beforeEach(() => {
    seen.inRequest = null;
    seen.ownerAnswer = null;
    seen.ownerThrew = null;
    seen.calls = 0;
  });

  /**
   * **Sixty seconds, and it is the import rather than the test.** Reaching
   * `handler` means loading `src/vercel.ts`, which pulls the whole of
   * `src/routes.ts` behind it — measured at about eight seconds cold on this
   * box, against vitest's five-second default. The work below is microseconds.
   */
  it("runs inside a request scope with nobody in the box", { timeout: 60_000 }, async () => {
    const handler = (await import("../src/vercel.js")).default;
    await handler(get("/read/some-article"), fakeRes());

    /* The control: without this every assertion below would pass just as
       happily against a handler that never reached the page at all. */
    expect(seen.calls, "the page handler must actually have run").toBe(1);

    expect(seen.inRequest).toBe(true);
    /* And the box is empty, which is the half that matters. A scope with an
       owner already in it would be worse than no scope. */
    expect(seen.ownerAnswer).toBeNull();
    expect(seen.ownerThrew).toMatch(/before the request was authenticated/);
  });
});
