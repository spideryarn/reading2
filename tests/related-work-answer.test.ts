/**
 * **Not cited's answer, shape-checked before the panel draws it**
 * (useRelatedWork.ts § `asRelatedWorkResult`), including the two groups under
 * the list that plan 261025h added (decision 3): *Other editions of this
 * piece* and *By the same authors*, each absent when empty. A row in either
 * that is not a work would throw while drawing, so it makes the answer
 * `unavailable` as a bad row in the list does.
 */
import { describe, expect, it } from "vitest";
import { asRelatedWorkResult } from "../src/web/useRelatedWork.js";

const WORK = { openalexId: "W123", title: "A paper", authors: ["A. Author"], authorCount: 1 };
const FOUND = {
  kind: "found",
  works: [WORK],
  excluded: 0,
  bibliographyStale: false,
  bibliographyCapped: false,
  yearLimited: null,
  queryChanged: false,
  searchedAt: "2026-10-25T10:00:00.000Z",
};

describe("asRelatedWorkResult", () => {
  it("reads a found answer with neither group, and with both", () => {
    expect(asRelatedWorkResult(FOUND)).toEqual(FOUND);
    const both = { ...FOUND, editions: [WORK], sameAuthors: [{ ...WORK, openalexId: "W456" }] };
    expect(asRelatedWorkResult(both)).toEqual(both);
  });

  it("refuses a group that is not a list of works", () => {
    expect(asRelatedWorkResult({ ...FOUND, editions: [{ title: 3 }] })).toBeNull();
    expect(asRelatedWorkResult({ ...FOUND, sameAuthors: "W123" })).toBeNull();
  });
});
