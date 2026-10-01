/**
 * **The notes are a switch of their own, not a mode** — `?margin=1` beside any
 * `?mode=`, and `?mode=marginalia` (or the old `?mode=annotations`) reading as
 * Plain. docs/plans/261001i-annotations-column-beside-a-band-mode.md; the
 * rename is
 * docs/plans/261001n-rename-annotations-mode-to-marginalia-and-the-three-column-interface-vision.md.
 */
import { describe, expect, it } from "vitest";
import { modeFromParam } from "../src/modes.js";
import { readMode } from "../src/read-address.js";
import { documentTitle } from "../src/title-text.js";
import type { FeedbackArticleContext } from "../src/web/feedback-context.js";
import type { HeraldPress } from "../src/web/ModeHerald.js";
import { marginInSearch, marginParam, modeParam } from "../src/web/params.js";

type FeedbackMode = FeedbackArticleContext["mode"];
const acceptFeedbackMode = (_mode: FeedbackMode) => {};
// @ts-expect-error Marginalia is never the current band in diagnostics.
acceptFeedbackMode("marginalia");
// @ts-expect-error Nor its word until 2026-10-01, which is no mode at all now.
acceptFeedbackMode("annotations");
// @ts-expect-error The herald names a band press, not the margin toggle.
const marginaliaHerald: HeraldPress = { mode: "marginalia", nonce: 1 };
void marginaliaHerald;
// @ts-expect-error The same for the old word.
const retiredHerald: HeraldPress = { mode: "annotations", nonce: 1 };
void retiredHerald;
// @ts-expect-error The server title receives the parsed band mode.
const marginaliaTitle = documentTitle("A piece", "marginalia");
void marginaliaTitle;
// @ts-expect-error The same for the old word.
const retiredTitle = documentTitle("A piece", "annotations");
void retiredTitle;

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
    /* Nor does the mode's own word since 261001n: it is a mode, not a band. */
    expect(modeFromParam("marginalia")).toBe(null);
    expect(modeParam.parse("marginalia")).toBe(null);
    expect(readMode("/read/x?mode=marginalia")).toBe("plain");
    /* The positive control: a band mode still parses. */
    expect(modeParam.parse("glossary")).toBe("glossary");
  });

  it("an old ?mode=annotations link still asks for the notes", () => {
    expect(marginInSearch("?mode=annotations")).toBe(true);
    expect(marginInSearch("?mode=marginalia")).toBe(true);
    expect(marginInSearch("?margin=1&mode=glossary")).toBe(true);
    expect(marginInSearch("?mode=glossary")).toBe(false);
    expect(marginInSearch("?margin=0")).toBe(false);
  });
});
