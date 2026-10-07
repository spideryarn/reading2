// @vitest-environment jsdom
/**
 * **The contents list on a window too narrow for a margin** — PageContents.tsx,
 * the *Contents* button and what the search box does to it.
 *
 * Greg, 2026-10-06, feedback report `spya-vwf00u`:
 *
 * > On something like a portrait iPhone, obviously it's not wide enough. So
 * > perhaps we should then put the search bar and table of contents above the
 * > actual contents of the page
 *
 * Below `lg` the list is folded under a *Contents* button, shut until pressed,
 * and a typed query shows its matches without the button.
 * docs/plans/261007c-contents-list-and-search-above-the-page-on-a-narrow-window.md.
 *
 * **jsdom applies no stylesheet, so nothing here is about layout.** There is no
 * "narrow" to set: the same markup is drawn at every width and the stylesheet
 * picks. What these pin is the half a stylesheet cannot get wrong by itself:
 * which classes the list wears (`tw:hidden` with `tw:lg:block` beside it is
 * "hidden below `lg` only"), whether the button exists, and what it tells a
 * screen reader. That the classes compute to the right boxes is the browser
 * pass's job.
 */
import { act, createElement, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PageContents, SECTION_REVEAL } from "../src/web/PageContents.js";

type Mounted = { host: HTMLDivElement; page: HTMLDivElement; root: Root };
let mounted: Mounted[];

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  mounted = [];
  /* Not at the bottom: jsdom's scrollHeight is 0, which the component reads as
     "the reader is at the foot of the page". */
  Object.defineProperty(document.documentElement, "scrollHeight", {
    value: 5000,
    configurable: true,
  });
});

afterEach(() => {
  for (const m of mounted) {
    act(() => m.root.unmount());
    m.host.remove();
    m.page.remove();
  }
  Reflect.deleteProperty(document.documentElement, "scrollHeight");
});

/** A page of three sections and a contents list reading it. */
function mount(): Mounted {
  const page = document.createElement("div");
  for (const [id, label] of [
    ["sec-a", "Alpha"],
    ["sec-b", "Beta"],
    ["sec-c", "Gamma"],
  ] as const) {
    const section = document.createElement("section");
    section.id = id;
    section.setAttribute("data-section", label);
    section.innerHTML = `<h2 tabindex="-1">${label}</h2>`;
    /* jsdom has no `scrollIntoView`, and a reveal calls it (flash.ts). */
    section.scrollIntoView = () => {};
    page.append(section);
  }
  const host = document.createElement("div");
  document.body.append(page, host);
  const root = createRoot(host);
  const ref = createRef<HTMLElement>();
  (ref as { current: HTMLElement | null }).current = page;
  act(() => {
    root.render(createElement(PageContents, { containerRef: ref, label: "Sections" }));
  });
  const m = { host, page, root };
  mounted.push(m);
  return m;
}

const nav = (m: Mounted) => m.host.querySelector<HTMLElement>("nav");
const list = (m: Mounted) => nav(m)?.querySelector<HTMLUListElement>("ul") ?? null;
const entries = (m: Mounted) =>
  [...(list(m)?.querySelectorAll<HTMLButtonElement>("li button") ?? [])].map((b) => b.textContent);
/** The *Contents* button: the nav's one button that is not a list entry. */
const contentsButton = (m: Mounted) =>
  [...(nav(m)?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find(
    (b) => !b.closest("li"),
  ) ?? null;
const box = (m: Mounted) => nav(m)?.querySelector<HTMLInputElement>('input[type="search"]') ?? null;

/** Hidden below `lg` and only there: `hidden`, with `lg:block` to undo it. */
function narrowHidden(m: Mounted): boolean {
  const ul = list(m);
  if (!ul) throw new Error("no list");
  const hidden = ul.classList.contains("tw:hidden");
  /* Hidden with nothing to bring it back would take the list off a wide
     window too, which is the one thing this change must not do. */
  if (hidden) expect(ul.classList.contains("tw:lg:block")).toBe(true);
  return hidden;
}

function type(m: Mounted, text: string) {
  const input = box(m);
  if (!input) throw new Error("no search box");
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("the nav itself", () => {
  it("is drawn at every width, and takes its margin position only from lg", () => {
    const m = mount();
    const classes = [...(nav(m)?.classList ?? [])];
    /* It was `tw:hidden tw:lg:flex`: not drawn at all on a phone. */
    expect(classes).not.toContain("tw:hidden");
    expect(classes).toContain("tw:lg:fixed");
    /* An unscoped one of these would pin the block over the page on a phone. */
    for (const cls of classes) {
      if (/^tw:(fixed|left-|top-|max-h-|z-|w-)/.test(cls)) throw new Error(`${cls} is not lg-scoped`);
    }
  });
});

describe("the Contents button", () => {
  it("is there, shut, and names its own list", () => {
    const m = mount();
    const button = contentsButton(m);
    expect(button?.textContent).toBe("Contents");
    expect(button?.getAttribute("type")).toBe("button");
    expect(button?.getAttribute("aria-expanded")).toBe("false");
    const id = button?.getAttribute("aria-controls");
    expect(id).toBeTruthy();
    expect(document.getElementById(id ?? "")).toBe(list(m));
    expect(narrowHidden(m)).toBe(true);
  });

  it("is drawn only below lg, after the search box and before the list", () => {
    const m = mount();
    const button = contentsButton(m);
    const input = box(m);
    const ul = list(m);
    if (!button || !input || !ul) throw new Error("missing a part");
    expect(button.classList.contains("tw:lg:hidden")).toBe(true);
    expect(input.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(button.compareDocumentPosition(ul) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("opens the list when pressed, and shuts it again", () => {
    const m = mount();
    act(() => contentsButton(m)?.click());
    expect(contentsButton(m)?.getAttribute("aria-expanded")).toBe("true");
    expect(narrowHidden(m)).toBe(false);
    expect(entries(m)).toEqual(["Alpha", "Beta", "Gamma"]);

    act(() => contentsButton(m)?.click());
    expect(contentsButton(m)?.getAttribute("aria-expanded")).toBe("false");
    expect(narrowHidden(m)).toBe(true);
  });

  it("keeps the list in the document while shut, for the wide window that shows it", () => {
    const m = mount();
    expect(entries(m)).toEqual(["Alpha", "Beta", "Gamma"]);
  });
});

describe("a query in the search box", () => {
  it("shows its matches and takes the Contents button away", () => {
    const m = mount();
    type(m, "beta");
    /* A button reading `aria-expanded="false"` above a list of matches would
       be a lie, and results folded away look like a search that found
       nothing. GPT Sol's F1 on the plan. */
    expect(contentsButton(m)).toBeNull();
    expect(narrowHidden(m)).toBe(false);
    expect(entries(m)).toEqual(["Beta"]);
  });

  it("brings the button back shut when it was shut", () => {
    const m = mount();
    type(m, "beta");
    type(m, "");
    expect(contentsButton(m)?.getAttribute("aria-expanded")).toBe("false");
    expect(narrowHidden(m)).toBe(true);
  });

  it("brings the button back open when it was open", () => {
    const m = mount();
    act(() => contentsButton(m)?.click());
    type(m, "beta");
    expect(contentsButton(m)).toBeNull();
    type(m, "");
    expect(contentsButton(m)?.getAttribute("aria-expanded")).toBe("true");
    expect(narrowHidden(m)).toBe(false);
    expect(entries(m)).toEqual(["Alpha", "Beta", "Gamma"]);
  });

  it("reveals the first match on Enter, with the list never opened", () => {
    const m = mount();
    const revealed: string[] = [];
    for (const el of m.page.querySelectorAll<HTMLElement>("[data-section]")) {
      el.addEventListener(SECTION_REVEAL, () => revealed.push(el.id));
    }
    type(m, "gamma");
    act(() => {
      box(m)?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      );
    });
    expect(revealed).toEqual(["sec-c"]);
    expect(document.activeElement).toBe(m.page.querySelector("#sec-c h2"));
  });
});

describe("the field and the rows, for a finger", () => {
  it("gives the search box 16px type on a touch screen, so iOS does not zoom into it", () => {
    const m = mount();
    expect(box(m)?.classList.contains("tw:any-pointer-coarse:text-base")).toBe(true);
  });

  it("makes an entry taller and larger below lg, and today's size from lg", () => {
    const m = mount();
    const entry = list(m)?.querySelector("li button");
    for (const cls of ["tw:py-2", "tw:text-sm", "tw:lg:py-1", "tw:lg:text-xs"]) {
      expect(entry?.classList.contains(cls), cls).toBe(true);
    }
  });
});

describe("two of these pages at once", () => {
  it("gives each list its own id, so each button controls its own", () => {
    const first = mount();
    const second = mount();
    const a = contentsButton(first)?.getAttribute("aria-controls");
    const b = contentsButton(second)?.getAttribute("aria-controls");
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(a).not.toBe(b);
    expect(list(first)?.id).toBe(a);
    expect(list(second)?.id).toBe(b);

    act(() => contentsButton(second)?.click());
    expect(narrowHidden(first)).toBe(true);
    expect(narrowHidden(second)).toBe(false);
  });
});
