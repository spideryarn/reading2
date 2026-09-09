# Code review round 2: did the fixes actually fix it?

You reviewed this Deploys tab twice — the plan (four P1s) and then the code (four more P1s). This is
the diff of what I did in response to the code round. **Your job now is to check whether each fix is
real or merely plausible**, and to find anything the fixes themselves broke or introduced.

I am more interested in "that fix doesn't work" than in new findings elsewhere, though I want those
too.

## What you found in round 1, and what I did

1. **The tab fetched once per second.** `api = httpDeploysApi()` in a default argument built a new
   object every render; `useNow` re-renders once a second; the panel's effect depends on api
   identity. → `httpDeploysApi` is now a module-level `const` (matching `httpHistoryApi` and
   `httpActionsApi`); the factory is `makeDeploysApi` and the const's doc says not to call it in a
   default argument. **Check: is the identity actually stable now, and did I miss a call site?**

2. **A stale cached ref rendered as a rollback alarm**, and the count on a divergent history is a set
   difference. → The probe now asks ancestry **both** directions and answers four ways: `ancestor`,
   `cache-behind` (benign, drawn without alarm), `diverged` (the real alarm), `unknown`. The count is
   `not-comparable` unless ancestry is `ancestor`. "Production is at X" became "main is at X".
   **Check: are the four arms exhaustive and correctly assigned? Is the new copy true?**

3. **The route's worst case (~20s) exceeded the browser's timeout (15s).** → `SNAPSHOT_BUDGET_MS` of
   8s, opened in `take()` and consumed by every call via `call()`, which passes
   `Math.min(timeoutMs, remaining)` and fails fast at 0. Per-call timeout dropped 5s → 2.5s. The two
   `rev-parse` calls became one. **Check: can the total still exceed 8s? Is the arithmetic right?**

4. **A corrupt newest line let the header measure from the wrong deploy.** → `readDeploys` now
   reports `newestLineRead`; the route passes a `null` watermark when it is false, so the probe
   refuses to measure; the panel says so. **Check: is `newestLineRead` computed correctly for every
   case, including blank lines and a trailing newline?**

Also taken from your P2s: the async `answer()` now has a `.catch` that handles `headersSent`; ages
use `servedAtMs` corrected by browser drift; the client checks `schema` before either arm; "show
more" adds a page rather than jumping to 60; the cache test counts real command executions through an
injected runner instead of counting clock reads.

**Not taken:** reading production's `/build.json` and `/api/health` to split the ambiguous count —
named in the plan as the next step, deliberately out of this branch.

## Specific things I am unsure about

- The `.catch` on `answer()` calls `res.destroy()` when headers are already sent. Is that right, or
  does it mask a case where the response could still be completed?
- `agoFrom` guards `Math.abs(atMs) > 8.64e15`. Is that the correct bound, and did I miss any other
  place an instant reaches a `Date`?
- The single-flight cache still holds one `inFlight` key, which you noted allows an `A → B → A`
  interleaving to launch two A probes. I left it — is that acceptable, given the key is a watermark
  that changes only when the record changes?
- `deployWhen` now delegates to `tools/fleet/zones.ts`, which landed from another session while I was
  working. I did not review that module; I only checked its output.

Findings as P0/P1/P2/P3. Be adversarial.


## The diff of the fixes — only the files this tab owns

```diff
diff --git a/tests/fleet-deploys-route.test.ts b/tests/fleet-deploys-route.test.ts
index 8f07eafd..46fe4769 100644
--- a/tests/fleet-deploys-route.test.ts
+++ b/tests/fleet-deploys-route.test.ts
@@ -25,7 +25,7 @@ import path from "node:path";
 import { afterAll, describe, expect, it } from "vitest";
 
 import { makeDeploys, RECORD_PATH, REPO_ROOT } from "../tools/fleet/deploys-wiring.js";
-import { gitProbe, type GitProbe } from "../tools/fleet/git-probe.js";
+import { gitProbe, type GitProbe, type Ran } from "../tools/fleet/git-probe.js";
 import {
   DEFAULT_LIMIT,
   MAX_LIMIT,
@@ -207,6 +207,36 @@ describe("not knowing, kept apart from knowing", () => {
     expect(payload.versions).toHaveLength(1);
   });
 
+  it("refuses to measure when the record's NEWEST line is corrupt", async () => {
+    /* Otherwise the header calls the newest SURVIVING sha "the newest recorded
+       deploy" and measures a confident distance from the wrong deploy — a
+       number nobody could tell was wrong. GPT Sol's P1 finding 4. */
+    const git = fakeGit();
+    const payload = await deploysPayload(
+      deps({ readRecord: () => ({ ok: true, text: [line(), "{broken"].join("\n") }), git }),
+      10,
+    );
+
+    if (payload.kind !== "deploys") throw new Error("unreachable");
+    expect(payload.newestLineRead).toBe(false);
+    expect(git.asked, "must not measure from a survivor").toEqual([null]);
+    /* The surviving deploys are still listed — the list and the comparison are
+       independent axes. */
+    expect(payload.versions).toHaveLength(1);
+  });
+
+  it("measures normally when an OLDER line is corrupt", async () => {
+    const git = fakeGit();
+    const payload = await deploysPayload(
+      deps({ readRecord: () => ({ ok: true, text: ["{broken", line()].join("\n") }), git }),
+      10,
+    );
+
+    if (payload.kind !== "deploys") throw new Error("unreachable");
+    expect(payload.newestLineRead).toBe(true);
+    expect(git.asked).toEqual([SHA_A]);
+  });
+
   it("passes a null sha for an empty record rather than inventing one", async () => {
     const git = fakeGit();
     await deploysPayload(deps({ readRecord: () => ({ ok: true, text: "" }), git }), 10);
@@ -253,6 +283,17 @@ describe("gitProbe against a real repository", () => {
   /** A fresh probe per case, so the TTL cache never carries an answer across. */
   const probe = (): GitProbe => gitProbe({ repoRoot: dir, ref: "trunk", ttlMs: 0 });
 
+  /** The real command runner, for cases that wrap it to COUNT executions. */
+  const realRun = async (args: string[], ms: number): Promise<Ran> => {
+    try {
+      const stdout = execFileSync("git", args, { cwd: dir, encoding: "utf8", timeout: ms, stdio: ["ignore", "pipe", "pipe"] });
+      return { ok: true, stdout: stdout.trim() };
+    } catch (err) {
+      const e = err as { status?: number; stderr?: string };
+      return { ok: false, why: (e.stderr ?? "").trim() || "failed", status: typeof e.status === "number" ? e.status : null };
+    }
+  };
+
   it("reads the tip's sha and its committer date", async () => {
     const { main } = await probe().snapshot(first);
 
@@ -274,10 +315,28 @@ describe("gitProbe against a real repository", () => {
     expect(snapshot.commitsSince).toEqual({ kind: "count", commits: 2 });
   });
 
-  it("says `not-ancestor` for a sha beside the branch", async () => {
+  it("says `diverged` for a sha beside the branch — the real alarm", async () => {
     const snapshot = await probe().snapshot(offBranch);
 
-    expect(snapshot.ancestry).toEqual({ kind: "not-ancestor" });
+    expect(snapshot.ancestry).toEqual({ kind: "diverged" });
+    /* **And refuses to put a number on it.** `rev-list A..B` across a divergence
+       is a set difference that reads like a distance, so drawing it would be a
+       plausible wrong figure rather than an absent one. */
+    expect(snapshot.commitsSince.kind).toBe("not-comparable");
+  });
+
+  it("says `cache-behind`, NOT an alarm, when the ref is older than the record", async () => {
+    /* **The commonest benign state, and it used to raise a rollback warning.**
+       Whenever the changelog job has run since this checkout last fetched, the
+       recorded deploy is newer than the cached tip and is not its ancestor. An
+       alarm that fires on the normal case is an alarm nobody reads — GPT Sol's
+       P1 finding 2. Modelled here by pointing the probe at an OLDER ref. */
+    const behind = gitProbe({ repoRoot: dir, ref: first, ttlMs: 0 });
+
+    const snapshot = await behind.snapshot(tip);
+
+    expect(snapshot.ancestry).toEqual({ kind: "cache-behind" });
+    expect(snapshot.commitsSince.kind).toBe("not-comparable");
   });
 
   it("counts zero when the record is level with the tip", async () => {
@@ -328,25 +387,113 @@ describe("gitProbe against a real repository", () => {
   });
 
   it("takes one snapshot for concurrent readers, and reuses it inside the TTL", async () => {
-    /* Single flight and a TTL, because this process is the one the Overseer
-       cannot do without: three spawns per reader is how a tab freezes the
-       control plane. */
-    let calls = 0;
+    /* **This test used to prove nothing.** It compared two snapshots for
+       equality — which only shows git is deterministic — and counted calls to
+       the injected CLOCK, so removing the cache entirely would have left it
+       green. GPT Sol, 2026-09-09. It now counts real command executions through
+       the injected runner, which is the number the cache exists to reduce. */
+    let executions = 0;
     const counted = gitProbe({
       repoRoot: dir,
       ref: "trunk",
       ttlMs: 60_000,
-      nowMs: () => {
-        calls += 1;
-        return 1000;
+      run: async (args, ms) => {
+        executions += 1;
+        return realRun(args, ms);
       },
     });
 
     const [a, b] = await Promise.all([counted.snapshot(first), counted.snapshot(first)]);
+    const afterConcurrent = executions;
     expect(a).toEqual(b);
+    expect(afterConcurrent, "two concurrent readers must share one probe").toBeGreaterThan(0);
+
     const c = await counted.snapshot(first);
     expect(c).toEqual(a);
-    expect(calls).toBeGreaterThan(0);
+    expect(executions, "a reader inside the TTL must run no commands at all").toBe(afterConcurrent);
+  });
+
+  it("stops running commands once the snapshot budget is spent", async () => {
+    /* **The route's worst case must stay under the browser's 15s timeout.** It
+       did not: four sequential waits at 5s each is ~20s, so a merely slow git
+       would let the browser replace a perfectly readable deploy list with "no
+       answer". GPT Sol's P1 finding 3. */
+    let executions = 0;
+    const slow = gitProbe({
+      repoRoot: dir,
+      ref: "trunk",
+      ttlMs: 0,
+      budgetMs: 50,
+      run: async (args, ms) => {
+        executions += 1;
+        await new Promise((r) => setTimeout(r, 40));
+        return realRun(args, ms);
+      },
+    });
+
+    const snapshot = await slow.snapshot(first);
+
+    /* It gives up rather than running the whole sequence... */
+    expect(executions).toBeLessThan(5);
+    /* ...and every reading it could not take says so, rather than being absent
+       or fabricated. */
+    const readings = [snapshot.ancestry.kind, snapshot.commitsSince.kind];
+    expect(readings.every((k) => k === "unknown" || k === "not-comparable" || k === "ancestor" || k === "count")).toBe(true);
+  });
+
+  it("gives up with every reading stated, rather than half a snapshot", async () => {
+    /* A budget so small that the first command has already overrun it. What
+       matters is not which sentence comes back — the first call reports its own
+       timeout, later ones report the budget — but that **no reading is left
+       fabricated or absent**: a probe that ran out of time must not produce a
+       count, and must not produce a ref it did not read. */
+    const stalled = gitProbe({
+      repoRoot: dir,
+      ref: "trunk",
+      ttlMs: 0,
+      budgetMs: 1,
+      run: async (args, ms) => {
+        await new Promise((r) => setTimeout(r, 20));
+        return realRun(args, ms);
+      },
+    });
+
+    const snapshot = await stalled.snapshot(first);
+
+    expect(snapshot.main.kind).toBe("unavailable");
+    if (snapshot.main.kind !== "unavailable") throw new Error("unreachable");
+    expect(snapshot.main.why, "a refusal must say why").not.toBe("");
+    expect(snapshot.commitsSince.kind).toBe("unknown");
+    expect(snapshot.ancestry.kind).toBe("unknown");
+  });
+
+  it("names the budget on the calls the budget actually stopped", async () => {
+    /* The distinct sentence, checked where it can appear: a budget big enough
+       for the first call and not for the rest. */
+    let seen = 0;
+    const tight = gitProbe({
+      repoRoot: dir,
+      ref: "trunk",
+      ttlMs: 0,
+      budgetMs: 60,
+      run: async (args, ms) => {
+        seen += 1;
+        await new Promise((r) => setTimeout(r, 55));
+        return realRun(args, ms);
+      },
+    });
+
+    const snapshot = await tight.snapshot(first);
+
+    expect(seen, "the first call should get through").toBeGreaterThan(0);
+    const sentences = [
+      snapshot.main.kind === "unavailable" ? snapshot.main.why : "",
+      snapshot.ancestry.kind === "unknown" ? snapshot.ancestry.why : "",
+      snapshot.commitsSince.kind === "unknown" || snapshot.commitsSince.kind === "not-comparable"
+        ? snapshot.commitsSince.why
+        : "",
+    ].join(" | ");
+    expect(sentences).toContain("budget");
   });
 
   it("does not serve one watermark's answer for another", async () => {
@@ -356,7 +503,7 @@ describe("gitProbe against a real repository", () => {
     const beside = await cached.snapshot(offBranch);
 
     expect(onBranch.ancestry.kind).toBe("ancestor");
-    expect(beside.ancestry.kind).toBe("not-ancestor");
+    expect(beside.ancestry.kind).toBe("diverged");
   });
 });
 
diff --git a/tests/fleet-deploys.test.ts b/tests/fleet-deploys.test.ts
index e0f83424..f3b08859 100644
--- a/tests/fleet-deploys.test.ts
+++ b/tests/fleet-deploys.test.ts
@@ -296,6 +296,44 @@ describe("newestDeploy and lastGeneratedAt", () => {
   });
 });
 
+/**
+ * **A corrupt NEWEST line is not the same as a corrupt line.**
+ *
+ * The record is append-only, so its last line is its newest deploy. When that
+ * line fails, `newestDeploy()` hands back the one before it and everything
+ * downstream calls that "the newest recorded deploy" and measures a confident
+ * distance from the wrong place. The earlier tests only covered a corrupt
+ * OLDEST line, which costs a row and nothing else — GPT Sol's P1 finding 4,
+ * 2026-09-09, and it is the difference between a test that looks thorough and
+ * one that is.
+ */
+describe("which line was corrupt matters", () => {
+  it("says the newest line failed when it did", () => {
+    const read = readDeploys([line({ deployment_id: "dpl_1" }), "{broken"].join("\n"));
+
+    expect(read.newestLineRead).toBe(false);
+    expect(read.versions).toHaveLength(1);
+  });
+
+  it("says the newest line was fine when an OLDER one failed", () => {
+    const read = readDeploys(
+      ["{broken", line({ version: "2026-09-03T10:00:00Z", sha: SHA_C, deployment_id: "dpl_3" })].join("\n"),
+    );
+
+    expect(read.newestLineRead).toBe(true);
+    expect(read.unreadable).toHaveLength(1);
+  });
+
+  it("is false for an empty record, because there is no newest line to have read", () => {
+    expect(readDeploys("").newestLineRead).toBe(false);
+    expect(readDeploys("\n\n").newestLineRead).toBe(false);
+  });
+
+  it("ignores a trailing newline, which is not a corrupt line", () => {
+    expect(readDeploys(`${line()}\n`).newestLineRead).toBe(true);
+  });
+});
+
 /**
  * **THE CHECK THAT CAN GO RED WITHOUT ANYBODY TOUCHING THIS BRANCH.**
  *
diff --git a/tools/fleet/deploys.ts b/tools/fleet/deploys.ts
index 7fbc41c4..1f6423d4 100644
--- a/tools/fleet/deploys.ts
+++ b/tools/fleet/deploys.ts
@@ -84,6 +84,21 @@ export type DeployRead = {
   unreadable: string[];
   /** Non-blank lines seen, parsed or not. The denominator for any claim about the file. */
   lines: number;
+  /**
+   * **Whether the LAST non-blank line of the file parsed.**
+   *
+   * Its own field because a corrupt last line is a different situation from a
+   * corrupt middle one, and only this one poisons the header. The file is
+   * append-only, so its last line is the newest deploy; if it fails,
+   * `newestDeploy()` returns the one before it, and everything downstream then
+   * calls that "the newest recorded deploy" and measures a distance from it —
+   * confidently, and about the wrong deploy. GPT Sol's P1 finding 4, 2026-09-09,
+   * and the tests only covered a corrupt OLDEST line, which costs nothing.
+   *
+   * False on an empty file too: there is no newest line, so nothing may claim to
+   * be it.
+   */
+  newestLineRead: boolean;
 };
 
 const SHA = /^[0-9a-f]{40}$/;
@@ -242,6 +257,10 @@ export function readDeploys(text: string): DeployRead {
   const versions: DeployVersion[] = [];
   const unreadable: string[] = [];
   let release = 0;
+  /* Set on every non-blank line and therefore describing the LAST one when the
+     loop ends. The file is append-only, so that line is the newest deploy —
+     see `DeployRead.newestLineRead`. */
+  let newestLineRead = false;
 
   for (const [i, line] of text.split("\n").entries()) {
     if (line.trim() === "") continue;
@@ -252,15 +271,21 @@ export function readDeploys(text: string): DeployRead {
       raw = JSON.parse(line);
     } catch (err) {
       unreadable.push(`${where}: does not parse (${(err as Error).message.slice(0, 60)})`);
+      newestLineRead = false;
       continue;
     }
     const read = readVersion(raw, release, where);
-    if (typeof read === "string") unreadable.push(read);
-    else versions.push(read);
+    if (typeof read === "string") {
+      unreadable.push(read);
+      newestLineRead = false;
+    } else {
+      versions.push(read);
+      newestLineRead = true;
+    }
   }
 
   versions.reverse();
-  return { versions, unreadable, lines: release };
+  return { versions, unreadable, lines: release, newestLineRead };
 }
 
 /**
diff --git a/tools/fleet/git-probe.ts b/tools/fleet/git-probe.ts
index 246e676a..67143382 100644
--- a/tools/fleet/git-probe.ts
+++ b/tools/fleet/git-probe.ts
@@ -70,7 +70,24 @@ export type { AncestryReading, CountReading, GitSnapshot, MainRef };
 const run = promisify(execFile);
 
 /** Long enough for a cold cache on a loaded box, short enough not to hang a poll. */
-export const GIT_TIMEOUT_MS = 5_000;
+export const GIT_TIMEOUT_MS = 2_500;
+
+/**
+ * **The whole snapshot's budget, and it MUST stay under the browser's.**
+ *
+ * The per-call timeout is not the route's worst case: resolving the ref, then
+ * two `rev-parse` calls for `FETCH_HEAD`, then the ancestry/count phase is four
+ * sequential waits. At 5 s each that was ~20 s — while `deploys-client.ts` gives
+ * up at 15 s. So the probe would eventually produce its honest `unknown` arms
+ * and **the browser would already have replaced the whole readable deploy list
+ * with "no answer"**: a git that was merely slow would blank a record that read
+ * perfectly. GPT Sol's P1 finding 3, 2026-09-09.
+ *
+ * 8 s against the client's 15 s leaves room for the file read, the JSON and the
+ * gzip, and means a slow git costs the reader some greyed-out comparisons rather
+ * than the list.
+ */
+export const SNAPSHOT_BUDGET_MS = 8_000;
 
 /**
  * How long a snapshot stands.
@@ -102,7 +119,7 @@ export type GitProbe = {
   snapshot(recordedSha: string | null): Promise<GitSnapshot>;
 };
 
-type Ran = { ok: true; stdout: string } | { ok: false; why: string; status: number | null };
+export type Ran = { ok: true; stdout: string } | { ok: false; why: string; status: number | null };
 
 /**
  * One git call.
@@ -165,14 +182,16 @@ async function git(repoRoot: string, args: string[], timeoutMs: number): Promise
  * it. Anything stronger needs `git ls-remote`, which is network work this route
  * has decided not to do.
  */
-async function lastFetchAtMs(repoRoot: string, timeoutMs: number): Promise<number | null> {
-  const dirs: string[] = [];
-  /* This worktree's gitdir and the shared common dir: a fetch run in any
-     worktree writes its own FETCH_HEAD, and the refs it wrote are shared. */
-  for (const flag of ["--git-dir", "--git-common-dir"]) {
-    const read = await git(repoRoot, ["rev-parse", flag], timeoutMs);
-    if (read.ok && read.stdout !== "") dirs.push(path.resolve(repoRoot, read.stdout));
-  }
+async function lastFetchAtMs(call: (args: string[]) => Promise<Ran>): Promise<number | null> {
+  /* Both dirs in ONE call rather than two sequential ones — it halves this
+     step's share of the snapshot budget, and `rev-parse` takes several flags. */
+  const read = await call(["rev-parse", "--git-dir", "--git-common-dir"]);
+  if (!read.ok) return null;
+  const dirs = read.stdout
+    .split("\n")
+    .map((line) => line.trim())
+    .filter((line) => line !== "")
+    .map((line) => path.resolve(line));
   let newest: number | null = null;
   for (const dir of dirs) {
     try {
@@ -198,14 +217,20 @@ export function gitProbe(options: {
   /** Default `origin/main`, which is production. Never `main`, a local branch. */
   ref?: string;
   timeoutMs?: number;
+  /** The whole snapshot's ceiling. See `SNAPSHOT_BUDGET_MS`. */
+  budgetMs?: number;
   ttlMs?: number;
   nowMs?: () => number;
+  /** Injectable so a test can count real executions rather than trust a fake. */
+  run?: (args: string[], timeoutMs: number) => Promise<Ran>;
 }): GitProbe {
   const repoRoot = options.repoRoot;
   const ref = options.ref ?? "origin/main";
   const timeoutMs = options.timeoutMs ?? GIT_TIMEOUT_MS;
+  const budgetMs = options.budgetMs ?? SNAPSHOT_BUDGET_MS;
   const ttlMs = options.ttlMs ?? SNAPSHOT_TTL_MS;
   const now = options.nowMs ?? ((): number => Date.now());
+  const exec = options.run ?? ((args, ms): Promise<Ran> => git(repoRoot, args, ms));
 
   /* Single flight and a short TTL. Two readers arriving together share one
      probe; a reader arriving inside the window pays nothing. Keyed by the
@@ -214,7 +239,21 @@ export function gitProbe(options: {
   let inFlight: { key: string; promise: Promise<GitSnapshot> } | null = null;
 
   async function take(recordedSha: string | null): Promise<GitSnapshot> {
-    const main = await readRef();
+    /* The budget is opened here and consumed by every call below, so the four
+       sequential waits cannot add up past it. `left()` returning 0 means the
+       remaining calls fail fast with a stated reason rather than each starting
+       a fresh timeout of its own. */
+    const deadline = now() + budgetMs;
+    const left = (): number => Math.max(0, deadline - now());
+    const call = async (args: string[]): Promise<Ran> => {
+      const remaining = left();
+      if (remaining <= 0) {
+        return { ok: false, why: `the ${budgetMs}ms budget for reading git ran out`, status: null };
+      }
+      return exec(args, Math.min(timeoutMs, remaining));
+    };
+
+    const main = await readRef(call);
     if (main.kind !== "ref") {
       /* No tip, so nothing to compare against — and saying so once is better
          than three arms each blaming git separately. */
@@ -231,46 +270,93 @@ export function gitProbe(options: {
     }
 
     /* **Against the resolved sha, not against `ref`.** That is the whole point
-       of taking a snapshot: the three answers describe one tip even if somebody
-       fetches underneath us. */
-    const [ancestry, commitsSince] = await Promise.all([
-      readAncestry(recordedSha, main.sha),
-      readCount(recordedSha, main.sha),
+       of taking a snapshot: every answer describes one tip even if somebody
+       fetches underneath us.
+
+       Both directions of the ancestry question, because they mean different
+       things and only asking one way makes a stale cache look like a rollback —
+       see `AncestryReading` in wire.ts. */
+    const [forwards, backwards, commitsSince] = await Promise.all([
+      isAncestorOf(call, recordedSha, main.sha),
+      isAncestorOf(call, main.sha, recordedSha),
+      readCount(call, recordedSha, main.sha),
     ]);
-    return { main, ancestry, commitsSince };
+
+    const ancestry = readAncestry(forwards, backwards);
+    return {
+      main,
+      ancestry,
+      /* **The count is withheld unless the histories are actually comparable.**
+         On a divergent pair `rev-list A..B` is a set difference that reads like
+         a distance. */
+      commitsSince:
+        ancestry.kind === "ancestor"
+          ? commitsSince
+          : ancestry.kind === "unknown"
+            ? { kind: "unknown", why: ancestry.why }
+            : {
+                kind: "not-comparable",
+                why:
+                  ancestry.kind === "cache-behind"
+                    ? "this checkout has not fetched since that deploy, so it cannot measure the distance"
+                    : "the recorded deploy and the cached tip have diverged, so there is no distance between them",
+              },
+    };
   }
 
-  async function readRef(): Promise<MainRef> {
+  async function readRef(call: (args: string[]) => Promise<Ran>): Promise<MainRef> {
     /* One call for both fields: `%H %cI` off the tip. Two calls could disagree
        with each other if somebody fetched between them, which is a sha and a
        date from different commits. */
-    const read = await git(repoRoot, ["log", "-1", "--format=%H %cI", ref], timeoutMs);
+    const read = await call(["log", "-1", "--format=%H %cI", ref]);
     if (!read.ok) return { kind: "unavailable", why: `${ref}: ${read.why}` };
     const [sha, committedAt] = read.stdout.split(" ");
     if (sha === undefined || !SHA.test(sha) || committedAt === undefined) {
       return { kind: "unavailable", why: `${ref}: git answered something unreadable` };
     }
-    return { kind: "ref", sha, committedAt, lastFetchAtMs: await lastFetchAtMs(repoRoot, timeoutMs) };
+    return { kind: "ref", sha, committedAt, lastFetchAtMs: await lastFetchAtMs(call) };
+  }
+
+  /**
+   * Is `sha` an ancestor of `of`? Three answers, never two.
+   *
+   * **EXIT 1 IS THE ANSWER "no", NOT A FAILURE.** Everything else — 128 for an
+   * unknown sha, a timeout, a missing git — is a failure, and collapsing the two
+   * draws a definite "no", which downstream reads as a rollback nobody
+   * performed.
+   */
+  async function isAncestorOf(
+    call: (args: string[]) => Promise<Ran>,
+    sha: string,
+    of: string,
+  ): Promise<boolean | { why: string }> {
+    const read = await call(["merge-base", "--is-ancestor", sha, of]);
+    if (read.ok) return true;
+    if (read.status === 1) return false;
+    return { why: read.why };
   }
 
-  async function readAncestry(sha: string, tip: string): Promise<AncestryReading> {
-    const read = await git(repoRoot, ["merge-base", "--is-ancestor", sha, tip], timeoutMs);
-    if (read.ok) return { kind: "ancestor" };
-    /* **EXIT 1 IS THE ANSWER "no", NOT A FAILURE.** Everything else — 128 for an
-       unknown sha, a timeout, a missing git — is a failure, and collapsing the
-       two draws "this deploy is not on main", which reads as a rollback nobody
-       performed. */
-    if (read.status === 1) return { kind: "not-ancestor" };
-    return { kind: "unknown", why: read.why };
+  /** The two directions, read together. wire.ts § AncestryReading says why. */
+  function readAncestry(
+    forwards: boolean | { why: string },
+    backwards: boolean | { why: string },
+  ): AncestryReading {
+    if (typeof forwards !== "boolean") return { kind: "unknown", why: forwards.why };
+    if (forwards) return { kind: "ancestor" };
+    /* Not an ancestor. The reverse question decides whether that is alarming.
+       If IT could not be asked we must not guess: an unreadable second answer
+       makes the pair unknown rather than divergent. */
+    if (typeof backwards !== "boolean") return { kind: "unknown", why: backwards.why };
+    return backwards ? { kind: "cache-behind" } : { kind: "diverged" };
   }
 
-  async function readCount(sha: string, tip: string): Promise<CountReading> {
+  async function readCount(call: (args: string[]) => Promise<Ran>, sha: string, tip: string): Promise<CountReading> {
     /* `--no-merges` to match the record's own `commit_count`, which drops merge
        commits — every one here is a `Merge remote-tracking branch 'origin/dev'`
        carrying no change of its own. A count taken the other way would sit
        beside the record's numbers looking comparable and not be.
        docs/project/changelog.md § Enumerate. */
-    const read = await git(repoRoot, ["rev-list", "--count", "--no-merges", `${sha}..${tip}`], timeoutMs);
+    const read = await call(["rev-list", "--count", "--no-merges", `${sha}..${tip}`]);
     if (!read.ok) return { kind: "unknown", why: read.why };
     const commits = Number(read.stdout);
     if (!Number.isInteger(commits) || commits < 0) {
diff --git a/tools/fleet/routes-deploys.ts b/tools/fleet/routes-deploys.ts
index 8f64cb3e..f347945d 100644
--- a/tools/fleet/routes-deploys.ts
+++ b/tools/fleet/routes-deploys.ts
@@ -156,8 +156,15 @@ export async function deploysPayload(deps: DeploysRouteDeps, limit: number): Pro
 
   /* One await, one snapshot, one tip. The probe holds the arm for "the record
      names no deploy to measure from" so that the reason a reading is missing
-     lives in one place rather than being invented twice. */
-  const git = await deps.git.snapshot(newest?.sha ?? null);
+     lives in one place rather than being invented twice.
+
+     **A null watermark when the newest LINE did not parse.** `newestDeploy()`
+     would hand back the newest line that *survived*, and comparing against that
+     produces a confident distance from the wrong deploy — a number nobody could
+     tell was wrong. Refusing to measure is the honest answer, and the page says
+     which. GPT Sol's P1 finding 4. */
+  const watermark = read.newestLineRead ? (newest?.sha ?? null) : null;
+  const git = await deps.git.snapshot(watermark);
 
   return {
     schema: 1,
@@ -169,6 +176,7 @@ export async function deploysPayload(deps: DeploysRouteDeps, limit: number): Pro
     recordLines: read.lines,
     lastGeneratedAt: lastGeneratedAt(read),
     newestRecordedSha: newest?.sha ?? null,
+    newestLineRead: read.newestLineRead,
     git,
     servedAtMs: deps.nowMs(),
   };
@@ -195,12 +203,30 @@ export function deploysRoute(deps: DeploysRouteDeps): {
         return true;
       }
 
-      /* `void` because the work is async and this never rejects — it catches
-         its own failures and answers 500. An unhandled rejection here would be
-         a request that hangs until the client gives up, which on a phone is
-         indistinguishable from the box being down. The same call
-         `routes-new.ts` makes. */
-      void answer(deps, url, req, res);
+      /* `void` because the work is async, **plus a `catch` because "never
+         rejects" was an assertion rather than a fact.** The try/catch inside
+         `answer` used to end before the gzip and the send, so a throw from
+         `gzipSync`, `writeHead` or `end` escaped as an unhandled rejection and
+         left the request unanswered — which on a phone is indistinguishable
+         from the box being down. GPT Sol, 2026-09-09.
+
+         Nothing is written here: by the time this fires the response may be
+         half-sent, and a second `writeHead` would throw again. Destroying the
+         socket is what tells the client to stop waiting. */
+      void answer(deps, url, req, res).catch((err: unknown) => {
+        try {
+          if (!res.headersSent) {
+            res.writeHead(500, { "content-type": "application/json", "cache-control": "no-store" });
+            res.end(JSON.stringify({ schema: 1, kind: "unreadable", why: "the deploys route failed while answering" }));
+          } else {
+            res.destroy(err instanceof Error ? err : undefined);
+          }
+        } catch {
+          /* The response is beyond saving. Better a dropped socket, which a
+             client sees as a failed request, than a hang. */
+          res.destroy();
+        }
+      });
       return true;
     },
   };
diff --git a/tools/fleet/web/src/DeploysPanel.tsx b/tools/fleet/web/src/DeploysPanel.tsx
index 1933afdf..c3554413 100644
--- a/tools/fleet/web/src/DeploysPanel.tsx
+++ b/tools/fleet/web/src/DeploysPanel.tsx
@@ -43,6 +43,7 @@ import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } fro
 import { Explain, type Tip } from "./Tooltip";
 import {
   FIRST_PAGE,
+  MAX_LIMIT,
   MORE_PAGE,
   ago,
   agoFrom,
@@ -93,8 +94,28 @@ function Sha({ sha }: { sha: string }): ReactNode {
  * omitting a line whose reading failed — leaves a header that looks complete and
  * is quietly missing the one fact that was wrong.
  */
-function Freshness({ view, nowMs }: { view: Extract<DeploysView, { kind: "deploys" }>; nowMs: number }): ReactNode {
-  const generatedAgo = ago(view.lastGeneratedAt, nowMs);
+function Freshness({
+  view,
+  nowMs,
+  arrivedAtMs,
+}: {
+  view: Extract<DeploysView, { kind: "deploys" }>;
+  nowMs: number;
+  /** The browser's clock at the moment this payload landed. See `skewed` below. */
+  arrivedAtMs: number;
+}): ReactNode {
+  /* **Ages are measured against the SERVER's clock, corrected by the skew this
+     browser has drifted since the answer arrived.**
+
+     Every timestamp here was stamped by the box; `nowMs` is the phone's. On a
+     device whose clock is a few minutes out, subtracting one from the other
+     changes every "ago" on the page — and this panel's whole subject is how
+     stale things are, so a device-skew error reads as a stale record. The
+     payload carries `servedAtMs` for exactly this and it was going unused.
+     GPT Sol, 2026-09-09. `skewed` keeps ticking, because an age that only moves
+     when data arrives freezes at the moment it matters. */
+  const skewed = view.servedAtMs + (nowMs - arrivedAtMs);
+  const generatedAgo = ago(view.lastGeneratedAt, skewed);
   const mainRef = view.git.main;
 
   return (
@@ -113,10 +134,14 @@ function Freshness({ view, nowMs }: { view: Extract<DeploysView, { kind: "deploy
       </div>
 
       <div className="tw:mt-1.5 tw:flex tw:flex-wrap tw:items-baseline tw:gap-x-2 tw:gap-y-1">
-        <span className="tw:font-semibold tw:text-ink">Production</span>
+        {/* **"main is at", not "Production is at".** The second is the claim the
+            route's own comment says cannot be made from here: `deploy.ts` pushes
+            and then waits, so the tip of main is where a deploy *attempt* got
+            to, not what is serving. GPT Sol's P1 finding 2. */}
+        <span className="tw:font-semibold tw:text-ink">main</span>
         {mainRef.kind === "ref" ? (
           <span>
-            is at <Sha sha={mainRef.sha} />, committed {ago(mainRef.committedAt, nowMs) ?? "at an unreadable time"}
+            is at <Sha sha={mainRef.sha} />, committed {ago(mainRef.committedAt, skewed) ?? "at an unreadable time"}
             {/* **The age of the VIEW, not of the commit** — a ref nobody has
                 updated in a week looks exactly like a week with no deploys
                 unless this says which it is. **Labelled as exactly what it
@@ -132,7 +157,7 @@ function Freshness({ view, nowMs }: { view: Extract<DeploysView, { kind: "deploy
               <span className="tw:text-ink-faint">
                 {" "}
                 — a cached view; this checkout last fetched something{" "}
-                {agoFrom(mainRef.lastFetchAtMs, nowMs) ?? "at an unreadable time"}
+                {agoFrom(mainRef.lastFetchAtMs, skewed) ?? "at an unreadable time"}
               </span>
             )}
           </span>
@@ -141,21 +166,28 @@ function Freshness({ view, nowMs }: { view: Extract<DeploysView, { kind: "deploy
         )}
       </div>
 
-      {/* Ancestry: three arms, and `not-ancestor` is the one worth a colour.
-          It means the newest recorded deploy is not on main at all — a rollback,
-          or a deploy from somebody's working directory — which changelog.md
-          says to check per version precisely because it breaks the ranges
-          silently. */}
+      {/* **Four arms, and only ONE of them is an alarm.** This drew a rollback
+          warning for any non-ancestor until 2026-09-09 — including the
+          commonest benign case, a cached ref older than the record, which is
+          what you get whenever the changelog job has run since this checkout
+          last fetched. An alarm that fires on the normal state is an alarm
+          nobody reads. wire.ts § AncestryReading. */}
       <div className="tw:mt-1.5 tw:flex tw:flex-wrap tw:items-baseline tw:gap-x-2 tw:gap-y-1">
         {view.git.ancestry.kind === "ancestor" ? (
-          <span className="tw:text-ink-faint">The newest recorded deploy is on main.</span>
-        ) : view.git.ancestry.kind === "not-ancestor" ? (
+          <span className="tw:text-ink-faint">The newest recorded deploy is in this checkout&rsquo;s history of main.</span>
+        ) : view.git.ancestry.kind === "cache-behind" ? (
+          <span className="tw:text-ink-faint">
+            This checkout has not fetched since the newest recorded deploy, so it cannot say how far behind the record
+            is. Nothing is wrong.
+          </span>
+        ) : view.git.ancestry.kind === "diverged" ? (
           <span className="tw:font-semibold tw:text-alarm-ink">
-            The newest recorded deploy is not on main — a rollback, or a deploy from a working directory.
+            The newest recorded deploy is not in this checkout&rsquo;s history of main at all, and main is not in its
+            history either — a rollback, or a deploy from a working directory.
           </span>
         ) : (
           <span className="tw:text-unknown-ink">
-            Whether the newest recorded deploy is on main could not be checked: {view.git.ancestry.why}
+            How the newest recorded deploy sits against main could not be checked: {view.git.ancestry.why}
           </span>
         )}
       </div>
@@ -171,6 +203,12 @@ function Freshness({ view, nowMs }: { view: Extract<DeploysView, { kind: "deploy
               </span>
             </span>
           </Explain>
+        ) : view.git.commitsSince.kind === "not-comparable" ? (
+          /* Deliberately NOT a number. `rev-list A..B` on divergent histories is
+             a set difference that reads like a distance. */
+          <span className="tw:text-ink-faint">
+            No distance from the newest recorded deploy to main can be measured: {view.git.commitsSince.why}
+          </span>
         ) : (
           <span className="tw:text-unknown-ink">
             How far the record is behind main could not be measured: {view.git.commitsSince.why}
@@ -178,6 +216,18 @@ function Freshness({ view, nowMs }: { view: Extract<DeploysView, { kind: "deploy
         )}
       </div>
 
+      {/* **The newest line specifically.** A corrupt line anywhere costs a
+          deploy; a corrupt LAST line also means everything above is measured
+          from the wrong place, because the record is append-only and its last
+          line is its newest deploy. The route refuses to measure at all in that
+          case, and this is where the page says why. GPT Sol's P1 finding 4. */}
+      {!view.newestLineRead && view.recordLines > 0 ? (
+        <div className="tw:mt-1.5 tw:font-semibold tw:text-alarm-ink">
+          The record&rsquo;s newest line could not be read, so the newest deploy is unknown and nothing above is
+          measured against it.
+        </div>
+      ) : null}
+
       {/* A line of the record that would not parse is a deploy missing from the
           list. Counted and shown, never swallowed — otherwise the list is
           quietly short and looks complete. */}
@@ -288,7 +338,7 @@ function DeployCard({ version, nowMs }: { version: DeployVersion; nowMs: number
 }
 
 export function DeploysPanel({
-  api = httpDeploysApi(),
+  api = httpDeploysApi,
   now,
   refreshNonce = 0,
 }: {
@@ -308,6 +358,9 @@ export function DeploysPanel({
   refreshNonce?: number;
 }): ReactNode {
   const [state, setState] = useState<State>({ kind: "loading" });
+  /* Stamped when the payload lands rather than read at render time: the gap
+     between the two is what `skewed` is correcting for. */
+  const [arrivedAtMs, setArrivedAtMs] = useState<number>(() => Date.now());
   const [limit, setLimit] = useState<number>(FIRST_PAGE);
   /* The panel's own view of "now" is the page's, but a fetch must not be
      re-issued every time it ticks — hence `limit` in the dependency list and
@@ -325,7 +378,9 @@ export function DeploysPanel({
     const controller = new AbortController();
     let live = true;
     void api.fetch(limit, controller.signal).then((view) => {
-      if (live) setState(view);
+      if (!live) return;
+      setArrivedAtMs(Date.now());
+      setState(view);
     });
     return () => {
       live = false;
@@ -333,7 +388,11 @@ export function DeploysPanel({
     };
   }, [api, limit, refreshNonce]);
 
-  const showMore = useCallback(() => setLimit(MORE_PAGE), []);
+  /* **Adds a page rather than setting one.** `setLimit(MORE_PAGE)` jumped to 60
+     and then did nothing on every later press — with 74 deploys the button
+     stayed visible offering 14 more and delivering none. The fake API returned
+     one row whatever the limit, so no test could see it. GPT Sol, 2026-09-09. */
+  const showMore = useCallback(() => setLimit((n) => Math.min(n + MORE_PAGE, MAX_LIMIT)), []);
 
   const more = useMemo(
     () => (state.kind === "deploys" ? state.total - state.versions.length : 0),
@@ -368,7 +427,7 @@ export function DeploysPanel({
         </Card>
       ) : (
         <>
-          <Freshness view={state} nowMs={now} />
+          <Freshness view={state} nowMs={now} arrivedAtMs={arrivedAtMs} />
 
           {state.versions.length === 0 ? (
             /* We READ the record and it is empty — a different claim from
@@ -379,7 +438,13 @@ export function DeploysPanel({
           ) : (
             <div className="tw:flex tw:flex-col tw:gap-2">
               {state.versions.map((version) => (
-                <DeployCard key={version.deploymentId} version={version} nowMs={now} />
+                <DeployCard
+                  key={version.deploymentId}
+                  version={version}
+                  /* The same corrected clock the header uses, so a deploy's age
+                     and the record's age cannot disagree by the device's drift. */
+                  nowMs={state.servedAtMs + (now - arrivedAtMs)}
+                />
               ))}
             </div>
           )}
diff --git a/tools/fleet/web/src/deploys-client.ts b/tools/fleet/web/src/deploys-client.ts
index 0b077cb3..6121327d 100644
--- a/tools/fleet/web/src/deploys-client.ts
+++ b/tools/fleet/web/src/deploys-client.ts
@@ -26,15 +26,27 @@
  * in a test that has none.
  */
 import type { DeploysPayload, DeployVersion } from "../../wire";
+import { zonedLine } from "../../zones";
 
 export const DEPLOYS_URL = "api/deploys";
 
 /** How many the tab asks for first. The server's own default, restated so a caller can widen it. */
 export const FIRST_PAGE = 10;
 
-/** What "show more" asks for. The server clamps at 200. */
+/** How many more rows each "show more" press asks for. */
 export const MORE_PAGE = 60;
 
+/**
+ * The ceiling, restated from the route's own `MAX_LIMIT`.
+ *
+ * Two copies of a number is how they come to disagree, and normally this would
+ * be imported — but `routes-deploys.ts` reaches `node:fs`, so the browser
+ * project cannot see it (wire.ts's header has the measurement). It is a `const`
+ * rather than a magic number so the next person finds this note; the route
+ * clamps regardless, so a disagreement costs a wasted press rather than a bug.
+ */
+export const MAX_LIMIT = 200;
+
 /** How long before deciding an answer is not coming. */
 export const REQUEST_TIMEOUT_MS = 15_000;
 
@@ -97,8 +109,8 @@ function readPayload(body: unknown): DeploysView {
   return body as DeploysView;
 }
 
-/** The real one. Relative URL, so the tool works behind any host. */
-export function httpDeploysApi(url: string = DEPLOYS_URL): DeploysApi {
+/** A client against a given URL. Relative, so the tool works behind any host. */
+export function makeDeploysApi(url: string = DEPLOYS_URL): DeploysApi {
   return {
     async fetch(limit, signal): Promise<DeploysView> {
       const controller = new AbortController();
@@ -142,6 +154,26 @@ export function httpDeploysApi(url: string = DEPLOYS_URL): DeploysApi {
   };
 }
 
+/**
+ * The real one, built once.
+ *
+ * **A FACTORY CALLED IN A DEFAULT ARGUMENT IS A NEW OBJECT EVERY RENDER**, and
+ * this page re-renders once a second because `useNow` ticks. `DeploysPanel`'s
+ * effect depends on the api's identity, so `api = makeDeploysApi()` as a default
+ * meant: abort the in-flight request and start another, once a second, for as
+ * long as the tab is open — while the box kept working on every abandoned one.
+ * A response slower than a second would never have been accepted at all.
+ *
+ * The tests could not see it because they inject a stable fake, which is exactly
+ * the shape of hole GPT Sol was looking for. Found in review, 2026-09-09.
+ *
+ * So this is a `const`, like `httpHistoryApi` and `httpActionsApi` beside it —
+ * the house pattern, and now for a reason that is written down. `makeDeploysApi`
+ * remains for a caller that needs a different URL; **do not call it in a default
+ * argument.**
+ */
+export const httpDeploysApi: DeploysApi = makeDeploysApi();
+
 /* ------------------------------------------------------------------ *
  * Saying when, and how long ago.
  * ------------------------------------------------------------------ */
@@ -155,16 +187,17 @@ export function httpDeploysApi(url: string = DEPLOYS_URL): DeploysApi {
  * 23:40 UTC is 02:40 Athens *the next day*, and printed bare beside the UTC time
  * it reads as three hours in the past.
  *
- * Until that module is on `dev` this spells the UTC time only, which is true and
- * not yet useful to somebody in Athens. **When it lands, this function's body
- * becomes `return zonedLine(iso) ?? …` and nothing else in this tab changes** —
- * which is the whole reason it is a function here rather than four lines inside
- * the panel's JSX.
+ * **Landed 2026-09-09** (`af1ec002`), and the swap was one line, which is the
+ * whole reason this was a function rather than four lines inside the panel's
+ * JSX. It returns `null` rather than throwing on anything unreadable, and the
+ * panel already draws `null` as "at a time this page cannot read".
  */
 export function deployWhen(iso: string): string | null {
-  const at = Date.parse(iso);
-  if (Number.isNaN(at)) return null;
-  return `${iso.replace("T", " ").replace("Z", "")} UTC`;
+  /* No `zones` argument, so this gets `DISPLAY_ZONES` — UTC, London, Athens.
+     **Pass a set rather than editing that constant** if a caller ever wants a
+     different one: it is Greg's "I'm bouncing between London/Athens" and it is
+     read by the usage card and `scripts/overseer.ts` too. zones.ts says so. */
+  return zonedLine(iso);
 }
 
 /**
```
