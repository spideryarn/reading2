/**
 * **A failure sentence is one colour, and the order chips are one chip** —
 * plan 261007h § F4 (F4a). Greg: *"controls that do the same job should look
 * the same in every mode, though use your judgment."*
 *
 * Until 2026-10-07 a sentence saying something failed was drawn in four
 * colours depending on the band: orange (`--highlight-ink`, the colour every
 * band also uses for "this is the AI's" and "this is chosen"), the red fill
 * (`--destructive`, 4.37:1 on Dark's raised surface), plain ink, and grey —
 * the grey being the colour every band prints "not made yet" in, so a failure
 * there read as never having asked. Every one now takes `--danger`, the
 * error-text token tests/appearance-palette.test.ts holds at 4.5:1 on the page,
 * the band and the raised surface in both themes. `--destructive` stays for
 * fills.
 *
 * ## What this does NOT prove
 *
 * It is a text scanner. It says the listed selectors are written in
 * `var(--danger)` and that no later, more specific rule ending in the same
 * class paints them another colour (Diagram's override was exactly that); it
 * cannot see a failure drawn under a class nobody listed here. The census
 * behind the list is in the plan's § What landed, and the browser measurements
 * (computed colour and contrast on each site's actual ground) are the evidence
 * that it renders.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readerCssNoComments } from "./helpers/stylesheets.js";

interface Rule {
  selectors: string[];
  decls: string;
}

/** Innermost `selector { decls }` blocks, so a rule inside `@media` is found
    under its own selector rather than under the query. */
function rules(css: string): Rule[] {
  const out: Rule[] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    out.push({
      selectors: (m[1] ?? "")
        .split(",")
        .map((s) => s.trim().replace(/\s+/g, " "))
        .filter(Boolean),
      decls: m[2] ?? "",
    });
  }
  return out;
}

function colourOf(decls: string): string | undefined {
  return /(?:^|;|\s)color:\s*([^;]+)/.exec(decls)?.[1]?.trim();
}

const CSS = rules(readerCssNoComments());

/** The sheets with every `@media` block taken out, braces counted: the rules
    a mouse at a wide window gets, so a coarse-pointer floor cannot answer a
    question about the chip at rest. */
function withoutMedia(css: string): string {
  let out = "";
  let i = 0;
  for (const m of css.matchAll(/@media[^{]*\{/g)) {
    if (m.index < i) continue;
    out += css.slice(i, m.index);
    let depth = 0;
    let j = m.index + m[0].length - 1;
    for (; j < css.length; j++) {
      if (css[j] === "{") depth++;
      else if (css[j] === "}" && --depth === 0) break;
    }
    i = j + 1;
  }
  return out + css.slice(i);
}
const AT_REST = rules(withoutMedia(readerCssNoComments()));

/** Every failure sentence in the reading view, by the selector that draws it. */
const FAILURES = [
  ".gloss-error", // ReadError and Glossary/Quiz/Skim's own: every band's failed read
  ".chat-error",
  ".chat-failed",
  ".chat-live-error",
  ".chat-live-failure p",
  ".chat-dialog-error",
  ".cmt-write-error",
  ".cmt-error p",
  ".cite-inv-error",
  ".prof-box-error",
  ".prof-save.is-error",
  ".srch-error",
  ".srch-failed",
  ".crit-error",
  ".clm-error",
  ".mir-error",
  ".cnd-error",
  ".dock-drawer-error",
  ".dbt-thread-failed",
  ".sk-failed",
  ".ill-failed",
  ".ill-plate-out.is-failed",
  ".ill-steer-long", // the note is over its limit and will not be sent
  ".diag-failed",
  ".prose-card-failed",
  ".prose-card-refused",
  ".struct-arriving-failed",
] as const;

describe("every failure sentence is drawn in --danger", () => {
  it.each(FAILURES)("%s", (sel) => {
    const own = CSS.filter((r) => r.selectors.includes(sel) && colourOf(r.decls) !== undefined);
    expect(own.length, `${sel} sets no colour of its own`).toBeGreaterThan(0);
    /* Every rule whose selector ends in this one and sets a colour — a shared
       wait/failure rule, or a band's override like Diagram's
       `.mode-band.diag .read-error .gloss-error` — has to agree. */
    const wrong = CSS.flatMap((r) =>
      r.selectors
        .filter((s) => s === sel || s.endsWith(` ${sel}`) || s.endsWith(sel))
        .filter(() => {
          const c = colourOf(r.decls);
          return c !== undefined && c !== "var(--danger)";
        })
        .map((s) => `${s} { color: ${colourOf(r.decls)} }`),
    );
    expect(wrong).toEqual([]);
  });

  it("splits Illustrated's and Diagram's waits from their failures, which keep the faint grey", () => {
    for (const sel of [".ill-busy", ".ill-plate-out", ".diag-wait", ".diag-note"]) {
      const colours = CSS.filter((r) => r.selectors.includes(sel))
        .map((r) => colourOf(r.decls))
        .filter((c) => c !== undefined);
      expect(colours, sel).toContain("var(--ink-faint)");
      expect(colours, sel).not.toContain("var(--danger)");
    }
  });

  /* The Tailwind-drawn failures in the bands and their editors. A file listed
     here writes its failure sentences with `tw:text-danger`; `text-destructive`
     is the fill's colour and is not text. */
  it.each([
    "src/web/JobProgress.tsx",
    "src/web/Tweets.tsx",
    "src/web/Metadata.tsx",
    "src/web/TitleEditor.tsx",
    "src/web/TagEditor.tsx",
  ])("%s writes no failure in the fill's red", (file) => {
    const src = readFileSync(file, "utf8");
    expect(src).not.toMatch(/tw:text-destructive(?![a-zA-Z0-9_-])/);
    expect(src).toMatch(/tw:text-danger(?![a-zA-Z0-9_-])/);
  });

  /* And nowhere else either: since 2026-10-07 every `tw:text-destructive` in
     the client was a failure or warning sentence and is `tw:text-danger` now.
     shadcn's own components (`components/ui/`) keep the fill's token. */
  it("no client component writes text in the fill's red", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = `${dir}/${name}`;
        if (statSync(path).isDirectory()) {
          if (path !== "src/web/components/ui") walk(path);
        } else if (/\.tsx?$/.test(name) && /tw:text-destructive(?![a-zA-Z0-9_-])/.test(readFileSync(path, "utf8"))) {
          offenders.push(path);
        }
      }
    };
    walk("src/web");
    expect(offenders).toEqual([]);
  });

  it("bridges --danger into Tailwind beside --destructive", () => {
    expect(readFileSync("src/web/tailwind.css", "utf8")).toMatch(/--color-danger:\s*var\(--danger\);/);
  });
});

describe("the order chips are one chip", () => {
  /* Glossary's `.gloss-sort-btn` (Glossary, Quotes, Citations, FAQ, Debate)
     and Search's `.srch-sort-btn`, which keeps its own class and its own
     `display: contents` wrapping (plan 261007a § K4). */
  const base = (cls: string) => AT_REST.filter((r) => r.selectors.includes(cls));
  const decl = (rs: Rule[], prop: string) =>
    rs
      .map((r) => new RegExp(`(?:^|;|\\s)${prop}:\\s*([^;]+)`).exec(r.decls)?.[1]?.trim())
      .filter((v) => v !== undefined)
      .at(-1);

  it("share one corner, the house radius", () => {
    expect(decl(base(".gloss-sort-btn"), "border-radius")).toBe("var(--radius)");
    expect(decl(base(".srch-sort-btn"), "border-radius")).toBe("var(--radius)");
  });

  it("share one height", () => {
    const g = decl(base(".gloss-sort-btn"), "min-height");
    expect(g).toBeDefined();
    expect(decl(base(".srch-sort-btn"), "min-height")).toBe(g);
  });

  it("mark the chosen order neutrally, as a part-switcher marks its part", () => {
    /* Orange marks the mode; a choice within it is marked neutrally
       (mode-band.css § the part-switcher). */
    const on = (cls: string) => base(`${cls}.on`);
    for (const prop of ["color", "background", "font-weight", "border-color"]) {
      expect(decl(on(".gloss-sort-btn"), prop), prop).toBeDefined();
      expect(decl(on(".srch-sort-btn"), prop), prop).toBe(decl(on(".gloss-sort-btn"), prop));
    }
    expect(decl(on(".gloss-sort-btn"), "color")).toBe("var(--ink)");
  });
});
