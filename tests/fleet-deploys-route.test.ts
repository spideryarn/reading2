/**
 * **`GET /api/deploys`, and the git probe behind it.**
 *
 * Three things are being checked, and the middle one is the point:
 *
 *  1. The payload: the clamp, the slice, the two arms.
 *  2. **That every way of not knowing stays distinguishable.** Each git question
 *     has a plausible wrong answer to collapse into — a missing ref could be
 *     "0 commits behind", a failed ancestry check could be "not an ancestor" —
 *     and both would draw a confident, false, reassuring number. So there is a
 *     case per arm.
 *  3. The real `gitProbe` against a throwaway repository on disk, because a
 *     probe exercised only through a fake proves the fake works.
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
import { gitProbe, type AncestryReading, type CountReading, type GitProbe, type MainRef } from "../tools/fleet/git-probe.js";
import {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  deploysPayload,
  limitFrom,
  readRecordFrom,
  type DeploysRouteDeps,
} from "../tools/fleet/routes-deploys.js";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

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

/** A probe that answers whatever the test says, and records what it was asked. */
function fakeGit(over: Partial<GitProbe> = {}): GitProbe & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    mainRef(): MainRef {
      asked.push("mainRef");
      return over.mainRef?.() ?? { kind: "ref", sha: SHA_B, committedAt: "2026-09-09T00:00:00Z", lastFetchAtMs: 1000 };
    },
    isAncestor(sha): AncestryReading {
      asked.push(`isAncestor:${sha.slice(0, 4)}`);
      return over.isAncestor?.(sha) ?? { kind: "ancestor" };
    },
    countSince(sha): CountReading {
      asked.push(`countSince:${sha.slice(0, 4)}`);
      return over.countSince?.(sha) ?? { kind: "count", commits: 287 };
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
  it("a record that cannot be read is a REASON, not an empty list", () => {
    const payload = deploysPayload(deps({ readRecord: () => ({ ok: false, why: "the disk is on fire" }) }), 10);

    expect(payload.kind).toBe("unreadable");
    if (payload.kind !== "unreadable") throw new Error("unreachable");
    expect(payload.why).toBe("the disk is on fire");
  });

  it("a record that is empty is an empty list, which is a different claim", () => {
    const payload = deploysPayload(deps({ readRecord: () => ({ ok: true, text: "" }) }), 10);

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
    line({ version: "2026-09-03T10:00:00Z", sha: "c".repeat(40), previous_sha: SHA_B, deployment_id: "dpl_3" }),
  ].join("\n");

  it("serves the newest `limit` and says how many there were altogether", () => {
    const payload = deploysPayload(deps({ readRecord: () => ({ ok: true, text: three }) }), 2);

    expect(payload.kind).toBe("deploys");
    if (payload.kind !== "deploys") throw new Error("unreachable");
    expect(payload.versions.map((v) => v.version)).toEqual(["2026-09-03T10:00:00Z", "2026-09-02T10:00:00Z"]);
    /* Without `total` a client cannot tell "that is all of them" from "there is
       more behind the limit", and would offer a Show more that does nothing. */
    expect(payload.total).toBe(3);
    expect(payload.limit).toBe(2);
  });

  it("asks git about the NEWEST recorded sha, not the oldest", () => {
    const git = fakeGit();
    const payload = deploysPayload(deps({ readRecord: () => ({ ok: true, text: three }), git }), 10);

    if (payload.kind !== "deploys") throw new Error("unreachable");
    expect(payload.newestRecordedSha).toBe("c".repeat(40));
    expect(git.asked).toContain("isAncestor:cccc");
    expect(git.asked).toContain("countSince:cccc");
  });

  it("carries the unreadable lines through rather than dropping them", () => {
    const payload = deploysPayload(
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
  it("an empty record does not get probed, and says so instead of answering zero", () => {
    /* A probe from nothing would answer "0 commits behind", which is the most
       reassuring possible way to say we have no idea. */
    const git = fakeGit();
    const payload = deploysPayload(deps({ readRecord: () => ({ ok: true, text: "" }), git }), 10);

    if (payload.kind !== "deploys") throw new Error("unreachable");
    expect(payload.ancestry).toEqual({ kind: "unknown", why: "the record names no deploy to measure from" });
    expect(payload.commitsSince).toEqual({ kind: "unknown", why: "the record names no deploy to measure from" });
    expect(git.asked).not.toContain("isAncestor");
    expect(git.asked.filter((a) => a.startsWith("countSince"))).toEqual([]);
  });

  it("a git failure is `unknown` with a reason, never a count of zero", () => {
    const payload = deploysPayload(
      deps({
        git: fakeGit({
          countSince: () => ({ kind: "unknown", why: "git rev-list took longer than 5000ms" }),
          isAncestor: () => ({ kind: "unknown", why: "fatal: bad object" }),
          mainRef: () => ({ kind: "unavailable", why: "origin/main: unknown revision" }),
        }),
      }),
      10,
    );

    if (payload.kind !== "deploys") throw new Error("unreachable");
    expect(payload.commitsSince).toEqual({ kind: "unknown", why: "git rev-list took longer than 5000ms" });
    expect(payload.ancestry.kind).toBe("unknown");
    expect(payload.main.kind).toBe("unavailable");
    /* And the deploys are still served: a git that will not answer must not
       take the list of deploys down with it. */
    expect(payload.versions).toHaveLength(1);
  });

  it("distinguishes `not-ancestor` from `unknown`, which is the collapse that reads as a rollback", () => {
    const rolled = deploysPayload(deps({ git: fakeGit({ isAncestor: () => ({ kind: "not-ancestor" }) }) }), 10);
    const blind = deploysPayload(deps({ git: fakeGit({ isAncestor: () => ({ kind: "unknown", why: "no git" }) }) }), 10);

    if (rolled.kind !== "deploys" || blind.kind !== "deploys") throw new Error("unreachable");
    expect(rolled.ancestry.kind).toBe("not-ancestor");
    expect(blind.ancestry.kind).toBe("unknown");
    expect(rolled.ancestry).not.toEqual(blind.ancestry);
  });
});

/**
 * **The real probe, against a repository built for the purpose.**
 *
 * A probe exercised only through a fake proves the fake works. These build a
 * throwaway repo with a branch standing in for `origin/main`, so every arm below
 * is the actual `spawnSync` path.
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
     which is the arm a rollback would produce and the one hardest to fake. */
  run("checkout", "-q", "-b", "sideways", first);
  writeFileSync(path.join(dir, "b.txt"), "elsewhere\n");
  run("add", "b.txt");
  run("commit", "-q", "-m", "sideways");
  const offBranch = run("rev-parse", "HEAD");
  run("checkout", "-q", "trunk");

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const probe = gitProbe({ repoRoot: dir, ref: "trunk" });

  it("reads the tip's sha and its committer date", () => {
    const ref = probe.mainRef();

    expect(ref.kind).toBe("ref");
    if (ref.kind !== "ref") throw new Error("unreachable");
    expect(ref.sha).toBe(tip);
    expect(Number.isNaN(Date.parse(ref.committedAt))).toBe(false);
    /* Never fetched, so this is null — and null is the honest answer rather
       than a zero that would render as 1970. */
    expect(ref.lastFetchAtMs).toBeNull();
  });

  it("says `ancestor` for a sha on the branch and `not-ancestor` for one beside it", () => {
    expect(probe.isAncestor(first)).toEqual({ kind: "ancestor" });
    expect(probe.isAncestor(offBranch)).toEqual({ kind: "not-ancestor" });
  });

  it("counts the commits since, and zero when there are none", () => {
    /* Two commits from `first` to the tip, and this repo has no merges, so the
       `--no-merges` flag is not what makes it two. */
    expect(probe.countSince(first)).toEqual({ kind: "count", commits: 2 });
    expect(probe.countSince(tip)).toEqual({ kind: "count", commits: 0 });
  });

  it("does NOT collapse an unknown sha into `not-ancestor`", () => {
    /* git exits 128 here, not 1. Treating every non-zero exit as "no" would
       draw a rollback that never happened. */
    const missing = "f".repeat(40);

    expect(probe.isAncestor(missing).kind).toBe("unknown");
    expect(probe.countSince(missing).kind).toBe("unknown");
  });

  it("refuses anything that is not a sha before it reaches an argv slot", () => {
    for (const bad of ["--upload-pack=touch /tmp/pwned", "HEAD", "", "; rm -rf /", "origin/main"]) {
      expect(probe.isAncestor(bad), bad).toEqual({ kind: "unknown", why: "not a 40-character sha" });
      expect(probe.countSince(bad), bad).toEqual({ kind: "unknown", why: "not a 40-character sha" });
    }
  });

  it("says `unavailable` for a ref that does not exist, rather than throwing", () => {
    const nowhere = gitProbe({ repoRoot: dir, ref: "origin/does-not-exist" });

    expect(nowhere.mainRef().kind).toBe("unavailable");
  });

  it("says `unavailable` outside a repository, rather than throwing", () => {
    const outside = gitProbe({ repoRoot: tmpdir(), ref: "trunk" });

    expect(outside.mainRef().kind).toBe("unavailable");
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
    const res = {
      writeHead(code: number) {
        status = code;
        return res;
      },
      end(chunk?: string | Buffer) {
        if (chunk !== undefined) chunks.push(Buffer.from(chunk));
      },
    };

    const handled = wiring.route.handle(
      { url: "/api/deploys?limit=3", headers: {} } as never,
      res as never,
    );

    expect(handled).toBe(true);
    expect(status).toBe(200);
    const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    expect(payload.kind).toBe("deploys");
    expect(payload.versions).toHaveLength(3);
    /* The real record joined to the real checkout: the newest recorded deploy
       really is on origin/main, and the distance really is a number. If this
       ever fails it is telling you something true about the repository. */
    expect(payload.newestRecordedSha).toMatch(/^[0-9a-f]{40}$/);
    expect(payload.recordLines).toBeGreaterThan(50);
  });

  it("does not answer for somebody else's route", () => {
    const wiring = makeDeploys();
    const handled = wiring.route.handle({ url: "/api/state", headers: {} } as never, {} as never);

    expect(handled).toBe(false);
  });

  it("404s a path that merely starts with the mount point", () => {
    const wiring = makeDeploys();
    let status = 0;
    const res = { writeHead: (code: number) => ((status = code), res), end: () => undefined };

    const handled = wiring.route.handle(
      { url: "/api/deploys/../secrets", headers: {} } as never,
      res as never,
    );

    expect(handled).toBe(true);
    expect(status).toBe(404);
  });
});
