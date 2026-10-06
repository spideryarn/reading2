// @vitest-environment jsdom
/**
 * **What one reader typed or was shown is not kept for the next.**
 * docs/plans/261006f-every-request-is-bound-to-the-reader-at-its-start.md § Stage 2;
 * the class is docs/postmortems/261006g-work-made-for-one-reader-outlives-a-change-of-reader.md.
 *
 * Three stores live at module level, keyed by slug, so that they outlive a
 * mode change: the unsent chat words, the search words, and what the link
 * cards know (the shelf, and the summaries written from a reader's profile).
 * The reading view unmounts when another tab signs in as somebody else, and
 * these did not: reader B, on the same slug, got reader A's.
 *
 * `api.ts` is real here, because the claim is about its auth listener: the
 * stores are empty by the time it returns, before React has drawn anything.
 * Only the SDK and `fetch` are stood in.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LinkFacts } from "../src/web/link-facts.js";
import type { LinkPreview } from "../src/web/link-preview.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface FakeSession {
  access_token: string;
  user: { id: string };
}
let signedIn: FakeSession | null = null;
const listeners = new Set<(event: string, session: FakeSession | null) => void>();
const sessionOf = (id: string, token = `TOKEN-${id}`): FakeSession => ({ access_token: token, user: { id } });

vi.mock("../src/web/lib/supabase.js", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: signedIn } }),
      refreshSession: async () => ({ data: { session: signedIn } }),
      onAuthStateChange: (fn: (event: string, session: FakeSession | null) => void) => {
        listeners.add(fn);
        return { data: { subscription: { unsubscribe: () => listeners.delete(fn) } } };
      },
    },
  },
  googleSignInAvailable: false,
  callbackUrl: () => "https://spideryarn.test/auth/callback",
  CALLBACK_PATH: "/auth/callback",
}));

/* `api.js` first: its listener is what tells the stores. */
await import("../src/web/lib/api.js");
const { chatDraftsFor, anyChatDraftHeld } = await import("../src/web/chat-draft.js");
const { searchDraftFor } = await import("../src/web/search-draft.js");
const { useLinkFacts } = await import("../src/web/link-facts.js");

function tell(event: string, session: FakeSession | null): void {
  signedIn = session;
  for (const fn of [...listeners]) fn(event, session);
}

const SLUG = "a-paper";
const ON_A_SHELF = "https://destination.example/on-a-shelf";
const SUMMARISED = "https://destination.example/summarised";
const BLOCK = "spya-aaaaaa";

/** Hold the next `GET /api/library` until the case lets it go. */
let holdShelf = false;
let releaseShelf: (() => void) | null = null;
let shelfReads = 0;
/** The next shelf reads fail, as a server having a moment does. */
let failShelf = false;

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

/** The server: each reader's own shelf, and a summary written for whoever asked. */
async function answer(url: string, init: RequestInit = {}): Promise<Response> {
  const who = new Headers(init.headers).get("Authorization")?.replace("Bearer TOKEN-", "") ?? "nobody";
  const path = url.split("?")[0] ?? url;
  if (path === "/api/library") {
    shelfReads += 1;
    if (failShelf) return new Response("{}", { status: 500 });
    const body = { articles: who === "A" ? [{ slug: "on-a-shelf", title: "On A's shelf", url: ON_A_SHELF }] : [] };
    if (holdShelf) {
      holdShelf = false;
      await new Promise<void>((resolve) => {
        releaseShelf = resolve;
      });
    }
    return json(body);
  }
  if (path === "/api/link-preview") {
    return json({ state: "ready", page: { title: "A page", description: "What the page says." } });
  }
  if (path === "/api/link-summary") {
    return new Response(`event: ready\ndata: ${JSON.stringify({ summary: `Written for ${who}.` })}\n\n`, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  }
  return json({});
}

const aLink = (url: string): LinkPreview => ({
  kind: "external",
  host: "destination.example",
  sameSite: false,
  trail: [],
  file: null,
  citation: null,
  wiki: null,
  url,
});

let host: HTMLDivElement;
let root: Root;
let facts: LinkFacts | null = null;

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 8; i += 1) await new Promise((r) => setTimeout(r, 0));
  });
}

/** Open the card over one link: a fresh mount, as a hover is. */
async function hover(url: string): Promise<LinkFacts> {
  function Probe() {
    facts = useLinkFacts(aLink(url), "https://noema.example/the-piece", SLUG, BLOCK);
    return null;
  }
  await act(async () => root.render(null));
  await act(async () => root.render(createElement(Probe)));
  await settle();
  if (!facts) throw new Error("the card did not draw");
  return facts;
}

beforeEach(() => {
  vi.stubGlobal("fetch", answer);
  holdShelf = false;
  releaseShelf = null;
  shelfReads = 0;
  failShelf = false;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  /* A tab that is already A's, and holds nothing of anybody's. */
  tell("SIGNED_OUT", null);
  tell("SIGNED_IN", sessionOf("A"));
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("when another reader's session arrives", () => {
  it("the unsent chat words are gone before the listener returns", () => {
    chatDraftsFor(SLUG).setList("A's question, half typed");
    chatDraftsFor(SLUG).setLearn("learn", "What A remembers");
    tell("SIGNED_IN", sessionOf("B"));
    expect(chatDraftsFor(SLUG).list()).toBe("");
    expect(chatDraftsFor(SLUG).learn("learn")).toBe("");
    expect(anyChatDraftHeld()).toBe(false);
  });

  it("the search words are gone", () => {
    searchDraftFor(SLUG).set("what A was looking for");
    tell("SIGNED_IN", sessionOf("B"));
    expect(searchDraftFor(SLUG).text()).toBe("");
  });

  it("a link card stops saying it is on the shelf when it was on the last reader's", async () => {
    expect((await hover(ON_A_SHELF)).library?.entry.slug).toBe("on-a-shelf");
    await act(async () => root.render(null));
    tell("SIGNED_IN", sessionOf("B"));
    const forB = await hover(ON_A_SHELF);
    expect(forB.library).toBeNull();
    expect(forB.shelfKnown, "B's own shelf was read, not merely A's dropped").toBe(true);
  });

  it("a shelf read still out for the last reader does not land on the next", async () => {
    holdShelf = true;
    await hover(ON_A_SHELF);
    expect(shelfReads).toBe(1);
    await act(async () => root.render(null));
    tell("SIGNED_IN", sessionOf("B"));
    /* A's answer, sent with A's token, arrives once the tab is B's and before
       B has asked for anything: with nothing newer installed, it would be. */
    releaseShelf?.();
    await settle();
    const forB = await hover(ON_A_SHELF);
    expect(forB.library).toBeNull();
    expect(forB.shelfKnown, "and the refused read did not leave B's shelf marked unreadable").toBe(true);
    expect(shelfReads).toBe(2);
  });

  it("a link summary written from the last reader's profile is asked for again", async () => {
    expect((await hover(SUMMARISED)).summary).toEqual({ text: "Written for A.", streaming: false });
    await act(async () => root.render(null));
    tell("SIGNED_IN", sessionOf("B"));
    expect((await hover(SUMMARISED)).summary).toEqual({ text: "Written for B.", streaming: false });
  });

  it("a shelf the last reader could not read is asked for again, not left unknown", async () => {
    failShelf = true;
    const forA = await hover(ON_A_SHELF);
    expect(forA.shelfKnown).toBe(false);
    expect(forA.loading, "it stopped looking: the failure was recorded").toBe(false);
    failShelf = false;
    await act(async () => root.render(null));
    tell("SIGNED_IN", sessionOf("B"));
    const forB = await hover(ON_A_SHELF);
    expect(forB.shelfKnown).toBe(true);
    expect(forB.library).toBeNull();
  });

  /* GPT Sol's F4: not the same sequence as A to B. The tab is told nobody
     in between, and it is the departure that has to empty the stores. */
  it("A, then signed out, then B on the same slug: the chat and search words are gone", async () => {
    chatDraftsFor(SLUG).setList("A's question, half typed");
    chatDraftsFor(SLUG).setLearn("learn", "What A remembers");
    searchDraftFor(SLUG).set("what A was looking for");
    await hover(ON_A_SHELF);
    await act(async () => root.render(null));

    tell("SIGNED_OUT", null);
    tell("SIGNED_IN", sessionOf("B"));

    expect(chatDraftsFor(SLUG).list()).toBe("");
    expect(chatDraftsFor(SLUG).learn("learn")).toBe("");
    expect(anyChatDraftHeld()).toBe(false);
    expect(searchDraftFor(SLUG).text()).toBe("");
    expect((await hover(ON_A_SHELF)).library).toBeNull();
  });

  it("signing out empties them too", () => {
    chatDraftsFor(SLUG).setList("A's question");
    searchDraftFor(SLUG).set("A's search");
    tell("SIGNED_OUT", null);
    expect(chatDraftsFor(SLUG).list()).toBe("");
    expect(searchDraftFor(SLUG).text()).toBe("");
  });
});

describe("and when it is the same reader, or the first anybody has heard", () => {
  it("a refreshed token for the same reader keeps everything", async () => {
    chatDraftsFor(SLUG).setList("A's question");
    searchDraftFor(SLUG).set("A's search");
    await hover(ON_A_SHELF);
    tell("TOKEN_REFRESHED", sessionOf("A", "TOKEN-A-2"));
    tell("SIGNED_IN", sessionOf("A", "TOKEN-A-2"));
    expect(chatDraftsFor(SLUG).list()).toBe("A's question");
    expect(searchDraftFor(SLUG).text()).toBe("A's search");
    await hover(ON_A_SHELF);
    expect(shelfReads, "the shelf was read once and kept").toBe(1);
  });

  it("what a visitor typed is still there when they sign in", () => {
    tell("SIGNED_OUT", null);
    chatDraftsFor(SLUG).setList("typed signed out");
    searchDraftFor(SLUG).set("searched signed out");
    tell("INITIAL_SESSION", sessionOf("A"));
    expect(chatDraftsFor(SLUG).list()).toBe("typed signed out");
    expect(searchDraftFor(SLUG).text()).toBe("searched signed out");
  });
});
