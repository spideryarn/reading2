/**
 * **The notes are a switch of their own, not a mode** — `?margin=1` beside any
 * `?mode=`, and `?mode=annotations` reading as Plain.
 * docs/plans/261001i-annotations-column-beside-a-band-mode.md.
 */
import { describe, expect, it } from "vitest";
import { modeFromParam } from "../src/modes.js";
import { readMode } from "../src/read-address.js";
import { marginInSearch, marginParam, modeParam } from "../src/web/params.js";

describe("the margin switch", () => {
  it("parses 1 and 0, and nothing else", () => {
    expect(marginParam.parse("1")).toBe(true);
    expect(marginParam.parse("0")).toBe(false);
    expect(marginParam.parse("yes")).toBe(null);
    expect(marginParam.serialize(true)).toBe("1");
  });

  it("?mode=annotations names no band: the client and the server both read Plain", () => {
    expect(modeFromParam("annotations")).toBe(null);
    expect(modeParam.parse("annotations")).toBe(null);
    expect(readMode("/read/x?mode=annotations")).toBe("plain");
    /* The positive control: a band mode still parses. */
    expect(modeParam.parse("glossary")).toBe("glossary");
  });

  it("an old ?mode=annotations link still asks for the notes", () => {
    expect(marginInSearch("?mode=annotations")).toBe(true);
    expect(marginInSearch("?margin=1&mode=glossary")).toBe(true);
    expect(marginInSearch("?mode=glossary")).toBe(false);
    expect(marginInSearch("?margin=0")).toBe(false);
  });
});
