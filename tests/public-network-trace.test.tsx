// @vitest-environment jsdom
/**
 * **The acceptance test for public reading is a network trace, not a
 * screenshot.**
 *
 * A signed-out browser on a shared document must issue **no request outside
 * `/api/public/` and no POST at all**. That sentence is the whole of slice 1a's
 * client half, and a screenshot cannot see it: the page renders correctly
 * either way, and the difference is a stream of 401s behind it that only a
 * trace or a devtools panel shows. docs/plans/public-read-only-access.md § Stage 1.
 *
 * ## Why the spy is on `globalThis.fetch` and not on `apiFetch`
 *
 * Because `apiFetch` is one of the things being tested. A spy on it would see
 * only the requests that went through the module we already know about, and the
 * failure this is guarding against is a hook mounting somewhere nobody
 * remembered. Every request in the client ends at `fetch`, including
 * `public-api.ts`'s deliberately plain one, so that is where the trace is taken.
 *
 * ## The control, and why the file would be worthless without it
 *
 * A test that has never been seen to fail proves nothing —
 * docs/reusable/silent-success.md, and most of a day's bugs here have been
 * something reporting success while doing nothing. So the same harness renders
 * the same address **as the owner**, and asserts the opposite: that the trace
 * fills up with `/api/comments/`, `/api/chat/`, `/api/glossary/` and the
 * record-open POST. If the visitor assertion ever passes because the spy is
 * blind or the page never mounted, that one fails in the same run.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { enableHistorySync, NuqsAdapter } from "nuqs/adapters/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Article } from "../src/types.js";
import type { PublicArticle, PublicMetadata } from "../src/public-types.js";

/** Who `useSession` says is here. Re-posed by each test before it renders. */
const session: { user: { id: string; email: string } | null } = { user: null };

vi.mock("../src/web/useSession.js", () => ({
  useSession: () => ({ session: null, user: session.user, loading: false }),
}));

/* Never reached on the visitor path — which is the point — but `lib/api.ts`
   imports it at module load and would go looking for a project URL. */
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

/**
 * The three browser APIs the reading view uses that jsdom does not have.
 *
 * Stubbed rather than avoided, because the whole value of this file is that it
 * mounts the **real** reading view: a version that swapped `Spine` or the
 * scroll tracker for stubs would be testing a page nobody visits. None of the
 * three can affect the trace — they observe layout and none of them fetches.
 */
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

/** Every request the page made, in order, whoever made it. */
const trace: { url: string; method: string; auth: string | null }[] = [];

const SLUG = "a-piece";

const ARTICLE: PublicArticle = {
  meta: { slug: SLUG, title: "A piece", byline: "Somebody" },
  blocks: [
    {
      id: "spya-aaaaaa",
      tag: "h1",
      kind: "heading",
      level: 1,
      text: "A piece",
      words: 2,
      html: "<h1>A piece</h1>",
      gistable: false,
    },
    {
      id: "spya-bbbbbb",
      tag: "p",
      kind: "text",
      text: "The first paragraph of the piece.",
      words: 6,
      html: "<p>The first paragraph of the piece.</p>",
      gistable: true,
    },
  ],
  tree: {
    version: "test",
    generator: "test",
    slug: SLUG,
    rootId: "n0",
    nodes: {
      n0: {
        id: "n0",
        depth: 0,
        parent: null,
        children: [],
        range: ["spya-aaaaaa", "spya-bbbbbb"],
        title: "A piece",
        gist: "What the piece says.",
      },
    },
  },
};

const METADATA: PublicMetadata = {
  slug: SLUG,
  title: "A piece",
  /* Two `true`s and three `false`s on purpose: a visitor pressing Glossary must
     get a different sentence from one pressing Summary, and a fixture that
     answered the same to every question could not tell that apart. */
  available: { arc: false, tweets: false, glossary: true, summary: false, ideas: false },
};

/** The same article as the owner would be served it. Extra fields and all. */
const OWNED: Article = { ...ARTICLE, meta: { ...ARTICLE.meta, url: "https://example.com/a" } };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * The server, as far as this page is concerned.
 *
 * Everything the *owner* asks for is answered with an empty success rather than
 * refused, so the control below exercises a page that works rather than a page
 * full of error states — a trace of failures would be a different test.
 */
function reply(url: string, method: string): Response {
  if (url === `/api/public/article/${SLUG}`) return json(ARTICLE);
  if (url === `/api/public/metadata/${SLUG}`) return json(METADATA);
  if (url === `/api/article/${SLUG}`) return json(OWNED);
  if (method === "POST") return new Response(null, { status: 204 });
  if (url.startsWith("/api/comments/")) return json({ comments: [] });
  if (url.startsWith("/api/chat/")) return json({ threads: [] });
  if (url.startsWith("/api/glossary/")) return json({ status: "none", glossary: null });
  return json({});
}

/* Imported here rather than inside `open()`, and it is not tidiness: the first
   dynamic import transforms App.tsx and the whole client graph behind it, which
   takes several seconds — long enough that whichever test ran first blew the
   5-second default and the other four were reported as failures of the code.
   `vi.mock` is hoisted above this, so the mocks are already in place. */
const { App } = await import("../src/web/App.js");

let host: HTMLDivElement;
let root: Root;

enableHistorySync();

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  trace.length = 0;
  session.user = null;
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    trace.push({ url, method, auth: headers.get("Authorization") });
    return Promise.resolve(reply(url, method));
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

async function settle(turns = 6): Promise<void> {
  for (let i = 0; i < turns; i++) {
    await act(async () => {
      await new Promise((go) => setTimeout(go, 0));
    });
  }
}

/** The whole app, at a shared article's address. */
async function open(search = ""): Promise<void> {
  history.replaceState(null, "", `/read/${SLUG}${search}`);
  await act(async () => {
    root.render(createElement(NuqsAdapter, null, createElement(App, null)));
  });
  await settle();
}

const outsidePublic = () => trace.filter((r) => !r.url.startsWith("/api/public/"));

describe("a signed-out browser on a shared document", () => {
  it("asks the two public endpoints and nothing else", async () => {
    await open();

    expect(host.textContent).toContain("The first paragraph of the piece.");
    /* **The chrome, asserted beside the trace, and the trace alone is not
       enough.** A page could ask only the public endpoints and still hand the
       reading view an owner capability — the hooks would fetch from
       `OwnedReader` either way, so the trace would not notice. The label is
       what the capability actually decides, so it is checked here and its
       absence is checked in the owner control below. */
    expect(host.textContent).toContain("View only");
    expect(trace.map((r) => r.url)).toEqual([
      `/api/public/article/${SLUG}`,
      `/api/public/metadata/${SLUG}`,
    ]);
  });

  it("issues no POST, and sends no Authorization header", async () => {
    await open();

    expect(trace.filter((r) => r.method !== "GET")).toEqual([]);
    expect(trace.filter((r) => r.auth !== null)).toEqual([]);
  });

  /**
   * The mode bands are where the private hooks live — `useJobs` polls the job
   * list for ever from three of them — so opening one is the press most likely
   * to mount something that fetches.
   */
  it("stays inside the public namespace through every mode", async () => {
    for (const mode of ["glossary", "summary", "ideas", "search", "chat", "review", "diagram"]) {
      trace.length = 0;
      await open(`?mode=${mode}`);
      expect(outsidePublic()).toEqual([]);
      await act(async () => root.unmount());
      host.remove();
      host = document.createElement("div");
      document.body.append(host);
      root = createRoot(host);
    }
  });

  it("opens the comments drawer without asking for anybody's comments", async () => {
    await open("?panel=questions");
    expect(outsidePublic()).toEqual([]);
    /* And it says whose they would be, rather than "nothing asked yet" — which
       is what an empty owner drawer says, and would be a false claim here. */
    expect(host.textContent).toContain("belong to whoever added this article");
  });
});

/**
 * **The control.** Same harness, same address, a session — and the trace must
 * fill up.
 *
 * Without this, every assertion above would pass just as happily against a spy
 * that saw nothing, a render that threw, or a page that never mounted. The
 * three named endpoints are the three hooks the capability seam exists to keep
 * out, and the POST is the record-open.
 */
describe("the same address, as the owner", () => {
  it("mounts the private hooks and the record-open POST", async () => {
    session.user = { id: "owner-1", email: "greg@example.com" };
    await open();

    const urls = trace.map((r) => r.url);
    expect(urls).toContain(`/api/article/${SLUG}`);
    expect(urls.some((u) => u.startsWith("/api/comments/"))).toBe(true);
    expect(urls.some((u) => u.startsWith("/api/chat/"))).toBe(true);
    expect(urls.some((u) => u.startsWith("/api/glossary/"))).toBe(true);
    expect(trace.filter((r) => r.method === "POST").map((r) => r.url)).toContain(
      `/api/library/${SLUG}/open`,
    );
    // And none of it went to the public namespace: the owner path is untouched.
    expect(trace.filter((r) => r.url.startsWith("/api/public/"))).toEqual([]);
    // The other half of the capability check — see the visitor test above.
    expect(host.textContent).not.toContain("View only");
  });
});
