// @vitest-environment jsdom
/**
 * **The takedown route, which is a section rather than a page — and the two
 * ways a section can quietly fail to be one.**
 *
 * Spideryarn republishes the extracted text of somebody else's article. The
 * owner ticks a box confirming they have the right to; nothing checks that, so
 * the protection is that tick-box **plus a way for the wronged party to
 * complain**. A public shelf makes those articles findable, which is the point
 * at which the second half stops being theoretical
 * (docs/plans/260904b-pricing-page-and-public-showcase.md § Stage 4).
 *
 * It is a section on `/privacy` and not a route of its own — the argument is in
 * `src/web/PrivacyPage.tsx` beside the section — and that choice buys two
 * failure modes that a route would not have had. Both are the same shape:
 * something looks linked and is not.
 *
 *  1. **The link and the anchor drift apart.** `/privacy#something` with no
 *     `id="something"` on the page is a link that lands at the top of a long
 *     policy and says nothing about why. Nothing in a browser reports it. So
 *     the id and the href are built from one exported constant, and this asserts
 *     the section actually carries it.
 *  2. **The fragment does nothing.** `navigate()` (src/web/router.ts) pushes the
 *     address and then `scrollTo({ top: 0 })` unconditionally; the element does
 *     not exist when a browser would honour the fragment on a cold load either,
 *     because this is a client-rendered page. So the page scrolls its own
 *     section into view, and that is a mechanism nothing else would exercise —
 *     it is the whole difference between the link working and appearing to.
 *
 * The words themselves are not pinned here. They are prose that will be
 * rewritten, and a test that quoted them would be a test somebody edits to make
 * green. What is pinned is that the section exists, that it says how to reach a
 * person, and that the address it gives is the one address we publish.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CONTACT_EMAIL } from "../src/site-text.js";
import { TAKEDOWN_HEADING } from "../src/messages.js";
import { PRIVACY_HREF, TAKEDOWN_HREF, TAKEDOWN_SECTION_ID, parseRoute } from "../src/web/router.js";
import { PrivacyPage } from "../src/web/PrivacyPage.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  history.replaceState(null, "", PRIVACY_HREF);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

async function show(): Promise<void> {
  await act(async () => {
    root.render(<PrivacyPage />);
  });
}

describe("the address a complaint is sent to", () => {
  /**
   * **The link and the anchor are one constant**, so this is close to a
   * tautology — and it is written down anyway, because the cheap way to build
   * this feature is two string literals in two files, and that version passes
   * every other test in the repo while being broken.
   */
  it("is the privacy page plus the section's own id", () => {
    expect(TAKEDOWN_HREF).toBe(`${PRIVACY_HREF}#${TAKEDOWN_SECTION_ID}`);
  });

  /** And the page at the other end of it is a page this app knows about. */
  it("and that page is a real route", () => {
    expect(parseRoute(PRIVACY_HREF)).toEqual({ kind: "privacy" });
  });
});

describe("the section a complaint is described in", () => {
  it("is on the privacy page, under the id the link points at", async () => {
    await show();
    const section = host.querySelector(`#${TAKEDOWN_SECTION_ID}`);
    expect(section, "the takedown link points at an anchor that is not on the page").not.toBeNull();
    expect(section?.textContent).toContain(TAKEDOWN_HEADING);
  });

  /**
   * **It has to get a real complaint to a real human**, which is the entire
   * requirement. One address, the one we publish everywhere else.
   */
  it("and gives the address a person actually reads", async () => {
    await show();
    const section = host.querySelector(`#${TAKEDOWN_SECTION_ID}`);
    expect(section?.textContent).toContain(CONTACT_EMAIL);
    expect(section?.querySelector(`a[href="mailto:${CONTACT_EMAIL}"]`)).not.toBeNull();
  });

  /**
   * **And it tells them what to put in it.** A first message that does not name
   * the page cannot be acted on, and the section says so — the one instruction
   * worth pinning, because dropping it turns a working route into a round trip.
   */
  it("and asks for the address of the page, which is what makes it actionable", async () => {
    await show();
    const words = host.querySelector(`#${TAKEDOWN_SECTION_ID}`)?.textContent ?? "";
    expect(words.toLowerCase()).toContain("address of the spideryarn page");
  });
});

/**
 * **The fragment has to move the page**, and nothing in the router does it.
 *
 * `navigate()` scrolls to the top on every navigation, and a cold load cannot
 * honour a fragment for an element React has not rendered yet. So this is the
 * one behaviour here that is a mechanism rather than markup.
 *
 * jsdom has no `scrollIntoView`, so it is stubbed — the same reason
 * `PricingPage.tsx` calls its own with `?.`.
 */
describe("arriving with the fragment on the address", () => {
  const scrolled: string[] = [];

  beforeEach(() => {
    scrolled.length = 0;
    vi.stubGlobal("scrollTo", () => {});
    Element.prototype.scrollIntoView = function scrollIntoView(this: Element) {
      scrolled.push(this.id);
    };
  });

  it("brings the section into view rather than landing at the top", async () => {
    history.replaceState(null, "", TAKEDOWN_HREF);
    await show();
    expect(scrolled).toContain(TAKEDOWN_SECTION_ID);
  });

  it("and leaves the page where it is when the address carries no fragment", async () => {
    history.replaceState(null, "", PRIVACY_HREF);
    await show();
    expect(scrolled).toEqual([]);
  });
});
