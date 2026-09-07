// @vitest-environment jsdom
/**
 * **The wordmark's hover animations: the trigger, and the seam between the
 * registry and the stylesheet.**
 *
 * Two different kinds of test live here because the feature has two different
 * ways of failing, and only one of them is visible.
 *
 * The **trigger** tests are ordinary: hovering picks an animation, a touch does
 * not, a long press picks one and does not navigate. Those would be caught by
 * anybody who tried the feature.
 *
 * The **seam** tests are the ones that matter. An animation is an entry in
 * `LOGO_ANIMATIONS` *and* a rule in src/web/styles/logo-animations.css, kept in
 * agreement by nothing but attention. Drop either half and the failure is
 * silent in the precise sense of docs/reusable/silent-success.md: the picker
 * still returns the entry, the class still goes on the element, nothing throws,
 * no test goes red, and one hover in twelve simply does nothing at all. Nobody
 * would report that — a reader who hovers and sees no animation assumes they
 * imagined the feature, and an agent who hovers once has an 11-in-12 chance of
 * seeing a different one work.
 *
 * The same reasoning covers the two style rules the animations live under, both
 * of which are invisible when broken: a rule written as `.logo:hover` works
 * perfectly for whoever wrote it and is dead on a touch device and on
 * `/design`; a rule written against `.logo-text` works in the corner and is
 * dead on the reading view, which is the copy most readers see most often.
 * src/web/styles/logo-animations.css states both; these assert them.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HomeLogo } from "../src/web/HomeLogo.js";
import {
  LOGO_ANIMATIONS,
  pickLogoAnimation,
  useLogoAnimation,
} from "../src/web/logo-animation.js";

const CSS = readFileSync(
  path.join(import.meta.dirname, "..", "src", "web", "styles", "logo-animations.css"),
  "utf8",
);

/** The stylesheet with its comments removed, so a class named in prose is not evidence. */
const RULES = CSS.replace(/\/\*[\s\S]*?\*\//g, "");

describe("the registry and the stylesheet agree", () => {
  it("gives every registered animation a rule of its own", () => {
    const missing = LOGO_ANIMATIONS.filter((a) => !RULES.includes(`.${a.id}`));
    expect(missing.map((a) => a.id)).toEqual([]);
  });

  it("registers every animation class the stylesheet defines", () => {
    /* Everything matching the naming convention except `.spya-anim` itself,
       which is the shared base rather than an animation. */
    const declared = new Set(
      [...RULES.matchAll(/\.(spya-[a-z0-9-]+)/g)]
        .map((m) => m[1] as string)
        .filter((c) => c !== "spya-anim"),
    );
    const registered = new Set(LOGO_ANIMATIONS.map((a) => a.id));
    const orphans = [...declared].filter((c) => !registered.has(c));
    expect(orphans).toEqual([]);
  });

  it("gives every animation a name and a blurb for /design", () => {
    for (const a of LOGO_ANIMATIONS) {
      expect(a.name.length, a.id).toBeGreaterThan(0);
      expect(a.blurb.length, a.id).toBeGreaterThan(0);
    }
  });

  it("has no duplicate ids", () => {
    const ids = LOGO_ANIMATIONS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("the two rules the stylesheet is written under", () => {
  it("drives every animation off the class, never off :hover", () => {
    /* `:hover` is one of three ways an animation starts, and the other two — a
       long press, and /design applying the class directly — do not produce one.
       See the file header. */
    expect(RULES).not.toMatch(/:hover/);
  });

  it("never selects .logo-text, which only the corner copy has", () => {
    /* The reading view's wordmark wraps its letters in `.dock-btn-label`
       instead (Dock.tsx § The word, and which mechanism takes it away), so a
       rule naming `.logo-text` silently does nothing there. */
    expect(RULES).not.toMatch(/\.logo-text/);
  });
});

describe("pickLogoAnimation", () => {
  it("never returns the animation just shown", () => {
    if (LOGO_ANIMATIONS.length < 2) return;
    for (const a of LOGO_ANIMATIONS) {
      /* Enough draws that a uniform picker excluding nothing would repeat with
         overwhelming probability — at a dozen animations, (11/12)^200 is about
         4e-8. A flake here is a real bug. */
      for (let i = 0; i < 200; i++) {
        expect(pickLogoAnimation(a.id)?.id).not.toBe(a.id);
      }
    }
  });

  it("can still return something when nothing has been shown yet", () => {
    if (LOGO_ANIMATIONS.length === 0) return;
    expect(pickLogoAnimation(null)).not.toBeNull();
  });

  it("reaches every animation", () => {
    if (LOGO_ANIMATIONS.length === 0) return;
    const seen = new Set<string>();
    for (let i = 0; i < 4000; i++) {
      const got = pickLogoAnimation(null);
      if (got) seen.add(got.id);
    }
    expect([...seen].sort()).toEqual(LOGO_ANIMATIONS.map((a) => a.id).sort());
  });
});

/* React only flushes inside `act` when it is told it is under test. */
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
});

/** The anchor `HomeLogo` renders. */
function logo(): HTMLAnchorElement {
  const el = host.querySelector("a.logo");
  if (!el) throw new Error("HomeLogo rendered no `a.logo`");
  return el as HTMLAnchorElement;
}

/**
 * A pointer event jsdom will carry.
 *
 * jsdom has no `PointerEvent` constructor, and React 19 delivers
 * `onPointerEnter`/`onPointerLeave` through the `pointerover`/`pointerout`
 * pair rather than from listeners on the element, so both the type name and
 * `pointerType` have to be supplied by hand.
 */
function pointer(type: string, init: { pointerType?: string; button?: number } = {}) {
  const e = new MouseEvent(type, { bubbles: true, button: init.button ?? 0 });
  Object.defineProperty(e, "pointerType", { value: init.pointerType ?? "mouse" });
  return e;
}

/** The animation class currently on the anchor, or null. */
function running(): string | null {
  const el = logo();
  if (!el.classList.contains("spya-anim")) return null;
  return [...el.classList].find((c) => c.startsWith("spya-") && c !== "spya-anim") ?? null;
}

describe("the trigger", () => {
  it("renders the markup the stylesheet keys on", () => {
    act(() => root.render(<HomeLogo />));
    expect(logo().querySelectorAll(".logo-letter")).toHaveLength(10);
    expect(logo().querySelector("img.logo-image")).not.toBeNull();
  });

  it("picks an animation when a mouse hovers, and drops it on leaving", () => {
    if (LOGO_ANIMATIONS.length === 0) return;
    act(() => root.render(<HomeLogo />));
    expect(running()).toBeNull();

    act(() => {
      logo().dispatchEvent(pointer("pointerover"));
    });
    expect(running()).not.toBeNull();

    act(() => {
      logo().dispatchEvent(pointer("pointerout"));
    });
    expect(running()).toBeNull();
  });

  it("ignores the pointerover a tap fires, so a tap on the way home is not a hover", () => {
    if (LOGO_ANIMATIONS.length === 0) return;
    act(() => root.render(<HomeLogo />));
    act(() => {
      logo().dispatchEvent(pointer("pointerover", { pointerType: "touch" }));
    });
    expect(running()).toBeNull();
  });

});

/**
 * The hook on a bare `<a>` rather than on `HomeLogo`.
 *
 * The long-press tests below ask whether the hook calls `preventDefault` on the
 * click, and through `HomeLogo` that question cannot be asked: `Link` calls
 * `preventDefault` itself on every plain left-click, because that is how it
 * takes over navigation from the browser (Link.tsx). Both the suppressed and
 * the unsuppressed case would come back prevented, and the test would pass
 * whatever the hook did — which is worse than not having it.
 */
function Bare() {
  const anim = useLogoAnimation();
  return (
    <a href="/read" className={`logo bare ${anim.className}`} {...anim.handlers}>
      Spideryarn
    </a>
  );
}

function bare(): HTMLAnchorElement {
  const el = host.querySelector("a.bare");
  if (!el) throw new Error("Bare rendered no anchor");
  return el as HTMLAnchorElement;
}

describe("the long press", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("picks an animation once the press is held, and swallows the click", () => {
    if (LOGO_ANIMATIONS.length === 0) return;
    act(() => root.render(<Bare />));
    act(() => {
      bare().dispatchEvent(pointer("pointerdown", { pointerType: "touch" }));
    });
    expect(bare().className).not.toContain("spya-anim");

    act(() => void vi.advanceTimersByTime(400));
    expect(bare().className).toContain("spya-anim");

    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    act(() => {
      bare().dispatchEvent(pointer("pointerup", { pointerType: "touch" }));
      bare().dispatchEvent(click);
    });
    /* The point of the whole gesture: a reader who held the wordmark down to
       watch it asked to *see* something, not to leave the page they were on. */
    expect(click.defaultPrevented).toBe(true);
  });

  it("clears the animation a while after the finger lifts", () => {
    if (LOGO_ANIMATIONS.length === 0) return;
    act(() => root.render(<Bare />));
    act(() => {
      bare().dispatchEvent(pointer("pointerdown", { pointerType: "touch" }));
    });
    act(() => void vi.advanceTimersByTime(400));
    act(() => {
      bare().dispatchEvent(pointer("pointerup", { pointerType: "touch" }));
    });
    /* Still running while the reader looks at it — a finger has no un-hover, so
       something has to end it. */
    expect(bare().className).toContain("spya-anim");
    act(() => void vi.advanceTimersByTime(5000));
    expect(bare().className).not.toContain("spya-anim");
  });

  it("lets a short press through, so the way home still works", () => {
    act(() => root.render(<Bare />));
    act(() => {
      bare().dispatchEvent(pointer("pointerdown"));
    });
    act(() => void vi.advanceTimersByTime(120));
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    act(() => {
      bare().dispatchEvent(pointer("pointerup"));
      bare().dispatchEvent(click);
    });
    expect(click.defaultPrevented).toBe(false);
  });
});
