/**
 * `collectUsage`'s one subprocess — `claude auth status`.
 *
 * WHAT IS UNDER TEST IS A BOUND, so the first test measures a clock. The call
 * was `execFileSync` with a `timeout`, which signals at the deadline and then
 * goes on waiting, and `collectUsage` runs inside the Overseer daemon: a
 * `claude` that ignored SIGTERM stopped every other job the daemon has
 * (docs/postmortems/260910a-a-timeout-that-signals-and-then-waits-is-not-a-bound.md).
 * The stand-in for `claude` here is a real script that ignores TERM and
 * sleeps, so the test fails against a synchronous call by the only evidence
 * that counts — how long the caller was gone.
 *
 * The rest is the mapping: an auth status that did not answer is an `unknown`
 * account with the reason in it, and the rest of the report is still made.
 */
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { probeOwner, type OwnedOutcome, type ProbeOwner, type ProbeSpec } from "../tools/fleet/child.js";
import { collectUsage, type AuthStatusProbe } from "../tools/overseer/usage.js";

const dir = mkdtempSync(path.join(tmpdir(), "overseer-auth-status-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const claudeJsonPath = path.join(dir, "claude.json");
writeFileSync(claudeJsonPath, "{}");
const projectsDir = path.join(dir, "projects");
mkdirSync(projectsDir);

/** An executable standing in for `claude`. It is handed `auth status` and ignores it. */
function fakeClaude(name: string, body: string): string {
  const file = path.join(dir, name);
  writeFileSync(file, `#!/bin/sh\n${body}\n`);
  chmodSync(file, 0o755);
  return file;
}

/** How long the stubborn child lives if nobody kills it — the time a synchronous call would be gone for. */
const STUBBORN_SECONDS = 4;
const stubbornClaude = fakeClaude("claude-ignores-term", `trap '' TERM\nsleep ${STUBBORN_SECONDS}`);

const collect = (authStatus: AuthStatusProbe) => collectUsage({ claudeJsonPath, projectsDir, authStatus });

function ownerAnswering(outcome: OwnedOutcome, seen: ProbeSpec[] = []): ProbeOwner {
  return {
    run: (spec) => {
      seen.push(spec);
      return Promise.resolve(outcome);
    },
    live: () => [],
  };
}

describe("claude auth status — the caller is released at the deadline, whatever claude does", () => {
  it("is back within timeout + grace when claude ignores SIGTERM, and the account is unknown with the reason", async () => {
    const startedAt = Date.now();
    const report = await collect({ owner: probeOwner(), claudeBin: stubbornClaude, timeoutMs: 200, graceMs: 200 });
    const elapsedMs = Date.now() - startedAt;

    // 200 + 200 and generous slack for a loaded box, still far short of the
    // child's own 4 s — which is what a call that waits for the exit takes.
    expect(elapsedMs).toBeLessThan(2_000);
    expect(report.account.kind).toBe("unknown");
    if (report.account.kind !== "unknown") throw new Error("unreachable");
    expect(report.account.why).toMatch(/claude auth status failed.*usage:claude-auth-status.*200ms deadline/);
    // The scan beside it still ran: one hung command does not cost the report.
    expect(report.rateLimits.coverage.transcriptsFound).toBe(0);
  });

  it("refuses a second run while the first one's claude is unaccounted for, rather than starting a sibling", async () => {
    const owner = probeOwner();
    const probe = { owner, claudeBin: stubbornClaude, timeoutMs: 300, graceMs: 200 };
    const first = collect(probe);
    // Wait for the first pass to have really started its child before the second asks.
    for (let i = 0; i < 200 && owner.live().length === 0; i += 1) await new Promise((r) => setTimeout(r, 5));
    expect(owner.live().map((c) => c.key)).toEqual(["usage:claude-auth-status"]);

    const second = await collect(probe);
    expect(second.account.kind).toBe("unknown");
    if (second.account.kind !== "unknown") throw new Error("unreachable");
    expect(second.account.why).toMatch(/claude auth status failed.*unaccounted for.*no second child/);
    await first;
  });
});

describe("claude auth status — nothing but an answer is an account", () => {
  const notAnAnswer: Exclude<OwnedOutcome, { kind: "ok" }>[] = [
    { kind: "failed", why: "could not start claude: spawn claude ENOENT", tookMs: 3, exitCode: null, signal: null },
    { kind: "timed-out", why: "probe reached its 20000ms deadline", tookMs: 20_000, pid: 41, exitObserved: false },
    { kind: "refused", why: "probe still has child pid 41 unaccounted for", pid: 41, liveForMs: 30_000 },
    { kind: "overflowed", why: "probe exceeded its 1048576-byte capture cap", tookMs: 9, capturedBytes: 1_048_577 },
  ];

  for (const outcome of notAnAnswer) {
    it(`${outcome.kind} becomes an unknown account carrying the owner's reason`, async () => {
      const report = await collect({ owner: ownerAnswering(outcome) });
      expect(report.account).toEqual({ kind: "unknown", why: `claude auth status failed: ${outcome.why}` });
    });
  }

  it("asks under its own key, with the cap and the deadline it always had", async () => {
    const seen: ProbeSpec[] = [];
    await collect({ owner: ownerAnswering({ kind: "ok", stdout: "{}", stderr: "", tookMs: 1 }, seen) });
    expect(seen.map((s) => [s.key, s.cmd, s.args, s.timeoutMs, s.maxBytes])).toEqual([
      ["usage:claude-auth-status", "claude", ["auth", "status"], 20_000, 1024 * 1024],
    ]);
  });

  it("a real child's stdout reaches the parser", async () => {
    const answers = fakeClaude(
      "claude-answers",
      `echo '{"loggedIn":true,"authMethod":"claude.ai","email":"a@example.test","subscriptionType":"max"}'`,
    );
    const viaOwner = await collect({ owner: probeOwner(), claudeBin: answers });
    const direct = await collect({
      owner: ownerAnswering({
        kind: "ok",
        stdout: '{"loggedIn":true,"authMethod":"claude.ai","email":"a@example.test","subscriptionType":"max"}\n',
        stderr: "",
        tookMs: 1,
      }),
    });
    expect(viaOwner.account).toEqual(direct.account);
    expect(JSON.stringify(viaOwner.account)).toContain("a@example.test");
  });
});
