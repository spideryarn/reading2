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
import type { SessionMeta, SessionState } from "../scripts/gjd-remote-tmux.js";
import { admissible } from "../tools/overseer/admissible.js";
import { OBSERVATION_SCHEMA, parseObservation, type JsonValue } from "../tools/overseer/observation.js";
import { EVERY_FIXTURE, editableFixture, freshFixture, freshFrom, rawFixture, rowsOf } from "./overseer-fixtures.js";

describe("the real captured snapshots", () => {
  test("all eight parse, and carry the fields the register needs", () => {
    expect(EVERY_FIXTURE).toHaveLength(8);
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
    const snapshot = freshFixture("status-change-before");
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
    const placeholder = fleetState(null, null, null, 60_000, false);
    expect(placeholder.schema).toBe(OBSERVATION_SCHEMA);
    expect(placeholder.collectedAt).toBeNull();
    expect(placeholder.rows).toEqual([]);

    const parsed = parseObservation(JSON.parse(JSON.stringify(placeholder)) as JsonValue);
    expect(parsed.ok).toBe(true);
    // It PARSES and is then REJECTED, which is the split that matters: an empty
    // row list is a well-formed payload, and it is the null clock rather than
    // the empty rows that makes it uninhabitable evidence.
    const verdict = admissible(null, parsed);
    expect(verdict.verdict).toBe("reject");
    expect(verdict.reason).toContain("never collected");
  });

  test("a snapshot's schema number is still the one this reader was written against", () => {
    // If the dashboard bumps its schema, this goes red before anything silently
    // reads the new shape with the old rules.
    expect(fleetState(null, null, null, 60_000, false).schema).toBe(OBSERVATION_SCHEMA);
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

    expect(admissible(null, parseObservation(rawFixture("duplicate-first"))).verdict).toBe("accept");
    const verdict = admissible(first, second);
    // NOT a fault. SSE pushes its cached snapshot on reconnect and the poll runs
    // between collections, so this is the ordinary case — the reason the middle
    // arm exists at all.
    expect(verdict.verdict).toBe("duplicate");
    expect(verdict.reason).toContain(first.clock.at);
  });

  test("a collection that advanced is accepted, and carries the snapshot with it", () => {
    const before = freshFixture("status-change-before");
    const verdict = admissible(before, parseObservation(rawFixture("status-change-after")));
    expect(verdict.verdict).toBe("accept");
    if (verdict.verdict !== "accept") return;
    expect(verdict.snapshot.clock.atMs).toBeGreaterThan(before.clock.atMs);
  });

  test("a payload that did not parse is rejected here, not thrown at the caller", () => {
    const verdict = admissible(null, parseObservation("not a snapshot"));
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

    const verdict = admissible(freshFixture("status-change-before"), parseObservation(payload));
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
    const verdict = admissible(freshFixture("status-change-before"), parseObservation(payload));
    expect(verdict.verdict).toBe("accept");
  });

  test("CONSTRUCTED: a clock that went backwards is rejected rather than shrugged at", () => {
    const later = freshFixture("status-change-after");
    const verdict = admissible(later, parseObservation(rawFixture("status-change-before")));
    // Deliberately not `duplicate`. Equal has an innocent explanation that
    // happens every minute; earlier has none, and calling it a duplicate would
    // stall the history silently for as long as the skew lasted.
    expect(verdict.verdict).toBe("reject");
    expect(verdict.reason).toContain("backwards");
  });

  test("the first snapshot after a cold start needs no predecessor", () => {
    const verdict = admissible(null, parseObservation(rawFixture("session-new-after")));
    expect(verdict.verdict).toBe("accept");
  });

  test("freshFrom refuses a payload with no collection, so no test can smuggle one into diff()", () => {
    const payload = editableFixture("status-change-before");
    payload["collectedAt"] = null;
    expect(() => freshFrom(payload, "constructed placeholder")).toThrow(/not a collection/);
  });
});
