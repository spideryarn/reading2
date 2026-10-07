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
 *   the border, corner, ground, padding and focus mark; the cascade is folded
 *   here selector by selector, so a later sheet that gives one box its own
 *   border back turns this red even though the shared rule is still there.
 *
 * What it does NOT prove: that they look right. That is the measured before
 * and after in the plan (heights, corners, borders, grounds, at 1440 in both
 * themes, the 288px band and 390).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readerCssNoComments } from "./helpers/stylesheets.js";

/** Each run button: the file that draws it, the hook it keeps, and its size. */
const RUN_BUTTONS = [
  { file: "src/web/CriteriaPanel.tsx", hook: "crit-run", size: "sm" },
  { file: "src/web/ClaimsPanel.tsx", hook: "clm-run", size: "sm" },
  { file: "src/web/MirrorPanel.tsx", hook: "mir-run", size: "sm" },
  { file: "src/web/CandidatesPanel.tsx", hook: "cnd-start-btn", size: "sm" },
  { file: "src/web/CandidatesPanel.tsx", hook: "cnd-send", size: "sm" },
  { file: "src/web/SearchPanel.tsx", hook: "srch-go", size: "sm" },
  /* Glossary's *Look up*, an entry's *Dig deeper*, and *Find terms* when it is
     drawn without `JobProgress` (GPT Sol's R10). */
  { file: "src/web/GlossaryPanel.tsx", hook: "gloss-ask-go", size: "sm" },
  { file: "src/web/GlossaryPanel.tsx", hook: "gloss-dig", size: "sm" },
  { file: "src/web/GlossaryPanel.tsx", hook: "gloss-more-go", size: "sm" },
  /* Citations' *Dig deeper* sits on a row of 24px controls (*Ask in chat*, the
     Scholar link), so it is the same button at the row's size. */
  { file: "src/web/CitationInvestigation.tsx", hook: "cite-investigate", size: "xs" },
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

/** Any declaration that would redraw one of the shared values. */
const COMPETES = /^(padding(-(top|bottom|left|right|block|inline))?|border(-(top|bottom|left|right))?(-(color|width|style))?|border-radius|background(-color)?|outline(-(color|width|style|offset))?)$/;

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

/** The competing declarations each selector ends up with, in cascade order (last wins). */
function folded(selector: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of rules(readerCssNoComments())) {
    if (!r.selectors.includes(selector)) continue;
    for (const [p, v] of r.decls) if (COMPETES.test(p)) out.set(p, v);
  }
  return out;
}

describe("every text box in a band resolves to the shared look", () => {
  for (const box of TEXT_BOXES) {
    it(`${box}: border, corner, ground and padding are the shared ones, and nothing redraws them`, () => {
      const got = folded(box);
      expect(Object.fromEntries(got)).toEqual(SHARED);
    });
    it(`${box}: focus is the app's 2px mark`, () => {
      const got = folded(`${box}:focus-visible`);
      expect(Object.fromEntries(got)).toEqual(SHARED_FOCUS);
    });
  }
});
