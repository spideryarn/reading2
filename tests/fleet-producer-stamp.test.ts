import { describe, expect, test } from "vitest";

import type { FleetSnapshot } from "../tools/fleet/collect.js";
import { statePayload, type PayloadDeps } from "../tools/fleet/state.js";
import type { ProducerStamp } from "../tools/fleet/wire.js";
import { parseObservation, type JsonValue } from "../tools/overseer/observation.js";

type Ledger = {
  record(outcome: "success" | "failure"): void;
  stamp(): ProducerStamp;
};

async function ledger(instance: string): Promise<Ledger> {
  const module = await import("../tools/fleet/instance.js") as typeof import("../tools/fleet/instance.js") & {
    PublicationLedger: new (instance: string) => Ledger;
  };
  return new module.PublicationLedger(instance);
}

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
  test("starts before any turn, then advances both counters on success and only publication on failure", async () => {
    const publications = await ledger("1a2b3c4d");
    expect(publications.stamp()).toEqual({ instance: "1a2b3c4d", publication: 0, inventory: null });

    publications.record("success");
    expect(publications.stamp()).toEqual({ instance: "1a2b3c4d", publication: 1, inventory: 1 });

    publications.record("failure");
    expect(publications.stamp()).toEqual({ instance: "1a2b3c4d", publication: 2, inventory: 1 });
  });

  test("keeps separate instance identities in one process and refuses a malformed id", async () => {
    const first = await ledger("1a2b3c4d");
    const second = await ledger("5e6f7890");
    expect(first.stamp().instance).toBe("1a2b3c4d");
    expect(second.stamp().instance).toBe("5e6f7890");
    await expect(ledger("not-an-instance")).rejects.toThrow(/instance/i);
  });
});

describe("the stamp on the fleet payload", () => {
  test("carries the ledger's values through the production composition", async () => {
    const publications = await ledger("1a2b3c4d");
    publications.record("success");
    publications.record("failure");
    expect(JSON.parse(payload(publications.stamp())).producer).toEqual({
      instance: "1a2b3c4d",
      publication: 2,
      inventory: 1,
    });
  });

  test("gives a poll and broadcast composed from the same dependencies the same stamp", async () => {
    const publications = await ledger("1a2b3c4d");
    publications.record("success");
    const deps = payloadDeps(publications.stamp());
    const poll = JSON.parse(statePayload(deps)) as { producer: ProducerStamp };
    const broadcast = JSON.parse(statePayload(deps)) as { producer: ProducerStamp };
    expect(broadcast.producer).toEqual(poll.producer);
    expect(poll.producer).toEqual(publications.stamp());
  });

  test("gives a new subscriber the same failed-first-turn payload a poll gets", async () => {
    const publications = await ledger("1a2b3c4d");
    publications.record("failure");
    const poll = payload(publications.stamp(), { snapshot: null, error: "tmux was unavailable" });
    const module = await import("../tools/fleet/state.js") as typeof import("../tools/fleet/state.js") & {
      initialFramePayload(producer: ProducerStamp, payload: string): string | null;
    };
    const initial = module.initialFramePayload(publications.stamp(), poll);

    expect(initial).toBe(poll);
    expect(JSON.parse(initial ?? "null")).toMatchObject({
      producer: { instance: "1a2b3c4d", publication: 1, inventory: null },
      error: "tmux was unavailable",
      collectedAt: null,
    });
  });

  test("refuses a producer inventory whose nullness disagrees with the snapshot", () => {
    expect(() => payload({ instance: "1a2b3c4d", publication: 1, inventory: null })).toThrow(/inventory.*snapshot/i);
    expect(() => payload(
      { instance: "1a2b3c4d", publication: 1, inventory: 1 },
      { snapshot: null },
    )).toThrow(/inventory.*snapshot/i);
  });

  test("is additive to today's observation parser", async () => {
    const publications = await ledger("1a2b3c4d");
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
