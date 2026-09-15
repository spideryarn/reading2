// @vitest-environment jsdom
/**
 * **The shelf's actions, as a finger sees them — in a browser that evaluates
 * media queries.**
 *
 * Greg, 2026-09-12, on an iPad (SPIDERYARN-READING2-40): *"We have a few
 * options that we can apply to articles on the shelf … like archive and rename
 * the title … On an iPad or other touch device, there didn't seem to be a way to
 * access them."* docs/plans/260915b-shelf-actions-reachable-on-touch.md.
 *
 * The five buttons are hidden at rest and revealed by `(hover: none)`. That
 * query asks about the *primary* pointer. An iPad answers it correctly whatever
 * is attached (WebKit pins its primary pointer to touch), but a touchscreen
 * laptop does not: its primary pointer is the mouse, so the reveal never applied
 * and the row stayed at `opacity: 0` under the finger tapping it.
 *
 * ## Why Chrome, and why these launch flags
 *
 * jsdom evaluates no media query and applies no stylesheet, so a jsdom test of
 * "is the row visible" asserts a fact about a fake. Playwright's `hasTouch` and
 * CDP's `Emulation.setEmulatedMedia` only produce the two *pure* devices — the
 * latter ignores `hover` and `pointer` outright, measured on this box
 * 2026-09-15 — and neither can say "a finger AND a mouse". Blink's own settings
 * can: `--blink-settings` sets the primary and available pointer and hover types
 * the media queries are answered from. Values are Blink's enums: pointer none=1
 * coarse=2 fine=4 (the `available*` pair is a bitmask), hover none=1 hover=2.
 * Measured the same day: the hybrid below answers `hover: hover`,
 * `pointer: fine`, `any-pointer: coarse` and `any-pointer: fine` all at once.
 *
 * ## Why the markup is rendered and the CSS compiled
 *
 * The subject is the class list the components really write and the rules
 * Tailwind really makes of it, so both come from the real thing:
 * `renderToStaticMarkup` of the real `ShelfCard` and `EditableTitle`, and the
 * real `src/web/tailwind.css` compiled by Tailwind's own `compile()` over the
 * classes that markup contains. A hand-written copy of either would be a test of
 * the copy.
 *
 * **The desktop case is the control.** A mouse still sees nothing at rest and
 * the row on hover; without that pair, a stylesheet that failed to load would
 * leave every opacity at 1 and turn the finger cases green over nothing.
 *
 * Skipped, loudly, where there is no Chrome — the same rule as
 * `tests/tab-traversal-in-chrome.test.ts`.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { compile } from "tailwindcss";
import { describe, expect, it } from "vitest";

import { chromePath } from "../scripts/browser-sign-in.js";
import type { LibraryEntry } from "../src/types.js";
import { ShelfCard, type Shelf } from "../src/web/ShelfEntry.js";
import { EditableTitle, type ArticleRename } from "../src/web/TitleEditor.js";

const chrome = (() => {
  try {
    return chromePath();
  } catch {
    return null;
  }
})();

const ENTRY: LibraryEntry = {
  slug: "a-piece",
  title: "A piece",
  url: "https://example.com/piece",
  addedAt: "2026-09-01T00:00:00.000Z",
  words: 1200,
  minutes: 6,
  blocks: 40,
  parts: 2,
  sections: 5,
  comments: 0,
  opens: 0,
  has: { arc: false, tweets: false, glossary: false },
};

const SHELF = { renaming: null } as unknown as Shelf;
const RENAME = { editing: false, overridden: false } as unknown as ArticleRename;

const MARKUP = renderToStaticMarkup(
  <div>
    <div id="card">
      <ShelfCard entry={ENTRY} shelf={SHELF} note="" />
    </div>
    <div id="heading">
      <EditableTitle rename={RENAME} title="A piece">
        <h1>A piece</h1>
      </EditableTitle>
    </div>
  </div>,
);

/** `@import`s resolved the way the build resolves them — tests/tailwind-utilities-resolve.test.ts. */
const loader = (base: string) => ({
  base,
  async loadStylesheet(id: string, from: string) {
    const path = id.startsWith(".") ? resolve(from, id) : resolve("node_modules", id);
    return { path, base: dirname(path), content: readFileSync(path, "utf8") };
  },
  async loadModule(): Promise<never> {
    throw new Error("tailwind.css is not expected to load a JS plugin or config");
  },
});

async function stylesheet(): Promise<string> {
  const entry = resolve("src/web/tailwind.css");
  const compiler = await compile(readFileSync(entry, "utf8"), loader(dirname(entry)));
  const classes = [...MARKUP.matchAll(/class="([^"]*)"/g)].flatMap((m) =>
    (m[1] ?? "").replace(/&#x27;/g, "'").split(/\s+/),
  );
  return compiler.build([...new Set(classes)].filter(Boolean));
}

/** Blink's enums, per the header. */
const DEVICES = {
  mouse: "primaryPointerType=4,availablePointerTypes=4,primaryHoverType=2,availableHoverTypes=2",
  finger: "primaryPointerType=2,availablePointerTypes=2,primaryHoverType=1,availableHoverTypes=1",
  "finger and mouse":
    "primaryPointerType=4,availablePointerTypes=6,primaryHoverType=2,availableHoverTypes=3",
} as const;

interface Seen {
  /** The effective opacity of the row of five — every ancestor's multiplied in. */
  row: number;
  /** The same, of the pencil beside an article page's heading. */
  pencil: number;
  /** The row again, with the (fake, mouse) pointer resting on the card. */
  rowHovered: number;
}

async function look(device: keyof typeof DEVICES): Promise<Seen> {
  if (chrome === null) throw new Error("no Chrome, and this should have been skipped");
  const css = await stylesheet();
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({
    headless: true,
    executablePath: chrome,
    args: [`--blink-settings=${DEVICES[device]}`],
  });
  try {
    const p = await browser.newPage();
    await p.setContent(`<style>${css}</style>${MARKUP}`);
    const measure = () =>
      p.evaluate(() => {
        const visible = (el: Element | null): number => {
          let o = 1;
          for (let at = el; at; at = at.parentElement) o *= Number(getComputedStyle(at).opacity);
          return o;
        };
        const first = document.querySelector("#card [data-action]");
        let row = first?.parentElement ?? null;
        while (row && row.querySelectorAll("[data-action]").length < 5) row = row.parentElement;
        return {
          row: visible(row),
          pencil: visible(document.querySelector('#heading button[aria-label="Edit title"]')),
        };
      });
    const rest = await measure();
    await p.hover("#card article");
    /* Past the 150ms `transition-opacity`, so the hovered value is the settled one. */
    await p.waitForTimeout(400);
    const hovered = await measure();
    return { ...rest, rowHovered: hovered.row };
  } finally {
    await browser.close();
  }
}

describe.skipIf(chrome === null)("the shelf's actions, in a browser that evaluates media queries", () => {
  it("are hidden from a mouse until it points at the card — the control", { timeout: 60_000 }, async () => {
    const seen = await look("mouse");
    expect(seen.row, "the row showed at rest on a desktop").toBe(0);
    expect(seen.pencil, "the pencil showed at rest on a desktop").toBe(0);
    expect(seen.rowHovered, "pointing at the card did not reveal the row").toBe(1);
  });

  it("are there at rest for a finger on a tablet", { timeout: 60_000 }, async () => {
    const seen = await look("finger");
    expect(seen.row).toBe(1);
    expect(seen.pencil).toBe(1);
  });

  it(
    "are there at rest for a finger on a machine whose primary pointer is a mouse",
    { timeout: 60_000 },
    async () => {
      const seen = await look("finger and mouse");
      expect(seen.row, "a touchscreen laptop showed no shelf actions to its finger").toBe(1);
      expect(seen.pencil, "a touchscreen laptop showed no pencil beside the title").toBe(1);
    },
  );
});
