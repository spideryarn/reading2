/**
 * **Trajectory is called Skim** (2026-10-01, spya-skxhcz): the word a reader
 * sees, the mode word, and the old `?mode=trajectory` still landing on it.
 * docs/plans/261001r-trajectory-becomes-skim-and-marginalia-rename-audit.md.
 */
import { describe, expect, it } from "vitest";
import { MODE_CATALOG } from "../src/mode-catalog.js";
import { MODES, modeFromParam } from "../src/modes.js";
import { readMode } from "../src/read-address.js";
import { MODE_LABEL } from "../src/title-text.js";
import { modeParam } from "../src/web/params.js";

const labels: Record<string, string> = MODE_LABEL;
const catalog: Record<string, { aliases: readonly string[] }> = MODE_CATALOG;

describe("Skim, the mode once called Trajectory", () => {
  it("is called Skim, and its mode word is skim", () => {
    expect(labels.skim).toBe("Skim");
    expect(MODES as readonly string[]).toContain("skim");
    expect(MODES as readonly string[]).not.toContain("trajectory");
  });

  it("the command bar still finds it by its old name", () => {
    expect(catalog.skim?.aliases).toContain("trajectory");
    expect(catalog.skim?.aliases).not.toContain("skim");
  });

  it("an old ?mode=trajectory link opens Skim, on the client and the server", () => {
    expect(modeFromParam("trajectory")).toBe("skim");
    expect(modeParam.parse("trajectory")).toBe("skim");
    expect(readMode("/read/x?mode=trajectory")).toBe("skim");
    /* The control: an unknown word is still nothing. */
    expect(modeFromParam("trajectoryx")).toBe(null);
  });
});
