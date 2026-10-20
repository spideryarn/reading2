/**
 * **A thread list that still says `tutorial` is read as Recall** — a body this
 * browser cached before Tutorial was folded into Recall (2026-10-20), or one
 * from a server mid-deploy. With both in the list, Recall's thread wins.
 * src/web/chat/retired-kinds.ts; GPT Sol's F5 on
 * docs/plans/261020m-recall-and-tutorial-become-one-recall.md.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { withRetiredKinds } from "../src/web/chat/retired-kinds.js";

vi.mock("../src/web/lib/supabase.js", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { access_token: "T" } } }),
      refreshSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
  callbackUrl: () => "https://spideryarn.test/auth/callback",
  CALLBACK_PATH: "/auth/callback",
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

const { askForThreads } = await import("../src/web/chat/effects.js");

const thread = (id: string, kind: string) => ({
  id,
  kind,
  title: id,
  createdAt: "2026-10-01T10:00:00.000Z",
  updatedAt: "2026-10-01T10:00:00.000Z",
  messages: [],
});

describe("withRetiredKinds", () => {
  it("reads a Tutorial thread as Recall when there is no Recall thread", () => {
    const out = withRetiredKinds([thread("spya-tuaa05", "tutorial"), thread("spya-chat05", "chat")]);
    expect(out.map((t) => [t.id, t.kind])).toEqual([
      ["spya-tuaa05", "learn"],
      ["spya-chat05", "chat"],
    ]);
  });

  it("leaves the Tutorial thread out when there is a Recall thread, whichever comes first", () => {
    for (const list of [
      [thread("spya-tuaa05", "tutorial"), thread("spya-rcaa05", "learn")],
      [thread("spya-rcaa05", "learn"), thread("spya-tuaa05", "tutorial")],
    ]) {
      expect(withRetiredKinds(list).map((t) => [t.id, t.kind])).toEqual([["spya-rcaa05", "learn"]]);
    }
  });

  it("returns a list with no retired kind as it was", () => {
    const list = [thread("spya-rcaa05", "learn"), thread("spya-xpaa05", "explore")];
    expect(withRetiredKinds(list)).toEqual(list);
  });
});

describe("askForThreads", () => {
  beforeEach(() => {
    vi.stubGlobal("navigator", { onLine: true });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("hands the panel no `tutorial` kind, whatever the body said", async () => {
    vi.stubGlobal("fetch", async () =>
      Response.json({ threads: [thread("spya-tuaa05", "tutorial"), thread("spya-rcaa05", "learn")] }),
    );
    const outcome = await askForThreads("a-slug");
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.threads.map((t) => [t.id, t.kind])).toEqual([["spya-rcaa05", "learn"]]);
  });
});
