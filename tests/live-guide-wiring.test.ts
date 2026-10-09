/**
 * **The browser tells the ticket which kind of conversation it is for** — plan
 * docs/plans/261009i-the-guide-greets-in-chat-takes-live-and-a-bar-row.md.
 *
 * An empty guide exists only in the tab, so without the kind the server would
 * start the companion's session, not the guide's, and nothing would error.
 * And `LiveThreadKind` (the browser's copy) must stay `SpokenKind` (the
 * server's), or one end sends a kind the other refuses with a 400.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const calls: { url: string; body: unknown }[] = [];

vi.mock("../src/web/lib/api.js", async () => {
  const real = await vi.importActual<typeof import("../src/web/lib/api.js")>("../src/web/lib/api.js");
  return {
    ...real,
    apiFetch: async (url: string, init?: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init?.body ?? "{}")) });
      const body = url.endsWith("/live-session")
        ? { sdp: "v=0", sessionId: "s1", tailId: null }
        : { token: "ek_test", expiresAt: 1, model: "m", seed: [], tailId: null, sessionId: "s1" };
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  };
});

const { apiWiringFor } = await import("../src/web/live/wiring.js");
const { isSpokenKind } = await import("../src/chat.js");

afterEach(() => {
  calls.length = 0;
});

describe("the kind travels with the ticket", () => {
  it("sends a guide's kind to Realtime's ticket and to GPT-Live's session", async () => {
    const wiring = apiWiringFor(null);
    await wiring.ticket("piece", "spya-gggggg", "laptop", undefined, "guide");
    await wiring.session?.("piece", "spya-gggggg", { sdp: "v=0", kind: "guide" });
    expect(calls.map((c) => c.body)).toEqual([
      { placement: "laptop", kind: "guide" },
      { sdp: "v=0", kind: "guide" },
    ]);
  });

  it("sends no kind when none is known, as before", async () => {
    await apiWiringFor(null).ticket("piece", "spya-cccccc", "laptop");
    expect(calls[0]?.body).toEqual({ placement: "laptop" });
  });
});

describe("the browser's kinds are the server's", () => {
  it("accepts exactly chat, learn and guide", () => {
    const kinds: Record<import("../src/web/live/wiring.js").LiveThreadKind, true> = { chat: true, learn: true, guide: true };
    for (const kind of Object.keys(kinds)) expect(isSpokenKind(kind)).toBe(true);
    for (const kind of ["candidates", "tutorial", "explore"]) expect(isSpokenKind(kind)).toBe(false);
  });
});
