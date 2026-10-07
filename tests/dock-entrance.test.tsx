// @vitest-environment jsdom
/**
 * **The bottom bar's entrance: absent for a second, then it fades and rises**
 * — once, on the first reading view of the page's lifetime (Greg, 2026-10-06,
 * spya-dest8x; plan 261007c, D7).
 *
 * What can go quietly wrong, and each has a case:
 *
 * - **StrictMode spends it before anything shows.** The guard is a module-level
 *   boolean; written during render, React's discarded first render would set it
 *   and the committed one would read *already played* (GPT Sol, PR-7).
 * - **It plays again** — on the next article, or on coming back from Metadata —
 *   and a regular pays a second without the bar every time (PR-6).
 * - **The wrong bar plays it.** Only the Reader's; the Metadata page's and the
 *   visitor pages' bars never do, so the class is a prop the Reader passes.
 * - **The install hint floats over an empty strip** for that second (PR-5).
 * - **The animation takes `transform`**, which is the phone's hide-on-scroll
 *   rule's, or leaves the bar focusable while it is invisible (PR-8).
 *
 * Whether it *looks* right is a browser's to say; this holds the wiring.
 */
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const offer = vi.hoisted(() => ({ install: false }));
vi.mock("../src/web/install-hint.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/web/install-hint.js")>();
  return { ...real, shouldOfferInstall: () => offer.install };
});

const { Dock } = await import("../src/web/Dock.js");
const { resetDockEntranceForTests, useDockEntrance } = await import("../src/web/reader/dock-entrance.js");
const { EXPERIMENTAL_OFF } = await import("./helpers/experimental-fixtures.js");

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  history.replaceState(null, "", "/read/a-piece");
  offer.install = false;
  resetDockEntranceForTests();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

/** What Reader.tsx does: ask the hook, hand the answer to its Dock. */
function ReadingView({ slug = "a-piece" }: { slug?: string }) {
  const entrance = useDockEntrance();
  return (
    <Dock slug={slug} view="article" mode="plain" onMode={() => {}} experimental={EXPERIMENTAL_OFF} entrance={entrance} />
  );
}

function mount(node: React.ReactNode): void {
  act(() => {
    root.render(<StrictMode>{node}</StrictMode>);
  });
}

function remount(node: React.ReactNode): void {
  act(() => root.unmount());
  root = createRoot(host);
  mount(node);
}

const dock = () => host.querySelector<HTMLElement>(".dock") as HTMLElement;
const entering = () => dock().classList.contains("dock-enter");

describe("which mount plays the entrance", () => {
  it("the first reading view of the page's lifetime does, under StrictMode", () => {
    mount(<ReadingView />);
    expect(entering()).toBe(true);
  });

  it("keeps the class through later renders of that mount, so the animation is not cut off", () => {
    mount(<ReadingView />);
    mount(<ReadingView slug="a-piece" />);
    expect(entering()).toBe(true);
  });

  it("a later reading view does not: another article, or the way back from Metadata", () => {
    mount(<ReadingView />);
    expect(entering()).toBe(true);
    remount(<ReadingView slug="another-piece" />);
    expect(entering()).toBe(false);
    remount(<ReadingView />);
    expect(entering()).toBe(false);
  });

  it("a bar that is not handed the prop never does, in either arm", () => {
    mount(<Dock slug="a-piece" view="article" mode="plain" onMode={() => {}} experimental={EXPERIMENTAL_OFF} />);
    expect(entering()).toBe(false);
    history.replaceState(null, "", "/read/a-piece/metadata");
    remount(<Dock slug="a-piece" view="metadata" experimental={EXPERIMENTAL_OFF} />);
    expect(entering()).toBe(false);
  });

  it("a Metadata bar mounted first does not spend the Reader's entrance", () => {
    history.replaceState(null, "", "/read/a-piece/metadata");
    mount(<Dock slug="a-piece" view="metadata" experimental={EXPERIMENTAL_OFF} />);
    history.replaceState(null, "", "/read/a-piece");
    remount(<ReadingView />);
    expect(entering()).toBe(true);
  });

  it("the fit class and the entrance class sit side by side on the bar", () => {
    mount(<ReadingView />);
    expect(dock().classList.contains("dock")).toBe(true);
    expect(dock().className).toMatch(/^dock( dock-fit-\d)? dock-enter$/);
  });
});

describe("the iOS install hint arrives with the bar", () => {
  it("carries the entrance class when the bar does", () => {
    offer.install = true;
    mount(<ReadingView />);
    const hint = host.querySelector(".install-hint");
    expect(hint, "the fixture draws the hint").not.toBeNull();
    expect(hint?.classList.contains("dock-enter")).toBe(true);
  });

  it("and not otherwise", () => {
    offer.install = true;
    mount(<ReadingView />);
    remount(<ReadingView />);
    expect(host.querySelector(".install-hint")?.classList.contains("dock-enter")).toBe(false);
  });
});

describe("only the Reader asks for it", () => {
  const src = (path: string) => readFileSync(path, "utf8");

  it("Reader.tsx hands its Dock the hook's answer", () => {
    const reader = src("src/web/reader/Reader.tsx");
    expect(reader).toMatch(/const dockEntrance = useDockEntrance\(\);/);
    expect(reader).toMatch(/<Dock\b[^>]*?\bentrance=\{dockEntrance\}/s);
  });

  it("Metadata and the visitor pages do not", () => {
    for (const path of ["src/web/Metadata.tsx", "src/web/PublicPages.tsx"]) {
      expect(src(path), path).not.toMatch(/entrance|useDockEntrance/);
    }
  });

  /**
   * **A text check, because the rendered ones cannot see this.** Measured
   * 2026-10-07: with the write moved into the `useState` initialiser, every
   * rendered case above stayed green under `<StrictMode>` — React keeps the
   * first initialiser's result — though a render React abandons would still
   * have spent the entrance. A bare write in the render body does go red
   * there. So the rule itself is held here: one write, and it is in the effect.
   */
  it("the guard is written once, inside the effect, and nowhere in render", () => {
    const code = src("src/web/reader/dock-entrance.ts").replace(/\/\*[\s\S]*?\*\//g, "");
    const hook = code.slice(code.indexOf("export function useDockEntrance"), code.indexOf("export function reset"));
    expect(hook.match(/played = /g) ?? []).toHaveLength(1);
    expect(hook).toMatch(/useEffect\(\(\) => \{\s*played = true;\s*\}, \[\]\);/);
    expect(hook).toMatch(/useState\(\(\) => !played\)/);
  });

  it("the Dock does not infer it: the guard is not read inside Dock.tsx", () => {
    expect(src("src/web/Dock.tsx")).not.toMatch(/useDockEntrance|dock-entrance\.js/);
  });
});

/* ------------------------------------------------------------------ CSS -- */

/** A stylesheet with its comments gone, so prose about a property is not a use of it. */
function stripped(path: string): string {
  return readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
}

/** The body of the first rule whose selector list is exactly `selector`. */
function rule(css: string, selector: string): string {
  const at = css.indexOf(`${selector} {`);
  expect(at, `no rule for ${selector}`).toBeGreaterThan(-1);
  const open = css.indexOf("{", at);
  return css.slice(open + 1, css.indexOf("}", open));
}

describe("the entrance, as the stylesheet writes it", () => {
  const css = stripped("src/web/styles/dock.css");

  it("is hidden outright during the delay, then runs once and holds its end", () => {
    const body = rule(css, ".dock.dock-enter,\n.install-hint.dock-enter");
    expect(body).toMatch(/visibility:\s*hidden;/);
    expect(body).toMatch(/animation:\s*dock-enter 0\.6s ease 1s forwards;/);
  });

  it("both keyframes are visible, and it moves by opacity and `translate`", () => {
    const at = css.indexOf("@keyframes dock-enter");
    expect(at).toBeGreaterThan(-1);
    const end = css.indexOf("\n}", at);
    const frames = css.slice(at, end);
    const from = frames.slice(frames.indexOf("from"), frames.indexOf("to {"));
    const to = frames.slice(frames.indexOf("to {"));
    for (const [name, frame] of [
      ["from", from],
      ["to", to],
    ] as const) {
      expect(frame, name).toMatch(/visibility:\s*visible;/);
      expect(frame, name).toMatch(/opacity:/);
      expect(frame, name).toMatch(/(?<![-\w])translate:/);
    }
    expect(from).toMatch(/opacity:\s*0;/);
    expect(to).toMatch(/opacity:\s*1;/);
  });

  it("never animates `transform`, which belongs to the phone's hide-on-scroll rule", () => {
    const at = css.indexOf("@keyframes dock-enter");
    const frames = css.slice(at, css.indexOf("\n}", at));
    expect(frames).not.toMatch(/transform/);
    expect(rule(css, ".dock.dock-enter,\n.install-hint.dock-enter")).not.toMatch(/transform/);
  });

  it("is switched off for a reader who asked for less motion, and the bar is simply there", () => {
    const blocks = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/g)].map(
      (m) => m[1] ?? "",
    );
    const block = blocks.find((b) => b.includes(".dock-enter"));
    expect(block, "no reduced-motion rule names .dock-enter").toBeDefined();
    const body = rule(block ?? "", ".dock.dock-enter,\n  .install-hint.dock-enter");
    expect(body).toMatch(/animation:\s*none;/);
    expect(body).toMatch(/visibility:\s*visible;/);
  });
});
