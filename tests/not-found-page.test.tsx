// @vitest-environment jsdom
/**
 * The 404 page, actually rendered — src/web/NotFoundPage.tsx.
 *
 * `tests/router.test.ts` already says which addresses become `not-found`, which
 * is the half of this feature that is pure string work. What it cannot see is
 * the half that is the whole point: that the reader is **told**, and given a
 * door. A page that parsed the address correctly and then rendered an empty
 * `<main>` would pass every assertion in that file.
 *
 * The three things asserted here are the three that would make it silent again:
 * the sentence, the way out, and the tab. Everything else about the page is
 * layout, which a test in jsdom cannot judge and should not pretend to.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  NOT_FOUND,
  NOT_FOUND_HEADING,
  NOT_FOUND_TO_HOME,
  NOT_FOUND_TO_SHELF,
} from "../src/messages.js";
import { NotFoundPage } from "../src/web/NotFoundPage.js";
import { LIBRARY_HREF } from "../src/web/router.js";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

async function draw(signedIn: boolean): Promise<void> {
  await act(async () => root.render(<NotFoundPage signedIn={signedIn} />));
}

const link = () => host.querySelector("a");

describe("the page for an address nobody minted", () => {
  it("says the address is wrong, rather than showing a plausible page", async () => {
    await draw(true);
    expect(host.textContent).toContain(NOT_FOUND_HEADING);
    expect(host.textContent).toContain(NOT_FOUND);
  });

  /**
   * **One href, two words for it.** `/` is the shelf for a reader who has one
   * and the landing page for a stranger (App.tsx), so the link never decides
   * where home is — only what to call it. Offering *"your shelf"* to somebody
   * with no account would be a promise the click cannot keep.
   */
  it("offers a way out, named for whoever is reading", async () => {
    await draw(true);
    expect(link()?.getAttribute("href")).toBe(LIBRARY_HREF);
    expect(link()?.textContent).toBe(NOT_FOUND_TO_SHELF);

    await draw(false);
    expect(link()?.getAttribute("href")).toBe(LIBRARY_HREF);
    expect(link()?.textContent).toBe(NOT_FOUND_TO_HOME);
  });

  /**
   * **A page that sets no title leaves the previous one standing.** That is a
   * real bug this repo has already had — `NotSharedPage` shipped without a
   * title and left an article's name in the tab over a page saying the reader
   * could not have it (page-title.ts § not-shared, 2026-08-30). Here it would
   * be worse: the tab would go on naming a document while the page says the
   * address means nothing.
   *
   * The assertion is on `document.title` rather than on `pageTitle`, because
   * what went wrong last time was the hook never being called at all — and a
   * test comparing `pageTitle(...)` to itself would have been green throughout.
   */
  it("takes the tab, so the last page's title cannot stand over it", async () => {
    document.title = "Some article · Spideryarn";
    await draw(true);
    expect(document.title).toBe("Not found · Spideryarn");
    expect(document.title).not.toContain("Some article");
  });
});
