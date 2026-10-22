// @vitest-environment jsdom
/**
 * **A tab viewing the app as another reader, mounted.**
 * docs/plans/261019n-admin-sees-other-users-articles-and-views-as-them.md
 * § Part 3, Client 3–4, and round 1 F3 / F5, round 2 R2-6.
 *
 * - The route table: only the shelf and `read` (an article in any mode, and its
 *   metadata page) are drawn; every other kind draws *Not available while
 *   viewing as another reader*, decided once in App.tsx § `SignedIn`.
 * - The shelf, drawn in that tab, asks for neither the plan nor the topics,
 *   sends no write, and says the plan is hidden rather than leaving a gap.
 * - The bar: drawn before `/current` has answered; the subject's address and
 *   the minutes from the server's `expiresAt`; Stop that lands ends the tab;
 *   Stop that cannot reach the server keeps everything and offers Retry.
 *
 * The mark is put on the window before anything is imported, as index.html's
 * script does before any module runs.
 */
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NuqsAdapter } from "nuqs/adapters/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const NONCE = "V".repeat(43);
Object.defineProperty(window, "__spideryarnViewAs", {
  configurable: true,
  value: Object.freeze({ nonce: NONCE }),
});

const session: { user: { id: string; email: string } | null } = { user: null };
vi.mock("../src/web/useSession.js", () => ({
  useSession: () => ({ session: null, user: session.user, loading: false, known: true }),
}));
vi.mock("../src/web/lib/supabase.js", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { access_token: "ADMIN-TOKEN", user: { id: "admin" } } } }),
      refreshSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
  googleSignInAvailable: false,
  callbackUrl: () => "https://spideryarn.test/auth/callback",
  CALLBACK_PATH: "/auth/callback",
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
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Call = { method: string; url: string; headers: Headers };
let calls: Call[];
/** What `/current` answers; `"hang"` never answers. */
let current: { status: number; body: unknown } | "hang";
/** What Stop's POST does. */
let stopWith: "ok" | "network";

const SUBJECT = "a1a1a1a1-0b11-4c5e-8a01-261020000009";

beforeEach(() => {
  calls = [];
  current = {
    status: 200,
    body: {
      subjectId: SUBJECT,
      subjectEmail: "alice@example.test",
      expiresAt: new Date(Date.now() + 27 * 60_000 - 5_000).toISOString(),
    },
  };
  stopWith = "ok";
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(typeof input === "string" ? input : input instanceof URL ? input : input.url);
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ method, url, headers: new Headers(init?.headers) });
    const json = (status: number, value: unknown) =>
      new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
    if (url === "/api/admin/view-as/current") {
      if (current === "hang") return new Promise<Response>(() => {});
      return json(current.status, current.body);
    }
    if (url === "/api/admin/view-as/end") {
      if (stopWith === "network") throw new TypeError("Failed to fetch");
      return new Response(null, { status: 204 });
    }
    if (url.startsWith("/api/library")) return json(200, []);
    return json(200, {});
  }) as typeof fetch;
});

const { App } = await import("../src/web/App.js");
const { ViewAsBar, minutesLeft } = await import("../src/web/ViewAsBar.js");
const { allowedWhileViewingAs, parseRoute } = await import("../src/web/router.js");
const { resetViewAsEndForTests, tabExit, viewAsNonce } = await import("../src/web/lib/view-as.js");
const { resetViewAsSessionForTests } = await import("../src/web/view-as-session.js");
const { ADMIN_USER_ID_LOCAL } = await import("../src/admin.js");

const close = vi.fn();
const replace = vi.fn();
beforeEach(() => {
  close.mockReset();
  replace.mockReset();
  tabExit.close = close;
  tabExit.replace = replace;
  resetViewAsEndForTests();
  resetViewAsSessionForTests();
});

let host: HTMLDivElement = document.createElement("div");
let root: Root | undefined;

async function settle() {
  for (let i = 0; i < 20; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
    });
  }
}

async function mount(node: ReturnType<typeof createElement>) {
  host = document.createElement("div");
  document.body.append(host);
  const r = createRoot(host);
  root = r;
  await act(async () => r.render(node));
  await settle();
}

async function show(path: string) {
  history.replaceState(null, "", path);
  await mount(
    createElement(
      NuqsAdapter,
      null,
      createElement(Fragment, null, createElement(App, null), createElement(ViewAsBar, null)),
    ),
  );
}

async function bar() {
  await mount(createElement(ViewAsBar));
}

afterEach(() => {
  /* Not every test mounts anything. */
  const mounted = root;
  if (mounted) act(() => mounted.unmount());
  root = undefined;
  host.remove();
});

const notAvailable = () => host.querySelector('[data-testid="not-while-viewing-as"]');
const theBar = () => host.querySelector('[data-testid="view-as-bar"]');
const button = (label: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === label) as HTMLButtonElement | undefined;

const READER = { id: "11111111-1111-4000-8000-000000000001", email: "admin-but-not-listed@example.test" };
const ADMIN = { id: ADMIN_USER_ID_LOCAL, email: "greg@gregdetre.com" };

describe("which pages a view-as tab draws", () => {
  it("allows the shelf, an article in any mode, and its metadata page, and nothing else", () => {
    const allowed = [
      "/",
      "/read/some-slug",
      "/read/some-slug?mode=quotes", // the mode is the query; the route is the path
      "/read/some-slug/metadata",
    ];
    for (const path of allowed) expect([path, allowedWhileViewingAs(parseRoute(path.split("?")[0]!))]).toEqual([path, true]);
    const refused = [
      "/profile",
      "/add/https%3A%2F%2Fexample.test%2Fa",
      "/admin",
      "/admin/users",
      "/design",
      "/pricing",
      "/login",
      "/oauth/consent",
      "/privacy",
      "/help",
      "/changelog",
      "/read/public",
      "/no-such-page",
    ];
    for (const path of refused) expect([path, allowedWhileViewingAs(parseRoute(path))]).toEqual([path, false]);
  });

  for (const path of ["/profile", "/pricing", "/design"]) {
    it(`draws "not available" at ${path}`, async () => {
      session.user = READER;
      await show(path);
      expect(notAvailable()?.textContent).toBe("Not available while viewing as another reader.");
    });
  }

  it("draws it for the administrator's own pages too, rather than the page", async () => {
    session.user = ADMIN;
    await show("/admin/users");
    expect(notAvailable()).not.toBeNull();
    expect(calls.some((c) => c.url.startsWith("/api/admin/users"))).toBe(false);
  });

  it("draws the shelf, asking for neither the plan nor the topics, and writing nothing", async () => {
    session.user = ADMIN;
    await show("/");
    expect(notAvailable()).toBeNull();
    expect(host.querySelector("h1")?.textContent).toBe("Spideryarn");
    expect(host.querySelector('[data-testid="hidden-while-viewing-as"]')?.textContent).toBe(
      "Their plan: hidden while viewing as another reader.",
    );
    const asked = calls.map((c) => `${c.method} ${c.url}`);
    expect(asked.some((c) => c.includes("/api/billing/usage"))).toBe(false);
    expect(asked.some((c) => c.includes("/api/library/terms"))).toBe(false);
    expect(asked.some((c) => c.includes("/api/jobs"))).toBe(false);
    expect(calls.filter((c) => c.method !== "GET")).toEqual([]);
    /* Every request it did make carried the nonce. */
    for (const c of calls) expect(c.headers.get("X-Spideryarn-View-As")).toBe(NONCE);
    /* No Feedback button: no host is mounted in this tab. */
    expect(button("Feedback")).toBeUndefined();
  });
});

describe("the bar", () => {
  it("is drawn before the server has said whose account it is", async () => {
    current = "hang";
    await bar();
    expect(theBar()?.textContent).toContain("Viewing as another reader");
    expect(theBar()?.textContent).toContain("read-only");
    expect(theBar()?.textContent).toContain("Checking whose account this is…");
  });

  it("names the subject and the minutes left by the server's clock", async () => {
    await bar();
    expect(theBar()?.textContent).toContain("Viewing as alice@example.test");
    expect(theBar()?.textContent).toContain("27 min left");
    const asked = calls.find((c) => c.url === "/api/admin/view-as/current");
    expect(asked?.headers.get("X-Spideryarn-View-As")).toBe(NONCE);
  });

  it("keeps the server expiry when Auth cannot supply the subject's email", async () => {
    current = {
      status: 200,
      body: { subjectId: SUBJECT, subjectEmail: null, expiresAt: new Date(Date.now() + 100).toISOString() },
    };
    await bar();
    expect(theBar()?.textContent).toContain(SUBJECT);
    await act(async () => new Promise((resolve) => setTimeout(resolve, 120)));
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("counts the last minute as one, and never below zero", () => {
    expect(minutesLeft(1_000 + 30_000, 1_000)).toBe(1);
    expect(minutesLeft(1_000, 5_000)).toBe(0);
    expect(minutesLeft(30 * 60_000, 0)).toBe(30);
  });

  it("ends the tab when Stop lands", async () => {
    await bar();
    await act(async () => button("Stop")!.click());
    await settle();
    expect(calls.some((c) => c.method === "POST" && c.url === "/api/admin/view-as/end")).toBe(true);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("keeps everything and offers Retry when Stop cannot reach the server", async () => {
    stopWith = "network";
    await bar();
    await act(async () => button("Stop")!.click());
    await settle();
    expect(close).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    expect(viewAsNonce()).toBe(NONCE);
    expect(theBar()?.textContent).toContain("Stop did not go through.");
    expect(button("Retry")).toBeDefined();
    stopWith = "ok";
    await act(async () => button("Retry")!.click());
    await settle();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("ends the tab when /current says the view has ended", async () => {
    current = { status: 410, body: { error: "This view has ended. [view-as-ended]" } };
    await bar();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("ends the tab when the server's expiry has already passed", async () => {
    current = {
      status: 200,
      body: { subjectId: SUBJECT, subjectEmail: "alice@example.test", expiresAt: new Date(Date.now() - 1).toISOString() },
    };
    await bar();
    expect(close).toHaveBeenCalledTimes(1);
  });
});

describe("the subject page waits for the session check", () => {
  it("does not ask for or draw the subject's shelf while the first /current hangs", async () => {
    current = "hang";
    session.user = ADMIN;
    await show("/");

    expect(calls.some((call) => call.url.startsWith("/api/library"))).toBe(false);
    expect(host.textContent).toContain("Checking whose account this is");
  });
});
