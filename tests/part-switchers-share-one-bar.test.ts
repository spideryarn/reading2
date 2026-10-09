/**
 * **Every mode's part-switcher is the one joined bar** — plan 261007h § F2.
 *
 * Greg, 2026-10-07: *"controls that do the same job should look the same in
 * every mode, though use your judgment."* The row that switches a mode's parts
 * came in six designs; it is now Summary's joined bar (`.summ-views` /
 * `.summ-view-btn`, mode-band.css § the part-switcher) everywhere, with each
 * mode's old classes kept beside it as hooks.
 *
 * Two halves, because either alone goes green over a drift:
 *
 * - **The markup carries the shared classes.** Read from the source, since
 *   most of these rows sit deep in a panel that needs a whole reader to
 *   render; the old class and the shared one must be in the same `className`.
 * - **No sheet draws a second look on the old hooks.** A rule that gives
 *   `.diag-kind.on` its orange back, or `.learn-submode` its own outline, would
 *   leave the markup test green and the screen in two designs.
 *
 * What it does NOT prove: that the bar looks right. That is the measured
 * before/after in the plan (heights, corners, fills, at 1440 in both themes,
 * the 288px band and 390).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readerSheets, stripComments } from "./helpers/stylesheets.js";

/** Each switcher: its file, its own group class and its own button class. */
const SWITCHERS = [
  { mode: "Summary", file: "src/web/modes/summary/SummaryMode.tsx", group: null, button: null },
  /* Debate's Reception | Claims until 2026-10-09; Peer review's three chips since. */
  { mode: "Peer review", file: "src/web/modes/peer-review/PeerReviewMode.tsx", group: "dbt-views", button: null },
  { mode: "Structure", file: "src/web/modes/structure/StructureMode.tsx", group: "struct-views", button: "struct-view-btn" },
  { mode: "Referee", file: "src/web/modes/referee/RefereeMode.tsx", group: "ref-views", button: "ref-view-btn" },
  { mode: "Referee's criterion kind", file: "src/web/CriteriaPanel.tsx", group: "crit-kinds", button: "crit-kind-btn" },
  { mode: "Learn", file: "src/web/QuizPanel.tsx", group: "learn-submode", button: "learn-submode-btn" },
  { mode: "Diagram", file: "src/web/DiagramPanel.tsx", group: "diag-kind-bar", button: "diag-kind" },
  { mode: "Search", file: "src/web/SearchPanel.tsx", group: "srch-matchers", button: "srch-mode" },
  { mode: "Skim", file: "src/web/SkimPanel.tsx", group: "skim-depths", button: "skim-depth" },
] as const;

/** Every `className` value written in a source file, as a string or a template. */
function classNames(source: string): string[] {
  return [...source.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)].map((m) => m[1] ?? m[2] ?? "");
}

describe("each mode's part-switcher carries the shared bar's classes", () => {
  for (const s of SWITCHERS) {
    it(`${s.mode}: the group is .summ-views and its buttons are .summ-view-btn`, () => {
      const names = classNames(readFileSync(s.file, "utf8"));
      const words = (n: string) => n.split(/\s+|\$\{/);
      const group = names.filter((n) => words(n).includes("summ-views"));
      expect(group.length, `${s.file} draws no .summ-views`).toBeGreaterThan(0);
      if (s.group) expect(group.some((n) => words(n).includes(s.group))).toBe(true);
      const buttons = names.filter((n) => words(n).includes("summ-view-btn"));
      expect(buttons.length, `${s.file} draws no .summ-view-btn`).toBeGreaterThan(0);
      if (s.button) expect(buttons.some((n) => words(n).includes(s.button))).toBe(true);
    });
  }
});

/** `selector { decls }` pairs of one sheet, with the selector list split on top-level commas. */
function rules(css: string): { selectors: string[]; decls: string }[] {
  return [...stripComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selectors: (m[1] ?? "").split(",").map((p) => p.trim()),
    decls: m[2] ?? "",
  }));
}

/** The look the bar owns: if a mode's own sheet sets one of these on its hook, it is a second design. */
const LOOK = /(?:^|;)\s*(border(?:-radius|-color)?|background(?:-color)?|color|font-weight)\s*:/;

/**
 * Rules that may still style an old hook, each for a reason:
 * Structure's *Build* and *Try again* carry `.struct-view-btn` but are actions
 * in the arriving note, not parts (structure-mode.css § the structure-arriving
 * line).
 */
const ALLOWED = [/^\.struct-arriving-note > \.struct-view-btn/];

describe("no sheet draws a second look on an old hook", () => {
  const hooks = SWITCHERS.flatMap((s) => [s.group, s.button]).filter((c): c is NonNullable<typeof c> => c !== null);

  it("the bar's rules are written once, in mode-band.css, before every mode's sheet", () => {
    const sheets = readerSheets();
    const owners = sheets.filter((s) =>
      rules(s.css).some((r) => r.selectors.some((p) => p === ".summ-views" || p === ".summ-view-btn")),
    );
    expect(owners.map((s) => s.path)).toEqual(["src/web/styles/mode-band.css"]);
    /* The modes' refinements (Skim's 36px, Search's padding, Learn's four
       chips) win by coming later, so the order is part of the contract. */
    const at = (p: string) => sheets.findIndex((s) => s.path === p);
    for (const later of ["summary", "structure-mode", "referee", "quiz", "diagram", "search", "skim", "debate"]) {
      expect(at("src/web/styles/mode-band.css")).toBeLessThan(at(`src/web/styles/${later}.css`));
    }
  });

  for (const hook of hooks) {
    it(`.${hook} sets none of the bar's border, corner, fill, ink or weight`, () => {
      const offenders: string[] = [];
      for (const sheet of readerSheets()) {
        for (const r of rules(sheet.css)) {
          for (const sel of r.selectors) {
            const targets = new RegExp(`\\.${hook}(?![\\w-])[^\\s>+~]*$`).test(sel);
            if (!targets || ALLOWED.some((a) => a.test(sel))) continue;
            if (LOOK.test(r.decls)) offenders.push(`${sheet.path}: ${sel} { ${r.decls.trim().slice(0, 80)} }`);
          }
        }
      }
      expect(offenders).toEqual([]);
    });
  }
});
