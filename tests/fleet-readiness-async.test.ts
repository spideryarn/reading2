/**
 * **The readiness timer's children, off the dashboard's only thread.**
 *
 * The timer runs on the same event loop as every request, so a synchronous
 * `tmux` or `git` there froze the whole dashboard for as long as the child
 * took to die — a `timeout` on `execFileSync` is when the signal is sent, not a
 * bound (`docs/postmortems/260910a-a-timeout-that-signals-and-then-waits-is-not-a-bound.md`).
 * These drive real children: one that ignores TERM, and a real scratch
 * repository whose refs move between two of the snapshot's git calls.
 */
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { probeOwner, type ProbeOwner, type ProbeSpec } from "../tools/fleet/child.js";
import { gitEnv, snapshotDev, snapshotDevAsync } from "../tools/fleet/readiness-git.js";
import { latchedReadinessRefresh, liveSessionNames, type ReadinessSnapshot } from "../tools/fleet/readiness-wiring.js";

describe("which tmux sessions exist, asked without blocking", () => {
  let bin: string;
  let path: string | undefined;

  /** A `tmux` first on PATH, so the real command line is what gets run. */
  const fakeTmux = (script: string): void => {
    writeFileSync(join(bin, "tmux"), `#!/bin/sh\n${script}\n`);
    chmodSync(join(bin, "tmux"), 0o755);
  };

  beforeEach(() => {
    bin = mkdtempSync(join(tmpdir(), "readiness-fake-tmux-"));
    path = process.env["PATH"];
    process.env["PATH"] = `${bin}${delimiter}${path ?? ""}`;
  });
  afterEach(() => {
    process.env["PATH"] = path;
    rmSync(bin, { recursive: true, force: true });
  });

  it("stops waiting for a tmux that ignores TERM, and says it did not look", async () => {
    // Ignores TERM and outlives every bound below; only SIGKILL ends it early.
    fakeTmux("trap '' TERM\nsleep 3");
    const real = probeOwner();
    /* The production deadline is three seconds; the test shrinks only the
       clock, so the command, the key and the mapping are the real ones. */
    const owner: ProbeOwner = {
      run: (spec: ProbeSpec) => real.run({ ...spec, timeoutMs: 200, graceMs: 150 }),
      live: () => real.live(),
    };

    const started = performance.now();
    const answer = await liveSessionNames(owner);
    const elapsed = performance.now() - started;

    // Generous about box scheduling, and still far short of the child's 3 s.
    expect(elapsed).toBeLessThan(1_500);
    /* "We did not look" — never an empty set, which would call every session
       gone and void the whole board. */
    expect(answer).not.toHaveProperty("names");
    expect("why" in answer && answer.why).toMatch(/tmux would not list its sessions.*deadline/);

    await vi.waitFor(() => expect(real.live()).toEqual([]), { timeout: 4_000 });
  });

  it("returns the names a tmux that answers printed", async () => {
    fakeTmux('printf "alpha\\n beta \\n\\n"');
    expect(await liveSessionNames(probeOwner())).toEqual({ names: new Set(["alpha", "beta"]) });
  });
});

describe("the dev snapshot, asked without blocking", () => {
  let repo: string;
  const git = (...args: string[]): string =>
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", ...args], {
      cwd: repo,
      encoding: "utf8",
      env: gitEnv(),
    }).trim();
  const commit = (message: string): string => {
    git("commit", "--allow-empty", "-m", message);
    return git("rev-parse", "HEAD");
  };

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "readiness-git-async-"));
    git("init", "--quiet", "-b", "work");
  });
  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it("counts from the shas it names, even when every ref moves between its git calls", async () => {
    const a = commit("A");
    const b = commit("B");
    const c = commit("C");
    const d = commit("D");
    git("update-ref", "refs/heads/work", b);
    git("update-ref", "refs/remotes/origin/dev", c);
    git("update-ref", "refs/remotes/origin/main", a);

    /* What a peer's push, fetch or commit does between two awaited calls: by
       the time the first count is asked, none of the three names means what it
       did when it was read. */
    const real = probeOwner();
    let moved = false;
    const owner: ProbeOwner = {
      run: (spec: ProbeSpec) => {
        if (!moved && spec.args[0] === "rev-list") {
          moved = true;
          git("update-ref", "refs/heads/work", a);
          git("update-ref", "refs/remotes/origin/dev", d);
          git("update-ref", "refs/remotes/origin/main", c);
        }
        return real.run(spec);
      },
      live: () => real.live(),
    };

    const snapshot = await snapshotDevAsync(owner, repo, "2026-10-04T12:00:00.000Z");

    expect(moved).toBe(true);
    expect(snapshot).toMatchObject({
      kind: "known",
      devSha: c,
      primarySha: b,
      primaryBehind: 1, // b..c — not a..c (2), which is what the moved HEAD would count
      trunkGap: 2, // a..c — not c..d (1), which is what the moved names would count
    });
  });

  it("agrees with the synchronous snapshot on a repository that is standing still", async () => {
    const a = commit("A");
    commit("B");
    const c = commit("C");
    git("update-ref", "refs/remotes/origin/dev", c);
    git("update-ref", "refs/remotes/origin/main", a);
    git("update-ref", "refs/heads/work", a);

    const nowIso = "2026-10-04T12:00:00.000Z";
    const sync = snapshotDev(repo, nowIso);
    expect(sync).toMatchObject({ kind: "known", devSha: c, primarySha: a, primaryBehind: 2, trunkGap: 2 });
    expect(await snapshotDevAsync(probeOwner(), repo, nowIso)).toEqual(sync);
  });

  it("says unknown, with the reason, where there is no origin/dev", async () => {
    commit("A");
    const snapshot = await snapshotDevAsync(probeOwner(), repo, "2026-10-04T12:00:00.000Z");
    expect(snapshot.kind).toBe("unknown");
    expect(snapshot.kind === "unknown" && snapshot.why).toMatch(/without origin\/dev/);
  });
});

describe("the readiness refresh latch", () => {
  const snapshot = { collectedAt: "2026-10-04T12:00:00.000Z" } as ReadinessSnapshot;

  it("does not start a second collection while one is in flight", async () => {
    let collections = 0;
    let finish: (s: ReadinessSnapshot) => void = () => {};
    const published: ReadinessSnapshot[] = [];
    const refresh = latchedReadinessRefresh({
      collect: () => {
        collections += 1;
        return new Promise<ReadinessSnapshot>((resolve) => {
          finish = resolve;
        });
      },
      publish: (s) => published.push(s),
      onError: (why) => {
        throw new Error(why);
      },
    });

    const first = refresh();
    const second = refresh();
    await second;
    expect(collections).toBe(1);
    expect(published).toEqual([]);

    finish(snapshot);
    await first;
    expect(published).toEqual([snapshot]);

    // PAIRED: the latch is a latch and not a wall — the next turn collects again.
    const third = refresh();
    expect(collections).toBe(2);
    finish(snapshot);
    await third;
    expect(published).toHaveLength(2);
  });

  it("publishes nothing from a failed collection, says why, and lets the next one run", async () => {
    const published: ReadinessSnapshot[] = [];
    const errors: string[] = [];
    let fail = true;
    const refresh = latchedReadinessRefresh({
      collect: async () => {
        if (fail) throw new Error("the scan fell over");
        return snapshot;
      },
      publish: (s) => published.push(s),
      onError: (why) => errors.push(why),
    });

    await refresh();
    expect(published).toEqual([]);
    expect(errors).toEqual(["the scan fell over"]);

    fail = false;
    await refresh();
    expect(published).toEqual([snapshot]);
  });
});
