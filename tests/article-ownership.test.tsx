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
import { readFileSync } from "node:fs";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NuqsAdapter } from "nuqs/adapters/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Article } from "../src/types.js";
import type { PublicArtefacts } from "../src/public-types.js";
import {
  LINK_OPENS_HEADING,
  LINK_OPENS_NONE,
  LINK_OPENS_SIGNED_OUT,
  OWNERSHIP_ADMIN_NO_EMAIL,
  OWNERSHIP_ADMIN_NOT_FOUND,
  OWNERSHIP_ADMIN_OWNER,
  OWNERSHIP_NOT_YOURS,
  OWNERSHIP_YOURS,
  SHARING_RIGHTS_CONFIRM,
} from "../src/messages.js";
import { ADMIN_USER_ID_PROD } from "../src/admin.js";

const EMAIL = "reader@example.com";
const READER = "00000000-0000-4000-8000-0000000ce1f0";
/* The production administrator's id, imported rather than written out: `tests/admin.test.ts`
   pins the literal, and a uuid written in two test files trips `tests/fixture-ids.test.ts`. */
const ADMIN = ADMIN_USER_ID_PROD;
/** Which account the mocked session holds; the session's id is what `user.id === readerId` compares. */
let sessionId = READER;
/** What `GET /api/admin/articles/:slug/access` answers (`null`: 404), and every address it was asked at. */
let adminAccess: unknown = null;
/** Queued answers for tests which hold one request while the page moves on. */
let adminReplies: Promise<unknown>[] = [];
let adminCalls = 0;
const adminUrls: string[] = [];
const KEY = "abcdefghijklmnopqrstuv";

/** An access answer, with the fields a test does not care about filled in. */
function access(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ownerId: READER,
    ownerEmail: "owner@example.com",
    emailsAvailable: true,
    mine: false,
    privateLink: false,
    openers: [],
    signedOut: null,
    ...over,
  };
}

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
  adminAccess = null;
  adminReplies = [];
  adminCalls = 0;
  adminUrls.length = 0;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith("/api/admin/") && !url.split("?")[0]!.endsWith("/access")) {
      /* The owner's page also asks for the administrator's cost section; not this test's business. */
      return new Response(JSON.stringify({ error: "not here" }), { status: 404, headers: { "content-type": "application/json" } });
    }
    if (url.startsWith("/api/admin/")) {
      adminCalls++;
      adminUrls.push(url);
      const queued = adminReplies.shift();
      const body = queued ? await queued : adminAccess;
      if (body === null) {
        return new Response(JSON.stringify({ error: "There is no such article." }), {
          status: 404,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
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

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function articleAt(slug: string): Article {
  return { ...ARTICLE, meta: { ...ARTICLE.meta, slug }, tree: { ...ARTICLE.tree, slug } };
}

describe("the owner's details page", () => {
  it("says you own it, and on which account, inside Access & sharing", async () => {
    history.replaceState(null, "", `/read/${SLUG}/metadata`);
    await act(async () => {
      root.render(
        createElement(
          NuqsAdapter,
          null,
          createElement(Metadata, {
            slug: SLUG,
            article: ARTICLE,
            readerId: READER,
            onRenamed: () => {},
            onVisibility: () => {},
          }),
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

  it("shows the administrator who opened their own article's private link, and asks nothing for anybody else", async () => {
    adminAccess = access({ ownerId: ADMIN, mine: true, privateLink: true, signedOut: { opens: 2, firstOpenedAt: "2026-10-21T08:00:00Z", lastOpenedAt: "2026-10-21T08:00:00Z" } });
    for (const who of [READER, ADMIN]) {
      sessionId = who;
      adminUrls.length = 0;
      await act(async () => {
        root.render(
          createElement(
            NuqsAdapter,
            null,
            createElement(Metadata, { slug: SLUG, article: ARTICLE, readerId: who, onRenamed: () => {}, onVisibility: () => {} }),
          ),
        );
      });
      await settle();
      const opens = section("Access & sharing")?.querySelector("[data-admin-link-opens]");
      if (who === ADMIN) {
        expect(adminUrls).toEqual([`/api/admin/articles/${SLUG}/access`]);
        expect(opens?.textContent).toContain(`${LINK_OPENS_SIGNED_OUT} 2`);
      } else {
        expect(adminUrls).toEqual([]);
        expect(opens).toBeFalsy();
      }
    }
  });

  it("follows the private-link switch after the admin access answer has landed", async () => {
    adminAccess = access({ ownerId: ADMIN, mine: true, privateLink: false });
    sessionId = ADMIN;
    const originalFetch = globalThis.fetch;
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).startsWith("/api/metadata/")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              slug: SLUG,
              dir: "data/a-piece",
              stages: [],
              comments: 0,
              profile: null,
              purpose: null,
              archivedAt: null,
              sharing: { visibility: "private", publicAt: null, personalised: [], available: NONE },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      }
      if (String(input).endsWith("/share-link") && init?.method === "POST") {
        return Promise.resolve(
          new Response(JSON.stringify({ on: true, key: KEY, since: "2026-10-21T12:00:00Z" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }
      if (String(input).endsWith("/share-link") && init?.method === "DELETE") {
        return Promise.resolve(
          new Response('{"on":false}', { status: 200, headers: { "content-type": "application/json" } }),
        );
      }
      return originalFetch(input, init);
    });

    await act(async () => {
      root.render(
        createElement(
          NuqsAdapter,
          null,
          createElement(Metadata, {
            slug: SLUG,
            article: ARTICLE,
            readerId: ADMIN,
            onRenamed: () => {},
            onVisibility: () => {},
          }),
        ),
      );
    });
    await settle();
    expect(host.querySelector("[data-admin-link-opens]")).toBeNull();

    const press = async (text: string) => {
      await act(async () => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === text)?.click());
      await settle();
    };
    await press("Create a link");
    const rights = [...host.querySelectorAll("label")]
      .find((label) => label.textContent?.includes(SHARING_RIGHTS_CONFIRM))
      ?.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(rights, "the private-link confirmation has no rights checkbox").toBeTruthy();
    await act(async () => rights?.click());
    await press("Create the link");
    expect(host.querySelector("[data-admin-link-opens]")?.textContent).toBe(LINK_OPENS_NONE);

    await press("Turn off");
    expect(host.querySelector("[data-admin-link-opens]")).toBeNull();
  });

  it("does not put a new session's address beside the old reader's ownership answer", async () => {
    sessionId = "00000000-0000-4000-8000-000000000002";
    await act(async () => {
      root.render(
        createElement(
          NuqsAdapter,
          null,
          createElement(Metadata, {
            slug: SLUG,
            article: ARTICLE,
            readerId: READER,
            onRenamed: () => {},
            onVisibility: () => {},
          }),
        ),
      );
    });
    await settle();
    expect(section("Access & sharing")?.querySelector("[data-ownership]")?.textContent).not.toContain(EMAIL);
  });
});

describe("a visitor's details page", () => {
  async function visitor(
    signedIn: boolean,
    sessionUnconfirmed: boolean,
    {
      readerId = signedIn ? READER : null,
      sharedBy = "link",
      slug = SLUG,
      shareKey = null,
    }: { readerId?: string | null; sharedBy?: "public" | "link"; slug?: string; shareKey?: string | null } = {},
  ): Promise<void> {
    history.replaceState(null, "", `/read/${slug}/metadata`);
    await act(async () => {
      root.render(
        createElement(PublicMetadataPage, {
          slug,
          article: articleAt(slug),
          available: NONE,
          signedIn,
          readerId,
          sessionUnconfirmed,
          sharedBy,
          shareKey: shareKey as never,
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

  it("makes no claim or admin request when the live session is not the account access was resolved for", async () => {
    sessionId = READER;
    await visitor(true, false, { readerId: ADMIN, sharedBy: "public" });
    expect(host.querySelector("[data-ownership]")).toBeNull();
    expect(host.querySelector("[data-admin-owner]")).toBeNull();
    expect(adminCalls).toBe(0);
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

  it("tells the administrator whose public article it is, from the access route", async () => {
    sessionId = ADMIN;
    adminAccess = access();
    await visitor(true, false, { readerId: ADMIN, sharedBy: "public" });
    expect(adminUrls).toEqual([`/api/admin/articles/${SLUG}/access`]);
    expect(host.querySelector("[data-admin-owner]")?.textContent).toBe(`${OWNERSHIP_ADMIN_OWNER} owner@example.com.`);
    /* A public article that has never had a link says nothing about links. */
    expect(host.querySelector("[data-admin-link-opens]")).toBeNull();
  });

  it("says the address could not be read when the Auth service listing failed", async () => {
    sessionId = ADMIN;
    adminAccess = access({ ownerEmail: null, emailsAvailable: false });
    await visitor(true, false, { readerId: ADMIN, sharedBy: "public" });
    expect(host.querySelector("[data-admin-owner]")?.textContent).toBe(OWNERSHIP_ADMIN_NO_EMAIL);
  });

  /* Greg's 1B (reply spya-xug3kf to q-agbc89): on a private link, the owner too
     — asked with the address's key, which is what the server answers for. */
  it("tells the administrator whose private-link article it is, asking with the key", async () => {
    sessionId = ADMIN;
    adminAccess = access({ privateLink: true });
    await visitor(true, false, { readerId: ADMIN, sharedBy: "link", shareKey: KEY });
    expect(adminUrls).toEqual([`/api/admin/articles/${SLUG}/access?key=${KEY}`]);
    expect(host.querySelector("[data-admin-owner]")?.textContent).toBe(`${OWNERSHIP_ADMIN_OWNER} owner@example.com.`);
    expect(host.querySelector("[data-admin-link-opens]")?.textContent).toBe(LINK_OPENS_NONE);
  });

  /* Greg's 2C: who opened it, among the signed-in, and roughly how often signed out. */
  it("lists who opened the private link, and the signed-out count", async () => {
    sessionId = ADMIN;
    adminAccess = access({
      privateLink: true,
      openers: [
        { readerId: "r1", email: "a@example.com", opens: 3, firstOpenedAt: "2026-10-20T09:00:00Z", lastOpenedAt: "2026-10-21T09:00:00Z" },
        { readerId: "r2", email: null, opens: 1, firstOpenedAt: "2026-10-20T10:00:00Z", lastOpenedAt: "2026-10-20T10:00:00Z" },
      ],
      signedOut: { opens: 4, firstOpenedAt: "2026-10-20T08:00:00Z", lastOpenedAt: "2026-10-21T08:00:00Z" },
    });
    await visitor(true, false, { readerId: ADMIN, sharedBy: "link", shareKey: KEY });
    const opens = host.querySelector("[data-admin-link-opens]")?.textContent ?? "";
    expect(opens).toContain(LINK_OPENS_HEADING);
    expect(opens).toContain("a@example.com — 3 times, last 21 October 2026");
    expect(opens).toContain("once, last 20 October 2026");
    expect(opens).toContain(`${LINK_OPENS_SIGNED_OUT} 4, last 21 October 2026.`);
  });

  it("says it could not look the article up when the route answers 404", async () => {
    sessionId = ADMIN;
    adminAccess = null;
    await visitor(true, false, { readerId: ADMIN, sharedBy: "link", shareKey: KEY });
    expect(host.querySelector("[data-admin-owner]")?.textContent).toBe(OWNERSHIP_ADMIN_NOT_FOUND);
    expect(host.querySelector("[data-admin-link-opens]")).toBeNull();
  });

  it("does not let an earlier slug's late owner answer overwrite the current one", async () => {
    sessionId = ADMIN;
    const old = deferred<unknown>();
    adminReplies = [old.promise, Promise.resolve(access({ ownerEmail: "current@example.com" }))];

    await visitor(true, false, { readerId: ADMIN, sharedBy: "public", slug: "old-piece" });
    expect(adminCalls).toBe(1);
    await visitor(true, false, { readerId: ADMIN, sharedBy: "public" });
    expect(host.querySelector("[data-admin-owner]")?.textContent).toBe(
      `${OWNERSHIP_ADMIN_OWNER} current@example.com.`,
    );

    old.resolve(access({ ownerEmail: "stale@example.com" }));
    await settle();
    expect(host.querySelector("[data-admin-owner]")?.textContent).toBe(
      `${OWNERSHIP_ADMIN_OWNER} current@example.com.`,
    );
  });

  it("qualifies the visitor ownership sentence in Help as signed-in only", () => {
    const help = readFileSync("src/web/help/pages/sharing.md", "utf8").replace(/\s+/g, " ");
    expect(help).toContain("When you’re signed in and open an article somebody else shared with you");
  });
});
