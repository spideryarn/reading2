/**
 * `realActionIo().listProcesses` — the two `ps` calls behind every kill preview.
 *
 * WHAT IS UNDER TEST IS A BOUND, so the first test measures a clock. The calls
 * were `execFileSync` with a `timeout`, which signals at the deadline and then
 * goes on waiting: a `ps` that ignored SIGTERM held the whole dashboard, every
 * request and every timer, for as long as it lived
 * (docs/postmortems/260910a-a-timeout-that-signals-and-then-waits-is-not-a-bound.md).
 * The stand-in for `ps` here is a real script that ignores TERM and sleeps, so
 * the test fails against a synchronous call by the only evidence that counts —
 * how long the caller was gone.
 *
 * The rest is the mapping: every outcome that is not a reading must become
 * `{ ok: false, why }`. An empty process list is the one answer this may never
 * give, because "nothing matched the rule" is how the page says the box is
 * clean.
 */
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { probeOwner, type OwnedOutcome, type ProbeOwner, type ProbeSpec } from "../tools/fleet/child.js";
import { realActionIo } from "../tools/fleet/routes-actions.js";

const dir = mkdtempSync(path.join(tmpdir(), "fleet-list-processes-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** An executable standing in for `ps`. It is handed `ps`'s arguments and ignores them. */
function fakePs(name: string, body: string): string {
  const file = path.join(dir, name);
  writeFileSync(file, `#!/bin/sh\n${body}\n`);
  chmodSync(file, 0o755);
  return file;
}

/** How long the stubborn child lives if nobody kills it — the time a synchronous call would be gone for. */
const STUBBORN_SECONDS = 4;
const stubbornPs = fakePs("ps-ignores-term", `trap '' TERM\nsleep ${STUBBORN_SECONDS}`);

/** An owner that never starts anything and answers every probe the same way. */
function ownerAnswering(outcome: OwnedOutcome, seen: ProbeSpec[] = []): ProbeOwner {
  return {
    run: (spec) => {
      seen.push(spec);
      return Promise.resolve(outcome);
    },
    live: () => [],
  };
}

describe("listProcesses — the caller is released at the deadline, whatever ps does", () => {
  it("is back within timeout + grace when ps ignores SIGTERM, and says it timed out", async () => {
    const io = realActionIo({ owner: probeOwner(), psBin: stubbornPs, timeoutMs: 200, graceMs: 200 });
    const startedAt = Date.now();
    const scan = await io.listProcesses();
    const elapsedMs = Date.now() - startedAt;

    // 200 + 200 and generous slack for a loaded box, still far short of the
    // child's own 4 s — which is what a call that waits for the exit takes.
    expect(elapsedMs).toBeLessThan(2_000);
    expect(scan.ok).toBe(false);
    if (scan.ok) throw new Error("unreachable");
    expect(scan.why).toMatch(/ps could not be read.*actions:ps-args.*200ms deadline/);
  });

  it("refuses a second scan while the first one's ps is unaccounted for, rather than starting a sibling", async () => {
    const io = realActionIo({ owner: probeOwner(), psBin: stubbornPs, timeoutMs: 300, graceMs: 200 });
    const first = io.listProcesses();
    const second = await io.listProcesses();
    expect(second.ok).toBe(false);
    if (second.ok) throw new Error("unreachable");
    expect(second.why).toMatch(/ps could not be read.*actions:ps-args.*unaccounted for.*no second child/);
    // The first is still the one that owns the child, and still ends as a timeout.
    const firstScan = await first;
    expect(firstScan.ok).toBe(false);
  });
});

describe("listProcesses — nothing but a reading is a process list", () => {
  const notAReading: Exclude<OwnedOutcome, { kind: "ok" }>[] = [
    { kind: "failed", why: "ps exited with code 1: no such option", tookMs: 3, exitCode: 1, signal: null },
    { kind: "timed-out", why: "probe reached its 10000ms deadline", tookMs: 10_000, pid: 41, exitObserved: false },
    { kind: "refused", why: "probe still has child pid 41 unaccounted for", pid: 41, liveForMs: 12_000 },
    { kind: "overflowed", why: "probe exceeded its 33554432-byte capture cap", tookMs: 9, capturedBytes: 33_554_433 },
  ];

  for (const outcome of notAReading) {
    it(`${outcome.kind} becomes ok:false carrying the owner's reason`, async () => {
      const scan = await realActionIo({ owner: ownerAnswering(outcome) }).listProcesses();
      expect(scan).toEqual({ ok: false, why: `ps could not be read: ${outcome.why}` });
    });
  }

  it("a second-call failure is a failure too: the first ps answering does not make a list", async () => {
    let calls = 0;
    const owner: ProbeOwner = {
      run: () => {
        calls += 1;
        return Promise.resolve<OwnedOutcome>(
          calls === 1
            ? { kind: "ok", stdout: "    1     0  1024   500 /sbin/init\n", stderr: "", tookMs: 1 }
            : { kind: "timed-out", why: "the comm listing hung", tookMs: 10_000, pid: 42, exitObserved: true },
        );
      },
      live: () => [],
    };
    const scan = await realActionIo({ owner }).listProcesses();
    expect(calls).toBe(2);
    expect(scan).toEqual({ ok: false, why: "ps could not be read: the comm listing hung" });
  });

  it("asks for both listings under their own keys, with the caps and the deadline it always had", async () => {
    const seen: ProbeSpec[] = [];
    await realActionIo({ owner: ownerAnswering({ kind: "ok", stdout: "", stderr: "", tookMs: 1 }, seen) }).listProcesses();
    expect(seen.map((s) => [s.key, s.cmd, s.args, s.timeoutMs, s.maxBytes])).toEqual([
      ["actions:ps-args", "ps", ["-eo", "pid=,ppid=,rss=,etimes=,args="], 10_000, 32 * 1024 * 1024],
      ["actions:ps-comm", "ps", ["-eo", "pid=,comm="], 10_000, 8 * 1024 * 1024],
    ]);
  });

  it("ps exiting 0 with nothing parseable is still refused, not an empty box", async () => {
    const scan = await realActionIo({
      owner: ownerAnswering({ kind: "ok", stdout: "", stderr: "", tookMs: 1 }),
    }).listProcesses();
    expect(scan.ok).toBe(false);
    if (scan.ok) throw new Error("unreachable");
    expect(scan.why).toMatch(/ps returned nothing this could parse/);
  });

  it("the real ps, through a real owner, finds this process and its cwd", async () => {
    const scan = await realActionIo({ owner: probeOwner() }).listProcesses();
    if (!scan.ok) throw new Error(scan.why);
    const self = scan.procs.find((p) => p.pid === process.pid);
    expect(self?.cwd).toBe(process.cwd());
    expect(self?.comm).not.toBe("");
  });
});
