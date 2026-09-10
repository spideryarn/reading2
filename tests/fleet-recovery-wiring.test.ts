/**
 * The join: the real daemon writes a store, and the composition `server.ts`
 * calls serves it — the drill, end to end.
 *
 * `makeRecoveryRoute()` is called with NO readers, exactly as `server.ts` calls
 * it, and finds the store through `OVERSEER_STORE_DIR` the way production does.
 * There is no second construction to get wrong. The store is built by
 * `buildRecoveryDrill`, which drives `runOverseer` through a simulated reboot
 * (scripts/overseer-recovery-drill.ts), so the file under test is one the real
 * parser, differ, fold and view pass wrote.
 *
 * The two lines no import can reach — the route's dispatch in `server.ts`, and
 * the panel's mount in `App.tsx` — are pinned by source checks at the bottom,
 * the kind tests/fleet-health-wiring.test.ts uses, because a missing mount is
 * invisible to every other test (the Overseer's condition on this stage).
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { DRILL_CONVERSATIONS, DRILL_SESSIONS, buildRecoveryDrill, refuseUnsafeTarget } from "../scripts/overseer-recovery-drill.js";
import { makeRecoveryRoute } from "../tools/fleet/routes-recovery.js";
import type { RecoveryFeed, RecoveryWireRecord } from "../tools/fleet/wire.js";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "fleet-recovery-wiring-"));
  dirs.push(dir);
  return dir;
}

async function getThroughTheProductionComposition(): Promise<{ status: number; feed: RecoveryFeed }> {
  let status = 0;
  let raw = "";
  let done!: () => void;
  const ended = new Promise<void>((resolve) => (done = resolve));
  const res = {
    writeHead(code: number) {
      status = code;
      return res;
    },
    end(chunk?: string) {
      raw = chunk ?? "";
      done();
      return res;
    },
  };
  const handled = makeRecoveryRoute().handle({ method: "GET", url: "/api/recovery", headers: {} } as IncomingMessage, res as unknown as ServerResponse);
  expect(handled).toBe(true);
  await ended;
  return { status, feed: JSON.parse(raw) as RecoveryFeed };
}

describe("the drill, served by the composition server.ts calls", () => {
  it("after a simulated reboot the page gets all four sessions, each with its evidence, and nothing is started", async () => {
    const target = tempDir();
    const drill = await buildRecoveryDrill(target, { hostname: () => "drill-host" });
    vi.stubEnv("OVERSEER_STORE_DIR", drill.store);

    const { status, feed } = await getThroughTheProductionComposition();
    expect(status).toBe(200);
    if (feed.kind !== "published") throw new Error(`expected a published feed, got ${JSON.stringify(feed)}`);
    expect(feed.view.kind).toBe("checked");
    if (feed.view.kind === "checked") expect(feed.view.inventory.kind).toBe("trusted");
    expect(feed.total).toBe(4);
    expect(feed.replay.kind).toBe("ran");

    const byName = new Map<string, RecoveryWireRecord>(feed.records.map((r) => [r.name, r]));
    const working = byName.get(DRILL_SESSIONS.working);
    const exited = byName.get(DRILL_SESSIONS.exited);
    const shell = byName.get(DRILL_SESSIONS.shell);
    const deleted = byName.get(DRILL_SESSIONS.deleted);

    // The working Claude came back in G2 under a new token: the daemon itself
    // disposed it as resumed. Nothing on the page did.
    expect(working?.state).toMatchObject({ kind: "resolved", resolution: { disposition: "resumed", evidence: { conversationId: DRILL_CONVERSATIONS.working } } });

    expect(exited?.state).toMatchObject({ kind: "classified", classification: { kind: "ended-before-reboot", statusKey: "no-claude" } });

    expect(shell?.state).toMatchObject({
      kind: "classified",
      classification: { kind: "interrupted" },
      evidence: { kind: "checked", dir: { kind: "exists", path: drill.dirs.shell }, resume: { kind: "manual", host: "drill-host", dir: drill.dirs.shell } },
    });

    expect(deleted?.state).toMatchObject({
      kind: "classified",
      classification: { kind: "interrupted" },
      evidence: {
        kind: "checked",
        dir: { kind: "missing", path: drill.dirs.deleted },
        transcript: { kind: "not-found", under: "claim", conversationId: DRILL_CONVERSATIONS.deleted },
        resume: { kind: "not-supported" },
      },
    });

    // Grouped: interrupted first, resolved last.
    expect(feed.records.at(-1)?.name).toBe(DRILL_SESSIONS.working);
    expect(feed.records[0]?.state).toMatchObject({ classification: { kind: "interrupted" } });
  }, 60_000);

  it("refuses the live store, anything inside it, and a directory that is not empty", () => {
    const live = join(homedir(), ".overseer");
    expect(refuseUnsafeTarget(live)).toMatch(/live Overseer store/);
    expect(refuseUnsafeTarget(join(live, "drill"))).toMatch(/live Overseer store/);
    const full = tempDir();
    writeFileSync(join(full, "something"), "x");
    expect(refuseUnsafeTarget(full)).toMatch(/not empty/);
    expect(refuseUnsafeTarget(join(tempDir(), "new"))).toBeNull();
  });
});

describe("server.ts", () => {
  const source = readFileSync(join(REPO, "tools", "fleet", "server.ts"), "utf8");

  it("imports the route module", () => {
    expect(source).toContain('import { makeRecoveryRoute } from "./routes-recovery.js";');
  });

  it("builds the route exactly once, with no readers of its own", () => {
    expect(source.match(/makeRecoveryRoute\(/g) ?? []).toHaveLength(1);
    expect(source).toContain("const recoveryApiRoute = makeRecoveryRoute();");
  });

  it("dispatches to it in the request path", () => {
    expect(source).toContain("if (recoveryApiRoute.handle(req, res)) return;");
  });
});

describe("App.tsx", () => {
  const source = readFileSync(join(REPO, "tools", "fleet", "web", "src", "App.tsx"), "utf8");

  it("mounts RecoveryPanel inside the overseer arm, below OverseerPanel", () => {
    const start = source.indexOf('{mode === "overseer" ? (');
    expect(start).toBeGreaterThan(-1);
    const end = source.indexOf(") : null}", start);
    const arm = source.slice(start, end);
    expect(arm).toContain("<OverseerPanel");
    expect(arm).toContain("<RecoveryPanel");
    expect(arm.indexOf("<RecoveryPanel")).toBeGreaterThan(arm.indexOf("<OverseerPanel"));
    expect(source.match(/<RecoveryPanel\b/g) ?? []).toHaveLength(1);
  });
});
