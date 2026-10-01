// @vitest-environment jsdom
/**
 * **The landing page signposts the sign-in page rather than carrying a form** —
 * Greg's report spya-p6s5a4, docs/plans/261001m.
 *
 * The case worth mounting is the deep link. Signed out, `App.tsx` answers an
 * unshared `/read/<slug>` (and `/add/…`, `/profile`) with this page, and the
 * address bar holding that path used to be what brought the reader back to it.
 * With the form on another page, every link to it has to carry the path, or a
 * stranger following a friend's link signs in and lands on an empty shelf —
 * which works, and looks like nothing is wrong.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
/* `apiFetch` reaches for IndexedDB; same import and reason as
   tests/site-nav-sign-in.test.tsx. */
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/web/lib/supabase.js", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: null } }),
      refreshSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
  googleSignInAvailable: async () => true,
  callbackUrl: () => "https://spideryarn.test/auth/callback",
  CALLBACK_PATH: "/auth/callback",
}));

const { LandingPage } = await import("../src/web/LandingPage.js");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("fetch", async () => new Response("nope", { status: 404 }));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function showAt(address: string): Promise<HTMLElement> {
  history.replaceState(null, "", address);
  await act(async () => {
    root.render(<LandingPage />);
  });
  for (let i = 0; i < 3; i++) {
    await act(async () => {
      await new Promise((go) => setTimeout(go, 0));
    });
  }
  return host;
}

function hrefOf(page: HTMLElement, text: string): string | null {
  const link = [...page.querySelectorAll("a")].find((a) => a.textContent?.trim() === text);
  return link?.getAttribute("href") ?? null;
}

describe("the landing page", () => {
  it("has no sign-in form of its own", async () => {
    const page = await showAt("/");
    expect(page.querySelector('input[type="password"]')).toBeNull();
    expect(page.querySelector('input[type="email"]')).toBeNull();
  });

  it("sends a stranger at / to the sign-in page, and the hero to Create account", async () => {
    const page = await showAt("/");
    expect(hrefOf(page, "Sign in")).toBe("/login");
    expect(hrefOf(page, "Start reading")).toBe("/login?new");
    expect(hrefOf(page, "Create an account")).toBe("/login?new");
  });

  it("keeps one orange primary action on the page", async () => {
    const page = await showAt("/");
    expect(page.querySelectorAll(".site-cta-primary")).toHaveLength(1);
  });

  it("carries a deep link through every one of those links", async () => {
    const page = await showAt("/read/an-unshared-essay?at=spya-k3m9qt");
    const next = "next=%2Fread%2Fan-unshared-essay%3Fat%3Dspya-k3m9qt";
    expect(hrefOf(page, "Sign in")).toBe(`/login?${next}`);
    expect(hrefOf(page, "Start reading")).toBe(`/login?new&${next}`);
    expect(hrefOf(page, "Create an account")).toBe(`/login?new&${next}`);
    /* The foot of the page has its own Sign in as well as the top bar's. */
    const signIns = [...page.querySelectorAll("a")].filter(
      (a) => a.textContent?.trim() === "Sign in",
    );
    expect(signIns.length).toBeGreaterThanOrEqual(2);
    for (const a of signIns) expect(a.getAttribute("href")).toBe(`/login?${next}`);
  });
});
