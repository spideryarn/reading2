/**
 * **A repaired model answer says so, and says nothing about itself.**
 *
 * `dropTrailingCommas` mends a malformed model answer and, until 2026-09-07,
 * nothing recorded that it had — so the rate at which a model gets the format
 * wrong was invisible, and a model that started emitting these on every answer
 * would have been accommodated silently.
 * docs/postmortems/260906b-asking-a-model-to-omit-a-field-makes-it-emit-the-comma-anyway.md.
 *
 * Two things are pinned here, and the second matters at least as much as the
 * first:
 *
 * 1. a repair that fires is reported, with the outcome, and one that does not
 *    fire is not;
 * 2. **nothing of the answer reaches the line.** `src/parse-json.ts` exists
 *    because `JSON.parse`'s error message quotes its input, and this is the one
 *    call it makes that leads to a logger at all. A test that only checked the
 *    count would be green over a leak.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { parseJsonAnswer } from "../src/parse-json.js";

/**
 * What reached the log, as `[fields, message]` pairs.
 *
 * The logger is spied on at `src/log.ts`'s own seam rather than the reporter
 * being injected: the claim under test is *what a running server writes down*,
 * and a fake passed into the code under test would not be that.
 */
const lines: { fields: Record<string, unknown>; message: string }[] = [];

vi.mock("../src/log.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/log.js")>();
  return {
    ...actual,
    log: (component: string) => ({
      ...actual.log(component as Parameters<typeof actual.log>[0]),
      warn: (fields: Record<string, unknown>, message: string) => {
        lines.push({ fields, message });
      },
    }),
  };
});

beforeEach(() => {
  lines.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** The whole line, as one string, for the "nothing of the answer" assertion. */
const asText = () => JSON.stringify(lines);

describe("a trailing-comma repair is counted", () => {
  it("says nothing when the answer parses cleanly", () => {
    /* The control that stops every other assertion here being vacuous: if this
       reported, `removed > 0` would not be the gate and the signal would be a
       line on every model call. */
    expect(parseJsonAnswer<{ a: number }>(`{"a":1}`, "the quotes response")).toEqual({ a: 1 });
    expect(lines).toEqual([]);
  });

  it("reports an accepted repair, with the source and the count", () => {
    expect(parseJsonAnswer<{ a: number }>(`{"a":1,}`, "the quotes response")).toEqual({ a: 1 });
    expect(lines).toHaveLength(1);
    expect(lines[0]?.fields).toEqual({
      source: "the quotes response",
      removed: 1,
      outcome: "accepted",
    });
  });

  it("counts every comma it removed, not every answer it repaired", () => {
    /* One captured live answer carried twenty. The count is what says whether
       this is a stray or a model that has stopped emitting valid JSON. */
    const answer = parseJsonAnswer<{ a: number[]; b: { c: number } }>(
      `{"a":[1,2,],"b":{"c":3,},}`,
      "the nav labels",
    );
    expect(answer).toEqual({ a: [1, 2], b: { c: 3 } });
    expect(lines[0]?.fields.removed).toBe(3);
  });

  it("reports a repair that did not save the answer, as a different outcome", () => {
    /* The commas came out and the span still would not parse, so they were a
       symptom rather than the fault. Counted, because a repair rate that only
       counted successes would flatter the model — and it is a *different*
       number: this one is a broken answer and a Retry button, not a tax we
       absorbed. GPT Sol, 2026-09-07, F4. */
    expect(() => parseJsonAnswer(`{"a": nope,}`, "the arc response")).toThrow();
    expect(lines).toHaveLength(1);
    expect(lines[0]?.fields).toMatchObject({ outcome: "still-invalid", removed: 1 });
  });

  it("never writes any part of the answer into the line", () => {
    /* The assertion this file exists for as much as the counting. The needle is
       shaped like article prose, and it is present in the repaired span, in the
       key and in the value — so a report that carried the payload under *any*
       key would fail this. */
    const needle = "Ozymandias king of kings";
    expect(() =>
      parseJsonAnswer(`{"${needle}": ${JSON.stringify(needle)}, "x": broken,}`, "the arc response"),
    ).toThrow();
    expect(asText()).not.toContain("Ozymandias");
    /* And the message is a fixed sentence of ours, not a rendering of anything
       that was parsed. */
    expect(lines[0]?.message).toBe(
      "repaired trailing commas in a model answer before parsing it",
    );
  });

  it("does not report when there was no repair to make on a broken answer", () => {
    /* A broken answer with no trailing comma in it is the ordinary failure and
       has nothing to do with this signal. If it reported, the number would be
       "answers that failed to parse" wearing the wrong name. */
    expect(() => parseJsonAnswer(`{"a": nope}`, "the arc response")).toThrow();
    expect(lines).toEqual([]);
  });
});
