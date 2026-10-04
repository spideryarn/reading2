/**
 * The attention pass's two tmux reads — tools/overseer/attention-probe.ts.
 *
 * The daemon reaches both on every attention pass (`attentionRunner`), and it
 * has one thread. A synchronous child with a `timeout` is signalled at the
 * timeout and then waited for until it exits, so a tmux that will not die held
 * the heartbeat for as long as it liked
 * (docs/postmortems/260910a-a-timeout-that-signals-and-then-waits-is-not-a-bound.md).
 * The only child that shows the difference is one that IGNORES the signal: one
 * that obeys comes back on time under either implementation. So that is the
 * fixture, and the assertion is the wall clock, not the wording.
 *
 * Seen red against the synchronous calls with the same seam: ~2.5 s each.
 */
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { probeOwner } from "../tools/fleet/child.js";
import { listSessions, tmuxServerGeneration } from "../tools/overseer/attention-probe.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** An executable standing in for `tmux`, whatever arguments it is given. */
function fakeTmux(script: string): string {
  const dir = mkdtempSync(join(tmpdir(), "attention-probe-"));
  dirs.push(dir);
  const bin = join(dir, "fake-tmux");
  writeFileSync(bin, `#!/bin/sh\n${script}\n`);
  chmodSync(bin, 0o755);
  return bin;
}

/** Ignores TERM and outlives the deadline by more than two seconds. */
const STALLS = 'trap "" TERM\nsleep 2.5';
/** The signal is sent at 200 ms and the caller is released one grace later. */
const BOUNDS = { timeoutMs: 200, graceMs: 100 };
/** Well under the 2.5 s the child takes, well over the 300 ms the owner allows. */
const RELEASED_WITHIN_MS = 1_500;

describe("a tmux that ignores its signal does not hold the caller", () => {
  test("listSessions rejects with the owner's reason, about one grace after the deadline", async () => {
    const bin = fakeTmux(STALLS);
    const started = Date.now();
    await expect((async () => listSessions({ bin, ...BOUNDS, owner: probeOwner() }))()).rejects.toThrow(/200ms deadline/);
    expect(Date.now() - started).toBeLessThan(RELEASED_WITHIN_MS);
  });

  test("tmuxServerGeneration answers null, about one grace after the deadline", async () => {
    const bin = fakeTmux(STALLS);
    const started = Date.now();
    expect(await tmuxServerGeneration({ bin, ...BOUNDS, owner: probeOwner() })).toBeNull();
    expect(Date.now() - started).toBeLessThan(RELEASED_WITHIN_MS);
  });

  test("the two reads have separate keys, so a stuck listing does not refuse the generation", async () => {
    const owner = probeOwner();
    // No grace to speak of and a child that outlives SIGKILL's delivery by
    // nothing: what matters is only that the listing's child is still
    // registered under ITS key when the generation is asked for.
    const stuck = listSessions({ bin: fakeTmux("sleep 1"), timeoutMs: 5_000, owner });
    expect(await tmuxServerGeneration({ bin: fakeTmux("echo 4242"), owner })).toBe(4242);
    expect(owner.live().map((child) => child.key)).toEqual(["attention:tmux-list-sessions"]);
    await stuck;
  });
});

describe("what the two reads make of tmux's answer is unchanged", () => {
  test("listSessions parses id, name and current pane, and a session with no pane is null", async () => {
    const bin = fakeTmux("printf '$1\\tasks\\t%%1\\n$2\\tno pane\\t\\n\\n'");
    expect(await listSessions({ bin, owner: probeOwner() })).toEqual([
      { sessionId: "$1", sessionName: "asks", paneId: "%1" },
      { sessionId: "$2", sessionName: "no pane", paneId: null },
    ]);
  });

  test("listSessions still rejects when tmux cannot be asked, and says why", async () => {
    const bin = fakeTmux("echo 'no server running on /tmp/tmux-1000/default' >&2\nexit 1");
    await expect((async () => listSessions({ bin, owner: probeOwner() }))()).rejects.toThrow(/exited with code 1.*no server running/);
  });

  test("tmuxServerGeneration is the pid tmux prints, and null for anything that is not one", async () => {
    expect(await tmuxServerGeneration({ bin: fakeTmux("echo 132280"), owner: probeOwner() })).toBe(132280);
    expect(await tmuxServerGeneration({ bin: fakeTmux("echo not-a-pid"), owner: probeOwner() })).toBeNull();
    expect(await tmuxServerGeneration({ bin: fakeTmux("exit 1"), owner: probeOwner() })).toBeNull();
  });
});
