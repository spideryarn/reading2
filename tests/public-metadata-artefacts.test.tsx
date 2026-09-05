// @vitest-environment jsdom
/**
 * **"What has been built for it", on a visitor's metadata page** — and the row
 * that was missing from it.
 *
 * The list had four entries written out by hand against a `PublicArtefacts` of
 * five, and the one left off was `quotes`. So a visitor reading a shared article
 * *with* quotes was told nothing about them, under a heading that promises what
 * has been built for it. Nothing was broken: the flag was computed, sent,
 * consumed by the dock, and simply not mentioned here. GPT Sol found it while
 * reviewing the owner's inventory
 * (docs/plans/260902n-the-sharing-dialog-lists-what-goes-out-and-what-stays.md).
 *
 * That is the class this file exists for — **a hand-written list beside an
 * exhaustive type** — so the assertion is not "quotes appears" but "every key of
 * `PublicArtefacts` appears, by the name the rest of the app calls it". The page
 * now walks `NOUN` (src/web/visitor.ts), which is the table the reading view's
 * gap sentences come from, so a sixth artefact lands here whether or not
 * whoever adds it opens `PublicPages.tsx`.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Article } from "../src/types.js";
import type { PublicArtefacts } from "../src/public-types.js";
import { TAKEDOWN_LINK } from "../src/messages.js";
import { TAKEDOWN_HREF } from "../src/web/router.js";

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
/* The dock is a fixed bar with fetches of its own and is not what this is
   about — the same stub tests/metadata-origin.test.tsx uses on the same page. */
vi.mock("../src/web/Dock.js", () => ({ Dock: () => null }));

const { PublicMetadataPage } = await import("../src/web/PublicPages.js");
const { NOUN } = await import("../src/web/visitor.js");

const SLUG = "a-piece";

const ARTICLE: Article = {
  meta: { slug: SLUG, title: "A piece" },
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
    version: "1",
    generator: "test",
    slug: SLUG,
    rootId: "spya-aaaaaa",
    nodes: {
      "spya-aaaaaa": {
        id: "spya-aaaaaa",
        depth: 0,
        parent: null,
        children: [],
        range: ["spya-aaaaaa", "spya-aaaaaa"],
        title: "A piece",
      },
    },
  },
};

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

async function visitor(available: PublicArtefacts): Promise<void> {
  await act(async () => {
    root.render(
      /* `sessionUnconfirmed` arrived on this page's props in a merge — a
         visitor whose session has not come back yet is told something
         different from one who is definitely signed out. This test is about
         which artefacts a visitor is shown, so `false` (definitely signed out)
         is the state it means. src/web/PublicPages.tsx and
         src/web/reader-capability.ts. */
      createElement(PublicMetadataPage, {
        slug: SLUG,
        article: ARTICLE,
        available,
        signedIn: false,
        sessionUnconfirmed: false,
      }),
    );
  });
}

const NONE: PublicArtefacts = {
  arc: false,
  tweets: false,
  glossary: false,
  ideas: false,
  quotes: false,
  timeline: false,
  sketch: false,
};
const ALL: PublicArtefacts = {
  arc: true,
  tweets: true,
  glossary: true,
  ideas: true,
  quotes: true,
  timeline: true,
  sketch: true,
};

/* The nouns as the list renders them: `NOUN` is written for the middle of a
   sentence and the page capitalises the first letter. Derived here rather than
   written out, so the test is about *coverage* and not about wording — a reword
   in one table should not need a second edit here. */
const shown = (key: keyof PublicArtefacts): string => {
  const noun = NOUN[key];
  return noun.charAt(0).toUpperCase() + noun.slice(1);
};

describe("what a visitor is told has been built", () => {
  const KEYS = Object.keys(NOUN) as (keyof PublicArtefacts)[];

  it("covers every artefact the payload can carry, not four of the five", async () => {
    await visitor(ALL);
    /* Length as well as membership: five keys and five rows. A page that
       rendered one of them twice and dropped another would satisfy a
       `toContain` sweep. */
    const rows = [...host.querySelectorAll("li")].map((li) => li.textContent ?? "");
    expect(rows).toHaveLength(KEYS.length);
    for (const key of KEYS) {
      expect(rows.join(" | "), `${key} is missing`).toContain(shown(key));
    }
  });

  /**
   * **The tick has to mean something.** The bug this file is about was a row
   * that never rendered; the neighbouring one is a row that renders and always
   * says the same thing. Both flags asserted per key, so a list wired to a
   * constant fails here rather than looking complete.
   */
  it.each(Object.keys(NOUN) as (keyof PublicArtefacts)[])(
    "marks %s built or not built according to its own flag",
    async (key) => {
      await visitor({ ...NONE, [key]: true });
      const rows = [...host.querySelectorAll("li")].map((li) => li.textContent ?? "");
      const mine = rows.find((r) => r.includes(shown(key)));
      expect(mine, `no row for ${key}`).toBeDefined();
      expect(mine).toContain("✓");
      /* And every other row says the opposite, which is what catches a page
         reading one flag for all five. */
      for (const other of rows.filter((r) => r !== mine)) expect(other).toContain("—");
    },
  );
});

/**
 * **"What a shared link carries", written to the person reading it.**
 *
 * This page and the owner's Access & Sharing card drew one constant between
 * them, and it was the owner's sentence: *"They never see **your** comments,
 * **your** conversations…"*, shown to a visitor who has none, about themselves
 * in the third person. Found while fixing the tense on the owner's card,
 * 2026-09-03.
 *
 * `SHARED_LINK_CARRIES` is now written to this page's reader and drawn nowhere
 * else. The owner's card says the same thing as an itemised list and dropped the
 * sentence, which is what leaves one audience and one wording with nothing to
 * keep in step — src/messages.ts § SHARED_LINK_CARRIES, and § SHARING_BADGE for
 * why the owner's side and the visitor's side of one fact are meant to differ.
 */
describe("what a visitor is told a shared link carries", () => {
  it("does not describe the visitor's own comments as theirs", async () => {
    await visitor(ALL);
    const text = host.textContent ?? "";

    expect(text).toContain("A shared link carries the article");
    expect(text).toContain("whoever added it");
    /* The owner's second person, on a page no owner is reading. */
    expect(text).not.toContain("your comments");
    expect(text).not.toContain("your conversations");
  });
});

/**
 * **Whose article this is, and what to do if the answer is "mine, and I did not
 * agree to this".**
 *
 * Two separate facts on the same page, tested together because they are the two
 * halves of one decision Greg took on 2026-09-04: a public article says who
 * wrote it, and a public article offers a way to complain about being here.
 *
 * `meta.byline` is **the original publication's author**, extracted from
 * somebody else's page by stage 2 and carried through `PublicMeta.byline`
 * (src/public/dto.ts § `publicMeta`). It is never the Spideryarn reader who
 * added the article: that person's identity is not on the public wire at all,
 * and there is no field here that could put it there.
 *
 * **The byline assertion was green when it was written**, which is unusual
 * enough to say out loud — the page has drawn it since it existed. It is pinned
 * now because it stopped being incidental and became something we told Greg the
 * product does; deleting the facts line was watched failing it.
 */
describe("whose article a visitor is looking at", () => {
  it("names the author the piece was published under", async () => {
    await act(async () => {
      root.render(
        createElement(PublicMetadataPage, {
          slug: SLUG,
          article: { ...ARTICLE, meta: { ...ARTICLE.meta, byline: "Richard P. Feynman" } },
          available: NONE,
          signedIn: false,
          sessionUnconfirmed: false,
        }),
      );
    });
    expect(host.textContent).toContain("Richard P. Feynman");
  });

  /**
   * **Most articles have no byline**, so the absent case is the ordinary one:
   * nothing drawn, no stranded separator, no "null".
   */
  it("and says nothing at all when the piece has none", async () => {
    await visitor(NONE);
    expect(host.textContent).not.toContain("null");
    expect(host.textContent).not.toContain("undefined");
  });

  /**
   * The takedown link, which is the counterweight to the tick-box the owner
   * ticked: sharing asks an owner to confirm they hold the rights, and nothing
   * checks that, so the protection is that plus a way for the wronged party to
   * say so. docs/project/privacy.md § If something here is yours.
   *
   * On this page rather than in the reading view: this is the page about where
   * the article came from, it is one press of the bottom bar away from the
   * article itself, and the reading chrome is measured — anything added to it
   * moves every deep link (src/web/scroll.ts).
   */
  it("and offers a way to ask for it to be taken down", async () => {
    await visitor(NONE);
    const hrefs = [...host.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toContain(TAKEDOWN_HREF);
    expect(host.textContent).toContain(TAKEDOWN_LINK);
  });
});
