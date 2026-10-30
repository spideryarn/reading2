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
 *  - the shelf card's *Tag*, haloed with clearance, and its drawn date line;
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
import { readdirSync, readFileSync } from "node:fs";
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

/** Every media block whose prelude has either coarse-pointer feature, including comma queries. */
function coarsePointerBlocks(css: string): string {
  const out: string[] = [];
  for (const m of css.matchAll(/@media\s*([^{}]+)\{/g)) {
    if (!/\(\s*(?:any-)?pointer\s*:\s*coarse\s*\)/.test(m[1] ?? "")) continue;
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

/**
 * The exact selector's declarations folded in source order. Later declarations
 * of one property replace that property without hiding unrelated ones from an
 * earlier grouped rule.
 */
function declsFor(css: string, selector: string): string | undefined {
  const declarations = new Map<string, string>();
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const list = (m[1] ?? "").split(",").map((s) => s.trim());
    if (!list.includes(selector)) continue;
    for (const declaration of (m[2] ?? "").split(";")) {
      const colon = declaration.indexOf(":");
      if (colon < 0) continue;
      const property = declaration.slice(0, colon).trim();
      const value = declaration.slice(colon + 1).trim();
      if (property && value) declarations.set(property, value);
    }
  }
  return declarations.size > 0
    ? [...declarations].map(([property, value]) => `${property}: ${value};`).join(" ")
    : undefined;
}

const css = readerCssNoComments();
const coarse = blocks(css, "any-pointer: coarse");

/**
 * Tailwind source tokens that leave a 2.5rem target behind a coarse-pointer
 * variant. Tokenising first keeps `not-pointer-coarse` from matching while
 * still admitting arbitrary and compound variants after the pointer variant.
 * Comments are deliberately included: Tailwind's scanner includes them too.
 */
function bareTailwindFingerFloors(input: string): string[] {
  const out: string[] = [];
  for (const token of input.match(/[^\s"'`{}]+/g) ?? []) {
    if (!/(?:^|:)(?:any-)?pointer-coarse:/.test(token)) continue;
    if (/(?:^|:)(?:size|min-h|min-w|h|w)-10!?$/.test(token)) out.push(token);
  }
  return out;
}

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

  it("Quiz questions in the margin are 40px tall", () => {
    expect(declsFor(coarse, ".marg-quiz-q")).toMatch(/min-height:\s*40px/);
  });

  it("Quiz's share pie is 40 × 40, with no negative margin and an 8px gap from the label", () => {
    const pie = declsFor(coarse, ".share-pie");
    expect(pie).toMatch(/width:\s*40px/);
    expect(pie).toMatch(/height:\s*40px/);
    expect(pie).toMatch(/margin:\s*0/);
    expect(declsFor(coarse, ".quiz-only-read-what")).toMatch(/gap:\s*8px/);
  });

  it("the masthead's share pie does not overlap the adjacent read-time target", () => {
    expect(coarse).not.toMatch(/\.facts\s+\.read-so-far\s*\{[^}]*margin-left:\s*-/s);
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
    expect(declsFor(css, ".quiz-step")).toMatch(/gap:\s*0\.5rem/);
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
      expectCoarse40(a.className, "min-w-", ["min-width"]);
    }
    await act(async () => root.unmount());
    host.remove();
  });
});

describe("haloed under a finger", () => {
  /* The Tag's 1.5rem box reserves enough overhang to make 40px at every
     supported root. The bottom date row is already 40px tall, so its control
     is drawn instead. */
  it("the shelf card's Tag halo has 40px clearance, and its date line is a drawn 40px target", () => {
    const tag = /<button[\s\S]*?aria-label=\{tags\.length[\s\S]*?className=\{`([^`]*)`/.exec(
      source("src/web/ShelfTags.tsx"),
    )?.[1];
    expect(tag, "could not find the Tag button's class").toBeDefined();
    expect(tag?.split(/\s+/)).toContain("tap-target");
    const clearance = "tw:any-pointer-coarse:my-[calc((40px-1.5rem)/2)]";
    expect(tag?.split(/\s+/)).toContain(clearance);
    const clearanceCss = compile([clearance])[0] ?? "";
    expect(clearanceCss).toContain("@media (any-pointer: coarse)");
    expect(clearanceCss).toMatch(/margin-block:\s*calc\(\(40px - 1\.5rem\) \/ 2\)/);
    for (const rootPx of [12, 15.36, 16, 20]) {
      const margin = (40 - 1.5 * rootPx) / 2;
      expect(1.5 * rootPx + 2 * margin, `at a ${rootPx}px root`).toBe(40);
    }
    const date = /aria-label=\{`\$\{note\} — details of[^`]*`\}\s*className="([^"]*)"/.exec(
      source("src/web/ShelfEntry.tsx"),
    )?.[1];
    expect(date, "could not find the date line's class").toBeDefined();
    expect(date?.split(/\s+/)).not.toContain("tap-target");
    expectCoarse40(date ?? "", "min-h-", ["min-height"]);
  });
});

describe("the bottom dock", () => {
  /* The dock is `pointer: coarse` on purpose (touch.md § How big a thing has to
     be: bulk chrome, not for a hybrid's fine pointer). A mode button is the bar less its top hairline, its
     frame's two 1px edges and the mode row's 0.3rem margins; at a 16px root
     `3.25rem` left 39.4px. */
  it("leaves a framed mode button at least 40px tall at every root the app supports", () => {
    const bar = blocks(css, "pointer: coarse");
    const m = /--dock-h:\s*max\(\s*([\d.]+)rem\s*,\s*calc\(\s*([\d.]+)px\s*\+\s*([\d.]+)rem\s*\)\s*\)/.exec(bar ?? "");
    expect(m, "no --dock-h of the form max(Nrem, calc(Npx + Nrem)) under pointer: coarse").not.toBeNull();
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
    const answer = declsFor(coarse, ".quiz-actions .chat-send");
    expect(answer).toMatch(/width:\s*max\(\s*40px/);
    expect(answer).toMatch(/height:\s*max\(\s*40px/);
    expect(declsFor(coarse, ".srch-icon")).toMatch(/min-width:\s*40px/);
    expect(declsFor(coarse, ".srch-icon")).toMatch(/min-height:\s*40px/);
    expect(declsFor(coarse, ".prof-mic")).toMatch(/flex:\s*none/);
    const metadata = /const QUIET_BUTTON\s*=\s*"([^"]+)"/.exec(source("src/web/Metadata.tsx"))?.[1] ?? "";
    expectCoarse40(metadata, "min-h-", ["min-height"]);
    const archiveArticle = /function ArchiveArticle[\s\S]*?disabled=\{busy\}\s*className=\{`([^`]*)/.exec(
      source("src/web/Metadata.tsx"),
    )?.[1] ?? "";
    expectCoarse40(archiveArticle, "min-h-", ["min-height"]);
    const signOut = /onClick=\{\(\) => void out\(\)\}[\s\S]*?className="([^"]+)"/.exec(
      source("src/web/AccountSection.tsx"),
    )?.[1] ?? "";
    expectCoarse40(signOut, "min-h-", ["min-height"]);
    const contents = /aria-controls=\{listId\}[\s\S]*?className="([^"]+)"/.exec(
      source("src/web/PageContents.tsx"),
    )?.[1] ?? "";
    expectCoarse40(contents, "min-h-", ["min-height"]);
  });

  it("keeps the converted legacy floors on any available coarse pointer", () => {
    const coarse = blocks(readerCssNoComments(), "any-pointer: coarse");
    for (const selector of [
      ".origin-chat",
      ".srch-sort-btn",
      ".gloss-sort-btn",
      ".rcp-check-send",
      ".rcp-dig",
      ".investigate-send",
      ".investigate-q",
      ".investigate-yours-line",
      ".investigate-yours-more",
      ".mention-picker-row",
    ]) {
      expect(declsFor(coarse, selector), selector).toMatch(/min-height:\s*max\(\s*40px\s*,\s*2\.5rem\s*\)/);
    }
    const receptionMore = declsFor(coarse, ".rcp-item > .rcp-more");
    expect(receptionMore).toMatch(/min-width:\s*max\(\s*40px\s*,\s*2\.25rem\s*\)/);
    expect(receptionMore).toMatch(/min-height:\s*max\(\s*40px\s*,\s*2\.25rem\s*\)/);
    expect(declsFor(coarse, ".rcp-section-head")).toMatch(
      /min-height:\s*max\(\s*40px\s*,\s*var\(--control-h-lg\)\s*\)/,
    );
  });
});

describe("no bare 2.5rem finger floor", () => {
  function bareCssFloors(input: string): string[] {
    const out: string[] = [];
    for (const m of input.matchAll(
      /(?:^|[;{\s])((?:(?:min-)?(?:height|width|block-size|inline-size)|--[\w-]+)\s*:\s*([^;}]+))(?=\s*[;}])/g,
    )) {
      const value = (m[2] ?? "").replace(/\s*!important\s*$/, "").trim();
      if (/^(?:2\.50*rem|calc\(\s*2\.50*rem\s*\))$/.test(value)) out.push((m[1] ?? "").trim());
    }
    return out;
  }

  /* The same mistake in Tailwind: `size-10`, `min-h-10` and friends are 2.5rem.
     Sol's stage-2 review (C7) found ten live utilities behind a coarse-pointer
     variant; the eleventh textual hit was a comment describing one of them. */
  it("is in any component's coarse-pointer Tailwind class", () => {
    const dir = path.join(ROOT, "src/web");
    const hits: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (p.endsWith(".tsx")) {
          for (const hit of bareTailwindFingerFloors(readFileSync(p, "utf8"))) {
            hits.push(`${path.relative(ROOT, p)}: ${hit}`);
          }
        }
      }
    };
    walk(dir);
    expect(hits).toEqual([]);
  });

  it("recognises nested variants without matching lookalike variant names or larger scales", () => {
    expect(
      bareTailwindFingerFloors(
        [
          "tw:any-pointer-coarse:[&_x]:size-10",
          "tw:any-pointer-coarse:[&>button]:min-h-10",
          "tw:pointer-coarse:group-hover/card:size-10!",
        ].join(" "),
      ),
    ).toEqual([
      "tw:any-pointer-coarse:[&_x]:size-10",
      "tw:any-pointer-coarse:[&>button]:min-h-10",
      "tw:pointer-coarse:group-hover/card:size-10!",
    ]);
    expect(
      bareTailwindFingerFloors(
        "tw:not-pointer-coarse:size-10 tw:pointer-coarse:size-100 tw:pointer-coarse:text-10",
      ),
    ).toEqual([]);
  });

  it("pins every C7 target to a fixed 40px floor on any available coarse pointer", () => {
    const targets: readonly [string, number][] = [
      ["src/web/BackLink.tsx", 1],
      ["src/web/FeedbackButton.tsx", 2],
      ["src/web/Library.tsx", 2],
      ["src/web/PlanHelp.tsx", 1],
      ["src/web/ReceptionAndClaimsPanel.tsx", 2],
      ["src/web/SimplePanel.tsx", 1],
      ["src/web/Tweets.tsx", 1],
    ];
    for (const [file, expected] of targets) {
      const hits = source(file).match(/tw:any-pointer-coarse:(?:size|min-h)-\[40px\]/g) ?? [];
      expect(hits, file).toHaveLength(expected);
    }
  });

  it("is in any coarse-pointer block", () => {
    const css = readerCssNoComments();
    expect(bareCssFloors(coarsePointerBlocks(css))).toEqual([]);
  });

  it("recognises variables, logical dimensions, !important, and calc", () => {
    expect(
      bareCssFloors(
        "a { min-block-size: 2.5rem !important; inline-size: 2.500rem; --target-h: calc(2.5rem) }",
      ),
    ).toEqual([
      "min-block-size: 2.5rem !important",
      "inline-size: 2.500rem",
      "--target-h: calc(2.5rem)",
    ]);
  });
});
