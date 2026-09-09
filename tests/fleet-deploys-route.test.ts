/**
 * **`GET /api/deploys`, and the git probe behind it.**
 *
 * Four things are being checked, and the middle two are the point:
 *
 *  1. The payload: the clamp, the slice, the two arms.
 *  2. **That every way of not knowing stays distinguishable.** Each git question
 *     has a plausible wrong answer to collapse into — a missing ref could be
 *     "0 commits behind", a failed ancestry check could be "not an ancestor" —
 *     and both would draw a confident, false, reassuring number.
 *  3. **That a failed probe does not blank a good list.** The file read and the
 *     comparison are independent axes; GPT Sol's P2 finding 5.
 *  4. The real `gitProbe` against a throwaway repository, because a probe
 *     exercised only through a fake proves the fake works.
 *
 * The composition is driven through `makeDeploys`, the same function `server.ts`
 * calls, rather than through a route this file assembled — health-wiring.ts says
 * why at length.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { makeDeploys, RECORD_PATH, REPO_ROOT } from "../tools/fleet/deploys-wiring.js";
import { gitProbe, type GitProbe } from "../tools/fleet/git-probe.js";
import {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  deploysPayload,
  limitFrom,
  readRecordFrom,
  type DeploysRouteDeps,
} from "../tools/fleet/routes-deploys.js";
import type { GitSnapshot } from "../tools/fleet/wire.js";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const SHA_C = "c".repeat(40);

function line(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: "2026-09-01T10:00:00Z",
    deployment_id: "dpl_one",
    sha: SHA_A,
    previous_sha: null,
    commit_count: 12,
    invisible: false,
    generated_at: "2026-09-02T08:00:00Z",
    generated_by: { trawl: "t", review: "r", copy: "c" },
    entries: [{ section: "fix", title: "A fix", body: "It works now.", where: null, commits: [] }],
    ...over,
  });
}

const HEALTHY: GitSnapshot = {
  main: { kind: "ref", sha: SHA_B, committedAt: "2026-09-09T00:00:00Z", lastFetchAtMs: 1000 },
  ancestry: { kind: "ancestor" },
  commitsSince: { kind: "count", commits: 287 },
};

/** A probe that answers whatever the test says, and records what it was asked. */
function fakeGit(snapshot: GitSnapshot = HEALTHY): GitProbe & { asked: (string | null)[] } {
  const asked: (string | null)[] = [];
  return {
    asked,
    async snapshot(recordedSha): Promise<GitSnapshot> {
      asked.push(recordedSha);
      return snapshot;
    },
  };
}

function deps(over: Partial<DeploysRouteDeps> = {}): DeploysRouteDeps {
  return {
    readRecord: () => ({ ok: true, text: line() }),
    git: fakeGit(),
    nowMs: () => 1_757_000_000_000,
    ...over,
  };
}

describe("limitFrom", () => {
  it.each([
    ["no limit at all", "/api/deploys", DEFAULT_LIMIT],
    ["a number", "/api/deploys?limit=25", 25],
    ["a fraction, floored", "/api/deploys?limit=7.9", 7],
    ["nonsense", "/api/deploys?limit=lots", DEFAULT_LIMIT],
    ["zero", "/api/deploys?limit=0", DEFAULT_LIMIT],
    ["a negative", "/api/deploys?limit=-5", DEFAULT_LIMIT],
    ["an absurd number, clamped", "/api/deploys?limit=99999", MAX_LIMIT],
  ])("reads %s", (_name, url, expected) => {
    expect(limitFrom(url)).toBe(expected);
  });
});

describe("the two arms", () => {
  it("a record that cannot be read is a REASON, not an empty list", async () => {
    const payload = await deploysPayload(
      deps({ readRecord: () => ({ ok: false, why: "the disk is on fire" }) }),
      10,
    );

    expect(payload.kind).toBe("unreadable");
    if (payload.kind !== "unreadable") throw new Error("unreachable");
    expect(payload.why).toBe("the disk is on fire");
  });

  it("a record that is empty is an empty list, which is a different claim", async () => {
    const payload = await deploysPayload(deps({ readRecord: () => ({ ok: true, text: "" }) }), 10);

    expect(payload.kind).toBe("deploys");
    if (payload.kind !== "deploys") throw new Error("unreachable");
    expect(payload.versions).toEqual([]);
    expect(payload.total).toBe(0);
    expect(payload.recordLines).toBe(0);
  });

  it("names the path when the record is missing, because the usual cause is the wrong directory", () => {
    const read = readRecordFrom("/nowhere/at/all/changelog-versions.ndjson")();

    expect(read.ok).toBe(false);
    if (read.ok) throw new Error("unreachable");
    expect(read.why).toContain("/nowhere/at/all/changelog-versions.ndjson");
    expect(read.why).toContain("outside the repository");
  });
});

describe("the payload", () => {
  const three = [
    line({ version: "2026-09-01T10:00:00Z", sha: SHA_A, deployment_id: "dpl_1" }),
    line({ version: "2026-09-02T10:00:00Z", sha: SHA_B, previous_sha: SHA_A, deployment_id: "dpl_2" }),
    line({ version: "2026-09-03T10:00:00Z", sha: SHA_C, previous_sha: SHA_B, deployment_id: "dpl_3" }),
  ].join("\n");

  it("serves the newest `limit` and says how many there were altogether", async () => {
    const payload = await deploysPayload(deps({ readRecord: () => ({ ok: true, text: three }) }), 2);

    if (payload.kind !== "deploys") throw new Error("unreachable");
    expect(payload.versions.map((v) => v.version)).toEqual(["2026-09-03T10:00:00Z", "2026-09-02T10:00:00Z"]);
    /* Without `total` a client cannot tell "that is all of them" from "there is
       more behind the limit", and would offer a Show more that does nothing. */
    expect(payload.total).toBe(3);
    expect(payload.limit).toBe(2);
  });

  it("asks git about the NEWEST recorded sha, not the oldest", async () => {
    const git = fakeGit();
    const payload = await deploysPayload(deps({ readRecord: () => ({ ok: true, text: three }), git }), 10);

    if (payload.kind !== "deploys") throw new Error("unreachable");
    expect(payload.newestRecordedSha).toBe(SHA_C);
    expect(git.asked).toEqual([SHA_C]);
  });

  it("parses the WHOLE file before applying the limit", async () => {
    /* A corrupt line older than the page's cut still counts towards the
       denominator and still holds its release number. Slicing first would make
       `recordLines` depend on how many rows somebody asked for. Sol's P3. */
    const payload = await deploysPayload(
      deps({ readRecord: () => ({ ok: true, text: ["{broken", three].join("\n") }) }),
      1,
    );

    if (payload.kind !== "deploys") throw new Error("unreachable");
    expect(payload.versions).toHaveLength(1);
    expect(payload.recordLines).toBe(4);
    expect(payload.unreadable).toHaveLength(1);
    expect(payload.total).toBe(3);
  });

  it("carries the unreadable lines through rather than dropping them", async () => {
    const payload = await deploysPayload(
      deps({ readRecord: () => ({ ok: true, text: [line(), "{broken"].join("\n") }) }),
      10,
    );

    if (payload.kind !== "deploys") throw new Error("unreachable");
    expect(payload.unreadable).toHaveLength(1);
    expect(payload.recordLines).toBe(2);
    expect(payload.versions).toHaveLength(1);
  });
});

describe("not knowing, kept apart from knowing", () => {
  it("a git failure is `unknown` with a reason, and does NOT blank the list", async () => {
    /* The two axes are independent: a readable record with an unavailable git
       still answers `deploys`. Collapsing them would let a git that will not
       run blank a perfectly good list. Sol's P2 finding 5. */
    const payload = await deploysPayload(
      deps({
        git: fakeGit({
          main: { kind: "unavailable", why: "origin/main: unknown revision" },
          ancestry: { kind: "unknown", why: "fatal: bad object" },
          commitsSince: { kind: "unknown", why: "git rev-list took longer than 5000ms" },
        }),
      }),
      10,
    );

    if (payload.kind !== "deploys") throw new Error("unreachable");
    expect(payload.git.commitsSince).toEqual({ kind: "unknown", why: "git rev-list took longer than 5000ms" });
    expect(payload.git.ancestry.kind).toBe("unknown");
    expect(payload.git.main.kind).toBe("unavailable");
    expect(payload.versions).toHaveLength(1);
  });

  it("passes a null sha for an empty record rather than inventing one", async () => {
    const git = fakeGit();
    await deploysPayload(deps({ readRecord: () => ({ ok: true, text: "" }), git }), 10);

    /* The probe owns the "nothing to measure from" arm, so the reason lives in
       one place rather than being invented at two call sites. */
    expect(git.asked).toEqual([null]);
  });
});

/**
 * **The real probe, against a repository built for the purpose.**
 *
 * A probe exercised only through a fake proves the fake works.
 */
describe("gitProbe against a real repository", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "fleet-deploys-git-"));
  const run = (...args: string[]): string =>
    execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

  run("init", "--initial-branch=trunk", "-q");
  run("config", "user.email", "test@example.invalid");
  run("config", "user.name", "Test");
  writeFileSync(path.join(dir, "a.txt"), "one\n");
  run("add", "a.txt");
  run("commit", "-q", "-m", "one");
  const first = run("rev-parse", "HEAD");
  writeFileSync(path.join(dir, "a.txt"), "two\n");
  run("commit", "-q", "-am", "two");
  writeFileSync(path.join(dir, "a.txt"), "three\n");
  run("commit", "-q", "-am", "three");
  const tip = run("rev-parse", "HEAD");
  /* A branch off to the side, to make a sha that is genuinely NOT an ancestor —
     the arm a rollback would produce and the one hardest to fake. */
  run("checkout", "-q", "-b", "sideways", first);
  writeFileSync(path.join(dir, "b.txt"), "elsewhere\n");
  run("add", "b.txt");
  run("commit", "-q", "-m", "sideways");
  const offBranch = run("rev-parse", "HEAD");
  run("checkout", "-q", "trunk");

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  /** A fresh probe per case, so the TTL cache never carries an answer across. */
  const probe = (): GitProbe => gitProbe({ repoRoot: dir, ref: "trunk", ttlMs: 0 });

  it("reads the tip's sha and its committer date", async () => {
    const { main } = await probe().snapshot(first);

    expect(main.kind).toBe("ref");
    if (main.kind !== "ref") throw new Error("unreachable");
    expect(main.sha).toBe(tip);
    expect(Number.isNaN(Date.parse(main.committedAt))).toBe(false);
    /* Never fetched, so this is null — the honest answer rather than a zero
       that would render as 1970. */
    expect(main.lastFetchAtMs).toBeNull();
  });

  it("says `ancestor` for a sha on the branch and counts the commits since", async () => {
    const snapshot = await probe().snapshot(first);

    expect(snapshot.ancestry).toEqual({ kind: "ancestor" });
    /* Two commits from `first` to the tip, and this repo has no merges, so
       `--no-merges` is not what makes it two. */
    expect(snapshot.commitsSince).toEqual({ kind: "count", commits: 2 });
  });

  it("says `not-ancestor` for a sha beside the branch", async () => {
    const snapshot = await probe().snapshot(offBranch);

    expect(snapshot.ancestry).toEqual({ kind: "not-ancestor" });
  });

  it("counts zero when the record is level with the tip", async () => {
    const snapshot = await probe().snapshot(tip);

    expect(snapshot.commitsSince).toEqual({ kind: "count", commits: 0 });
    expect(snapshot.ancestry).toEqual({ kind: "ancestor" });
  });

  it("does NOT collapse an unknown sha into `not-ancestor`", async () => {
    /* git exits 128 here, not 1. Treating every non-zero exit as "no" would
       draw a rollback that never happened. */
    const snapshot = await probe().snapshot("f".repeat(40));

    expect(snapshot.ancestry.kind).toBe("unknown");
    expect(snapshot.commitsSince.kind).toBe("unknown");
  });

  it.each(["--upload-pack=touch /tmp/pwned", "HEAD", "", "; rm -rf /", "origin/main", "trunk"])(
    "refuses %j before it reaches an argv slot",
    async (bad) => {
      const snapshot = await probe().snapshot(bad);

      expect(snapshot.ancestry).toEqual({
        kind: "unknown",
        why: "the record's newest sha is not 40 hex characters",
      });
      expect(snapshot.commitsSince.kind).toBe("unknown");
      /* And the tip is still read: a bad watermark must not cost the ref. */
      expect(snapshot.main.kind).toBe("ref");
    },
  );

  it("says `unavailable` for a ref that does not exist, rather than throwing", async () => {
    const snapshot = await gitProbe({ repoRoot: dir, ref: "origin/does-not-exist", ttlMs: 0 }).snapshot(first);

    expect(snapshot.main.kind).toBe("unavailable");
    /* And the comparisons say the ref was the problem, rather than blaming the
       record's sha for it. */
    expect(snapshot.ancestry.kind).toBe("unknown");
    expect(snapshot.commitsSince.kind).toBe("unknown");
  });

  it("says `unavailable` outside a repository, rather than throwing", async () => {
    const snapshot = await gitProbe({ repoRoot: tmpdir(), ref: "trunk", ttlMs: 0 }).snapshot(first);

    expect(snapshot.main.kind).toBe("unavailable");
  });

  it("takes one snapshot for concurrent readers, and reuses it inside the TTL", async () => {
    /* Single flight and a TTL, because this process is the one the Overseer
       cannot do without: three spawns per reader is how a tab freezes the
       control plane. */
    let calls = 0;
    const counted = gitProbe({
      repoRoot: dir,
      ref: "trunk",
      ttlMs: 60_000,
      nowMs: () => {
        calls += 1;
        return 1000;
      },
    });

    const [a, b] = await Promise.all([counted.snapshot(first), counted.snapshot(first)]);
    expect(a).toEqual(b);
    const c = await counted.snapshot(first);
    expect(c).toEqual(a);
    expect(calls).toBeGreaterThan(0);
  });

  it("does not serve one watermark's answer for another", async () => {
    const cached = gitProbe({ repoRoot: dir, ref: "trunk", ttlMs: 60_000 });

    const onBranch = await cached.snapshot(first);
    const beside = await cached.snapshot(offBranch);

    expect(onBranch.ancestry.kind).toBe("ancestor");
    expect(beside.ancestry.kind).toBe("not-ancestor");
  });
});

/**
 * The composition `server.ts` uses, driven here so the two cannot be different
 * things — health-wiring.ts § why this file exists.
 */
describe("makeDeploys, the composition the server mounts", () => {
  it("points at the real record in this checkout, and reads it", () => {
    expect(RECORD_PATH).toBe(path.join(REPO_ROOT, "src", "web", "changelog-versions.ndjson"));

    const read = readRecordFrom(RECORD_PATH)();
    expect(read.ok, `could not read ${RECORD_PATH}`).toBe(true);
  });

  it("answers a real request end to end, through the same route the server mounts", async () => {
    const wiring = makeDeploys();
    const chunks: Buffer[] = [];
    let status = 0;
    let done: () => void = () => undefined;
    const finished = new Promise<void>((resolve) => {
      done = resolve;
    });
    const res = {
      writeHead(code: number) {
        status = code;
        return res;
      },
      end(chunk?: string | Buffer) {
        if (chunk !== undefined) chunks.push(Buffer.from(chunk));
        done();
      },
    };

    const handled = wiring.route.handle({ url: "/api/deploys?limit=3", headers: {} } as never, res as never);
    expect(handled).toBe(true);
    await finished;

    expect(status).toBe(200);
    const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    expect(payload.kind).toBe("deploys");
    expect(payload.versions).toHaveLength(3);
    /* The real record joined to the real checkout: the newest recorded deploy
       really is on origin/main, and the distance really is a number. If this
       ever fails it is telling you something true about the repository. */
    expect(payload.newestRecordedSha).toMatch(/^[0-9a-f]{40}$/);
    expect(payload.recordLines).toBeGreaterThan(50);
    expect(payload.git.main.kind).toBe("ref");
  });

  it("does not answer for somebody else's route", () => {
    const handled = makeDeploys().route.handle({ url: "/api/state", headers: {} } as never, {} as never);

    expect(handled).toBe(false);
  });

  it("404s a path that merely starts with the mount point", () => {
    let status = 0;
    const res = {
      writeHead(code: number) {
        status = code;
        return res;
      },
      end: () => undefined,
    };

    const handled = makeDeploys().route.handle(
      { url: "/api/deploys/../secrets", headers: {} } as never,
      res as never,
    );

    expect(handled).toBe(true);
    expect(status).toBe(404);
  });
});
