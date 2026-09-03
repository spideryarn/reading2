// @vitest-environment jsdom
/**
 * **`/asdf` reaches the 404 page, asserted by mounting the real `App`** — the
 * exact thing Greg reported, at the level it actually happens.
 *
 * tests/router.test.ts says `/asdf` parses to `{ kind: "not-found" }`, and
 * tests/not-found-page.test.tsx says the component draws the sentence and the
 * link. **Neither of them touches the wire between the two**, and that wire is
 * the whole feature: the signed-out gate in App.tsx answers nearly every
 * address with `LandingPage`, and the 404 page is an exception written *above*
 * that line. Change one `if` and Greg's original bug is back — the homepage at
 * a nonsense address — with both other files still green. GPT Sol asked for
 * this file by naming that mutation, 2026-09-03.
 *
 * Same shape and same reasoning as tests/feedback-button-visibility.test.tsx,
 * which exists because *that* rule is positional too.
 *
 * **The signed-out case is the one that matters** and the signed-in case is
 * not padding: the two branches are separate lines in a different half of the
 * file, and `signedIn` is passed by hand on each. A stranger offered *"Go to
 * your shelf"* would be a promise the click cannot keep.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NuqsAdapter } from "nuqs/adapters/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NOT_FOUND_HEADING, NOT_FOUND_TO_HOME, NOT_FOUND_TO_SHELF } from "../src/messages.js";

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

/* Nothing on this page fetches anything — that is one of its properties — but
   the control case below draws the shelf, which does. An empty list is enough. */
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

const text = () => host.textContent ?? "";

beforeEach(() => {
  session.user = null;
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("an address nobody minted, through the whole app", () => {
  it("shows a stranger the 404 page rather than the landing page", async () => {
    await show("/asdf");
    expect(text()).toContain(NOT_FOUND_HEADING);
    expect(text()).toContain(NOT_FOUND_TO_HOME);
    expect(text()).not.toContain(NOT_FOUND_TO_SHELF);
  });

  it("shows a signed-in reader the 404 page rather than their shelf", async () => {
    session.user = { id: "11111111-1111-4000-8000-000000000001", email: "reader@example.test" };
    await show("/read/example/nonsense");
    expect(text()).toContain(NOT_FOUND_HEADING);
    expect(text()).toContain(NOT_FOUND_TO_SHELF);
  });

  /**
   * **The control, and this file is worth little without it.**
   *
   * Every assertion above is satisfied by an app that renders the 404 page at
   * *every* address — including a build where the route table had been deleted
   * altogether. The root has to still be the front door.
   * docs/reusable/silent-success.md.
   */
  it("still shows the front door at the root", async () => {
    await show("/");
    expect(text()).not.toContain(NOT_FOUND_HEADING);
  });
});
