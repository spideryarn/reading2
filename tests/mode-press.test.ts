/**
 * **What a press on a band does** — `modePress`, the rule `Reader` acts on.
 * Greg, SPIDERYARN-READING2-96: Plain closes both columns, and a second press
 * on the bar's button closes the band. The command bar (`toggle` false) names
 * a destination, so it never closes (GPT Sol, plan review).
 * docs/plans/261002g-plain-closes-both-columns-a-second-press-closes-a-mode-and-plain-and-marginalia-in-frames-of-their-own.md.
 */
import { describe, expect, it } from "vitest";
import { arrivalBringsRailBack, modePress } from "../src/web/reader/mode-press.js";

describe("modePress", () => {
  it("Plain closes both, from either door", () => {
    expect(modePress({ next: "plain", current: "summary", bandBack: false, toggle: true })).toBe("plain");
    expect(modePress({ next: "plain", current: "plain", bandBack: false, toggle: false })).toBe("plain");
  });

  it("the bar's button on the band you are in closes it", () => {
    expect(modePress({ next: "summary", current: "summary", bandBack: false, toggle: true })).toBe("close");
  });

  it("brings a stepped-aside band back rather than closing it", () => {
    expect(modePress({ next: "summary", current: "summary", bandBack: true, toggle: true })).toBe("open");
  });

  it("the command bar choosing the mode you are in leaves you in it", () => {
    expect(modePress({ next: "summary", current: "summary", bandBack: false, toggle: false })).toBe("open");
  });

  it("another band opens", () => {
    expect(modePress({ next: "glossary", current: "summary", bandBack: false, toggle: true })).toBe("open");
  });
});

/* The rule the Dock's press and the command bar's *Quick search “X”* row
   share (plan 261005i, GPT Sol's F2): a reader who hid the rail and then
   opens Search gets it back, because the rail is where the hits are drawn. */
describe("arrivalBringsRailBack", () => {
  it("brings a hidden rail back on arriving in Search or Ideas", () => {
    expect(arrivalBringsRailBack({ next: "search", current: "plain", showSpine: false })).toBe(true);
    expect(arrivalBringsRailBack({ next: "ideas", current: "summary", showSpine: false })).toBe(true);
  });

  it("leaves it alone when already there: by default is about arriving, not staying", () => {
    expect(arrivalBringsRailBack({ next: "search", current: "search", showSpine: false })).toBe(false);
  });

  it("has nothing to do for a rail that is not hidden, or for any other band", () => {
    expect(arrivalBringsRailBack({ next: "search", current: "plain", showSpine: null })).toBe(false);
    expect(arrivalBringsRailBack({ next: "search", current: "plain", showSpine: true })).toBe(false);
    expect(arrivalBringsRailBack({ next: "glossary", current: "plain", showSpine: false })).toBe(false);
  });
});
