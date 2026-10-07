/**
 * Path routing — src/web/router.ts. Pure string work, no DOM.
 *
 * The case worth having a test for is the *degradation*: an address nobody
 * meant to type has to land somewhere sensible rather than render nothing. A
 * blank page from a stray slash is the sort of failure that looks like the app
 * is broken rather than like the link was.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  settleAddress,
  ADMIN_FEEDBACK_HREF,
  ADMIN_HREF,
  ADMIN_USERS_HREF,
  addHref,
  addUploadHref,
  addUrlFrom,
  addUrlFromQuery,
  canonicalAddHref,
  carriedSearch,
  CONTACT_HREF,
  HELP_HREF,
  liftedLegacyHref,
  liftedTweetsHref,
  navigate,
  PRIVACY_HREF,
  FEATURES_HREF,
  PRICING_HREF,
  parseRoute,
  readHref,
} from "../src/web/router.js";

describe("parseRoute", () => {
  it("reads the slug out of /read/<slug>", () => {
    expect(parseRoute("/read/noema-mythology-of-conscious-ai")).toEqual({
      kind: "read",
      slug: "noema-mythology-of-conscious-ai",
      view: "article",
    });
  });

  it("accepts the trailing slash, because links gain and lose them", () => {
    expect(parseRoute("/read/example/")).toEqual({
      kind: "read",
      slug: "example",
      view: "article",
    });
  });

  /**
   * The decode still happens — the fixture changed, because the old one could
   * not exist.
   *
   * This case read `/read/a%20b` → `slug: "a b"` until `parseRoute` grew an
   * `isSlug` guard. `isSlug` is `^[a-z0-9][a-z0-9-]*$` with a 60-character cap
   * (src/ingest.ts), and its own comment calls it a path-traversal guard rather
   * than a tidiness check, because a slug is joined onto `data/` and `output/`.
   * So no article has ever had a space in its slug and none ever can, and the
   * server 400s the address. `%2D` is a percent-encoded hyphen: a legal slug,
   * spelled in a way that still has to be decoded to be recognised.
   */
  it("decodes an escaped slug", () => {
    expect(parseRoute("/read/a%2Db")).toEqual({ kind: "read", slug: "a-b", view: "article" });
  });

  /**
   * **An address the server could never answer is a mistyped address**, and a
   * mistyped address is `not-found` — which is what this file's own opening
   * paragraph says the degradation is for. It landed on the shelf until
   * 2026-09-03; the premise did not change, the destination did.
   *
   * Before the guard, `/read/Upper` became an article route: the client asked
   * for it, the API refused it with the 400 it gives every malformed slug, and
   * the reader got an error page. GPT Sol's stage 2 design § 5.
   *
   * The three shapes are chosen to be different failures rather than three of
   * one: a capital letter, a leading hyphen (the path-traversal shape `../` is
   * a leading punctuation mark too), and a slug past the 60-character cap — the
   * one an alphabet-only check would wave straight through.
   */
  it("sends an address that is not a slug to the not-found page instead of rendering an error", () => {
    expect(parseRoute("/read/Upper")).toEqual({ kind: "not-found" });
    expect(parseRoute("/read/-leading")).toEqual({ kind: "not-found" });
    expect(parseRoute(`/read/${"a".repeat(61)}`)).toEqual({ kind: "not-found" });
    /* And the control: one character shorter is a slug, and still reads. If the
       cap moved, the case above would pass for the wrong reason. */
    expect(parseRoute(`/read/${"a".repeat(60)}`)).toEqual({
      kind: "read",
      slug: "a".repeat(60),
      view: "article",
    });
  });

  it("reads the third segment as the view", () => {
    expect(parseRoute("/read/example/metadata")).toEqual({
      kind: "read",
      slug: "example",
      view: "metadata",
    });
  });

  it("no longer knows `/tweets`, which is a mode since 2026-09-29", () => {
    /* The old page's address is lifted to `?mode=tweets` before anything parses
       it — `settleAddress`, `navigate()` and `useRoute` (§ lifting the old
       Tweets address, below). Parsed raw, it is simply not a view. */
    expect(parseRoute("/read/example/tweets")).toEqual({ kind: "not-found" });
  });

  it("accepts the trailing slash on a view too — Greg wrote the route with one", () => {
    expect(parseRoute("/read/example/metadata/")).toEqual({
      kind: "read",
      slug: "example",
      view: "metadata",
    });
  });

  /**
   * **The reversal, and the two exceptions to it** —
   * docs/plans/260903j-not-found-page.md.
   *
   * Every path in the first list was `library` until 2026-09-03, which is what
   * Greg met at `/asdf`: a plausible page at an address that means nothing, so
   * a link that had rotted looked exactly like one that worked.
   *
   * `/read` and `/read/` are in it deliberately. They are a prefix of ours with
   * nothing after it, and the temptation is to read that as "the articles" and
   * send it to the shelf — but the shelf is `/`, nothing in the app links to
   * `/read`, and an exception costs a rule that has to be remembered. It is an
   * address nobody minted, like the rest.
   */
  it("sends anything else to the not-found page", () => {
    for (const path of ["/read", "/read/", "/read/a/b", "/nonsense", "/asdf"]) {
      expect(parseRoute(path), path).toEqual({ kind: "not-found" });
    }
  });

  /**
   * **The root is the shelf, and it needs saying because it stopped being free.**
   *
   * `/` was the fall-through's freeloader: it had no branch of its own, and the
   * moment the fall-through became `not-found` the homepage would have become a
   * 404 with nothing in the diff to suggest it. `""` is what a caller passes
   * when it has no address at all, and means the same thing.
   *
   * **`/index.html` is the third spelling**, and it is the one that would have
   * gone quietly: nothing in the app links to it and the manifest starts at
   * `/`, so no test would have missed it — but it is the file this whole app
   * *is*, served under its own name by Vite and by every static host, and an
   * app that 404s its own entry point is a bug report nobody should have to
   * file. GPT Sol's review, 2026-09-03.
   */
  it("keeps all three spellings of the root on the shelf", () => {
    for (const path of ["/", "", "/index.html"]) {
      expect(parseRoute(path), path).toEqual({ kind: "library" });
    }
  });

  it("sends an unknown view to the not-found page rather than a blank article page", () => {
    for (const path of ["/read/example/nonsense", "/read/example/metadata/x"]) {
      expect(parseRoute(path), path).toEqual({ kind: "not-found" });
    }
  });

  it("survives a malformed escape rather than throwing out of the render", () => {
    expect(parseRoute("/read/%E0%A4%A")).toEqual({ kind: "not-found" });
  });
});

/**
 * `/admin`, `/admin/users` and `/admin/feedback` — see src/web/AdminPage.tsx.
 *
 * **Parsing an address says nothing about being allowed to use it.** These
 * routes exist for everybody; App.tsx renders the shelf for anybody who is not
 * the administrator, and the refusal that matters is the server's on
 * `/api/admin`. So nothing here is a security test, and it must not be read as
 * one — it is about the two spellings Greg wrote, and the ones that must not
 * match. docs/project/admin.md.
 */
describe("the admin routes", () => {
  it("takes both of the addresses, with or without the trailing slash", () => {
    for (const path of ["/admin", "/admin/"]) {
      expect(parseRoute(path), path).toEqual({ kind: "admin", page: "home" });
    }
    for (const path of ["/admin/users", "/admin/users/"]) {
      expect(parseRoute(path), path).toEqual({ kind: "admin", page: "users" });
    }
    for (const path of ["/admin/feedback", "/admin/feedback/"]) {
      expect(parseRoute(path), path).toEqual({ kind: "admin", page: "feedback" });
    }
  });

  it("sends anything else under /admin to the not-found page, like every other unknown address", () => {
    /* The alternation in the regex is the validation. A third admin page is a
       word added there, not a path that silently half-works.

       **An address under `/admin` is not the same as `/admin` for somebody who
       is not the administrator.** That one still gets the shelf, decided in
       App.tsx, and docs/project/admin.md says why: the admin pages are in every
       signed-in reader's bundle, so 403 is the honest posture and a 404 would
       be pretending about something anyone can see is there. This is the
       client's version of the server's own split — `/api/admin/anything` is a
       403 and `/api/administer` is a 404. */
    for (const path of [
      "/admin/nonsense",
      "/admin/users/extra",
      "/admin/feedback/extra",
      "/adminx",
      "/admin/USERS",
      "/admin/FEEDBACK",
    ]) {
      expect(parseRoute(path), path).toEqual({ kind: "not-found" });
    }
  });

  it("is spelled once, by the constants the links use", () => {
    /* A link that does not parse lands the reader on the 404 page while the
       address bar says otherwise. That is at least visible — it landed silently
       on the shelf until 2026-09-03 — but a link inside the app should never
       reach it, and the constant is what makes sure. */
    expect(parseRoute(ADMIN_HREF)).toEqual({ kind: "admin", page: "home" });
    expect(parseRoute(ADMIN_USERS_HREF)).toEqual({ kind: "admin", page: "users" });
    expect(parseRoute(ADMIN_FEEDBACK_HREF)).toEqual({ kind: "admin", page: "feedback" });
  });
});

describe("the features route", () => {
  it("parses, with and without a trailing slash, and from its own constant", () => {
    expect(parseRoute("/features")).toEqual({ kind: "features" });
    expect(parseRoute("/features/")).toEqual({ kind: "features" });
    expect(parseRoute(FEATURES_HREF)).toEqual({ kind: "features" });
  });

  it("is not a prefix: an address under it is nobody's", () => {
    expect(parseRoute("/features/zoom")).toEqual({ kind: "not-found" });
  });

  /* A static page must survive the boot-time address settling untouched, or a
     stranger following the landing page's link is rewritten away from the page
     they asked for. */
  it("is left alone by settleAddress", () => {
    expect(settleAddress("/features", "", "")).toBeNull();
  });
});

describe("the contact route", () => {
  it("parses, with and without a trailing slash, and from its own constant", () => {
    expect(parseRoute("/contact")).toEqual({ kind: "contact" });
    expect(parseRoute("/contact/")).toEqual({ kind: "contact" });
    expect(parseRoute(CONTACT_HREF)).toEqual({ kind: "contact" });
  });

  it("is not a prefix: an address under it is nobody's", () => {
    expect(parseRoute("/contact/us")).toEqual({ kind: "not-found" });
  });
});

describe("the help route", () => {
  it("parses, with and without a trailing slash, and from its own constant", () => {
    expect(parseRoute("/help")).toEqual({ kind: "help" });
    expect(parseRoute("/help/")).toEqual({ kind: "help" });
    expect(parseRoute(HELP_HREF)).toEqual({ kind: "help" });
  });

  /* Since 2026-10-07 a page of Help is a path (help-anchors.ts § helpHref).
     docs/plans/261007e-help-back-in-the-bar-and-help-as-markdown-pages-by-mode-and-theme-with-reader-guides.md
     § Routing and old links. */
  it("gives Help one segment under it, with or without a trailing slash", () => {
    expect(parseRoute("/help/spine")).toEqual({ kind: "help", page: "spine" });
    expect(parseRoute("/help/spine/")).toEqual({ kind: "help", page: "spine" });
    expect(parseRoute("/help/questions")).toEqual({ kind: "help", page: "questions" });
  });

  /* Whether the segment names a page is Help's to say, so the router imports
     none of Help and Help can answer a wrong address itself
     (help-anchors.ts § resolveHelpPage). */
  it("does not judge the segment, and hands it over decoded", () => {
    expect(parseRoute("/help/nonsense")).toEqual({ kind: "help", page: "nonsense" });
    expect(parseRoute("/help/mode-trajectory")).toEqual({ kind: "help", page: "mode-trajectory" });
    expect(parseRoute("/help/mode%2Dskim")).toEqual({ kind: "help", page: "mode-skim" });
    /* A mangled escape is handed over as it came rather than thrown on. */
    expect(parseRoute("/help/%E0%A4%A")).toEqual({ kind: "help", page: "%E0%A4%A" });
  });

  it("is one segment deep and no more, and is not a prefix of another word", () => {
    expect(parseRoute("/help/a/b")).toEqual({ kind: "not-found" });
    expect(parseRoute("/help/spine/more")).toEqual({ kind: "not-found" });
    expect(parseRoute("/help//")).toEqual({ kind: "not-found" });
    expect(parseRoute("/helpful")).toEqual({ kind: "not-found" });
  });

  /* An old link into Help is all fragment (`/help#spine`), and a question's
     still is (`/help/questions#faq-…`). Nothing on the way in may rewrite
     either: the page itself carries the old one over (HelpPage.tsx §
     Arriving), and it needs the fragment to do it. */
  it("is left alone by settleAddress, fragment and all", () => {
    expect(settleAddress("/help", "", "#spine")).toBeNull();
    expect(settleAddress("/help", "", "#mode-trajectory")).toBeNull();
    expect(settleAddress("/help/spine", "", "")).toBeNull();
    expect(settleAddress("/help/questions", "", "#faq-older-profile")).toBeNull();
  });
});

describe("the pricing route", () => {
  it("parses, with and without a trailing slash, and from its own constant", () => {
    expect(parseRoute("/pricing")).toEqual({ kind: "pricing" });
    expect(parseRoute("/pricing/")).toEqual({ kind: "pricing" });
    expect(parseRoute(PRICING_HREF)).toEqual({ kind: "pricing" });
  });

  it("is not a prefix: an address under it is nobody's", () => {
    expect(parseRoute("/pricing/reader")).toEqual({ kind: "not-found" });
  });

  /* A static page must survive the boot-time address settling untouched, or a
     stranger following the landing page's link is rewritten away from the page
     they asked for — and this is the one somebody sends somebody else, so it is
     the link most likely to be followed cold. */
  it("is left alone by settleAddress", () => {
    expect(settleAddress("/pricing", "", "")).toBeNull();
  });
});

describe("the privacy route", () => {
  /* It is three lines of regex, and it is tested for the reason every other
     standalone route here is: a link that does not parse lands the reader on
     the 404 page with the address bar still saying `/privacy`. The policy is
     also the one page a reader may have been *sent* a link to, so a link that
     goes nowhere is worse here than on `/design` — and telling them so, which
     is what that page did not do until 2026-09-03, does not make the link work.
     See src/web/PrivacyPage.tsx. */
  it("takes the address with or without the trailing slash", () => {
    expect(parseRoute("/privacy")).toEqual({ kind: "privacy" });
    expect(parseRoute("/privacy/")).toEqual({ kind: "privacy" });
  });

  it("is spelled once, by the constant the two links use", () => {
    expect(parseRoute(PRIVACY_HREF)).toEqual({ kind: "privacy" });
  });

  it("does not swallow anything underneath it", () => {
    /* `/privacy/cookies` is an address nobody minted, and an unknown address is
       the not-found page — the same rule `/admin/foo` follows above. It must not
       become the policy page, because a reader who typed it would be told they
       were reading a document that does not answer what they asked. */
    expect(parseRoute("/privacy/cookies")).toEqual({ kind: "not-found" });
  });
});

describe("readHref", () => {
  it("round-trips through parseRoute", () => {
    const slug = "a-slug-with-dashes";
    expect(parseRoute(readHref(slug))).toEqual({ kind: "read", slug, view: "article" });
  });

  /**
   * **The escaping stays defensive; what changed is the far end.**
   *
   * `readHref` still refuses to let a slash out into the path unescaped, and
   * that half of this case is unchanged — it is the assertion that stops a
   * `/`-carrying value silently becoming two path segments.
   *
   * The round trip no longer comes back as an article, and that is the point
   * rather than a weakening: `parseRoute` now applies `isSlug`, which no value
   * containing a slash can pass, so an encoded slash is refused at **both**
   * ends instead of being handed on to a server that would 400 it. Nothing that
   * calls `readHref` in the app can produce one — every caller passes a slug
   * the server minted, and `kebab()` in src/ingest.ts strips everything outside
   * `[a-z0-9-]` and trims to 60 characters — so this is a guard against a value
   * that should not exist, kept because it should not exist quietly.
   */
  it("escapes a slug that would otherwise change the shape of the path", () => {
    expect(readHref("a/b")).toBe("/read/a%2Fb");
    expect(parseRoute(readHref("a/b"))).toEqual({ kind: "not-found" });
  });

  it("carries view state across, with or without the leading question mark", () => {
    expect(readHref("x", "cols=0,1")).toBe("/read/x?cols=0,1");
    expect(readHref("x", "?cols=0,1")).toBe("/read/x?cols=0,1");
    expect(readHref("x", "")).toBe("/read/x");
  });

  it("spells the view as the third segment, and round-trips it", () => {
    expect(readHref("x", "", "metadata")).toBe("/read/x/metadata");
    expect(readHref("x", "at=spya-k3m9qt", "metadata")).toBe("/read/x/metadata?at=spya-k3m9qt");
    for (const view of ["article", "metadata"] as const) {
      expect(parseRoute(readHref("x", "", view)), view).toEqual({
        kind: "read",
        slug: "x",
        view,
      });
    }
  });
});

/**
 * **Lifting the old Tweets addresses.** The thread was a page at
 * `/read/<slug>/tweets` from 2026-08-25 until 2026-09-29, then the mode
 * `?mode=tweets` until 2026-10-03, when it became Summary's Thread view
 * (docs/plans/260929f-tweets-become-a-mode-with-a-wide-band-and-block-links.md,
 * docs/plans/261003l-fewer-top-level-modes-tweets-become-summary-s-thread.md).
 * Links to either are pasted, bookmarked and in a tab's own history, and each
 * must land on `?mode=summary&summary=thread` — at boot (`settleAddress`), on an
 * in-app link (`navigate()`) and on Back (`useRoute`, which shares
 * `liftedTweetsHref`). `RETIRED_MODES` alone would open Summary at Brief.
 */
describe("lifting the old Tweets addresses", () => {
  const THREAD = "mode=summary&summary=thread";

  it("sends the bare page to Summary's thread", () => {
    expect(settleAddress("/read/x/tweets", "", "")).toBe(`/read/x?${THREAD}`);
    // The trailing slash `parseRoute` accepts on every other view.
    expect(settleAddress("/read/x/tweets/", "", "")).toBe(`/read/x?${THREAD}`);
  });

  it("sends the retired mode word there too", () => {
    expect(settleAddress("/read/x", "?mode=tweets", "")).toBe(`/read/x?${THREAD}`);
    expect(settleAddress("/read/x", "?%6Dode=tweets", "")).toBe(`/read/x?${THREAD}`);
    /* On the metadata page as well: the bar's links there carry the query back
       to the article, and a carried `mode=tweets` would open Brief. */
    expect(settleAddress("/read/x/metadata", "?mode=tweets", "")).toBe(`/read/x/metadata?${THREAD}`);
  });

  it("carries the reader's place and anything else on the link", () => {
    expect(settleAddress("/read/x/tweets", "?at=spya-k3m9qt", "")).toBe(`/read/x?at=spya-k3m9qt&${THREAD}`);
    expect(settleAddress("/read/x", "?at=spya-k3m9qt&mode=tweets&margin=1&cols=0,1", "")).toBe(
      `/read/x?at=spya-k3m9qt&margin=1&cols=0,1&${THREAD}`,
    );
  });

  it("replaces a mode already on the link, because the path said which one it meant", () => {
    expect(settleAddress("/read/x/tweets", "?mode=summary&at=spya-k3m9qt", "")).toBe(
      `/read/x?at=spya-k3m9qt&${THREAD}`,
    );
  });

  it("overrides a carried `summary`, and leaves exactly one of each pair", () => {
    /* GPT Sol's F4: the legacy spelling says Thread, whatever level the link
       also carried; two `summary` pairs would let the first one win. */
    for (const [pathname, search] of [
      ["/read/x", "?summary=brief&mode=tweets"],
      ["/read/x", "?mode=tweets&summary=fuller&summary=brief"],
      ["/read/x", "?mode=tweets&%73ummary=fuller"],
      ["/read/x/tweets", "?summary=fuller"],
      ["/read/x/tweets", "?mode=glossary&summary=brief"],
    ] as const) {
      const lifted = settleAddress(pathname, search, "");
      expect(lifted, `${pathname}${search}`).toBe(`/read/x?${THREAD}`);
      const params = new URLSearchParams((lifted ?? "").split("?")[1]);
      expect(params.getAll("mode")).toEqual(["summary"]);
      expect(params.getAll("summary")).toEqual(["thread"]);
    }
  });

  it("replaces an encoded `mode` too, or the stale one would win `get(\"mode\")`", () => {
    /* `%6Dode` is `mode` to `URLSearchParams`, which returns the first match —
       so a literal-only removal would leave the reader somewhere else. The
       ninth address bug's shape (§ `hasKey`). */
    const lifted = settleAddress("/read/x/tweets", "?%6Dode=glossary", "");
    expect(lifted).toBe(`/read/x?${THREAD}`);
    expect(new URLSearchParams((lifted ?? "").split("?")[1]).getAll("mode")).toEqual(["summary"]);
  });

  it("keeps a hash", () => {
    expect(settleAddress("/read/x/tweets", "?at=spya-k3m9qt", "#section-2")).toBe(
      `/read/x?at=spya-k3m9qt&${THREAD}#section-2`,
    );
    /* A block-id hash goes on to become `?at=`, as it does on any read address
       — the lift runs first and hands the rest of the chain an ordinary one. */
    expect(settleAddress("/read/x/tweets", "", "#spya-k3m9qt")).toBe(`/read/x?at=spya-k3m9qt&${THREAD}`);
  });

  it("runs before `?about=1`, which then goes to Metadata as it does from the article", () => {
    /* The order matters: lifted second, the tweets path would already have been
       handed to `liftLegacyAbout` as a route `parseRoute` cannot read. */
    expect(settleAddress("/read/x/tweets", "?about=1", "")).toBe(`/read/x/metadata?${THREAD}`);
  });

  it("leaves everything that is not an old Tweets address alone", () => {
    expect(settleAddress("/tweets", "", "")).toBeNull();
    expect(settleAddress("/read/x/y/tweets", "", "")).toBeNull();
    expect(settleAddress("/read/x/tweetsy", "", "")).toBeNull();
    expect(settleAddress("/read/Not A Slug/tweets", "", "")).toBeNull();
    // Already there: nothing to do, which is what makes the rewrite settle.
    expect(settleAddress("/read/x", `?${THREAD}`, "")).toBeNull();
    // Summary at a length is not the thread, and another mode's word is not ours.
    expect(settleAddress("/read/x", "?mode=summary&summary=fuller", "")).toBeNull();
    expect(settleAddress("/read/x", "?mode=tweetsy", "")).toBeNull();
    expect(settleAddress("/read/x", "?find=mode%3Dtweets", "")).toBeNull();
  });

  it("`liftedTweetsHref` answers a whole href, and `null` for anything else", () => {
    expect(liftedTweetsHref("/read/x/tweets?at=spya-a#h")).toBe(`/read/x?at=spya-a&${THREAD}#h`);
    expect(liftedTweetsHref("/read/x?mode=tweets&at=spya-a#h")).toBe(`/read/x?at=spya-a&${THREAD}#h`);
    expect(liftedTweetsHref(`/read/x?${THREAD}`)).toBeNull();
    expect(liftedTweetsHref("/read/x/metadata")).toBeNull();
    expect(liftedTweetsHref("/read/x")).toBeNull();
  });

  /**
   * **Debate's *by claim* order became the Claims sub-mode** on 2026-10-03
   * (plan 261003o; GPT Sol's F7). The old value is rewritten once, here, so
   * nothing downstream reads it: a legacy fallback inside the panel would
   * bounce a reader who pressed Reception straight back to Claims, since
   * Reception is the absent parameter.
   */
  describe("lifting Debate's old by-claim order", () => {
    it("sends `debateby=claim` to the Claims sub-mode, and removes it", () => {
      expect(settleAddress("/read/x", "?mode=debate&debateby=claim", "")).toBe("/read/x?mode=debate&debate=claims");
      expect(settleAddress("/read/x", "?mode=debate&%64ebateby=claim&at=spya-k3m9qt", "")).toBe(
        "/read/x?mode=debate&at=spya-k3m9qt&debate=claims",
      );
      expect(settleAddress("/read/x/metadata", "?debateby=claim", "")).toBe("/read/x/metadata?debate=claims");
    });

    it("lets an explicit `debate=` win, and still removes the old order", () => {
      expect(settleAddress("/read/x", "?debate=reception&debateby=claim", "")).toBe("/read/x?debate=reception");
      expect(settleAddress("/read/x", "?debateby=claim&debate=claims", "")).toBe("/read/x?debate=claims");
    });

    it("leaves Reception's own orders alone, and Claims with one of them carried", () => {
      expect(settleAddress("/read/x", "?mode=debate&debateby=stance", "")).toBeNull();
      expect(settleAddress("/read/x", "?mode=debate&debateby=date", "")).toBeNull();
      /* `debate=claims&debateby=date` is Claims; `debateby` is Reception's and
         waits there. Nothing to rewrite. */
      expect(settleAddress("/read/x", "?debate=claims&debateby=date", "")).toBeNull();
      expect(settleAddress("/read/x", "?find=debateby%3Dclaim", "")).toBeNull();
    });

    /* What makes the rewrite settle, and what keeps Reception reachable: the
       address a press on Reception writes from a lifted link has no `debate`
       and no `debateby`, and it is left exactly so. */
    it("settles: the lifted address, and the one Reception then writes, are both left alone", () => {
      const lifted = settleAddress("/read/x", "?mode=debate&debateby=claim", "") ?? "";
      const at = lifted.indexOf("?");
      expect(settleAddress(lifted.slice(0, at), lifted.slice(at), "")).toBeNull();
      expect(settleAddress("/read/x", "?mode=debate", "")).toBeNull();
    });

    it("is lifted on Back and on `navigate()` too, through `liftedLegacyHref`", () => {
      expect(liftedLegacyHref("/read/x?mode=debate&debateby=claim#h")).toBe("/read/x?mode=debate&debate=claims#h");
      expect(liftedLegacyHref("/read/x?mode=debate&debateby=stance")).toBeNull();
      /* Both old spellings on one link. */
      expect(liftedLegacyHref("/read/x/tweets?debateby=claim")).toBe(`/read/x?${THREAD}&debate=claims`);
      expect(liftedLegacyHref("/read/x/tweets")).toBe(`/read/x?${THREAD}`);
      expect(liftedLegacyHref("/read/x")).toBeNull();
    });
  });

  describe("navigate()", () => {
    /* This file is node rather than jsdom, so the three globals `navigate`
       touches are posed — which also lets the test read exactly what was
       written to history, rather than trusting a URL jsdom resolved. */
    const written: string[] = [];
    function pose(pathname: string, search = "", hash = ""): void {
      written.length = 0;
      vi.stubGlobal("location", { pathname, search, hash });
      vi.stubGlobal("history", {
        pushState: (_s: unknown, _t: string, href: string) => written.push(`push ${href}`),
        replaceState: (_s: unknown, _t: string, href: string) => written.push(`replace ${href}`),
      });
      vi.stubGlobal("window", { dispatchEvent: () => true, scrollTo: () => {} });
    }
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("lands an old link on Summary's thread", () => {
      pose("/read/x");
      navigate("/read/x/tweets?at=spya-k3m9qt");
      expect(written).toEqual([`push /read/x?at=spya-k3m9qt&${THREAD}`]);
    });

    it("and the retired mode word, on a client navigation", () => {
      pose("/read/y");
      navigate("/read/x?mode=tweets");
      expect(written).toEqual([`push /read/x?${THREAD}`]);
    });

    it("and with `replace`", () => {
      pose("/read/x");
      navigate("/read/x/tweets", { replace: true });
      expect(written).toEqual([`replace /read/x?${THREAD}`]);
    });

    it("writes nothing when the old link names where the reader already is", () => {
      /* The `href === location` guard compares the *lifted* address — or an old
         link clicked from inside the thread would push a duplicate entry. */
      pose("/read/x", `?${THREAD}`);
      navigate("/read/x/tweets");
      expect(written).toEqual([]);
    });

    it("clears a hash when the old link does not carry it", () => {
      /* A hash is part of the destination. Comparing only path and search made
         this look like the same address after the legacy link was lifted, so
         the hash from the page being left survived the navigation. */
      pose("/read/x", `?${THREAD}`, "#old-section");
      navigate("/read/x/tweets");
      expect(written).toEqual([`push /read/x?${THREAD}`]);
    });

    it("the positive control: an ordinary address goes through as written", () => {
      pose("/read/x");
      navigate("/read/x/metadata");
      expect(written).toEqual(["push /read/x/metadata"]);
    });
  });
});

describe("carriedSearch", () => {
  it("keeps the reader's place when they step off the article and back", () => {
    expect(carriedSearch("?at=spya-k3m9qt&crits=spya-a,spya-b&mode=summary")).toBe(
      "at=spya-k3m9qt&crits=spya-a,spya-b&mode=summary",
    );
  });

  it("leaves the commas in a list alone, so a pasted link stays readable", () => {
    expect(carriedSearch("?crits=spya-a,spya-b")).toContain("crits=spya-a,spya-b");
  });

  it("drops the drawer, which is not a place you were", () => {
    expect(carriedSearch("?panel=questions&at=spya-k3m9qt")).toBe("at=spya-k3m9qt");
    expect(carriedSearch("?panel=questions")).toBe("");
  });

  it("takes a search string with or without the question mark, and an empty one", () => {
    expect(carriedSearch("mode=summary")).toBe("mode=summary");
    expect(carriedSearch("")).toBe("");
    expect(carriedSearch("?")).toBe("");
  });
});

/**
 * `/add/<a whole URL>` — the one route whose parameter is somebody else's
 * address rather than one of our slugs.
 *
 * Two spellings reach `parseRoute`: the raw paste Greg asked for, and the
 * percent-encoded one `addHref` mints. The tests that matter are the ones where
 * telling them apart could go wrong — a URL with a query string, which the
 * browser splits off into `location.search` unless it has been encoded, and a
 * URL with a port, whose extra colon must not confuse the raw/encoded test.
 */
describe("the add route", () => {
  it("reads a raw pasted URL straight out of the path", () => {
    expect(parseRoute("/add/https://example.com/an-essay")).toEqual({
      kind: "add",
      url: "https://example.com/an-essay",
    });
  });

  it("reads the encoded spelling addHref mints", () => {
    expect(parseRoute(addHref("https://example.com/an-essay?utm=1"))).toEqual({
      kind: "add",
      url: "https://example.com/an-essay?utm=1",
    });
  });

  it("round-trips a URL with a query string, which raw form cannot", () => {
    const url = "https://example.com/x?a=1&b=2#frag";
    const route = parseRoute(addHref(url));
    expect(route).toEqual({ kind: "add", url });
  });

  it("is not confused by a port, whose colon is not an encoding signal", () => {
    expect(parseRoute("/add/http://localhost:3000/x")).toEqual({
      kind: "add",
      url: "http://localhost:3000/x",
    });
  });

  it("sends /add and /add/ to the shelf, where the add box is", () => {
    expect(parseRoute("/add")).toEqual({ kind: "library" });
    expect(parseRoute("/add/")).toEqual({ kind: "library" });
  });

  /**
   * **And an `/add/` carrying something unusable is still an add route** — not
   * the shelf, and not the 404 page.
   *
   * `addUrlFrom` hands back whatever follows the prefix without judging it, so
   * this reaches `AddPage`, which says *that isn't a web address we can fetch*
   * over the thing the reader actually typed. That is a better answer than
   * either of the general ones, and it is asserted here because the plan for
   * the 404 page claimed the opposite until GPT Sol read it — an empty segment
   * is the only case that falls through. 2026-09-03.
   */
  it("leaves a bad address in /add/ to the add page, which can say what is wrong with it", () => {
    expect(parseRoute("/add/not a url")).toEqual({ kind: "add", url: "not a url" });
  });

  it("survives a hand-mangled escape rather than blanking the page", () => {
    // `decodeURIComponent` throws on this; an uncaught URIError during render
    // is a white screen over a typo in the address bar.
    expect(parseRoute("/add/%E0%A4%A")).toEqual({ kind: "add", url: "%E0%A4%A" });
  });

  /* Not a round trip: the point is that the ENCODED form of a URL which is
     itself full of escapes survives being read as an encoded segment, rather
     than being decoded a second time down to the bare characters. */
  it("decodes exactly once, however many escapes the URL itself carries", () => {
    const url = "https://example.com/a%2Fb%20c";
    expect(parseRoute(addHref(url))).toEqual({ kind: "add", url });
    // And the segment really is doubly-escaped in the address.
    expect(addHref(url)).toContain("%252F");
  });
});

/**
 * The half `parseRoute` cannot do, because it is only ever handed a pathname:
 * a raw paste has had its query string and fragment taken off it by the browser
 * before anybody looks, and main.tsx is the only place they can be put back.
 */
/**
 * `/add/upload/<uploadId>` — the one `/add/` address whose parameter is one of
 * ours rather than somebody else's.
 */
describe("the upload route", () => {
  const ID = "069894e5-aa66-48b0-8e25-a35c508777ef";

  it("reads an upload id, and the href round-trips", () => {
    expect(parseRoute(`/add/upload/${ID}`)).toEqual({ kind: "add-upload", uploadId: ID });
    expect(parseRoute(addUploadHref(ID))).toEqual({ kind: "add-upload", uploadId: ID });
  });

  /* An id is hex, and a URL path is not reliably one case or the other — a
     copied address can arrive shouting. Lower-cased on the way in so that the
     server, which matches lower-case, is asked about the same string. */
  it("accepts the shouted spelling, and a trailing slash", () => {
    expect(parseRoute(`/add/upload/${ID.toUpperCase()}/`)).toEqual({
      kind: "add-upload",
      uploadId: ID,
    });
  });

  /**
   * **Thirty-six hyphens are the right length and the right alphabet.**
   *
   * `[0-9a-f-]{36}` matched them, and this is the second time that exact regex
   * has appeared in this codebase — the first was `isStagingKey` in
   * src/source.ts, found by a cross-family review; this one was found by the
   * next review, two weeks later. Not a security hole either time, because the
   * server refuses the id anyway. What it did was render a whole ingest page
   * for an address that could never mean anything.
   */
  it("refuses the things that are shaped like an id and are not one", () => {
    for (const bad of [
      "-".repeat(36),
      "069894e5aa6648b08e25a35c508777ef",
      "069894e5-aa66-48b0-8e25-a35c50877",
      "069894e5-aa66-48b0-8e25-a35c508777efff",
      "nope",
    ]) {
      expect(parseRoute(`/add/upload/${bad}`).kind, bad).not.toBe("add-upload");
    }
  });

  /* It has to win over the general `/add/<a whole URL>` branch, which reads
     everything after the prefix as an address. Losing that race would land the
     reader on the shelf with their file already in the object store and nothing
     pointing at it. */
  it("is matched before the general add route, not after it", () => {
    expect(parseRoute(`/add/upload/${ID}`).kind).toBe("add-upload");
    expect(parseRoute("/add/https://example.com/upload/x").kind).toBe("add");
  });

  /**
   * **The reload bug, and it was live.**
   *
   * `canonicalAddHref` runs on every load in main.tsx and rewrites an `/add/`
   * path to the encoded spelling `addHref` mints. It did not know about upload
   * addresses, so it read `/add/upload/<uuid>` as the *URL* `upload/<uuid>`,
   * percent-encoded the slash, and sent the reader to
   * `/add/upload%2F<uuid>` — which matches no route and rendered "That isn't a
   * web address we can fetch". The page the whole upload flow navigates to
   * could not be reloaded, which is most of the reason it has an address.
   *
   * Every unit test passed while that was true, because the rewrite is
   * something main.tsx does rather than something `parseRoute` decides. It took
   * pressing reload in a real browser. See browser-testing.md.
   */
  it("is left alone by the canonicalising rewrite", () => {
    expect(canonicalAddHref(`/add/upload/${ID}`, "", "")).toBeNull();
    expect(canonicalAddHref(`/add/upload/${ID}/`, "", "")).toBeNull();
    /* And an ordinary add address is still canonicalised — a guard that turned
       the rewrite off for everything would pass the two lines above. */
    expect(canonicalAddHref("/add/https://example.com/an-essay", "", "")).not.toBeNull();
  });
});

describe("addUrlFrom", () => {
  it("puts a raw URL's query string and fragment back on", () => {
    expect(addUrlFrom("/add/https://example.com/x", "?a=1&b=2", "#frag")).toBe(
      "https://example.com/x?a=1&b=2#frag",
    );
  });

  it("leaves an encoded segment alone — its search belongs to us, not to it", () => {
    expect(addUrlFrom(addHref("https://example.com/x?a=1"), "", "")).toBe(
      "https://example.com/x?a=1",
    );
  });

  it("is empty for anything that is not an add address", () => {
    expect(addUrlFrom("/read/example")).toBe("");
    expect(addUrlFrom("/add/")).toBe("");
  });
});

/**
 * The rewrite that runs before React mounts — `canonicalAddHref`, called from
 * main.tsx.
 *
 * It is a function rather than four lines inside main.tsx **because of this
 * block**. Module-init side effects cannot be tested, and every case below was
 * a real bug found by reading rather than by running: GPT Sol's review,
 * 2026-08-26.
 */
describe("canonicalAddHref", () => {
  const encoded = (url: string) => addHref(url);

  it("canonicalises a raw pasted URL, query string and all", () => {
    expect(canonicalAddHref("/add/https://x.test/a", "?utm=1", "")).toBe(
      encoded("https://x.test/a?utm=1"),
    );
  });

  /* Each of these was eaten by one of the three legacy rewrites in main.tsx,
     which used to run first. They read `location.search` and `location.hash`,
     and on a raw add address those belong to the PASTED url. */
  describe("survives the query strings the legacy rewrites are looking for", () => {
    it("?slug=, which used to navigate to /read/ and queue nothing at all", () => {
      expect(canonicalAddHref("/add/https://x.test/a", "?slug=story", "")).toBe(
        encoded("https://x.test/a?slug=story"),
      );
    });

    it("?about=, which used to strip the query and add a different page", () => {
      expect(canonicalAddHref("/add/https://x.test/a", "?about=1", "")).toBe(
        encoded("https://x.test/a?about=1"),
      );
    });

    it("#spya-…, which used to become a real ?at= parameter", () => {
      expect(canonicalAddHref("/add/https://x.test/a", "", "#spya-k6fpme")).toBe(
        encoded("https://x.test/a#spya-k6fpme"),
      );
    });
  });

  it("keeps a query string on a scheme-less URL, which has no : and no / to go by", () => {
    // The classifier reads a segment with neither as already-encoded. A query
    // string settles it before the segment's shape is looked at — without that
    // this lost `?edition=2` and added a different article.
    expect(canonicalAddHref("/add/example.com", "?edition=2", "")).toBe(
      encoded("example.com?edition=2"),
    );
  });

  it("takes the whole rest of the query for ?add=, & and ? included", () => {
    expect(canonicalAddHref("/", "?add=https://x.test/a?x=1&y=2", "")).toBe(
      encoded("https://x.test/a?x=1&y=2"),
    );
  });

  it("leaves a + alone in ?add=, because a URL is not a form", () => {
    expect(canonicalAddHref("/", "?add=https://x.test/a+b", "")).toBe(
      encoded("https://x.test/a+b"),
    );
  });

  it("accepts an encoded ?add= too", () => {
    expect(canonicalAddHref("/", `?add=${encodeURIComponent("https://x.test/a?x=1")}`, "")).toBe(
      encoded("https://x.test/a?x=1"),
    );
  });

  /* Each of these is a second-pass finding (GPT Sol, 2026-08-26): the first
     round of fixes introduced two of them and left one. */
  describe("does not let the target URL's own shape hijack the rewrite", () => {
    it("keeps an add= that belongs to the article, not to us", () => {
      // With ?add= consulted before the path, this canonicalised to /add/2 —
      // the target URL's own parameter read as ours, and replaced it.
      expect(canonicalAddHref("/add/https://x.test/article", "?add=2", "")).toBe(
        encoded("https://x.test/article?add=2"),
      );
    });

    it("ignores an add= that is not at a parameter boundary", () => {
      // Only the first `?` in a URL begins its query; `[?&]` matched the one
      // inside a value too.
      expect(addUrlFromQuery("?next=/somewhere?add=x")).toBe("");
      expect(canonicalAddHref("/", "?next=/somewhere?add=x", "")).toBeNull();
    });

    it("decodes an encoded segment before putting its query back on", () => {
      // Reading the mere presence of a query as proof the segment was raw
      // double-encoded this into something that is not a URL at all.
      expect(canonicalAddHref("/add/https%3A%2F%2Fx.test%2Fa", "?edition=2", "")).toBe(
        encoded("https://x.test/a?edition=2"),
      );
      expect(parseRoute(addHref("https://x.test/a?edition=2"))).toEqual({
        kind: "add",
        url: "https://x.test/a?edition=2",
      });
    });
  });

  it("is null when there is nothing to rewrite", () => {
    expect(canonicalAddHref("/", "", "")).toBeNull();
    expect(canonicalAddHref("/read/example", "?at=spya-k6fpme", "")).toBeNull();
    expect(canonicalAddHref("/add/", "", "")).toBeNull();
    // Already canonical: no second replaceState, and no rewrite loop.
    const href = encoded("https://x.test/a?x=1");
    expect(canonicalAddHref(href, "", "")).toBeNull();
  });

  it("is idempotent, so a rewrite can never chase its own tail", () => {
    const once = canonicalAddHref("/add/https://x.test/a", "?x=1", "");
    expect(once).not.toBeNull();
    expect(canonicalAddHref(once as string, "", "")).toBeNull();
  });
});

describe("addUrlFromQuery", () => {
  it("ignores a parameter that merely ends in add", () => {
    expect(addUrlFromQuery("?padd=https://x.test/a")).toBe("");
    expect(addUrlFromQuery("?at=spya-k6fpme")).toBe("");
  });

  it("reads add= from the middle, taking everything after it", () => {
    expect(addUrlFromQuery("?cols=0,1&add=https://x.test/a?b=1")).toBe("https://x.test/a?b=1");
  });

  it("is empty for an empty value", () => {
    expect(addUrlFromQuery("?add=")).toBe("");
    expect(addUrlFromQuery("")).toBe("");
  });
});

/**
 * The callback route, and the rewrite it must dodge.
 *
 * The point is not that `/auth/callback` parses — it is that **no rewrite
 * touches it**. `canonicalAddHref` reads `location.search` as part of an
 * article's address, which is its whole job, so a Google return landing on any
 * `/add/…` spelling would fold our one-time authorisation code into a
 * stranger's URL and then ingest would fetch it. GPT Sol, 2026-08-26.
 *
 * main.tsx does the exempting (it is module-init side effects, which nothing
 * can test); what is tested here is the pure function it guards, so that the
 * two cannot drift apart without something going red.
 */
describe("the auth callback", () => {
  it("is its own route", () => {
    expect(parseRoute("/auth/callback")).toEqual({ kind: "callback" });
    expect(parseRoute("/auth/callback/")).toEqual({ kind: "callback" });
  });

  it("is not mistaken for an article, an add, or the shelf", () => {
    expect(parseRoute("/auth/callback").kind).not.toBe("read");
    expect(parseRoute("/auth/callback").kind).not.toBe("add");
    expect(parseRoute("/login")).toEqual({ kind: "login" });
  });

  /**
   * The consequence, stated as the thing we actually care about: with a code on
   * it, this address must not turn into a request to add an article.
   *
   * `canonicalAddHref` would happily do that if it were ever asked — it has no
   * idea what `/auth/callback` is — which is exactly why the guard lives above
   * it in main.tsx rather than inside it.
   */
  /**
   * **Two guards now, and each is checked on its own.**
   *
   * This case used to read "`?add=` is read from the query wherever it appears,
   * so the exemption in main.tsx is the only thing standing between a Google
   * return and an ingest of the reader's authorisation code". That sentence
   * stopped being true on 2026-08-30: `?add=` is now read on the **root only**,
   * because reading it anywhere else made `/read/a?add=…` a page the server
   * titled as article *a* and the client turned into an add.
   *
   * So the callback is safe twice over — and the danger of that is a test that
   * passes because the function has gone inert rather than because a guard
   * works. Hence the positive control below: the same query on `/` **is**
   * folded, and does carry the secret, which is what makes the `null` above
   * evidence about the pathname rather than about the query.
   */
  it("is not folded into an add — by the root constraint, and separately by main.tsx", () => {
    /* Not an `/add/` path, so nothing to canonicalise: the path branch cannot
       touch the callback on its own. */
    expect(canonicalAddHref("/auth/callback", "?code=SECRET&state=S", "")).toBeNull();

    /* Guard one, the root constraint. */
    expect(canonicalAddHref("/auth/callback", "?add=https://x.test/a&code=SECRET", "")).toBeNull();

    /* **The control.** The identical query on the root is folded and does carry
       the code, so the two `null`s above are the pathname doing work — not a
       function that has quietly stopped reading `?add=` at all. */
    const onRoot = canonicalAddHref("/", "?add=https://x.test/a&code=SECRET", "");
    expect(onRoot).not.toBeNull();
    expect(onRoot).toContain("SECRET");
  });

  /**
   * **Guard two, and it is now a structural property rather than a habit.**
   *
   * Every pre-mount rewrite lives inside `settleAddress`, so `main.tsx` has
   * exactly **one** place that changes the address and one `onCallback` check in
   * front of it. It used to have four of each, which meant the person adding a
   * fifth rewrite had to remember — and counting the guards, as an earlier
   * version of this test did, would not have noticed an unguarded fifth. GPT Sol
   * made that point on 2026-08-30; the fix is that a fifth rewrite now goes
   * *inside* the guarded function and is exempt by construction.
   *
   * Still partly static, because module-init side effects cannot be called. But
   * what it asserts is a count of rewrite *sites*, which is the thing that was
   * actually hard to keep right.
   */
  it("carries a fragment across the ?slug= rewrite, which the old version dropped", () => {
    /* A deliberate change, made while turning the four rewrites into one
       function: the inline `?slug=` rewrite dropped the fragment and the
       `about=` one beside it kept it, which reads as two rewrites written at
       different times rather than a decision. Only a non-id fragment is
       affected — `liftLegacyAnchor` runs first and turns `#spya-…` into `?at=`. */
    expect(settleAddress("/", "?slug=a-piece", "#section-2")).toBe("/read/a-piece#section-2");
    /* And the id case, to show the ordering: the fragment is consumed, not
       carried, because it means a position rather than a place. */
    expect(settleAddress("/", "?slug=a-piece", "#spya-k3m9qt")).toBe(
      "/read/a-piece?at=spya-k3m9qt",
    );
  });

  it("and main.tsx has exactly one guarded place where the address changes", () => {
    const main = readFileSync(
      path.join(path.resolve(import.meta.dirname, ".."), "src", "web", "main.tsx"),
      "utf8",
    );
    expect(main.match(/history\.replaceState/g) ?? [], "one rewrite site, not four").toHaveLength(1);
    expect(main).toContain("if (!onCallback) {");
    expect(main).toContain("settleAddress(location.pathname, location.search, location.hash)");

    /* And the behavioural half, which the old version had none of.
       `?add=` on the callback is already inert — it is read on the root only —
       so that shape no longer demonstrates anything: */
    expect(settleAddress("/auth/callback", "?add=https://x.test/a&code=SECRET", "")).toBeNull();

    /* **This is the shape that shows the guard still has work.** `about=` is
       stripped on any path, so an unguarded `settleAddress` would rewrite the
       callback's address — and a Google return carries a one-time `code` on it.
       Google sends no `about=`, so this is not a live route; the point is that
       the guard is doing something rather than being a comment, and it must stay
       whatever the other rewrites are constrained to. */
    const rewritten = settleAddress("/auth/callback", "?about=0&code=SECRET", "");
    expect(rewritten, "the guard must have work to do, or it proves nothing").not.toBeNull();
    expect(rewritten).toContain("code=SECRET");
  });});

/**
 * The address of the sign-in page with where to go afterwards — docs/plans/261001m.
 * `next=/` is left off because the shelf is where a sign-in goes anyway.
 */
describe("loginHref", () => {
  it("is the bare page with nothing to carry", async () => {
    const { loginHref } = await import("../src/web/router.js");
    expect(loginHref()).toBe("/login");
    expect(loginHref({ next: "/" })).toBe("/login");
  });

  it("carries the destination, encoded, and the create-account tab", async () => {
    const { loginHref, parseRoute } = await import("../src/web/router.js");
    expect(loginHref({ next: "/read/x?at=spya-k3m9qt" })).toBe(
      "/login?next=%2Fread%2Fx%3Fat%3Dspya-k3m9qt",
    );
    expect(loginHref({ create: true })).toBe("/login?new");
    expect(loginHref({ create: true, next: "/pricing" })).toBe("/login?new&next=%2Fpricing");
    /* And it is still the login route, so the link is not a 404. */
    expect(parseRoute(loginHref({ create: true, next: "/pricing" }).split("?")[0] ?? "")).toEqual({
      kind: "login",
    });
  });
});
