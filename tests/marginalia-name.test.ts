/**
 * **Annotations is called Marginalia** (2026-10-01, SPIDERYARN-READING2-8E):
 * the word a reader sees, the mode word, and both old and new spellings of
 * `?mode=` landing on the `?margin=1` switch.
 * docs/plans/261001n-rename-annotations-mode-to-marginalia-and-the-three-column-interface-vision.md.
 */
import { describe, expect, it } from "vitest";
import { MODE_CATALOG } from "../src/mode-catalog.js";
import { MODES, modeFromParam } from "../src/modes.js";
import { readMode } from "../src/read-address.js";
import { MODE_LABEL } from "../src/title-text.js";
import { rememberableSearch } from "../src/web/last-view.js";
import { marginInSearch } from "../src/web/params.js";

const labels: Record<string, string> = MODE_LABEL;
const catalog: Record<string, { aliases: readonly string[] }> = MODE_CATALOG;

describe("Marginalia, the mode once called Annotations", () => {
  it("is called Marginalia, and its mode word is marginalia", () => {
    expect(labels.marginalia).toBe("Marginalia");
    expect(MODES as readonly string[]).toContain("marginalia");
    expect(MODES as readonly string[]).not.toContain("annotations");
  });

  it("the command bar still finds it by its old name", () => {
    expect(catalog.marginalia?.aliases).toContain("annotations");
    /* An alias equal to the mode's own word would be noise. */
    expect(catalog.marginalia?.aliases).not.toContain("marginalia");
  });

  it("?mode=marginalia asks for the notes, as ?mode=annotations does", () => {
    expect(marginInSearch("?mode=marginalia")).toBe(true);
    expect(marginInSearch("?mode=annotations")).toBe(true);
    /* Neither names a band: both read as Plain on the client and the server. */
    expect(modeFromParam("marginalia")).toBe(null);
    expect(readMode("/read/x?mode=marginalia")).toBe("plain");
    /* The control: a band mode is not the margin. */
    expect(marginInSearch("?mode=glossary")).toBe(false);
  });

  it("a remembered ?mode=marginalia comes back as the margin switch", () => {
    expect(rememberableSearch("?mode=marginalia")).toBe("?margin=1");
    expect(rememberableSearch("?mode=annotations")).toBe("?margin=1");
  });
});
