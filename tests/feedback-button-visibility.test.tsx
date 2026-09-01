// @vitest-environment jsdom
/**
 * **Who gets a Feedback button, asserted by mounting the real `App`.**
 *
 * The rule is one line in App.tsx — the button is rendered below the signed-in
 * gate — and the reason it is worth a test that boots the whole router is that
 * the rule is *positional*. It is not a condition anybody could read off the
 * component; it is where the element sits relative to `if (!user)`, and a
 * refactor that moves the mount point breaks it without touching a single
 * expression. Rendering `FeedbackButton` directly would prove nothing about
 * that, in the same way that passing a prop by hand proved nothing about the
 * sharing card (tests/metadata-sharing-card.test.tsx has that story).
 *
 * **This is half of a rule, and it says so.** A button the client does not draw
 * is not a gate: anyone can open a console and post. The other half —
 * `POST /api/feedback` answering an anonymous request with 401 — is in
 * tests/feedback-route.test.ts, and neither test is evidence without the other.
 * GPT Sol asked for both, 2026-08-31.
 *
 * The **signed-in** case is the control. Without it, this file would pass just
 * as happily if `FeedbackButton` had been deleted, or if `App` had thrown before
 * reaching any of it — which is the failure docs/reusable/silent-success.md is
 * about, and the one an "absence" assertion is most prone to.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NuqsAdapter } from "nuqs/adapters/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

/* The shelf fetches its own list on mount. An empty one is enough: this file is
   about a fixed button in the corner, which does not care what is on the shelf. */
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = String(typeof input === "string" ? input : input instanceof URL ? input : input.url);
  const body = url.startsWith("/api/library") ? "[]" : "{}";
  return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { App } = await import("../src/web/App.js");

let host: HTMLDivElement;
let root: Root;

async function show(path = "/") {
  history.replaceState(null, "", path);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root.render(createElement(NuqsAdapter, null, createElement(App, null)));
  });
}

beforeEach(() => {
  session.user = null;
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("the Feedback button", () => {
  it("is not drawn for a reader who is not signed in", async () => {
    await show("/");
    expect(document.querySelector(".fb-button")).toBeNull();
  });

  /**
   * **The route that actually matters for the absence half.**
   *
   * `/read/<slug>` is the one address an anonymous person can be at and still be
   * shown a real page — an owner can mark a document world-readable, so the
   * signed-out gate lets this address through where it turns every other one
   * into the landing page (App.tsx has that story). Testing only `/` would have
   * passed just as well if the button had been mounted on the reading view and
   * nowhere else, which is the wrong shape and the likelier mistake.
   * GPT Sol, 2026-09-01.
   */
  it("is not drawn for an anonymous reader on a shared article", async () => {
    await show("/read/a-piece");
    expect(document.querySelector(".fb-button")).toBeNull();
  });

  it("is drawn for a signed-in reader — the control for the assertions above", async () => {
    session.user = { id: "reader-1", email: "reader@example.com" };
    await show("/");
    expect(document.querySelector(".fb-button")).not.toBeNull();
  });

  /* A second signed-in route, so the claim is "every signed-in page" rather than
     "the shelf". `/design` is the cheapest one that is not the shelf: it is the
     only signed-in page that fetches nothing, so this stays a test about where
     the button is mounted rather than about a fixture. */
  it("is drawn on a signed-in page that is not the shelf", async () => {
    session.user = { id: "reader-1", email: "reader@example.com" };
    await show("/design");
    expect(document.querySelector(".fb-button")).not.toBeNull();
  });
});
