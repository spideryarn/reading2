// @vitest-environment jsdom
/**
 * **A good Copy link takes down the "Couldn't copy" notice, and nobody
 * else's.** qi-pnqc7eh4, plan 261004g.
 *
 * `useShelf` has one notice, shared by archive, rename, re-run and copy, and
 * until 2026-10-04 a button could only set it. So a copy that failed and then
 * worked left the shelf saying it couldn't over a clipboard that held the
 * link. The fix remembers who set the notice: a copy that works clears a
 * copy's notice, and leaves a re-run's or an archive's where it is, because
 * the reader has not dealt with that one.
 *
 * This is the hook's half. The row's half (which outcome calls which) is in
 * tests/shelf-actions-menu.test.tsx.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Shelf } from "../src/web/useShelf.js";

vi.mock("../src/web/lib/api.js", () => ({
  apiFetch: () => Promise.resolve(new Response(null, { status: 200 })),
  readJson: () => new Promise(() => {}),
  statusOf: () => null,
}));
vi.mock("../src/web/lib/offline-store.js", () => ({
  readCached: vi.fn(async () => undefined),
  writeCached: vi.fn(),
  reserveTicket: vi.fn(async () => null),
  invalidate: vi.fn(),
  cachedSlugs: vi.fn(),
  rememberUser: vi.fn(),
  lastKnownUser: () => "reader-a",
  forgetUser: vi.fn(),
}));

const { useShelf } = await import("../src/web/useShelf.js");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let shelf: Shelf;
function Probe() {
  shelf = useShelf("reader-a");
  return null;
}

let host: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(createElement(Probe)));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const COPY = "Couldn't copy the link: the browser refused.";
const REBUILD = "Couldn't queue a rebuild: 503";

it("a copy that works clears the notice a failed copy left", () => {
  act(() => shelf.report(COPY, "copy"));
  expect(shelf.actionError).toBe(COPY);
  act(() => shelf.copied());
  expect(shelf.actionError).toBeNull();
});

it("a copy that works leaves another button's notice alone", () => {
  act(() => shelf.report(REBUILD));
  act(() => shelf.copied());
  expect(shelf.actionError).toBe(REBUILD);
});

it("the newest notice decides: a rebuild's failure after a copy's is not a copy's", () => {
  act(() => shelf.report(COPY, "copy"));
  act(() => shelf.report(REBUILD));
  act(() => shelf.copied());
  expect(shelf.actionError).toBe(REBUILD);
});
