// @vitest-environment jsdom
/**
 * **The client half of the admin gate, asserted by mounting the real `App`.**
 *
 * There is one list of admin-only route kinds (`ADMIN_ONLY` in
 * src/web/router.ts) and `SignedIn` consults it once, above its branch chain.
 * This file checks the wire between those two: that a reader who is not the
 * administrator gets the shelf at every address on the list, and that the
 * administrator gets the page.
 *
 * **None of this is a gate, and these tests are not pretending otherwise.**
 * Every component involved is in the bundle every signed-in reader downloads,
 * and the SPA rewrite serves these addresses with a 200 whoever asks. What is
 * pinned here is that the courtesy is consulted in one place and covers the
 * whole list — the mutation it exists to catch is somebody adding an
 * administrator's page and forgetting the `if`, which is what happened to
 * `/design` on 2026-09-05. docs/project/admin.md § The three refusals.
 *
 * Same shape and reasoning as tests/not-found-route.test.tsx, whose rule is
 * positional in the same way.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NuqsAdapter } from "nuqs/adapters/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ADMIN_USER_ID_LOCAL } from "../src/admin.js";
import { adminOnly, parseRoute } from "../src/web/router.js";

/** Who `useSession` says is here. Re-posed by each test before it renders. */
const session: { user: { id: string; email: string } | null } = { user: null };

vi.mock("../src/web/useSession.js", () => ({
  useSession: () => ({ session: null, user: session.user, loading: false }),
}));

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

class NoResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
Object.assign(globalThis, { ResizeObserver: NoResizeObserver });
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    onchange: null,
    dispatchEvent: () => false,
  }),
});
Object.defineProperty(window, "scrollTo", { writable: true, value: () => {} });

/* The shelf fetches its list and the admin pages fetch theirs. Empty answers
   are enough: this file is about which page mounts, not what it draws. */
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = String(typeof input === "string" ? input : input instanceof URL ? input : input.url);
  const body = url.startsWith("/api/library") ? "[]" : "{}";
  return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { App } = await import("../src/web/App.js");

let host: HTMLDivElement;
let root: Root;

async function show(path: string) {
  history.replaceState(null, "", path);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root.render(createElement(NuqsAdapter, null, createElement(App, null)));
  });
}

/** The page's own name for itself — the shelf, the design reference, or Admin. */
const heading = () => host.querySelector("h1")?.textContent ?? "";

const READER = { id: "11111111-1111-4000-8000-000000000001", email: "reader@example.test" };
const ADMIN = { id: ADMIN_USER_ID_LOCAL, email: "greg@gregdetre.com" };

beforeEach(() => {
  session.user = null;
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("/design is on the administrator's list", () => {
  it("shows an ordinary signed-in reader the shelf", async () => {
    session.user = READER;
    await show("/design");
    expect(heading()).toBe("Spideryarn");
  });

  it("shows the administrator the design reference", async () => {
    session.user = ADMIN;
    await show("/design");
    expect(heading()).toBe("Design reference");
  });
});

describe("/admin still refuses exactly as it did", () => {
  it("shows an ordinary signed-in reader the shelf", async () => {
    session.user = READER;
    await show("/admin");
    expect(heading()).toBe("Spideryarn");
  });

  it("shows the administrator the admin index", async () => {
    session.user = ADMIN;
    await show("/admin");
    expect(heading()).toBe("Admin");
  });

  it("refuses the pages under it too", async () => {
    session.user = READER;
    await show("/admin/users");
    expect(heading()).toBe("Spideryarn");
  });
});

describe("the list itself", () => {
  it("names admin and design, and nothing a reader has a right to", () => {
    expect(adminOnly(parseRoute("/admin"))).toBe(true);
    expect(adminOnly(parseRoute("/admin/users"))).toBe(true);
    expect(adminOnly(parseRoute("/design"))).toBe(true);
    for (const open of ["/", "/profile", "/privacy", "/pricing", "/features", "/contact", "/asdf"]) {
      expect(adminOnly(parseRoute(open)), open).toBe(false);
    }
  });
});
