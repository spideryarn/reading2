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
    expect(parsedStamped.value).toEqual(parsedUnstamped.value);
  });
});
