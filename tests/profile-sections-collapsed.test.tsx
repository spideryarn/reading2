// @vitest-environment jsdom
/**
 * **Profile's three read-outs start shut; the three a reader came for do not fold.**
 *
 * Greg, 2026-10-03, feedback report `spya-ka3cau`:
 *
 * > So the important ones that we should keep open are probably account, plan,
 * > and about you. And then I think the others could perhaps be default
 * > collapsed.
 *
 * Two halves, and each needs the other. *Account*, *Plan* and *About you* must
 * have **no** disclosure button at all — the refusal copy sends a reader to
 * the Upgrade button under *Plan*, and a heading that could be shut is a
 * button that could be hidden. *Settings*, *Recently read* and *What's
 * running* must start shut **and open when pressed** — a section that starts
 * shut and cannot be opened is the latch bug in
 * docs/postmortems/260903d-a-collapsible-section-latched-shut-and-sealed-the-error-in.md.
 *
 * The section itself is src/web/PageSection.tsx, shared with the Metadata
 * page; its own behaviour is covered by tests/metadata-section-param.test.tsx
 * and tests/metadata-contents-reveal.test.tsx. This file is only which of
 * Profile's six are which. docs/project/reader-profile.md.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* What `GET /api/models` answers; a test may put rows in it before painting. */
const posed = vi.hoisted(() => ({ models: [] as unknown[] }));

vi.mock("../src/web/lib/api.js", () => ({
  apiFetch: (url: string) =>
    Promise.resolve(new Response(null, { status: 200, headers: { "x-url": url } })),
  readJson: (r: Response) => {
    const url = r.headers.get("x-url") ?? "";
    if (url === "/api/library") return Promise.resolve({ articles: [] });
    if (url === "/api/models") return Promise.resolve({ tasks: posed.models });
    throw new Error(`nothing posed for ${url}`);
  },
}));

/* Each section's body is stood in for by one word, so "the body is showing"
   is a question about this page's folding and not about five components'
   own loading states. The two read-outs at the foot are the page's own markup
   and are asked for by a sentence they really print. */
vi.mock("../src/web/useProfile.js", () => ({
  useProfile: () => ({ draft: "", setDraft: () => {}, commit: () => {}, saved: "", state: "idle" }),
}));
vi.mock("../src/web/AccountSection.js", () => ({ AccountSection: () => "ACCOUNT-BODY" }));
vi.mock("../src/web/BillingSection.js", () => ({ BillingSection: () => "PLAN-BODY" }));
vi.mock("../src/web/ProfileBox.js", () => ({ ProfileBox: () => "ABOUT-BODY" }));
vi.mock("../src/web/AppearanceSetting.js", () => ({ AppearanceSetting: () => "APPEARANCE-BODY" }));
vi.mock("../src/web/SettingsSection.js", () => ({ SettingsSection: () => "SETTINGS-BODY" }));
vi.mock("../src/web/SiteFooter.js", () => ({ SiteFooter: () => null }));

const { ProfilePage } = await import("../src/web/ProfilePage.js");
const { CONTENTS_MARGIN } = await import("../src/web/PageContents.js");

let host: HTMLDivElement;
let root: Root;

async function paint(): Promise<void> {
  act(() => {
    root.render(createElement(ProfilePage));
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** The `<section>` whose heading reads `label`, found by the words on it. */
function section(label: string): HTMLElement {
  const heading = [...host.querySelectorAll("h2")].find((h) => h.textContent?.trim() === label);
  const el = heading?.closest("section");
  if (!el) throw new Error(`No section headed "${label}" — the page reads: ${host.textContent}`);
  return el;
}

const toggle = (label: string): HTMLButtonElement | null =>
  section(label).querySelector<HTMLButtonElement>("h2 button[aria-expanded]");

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  posed.models = [];
  act(() => root.unmount());
  host.remove();
});

/** Label, and a string its body prints. */
const OPEN: [string, string][] = [
  ["Account", "ACCOUNT-BODY"],
  ["Plan", "PLAN-BODY"],
  ["About you", "ABOUT-BODY"],
];
const SHUT: [string, string][] = [
  ["Settings", "SETTINGS-BODY"],
  ["Recently read", "Nothing on the shelf yet"],
  ["What's running", "Which model writes what"],
];

describe("the profile page's sections", () => {
  it.each(OPEN)("%s is open and cannot be shut", async (label, body) => {
    await paint();
    expect(toggle(label), "no disclosure button").toBe(null);
    expect(section(label).textContent).toContain(body);
  });

  it.each(SHUT)("%s starts shut, and its heading opens it", async (label, body) => {
    await paint();
    const button = toggle(label);
    if (!button) throw new Error(`"${label}" has no disclosure button`);
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(section(label).textContent).not.toContain(body);

    act(() => button.click());
    expect(toggle(label)?.getAttribute("aria-expanded")).toBe("true");
    expect(section(label).textContent).toContain(body);
  });

  it("keeps Settings' two controls in the one section", async () => {
    await paint();
    act(() => toggle("Settings")?.click());
    expect(section("Settings").textContent).toContain("APPEARANCE-BODY");
    expect(section("Settings").textContent).toContain("SETTINGS-BODY");
  });

  /* The browser check of 261003k read "claude-sonnet-5 · OpenRouter (undefined)"
     on every row: the page printed a `wire` the server had never sent. A row
     with one says it; a row without one (the PDF reader, the embedding model)
     says nothing rather than "undefined". */
  it("names the wire on a row that has one, and nothing on a row that has not", async () => {
    posed.models = [
      { task: "glossary", model: "claude-sonnet-5", id: "anthropic/claude-sonnet-5", provider: "openrouter", wire: "messages", source: "default" },
      { task: "embeddings", model: "an-embedder", id: "x/an-embedder", provider: "openrouter", source: "default" },
    ];
    await paint();
    act(() => toggle("What's running")?.click());
    const text = section("What's running").textContent ?? "";
    expect(text).toContain("OpenRouter (Messages)");
    expect(text).not.toContain("undefined");
    for (const el of section("What's running").querySelectorAll("[title]")) {
      expect(el.getAttribute("title")).not.toContain("undefined");
    }
  });

  /* The `?? m.provider` fallback already shows a provider or a wire this copy
     has no label for. What gets past it is a name every object inherits:
     `PROVIDER_LABEL["__proto__"]` is an object, not `undefined`.
     docs/plans/261005h, Stage A. */
  it.each(["a-newer-value", "__proto__", "constructor", "toString"])(
    "shows provider and wire %s as the server sent them",
    async (value) => {
      posed.models = [
        { task: "glossary", model: "claude-sonnet-5", id: "anthropic/claude-sonnet-5", provider: value, wire: value, source: "default" },
      ];
      await paint();
      act(() => toggle("What's running")?.click());
      const here = section("What's running");
      expect(here.textContent).toContain(`claude-sonnet-5 · ${value} (${value})`);
      expect(here.querySelector("[title]")?.getAttribute("title")).toBe(
        `anthropic/claude-sonnet-5 · via ${value} · ${value} API`,
      );
    },
  );
});

/* Greg, 2026-10-03, asked whether Profile gets Metadata's contents list too:
   *"Probably B"*, B being the list in the left margin with its search box.
   The list is src/web/PageContents.tsx, which reads the page's sections off
   the DOM, so these ask only that Profile mounts it and that its entries
   reach Profile's own sections; how it searches and scrolls is
   tests/metadata-contents-reveal.test.tsx.
   docs/plans/261003n-profile-gets-the-contents-list-and-search-box.md. */
describe("the profile page's contents list", () => {
  const nav = () => host.querySelector<HTMLElement>('nav[aria-label="Sections of this page"]');
  const entries = () => [...(nav()?.querySelectorAll<HTMLButtonElement>("li button") ?? [])];

  it("lists the six sections, in the page's order", async () => {
    await paint();
    expect(entries().map((b) => b.textContent)).toEqual([
      "Account",
      "Plan",
      "About you",
      "Settings",
      "Recently read",
      "What's running",
    ]);
  });

  it("opens a shut section when its entry is pressed", async () => {
    await paint();
    expect(toggle("What's running")?.getAttribute("aria-expanded")).toBe("false");
    act(() => entries().find((b) => b.textContent === "What's running")?.click());
    expect(toggle("What's running")?.getAttribute("aria-expanded")).toBe("true");
    expect(section("What's running").textContent).toContain("Which model writes what");
  });

  it("finds Settings by a word only its keywords carry, and Enter opens it", async () => {
    await paint();
    const box = nav()?.querySelector<HTMLInputElement>('input[type="search"]');
    if (!box) throw new Error("no search box");
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    await act(async () => {
      setter?.call(box, "dark mode");
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(entries().map((b) => b.textContent)).toEqual(["Settings"]);
    await act(async () => {
      box.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      );
    });
    expect(toggle("Settings")?.getAttribute("aria-expanded")).toBe("true");
  });

  it.each([
    ["hide experimental features", ["Settings"]],
    ["archived articles", []],
    ["font size", []],
    ["usage", ["Plan"]],
    ["bill", ["Plan"]],
  ])("uses Profile's vocabulary for %s", async (query, labels) => {
    await paint();
    const box = nav()?.querySelector<HTMLInputElement>('input[type="search"]');
    if (!box) throw new Error("no search box");
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    await act(async () => {
      setter?.call(box, query);
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(entries().map((b) => b.textContent)).toEqual(labels);
  });

  /* The list is fixed in the margin and assumes its page steps right to clear
     it (PageContents.tsx § CONTENTS_MARGIN). A page that mounts the list
     without the class puts it over the prose between 1024px and 1152px. */
  it("applies the desktop clearance class to its main column", async () => {
    await paint();
    const main = host.querySelector("main");
    expect(CONTENTS_MARGIN).toBe(
      "tw:lg:ml-[max(calc(12rem_+_var(--safe-left)),calc((100%_-_48rem)/2))]",
    );
    for (const cls of CONTENTS_MARGIN.split(" ")) {
      expect(main?.classList.contains(cls), cls).toBe(true);
    }
  });
});
