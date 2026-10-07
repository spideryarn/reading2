/**
 * **The transition table of `Read`** — src/web/read-state.ts, every state by
 * every event. Six states, because a known answer and a known "none yet" behave
 * differently under *Try again*, and so does each with a failed recheck.
 *
 * This proves the functions; it does not prove a hook calls them. That is
 * tests/ideas-read-states.test.tsx, which drives the real hook and panel.
 */
import { describe, expect, it } from "vitest";
import { answerOf, failedRead, failureOf, landed, type Read, retrying, statusOf } from "../src/web/read-state.js";

type A = { name: string };
const OLD: A = { name: "old" };
const NEW: A = { name: "new" };

const STATES: Record<string, Read<A>> = {
  asking: { kind: "asking" },
  failed: { kind: "failed", error: "first" },
  none: { kind: "known", answer: null, recheck: null },
  "none, recheck failed": { kind: "known", answer: null, recheck: "first" },
  list: { kind: "known", answer: OLD, recheck: null },
  "list, recheck failed": { kind: "known", answer: OLD, recheck: "first" },
};
const names = Object.keys(STATES);

describe("landed", () => {
  /* It takes no previous state, so whatever was true before, this is what follows. */
  it("an answer is known, and any failure is over", () => {
    expect(landed(NEW)).toEqual({ kind: "known", answer: NEW, recheck: null });
  });
  it("none yet is a known answer of null, not a failure and not asking", () => {
    expect(landed<A>(null)).toEqual({ kind: "known", answer: null, recheck: null });
  });
});

describe("failedRead", () => {
  const AFTER: Record<string, Read<A>> = {
    asking: { kind: "failed", error: "second" },
    failed: { kind: "failed", error: "second" },
    none: { kind: "known", answer: null, recheck: "second" },
    "none, recheck failed": { kind: "known", answer: null, recheck: "second" },
    list: { kind: "known", answer: OLD, recheck: "second" },
    "list, recheck failed": { kind: "known", answer: OLD, recheck: "second" },
  };
  it.each(names)("from %s: what was known stays, under the newest sentence", (name) => {
    expect(failedRead(STATES[name]!, "second")).toEqual(AFTER[name]);
  });
  it("keeps the very answer it was given, so a memo keyed on it does not re-run", () => {
    expect(answerOf(failedRead(STATES.list!, "second"))).toBe(OLD);
  });
  it("keeps an empty sentence as a failure — presence is `!== null`, never truthiness", () => {
    expect(failureOf(failedRead(STATES.list!, ""))).toBe("");
    expect(failureOf(failedRead(STATES.asking!, ""))).toBe("");
  });
});

describe("retrying", () => {
  const AFTER: Record<string, Read<A>> = {
    asking: { kind: "asking" },
    failed: { kind: "asking" },
    /* Today's rule, and the owner's open question: none yet goes back to asking. */
    none: { kind: "asking" },
    "none, recheck failed": { kind: "asking" },
    list: { kind: "known", answer: OLD, recheck: null },
    "list, recheck failed": { kind: "known", answer: OLD, recheck: null },
  };
  it.each(names)("from %s: a list stays with its failure cleared, anything else asks again", (name) => {
    expect(retrying(STATES[name]!)).toEqual(AFTER[name]);
  });
});

describe("what a consumer reads off it", () => {
  const READS: Record<string, { status: string; answer: A | null; failure: string | null }> = {
    asking: { status: "loading", answer: null, failure: null },
    failed: { status: "error", answer: null, failure: "first" },
    none: { status: "none", answer: null, failure: null },
    /* A failed recheck changes neither word: it must not change what is spent. */
    "none, recheck failed": { status: "none", answer: null, failure: "first" },
    list: { status: "ready", answer: OLD, failure: null },
    "list, recheck failed": { status: "ready", answer: OLD, failure: "first" },
  };
  it.each(names)("%s", (name) => {
    const read = STATES[name]!;
    expect({ status: statusOf(read), answer: answerOf(read), failure: failureOf(read) }).toEqual(READS[name]);
  });
});
