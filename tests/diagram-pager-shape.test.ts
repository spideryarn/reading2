/**
 * **Diagram's ↑ n / N ↓ is drawn in Quotes' and Skim's shape.**
 *
 * Greg, 2026-10-07: *"controls that do the same job should look the same in
 * every mode"*. Diagram's pager was two half-width cells with a faint border;
 * Quotes' and Skim's ‹ n › are 44px squares on a raised ground (queue item
 * qi-mpnpp2qp, plan 261007m S3). The two keep their own classes — quotes.css
 * says why: neither band's arrows should move when the other's are restyled —
 * so this holds the box they share, declaration by declaration. Only the box:
 * Diagram's chevrons point up and down, and its unavailable state is
 * `aria-disabled` (GPT Sol, 261007h R20), which these rules do not cover.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const STYLES = join(import.meta.dirname, "..", "src", "web", "styles");

/** The declarations of the first rule whose selector is exactly `selector`. */
function rule(file: string, selector: string): Map<string, string> {
  const css = readFileSync(join(STYLES, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`(?:^|})\\s*${escaped}\\s*\\{([^}]*)\\}`, "m").exec(css);
  if (!m) throw new Error(`no rule ${selector} in ${file}`);
  const out = new Map<string, string>();
  for (const decl of (m[1] ?? "").split(";")) {
    const at = decl.indexOf(":");
    if (at > 0) out.set(decl.slice(0, at).trim(), decl.slice(at + 1).trim());
  }
  return out;
}

const BOX = ["padding", "border", "border-radius", "background", "color"] as const;

describe("Diagram's pager", () => {
  it("draws its buttons in the box Quotes' arrows use", () => {
    const quotes = rule("quotes.css", ".quotes-arrow");
    const diagram = rule("diagram.css", ".diag-step-btn");
    for (const prop of BOX) {
      expect(diagram.get(prop), prop).toBe(quotes.get(prop));
    }
  });

  it("holds all three steppers' arrows to one size with a 44px floor", () => {
    /* `--control-h-lg` is 2.75rem: a reader's 12px root would make it 33px,
       under a thumb's target. Diagram's bar had held 44px since Greg's iPad
       ask; Quotes' and Skim's took the same floor (GPT Sol's M3 and C2, plan
       261007m). */
    const arrows = [
      rule("diagram.css", ".diag-step-btn"),
      rule("quotes.css", ".quotes-arrow"),
      rule("skim.css", ".skim-arrow"),
    ];
    for (const arrow of arrows) {
      for (const prop of ["width", "height"] as const) {
        expect(arrow.get(prop), prop).toBe("max(44px, var(--control-h-lg))");
      }
    }
  });

  it("centres them round the readout, as Quotes' stepper does", () => {
    const quotes = rule("quotes.css", ".quotes-step");
    const diagram = rule("diagram.css", ".diag-step");
    for (const prop of ["display", "justify-content", "align-items", "gap"] as const) {
      expect(diagram.get(prop), prop).toBe(quotes.get(prop));
    }
  });
});
