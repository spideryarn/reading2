/**
 * The dashboard's projection of the per-account block. Plan 260910c.
 *
 * `tests/fleet-account-usage-sections.test.tsx` drives the whole hop into a DOM;
 * this file is about the projection's own refusals, which are easier to state
 * as values than as rendered text — and about the **mixed-version** cases, where
 * a build of one age reads a checkpoint written by a build of another. Those are
 * the ones nobody exercises by accident.
 */
import { describe, expect, it } from "vitest";

import { projectAccountUsage } from "../tools/fleet/account-usage-feed.js";
import type { AccountUsageSection } from "../tools/fleet/wire.js";

const WRITTEN_AT = "2026-09-10T06:00:00.000Z";
const TAKEN_AT = "2026-09-10T05:59:00.000Z";

function section(over: Partial<Extract<AccountUsageSection, { family: "claude" }>> = {}): AccountUsageSection {
  return {
    name: "mindstone",
    family: "claude",
    role: "pool",
    origin: "registered",
    displayEmail: "greg@mindstone.com",
    providerAccountId: "provider-mindstone",
    takenAt: TAKEN_AT,
    reading: {
      kind: "windows",
      windows: [{ kind: "value", window: "five_hour", utilizationPercent: 41, resetsAt: "2026-09-10T09:00:00.000Z" }],
    },
    ...over,
  };
}

function checkpoint(accountUsage: unknown): unknown {
  return { schema: 2, writtenAt: WRITTEN_AT, accountUsage };
}

describe("projectAccountUsage reads what the Overseer wrote", () => {
  it("publishes the sections, their problems and both clocks", () => {
    const feed = projectAccountUsage(
      checkpoint({ kind: "reading", collectedAt: TAKEN_AT, accounts: [section()], problems: ["the registry is broken"] }),
    );
    expect(feed).toEqual({
      kind: "published",
      collectedAt: TAKEN_AT,
      accounts: [section()],
      problems: ["the registry is broken"],
      coordinatorWrittenAt: WRITTEN_AT,
    });
  });

  /**
   * **THE MIXED-VERSION CASE THAT PRODUCTION DRAWS FIRST.** The field was added
   * without a schema bump — the store's own rule is that a reader ignoring a new
   * field is poorer rather than wrong — so a checkpoint written by a daemon that
   * predates this feature carries nothing here. It must read as *no pass has
   * run*, never as *this box has no subscriptions*.
   */
  it("reads an older checkpoint's missing block as 'no pass has run'", () => {
    const feed = projectAccountUsage(checkpoint(undefined));
    expect(feed.kind).toBe("no-reading");
    if (feed.kind !== "no-reading") throw new Error("expected no-reading");
    expect(feed.why).toContain("written before the Overseer had one");
    expect(feed.at).toBe(WRITTEN_AT);
  });

  it("refuses a checkpoint schema it does not know rather than coercing it", () => {
    expect(projectAccountUsage({ schema: 99, writtenAt: WRITTEN_AT, accountUsage: { kind: "reading" } })).toEqual({
      kind: "unsupported-schema",
      saw: "99",
      known: 2,
    });
  });

  it("refuses a checkpoint with no readable clock, because an age cannot be told without one", () => {
    expect(projectAccountUsage({ schema: 2, writtenAt: "not a time" })).toEqual({
      kind: "checkpoint-unreadable",
      why: expect.stringContaining("writtenAt"),
    });
  });
});

describe("projectAccountUsage refuses rather than quietly saying less", () => {
  /**
   * A list one shorter than it should be tells the reader the box has fewer
   * subscriptions than it has, and nothing on the page contradicts it. So one
   * unreadable section fails the whole feed — the same rule `parseHit` follows
   * about a rejection going missing from a list of nine.
   */
  it("fails the whole feed rather than dropping a section it cannot read", () => {
    const feed = projectAccountUsage(
      checkpoint({
        kind: "reading",
        collectedAt: TAKEN_AT,
        problems: [],
        accounts: [section(), { ...section({ name: "broken" }), role: "sovereign" }],
      }),
    );
    expect(feed.kind).toBe("reading-unreadable");
    if (feed.kind !== "reading-unreadable") throw new Error("expected reading-unreadable");
    expect(feed.why).toContain("broken");
  });

  it("fails the feed on a window it cannot read, rather than a section with one row missing", () => {
    const feed = projectAccountUsage(
      checkpoint({
        kind: "reading",
        collectedAt: TAKEN_AT,
        problems: [],
        accounts: [
          section({
            reading: {
              kind: "windows",
              // A percentage with no reset instant: the reading exists and
              // cannot be placed in time, which is not the same as absent.
              windows: [{ kind: "value", window: "five_hour", utilizationPercent: 41 } as never],
            },
          }),
        ],
      }),
    );
    expect(feed.kind).toBe("reading-unreadable");
  });

  /** Two rows for one subscription make both untrustworthy, however they arrived. */
  it("refuses a file that lists one account twice", () => {
    const feed = projectAccountUsage(
      checkpoint({ kind: "reading", collectedAt: TAKEN_AT, problems: [], accounts: [section(), section()] }),
    );
    expect(feed.kind).toBe("reading-unreadable");
    if (feed.kind !== "reading-unreadable") throw new Error("expected reading-unreadable");
    expect(feed.why).toContain("twice");
  });

  /** An empty list renders as a claim; only *something did not look* is true of one. */
  it("refuses a reading with no accounts in it", () => {
    const feed = projectAccountUsage(checkpoint({ kind: "reading", collectedAt: TAKEN_AT, problems: [], accounts: [] }));
    expect(feed.kind).toBe("reading-unreadable");
  });

  /**
   * A section aged by the pass rather than by its own reading is the
   * stale-reading-that-looks-current failure this subsystem exists to refuse, so
   * a section with no `takenAt` is refused rather than borrowing one.
   */
  it("refuses a section that cannot say when it was read", () => {
    const { takenAt: _dropped, ...withoutClock } = section() as AccountUsageSection & { takenAt: string };
    const feed = projectAccountUsage(
      checkpoint({ kind: "reading", collectedAt: TAKEN_AT, problems: [], accounts: [withoutClock] }),
    );
    expect(feed.kind).toBe("reading-unreadable");
    if (feed.kind !== "reading-unreadable") throw new Error("expected reading-unreadable");
    expect(feed.why).toContain("takenAt");
  });

  /** `none` is passed through with its sentence intact; it is not a broken file. */
  it("passes the store's own 'nothing has run' through rather than calling it broken", () => {
    const feed = projectAccountUsage(
      checkpoint({ kind: "none", why: "no per-account usage pass has run in this Overseer yet.", at: WRITTEN_AT }),
    );
    expect(feed).toEqual({
      kind: "no-reading",
      why: "no per-account usage pass has run in this Overseer yet.",
      at: WRITTEN_AT,
    });
  });

  /** Composed into `/api/state`, where a throw ends the refresh loop. Every path returns an arm. */
  it("never throws, whatever it is handed", () => {
    for (const value of [null, undefined, 7, "text", [], { schema: 2 }, { schema: 2, writtenAt: WRITTEN_AT, accountUsage: 7 }]) {
      expect(() => projectAccountUsage(value)).not.toThrow();
    }
  });
});
