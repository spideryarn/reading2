/**
 * **A PERSON'S STATEMENT BESIDE AN UNKNOWN, NEVER A NEW OUTCOME** — plan
 * 260910d, Stage 4: `POST /api/actions/receipts/reconcile`.
 *
 * An enacted plan (a worktree removal, a kill) whose outcome the dashboard
 * could not establish stays `outcome-unknown` for ever. Somebody can look at
 * the box and record that they did — `operator-confirmed` — or record that
 * they have stopped trying — `abandoned-unknown`. Neither is proof, and the
 * test that matters most is that the receipt's `state` does not move.
 *
 * No transport here reaches tmux: nothing in this file sends anything. The
 * receipts are seeded straight into a journal, the way
 * tests/fleet-request-replay.test.ts seeds an earlier build's receipt.
 */
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";

import { afterEach, describe, expect, it } from "vitest";

import { QuarantineBook } from "../tools/fleet/quarantine.js";
import { SteeringQueue } from "../tools/fleet/queue.js";
import {
  memoryReceiptJournal,
  openReceiptJournal,
  summarizeReceipt,
  type ReceiptActor,
  type ReceiptJournal,
} from "../tools/fleet/receipt-journal.js";
import { makeActionRoutes } from "../tools/fleet/routes-actions.js";
import { createRateLimiter } from "../tools/fleet/routes-steer.js";
import { makeSendCoordinator } from "../tools/fleet/send-coordinator.js";
import { releaseLock, takeLock, type HeldLock } from "../tools/overseer/lock.js";
import { parseReceiptsFeed } from "../tools/fleet/web/src/actions-client";

const NOW = 1_800_400_000_000;
const HOST = "100.90.80.72:8787";
const ORIGIN = `http://${HOST}`;
const RUN = "b8b8b8b8";
const GREG: ReceiptActor = { kind: "client-claimed", id: "greg" };
const RECONCILE = "/api/actions/receipts/reconcile";

const roots: string[] = [];
const locks: Array<{ lock: HeldLock; path: string }> = [];
afterEach(() => {
  while (locks.length > 0) {
    const entry = locks.pop();
    if (entry !== undefined) releaseLock(entry.lock, entry.path);
  }
  while (roots.length > 0) rmSync(roots.pop() ?? "", { recursive: true, force: true });
});

type Ending = "unknown" | "completed";

/** One receipt, accepted, attempted and concluded — no route, no transport. */
function seed(journal: ReceiptJournal, op: "enacted-session" | "enacted-box" | "steer-message", ending: Ending): string {
  const accepted =
    op === "enacted-box"
      ? journal.accept({
          requestId: null,
          fingerprint: null,
          op,
          origin: "enacted",
          actor: GREG,
          speaker: "greg",
          target: null,
          what: "kill-test-suites",
          queue: null,
        })
      : journal.accept({
          requestId: null,
          fingerprint: null,
          op,
          origin: op === "steer-message" ? "direct-steer" : "enacted",
          actor: GREG,
          speaker: "greg",
          target: { sessionId: "$98801", paneId: "%98801", claudeSessionId: randomUUID(), tmuxGeneration: null },
          what: op === "steer-message" ? "message (5 characters)" : "remove-worktree",
          queue: null,
        });
  if (!accepted.ok) throw new Error(accepted.why);
  const id = accepted.receiptId;
  journal.attempted(id);
  const landed =
    ending === "unknown"
      ? journal.outcome(id, { state: "outcome-unknown", reason: "threw", code: null, why: "the plan threw before it could say" })
      : journal.outcome(
          id,
          op === "steer-message"
            ? { state: "keys-submitted", reason: "transport-ok", code: null, why: "the transport submitted every key" }
            : { state: "completed", reason: "plan-passed", code: null, why: "every gate passed" },
        );
  if (!landed) throw new Error("the fixture's outcome did not land");
  return id;
}

type Res = { status: number | null; json: Record<string, unknown> };

function world(receipts: ReceiptJournal = memoryReceiptJournal({ now: () => NOW, serverInstanceId: RUN })) {
  const book = new QuarantineBook({ now: () => NOW, serverInstanceId: RUN });
  const queue = new SteeringQueue({ now: () => NOW, serverInstanceId: RUN, quarantine: book, receipts });
  const nothingIsSent = (): never => {
    throw new Error("nothing in this file may reach a transport");
  };
  const send = makeSendCoordinator({ book, sendMessage: nothingIsSent, answerQuestion: nothingIsSent });
  const routes = makeActionRoutes({
    serverInstanceId: RUN,
    queue,
    send,
    now: () => NOW,
    limiter: createRateLimiter({ minIntervalMs: 0, burstMax: 1_000, burstWindowMs: 1 }),
    log: () => {},
    actEnabled: () => false,
    primaryDir: () => "/nonexistent/fixture-checkout",
  });

  async function request(url: string, body: unknown, options: { method?: string; origin?: string } = {}): Promise<Res> {
    const stream = new PassThrough();
    if (body !== undefined) stream.write(JSON.stringify(body));
    stream.end();
    const req = Object.assign(stream, {
      url,
      method: options.method ?? "POST",
      headers: { host: HOST, origin: options.origin ?? ORIGIN, "content-type": "application/json" },
      socket: { remoteAddress: "100.90.80.73" },
    }) as unknown as IncomingMessage;
    let finish: () => void = () => {};
    const done = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const seen: { status: number | null; body: string } = { status: null, body: "" };
    const res = {
      writeHead(status: number) {
        seen.status = status;
        return res;
      },
      end(chunk?: string) {
        seen.body = chunk ?? "";
        finish();
        return res;
      },
    } as unknown as ServerResponse;
    expect(routes.handle(req, res)).toBe(true);
    await done;
    return { status: seen.status, json: seen.body === "" ? {} : (JSON.parse(seen.body) as Record<string, unknown>) };
  }

  return { receipts, request };
}

function reconciledRecords(journal: ReceiptJournal, id: string): number {
  return journal.get(id)?.records.filter((record) => record.kind === "reconciled").length ?? -1;
}

describe("reconciling an unknown enacted plan", () => {
  it.each(["enacted-session", "enacted-box"] as const)(
    "records a person's statement beside an unknown %s, and the outcome stays unknown",
    async (op) => {
      const w = world();
      const id = seed(w.receipts, op, "unknown");
      const answer = await w.request(RECONCILE, { receiptId: id, disposition: "operator-confirmed" });

      expect(answer.status).toBe(200);
      expect(answer.json).toMatchObject({
        ok: true,
        op: "reconciled",
        repeat: false,
        receipt: {
          receiptId: id,
          // The whole point: a statement never turns an unknown into anything else.
          state: "outcome-unknown",
          reason: "threw",
          reconciled: true,
          reconciliation: { disposition: "operator-confirmed", actor: { kind: "client-claimed", id: "greg" }, at: NOW },
        },
      });
      expect(reconciledRecords(w.receipts, id)).toBe(1);
      expect(summarizeReceipt(w.receipts.get(id)!).state).toBe("outcome-unknown");
    },
  );

  it("is idempotent for the same disposition, and refuses a different one", async () => {
    const w = world();
    const id = seed(w.receipts, "enacted-session", "unknown");
    expect((await w.request(RECONCILE, { receiptId: id, disposition: "abandoned-unknown" })).status).toBe(200);

    const again = await w.request(RECONCILE, { receiptId: id, disposition: "abandoned-unknown" });
    expect(again.status).toBe(200);
    expect(again.json).toMatchObject({ ok: true, op: "reconciled", repeat: true });

    const other = await w.request(RECONCILE, { receiptId: id, disposition: "operator-confirmed" });
    expect(other.status).toBe(409);
    expect(other.json.code).toBe("reconciled-otherwise");
    expect(reconciledRecords(w.receipts, id)).toBe(1);
    expect(summarizeReceipt(w.receipts.get(id)!).reconciliation?.disposition).toBe("abandoned-unknown");
  });

  it("refuses anything but an unknown enacted plan, and records nothing", async () => {
    const w = world();
    const steer = seed(w.receipts, "steer-message", "unknown");
    const done = seed(w.receipts, "enacted-session", "completed");

    const notAPlan = await w.request(RECONCILE, { receiptId: steer, disposition: "operator-confirmed" });
    expect(notAPlan.status).toBe(409);
    expect(notAPlan.json.code).toBe("not-reconcilable");

    const known = await w.request(RECONCILE, { receiptId: done, disposition: "operator-confirmed" });
    expect(known.status).toBe(409);
    expect(known.json.code).toBe("not-reconcilable");

    const missing = await w.request(RECONCILE, { receiptId: `${RUN}-r9999`, disposition: "operator-confirmed" });
    expect(missing.status).toBe(404);
    expect(missing.json.code).toBe("no-such-receipt");

    /* `lease-abandoned` is the abandon route's word about a queued item, never
       something this gesture may claim. */
    const unknown = seed(w.receipts, "enacted-session", "unknown");
    const wrongWord = await w.request(RECONCILE, { receiptId: unknown, disposition: "lease-abandoned" });
    expect(wrongWord.status).toBe(400);

    for (const id of [steer, done, unknown]) expect(reconciledRecords(w.receipts, id)).toBe(0);
  });

  it("is origin-checked like every other write", async () => {
    const w = world();
    const id = seed(w.receipts, "enacted-session", "unknown");
    const refused = await w.request(RECONCILE, { receiptId: id, disposition: "operator-confirmed" }, { origin: "http://evil.example" });
    expect(refused.status).toBe(403);
    expect(reconciledRecords(w.receipts, id)).toBe(0);
  });

  it("is a POST, and a GET changes nothing", async () => {
    const w = world();
    const id = seed(w.receipts, "enacted-session", "unknown");
    const refused = await w.request(RECONCILE, undefined, { method: "GET" });
    expect(refused.status).toBe(405);
    expect(reconciledRecords(w.receipts, id)).toBe(0);
  });

  it("reaches the receipts feed, and the page's parser reads it", async () => {
    const w = world();
    const id = seed(w.receipts, "enacted-box", "unknown");
    await w.request(RECONCILE, { receiptId: id, disposition: "operator-confirmed" });
    const read = await w.request("/api/actions/receipts", undefined, { method: "GET" });
    expect(read.status).toBe(200);

    const feed = parseReceiptsFeed(read.json);
    expect(feed).not.toBeNull();
    const mine = feed?.receipts.find((r) => r.receiptId === id);
    expect(mine).toMatchObject({
      op: "enacted-box",
      state: "outcome-unknown",
      reconciliation: { disposition: "operator-confirmed", actor: { kind: "client-claimed", id: "greg" } },
    });
    expect(feed?.unreadable).toBe(0);
  });
});

describe("the journal's own rule", () => {
  it("refuses an operator statement on anything but an enacted plan, and keeps one across a reopen", () => {
    const dir = mkdtempSync(join(tmpdir(), "fleet-receipt-reconcile-"));
    roots.push(dir);
    const path = join(dir, "writer.lock");
    const taken = takeLock(path, () => new Date(NOW));
    if (!taken.ok) throw new Error("could not take the test writer lock");
    locks.push({ lock: taken.lock, path });
    const open = (): ReceiptJournal => {
      const opened = openReceiptJournal(dir, { lock: { held: taken.lock, lockedOutBy: null }, now: () => NOW, serverInstanceId: RUN });
      if (opened.kind !== "open") throw new Error(opened.why);
      return opened.journal;
    };

    const first = open();
    const steer = seed(first, "steer-message", "unknown");
    const plan = seed(first, "enacted-session", "unknown");
    expect(first.reconcile(steer, "operator-confirmed", GREG)).toBe(false);
    expect(first.reconcile(plan, "operator-confirmed", GREG)).toBe(true);
    // One statement only: the second is refused by the journal, not just the route.
    expect(first.reconcile(plan, "abandoned-unknown", GREG)).toBe(false);
    first.close();

    const second = open();
    expect(second.status().unreadableLines).toBe(0);
    expect(summarizeReceipt(second.get(plan)!)).toMatchObject({
      state: "outcome-unknown",
      reconciliation: { disposition: "operator-confirmed", actor: GREG, at: NOW },
    });
    expect(summarizeReceipt(second.get(steer)!).reconciliation).toBeNull();
    second.close();
  });
});
