// @vitest-environment jsdom
/**
 * **The sharing card, mounted the way the app mounts it** — through `Metadata`,
 * off that page's own `/api/metadata/:slug` fetch, with nothing clicked.
 *
 * `tests/access-sharing.test.tsx` renders `AccessSharing` directly and pins its
 * behaviour thoroughly. It cannot see the wiring, and the wiring is where this
 * feature's one reported bug lived: until 2026-08-28 the card kept `publicAt`
 * in its own state and only the `PUT`'s reply ever filled it, so *"Shared
 * since…"* appeared for as long as you stayed on the page after pressing Share
 * and was simply absent on reload. **A browser pass found it; every unit test
 * was green**, because passing the prop in by hand is exactly what the broken
 * version could not do for itself.
 *
 * So the assertion here is deliberately about the *first paint after the
 * fetch*, with no interaction at all: that is the state a reload produces and
 * the one no test was making.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NuqsAdapter } from "nuqs/adapters/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Article } from "../src/types.js";

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

const SLUG = "a-piece";

const ARTICLE: Article = {
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

/**
 * What `GET /api/metadata/:slug` answers in its `sharing` field.
 *
 * `unknown` rather than `ArticleSharing`, because half these tests are about
 * bodies the type says cannot exist — and `readJson<ArticleMetadata>` is a cast
 * that would have accepted every one of them.
 */
let sharing: unknown;
/** Whether that request fails outright. The page's `provenance` then stays null. */
let metadataFails = false;

/**
 * **Typed as the wire rather than as `ArticleMetadata`**, and that is the point
 * of half these tests: the bodies below are ones the type says cannot exist,
 * and `readJson<ArticleMetadata>` in the page is a cast that would have
 * accepted every one of them. Declaring the fixture as the type would be
 * asserting the very thing under test.
 */
function metadata(): Record<string, unknown> {
  return {
    slug: SLUG,
    /* Not `example`, and it matters: the page withholds every control that
       writes to a shelf row when it is showing the fixture, the card included.
       A fixture `dir` here would make this file green for the wrong reason. */
    dir: "data/a-piece",
    stages: [],
    comments: 0,
    profile: null,
    purpose: null,
    archivedAt: null,
    ...(sharing === undefined ? {} : { sharing }),
  };
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  sharing = undefined;
  metadataFails = false;
  vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith("/api/metadata/")) {
      if (metadataFails) {
        return Promise.resolve(
          new Response(JSON.stringify({ error: "the database went away" }), { status: 500 }),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify(metadata()), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }
    return Promise.resolve(new Response("{}", { status: 200 }));
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

/** The metadata page, settled, with nothing pressed. */
async function open(): Promise<void> {
  history.replaceState(null, "", `/read/${SLUG}/metadata`);
  await act(async () => {
    root.render(
      createElement(
        NuqsAdapter,
        null,
        createElement(Metadata, { slug: SLUG, article: ARTICLE, onRenamed: () => {} }),
      ),
    );
  });
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((go) => setTimeout(go, 0));
    });
  }
}

describe("the sharing card, on the page that owns it", () => {
  it("says when a public article was shared, on a fresh load", async () => {
    sharing = {
      visibility: "public",
      publicAt: "2026-08-28T10:34:44.443Z",
      personalised: [],
    };

    await open();

    expect(host.textContent).toContain("Anyone with the link can read this");
    /* **The line the browser pass found missing.** Nothing has been pressed —
       this is what a reload shows, and the version that kept `publicAt` in
       component state had nothing to put here. */
    expect(host.textContent).toContain("Shared since");
  });

  /**
   * **`personalised` survives the wiring**, which nothing asserted.
   *
   * The prop is threaded `Metadata` → `SharingSection` → `AccessSharing`, and
   * dropping it anywhere along that path leaves the dialog falling back to its
   * *"may have been written for your reader profile"* hedge — the very sentence
   * the field was built to replace. Every unit test passes, because they hand
   * the card its props directly. GPT Sol named this mutation, 2026-08-28.
   *
   * It is asserted through the **dialog**, because that is the only place the
   * value is visible: the card itself says nothing about profiles until the
   * owner opens the confirmation.
   */
  it("carries the personalised list all the way to the dialog", async () => {
    sharing = { visibility: "private", publicAt: null, personalised: ["glossary", "summary"] };

    await open();
    const share = [...host.querySelectorAll("button")].find((b) =>
      (b.textContent ?? "").includes("Share with anyone"),
    );
    await act(async () => share?.click());

    expect(host.textContent).toContain("your glossary and your summary");
    // And not the hedge, which is what a dropped prop falls back to.
    expect(host.textContent).not.toContain("may have been written");
  });

  /**
   * **The door that was not validated.**
   *
   * The write response was parsed from the day it was written; the page load
   * was cast. So `sharing: {}` was truthy, became the card's *known* state, and
   * drew **"Only you can read this"** with complete confidence about a body
   * that said nothing at all — the one claim this control must never get wrong,
   * arriving through the one door nobody had checked. GPT Sol, second pass,
   * 2026-08-28.
   *
   * The last two rows are contract-breaking *combinations* rather than wrong
   * types: `public_at` is set on publishing and cleared on unpublishing, so
   * neither pair is a state the server holds, and a card drawing one would be
   * reporting a database that does not exist. `"soon"` would have printed
   * straight into *"Shared since Invalid Date"*.
   */
  it.each([
    ["an empty object", {}],
    ["a null", null],
    ["a string", "public"],
    ["an unknown visibility", { visibility: "world", publicAt: null, personalised: [] }],
    ["a missing personalised list", { visibility: "private", publicAt: null }],
    ["a personalised list of numbers", { visibility: "private", publicAt: null, personalised: [7] }],
    ["public with no timestamp", { visibility: "public", publicAt: null, personalised: [] }],
    [
      "private with a timestamp",
      { visibility: "private", publicAt: "2026-08-28T09:00:00.000Z", personalised: [] },
    ],
    ["a timestamp that is not a date", { visibility: "public", publicAt: "soon", personalised: [] }],
  ])("treats %s in the metadata as unknown rather than as private", async (_name, body) => {
    sharing = body;

    await open();

    expect(host.textContent).toContain("could not check");
    expect(host.textContent).not.toContain("Only you can read this");
    expect(host.textContent).not.toContain("Anyone with the link");
    /* And the rest of the page still renders — a bad `sharing` must not take
       the metadata page down with it. */
    expect(host.textContent).toContain("At a glance");
  });

  it("says a private article is private, and offers to share it", async () => {
    sharing = { visibility: "private", publicAt: null, personalised: [] };

    await open();

    expect(host.textContent).toContain("Only you can read this");
    expect(host.textContent).toContain("Share with anyone who has the link");
    // No stale timestamp from a previous article or a previous render.
    expect(host.textContent).not.toContain("Shared since");
  });

  /**
   * The filesystem store has no column, so the field is absent — and the card
   * must say it does not know rather than drawing an off switch. Checked here
   * as well as in the unit tests because this is the arrangement where the
   * value arrives over the wire and could be lost on the way.
   */
  it("refuses to guess when the store cannot say", async () => {
    sharing = undefined;

    await open();

    expect(host.textContent).toContain("could not check");
    expect(host.textContent).not.toContain("Only you can read this");
  });

  /**
   * **A failed metadata fetch used to remove the section altogether.**
   *
   * `hasShelfRow` is `provenance !== null && !showingFixture`, and a failure
   * leaves `provenance` null — so the owner looking for the sharing switch
   * found no switch and nothing saying why. The card has an honest state for
   * exactly this and it was being skipped over. GPT Sol, 2026-08-28.
   *
   * The section is hidden now only for a *known* fixture, which is the one case
   * where the controls really would 404.
   */
  it("shows the card saying it does not know, rather than hiding it", async () => {
    metadataFails = true;

    await open();

    expect(host.textContent).toContain("Access & sharing");
    expect(host.textContent).toContain("could not check");
    // And no switch is offered, because we have no idea what it would toggle.
    expect(host.textContent).not.toContain("Share with anyone");
  });
});
