/**
 * **CAN THIS ACCOUNT AFFORD MORE WORK?** — the fleet's projection of the usage
 * report out of the Overseer's checkpoint, and the grouping that is this
 * stage's acceptance line.
 *
 * ## The fixture is shaped like the real file, and that is load-bearing
 *
 * `CHECKPOINT` below was built by reading `~/.overseer/current.json` on
 * 2026-09-08 and then replacing the identifiers. Two details of it are
 * deliberately awkward and both were found that way rather than imagined:
 *
 *  - **`resets_at` is `…313670+00:00`** — microsecond precision and a numeric
 *    offset, which is what `~/.claude.json` writes and is NOT what
 *    `toISOString()` emits. A strict round-trip check on that field failed
 *    every cached window, which failed the cache, which degraded the whole
 *    report to *no usage pass has run*. A page confidently reporting an absence
 *    off a file that was fine — docs/reusable/silent-success.md, and the reason
 *    `instant()` exists.
 *  - **Windows with no `resets_at` at all** (`nimbus_quill`, `spend`) and one
 *    whose entry is `false`. All three are in the live file. They arrive as
 *    `unknown` with a sentence, never as zero.
 *
 * ## What is being asserted, and what is deliberately not
 *
 * The reading RULES are `tools/overseer/usage.ts`'s and are tested there. What
 * is tested here is the boundary: that a checkpoint on disk becomes something a
 * page can draw, that every way of having nothing to say survives as its own
 * sentence, and that thirty rejections in one window become one incident.
 */
import { describe, expect, it } from "vitest";

import { groupUsageIncidents, projectUsage } from "../tools/fleet/usage-feed.js";
import type { UsageFeed } from "../tools/fleet/wire.js";

const WRITTEN_AT = "2026-09-08T18:42:00.000Z";

/** One rejection, in the shape `tools/overseer/usage.ts` writes them. */
function hit(over: Partial<Parameters<typeof groupUsageIncidents>[0][number]> = {}) {
  return {
    window: "five_hour",
    resetsAtMs: Date.parse("2026-09-08T06:30:00.000Z"),
    hitAtMs: Date.parse("2026-09-08T06:23:02.314Z"),
    /* **NOT A UUID COPIED OUT OF A REAL TRANSCRIPT**, which is how this landed
       the first time. `tests/fixture-ids.test.ts` refuses a uuid claimed by two
       test files — vitest runs files in parallel against one database, so
       whichever tears down first deletes the other's fixture — and the one I
       had lifted off the live box was already `overseer-harness.test.ts`'s.
       Neither file inserts a row, but the guard is deliberately blind to that
       and it is cheaper to be unique than to argue. */
    claudeSessionId: "u5a9e1c7-0000-4000-8000-usagefeed0001",
    ...over,
  };
}

/** A whole checkpoint, with `usage` swappable. Everything else is what schema 2 requires. */
function checkpoint(usage: unknown, over: Record<string, unknown> = {}): unknown {
  return { schema: 2, writtenAt: WRITTEN_AT, usage, ...over };
}

/**
 * **A CONCLUSIVE SCAN** — every count consistent, nothing unreadable, nothing
 * truncated, and a window long enough that a seven-day rejection could not hide
 * outside it.
 *
 * It has to be, and finding that out was itself the point: the first version of
 * this fixture had `transcriptsUnreadable: 3`, and once the projection started
 * checking `absenceGapReason` it correctly refused to report `none` off it —
 * any one of those three could hold the rejection that is in force. The
 * producer would never have emitted that pair either. An unsupportable coverage
 * now has its own test rather than sitting unnoticed inside the happy path.
 */
const COVERAGE = {
  transcriptsFound: 240,
  transcriptsSelected: 240,
  transcriptsOpened: 240,
  transcriptsUnreadable: 0,
  unreadableWhy: [],
  linesScanned: 232961,
  candidateLines: 27,
  linesParsed: 27,
  malformedCandidates: 0,
  quotaLimitsWithoutErrorSignal: 0,
  truncatedByLimit: false,
  sinceMs: 691_200_000,
  tookMs: 41_233,
};

/** A complete report, as the real one is shaped. Fields are overridden per test. */
function report(over: Record<string, unknown> = {}): unknown {
  return {
    kind: "report",
    report: {
      account: {
        kind: "value",
        email: "greg@example.test",
        orgId: "org-1111",
        orgName: "An organisation",
        subscriptionType: "max",
        accountUuid: "acct-1111",
        rateLimitTier: "default_claude_max_20x",
      },
      cache: {
        kind: "value",
        accountUuid: "acct-1111",
        fetchedAtMs: Date.parse("2026-09-08T18:26:16.432Z"),
        ageMs: 943_568,
        windows: [
          {
            kind: "value",
            window: "five_hour",
            /* THE AWKWARD ONE. Verbatim shape from ~/.claude.json. */
            utilizationPercent: 8,
            resetsAt: "2026-09-09T02:50:00.313670+00:00",
            resetsAtMs: Date.parse("2026-09-09T02:50:00.313Z"),
            msUntilReset: 13_946_303,
          },
          {
            kind: "unknown",
            window: "nimbus_quill",
            why: "no resets_at, so the utilization (0) cannot be checked for validity",
          },
        ],
      },
      rateLimits: { kind: "none", coverage: COVERAGE },
      verdict: { level: "ok", reasons: ["no rejection in the scanned window, and the cache is under 20%"], activeLimit: null },
      collectedAt: "2026-09-08T18:41:30.000Z",
      tookMs: 41_400,
      ...over,
    },
  };
}

/** The `published` arm or a failure that says which arm it got instead. */
function published(feed: UsageFeed) {
  if (feed.kind !== "published") throw new Error(`expected a published reading, got ${feed.kind}: ${JSON.stringify(feed)}`);
  return feed.summary;
}

describe("projectUsage — the whole reading", () => {
  it("reads a real-shaped report end to end", () => {
    const summary = published(projectUsage(checkpoint(report())));
    expect(summary.collectedAt).toBe("2026-09-08T18:41:30.000Z");
    expect(summary.level).toBe("ok");
    expect(summary.account).toMatchObject({ kind: "value", email: "greg@example.test", subscriptionType: "max" });
    expect(summary.dueBackAt).toBeNull();
    expect(summary.limits.kind).toBe("none");
    /* THE POSITIVE CONTROL CROSSES WHOLE. Every number of it, because a `none`
       with a partial coverage under it is the unfalsifiable zero again. */
    expect(summary.limits.coverage).toEqual(COVERAGE);
  });

  it("normalises Anthropic's own timestamp format rather than voiding the cache", () => {
    /* THE BUG THIS FILE'S HEADER IS ABOUT. `2026-09-09T02:50:00.313670+00:00`
       is not `toISOString()` form; a strict round-trip check rejected it, which
       rejected the window, the cache and then the whole report. */
    const summary = published(projectUsage(checkpoint(report())));
    expect(summary.cache).toMatchObject({ kind: "attributed" });
    if (summary.cache.kind !== "attributed") throw new Error("the cache should have been readable");
    expect(summary.cache.windows[0]).toEqual({
      kind: "value",
      window: "five_hour",
      utilizationPercent: 8,
      resetsAt: "2026-09-09T02:50:00.313Z",
    });
    /* A window with no reset instant is `unknown` WITH A SENTENCE, never zero. */
    expect(summary.cache.windows[1]).toMatchObject({ kind: "unknown", window: "nimbus_quill" });
  });

  it("carries no percentage at all on an expired window", () => {
    const feed = projectUsage(
      checkpoint(
        report({
          cache: {
            kind: "value",
            accountUuid: "acct-1111",
            fetchedAtMs: Date.parse("2026-09-08T18:26:16.432Z"),
            windows: [
              {
                kind: "expired",
                window: "five_hour",
                resetsAt: "2026-09-08T18:00:00.000+00:00",
                resetsAtMs: Date.parse("2026-09-08T18:00:00.000Z"),
                msSinceReset: 1_620_000,
                why: "the cached 70% describes a window that reset 27 minutes before this reading",
              },
            ],
          },
        }),
      ),
    );
    const cache = published(feed).cache;
    if (cache.kind !== "attributed") throw new Error("the cache should have been readable");
    const window = cache.windows[0];
    expect(window).toEqual({
      kind: "expired",
      window: "five_hour",
      resetsAt: "2026-09-08T18:00:00.000Z",
      why: "the cached 70% describes a window that reset 27 minutes before this reading",
    });
    /* THE ASSERTION THAT MATTERS: there is no numeric field for a renderer to
       find. The stale number survives only inside the prose. */
    expect(Object.keys(window ?? {})).not.toContain("utilizationPercent");
    expect(JSON.stringify(window)).toContain("70%");
  });

  it("keeps `limited` and the instant work can resume", () => {
    const summary = published(
      projectUsage(
        checkpoint(
          report({
            rateLimits: { kind: "hits", hits: [hit()], coverage: COVERAGE },
            verdict: {
              level: "limited",
              reasons: ["a five_hour rejection at 06:23 has not yet reset"],
              activeLimit: { ...hit(), id: "abc", hitAt: "2026-09-08T06:23:02.314Z", status: "rejected", transcriptPath: "/x", message: "…" },
            },
          }),
        ),
      ),
    );
    expect(summary.level).toBe("limited");
    expect(summary.dueBackAt).toBe("2026-09-08T06:30:00.000Z");
  });

  it("records the account it belongs to, and its absence", () => {
    const loggedOut = published(
      projectUsage(checkpoint(report({ account: { kind: "logged-out", projectsDirectory: "/home/greg/.claude/projects" } }))),
    );
    /* NOT A FAILURE — the one arm on this card a person can act on. */
    expect(loggedOut.account).toEqual({ kind: "logged-out", projectsDirectory: "/home/greg/.claude/projects" });

    const unknown = published(projectUsage(checkpoint(report({ account: { kind: "unknown", why: "`claude auth status` exited 1" } }))));
    expect(unknown.account).toEqual({ kind: "unknown", why: "`claude auth status` exited 1" });
  });

  it("refuses to carry another account's percentages after a /login swap", () => {
    /* **THE P0 OF 2026-09-09.** `~/.claude.json` holds whichever account was
       logged in when it was written, so after a swap it can carry the previous
       subscription's numbers. The projection used to carry both uuids and
       compare neither, so the card could name account B in its heading and draw
       account A's 96% underneath it. `attributeCache` in tools/overseer/usage.ts
       is the rule; these are its clauses over the same fields. */
    const summary = published(
      projectUsage(
        checkpoint(
          report({
            cache: {
              kind: "value",
              accountUuid: "acct-2222",
              fetchedAtMs: Date.parse("2026-09-08T18:26:16.432Z"),
              windows: [
                {
                  kind: "value",
                  window: "five_hour",
                  utilizationPercent: 96,
                  resetsAt: "2026-09-09T02:50:00.313670+00:00",
                  resetsAtMs: Date.parse("2026-09-09T02:50:00.313Z"),
                },
              ],
            },
          }),
        ),
      ),
    );
    expect(summary.cache.kind).toBe("unattributed");
    if (summary.cache.kind !== "unattributed") throw new Error("unreachable");
    /* BOTH IDS IN THE SENTENCE, so a reader can see what happened — and NOT a
       single percentage anywhere in the arm, which is the structural half: a
       renderer handed a numeric field will eventually render it. */
    expect(summary.cache.why).toContain("acct-2222");
    expect(summary.cache.why).toContain("acct-1111");
    expect(JSON.stringify(summary.cache)).not.toContain("96");
    expect(Object.keys(summary.cache)).not.toContain("windows");
  });

  it("refuses attribution when either side has no account id at all", () => {
    /* "NOT PROVEN TO BE SOMEBODY ELSE'S" IS NOT "PROVEN TO BE OURS" —
       `attributeCache`'s own words, and its clauses are positive for exactly
       this reason. Every one of these used to render percentages. */
    const noCacheUuid = published(
      projectUsage(checkpoint(report({ cache: { kind: "value", fetchedAtMs: 1, accountUuid: null, windows: [] } }))),
    );
    expect(noCacheUuid.cache.kind).toBe("unattributed");

    const noAccountUuid = published(
      projectUsage(
        checkpoint(report({ account: { kind: "value", email: "greg@example.test", accountUuid: null }, cache: { kind: "value", fetchedAtMs: 1, accountUuid: "acct-1111", windows: [] } })),
      ),
    );
    expect(noAccountUuid.cache.kind).toBe("unattributed");

    const loggedOut = published(
      projectUsage(
        checkpoint(report({ account: { kind: "logged-out", projectsDirectory: "/x" }, cache: { kind: "value", fetchedAtMs: 1, accountUuid: "acct-1111", windows: [] } })),
      ),
    );
    expect(loggedOut.cache.kind).toBe("unattributed");

    const unreadableAccount = published(
      projectUsage(
        checkpoint(report({ account: { kind: "unknown", why: "`claude auth status` exited 1" }, cache: { kind: "value", fetchedAtMs: 1, accountUuid: "acct-1111", windows: [] } })),
      ),
    );
    expect(unreadableAccount.cache.kind).toBe("unattributed");
  });

  it("refuses a `none` whose own coverage cannot support an absence", () => {
    /* THE ZERO-MEANS-WE-DID-NOT-LOOK FAILURE, arriving through the one door the
       positive control was built to shut: every coverage field present, and the
       counts all zero. `summariseRateLimitScan` will not emit this; a corrupt
       or hand-edited checkpoint can. */
    const empty = { ...COVERAGE, transcriptsOpened: 0, transcriptsSelected: 0, transcriptsFound: 0, linesScanned: 0, transcriptsUnreadable: 0, unreadableWhy: [], candidateLines: 0, linesParsed: 0 };
    const summary = published(projectUsage(checkpoint(report({ rateLimits: { kind: "none", coverage: empty } }))));
    expect(summary.limits.kind).toBe("unknown");
    if (summary.limits.kind !== "unknown") throw new Error("unreachable");
    expect(summary.limits.why).toContain("no transcript was opened");

    /* A TRUNCATED SCAN'S SILENCE IS PARTIAL BY CONSTRUCTION, and so is one
       bounded to less than the longest window a rejection can live in. */
    const truncated = { ...COVERAGE, truncatedByLimit: true };
    expect(published(projectUsage(checkpoint(report({ rateLimits: { kind: "none", coverage: truncated } })))).limits.kind).toBe("unknown");
    const shortWindow = { ...COVERAGE, sinceMs: 86_400_000 };
    expect(published(projectUsage(checkpoint(report({ rateLimits: { kind: "none", coverage: shortWindow } })))).limits.kind).toBe("unknown");
    /* ANY ONE OF THE UNREADABLE ONES COULD HOLD THE REJECTION THAT IS IN FORCE. */
    const unreadable = { ...COVERAGE, transcriptsUnreadable: 3, unreadableWhy: ["x.jsonl vanished between listing and reading"] };
    expect(published(projectUsage(checkpoint(report({ rateLimits: { kind: "none", coverage: unreadable } })))).limits.kind).toBe("unknown");
    /* AND THE SAME COVERAGE UNDER A `hits` ARM IS UNTOUCHED: the gate is about
       whether a SILENCE can be believed, not about whether a scan was tidy. */
    expect(
      published(projectUsage(checkpoint(report({ rateLimits: { kind: "hits", hits: [hit()], coverage: unreadable } })))).limits.kind,
    ).toBe("incidents");
  });

  it("does not throw on an epoch outside the range Date can express", () => {
    /* `Number.isFinite(1e100)` is true and `new Date(1e100).toISOString()`
       throws. This module's whole contract is that it does not throw: in
       /api/state that escape ends the refresh loop, and in `overseer status` it
       takes the page down. GPT Sol's P0(2), 2026-09-09. */
    for (const broken of [
      report({ cache: { kind: "value", accountUuid: "acct-1111", fetchedAtMs: 1e100, windows: [] } }),
      report({ verdict: { level: "limited", reasons: ["x"], activeLimit: { resetsAtMs: 1e100 } } }),
      report({ rateLimits: { kind: "hits", hits: [{ window: "five_hour", resetsAtMs: 1e100 }], coverage: COVERAGE } }),
      report({ rateLimits: { kind: "hits", hits: [{ window: "five_hour", resetsAtMs: 1, hitAtMs: 1e100, claudeSessionId: "a" }], coverage: COVERAGE } }),
    ]) {
      expect(() => projectUsage(checkpoint(broken))).not.toThrow();
    }
    /* And the grouper directly, which `scripts/overseer.ts` calls with no
       containment around it at all. */
    expect(() => groupUsageIncidents([{ window: "five_hour", resetsAtMs: 1e100, hitAtMs: null, claudeSessionId: null }])).not.toThrow();
    expect(groupUsageIncidents([{ window: "five_hour", resetsAtMs: 1e100, hitAtMs: null, claudeSessionId: null }])).toEqual([]);
  });
});

describe("projectUsage — every way of having nothing to say", () => {
  it("passes `no usage pass has run` through with its own sentence", () => {
    const feed = projectUsage(
      checkpoint({ kind: "none", why: "no usage pass has run in this Overseer yet", at: WRITTEN_AT }),
    );
    /* NOT `checkpoint-unreadable`. The file is fine; the daemon has not looked.
       Reading it as broken sends somebody to inspect a healthy file. */
    expect(feed).toEqual({ kind: "no-report", why: "no usage pass has run in this Overseer yet", at: WRITTEN_AT });
  });

  it("treats a checkpoint that predates the field as no report, not as no limits", () => {
    const feed = projectUsage({ schema: 2, writtenAt: WRITTEN_AT });
    expect(feed.kind).toBe("no-report");
    if (feed.kind !== "no-report") throw new Error("unreachable");
    expect(feed.why).toContain("written before the Overseer had one");
  });

  it("refuses a schema it does not know, naming both versions", () => {
    expect(projectUsage(checkpoint(report(), { schema: 3 }))).toEqual({ kind: "unsupported-schema", saw: "3", known: 2 });
  });

  it("refuses a checkpoint with no readable write time", () => {
    const feed = projectUsage({ schema: 2, writtenAt: "some time yesterday", usage: report() });
    expect(feed.kind).toBe("checkpoint-unreadable");
  });

  it("degrades a malformed report to `report-unreadable`, not to `no report`", () => {
    /* **THEY ARE TWO ARMS BECAUSE THE PAGE SAYS TWO DIFFERENT THINGS.**
       `no-report`'s sentence ends "nothing is wrong with the file", which is
       false for every case below and sends a reader away from the thing that is
       wrong. GPT Sol's P1(3), 2026-09-09. */
    for (const broken of [
      report({ collectedAt: undefined }),
      report({ account: { kind: "value-ish" } }),
      report({ verdict: { level: "nearly", reasons: [], activeLimit: null } }),
      report({ verdict: { level: "ok", reasons: ["ok", ""], activeLimit: null } }),
      report({ rateLimits: { kind: "none" } }),
      report({ cache: { kind: "value", fetchedAtMs: "recently", windows: [] } }),
      { kind: "report", report: "a report" },
      { kind: "something-new" },
    ]) {
      const feed = projectUsage(checkpoint(broken));
      expect(feed.kind, JSON.stringify(broken).slice(0, 120)).toBe("report-unreadable");
    }
    /* And the two that really are *no report*, which must NOT land there. */
    expect(projectUsage(checkpoint(undefined)).kind).toBe("no-report");
    expect(projectUsage(checkpoint({ kind: "none", why: "no pass yet", at: WRITTEN_AT })).kind).toBe("no-report");
  });

  it("refuses a coverage with a field missing, because a partial positive control is not one", () => {
    const { linesScanned: _dropped, ...partial } = COVERAGE;
    const feed = projectUsage(checkpoint(report({ rateLimits: { kind: "none", coverage: partial } })));
    expect(feed.kind).toBe("report-unreadable");
    if (feed.kind !== "report-unreadable") throw new Error("unreachable");
    /* THE SENTENCE IS THE POINT: it says why an absence with no size on it is
       refused, rather than reporting a calm account. */
    expect(feed.why).toContain("cannot be told from a scan that opened nothing");
  });

  it("refuses a `hits` arm that carries no readable hit", () => {
    const feed = projectUsage(checkpoint(report({ rateLimits: { kind: "hits", hits: [{ window: "five_hour" }], coverage: COVERAGE } })));
    expect(feed.kind).toBe("report-unreadable");
  });
});

describe("groupUsageIncidents — thirty sessions, one window, one incident", () => {
  it("collapses many rejections in one window into one incident", () => {
    /* THE ACCEPTANCE LINE. Thirty conversations, three rejections each — what
       a filled five-hour window on a busy box actually produces. */
    const hits = [];
    for (let session = 0; session < 30; session += 1) {
      for (let retry = 0; retry < 3; retry += 1) {
        hits.push(
          hit({
            claudeSessionId: `conversation-${session}`,
            hitAtMs: Date.parse("2026-09-08T06:00:00.000Z") + session * 1000 + retry * 60_000,
          }),
        );
      }
    }
    const incidents = groupUsageIncidents(hits);
    expect(incidents).toHaveLength(1);
    expect(incidents[0]).toMatchObject({
      id: "five_hour@2026-09-08T06:30:00.000Z",
      window: "five_hour",
      resetsAt: "2026-09-08T06:30:00.000Z",
      rejections: 90,
      unidentifiedRejections: 0,
      firstHitAt: "2026-09-08T06:00:00.000Z",
      lastHitAt: "2026-09-08T06:02:29.000Z",
    });
    expect(incidents[0]?.conversations).toHaveLength(30);
  });

  it("keeps overlapping limits apart, latest reset first", () => {
    /* Two windows in force at once — a five-hour that clears this evening and a
       seven-day that does not. The one that frees up LAST is the one that
       decides when work can resume, so it sorts first: the same rule
       `UsageVerdict.activeLimit` follows. */
    const incidents = groupUsageIncidents([
      hit({ window: "five_hour", resetsAtMs: Date.parse("2026-09-08T21:00:00.000Z") }),
      hit({ window: "seven_day", resetsAtMs: Date.parse("2026-09-14T05:00:00.000Z") }),
      hit({ window: "five_hour", resetsAtMs: Date.parse("2026-09-08T21:00:00.000Z"), claudeSessionId: "another" }),
    ]);
    expect(incidents.map((i) => [i.window, i.rejections, i.conversations.length])).toEqual([
      ["seven_day", 1, 1],
      ["five_hour", 2, 2],
    ]);
  });

  it("keeps two resets of the SAME window apart", () => {
    /* A post-reset old 429 is history, and history from this morning's window
       must not be folded into this evening's. Same name, different event. */
    const incidents = groupUsageIncidents([
      hit({ resetsAtMs: Date.parse("2026-09-08T06:30:00.000Z") }),
      hit({ resetsAtMs: Date.parse("2026-09-08T21:00:00.000Z") }),
    ]);
    expect(incidents.map((i) => i.resetsAt)).toEqual(["2026-09-08T21:00:00.000Z", "2026-09-08T06:30:00.000Z"]);
  });

  it("counts a rejection with no conversation id rather than inventing or dropping one", () => {
    const incidents = groupUsageIncidents([
      hit({ claudeSessionId: "known" }),
      hit({ claudeSessionId: null }),
      hit({ claudeSessionId: null }),
    ]);
    expect(incidents[0]).toMatchObject({ rejections: 3, unidentifiedRejections: 2 });
    /* Neither inflated to three sessions nor quietly reduced to one rejection. */
    expect(incidents[0]?.conversations).toEqual(["known"]);
  });

  it("survives a rejection with no timestamp of its own", () => {
    const incidents = groupUsageIncidents([hit({ hitAtMs: null })]);
    expect(incidents[0]).toMatchObject({ rejections: 1, firstHitAt: null, lastHitAt: null });
  });

  it("mints the map key and the id from the same canonical instant", () => {
    /* Grouping on the raw millisecond while minting the id from `toISOString()`
       — which clips to whole milliseconds — put these two in separate groups
       wearing ONE id: two rows, one React key. GPT Sol's P2(1), 2026-09-09. */
    const incidents = groupUsageIncidents([hit({ resetsAtMs: 1000.1 }), hit({ resetsAtMs: 1000.9 })]);
    expect(incidents).toHaveLength(1);
    expect(new Set(incidents.map((i) => i.id)).size).toBe(incidents.length);
    expect(incidents[0]).toMatchObject({ rejections: 2, resetsAt: "1970-01-01T00:00:01.000Z" });
  });

  it("gives one incident one id across two passes", () => {
    /* Stable, never minted per render: it is a React key and the thing that
       makes "the same incident" sayable between two readings. */
    const first = groupUsageIncidents([hit()]);
    const second = groupUsageIncidents([hit({ claudeSessionId: "somebody-else" }), hit()]);
    expect(first[0]?.id).toBe(second[0]?.id);
  });

  it("has nothing to say about no rejections", () => {
    expect(groupUsageIncidents([])).toEqual([]);
  });
});
