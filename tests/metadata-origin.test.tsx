// @vitest-environment jsdom
/**
 * **Where the article came from, on the two metadata pages.**
 *
 * There are two, and they are different components for a real reason: the
 * owner's `Metadata` mounts editing, deletion, the profile boxes and a fetch of
 * the private `GET /api/metadata/:slug`, none of which a visitor may have, so
 * `PublicMetadataPage` replaces it rather than hiding parts of it
 * (src/web/PublicPages.tsx). The cost of that seam is that a fact added to one
 * is simply missing from the other, silently, and **that is exactly what
 * happened here**: the owner's page grew the source link on 2026-08-30 and the
 * visitor's did not, against an instruction that was explicitly about visitors —
 * *"Public-readable articles should show their provenance-url to all
 * reader[s]"*. GPT Sol found it by reading both.
 *
 * So this file asks the same question of both pages in one place. A future
 * third answer to "where did this come from" has somewhere obvious to be added
 * twice.
 *
 * The owner's page also says something the visitor's must not: *uploaded*. That
 * claim needs `meta.source === "pdf"` as evidence and never a missing URL —
 * src/web/Masthead.tsx § `OriginMark` has the two ways the absence lies, and
 * tests/masthead-origin.test.tsx holds the masthead's copy of the same rule.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Article, Meta } from "../src/types.js";

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

/* The owner's page reads where the reader had got to out of the address bar, and
   `nuqs` needs an adapter above the tree to do it. Stubbed rather than provided,
   as tests/article-rename.test.tsx does for the same page: `?at=` is not what
   this file is about, and mounting a real adapter drags the router in with it.
   The dock is a fixed bar with fetches of its own, and the same. */
vi.mock("nuqs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("nuqs")>()),
  useQueryState: () => [null, () => {}],
}));
vi.mock("../src/web/Dock.js", () => ({ Dock: () => null }));

const { Metadata } = await import("../src/web/Metadata.js");
const { PublicMetadataPage } = await import("../src/web/PublicPages.js");

const SLUG = "a-piece";
const URL_ = "https://www.noemamag.com/a-piece/";
const UPLOADED = "Uploaded from a file";
const UNRECORDED = "No web address was recorded";

function article(meta: Partial<Meta>): Article {
  return {
    meta: { slug: SLUG, title: "A piece", ...meta },
    blocks: [
      {
        id: "spya-aaaaaa",
        tag: "p",
        kind: "text",
        text: "A paragraph.",
        words: 2,
        html: "<p>A paragraph.</p>",
        gistable: true,
      },
    ],
    assets: undefined,
    tree: {
      version: "t",
      generator: "t",
      slug: SLUG,
      rootId: "n0",
      nodes: {
        n0: {
          id: "n0",
          depth: 0,
          parent: null,
          children: [],
          range: ["spya-aaaaaa", "spya-aaaaaa"],
          title: "A piece",
        },
      },
    },
  };
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  /* The owner's page fetches `/api/metadata/:slug` on mount, and this answers it.
     It has to succeed for the *file* link, and that is the page working rather
     than the test being awkward: `Origin`'s owner gate is `hasShelfRow`, which
     is false until the request lands — so before it does, the page does not yet
     know there is a row to own and withholds every control that would PATCH one.
     The failed case is a test of its own below. */
  vi.stubGlobal("fetch", () =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          slug: SLUG,
          dir: `data/${SLUG}`,
          stages: [],
          comments: 0,
          profile: null,
          purpose: null,
          archivedAt: null,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    ),
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const hrefs = () => [...host.querySelectorAll("a[href]")].map((a) => a.getAttribute("href"));

/** The owner's page, which owns a rename callback because only an owner has one. */
async function owner(meta: Partial<Meta>) {
  await act(async () => {
    root.render(
      createElement(Metadata, {
        slug: SLUG,
        article: article(meta),
        onRenamed: () => {},
        onVisibility: () => {},
      }),
    );
  });
}

/** The visitor's page, which fetches nothing and is handed everything. */
async function visitor(meta: Partial<Meta>) {
  await act(async () => {
    root.render(
      createElement(PublicMetadataPage, {
        slug: SLUG,
        article: article(meta),
        available: {
          arc: false,
          tweets: false,
          glossary: false,
          ideas: false,
          quotes: false,
          timeline: false,
          sketch: false,
        },
        signedIn: false,
        /* This file is about where the piece came from; the session is beside
           the point, so it is the ordinary answer. App.tsx § ArticleAccess. */
        sessionUnconfirmed: false,
      }),
    );
  });
}

describe("the owner's metadata page", () => {
  it("links out to the original when there is one", async () => {
    await owner({ url: URL_ });

    expect(hrefs()).toContain(URL_);
    expect(host.textContent).not.toContain(UPLOADED);
  });

  it("says an uploaded PDF was uploaded, and offers the file", async () => {
    await owner({ source: "pdf" });

    expect(host.textContent).toContain(UPLOADED);
    /* The way to the stored file, which for an upload is the only original
       there is — and a button rather than an anchor, because the route behind
       it needs an Authorization header (src/web/SourceLink.tsx). */
    expect(host.textContent).toContain("View the original");
  });

  /**
   * A web article with no address is a real state — a lost `meta.json`, or an
   * import that carried no URL — and telling the owner they uploaded it is a
   * claim about what they did, made out of a gap in our files.
   */
  it("does not call a web article with no address an upload", async () => {
    await owner({});

    expect(host.textContent).not.toContain(UPLOADED);
    expect(host.textContent).toContain(UNRECORDED);
    /* And no offer of a file that was never uploaded: the control behind it
       fetches a stored PDF and could only 404 here. */
    expect(host.textContent).not.toContain("View the original");
  });

  it("does not draw a file:// path as a source, anywhere", async () => {
    await owner({ source: "pdf", url: "file:///Users/greg/Documents/thing.pdf" });

    expect(host.innerHTML).not.toContain("file://");
    expect(host.innerHTML).not.toContain("/Users/greg");
    expect(host.textContent).toContain(UPLOADED);
  });

  /**
   * **The source line comes off the article payload, not off the metadata
   * request** — so it is there even when that request fails, which is the state
   * this page is most often opened in when something is wrong.
   *
   * The file link is not, and must not be: `hasShelfRow` is false until the
   * request lands, and offering a control that PATCHes a row we have not
   * confirmed exists is the rule the Delete button on this page is built around.
   * Two different answers to "do we know this yet", and both are right.
   */
  it("still says where the article came from when the metadata request fails", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new Error("no metadata in this test")));
    await owner({ url: URL_ });
    expect(hrefs()).toContain(URL_);

    await act(async () => root.unmount());
    root = createRoot(host);
    await owner({ source: "pdf" });
    expect(host.textContent).toContain(UPLOADED);
    expect(host.textContent).not.toContain("View the original");
  });
});

describe("the visitor's metadata page", () => {
  /** The gap GPT Sol found: this page had no source link at all. */
  it("links out to the original, which is the whole instruction", async () => {
    await visitor({ url: URL_ });

    expect(hrefs()).toContain(URL_);
  });

  /**
   * **And says nothing when there is none.** A visitor's absent `url` means an
   * upload *or* an address `publicSourceUrl` withheld, and this page cannot tell
   * which — so both sentences the owner's page can reach are unavailable here.
   */
  it("makes no claim about provenance when there is no address", async () => {
    await visitor({});

    expect(host.textContent).not.toContain(UPLOADED);
    expect(host.textContent).not.toContain(UNRECORDED);
  });

  /**
   * **The positive control on the negative one.** Every assertion above passes
   * on a page that renders nothing at all, which is precisely the state this
   * whole file exists because the page was in.
   */
  it("is a real page while it says nothing about provenance", async () => {
    await visitor({});

    expect(host.textContent).toContain("A piece");
    expect(host.textContent).toContain("words");
  });
});
