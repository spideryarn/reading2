// @vitest-environment jsdom
/**
 * **The effect `App` actually runs, rendered as itself.**
 *
 * This used to be a copy of `App`'s effect written out inside
 * `tests/job-engine-session.test.tsx`, and GPT Sol's note on it is the reason
 * this file exists: a copy stays green while the original drifts, and the
 * original is an effect whose *dependency array* is the entire contract. So the
 * body moved into `useJobSession` (src/web/useJobs.ts), which `App` calls and
 * this file renders. That `App` still calls it is a separate fact, pinned
 * behaviourally by the one `GET /api/jobs` a signed-in reader makes in
 * `tests/public-network-trace.test.tsx`.
 *
 * ## The two things it has to get right
 *
 * **Strict Mode is not a special case, it is the ordinary one.** React runs
 * mount effects twice in development, so the effect really does fire
 * `start → stop → start` on every load, with the first poll still in flight
 * across the middle. That is the same sequence as a fast sign-out and sign-in,
 * and if the fence is wrong it shows as a snapshot that flickers back to a
 * stale list — which reads as a race and is entirely deterministic.
 *
 * **A new token for the same reader has to resume a paused engine, and must
 * not restart a healthy one.** Both halves matter. Putting the token in the
 * first effect's dependencies would tear the session down and rebuild it on
 * every hourly refresh — fencing an `/advance` mid-flight, dropping the job
 * list — to achieve nothing; leaving it out altogether is the hole Sol found,
 * where a 401 pause outlived the token that would have fixed it.
 *
 * The real `jobEngine` singleton runs here, over a mocked `apiFetch` whose
 * every answer is held: the point is which requests go out and when.
 */
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Every URL asked for, in order, and the resolver for each still waiting. */
let requests: string[] = [];
let held: ((res: Response) => void)[] = [];
/** The same requests with their method and body, for the one case that asks. */
let sent: { url: string; method: string; body: string | null; answer: (res: Response) => void }[] = [];

/* jsdom's `localStorage` is shadowed by Node's own global here (see
   src/web/shelf-hidden-columns.ts), so the test brings its own. */
const stored = new Map<string, string>();
Object.defineProperty(window, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => void stored.set(key, value),
    removeItem: (key: string) => void stored.delete(key),
    clear: () => stored.clear(),
  },
});

/* The real `readJson` and `statusOf`, because the 401 case below is about what
   they make of a refusal — a stand-in that threw a plain `Error` would take the
   status out of the test that is about the status. */
vi.mock("../src/web/lib/api.js", async () => {
  const real = await vi.importActual<typeof import("../src/web/lib/api.js")>(
    "../src/web/lib/api.js",
  );
  return {
    ...real,
    apiFetch: (url: string, init: RequestInit = {}) => {
      requests.push(url);
      return new Promise<Response>((resolve) => {
        held.push(resolve);
        sent.push({
          url,
          method: init.method ?? "GET",
          body: typeof init.body === "string" ? init.body : null,
          answer: resolve,
        });
      });
    },
  };
});

const { jobEngine } = await import("../src/web/jobEngine.js");
const { useJobSession } = await import("../src/web/useJobs.js");

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** The whole of what `App` renders around this: nothing. */
function Gate({ readerId, token }: { readerId: string | null; token: string | null }) {
  useJobSession(readerId, token);
  return null;
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  /* `errorFor` logs every refusal with the status and the URL, which is
     deliberate (src/web/lib/api.ts) and is noise here. */
  vi.spyOn(console, "error").mockImplementation(() => {});
  jobEngine.reset();
  requests = [];
  held = [];
  sent = [];
  stored.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  jobEngine.reset();
  vi.restoreAllMocks();
});

/** Render, and let whatever the effects started settle. */
async function show(readerId: string | null, token: string | null): Promise<void> {
  await act(async () => {
    root.render(createElement(StrictMode, null, createElement(Gate, { readerId, token })));
  });
  await act(async () => {
    await Promise.resolve();
  });
}

describe("the session effect App runs", () => {
  it("ends with exactly one live session after Strict Mode's start → stop → start", async () => {
    await show("reader-a", "token-1");

    const [first, second] = held.splice(0);
    if (!first || !second) throw new Error(`expected two polls, saw ${requests.length}`);

    // The live session's answer lands, and then the fenced one arrives late.
    second(json({ jobs: [{ id: "live", slug: "s", status: "running", steps: [] }] }));
    await act(async () => {
      await Promise.resolve();
    });
    first(json({ jobs: [{ id: "stale", slug: "s", status: "done", steps: [] }] }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(jobEngine.getSnapshot().jobs.map((j) => j.id)).toEqual(["live"]);
    // And the stale reply announced nothing to anybody.
    expect(jobEngine.drainCompletions(0).jobs).toEqual([]);
  });

  it("does not sign anybody in for a signed-out reader", async () => {
    await show(null, null);
    expect(requests).toEqual([]);
  });

  it("resumes a paused engine when the same reader's token is refreshed", async () => {
    await show("reader-a", "token-1");
    // Strict Mode's two polls; the fenced one can answer or not, it changes nothing.
    for (const answer of held.splice(0)) answer(json({ error: "Your session has expired." }, 401));
    await act(async () => {
      await Promise.resolve();
    });
    expect(jobEngine.getSnapshot()).toMatchObject({
      authFailed: true,
      error: "Your session has expired.",
    });

    /* A re-emitted `SIGNED_IN` — Supabase fires one whenever the tab regains
       focus — carries the *same* token, and must change nothing. Without this,
       the assertion below would also pass on an effect that resumed on every
       render. */
    const beforeAltTab = requests.length;
    await show("reader-a", "token-1");
    expect(requests.length, "an alt-tab restarted the poller").toBe(beforeAltTab);

    // And the refresh that really is new brings it back.
    await show("reader-a", "token-2");
    expect(requests.length, "a fresh token asked for nothing").toBeGreaterThan(beforeAltTab);

    for (const answer of held.splice(0)) answer(json({ jobs: [] }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(jobEngine.getSnapshot()).toMatchObject({
      authFailed: false,
      error: null,
      loaded: true,
    });
  });

  it("does not tear the session down on an ordinary token refresh", async () => {
    /* The cost of the fix, kept honest: a token refreshes about once an hour on
       a healthy session, and if that restarted the engine it would fence
       whatever `/advance` was in flight and drop the job list — turning an
       invisible housekeeping event into a stalled import. */
    await show("reader-a", "token-1");
    for (const answer of held.splice(0)) answer(json({ jobs: [] }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(jobEngine.getSnapshot().loaded).toBe(true);

    const before = requests.length;
    await show("reader-a", "token-2");
    expect({ requests: requests.length, loaded: jobEngine.getSnapshot().loaded }).toEqual({
      requests: before,
      loaded: true,
    });
  });

  /**
   * **A browser's old "off" for *generate the main modes* is handed to the
   * server when the signed-in app starts** — plan 261004h, GPT Sol's F3. Here
   * and not on the add page, because an import can start from a link's hover
   * card without ever visiting it. The request, the key outliving a refusal and
   * the forgetting are held by tests/auto-modes.test.tsx; this holds that the
   * effect `App` runs is what makes the call.
   */
  it("hands an old off for the main modes to the server, and only for a signed-in reader", async () => {
    stored.set("spideryarn.add.generate-main-modes", "off");
    await show(null, null);
    expect(requests, "a signed-out visitor wrote somebody's setting").toEqual([]);

    await show("reader-a", "token-1");
    const patches = sent.filter((r) => r.url === "/api/reader" && r.method === "PATCH");
    expect(patches.length, "the session started and handed nothing over").toBeGreaterThan(0);
    expect(patches.every((r) => r.body === JSON.stringify({ autoModes: false }))).toBe(true);
    expect(stored.get("spideryarn.add.generate-main-modes"), "forgotten before the server answered").toBe("off");

    for (const patch of patches) patch.answer(json({ profile: null, experimentalSince: null, autoModes: false }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(stored.has("spideryarn.add.generate-main-modes"), "the key outlived the hand-over").toBe(false);
  });

  /**
   * **The add page's sharing controllers end with the session** — plan
   * 261005l, stage 2, GPT Sol's F1. One of them holds a private link's key,
   * and a direct change of account can leave the add page mounted. What a
   * retired controller then does and does not do is
   * tests/add-share-link.test.ts; this holds that the effect `App` runs is
   * what retires them, and that a refreshed token does not.
   */
  it("retires the add page's sharing controllers when the reader changes, and not while the reader stays", async () => {
    const { linkAtAddFor } = await import("../src/web/add-share-link.js");
    const never = () => new Promise<never>(() => {});
    const io = { probe: never, read: never, create: never, remove: never };

    await show("reader-a", "token-1");
    /* Made after Strict Mode's start → stop → start, as a page's would be. */
    const forA = linkAtAddFor("an-essay", io, "reader-a");

    await show("reader-a", "token-2");
    expect(linkAtAddFor("an-essay", io, "reader-a"), "a refreshed token retired it").toBe(forA);

    await show("reader-b", "token-3");
    expect(linkAtAddFor("an-essay", io, "reader-a"), "reader A's controller outlived reader A").not.toBe(forA);
  });
});
