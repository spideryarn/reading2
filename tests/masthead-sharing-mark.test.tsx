// @vitest-environment jsdom
/**
 * **Who can read this, at the top of the page you read it on.**
 *
 * Greg, 2026-09-04:
 *
 * > Make it a bit clearer at the top of an article page with an icon if it's
 * > public or not - actually, make that a clickable button with clear tooltip
 * > that takes you to the profile to change whether the article is
 * > private/public
 *
 * ## What needs a test rather than a look
 *
 * All three of these are invisible on the page anybody building this opens,
 * because that page is an owner's own private article on a store that can
 * answer:
 *
 *  1. **Absent is not `private`.** The filesystem store has no visibility
 *     column and never answers (src/api.ts § `loadArticle`), so a mark that
 *     defaulted to a lock would tell an owner that only they can read an
 *     article nobody was ever asked about — with complete confidence and no way
 *     to be right. It is the sentence `AccessSharing` was rebuilt around, and
 *     it is the class in docs/reusable/silent-success.md.
 *  2. **A visitor gets nothing.** The fact is the owner's, and the destination
 *     is a page a visitor cannot open. `article.visibility` only ever rides on
 *     the owner's payload, so this could only regress by somebody putting it on
 *     the public projection too — at which point nothing else in the suite
 *     would notice.
 *  3. **The view state is carried.** Stepping out to the switch and coming back
 *     has to return the reader to the paragraph they left, which is a `?at=`
 *     riding on the href and is exactly the sort of thing that looks fine on a
 *     page opened at the top.
 *
 * docs/plans/260904b-sharing-mark-on-the-article-masthead.md.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SHARING_MARK_NAME_PRIVATE,
  SHARING_MARK_NAME_PUBLIC,
  SHARING_MARK_PRIVATE,
  SHARING_MARK_PUBLIC,
} from "../src/messages.js";
import type { Article, Visibility } from "../src/types.js";

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

const { Masthead } = await import("../src/web/Masthead.js");

const SLUG = "a-piece";
const METADATA = `/read/${SLUG}/metadata`;

function article(visibility: Visibility | undefined): Article {
  return {
    meta: { slug: SLUG, title: "A piece", url: "https://example.com/the-piece" },
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
    navLabelStatus: "ready",
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
    /* Conditional rather than `visibility`, because `exactOptionalPropertyTypes`
       makes an explicit `undefined` a different value from an absent key — and
       the absent one is the state this file is largely about. */
    ...(visibility ? { visibility } : {}),
  };
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  // The mark reads `location.search` at render, the way the dock does.
  history.replaceState(null, "", `/read/${SLUG}`);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

/** The masthead, as the owner sees it (`onRenamed`) or as a visitor does. */
async function mount(visibility: Visibility | undefined, owner: boolean) {
  await act(async () => {
    root.render(
      createElement(Masthead, {
        article: article(visibility),
        slug: SLUG,
        ...(owner ? { onRenamed: () => {} } : {}),
      }),
    );
  });
}

const hrefs = () => [...host.querySelectorAll("a[href]")].map((a) => a.getAttribute("href"));

/** Every accessible name in the masthead — this mark is a glyph, so it has no text. */
const names = () =>
  [...host.querySelectorAll("[aria-label]")].map((el) => el.getAttribute("aria-label"));

/**
 * **The name and the tooltip are different strings, and that is the assertion.**
 *
 * Floating UI hands the tooltip to the link as `aria-describedby`, so a name
 * holding the same sentence is read out twice. Checking the tooltip *sentence*
 * is absent from the accessible names is how a later tidy-up that collapses the
 * two back into one gets caught. src/messages.ts § `SHARING_MARK_NAME_PUBLIC`.
 */
function marked(name: string, tip: string): void {
  expect(names()).toContain(name);
  expect(names()).not.toContain(tip);
  /* Shorter, as a name should be — and the check is not decoration: the failure
     it guards is somebody passing the sentence as both. */
  expect(name.length).toBeLessThan(tip.length);
}

describe("the sharing mark beside the title", () => {
  it("says an article is out in the world, and links to the switch", async () => {
    await mount("public", true);

    marked(SHARING_MARK_NAME_PUBLIC, SHARING_MARK_PUBLIC);
    expect(names()).not.toContain(SHARING_MARK_NAME_PRIVATE);
    expect(hrefs()).toContain(METADATA);
  });

  it("says a private article is private, rather than saying nothing", async () => {
    await mount("private", true);

    /* **The half the shelf deliberately does not have.** `SharedBadge` draws
       only on a shared article, because a chip on every card is decoration;
       here the question — *would the link I am about to paste work?* — is asked
       exactly as often about a private article, and answering it by absence is
       indistinguishable from a mark that has not loaded. */
    marked(SHARING_MARK_NAME_PRIVATE, SHARING_MARK_PRIVATE);
    expect(hrefs()).toContain(METADATA);
  });

  /**
   * **The one this file exists for.** A store with no visibility column answers
   * nothing, and nothing is what must be drawn — not the lock, which is a claim.
   */
  it("draws nothing at all when the store could not say", async () => {
    await mount(undefined, true);

    expect(names()).not.toContain(SHARING_MARK_NAME_PRIVATE);
    expect(names()).not.toContain(SHARING_MARK_NAME_PUBLIC);
    expect(hrefs()).not.toContain(METADATA);
  });

  /**
   * A visitor's payload carries no `visibility` at all, so this is the case
   * above with a second reason. Asserted with the field *present* precisely
   * because the absence would pass on its own and prove nothing: it is the
   * owner gate that has to hold if the public projection ever grows the field.
   */
  it("tells a visitor nothing, even handed the fact", async () => {
    await mount("public", false);

    expect(names()).not.toContain(SHARING_MARK_NAME_PUBLIC);
    expect(hrefs()).not.toContain(METADATA);
  });

  /**
   * **Where the reader had got to, carried across** — the same
   * `carriedSearch(location.search)` the dock's Metadata button uses, so
   * leaving the article to change who can read it and pressing Back returns to
   * the paragraph rather than to the top. `?panel=` is dropped on the way
   * (router.ts § `carriedSearch`): a drawer is not a place you were.
   */
  it("carries the reading position to the metadata page, and drops the panel", async () => {
    history.replaceState(null, "", `/read/${SLUG}?at=spya-aaaaaa&cols=0,1&panel=about`);
    await mount("private", true);

    expect(hrefs()).toContain(`${METADATA}?at=spya-aaaaaa&cols=0,1`);
  });
});
