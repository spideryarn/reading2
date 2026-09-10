/**
 * **A LOST RESPONSE, A DASHBOARD RESTART, AND THE PERSON PRESSING CHECK** —
 * plan 260910d, Stage 4, end to end.
 *
 * The case this whole plan exists for, driven through the real pieces: the
 * browser's `makeSteerApi` client, over a `fetch` that delivers the request to
 * the real `makeSteerRoutes`, over a durable receipt journal on a temporary
 * disk. The server acts; the response is lost on the way back; the dashboard
 * restarts (every object discarded, a fresh journal opened over the same
 * directory); the person presses Check, which resends the SAME envelope. The
 * transport must have been called once in total, and the client must hear a
 * replay.
 *
 * **NO TRANSPORT HERE REACHES TMUX.** The send coordinator is handed a fake
 * that counts; the handles are fictional.
 */
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";

import { afterEach, describe, expect, it } from "vitest";

import { QuarantineBook } from "../tools/fleet/quarantine.js";
import { openReceiptJournal, type ReceiptJournal } from "../tools/fleet/receipt-journal.js";
import { createRateLimiter, makeSteerRoutes, type SteerRoutes } from "../tools/fleet/routes-steer.js";
import { makeSendCoordinator } from "../tools/fleet/send-coordinator.js";
import type { SteerResult, SteerTarget } from "../tools/fleet/steer.js";
import { releaseLock, takeLock, type HeldLock } from "../tools/overseer/lock.js";
import { makeSteerApi, messageEnvelope } from "../tools/fleet/web/src/steer-client";
import type { FleetRow } from "../tools/fleet/web/src/types";

const NOW = 1_800_500_000_000;
const HOST = "100.90.80.74:8787";
const RUN_BEFORE = "c9c9c9c9";
const RUN_AFTER = "d0d0d0d0";
const PANE_PID = 978_010;
const TEXT = "the words the restart must not send twice";

const roots: string[] = [];
const locks: Array<{ lock: HeldLock; path: string }> = [];
afterEach(() => {
  while (locks.length > 0) {
    const entry = locks.pop();
    if (entry !== undefined) releaseLock(entry.lock, entry.path);
  }
  while (roots.length > 0) rmSync(roots.pop() ?? "", { recursive: true, force: true });
});

function steerableRow(): FleetRow {
  const status = { kind: "idle" as const };
  return {
    description: { kind: "not-yet-described", why: "no describe pass in this fixture" },
    paneId: "%97801",
    name: "restart-fixture",
    execution: { kind: "unknown", cause: "not-reported", why: "the fixture carried no execution reading" },
    title: null,
    repo: null,
    worktree: null,
    startedAt: new Date("2026-09-10T00:00:00Z").toISOString(),
    status,
    question: null,
    permissionMode: { kind: "cannot-tell", why: "the fixture did not say" },
    pause: { kind: "cannot-tell", why: "the fixture did not say", cause: "rate-limits-not-collected" },
    meta: { version: "legacy" },
    role: { kind: "none" },
    panePid: PANE_PID,
    claudeSessionId: randomUUID(),
    id: "$97801",
    rawStatus: status,
    rawQuestion: null,
  };
}

/** Deliver one request to the routes, as the browser would, and read what they answered. */
async function deliver(routes: SteerRoutes, url: string, body: string): Promise<{ status: number; body: string }> {
  const stream = new PassThrough();
  stream.write(body);
  stream.end();
  const req = Object.assign(stream, {
    url,
    method: "POST",
    headers: { host: HOST, origin: `http://${HOST}`, "content-type": "application/json" },
    socket: { remoteAddress: "100.90.80.75" },
  }) as unknown as IncomingMessage;
  let finish: () => void = () => {};
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const seen = { status: 0, body: "" };
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
  if (!routes.handle(req, res)) throw new Error(`the steer routes did not claim ${url}`);
  await done;
  return seen;
}

describe("a lost response, a restart, and Check", () => {
  it("sends once in total, and the client hears a replay", async () => {
    const dir = mkdtempSync(join(tmpdir(), "fleet-envelope-restart-"));
    roots.push(dir);
    const lockPath = join(dir, "writer.lock");
    const taken = takeLock(lockPath, () => new Date(NOW));
    if (!taken.ok) throw new Error("could not take the test writer lock");
    const held = taken.lock;
    locks.push({ lock: held, path: lockPath });

    let transportCalls = 0;
    const typed = (target: SteerTarget): SteerResult => {
      transportCalls += 1;
      return {
        ok: true,
        verified: { paneId: target.paneId, sessionId: target.sessionId, panePid: PANE_PID, claudePid: PANE_PID + 1 },
        sent: [["send-keys", "-t", target.paneId, "-l", "--", "fixture"], ["send-keys", "-t", target.paneId, "Enter"]],
      };
    };

    /** One run of the dashboard: a journal opened over the directory, and routes over it. Nothing else survives. */
    function boot(serverInstanceId: string): { routes: SteerRoutes; journal: ReceiptJournal } {
      const opened = openReceiptJournal(dir, {
        lock: { held, lockedOutBy: null },
        now: () => NOW,
        serverInstanceId,
      });
      if (opened.kind !== "open") throw new Error(opened.why);
      const book = new QuarantineBook({ now: () => NOW, serverInstanceId });
      const send = makeSendCoordinator({
        book,
        sendMessage: typed,
        answerQuestion: () => {
          throw new Error("nothing here answers a dialog");
        },
      });
      const routes = makeSteerRoutes({
        send,
        receipts: opened.journal,
        now: () => NOW,
        limiter: createRateLimiter({ minIntervalMs: 0, burstMax: 1_000, burstWindowMs: 1 }),
        log: () => {},
        answeringEnabled: () => true,
      });
      return { routes, journal: opened.journal };
    }

    let server = boot(RUN_BEFORE);
    let loseTheNextAnswer = true;
    const posted: string[] = [];
    const browserFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = String(init?.body);
      posted.push(body);
      const answered = await deliver(server.routes, `/${String(input)}`, body);
      /* THE SERVER HAS ACTED. The phone loses signal on the way back, so the
         browser sees a network error — which says nothing about the pane. */
      if (loseTheNextAnswer) {
        loseTheNextAnswer = false;
        throw new TypeError("The network connection was lost.");
      }
      return new Response(answered.body, { status: answered.status, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;

    const api = makeSteerApi(browserFetch);
    const row = steerableRow();
    const envelope = messageEnvelope(row, TEXT, null, { now: NOW });

    const first = await api.keyed.message(envelope);
    expect(first.kind).toBe("not-confirmed");
    expect(transportCalls).toBe(1);

    // The restart: every object is discarded; only bytes on the disk cross.
    server.journal.close();
    server = boot(RUN_AFTER);

    const check = await api.keyed.message(envelope);
    expect(check.kind).toBe("replay");
    if (check.kind !== "replay") return;
    expect(check.receipt).toMatchObject({ op: "steer-message", state: "keys-submitted", pending: false });
    expect(check.receipt.receiptId.startsWith(RUN_BEFORE)).toBe(true);
    expect(transportCalls).toBe(1);
    expect(posted).toHaveLength(2);
    expect(posted[1]).toBe(posted[0]);
    expect(JSON.stringify(check)).not.toContain(TEXT);

    /* THE CONTROL: the restarted dashboard's transport is live. A new intention
       — a new envelope, the same words — is sent, so "once in total" above was
       the replay's doing and not a dead fake's. */
    const fresh = await api.keyed.message(messageEnvelope(row, TEXT, null, { now: NOW }));
    expect(fresh.kind).toBe("answered");
    expect(transportCalls).toBe(2);
    server.journal.close();
  });
});
