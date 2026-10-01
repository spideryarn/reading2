/**
 * **The notes are a switch of their own, not a mode** — `?margin=1` beside any
 * `?mode=`, and `?mode=annotations` reading as Plain.
 * docs/plans/261001i-annotations-column-beside-a-band-mode.md.
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
// @ts-expect-error Annotations is never the current band in diagnostics.
acceptFeedbackMode("annotations");
// @ts-expect-error The herald names a band press, not the margin toggle.
const retiredHerald: HeraldPress = { mode: "annotations", nonce: 1 };
void retiredHerald;
// @ts-expect-error The server title receives the parsed band mode.
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
