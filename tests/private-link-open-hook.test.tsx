// @vitest-environment jsdom
/**
 * **A visitor's page says a private link was opened, once, and only then** —
 * `usePrivateLinkOpen`, plan 261021d § 3 (Greg's 2C, reply `spya-xug3kf` to
 * q-agbc89).
 *
 * - signed in and confirmed: one POST to the authenticated route, with the key;
 * - signed out: one credential-less POST to the public write;
 * - session unconfirmed, a public article, or no key: nothing at all — so the
 *   visitor tests' *a signed-out browser issues no POST* still holds on a
 *   public article;
 * - StrictMode's double effect, a re-render, and a remount of the same visit
 *   (the gift-claim re-read does that): still one.
 */
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

const { usePrivateLinkOpen, forgetNotedPrivateLinkOpen } = await import("../src/web/usePrivateLinkOpen.js");
const { parseShareKey } = await import("../src/share-key.js");

const SLUG = "a-piece-spya-k3m9qt";
const KEY = parseShareKey("abcdefghijklmnopqrstuv");
const READER = "00000000-0000-4000-8000-0000000ce1f1";

const calls: { url: string; init: RequestInit | undefined }[] = [];
let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  calls.length = 0;
  forgetNotedPrivateLinkOpen();
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response(null, { status: 204 });
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

function Probe(props: {
  sharedBy: "public" | "link";
  shareKey: typeof KEY;
  readerId: string | null;
  sessionUnconfirmed: boolean;
  tick?: number;
}) {
  usePrivateLinkOpen(SLUG, props.sharedBy, props.shareKey, props.readerId, props.sessionUnconfirmed);
  return null;
}

async function mount(props: Parameters<typeof Probe>[0]): Promise<void> {
  await act(async () => {
    root.render(createElement(StrictMode, null, createElement(Probe, props)));
  });
  for (let i = 0; i < 3; i++) await act(async () => new Promise((go) => setTimeout(go, 0)));
}

describe("usePrivateLinkOpen", () => {
  it("sends one credential-less POST to the public write for a signed-out visitor", async () => {
    await mount({ sharedBy: "link", shareKey: KEY, readerId: null, sessionUnconfirmed: false });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`/api/public/private-link-opened/${SLUG}?key=${KEY}`);
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.credentials).toBe("omit");
  });

  it("sends one authenticated POST, with the key, for a confirmed signed-in visitor", async () => {
    await mount({ sharedBy: "link", shareKey: KEY, readerId: READER, sessionUnconfirmed: false });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`/api/private-link-opens/${SLUG}?key=${KEY}`);
    expect(calls[0]?.init?.method).toBe("POST");
    expect(new Headers(calls[0]?.init?.headers).get("Authorization")).toBe("Bearer t");
  });

  it.each([
    ["a public article", { sharedBy: "public" as const, shareKey: KEY, readerId: null, sessionUnconfirmed: false }],
    ["a public article, signed in", { sharedBy: "public" as const, shareKey: KEY, readerId: READER, sessionUnconfirmed: false }],
    ["no key in the address", { sharedBy: "link" as const, shareKey: null, readerId: null, sessionUnconfirmed: false }],
    ["an unconfirmed session", { sharedBy: "link" as const, shareKey: KEY, readerId: READER, sessionUnconfirmed: true }],
  ])("sends nothing for %s", async (_label, props) => {
    await mount(props);
    expect(calls).toEqual([]);
  });

  it("still sends once when the page re-renders", async () => {
    await mount({ sharedBy: "link", shareKey: KEY, readerId: null, sessionUnconfirmed: false, tick: 1 });
    await mount({ sharedBy: "link", shareKey: KEY, readerId: null, sessionUnconfirmed: false, tick: 2 });
    expect(calls).toHaveLength(1);
  });

  it("still sends once when the page is unmounted and mounted again for the same visit", async () => {
    const props = { sharedBy: "link" as const, shareKey: KEY, readerId: READER, sessionUnconfirmed: false };
    await mount(props);
    await act(async () => root.unmount());
    root = createRoot(host);
    await mount(props);
    expect(calls).toHaveLength(1);
  });

  it("sends again for a different reader, or a new page load", async () => {
    await mount({ sharedBy: "link", shareKey: KEY, readerId: null, sessionUnconfirmed: false });
    await mount({ sharedBy: "link", shareKey: KEY, readerId: READER, sessionUnconfirmed: false });
    forgetNotedPrivateLinkOpen();
    await act(async () => root.unmount());
    root = createRoot(host);
    await mount({ sharedBy: "link", shareKey: KEY, readerId: READER, sessionUnconfirmed: false });
    expect(calls).toHaveLength(3);
  });
});
