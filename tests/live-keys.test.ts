/**
 * `liveKeys` — the count behind every live marker in src/routes.ts.
 *
 * The integration halves, one per handler, are in
 * tests/referee-stream-lifetime.test.ts, tests/routes.test.ts and
 * tests/comment-answer-stream-lifetime.test.ts.
 */
import { expect, it } from "vitest";

import { liveKeys } from "../src/live-keys.js";

it("stays live while any holder remains, and goes when the last one releases", () => {
  const live = liveKeys();
  const first = live.hold("a/1");
  const second = live.hold("a/1");
  first();
  expect(live.has("a/1"), "the first release took the second holder's key").toBe(true);
  expect([...live.keys()]).toEqual(["a/1"]);
  second();
  expect(live.has("a/1")).toBe(false);
  expect([...live.keys()]).toEqual([]);
});

it("counts a double release as one", () => {
  const live = liveKeys();
  const first = live.hold("a/1");
  live.hold("a/1");
  first();
  first();
  expect(live.has("a/1"), "a second call of one release decremented another holder").toBe(true);
});

it("releases in either order, and keeps keys apart", () => {
  const live = liveKeys();
  const older = live.hold("a/1");
  const newer = live.hold("a/1");
  const other = live.hold("b/2");
  newer();
  expect(live.has("a/1")).toBe(true);
  older();
  expect(live.has("a/1")).toBe(false);
  expect([...live.keys()]).toEqual(["b/2"]);
  other();
  expect(live.has("b/2")).toBe(false);
});
