import { describe, expect, test } from "vitest";

import type { FleetSnapshot } from "../tools/fleet/collect.js";
import { PublicationLedger } from "../tools/fleet/instance.js";
import { initialFramePayload, statePayload, type PayloadDeps } from "../tools/fleet/state.js";
import type { ProducerStamp } from "../tools/fleet/wire.js";
import { parseObservation, type JsonValue } from "../tools/overseer/observation.js";

const snapshot: FleetSnapshot = {
  rows: [],
  tmuxServerPid: 4812,
  collectedAt: "2026-09-10T10:30:00.000Z",
  tookMs: 1200,
};

function payloadDeps(producer: ProducerStamp, over: Partial<{
  snapshot: FleetSnapshot | null;
  error: string | null;
}> = {}): PayloadDeps {
  return {
    snapshot,
    error: null,
    health: null,
    refreshMs: 60_000,
    answeringEnabled: true,
    attemptedAt: "2026-09-10T10:29:58.000Z",
    producer,
    readCheckpoint: () => ({
      attention: { kind: "not-asked" },
      overseer: { kind: "not-asked" },
      usage: { kind: "not-asked" },
      accountUsage: { kind: "not-asked" },
      work: { kind: "checkpoint-absent" },
    }),
    ...over,
  };
}

function payload(producer: ProducerStamp, over: Partial<{
  snapshot: FleetSnapshot | null;
  error: string | null;
}> = {}): string {
  return statePayload(payloadDeps(producer, over));
}

describe("the producer publication ledger", () => {
  test("starts before any turn, then advances both counters on success and only publication on failure", () => {
    const publications = new PublicationLedger("1a2b3c4d");
    expect(publications.stamp()).toEqual({ instance: "1a2b3c4d", publication: 0, inventory: null });

    publications.record("success");
    expect(publications.stamp()).toEqual({ instance: "1a2b3c4d", publication: 1, inventory: 1 });

    publications.record("failure");
    expect(publications.stamp()).toEqual({ instance: "1a2b3c4d", publication: 2, inventory: 1 });
  });

  test("keeps separate instance identities in one process and refuses a malformed id", () => {
    const first = new PublicationLedger("1a2b3c4d");
    const second = new PublicationLedger("5e6f7890");
    expect(first.stamp().instance).toBe("1a2b3c4d");
    expect(second.stamp().instance).toBe("5e6f7890");
    expect(() => new PublicationLedger("not-an-instance")).toThrow(/instance/i);
  });
});

describe("the stamp on the fleet payload", () => {
  test("carries the ledger's values through the production composition", () => {
    const publications = new PublicationLedger("1a2b3c4d");
    publications.record("success");
    publications.record("failure");
    expect(JSON.parse(payload(publications.stamp())).producer).toEqual({
      instance: "1a2b3c4d",
      publication: 2,
      inventory: 1,
    });
  });

  test("gives a poll and broadcast composed from the same dependencies the same stamp", () => {
    const publications = new PublicationLedger("1a2b3c4d");
    publications.record("success");
    const deps = payloadDeps(publications.stamp());
    const poll = JSON.parse(statePayload(deps)) as { producer: ProducerStamp };
    const broadcast = JSON.parse(statePayload(deps)) as { producer: ProducerStamp };
    expect(broadcast.producer).toEqual(poll.producer);
    expect(poll.producer).toEqual(publications.stamp());
  });

  test("gives a new subscriber the same failed-first-turn payload a poll gets without composing before a turn", () => {
    const publications = new PublicationLedger("1a2b3c4d");
    let compositions = 0;
    let checkpointReads = 0;
    const compose = () => {
      compositions += 1;
      return statePayload({
        ...payloadDeps(publications.stamp(), { snapshot: null, error: "tmux was unavailable" }),
        readCheckpoint: () => {
          checkpointReads += 1;
          return {
            attention: { kind: "not-asked" },
            overseer: { kind: "not-asked" },
            usage: { kind: "not-asked" },
            accountUsage: { kind: "not-asked" },
            work: { kind: "checkpoint-absent" },
          };
        },
      });
    };

    expect(initialFramePayload(publications.stamp(), compose)).toBeNull();
    expect(compositions).toBe(0);
    expect(checkpointReads).toBe(0);

    publications.record("failure");
    const initial = initialFramePayload(publications.stamp(), compose);

    expect(compositions).toBe(1);
    expect(checkpointReads).toBe(1);
    expect(JSON.parse(initial ?? "null")).toMatchObject({
      producer: { instance: "1a2b3c4d", publication: 1, inventory: null },
      error: "tmux was unavailable",
      collectedAt: null,
    });
  });

  test("reports a producer/snapshot disagreement without taking the payload down", () => {
    const errors: unknown[][] = [];
    const original = console.error;
    let withSnapshot = "";
    let withoutSnapshot = "";
    try {
      console.error = (...args: unknown[]) => errors.push(args);
      withSnapshot = payload({ instance: "1a2b3c4d", publication: 1, inventory: null });
      withoutSnapshot = payload(
        { instance: "1a2b3c4d", publication: 1, inventory: 1 },
        { snapshot: null },
      );
    } finally {
      console.error = original;
    }

    expect(errors).toHaveLength(2);
    expect(errors[0]?.join(" ")).toMatch(/producer.*inventory.*snapshot/i);
    expect(JSON.parse(withSnapshot)).toMatchObject({
      collectedAt: snapshot.collectedAt,
      producer: { instance: "invalid", publication: 1, inventory: 0 },
    });
    expect(JSON.parse(withoutSnapshot)).toMatchObject({
      collectedAt: null,
      producer: { instance: "invalid", publication: 1, inventory: null },
    });
  });

  test("is additive to today's observation parser", () => {
    const publications = new PublicationLedger("1a2b3c4d");
    publications.record("success");
    const stamped = JSON.parse(payload(publications.stamp())) as Record<string, JsonValue>;
    const unstamped = structuredClone(stamped);
    delete unstamped.producer;

    const parsedStamped = parseObservation(stamped);
    const parsedUnstamped = parseObservation(unstamped);
    expect(parsedStamped.ok).toBe(true);
    expect(parsedUnstamped.ok).toBe(true);
    if (!parsedStamped.ok || !parsedUnstamped.ok) return;
    // Since Stage 2 (docs/plans/260910d) the parser READS the stamp into
    // `ordering`, so the two now differ in exactly that field and nowhere
    // else — which is the additivity claim: everything a reader without
    // `ordering` sees is the same with or without the key.
    const { ordering: stampedOrdering, ...stampedRest } = parsedStamped.value;
    const { ordering: unstampedOrdering, ...unstampedRest } = parsedUnstamped.value;
    expect(stampedRest).toEqual(unstampedRest);
    expect(stampedOrdering).toEqual({ kind: "stamped", instance: "1a2b3c4d", publication: 1, inventory: 1 });
    expect(unstampedOrdering).toEqual({ kind: "unstamped" });
  });

  test("declares no capability this build cannot back, beside the stamp, and the Overseer's parser reads the list", () => {
    // Plan 260910f, Sol's G3: the resume pass defers until the collecting
    // dashboard declares `argv-resume-uuid` — that a resumed session reads as
    // VERIFIED. After Sol's G21 it does not: a `--resume` on a ps-flattened
    // line is unreadable, so a resumed pane reads `claimed-only`. Declaring it
    // anyway would let a resume launch that the pace rule then waits behind
    // for ever. Stage 3b re-declares it once it reads /proc/<pid>/cmdline
    // faithfully. Through the production composition, not a hand-built payload.
    const publications = new PublicationLedger("1a2b3c4d");
    publications.record("success");
    const body = JSON.parse(payload(publications.stamp())) as Record<string, JsonValue>;
    expect(body["capabilities"]).toEqual([]);
    const parsed = parseObservation(body);
    expect(parsed.ok && parsed.value.capabilities).toEqual([]);
    // and a never-collected payload says the same: it is a fact about the build
    const empty = JSON.parse(payload(new PublicationLedger("5e6f7890").stamp(), { snapshot: null })) as Record<string, JsonValue>;
    expect(empty["capabilities"]).toEqual([]);
  });
});
