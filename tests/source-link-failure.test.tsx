// @vitest-environment jsdom
/**
 * **"View the original" that fails says a reader's sentence**, never the
 * exception's own words. `SourceLink` printed `(err as Error).message` beside
 * the button, so a dropped connection read "Load failed" on an iPad and a bug
 * read as its stack's first line. docs/plans/261007a-ui-sweep-umbrella.md § K4.
 *
 * What can throw there: `apiFetch` (a lost connection, marked by it), the
 * server's refusal (written at the throw site, since the body may be a PDF),
 * `res.blob()` dying mid-download (a `TypeError` nobody marked until this
 * change), and anything unexpected. The real `apiFetch`; only `fetch` and
 * `window.open` are posed.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../src/web/lib/supabase.js", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { access_token: "t" } } }),
      refreshSession: async () => ({ data: { session: { access_token: "t" } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
  googleSignInAvailable: false,
}));

vi.mock("../src/web/lib/offline-store.js", () => ({
  readCached: async () => undefined,
  writeCached: async () => undefined,
  reserveTicket: async () => null,
  invalidate: async () => undefined,
  cachedSlugs: async () => new Set<string>(),
  rememberUser: () => {},
  lastKnownUser: () => null,
  forgetUser: () => {},
}));

vi.mock("../src/web/monitoring.js", async () => {
  const real = await vi.importActual<typeof import("../src/web/monitoring.js")>(
    "../src/web/monitoring.js",
  );
  return { ...real, captureClientFailure: () => {} };
});

const { SourceLink } = await import("../src/web/SourceLink.js");

let host: HTMLDivElement;
let root: Root;
let closed = 0;

beforeEach(() => {
  closed = 0;
  /* A built page: the development build keeps the browser's words in brackets. */
  vi.stubEnv("PROD", true);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal("open", () => ({ opener: {}, location: { href: "" }, close: () => void (closed += 1) }));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function press(answer: () => Promise<Response>): Promise<string> {
  vi.stubGlobal("fetch", answer);
  await act(async () => {
    root.render(createElement(SourceLink, { slug: "a-piece", children: "view the original" }));
  });
  await act(async () => host.querySelector("button")!.click());
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
  return host.querySelector('[role="alert"]')?.textContent ?? "";
}

describe("a failed View the original", () => {
  it("says the connection was lost, in our words, when the request never left", async () => {
    const said = await press(() => Promise.reject(new TypeError("Load failed")));
    expect(said).toContain("Couldn't open the original.");
    expect(said).toMatch(/\[net-down\]$/);
    expect(said).not.toContain("Load failed");
    expect(closed, "the blank tab was left open").toBe(1);
  });

  it("says the same when the document dies part-way down", async () => {
    const said = await press(async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(c) {
            c.error(new TypeError("network error"));
          },
        }),
        { status: 200 },
      ),
    );
    expect(said).toMatch(/\[net-down\]$/);
    expect(said).not.toContain("network error");
  });

  it("keeps its own sentence and its own code for a refusal", async () => {
    const said = await press(async () => new Response("no", { status: 404 }));
    expect(said).toBe("Couldn't open the original. The server said 404. [source-open]");
  });

  it("does not print an exception nobody wrote for a reader", async () => {
    const said = await press(() => Promise.reject(new Error("Cannot read properties of undefined (reading 'pdf')")));
    expect(said).toContain("Couldn't open the original.");
    expect(said).toMatch(/\[web-unexpected\]$/);
    expect(said).not.toContain("Cannot read");
  });
});
