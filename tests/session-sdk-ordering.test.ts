import { GoTrueClient, type AuthChangeEvent, type Session } from "@supabase/auth-js";
import { afterEach, expect, it, vi } from "vitest";

const sessionOf = (id: string): Session => ({
  access_token: `TOKEN-${id}`, refresh_token: `REFRESH-${id}`, token_type: "bearer",
  expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id, aud: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "" },
});

let client: GoTrueClient;
afterEach(() => {
  client.stopAutoRefresh();
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function setup() {
  let stored = JSON.stringify(sessionOf("A"));
  let holdRead: (() => Promise<string>) | null = null;
  let refresh: (() => Promise<Response>) | null = null;
  client = new GoTrueClient({
    url: "https://auth.example.test", storageKey: "reader-ordering",
    autoRefreshToken: false, detectSessionInUrl: false, persistSession: true,
    fetch: () => { if (!refresh) throw new Error("Unexpected auth fetch"); return refresh(); },
    storage: {
      getItem: () => holdRead ? holdRead() : stored,
      setItem: (_key, value) => { stored = value; }, removeItem: () => { stored = "null"; },
    },
  });
  await client.initialize();
  const expireAndHoldRefresh = () => {
    stored = JSON.stringify({ ...sessionOf("A"), expires_at: Math.floor(Date.now() / 1000) - 1 });
    let start!: () => void;
    let answer!: () => void;
    const started = new Promise<void>((resolve) => { start = resolve; });
    refresh = () => {
      start();
      return new Promise<Response>((resolve) => { answer = () => resolve(new Response(
        JSON.stringify(sessionOf("A")), { headers: { "content-type": "application/json" } },
      )); });
    };
    return { started, answer: () => answer(), becomeB: () => { stored = JSON.stringify(sessionOf("B")); } };
  };
  vi.doMock("../src/web/lib/supabase.js", () => ({ supabase: { auth: client } }));
  const deferRead = (id: string) => {
    stored = JSON.stringify(sessionOf(id));
    let start!: () => void;
    let answer!: () => void;
    const started = new Promise<void>((resolve) => { start = resolve; });
    holdRead = () => {
      holdRead = null;
      const snapshot = stored;
      start();
      return new Promise<string>((resolve) => { answer = () => resolve(snapshot); });
    };
    return { started, answer: () => answer() };
  };
  // This is the installed SDK's incoming BroadcastChannel handler's call.
  const broadcast = (event: AuthChangeEvent, session: Session | null) =>
    (client as unknown as {
      _notifyAllSubscribers(event: AuthChangeEvent, session: Session | null, broadcast: boolean): Promise<void>;
    })._notifyAllSubscribers(event, session, false);
  return { deferRead, broadcast, expireAndHoldRefresh };
}

it("a discarded initial refresh with synchronous browser-style storage cannot sign out the newer reader", async () => {
  const { expireAndHoldRefresh, broadcast } = await setup();
  const read = expireAndHoldRefresh();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const { heldReader } = await import("../src/web/lib/session.js");
  await read.started;
  read.becomeB();
  await broadcast("SIGNED_IN", sessionOf("B"));
  expect(heldReader()).toBe("B");
  read.answer();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(heldReader()).toBe("B");
});

it("a delayed SDK INITIAL_SESSION does not replace a newer cross-tab event", async () => {
  const { deferRead, broadcast } = await setup();
  const read = deferRead("A");
  const { heldReader } = await import("../src/web/lib/session.js");
  await read.started;
  await broadcast("SIGNED_IN", sessionOf("B"));
  expect(heldReader()).toBe("B");
  read.answer();
  await client.getSession();
  expect(heldReader()).toBe("B");
});

it("an SDK lookup overtaken by sign-out and sign-in of the same reader cannot adopt its old snapshot", async () => {
  const { deferRead, broadcast } = await setup();
  const { heldReader, onSession } = await import("../src/web/lib/session.js");
  await new Promise<void>((resolve) => {
    const stop = onSession(() => { resolve(); queueMicrotask(() => stop()); });
  });
  const { apiFetch } = await import("../src/web/lib/api.js");
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
  const read = deferRead("B");
  const request = apiFetch("/api/reader").catch((error: Error) => error.name);
  await read.started;
  await broadcast("SIGNED_OUT", null);
  await broadcast("SIGNED_IN", sessionOf("A"));
  read.answer();
  expect(await request).toBe("NotThisReader");
  expect(heldReader()).toBe("A");
  expect(fetch).not.toHaveBeenCalled();
});
