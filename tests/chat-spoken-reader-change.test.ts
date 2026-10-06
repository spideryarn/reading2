// @vitest-environment jsdom
/**
 * **A spoken exchange is not retried as the next reader.**
 * docs/plans/261006f-every-request-is-bound-to-the-reader-at-its-start.md § Stage 2;
 * GPT Sol's review, F2 (docs/plans/261006f-reader-bound-plan-review-sol.md).
 *
 * `appendSpoken` tries three times with a gap between. A first spoken
 * exchange *creates* its thread, so the conversation's id protects nothing:
 * if reader A's first attempt is lost and another tab signs in as B during
 * the gap, the retry went out with B's token and stored A's transcript on
 * B's article of the same slug.
 *
 * `api.ts` is real; the SDK and `fetch` are stood in.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";

interface FakeSession {
  access_token: string;
  user: { id: string };
}
let signedIn: FakeSession | null = null;
let announce: (event: string, session: FakeSession | null) => void = () => {};
const sessionOf = (id: string): FakeSession => ({ access_token: `TOKEN-${id}`, user: { id } });
function become(id: string): void {
  signedIn = sessionOf(id);
  announce("SIGNED_IN", signedIn);
}

vi.mock("../src/web/lib/supabase.js", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: signedIn } }),
      refreshSession: async () => ({ data: { session: signedIn } }),
      onAuthStateChange: (fn: typeof announce) => {
        announce = fn;
        return { data: { subscription: { unsubscribe() {} } } };
      },
    },
  },
  callbackUrl: () => "https://spideryarn.test/auth/callback",
  CALLBACK_PATH: "/auth/callback",
}));

const { appendSpoken } = await import("../src/web/chat/effects.js");

const body = { question: "What A asked aloud.", answer: "What A was told.", expectedTailId: null };
const stored = () =>
  new Response(JSON.stringify({ thread: { id: "spya-thra01", messages: [] } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

let sent: (string | null)[] = [];
/** Runs as each request is made; what it returns or throws is the answer. */
let onRequest: (n: number) => Response = () => stored();

beforeEach(() => {
  sent = [];
  onRequest = () => stored();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit = {}) => {
    sent.push(new Headers(init.headers).get("Authorization"));
    return onRequest(sent.length);
  });
  announce("SIGNED_OUT", null);
  become("A");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("stops, and sends nothing as B, when the reader changes in the gap after a lost first attempt", async () => {
  onRequest = () => {
    /* A's first attempt is lost, and another tab signs in as B before the retry. */
    become("B");
    throw new TypeError("Failed to fetch");
  };
  const outcome = await appendSpoken("a-slug", "spya-thra01", body, 0);

  expect(sent).toEqual(["Bearer TOKEN-A"]);
  /* A definite end, not `uncertain`: that would send the caller to read B's
     conversations to find out what became of A's words. */
  expect(outcome).toMatchObject({ ok: false, conflict: false });
  expect(outcome).not.toHaveProperty("uncertain");
});

it("names the reader its caller hands it, when it is called after the tab has changed", async () => {
  /* The band's controller was made for A; the hang-up that writes the last
     exchange runs as the view unmounts, when the tab is already B's. */
  become("B");
  const outcome = await appendSpoken("a-slug", "spya-thra01", body, 0, "A");
  expect(sent).toEqual([]);
  expect(outcome).toMatchObject({ ok: false, conflict: false });
});

it("still retries a lost attempt for the same reader", async () => {
  onRequest = (n) => {
    if (n === 1) throw new TypeError("Failed to fetch");
    return stored();
  };
  const outcome = await appendSpoken("a-slug", "spya-thra01", body, 0);
  expect(sent).toEqual(["Bearer TOKEN-A", "Bearer TOKEN-A"]);
  expect(outcome.ok).toBe(true);
});
