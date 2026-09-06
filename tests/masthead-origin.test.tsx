// @vitest-environment jsdom
/**
 * **Where the article came from, said beside the title — and never guessed.**
 *
 * The masthead's title has been an `<a href={meta.url}>` since it existed, which
 * says where a piece is from only when you already suspect there is somewhere.
 * When there is not, it said nothing at all, and Greg — 2026-08-30, looking at
 * one he had uploaded — read the silence as a missing feature rather than as an
 * answer: *"I forgot that I uploaded it … In that case, make it clear that it
 * was uploaded!"*
 *
 * The link out is for **everybody**, since Greg's second instruction the same
 * day — *"Public-readable articles should show their provenance-url to all
 * reader[s]"* — and `PublicMeta.url` carries it.
 *
 * ## The part that needs a test rather than a look
 *
 * "No web address, therefore a file" is an **inference**, and it is false twice
 * over. Both were found by reading, not by looking, and neither is visible on
 * the owner's page with a real article on it — which is the only page anybody
 * building this opens.
 *
 *  1. **For a visitor.** An absent `PublicMeta.url` means an upload *or* an
 *     address `publicSourceUrl` withheld — a credential, a query, a private
 *     host (src/urls.ts). Before 2026-08-30 it was wider still: no visitor
 *     received a `url` at all, so *every* shared web article would have told a
 *     stranger it was uploaded.
 *  2. **For an owner.** `src/api.ts` tolerates a missing `meta.json` and a
 *     revision may be published with neither `requested_url` nor `final_url`
 *     (src/db/schema.ts), either of which is an ordinary web article with no
 *     address.
 *     GPT Sol found this one after the first version had shipped past it.
 *
 * So the mark says "uploaded" on the evidence of `meta.source === "pdf"` and
 * never on an absence. Neither failure is a leak, so no security test would go
 * near them; this file is what says the two conditions are load-bearing.
 *
 * The `file://` case is the same class one step along. `npm run eval:pdf-read
 * -- <file.pdf>` records `url: "file:///Users/greg/…"` (src/pdf-read.ts § `main`),
 * which is not an address a reader can follow and *is* a home directory printed
 * on the page.
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

const { Masthead } = await import("../src/web/Masthead.js");

const SLUG = "a-piece";

/** The two sentences the mark carries, so a reword cannot pass silently. */
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
  };
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

/** The masthead, as the owner sees it (`onRenamed`) or as a visitor does. */
async function mount(meta: Partial<Meta>, owner: boolean) {
  await act(async () => {
    root.render(
      createElement(Masthead, {
        article: article(meta),
        slug: SLUG,
        ...(owner ? { onRenamed: () => {} } : {}),
      }),
    );
  });
}

/** Every `href` anywhere in the masthead, so a link cannot hide inside a wrapper. */
const hrefs = () => [...host.querySelectorAll("a[href]")].map((a) => a.getAttribute("href"));

/** Every accessible name in the masthead — this mark is a glyph, so it has no text. */
const names = () =>
  [...host.querySelectorAll("[aria-label]")].map((el) => el.getAttribute("aria-label"));

describe("the mark beside the title", () => {
  it("points the owner at the original when the article has a web address", async () => {
    await mount({ url: "https://example.com/the-piece" }, true);

    /* Twice on purpose: the title itself, which has always been a link, and the
       icon, which is the half a reader can actually see is a link. */
    expect(hrefs().filter((h) => h === "https://example.com/the-piece")).toHaveLength(2);
    /* The host in the name, because "View the original" alone does not say
       whose site you are about to be sent to. */
    expect(names()).toContain("View the original at example.com");
    expect(host.textContent).not.toContain(UPLOADED);
  });

  it("tells the owner an article with no web address was uploaded", async () => {
    await mount({ source: "pdf" }, true);

    expect(names().some((n) => n?.startsWith(UPLOADED))).toBe(true);
    expect(hrefs()).not.toContain(null);
  });

  /**
   * **A visitor gets the link too, and this is the whole of Greg's second
   * instruction:** *"Public-readable articles should show their provenance-url
   * to all reader[s]."* Until 2026-08-30 `PublicMeta` carried no `url`, so this
   * case could not arise; now it is the common one, and nothing else in the
   * suite would notice if the link were quietly re-gated to owners.
   */
  it("gives a visitor the same link out to the publisher", async () => {
    await mount({ url: "https://www.noemamag.com/a-piece/" }, false);

    expect(hrefs()).toContain("https://www.noemamag.com/a-piece/");
    /* The host with `www.` off, which is `hostOf`'s doing and the reason the
       masthead stopped carrying its own copy of that function. */
    expect(names()).toContain("View the original at noemamag.com");
    /* And still no claim about how it got here — a visitor's absent `source`
       makes both of the second branch's sentences unavailable to them. */
    expect(host.textContent).not.toContain(UPLOADED);
    expect(host.textContent).not.toContain(UNRECORDED);
  });

  /**
   * **"No URL" is not "uploaded", even for an owner**, and this is the case that
   * first version got wrong. `src/api.ts` tolerates a missing `meta.json` and a
   * revision may be published with neither `requested_url` nor `final_url`
   * (src/db/schema.ts), either of which hands an owner an ordinary web article
   * with no address. The
   * mark used to tell them they had uploaded it — a claim about something they
   * did, made out of a gap in our own files. GPT Sol, 2026-08-30.
   */
  it("does not call a web article with no address an upload", async () => {
    await mount({}, true);

    expect(names().some((n) => n?.startsWith(UPLOADED))).toBe(false);
    /* And it says the true thing rather than nothing: the owner is looking at
       their own library and the gap is a fact about it. */
    expect(names().some((n) => n?.startsWith(UNRECORDED))).toBe(true);
  });

  /**
   * **The one this file exists for.** A visitor's meta has no `url` whatever the
   * article is, so the same absence must produce no claim at all rather than the
   * claim above.
   */
  it("tells a visitor nothing, because it cannot tell", async () => {
    await mount({ source: "pdf" }, false);

    expect(host.textContent).not.toContain(UPLOADED);
    expect(names().some((n) => n?.startsWith(UPLOADED))).toBe(false);
  });

  /**
   * A local file is not an address. Asserted on the *whole* markup rather than
   * on the mark, because the failure mode is a path reaching the page at all —
   * a `title`, an `href` or a line of text are three ways for it to.
   */
  it("does not draw a file:// path as a source, anywhere", async () => {
    await mount({ source: "pdf", url: "file:///Users/greg/Documents/thing.pdf" }, true);

    expect(host.innerHTML).not.toContain("file://");
    expect(host.innerHTML).not.toContain("/Users/greg");
    /* And it lands in the other branch rather than in neither: a `webSource`
       that returned `null` for everything would pass the two lines above. */
    expect(names().some((n) => n?.startsWith(UPLOADED))).toBe(true);
  });
});
