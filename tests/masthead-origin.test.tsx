// @vitest-environment jsdom
/**
 * **Where the article came from, said under the title — and never guessed.**
 *
 * It was a glyph beside the title until 2026-09-06 and is a line under it now,
 * carrying the address itself: Greg, *"Show the url from which the original came
 * … I think it's important that we are prominent about the origin."*
 * src/web/Masthead.tsx § `OriginLine`. Everything below is unchanged in what it
 * asserts and changed only in where it looks — the sentences are visible text
 * now rather than an `aria-label`, which is the point of the change.
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

/**
 * Every accessible name in the masthead. The origin *link* has one and it is
 * deliberately not its visible text — an address read aloud does not announce
 * that it goes anywhere (src/web/Masthead.tsx § `OriginLine`). The two states
 * with no address have none at all, because their text is the sentence.
 */
const names = () =>
  [...host.querySelectorAll("[aria-label]")].map((el) => el.getAttribute("aria-label"));

describe("the origin line under the title", () => {
  it("points the owner at the original when the article has a web address", async () => {
    await mount({ url: "https://example.com/the-piece" }, true);

    /* Twice on purpose: the title itself, which has always been a link, and the
       origin line, which is the half a reader can actually see is a link. */
    expect(hrefs().filter((h) => h === "https://example.com/the-piece")).toHaveLength(2);
    /* The host in the name, because "View the original" alone does not say
       whose site you are about to be sent to. */
    expect(names()).toContain("View the original at example.com");
    expect(host.textContent).not.toContain(UPLOADED);
  });

  /**
   * **The whole of the 2026-09-06 change, in one assertion.** The address used
   * to be reachable only by hovering an arrow or by clicking the title to find
   * out; it is on the page now. Asserted on the *text* rather than on the
   * `href`, because an `href` nobody can read is exactly the state this
   * replaced.
   */
  it("prints the address itself, host first and path after it", async () => {
    await mount({ url: "https://www.example.com/2026/the-piece/" }, true);

    /* `hostOf`'s doing: no scheme, no `www.`. The trailing slash goes with it —
       one page, and only one of the two spellings looks deliberate. */
    expect(host.textContent).toContain("example.com");
    expect(host.textContent).toContain("/2026/the-piece");
    expect(host.textContent).not.toContain("https://");
    /* And the address the link actually goes to is untouched by any of that. */
    expect(hrefs()).toContain("https://www.example.com/2026/the-piece/");
  });

  /**
   * **What is drawn is the address the link goes to, or it is not worth
   * drawing.** Three ways the first version's `pathOf` broke that, all found by
   * GPT Sol on 2026-09-06 and none of them visible on a normal article: it
   * stripped a trailing slash from the whole `pathname + search + hash` rather
   * than from the path, so a query or a fragment ending in one came out
   * *different*; and it took the host from `hostOf`, which reports
   * `URL.hostname` and so silently dropped a non-default port.
   *
   * A line whose whole job is provenance may not show one address and follow
   * another, however small the difference.
   */
  it("shows the address it actually links to, down to the query and the port", async () => {
    for (const [url, shown] of [
      ["https://example.com/a?next=/", "example.com/a?next=/"],
      ["https://example.com/a#section/", "example.com/a#section/"],
      ["https://example.com:8443/p", "example.com:8443/p"],
    ] as const) {
      await mount({ url }, true);
      expect({ url, shown: host.querySelector(".origin-link")?.textContent }).toEqual({
        url,
        shown,
      });
      expect(hrefs()).toContain(url);
    }
  });

  /**
   * **A malformed address is not printed**, and this is a sink that did not
   * exist before the line did. `webSource`'s allowlist is a `/^https?:\/\//`
   * regex rather than a parse (src/web/SourceLink.tsx), so a value like this
   * reaches the masthead — and an *imported* article's metadata goes straight
   * into the row. React escapes it, so it was never markup; it could still be a
   * screenful of control characters under the title. GPT Sol, 2026-09-06.
   */
  it("refuses to print an address it cannot parse, and still offers the way out", async () => {
    await mount({ url: "https://[bad" }, true);

    expect(host.textContent).not.toContain("[bad");
    /* The words instead, and the link still there: nothing dangerous can reach
       this `href` — `webSource` refuses every scheme but `http(s)` — so the
       reader keeps the way out and loses only the unreadable text. */
    expect(host.querySelector(".origin-link")?.textContent).toBe("View the original");
    expect(hrefs()).toContain("https://[bad");
  });

  it("tells the owner an article with no web address was uploaded", async () => {
    await mount({ source: "pdf" }, true);

    expect(host.textContent).toContain(UPLOADED);
    /* And the sentence is *all* it is: an upload has nowhere to send anybody, so
       the line must not have grown a link out. (This read `hrefs()` for a `null`
       until 2026-09-06, which the `a[href]` selector had already made
       impossible — a check that could never fail. GPT Sol.) */
    expect(hrefs()).not.toContain("");
    expect(host.querySelectorAll(".origin a")).toHaveLength(0);
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

    expect(host.textContent).not.toContain(UPLOADED);
    /* And it says the true thing rather than nothing: the owner is looking at
       their own library and the gap is a fact about it. */
    expect(host.textContent).toContain(UNRECORDED);
  });

  /**
   * **The one this file exists for.** A visitor *does* get a `url` when we have
   * one to give — that is the test three above. What they never get is the
   * *inference*: an absent `PublicMeta.url` means an upload or an address
   * `publicSourceUrl` withheld, so the same absence must produce no claim at all
   * rather than the claim above.
   */
  it("tells a visitor nothing, because it cannot tell", async () => {
    await mount({ source: "pdf" }, false);

    expect(host.textContent).not.toContain(UPLOADED);
    /* Nor the other half of the line: a visitor gets no origin state at all,
       rather than the one we happen to be able to infer. */
    expect(host.textContent).not.toContain(UNRECORDED);
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
    expect(host.textContent).toContain(UPLOADED);
  });
});
