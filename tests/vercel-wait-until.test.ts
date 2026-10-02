/**
 * **Work after the response has to be handed to the platform, or it is frozen.**
 *
 * docs/postmortems/261002b-a-pipeline-whose-only-consumer-reads-the-lossy-copy.md. A Vercel
 * instance is suspended once its response is complete, whatever the handler's
 * promise is still doing — so the feedback mirror, its acknowledgement and the
 * Sentry flush, all of which run after `res.end`, ran only when some later
 * request happened to wake the instance, and sometimes never. Awaiting them was
 * not enough; the platform has to be told, through its request context's
 * `waitUntil`.
 *
 * So these tests install the request context the way the platform does and
 * assert that the handler registers a promise that is still pending after the
 * response has ended, and settles only when the after-response work does. A
 * test that only checked "waitUntil was called" would pass for a handler that
 * registered an already-settled promise.
 */
import type { IncomingMessage, ServerResponse } from "node:http";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Released by the test: the work the fake route does after it has answered. */
let releaseAfterResponse: () => void = () => {};
let responseEnded = false;

vi.mock("../src/routes.js", () => ({
  handleApi: async (_req: IncomingMessage, res: ServerResponse) => {
    res.end("{}");
    responseEnded = true;
    /* What `fileFeedback` does with the mirror: answered, then awaited. */
    await new Promise<void>((resolve) => {
      releaseAfterResponse = resolve;
    });
  },
}));

const { default: handler } = await import("../src/vercel.js");
const { VERCEL_REQUEST_CONTEXT } = await import("../src/wait-until.js");

const contextHolder = globalThis as unknown as Record<symbol, unknown>;

function fakeRequest(): IncomingMessage {
  return { url: "/api/index?__spy_path=nothing-real", method: "GET", headers: {} } as IncomingMessage;
}

function fakeResponse(): ServerResponse {
  const res = {
    statusCode: 200,
    headersSent: false,
    writableEnded: false,
    setHeader: () => res,
    getHeader: () => undefined,
    end: () => {
      res.writableEnded = true;
      return res;
    },
  };
  return res as unknown as ServerResponse;
}

/** Whether `promise` has settled, asked without waiting for it. */
async function settled(promise: Promise<unknown>): Promise<boolean> {
  let done = false;
  void promise.then(
    () => {
      done = true;
    },
    () => {
      done = true;
    },
  );
  /* Two turns, so a promise that is already resolved has had its chance. */
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  return done;
}

describe("handler and the platform's waitUntil", () => {
  let registered: Promise<unknown>[];

  beforeEach(() => {
    registered = [];
    responseEnded = false;
    /* A method that needs its `this`, so a detached call fails here as it
       might on the platform. `@vercel/functions` calls it as
       `context.waitUntil?.(promise)`, and so must we. */
    contextHolder[VERCEL_REQUEST_CONTEXT] = {
      get: () => ({
        kept: registered,
        waitUntil(this: { kept: Promise<unknown>[] }, promise: Promise<unknown>) {
          this.kept.push(promise);
        },
      }),
    };
  });

  afterEach(() => {
    delete contextHolder[VERCEL_REQUEST_CONTEXT];
    releaseAfterResponse();
  });

  it("registers work that is still running after the response has ended", async () => {
    const done = handler(fakeRequest(), fakeResponse());
    await vi.waitFor(() => expect(responseEnded).toBe(true));

    expect(registered).toHaveLength(1);
    const kept = registered[0] as Promise<unknown>;
    /* The response is out and the instance would be frozen here; the promise
       the platform holds must not have settled yet. */
    expect(await settled(kept)).toBe(false);

    releaseAfterResponse();
    await done;
    expect(await settled(kept)).toBe(true);
  });

  it("still serves, and registers nothing, where there is no request context", async () => {
    delete contextHolder[VERCEL_REQUEST_CONTEXT];
    const done = handler(fakeRequest(), fakeResponse());
    await vi.waitFor(() => expect(responseEnded).toBe(true));
    releaseAfterResponse();
    await done;
    expect(registered).toHaveLength(0);
  });
});
