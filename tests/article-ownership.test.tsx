// @vitest-environment jsdom
/**
 * **Whose article this is, on its details page** — Greg, 2026-10-19
 * (`spya-cf30ac`): *"It doesn't seem obvious who owns an article"*.
 * docs/plans/261020j-say-who-owns-an-article-on-its-details-page.md.
 *
 * The owner's page says *you own it* inside Access & sharing; a visitor's says
 * *you don't* — but only to a session the server confirmed, because a signed-out
 * reader, or one whose session came back 401, may be the owner.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NuqsAdapter } from "nuqs/adapters/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Article } from "../src/types.js";
import type { PublicArtefacts } from "../src/public-types.js";
import {
  OWNERSHIP_ADMIN_LINK,
  OWNERSHIP_ADMIN_NO_EMAIL,
  OWNERSHIP_ADMIN_OWNER,
  OWNERSHIP_NOT_YOURS,
  OWNERSHIP_YOURS,
} from "../src/messages.js";

const EMAIL = "reader@example.com";
const READER = "00000000-0000-4000-8000-000000000001";
/* The production administrator's id, written out: the constant is what is under test. */
const ADMIN = "001bb7a0-7720-4f1b-8b9d-1ee6e63d132a";
/** Which account the mocked session holds; the session's id is what `user.id === readerId` compares. */
let sessionId = READER;
/** What `GET /api/admin/articles` answers, and how often it was asked. */
let adminList: unknown = { articles: [], emailsAvailable: true };
let adminCalls = 0;

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
vi.mock("../src/web/useSession.js", () => ({
  useSession: () => ({
    session: { access_token: "t" },
    user: { id: sessionId, email: "reader@example.com" },
    loading: false,
    known: true,
  }),
}));
vi.mock("../src/web/Dock.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/web/Dock.js")>()),
  Dock: () => null,
}));

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (q: string) => ({
    matches: false,
    media: q,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    onchange: null,
    dispatchEvent: () => false,
  }),
});

const { Metadata } = await import("../src/web/Metadata.js");
const { PublicMetadataPage } = await import("../src/web/PublicPages.js");

const SLUG = "a-piece";

const ARTICLE: Article = {
  highPowerSince: null,
  titleOverridden: false,
  meta: { slug: SLUG, title: "A piece" },
  blocks: [
    {
      id: "spya-aaaaaa",
      tag: "p",
      kind: "text",
      text: "The first paragraph.",
      words: 3,
      html: "<p>The first paragraph.</p>",
      gistable: true,
    },
  ],
  assets: undefined,
  navLabelStatus: "ready",
  sourceGuess: undefined,
  tree: {
    version: "t",
    generator: "t",
    slug: SLUG,
    rootId: "n0",
    nodes: {
      n0: { id: "n0", depth: 0, parent: null, children: [], range: ["spya-aaaaaa", "spya-aaaaaa"], title: "A piece" },
    },
  },
};

const NONE: PublicArtefacts = {
  arc: false,
  tweets: false,
  glossary: false,
  ideas: false,
  quotes: false,
  timeline: false,
  sketch: false,
  skim: false,
  faq: false,
  simpleSummary: false,
  bibliography: false,
  reception: false,
};

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  sessionId = READER;
  adminList = { articles: [], emailsAvailable: true };
  adminCalls = 0;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "/api/admin/articles") {
      adminCalls++;
      return new Response(JSON.stringify(adminList), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.startsWith("/api/metadata/")) {
      return new Response(
        JSON.stringify({
          slug: SLUG,
          dir: "data/a-piece",
          stages: [],
          comments: 0,
          profile: null,
          purpose: null,
          archivedAt: null,
          sharing: { visibility: "private", publicAt: null },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.endsWith("/share-link")) {
      return new Response('{"on":false}', { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response("{}", { status: 200 });
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

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((go) => setTimeout(go, 0));
    });
  }
}

/** The Access & sharing section, found by its heading. */
function section(label: string): HTMLElement | undefined {
  const heading = [...host.querySelectorAll("h2")].find((h) => h.textContent?.trim() === label);
  return heading?.closest("section") ?? undefined;
}

describe("the owner's details page", () => {
  it("says you own it, and on which account, inside Access & sharing", async () => {
    history.replaceState(null, "", `/read/${SLUG}/metadata`);
    await act(async () => {
      root.render(
        createElement(
          NuqsAdapter,
          null,
          createElement(Metadata, { slug: SLUG, article: ARTICLE, onRenamed: () => {}, onVisibility: () => {} }),
        ),
      );
    });
    await settle();
    const card = section("Access & sharing");
    expect(card, "no Access & sharing section").toBeDefined();
    const line = card!.querySelector("[data-ownership]");
    expect(line?.getAttribute("data-ownership")).toBe("yours");
    expect(line?.textContent).toContain(OWNERSHIP_YOURS);
    expect(line?.textContent).toContain(EMAIL);
    expect(host.textContent).not.toContain(OWNERSHIP_NOT_YOURS);
  });
});

describe("a visitor's details page", () => {
  async function visitor(
    signedIn: boolean,
    sessionUnconfirmed: boolean,
    { readerId = signedIn ? READER : null, sharedBy = "link" }: { readerId?: string | null; sharedBy?: "public" | "link" } = {},
  ): Promise<void> {
    history.replaceState(null, "", `/read/${SLUG}/metadata`);
    await act(async () => {
      root.render(
        createElement(PublicMetadataPage, {
          slug: SLUG,
          article: ARTICLE,
          available: NONE,
          signedIn,
          readerId,
          sessionUnconfirmed,
          sharedBy,
        }),
      );
    });
    await settle();
  }

  it("tells a confirmed signed-in reader it is not theirs", async () => {
    await visitor(true, false);
    const line = section("Access")?.querySelector("[data-ownership]");
    expect(line?.getAttribute("data-ownership")).toBe("not-yours");
    expect(line?.textContent).toContain(OWNERSHIP_NOT_YOURS);
    expect(line?.textContent).toContain(EMAIL);
    expect(host.textContent).not.toContain(OWNERSHIP_YOURS);
  });

  it.each([
    ["signed out", false, false],
    ["whose session the server could not confirm", true, true],
  ])("makes no claim about ownership to a reader %s", async (_label, signedIn, unconfirmed) => {
    await visitor(signedIn, unconfirmed);
    expect(host.querySelector("[data-ownership]")).toBeNull();
    expect(host.textContent).not.toContain(OWNERSHIP_NOT_YOURS);
  });

  it("shows no address when the session is not the account access was resolved for", async () => {
    sessionId = "00000000-0000-4000-8000-000000000002";
    await visitor(true, false);
    expect(host.querySelector("[data-ownership]")?.textContent).not.toContain(EMAIL);
  });

  it("asks nothing of the admin routes for a reader who is not the administrator", async () => {
    await visitor(true, false, { sharedBy: "public" });
    expect(adminCalls).toBe(0);
    expect(host.querySelector("[data-admin-owner]")).toBeNull();
  });

  it("asks nothing for an administrator whose session the server could not confirm", async () => {
    sessionId = ADMIN;
    await visitor(true, true, { readerId: ADMIN, sharedBy: "public" });
    expect(adminCalls).toBe(0);
    expect(host.querySelector("[data-admin-owner]")).toBeNull();
  });

  it("tells the administrator whose public article it is, matched by slug", async () => {
    sessionId = ADMIN;
    adminList = {
      emailsAvailable: true,
      articles: [
        { id: "x", shortId: null, ownerId: READER, ownerEmail: "other@example.com", mine: false, createdAt: "", visibility: "public", processing: "full", title: "Another", slug: "another", published: true },
        { id: "y", shortId: null, ownerId: READER, ownerEmail: "owner@example.com", mine: false, createdAt: "", visibility: "public", processing: "full", title: "A piece", slug: SLUG, published: true },
      ],
    };
    await visitor(true, false, { readerId: ADMIN, sharedBy: "public" });
    expect(adminCalls).toBe(1);
    expect(host.querySelector("[data-admin-owner]")?.textContent).toBe(`${OWNERSHIP_ADMIN_OWNER} owner@example.com.`);
  });

  it("says the address could not be read when the Auth service listing failed", async () => {
    sessionId = ADMIN;
    adminList = {
      emailsAvailable: false,
      articles: [{ id: "y", shortId: null, ownerId: READER, ownerEmail: null, mine: false, createdAt: "", visibility: "public", processing: "full", title: "A piece", slug: SLUG, published: true }],
    };
    await visitor(true, false, { readerId: ADMIN, sharedBy: "public" });
    expect(host.querySelector("[data-admin-owner]")?.textContent).toBe(OWNERSHIP_ADMIN_NO_EMAIL);
  });

  it("does not look up a private-link article's owner, and says why", async () => {
    sessionId = ADMIN;
    await visitor(true, false, { readerId: ADMIN, sharedBy: "link" });
    expect(adminCalls).toBe(0);
    expect(host.querySelector("[data-admin-owner]")?.textContent).toBe(OWNERSHIP_ADMIN_LINK);
  });
});
