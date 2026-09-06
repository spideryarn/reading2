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
 * Every component involved is served to anybody who asks for it — since
 * 2026-09-05 on demand rather than in the reader's first download
 * (src/web/LazyPage.tsx), which changed the startup cost and nothing about who
 * may have the code — and the SPA rewrite serves these addresses with a 200
 * whoever asks. What is
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
  /* An empty list is an answer these pages can draw. `{}` is not: both read a
     named array straight off the body, so an unshaped reply throws inside the
     page and the boundary below it catches — which reads as "the page did not
     render" and means nothing of the kind. Naming the two shapes here was
     needed once the administrator's own pages started being mounted in this
     file (2026-09-05); before that only the shelf was ever drawn. */
  const body = url.startsWith("/api/library")
    ? "[]"
    : url.startsWith("/api/admin/users")
      ? '{"users":[]}'
      : url.startsWith("/api/admin/feedback")
        ? '{"reports":[],"hasMore":false}'
        : "{}";
  return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* **Warm the two on-demand routes.** They are behind `React.lazy` since
   2026-09-05, and under vitest a first dynamic `import()` means reading and
   transforming the module and everything under it — seconds on a loaded box,
   which is a flake waiting to happen inside a bounded wait. Importing them here
   puts them in the module registry, so the loaders in App.tsx resolve promptly
   and what the tests below wait for is React, not a compiler. The loaders
   themselves still run: `React.lazy` reads `module.default`, which neither page
   has, so a badly written loader still fails here. */
await import("../src/web/AdminPage.js");
await import("../src/web/DesignPage.js");

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
  /* **Wait for the page, because `/admin` and `/design` are not in the bundle
     any more.** Since 2026-09-05 both go through `LazyPage`, so the first
     commit draws a Suspense fallback and the page itself arrives once the
     dynamic `import()` resolves — which under vitest is real disk I/O, so
     several turns of the event loop rather than a microtask (LazyPage.tsx, and
     docs/plans/260905i-lazy-load-admin-and-design-routes.md). Nothing the tests
     below assert has changed; only how long it takes to be true.

     Bounded, and it gives up **loudly** — the assertion that follows is the one
     that fails, naming the page it did not get. A wait that returned quietly on
     a timeout would turn every one of these into a test of the spinner. */
  for (let i = 0; i < 50 && !host.querySelector("h1"); i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
    });
  }
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

/**
 * **All four lazy variants arrive, through the real loaders.**
 *
 * Since 2026-09-05 `/admin`, its two sub-pages and `/design` are behind
 * `React.lazy` in App.tsx, and `React.lazy` reads `module.default` — which
 * neither `AdminPage.tsx` nor `DesignPage.tsx` has. A loader written the
 * obvious way (`lazy(() => import("./AdminPage.js"))`) therefore compiles,
 * type-checks and sends **every** visit to the failure surface. GPT Sol's F1 on
 * docs/plans/260905i-lazy-load-admin-and-design-routes.md.
 *
 * So this asks each address for the page's own name, and asks that nobody got
 * the escape hatch instead. The failure surface is tested on its own in
 * tests/lazy-page.test.tsx; here it is only ever the wrong answer.
 */
describe("the four pages that load on demand", () => {
  const variants: [string, string][] = [
    ["/admin", "Admin"],
    ["/admin/users", "Users"],
    ["/admin/feedback", "Feedback"],
    ["/design", "Design reference"],
  ];
  for (const [path, name] of variants) {
    it(`renders the real page at ${path}`, async () => {
      session.user = ADMIN;
      await show(path);
      expect(heading(), path).toBe(name);
      expect(host.textContent ?? "", path).not.toContain("[chunk]");
    });
  }
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
