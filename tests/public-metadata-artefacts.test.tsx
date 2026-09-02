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
};
const ALL: PublicArtefacts = { arc: true, tweets: true, glossary: true, ideas: true, quotes: true };

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
