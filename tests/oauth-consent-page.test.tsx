// @vitest-environment jsdom
/**
 * **The consent page an AI app's sign-in passes through** — `/oauth/consent`,
 * stage 1 item 3 of docs/plans/261007p-mcp-remote-sign-in-with-oauth.md.
 *
 * Supabase's OAuth server sends the browser here with `?authorization_id=…`.
 * The page asks Supabase what the request is, shows who is asking and as whom,
 * and turns Allow and Deny into Supabase's approve and deny. Supabase is faked:
 * these are the page's decisions, not Supabase's.
 *
 * And the half that is App.tsx's: a stranger is sent to sign in and comes back
 * here **with the id**, which is the whole request — lose it and the sign-in
 * Claude started can never finish.
 */
import { act, createElement, StrictMode, useSyncExternalStore } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NuqsAdapter } from "nuqs/adapters/react";
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type SessionState = {
  session: { access_token: string } | null;
  user: { id: string; email: string } | null;
  loading: boolean;
  known: boolean;
};
let state: SessionState = { session: null, user: null, loading: false, known: true };
const listeners = new Set<() => void>();
function setState(next: SessionState) {
  state = next;
  for (const l of listeners) l();
}

vi.mock("../src/web/useSession.js", () => ({
  useSession: () =>
    useSyncExternalStore(
      (l) => {
        listeners.add(l);
        return () => listeners.delete(l);
      },
      () => state,
    ),
}));

const oauth = {
  getAuthorizationDetails: vi.fn(),
  approveAuthorization: vi.fn(),
  denyAuthorization: vi.fn(),
};

vi.mock("../src/web/lib/supabase.js", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { access_token: "t" } } }),
      refreshSession: async () => ({ data: { session: { access_token: "t" } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      oauth,
    },
  },
  urlSessionKind: async () => "sign-in",
  arrivedWithCode: () => false,
  forgetCodeArrival: () => {},
  googleSignInAvailable: async () => true,
  CALLBACK_PATH: "/auth/callback",
  callbackUrl: () => "https://spideryarn.test/auth/callback",
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

const { App } = await import("../src/web/App.js");
const { OAuthConsentPage, CONSENT_WHAT_IT_CAN_DO } = await import("../src/web/OAuthConsentPage.js");
const { rememberReturn, loginNext } = await import("../src/web/auth-return.js");
const { parseRoute } = await import("../src/web/router.js");

const READER = {
  session: { access_token: "t" },
  user: { id: "11111111-1111-4000-8000-000000000001", email: "reader@example.test" },
  loading: false,
  known: true,
};

const DETAILS = {
  authorization_id: "auth-123",
  redirect_uri: "https://claude.ai/api/mcp/auth_callback",
  client: { id: "c1", name: "Claude", uri: "", logo_uri: "" },
  user: { id: READER.user.id, email: "greg@example.test" },
  scope: "openid email profile",
};

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  sessionStorage.clear();
  state = { session: null, user: null, loading: false, known: true };
  oauth.getAuthorizationDetails.mockReset();
  oauth.approveAuthorization.mockReset();
  oauth.denyAuthorization.mockReset();
  vi.stubGlobal(
    "fetch",
    async () => new Response("[]", { status: 200, headers: { "content-type": "application/json" } }),
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await act(async () => {
      await new Promise((go) => setTimeout(go, 0));
    });
  }
}

async function mountPage(address: string, leave = vi.fn()): Promise<typeof leave> {
  history.replaceState(null, "", address);
  await act(async () => {
    root.render(createElement(OAuthConsentPage, { leave }));
  });
  await settle();
  return leave;
}

function button(name: RegExp): HTMLButtonElement {
  const found = [...host.querySelectorAll("button")].find((b) => name.test(b.textContent ?? ""));
  if (!found) throw new Error(`no button matching ${name}: ${host.textContent}`);
  return found;
}

describe("the route", () => {
  it("is its own page, with and without a trailing slash", () => {
    expect(parseRoute("/oauth/consent").kind).toBe("oauth-consent");
    expect(parseRoute("/oauth/consent/").kind).toBe("oauth-consent");
    expect(parseRoute("/oauth/other").kind).toBe("not-found");
  });
});

describe("signed out", () => {
  it("sends a stranger to sign in, and the authorization id survives the round trip", async () => {
    history.replaceState(null, "", "/oauth/consent?authorization_id=auth-123");
    await act(async () => {
      root.render(createElement(StrictMode, null, createElement(NuqsAdapter, null, createElement(App, null))));
    });
    await settle();
    expect(`${location.pathname}${location.search}`).toBe("/login?next=%2Foauth%2Fconsent%3Fauthorization_id%3Dauth-123");
    /* The sign-in page accepts it as somewhere to go back to. */
    const next = loginNext(location.search, "/auth/callback");
    expect(next).toBe("/oauth/consent?authorization_id=auth-123");
    /* What SignInControls does on submit (tests/sign-in-controls.test.tsx pins it). */
    rememberReturn(next as string);
    oauth.getAuthorizationDetails.mockResolvedValue({ data: DETAILS, error: null });
    await act(async () => setState(READER));
    await settle();
    expect(location.pathname).toBe("/oauth/consent");
    expect(new URLSearchParams(location.search).get("authorization_id")).toBe("auth-123");
    expect(oauth.getAuthorizationDetails).toHaveBeenCalledWith("auth-123");
  });
});

describe("the consent page", () => {
  it("loads the new request on same-page history navigation without a forced render", async () => {
    oauth.getAuthorizationDetails.mockResolvedValue({ data: DETAILS, error: null });
    await mountPage("/oauth/consent?authorization_id=auth-123");
    oauth.getAuthorizationDetails.mockResolvedValueOnce({
      data: { ...DETAILS, authorization_id: "auth-456", user: { ...DETAILS.user, email: "next@example.test" } },
      error: null,
    });
    await act(async () => {
      history.replaceState(null, "", "/oauth/consent?authorization_id=auth-456");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await settle();
    expect(oauth.getAuthorizationDetails).toHaveBeenCalledWith("auth-456");
    expect(host.textContent).toContain("next@example.test");
    expect(host.textContent).not.toContain(DETAILS.user.email);
  });

  it("shows who is asking, where it sends you, as whom, and what it may do", async () => {
    oauth.getAuthorizationDetails.mockResolvedValue({ data: DETAILS, error: null });
    await mountPage("/oauth/consent?authorization_id=auth-123");
    expect(oauth.getAuthorizationDetails).toHaveBeenCalledWith("auth-123");
    const text = host.textContent ?? "";
    expect(text).toContain("Claude");
    expect(text).toMatch(/calls itself/i);
    expect(text).toContain("claude.ai");
    expect(text).toContain("greg@example.test");
    expect(text).toContain(CONSENT_WHAT_IT_CAN_DO);
    expect(CONSENT_WHAT_IT_CAN_DO).toBe(
      "It will be able to do what you can do on Spideryarn through its tools: read and organise your " +
        "shelf, import articles, and, as the administrator, look up readers and gift vouchers. These tools cannot " +
        "send email, publish, or hand over a private link: those need you, in the Mac app or on the site.",
    );
  });

  it("shows the whole host, not a name that could be shortened into a lie", async () => {
    oauth.getAuthorizationDetails.mockResolvedValue({
      data: { ...DETAILS, redirect_uri: "https://claude.ai.attacker.example/cb" },
      error: null,
    });
    await mountPage("/oauth/consent?authorization_id=auth-123");
    expect(host.textContent).toContain("claude.ai.attacker.example");
  });

  it("explains that the sign-in it hands over could also change account settings, the password included", async () => {
    oauth.getAuthorizationDetails.mockResolvedValue({ data: DETAILS, error: null });
    await mountPage("/oauth/consent?authorization_id=auth-123");
    /* In plain words (Greg reads this page, not a Supabase engineer): the app
       holds a sign-in, and that sign-in reaches past the tools. */
    expect(host.textContent).toContain("could also change your account settings, such as your password");
    expect(host.textContent).toContain("These tools cannot");
  });

  it("goes straight on when Supabase says it was already agreed", async () => {
    oauth.getAuthorizationDetails.mockResolvedValue({
      data: { redirect_url: "https://claude.ai/api/mcp/auth_callback?code=x&state=y" },
      error: null,
    });
    const leave = await mountPage("/oauth/consent?authorization_id=auth-123");
    expect(leave).toHaveBeenCalledWith("https://claude.ai/api/mcp/auth_callback?code=x&state=y");
  });

  it("does not follow old authorization details after the address has changed", async () => {
    let finish!: (answer: unknown) => void;
    oauth.getAuthorizationDetails.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const leave = await mountPage("/oauth/consent?authorization_id=auth-123");
    // History can change before React renders and cleans up the old effect.
    history.replaceState(null, "", "/oauth/consent?authorization_id=auth-456");
    await act(async () => finish({ data: { redirect_url: "https://claude.ai/callback?code=old" }, error: null }));
    expect(leave).not.toHaveBeenCalled();
  });

  it("Allow approves and follows the answer", async () => {
    oauth.getAuthorizationDetails.mockResolvedValue({ data: DETAILS, error: null });
    oauth.approveAuthorization.mockResolvedValue({
      data: { redirect_url: "https://claude.ai/api/mcp/auth_callback?code=ok" },
      error: null,
    });
    const leave = await mountPage("/oauth/consent?authorization_id=auth-123");
    await act(async () => button(/^allow$/i).click());
    await settle();
    expect(oauth.approveAuthorization).toHaveBeenCalledWith("auth-123", { skipBrowserRedirect: true });
    expect(oauth.denyAuthorization).not.toHaveBeenCalled();
    expect(leave).toHaveBeenCalledWith("https://claude.ai/api/mcp/auth_callback?code=ok");
  });

  it("cannot approve a new authorization id using the previous request's details", async () => {
    oauth.getAuthorizationDetails.mockResolvedValueOnce({ data: DETAILS, error: null });
    const leave = await mountPage("/oauth/consent?authorization_id=auth-123");
    const oldAllow = button(/^allow$/i);
    oauth.getAuthorizationDetails.mockImplementationOnce(() => new Promise(() => {}));
    history.replaceState(null, "", "/oauth/consent?authorization_id=auth-456");
    await act(async () => root.render(createElement(OAuthConsentPage, { leave })));
    await act(async () => oldAllow.click());
    expect(oauth.approveAuthorization).not.toHaveBeenCalled();
    expect(host.textContent).not.toContain(DETAILS.user.email);
    expect(host.querySelector("button")).toBeNull();
  });

  it("does not follow an approval that finishes after navigating to another request", async () => {
    oauth.getAuthorizationDetails.mockResolvedValue({ data: DETAILS, error: null });
    let finish!: (answer: unknown) => void;
    oauth.approveAuthorization.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const leave = await mountPage("/oauth/consent?authorization_id=auth-123");
    await act(async () => button(/^allow$/i).click());
    history.replaceState(null, "", "/oauth/consent?authorization_id=auth-456");
    oauth.getAuthorizationDetails.mockImplementationOnce(() => new Promise(() => {}));
    await act(async () => root.render(createElement(OAuthConsentPage, { leave })));
    await act(async () => finish({ data: { redirect_url: "https://claude.ai/callback?code=old" }, error: null }));
    expect(leave).not.toHaveBeenCalled();
  });

  it("removes the old consent buttons when the new address has no request id", async () => {
    oauth.getAuthorizationDetails.mockResolvedValueOnce({ data: DETAILS, error: null });
    const leave = await mountPage("/oauth/consent?authorization_id=auth-123");
    history.replaceState(null, "", "/oauth/consent");
    await act(async () => root.render(createElement(OAuthConsentPage, { leave })));
    expect(host.querySelector("button")).toBeNull();
    expect(host.textContent).toContain("[oauth-no-request]");
  });

  it("Deny denies and follows the answer", async () => {
    oauth.getAuthorizationDetails.mockResolvedValue({ data: DETAILS, error: null });
    oauth.denyAuthorization.mockResolvedValue({
      data: { redirect_url: "https://claude.ai/api/mcp/auth_callback?error=access_denied" },
      error: null,
    });
    const leave = await mountPage("/oauth/consent?authorization_id=auth-123");
    await act(async () => button(/^deny$/i).click());
    await settle();
    expect(oauth.denyAuthorization).toHaveBeenCalledWith("auth-123", { skipBrowserRedirect: true });
    expect(oauth.approveAuthorization).not.toHaveBeenCalled();
    expect(leave).toHaveBeenCalledWith("https://claude.ai/api/mcp/auth_callback?error=access_denied");
  });

  it("says so when there is no request in the address, and asks Supabase nothing", async () => {
    await mountPage("/oauth/consent");
    expect(oauth.getAuthorizationDetails).not.toHaveBeenCalled();
    expect(host.textContent).toMatch(/\[oauth-no-request\]/);
    expect(host.querySelector("button")).toBeNull();
  });

  it("says so when Supabase refuses, and offers no button", async () => {
    oauth.getAuthorizationDetails.mockResolvedValue({ data: null, error: { message: "supabase-said-this" } });
    await mountPage("/oauth/consent?authorization_id=auth-123");
    expect(host.textContent).toMatch(/\[oauth-failed\]/);
    /* Supabase's own words are not ours to show. */
    expect(host.textContent).not.toContain("supabase-said-this");
    expect(host.querySelector("button")).toBeNull();
  });

  it("does not follow a redirect that is not a web address", async () => {
    oauth.getAuthorizationDetails.mockResolvedValue({ data: { redirect_url: "javascript:alert(1)" }, error: null });
    const leave = await mountPage("/oauth/consent?authorization_id=auth-123");
    expect(leave).not.toHaveBeenCalled();
    expect(host.textContent).toMatch(/\[oauth-failed\]/);
  });

  it("says so when Allow fails, and goes nowhere", async () => {
    oauth.getAuthorizationDetails.mockResolvedValue({ data: DETAILS, error: null });
    oauth.approveAuthorization.mockResolvedValue({ data: null, error: { message: "nope" } });
    const leave = await mountPage("/oauth/consent?authorization_id=auth-123");
    await act(async () => button(/^allow$/i).click());
    await settle();
    expect(leave).not.toHaveBeenCalled();
    expect(host.textContent).toMatch(/\[oauth-failed\]/);
  });
});
