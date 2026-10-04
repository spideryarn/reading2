// @vitest-environment jsdom
/**
 * **`useCiters`, the read behind Reception's *Cited by*** — src/web/useCiters.ts,
 * plan 261004h.
 *
 * It is one GET and nothing else, so what is worth holding is *when* it asks:
 * not until the section is wanted, once per article however often Reception is
 * left and come back to, again on *Try again*, and again for another article.
 * And that a failed request is the `unavailable` answer rather than a throw or
 * a spinner that never ends.
 *
 * That it starts no job is tests/modes-that-start-themselves.test.tsx § Debate.
 */
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CitersResult } from "../src/types.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Every address asked for, in order. */
const gets: string[] = [];
/** What the next GETs answer: a body, or a status that is not ok. */
let answer: CitersResult | number = { kind: "not-indexed" };
let pending: Promise<Response> | null = null;

vi.mock("../src/web/lib/api.js", () => ({
  apiFetch: async (url: string) => {
    gets.push(url);
    if (pending) return pending;
    return typeof answer === "number"
      ? new Response(JSON.stringify({ error: "no" }), { status: answer })
      : new Response(JSON.stringify(answer), { status: 200 });
  },
  readJson: async (res: Response) => {
    if (!res.ok) throw new Error(String(res.status));
    return res.json();
  },
}));

const { useCiters } = await import("../src/web/useCiters.js");

let host: HTMLDivElement;
let root: Root;
let retry: () => void = () => {};

function Probe({ slug, wanted }: { slug: string; wanted: boolean }) {
  const citers = useCiters(slug, wanted);
  retry = citers.retry;
  return createElement("p", null, citers.result === null ? "waiting" : citers.result.kind);
}

async function show(slug: string, wanted: boolean): Promise<void> {
  await act(async () => {
    root.render(createElement(StrictMode, null, createElement(Probe, { slug, wanted })));
  });
  for (let i = 0; i < 4; i += 1) await act(async () => { await Promise.resolve(); });
}

beforeEach(() => {
  gets.length = 0;
  answer = { kind: "not-indexed" };
  pending = null;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

it("asks nothing until the section is wanted", async () => {
  await show("a-piece", false);
  expect(gets).toEqual([]);
  expect(host.textContent).toBe("waiting");
});

it("asks once, and not again when Reception is left and come back to", async () => {
  await show("a-piece", true);
  expect(gets).toEqual(["/api/citers/a-piece"]);
  expect(host.textContent).toBe("not-indexed");
  await show("a-piece", false);
  await show("a-piece", true);
  expect(gets).toEqual(["/api/citers/a-piece"]);
  expect(host.textContent).toBe("not-indexed");
});

it("asks again on Try again, and shows the new answer", async () => {
  answer = 503;
  await show("a-piece", true);
  expect(host.textContent).toBe("unavailable");
  answer = { kind: "no-doi" };
  await act(async () => retry());
  for (let i = 0; i < 4; i += 1) await act(async () => { await Promise.resolve(); });
  expect(gets).toEqual(["/api/citers/a-piece", "/api/citers/a-piece"]);
  expect(host.textContent).toBe("no-doi");
});

it("calls any failed request unavailable: a refusal, a missing article, a broken body", async () => {
  for (const status of [401, 404, 500]) {
    answer = status;
    await show(`piece-${status}`, true);
    expect(host.textContent, String(status)).toBe("unavailable");
  }
});

it("calls a 200 that is not one of the route's answers unavailable, rather than handing it to the panel", async () => {
  /* Found by tests/a-broken-mode-leaves-the-article-readable.test.tsx, whose
     stub answers an unknown route `{}`: the panel switches exhaustively on
     `kind`, so a body with no kind took the whole Debate band down. */
  const bodies: unknown[] = [
    {},
    { kind: "found" },
    { kind: "found", count: 1, returned: 1, dropped: 0, capped: false, citers: "no", fetchedAt: "2026-10-04T00:00:00Z" },
    { kind: "something-new" },
    null,
    [],
  ];
  for (const [i, body] of bodies.entries()) {
    answer = body as CitersResult;
    await show(`odd-${i}`, true);
    expect(host.textContent, JSON.stringify(body)).toBe("unavailable");
  }
  /* The positive control: a well-formed list is passed through. */
  answer = { kind: "found", count: 0, returned: 0, dropped: 0, capped: false, citers: [], fetchedAt: "2026-10-04T00:00:00Z" };
  await show("fine", true);
  expect(host.textContent).toBe("found");
});

it("asks about another article, and does not show the last one's answer meanwhile", async () => {
  await show("one", true);
  expect(host.textContent).toBe("not-indexed");
  answer = { kind: "no-doi" };
  act(() => {
    root.render(createElement(StrictMode, null, createElement(Probe, { slug: "two", wanted: true })));
  });
  expect(host.textContent).toBe("waiting");
  for (let i = 0; i < 4; i += 1) await act(async () => { await Promise.resolve(); });
  expect(gets).toEqual(["/api/citers/one", "/api/citers/two"]);
  expect(host.textContent).toBe("no-doi");
});

it("reads again after a pending article is left for an unwanted section and then revisited", async () => {
  let finish!: (res: Response) => void;
  pending = new Promise<Response>((resolve) => { finish = resolve; });
  await show("one", true);
  await show("two", false);
  pending = null;
  await show("one", true);
  await act(async () => { finish(new Response(JSON.stringify({ kind: "no-doi" }))); });
  expect(gets).toEqual(["/api/citers/one", "/api/citers/one"]);
  expect(host.textContent).toBe("not-indexed");
});

it("refuses malformed citer rows before they can crash the Debate band", async () => {
  const valid = {
    openalexId: "W1", title: "A citing paper", authors: ["Ada Lovelace"],
    authorCount: 1, citedByCount: 0,
  };
  for (const [i, row] of [null, {}, { ...valid, authors: null }, { ...valid, title: {} }].entries()) {
    answer = {
      kind: "found", count: 1, returned: 1, dropped: 0, capped: false,
      citers: [row], fetchedAt: "2026-10-04T00:00:00Z",
    } as CitersResult;
    await show(`malformed-${i}`, true);
    expect(host.textContent, JSON.stringify(row)).toBe("unavailable");
  }
  answer = {
    kind: "found", count: 1, returned: 1, dropped: 0, capped: false,
    citers: [valid], fetchedAt: "2026-10-04T00:00:00Z",
  };
  await show("valid-row", true);
  expect(host.textContent).toBe("found");
});
