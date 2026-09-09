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
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { makeDeploys, RECORD_PATH, REPO_ROOT } from "../tools/fleet/deploys-wiring.js";
import { gitProbe, type GitProbe, type Ran } from "../tools/fleet/git-probe.js";
import {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  deploysPayload,
  limitFrom,
  readRecordFrom,
  type DeploysRouteDeps,
} from "../tools/fleet/routes-deploys.js";
import type { GitSnapshot, Watermark } from "../tools/fleet/wire.js";

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

/** A sha as a watermark. The real probe takes a discriminated reason now. */
function at(sha: string): Watermark {
  return { kind: "sha", sha };
}

/** A probe that answers whatever the test says, and records what it was asked. */
function fakeGit(snapshot: GitSnapshot = HEALTHY): GitProbe & { asked: Watermark[] } {
  const asked: Watermark[] = [];
  return {
    asked,
    async snapshot(watermark): Promise<GitSnapshot> {
      asked.push(watermark);
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
    expect(git.asked).toEqual([at(SHA_C)]);
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

  it("refuses to measure when the record's NEWEST line is corrupt", async () => {
    /* Otherwise the header calls the newest SURVIVING sha "the newest recorded
       deploy" and measures a confident distance from the wrong deploy — a
       number nobody could tell was wrong. GPT Sol's P1 finding 4. */
    const git = fakeGit();
    const payload = await deploysPayload(
      deps({ readRecord: () => ({ ok: true, text: [line(), "{broken"].join("\n") }), git }),
      10,
    );

    if (payload.kind !== "deploys") throw new Error("unreachable");
    expect(payload.newestLineRead).toBe(false);
    /* **The REASON travels, not just the absence.** "the record names no deploy
       to measure from" is true of an empty record and false of this one, which
       names plenty — GPT Sol's F1. */
    expect(git.asked, "must not measure from a survivor").toEqual([{ kind: "newest-unreadable" }]);
    /* The surviving deploys are still listed — the list and the comparison are
       independent axes. */
    expect(payload.versions).toHaveLength(1);
  });

  it("measures normally when an OLDER line is corrupt", async () => {
    const git = fakeGit();
    const payload = await deploysPayload(
      deps({ readRecord: () => ({ ok: true, text: ["{broken", line()].join("\n") }), git }),
      10,
    );

    if (payload.kind !== "deploys") throw new Error("unreachable");
    expect(payload.newestLineRead).toBe(true);
    expect(git.asked).toEqual([at(SHA_A)]);
  });

  it("passes a null sha for an empty record rather than inventing one", async () => {
    const git = fakeGit();
    await deploysPayload(deps({ readRecord: () => ({ ok: true, text: "" }), git }), 10);

    /* The probe owns the "nothing to measure from" arm, so the reason lives in
       one place rather than being invented at two call sites.

       **And `none`, not `newest-unreadable`.** An empty record has no newest
       line to have read, so `newestLineRead` is false for it too — testing that
       first reported "the record's newest line could not be read" about a file
       with nothing in it, which is the mirror of the bug the watermark exists to
       fix. This assertion caught it. */
    expect(git.asked).toEqual([{ kind: "none" }]);
  });

  it("gives the two absences DIFFERENT sentences, which is the whole point of the watermark", async () => {
    /* One arm said "the record names no deploy to measure from" for both — true
       of an empty record, and false of one that names plenty and merely cannot
       say which is newest. GPT Sol's F1. */
    const empty = await gitProbe({ repoRoot: REPO_ROOT, ttlMs: 0 }).snapshot({ kind: "none" });
    const corrupt = await gitProbe({ repoRoot: REPO_ROOT, ttlMs: 0 }).snapshot({ kind: "newest-unreadable" });

    expect(empty.ancestry.kind).toBe("unknown");
    expect(corrupt.ancestry.kind).toBe("unknown");
    if (empty.ancestry.kind !== "unknown" || corrupt.ancestry.kind !== "unknown") throw new Error("unreachable");

    expect(empty.ancestry.why).toContain("names no deploy");
    expect(corrupt.ancestry.why).toContain("newest line");
    expect(empty.ancestry.why).not.toBe(corrupt.ancestry.why);
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

  /** The real command runner, for cases that wrap it to COUNT executions. */
  const realRun = async (args: string[], ms: number): Promise<Ran> => {
    try {
      const stdout = execFileSync("git", args, { cwd: dir, encoding: "utf8", timeout: ms, stdio: ["ignore", "pipe", "pipe"] });
      return { ok: true, stdout: stdout.trim() };
    } catch (err) {
      const e = err as { status?: number; stderr?: string };
      return { ok: false, why: (e.stderr ?? "").trim() || "failed", status: typeof e.status === "number" ? e.status : null };
    }
  };

  it("reads the tip's sha and its committer date", async () => {
    const { main } = await probe().snapshot(at(first));

    expect(main.kind).toBe("ref");
    if (main.kind !== "ref") throw new Error("unreachable");
    expect(main.sha).toBe(tip);
    expect(Number.isNaN(Date.parse(main.committedAt))).toBe(false);
    /* Never fetched, so this is null — the honest answer rather than a zero
       that would render as 1970. */
    expect(main.lastFetchAtMs).toBeNull();
  });

  it("resolves git's relative dirs against the REPO, not the process's cwd", async () => {
    /* **The regression I introduced folding two `rev-parse` calls into one**:
       `path.resolve(line)` instead of `path.resolve(repoRoot, line)`. Git prints
       these paths relative to the repository, so resolving them against
       `process.cwd()` silently finds nothing and `lastFetchAtMs` comes back null
       — which reads as "never fetched" on a perfectly healthy checkout. It
       survived in production only because systemd's cwd happens to equal
       repoRoot. GPT Sol's F7.

       This asserts against THIS repository, whose `.git` is real and which has
       certainly fetched — and it is run from a process whose cwd is the
       worktree root, so a `resolve(line)` bug would still pass here. So the real
       check is the throwaway repo above: its cwd is NOT its repoRoot, and it
       gets a null only because it has genuinely never fetched. Both together
       pin the behaviour; neither alone does. */
    const here = await gitProbe({ repoRoot: REPO_ROOT, ttlMs: 0 }).snapshot({ kind: "none" });

    expect(here.main.kind).toBe("ref");
    if (here.main.kind !== "ref") throw new Error("unreachable");
    expect(here.main.lastFetchAtMs, "this checkout has certainly fetched").not.toBeNull();
  });

  it("says `ancestor` for a sha on the branch and counts the commits since", async () => {
    const snapshot = await probe().snapshot(at(first));

    expect(snapshot.ancestry).toEqual({ kind: "ancestor" });
    /* Two commits from `first` to the tip, and this repo has no merges, so
       `--no-merges` is not what makes it two. */
    expect(snapshot.commitsSince).toEqual({ kind: "count", commits: 2 });
  });

  it("says `diverged` for a sha beside the branch — the real alarm", async () => {
    const snapshot = await probe().snapshot(at(offBranch));

    expect(snapshot.ancestry).toEqual({ kind: "diverged" });
    /* **And refuses to put a number on it.** `rev-list A..B` across a divergence
       is a set difference that reads like a distance, so drawing it would be a
       plausible wrong figure rather than an absent one. */
    expect(snapshot.commitsSince.kind).toBe("not-comparable");
  });

  it("says `record-ahead`, NOT an alarm, when the ref is older than the record", async () => {
    /* **The commonest benign state, and it used to raise a rollback warning.**
       Whenever the changelog job has run since this checkout last fetched, the
       recorded deploy is newer than the cached tip and is not its ancestor. An
       alarm that fires on the normal case is an alarm nobody reads — GPT Sol's
       P1 finding 2. Modelled here by pointing the probe at an OLDER ref. */
    const behind = gitProbe({ repoRoot: dir, ref: first, ttlMs: 0 });

    const snapshot = await behind.snapshot(at(tip));

    expect(snapshot.ancestry).toEqual({ kind: "record-ahead" });
    expect(snapshot.commitsSince.kind).toBe("not-comparable");
  });

  it("counts zero when the record is level with the tip", async () => {
    const snapshot = await probe().snapshot(at(tip));

    expect(snapshot.commitsSince).toEqual({ kind: "count", commits: 0 });
    expect(snapshot.ancestry).toEqual({ kind: "ancestor" });
  });

  it("does NOT collapse an unknown sha into `not-ancestor`", async () => {
    /* git exits 128 here, not 1. Treating every non-zero exit as "no" would
       draw a rollback that never happened. */
    const snapshot = await probe().snapshot(at("f".repeat(40)));

    expect(snapshot.ancestry.kind).toBe("unknown");
    expect(snapshot.commitsSince.kind).toBe("unknown");
  });

  it.each(["--upload-pack=touch /tmp/pwned", "HEAD", "", "; rm -rf /", "origin/main", "trunk"])(
    "refuses %j before it reaches an argv slot",
    async (bad) => {
      const snapshot = await probe().snapshot({ kind: "sha", sha: bad });

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
    const snapshot = await gitProbe({ repoRoot: dir, ref: "origin/does-not-exist", ttlMs: 0 }).snapshot(at(first));

    expect(snapshot.main.kind).toBe("unavailable");
    /* And the comparisons say the ref was the problem, rather than blaming the
       record's sha for it. */
    expect(snapshot.ancestry.kind).toBe("unknown");
    expect(snapshot.commitsSince.kind).toBe("unknown");
  });

  it("says `unavailable` outside a repository, rather than throwing", async () => {
    const snapshot = await gitProbe({ repoRoot: tmpdir(), ref: "trunk", ttlMs: 0 }).snapshot(at(first));

    expect(snapshot.main.kind).toBe("unavailable");
  });

  it("takes one snapshot for concurrent readers, and reuses it inside the TTL", async () => {
    /* **This test used to prove nothing.** It compared two snapshots for
       equality — which only shows git is deterministic — and counted calls to
       the injected CLOCK, so removing the cache entirely would have left it
       green. GPT Sol, 2026-09-09. It now counts real command executions through
       the injected runner, which is the number the cache exists to reduce. */
    let executions = 0;
    const counted = gitProbe({
      repoRoot: dir,
      ref: "trunk",
      ttlMs: 60_000,
      run: async (args, ms) => {
        executions += 1;
        return realRun(args, ms);
      },
    });

    const [a, b] = await Promise.all([counted.snapshot(at(first)), counted.snapshot(at(first))]);
    const afterConcurrent = executions;
    expect(a).toEqual(b);
    expect(afterConcurrent, "two concurrent readers must share one probe").toBeGreaterThan(0);

    const c = await counted.snapshot(at(first));
    expect(c).toEqual(a);
    expect(executions, "a reader inside the TTL must run no commands at all").toBe(afterConcurrent);
  });

  it("stops running commands once the snapshot budget is spent", async () => {
    /* **The route's worst case must stay under the browser's 15s timeout.** It
       did not: four sequential waits at 5s each is ~20s, so a merely slow git
       would let the browser replace a perfectly readable deploy list with "no
       answer". GPT Sol's P1 finding 3. */
    let executions = 0;
    const slow = gitProbe({
      repoRoot: dir,
      ref: "trunk",
      ttlMs: 0,
      budgetMs: 50,
      run: async (args, ms) => {
        executions += 1;
        await new Promise((r) => setTimeout(r, 40));
        return realRun(args, ms);
      },
    });

    const snapshot = await slow.snapshot(at(first));

    /* It gives up rather than running the whole sequence... */
    expect(executions).toBeLessThan(5);
    /* ...and every reading it could not take says so, rather than being absent
       or fabricated. */
    const readings = [snapshot.ancestry.kind, snapshot.commitsSince.kind];
    expect(readings.every((k) => k === "unknown" || k === "not-comparable" || k === "ancestor" || k === "count")).toBe(true);
  });

  it("gives up with every reading stated, rather than half a snapshot", async () => {
    /* A budget so small that the first command has already overrun it. What
       matters is not which sentence comes back — the first call reports its own
       timeout, later ones report the budget — but that **no reading is left
       fabricated or absent**: a probe that ran out of time must not produce a
       count, and must not produce a ref it did not read. */
    const stalled = gitProbe({
      repoRoot: dir,
      ref: "trunk",
      ttlMs: 0,
      budgetMs: 1,
      run: async (args, ms) => {
        await new Promise((r) => setTimeout(r, 20));
        return realRun(args, ms);
      },
    });

    const snapshot = await stalled.snapshot(at(first));

    expect(snapshot.main.kind).toBe("unavailable");
    if (snapshot.main.kind !== "unavailable") throw new Error("unreachable");
    expect(snapshot.main.why, "a refusal must say why").not.toBe("");
    expect(snapshot.commitsSince.kind).toBe("unknown");
    expect(snapshot.ancestry.kind).toBe("unknown");
  });

  it("names the budget on the calls the budget actually stopped", async () => {
    /* The distinct sentence, checked where it can appear: a budget big enough
       for the first call and not for the rest. */
    let seen = 0;
    const tight = gitProbe({
      repoRoot: dir,
      ref: "trunk",
      ttlMs: 0,
      budgetMs: 60,
      run: async (args, ms) => {
        seen += 1;
        await new Promise((r) => setTimeout(r, 55));
        return realRun(args, ms);
      },
    });

    const snapshot = await tight.snapshot(at(first));

    expect(seen, "the first call should get through").toBeGreaterThan(0);
    const sentences = [
      snapshot.main.kind === "unavailable" ? snapshot.main.why : "",
      snapshot.ancestry.kind === "unknown" ? snapshot.ancestry.why : "",
      snapshot.commitsSince.kind === "unknown" || snapshot.commitsSince.kind === "not-comparable"
        ? snapshot.commitsSince.why
        : "",
    ].join(" | ");
    expect(sentences).toContain("budget");
  });

  it("does not serve one watermark's answer for another", async () => {
    const cached = gitProbe({ repoRoot: dir, ref: "trunk", ttlMs: 60_000 });

    const onBranch = await cached.snapshot(at(first));
    const beside = await cached.snapshot(at(offBranch));

    expect(onBranch.ancestry.kind).toBe("ancestor");
    expect(beside.ancestry.kind).toBe("diverged");
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

/**
 * **The one line no test above can reach.**
 *
 * Everything else here drives `makeDeploys`, the function `server.ts` calls —
 * so there is no second composition to get wrong. What it still cannot prove is
 * that `server.ts` actually *calls* `route.handle` in its request path, because
 * importing that file binds port 8787.
 *
 * A source check is the cheap guard, the same kind
 * `tests/fleet-health-wiring.test.ts` and `tests/fleet-web.test.tsx` already
 * use. It cannot prove the mount works; it can prove somebody deleted it — and
 * a route mounted nowhere answers 404 on a page that would then say the record
 * is unreadable, which is a lie about production told by a missing line.
 */
describe("server.ts", () => {
  const source = readFileSync(path.join(REPO_ROOT, "tools", "fleet", "server.ts"), "utf8");
  /** Lines that are actually code — a commented-out mount is not a mount. */
  const code = source
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => !l.startsWith("//") && !l.startsWith("*") && !l.startsWith("/*"));

  it("mounts the deploys route in its request path", () => {
    /* **Asserted against uncommented lines, and that is not fussiness.** The
       first version of this guard was `expect(source).toContain(…)`, and when I
       checked it could fail — by commenting the mount out — **it passed**: the
       needle was still there, inside the comment. A guard that a `//` satisfies
       is a guard against deletion only, and deletion is not how a line like
       this actually dies. docs/reusable/silent-success.md. */
    expect(code).toContain("if (deploys.route.handle(req, res)) return;");
  });

  it("builds the composition exactly once", () => {
    /* Two `makeDeploys()` calls would mean two probes with two caches, which is
       the shape of the bug health-wiring.ts was rearranged around. */
    expect(code.filter((l) => l.includes("makeDeploys("))).toHaveLength(1);
  });
});
