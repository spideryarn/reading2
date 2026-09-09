# Code review: a Deploys tab on an internal agent dashboard (round 2)

You reviewed the PLAN for this and returned four P1s and five P2s. I took most of them; this is the
code that resulted. **Weight this review higher than the last**: a plan-stage review cannot find a
handler that writes one field and then rejects the request.

## Context

`tools/fleet/` is an internal dashboard served on port 8787 on an always-on Hetzner box, showing the
~40 Claude Code agent sessions running in tmux there. One reader (Greg), usually on a phone over
Tailscale. It had three modes (tabs); this adds a fourth, "Deploys".

The deploy record is `src/web/changelog-versions.ndjson` — one line per production deploy, written by
a multi-stage agent pipeline Greg runs by hand, so it lags. The box has no `VERCEL_TOKEN` and the
Vercel CLI is logged out there.

## What you found last time, and what I did

- **P1-1 (live build stamps can split the ambiguous count).** VERIFIED your claim — `/build.json` and
  `/api/health` both exist and `deploy.ts` cross-checks them. **Not taken in this pass**: it is an
  outbound network call needing its own arms and cache, so it is named as the next step in the plan
  and in `routes-deploys.ts`. **But I did take the correctness half**: I verified that `deploy.ts`
  pushes to `main` and only *then* waits for Vercel, so my "everything on `main` has shipped or is
  shipping" was false. **Please check the replacement wording is actually true now** — that is the
  sentence this whole tab exists to get right.
- **P1-2 (a ref's mtime does not measure staleness).** Reproduced both halves myself on this box:
  `FETCH_HEAD`'s mtime *does* advance on a no-op fetch (so it says when we last asked), but it names
  whatever was last fetched (so it does not prove `origin/main` was refreshed), and the loose ref may
  be packed. Relabelled rather than removed. Check the label is now exactly what it measures.
- **P1-3 (corrupt entries become a quiet deploy).** Taken in full: `readChangelog()` in `deploys.ts`,
  a `changelogReadable` field on the wire, a separate arm in the panel.
- **P1-4 (`spawnSync` freezes the control plane).** Taken: `execFile`, one snapshot, single flight,
  15 s TTL.
- **P2-5** schema check added to the client. **P2-6** one resolved sha used for all three questions.
  **P2-7** the cross-parser test now compares field by field via a test-only import of
  `src/changelog.ts`. **P2-8** explicit `MODES` assertion. **P2-9** the dock Refresh now reaches the
  active panel.
- **Not taken:** adding `src/changelog.ts` to the fleet's import allowlist — you argued against it
  independently, on the grounds I had.

## What I want from you

1. **Did I actually fix P1-3 and P1-4, or only appear to?** Those are the two where a plausible patch
   can leave the hole open. For P1-4 specifically: is the single-flight/TTL correct under
   concurrency, and can any path still block the event loop?
2. **Is any sentence the panel renders still false or misleading?** This is the point of the whole
   tab. Read `DeploysPanel.tsx`'s copy against what the data can actually support.
3. Anything in the new async route that can hang, double-send a response, or leak a handle.
4. Whether the tests would actually catch a regression, or merely pass.

Findings as P0/P1/P2/P3 please. Be adversarial; I would rather hear it now.

## The full diff against origin/dev

```diff
diff --git a/tests/fleet-deploys-route.test.ts b/tests/fleet-deploys-route.test.ts
new file mode 100644
index 00000000..749677a0
--- /dev/null
+++ b/tests/fleet-deploys-route.test.ts
@@ -0,0 +1,434 @@
+/**
+ * **`GET /api/deploys`, and the git probe behind it.**
+ *
+ * Four things are being checked, and the middle two are the point:
+ *
+ *  1. The payload: the clamp, the slice, the two arms.
+ *  2. **That every way of not knowing stays distinguishable.** Each git question
+ *     has a plausible wrong answer to collapse into — a missing ref could be
+ *     "0 commits behind", a failed ancestry check could be "not an ancestor" —
+ *     and both would draw a confident, false, reassuring number.
+ *  3. **That a failed probe does not blank a good list.** The file read and the
+ *     comparison are independent axes; GPT Sol's P2 finding 5.
+ *  4. The real `gitProbe` against a throwaway repository, because a probe
+ *     exercised only through a fake proves the fake works.
+ *
+ * The composition is driven through `makeDeploys`, the same function `server.ts`
+ * calls, rather than through a route this file assembled — health-wiring.ts says
+ * why at length.
+ */
+import { execFileSync } from "node:child_process";
+import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
+import { tmpdir } from "node:os";
+import path from "node:path";
+
+import { afterAll, describe, expect, it } from "vitest";
+
+import { makeDeploys, RECORD_PATH, REPO_ROOT } from "../tools/fleet/deploys-wiring.js";
+import { gitProbe, type GitProbe } from "../tools/fleet/git-probe.js";
+import {
+  DEFAULT_LIMIT,
+  MAX_LIMIT,
+  deploysPayload,
+  limitFrom,
+  readRecordFrom,
+  type DeploysRouteDeps,
+} from "../tools/fleet/routes-deploys.js";
+import type { GitSnapshot } from "../tools/fleet/wire.js";
+
+const SHA_A = "a".repeat(40);
+const SHA_B = "b".repeat(40);
+const SHA_C = "c".repeat(40);
+
+function line(over: Record<string, unknown> = {}): string {
+  return JSON.stringify({
+    version: "2026-09-01T10:00:00Z",
+    deployment_id: "dpl_one",
+    sha: SHA_A,
+    previous_sha: null,
+    commit_count: 12,
+    invisible: false,
+    generated_at: "2026-09-02T08:00:00Z",
+    generated_by: { trawl: "t", review: "r", copy: "c" },
+    entries: [{ section: "fix", title: "A fix", body: "It works now.", where: null, commits: [] }],
+    ...over,
+  });
+}
+
+const HEALTHY: GitSnapshot = {
+  main: { kind: "ref", sha: SHA_B, committedAt: "2026-09-09T00:00:00Z", lastFetchAtMs: 1000 },
+  ancestry: { kind: "ancestor" },
+  commitsSince: { kind: "count", commits: 287 },
+};
+
+/** A probe that answers whatever the test says, and records what it was asked. */
+function fakeGit(snapshot: GitSnapshot = HEALTHY): GitProbe & { asked: (string | null)[] } {
+  const asked: (string | null)[] = [];
+  return {
+    asked,
+    async snapshot(recordedSha): Promise<GitSnapshot> {
+      asked.push(recordedSha);
+      return snapshot;
+    },
+  };
+}
+
+function deps(over: Partial<DeploysRouteDeps> = {}): DeploysRouteDeps {
+  return {
+    readRecord: () => ({ ok: true, text: line() }),
+    git: fakeGit(),
+    nowMs: () => 1_757_000_000_000,
+    ...over,
+  };
+}
+
+describe("limitFrom", () => {
+  it.each([
+    ["no limit at all", "/api/deploys", DEFAULT_LIMIT],
+    ["a number", "/api/deploys?limit=25", 25],
+    ["a fraction, floored", "/api/deploys?limit=7.9", 7],
+    ["nonsense", "/api/deploys?limit=lots", DEFAULT_LIMIT],
+    ["zero", "/api/deploys?limit=0", DEFAULT_LIMIT],
+    ["a negative", "/api/deploys?limit=-5", DEFAULT_LIMIT],
+    ["an absurd number, clamped", "/api/deploys?limit=99999", MAX_LIMIT],
+  ])("reads %s", (_name, url, expected) => {
+    expect(limitFrom(url)).toBe(expected);
+  });
+});
+
+describe("the two arms", () => {
+  it("a record that cannot be read is a REASON, not an empty list", async () => {
+    const payload = await deploysPayload(
+      deps({ readRecord: () => ({ ok: false, why: "the disk is on fire" }) }),
+      10,
+    );
+
+    expect(payload.kind).toBe("unreadable");
+    if (payload.kind !== "unreadable") throw new Error("unreachable");
+    expect(payload.why).toBe("the disk is on fire");
+  });
+
+  it("a record that is empty is an empty list, which is a different claim", async () => {
+    const payload = await deploysPayload(deps({ readRecord: () => ({ ok: true, text: "" }) }), 10);
+
+    expect(payload.kind).toBe("deploys");
+    if (payload.kind !== "deploys") throw new Error("unreachable");
+    expect(payload.versions).toEqual([]);
+    expect(payload.total).toBe(0);
+    expect(payload.recordLines).toBe(0);
+  });
+
+  it("names the path when the record is missing, because the usual cause is the wrong directory", () => {
+    const read = readRecordFrom("/nowhere/at/all/changelog-versions.ndjson")();
+
+    expect(read.ok).toBe(false);
+    if (read.ok) throw new Error("unreachable");
+    expect(read.why).toContain("/nowhere/at/all/changelog-versions.ndjson");
+    expect(read.why).toContain("outside the repository");
+  });
+});
+
+describe("the payload", () => {
+  const three = [
+    line({ version: "2026-09-01T10:00:00Z", sha: SHA_A, deployment_id: "dpl_1" }),
+    line({ version: "2026-09-02T10:00:00Z", sha: SHA_B, previous_sha: SHA_A, deployment_id: "dpl_2" }),
+    line({ version: "2026-09-03T10:00:00Z", sha: SHA_C, previous_sha: SHA_B, deployment_id: "dpl_3" }),
+  ].join("\n");
+
+  it("serves the newest `limit` and says how many there were altogether", async () => {
+    const payload = await deploysPayload(deps({ readRecord: () => ({ ok: true, text: three }) }), 2);
+
+    if (payload.kind !== "deploys") throw new Error("unreachable");
+    expect(payload.versions.map((v) => v.version)).toEqual(["2026-09-03T10:00:00Z", "2026-09-02T10:00:00Z"]);
+    /* Without `total` a client cannot tell "that is all of them" from "there is
+       more behind the limit", and would offer a Show more that does nothing. */
+    expect(payload.total).toBe(3);
+    expect(payload.limit).toBe(2);
+  });
+
+  it("asks git about the NEWEST recorded sha, not the oldest", async () => {
+    const git = fakeGit();
+    const payload = await deploysPayload(deps({ readRecord: () => ({ ok: true, text: three }), git }), 10);
+
+    if (payload.kind !== "deploys") throw new Error("unreachable");
+    expect(payload.newestRecordedSha).toBe(SHA_C);
+    expect(git.asked).toEqual([SHA_C]);
+  });
+
+  it("parses the WHOLE file before applying the limit", async () => {
+    /* A corrupt line older than the page's cut still counts towards the
+       denominator and still holds its release number. Slicing first would make
+       `recordLines` depend on how many rows somebody asked for. Sol's P3. */
+    const payload = await deploysPayload(
+      deps({ readRecord: () => ({ ok: true, text: ["{broken", three].join("\n") }) }),
+      1,
+    );
+
+    if (payload.kind !== "deploys") throw new Error("unreachable");
+    expect(payload.versions).toHaveLength(1);
+    expect(payload.recordLines).toBe(4);
+    expect(payload.unreadable).toHaveLength(1);
+    expect(payload.total).toBe(3);
+  });
+
+  it("carries the unreadable lines through rather than dropping them", async () => {
+    const payload = await deploysPayload(
+      deps({ readRecord: () => ({ ok: true, text: [line(), "{broken"].join("\n") }) }),
+      10,
+    );
+
+    if (payload.kind !== "deploys") throw new Error("unreachable");
+    expect(payload.unreadable).toHaveLength(1);
+    expect(payload.recordLines).toBe(2);
+    expect(payload.versions).toHaveLength(1);
+  });
+});
+
+describe("not knowing, kept apart from knowing", () => {
+  it("a git failure is `unknown` with a reason, and does NOT blank the list", async () => {
+    /* The two axes are independent: a readable record with an unavailable git
+       still answers `deploys`. Collapsing them would let a git that will not
+       run blank a perfectly good list. Sol's P2 finding 5. */
+    const payload = await deploysPayload(
+      deps({
+        git: fakeGit({
+          main: { kind: "unavailable", why: "origin/main: unknown revision" },
+          ancestry: { kind: "unknown", why: "fatal: bad object" },
+          commitsSince: { kind: "unknown", why: "git rev-list took longer than 5000ms" },
+        }),
+      }),
+      10,
+    );
+
+    if (payload.kind !== "deploys") throw new Error("unreachable");
+    expect(payload.git.commitsSince).toEqual({ kind: "unknown", why: "git rev-list took longer than 5000ms" });
+    expect(payload.git.ancestry.kind).toBe("unknown");
+    expect(payload.git.main.kind).toBe("unavailable");
+    expect(payload.versions).toHaveLength(1);
+  });
+
+  it("passes a null sha for an empty record rather than inventing one", async () => {
+    const git = fakeGit();
+    await deploysPayload(deps({ readRecord: () => ({ ok: true, text: "" }), git }), 10);
+
+    /* The probe owns the "nothing to measure from" arm, so the reason lives in
+       one place rather than being invented at two call sites. */
+    expect(git.asked).toEqual([null]);
+  });
+});
+
+/**
+ * **The real probe, against a repository built for the purpose.**
+ *
+ * A probe exercised only through a fake proves the fake works.
+ */
+describe("gitProbe against a real repository", () => {
+  const dir = mkdtempSync(path.join(tmpdir(), "fleet-deploys-git-"));
+  const run = (...args: string[]): string =>
+    execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
+
+  run("init", "--initial-branch=trunk", "-q");
+  run("config", "user.email", "test@example.invalid");
+  run("config", "user.name", "Test");
+  writeFileSync(path.join(dir, "a.txt"), "one\n");
+  run("add", "a.txt");
+  run("commit", "-q", "-m", "one");
+  const first = run("rev-parse", "HEAD");
+  writeFileSync(path.join(dir, "a.txt"), "two\n");
+  run("commit", "-q", "-am", "two");
+  writeFileSync(path.join(dir, "a.txt"), "three\n");
+  run("commit", "-q", "-am", "three");
+  const tip = run("rev-parse", "HEAD");
+  /* A branch off to the side, to make a sha that is genuinely NOT an ancestor —
+     the arm a rollback would produce and the one hardest to fake. */
+  run("checkout", "-q", "-b", "sideways", first);
+  writeFileSync(path.join(dir, "b.txt"), "elsewhere\n");
+  run("add", "b.txt");
+  run("commit", "-q", "-m", "sideways");
+  const offBranch = run("rev-parse", "HEAD");
+  run("checkout", "-q", "trunk");
+
+  afterAll(() => rmSync(dir, { recursive: true, force: true }));
+
+  /** A fresh probe per case, so the TTL cache never carries an answer across. */
+  const probe = (): GitProbe => gitProbe({ repoRoot: dir, ref: "trunk", ttlMs: 0 });
+
+  it("reads the tip's sha and its committer date", async () => {
+    const { main } = await probe().snapshot(first);
+
+    expect(main.kind).toBe("ref");
+    if (main.kind !== "ref") throw new Error("unreachable");
+    expect(main.sha).toBe(tip);
+    expect(Number.isNaN(Date.parse(main.committedAt))).toBe(false);
+    /* Never fetched, so this is null — the honest answer rather than a zero
+       that would render as 1970. */
+    expect(main.lastFetchAtMs).toBeNull();
+  });
+
+  it("says `ancestor` for a sha on the branch and counts the commits since", async () => {
+    const snapshot = await probe().snapshot(first);
+
+    expect(snapshot.ancestry).toEqual({ kind: "ancestor" });
+    /* Two commits from `first` to the tip, and this repo has no merges, so
+       `--no-merges` is not what makes it two. */
+    expect(snapshot.commitsSince).toEqual({ kind: "count", commits: 2 });
+  });
+
+  it("says `not-ancestor` for a sha beside the branch", async () => {
+    const snapshot = await probe().snapshot(offBranch);
+
+    expect(snapshot.ancestry).toEqual({ kind: "not-ancestor" });
+  });
+
+  it("counts zero when the record is level with the tip", async () => {
+    const snapshot = await probe().snapshot(tip);
+
+    expect(snapshot.commitsSince).toEqual({ kind: "count", commits: 0 });
+    expect(snapshot.ancestry).toEqual({ kind: "ancestor" });
+  });
+
+  it("does NOT collapse an unknown sha into `not-ancestor`", async () => {
+    /* git exits 128 here, not 1. Treating every non-zero exit as "no" would
+       draw a rollback that never happened. */
+    const snapshot = await probe().snapshot("f".repeat(40));
+
+    expect(snapshot.ancestry.kind).toBe("unknown");
+    expect(snapshot.commitsSince.kind).toBe("unknown");
+  });
+
+  it.each(["--upload-pack=touch /tmp/pwned", "HEAD", "", "; rm -rf /", "origin/main", "trunk"])(
+    "refuses %j before it reaches an argv slot",
+    async (bad) => {
+      const snapshot = await probe().snapshot(bad);
+
+      expect(snapshot.ancestry).toEqual({
+        kind: "unknown",
+        why: "the record's newest sha is not 40 hex characters",
+      });
+      expect(snapshot.commitsSince.kind).toBe("unknown");
+      /* And the tip is still read: a bad watermark must not cost the ref. */
+      expect(snapshot.main.kind).toBe("ref");
+    },
+  );
+
+  it("says `unavailable` for a ref that does not exist, rather than throwing", async () => {
+    const snapshot = await gitProbe({ repoRoot: dir, ref: "origin/does-not-exist", ttlMs: 0 }).snapshot(first);
+
+    expect(snapshot.main.kind).toBe("unavailable");
+    /* And the comparisons say the ref was the problem, rather than blaming the
+       record's sha for it. */
+    expect(snapshot.ancestry.kind).toBe("unknown");
+    expect(snapshot.commitsSince.kind).toBe("unknown");
+  });
+
+  it("says `unavailable` outside a repository, rather than throwing", async () => {
+    const snapshot = await gitProbe({ repoRoot: tmpdir(), ref: "trunk", ttlMs: 0 }).snapshot(first);
+
+    expect(snapshot.main.kind).toBe("unavailable");
+  });
+
+  it("takes one snapshot for concurrent readers, and reuses it inside the TTL", async () => {
+    /* Single flight and a TTL, because this process is the one the Overseer
+       cannot do without: three spawns per reader is how a tab freezes the
+       control plane. */
+    let calls = 0;
+    const counted = gitProbe({
+      repoRoot: dir,
+      ref: "trunk",
+      ttlMs: 60_000,
+      nowMs: () => {
+        calls += 1;
+        return 1000;
+      },
+    });
+
+    const [a, b] = await Promise.all([counted.snapshot(first), counted.snapshot(first)]);
+    expect(a).toEqual(b);
+    const c = await counted.snapshot(first);
+    expect(c).toEqual(a);
+    expect(calls).toBeGreaterThan(0);
+  });
+
+  it("does not serve one watermark's answer for another", async () => {
+    const cached = gitProbe({ repoRoot: dir, ref: "trunk", ttlMs: 60_000 });
+
+    const onBranch = await cached.snapshot(first);
+    const beside = await cached.snapshot(offBranch);
+
+    expect(onBranch.ancestry.kind).toBe("ancestor");
+    expect(beside.ancestry.kind).toBe("not-ancestor");
+  });
+});
+
+/**
+ * The composition `server.ts` uses, driven here so the two cannot be different
+ * things — health-wiring.ts § why this file exists.
+ */
+describe("makeDeploys, the composition the server mounts", () => {
+  it("points at the real record in this checkout, and reads it", () => {
+    expect(RECORD_PATH).toBe(path.join(REPO_ROOT, "src", "web", "changelog-versions.ndjson"));
+
+    const read = readRecordFrom(RECORD_PATH)();
+    expect(read.ok, `could not read ${RECORD_PATH}`).toBe(true);
+  });
+
+  it("answers a real request end to end, through the same route the server mounts", async () => {
+    const wiring = makeDeploys();
+    const chunks: Buffer[] = [];
+    let status = 0;
+    let done: () => void = () => undefined;
+    const finished = new Promise<void>((resolve) => {
+      done = resolve;
+    });
+    const res = {
+      writeHead(code: number) {
+        status = code;
+        return res;
+      },
+      end(chunk?: string | Buffer) {
+        if (chunk !== undefined) chunks.push(Buffer.from(chunk));
+        done();
+      },
+    };
+
+    const handled = wiring.route.handle({ url: "/api/deploys?limit=3", headers: {} } as never, res as never);
+    expect(handled).toBe(true);
+    await finished;
+
+    expect(status).toBe(200);
+    const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
+    expect(payload.kind).toBe("deploys");
+    expect(payload.versions).toHaveLength(3);
+    /* The real record joined to the real checkout: the newest recorded deploy
+       really is on origin/main, and the distance really is a number. If this
+       ever fails it is telling you something true about the repository. */
+    expect(payload.newestRecordedSha).toMatch(/^[0-9a-f]{40}$/);
+    expect(payload.recordLines).toBeGreaterThan(50);
+    expect(payload.git.main.kind).toBe("ref");
+  });
+
+  it("does not answer for somebody else's route", () => {
+    const handled = makeDeploys().route.handle({ url: "/api/state", headers: {} } as never, {} as never);
+
+    expect(handled).toBe(false);
+  });
+
+  it("404s a path that merely starts with the mount point", () => {
+    let status = 0;
+    const res = {
+      writeHead(code: number) {
+        status = code;
+        return res;
+      },
+      end: () => undefined,
+    };
+
+    const handled = makeDeploys().route.handle(
+      { url: "/api/deploys/../secrets", headers: {} } as never,
+      res as never,
+    );
+
+    expect(handled).toBe(true);
+    expect(status).toBe(404);
+  });
+});
diff --git a/tests/fleet-deploys.test.ts b/tests/fleet-deploys.test.ts
new file mode 100644
index 00000000..e0f83424
--- /dev/null
+++ b/tests/fleet-deploys.test.ts
@@ -0,0 +1,443 @@
+/**
+ * **The deploy record reader, and the check that it has not drifted from the
+ * file it reads.**
+ *
+ * `tools/fleet/deploys.ts` is a SECOND reader of a format `src/changelog.ts`
+ * already parses — the reasoning is in that file's header and in
+ * docs/plans/260909b, and the whole cost of the decision is that the two can
+ * drift. So the last describe block below reads **the real committed
+ * `src/web/changelog-versions.ndjson`**, not a fixture, and asserts the reader
+ * found one version per non-blank line with nothing it could not read.
+ *
+ * That is the test that can go red on a day nobody touched this file, which is
+ * the only kind of agreement worth having here — a fixture cut proves the reader
+ * parses the fixture, and would stay green through a format change forever
+ * (docs/reusable/silent-success.md).
+ */
+import { readFileSync } from "node:fs";
+import path from "node:path";
+import { fileURLToPath } from "node:url";
+
+import { describe, expect, it } from "vitest";
+
+/* **Test-only, and that is what makes it legal.** `tests/fleet-imports.test.ts`
+   walks the import graph rooted at `tools/`, so importing the product's own
+   parser here adds no runtime dependency for the dashboard — and it is the only
+   way to check that the fleet's second reader agrees with the first. */
+import { parseChangelog } from "../src/changelog.js";
+import {
+  lastGeneratedAt,
+  newestDeploy,
+  readDeploys,
+  type DeployVersion,
+} from "../tools/fleet/deploys.js";
+
+const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
+const REAL_FILE = path.join(ROOT, "src/web/changelog-versions.ndjson");
+
+const SHA_A = "a".repeat(40);
+const SHA_B = "b".repeat(40);
+const SHA_C = "c".repeat(40);
+
+/** A well-formed line, with anything the caller wants overridden. */
+function line(over: Record<string, unknown> = {}): string {
+  return JSON.stringify({
+    version: "2026-09-01T10:00:00Z",
+    deployment_id: "dpl_one",
+    sha: SHA_A,
+    previous_sha: null,
+    commit_count: 12,
+    invisible: false,
+    generated_at: "2026-09-02T08:00:00Z",
+    generated_by: { trawl: "t", review: "r", copy: "c" },
+    entries: [
+      {
+        id: "x",
+        section: "headline",
+        title: "A thing changed",
+        body: "In a way a reader would notice.",
+        where: "/read",
+        links: [],
+        commits: [SHA_B],
+        provenance: { sources: [0], verdicts: ["confirmed"] },
+      },
+    ],
+    ...over,
+  });
+}
+
+describe("readDeploys", () => {
+  it("returns versions newest first, which is the opposite of the file", () => {
+    const text = [
+      line({ version: "2026-09-01T10:00:00Z", sha: SHA_A, deployment_id: "dpl_1" }),
+      line({ version: "2026-09-02T10:00:00Z", sha: SHA_B, previous_sha: SHA_A, deployment_id: "dpl_2" }),
+      line({ version: "2026-09-03T10:00:00Z", sha: SHA_C, previous_sha: SHA_B, deployment_id: "dpl_3" }),
+    ].join("\n");
+
+    const read = readDeploys(text);
+
+    expect(read.versions.map((v) => v.version)).toEqual([
+      "2026-09-03T10:00:00Z",
+      "2026-09-02T10:00:00Z",
+      "2026-09-01T10:00:00Z",
+    ]);
+    expect(read.unreadable).toEqual([]);
+    expect(read.lines).toBe(3);
+  });
+
+  it("numbers releases from the OLDEST line, so the newest has the highest number", () => {
+    const text = [line({ deployment_id: "dpl_1" }), line({ version: "2026-09-02T10:00:00Z", sha: SHA_B, deployment_id: "dpl_2" })].join("\n");
+
+    expect(readDeploys(text).versions.map((v) => v.release)).toEqual([2, 1]);
+  });
+
+  it("skips blank lines without counting them", () => {
+    const read = readDeploys(`\n${line()}\n\n`);
+
+    expect(read.lines).toBe(1);
+    expect(read.versions).toHaveLength(1);
+    expect(read.versions[0]?.release).toBe(1);
+  });
+
+  it("derives `invisible` from the entries rather than trusting the field", () => {
+    /* The file says one thing and the entries say another. What is on screen is
+       what is in `entries`, so a line claiming to be quiet cannot hide them. */
+    const read = readDeploys(line({ invisible: true }));
+
+    expect(read.versions[0]?.invisible).toBe(false);
+    expect(read.versions[0]?.entries).toHaveLength(1);
+  });
+
+  it("reads a quiet deploy as quiet", () => {
+    const read = readDeploys(line({ invisible: true, entries: [] }));
+
+    expect(read.versions[0]?.invisible).toBe(true);
+    expect(read.versions[0]?.changelogReadable).toBe(true);
+    expect(read.unreadable).toEqual([]);
+  });
+});
+
+/**
+ * **"We could not read what changed" is not "nothing changed".**
+ *
+ * The hole GPT Sol found on 2026-09-09: `invisible` was `entries.length === 0`,
+ * so a line whose entries were missing or corrupt came out as a quiet deploy and
+ * the panel said *Nothing a reader would notice* — the exact opposite of the
+ * truth, with no error anywhere and a headline feature rendered as an empty
+ * deploy.
+ */
+describe("a changelog that cannot be read is not a quiet deploy", () => {
+  it.each([
+    ["entries missing altogether", { entries: undefined }],
+    ["entries not an array", { entries: "nope" }],
+    ["entries an object", { entries: { section: "fix" } }],
+    ["every entry unreadable", { entries: [{ section: "engineering", title: "t", body: "b" }] }],
+    ["an entry with no body", { entries: [{ section: "fix", title: "t" }] }],
+    ["loud with an empty array", { invisible: false, entries: [] }],
+  ])("%s reads as unreadable rather than quiet", (_name, over) => {
+    const read = readDeploys(line(over as Record<string, unknown>));
+    const version = read.versions[0];
+
+    expect(version, "the deploy itself must still be kept").toBeDefined();
+    expect(version?.changelogReadable, "changelogReadable").toBe(false);
+    expect(version?.invisible, "must NOT claim to be quiet").toBe(false);
+  });
+
+  it("keeps the readable entries and counts the rest", () => {
+    const read = readDeploys(
+      line({
+        entries: [
+          { section: "fix", title: "Kept", body: "This one parses." },
+          { section: "engineering", title: "Dropped", body: "Not a real section." },
+          { section: "headline", title: "", body: "No title." },
+        ],
+      }),
+    );
+    const version = read.versions[0];
+
+    expect(version?.entries.map((e) => e.title)).toEqual(["Kept"]);
+    expect(version?.unreadableEntries).toBe(2);
+    /* Something WAS read, so the changelog is readable — partially, and the
+       count says by how much. */
+    expect(version?.changelogReadable).toBe(true);
+    expect(version?.invisible).toBe(false);
+  });
+
+  it("a genuinely quiet deploy has nothing to count", () => {
+    const read = readDeploys(line({ invisible: true, entries: [] }));
+
+    expect(read.versions[0]?.unreadableEntries).toBe(0);
+    expect(read.versions[0]?.changelogReadable).toBe(true);
+    expect(read.versions[0]?.invisible).toBe(true);
+  });
+
+  it("ignores extra fields it does not know about", () => {
+    const read = readDeploys(line({ some_new_field: { a: 1 }, entries: [{ section: "fix", title: "t", body: "b", newField: 2 }] }));
+
+    expect(read.unreadable).toEqual([]);
+    expect(read.versions[0]?.changelogReadable).toBe(true);
+    expect(read.versions[0]?.entries).toHaveLength(1);
+  });
+});
+
+describe("a line that will not parse", () => {
+  it("is counted and NAMED, never swallowed", () => {
+    const read = readDeploys([line(), "{not json", line({ version: "2026-09-03T10:00:00Z", sha: SHA_C, deployment_id: "dpl_3" })].join("\n"));
+
+    expect(read.versions).toHaveLength(2);
+    expect(read.unreadable).toHaveLength(1);
+    expect(read.unreadable[0]).toContain("line 2");
+    expect(read.unreadable[0]).toContain("does not parse");
+  });
+
+  it("takes its own release number down with it, and moves nothing else", () => {
+    /* One unreadable line in the middle must not silently renumber every
+       release above it — the number is the join between this tab, /changelog and
+       the logo's build stamp. */
+    const read = readDeploys([line({ deployment_id: "dpl_1" }), "{not json", line({ version: "2026-09-03T10:00:00Z", sha: SHA_C, deployment_id: "dpl_3" })].join("\n"));
+
+    expect(read.versions.map((v) => v.release)).toEqual([3, 1]);
+    expect(read.lines).toBe(3);
+  });
+
+  it.each([
+    ["a version that is not a UTC stamp", { version: "yesterday" }, "not a UTC stamp"],
+    ["a version that is not a real date", { version: "2026-99-99T99:99:99Z" }, "not a real date"],
+    ["a short sha", { sha: "abc123" }, "not a 40-character sha"],
+    ["no deployment_id", { deployment_id: "" }, "no deployment_id"],
+    ["a previous_sha that is neither null nor a sha", { previous_sha: "nope" }, "neither null nor a sha"],
+    ["a line that is not an object", null, "not an object"],
+  ])("rejects %s with a sentence saying why", (_name, over, expected) => {
+    const text = over === null ? "[1,2,3]" : line(over as Record<string, unknown>);
+    const read = readDeploys(text);
+
+    expect(read.versions).toEqual([]);
+    expect(read.unreadable).toHaveLength(1);
+    expect(read.unreadable[0]).toContain(expected);
+  });
+});
+
+describe("the fields that may be missing without losing the deploy", () => {
+  it("carries a missing commit_count as null, not as zero", () => {
+    /* A line that does not say how many commits it shipped has not shipped
+       zero. Zero is a number a panel would draw and a reader would believe. */
+    for (const bad of [undefined, -1, 1.5, "12", null]) {
+      const read = readDeploys(line({ commit_count: bad }));
+      expect(read.versions[0]?.commitCount, `commit_count ${JSON.stringify(bad)}`).toBeNull();
+      expect(read.versions[0]?.version).toBe("2026-09-01T10:00:00Z");
+    }
+  });
+
+  it("keeps a real commit_count, including a genuine zero", () => {
+    expect(readDeploys(line({ commit_count: 0 })).versions[0]?.commitCount).toBe(0);
+    expect(readDeploys(line({ commit_count: 137 })).versions[0]?.commitCount).toBe(137);
+  });
+
+  it("carries a missing or malformed generated_at as null", () => {
+    expect(readDeploys(line({ generated_at: "whenever" })).versions[0]?.generatedAt).toBeNull();
+    expect(readDeploys(line({ generated_at: undefined })).versions[0]?.generatedAt).toBeNull();
+  });
+});
+
+describe("entries", () => {
+  it("drops an entry whose section is not one of the three", () => {
+    const read = readDeploys(line({ entries: [{ section: "engineering", title: "t", body: "b" }] }));
+
+    expect(read.versions[0]?.entries).toEqual([]);
+    /* **And the version does NOT read as quiet.** This assertion said the
+       opposite until 2026-09-09, and it was wrong in the way that matters: a
+       deploy whose only entry we could not parse has not shipped nothing, and
+       drawing it as quiet is the silent failure GPT Sol found. */
+    expect(read.versions[0]?.invisible).toBe(false);
+    expect(read.versions[0]?.changelogReadable).toBe(false);
+    expect(read.versions[0]?.unreadableEntries).toBe(1);
+  });
+
+  it("drops a sha that is not 40 hex characters, and keeps the rest", () => {
+    const read = readDeploys(
+      line({ entries: [{ section: "fix", title: "t", body: "b", commits: [SHA_B, "abc", 7, SHA_C] }] }),
+    );
+
+    expect(read.versions[0]?.entries[0]?.commits).toEqual([SHA_B, SHA_C]);
+  });
+
+  it("keeps `where` when it is there and nulls it when it is not", () => {
+    expect(readDeploys(line()).versions[0]?.entries[0]?.where).toBe("/read");
+    const bare = readDeploys(line({ entries: [{ section: "fix", title: "t", body: "b" }] }));
+    expect(bare.versions[0]?.entries[0]?.where).toBeNull();
+  });
+});
+
+describe("newestDeploy and lastGeneratedAt", () => {
+  it("newestDeploy is the head of the reversed list, and null for an empty record", () => {
+    const read = readDeploys([line({ deployment_id: "dpl_1" }), line({ version: "2026-09-04T10:00:00Z", sha: SHA_C, deployment_id: "dpl_3" })].join("\n"));
+
+    expect(newestDeploy(read)?.version).toBe("2026-09-04T10:00:00Z");
+    expect(newestDeploy(readDeploys(""))).toBeNull();
+  });
+
+  it("lastGeneratedAt takes the NEWEST stamp, not the last line's", () => {
+    /* A run that filled in an older gap leaves the freshest stamp somewhere
+       other than the end, and reading the end would understate how fresh the
+       record is. */
+    const read = readDeploys(
+      [
+        line({ deployment_id: "dpl_1", generated_at: "2026-09-07T08:00:00Z" }),
+        line({ version: "2026-09-02T10:00:00Z", sha: SHA_B, deployment_id: "dpl_2", generated_at: "2026-09-03T08:00:00Z" }),
+      ].join("\n"),
+    );
+
+    expect(lastGeneratedAt(read)).toBe("2026-09-07T08:00:00Z");
+  });
+
+  it("lastGeneratedAt is null when no line carries a usable stamp", () => {
+    expect(lastGeneratedAt(readDeploys(line({ generated_at: "nope" })))).toBeNull();
+    expect(lastGeneratedAt(readDeploys(""))).toBeNull();
+  });
+});
+
+/**
+ * **THE CHECK THAT CAN GO RED WITHOUT ANYBODY TOUCHING THIS BRANCH.**
+ *
+ * Everything above proves the reader parses text this file wrote. This proves it
+ * parses the file it is actually pointed at — which is the only half that
+ * notices the day the changelog format moves under it.
+ */
+describe("the real committed record", () => {
+  const text = readFileSync(REAL_FILE, "utf8");
+  const read = readDeploys(text);
+
+  it("reads every non-blank line", () => {
+    const nonBlank = text.split("\n").filter((l) => l.trim() !== "").length;
+
+    expect(read.lines).toBe(nonBlank);
+    expect(read.unreadable).toEqual([]);
+    expect(read.versions).toHaveLength(nonBlank);
+    /* Not a fixture with three lines in it. If this ever reads as a handful,
+       the path is wrong and every assertion above it is vacuous. */
+    expect(nonBlank).toBeGreaterThan(50);
+  });
+
+  it("comes back newest first, with releases counting up towards it", () => {
+    const versions = read.versions;
+    for (let i = 1; i < versions.length; i++) {
+      const newer = versions[i - 1] as DeployVersion;
+      const older = versions[i] as DeployVersion;
+      expect(newer.version > older.version, `${newer.version} should be later than ${older.version}`).toBe(true);
+      expect(newer.release).toBe(older.release + 1);
+    }
+    expect(versions[versions.length - 1]?.release).toBe(1);
+  });
+
+  it("has a sha, a deployment id and a commit count on every line", () => {
+    for (const v of read.versions) {
+      expect(v.sha, v.version).toMatch(/^[0-9a-f]{40}$/);
+      expect(v.deploymentId, v.version).not.toBe("");
+      /* A null here would be a real gap in the record rather than a reader
+         fault — and would mean the panel starts saying "not recorded" on a line
+         that used to carry a number. Worth failing over. */
+      expect(v.commitCount, v.version).not.toBeNull();
+    }
+  });
+
+  it("has something a reader would notice on at least some deploys", () => {
+    /* The count that collapses is the signal — changelog.md § The traps. A
+       reader that silently stopped recognising `entries` would leave every
+       version quiet, which renders as a plausible-looking list of empty
+       deploys. */
+    const loud = read.versions.filter((v) => !v.invisible);
+
+    expect(loud.length).toBeGreaterThan(10);
+    expect(loud.flatMap((v) => v.entries).length).toBeGreaterThan(50);
+  });
+
+  it("could read what changed on every line", () => {
+    /* `changelogReadable: false` on the real file would mean the record itself
+       has lost a deploy's entries — worth failing over, and the opposite of the
+       silent "quiet deploy" this reader used to produce. */
+    const unreadable = read.versions.filter((v) => !v.changelogReadable);
+
+    expect(unreadable.map((v) => v.version)).toEqual([]);
+  });
+});
+
+/**
+ * **THE TWO PARSERS, MADE TO AGREE FIELD BY FIELD.**
+ *
+ * "One accepted version per non-blank line" was the whole of the drift
+ * mitigation, and GPT Sol was right that it is not enough: it passes while this
+ * reader defaults fields, drops entries, or derives a different meaning from the
+ * same bytes. So both readers are run over the real file and every field the
+ * fleet uses is compared.
+ *
+ * **The import of `src/changelog.ts` here is test-only and adds no runtime
+ * dependency** — `tests/fleet-imports.test.ts` walks the import graph rooted at
+ * `tools/`, not at `tests/`, which is what makes this legal as well as useful.
+ * Sol's P2 finding 7.
+ */
+describe("the fleet reader agrees with the canonical one", () => {
+  const text = readFileSync(REAL_FILE, "utf8");
+  const mine = readDeploys(text);
+  const canonical = parseChangelog(text);
+
+  it("the canonical parser is happy with the file, so disagreement means US", () => {
+    /* Without this, a file that is simply broken would look like a reader that
+       disagrees, and the next person would go looking in the wrong module. */
+    expect(canonical.problems).toEqual([]);
+  });
+
+  it("finds the same versions, in opposite orders", () => {
+    expect(mine.versions).toHaveLength(canonical.versions.length);
+    /* Ours is newest first; the file, and therefore the canonical parser, is
+       oldest first. */
+    expect(mine.versions.map((v) => v.version)).toEqual(
+      canonical.versions.map((v) => v.version).reverse(),
+    );
+  });
+
+  it("agrees on every field the panel draws", () => {
+    const theirs = new Map(canonical.versions.map((v) => [v.version, v]));
+
+    for (const v of mine.versions) {
+      const other = theirs.get(v.version);
+      expect(other, `${v.version} is missing from the canonical parse`).toBeDefined();
+      if (other === undefined) continue;
+
+      expect(v.release, `${v.version} release`).toBe(other.release);
+      expect(v.sha, `${v.version} sha`).toBe(other.sha);
+      expect(v.previousSha, `${v.version} previousSha`).toBe(other.previous_sha);
+      expect(v.deploymentId, `${v.version} deploymentId`).toBe(other.deployment_id);
+      expect(v.commitCount, `${v.version} commitCount`).toBe(other.commit_count);
+      expect(v.generatedAt, `${v.version} generatedAt`).toBe(other.generated_at);
+      expect(v.invisible, `${v.version} invisible`).toBe(other.invisible);
+
+      /* The entries, in order, on the fields this tab renders. A reader that
+         quietly dropped one would pass every count above. */
+      expect(v.entries.map((e) => e.section), `${v.version} sections`).toEqual(
+        other.entries.map((e) => e.section),
+      );
+      expect(v.entries.map((e) => e.title), `${v.version} titles`).toEqual(
+        other.entries.map((e) => e.title),
+      );
+      expect(v.entries.map((e) => e.body), `${v.version} bodies`).toEqual(
+        other.entries.map((e) => e.body),
+      );
+      expect(v.entries.map((e) => e.where), `${v.version} wheres`).toEqual(
+        other.entries.map((e) => e.where),
+      );
+      expect(v.entries.map((e) => e.commits), `${v.version} commits`).toEqual(
+        other.entries.map((e) => e.commits),
+      );
+    }
+  });
+
+  it("accepts nothing the canonical parser would reject", () => {
+    /* The asymmetry that matters: this reader is deliberately more tolerant
+       about product rules it does not own (the headline cap, the link scheme,
+       the chain) but must not be more tolerant about what a version IS. */
+    const canonicalVersions = new Set(canonical.versions.map((v) => v.version));
+    const extra = mine.versions.filter((v) => !canonicalVersions.has(v.version));
+
+    expect(extra.map((v) => v.version)).toEqual([]);
+  });
+});
diff --git a/tests/fleet-web.test.tsx b/tests/fleet-web.test.tsx
index f5694c29..761068f9 100644
--- a/tests/fleet-web.test.tsx
+++ b/tests/fleet-web.test.tsx
@@ -39,6 +39,8 @@ import { createRoot, type Root } from "react-dom/client";
 import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
 
 import { App } from "../tools/fleet/web/src/App";
+import type { DeploysApi, DeploysView } from "../tools/fleet/web/src/deploys-client";
+import { MODES, MODE_LABELS } from "../tools/fleet/web/src/mode";
 import { freshness } from "../tools/fleet/web/src/Header";
 import { POLL_GIVE_UP_MS, POLL_MS } from "../tools/fleet/web/src/NewSessionPanel";
 import { STATUS_TIPS } from "../tools/fleet/web/src/SessionParts";
@@ -284,6 +286,80 @@ function state(over: Partial<FleetState> = {}): FleetState {
  * effects, and a transport whose teardown did nothing would leave two of these
  * running with nothing on screen to say so.
  */
+/**
+ * A deploy record that answers whatever the test says.
+ *
+ * Injected into `<App>` like every other seam here, so no test in this file can
+ * reach `fetch` — the panel's default is the real HTTP client, and a suite that
+ * quietly made real requests would pass while telling you nothing.
+ */
+function recordingDeploys(
+  replyOf: () => DeploysView = () => deploysView(),
+): { api: DeploysApi; asked: number[] } {
+  const asked: number[] = [];
+  const api: DeploysApi = {
+    fetch: async (limit) => {
+      asked.push(limit);
+      return replyOf();
+    },
+  };
+  return { api, asked };
+}
+
+/** A healthy git snapshot. Spread it when overriding one reading, so the other two survive. */
+function healthyGit(): Extract<DeploysView, { kind: "deploys" }>["git"] {
+  return {
+    main: {
+      kind: "ref",
+      sha: "8985e7b682d197e6eb48c9c5dfd07eb30eccd57c",
+      committedAt: "2026-09-09T00:32:12Z",
+      lastFetchAtMs: 1_788_912_000_000,
+    },
+    ancestry: { kind: "ancestor" },
+    commitsSince: { kind: "count", commits: 287 },
+  };
+}
+
+/** A readable record with one deploy in it, and anything the caller overrides. */
+function deploysView(over: Partial<Extract<DeploysView, { kind: "deploys" }>> = {}): DeploysView {
+  return {
+    schema: 1,
+    kind: "deploys",
+    versions: [
+      {
+        version: "2026-09-08T05:32:17Z",
+        release: 74,
+        deploymentId: "dpl_test",
+        sha: "8cd2206ae24e16c65f76ea9f954c5b300616cd57",
+        previousSha: "3b4d32f0a1b2c3d4e5f60718293a4b5c6d7e8f90",
+        commitCount: 137,
+        invisible: false,
+        changelogReadable: true,
+        unreadableEntries: 0,
+        generatedAt: "2026-09-08T07:06:51Z",
+        entries: [
+          {
+            section: "headline",
+            title: "Hover cards on links",
+            body: "See where a link goes before you follow it.",
+            where: "/read",
+            commits: [],
+          },
+        ],
+      },
+    ],
+    total: 74,
+    limit: 10,
+    unreadable: [],
+    recordLines: 74,
+    lastGeneratedAt: "2026-09-08T07:06:51Z",
+    newestRecordedSha: "8cd2206ae24e16c65f76ea9f954c5b300616cd57",
+    git: healthyGit(),
+    servedAtMs: 1_788_912_000_000,
+    ...over,
+  };
+}
+
 function manualTransport(): {
   transport: Transport;
   push: (next: FleetState) => void;
@@ -384,7 +460,7 @@ afterEach(() => {
  * thought it was exercising. The handful of tests that DO want the real wire
  * stub `fetch` and render `<App>` themselves.
  */
-function mount(transport: Transport): void {
+function mount(transport: Transport, deploysApi: DeploysApi = recordingDeploys().api): void {
   act(() =>
     root.render(
       <App
@@ -392,6 +468,7 @@ function mount(transport: Transport): void {
         rename={fakeRename()}
         actionsApi={recordingActions().api}
         messagesApi={recordingMessages().api}
+        deploysApi={deploysApi}
         actionsPollMs={3_600_000}
       />,
     ),
@@ -724,6 +801,224 @@ describe("the modes", () => {
   });
 });
 
+/**
+ * **The Deploys tab.**
+ *
+ * The three assertions docs/project/fleet-dashboard-modes.md § The test asks
+ * for, and the second of them is the one that earns its place: `MODES`,
+ * `MODE_LABELS`, `MODE_ICONS` and `MODE_TIPS` are all `Record<Mode, …>` and the
+ * compiler catches a half-registered mode — but **the mount in `App.tsx` is a
+ * plain ternary and nothing type-checks it**. A mode registered in all four with
+ * no arm there compiles, draws a button, switches the hash, and shows an empty
+ * page.
+ */
+describe("the deploys tab", () => {
+  it("is registered at all, which is the one thing the types cannot check", () => {
+    /* **`Record<Mode, …>` cannot catch a whole mode being lost.** `Mode` is
+       derived FROM `MODES`, so a merge that drops `"deploys"` from the array and
+       its entries from the four maps leaves every `Record<Mode, …>` perfectly
+       typed and the tab simply gone. Three sessions added a mode on the night of
+       2026-09-08 and git merges these additions with no conflict marker, so
+       "typecheck and count by eye" was the plan until GPT Sol pointed out that
+       the typecheck proves nothing here. This is the assertion instead. */
+    expect(MODES).toContain("deploys");
+    expect(MODE_LABELS.deploys).toBe("Deploys");
+  });
+
+  it("opens straight into it from the hash", async () => {
+    window.location.hash = "#deploys";
+    const feed = manualTransport();
+    mount(feed.transport);
+    await act(async () => undefined);
+
+    expect(container.textContent).toContain("Release 74");
+    expect(container.textContent).toContain("Hover cards on links");
+  });
+
+  it("draws the panel when the button is pressed — the missing-mount test", async () => {
+    const feed = manualTransport();
+    mount(feed.transport);
+    const button = [...container.querySelectorAll("button")].find((b) => b.textContent === "Deploys");
+    expect(button, "no Deploys button in the bar").toBeDefined();
+
+    act(() => button?.click());
+    await act(async () => undefined);
+
+    expect(window.location.hash).toBe("#deploys");
+    expect(container.textContent).toContain("Release 74");
+  });
+
+  it("says how stale the record is, and does not present the number as undeployed work", async () => {
+    window.location.hash = "#deploys";
+    const feed = manualTransport();
+    mount(feed.transport);
+    await act(async () => undefined);
+
+    const text = container.textContent ?? "";
+    expect(text).toContain("287");
+    expect(text).toContain("later non-merge commits");
+    expect(text).toContain("cached");
+    expect(text).toContain("may already have deployed");
+    expect(text).toContain("This view cannot tell which");
+
+    /* **The wording is load-bearing, and the check has to be about the CLAIM
+       rather than about a phrase.** "287 commits not yet deployed" would be
+       false — main is only ever written by a deploy — and it is the sentence a
+       later edit would find punchier. But *"a mix of deploys not yet written up
+       and a tip not yet deployed"* is true and says the opposite, and a blunt
+       `not.toContain("not yet deployed")` fails on it: the first version of this
+       assertion did exactly that, and the thing it caught was correct copy.
+       So what is forbidden is the NUMBER being given that reading directly.
+       routes-deploys.ts § The claim in the header. */
+    for (const lie of [
+      /\d+\s+commits?\s+(that are\s+)?(not yet|awaiting|pending|un)deploy/i,
+      /\d+\s+commits?\s+behind\s+production/i,
+      /\d+\s+undeployed/i,
+    ]) {
+      expect(text, `the count must not be described as undeployed work: ${lie}`).not.toMatch(lie);
+    }
+  });
+
+  it.each([
+    [
+      "the server could not read the record",
+      { kind: "unreadable", why: "there is no deploy record at /nope" } as DeploysView,
+      ["could not be read", "/nope", "statement about this dashboard"],
+    ],
+    [
+      "this browser got no answer",
+      { kind: "no-answer", why: "no answer in 15s" } as DeploysView,
+      ["did not get an answer from the box", "no answer in 15s"],
+    ],
+  ])("says WHICH nothing it is when %s", async (_name, reply, expected) => {
+    window.location.hash = "#deploys";
+    const feed = manualTransport();
+    mount(feed.transport, recordingDeploys(() => reply).api);
+    await act(async () => undefined);
+
+    for (const phrase of expected) expect(container.textContent).toContain(phrase);
+  });
+
+  it("tells an empty record apart from an unreadable one", async () => {
+    window.location.hash = "#deploys";
+    const feed = manualTransport();
+    mount(
+      feed.transport,
+      recordingDeploys(() => deploysView({ versions: [], total: 0, recordLines: 0 })).api,
+    );
+    await act(async () => undefined);
+
+    /* We READ it and it is empty — which must not draw as either failure, and
+       must not draw as a blank panel that reads "nothing has ever shipped". */
+    expect(container.textContent).toContain("read and holds no deploys");
+    expect(container.textContent).not.toContain("could not be read");
+  });
+
+  it("draws a quiet deploy as quiet rather than as an empty card", async () => {
+    window.location.hash = "#deploys";
+    const feed = manualTransport();
+    const quiet = deploysView();
+    if (quiet.kind !== "deploys") throw new Error("unreachable");
+    const only = quiet.versions[0];
+    if (only === undefined) throw new Error("unreachable");
+    mount(
+      feed.transport,
+      recordingDeploys(() => deploysView({ versions: [{ ...only, entries: [], invisible: true }] })).api,
+    );
+    await act(async () => undefined);
+
+    expect(container.textContent).toContain("Nothing a reader would notice");
+  });
+
+  it("shows a deploy that is not on main as the alarm it is, not as a shrug", async () => {
+    window.location.hash = "#deploys";
+    const feed = manualTransport();
+    mount(feed.transport, recordingDeploys(() => deploysView({ git: { ...healthyGit(), ancestry: { kind: "not-ancestor" } } })).api);
+    await act(async () => undefined);
+
+    expect(container.textContent).toContain("is not on main");
+    expect(container.textContent).toContain("rollback");
+  });
+
+  it("says a git reading failed rather than drawing a zero", async () => {
+    window.location.hash = "#deploys";
+    const feed = manualTransport();
+    mount(
+      feed.transport,
+      recordingDeploys(() =>
+        deploysView({
+          git: {
+            ...healthyGit(),
+            commitsSince: { kind: "unknown", why: "git rev-list took longer than 5000ms" },
+            ancestry: { kind: "unknown", why: "fatal: bad object" },
+          },
+        }),
+      ).api,
+    );
+    await act(async () => undefined);
+
+    const text = container.textContent ?? "";
+    expect(text).toContain("could not be measured");
+    expect(text).toContain("git rev-list took longer than 5000ms");
+    expect(text).toContain("could not be checked");
+    /* The specific collapse this guards: a failed count rendering as "0
+       commits ... behind", which is the most reassuring possible way to say we
+       have no idea. */
+    expect(text).not.toContain("0 commits on main");
+  });
+
+  it("asks for more when there are more, and says how many", async () => {
+    window.location.hash = "#deploys";
+    const feed = manualTransport();
+    const deploys = recordingDeploys();
+    mount(feed.transport, deploys.api);
+    await act(async () => undefined);
+
+    expect(deploys.asked).toEqual([10]);
+    const more = [...container.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Show more"));
+    expect(more?.textContent).toContain("73 older deploys");
+
+    act(() => more?.click());
+    await act(async () => undefined);
+    expect(deploys.asked).toEqual([10, 60]);
+  });
+
+  it("answers the dock's Refresh button, which claims to refresh the page", async () => {
+    /* The button's tooltip presents it as the page's refresh control. Until
+       2026-09-09 it refreshed the fleet feed only, so on this tab pressing it
+       did nothing — indistinguishable from a broken button, on the one page
+       whose job is to say whether things are broken. Sol's P2 finding 9. */
+    window.location.hash = "#deploys";
+    const feed = manualTransport();
+    const deploys = recordingDeploys();
+    mount(feed.transport, deploys.api);
+    await act(async () => undefined);
+    expect(deploys.asked).toEqual([10]);
+
+    const refresh = [...container.querySelectorAll("button")].find((b) => b.textContent === "Refresh");
+    expect(refresh, "no Refresh button").toBeDefined();
+    act(() => refresh?.click());
+    await act(async () => undefined);
+
+    expect(deploys.asked).toEqual([10, 10]);
+    /* And it still refreshes the feed, which was its original job. */
+    expect(feed.refreshes()).toBeGreaterThan(0);
+  });
+
+  it("counts the lines it could not read rather than showing a quietly short list", async () => {
+    window.location.hash = "#deploys";
+    const feed = manualTransport();
+    mount(
+      feed.transport,
+      recordingDeploys(() => deploysView({ unreadable: ["line 12: does not parse"], recordLines: 75 })).api,
+    );
+    await act(async () => undefined);
+
+    expect(container.textContent).toContain("1 of 75 lines in the record could not be read");
+    expect(container.textContent).toContain("line 12: does not parse");
+  });
+});
+
 describe("box health, whose shape belongs to somebody else", () => {
   it("says absent rather than drawing an empty panel", () => {
     window.location.hash = "#health";
@@ -1000,11 +1295,17 @@ describe("the bottom bar", () => {
   it("puts the mode switch in the bar at the bottom rather than in the masthead", () => {
     /* The move is the whole point of the port: on a phone the top of the screen
        is the furthest thing from a thumb. Asserted structurally, because a test
-       that only found the three buttons somewhere on the page would have passed
-       just as happily before the change. */
+       that only found the buttons somewhere on the page would have passed just
+       as happily before the change.
+
+       **Derived from `MODES` rather than written out.** Four sessions added a
+       tab on the night of 2026-09-08 and a hand-typed list here goes red for
+       each of them, in a file they are all editing — a conflict that teaches
+       nobody anything. What is actually being asserted is that the bar draws
+       every mode, in order, with its label, and that is what this now says. */
     const feed = manualTransport();
     mount(feed.transport);
-    expect(modeButtons().map((b) => b.textContent)).toEqual(["Sessions", "Box health", "Overseer"]);
+    expect(modeButtons().map((b) => b.textContent)).toEqual(MODES.map((m) => MODE_LABELS[m]));
     expect(container.querySelector("header")?.querySelector(".dock-modes")).toBeNull();
   });
 
@@ -1012,13 +1313,15 @@ describe("the bottom bar", () => {
     const feed = manualTransport();
     mount(feed.transport);
 
+    /** `aria-checked` down the bar, as the mode at `index` being the live one. */
+    const onlyOn = (index: number): string[] => MODES.map((_, i) => (i === index ? "true" : "false"));
     const checked = (): (string | null)[] => modeButtons().map((b) => b.getAttribute("aria-checked"));
-    expect(checked()).toEqual(["true", "false", "false"]);
+    expect(checked()).toEqual(onlyOn(MODES.indexOf("sessions")));
 
     const health = modeButtons().find((b) => b.textContent === "Box health");
     act(() => health?.click());
 
-    expect(checked()).toEqual(["false", "true", "false"]);
+    expect(checked()).toEqual(onlyOn(MODES.indexOf("health")));
     // And the class the stylesheet paints, which is what a sighted reader sees.
     expect(modeButtons().filter((b) => b.classList.contains("on")).map((b) => b.textContent)).toEqual([
       "Box health",
diff --git a/tools/fleet/deploys-wiring.ts b/tools/fleet/deploys-wiring.ts
new file mode 100644
index 00000000..15b42b26
--- /dev/null
+++ b/tools/fleet/deploys-wiring.ts
@@ -0,0 +1,66 @@
+/**
+ * The deploys composition, in one importable place.
+ *
+ * **The same lesson `health-wiring.ts` exists for.** A test that builds its own
+ * record path and its own probe, hands them to its own `deploysRoute` and reads
+ * the answer back proves the route works — and stays green if `server.ts` mounts
+ * it against a *different* path, which is the whole failure. So the composition
+ * lives here, `server.ts` holds nothing but a call to it, and
+ * `tests/fleet-deploys-route.test.ts` drives **the same function the server
+ * does**.
+ *
+ * What that still cannot prove is that `server.ts` calls `route.handle` in its
+ * request path — that line is in a file no test can import, because importing it
+ * binds port 8787. A source check covers it, the same guard
+ * `tests/fleet-health-wiring.test.ts` uses.
+ */
+import path from "node:path";
+import { fileURLToPath } from "node:url";
+
+import { gitProbe } from "./git-probe.js";
+import { deploysRoute, readRecordFrom, type DeploysPayload } from "./routes-deploys.js";
+
+/**
+ * The repository this dashboard is running out of.
+ *
+ * `tools/fleet/` → up two. Derived from this module's own location rather than
+ * from `process.cwd()`, which is whatever directory somebody happened to start
+ * the server from and has been the wrong answer before.
+ */
+export const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
+
+/**
+ * Where the deploy record lives.
+ *
+ * Under `src/web/` because it is imported by the public `/changelog` page
+ * through Vite's `?raw` — docs/project/changelog.md § The page. This tool only
+ * ever reads it.
+ */
+export const RECORD_PATH = path.join(REPO_ROOT, "src", "web", "changelog-versions.ndjson");
+
+export type DeploysWiring = {
+  route: {
+    handle(req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse): boolean;
+  };
+  /** What to say at startup: which record, and which checkout it is reading git from. */
+  lines: { log: string[] };
+};
+
+export function makeDeploys(options: { repoRoot?: string; recordPath?: string } = {}): DeploysWiring {
+  const repoRoot = options.repoRoot ?? REPO_ROOT;
+  const recordPath = options.recordPath ?? RECORD_PATH;
+
+  return {
+    route: deploysRoute({
+      readRecord: readRecordFrom(recordPath),
+      git: gitProbe({ repoRoot }),
+      nowMs: () => Date.now(),
+    }),
+    /* Named at startup rather than only on a request, because "the dashboard is
+       reading a record that is not the one you are editing" is a thing you want
+       to find in the log rather than by disbelieving a number on a phone. */
+    lines: { log: [`deploys record → ${recordPath}`] },
+  };
+}
+
+export type { DeploysPayload };
diff --git a/tools/fleet/deploys.ts b/tools/fleet/deploys.ts
new file mode 100644
index 00000000..7fbc41c4
--- /dev/null
+++ b/tools/fleet/deploys.ts
@@ -0,0 +1,294 @@
+/**
+ * **Reading the deploy record — `src/web/changelog-versions.ndjson` — for the
+ * Deploys tab.** Pure: text in, versions out, no clock and no filesystem.
+ *
+ * ## What this file is a record OF
+ *
+ * One production deploy on Vercel is one version, named by its timestamp, and
+ * the list of them is not in git: `main` is fast-forwarded a sha at a time by
+ * `scripts/deploy.ts`, so history alone cannot say which shas were deploy
+ * points. Vercel's deployment list is the source of truth and **this box cannot
+ * reach it** — no `VERCEL_TOKEN`, and the CLI is logged out. So the committed
+ * NDJSON is the whole record available here, and it is only as fresh as the last
+ * time somebody ran the changelog job. docs/project/changelog.md.
+ *
+ * ## Why this is a SECOND reader of a format that already has one
+ *
+ * `src/changelog.ts` is a complete, dependency-free parser for exactly this
+ * file, and reusing it is the first instinct and the house rule. It is not
+ * imported here, deliberately: `tests/fleet-imports.test.ts` pins the set of
+ * `src/` modules this tool may reach, and the rule behind that pin
+ * (docs/project/overseer-direction.md § Principles) is that the fleet dashboard
+ * must be movable to its own repo. `src/changelog.ts` is leaf and browser-safe
+ * but hardcodes the product's repository URL, its launch version and its three
+ * section names. **The fleet's relationship to this file is the one it has to
+ * tmux and to `~/.claude/projects`: an artefact at a path**, and the coupling
+ * belongs on the path rather than on the type.
+ *
+ * The cost is two readers that can drift, and the mitigation is a check that can
+ * go red rather than a comment: `tests/fleet-deploys.test.ts` reads the **real
+ * committed file** and asserts one version per non-blank line with nothing
+ * unreadable. Two independent readings that are able to disagree is the only
+ * kind of agreement worth having — docs/reusable/silent-success.md, and
+ * docs/plans/260909b.
+ *
+ * ## Tolerant, and loud about it
+ *
+ * A line that will not parse is **counted and placed**, never swallowed. The
+ * fleet's standing discipline (routes-health-history.ts) is that *we looked and
+ * there is nothing* and *we could not look* must never render the same way; the
+ * per-line version of that is a list that is quietly two entries short. So
+ * `unreadable` carries a sentence per bad line and the panel shows the count.
+ *
+ * What this does NOT re-check: the chain (`previous_sha` matching the line
+ * above), the two-headline cap, the link scheme. `src/changelog.ts` and
+ * `tests/changelog-file.test.ts` own those, and a second opinion here would be a
+ * second place to be wrong about the product's rules.
+ *
+ * **Its only import is `wire.ts`, which itself imports nothing** — so this stays
+ * a leaf the browser project can reach. The shapes live there rather than here
+ * because both ends read them, which is the twin-type problem wire.ts's header
+ * is about. `tests/fleet-imports.test.ts` walks every edge and would say so.
+ */
+
+import type {
+  DeployEntry,
+  DeploySection,
+  DeployVersion,
+} from "./wire.js";
+
+/**
+ * The three headings, as a runtime value.
+ *
+ * The TYPE lives in `wire.ts`, which both ends import and which may hold no
+ * runtime values at all. This array is the one thing that cannot live there,
+ * and it is derived from the type rather than beside it — `satisfies` makes a
+ * heading added to one and forgotten in the other a compile error rather than a
+ * section that silently never renders.
+ */
+export const DEPLOY_SECTIONS = ["headline", "enhancement", "fix"] as const satisfies readonly DeploySection[];
+
+export type { DeployEntry, DeploySection, DeployVersion };
+
+/**
+ * What a read found.
+ *
+ * `versions` is **newest first**, which is the opposite of the file. The file is
+ * append-only and therefore oldest first; a list of deploys is read from the top
+ * down, most recent first, so the reversal happens once, here, rather than in
+ * every caller.
+ */
+export type DeployRead = {
+  versions: DeployVersion[];
+  /** One sentence per line that would not parse. Never merely counted. */
+  unreadable: string[];
+  /** Non-blank lines seen, parsed or not. The denominator for any claim about the file. */
+  lines: number;
+};
+
+const SHA = /^[0-9a-f]{40}$/;
+const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
+
+function isRecord(v: unknown): v is Record<string, unknown> {
+  return typeof v === "object" && v !== null && !Array.isArray(v);
+}
+
+/** A string field, or null. Never `undefined`, never `"undefined"`. */
+function str(v: unknown): string | null {
+  return typeof v === "string" && v !== "" ? v : null;
+}
+
+function readEntry(raw: unknown): DeployEntry | null {
+  if (!isRecord(raw)) return null;
+  const section = raw.section;
+  if (typeof section !== "string" || !(DEPLOY_SECTIONS as readonly string[]).includes(section)) {
+    return null;
+  }
+  const title = str(raw.title);
+  const body = str(raw.body);
+  if (title === null || body === null) return null;
+  /* Shas are filtered rather than trusted: the panel draws them as links into
+     the repository, and a short or mistyped one is a 404 in the one place
+     somebody is most likely to click. The copy stage has produced one before —
+     changelog.md § Copy. */
+  const commits = Array.isArray(raw.commits)
+    ? raw.commits.filter((c): c is string => typeof c === "string" && SHA.test(c))
+    : [];
+  return { section: section as DeploySection, title, body, where: str(raw.where), commits };
+}
+
+/**
+ * **What changed on this deploy — and whether that could be read at all.**
+ *
+ * THE HOLE GPT SOL FOUND, AND IT IS THE ONE THAT MATTERS ON THIS PANEL.
+ * `invisible` used to be derived as `entries.length === 0`, so a line whose
+ * `entries` was missing, not an array, or full of unreadable objects came out as
+ * a *quiet deploy* — and the panel says "Nothing a reader would notice", which
+ * is the exact opposite of "we could not read what changed". A deploy that
+ * shipped a headline feature would render as one that shipped nothing, with no
+ * error anywhere. P1 finding 3, 2026-09-09.
+ *
+ * So three outcomes, not two:
+ *
+ *  - `entries: []` on a line that claims to be quiet → genuinely quiet;
+ *  - some readable, some not → what was read, plus a count of what was not;
+ *  - `entries` absent, not an array, or wholly unreadable on a line that claims
+ *    to be loud → **changelog unreadable, never quiet**.
+ *
+ * Its own function rather than a block inside `readVersion`, which was over the
+ * complexity limit with it inline — and this is the half worth reading on its
+ * own anyway.
+ */
+function readChangelog(raw: Record<string, unknown>): {
+  entries: DeployEntry[];
+  readable: boolean;
+  unreadable: number;
+} {
+  const entries: DeployEntry[] = [];
+  let unreadable = 0;
+
+  if (!Array.isArray(raw.entries)) {
+    /* No `entries` key at all, or not an array. Says nothing about whether the
+       deploy was quiet — so this must not answer that question. */
+    return { entries, readable: false, unreadable };
+  }
+
+  for (const e of raw.entries) {
+    const entry = readEntry(e);
+    if (entry !== null) entries.push(entry);
+    else unreadable += 1;
+  }
+  if (entries.length > 0) return { entries, readable: true, unreadable };
+
+  /* Nothing readable came out. That is only "quiet" if the line agrees it is
+     quiet AND nothing was dropped getting here; a line marked loud with an
+     empty array has lost its entries somewhere upstream. */
+  return { entries, readable: unreadable === 0 && raw.invisible === true, unreadable };
+}
+
+/**
+ * One line.
+ *
+ * Returns the version, or a sentence saying what was wrong with it. The three
+ * fields that can be missing without the line being useless — `commit_count`,
+ * `generated_at`, `invisible` — are coerced with a stated default rather than
+ * rejecting the whole deploy, because a version that has forgotten how many
+ * commits it shipped still has a time, a sha and its entries, and those are most
+ * of what this tab draws.
+ */
+function readVersion(raw: unknown, release: number, where: string): DeployVersion | string {
+  if (!isRecord(raw)) return `${where}: not an object`;
+
+  const version = str(raw.version);
+  if (version === null || !STAMP.test(version)) {
+    return `${where}: version ${JSON.stringify(raw.version)} is not a UTC stamp`;
+  }
+  /* The shape and the date are two questions, and `2026-99-99T99:99:99Z` passes
+     the first. It would reach the panel as `Invalid Date`, or as a `null` out of
+     `zonedLine` — which the panel can say something true about, but only if this
+     has not already claimed the line was fine. */
+  if (Number.isNaN(Date.parse(version))) {
+    return `${where}: version ${JSON.stringify(version)} is not a real date`;
+  }
+  const sha = str(raw.sha);
+  if (sha === null || !SHA.test(sha)) {
+    return `${where}: sha ${JSON.stringify(raw.sha)} is not a 40-character sha`;
+  }
+  const deploymentId = str(raw.deployment_id);
+  if (deploymentId === null) return `${where}: no deployment_id`;
+
+  const generatedAt = str(raw.generated_at);
+  const previous = raw.previous_sha;
+  if (previous !== null && !(typeof previous === "string" && SHA.test(previous))) {
+    return `${where}: previous_sha is neither null nor a sha`;
+  }
+
+  const changelog = readChangelog(raw);
+
+  const count = raw.commit_count;
+  const commitCount =
+    typeof count === "number" && Number.isInteger(count) && count >= 0 ? count : null;
+
+  return {
+    version,
+    release,
+    deploymentId,
+    sha,
+    previousSha: typeof previous === "string" ? previous : null,
+    commitCount,
+    /* **Quiet is a claim, and it is only made when it can be made.** Not
+       `entries.length === 0`: that reads an unreadable changelog as a deploy
+       with nothing in it. `changelogReadable` is false in exactly the cases
+       where this file cannot tell, and the panel draws that differently. */
+    invisible: changelog.readable && changelog.entries.length === 0,
+    changelogReadable: changelog.readable,
+    unreadableEntries: changelog.unreadable,
+    entries: changelog.entries,
+    generatedAt: generatedAt !== null && STAMP.test(generatedAt) ? generatedAt : null,
+  };
+}
+
+/**
+ * Read the whole file. Newest first.
+ *
+ * **`release` counts non-blank LINES, not successes.** A line that fails takes
+ * its own number down with it and nothing else moves — otherwise one unreadable
+ * line in the middle silently renumbers every release above it, and the number
+ * is the join between this tab, `/changelog` and the logo's build stamp.
+ * `src/changelog.ts` § `ChangelogVersion.release` makes the same call for the
+ * same reason.
+ */
+export function readDeploys(text: string): DeployRead {
+  const versions: DeployVersion[] = [];
+  const unreadable: string[] = [];
+  let release = 0;
+
+  for (const [i, line] of text.split("\n").entries()) {
+    if (line.trim() === "") continue;
+    release += 1;
+    const where = `line ${i + 1}`;
+    let raw: unknown;
+    try {
+      raw = JSON.parse(line);
+    } catch (err) {
+      unreadable.push(`${where}: does not parse (${(err as Error).message.slice(0, 60)})`);
+      continue;
+    }
+    const read = readVersion(raw, release, where);
+    if (typeof read === "string") unreadable.push(read);
+    else versions.push(read);
+  }
+
+  versions.reverse();
+  return { versions, unreadable, lines: release };
+}
+
+/**
+ * The newest version, or null for an empty record.
+ *
+ * The watermark: the sha the git probe asks its two questions about. Taken from
+ * the head of the reversed list rather than re-scanning, so there is one
+ * definition of "newest" and the panel and the probe cannot pick different ones.
+ */
+export function newestDeploy(read: DeployRead): DeployVersion | null {
+  return read.versions[0] ?? null;
+}
+
+/**
+ * When the record was last written — the newest `generated_at` on any line.
+ *
+ * **The newest, not the last line's.** They are usually the same and need not
+ * be: the pipeline appends in version order, and a run that fills in an older
+ * gap would leave the freshest stamp somewhere other than the end. This is the
+ * number the tab uses to say how stale the record is, and reading it off the
+ * wrong line would understate the freshness of a file that had just been
+ * updated. Empty when no line carries a usable stamp.
+ */
+export function lastGeneratedAt(read: DeployRead): string | null {
+  let newest: string | null = null;
+  for (const v of read.versions) {
+    if (v.generatedAt === null) continue;
+    if (newest === null || v.generatedAt > newest) newest = v.generatedAt;
+  }
+  return newest;
+}
diff --git a/tools/fleet/git-probe.ts b/tools/fleet/git-probe.ts
new file mode 100644
index 00000000..246e676a
--- /dev/null
+++ b/tools/fleet/git-probe.ts
@@ -0,0 +1,301 @@
+/**
+ * **The read-only questions this box can answer about production without a
+ * Vercel token**, taken as one snapshot, asynchronously, with an arm for every
+ * way of not knowing.
+ *
+ * ## Why git at all
+ *
+ * The deploy record (`src/web/changelog-versions.ndjson`) is written by a job
+ * Greg runs by hand, so it lags. Git is the one always-current source on this
+ * box: `main` is advanced only by `scripts/deploy.ts`, so `origin/main` is where
+ * production was last *pushed to*, and the distance from the newest recorded
+ * deploy to that tip is how far behind the record has fallen.
+ *
+ * **`origin/main` is not "what is serving".** `deploy.ts` pushes and only then
+ * waits for Vercel, so a build that failed or timed out leaves `main` advanced
+ * with nothing serving from it (deploy.ts § Push). Nothing here may say those
+ * commits shipped — GPT Sol's P1, 2026-09-09, and `routes-deploys.ts` § The
+ * claim in the header carries the wording that survived it.
+ *
+ * ## ASYNCHRONOUS, AND THAT IS NOT A STYLE CHOICE
+ *
+ * This was three `spawnSync` calls until GPT Sol pointed out what that means
+ * here: **the dashboard is one Node process and the Overseer has no independent
+ * source of fleet state** (overseer-direction.md). A slow disk or a loaded box
+ * would let one Deploys request block every session, every action, every
+ * heartbeat and every health request for the sum of three command timeouts —
+ * up to fifteen seconds of frozen control plane, caused by somebody opening a
+ * tab. So: `execFile`, bounded output, a timeout each, and a snapshot cached
+ * behind a single flight so concurrent readers cost one probe rather than
+ * three each.
+ *
+ * ## THIS NEVER FETCHES
+ *
+ * Not because fetching would disturb other agents — it would not; a fetch
+ * writes refs and touches no working tree — but because it is network work on
+ * every request, repeated for every reader, and it would let a caller mutate
+ * this repository's refs by loading a page. So `origin/main` here is **this
+ * checkout's cached view**, and `lastFetchAtMs` says when this checkout last
+ * fetched anything at all. Read that field's doc before drawing it: it is a
+ * weaker fact than it looks.
+ *
+ * ## Every failure is an arm, never a throw and never a zero
+ *
+ * Each of these questions has a plausible, reassuring wrong answer to collapse
+ * into — a missing ref could be `0` commits behind, an ancestry check that
+ * failed to run could be "not an ancestor". Both draw a confident false number.
+ *
+ * ## Spawning
+ *
+ * Fixed argv arrays, no shell, a timeout each, bounded output. The only
+ * interpolated value is a sha re-checked here against `/^[0-9a-f]{40}$/` at the
+ * point of use — it comes from a file rather than from a caller, but a
+ * validation next to the spawn is the one that survives somebody later passing
+ * it something else.
+ */
+import { execFile } from "node:child_process";
+import { stat } from "node:fs/promises";
+import path from "node:path";
+import { promisify } from "node:util";
+
+import type { AncestryReading, CountReading, GitSnapshot, MainRef } from "./wire.js";
+
+/**
+ * The readings are declared in `wire.ts` and re-exported here, so a caller that
+ * wants "what the probe answers" imports it from the probe. One declaration,
+ * two doors — the twin types wire.ts's header is about were two declarations.
+ */
+export type { AncestryReading, CountReading, GitSnapshot, MainRef };
+
+const run = promisify(execFile);
+
+/** Long enough for a cold cache on a loaded box, short enough not to hang a poll. */
+export const GIT_TIMEOUT_MS = 5_000;
+
+/**
+ * How long a snapshot stands.
+ *
+ * These values move when somebody deploys or fetches, which is minutes apart at
+ * best, and the panel is opened and re-opened by hand. Recomputing per request
+ * buys nothing and spends the box's time in the one process the Overseer cannot
+ * do without.
+ */
+export const SNAPSHOT_TTL_MS = 15_000;
+
+const SHA = /^[0-9a-f]{40}$/;
+
+/** Bounded, so a pathological repository cannot buffer a response into memory. */
+const MAX_OUTPUT_BYTES = 1024 * 1024;
+
+/** One question, and what it takes to ask it. */
+export type GitProbe = {
+  /**
+   * Everything, as one snapshot.
+   *
+   * **One method rather than three**, because the three answers must describe
+   * the same tip. `origin/main` is mutable between processes — a dozen agents
+   * fetch all night — so three independent calls can resolve the ref to A,
+   * check ancestry against B and count to C, and the response is then not a
+   * reading of anything. GPT Sol's P2 finding 6. The ref is resolved once and
+   * the literal sha is used for the rest.
+   */
+  snapshot(recordedSha: string | null): Promise<GitSnapshot>;
+};
+
+type Ran = { ok: true; stdout: string } | { ok: false; why: string; status: number | null };
+
+/**
+ * One git call.
+ *
+ * The ways it goes wrong need different sentences: git missing, a timeout, a
+ * non-zero exit (which for `merge-base --is-ancestor` is an ANSWER rather than
+ * a fault), and a throw.
+ */
+async function git(repoRoot: string, args: string[], timeoutMs: number): Promise<Ran> {
+  try {
+    const { stdout } = await run("git", args, {
+      cwd: repoRoot,
+      timeout: timeoutMs,
+      encoding: "utf8",
+      maxBuffer: MAX_OUTPUT_BYTES,
+      /* No shell, so nothing here is parsed by one. `env` is inherited: git
+         needs PATH, and this is a read-only call in a checkout this process
+         already lives in. */
+      windowsHide: true,
+    });
+    return { ok: true, stdout: stdout.trim() };
+  } catch (err) {
+    const e = err as NodeJS.ErrnoException & { code?: number | string; killed?: boolean; stderr?: string };
+    if (e.killed === true || e.code === "ETIMEDOUT") {
+      return { ok: false, why: `git ${args[0]} took longer than ${timeoutMs}ms`, status: null };
+    }
+    if (e.code === "ENOENT") return { ok: false, why: "git is not installed on this box", status: null };
+    const status = typeof e.code === "number" ? e.code : null;
+    /* First line only, and bounded: this reaches a page, and a page must not be
+       handed an unbounded string a subprocess chose. React escapes it; the cap
+       is about size rather than markup. */
+    const stderr = (e.stderr ?? "").trim().split("\n")[0]?.slice(0, 300) ?? "";
+    return {
+      ok: false,
+      why: stderr === "" ? `git ${args[0]} exited ${String(e.code)}` : stderr,
+      status,
+    };
+  }
+}
+
+/**
+ * When this checkout last fetched **anything**, from `FETCH_HEAD`'s mtime.
+ *
+ * **A weaker fact than it looks, and it must be labelled as what it is.**
+ * Measured on this box, 2026-09-09, after GPT Sol's P1 finding 2:
+ *
+ *  - A **no-op** fetch does advance `FETCH_HEAD`'s mtime (01:16:00 → 01:16:02),
+ *    while the loose `refs/remotes/origin/main` file's mtime does not move. So
+ *    the ref file answers *when did origin/main last change*, which is not the
+ *    question, and `FETCH_HEAD` answers *when did we last ask*, which is.
+ *  - But `FETCH_HEAD` names **whatever was last fetched**. After
+ *    `git fetch origin sidebranch` it names `sidebranch`, so this does not prove
+ *    `origin/main` itself was refreshed then.
+ *  - And the loose ref may not exist at all: `origin/main` can be packed into
+ *    `packed-refs`, which has one unrelated mtime for many refs. A stat that
+ *    silently misses would report "never fetched" on a healthy repository.
+ *
+ * So this is *the last time this checkout was in contact with the remote*, it
+ * is drawn with those words, and it bounds the staleness rather than measuring
+ * it. Anything stronger needs `git ls-remote`, which is network work this route
+ * has decided not to do.
+ */
+async function lastFetchAtMs(repoRoot: string, timeoutMs: number): Promise<number | null> {
+  const dirs: string[] = [];
+  /* This worktree's gitdir and the shared common dir: a fetch run in any
+     worktree writes its own FETCH_HEAD, and the refs it wrote are shared. */
+  for (const flag of ["--git-dir", "--git-common-dir"]) {
+    const read = await git(repoRoot, ["rev-parse", flag], timeoutMs);
+    if (read.ok && read.stdout !== "") dirs.push(path.resolve(repoRoot, read.stdout));
+  }
+  let newest: number | null = null;
+  for (const dir of dirs) {
+    try {
+      const at = (await stat(path.join(dir, "FETCH_HEAD"))).mtimeMs;
+      if (newest === null || at > newest) newest = at;
+    } catch {
+      /* No FETCH_HEAD here. Not an error — a worktree that has never fetched is
+         normal, and the other dir may still have one. */
+    }
+  }
+  return newest;
+}
+
+/**
+ * The real probe, against a checkout on disk.
+ *
+ * `ref` is a parameter so a test can drive it against a throwaway repository
+ * with no remote, and so `origin/main` is spelled once rather than in three
+ * argv arrays.
+ */
+export function gitProbe(options: {
+  repoRoot: string;
+  /** Default `origin/main`, which is production. Never `main`, a local branch. */
+  ref?: string;
+  timeoutMs?: number;
+  ttlMs?: number;
+  nowMs?: () => number;
+}): GitProbe {
+  const repoRoot = options.repoRoot;
+  const ref = options.ref ?? "origin/main";
+  const timeoutMs = options.timeoutMs ?? GIT_TIMEOUT_MS;
+  const ttlMs = options.ttlMs ?? SNAPSHOT_TTL_MS;
+  const now = options.nowMs ?? ((): number => Date.now());
+
+  /* Single flight and a short TTL. Two readers arriving together share one
+     probe; a reader arriving inside the window pays nothing. Keyed by the
+     recorded sha because that is the only input. */
+  let cached: { key: string; atMs: number; snapshot: GitSnapshot } | null = null;
+  let inFlight: { key: string; promise: Promise<GitSnapshot> } | null = null;
+
+  async function take(recordedSha: string | null): Promise<GitSnapshot> {
+    const main = await readRef();
+    if (main.kind !== "ref") {
+      /* No tip, so nothing to compare against — and saying so once is better
+         than three arms each blaming git separately. */
+      const why = `${ref} could not be read`;
+      return { main, ancestry: { kind: "unknown", why }, commitsSince: { kind: "unknown", why } };
+    }
+    if (recordedSha === null) {
+      const why = "the record names no deploy to measure from";
+      return { main, ancestry: { kind: "unknown", why }, commitsSince: { kind: "unknown", why } };
+    }
+    if (!SHA.test(recordedSha)) {
+      const why = "the record's newest sha is not 40 hex characters";
+      return { main, ancestry: { kind: "unknown", why }, commitsSince: { kind: "unknown", why } };
+    }
+
+    /* **Against the resolved sha, not against `ref`.** That is the whole point
+       of taking a snapshot: the three answers describe one tip even if somebody
+       fetches underneath us. */
+    const [ancestry, commitsSince] = await Promise.all([
+      readAncestry(recordedSha, main.sha),
+      readCount(recordedSha, main.sha),
+    ]);
+    return { main, ancestry, commitsSince };
+  }
+
+  async function readRef(): Promise<MainRef> {
+    /* One call for both fields: `%H %cI` off the tip. Two calls could disagree
+       with each other if somebody fetched between them, which is a sha and a
+       date from different commits. */
+    const read = await git(repoRoot, ["log", "-1", "--format=%H %cI", ref], timeoutMs);
+    if (!read.ok) return { kind: "unavailable", why: `${ref}: ${read.why}` };
+    const [sha, committedAt] = read.stdout.split(" ");
+    if (sha === undefined || !SHA.test(sha) || committedAt === undefined) {
+      return { kind: "unavailable", why: `${ref}: git answered something unreadable` };
+    }
+    return { kind: "ref", sha, committedAt, lastFetchAtMs: await lastFetchAtMs(repoRoot, timeoutMs) };
+  }
+
+  async function readAncestry(sha: string, tip: string): Promise<AncestryReading> {
+    const read = await git(repoRoot, ["merge-base", "--is-ancestor", sha, tip], timeoutMs);
+    if (read.ok) return { kind: "ancestor" };
+    /* **EXIT 1 IS THE ANSWER "no", NOT A FAILURE.** Everything else — 128 for an
+       unknown sha, a timeout, a missing git — is a failure, and collapsing the
+       two draws "this deploy is not on main", which reads as a rollback nobody
+       performed. */
+    if (read.status === 1) return { kind: "not-ancestor" };
+    return { kind: "unknown", why: read.why };
+  }
+
+  async function readCount(sha: string, tip: string): Promise<CountReading> {
+    /* `--no-merges` to match the record's own `commit_count`, which drops merge
+       commits — every one here is a `Merge remote-tracking branch 'origin/dev'`
+       carrying no change of its own. A count taken the other way would sit
+       beside the record's numbers looking comparable and not be.
+       docs/project/changelog.md § Enumerate. */
+    const read = await git(repoRoot, ["rev-list", "--count", "--no-merges", `${sha}..${tip}`], timeoutMs);
+    if (!read.ok) return { kind: "unknown", why: read.why };
+    const commits = Number(read.stdout);
+    if (!Number.isInteger(commits) || commits < 0) {
+      return { kind: "unknown", why: `git answered ${JSON.stringify(read.stdout.slice(0, 40))}` };
+    }
+    return { kind: "count", commits };
+  }
+
+  return {
+    async snapshot(recordedSha): Promise<GitSnapshot> {
+      const key = recordedSha ?? "none";
+      const at = now();
+      if (cached !== null && cached.key === key && at - cached.atMs < ttlMs) return cached.snapshot;
+      if (inFlight !== null && inFlight.key === key) return inFlight.promise;
+
+      const promise = take(recordedSha)
+        .then((snapshot) => {
+          cached = { key, atMs: now(), snapshot };
+          return snapshot;
+        })
+        .finally(() => {
+          if (inFlight?.promise === promise) inFlight = null;
+        });
+      inFlight = { key, promise };
+      return promise;
+    },
+  };
+}
diff --git a/tools/fleet/routes-deploys.ts b/tools/fleet/routes-deploys.ts
new file mode 100644
index 00000000..8f64cb3e
--- /dev/null
+++ b/tools/fleet/routes-deploys.ts
@@ -0,0 +1,255 @@
+/**
+ * `GET /api/deploys` — the most recent production deploys, and how stale the
+ * record of them is.
+ *
+ * A route module rather than lines in `server.ts`, for the reason
+ * `routes-health-history.ts` states: importing `server.ts` binds port 8787, so
+ * anything living there cannot be driven by a test. `deploysPayload` below takes
+ * its file and its git probe as parameters and is pure given both, which is the
+ * half worth testing.
+ *
+ * ## Two arms, and the one they must not become
+ *
+ * `{ kind: "deploys", versions: [] }` says *we read the record and it is empty*.
+ * `{ kind: "unreadable", why }` says *we could not read it*. Drawn the same way
+ * those become one claim — "nothing has ever been deployed" — which is false in
+ * both directions and reassuring in the wrong one. Same distinction, same
+ * reasons, as the health chart's blank day.
+ *
+ * ## What this route does NOT do
+ *
+ * **It does not call Vercel**, because this box has no `VERCEL_TOKEN` and the
+ * CLI is logged out there; the committed NDJSON is the whole record available.
+ *
+ * **And it does not read production's own build stamp, which it could.**
+ * Production publishes two token-free stamps — `/build.json` for the client
+ * bundle (vite.config.ts) and `/api/health` for the function
+ * (src/vercel-health.ts) — and `scripts/deploy.ts` already fetches and
+ * cross-checks both. They cannot enumerate deploys or recover their timestamps,
+ * so they do not replace the record; but they do name **the sha currently
+ * serving**, which would split the vague count above into *commits included in
+ * the serving build* and *commits that are not*. That is the honest improvement
+ * to make next, and it is left out of this pass on purpose: it is an outbound
+ * network call from the dashboard, so it needs its own unavailable / malformed /
+ * client-disagrees-with-API arms, its own cache, and it must never delay or
+ * prevent rendering the recorded list. GPT Sol's P1 finding 1, 2026-09-09.
+ * **It does not fetch**, because a dashboard polled from a phone must not write
+ * refs in a checkout eight other agents are editing — git-probe.ts. **It does
+ * not deploy and does not run the changelog job**: both are Greg's, and step 7
+ * of changelog.md § Running it is a person reading public claims a model wrote,
+ * which a dashboard cannot be.
+ *
+ * ## The claim in the header, and why it is worded weakly
+ *
+ * The tab wants to say how far the record has fallen behind. What it can measure
+ * is the non-merge distance from the newest recorded deploy to this checkout's
+ * cached `origin/main`.
+ *
+ * **That number is not "undeployed work", and it is not "shipped work"
+ * either.** An earlier draft of this comment said everything on `main` has
+ * shipped or is shipping, because `main` is written only by `npm run deploy`.
+ * That is false, and GPT Sol caught it: `deploy.ts` pushes to `main` and only
+ * *then* waits for Vercel (deploy.ts § Push), so a build that failed or timed
+ * out leaves `main` advanced with nothing serving from it. The count therefore
+ * mixes three things — deploys that happened and have not been written up, a tip
+ * that has not been deployed, and pushes whose build never succeeded — and
+ * nothing this route asks can separate them.
+ *
+ * So the payload names the number for what it literally is, *later non-merge
+ * commits in the cached ref*, and the panel says "some may already have
+ * deployed; this view cannot tell which". **There is a token-free way to do
+ * better** and it is deliberately not taken here — see § What this route does
+ * not do. docs/plans/260909b.
+ */
+import type { IncomingMessage, ServerResponse } from "node:http";
+import { readFileSync } from "node:fs";
+import { gzipSync } from "node:zlib";
+
+import { lastGeneratedAt, newestDeploy, readDeploys } from "./deploys.js";
+import type { GitProbe } from "./git-probe.js";
+import type { DeploysPayload } from "./wire.js";
+
+export type { DeploysPayload };
+
+export const DEPLOYS_PATH = "/api/deploys";
+
+/** How many deploys the tab shows before somebody asks for more. */
+export const DEFAULT_LIMIT = 10;
+
+/**
+ * The most it will serve at once.
+ *
+ * Not a security limit — this server has no untrusted caller — but a limit on
+ * how much of a growing file gets serialised into one response because somebody
+ * typed a number into a URL. The whole file is ~210 KB of changelog copy and
+ * grows by roughly eleven deploys a day.
+ */
+export const MAX_LIMIT = 200;
+
+/** Compress above this. Below it the header costs more than it saves. */
+const GZIP_ABOVE_BYTES = 8 * 1024;
+
+export type DeploysRouteDeps = {
+  /** The record's text, or why it could not be read. Injected so a test needs no file. */
+  readRecord(): { ok: true; text: string } | { ok: false; why: string };
+  git: GitProbe;
+  nowMs(): number;
+};
+
+/**
+ * How many the caller asked for, clamped, never NaN.
+ *
+ * A missing or unparseable `limit` is the default rather than an error: this is
+ * a list, and refusing to draw because a query string was odd helps nobody. The
+ * same call `windowHoursFrom` makes in routes-health-history.ts.
+ */
+export function limitFrom(url: string): number {
+  const value = new URL(url, "http://fleet.invalid").searchParams.get("limit");
+  if (value === null) return DEFAULT_LIMIT;
+  const limit = Number(value);
+  if (!Number.isFinite(limit) || limit < 1) return DEFAULT_LIMIT;
+  return Math.min(Math.floor(limit), MAX_LIMIT);
+}
+
+/** Read the record off disk, as a `readRecord` dep. */
+export function readRecordFrom(recordPath: string): DeploysRouteDeps["readRecord"] {
+  return () => {
+    try {
+      return { ok: true, text: readFileSync(recordPath, "utf8") };
+    } catch (err) {
+      const code = (err as NodeJS.ErrnoException).code;
+      /* The path, because the commonest way this breaks is the dashboard being
+         started from somewhere the repo is not, and "ENOENT" alone sends
+         somebody looking at the changelog job instead. */
+      return {
+        ok: false,
+        why:
+          code === "ENOENT"
+            ? `there is no deploy record at ${recordPath} — this dashboard may be running outside the repository`
+            : `the deploy record at ${recordPath} could not be read: ${err instanceof Error ? err.message : String(err)}`,
+      };
+    }
+  };
+}
+
+/**
+ * Build the payload. **Pure given its deps** — no request, no response, no clock
+ * of its own — so the interesting half of this route is testable directly.
+ *
+ * **A git probe that fails does not take the list down with it.** The file read
+ * and the comparison are independent axes: a readable record with an
+ * unavailable git still answers `deploys`, with the readings saying they could
+ * not be taken. Collapsing those would let a `git` that would not run blank a
+ * perfectly good list of deploys. GPT Sol's P2 finding 5.
+ *
+ * **The whole file is parsed before `limit` is applied**, so a corrupt line
+ * older than the page's cut still counts towards `recordLines` and still holds
+ * its release number. Slicing first would make the denominator depend on how
+ * many rows somebody asked for.
+ */
+export async function deploysPayload(deps: DeploysRouteDeps, limit: number): Promise<DeploysPayload> {
+  const record = deps.readRecord();
+  if (!record.ok) return { schema: 1, kind: "unreadable", why: record.why };
+
+  const read = readDeploys(record.text);
+  const newest = newestDeploy(read);
+
+  /* One await, one snapshot, one tip. The probe holds the arm for "the record
+     names no deploy to measure from" so that the reason a reading is missing
+     lives in one place rather than being invented twice. */
+  const git = await deps.git.snapshot(newest?.sha ?? null);
+
+  return {
+    schema: 1,
+    kind: "deploys",
+    versions: read.versions.slice(0, limit),
+    total: read.versions.length,
+    limit,
+    unreadable: read.unreadable,
+    recordLines: read.lines,
+    lastGeneratedAt: lastGeneratedAt(read),
+    newestRecordedSha: newest?.sha ?? null,
+    git,
+    servedAtMs: deps.nowMs(),
+  };
+}
+
+/**
+ * Mount it. Returns false when the request is not this route's — the same shape
+ * as `healthHistoryRoute().handle`, so `server.ts` keeps holding nothing but
+ * wiring.
+ */
+export function deploysRoute(deps: DeploysRouteDeps): {
+  handle(req: IncomingMessage, res: ServerResponse): boolean;
+} {
+  return {
+    handle(req, res): boolean {
+      const url = req.url ?? "/";
+      if (!url.startsWith(DEPLOYS_PATH)) return false;
+      /* An exact path, so the `startsWith` that mounts it cannot quietly widen
+         into `/api/deploys/../something`. The rule routes-new.ts states. */
+      const path = url.split("?")[0] ?? "";
+      if (path !== DEPLOYS_PATH) {
+        res.writeHead(404, { "content-type": "application/json", "cache-control": "no-store" });
+        res.end(JSON.stringify({ schema: 1, kind: "unreadable", why: `no such route: ${path}` }));
+        return true;
+      }
+
+      /* `void` because the work is async and this never rejects — it catches
+         its own failures and answers 500. An unhandled rejection here would be
+         a request that hangs until the client gives up, which on a phone is
+         indistinguishable from the box being down. The same call
+         `routes-new.ts` makes. */
+      void answer(deps, url, req, res);
+      return true;
+    },
+  };
+}
+
+/**
+ * Serialise and send. Separate from `handle` only so the `await` has somewhere
+ * to live without making the mount point async.
+ */
+async function answer(
+  deps: DeploysRouteDeps,
+  url: string,
+  req: IncomingMessage,
+  res: ServerResponse,
+): Promise<void> {
+  let body: string;
+  try {
+    body = JSON.stringify(await deploysPayload(deps, limitFrom(url)));
+  } catch (err) {
+    /* Every failure below this is meant to be an arm, so this is for the case
+       where that is itself wrong. */
+    res.writeHead(500, { "content-type": "application/json", "cache-control": "no-store" });
+    res.end(
+      JSON.stringify({
+        schema: 1,
+        kind: "unreadable",
+        why: `building the deploys answer threw: ${err instanceof Error ? err.message : String(err)}`,
+      }),
+    );
+    return;
+  }
+
+  const accepts = String(req.headers["accept-encoding"] ?? "").includes("gzip");
+  if (accepts && body.length > GZIP_ABOVE_BYTES) {
+    const packed = gzipSync(body);
+    res.writeHead(200, {
+      "content-type": "application/json",
+      "content-encoding": "gzip",
+      "cache-control": "no-store",
+      vary: "accept-encoding",
+      "content-length": String(packed.length),
+    });
+    res.end(packed);
+    return;
+  }
+  res.writeHead(200, {
+    "content-type": "application/json",
+    "cache-control": "no-store",
+    vary: "accept-encoding",
+  });
+  res.end(body);
+}
diff --git a/tools/fleet/server.ts b/tools/fleet/server.ts
index d197edbc..327a7b26 100644
--- a/tools/fleet/server.ts
+++ b/tools/fleet/server.ts
@@ -36,6 +36,7 @@ import { collect, COLLECT_DEADLINE_MS, type FleetSnapshot } from "./collect.js";
 import { parseBinds } from "./config.js";
 import { collectHealth, type HealthReport } from "./health.js";
 import { type HealthTurn } from "./health-history.js";
+import { makeDeploys } from "./deploys-wiring.js";
 import { makeHealthRetention } from "./health-wiring.js";
 import { applySecurityHeaders } from "./headers.js";
 import { broadcast, startHeartbeat, subscribe, subscriberCount } from "./live.js";
@@ -151,6 +152,18 @@ const retention = makeHealthRetention({
 for (const line of retention.lines.log) console.log(line);
 for (const line of retention.lines.error) console.error(line);
 
+/**
+ * The Deploys tab's record and its probe.
+ *
+ * Cheap enough to build unconditionally: it opens nothing at startup and spawns
+ * anything only per request. The composition is in deploys-wiring.ts rather than
+ * here for the reason health-wiring.ts states at length — a test that assembles
+ * its own route proves the route works, and stays green if this file mounts a
+ * different one.
+ */
+const deploys = makeDeploys();
+for (const line of deploys.lines.log) console.log(line);
+
 /**
  * The wire shape, in one place, so the poll and the stream cannot disagree.
  *
@@ -353,6 +366,12 @@ function handler(req: import("node:http").IncomingMessage, res: import("node:htt
   // reads nothing but this process's own append-only file.
   if (retention.route.handle(req, res)) return;
 
+  // The most recent production deploys, for the Deploys tab. Read-only twice
+  // over: it reads one committed file and asks three read-only questions of the
+  // checkout. It never fetches, never calls Vercel — this box has no token —
+  // and cannot deploy anything. routes-deploys.ts says why for each.
+  if (deploys.route.handle(req, res)) return;
+
   // Recent messages for one session, for the detail pane.
   //
   // ADDRESSED THROUGH THE CURRENT SNAPSHOT, NOT THROUGH THE QUERY STRING. The
diff --git a/tools/fleet/web/src/App.tsx b/tools/fleet/web/src/App.tsx
index 054054db..9c4a3bd6 100644
--- a/tools/fleet/web/src/App.tsx
+++ b/tools/fleet/web/src/App.tsx
@@ -1,5 +1,5 @@
 /**
- * The whole page: a masthead, one of three panels, and a bar along the bottom.
+ * The whole page: a masthead, one of several panels, and a bar along the bottom.
  *
  * **Phone first, and now a desk too.** Greg reads this on a phone over
  * Tailscale, so the layout starts as a single column and the mode switch is at
@@ -16,15 +16,17 @@
  * below exists so a test can drive the page without a clock or a network, and
  * it is the same seam.
  */
-import { useMemo, useRef, type ReactNode } from "react";
+import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
 
 import { AttentionPanel } from "./AttentionPanel";
+import { DeploysPanel } from "./DeploysPanel";
 import { Dock } from "./Dock";
 import { Header, SHELL, freshness } from "./Header";
 import { HealthPanel } from "./HealthPanel";
 import { OverseerPanel } from "./OverseerPanel";
 import { SessionsPanel } from "./SessionsPanel";
 import { httpActionsApi, type ActionsApi } from "./actions-client";
+import { httpDeploysApi, type DeploysApi } from "./deploys-client";
 import { useDockFit } from "./fit";
 import { httpHistoryApi, type HistoryApi } from "./health-history-client";
 import { httpMessagesApi, withClockSkew, type MessagesApi } from "./messages-client";
@@ -48,6 +50,7 @@ export function App({
   actionsApi = httpActionsApi,
   messagesApi = httpMessagesApi,
   historyApi = httpHistoryApi,
+  deploysApi = httpDeploysApi(),
   actionsPollMs,
 }: {
   transport?: Transport;
@@ -69,6 +72,13 @@ export function App({
    * this page measures and the times that chart prints.
    */
   historyApi?: HistoryApi;
+  /**
+   * The deploy record. Injected here as well as defaulted in `DeploysPanel`, so
+   * that no test in this file can reach `fetch` by accident — a suite that
+   * quietly made real requests would pass and tell you nothing about the seam
+   * it thought it was exercising.
+   */
+  deploysApi?: DeploysApi;
   /** Only a test passes this, to keep a poll off a fake clock. */
   actionsPollMs?: number;
 }): ReactNode {
@@ -99,6 +109,18 @@ export function App({
      the exact moment it matters. */
   const now = useNow();
   const { mode, params, chooseMode, setParam } = useHashState();
+  /* **The dock's Refresh means "the page", not "the feed".** Its tooltip
+     presents it as the page's refresh control, and until 2026-09-09 it called
+     `feed.refresh()` only — so on a panel with its own route, pressing it did
+     nothing at all, which is indistinguishable from a broken button on the one
+     page whose job is to say whether things are broken. GPT Sol's P2 finding 9.
+     A counter rather than a callback registry: a panel that wants to be told
+     puts this in its effect's dependencies and needs to know nothing else. */
+  const [refreshNonce, setRefreshNonce] = useState(0);
+  const refreshEverything = useCallback(() => {
+    feed.refresh();
+    setRefreshNonce((n) => n + 1);
+  }, [feed]);
   /* Both of these live in the URL for the reason the mode does: this page is
      reloaded by the browser whenever iOS reclaims the tab, and a sort order
      that resets every time is one nobody bothers to set. mode.ts § the hash. */
@@ -125,7 +147,7 @@ export function App({
 
   return (
     <div className="tw:min-h-dvh tw:bg-page">
-      <Header state={feed.state} fresh={fresh} onRefresh={feed.refresh} />
+      <Header state={feed.state} fresh={fresh} onRefresh={refreshEverything} />
 
       {/* The bottom padding is the bar's resting room plus a card's worth of
           air, so the last session does not finish underneath the dock — which
@@ -222,13 +244,24 @@ export function App({
             />
           </div>
         ) : null}
+        {/* **Deploys takes no snapshot props, and that is the shape rather than
+            an omission.** The deploy record is read on its own route, on its own
+            cadence, and costs nothing until somebody opens the tab — the rule in
+            fleet-dashboard-modes.md § Where the panel's data comes from: no read
+            inside the collection loop. All it needs from here is the page's
+            clock, so every age on screen is anchored to the same tick. */}
+        {mode === "deploys" ? (
+          <div className="tw:mx-auto tw:max-w-3xl">
+            <DeploysPanel api={deploysApi} now={now} refreshNonce={refreshNonce} />
+          </div>
+        ) : null}
       </main>
 
       <Dock
         mode={mode}
         onChoose={chooseMode}
         needsYou={needsYou}
-        onRefresh={feed.refresh}
+        onRefresh={refreshEverything}
         fitClass={fitClass}
         barRef={dockRef}
       />
diff --git a/tools/fleet/web/src/DeploysPanel.tsx b/tools/fleet/web/src/DeploysPanel.tsx
new file mode 100644
index 00000000..568f3b87
--- /dev/null
+++ b/tools/fleet/web/src/DeploysPanel.tsx
@@ -0,0 +1,390 @@
+/**
+ * The Deploys tab: what shipped to production, newest first, and how stale the
+ * record of it is.
+ *
+ * ## The header is the honest half
+ *
+ * The list is easy; the header is where this panel could lie. The record it
+ * draws (`src/web/changelog-versions.ndjson`) is written by a job Greg runs by
+ * hand, so **a deploy can have happened hours before it appears here**, and a
+ * page that showed only the list would present a stale record as the current
+ * state of production with nothing saying otherwise. So the first thing on the
+ * page is when the record was last written, where production's tip actually is,
+ * and how far apart those two are.
+ *
+ * ## The sentence this panel must not get wrong
+ *
+ * `commitsSince` is the non-merge distance from the newest recorded deploy to
+ * `origin/main`. **It is not undeployed work.** Everything on `main` has shipped
+ * or is shipping — `main` is written only by `npm run deploy` — so the number
+ * lumps together deploys the changelog job has not written up yet and a tip that
+ * has not been deployed. Nothing on this box can separate those without a Vercel
+ * token. The copy below says the weaker true thing and names what it cannot
+ * tell; if you are tempted to tighten it into something punchier, read
+ * routes-deploys.ts § The claim in the header first.
+ *
+ * ## Every kind of nothing, kept apart
+ *
+ * Four arms out of `deploys-client.ts` and each draws differently, because an
+ * empty list reads as *nothing has ever been deployed* — the page's standing
+ * rule (docs/project/fleet-dashboard-modes.md § Absence is stated, never drawn),
+ * sharpened here by the fact that every failure has a reassuring wrong answer to
+ * fall back to.
+ */
+import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
+
+import { Explain, type Tip } from "./Tooltip";
+import {
+  FIRST_PAGE,
+  MORE_PAGE,
+  ago,
+  commitUrl,
+  deployWhen,
+  groupedEntries,
+  httpDeploysApi,
+  shortSha,
+  type DeploysApi,
+  type DeploysView,
+} from "./deploys-client";
+import { Button, Card, Mono, Pill, SectionHeading } from "./ui";
+import type { DeployVersion } from "../../wire";
+
+/** What the panel is doing, plus whatever it last heard. */
+type State = { kind: "loading" } | DeploysView;
+
+const RECORD_TIP: Tip = {
+  head: "The deploy record",
+  what: "Every production deploy that has been written up, newest first, with the changelog entries a reader would have noticed.",
+  how: "It is a committed file, not a live call to Vercel — this box has no token — so it lags until somebody runs the changelog job. The line above says by how much.",
+};
+
+const BEHIND_TIP: Tip = {
+  head: "Commits after the last recorded deploy",
+  what: "Non-merge commits between the newest deploy in the record and this checkout\u2019s cached tip of main.",
+  how: "Not a count of work awaiting release: main is advanced by a deploy attempt before its build is known to have succeeded, so some of these shipped and some did not. Telling them apart needs the live build stamp or Vercel.",
+};
+
+/** A sha, linked into the repository. */
+function Sha({ sha }: { sha: string }): ReactNode {
+  return (
+    <a
+      href={commitUrl(sha)}
+      target="_blank"
+      rel="noreferrer noopener"
+      className="tw:font-mono tw:text-[12px] tw:text-ink-faint tw:underline tw:decoration-dotted tw:underline-offset-2 tw:hover:text-ink"
+    >
+      {shortSha(sha)}
+    </a>
+  );
+}
+
+/**
+ * The freshness header.
+ *
+ * **Every line here is allowed to say "we could not tell".** The alternative —
+ * omitting a line whose reading failed — leaves a header that looks complete and
+ * is quietly missing the one fact that was wrong.
+ */
+function Freshness({ view, nowMs }: { view: Extract<DeploysView, { kind: "deploys" }>; nowMs: number }): ReactNode {
+  const generatedAgo = ago(view.lastGeneratedAt, nowMs);
+  const mainRef = view.git.main;
+
+  return (
+    <Card className="tw:px-3 tw:py-2.5 tw:text-[13px] tw:text-ink-soft">
+      <div className="tw:flex tw:flex-wrap tw:items-baseline tw:gap-x-2 tw:gap-y-1">
+        <span className="tw:font-semibold tw:text-ink">The record</span>
+        {view.lastGeneratedAt === null ? (
+          <span>says nothing about when it was written.</span>
+        ) : (
+          <span>
+            was last written {generatedAgo ?? "at a time this page cannot read"}
+            <span className="tw:text-ink-faint"> ({deployWhen(view.lastGeneratedAt) ?? view.lastGeneratedAt})</span>, and
+            holds {view.total} {view.total === 1 ? "deploy" : "deploys"}.
+          </span>
+        )}
+      </div>
+
+      <div className="tw:mt-1.5 tw:flex tw:flex-wrap tw:items-baseline tw:gap-x-2 tw:gap-y-1">
+        <span className="tw:font-semibold tw:text-ink">Production</span>
+        {mainRef.kind === "ref" ? (
+          <span>
+            is at <Sha sha={mainRef.sha} />, committed {ago(mainRef.committedAt, nowMs) ?? "at an unreadable time"}
+            {/* **The age of the VIEW, not of the commit.** The dashboard never
+                fetches, so a ref nobody has updated in a week looks exactly like
+                a week with no deploys unless this says which it is. */}
+            {/* **Labelled as exactly what it measures, after GPT Sol's P1
+                finding 2 and a measurement on this box.** `FETCH_HEAD`'s mtime
+                does advance on a no-op fetch — so it says when we last ASKED,
+                not when the ref last moved — but it names whatever was last
+                fetched, so it does not prove `origin/main` itself was
+                refreshed. It bounds the staleness; it does not measure it. */}
+            {mainRef.lastFetchAtMs === null ? (
+              <span className="tw:text-ink-faint"> — a cached view; this checkout has no record of fetching</span>
+            ) : (
+              <span className="tw:text-ink-faint">
+                {" "}
+                — a cached view; this checkout last fetched something{" "}
+                {ago(new Date(mainRef.lastFetchAtMs).toISOString(), nowMs) ?? "at an unreadable time"}
+              </span>
+            )}
+          </span>
+        ) : (
+          <span className="tw:text-unknown-ink">could not be read: {mainRef.why}</span>
+        )}
+      </div>
+
+      {/* Ancestry: three arms, and `not-ancestor` is the one worth a colour.
+          It means the newest recorded deploy is not on main at all — a rollback,
+          or a deploy from somebody's working directory — which changelog.md
+          says to check per version precisely because it breaks the ranges
+          silently. */}
+      <div className="tw:mt-1.5 tw:flex tw:flex-wrap tw:items-baseline tw:gap-x-2 tw:gap-y-1">
+        {view.git.ancestry.kind === "ancestor" ? (
+          <span className="tw:text-ink-faint">The newest recorded deploy is on main.</span>
+        ) : view.git.ancestry.kind === "not-ancestor" ? (
+          <span className="tw:font-semibold tw:text-alarm-ink">
+            The newest recorded deploy is not on main — a rollback, or a deploy from a working directory.
+          </span>
+        ) : (
+          <span className="tw:text-unknown-ink">
+            Whether the newest recorded deploy is on main could not be checked: {view.git.ancestry.why}
+          </span>
+        )}
+      </div>
+
+      <div className="tw:mt-1.5">
+        {view.git.commitsSince.kind === "count" ? (
+          <Explain tip={BEHIND_TIP}>
+            <span>
+              <span className="tw:font-semibold tw:text-ink">{view.git.commitsSince.commits}</span> later non-merge
+              commits in this checkout&rsquo;s cached <span className="tw:font-mono">origin/main</span>.{" "}
+              <span className="tw:text-ink-faint">
+                Some may already have deployed and not been written up yet. This view cannot tell which.
+              </span>
+            </span>
+          </Explain>
+        ) : (
+          <span className="tw:text-unknown-ink">
+            How far the record is behind main could not be measured: {view.git.commitsSince.why}
+          </span>
+        )}
+      </div>
+
+      {/* A line of the record that would not parse is a deploy missing from the
+          list. Counted and shown, never swallowed — otherwise the list is
+          quietly short and looks complete. */}
+      {view.unreadable.length > 0 ? (
+        <div className="tw:mt-1.5 tw:text-alarm-ink">
+          {view.unreadable.length} of {view.recordLines} lines in the record could not be read, so that many deploys are
+          missing from this list: {view.unreadable.join("; ")}
+        </div>
+      ) : null}
+    </Card>
+  );
+}
+
+/** One deploy. */
+function DeployCard({ version, nowMs }: { version: DeployVersion; nowMs: number }): ReactNode {
+  const groups = groupedEntries(version);
+  const when = deployWhen(version.version);
+
+  return (
+    <Card className="tw:px-3 tw:py-2.5">
+      <div className="tw:flex tw:flex-wrap tw:items-baseline tw:gap-x-2 tw:gap-y-1">
+        <span className="tw:font-semibold tw:text-ink">Release {version.release}</span>
+        <span className="tw:text-[13px] tw:text-ink-soft">{ago(version.version, nowMs) ?? "at an unreadable time"}</span>
+        {version.invisible ? <Pill tone="idle">quiet</Pill> : null}
+      </div>
+
+      <div className="tw:mt-1 tw:flex tw:flex-wrap tw:items-baseline tw:gap-x-2 tw:gap-y-1 tw:text-[12px] tw:text-ink-faint">
+        <span>{when ?? version.version}</span>
+        <span aria-hidden="true">·</span>
+        <Sha sha={version.sha} />
+        {/* **Null is not zero.** A line that has forgotten what it shipped has
+            not shipped nothing, and drawing "0 commits" would be a number
+            somebody could act on. */}
+        <span aria-hidden="true">·</span>
+        <span>
+          {version.commitCount === null
+            ? "commit count not recorded"
+            : `${version.commitCount} ${version.commitCount === 1 ? "commit" : "commits"}`}
+        </span>
+        {version.previousSha !== null ? (
+          <>
+            <span aria-hidden="true">·</span>
+            {/* The range, so what this deploy covers is visible rather than
+                implied. */}
+            <span>
+              since <Sha sha={version.previousSha} />
+            </span>
+          </>
+        ) : null}
+      </div>
+
+      {!version.changelogReadable ? (
+        /* **"We could not read what changed" is NOT "nothing changed".** The two
+           look identical on a card and mean opposite things: one is the common
+           quiet deploy, the other is a headline feature rendered as an empty
+           box. GPT Sol's P1 finding 3, 2026-09-09. */
+        <p className="tw:mt-2 tw:text-[13px] tw:text-unknown-ink">
+          What changed here could not be read from the record
+          {version.unreadableEntries > 0
+            ? ` — ${version.unreadableEntries} ${version.unreadableEntries === 1 ? "entry" : "entries"} would not parse`
+            : ""}
+          . This is not a quiet deploy; it is a gap in the changelog.
+        </p>
+      ) : groups.length === 0 ? (
+        /* **NOT an empty card.** Most deploys are quiet — 19 of the 20 in one
+           42-hour stretch — and that is expected rather than a fault, so it is
+           said in words rather than left as a gap somebody has to interpret. */
+        <p className="tw:mt-2 tw:text-[13px] tw:text-ink-faint">Nothing a reader would notice.</p>
+      ) : (
+        groups.map((group) => (
+          <div key={group.section} className="tw:mt-2.5">
+            <h3 className="tw:text-[11px] tw:font-semibold tw:tracking-widest tw:text-ink-faint tw:uppercase">
+              {group.label}
+            </h3>
+            <ul className="tw:mt-1 tw:flex tw:flex-col tw:gap-2">
+              {group.entries.map((entry) => (
+                /* Keyed by the title within its section rather than by index:
+                   these are drawn from a file that can gain a line above them,
+                   and an index key would then re-use one entry's DOM for
+                   another's text. */
+                <li key={`${group.section}-${entry.title}`} className="tw:text-[13px]">
+                  <span className="tw:font-medium tw:text-ink">{entry.title}</span>
+                  <p className="tw:mt-0.5 tw:text-ink-soft">{entry.body}</p>
+                  <div className="tw:mt-0.5 tw:flex tw:flex-wrap tw:items-baseline tw:gap-x-2">
+                    {entry.where !== null ? <Mono>{entry.where}</Mono> : null}
+                    {entry.commits.map((sha) => (
+                      <Sha key={sha} sha={sha} />
+                    ))}
+                  </div>
+                </li>
+              ))}
+            </ul>
+          </div>
+        ))
+      )}
+
+      {/* Some entries read, some not. The list above is real and short, and
+          saying by how much is the difference between a partial list and a
+          list. */}
+      {version.changelogReadable && version.unreadableEntries > 0 ? (
+        <p className="tw:mt-2 tw:text-[12px] tw:text-unknown-ink">
+          {version.unreadableEntries} further {version.unreadableEntries === 1 ? "entry" : "entries"} on this deploy
+          could not be read, so this list is short.
+        </p>
+      ) : null}
+    </Card>
+  );
+}
+
+export function DeploysPanel({
+  api = httpDeploysApi(),
+  now,
+  refreshNonce = 0,
+}: {
+  /** Injectable, so a test drives the panel through the seam rather than stubbing `fetch`. */
+  api?: DeploysApi;
+  /** The page's clock, so every age on screen is anchored to the same tick. */
+  now: number;
+  /**
+   * Bumped when somebody presses Refresh.
+   *
+   * **This panel does not poll.** The record changes when a person runs the
+   * changelog job, which is hours apart, so a timer would be spending the box's
+   * time to re-read an unchanged file. What it must do instead is answer the
+   * Refresh button — which presents itself as the page's, and did nothing here
+   * until this existed. App.tsx § refreshEverything.
+   */
+  refreshNonce?: number;
+}): ReactNode {
+  const [state, setState] = useState<State>({ kind: "loading" });
+  const [limit, setLimit] = useState<number>(FIRST_PAGE);
+  /* The panel's own view of "now" is the page's, but a fetch must not be
+     re-issued every time it ticks — hence `limit` in the dependency list and
+     `now` deliberately out of it. */
+  const nowRef = useRef(now);
+  nowRef.current = now;
+
+  /* `refreshNonce` is in the dependency list for its effect on identity alone —
+     it is never read in the body. That IS the mechanism: pressing Refresh
+     changes it, which re-runs the effect, which re-fetches. Biome sees an
+     unnecessary dependency, which is exactly what it is and exactly what is
+     wanted. */
+  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshNonce is the refresh signal — re-running when it changes is the point.
+  useEffect(() => {
+    const controller = new AbortController();
+    let live = true;
+    void api.fetch(limit, controller.signal).then((view) => {
+      if (live) setState(view);
+    });
+    return () => {
+      live = false;
+      controller.abort();
+    };
+  }, [api, limit, refreshNonce]);
+
+  const showMore = useCallback(() => setLimit(MORE_PAGE), []);
+
+  const more = useMemo(
+    () => (state.kind === "deploys" ? state.total - state.versions.length : 0),
+    [state],
+  );
+
+  return (
+    <section className="tw:flex tw:flex-col tw:gap-2">
+      <SectionHeading>
+        <Explain tip={RECORD_TIP}>Deploys</Explain>
+      </SectionHeading>
+
+      {state.kind === "loading" ? (
+        /* Not a claim about anything — and it says so rather than showing an
+           empty list that would read as "no deploys". */
+        <Card className="tw:px-3 tw:py-2.5 tw:text-[13px] tw:text-ink-soft">Reading the deploy record…</Card>
+      ) : state.kind === "unreadable" ? (
+        /* THE SERVER could not look, in the server's voice. */
+        <Card className="tw:px-3 tw:py-2.5 tw:text-[13px]">
+          <span className="tw:font-semibold tw:text-alarm-ink">The deploy record could not be read.</span>{" "}
+          <span className="tw:text-ink-soft">{state.why}</span>
+          <p className="tw:mt-1 tw:text-ink-faint">
+            This is not a statement about production — it is a statement about this dashboard.
+          </p>
+        </Card>
+      ) : state.kind === "no-answer" ? (
+        /* THIS BROWSER never got an answer, in OUR voice. The phone's own
+           network trouble must not appear wearing the server's. */
+        <Card className="tw:px-3 tw:py-2.5 tw:text-[13px]">
+          <span className="tw:font-semibold tw:text-unknown-ink">This page did not get an answer from the box.</span>{" "}
+          <span className="tw:text-ink-soft">{state.why}</span>
+        </Card>
+      ) : (
+        <>
+          <Freshness view={state} nowMs={now} />
+
+          {state.versions.length === 0 ? (
+            /* We READ the record and it is empty — a different claim from
+               either failure above, and it names which. */
+            <Card className="tw:px-3 tw:py-2.5 tw:text-[13px] tw:text-ink-soft">
+              The record was read and holds no deploys at all. It has {state.recordLines} lines.
+            </Card>
+          ) : (
+            <div className="tw:flex tw:flex-col tw:gap-2">
+              {state.versions.map((version) => (
+                <DeployCard key={version.deploymentId} version={version} nowMs={now} />
+              ))}
+            </div>
+          )}
+
+          {more > 0 ? (
+            <div className="tw:flex tw:justify-center tw:py-1">
+              <Button onClick={showMore}>
+                Show more ({more} older {more === 1 ? "deploy" : "deploys"})
+              </Button>
+            </div>
+          ) : null}
+        </>
+      )}
+    </section>
+  );
+}
diff --git a/tools/fleet/web/src/Dock.tsx b/tools/fleet/web/src/Dock.tsx
index 68bde6ad..0357a882 100644
--- a/tools/fleet/web/src/Dock.tsx
+++ b/tools/fleet/web/src/Dock.tsx
@@ -20,7 +20,7 @@
  * nothing here needs touching — `MODES` in mode.ts is the list, and the bar
  * measures its own fit (fit.ts).
  */
-import { Gauge, ListChecks, Network, RefreshCw, type LucideIcon } from "lucide-react";
+import { Gauge, ListChecks, Network, RefreshCw, Rocket, type LucideIcon } from "lucide-react";
 import type { ReactNode, RefObject } from "react";
 
 import { Tooltip, TooltipGroup, TipCard, type Tip } from "./Tooltip";
@@ -45,6 +45,7 @@ const MODE_ICONS: Record<Mode, LucideIcon> = {
   sessions: ListChecks,
   health: Gauge,
   overseer: Network,
+  deploys: Rocket,
 };
 
 const MODE_TIPS: Record<Mode, Tip> = {
@@ -63,6 +64,16 @@ const MODE_TIPS: Record<Mode, Tip> = {
     what: "What this tool is meant to become: a coordinator agent rather than a person with a mouse.",
     how: "It is a roadmap, not a feature. Nothing on that panel is live, and it says so.",
   },
+  deploys: {
+    head: "Deploys",
+    what: "Every production deploy there is a written record of, newest first: when it shipped, what a reader would have noticed, and the commits behind it.",
+    /* The non-obvious half is that this is a FILE rather than a live reading —
+       and it points at where the staleness is stated rather than promising a
+       freshness here, which is `usage-limits-tab`'s note: a tooltip that says
+       "only as fresh as the last run" invites the question the header already
+       answers with a number. */
+    how: "The record is a committed file, not a call to Vercel — this box has no token for one — so the first line of the tab says how far behind main it has fallen.",
+  },
 };
 
 function DockMode({
diff --git a/tools/fleet/web/src/deploys-client.ts b/tools/fleet/web/src/deploys-client.ts
new file mode 100644
index 00000000..89737177
--- /dev/null
+++ b/tools/fleet/web/src/deploys-client.ts
@@ -0,0 +1,222 @@
+/**
+ * The deploy record — `GET /api/deploys`.
+ *
+ * ## FOUR ARMS, BECAUSE THE SERVER HAS TWO AND THE WIRE CAN FAIL TOO
+ *
+ * The discipline `health-history-client.ts` states at length, and it applies
+ * here for the same reason: every arm is a different kind of *nothing*, and
+ * collapsing any two of them produces an empty list, which reads as **"nothing
+ * has ever been deployed"** — a confident, false, and rather alarming sentence
+ * about production.
+ *
+ *  - **`deploys`** — we read the record. `versions` may be empty, and that is a
+ *    claim about the record rather than a failure.
+ *  - **`unreadable`** — the SERVER could not read it. Its `why`, in its voice.
+ *  - **`no-answer`** — THIS BROWSER never got an answer it could read. Our
+ *    sentence, and it says so, because the phone's own network trouble must not
+ *    appear on screen wearing the server's voice.
+ *  - **`loading`** — the panel's, and not a claim about anything.
+ *
+ * ## The seam
+ *
+ * `DeploysApi` is injectable so `DeploysPanel` can be driven by a test without
+ * stubbing `fetch` — the rule docs/project/fleet-dashboard-modes.md § Writing
+ * back states: bind `fetch` at import time and it is unstubbable in any suite
+ * that imports the module first, and the failure looks like a real network call
+ * in a test that has none.
+ */
+import type { DeploysPayload, DeployVersion } from "../../wire";
+
+export const DEPLOYS_URL = "api/deploys";
+
+/** How many the tab asks for first. The server's own default, restated so a caller can widen it. */
+export const FIRST_PAGE = 10;
+
+/** What "show more" asks for. The server clamps at 200. */
+export const MORE_PAGE = 60;
+
+/** How long before deciding an answer is not coming. */
+export const REQUEST_TIMEOUT_MS = 15_000;
+
+/**
+ * What the panel renders. The server's two arms, plus the one only a browser can
+ * have.
+ */
+export type DeploysView =
+  | (Extract<DeploysPayload, { kind: "deploys" }> & { kind: "deploys" })
+  | { kind: "unreadable"; why: string }
+  | { kind: "no-answer"; why: string };
+
+/** The seam. One method, because this tab only reads. */
+export type DeploysApi = {
+  fetch(limit: number, signal?: AbortSignal): Promise<DeploysView>;
+};
+
+function describe(cause: unknown): string {
+  if (cause instanceof Error) return cause.message === "" ? cause.name : cause.message;
+  if (typeof cause === "string" && cause !== "") return cause;
+  return "the request failed, and gave no reason";
+}
+
+/**
+ * Is this the shape this build can read?
+ *
+ * **Checked rather than cast.** A payload from a schema this build does not
+ * know looks exactly like a healthy one to `await response.json()`, and the
+ * failure would be a panel drawing `undefined` where a count belongs. The
+ * fields checked are the ones the panel would silently render wrong, not every
+ * field on the type.
+ */
+function readPayload(body: unknown): DeploysView {
+  if (typeof body !== "object" || body === null) {
+    return { kind: "no-answer", why: "the server's answer was not an object" };
+  }
+  const raw = body as Record<string, unknown>;
+  /* **The schema first, before either arm is read.** A payload from a build
+     this page does not know looks exactly like a healthy one to `.json()`, and
+     the failure would be a panel drawing `undefined` where a count belongs —
+     the same call `health-history-client.ts` makes. GPT Sol's P2 finding 5. */
+  if (raw.schema !== 1) {
+    return {
+      kind: "no-answer",
+      why: `this page cannot read schema ${JSON.stringify(raw.schema)} from the box — one of the two is out of date`,
+    };
+  }
+  if (raw.kind === "unreadable") {
+    return {
+      kind: "unreadable",
+      why: typeof raw.why === "string" ? raw.why : "the server did not say why",
+    };
+  }
+  if (raw.kind !== "deploys" || !Array.isArray(raw.versions)) {
+    return {
+      kind: "no-answer",
+      why: `this build cannot read the server's answer (kind ${JSON.stringify(raw.kind)})`,
+    };
+  }
+  return body as DeploysView;
+}
+
+/** The real one. Relative URL, so the tool works behind any host. */
+export function httpDeploysApi(url: string = DEPLOYS_URL): DeploysApi {
+  return {
+    async fetch(limit, signal): Promise<DeploysView> {
+      const controller = new AbortController();
+      const abort = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
+      /* The caller's signal and ours both have to reach the fetch: the caller's
+         is React unmounting, ours is the timeout. Without the first, a panel
+         that goes away mid-request sets state on a dead component; without the
+         second, a hung request is indistinguishable from a slow one for ever. */
+      const onAbort = (): void => controller.abort();
+      signal?.addEventListener("abort", onAbort);
+      try {
+        const response = await fetch(`${url}?limit=${limit}`, {
+          cache: "no-store",
+          signal: controller.signal,
+        });
+        if (!response.ok) {
+          return {
+            kind: "no-answer",
+            why: `the server answered ${response.status} ${response.statusText}`.trimEnd(),
+          };
+        }
+        let body: unknown;
+        try {
+          body = await response.json();
+        } catch (cause) {
+          return { kind: "no-answer", why: `the server's answer was not JSON: ${describe(cause)}` };
+        }
+        return readPayload(body);
+      } catch (cause) {
+        return {
+          kind: "no-answer",
+          why: controller.signal.aborted
+            ? `no answer in ${Math.round(REQUEST_TIMEOUT_MS / 1000)}s — the box may be busy, or gone`
+            : describe(cause),
+        };
+      } finally {
+        clearTimeout(abort);
+        signal?.removeEventListener("abort", onAbort);
+      }
+    },
+  };
+}
+
+/* ------------------------------------------------------------------ *
+ * Saying when, and how long ago.
+ * ------------------------------------------------------------------ */
+
+/**
+ * **The seam for `tools/fleet/zones.ts`.**
+ *
+ * `zonedLine(iso)` — landing from docs/plans/260908f-roadmap-usage — spells a
+ * time in UTC, London and Athens at once, with a `(+1d)` where the calendar
+ * dates differ. That last part is the bit worth not reinventing: a deploy at
+ * 23:40 UTC is 02:40 Athens *the next day*, and printed bare beside the UTC time
+ * it reads as three hours in the past.
+ *
+ * Until that module is on `dev` this spells the UTC time only, which is true and
+ * not yet useful to somebody in Athens. **When it lands, this function's body
+ * becomes `return zonedLine(iso) ?? …` and nothing else in this tab changes** —
+ * which is the whole reason it is a function here rather than four lines inside
+ * the panel's JSX.
+ */
+export function deployWhen(iso: string): string | null {
+  const at = Date.parse(iso);
+  if (Number.isNaN(at)) return null;
+  return `${iso.replace("T", " ").replace("Z", "")} UTC`;
+}
+
+/**
+ * How long ago, in the coarsest unit that is still informative.
+ *
+ * Returns null for an unreadable stamp rather than "NaN ago" or, worse, "just
+ * now" — a fabricated freshness is the single most misleading thing this panel
+ * could say, since the whole header is about how stale the record is.
+ */
+export function ago(iso: string | null, nowMs: number): string | null {
+  if (iso === null) return null;
+  const at = Date.parse(iso);
+  if (Number.isNaN(at)) return null;
+  const seconds = Math.round((nowMs - at) / 1000);
+  /* A future stamp is a clock disagreement, not a negative age. The box and the
+     phone need not agree, and "in 3 minutes" beside a deploy is a puzzle
+     nobody should have to solve on a phone. */
+  if (seconds < 0) return "just now";
+  if (seconds < 90) return `${seconds}s ago`;
+  const minutes = Math.round(seconds / 60);
+  if (minutes < 90) return `${minutes}m ago`;
+  const hours = Math.round(minutes / 60);
+  if (hours < 36) return `${hours}h ago`;
+  return `${Math.round(hours / 24)}d ago`;
+}
+
+/** A sha as the seven characters a person reads. */
+export function shortSha(sha: string): string {
+  return sha.slice(0, 7);
+}
+
+/** The repository the commit links point into. Public since 2026-09-06. */
+export const REPO_URL = "https://github.com/spideryarn/reading2";
+
+export function commitUrl(sha: string): string {
+  return `${REPO_URL}/commit/${sha}`;
+}
+
+/** The entries of one deploy, grouped under the three headings, in order. */
+export function groupedEntries(
+  version: DeployVersion,
+): { section: "headline" | "enhancement" | "fix"; label: string; entries: DeployVersion["entries"] }[] {
+  const labels = {
+    headline: "Headline changes",
+    enhancement: "Minor enhancements",
+    fix: "Bug fixes",
+  } as const;
+  return (["headline", "enhancement", "fix"] as const)
+    .map((section) => ({
+      section,
+      label: labels[section],
+      entries: version.entries.filter((e) => e.section === section),
+    }))
+    .filter((group) => group.entries.length > 0);
+}
diff --git a/tools/fleet/web/src/mode.ts b/tools/fleet/web/src/mode.ts
index 2bbf884b..ca020bc2 100644
--- a/tools/fleet/web/src/mode.ts
+++ b/tools/fleet/web/src/mode.ts
@@ -27,7 +27,7 @@
  */
 import { useCallback, useEffect, useMemo, useState } from "react";
 
-export const MODES = ["sessions", "health", "overseer"] as const;
+export const MODES = ["sessions", "health", "overseer", "deploys"] as const;
 
 export type Mode = (typeof MODES)[number];
 
@@ -35,6 +35,7 @@ export const MODE_LABELS: Record<Mode, string> = {
   sessions: "Sessions",
   health: "Box health",
   overseer: "Overseer",
+  deploys: "Deploys",
 };
 
 /** Everything the fragment says. `params` is plain, so React can compare it. */
diff --git a/tools/fleet/wire.ts b/tools/fleet/wire.ts
index e2bb055f..38901ceb 100644
--- a/tools/fleet/wire.ts
+++ b/tools/fleet/wire.ts
@@ -1673,3 +1673,178 @@ export type QuarantineHoldView = {
   why: string;
   outcome: HoldOutcome;
 };
+
+/* ------------------------------------------------------------------ *
+ * The Deploys tab: what shipped to production, and how stale the record is.
+ * ------------------------------------------------------------------ */
+
+/**
+ * The three headings a deploy's reader-facing entries appear under.
+ *
+ * A type rather than the `as const` array, which is a runtime value and belongs
+ * in `deploys.ts` — this file may not hold one. docs/project/changelog.md
+ * § The file has the reasoning for three rather than four: there is no section
+ * for engineering, because a change a reader would notice is a headline change
+ * whatever it took to build.
+ */
+export type DeploySection = "headline" | "enhancement" | "fix";
+
+/** One thing a reader would notice, as the changelog pipeline wrote it. */
+export type DeployEntry = {
+  section: DeploySection;
+  title: string;
+  body: string;
+  /** Where in the app, in the pipeline's words. Null when it named nowhere. */
+  where: string | null;
+  /** Full 40-character shas. The panel renders them as links into the repository. */
+  commits: string[];
+};
+
+/**
+ * One production deploy, as `src/web/changelog-versions.ndjson` has it.
+ *
+ * **Declared here rather than in `deploys.ts` because both ends read it**, and
+ * this file's whole existence is the four fields that reached the browser and
+ * were dropped by a client holding its own unrelated copy of a type. The reader
+ * and the panel import this one.
+ */
+export type DeployVersion = {
+  /** The deploy's timestamp, UTC. It is also the version's id. */
+  version: string;
+  /** Which release this is, counted from the OLDEST line — the number `/changelog` shows. */
+  release: number;
+  deploymentId: string;
+  sha: string;
+  previousSha: string | null;
+  /**
+   * How many commits this deploy shipped, or null when the line does not say.
+   *
+   * **A NON-MERGE COUNT** — the changelog pipeline drops merge commits, because
+   * every one of them here is a `Merge remote-tracking branch 'origin/dev'`
+   * carrying no change of its own. Anything drawn beside it must be counted the
+   * same way or the two are not comparable. **Null is not zero**: a line that
+   * has forgotten what it shipped has not shipped nothing.
+   */
+  commitCount: number | null;
+  /**
+   * Nothing a reader would notice. The common case, and not a fault.
+   *
+   * **Only ever true when `changelogReadable` is** — a deploy whose changelog
+   * could not be read is not a quiet one, and saying so was the bug GPT Sol
+   * found on 2026-09-09.
+   */
+  invisible: boolean;
+  /**
+   * **Whether "what changed" could be read at all**, as distinct from there
+   * being nothing.
+   *
+   * False when `entries` is absent, is not an array, or held nothing readable
+   * on a line that does not claim to be quiet. The panel must draw this as
+   * *we could not read what changed*, never as *nothing changed*: the two look
+   * identical and mean opposite things, and one of them is a headline feature
+   * rendered as an empty deploy.
+   */
+  changelogReadable: boolean;
+  /** Entries on this line that would not parse. Counted, never hidden. */
+  unreadableEntries: number;
+  /** When the changelog job wrote this line — **not** when the deploy happened. */
+  generatedAt: string | null;
+  entries: DeployEntry[];
+};
+
+/**
+ * The three git readings, taken together as one snapshot.
+ *
+ * **One shape rather than three fields, because they must describe one tip.**
+ * `origin/main` is mutable between processes — a dozen agents fetch all night —
+ * so three independently-resolved calls can answer about three different
+ * commits, and the result is a reading of nothing. GPT Sol's P2 finding 6.
+ */
+export type GitSnapshot = {
+  main: MainRef;
+  ancestry: AncestryReading;
+  commitsSince: CountReading;
+};
+
+/**
+ * Production's tip, as the dashboard's checkout last heard it.
+ *
+ * `lastFetchAtMs` is the age of **the view, not of the commit**. The dashboard
+ * never fetches — see `tools/fleet/git-probe.ts` — so a ref nobody has updated
+ * in a week looks exactly like a week with no deploys unless the page can tell
+ * the two apart.
+ */
+export type MainRef =
+  | { kind: "ref"; sha: string; committedAt: string; lastFetchAtMs: number | null }
+  | { kind: "unavailable"; why: string };
+
+/**
+ * Whether the newest recorded deploy is behind production's tip.
+ *
+ * **Three arms, and the third is why this is not a boolean.** `not-ancestor`
+ * means a rollback or a deploy from somebody's working directory; `unknown`
+ * means we could not ask. Collapsed into one `false`, a git that would not run
+ * renders as a rollback that never happened.
+ */
+export type AncestryReading =
+  | { kind: "ancestor" }
+  | { kind: "not-ancestor" }
+  | { kind: "unknown"; why: string };
+
+/**
+ * How many commits separate the newest recorded deploy from production's tip.
+ *
+ * Non-merge, to match `DeployVersion.commitCount`. **`unknown` rather than a
+ * fallback of `0`**: every failure of this question has a plausible, reassuring
+ * wrong answer, and "0 commits behind" is the most reassuring possible way to
+ * say we have no idea.
+ */
+export type CountReading = { kind: "count"; commits: number } | { kind: "unknown"; why: string };
+
+/**
+ * `GET /api/deploys`.
+ *
+ * **`deploys` with an empty `versions` and `unreadable` are different claims** —
+ * *we read the record and it is empty* against *we could not read it* — and the
+ * page must never draw them the same way. Same discipline as the health chart's
+ * blank day, and the same reason: the collapsed version is a confident sentence
+ * about production that nobody checked.
+ *
+ * On `commitsSince`, read `routes-deploys.ts` before writing a sentence about
+ * the number. **It is not undeployed work.** Everything on `main` has shipped or
+ * is shipping, since `main` is written only by `npm run deploy`; the number
+ * lumps together deploys the changelog job has not recorded yet and a tip that
+ * has not been deployed, and nothing on this box can separate those without a
+ * Vercel token.
+ */
+export type DeploysPayload =
+  | {
+      schema: 1;
+      kind: "deploys";
+      /** Newest first, at most `limit` of them. */
+      versions: DeployVersion[];
+      /** How many the record holds altogether, so "show more" knows there is more. */
+      total: number;
+      /** What was served, after clamping — so the page can say if it got less. */
+      limit: number;
+      /** A sentence per line of the record that would not parse. Never merely counted. */
+      unreadable: string[];
+      /** Non-blank lines in the record, parsed or not. The denominator. */
+      recordLines: number;
+      /** When the changelog job last wrote a line. **Not** when anything deployed. */
+      lastGeneratedAt: string | null;
+      /** The newest deploy the record knows about, or null for an empty record. */
+      newestRecordedSha: string | null;
+      /**
+       * The git readings, as **one snapshot of one tip**.
+       *
+       * Nested rather than spread across three sibling fields, so it is not
+       * possible to build a payload whose `ancestry` and `commitsSince` were
+       * measured against different commits. GitSnapshot says why that is a real
+       * risk here rather than a theoretical one.
+       */
+      git: GitSnapshot;
+      /** The server's clock, so the page can age the record against it. */
+      servedAtMs: number;
+    }
+  | { schema: 1; kind: "unreadable"; why: string };
```
