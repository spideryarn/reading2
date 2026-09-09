/**
 * **The wire parser, which had no tests of its own at all.**
 *
 * GPT Sol's F8, 2026-09-09: after checking `schema`, `kind` and that `versions`
 * is an array, everything else was a cast — so a payload missing `git` crashed
 * the render, one missing `servedAtMs` produced `NaNd ago`, and one missing
 * `newestLineRead` **announced that the record was corrupt when nothing was
 * wrong**. That last is the worst of the three because it is a false alarm
 * invented by version skew: the field arrived after the schema number did, so
 * every older schema-1 server sends a payload without it.
 *
 * The rule the cases below encode: **an absent field must default to the reading
 * that claims LEAST.** Absence means "this server never looked", not "the answer
 * is bad" — an alarm has to be raised by evidence.
 */
import { describe, expect, it } from "vitest";

import { agoFrom, ago, readPayload, shortSha, groupedEntries } from "../tools/fleet/web/src/deploys-client";
import type { DeploysPayload } from "../tools/fleet/wire";

const SHA = "8cd2206ae24e16c65f76ea9f954c5b300616cd57";

function payload(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: 1,
    kind: "deploys",
    versions: [],
    total: 74,
    limit: 10,
    unreadable: [],
    recordLines: 74,
    lastGeneratedAt: "2026-09-08T07:06:51Z",
    newestRecordedSha: SHA,
    newestLineRead: true,
    git: {
      main: { kind: "ref", sha: SHA, committedAt: "2026-09-09T00:32:12Z", lastFetchAtMs: 1000 },
      ancestry: { kind: "ancestor" },
      commitsSince: { kind: "count", commits: 287 },
    },
    servedAtMs: 1_788_912_000_000,
    ...over,
  };
}

describe("the envelope", () => {
  it("reads a healthy payload", () => {
    const view = readPayload(payload());

    expect(view.kind).toBe("deploys");
  });

  it.each([
    ["not an object", 42, "not an object"],
    ["null", null, "not an object"],
    ["a schema this build does not know", payload({ schema: 2 }), "cannot read schema"],
    ["no schema at all", payload({ schema: undefined }), "cannot read schema"],
    ["an unknown kind", payload({ kind: "something-new" }), "cannot read the server's answer"],
    ["versions that is not an array", payload({ versions: "lots" }), "cannot read the server's answer"],
  ])("refuses %s, in this page's own voice", (_name, body, expected) => {
    const view = readPayload(body);

    expect(view.kind).toBe("no-answer");
    if (view.kind === "deploys") throw new Error("unreachable");
    expect(view.why).toContain(expected);
  });

  it("passes the server's `unreadable` arm through in the SERVER's voice", () => {
    const view = readPayload({ schema: 1, kind: "unreadable", why: "there is no record at /nope" });

    expect(view.kind).toBe("unreadable");
    if (view.kind !== "unreadable") throw new Error("unreachable");
    expect(view.why).toBe("there is no record at /nope");
  });

  it("checks the SCHEMA before either arm, so a future shape cannot be half-read", () => {
    /* A schema-2 `unreadable` must not be reported as the server's refusal:
       this build has no idea what a schema-2 payload means. */
    const view = readPayload({ schema: 2, kind: "unreadable", why: "…" });

    expect(view.kind).toBe("no-answer");
  });
});

describe("a field that is missing defaults to claiming the least", () => {
  it("treats a missing `newestLineRead` as fine, NOT as corruption", () => {
    /* The false alarm invented by version skew. An older schema-1 server never
       reported this field; `undefined` is falsy; the page cried corruption. */
    const view = readPayload(payload({ newestLineRead: undefined }));

    expect(view.kind).toBe("deploys");
    if (view.kind !== "deploys") throw new Error("unreachable");
    expect(view.newestLineRead).toBe(true);
  });

  it("still believes an explicit `false`, which is evidence rather than absence", () => {
    const view = readPayload(payload({ newestLineRead: false }));

    if (view.kind !== "deploys") throw new Error("unreachable");
    expect(view.newestLineRead).toBe(false);
  });

  it("falls back to this browser's clock for a missing `servedAtMs`", () => {
    /* Otherwise every age on the page reads `NaNd ago`. */
    const before = Date.now();
    const view = readPayload(payload({ servedAtMs: undefined }));

    if (view.kind !== "deploys") throw new Error("unreachable");
    expect(Number.isFinite(view.servedAtMs)).toBe(true);
    expect(view.servedAtMs).toBeGreaterThanOrEqual(before);
  });

  it.each([undefined, null, "lots", Number.NaN, Number.POSITIVE_INFINITY])(
    "falls back for a servedAtMs of %s rather than propagating it",
    (bad) => {
      const view = readPayload(payload({ servedAtMs: bad }));

      if (view.kind !== "deploys") throw new Error("unreachable");
      expect(Number.isFinite(view.servedAtMs)).toBe(true);
    },
  );

  it("refuses a payload with no `git` rather than crashing the render", () => {
    /* `view.git.main` throws, and a throw during render blanks the panel — so
       this is a wire we cannot read, not a reading we can default. */
    for (const bad of [undefined, null, 7, {}, { main: {} }]) {
      const view = readPayload(payload({ git: bad }));

      expect(view.kind, `git: ${JSON.stringify(bad)}`).toBe("no-answer");
      if (view.kind === "deploys") throw new Error("unreachable");
      expect(view.why).toContain("git readings");
    }
  });

  it("defaults the counts rather than rendering `undefined`", () => {
    const view = readPayload(payload({ total: undefined, recordLines: "many", unreadable: 3 }));

    if (view.kind !== "deploys") throw new Error("unreachable");
    expect(view.total).toBe(0);
    expect(view.recordLines).toBe(0);
    expect(view.unreadable).toEqual([]);
  });

  it("drops non-string entries from `unreadable` rather than rendering them", () => {
    const view = readPayload(payload({ unreadable: ["line 4: bad", 7, null, "line 9: bad"] }));

    if (view.kind !== "deploys") throw new Error("unreachable");
    expect(view.unreadable).toEqual(["line 4: bad", "line 9: bad"]);
  });
});

describe("ages", () => {
  it("says nothing rather than something wrong for an unreadable stamp", () => {
    expect(ago(null, 1000)).toBeNull();
    expect(ago("not a date", 1000)).toBeNull();
    expect(agoFrom(null, 1000)).toBeNull();
  });

  it("refuses an out-of-range instant instead of throwing", () => {
    /* `new Date(1e300).toISOString()` raises RangeError, and a throw during
       render blanks the panel. `Number.isFinite` does NOT catch it. */
    expect(agoFrom(1e300, 1000)).toBeNull();
    expect(agoFrom(-1e300, 1000)).toBeNull();
    expect(agoFrom(Number.NaN, 1000)).toBeNull();
    expect(agoFrom(Number.POSITIVE_INFINITY, 1000)).toBeNull();
  });

  it("accepts the boundary, which is a real time", () => {
    expect(agoFrom(8.64e15, 8.64e15)).toBe("0s ago");
  });

  it("never says a future stamp is negative", () => {
    /* The box's clock and the phone's need not agree, and "in 3 minutes" beside
       a deploy is a puzzle nobody should have to solve. */
    expect(agoFrom(2000, 1000)).toBe("just now");
  });

  it.each([
    [0, "0s ago"],
    [45_000, "45s ago"],
    [5 * 60_000, "5m ago"],
    [3 * 3_600_000, "3h ago"],
    [5 * 86_400_000, "5d ago"],
  ])("coarsens by %sms", (elapsed, expected) => {
    expect(agoFrom(1_000_000_000, 1_000_000_000 + elapsed)).toBe(expected);
  });
});

describe("small helpers", () => {
  it("shortens a sha to the seven characters a person reads", () => {
    expect(shortSha(SHA)).toBe("8cd2206");
  });

  it("groups entries under the three headings, in order, dropping empty ones", () => {
    const version = {
      version: "2026-09-08T05:32:17Z",
      release: 74,
      deploymentId: "dpl",
      sha: SHA,
      previousSha: null,
      commitCount: 1,
      invisible: false,
      changelogReadable: true,
      unreadableEntries: 0,
      generatedAt: null,
      entries: [
        { section: "fix" as const, title: "F", body: "b", where: null, commits: [] },
        { section: "headline" as const, title: "H", body: "b", where: null, commits: [] },
      ],
    };

    const groups = groupedEntries(version);

    /* Headline first even though `fix` came first in the array: the order is the
       product's, not the file's. And no "Minor enhancements" heading over
       nothing. */
    expect(groups.map((g) => g.section)).toEqual(["headline", "fix"]);
    expect(groups.map((g) => g.label)).toEqual(["Headline changes", "Bug fixes"]);
  });
});

/** The payload type is the wire's; this asserts the fixture is a real one. */
const _typecheck: DeploysPayload = payload() as unknown as DeploysPayload;
void _typecheck;
