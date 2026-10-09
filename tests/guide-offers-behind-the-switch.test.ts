/**
 * **The guide may offer Referee from behind the experimental switch, as a
 * press, and nothing else changes** — plan
 * docs/plans/261009w-the-guide-offers-referee-to-a-reader-who-says-they-are-refereeing.md.
 *
 * Three readers of one record (src/mode-catalog.ts § `OFFERED_BEHIND_THE_SWITCH`):
 * the written guide's list of modes, the press rule (src/acts-alone.ts), and the
 * guide's chip door (src/web/chip-door.ts, held in
 * tests/guide-offers-behind-the-switch-door.test.tsx). This file holds the first
 * two and the record itself.
 */
import { describe, expect, it } from "vitest";
import { modeActsAlone } from "../src/acts-alone.js";
import { guideModeKeys, modeToken, modeWordsSection, spokenModeWords } from "../src/guide.js";
import { MODE_CATALOG, OFFERED_BEHIND_THE_SWITCH, offeredBehindTheSwitch } from "../src/mode-catalog.js";
import type { Mode } from "../src/modes.js";
import catalogue from "../src/command-pick-catalogue.generated.json" with { type: "json" };

const written = modeWordsSection();
const lineOf = (text: string, start: string): string => text.split("\n").find((l) => l.startsWith(start)) ?? "";
const refereeRows = catalogue.filter(
  (r) => (r.id === "mode:referee" || r.id.startsWith("submode:referee:")) && r.contexts.includes("owner-article"),
);

describe("the record", () => {
  it("names Referee, and only modes that are behind the switch", () => {
    expect(Object.keys(OFFERED_BEHIND_THE_SWITCH)).toContain("referee");
    for (const mode of Object.keys(OFFERED_BEHIND_THE_SWITCH) as Mode[]) {
      expect(MODE_CATALOG[mode].experimental, mode).toBe(true);
    }
  });

  it("finds a mode and its sub-modes by catalogue key, and nothing else", () => {
    expect(offeredBehindTheSwitch("mode:referee")).toBe(OFFERED_BEHIND_THE_SWITCH.referee);
    expect(offeredBehindTheSwitch("submode:referee:criteria")).toBe(OFFERED_BEHIND_THE_SWITCH.referee);
    expect(offeredBehindTheSwitch("mode:diagram")).toBeUndefined();
    expect(offeredBehindTheSwitch("mode:structure")).toBeUndefined();
    expect(offeredBehindTheSwitch("mode:constructor")).toBeUndefined();
    expect(offeredBehindTheSwitch("referee")).toBeUndefined();
  });
});

describe("the written guide's list of modes", () => {
  it("gives Referee its button, a press, with who it is for and what to say", () => {
    const line = lineOf(written, "- Referee");
    expect(line).toContain("(experimental; offer it only when");
    expect(line).toContain(OFFERED_BEHIND_THE_SWITCH.referee?.audience);
    expect(line).toContain(OFFERED_BEHIND_THE_SWITCH.referee?.guidance);
    expect(line).toContain(` Button: ${modeToken("mode:referee")}`);
  });

  it("gives every Referee sub-mode a button that is a press, pointing back to the mode's line", () => {
    expect(refereeRows.length).toBeGreaterThan(1);
    for (const row of refereeRows) {
      expect(written, row.id).toContain(`Button: ${modeToken(row.id)}`);
      expect(written, row.id).not.toContain(`Opens at once: ${modeToken(row.id)}`);
    }
    expect(lineOf(written, "  - Referee › Criteria")).toContain("offer it only when its mode's line says");
  });

  it("says when such a mode may be offered, and to nobody else", () => {
    expect(written).toContain('The one exception is a mode marked "(experimental; offer it only when …)"');
    expect(written).toContain("otherwise do not mention it");
  });

  it("still gives another experimental mode no button", () => {
    expect(MODE_CATALOG.diagram.experimental).toBe(true);
    expect(lineOf(written, "- Diagram")).toContain("(experimental)");
    expect(written).not.toContain(modeToken("mode:diagram"));
  });

  /* The next steps' check (src/next-steps.ts) takes the keys with a button, so
     a Referee next step is kept and a Diagram one still refused. */
  it("lets a next step name Referee and its sub-modes, and still not another experimental mode", () => {
    const keys = guideModeKeys();
    for (const row of refereeRows) expect(keys.has(row.id), row.id).toBe(true);
    expect(keys.has("mode:diagram")).toBe(false);
    expect(keys.has("mode:structure")).toBe(true);
  });

  it("leaves the spoken guide's list as it was", () => {
    expect(spokenModeWords()).not.toContain("offer it only when");
    expect(lineOf(spokenModeWords(), "- Referee")).toContain("Referee (experimental):");
  });
});

describe("the press rule", () => {
  it("never lets the guide open Referee or a Referee sub-mode by itself", () => {
    for (const row of refereeRows) expect(modeActsAlone(row.id, row.generates), row.id).toBe(false);
  });

  it("still lets it open an ordinary mode that only moves the reader", () => {
    expect(modeActsAlone("mode:structure", false)).toBe(true);
  });
});
