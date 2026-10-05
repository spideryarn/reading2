// @vitest-environment jsdom
/**
 * **Light, Dark and System, as command bar rows, pressed** —
 * docs/plans/261005d-theme-commands-in-the-command-bar.md, drawn out of the
 * real `Dock` as tests/command-bar-arguments.test.tsx draws the experimental
 * switch.
 *
 * Greg, 2026-10-04 (spya-c5wdn7): *"Add a command in the command bar to be able
 * to switch between dark and light mode, and I guess system mode as well."*
 *
 * What a happy path would not see:
 *
 *  - **The press goes through the setting /profile already has**, so the
 *    storage key and the page's `data-theme` are what is asserted, not a stub.
 *  - **All three rows are always there, and the one in force is marked** — a
 *    reader in Dark who types `dark mode` gets a row, not `No command matches.`
 *  - **A refused save still changes the page, and the bar stays open to say it
 *    will not last.**
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APPEARANCE_KEY, setAppearance } from "../src/web/appearance.js";
import { APPEARANCE_CURRENT, APPEARANCE_NOT_SAVED } from "../src/web/appearance-commands.js";
import type { DockExperimental } from "../src/web/Dock.js";
import { EXPERIMENTAL_OFF, EXPERIMENTAL_SIGNED_OUT } from "./helpers/experimental-fixtures.js";

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
vi.mock("../src/web/useDictationField.js", () => ({
  useDictationField: () => ({
    dictation: { supported: true, armed: false, transcribing: false, toggle: () => {} },
    readOnly: false,
    busy: false,
    toggle: () => {},
  }),
}));
vi.mock("../src/web/DictationStrip.js", () => ({
  DictationButton: () => createElement("button", { type: "button", className: "dictation-button" }),
  DictationStrip: () => null,
}));

const { Dock } = await import("../src/web/Dock.js");
const { jobEngine } = await import("../src/web/jobEngine.js");

const SLUG = "a-piece";
const ALL = ["Appearance: Dark", "Appearance: Light", "Appearance: System"];

let host: HTMLDivElement;
let root: Root;
/* This jsdom has no `localStorage` (tests/appearance.test.ts defines its own
   too), so the device is a map, and `refuses` is a private window. */
let stored: Map<string, string>;
let refuses: boolean;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  history.replaceState(null, "", `/read/${SLUG}?at=spya-k3m9qt`);
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
  stored = new Map();
  refuses = false;
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (refuses) throw new DOMException("blocked", "SecurityError");
        stored.set(key, value);
      },
    },
  });
  /* The module keeps the choice for the life of the page; start each test from
     the default a reader who never chose has. */
  setAppearance("dark");
  stored.clear();
  jobEngine.reset();
  vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "/api/jobs") return Promise.resolve(new Response(JSON.stringify({ jobs: [] })));
    return Promise.resolve(new Response("{}"));
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  jobEngine.reset();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  setAppearance("dark");
  Reflect.deleteProperty(window, "localStorage");
  delete document.documentElement.dataset.theme;
});

function reading(setting: DockExperimental = EXPERIMENTAL_OFF): void {
  act(() => {
    root.render(
      // biome-ignore lint/suspicious/noExplicitAny: as tests/command-bar.test.tsx § reading
      createElement(Dock as any, { slug: SLUG, view: "article", mode: "plain", onMode: () => {}, experimental: setting }),
    );
  });
}

function metadataPage(): void {
  history.replaceState(null, "", `/read/${SLUG}/metadata?at=spya-k3m9qt`);
  act(() => {
    root.render(
      // biome-ignore lint/suspicious/noExplicitAny: the metadata page's Dock has no onMode, on purpose
      createElement(Dock as any, { slug: SLUG, view: "metadata", experimental: EXPERIMENTAL_OFF }),
    );
  });
}

const dialog = (): HTMLDialogElement => host.querySelector("dialog.cmdbar") as HTMLDialogElement;
const input = (): HTMLInputElement => dialog().querySelector("input.cmdbar-input") as HTMLInputElement;
const rows = (): HTMLElement[] => [...dialog().querySelectorAll<HTMLElement>('[role="option"]')];
const listed = (): string[] => rows().map((r) => r.querySelector(".cmdbar-name")?.textContent ?? "");
const rowNamed = (name: string) => rows().find((r) => r.querySelector(".cmdbar-name")?.textContent === name);
const marker = (name: string): string | null => rowNamed(name)?.querySelector(".cmdbar-marker")?.textContent ?? null;
const status = (): string => dialog().querySelector('[role="status"]')?.textContent ?? "";

function openBar(): void {
  act(() => host.querySelector<HTMLButtonElement>(".dock-commands")?.click());
}

function type(text: string): void {
  const el = input();
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(el, text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function press(key: string): void {
  act(() => {
    input().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((go) => setTimeout(go, 0));
    });
  }
}

describe("finding the rows", () => {
  it("leaves them out of the list the bar opens on", () => {
    reading();
    openBar();
    for (const name of ALL) expect(listed()).not.toContain(name);
  });

  it.each(["appearance", "theme", "colour scheme", "color scheme"])("`%s` lists all three", (words) => {
    reading();
    openBar();
    type(words);
    for (const name of ALL) expect(listed()).toContain(name);
  });

  it.each([
    ["dark mode", "Appearance: Dark"],
    ["dark", "Appearance: Dark"],
    ["night mode", "Appearance: Dark"],
    ["light mode", "Appearance: Light"],
    ["light theme", "Appearance: Light"],
    ["system", "Appearance: System"],
    ["system mode", "Appearance: System"],
  ])("`%s` puts %s first", (words, name) => {
    reading();
    openBar();
    type(words);
    expect(listed()[0]).toBe(name);
  });

  it("offers them with nobody signed in and on the Metadata page: the choice is the device's", () => {
    reading(EXPERIMENTAL_SIGNED_OUT);
    openBar();
    type("theme");
    for (const name of ALL) expect(listed()).toContain(name);
    act(() => dialog().close());
    metadataPage();
    openBar();
    type("theme");
    for (const name of ALL) expect(listed()).toContain(name);
  });
});

describe("pressing one", () => {
  it("saves the choice on the device, repaints the page, and closes", async () => {
    reading();
    openBar();
    type("light mode");
    press("Enter");
    await settle();
    expect(stored.get(APPEARANCE_KEY)).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(dialog().open).toBe(false);
  });

  it("goes back to dark, and to system, by the same door", async () => {
    setAppearance("light");
    reading();
    openBar();
    type("dark mode");
    rowNamed("Appearance: Dark")?.click();
    await settle();
    expect(stored.get(APPEARANCE_KEY)).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    openBar();
    type("system");
    press("Enter");
    await settle();
    expect(stored.get(APPEARANCE_KEY)).toBe("system");
  });

  it("marks the one in force, and only that one, in a word that is not the description", async () => {
    reading();
    openBar();
    type("theme");
    expect(marker("Appearance: Dark")).toBe(APPEARANCE_CURRENT);
    expect(marker("Appearance: Light")).toBeNull();
    expect(marker("Appearance: System")).toBeNull();
    const before = rowNamed("Appearance: Dark")?.querySelector(".cmdbar-what")?.textContent;
    rowNamed("Appearance: Light")?.click();
    await settle();
    openBar();
    type("theme");
    expect(marker("Appearance: Light")).toBe(APPEARANCE_CURRENT);
    expect(marker("Appearance: Dark")).toBeNull();
    /* What a model is shown may not move with the reader's setting (F2). */
    expect(rowNamed("Appearance: Dark")?.querySelector(".cmdbar-what")?.textContent).toBe(before);
  });

  it("presses on the owner's Metadata page too", async () => {
    metadataPage();
    openBar();
    type("light mode");
    press("Enter");
    await settle();
    expect(stored.get(APPEARANCE_KEY)).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("still repaints when the device refuses to save, and stays open to say it will not last", async () => {
    refuses = true;
    reading();
    openBar();
    type("light mode");
    press("Enter");
    await settle();
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(dialog().open).toBe(true);
    expect(status()).toContain(APPEARANCE_NOT_SAVED);
    /* The choice holds for this page, so the mark has moved with it. */
    expect(marker("Appearance: Light")).toBe(APPEARANCE_CURRENT);
    expect(marker("Appearance: Dark")).toBeNull();
  });
});
