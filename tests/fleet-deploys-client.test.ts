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

import {
  agoFrom,
  ago,
  dayLabel,
  deployDays,
  deployGist,
  deployWhenIn,
  readPayload,
  shortSha,
  groupedEntries,
} from "../tools/fleet/web/src/deploys-client";
import type { DeploysPayload, DeployVersion } from "../tools/fleet/wire";

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

/* ------------------------------------------------------------------ *
 * The collapsed row.
 * ------------------------------------------------------------------ */

function version(over: Partial<DeployVersion> = {}): DeployVersion {
  return {
    version: "2026-09-08T05:32:17Z",
    release: 74,
    deploymentId: "dpl",
    sha: SHA,
    previousSha: null,
    commitCount: 12,
    invisible: false,
    changelogReadable: true,
    unreadableEntries: 0,
    generatedAt: null,
    entries: [
      { section: "fix", title: "F", body: "b", where: null, commits: [] },
      { section: "headline", title: "H", body: "b", where: null, commits: [] },
    ],
    ...over,
  };
}

describe("deployGist — the one line a closed deploy gets", () => {
  it("leads with the headline entry, not the first one in the file", () => {
    /* Same argument as `groupedEntries`: the order the record happens to hold
       is not the order a reader cares about, and a closed row shows exactly
       one title. */
    expect(deployGist(version())).toEqual({ kind: "entries", title: "H", more: 1, unreadable: 0 });
  });

  it("says NOTHING CHANGED only when the changelog was read", () => {
    expect(deployGist(version({ entries: [], invisible: true })).kind).toBe("quiet");
  });

  it("does NOT call an unreadable changelog a quiet deploy", () => {
    /* **The collapse this whole design could commit.** A deploy whose entries
       would not parse has an empty `entries` array, so any gist that branched
       on "are there entries" would draw a headline release as *nothing a reader
       would notice* — the identical bug GPT Sol found in the open card on
       2026-09-09, re-introduced one level up. */
    const gist = deployGist(version({ entries: [], changelogReadable: false, unreadableEntries: 3 }));
    expect(gist.kind).toBe("unreadable");
    expect(gist.title).toBeNull();
  });

  it("carries the unparsed count, so a short list is not shown as a whole one", () => {
    expect(deployGist(version({ unreadableEntries: 2 }))).toMatchObject({ kind: "entries", more: 1, unreadable: 2 });
  });
});

describe("deployWhenIn — one instant, one zone, always labelled", () => {
  it("reads an instant in the zone it is given", () => {
    expect(deployWhenIn("2026-09-08T05:32:17Z", { zone: "Europe/Athens", label: "Athens" })).toEqual({
      date: "2026-09-08",
      time: "08:32",
      label: "Athens",
    });
  });

  it("falls back to UTC — and SAYS UTC — for a zone this host does not know", () => {
    /* The retreat is named rather than silent: a row reading `05:32 UTC` on a
       host whose zone `Intl` refuses is true, where `05:32` under an Athens
       heading would not be. */
    expect(deployWhenIn("2026-09-08T05:32:17Z", { zone: "Mars/Olympus", label: "Olympus" })).toEqual({
      date: "2026-09-08",
      time: "05:32",
      label: "UTC",
    });
  });

  it("returns null for an instant it cannot read, rather than an invented time", () => {
    expect(deployWhenIn("not a time", { zone: "UTC", label: "UTC" })).toBeNull();
  });
});

describe("deployDays — grouped in whatever zone the rows are drawn in", () => {
  it("files a late-evening deploy under the day that ZONE had", () => {
    /* **The assertion this parameter exists for.** 23:19 UTC is 02:19 Athens the
       next morning, so a heading measured in one zone over a time measured in
       another files a release under a day it did not happen on — the `(+1d)`
       case zones.ts carries a suffix for, arriving as a wrong heading.

       Production passes no zone and gets UTC (`ROW_ZONE`), so this case cannot
       arise on the page today. It is checked anyway, because the parameter is
       what stops the heading and the row's clock ever being measured
       differently, and a branch no test reaches is one nobody can trust —
       zones.ts's own argument for keeping `zones` a parameter. */
    const days = deployDays(
      [
        version({ version: "2026-09-08T23:19:14Z", deploymentId: "late", release: 74 }),
        version({ version: "2026-09-08T05:32:17Z", deploymentId: "early", release: 73 }),
      ],
      { zone: "Europe/Athens", label: "Athens" },
    );

    expect(days.map((d) => d.key)).toEqual(["2026-09-09", "2026-09-08"]);
    expect(days[0]?.versions.map((v) => v.deploymentId)).toEqual(["late"]);
    expect(days[1]?.versions.map((v) => v.deploymentId)).toEqual(["early"]);
  });

  it("keeps a day's deploys together and in the order they arrived", () => {
    const days = deployDays(
      [
        version({ version: "2026-09-08T10:00:00Z", deploymentId: "a" }),
        version({ version: "2026-09-08T09:00:00Z", deploymentId: "b" }),
        version({ version: "2026-09-07T09:00:00Z", deploymentId: "c" }),
      ],
      { zone: "UTC", label: "UTC" },
    );

    expect(days).toHaveLength(2);
    expect(days[0]?.versions.map((v) => v.deploymentId)).toEqual(["a", "b"]);
    expect(days[1]?.versions.map((v) => v.deploymentId)).toEqual(["c"]);
  });

  it("puts an unreadable instant under a heading that says so", () => {
    /* Never its own invented day, and never silently dropped: a deploy missing
       from the list is the failure this tab's whole first pass was about. */
    const days = deployDays([version({ version: "nonsense", deploymentId: "x" })], { zone: "UTC", label: "UTC" });
    expect(days).toHaveLength(1);
    expect(days[0]?.label).toBe("at a time this page cannot read");
    expect(days[0]?.versions).toHaveLength(1);
  });
});

describe("dayLabel", () => {
  it("spells a key as a person reads it, with the weekday", () => {
    expect(dayLabel("2026-09-08")).toBe("Tue 8 Sep 2026");
  });

  it("does not slip onto the neighbouring day", () => {
    /* **`timeZone: "UTC"` is the guarantee, not the hour.** The key is already
       a calendar date, and formatting it in UTC cannot move it whatever hour is
       chosen; noon is belt to that braces, so a later edit that changed the
       zone would produce a wrong LABEL rather than a wrong DAY. This comment
       said noon was the mechanism until GPT Sol pointed out that it is not. */
    expect(dayLabel("2026-01-01")).toBe("Thu 1 Jan 2026");
  });
});

/** The payload type is the wire's; this asserts the fixture is a real one. */
const _typecheck: DeploysPayload = payload() as unknown as DeploysPayload;
void _typecheck;
