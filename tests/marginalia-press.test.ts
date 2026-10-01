/* What pressing Marginalia does — the most recent press wins on a window too
   narrow for the band and the notes together (SPIDERYARN-READING2-7P).
   docs/plans/261001k-annotations-head-path-wraps-and-the-notes-swap-in-on-a-narrow-window.md */
import { describe, expect, it } from "vitest";
import { marginaliaPress, notesFit } from "../src/web/marginalia/press.js";

/* The hypothetical fits the press reads, at their thresholds (GPT Sol on the
   plan): alone from 612 with the rail and 600 without; beside a band from 900
   and 888. Between 612 and 699 the band covers the prose and the notes still
   fit alone, so a landscape phone swaps too. */
describe("notesFit", () => {
  const at = (windowWidth: number, showSpine: boolean | null, bandOpen: boolean) =>
    notesFit({ windowWidth, showSpine }, bandOpen);

  it("fits the notes alone from 612px with the rail, 600 without", () => {
    expect(at(611, true, false).alone).toBe(false);
    expect(at(612, true, false).alone).toBe(true);
    expect(at(599, false, false).alone).toBe(false);
    expect(at(600, false, false).alone).toBe(true);
  });

  it("fits them beside a band from 900px with the rail", () => {
    expect(at(899, true, true).both).toBe(false);
    expect(at(900, true, true).both).toBe(true);
  });

  it("reads 'alone' even with a band open, so a covering band can be swapped", () => {
    expect(at(650, null, true)).toEqual({ both: false, alone: true });
  });
});

const press = (margin: boolean, bandOpen: boolean, bothFit: boolean, aloneFit: boolean) =>
  marginaliaPress({ margin, bandOpen, bothFit, aloneFit });

describe("marginaliaPress", () => {
  it("turns the notes on with no band", () => {
    expect(press(false, false, false, true)).toEqual({ margin: true, closeBand: false });
  });

  it("turns the notes on beside a band where both fit, and leaves the band", () => {
    expect(press(false, true, true, true)).toEqual({ margin: true, closeBand: false });
  });

  it("swaps the band out for the notes where only one fits", () => {
    expect(press(false, true, false, true)).toEqual({ margin: true, closeBand: true });
  });

  it("brings back notes hidden behind a band that won, rather than turning them off", () => {
    expect(press(true, true, false, true)).toEqual({ margin: true, closeBand: true });
  });

  it("turns showing notes off", () => {
    expect(press(true, false, false, true)).toEqual({ margin: false, closeBand: false });
    expect(press(true, true, true, true)).toEqual({ margin: false, closeBand: false });
  });

  it("never closes the band on a phone, where the notes do not fit even alone", () => {
    expect(press(false, true, false, false)).toEqual({ margin: true, closeBand: false });
    expect(press(true, true, false, false)).toEqual({ margin: false, closeBand: false });
  });
});
