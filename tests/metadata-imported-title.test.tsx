// @vitest-environment jsdom
/**
 * **The Metadata page's "Imported as …" line**: the original of a title import
 * tidied, and the button that puts it back.
 * docs/plans/261005g-tidy-an-imported-title-and-keep-the-original.md
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
vi.mock("nuqs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("nuqs")>()),
  useQueryState: () => [null, () => {}],
}));
vi.mock("../src/web/Dock.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/web/Dock.js")>()),
  Dock: () => null,
}));

const { ImportedTitle } = await import("../src/web/Metadata.js");

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

const mount = (props: { original: string | undefined; showing: string; onUse?: (title: string) => void }) =>
  act(async () => root.render(createElement(ImportedTitle, { onUse: () => {}, ...props })));

describe("the imported title, on the Metadata page", () => {
  it("shows the original beside a tidied title, and hands it back when asked", async () => {
    const used: string[] = [];
    await mount({ original: "THE ORDER OF TIME", showing: "The Order of Time", onUse: (t) => used.push(t) });
    const line = host.querySelector("[data-imported-title]");
    expect(line?.textContent).toContain("Imported as “THE ORDER OF TIME”.");
    await act(async () => line?.querySelector("button")?.click());
    expect(used).toEqual(["THE ORDER OF TIME"]);
  });

  it("draws nothing when import changed nothing", async () => {
    await mount({ original: undefined, showing: "The Order of Time" });
    expect(host.querySelector("[data-imported-title]")).toBeNull();
  });

  it("draws nothing once the original is the title showing", async () => {
    await mount({ original: "THE ORDER OF TIME", showing: "THE ORDER OF TIME" });
    expect(host.querySelector("[data-imported-title]")).toBeNull();
  });
});
