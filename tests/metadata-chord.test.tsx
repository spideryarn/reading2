// @vitest-environment jsdom
/**
 * **⌘-Enter / Ctrl-Enter opens the Metadata page, from the reading view.**
 *
 * > In the Reading view, if I hit Command Enter, that should open up the
 * > Metadata mode.
 * >
 * > — Greg, 2026-09-29, SPIDERYARN-READING2-5F
 *
 * Mounts the real `Dock`, as tests/command-bar.test.tsx does for ⌘-K, and
 * asserts where the address went — the same href the Dock's Metadata button
 * carries, `?at=` included. Every refusal below is a press that belongs to
 * somebody else: a text box's "send", a link's new tab, the browser's Shift and
 * Alt chords, an open dialog, an IME. docs/project/keyboard.md § ⌘-Enter;
 * docs/plans/260929g-shelf-search-focus-and-metadata-chord.md § Part B.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Dock } from "../src/web/Dock.js";
import { EXPERIMENTAL_OFF } from "./helpers/experimental-fixtures.js";

const START = "/read/a-piece?at=spya-k3m9qt";

let host: HTMLDivElement;
let root: Root;
let extras: HTMLElement[];

beforeEach(() => {
  history.replaceState(null, "", START);
  /* jsdom implements neither; the same stand-in tests/command-bar.test.tsx uses. */
  const proto = window.HTMLDialogElement?.prototype;
  if (proto) {
    proto.showModal = function showModal(this: HTMLDialogElement) {
      this.open = true;
    };
    proto.close = function close(this: HTMLDialogElement) {
      this.open = false;
      this.dispatchEvent(new Event("close"));
    };
  }
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  extras = [];
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  for (const el of extras) el.remove();
});

function mount(props: Record<string, unknown> = {}): void {
  act(() => {
    root.render(
      // biome-ignore lint/suspicious/noExplicitAny: the mount sites differ by which optional props are present
      createElement(Dock as any, {
        slug: "a-piece",
        view: "article",
        mode: "plain",
        onMode: () => {},
        experimental: EXPERIMENTAL_OFF,
        ...props,
      }),
    );
  });
}

/** Something else on the page, focused, the way a reader would have left it. */
function focusOn<T extends HTMLElement>(el: T): T {
  document.body.append(el);
  extras.push(el);
  el.focus();
  return el;
}

/**
 * The press, dispatched where a real one starts — on the focused element, so
 * it bubbles through anything that might claim it on its way to `window`.
 * Returns whether the press was claimed.
 */
function press(over: KeyboardEventInit = {}, from: EventTarget = document.activeElement ?? window): boolean {
  const e = new KeyboardEvent("keydown", {
    key: "Enter",
    metaKey: true,
    bubbles: true,
    cancelable: true,
    ...over,
  });
  act(() => {
    from.dispatchEvent(e);
  });
  return e.defaultPrevented;
}

const here = () => location.pathname + location.search;
const METADATA = "/read/a-piece/metadata?at=spya-k3m9qt";

describe("⌘/Ctrl-Enter on the reading view", () => {
  it("goes to the Metadata page, carrying the reader's place, and claims the press", () => {
    mount();
    expect(press()).toBe(true);
    expect(here()).toBe(METADATA);
  });

  it("goes to exactly the href the Dock's Metadata button carries", () => {
    mount();
    const link = [...host.querySelectorAll<HTMLAnchorElement>("a[href]")].find((a) =>
      a.getAttribute("href")?.startsWith("/read/a-piece/metadata"),
    );
    expect(link, "the Dock draws no Metadata link").toBeDefined();
    press();
    expect(here()).toBe(link?.getAttribute("href"));
  });

  it("works with Ctrl as well as ⌘", () => {
    mount();
    expect(press({ metaKey: false, ctrlKey: true })).toBe(true);
    expect(here()).toBe(METADATA);
  });

  it("works for a visitor on the reading view", () => {
    mount({ visitor: true, onMode: undefined, mode: undefined });
    expect(press()).toBe(true);
    expect(here()).toBe(METADATA);
  });

  /* App policy, not a browser fact: no button here binds a modified Enter, so
     the chord still works after the reader has clicked something in the Dock. */
  it("still fires with a button focused", () => {
    mount();
    focusOn(document.createElement("button"));
    expect(press()).toBe(true);
    expect(here()).toBe(METADATA);
  });
});

describe("⌘/Ctrl-Enter is left alone", () => {
  it("in a textarea — five text boxes already send on it", () => {
    mount();
    focusOn(document.createElement("textarea"));
    expect(press()).toBe(false);
    expect(here()).toBe(START);
  });

  it("in a contenteditable host", () => {
    mount();
    const editor = document.createElement("div");
    editor.setAttribute("contenteditable", "true");
    const inner = document.createElement("span");
    inner.tabIndex = -1;
    editor.append(inner);
    focusOn(editor);
    inner.focus();
    expect(press()).toBe(false);
    expect(here()).toBe(START);
  });

  it("on a focused link — there it is a new-tab click", () => {
    mount();
    const a = document.createElement("a");
    a.href = "https://example.com/";
    a.textContent = "a link in the prose";
    focusOn(a);
    expect(press()).toBe(false);
    expect(here()).toBe(START);
  });

  it("on something focused inside a link", () => {
    mount();
    const a = document.createElement("a");
    a.href = "https://example.com/";
    const inner = document.createElement("span");
    inner.tabIndex = 0;
    a.append(inner);
    document.body.append(a);
    extras.push(a);
    inner.focus();
    expect(press()).toBe(false);
    expect(here()).toBe(START);
  });

  it("with Shift", () => {
    mount();
    expect(press({ shiftKey: true })).toBe(false);
    expect(here()).toBe(START);
  });

  it("with Alt", () => {
    mount();
    expect(press({ altKey: true })).toBe(false);
    expect(here()).toBe(START);
  });

  it("without ⌘ or Ctrl", () => {
    mount();
    expect(press({ metaKey: false })).toBe(false);
    expect(here()).toBe(START);
  });

  it("over an open native dialog", () => {
    mount();
    const other = document.createElement("dialog");
    other.open = true;
    document.body.append(other);
    extras.push(other);
    expect(press()).toBe(false);
    expect(here()).toBe(START);
  });

  it("on auto-repeat", () => {
    mount();
    expect(press({ repeat: true })).toBe(false);
    expect(here()).toBe(START);
  });

  it("once another handler has claimed it", () => {
    mount();
    const claimer = focusOn(document.createElement("button"));
    claimer.addEventListener("keydown", (e) => e.preventDefault());
    press();
    expect(here()).toBe(START);
  });

  it("while an IME is composing", () => {
    mount();
    expect(press({ isComposing: true })).toBe(false);
    expect(here()).toBe(START);
  });

  it("on the legacy composition keyCode, 229", () => {
    mount();
    expect(press({ keyCode: 229 } as KeyboardEventInit)).toBe(false);
    expect(here()).toBe(START);
  });
});

/* **On the Metadata page it toggles back**, since 2026-10-03 — Greg,
   spya-bpczdx: *"Tapping on Metadata mode in bottom bar when active should
   close it"*. The chord follows the button, as it always has. Until then this
   case asserted the press was left alone ("nothing to toggle back to", plan
   260929g). docs/plans/261003c-glossary-find-more-at-the-top-and-metadata-press-closes.md § 2. */
describe("⌘/Ctrl-Enter on the Metadata page", () => {
  it.each(["input", "textarea"])("leaves a Metadata %s's chord alone", (tag) => {
    const start = "/read/a-piece/metadata?mode=glossary";
    history.replaceState(null, "", start);
    mount({ view: "metadata" });
    focusOn(document.createElement(tag));
    expect(press()).toBe(false);
    expect(here()).toBe(start);
  });

  it("returns from a visitor's public Metadata page with the carried search", () => {
    history.replaceState(null, "", "/read/a-piece/metadata?mode=glossary&margin=1&panel=questions");
    mount({ view: "metadata", visitor: true, onMode: undefined, mode: undefined });
    expect(press({ metaKey: false, ctrlKey: true })).toBe(true);
    expect(here()).toBe("/read/a-piece?mode=glossary&margin=1");
  });

  it("goes back to the article, carrying the mode and the place", () => {
    history.replaceState(null, "", "/read/a-piece/metadata?mode=glossary&at=spya-k3m9qt");
    act(() => {
      root.render(
        // biome-ignore lint/suspicious/noExplicitAny: this arm is missing props on purpose
        createElement(Dock as any, { slug: "a-piece", view: "metadata", experimental: EXPERIMENTAL_OFF }),
      );
    });
    expect(press()).toBe(true);
    expect(here()).toBe("/read/a-piece?mode=glossary&at=spya-k3m9qt");
  });

  it("is where the Metadata button points there, drawn as the page you are on", () => {
    history.replaceState(null, "", "/read/a-piece/metadata?mode=glossary&margin=1&at=spya-k3m9qt");
    act(() => {
      root.render(
        // biome-ignore lint/suspicious/noExplicitAny: this arm is missing props on purpose
        createElement(Dock as any, { slug: "a-piece", view: "metadata", experimental: EXPERIMENTAL_OFF }),
      );
    });
    const link = host.querySelector<HTMLAnchorElement>('a[aria-label="Metadata"]');
    expect(link, "the Dock draws no Metadata link").not.toBeNull();
    expect(link?.getAttribute("href")).toBe("/read/a-piece?mode=glossary&margin=1&at=spya-k3m9qt");
    expect(link?.getAttribute("aria-current")).toBe("page");
  });

  it("leaves the button on the reading view pointing at the Metadata page", () => {
    mount();
    const link = host.querySelector<HTMLAnchorElement>('a[aria-label="Metadata"]');
    expect(link?.getAttribute("href")).toBe(METADATA);
  });
});

describe("⌘-K, rewritten on the shared test", () => {
  it("still opens the command bar with Caps Lock on", () => {
    mount();
    expect(press({ key: "K" })).toBe(true);
    const bar = host.querySelector<HTMLDialogElement>("dialog.cmdbar");
    expect(bar?.open).toBe(true);
    expect(here()).toBe(START);
  });
});

describe("the Metadata tooltip", () => {
  /* Read off the card a hover really opens, the way
     tests/dock-mode-tooltips.test.tsx § cardFor does, rather than off the
     constant — the card is what a reader sees. */
  it("names the chord, in the Commands card's format", async () => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    mount();
    const link = host.querySelector<HTMLAnchorElement>('a[aria-label="Metadata"], a[href^="/read/a-piece/metadata"]');
    expect(link, "the Dock draws no Metadata link").not.toBeNull();
    link?.dispatchEvent(new MouseEvent("mouseenter"));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });
    const card = document.querySelector('[role="tooltip"]');
    expect(card?.textContent?.replace(/\s+/g, " ")).toContain("⌘Enter / Ctrl-Enter");
  });
});
