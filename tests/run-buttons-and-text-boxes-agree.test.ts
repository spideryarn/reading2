/**
 * **Every mode's run button is the one `JobProgress` draws, and every text box
 * in a band has one look** — plan 261007h § F3.
 *
 * Greg, 2026-10-07: *"controls that do the same job should look the same in
 * every mode, though use your judgment."*
 *
 * - **Run buttons.** The button that runs a mode's job is shadcn's `Button`,
 *   `variant="outline" size="sm"` (32px, `rounded-md`), as `JobProgress`
 *   draws it in nine modes. Read from the source, because most of these sit
 *   deep in a panel that needs a whole reader to render; each keeps its old
 *   class as a hook, so the test finds it by that class and asks what element
 *   carries it.
 * - **Text boxes.** One rule in mode-band.css § text boxes in the bands sets
 *   the border, corner, ground, padding and focus mark. Direct declarations
 *   agree, and a guard rejects competing rules naming any box, apart from
 *   Search's two explicit clear-button/spinner padding exceptions.
 *
 * What it does NOT prove: that they look right. That is the measured before
 * and after in the plan (heights, corners, borders, grounds, at 1440 in both
 * themes, the 288px band and 390).
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { __unstable__loadDesignSystem } from "tailwindcss";
import { beforeAll, describe, expect, it } from "vitest";
import { buttonVariants } from "../src/web/components/ui/button.js";
import { readerCssNoComments } from "./helpers/stylesheets.js";

/** Each run button: the file that draws it, the hook it keeps, and its size. */
const RUN_BUTTONS = [
  { file: "src/web/CriteriaPanel.tsx", hook: "crit-run", size: "sm" },
  { file: "src/web/ClaimsPanel.tsx", hook: "clm-run", size: "sm" },
  { file: "src/web/MirrorPanel.tsx", hook: "mir-run", size: "sm" },
  { file: "src/web/CandidatesPanel.tsx", hook: "cnd-start-btn", size: "sm" },
  { file: "src/web/CandidatesPanel.tsx", hook: "cnd-send", size: "sm" },
  { file: "src/web/SearchPanel.tsx", hook: "srch-go", size: "sm" },
  /* Glossary's *Look up*, and *Find terms* when it is drawn without
     `JobProgress` (GPT Sol's R10). An entry's *Dig deeper* (`gloss-dig`) and
     Citations' (`cite-investigate`) were here until plan 261009k removed both
     buttons; *Ask in chat* in their place is `AskInChatButton`, the same `sm`
     Button (OriginChat.tsx). */
  { file: "src/web/GlossaryPanel.tsx", hook: "gloss-ask-go", size: "sm" },
  { file: "src/web/GlossaryPanel.tsx", hook: "gloss-more-go", size: "sm" },
] as const;

/** The whole opening tag that starts at `start`, braces and quotes respected. */
function openingTag(source: string, start: number): string {
  let depth = 0;
  let quote: string | null = null;
  for (let i = start; i < source.length; i++) {
    const c = source[i];
    if (quote) {
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth === 0) return source.slice(start, i + 1);
  }
  return source.slice(start);
}

/** Every opening tag whose `className` carries `hook` as a whole word. */
function tagsCarrying(source: string, hook: string): string[] {
  const out: string[] = [];
  const at = new RegExp(`className=(?:"[^"]*\\b${hook}\\b[^"]*"|\\{\`[^\`]*\\b${hook}\\b[^\`]*\`\\})`, "g");
  for (const m of source.matchAll(at)) {
    const before = source.slice(0, m.index);
    const start = Math.max(before.lastIndexOf("<Button"), before.lastIndexOf("<button"));
    out.push(openingTag(source, start));
  }
  return out;
}

describe("each mode's run button is the shadcn outline button JobProgress draws", () => {
  for (const b of RUN_BUTTONS) {
    it(`.${b.hook} in ${b.file.replace("src/web/", "")} is <Button variant="outline" size="${b.size}">`, () => {
      const tags = tagsCarrying(readFileSync(b.file, "utf8"), b.hook);
      expect(tags.length, `nothing in ${b.file} carries .${b.hook}`).toBeGreaterThan(0);
      for (const tag of tags) {
        expect(tag.startsWith("<Button"), tag.slice(0, 120)).toBe(true);
        expect(tag).toMatch(/\bvariant="outline"/);
        expect(tag).toMatch(new RegExp(`\\bsize="${b.size}"`));
      }
    });
  }
});

/** The text boxes in the bands (GPT Sol's R8). Chat's rename and edit boxes and `ProfileBox` are not. */
const TEXT_BOXES = [
  ".chat-input",
  ".srch-input",
  ".gloss-ask-input",
  ".cnd-box",
  ".crit-text",
  ".crit-poles input",
  ".quiz-answer",
  ".ill-steer-input",
  ".skim-purpose-input",
] as const;

const SHARED: Record<string, string> = {
  padding: "0.45rem 0.55rem",
  border: "1px solid var(--rule-strong)",
  "border-radius": "var(--radius)",
  background: "var(--page)",
};
const SHARED_FOCUS: Record<string, string> = {
  outline: "2px solid var(--highlight-text)",
  "outline-offset": "1px",
};

/** The entire property families, including logical sides and background images. */
const COMPETES = /^(padding|border|background|outline)(-|$)/;

/** `selector { decls }`, each selector list split on top-level commas and `:is()` unwrapped. */
function rules(css: string): { selectors: string[]; decls: [string, string][] }[] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => {
    const raw = (m[1] ?? "").trim();
    const isList = /^:is\(([\s\S]*)\)(.*)$/.exec(raw);
    const selectors = isList
      ? (isList[1] ?? "").split(",").map((p) => `${p.trim()}${isList[2] ?? ""}`)
      : raw.split(",").map((p) => p.trim().replace(/\s+/g, " "));
    const decls = (m[2] ?? "")
      .split(";")
      .map((d) => d.trim())
      .filter(Boolean)
      .map((d) => {
        const i = d.indexOf(":");
        return [d.slice(0, i).trim(), d.slice(i + 1).trim()] as [string, string];
      });
    return { selectors, decls };
  });
}

/** Direct declarations, in source order. This does not model the browser cascade. */
function folded(selector: string, css = readerCssNoComments()): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of rules(css)) {
    if (!r.selectors.includes(selector)) continue;
    for (const [p, v] of r.decls) if (COMPETES.test(p)) out.set(p, v);
  }
  return out;
}

function assertBoxRulesAgree(css: string): void {
  for (const box of TEXT_BOXES) {
    expect(Object.fromEntries(folded(box, css))).toEqual(SHARED);
    expect(Object.fromEntries(folded(`${box}:focus-visible`, css))).toEqual(SHARED_FOCUS);
  }
  // Refuse competing selectors rather than trying to reimplement specificity,
  // shorthand resolution and media queries. Generic element/ancestor rules and
  // layout still require a browser; this guard covers rules naming these boxes.
  const exceptions: Record<string, Record<string, string>> = {
    ".srch-field--filled .srch-input": { "padding-right": "28px" },
    ".srch-field--filled.srch-field--busy .srch-input": { "padding-right": "46px" },
  };
  for (const rule of rules(css)) {
    const competing = rule.decls.filter(([property]) => COMPETES.test(property));
    if (competing.length === 0) continue;
    for (const selector of rule.selectors) {
      const namesBox = TEXT_BOXES.some((box) => {
        const className = box.split(" ")[0];
        return new RegExp(`\\${className}(?![\\w-])`).test(selector);
      });
      if (!namesBox) continue;
      if (TEXT_BOXES.some((box) => selector === box || selector === `${box}:focus-visible`)) continue;
      expect(Object.fromEntries(competing), `unexpected competing field rule: ${selector}`).toEqual(exceptions[selector]);
    }
  }
  for (const [selector, declarations] of Object.entries(exceptions)) {
    expect(Object.fromEntries(folded(selector, css)), `room for Search's clear button/spinner: ${selector}`).toEqual(declarations);
  }
}

describe("the text-box guard sees competing selectors", () => {
  it("allows only the shared declarations and Search's reserved padding", () => {
    assertBoxRulesAgree(readerCssNoComments());
  });
  it("rejects a more-specific field background even though the shared rule remains", () => {
    expect(() => assertBoxRulesAgree(`${readerCssNoComments()}\n:root .quiz-answer { background: var(--surface-raised); }`)).toThrow();
  });
  it("rejects a conditional field override and a lost clear-button padding exception", () => {
    expect(() => assertBoxRulesAgree(`${readerCssNoComments()}\n@media (max-width: 400px) { .mode-band .chat-input { border-radius: 0; } }`)).toThrow();
    expect(() => assertBoxRulesAgree(readerCssNoComments().replace("padding-right: 28px", "padding-right: 0"))).toThrow();
  });
  it("rejects logical padding and a background image that redraw the field", () => {
    expect(() => assertBoxRulesAgree(`${readerCssNoComments()}\n:root .quiz-answer { padding-inline-start: 2rem; }`)).toThrow();
    expect(() => assertBoxRulesAgree(`${readerCssNoComments()}\n:root .quiz-answer { background-image: linear-gradient(red, blue); }`)).toThrow();
  });
});

describe("aria-disabled buttons keep focus and guards, without enabled hover", () => {
  let candidatesToCss: (classes: string[]) => (string | null)[];
  beforeAll(async () => {
    const entry = resolve("src/web/tailwind.css");
    const system = await __unstable__loadDesignSystem(readFileSync(entry, "utf8"), {
      base: dirname(entry),
      async loadStylesheet(id, from) {
        const path = id.startsWith(".") ? resolve(from, id) : resolve("node_modules", id);
        return { path, base: dirname(path), content: readFileSync(path, "utf8") };
      },
    });
    candidatesToCss = (classes) => system.candidatesToCss(classes);
  });

  for (const variant of ["default", "destructive", "outline", "secondary", "ghost", "link"] as const) {
    it(`${variant}: hover utilities compile with the aria-disabled exclusion`, () => {
      const classes = buttonVariants({ variant }).split(/\s+/);
      const hover = classes.filter((cls) => cls.includes(":hover:"));
      expect(hover.length).toBeGreaterThan(0);
      for (const cls of hover) {
        expect(cls).toContain(":not-aria-disabled:hover:");
        const css = candidatesToCss([cls])[0];
        expect(css, `${cls} must generate a rule`).toBeTruthy();
        expect(css).toContain(':not([aria-disabled="true"])');
        expect(css).toContain(":hover");
      }
      expect(classes).toContain("tw:aria-disabled:opacity-50");
      expect(classes).toContain("tw:aria-disabled:cursor-default");
      expect(classes.filter((cls) => cls.includes("aria-disabled") && cls.includes("pointer-events"))).toEqual([]);
    });
  }
});

describe("every text box in a band declares the shared look", () => {
  for (const box of TEXT_BOXES) {
    it(`${box}: border, corner, ground and padding are the shared ones`, () => {
      const got = folded(box);
      expect(Object.fromEntries(got)).toEqual(SHARED);
    });
    it(`${box}: focus is the app's 2px mark`, () => {
      const got = folded(`${box}:focus-visible`);
      expect(Object.fromEntries(got)).toEqual(SHARED_FOCUS);
    });
  }
});
