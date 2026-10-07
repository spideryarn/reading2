/**
 * **Whose add visit this is, and whether it has been stopped** —
 * src/web/add-visit.ts, the table in
 * docs/plans/261006e-add-page-forgets-everything-when-the-reader-changes.md
 * § 1, row by row.
 *
 * The rule is a pure function so that it can be read here without a session,
 * a router or a page. What `App` does with the answer is in
 * tests/add-page-reader-change.test.tsx.
 */
import { describe, expect, it } from "vitest";

import { addAddress, nextAddVisit, type AddVisit } from "../src/web/add-visit.js";

const PAPER = "url https://example.com/paper";
const OTHER = "url https://example.com/other";
const running = (reader: string, address = PAPER): AddVisit => ({ kind: "running", address, reader });
const stopped = (address = PAPER): AddVisit => ({ kind: "stopped", address });

describe("nextAddVisit", () => {
  it("forgets the visit away from an add address, whoever is signed in", () => {
    expect(nextAddVisit(running("A"), null, "A")).toBeNull();
    expect(nextAddVisit(running("A"), null, "B")).toBeNull();
    expect(nextAddVisit(running("A"), null, null)).toBeNull();
    expect(nextAddVisit(stopped(), null, "B")).toBeNull();
  });

  it("keeps the visit as it is while nobody is signed in", () => {
    const held = running("A");
    expect(nextAddVisit(held, PAPER, null)).toBe(held);
    const halted = stopped();
    expect(nextAddVisit(halted, PAPER, null)).toBe(halted);
    expect(nextAddVisit(null, PAPER, null)).toBeNull();
  });

  it("starts a visit for whoever is signed in when there is none", () => {
    expect(nextAddVisit(null, PAPER, "A")).toEqual(running("A"));
  });

  it("starts a new visit at another address, for whoever is there now", () => {
    expect(nextAddVisit(running("A"), OTHER, "A")).toEqual(running("A", OTHER));
    expect(nextAddVisit(running("A"), OTHER, "B")).toEqual(running("B", OTHER));
    /* Leaving the address is what ends a stop. */
    expect(nextAddVisit(stopped(), OTHER, "B")).toEqual(running("B", OTHER));
  });

  it("leaves the visit unchanged for its own reader", () => {
    const held = running("A");
    expect(nextAddVisit(held, PAPER, "A")).toBe(held);
  });

  it("stops the visit when another reader is at its address", () => {
    expect(nextAddVisit(running("A"), PAPER, "B")).toEqual(stopped());
  });

  it("stays stopped when the first reader comes back", () => {
    let visit = nextAddVisit(null, PAPER, "A");
    visit = nextAddVisit(visit, PAPER, "B");
    visit = nextAddVisit(visit, PAPER, "A");
    expect(visit).toEqual(stopped());
  });

  it("stops across a signed-out render: A, then nobody, then B", () => {
    let visit = nextAddVisit(null, PAPER, "A");
    visit = nextAddVisit(visit, PAPER, null);
    expect(visit).toEqual(running("A"));
    visit = nextAddVisit(visit, PAPER, "B");
    expect(visit).toEqual(stopped());
    /* And through another signed-out render, and for anybody after it. */
    visit = nextAddVisit(visit, PAPER, null);
    visit = nextAddVisit(visit, PAPER, "A");
    expect(visit).toEqual(stopped());
  });

  it("runs for somebody who arrived signed out and then signed in", () => {
    let visit = nextAddVisit(null, PAPER, null);
    visit = nextAddVisit(visit, PAPER, "B");
    expect(visit).toEqual(running("B"));
  });

  it("gives the same answer when asked twice, as StrictMode asks", () => {
    const once = nextAddVisit(running("A"), PAPER, "B");
    expect(nextAddVisit(once, PAPER, "B")).toBe(once);
  });
});

describe("addAddress", () => {
  it("names an address to fetch and an upload apart, and nothing else", () => {
    expect(addAddress({ kind: "add", url: "https://example.com/paper" })).toBe(PAPER);
    expect(addAddress({ kind: "add-upload", uploadId: "up-1" })).toBe("upload up-1");
    expect(addAddress({ kind: "library" })).toBeNull();
  });
});
