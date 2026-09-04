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
import { CARD } from "../src/web/card.js";

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
  /* Absent, and that is the third state: this article has never been through the
     `assets` step, so the reader hot-links exactly as before. src/assets.ts. */
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
        createElement(Metadata, {
          slug: SLUG,
          article: ARTICLE,
          onRenamed: () => {},
          onVisibility: () => {},
        }),
      ),
    );
  });
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((go) => setTimeout(go, 0));
    });
  }
}

/**
 * Every artefact built, which is what the fixtures below want unless they say
 * otherwise: since 2026-09-02 the card **refuses to offer sharing** when it
 * cannot say what a shared link would carry, so a body with no `available` is a
 * different test rather than a shorter fixture. See § the inventory could not be
 * read at the foot of this file.
 */
const ALL_BUILT = {
  arc: true,
  tweets: true,
  glossary: true,
  ideas: true,
  quotes: true,
  timeline: true,
};

describe("the sharing card, on the page that owns it", () => {
  it("says when a public article was shared, on a fresh load", async () => {
    sharing = {
      visibility: "public",
      publicAt: "2026-08-28T10:34:44.443Z",
      personalised: [],
      available: ALL_BUILT,
    };

    await open();

    expect(host.textContent).toContain("Anyone with the link can read this");
    /* **The line the browser pass found missing.** Nothing has been pressed —
       this is what a reload shows, and the version that kept `publicAt` in
       component state had nothing to put here. */
    expect(host.textContent).toContain("Shared since");
  });

  /**
   * **The inventory could not be read, so the page does not offer to publish.**
   *
   * At this level rather than only in `tests/access-sharing.test.tsx`, because
   * this is the shape a *real* older or broken server produces — a `sharing`
   * block with the visibility in it and no `available` — and it is the fixture
   * every test in this file used until 2026-09-02. Stopping short here is
   * deliberate: an owner who cannot be told what publishing carries should not
   * be walked through a confirmation that claims to tell them.
   */
  it("offers no share button when the body carried no artefact flags", async () => {
    sharing = { visibility: "private", publicAt: null, personalised: [] };

    await open();

    expect(host.textContent).toContain("Only you can read this");
    expect(host.textContent).toContain("We could not work out what a shared link would carry");
    expect(host.textContent).not.toContain("Share with anyone who has the link");
  });

  /**
   * **The inventory survives the wiring too, and it is asymmetric on purpose.**
   *
   * `available` is threaded `Metadata` → `asArticleSharing` → `SharingSection` →
   * `AccessSharing` → `sharedInventory`, and every unit test on that path hands
   * the card its props directly. GPT Sol, 2026-09-02: a parser that discarded a
   * valid `available`, or one that cross-wired two of its keys, would leave all
   * of them green.
   *
   * So the body sets exactly two flags, and the assertion is that those two
   * labels are on the *shared* side and the other three on the *not built* side
   * — which no all-true or all-false fixture can check.
   */
  it("carries the artefact flags through the parser and into the dialog", async () => {
    sharing = {
      visibility: "private",
      publicAt: null,
      personalised: [],
      available: {
        arc: false,
        tweets: true,
        glossary: true,
        ideas: false,
        quotes: false,
        timeline: false,
      },
    };

    await open();
    const share = [...host.querySelectorAll("button")].find((b) =>
      (b.textContent ?? "").includes("Share with anyone"),
    );
    await act(async () => share?.click());

    /* **Which heading each chip sits under**, not merely that both headings
       exist. A component that rendered every row under "Anyone with the link
       gets these" would pass a `textContent` check and be the worst possible
       version of this feature. */
    const under = (heading: string): string[] => {
      const head = [...host.querySelectorAll("p")].find((p) =>
        (p.textContent ?? "").includes(heading),
      );
      const list = head?.parentElement?.querySelector("ul");
      /* `firstChild`, not `textContent`. Since 2026-09-04 each chip also
         carries an `sr-only` span holding the whole sentence behind the row —
         the thing a screen reader reads, because a tooltip is only in the
         accessibility tree while it is open (AccessSharing.tsx § Inventory).
         `textContent` swallows it and this test would be comparing labels
         against label-plus-paragraph. */
      return [...(list?.querySelectorAll("li") ?? [])].map(
        (li) => li.firstChild?.textContent?.trim() ?? "",
      );
    };

    expect(under("Anyone with the link gets these")).toEqual(
      expect.arrayContaining(["Glossary", "Tweets"]),
    );
    expect(under("Not built yet")).toEqual(
      expect.arrayContaining(["Ideas", "Quotes", "The arc"]),
    );
    expect(under("Anyone with the link gets these")).not.toContain("The arc");
    expect(under("These stay with you")).toEqual(expect.arrayContaining(["Chat", "Search"]));
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
    sharing = {
      visibility: "private",
      publicAt: null,
      personalised: ["glossary", "summary"],
      available: ALL_BUILT,
    };

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
    sharing = { visibility: "private", publicAt: null, personalised: [], available: ALL_BUILT };

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

  /**
   * **The section sits in a box, like every other section on this page.**
   *
   * Greg, 2026-09-04: *"the section should be inside a box like the other
   * sections"*. It was the one section whose contents sat straight on the page
   * background.
   *
   * Here rather than in the preview page or the component's own suite, and
   * that is the whole point of it: the wrapper lives in `SharingSection`, which
   * only this page draws. `preview-sharing.tsx` puts the card round it by hand
   * for the screenshots, so it would go on *looking* boxed for ever after
   * somebody deleted the real one. GPT Sol, 2026-09-04.
   */
  it("draws the section inside the page's card, like its neighbours", async () => {
    sharing = {
      visibility: "private",
      publicAt: null,
      personalised: [],
      available: {
        arc: false,
        tweets: false,
        glossary: true,
        ideas: false,
        quotes: false,
        timeline: false,
      },
    };

    await open();

    const section = [...host.querySelectorAll("section")].find(
      (s) => s.dataset.section === "Access & sharing",
    );
    expect(section, "the sharing section is not on the page at all").toBeTruthy();
    /* `CARD` itself, imported, so this cannot pass against a stale copy of the
       class string — src/web/card.ts. Matched with `classList` rather than a
       CSS selector: every one of these class names contains a `:`, which a
       selector reads as a pseudo-class unless it is escaped, and the escaped
       form is its own small bug waiting to happen. */
    const wanted = CARD.split(" ");
    const box = [...(section?.querySelectorAll("div") ?? [])].find((d) =>
      wanted.every((c) => d.classList.contains(c)),
    );
    expect(box, `no element under the section carries CARD ("${CARD}")`).toBeTruthy();
    // And the switch is inside it, rather than the box being an empty sibling.
    expect(box?.textContent).toContain("Only you can read this");
  });
});
