/**
 * The wire boundary — tools/fleet/web/src/health-history-client.ts.
 *
 * **EVERY TEST HERE WAS A HOLE GPT SOL WALKED THROUGH BY HAND**, on 2026-09-08,
 * against the built code. Each one produced a page that was confident, plausible
 * and wrong, which is the failure mode that matters in this panel — a crash is
 * cheap by comparison:
 *
 *  - a payload stamped `schema: 2` was drawn as current history;
 *  - renaming or dropping `samples` produced a valid, empty, reassuring day;
 *  - a malformed sample between two healthy ones was dropped, and the line was
 *    drawn straight across the place it had been.
 *
 * The lesson is the one the module header already states and the code had not
 * kept: **this parser's job is to refuse, not to cope.** A payload it cannot
 * fully believe becomes a sentence, never a chart.
 */
import { describe, expect, it } from "vitest";

import { parseHistory, parseSample } from "../tools/fleet/web/src/health-history-client";

const AT = "2026-09-08T12:00:00.000Z";
const AT_MS = Date.parse(AT);

function sample(at: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return { schema: 1, at, nextDueMs: 73_000, kind: "reading", report: { load: { kind: "value", ratio1: 1.2 } }, ...over };
}

function payload(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: 1,
    kind: "history",
    windowHours: 24,
    fromMs: AT_MS - 86_400_000,
    toMs: AT_MS,
    samples: [sample(AT)],
    predecessor: null,
    holes: [],
    earliestAt: AT,
    rotated: false,
    retention: { lastAttemptAt: AT, lastSuccessAt: AT, failure: null, poisoned: false, lockedOutBy: null },
    unreadableLines: 0,
    refreshMs: 60_000,
    ...over,
  };
}

describe("the schema is checked", () => {
  it("refuses a version this build has never heard of, rather than drawing it", () => {
    /* A version exists so that a server which changed what a field MEANS is not
       rendered by a client that predates the change. Accepting it is the silent,
       plausible failure the whole envelope was for. */
    const view = parseHistory(payload({ schema: 2 }));
    expect(view.kind).toBe("no-answer");
    if (view.kind !== "no-answer") return;
    expect(view.why).toContain("2");
    expect(view.why).toMatch(/version 1/);
  });

  it("refuses a payload with no schema at all", () => {
    const raw = payload();
    delete raw["schema"];
    expect(parseHistory(raw).kind).toBe("no-answer");
  });

  it("accepts version 1", () => {
    expect(parseHistory(payload()).kind).toBe("history");
  });
});

describe("a missing samples array", () => {
  it("is a payload this page cannot read, NOT an empty day", () => {
    /* The two are opposite claims and the second is the reassuring one, which
       is why it is the dangerous one. */
    const raw = payload();
    delete raw["samples"];
    const view = parseHistory(raw);
    expect(view.kind).toBe("no-answer");
    if (view.kind !== "no-answer") return;
    expect(view.why).toMatch(/cannot read/);
  });

  it("is also refused when the field was renamed", () => {
    const raw = payload();
    raw["rows"] = raw["samples"];
    delete raw["samples"];
    expect(parseHistory(raw).kind).toBe("no-answer");
  });

  it("an EMPTY array is a real claim and is accepted", () => {
    const view = parseHistory(payload({ samples: [] }));
    expect(view.kind).toBe("history");
    if (view.kind !== "history") return;
    expect(view.samples).toEqual([]);
  });
});

describe("a sample this page cannot read", () => {
  it("becomes a positional hole, so the line breaks where it was", () => {
    /* Counted-and-dropped let the renderer draw straight across the place the
       record is broken — the same reconnection a break must never get. */
    const later = new Date(AT_MS + 146_000).toISOString();
    const view = parseHistory(
      payload({ samples: [sample(AT), { schema: 1, at: "not a date" }, sample(later)] }),
    );
    if (view.kind !== "history") throw new Error("expected a history");
    expect(view.samples).toHaveLength(2);
    expect(view.unreadableSamples).toBe(1);
    expect(view.holes).toEqual([{ afterAtMs: AT_MS, beforeAtMs: Date.parse(later) }]);
  });

  it("treats a run of them as one place the record is broken", () => {
    const later = new Date(AT_MS + 219_000).toISOString();
    const view = parseHistory(
      payload({ samples: [sample(AT), { bad: 1 }, { bad: 2 }, { bad: 3 }, sample(later)] }),
    );
    if (view.kind !== "history") throw new Error("expected a history");
    expect(view.unreadableSamples).toBe(3);
    expect(view.holes).toHaveLength(1);
  });

  it("places a hole with no left neighbour when the first sample is the bad one", () => {
    const view = parseHistory(payload({ samples: [{ bad: 1 }, sample(AT)] }));
    if (view.kind !== "history") throw new Error("expected a history");
    expect(view.holes[0]).toEqual({ afterAtMs: null, beforeAtMs: AT_MS });
  });

  it("keeps the store's own holes alongside its own", () => {
    const view = parseHistory(
      payload({
        samples: [sample(AT)],
        holes: [{ afterAt: "2026-09-08T11:00:00.000Z", beforeAt: AT }],
      }),
    );
    if (view.kind !== "history") throw new Error("expected a history");
    expect(view.holes).toHaveLength(1);
    expect(view.holes[0]?.afterAtMs).toBe(Date.parse("2026-09-08T11:00:00.000Z"));
  });
});

describe("the window", () => {
  it("refuses a payload with no usable axis, rather than inventing one", () => {
    /* A chart plotted over a window this page made up would put every point in
       the wrong place and look entirely normal doing it. */
    const raw = payload();
    delete raw["fromMs"];
    expect(parseHistory(raw).kind).toBe("no-answer");
    expect(parseHistory(payload({ toMs: AT_MS - 86_400_000 - 1 })).kind).toBe("no-answer");
  });
});

describe("the writer's condition off the wire", () => {
  it("is null when the server did not say — never a healthy default", () => {
    const raw = payload();
    delete raw["retention"];
    const view = parseHistory(raw);
    if (view.kind !== "history") throw new Error("expected a history");
    /* A server built before the field existed makes no claim about whether it
       is still writing, and inventing a healthy one puts a reassurance on the
       page that nothing produced. */
    expect(view.retention).toBeNull();
  });

  it("carries a lock-out as its own field", () => {
    const view = parseHistory(
      payload({
        retention: { lastAttemptAt: null, lastSuccessAt: null, failure: null, poisoned: false, lockedOutBy: "pid 42 holds it" },
      }),
    );
    if (view.kind !== "history") throw new Error("expected a history");
    expect(view.retention?.lockedOutBy).toBe("pid 42 holds it");
  });
});

describe("the server's own refusal", () => {
  it("comes through in the server's voice, not this page's", () => {
    const view = parseHistory({ schema: 1, kind: "unreadable", why: "could not read /x: EIO" });
    expect(view.kind).toBe("unreadable");
    if (view.kind !== "unreadable") return;
    expect(view.why).toContain("EIO");
  });

  it("is not confused with this browser failing to ask", () => {
    expect(parseHistory("not an object").kind).toBe("no-answer");
    expect(parseHistory({ kind: "something-else" }).kind).toBe("no-answer");
  });
});

describe("parseSample", () => {
  it("refuses a sample with no usable clock or interval", () => {
    expect(parseSample(sample(AT, { at: "" }))).toBeNull();
    expect(parseSample(sample(AT, { nextDueMs: 0 }))).toBeNull();
    expect(parseSample(sample(AT, { nextDueMs: "soon" }))).toBeNull();
  });

  it("keeps a collector failure as its own arm", () => {
    const parsed = parseSample({ schema: 1, at: AT, nextDueMs: 73_000, kind: "collector-failed", why: "boom" });
    expect(parsed?.kind).toBe("collector-failed");
  });

  it("refuses a reading with no report object", () => {
    expect(parseSample(sample(AT, { report: "nope" }))).toBeNull();
  });
});
