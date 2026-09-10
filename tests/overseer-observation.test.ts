/**
 * The Overseer's parser and its admissibility gate, against the real captured
 * snapshots in tests/fixtures/overseer-snapshots/.
 *
 * WHERE A CASE IS CONSTRUCTED IT SAYS SO IN ITS NAME. The capture holds no
 * `unknown` status, no non-null `error`, no empty fleet and one tmux generation
 * throughout, so several of the branches that matter most have no real example.
 * Every constructed case starts from one of those files and edits exactly the
 * field under test, so the envelope around it stays honest.
 */
import { describe, expect, test } from "vitest";

import { fleetState } from "../tools/fleet/state.js";
import { isRepoValue } from "../scripts/gjd-remote-repo.js";
import type { SessionMeta, SessionState } from "../scripts/gjd-remote-tmux.js";
import { admissible } from "../tools/overseer/admissible.js";
import {
  OBSERVATION_SCHEMA,
  parseAttempt,
  parseObservation,
  type JsonValue,
  type ObservedAttemptClock,
  type ObservedStatus,
} from "../tools/overseer/observation.js";
import { EVERY_FIXTURE, editableFixture, freshFixture, freshFrom, rawFixture, rowsOf, type FixtureName } from "./overseer-fixtures.js";
import type { AttentionFeed, OverseerStatusFeed, UsageFeed } from "../tools/fleet/wire.js";

/**
 * No dashboard run retired. `admissible()`'s third argument is required, so a
 * caller that has none says so in as many words — which is true of every test
 * here that is not about retirement.
 */
const NONE_RETIRED: ReadonlySet<string> = new Set();

/**
 * What a caller that did not look at the attention inbox passes.
 *
 * `fleetState`'s attention parameter is required rather than defaulted, so that
 * a production call site cannot lose the reading without the compiler saying
 * so — state.ts says why at the parameter. These tests are about the
 * observation schema and did not look at any checkpoint, which is what this
 * says.
 */
const NOT_ASKED: AttentionFeed = { kind: "not-asked" };

/** The same, for the Overseer's own status — added to the payload without a schema bump. */
const NO_OVERSEER: OverseerStatusFeed = { kind: "not-asked" };

/** And for the account's usage, added the same way and on the same argument. */
const NO_USAGE: UsageFeed = { kind: "not-asked" };

describe("the real captured snapshots", () => {
  test("all ten parse, and carry the fields the register needs", () => {
    expect(EVERY_FIXTURE).toHaveLength(10);
    for (const name of EVERY_FIXTURE) {
      const parsed = parseObservation(rawFixture(name));
      expect(parsed.ok ? null : parsed.reason).toBeNull();
      if (!parsed.ok) continue;
      expect(parsed.value.schema).toBe(OBSERVATION_SCHEMA);
      expect(parsed.value.rows.length).toBe(6);
      expect(parsed.value.tmuxServerPid).toBe(132280);
      expect(parsed.value.clock.collected).toBe(true);
    }
  });

  test("meta survives whole, so a reboot has a directory to resume into", () => {
    const snapshot = freshFixture("status-change-before").snapshot;
    const dirs = snapshot.rows.map((r) => (r.meta.version === 1 ? r.meta.dir : null));
    // The point of the union: every arm that has a dir has a real one, and a
    // legacy arm has none at all rather than an empty string standing in.
    for (const dir of dirs) expect(dir === null || dir.startsWith("/")).toBe(true);
    expect(dirs.filter((d) => d !== null).length).toBeGreaterThan(0);
  });
});

/**
 * THE CONTRACT WE DEPEND ON AND DO NOT OWN.
 *
 * `fleetState()` is the producer's own function, so this is not a mirror of the
 * dashboard's shape written down twice — it is the dashboard's shape, imported.
 * The assignment is a compile-time check and the assertions are a run-time one:
 * either the payload type stops fitting what the parser reads, or the real
 * placeholder stops looking like the placeholder this file rejects.
 */
describe("the dashboard's own payload", () => {
  test("its startup placeholder is exactly what the parser expects to refuse", () => {
    // Its real arguments, not a hand-made object. The day this call stops
    // compiling is the day the contract moved — which is exactly what happened
    // while this stage was being written: `answeringEnabled` was added below,
    // correctly WITHOUT a schema bump, and this line went red within the hour.
    const placeholder = fleetState(null, null, null, 60_000, false, null, NOT_ASKED, NO_OVERSEER, NO_USAGE, { kind: "checkpoint-absent" }, { instance: "1a2b3c4d", publication: 0, inventory: null });
    expect(placeholder.schema).toBe(OBSERVATION_SCHEMA);
    expect(placeholder.collectedAt).toBeNull();
    expect(placeholder.rows).toEqual([]);

    const parsed = parseObservation(JSON.parse(JSON.stringify(placeholder)) as JsonValue);
    expect(parsed.ok).toBe(true);
    // It PARSES and is then REJECTED, which is the split that matters: an empty
    // row list is a well-formed payload, and it is the null clock rather than
    // the empty rows that makes it uninhabitable evidence.
    const verdict = admissible(null, parsed, NONE_RETIRED);
    expect(verdict.verdict).toBe("reject");
    expect(verdict.reason).toContain("never collected");
  });

  test("a snapshot's schema number is still the one this reader was written against", () => {
    // If the dashboard bumps its schema, this goes red before anything silently
    // reads the new shape with the old rules.
    expect(fleetState(null, null, null, 60_000, false, null, NOT_ASKED, NO_OVERSEER, NO_USAGE, { kind: "checkpoint-absent" }, { instance: "1a2b3c4d", publication: 0, inventory: null }).schema).toBe(OBSERVATION_SCHEMA);
  });
});

describe("strict parsing fails the whole snapshot", () => {
  test("CONSTRUCTED: one malformed row takes the other five with it", () => {
    const payload = editableFixture("status-change-before");
    const rows = rowsOf(payload);
    expect(rows).toHaveLength(6);
    delete rows[3]?.["name"];

    const parsed = parseObservation(payload);
    expect(parsed.ok).toBe(false);
    // The index is in the sentence, because "a row was wrong" is not something
    // anybody can act on at three in the morning.
    if (!parsed.ok) expect(parsed.reason).toContain("rows[3].name");
  });

  test("CONSTRUCTED: a 35-of-36 payload is not a thing this parser can produce", () => {
    // The plan's phrasing, made concrete. There is no arm of `ParseResult` that
    // hands back some of the rows, so the only way to lose one is for the
    // producer to omit it — which is a shorter list, not a parse failure, and
    // is why `parseSessions` guards the row count at the source instead.
    const payload = editableFixture("status-change-before");
    const rows = rowsOf(payload);
    const status = rows[2]?.["status"] as Record<string, JsonValue>;
    status["kind"] = "reticulating";

    const parsed = parseObservation(payload);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toContain("no arm for");
    expect(Object.keys(parsed)).not.toContain("value");
  });

  test("CONSTRUCTED: two rows wearing one tmux handle", () => {
    const payload = editableFixture("status-change-before");
    const rows = rowsOf(payload);
    const first = rows[0];
    if (first === undefined) throw new Error("fixture has no rows");
    rows[4] = { ...first };

    const parsed = parseObservation(payload);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toContain("repeats the session handle $1991");
  });

  test("CONSTRUCTED: an id that did not come from tmux", () => {
    const payload = editableFixture("status-change-before");
    const rows = rowsOf(payload);
    const row = rows[0];
    if (row === undefined) throw new Error("fixture has no rows");
    row["id"] = "1991";

    const parsed = parseObservation(payload);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toContain("not a tmux session handle");
  });

  test("CONSTRUCTED: a timestamp that parses but is not what the producer prints", () => {
    for (const bad of ["yesterday", "2026-09-08", "2026-13-45T00:00:00.000Z", 1_757_000_000_000]) {
      const payload = editableFixture("status-change-before");
      payload["collectedAt"] = bad as JsonValue;
      const parsed = parseObservation(payload);
      expect(parsed.ok, `collectedAt ${JSON.stringify(bad)} should not parse`).toBe(false);
    }
  });

  test("CONSTRUCTED: a schema this reader has never read", () => {
    const payload = editableFixture("status-change-before");
    payload["schema"] = 2;
    const parsed = parseObservation(payload);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toContain("only understands 1");
  });

  test("CONSTRUCTED: version 1 metadata with no directory, which is the field nothing can rebuild", () => {
    const payload = editableFixture("status-change-before");
    const rows = rowsOf(payload);
    const meta = rows[0]?.["meta"] as Record<string, JsonValue>;
    meta["dir"] = "";
    const parsed = parseObservation(payload);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toContain("nothing else in the payload can replace it");
  });

  test("CONSTRUCTED: a legacy session is a valid arm, not a damaged one", () => {
    const payload = editableFixture("status-change-before");
    const rows = rowsOf(payload);
    const row = rows[0];
    if (row === undefined) throw new Error("fixture has no rows");
    row["meta"] = { version: "legacy" };

    const parsed = parseObservation(payload);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const meta: SessionMeta | undefined = parsed.value.rows[0]?.meta;
    expect(meta).toEqual({ version: "legacy" });
  });
});

/**
 * The `unknown` arm has NO example in 596 captured rows, so every case here is
 * constructed — and it is the arm most likely to arrive for real, because the
 * trigger is an ordinary Claude Code upgrade adding a status this version has
 * no arm for.
 */
describe("CONSTRUCTED: the unknown status arm, which the real capture never contains", () => {
  function withStatus(status: JsonValue): ReturnType<typeof parseObservation> {
    const payload = editableFixture("status-change-before");
    const rows = rowsOf(payload);
    const row = rows[0];
    if (row === undefined) throw new Error("fixture has no rows");
    row["status"] = status;
    return parseObservation(payload);
  }

  test("a known cause parses, and carries the reported token when there is one", () => {
    const parsed = withStatus({
      kind: "unknown",
      cause: "unrecognised-agent-status",
      why: "Claude Code calls this 'compacting', which this version does not know",
      reportedStatus: "compacting",
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const status: SessionState | undefined = parsed.value.rows[0]?.status;
    expect(status).toEqual({
      kind: "unknown",
      cause: "unrecognised-agent-status",
      why: "Claude Code calls this 'compacting', which this version does not know",
      reportedStatus: "compacting",
    });
  });

  test("the token is absent rather than undefined when the box did not report one", () => {
    const parsed = withStatus({ kind: "unknown", cause: "agents-unavailable", why: "the box could not say" });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    // Absent, not `undefined`: a snapshot read off the wire and the same
    // snapshot read back out of the store must produce the same canonical key,
    // and `JSON.stringify` drops an undefined field.
    expect(Object.hasOwn(parsed.value.rows[0]?.status ?? {}, "reportedStatus")).toBe(false);
  });

  test("a cause this version has no arm for fails the snapshot", () => {
    const parsed = withStatus({ kind: "unknown", cause: "the-box-was-asleep", why: "..." });
    expect(parsed.ok).toBe(false);
  });
});

describe("admissibility", () => {
  test("two polls that returned the same collection: accept, then duplicate", () => {
    const first = freshFixture("duplicate-first");
    const second = parseObservation(rawFixture("duplicate-second"));

    expect(admissible(null, parseObservation(rawFixture("duplicate-first")), NONE_RETIRED).verdict).toBe("accept");
    const verdict = admissible(first, second, NONE_RETIRED);
    // NOT a fault. SSE pushes its cached snapshot on reconnect and the poll runs
    // between collections, so this is the ordinary case — the reason the middle
    // arm exists at all.
    expect(verdict.verdict).toBe("duplicate");
    expect(verdict.reason).toContain(first.snapshot.clock.at);
  });

  test("a collection that advanced is accepted, and carries the snapshot with it", () => {
    const before = freshFixture("status-change-before");
    const verdict = admissible(before, parseObservation(rawFixture("status-change-after")), NONE_RETIRED);
    expect(verdict.verdict).toBe("accept");
    if (verdict.verdict !== "accept") return;
    expect(verdict.snapshot.snapshot.clock.atMs).toBeGreaterThan(before.snapshot.clock.atMs);
  });

  test("a payload that did not parse is rejected here, not thrown at the caller", () => {
    const verdict = admissible(null, parseObservation("not a snapshot"), NONE_RETIRED);
    expect(verdict.verdict).toBe("reject");
    expect(verdict.reason).toContain("not a snapshot");
  });

  test("CONSTRUCTED: a failed refresh is rejected even though its rows look fine", () => {
    // The dashboard leaves the old rows in place, sets `error`, and broadcasts
    // it anyway — so this payload arrives with six perfectly good rows and an
    // old clock. It is the clock rule's near-miss, and the sentence has to say
    // the producer is broken rather than that nothing changed.
    const payload = editableFixture("status-change-after");
    payload["error"] = "could not read this box's tmux sessions: tmux server not found";

    const verdict = admissible(freshFixture("status-change-before"), parseObservation(payload), NONE_RETIRED);
    expect(verdict.verdict).toBe("reject");
    expect(verdict.reason).toContain("tmux server not found");
    expect(rowsOf(payload)).toHaveLength(6);
  });

  test("CONSTRUCTED: an empty fleet with a real clock is accepted, on purpose", () => {
    // There is deliberately no "rows must be non-empty" rule (Sol F5). A drained
    // or freshly rebooted box has nothing running, and refusing that would be
    // refusing the truth at exactly the moment the history is most interesting.
    const payload = editableFixture("status-change-after");
    payload["rows"] = [];
    const verdict = admissible(freshFixture("status-change-before"), parseObservation(payload), NONE_RETIRED);
    expect(verdict.verdict).toBe("accept");
  });

  test("CONSTRUCTED: a clock that went backwards is rejected rather than shrugged at", () => {
    const later = freshFixture("status-change-after");
    const verdict = admissible(later, parseObservation(rawFixture("status-change-before")), NONE_RETIRED);
    // Deliberately not `duplicate`. Equal has an innocent explanation that
    // happens every minute; earlier has none, and calling it a duplicate would
    // stall the history silently for as long as the skew lasted.
    expect(verdict.verdict).toBe("reject");
    expect(verdict.reason).toContain("backwards");
  });

  test("the first snapshot after a cold start needs no predecessor", () => {
    const verdict = admissible(null, parseObservation(rawFixture("session-new-after")), NONE_RETIRED);
    expect(verdict.verdict).toBe("accept");
  });

  test("freshFrom refuses a payload with no collection, so no test can smuggle one into diff()", () => {
    const payload = editableFixture("status-change-before");
    payload["collectedAt"] = null;
    expect(() => freshFrom(payload, "constructed placeholder")).toThrow(/not a collection/);
  });

  /**
   * S2-07. `diff()` takes an `AdmissibleSnapshot`, a type only `admissible()`
   * can mint, so this helper is the only route into a differ that any test has
   * — and it runs every rule. The old `FreshSnapshot` could be built from a
   * parse result with a spread and no cast, which is what made its "only
   * `admissible()` mints one" comment untrue.
   */
  test("freshFrom refuses a payload whose collection failed, for the same reason", () => {
    const payload = editableFixture("status-change-before");
    payload["error"] = "could not read this box's tmux sessions";
    expect(() => freshFrom(payload, "constructed failure")).toThrow(/tmux sessions/);
  });
});

/**
 * S2-02: THE NUMERIC DOMAINS, none of which is "finite".
 *
 * Every case here parsed before 2026-09-08 and every one of them is a payload
 * the producer cannot emit — each number in this envelope comes from a bounded
 * digit string or from arithmetic on `Date.now()`. The first is the one with
 * teeth: an impossible generation reads as a different tmux server, which
 * closes the whole fleet and re-announces it.
 */
describe("CONSTRUCTED: numbers the producer could not have printed", () => {
  function withField(edit: (payload: Record<string, JsonValue>) => void): ReturnType<typeof parseObservation> {
    const payload = editableFixture("status-change-before");
    edit(payload);
    return parseObservation(payload);
  }

  function rowField(field: string, value: JsonValue): ReturnType<typeof parseObservation> {
    return withField((p) => {
      const row = rowsOf(p)[0];
      if (row) row[field] = value;
    });
  }

  test("a fractional tmux generation is not a generation", () => {
    // 132280.5 is finite, so the old check passed it — and `generationRelation`
    // then reads it as a DIFFERENT tmux server from 132280, which is six
    // closures and six arrivals manufactured from a typo.
    const parsed = withField((p) => {
      p["tmuxServerPid"] = 132280.5;
    });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toContain("not a process id");
  });

  test("a generation that is zero, negative or beyond a safe integer is refused too", () => {
    for (const bad of [0, -1, 1e30, Number.MAX_SAFE_INTEGER + 2]) {
      const parsed = withField((p) => {
        p["tmuxServerPid"] = bad;
      });
      expect(parsed.ok, `tmuxServerPid ${bad} should not parse`).toBe(false);
    }
    // Null stays legitimate: it is the producer saying it could not read one.
    expect(
      withField((p) => {
        p["tmuxServerPid"] = null;
      }).ok,
    ).toBe(true);
  });

  test("a pane pid is a pid or nothing", () => {
    for (const bad of [0, -12, 4136799.5]) {
      expect(rowField("panePid", bad).ok, `panePid ${bad} should not parse`).toBe(false);
    }
    expect(rowField("panePid", null).ok).toBe(true);
    expect(rowField("panePid", 4136799).ok).toBe(true);
  });

  test("a refresh interval of zero or less would poison the freshness watchdog S4 depends on", () => {
    // A cadence of zero is a deadline that is always missed; a negative one is
    // a deadline that never is. Neither would say anything about itself, and
    // both would be read as facts about the box.
    for (const bad of [0, -60_000, 60_000.5]) {
      const parsed = withField((p) => {
        p["refreshMs"] = bad;
      });
      expect(parsed.ok, `refreshMs ${bad} should not parse`).toBe(false);
    }
  });

  test("a collection cannot have taken a negative or fractional number of milliseconds", () => {
    for (const bad of [-1, 13414.5]) {
      const parsed = withField((p) => {
        p["tookMs"] = bad;
      });
      expect(parsed.ok, `tookMs ${bad} should not parse`).toBe(false);
    }
    // Zero IS legitimate: `fleetState()` substitutes it when there is no
    // collection to report a duration for.
    expect(
      withField((p) => {
        p["tookMs"] = 0;
      }).ok,
    ).toBe(true);
  });

  test("a countdown is whole seconds and never negative", () => {
    for (const bad of [-1, 899.5]) {
      expect(rowField("status", { kind: "waiting", secondsLeft: bad }).ok, `secondsLeft ${bad}`).toBe(false);
    }
    expect(rowField("status", { kind: "waiting", secondsLeft: 0 }).ok).toBe(true);
  });
});

/**
 * S2-04: the reported status token and its cause travel together.
 *
 * The producer sets the token at exactly one site and that site's cause is
 * `unrecognised-agent-status`. `statusKey` puts the token in the transition
 * key, so a payload that pairs it with any other cause manufactures status
 * transitions out of rows the box could not have produced.
 *
 * The type-level half of this finding cannot be tested here — vitest strips
 * types — so `ObservedUnknownStatus` is enforced by `npm run typecheck` and the
 * assignment below is what would go red.
 */
describe("CONSTRUCTED: reportedStatus on a cause that never carries one", () => {
  function withStatus(status: JsonValue): ReturnType<typeof parseObservation> {
    const payload = editableFixture("status-change-before");
    const row = rowsOf(payload)[0];
    if (row === undefined) throw new Error("fixture has no rows");
    row["status"] = status;
    return parseObservation(payload);
  }

  test("a token on `agents-unavailable` fails the snapshot", () => {
    const parsed = withStatus({
      kind: "unknown",
      cause: "agents-unavailable",
      why: "the box could not say",
      reportedStatus: "a",
    });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toContain("never sets it for");
  });

  test("every other cause refuses it too, and the one that carries it requires it", () => {
    for (const cause of ["not-a-session-id", "running-but-unlisted", "no-status-derived", "client-declared"]) {
      const parsed = withStatus({ kind: "unknown", cause, why: "…", reportedStatus: "compacting" });
      expect(parsed.ok, `${cause} should not carry a reportedStatus`).toBe(false);
    }
    const missing = withStatus({ kind: "unknown", cause: "unrecognised-agent-status", why: "…" });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.reason).toContain("the box saw a status token");
  });

  test("the shape the producer really emits still parses, and keeps its token", () => {
    const parsed = withStatus({
      kind: "unknown",
      cause: "unrecognised-agent-status",
      why: "Claude Code calls this 'compacting', which this version does not know",
      reportedStatus: "compacting",
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const status: ObservedStatus | undefined = parsed.value.rows[0]?.status;
    // The narrowed union is what the parser hands back, and it is assignable to
    // the producer's own type — this line is the compile-time half of S2-04.
    const asProducerType: SessionState | undefined = status;
    expect(asProducerType).toMatchObject({ reportedStatus: "compacting" });
  });
});

/**
 * S2-06: the two fields kept for reboot recovery, held to the producer's own
 * rules.
 *
 * `row.repo` and `row.worktree` are display strings and stay loose — the
 * capture has them as the repo, as null, and as the literal `"unknown"`.
 * `meta.repo` and `meta.dir` are the register, and a value the producer would
 * have refused is one no resumer can act on.
 */
describe("CONSTRUCTED: recovery metadata the producer would not have minted", () => {
  function withMeta(edit: (meta: Record<string, JsonValue>) => void): ReturnType<typeof parseObservation> {
    const payload = editableFixture("status-change-before");
    const meta = rowsOf(payload)[0]?.["meta"] as Record<string, JsonValue>;
    edit(meta);
    return parseObservation(payload);
  }

  test("a relative dir is refused, because a resumer would use whatever directory it is standing in", () => {
    const parsed = withMeta((meta) => {
      meta["dir"] = "relative/path";
    });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toContain("not an absolute path");
  });

  test("a dir longer than the producer's bound is refused", () => {
    expect(
      withMeta((meta) => {
        meta["dir"] = `/${"x".repeat(4096)}`;
      }).ok,
    ).toBe(false);
    expect(
      withMeta((meta) => {
        meta["dir"] = `/${"x".repeat(4094)}`;
      }).ok,
    ).toBe(true);
  });

  test("S2-06A: the parser delegates to the producer's validator rather than agreeing with a copy of it", () => {
    // NOT AN EXAMPLE TEST — a drift detector, and the only kind that can catch
    // this. A copy of `isRepoValue` lived here for a few hours and passed every
    // example anyone thought to write, because it was correct on the day it was
    // written. What it could not do is change when the producer's grammar
    // changes: `isRepoValue` guards `GJD_REPO` at the launcher and the `repo`
    // field of the durable log, so a copy that stopped matching would have the
    // Overseer refusing snapshots the box was right to send — silently, with
    // typecheck green. This asserts the parser's verdict IS the validator's,
    // whatever the validator currently says.
    const values = [
      "spideryarn/reading2",
      "unknown",
      "owner/name",
      "a.b-c_d/e.f-g_h",
      "Not A Slug",
      "OWNER/NAME",
      "a/b/c",
      "../escape",
      "owner/..",
      "owner/.",
      "owner/name/",
      "owner",
      "",
      "/",
      `${"x".repeat(101)}/name`,
      `${"x".repeat(100)}/name`,
    ];
    for (const value of values) {
      const parsed = withMeta((meta) => {
        meta["repo"] = value;
      });
      expect(parsed.ok, `the parser and isRepoValue disagree about ${JSON.stringify(value)}`).toBe(isRepoValue(value));
    }
  });

  test("a repo value that is not a slug is refused, and `unknown` is not one of those", () => {
    for (const bad of ["Not A Slug", "a/b/c", "../escape", "owner/..", "owner/name/", ""]) {
      expect(
        withMeta((meta) => {
          meta["repo"] = bad;
        }).ok,
        `meta.repo ${JSON.stringify(bad)} should not parse`,
      ).toBe(false);
    }
    // The producer's own admission that a session belongs to no repo.
    expect(
      withMeta((meta) => {
        meta["repo"] = "unknown";
      }).ok,
    ).toBe(true);
  });

  test("the row's display repo is NOT held to that rule, because it is not the register", () => {
    // Measured in the capture: `repo` was variously the slug, null, the literal
    // "unknown", and `spideryarn/hellozenno`. Tightening this one would fail
    // whole snapshots over a field nothing recovers from.
    const payload = editableFixture("status-change-before");
    const row = rowsOf(payload)[0];
    if (row === undefined) throw new Error("fixture has no rows");
    row["repo"] = "Some Display Text";
    expect(parseObservation(payload).ok).toBe(true);
  });
});

/**
 * S2-05: two payloads wearing one clock, which is only a duplicate if they say
 * the same thing.
 */
describe("CONSTRUCTED: equal clocks with disagreeing bodies", () => {
  /** The real duplicate's clock, on a body that has been changed. */
  function sameClockAs(first: ReturnType<typeof freshFixture>, edit: (payload: Record<string, JsonValue>) => void) {
    const payload = editableFixture("duplicate-second");
    edit(payload);
    expect(payload["collectedAt"]).toBe(first.snapshot.clock.at);
    return admissible(first, parseObservation(payload), NONE_RETIRED);
  }

  test("the real byte-identical pair is still a duplicate", () => {
    // The case that must not break: SSE pushes its cached snapshot on
    // reconnect while a poll runs between collections, so this is the ordinary
    // event rather than a fault.
    const verdict = sameClockAs(freshFixture("duplicate-first"), () => {});
    expect(verdict.verdict).toBe("duplicate");
  });

  test("a different tmux generation under the same clock is a contract failure, not a repeat", () => {
    const verdict = sameClockAs(freshFixture("duplicate-first"), (p) => {
      p["tmuxServerPid"] = 999_111;
    });
    expect(verdict.verdict).toBe("reject");
    expect(verdict.reason).toContain("same clock");
    // The sentence has to name the inconsistency: "duplicate" was the silence
    // this finding is about, and a reject nobody can act on is the next one.
    expect(verdict.reason).toContain("132280");
    expect(verdict.reason).toContain("999111");
  });

  test("a changed row under the same clock names the row", () => {
    const verdict = sameClockAs(freshFixture("duplicate-first"), (p) => {
      const row = rowsOf(p)[1];
      if (row) row["status"] = { kind: "working" };
    });
    expect(verdict.verdict).toBe("reject");
    expect(verdict.reason).toContain("$1207");
  });

  test("a dropped row under the same clock is caught before any comparison of rows", () => {
    const verdict = sameClockAs(freshFixture("duplicate-first"), (p) => {
      p["rows"] = rowsOf(p).slice(1) as unknown as JsonValue;
    });
    expect(verdict.verdict).toBe("reject");
    expect(verdict.reason).toContain("6 sessions and the other 5");
  });

  test("a changed `health` is STILL a duplicate, because it is not part of the collection", () => {
    // Deliberate, and the one place this rule gives ground. `health` is
    // re-probed on its own and is carried verbatim by this module precisely
    // because it is not interpreted here; rejecting a duplicate over it would
    // stall the history over a field the Overseer has declared it does not
    // read — the same silence, arrived at from the other side.
    const verdict = sameClockAs(freshFixture("duplicate-first"), (p) => {
      p["health"] = { verdict: { level: "calm" } };
    });
    expect(verdict.verdict).toBe("duplicate");
  });
});

/**
 * The attempt clock: when the producer last STARTED a collection.
 *
 * A DIFFERENT FACT FROM `collectedAt`, and the pair is the only thing that can
 * tell **the collector is wedged mid-attempt** from **the dashboard is gone**.
 * It exists because on 2026-09-08 `/api/state` served a `collectedAt` thirty
 * minutes stale with `error: null` and nothing anywhere could say so — see
 * `attemptedAt` in tools/fleet/state.ts.
 *
 * THREE OUTCOMES, AND THE ONE THAT MATTERS IS THE FIRST. Read naively, a
 * producer that does not send the field looks exactly like one that has never
 * attempted a collection, which is exactly what a wedged collector looks like;
 * so "this producer cannot say" has to be a separate answer from "this producer
 * says it has never tried". The daemon's watchdog acts differently on each.
 *
 * IT NEVER FAILS A SNAPSHOT, which is the one place this module's usual rule is
 * suspended on purpose: the field landed as an addition without a schema bump,
 * so every older dashboard omits it, and refusing those would take the Overseer
 * off the air over a field it can do without.
 */
describe("the attempt clock, which is not the collection clock", () => {
  /** A real capture with `attemptedAt` set, or removed entirely. */
  function withAttempt(value: JsonValue | undefined): ReturnType<typeof parseObservation> {
    const payload = editableFixture("status-change-before");
    if (value === undefined) delete payload["attemptedAt"];
    else payload["attemptedAt"] = value;
    return parseObservation(payload);
  }

  function attemptOf(parsed: ReturnType<typeof parseObservation>): ObservedAttemptClock {
    if (!parsed.ok) throw new Error(`the snapshot did not parse: ${parsed.reason}`);
    return parsed.value.attempt;
  }

  test("a timestamp is carried through with its milliseconds", () => {
    // The number is written out rather than computed from the input, so that
    // getting the parse wrong cannot make the expectation wrong with it.
    expect(attemptOf(withAttempt("2026-09-08T02:47:20.000Z"))).toEqual({
      reported: true,
      attempted: true,
      at: "2026-09-08T02:47:20.000Z",
      atMs: 1_788_835_640_000,
    });
  });

  test("MALFORMED IS NOT NEVER-ATTEMPTED, and it is not a reason to fail the snapshot either", () => {
    // The case this whole field exists for, got backwards. A number, or a date
    // string the producer's `toISOString()` could not have printed, used to
    // read as `attemptedAt: null` — a POSITIVE claim that the collector has
    // never started, manufactured out of junk, on a payload full of live rows.
    // The watchdog then has a fact it can act on and the fact is invented.
    // `""` is in the list because the producer's own helper reads a non-empty
    // string and nothing else, so an empty one falls straight through it.
    for (const bad of [17, "", "yesterday", "2026-09-08", "2026-13-45T00:00:00.000Z", true, [], {}] as JsonValue[]) {
      const parsed = withAttempt(bad);
      // The snapshot still stands: the rows are good and this field is not one
      // the history is built from.
      expect(parsed.ok, `attemptedAt ${JSON.stringify(bad)} must not fail the snapshot`).toBe(true);
      const attempt = attemptOf(parsed);
      expect(attempt.reported, `attemptedAt ${JSON.stringify(bad)} should say nothing can be read`).toBe(false);
      if (attempt.reported) throw new Error("expected an unreadable attempt clock");
      expect(attempt.why).toContain("attemptedAt");
    }
  });

  test("a producer that omits the field, on a payload that HAS collected, is an old server and not a wedged one", () => {
    // THE LIVE SPECIMEN: every fixture in the capture is exactly this shape,
    // because `:8787` predated the field. `attemptedAt` is written BEFORE each
    // attempt, so a non-null `collectedAt` with no attempt clock is provably a
    // producer that does not REPORT trying rather than one that never tried.
    const attempt = attemptOf(withAttempt(undefined));
    expect(attempt.reported).toBe(false);
    if (attempt.reported) throw new Error("an old server cannot report an attempt");
    expect(attempt.why).toContain("before that field");
  });

  test("nothing collected and nothing attempted is a positive statement, not an absence", () => {
    // A dashboard that has just started: it tracks attempts and has not made
    // one. Merged upstream with "an old server that has never collected",
    // deliberately — no data has arrived either way and the action is the same.
    for (const value of [null, undefined]) {
      const payload = editableFixture("status-change-before");
      payload["collectedAt"] = null;
      if (value === null) payload["attemptedAt"] = null;
      const parsed = parseObservation(payload);
      expect(parsed.ok).toBe(true);
      expect(attemptOf(parsed)).toEqual({ reported: true, attempted: false });
    }
  });

  test("an explicit null beside a real collection is still the old-server answer, not a claim", () => {
    // `undefined` and `null` are not told apart on purpose — that distinction
    // dies in the first thing that normalises one to the other — so this lands
    // where the omitted field lands, which is "cannot say" rather than "never".
    const payload = editableFixture("status-change-before");
    payload["attemptedAt"] = null;
    expect(attemptOf(parseObservation(payload)).reported).toBe(false);
  });

  test("the payload the producer would really send round-trips through this parser", () => {
    // Its own constructor, not a hand-made object, so the day the wire name
    // changes this line stops compiling rather than going quietly wrong — the
    // same pin the startup placeholder gets above.
    const state = fleetState(null, null, null, 60_000, false, "2026-09-08T02:47:20.000Z", NOT_ASKED, NO_OVERSEER, NO_USAGE, { kind: "checkpoint-absent" }, { instance: "1a2b3c4d", publication: 0, inventory: null });
    expect(state.attemptedAt).toBe("2026-09-08T02:47:20.000Z");
    const payload = JSON.parse(JSON.stringify(state)) as Record<string, JsonValue>;
    expect(parseAttempt(payload)).toEqual({
      reported: true,
      attempted: true,
      at: "2026-09-08T02:47:20.000Z",
      atMs: 1_788_835_640_000,
    });
  });

  test("something that is not a payload at all can still be asked, and says so", () => {
    // The daemon reads the attempt clock off payloads the gate has REFUSED, so
    // this function meets things `parseObservation` would have thrown out.
    for (const junk of ["not an object", null, 3, []] as JsonValue[]) {
      expect(parseAttempt(junk).reported, `${JSON.stringify(junk)} cannot report an attempt`).toBe(false);
    }
  });

  test("the snapshot's field and the standalone reader are the same reading", () => {
    // The daemon depends on this: it reads the clock off the parsed snapshot
    // when the payload parsed and off the raw JSON when it did not, and those
    // two must never be able to disagree about one payload.
    for (const value of [undefined, null, "2026-09-08T02:47:20.000Z", 17, "yesterday"] as (JsonValue | undefined)[]) {
      const payload = editableFixture("status-change-before");
      if (value === undefined) delete payload["attemptedAt"];
      else payload["attemptedAt"] = value;
      const parsed = parseObservation(payload);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) continue;
      expect(parsed.value.attempt).toEqual(parseAttempt(payload));
    }
  });

  test("a schema this reader has not read reports no attempt clock, however plausible its attemptedAt", () => {
    // Sol's finding 1 on the plan. The daemon reads the attempt clock off
    // payloads that failed to parse, and a schema-2 payload fails to parse —
    // so this function is the only thing standing between a producer nobody
    // here has read and the collector condition. The schema is refused before
    // any field is.
    const payload = editableFixture("status-change-before");
    payload["schema"] = 2;
    payload["attemptedAt"] = "2026-09-08T02:47:20.000Z";
    const attempt = parseAttempt(payload);
    expect(attempt.reported).toBe(false);
    if (attempt.reported) throw new Error("an unread schema cannot report an attempt");
    expect(attempt.why).toContain("schema 2");

    // Absent is not 1 either: a bare `{ attemptedAt }` is not a payload of any
    // schema this reader knows.
    expect(parseAttempt({ attemptedAt: "2026-09-08T02:47:20.000Z" }).reported).toBe(false);
  });
});

/**
 * The producer stamp: which run of the dashboard composed a payload, and which
 * collection its rows came from. docs/plans/260910d § Consumer.
 *
 * LIKE `attemptedAt`, IT CANNOT FAIL THE PARSE. A dashboard built before the
 * stamp is an old producer, not a broken one, and a stamp that is present and
 * wrong is a producer defect the daemon reports as a condition — refusing the
 * whole snapshot over it would take the Overseer off the air to punish it.
 */
describe("the producer stamp", () => {
  /** A run id minted for this file. */
  const R1 = "c0ffee01";

  function withProducer(producer: JsonValue | undefined, name: FixtureName = "status-change-before", edits: Record<string, JsonValue> = {}) {
    const payload = { ...editableFixture(name), ...edits };
    if (producer !== undefined) payload["producer"] = producer;
    return parseObservation(payload);
  }

  function orderingOf(parsed: ReturnType<typeof parseObservation>) {
    if (!parsed.ok) throw new Error(`the snapshot did not parse: ${parsed.reason}`);
    return parsed.value.ordering;
  }

  test("a readable stamp is carried through whole", () => {
    expect(orderingOf(withProducer({ instance: R1, publication: 4, inventory: 3 }))).toEqual({
      kind: "stamped",
      instance: R1,
      publication: 4,
      inventory: 3,
    });
    // Never collected: inventory null beside a null clock, which agree.
    expect(orderingOf(withProducer({ instance: R1, publication: 0, inventory: null }, "status-change-before", { collectedAt: null, rows: [] }))).toEqual({
      kind: "stamped",
      instance: R1,
      publication: 0,
      inventory: null,
    });
  });

  test("no producer key at all is the old-producer state, and every captured fixture is one", () => {
    for (const name of EVERY_FIXTURE) {
      expect(orderingOf(parseObservation(rawFixture(name)))).toEqual({ kind: "unstamped" });
    }
  });

  /** Every cause the plan names, each with the field it should name in its sentence. */
  const unreadable: { what: string; producer: JsonValue; edits?: Record<string, JsonValue>; names: string }[] = [
    { what: "null", producer: null, names: "not an object" },
    { what: "a number", producer: 3, names: "not an object" },
    { what: "a bare run id", producer: R1, names: "not an object" },
    { what: "an array", producer: [R1, 1, 1], names: "not an object" },
    { what: "the producer's own 'invalid' sentinel", producer: { instance: "invalid", publication: 1, inventory: 1 }, names: "instance" },
    { what: "an upper-case run id", producer: { instance: "C0FFEE01", publication: 1, inventory: 1 }, names: "instance" },
    { what: "a short run id", producer: { instance: "c0ffee0", publication: 1, inventory: 1 }, names: "instance" },
    { what: "a long run id", producer: { instance: "c0ffee011", publication: 1, inventory: 1 }, names: "instance" },
    { what: "a numeric run id", producer: { instance: 12345678, publication: 1, inventory: 1 }, names: "instance" },
    { what: "no run id", producer: { publication: 1, inventory: 1 }, names: "instance" },
    { what: "a negative publication", producer: { instance: R1, publication: -1, inventory: null }, edits: { collectedAt: null }, names: "publication" },
    { what: "a fractional publication", producer: { instance: R1, publication: 1.5, inventory: 1 }, names: "publication" },
    { what: "a string publication", producer: { instance: R1, publication: "3", inventory: 1 }, names: "publication" },
    { what: "an unsafe publication", producer: { instance: R1, publication: 1e30, inventory: 1 }, names: "publication" },
    { what: "no publication", producer: { instance: R1, inventory: 1 }, names: "publication" },
    { what: "a negative inventory", producer: { instance: R1, publication: 1, inventory: -1 }, names: "inventory" },
    { what: "a fractional inventory", producer: { instance: R1, publication: 3, inventory: 2.5 }, names: "inventory" },
    { what: "no inventory", producer: { instance: R1, publication: 1 }, names: "inventory" },
    { what: "more collections than publications", producer: { instance: R1, publication: 2, inventory: 3 }, names: "inventory" },
    { what: "inventory null beside a real collection", producer: { instance: R1, publication: 2, inventory: null }, names: "collectedAt" },
    {
      what: "an inventory beside a null collection",
      producer: { instance: R1, publication: 2, inventory: 1 },
      edits: { collectedAt: null, rows: [] },
      names: "collectedAt",
    },
  ];

  for (const { what, producer, edits, names } of unreadable) {
    test(`unreadable, and the snapshot still stands: ${what}`, () => {
      const parsed = withProducer(producer, "status-change-before", edits ?? {});
      expect(parsed.ok, `a stamp that is ${what} must not fail the snapshot`).toBe(true);
      const ordering = orderingOf(parsed);
      expect(ordering.kind).toBe("unreadable");
      if (ordering.kind !== "unreadable") return;
      expect(ordering.why).toContain(names);
    });
  }
});

/**
 * `admissible()`'s rules, in the order the plan puts them — and the order is
 * the point: several of these payloads break two rules at once, and the test
 * is which sentence they get.
 */
describe("admissibility with producer stamps", () => {
  const R1 = "c0ffee01";
  const R2 = "5eed1234";

  type Stamp = { instance: string; publication: number; inventory: number | null };

  function stampedJson(name: FixtureName, stamp: Stamp, edits: Record<string, JsonValue> = {}): JsonValue {
    return { ...editableFixture(name), ...edits, producer: stamp } as unknown as JsonValue;
  }

  function plainJson(name: FixtureName, edits: Record<string, JsonValue> = {}): JsonValue {
    return { ...editableFixture(name), ...edits } as unknown as JsonValue;
  }

  const placeholder = (instance: string, edits: Record<string, JsonValue> = {}): JsonValue =>
    stampedJson("status-change-before", { instance, publication: 0, inventory: null }, { collectedAt: null, rows: [], tookMs: 0, ...edits });

  // status-change-before is 02:41:07.661Z; status-change-after is 02:42:21.913Z.
  const EARLIER = "2026-09-08T02:30:00.000Z";

  test("a retired run is refused before its error is read", () => {
    const previous = freshFrom(stampedJson("status-change-before", { instance: R2, publication: 1, inventory: 1 }), "R2");
    const verdict = admissible(
      previous,
      parseObservation(stampedJson("status-change-after", { instance: R1, publication: 9, inventory: 9 }, { error: "tmux server not found" })),
      new Set([R1]),
    );
    expect(verdict.verdict).toBe("reject");
    expect(verdict.reason).toContain("replaced");
    expect(verdict.reason).toContain(R1);
    expect(verdict.reason).not.toContain("tmux server not found");
  });

  test("a lower collection in the same run is out of order, before its error is read", () => {
    const previous = freshFrom(stampedJson("status-change-before", { instance: R1, publication: 4, inventory: 3 }), "R1 at 3");
    const verdict = admissible(
      previous,
      parseObservation(stampedJson("status-change-after", { instance: R1, publication: 3, inventory: 2 }, { error: "tmux server not found" })),
      NONE_RETIRED,
    );
    expect(verdict.verdict).toBe("reject");
    expect(verdict.reason).toContain("out of order");
    expect(verdict.reason).not.toContain("last collection failed");
  });

  test("a publication from before the run's first collection, arriving after one, is out of order too", () => {
    // Within one run the inventory never goes back to null, so this is an old
    // publication delivered late — the same fact as a lower ordinal.
    const previous = freshFrom(stampedJson("status-change-before", { instance: R1, publication: 4, inventory: 3 }), "R1 at 3");
    const verdict = admissible(previous, parseObservation(placeholder(R1)), NONE_RETIRED);
    expect(verdict.verdict).toBe("reject");
    expect(verdict.reason).toContain("out of order");
  });

  test("an error still comes before never-collected, as it did", () => {
    const previous = freshFrom(stampedJson("status-change-before", { instance: R1, publication: 4, inventory: 3 }), "R1 at 3");
    const verdict = admissible(previous, parseObservation(placeholder(R2, { error: "tmux server not found" })), NONE_RETIRED);
    expect(verdict.verdict).toBe("reject");
    expect(verdict.reason).toContain("last collection failed");
  });

  test("never collected in a new run says the run is new, because a restart is not a fault", () => {
    const previous = freshFrom(stampedJson("status-change-before", { instance: R1, publication: 4, inventory: 3 }), "R1 at 3");
    const verdict = admissible(previous, parseObservation(placeholder(R2)), NONE_RETIRED);
    expect(verdict.verdict).toBe("reject");
    expect(verdict.reason).toContain("new dashboard run");
    expect(verdict.reason).toContain(R2);
  });

  test("the same run and collection is a duplicate whatever servedAt, health or publication say", () => {
    const previous = freshFrom(stampedJson("status-change-before", { instance: R1, publication: 3, inventory: 2 }), "R1 at 2");
    const verdict = admissible(
      previous,
      parseObservation(
        stampedJson("status-change-before", { instance: R1, publication: 9, inventory: 2 }, {
          servedAt: "2026-09-08T02:45:00.000Z",
          health: { verdict: { level: "calm" } },
        }),
      ),
      NONE_RETIRED,
    );
    expect(verdict.verdict).toBe("duplicate");
  });

  test("one collection wearing two clocks is a contract failure, and the sentence names both", () => {
    const previous = freshFrom(stampedJson("status-change-before", { instance: R1, publication: 3, inventory: 2 }), "R1 at 2");
    const verdict = admissible(
      previous,
      parseObservation(stampedJson("status-change-before", { instance: R1, publication: 4, inventory: 2 }, { collectedAt: "2026-09-08T02:44:00.000Z" })),
      NONE_RETIRED,
    );
    expect(verdict.verdict).toBe("reject");
    expect(verdict.reason).toContain("contract failure");
    expect(verdict.reason).toContain("2026-09-08T02:41:07.661Z");
    expect(verdict.reason).toContain("2026-09-08T02:44:00.000Z");
  });

  test("one collection with a different row is a contract failure too", () => {
    const previous = freshFrom(stampedJson("status-change-before", { instance: R1, publication: 3, inventory: 2 }), "R1 at 2");
    const changed = stampedJson("status-change-before", { instance: R1, publication: 3, inventory: 2 });
    const row = rowsOf(changed as Record<string, JsonValue>)[1];
    if (row) row["status"] = { kind: "working" };
    const verdict = admissible(previous, parseObservation(changed), NONE_RETIRED);
    expect(verdict.verdict).toBe("reject");
    expect(verdict.reason).toContain("$1643");
  });

  test("a newer collection in the same run is accepted with an earlier clock", () => {
    const previous = freshFrom(stampedJson("status-change-after", { instance: R1, publication: 3, inventory: 2 }), "R1 at 2");
    const verdict = admissible(
      previous,
      parseObservation(stampedJson("status-change-before", { instance: R1, publication: 4, inventory: 3 }, { collectedAt: EARLIER })),
      NONE_RETIRED,
    );
    expect(verdict.verdict).toBe("accept");
  });

  test("a new run is accepted with an earlier clock", () => {
    const previous = freshFrom(stampedJson("status-change-after", { instance: R1, publication: 3, inventory: 2 }), "R1 at 2");
    const verdict = admissible(
      previous,
      parseObservation(stampedJson("status-change-before", { instance: R2, publication: 1, inventory: 1 }, { collectedAt: EARLIER })),
      NONE_RETIRED,
    );
    expect(verdict.verdict).toBe("accept");
  });

  test("retirement is only consulted when both sides are stamped", () => {
    // After an unstamped predecessor the clock rules apply, exactly as
    // yesterday — including to a run this daemon once retired.
    const unstampedPrevious = freshFrom(plainJson("status-change-before"), "unstamped");
    const later = stampedJson("status-change-after", { instance: R1, publication: 5, inventory: 5 });
    expect(admissible(unstampedPrevious, parseObservation(later), new Set([R1])).verdict).toBe("accept");
  });

  test("stamped after unstamped orders by the clock", () => {
    const previous = freshFrom(plainJson("status-change-after"), "unstamped");
    const verdict = admissible(
      previous,
      parseObservation(stampedJson("status-change-before", { instance: R1, publication: 1, inventory: 1 })),
      NONE_RETIRED,
    );
    expect(verdict.verdict).toBe("reject");
    expect(verdict.reason).toContain("went backwards");
  });

  test("unstamped after stamped orders by the clock", () => {
    const previous = freshFrom(stampedJson("status-change-after", { instance: R1, publication: 1, inventory: 1 }), "R1");
    const verdict = admissible(previous, parseObservation(plainJson("status-change-before")), NONE_RETIRED);
    expect(verdict.verdict).toBe("reject");
    expect(verdict.reason).toContain("went backwards");
  });

  test("an unreadable stamp on either side orders by the clock", () => {
    const bad = { instance: "invalid", publication: 1, inventory: 1 };
    const unreadablePrevious = freshFrom(stampedJson("status-change-after", bad), "unreadable");
    expect(
      admissible(
        unreadablePrevious,
        parseObservation(stampedJson("status-change-before", { instance: R1, publication: 2, inventory: 2 })),
        NONE_RETIRED,
      ).reason,
    ).toContain("went backwards");
    const stampedPrevious = freshFrom(stampedJson("status-change-after", { instance: R1, publication: 1, inventory: 1 }), "R1");
    expect(admissible(stampedPrevious, parseObservation(stampedJson("status-change-before", bad)), NONE_RETIRED).reason).toContain(
      "went backwards",
    );
  });
});
