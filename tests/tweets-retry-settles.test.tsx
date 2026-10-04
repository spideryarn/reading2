// @vitest-environment jsdom
/**
 * **A read that has finished is not `loading`, whatever an earlier read said.**
 *
 * After a clean 404, a failed recheck and then a failed *Try again* left
 * `useTweets` on `loading` beside the failure's sentence: the catch kept the
 * view because an earlier read had answered, and `retryRead` had moved to
 * `loading` because nothing was loaded — both true after a 404.
 * docs/postmortems/261004f-a-previous-404-cannot-settle-the-next-failed-retry.md.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { THREAD_RECHECK_FAILED } from "../src/messages.js";
import type { UseTweets } from "../src/web/useTweets.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../src/web/useJobs.js", () => ({
  useJobs: () => ({
    jobs: [],
    loaded: true,
    driverFailures: {},
    lastFailure: () => null,
    run: async () => null,
    cancel: async () => {},
  }),
}));
/* Arrival would start a job on `none`; this file is about the read. */
vi.mock("../src/web/useAutoRun.js", () => ({ useAutoRunOnArrival: () => {} }));

let answer: () => Promise<Response> = async () => new Response(null, { status: 404 });
vi.mock("../src/web/lib/api.js", () => ({
  apiFetch: () => answer(),
  readJson: async (res: Response) => res.json(),
}));

const { useTweets } = await import("../src/web/useTweets.js");

let view: UseTweets;
function Probe() {
  view = useTweets("a-piece");
  return null;
}
let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  answer = async () => new Response(null, { status: 404 });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

it("settles a failed retry after a 404 and a failed recheck", async () => {
  await act(async () => root.render(createElement(Probe)));
  expect(view.status).toBe("none");

  answer = async () => {
    throw new TypeError("Load failed");
  };
  await act(async () => view.refresh());
  expect(view.status).toBe("none");
  expect(view.error).toBe(THREAD_RECHECK_FAILED.message);

  await act(async () => view.retryRead());
  expect(view.error).toBe(THREAD_RECHECK_FAILED.message);
  expect(view.status, "the GET rejected, so this is no longer loading").not.toBe("loading");
  expect(view.status).toBe("none");
});

it("still shows loading while that retry is in the air, and takes a thread if it answers", async () => {
  await act(async () => root.render(createElement(Probe)));
  let land!: (res: Response) => void;
  answer = () => new Promise((resolve) => { land = resolve; });
  let retry!: Promise<void>;
  await act(async () => {
    retry = view.retryRead();
  });
  expect(view.status).toBe("loading");
  await act(async () => {
    land(Response.json({ thread: { tweets: [], limit: 280, generatedAt: "2026-10-04T09:00:00.000Z" }, stale: false, profileChanged: false }));
    await retry;
  });
  expect(view.status).toBe("ready");
});
