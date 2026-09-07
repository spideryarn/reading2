// @vitest-environment jsdom
/** A lost write response is uncertain even when every retry also loses its answer. */
import { afterEach, expect, it, vi } from "vitest";

let answer: (url: string, init?: RequestInit) => Promise<Response>;
vi.mock("../src/web/lib/api.js", async () => {
  const real = await vi.importActual<typeof import("../src/web/lib/api.js")>("../src/web/lib/api.js");
  return { ...real, apiFetch: (url: string, init?: RequestInit) => answer(url, init) };
});
const { appendSpoken } = await import("../src/web/chat/effects.js");
const body = { question: "Why?", answer: "Because.", expectedTailId: null };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { "content-type": "application/json" },
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

it.each(["network", "server", "malformed", "empty"])("marks exhausted %s responses uncertain", async (kind) => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  let attempts = 0;
  answer = async () => {
    attempts++;
    if (kind === "network") throw new TypeError("Lost response");
    if (kind === "server") return json({ error: "Server unavailable" }, 502);
    if (kind === "malformed") return new Response("broken JSON", { status: 200 });
    return json({});
  };
  const result = await appendSpoken("a-slug", "spya-thra01", body, 0);
  expect(attempts).toBe(3);
  expect(result).toMatchObject({ ok: false, conflict: false, uncertain: true });
});

it("marks timed out attempts uncertain", async () => {
  vi.useFakeTimers();
  answer = (_url, init) => new Promise((_, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new Error("Timed out")));
  });
  const pending = appendSpoken("a-slug", "spya-thra01", body, 0);
  await vi.advanceTimersByTimeAsync(35_000);
  await expect(pending).resolves.toMatchObject({ ok: false, conflict: false, uncertain: true });
});

it("keeps uncertainty from an earlier lost response when the next attempt is refused", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  let attempts = 0;
  answer = async () => {
    if (++attempts === 1) throw new TypeError("First response was lost after commit");
    return json({ error: "Sign in again" }, 401);
  };
  const result = await appendSpoken("a-slug", "spya-thra01", body, 0);
  expect(attempts).toBe(2);
  expect(result).toMatchObject({ ok: false, conflict: false, uncertain: true });
});

it("keeps a definite first-attempt rejection distinct and does not retry it", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  let attempts = 0;
  answer = async () => { attempts++; return json({ error: "Invalid passage" }, 400); };
  const result = await appendSpoken("a-slug", "spya-thra01", body, 0);
  expect(attempts).toBe(1);
  expect(result).toEqual({ ok: false, conflict: false, error: "Invalid passage" });
});
