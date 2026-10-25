// @vitest-environment jsdom
/**
 * **The Chrome extension is findable, and one constant switches every place
 * on** — plan docs/plans/261025b-the-chrome-extension-findable-from-help-the-command-bar-and-a-refused-import.md.
 *
 *  - `PRODUCTION_EXTENSION_ID` is `null` or a store id, never a typo that
 *    would switch on a link to nowhere;
 *  - Help's `{{chrome-extension}}` draws its sentence in both states, the store
 *    link only with an id, and gives search and the chatbot the same sentence
 *    either way, so setting the id moves no generated file;
 *  - the command bar's row is there only with a store address, typed-only,
 *    opening Help, and before the app pages.
 *
 * The add page's half is tests/add-page-upload-instead.test.tsx.
 */
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const navigations: string[] = [];
vi.mock("../src/web/router.js", async (importActual) => ({
  ...(await importActual<typeof import("../src/web/router.js")>()),
  navigate: (href: string) => {
    navigations.push(href);
  },
}));

import { besideTheModes } from "../src/web/CommandBar.js";
import { EXTENSION_HELP_SENTENCE, EXTENSION_NOT_YET, ExtensionHelp } from "../src/web/ExtensionOffer.js";
import { EXTENSION_STORE_URL, PRODUCTION_EXTENSION_ID, extensionStoreUrl } from "../src/web/extension-handoff.js";
import { expandHelpTokens, helpMarkdownText, renderHelpMarkdown } from "../src/web/help/help-markdown.js";
import { helpPage } from "../src/web/help/help-pages.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ID = "abcdefghijklmnopabcdefghijklmnop";
const STORE = `https://chromewebstore.google.com/detail/${ID}`;

let root: Root | null = null;
let host: HTMLElement;

function draw(node: Parameters<Root["render"]>[0]): HTMLElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(node));
  return host;
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
});

describe("the store item's id", () => {
  it("is null, or 32 letters a to p, as the store assigns them", () => {
    if (PRODUCTION_EXTENSION_ID !== null) expect(PRODUCTION_EXTENSION_ID).toMatch(/^[a-p]{32}$/);
    expect(EXTENSION_STORE_URL).toBe(extensionStoreUrl(PRODUCTION_EXTENSION_ID));
  });

  it("makes the store's address for the item, or none", () => {
    expect(extensionStoreUrl(ID)).toBe(STORE);
    expect(extensionStoreUrl(null)).toBeNull();
  });
});

describe("Help's {{chrome-extension}}", () => {
  it("draws the sentence and the store link once there is an item", () => {
    const page = draw(createElement(ExtensionHelp, { url: STORE }));
    expect(page.textContent).toContain(EXTENSION_HELP_SENTENCE);
    expect(page.textContent).not.toContain(EXTENSION_NOT_YET);
    const link = page.querySelector("a");
    expect(link?.href).toBe(STORE);
    expect(link?.target).toBe("_blank");
    expect(link?.rel).toBe("noopener noreferrer");
  });

  it("draws the sentence and no link while there is none", () => {
    const page = draw(createElement(ExtensionHelp, { url: null }));
    expect(page.textContent).toBe(`${EXTENSION_HELP_SENTENCE} ${EXTENSION_NOT_YET}`);
    expect(page.querySelector("a")).toBeNull();
  });

  it("is in Adding an article, drawn from the token", () => {
    const body = helpPage("adding-articles").body;
    expect(body).toMatch(/^\{\{chrome-extension\}\}$/m);
    const page = draw(createElement(Fragment, null, renderHelpMarkdown(body, "adding-articles")));
    expect(page.textContent).toContain(EXTENSION_HELP_SENTENCE);
    /* Today's constant decides the rest: a link exactly when there is an item. */
    expect(page.querySelector('a[href^="https://chromewebstore.google.com/"]') !== null).toBe(EXTENSION_STORE_URL !== null);
  });

  it("gives search and the chatbot the same sentence in either state", () => {
    expect(expandHelpTokens("{{chrome-extension}}")).toBe(EXTENSION_HELP_SENTENCE);
    expect(helpMarkdownText("{{chrome-extension}}", "test")).toBe(EXTENSION_HELP_SENTENCE);
  });

  it("must be a paragraph of its own", () => {
    expect(() => renderHelpMarkdown("Get {{chrome-extension}} now.", "test")).toThrow(/alone in its own paragraph/);
  });
});

describe("the command bar's Chrome extension row", () => {
  const rows = (extensionStore: string | null) =>
    besideTheModes({
      article: undefined,
      openComments: undefined,
      openFeedback: () => {},
      queue: { run: async () => null, lastFailure: () => null },
      extensionStore,
    });
  const labels = (extensionStore: string | null) => rows(extensionStore).map((row) => ("label" in row ? row.label : ""));

  it("is not there while there is no store address", () => {
    expect(labels(null)).not.toContain("Chrome extension");
  });

  it("opens Help's Adding an article, typed-only, just before the app pages", () => {
    const all = rows(STORE);
    const row = all.find((r) => "label" in r && r.label === "Chrome extension");
    expect(row).toMatchObject({ kind: "action", id: "chrome-extension", typedOnly: true, generates: false, opensOnly: true });
    if (row?.kind !== "action") throw new Error("no row");
    expect(row.run()).toEqual({ kind: "close" });
    expect(navigations).toEqual(["/help/adding-articles"]);
    const order = labels(STORE);
    expect(order.indexOf("Chrome extension") + 1).toBe(order.indexOf("Library"));
  });
});
