// @vitest-environment jsdom
/**
 * **Under a finger, nothing to press is under 40 × 40px** — the rest of the
 * targets, plan 261021g § Stage 2 (and its § Plan review, which overrides the
 * table). Greg on an iPhone, 2026-10-20: *"the icons are too small"*.
 *
 * One assertion per target the plan took on, each that the size is written
 * under the coarse query with a 40px value, and nowhere else:
 *
 *  - shadcn `Button`: every size at least 40 high, the icon sizes 40 wide too;
 *  - the band's corner (the (i) and the owner's badge beside it), with the gap
 *    between them opened;
 *  - the masthead's sharing mark, Archive and the title's pencil;
 *  - the facts line's controls, drawn 40px tall rather than haloed (Sol, R4);
 *  - the shelf card's *Tag* and its date line, haloed;
 *  - Quiz's *Only what I've read* label, its share pie, and its steppers;
 *  - *Dictate*, the References stub, Glossary's Hide, the footer's links;
 *  - the bottom dock's mode buttons, which came out at 39.4px.
 *
 * **Why `40px` and not `2.5rem`** (or Tailwind's `size-10`, which is
 * `2.5rem`): the phone the measuring pass used had a 15.36px root, where
 * `2.5rem` is 38.4px — 261021c's C2 was exactly that.
 *
 * ## What this does NOT prove
 *
 * That the cascade lets these win, or that a finger lands where it should.
 * This reads text and compiles class names; the Sonnet browser pass at 390
 * reads computed sizes and is the real check (plan § Done looks like).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { __unstable__loadDesignSystem } from "tailwindcss";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Article } from "../src/types.js";
import { readerCssNoComments } from "./helpers/stylesheets.js";

const apiFetch = vi.fn();
vi.mock("../src/web/lib/api.js", async () => {
  const actual = await vi.importActual<typeof import("../src/web/lib/api.js")>("../src/web/lib/api.js");
  return { ...actual, apiFetch: (...args: unknown[]) => apiFetch(...args) };
});

const { buttonVariants } = await import("../src/web/components/ui/button.js");
const { Masthead } = await import("../src/web/Masthead.js");
const { useArchive } = await import("../src/web/useArchive.js");
const { SiteFooter } = await import("../src/web/SiteFooter.js");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ROOT = path.resolve(import.meta.dirname, "..");
const source = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

/** Every `@media (<query>)` block's body, this query only. tap-target.test.tsx's helper, generalised. */
function blocks(css: string, query: "any-pointer: coarse" | "pointer: coarse"): string {
  const [feature, value] = query.split(":").map((s) => s.trim());
  const re = new RegExp(`@media\\s*\\(\\s*${feature}:\\s*${value}\\s*\\)\\s*\\{`, "g");
  const out: string[] = [];
  for (const m of css.matchAll(re)) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    while (i < css.length && depth > 0) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}") depth--;
      i++;
    }
    out.push(css.slice(start, i - 1));
  }
  return out.join("\n");
}

/** The declarations of the first rule whose selector list names `selector`. */
function declsFor(css: string, selector: string): string | undefined {
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const list = (m[1] ?? "").split(",").map((s) => s.trim());
    if (list.includes(selector)) return m[2] ?? "";
  }
  return undefined;
}

const css = readerCssNoComments();
const coarse = blocks(css, "any-pointer: coarse");

/** Compiles Tailwind class names the way the build does (run-buttons-and-text-boxes-agree.test.ts). */
let compile: (classes: string[]) => (string | null)[];
beforeAll(async () => {
  const entry = path.join(ROOT, "src/web/tailwind.css");
  const system = await __unstable__loadDesignSystem(readFileSync(entry, "utf8"), {
    base: path.dirname(entry),
    async loadStylesheet(id, from) {
      const p = id.startsWith(".") ? path.resolve(from, id) : path.join(ROOT, "node_modules", id);
      return { path: p, base: path.dirname(p), content: readFileSync(p, "utf8") };
    },
  });
  compile = (classes) => system.candidatesToCss(classes);
});

/** The one class in `classes` that the coarse variant applies, compiled: it must exist and say `prop: 40px`. */
function expectCoarse40(classes: string, prefix: string, props: string[]) {
  const cls = classes.split(/\s+/).find((c) => c.startsWith(`tw:any-pointer-coarse:${prefix}`));
  expect(cls, `no tw:any-pointer-coarse:${prefix}… in "${classes}"`).toBeDefined();
  const out = compile([cls ?? ""])[0] ?? "";
  expect(out).toContain("@media (any-pointer: coarse)");
  for (const prop of props) expect(out).toMatch(new RegExp(`${prop}:\\s*40px`));
}

describe("shadcn Button", () => {
  const SIZES = ["default", "xs", "sm", "lg", "icon", "icon-xs", "icon-sm", "icon-lg"] as const;
  it.each(SIZES)("%s is at least 40px high under a finger", (size) => {
    expectCoarse40(buttonVariants({ size }), "min-h-", ["min-height"]);
  });
  it.each(SIZES.filter((s) => s.startsWith("icon")))("%s is at least 40px wide too", (size) => {
    expectCoarse40(buttonVariants({ size }), "min-w-", ["min-width"]);
  });
});

describe("the band's corner", () => {
  it("draws the (i) and the owner's badge at 40px, with a gap of at least 4px", () => {
    const corner = declsFor(coarse, ".mode-band.has-about");
    expect(corner, "no any-pointer coarse size for the band's corner").toBeDefined();
    expect(corner).toMatch(/--band-corner-btn:\s*max\(\s*40px\s*,\s*2\.5rem\s*\)/);
    const gap = /--band-corner-gap:\s*([\d.]+)rem/.exec(corner ?? "");
    /* At the 12px root the app supports, too. */
    expect(Number(gap?.[1]) * 12).toBeGreaterThanOrEqual(4);
  });
});

const SLUG = "a-piece";
function article(): Article {
  return {
    highPowerSince: null,
    titleOverridden: false,
    meta: { slug: SLUG, title: "A piece", url: "https://example.com/the-piece" },
    blocks: [
      { id: "spya-aaaaaa", tag: "p", kind: "text", text: "A paragraph.", words: 2, html: "<p>A paragraph.</p>", gistable: true },
    ],
    assets: undefined,
    navLabelStatus: "ready",
    sourceGuess: undefined,
    tree: {
      version: "t",
      generator: "t",
      slug: SLUG,
      rootId: "n0",
      nodes: { n0: { id: "n0", depth: 0, parent: null, children: [], range: ["spya-aaaaaa", "spya-aaaaaa"], title: "A piece" } },
    },
    visibility: "private",
    archivedAt: null,
  };
}

describe("the masthead's three icons", () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    history.replaceState(null, "", `/read/${SLUG}`);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  function Harness() {
    const archive = useArchive(SLUG, null, true, false);
    return createElement(Masthead, { article: article(), slug: SLUG, onRenamed: () => {}, archive });
  }

  it("sharing mark, Archive and the pencil are each drawn 40 × 40 under a finger", async () => {
    await act(async () => root.render(createElement(Harness)));
    const sharing = host.querySelector<HTMLAnchorElement>(`a[href^="/read/${SLUG}/metadata"]`);
    const archive = host.querySelector<HTMLButtonElement>('[data-testid="masthead-archive"]');
    const pencil = host.querySelector<HTMLButtonElement>('button[aria-label="Edit title"]');
    expect(sharing && archive && pencil, "a masthead icon is missing").toBeTruthy();
    expectCoarse40(sharing?.className ?? "", "size-", ["width", "height"]);
    expectCoarse40(archive?.className ?? "", "size-", ["width", "height"]);
    /* The pencil is an `IconButton`, which takes no class: its wrapper sizes
       it, so every other IconButton keeps its 28px (Sol, R3). */
    const wrap = pencil?.parentElement?.className ?? "";
    expect(pencil?.className ?? "").not.toMatch(/any-pointer-coarse/);
    const cls = wrap.split(/\s+/).find((c) => c.startsWith("tw:any-pointer-coarse:[&>button]:size-"));
    expect(cls, "the pencil's wrapper does not size it for a finger").toBeDefined();
    const out = compile([cls ?? ""])[0] ?? "";
    expect(out).toContain("@media (any-pointer: coarse)");
    expect(out).toMatch(/> button/);
    expect(out).toMatch(/width:\s*40px/);
  });
});

describe("drawn 40px tall under a finger", () => {
  it.each([".origin-link", ".facts > .fold-all", ".facts > .counts-toggle", ".read-time-trigger"])(
    "the facts line's %s is an inline-flex 40px box, not a halo (Sol, R4)",
    (selector) => {
      const rule = declsFor(coarse, selector);
      expect(rule, `no any-pointer coarse rule for ${selector}`).toBeDefined();
      expect(rule).toMatch(/display:\s*inline-flex/);
      expect(rule).toMatch(/align-items:\s*center/);
      expect(rule).toMatch(/min-height:\s*40px/);
    },
  );

  it("Quiz's Only what I've read label is 40px tall", () => {
    expect(declsFor(coarse, ".quiz-only-read label")).toMatch(/min-height:\s*40px/);
  });

  it("Quiz's share pie is 40 × 40, with no negative margin and an 8px gap from the label", () => {
    const pie = declsFor(coarse, ".share-pie");
    expect(pie).toMatch(/width:\s*40px/);
    expect(pie).toMatch(/height:\s*40px/);
    expect(pie).toMatch(/margin:\s*0/);
    expect(declsFor(coarse, ".quiz-only-read-what")).toMatch(/gap:\s*8px/);
  });

  it("Quiz's steppers are 40 × 40, keeping their gap (Sol, R7)", () => {
    const quiz = source("src/web/QuizPanel.tsx");
    const step = /className="([^"]*\bquiz-step\b[^"]*)"/.exec(quiz)?.[1] ?? "";
    expect(step).not.toMatch(/gap-0/);
    const cls = step.split(/\s+/).find((c) => c.startsWith("tw:any-pointer-coarse:[&>button]:size-"));
    expect(cls, "the stepper row does not size its buttons for a finger").toBeDefined();
    const out = compile([cls ?? ""])[0] ?? "";
    expect(out).toContain("@media (any-pointer: coarse)");
    expect(out).toMatch(/width:\s*40px/);
    expect(out).toMatch(/height:\s*40px/);
  });

  it("Dictate is 40 × 40", () => {
    const mic = declsFor(coarse, ".prof-mic");
    expect(mic).toMatch(/width:\s*40px/);
    expect(mic).toMatch(/height:\s*40px/);
  });

  it("the References stub is 40px tall, its ⓘ 40 × 40, 8px apart (Sol, R5)", () => {
    expect(declsFor(coarse, ".matter-stub > .matter-stub-open")).toMatch(/min-height:\s*40px/);
    const info = declsFor(coarse, ".matter-stub-info");
    expect(info).toMatch(/width:\s*40px/);
    expect(info).toMatch(/height:\s*40px/);
    expect(declsFor(coarse, ".matter-stub")).toMatch(/gap:\s*8px/);
  });

  it("Glossary's Hide is 40 × 40 (Sol, R8)", () => {
    const hide = declsFor(coarse, ".gloss-hide");
    expect(hide).toMatch(/width:\s*40px/);
    expect(hide).toMatch(/height:\s*40px/);
  });

  it("every footer link is an inline-flex 40px box (Sol, R8)", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(createElement(SiteFooter)));
    const links = [...host.querySelectorAll<HTMLAnchorElement>('nav[aria-label="Site"] a')];
    expect(links.length).toBeGreaterThan(0);
    for (const a of links) {
      expect(a.className).toContain("tw:any-pointer-coarse:inline-flex");
      expectCoarse40(a.className, "min-h-", ["min-height"]);
    }
    await act(async () => root.unmount());
    host.remove();
  });
});

describe("haloed under a finger", () => {
  /* The nearest pressable control is 55px away (plan § Stage 2), so the halo
     has its room, and the card's layout does not move. */
  it("the shelf card's Tag button and its date line carry .tap-target", () => {
    const tag = /<button[\s\S]*?aria-label=\{tags\.length[\s\S]*?className=\{`([^`]*)`/.exec(
      source("src/web/ShelfTags.tsx"),
    )?.[1];
    expect(tag, "could not find the Tag button's class").toBeDefined();
    expect(tag?.split(/\s+/)).toContain("tap-target");
    const date = /aria-label=\{`\$\{note\} — details of[^`]*`\}\s*className="([^"]*)"/.exec(
      source("src/web/ShelfEntry.tsx"),
    )?.[1];
    expect(date, "could not find the date line's class").toBeDefined();
    expect(date?.split(/\s+/)).toContain("tap-target");
  });
});

describe("the bottom dock", () => {
  /* Its own query, `pointer: coarse`, for touch.md's reason. A mode button is
     the bar less its top hairline, its frame's two 1px edges and the mode
     row's 0.3rem margins; at a 16px root `3.25rem` left 39.4px. */
  it("leaves a framed mode button at least 40px tall at every root the app supports", () => {
    const bar = declsFor(blocks(css, "pointer: coarse"), ":root");
    const m = /--dock-h:\s*max\(\s*([\d.]+)rem\s*,\s*calc\(\s*([\d.]+)px\s*\+\s*([\d.]+)rem\s*\)\s*\)/.exec(bar ?? "");
    expect(m, `--dock-h is not max(Nrem, calc(Npx + Nrem)): ${bar}`).not.toBeNull();
    /* The two parts the sum assumes: the row's vertical margin, and the frame's 1px edge. */
    const margin = /margin:\s*([\d.]+)rem\s/.exec(declsFor(css, ".dock-modes") ?? "");
    expect(margin, "the mode row's margin moved; recheck the sum").not.toBeNull();
    expect(declsFor(css, ".dock-frame")).toMatch(/border:\s*1px solid/);
    for (const rootPx of [12, 15.36, 16, 20]) {
      const h = Math.max(Number(m?.[1]) * rootPx, Number(m?.[2]) + Number(m?.[3]) * rootPx);
      const button = h - 1 - 2 - 2 * Number(margin?.[1]) * rootPx;
      expect(button, `at a ${rootPx}px root`).toBeGreaterThanOrEqual(40 - 1e-9);
    }
  });
});

/* **A finger floor written as a bare `2.5rem` is 38.4px on the iPhone measured**
   (15.36px root). Building this stage turned up seven in coarse blocks
   (Search's sort, Reception's two, origin-chat, the badge, Glossary's sort, the
   live arrow), each meant as 40. A size inside a coarse query is a target's,
   so it says `max(40px, 2.5rem)` or `40px`. */
/* What the stage's browser pass still found under 40 (plan 261021g § What landed). */
describe("the browser pass's stragglers", () => {
  it("are 40 under a finger", () => {
    const coarse = blocks(readerCssNoComments(), "any-pointer: coarse");
    expect(declsFor(coarse, ".chat-send.quiz-go")).toMatch(/height:\s*max\(\s*40px/);
    expect(declsFor(coarse, ".srch-icon")).toMatch(/min-width:\s*40px/);
    expect(declsFor(coarse, ".prof-mic")).toMatch(/flex:\s*none/);
    for (const file of ["src/web/Metadata.tsx", "src/web/AccountSection.tsx", "src/web/PageContents.tsx"]) {
      expect(source(file), file).toContain("tw:any-pointer-coarse:min-h-[40px]");
    }
  });
});

describe("no bare 2.5rem finger floor", () => {
  it("is in any coarse-pointer block", () => {
    const css = readerCssNoComments();
    const coarse = `${blocks(css, "any-pointer: coarse")}\n${blocks(css, "pointer: coarse")}`;
    const bare = [...coarse.matchAll(/(?:^|[;{\s])((?:min-)?(?:height|width)\s*:\s*2\.5rem)\s*[;}]/g)].map((m) => m[1]);
    expect(bare).toEqual([]);
  });
});
