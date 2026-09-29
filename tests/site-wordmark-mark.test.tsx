// @vitest-environment jsdom
/**
 * **The spider travels with the words, and Beta sits on the right.**
 *
 * Greg, 2026-09-29 (SPIDERYARN-READING2-4X): *"include the Spideryarn logo next
 * to "Spideryarn Reading" (in the top left, and bottom-left). And same for
 * logged-in footer. And move the "Beta" to the right-hand-side of the Header
 * (just before "Features")"*. docs/plans/260929a-….
 *
 * What is pinned is not "there is an image" but that each copy is **its own
 * animation host** — a spider that renders but never plays is the failure a
 * screenshot cannot see (docs/project/design-logo.md). So the test hovers the
 * host and checks the class the hook puts on it, and checks that the mark
 * lives inside that host rather than beside it.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SiteNav } from "../src/web/SiteBits.js";
import { SiteFooter } from "../src/web/SiteFooter.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

/**
 * Point at an element with a mouse. jsdom has no `PointerEvent`, and React
 * delivers `onPointerEnter` from `pointerover`, so this is the shape
 * tests/logo-animation.test.tsx § pointer uses.
 */
function hover(el: Element) {
  const e = new MouseEvent("pointerover", { bubbles: true, buttons: 0 });
  Object.defineProperty(e, "pointerType", { value: "mouse" });
  Object.defineProperty(e, "pointerId", { value: 1 });
  act(() => {
    el.dispatchEvent(e);
  });
}

describe("the top bar", () => {
  it("draws the spider inside the home link, and the link animates it", () => {
    act(() => root.render(<SiteNav here="home" signedIn={false} />));
    const home = host.querySelector('a[aria-label="Spideryarn Reading, home"]');
    expect(home).not.toBeNull();
    expect(home?.querySelector(".logo-mark > img.logo-image")).not.toBeNull();
    hover(home as Element);
    expect(home?.className).toContain("spya-anim");
  });

  it("puts Beta in the right-hand cluster, just before the first link", () => {
    act(() => root.render(<SiteNav here="home" signedIn={false} />));
    const home = host.querySelector('a[aria-label="Spideryarn Reading, home"]');
    expect(home?.textContent).not.toContain("Beta");
    const beta = [...host.querySelectorAll("span")].find((s) => s.textContent === "Beta");
    expect(beta).toBeDefined();
    const next = beta?.nextElementSibling;
    expect(next?.textContent).toBe("Features");
  });

  it("keeps the corner logo's build tooltip when it replaces that control", () => {
    vi.stubGlobal("__SPIDERYARN_BUILD_COMMIT__", "39282f8ca7e616a212720a7469e1b680cdf874e3");
    vi.stubGlobal("__SPIDERYARN_BUILD_TIME__", "2026-09-07T09:49:03Z");
    act(() => root.render(<SiteNav here="features" signedIn />));
    const home = host.querySelector('a[aria-label="Spideryarn Reading, home"]');
    expect(home?.getAttribute("title")).toContain("back to the library");
    expect(home?.getAttribute("title")).toContain("39282f8");
  });

  it("does not describe a signed-out home link as the reader's library", () => {
    act(() => root.render(<SiteNav here="features" signedIn={false} />));
    const home = host.querySelector('a[aria-label="Spideryarn Reading, home"]');
    expect(home?.getAttribute("title")).toBeNull();
  });
});

describe("the footer", () => {
  it("draws the spider beside the words, in a host that animates it", () => {
    act(() => root.render(<SiteFooter here="library" />));
    const img = host.querySelector("footer .logo-mark > img.logo-image");
    expect(img).not.toBeNull();
    const animHost = img?.closest(".site-wordmark-host");
    expect(animHost).not.toBeNull();
    expect(animHost?.textContent).toContain("Spideryarn");
    hover(animHost as Element);
    expect(animHost?.className).toContain("spya-anim");
  });
});
