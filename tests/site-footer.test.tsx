// @vitest-environment jsdom
/**
 * **The footer row, and the things about it that are decisions rather than
 * markup.**
 *
 * The row itself is five links and an address, and a test that only counted
 * them would be a test of JSX. What is worth pinning is:
 *
 *  - **It drops the link for the page it is on.** That is the whole reason the
 *    component reads `useRoute()` instead of taking a prop everywhere, and the
 *    failure it replaces — a Features page linking to Features — is one that a
 *    screenshot review reads straight past.
 *  - **It believes `here` over the address.** The landing page is drawn at four
 *    addresses that are not its own, and without that prop the row grew a Home
 *    link pointing at the page the reader was already looking at.
 *  - **It never drops the contact address.** The address is the only thing here
 *    a reader who is stuck can use, and a filter written one entry too greedily
 *    would take it out on some page nobody visits during review.
 *
 * A second `describe` at the foot answers the question none of those can:
 * **which pages actually mount it.** Every rule test here is satisfied by a
 * component nothing renders, and page coverage is the requirement Greg wrote —
 * so the inventory is pinned after all, as a source scan, with its reasoning
 * beside it.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CONTACT_EMAIL } from "../src/site-text.js";
import { SiteFooter } from "../src/web/SiteFooter.js";

/* React only treats `act()` as authoritative when this is set, and without it
   every render below logs "The current testing environment is not configured to
   support act(...)" — noise that hides a real warning. The neighbouring suites
   set it the same way (tests/spine-card.test.tsx). */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

/**
 * Mount the footer as it would be at `pathname`, and read the row back.
 *
 * `history.replaceState` rather than a mocked router: `useRoute` reads
 * `location.pathname` through `useSyncExternalStore` and jsdom gives it a real
 * one, so this exercises the actual parse — including the fact that `/` is the
 * `library` route on a page a signed-out reader is looking at.
 *
 * **Label and destination together, never the labels alone.** GPT Sol's
 * finding, 2026-09-03: a suite that read only the words would stay green
 * through `LIBRARY_HREF` and `FEATURES_HREF` being swapped — which is a row
 * where "Home" goes to the features page and "Features" points at the page you
 * are standing on, the exact failure the filter exists to prevent. The `→` is
 * only so a mismatch prints legibly.
 */
function footerAt(
  pathname: string,
  here?: "library" | "features" | "privacy" | "contact",
): string[] {
  history.replaceState(null, "", pathname);
  act(() => root.render(<SiteFooter {...(here ? { here } : {})} />));
  return [...host.querySelectorAll("footer a")].map(
    (a) => `${a.textContent ?? ""} → ${a.getAttribute("href") ?? ""}`,
  );
}

const HOME = "Home → /";
const FEATURES = "Features → /features";
const PRICING = "Pricing → /pricing";
const PRIVACY = "Privacy → /privacy";
const CONTACT = "Contact → /contact";
const MAIL = `${CONTACT_EMAIL} → mailto:${CONTACT_EMAIL}`;

describe("the site footer", () => {
  it("carries the whole row on a page that is not one of its own", () => {
    // The control: if this ever stops holding, every "is missing" assertion
    // below would pass over a footer that rendered nothing at all.
    expect(footerAt("/profile")).toEqual([HOME, FEATURES, PRICING, PRIVACY, CONTACT, MAIL]);
  });

  it("drops Home on the shelf, which is also the landing page", () => {
    expect(footerAt("/")).toEqual([FEATURES, PRICING, PRIVACY, CONTACT, MAIL]);
  });

  it("drops Features on the features page", () => {
    expect(footerAt("/features")).toEqual([HOME, PRICING, PRIVACY, CONTACT, MAIL]);
  });

  it("drops Privacy on the privacy page", () => {
    expect(footerAt("/privacy")).toEqual([HOME, FEATURES, PRICING, CONTACT, MAIL]);
  });

  it("drops Contact on the contact page, and keeps the address there", () => {
    /* The one page where the two halves of this row say nearly the same thing,
       and they still behave differently: the link drops itself, the `mailto:`
       does not. That is the decision in SiteFooter.tsx § `LINKS`, and this is
       what would go red if somebody later folded the address into the link. */
    expect(footerAt("/contact")).toEqual([HOME, FEATURES, PRICING, PRIVACY, MAIL]);
  });

  it("keeps the contact address on every one of them", () => {
    // Said separately from the four above because it is a different rule with a
    // different reason: the address is the only thing in the row that is not a
    // page, and the only thing a reader who is stuck can actually use.
    for (const at of ["/", "/features", "/pricing", "/privacy", "/contact", "/profile"]) {
      expect(footerAt(at)).toContain(MAIL);
    }
  });

  /**
   * **The landing page is drawn at addresses that are not its own**, which is
   * the one case the address cannot answer: `App.tsx`, signed out, answers
   * `/profile`, `/design`, `/admin` and an unshared `/read/<slug>` with
   * `LandingPage`. Before `here` existed the row offered those readers a Home
   * link to the page they were already on. GPT Sol found it, 2026-09-03.
   *
   * `/profile` as the address rather than `/design`, because it is the one of
   * the four that is *also* a real page with a footer of its own — so this test
   * and the control at the top are the same address answered two different
   * ways, which is precisely the distinction `here` was added to make.
   */
  it("believes the page over the address when the caller says which it is", () => {
    expect(footerAt("/profile", "library")).toEqual([FEATURES, PRICING, PRIVACY, CONTACT, MAIL]);
  });

  it("takes a sentence of its own above the links", () => {
    history.replaceState(null, "", "/profile");
    act(() => root.render(<SiteFooter>About these screenshots.</SiteFooter>));
    expect(host.textContent).toContain("About these screenshots.");
  });
});

/**
 * **Which pages mount it, how many times, and which of them declare `here` —
 * as a source scan, and the reason it is one and what it is not.**
 *
 * GPT Sol, 2026-09-03: *"Removing `<SiteFooter />` from any caller leaves this
 * suite green"*, and page coverage is the actual requirement Greg wrote —
 * *"all non-logged-in-pages … e.g. on `/`, but NOT on any `/read/*` pages"*.
 *
 * **It counts mounts, not imports**, and that distinction is this test's second
 * draft rather than its first: an import scan passes over a file that keeps the
 * import and deletes the `<SiteFooter />`, which is exactly what a careless
 * edit leaves behind — same review, second pass. Counting also pins the
 * *number* per file, which is what would otherwise let one of a page's two
 * mounts go quietly.
 *
 * A scan rather than six mounted pages, because mounting `Library` or
 * `ProfilePage` needs a Supabase session, a `nuqs` adapter and a fetch mock
 * each, and what that would mostly prove is that this file can build a fixture.
 *
 * **It is a text check and it says so**: it reads JSX as characters, so a
 * footer reaching the reading view by way of some component `App.tsx` already
 * renders would slip past it. What it catches is the whole-page mistake, which
 * is the one that has actually happened.
 */
describe("the pages that mount it", () => {
  const WEB = path.join(import.meta.dirname, "..", "src", "web");

  const sourceOf = (file: string) => readFileSync(path.join(WEB, file), "utf8");

  /** `<SiteFooter …>` occurrences per `src/web/*.tsx`, files with none omitted. */
  const mounts = new Map(
    readdirSync(WEB)
      .filter((f) => f.endsWith(".tsx"))
      .map((f) => [f, sourceOf(f).match(/<SiteFooter[\s/>]/g)?.length ?? 0] as const)
      .filter(([, n]) => n > 0)
      .sort(),
  );

  it("is exactly the eight pages that have a bottom, once each", () => {
    expect(Object.fromEntries(mounts)).toEqual({
      /* `/contact`, since 2026-09-05 — docs/plans/260905c-contact-page-and-a-warmer-feedback-thank-you.md. */
      "ContactPage.tsx": 1,
      "FeaturesPage.tsx": 1,
      "LandingPage.tsx": 1,
      "Library.tsx": 1,
      /* `/pricing`, since 2026-09-03. Its first draft hand-wrote the row by
         copying the features page, which is the duplication this component was
         extracted to stop — and this assertion is what caught it. */
      "PricingPage.tsx": 1,
      "PrivacyPage.tsx": 1,
      "ProfilePage.tsx": 1,
      "SignInPage.tsx": 1,
    });
  });

  it("is nothing under /read/ — not the reading view, not the two dead ends", () => {
    /* Greg's one explicit exclusion, and it gets an assertion of its own rather
       than resting on the list above, because the two files are kept out for
       reasons of different strength. `App.tsx` holds `ArticlePage` *and* six
       routes that do get a footer, so the interesting fact about it is the
       absence rather than its position in a sorted list. `PublicChrome.tsx`
       holds two dead-end pages that would take a footer perfectly well and are
       kept out only because they sit at a `/read/` address — SiteFooter.tsx
       § Where it goes. **If Greg says the exclusion was about the reading view
       rather than the path, this is the line to edit**, along with the two
       comments in PublicChrome.tsx. */
    expect([...mounts.keys()]).not.toContain("App.tsx");
    expect([...mounts.keys()]).not.toContain("PublicChrome.tsx");
  });

  it("found the mounts at all, rather than matching nothing", () => {
    /* The regex above is the kind that fails silently — rename the component,
       or let a formatter break the opening tag across lines, and it matches
       zero files, at which point both assertions above pass while proving
       nothing. docs/reusable/silent-success.md. */
    expect(mounts.size).toBeGreaterThan(0);
  });

  /**
   * **The two pages `App.tsx` uses as fallbacks have to declare themselves**,
   * and nothing else may — SiteFooter.tsx § `here`. Both halves matter and they
   * fail differently: a missing `here` is a Home link pointing at the page the
   * reader is already on (the bug, found twice), and a spurious one is a page
   * silently dropping a link it should carry.
   */
  it("is declared with `here` by exactly the two fallback pages", () => {
    const declares = [...mounts.keys()].filter((f) =>
      /<SiteFooter[^>]*\bhere=/.test(sourceOf(f)),
    );
    expect(declares).toEqual(["LandingPage.tsx", "Library.tsx"]);
  });
});

/**
 * **One address on the site, and it is not a person's.**
 *
 * Greg, 2026-09-05, having found his own address in the feedback dialog:
 *
 * > Remove that sentence, and remove any other mentions in the UI of my
 * > personal email address, greg@gregdetre.com. The only email address we
 * > should include on the site is hello@spideryarn.com.
 *
 * `ADMIN_EMAIL` (src/admin.ts) is not going anywhere — it is the label on an
 * identity, for logs and for the seed, and docs/project/admin.md is clear that
 * the gate compares ids and never it. What this pins is the *other* half: that
 * nothing the browser renders reaches for it. `FeedbackDialog.tsx` did, on the
 * failed-send fallback, which was the one screen in the app that asks a reader
 * to write to us — and named a person while doing it.
 *
 * An import rather than a text match, so that a comment quoting Greg's original
 * request (`AdminPage.tsx` has one) is not a failure.
 */
describe("the one address a reader is shown", () => {
  const WEB = path.join(import.meta.dirname, "..", "src", "web");

  const browserFiles = readdirSync(WEB).filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"));

  it("is never the administrator's, anywhere the browser loads", () => {
    const reaching = browserFiles.filter((f) =>
      /import\s*\{[^}]*\bADMIN_EMAIL\b[^}]*\}\s*from\s*["'][^"']*admin\.js["']/.test(
        readFileSync(path.join(WEB, f), "utf8"),
      ),
    );
    expect(reaching).toEqual([]);
  });

  it("found files to look at, rather than matching nothing", () => {
    /* The filter above is the kind that passes by reading zero files.
       docs/reusable/silent-success.md. */
    expect(browserFiles.length).toBeGreaterThan(50);
  });
});
