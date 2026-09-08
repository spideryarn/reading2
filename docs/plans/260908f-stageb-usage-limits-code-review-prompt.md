# Cross-family code review — Stage B of orchestrator wave 2: the usage-limits collector

You are reviewing NEW code, not a plan. Weight this higher than a plan-stage review: a plan review
cannot catch a function that reports the wrong field.

## What this is

Spideryarn runs a fleet of ~30 concurrent Claude Code sessions on one Hetzner box. The "Overseer" is
a tool that watches them. Stage B of `docs/plans/260908f-orchestrator-wave-2-…md` is a collector that
answers: **how close is the current Claude Max subscription to its usage limit, and which sessions
have already been stopped by a 429?**

The measurements it is built on were researched and hand-verified on 2026-09-08 and are recorded in
`docs/project/orchestrator-direction.md`. The relevant conclusions, which you should treat as
established rather than re-derive:

- There is **no supported API** for subscription quota. Every `/v1/organizations/*` usage endpoint
  reports Console API-key spend, not subscription quota; Anthropic's own FAQ says "This API only
  tracks Claude Code usage on the Claude API". The undocumented `anthropic-ratelimit-unified-*`
  headers and `GET /api/oauth/usage` are treated as unsupported and are NOT called.
- **Source (a), a hint:** `~/.claude.json` → `.cachedUsageUtilization` carries per-window
  `utilization` percentages with an ISO `resets_at`. It is a CACHE and a stale entry reads exactly
  like a current one — measured: the file was 48 minutes old and its `five_hour` window had reset 27
  minutes earlier, so its `utilization: 70` described a window that no longer existed.
- **Source (b), ground truth:** a real 429 in a session's own transcript, carrying
  `"error":"rate_limit"`, `isApiErrorMessage: true`, `apiErrorStatus: 429`, and a `quotaLimits`
  object with `rateLimitType` (`five_hour`/`seven_day`) and a unix `resetsAt`. Cannot be stale.
- **Source (c):** `claude auth status` returns JSON with `email`, `orgId`, `subscriptionType`;
  `.oauthAccount` adds `accountUuid` and `organizationRateLimitTier`. There is no `claude usage`
  subcommand. Multiple Max subscriptions is medium-term by the owner's explicit call: **record the
  account, build no rotation.**

## The standard it is written to

Two house rules drive most of the design, and a finding that contradicts them needs to argue with
them rather than assume they are accidents:

1. **A zero must never mean "fine", and neither must a silence.** Every reading is a discriminated
   union with an explicit `unknown` arm carrying `why` in a person's words. The model is
   `tools/fleet/health.ts` in the same repo. The failure class is "something reporting success while
   doing nothing, with the obvious check agreeing because it shares an assumption with the code".
2. **One declaration per contract.** A postmortem the same morning found sixteen hand-written joins
   of one contract across the server/browser seam, ten of them lossy — the worst sent `dryRun` while
   the route only ever parsed `mode`, so every action ever pressed was a dry run reported as "Done."
   `tools/fleet/wire.ts` is the repair: one leaf module holding every type that crosses the
   boundary, imported by both sides. **wire.ts may contain no imports and no runtime values** — the
   browser project compiles its transitive closure under DOM-only libs, and a `const` there would be
   bundled into the browser.

## What I most want you to attack

- **`contradictsCachedWindow`.** This is the one defect found by running the collector against the
  live box, and my fix for it. A transcript 429 carries NO account id. The box's owner swaps between
  Max subscriptions with `/login`, so transcripts hold rejections from accounts that are no longer
  logged in, and one looks exactly like a current rejection down to a `resetsAt` in the future. Live
  numbers: 25 `seven_day` rejections from 2026-09-07 all recorded `resetsAt` 2026-09-12T18:00Z,
  while the current account's cache said its `seven_day` window was 22% used and resets
  2026-09-15T04:59Z. The collector said LIMITED for an account with 78% of its week left. My fix
  argues this is a **direct contradiction, not an inference**: one account has exactly one current
  window per name, so a live cached window and an in-force rejection for that name must agree on the
  reset instant; when they do not, one is not about this account, and the cache is the one that says
  whose it is. **Is that argument sound? Where does it fail?** I am specifically worried about:
  (i) a legitimate case where the same account's cache and a current rejection disagree on the reset
  instant; (ii) the two-minute tolerance being wrong in either direction; (iii) whether letting the
  hint disqualify ground truth is a trust inversion I have talked myself into.
- **The positive control.** `summariseRateLimitScan` refuses to return `none` unless it can show it
  opened a transcript and parsed a line, and refuses again if it found rate-limit-shaped records it
  could not read. **Is there a path by which a broken probe still returns `none`?** Note that this
  repository now contains the literal string `rateLimitType`, so agent transcripts reading this very
  file produce candidate lines that are NOT rejections — that is why a line with no `quotaLimits`
  object anywhere is `not-a-hit` rather than `malformed`.
- **The chunked buffer scan** (`scanTranscript`). It replaced `readline` for speed (measured 9.9s →
  1.8s on the same 235 files, identical results). Its one obvious failure mode is a record straddling
  a 1 MiB read boundary; there is a test that pads past 1 MiB. **Are there others?** Multi-byte UTF-8
  split across a chunk, `\r\n`, a file with no trailing newline, an empty file, a pathological line.
- **`parseUsageWindow`'s ordering.** `resets_at` is checked before the percentage is trusted, and the
  `expired` arm deliberately carries NO numeric field — not even under a name like `stalePercent` —
  on the argument that a renderer handed a numeric field will eventually render it. Is anything else
  in the module able to leak the void number back out as a reading?
- **Anything where an `unknown` arm is reachable but a caller would read it as calm**, and anything
  where a `value` arm can be produced from data that does not support it.

Also tell me plainly if you think the whole `contradictsCachedWindow` mechanism is wrong and I
should instead report the ambiguity and let the dashboard show both — I would rather be told now.

## Evidence: the collector run against the live box, just now

```
account   greg@rehearsable.ai  max  tier default_claude_max_20x  uuid eddd4c75-0024-4636-b7ca-d727eaeca66b
verdict   OK
          set aside 25 rejection(s) that have not expired but are not this account's: this seven_day rejection says the window resets at 2026-09-12T18:00:00.000Z, but the logged-in account's cache says its seven_day window is 22% used and resets at 2026-09-15T04:59:59.790550+00:00 — one account has one current seven_day window, so this rejection belongs to a different account (Greg swaps Max subscriptions with /login, and a transcript 429 carries no account id)
          54 rate-limit rejection(s) found, none in force for this account (29 already reset, 25 another account's)
cache     fetched 37 min ago, account eddd4c75-0024-4636-b7ca-d727eaeca66b
          five_hour: 1% used, resets 2026-09-08T16:49:59.790529+00:00
          seven_day: 22% used, resets 2026-09-15T04:59:59.790550+00:00
          nimbus_quill: unknown — no resets_at, so the utilization (0) cannot be checked for validity — reporting it would be reporting a number that may describe a window that no longer exists
          spend: unknown — no resets_at, so the utilization (absent) cannot be checked for validity — reporting it would be reporting a number that may describe a window that no longer exists
          member_dashboard_available: unknown — window entry was not an object: false
scanned   242/242 of 1763 transcripts, 239676 lines, 150 candidates, 9672ms
429       2026-09-08T06:23:02.314Z  five_hour  resets 2026-09-08T06:30:00.000Z  conversation 3dbdbfcb-3264-4b23-9243-1c3013826ae9
429       2026-09-08T06:04:01.839Z  five_hour  resets 2026-09-08T06:30:00.000Z  conversation 3dbdbfcb-3264-4b23-9243-1c3013826ae9
429       2026-09-08T06:02:47.112Z  five_hour  resets 2026-09-08T06:30:00.000Z  conversation cb936df3-428d-436f-a731-3397cf339abd
429       2026-09-08T06:02:46.605Z  five_hour  resets 2026-09-08T06:30:00.000Z  conversation cb936df3-428d-436f-a731-3397cf339abd
429       2026-09-08T06:02:46.527Z  five_hour  resets 2026-09-08T06:30:00.000Z  conversation 490f2556-4e1c-45c5-a5ba-361ee5860c90
429       2026-09-08T06:02:45.947Z  five_hour  resets 2026-09-08T06:30:00.000Z  conversation 490f2556-4e1c-45c5-a5ba-361ee5860c90
429       2026-09-08T06:02:42.649Z  five_hour  resets 2026-09-08T06:30:00.000Z  conversation 30d04781-3d44-411f-b9ae-a18ec4fb4861
429       2026-09-08T06:02:38.002Z  five_hour  resets 2026-09-08T06:30:00.000Z  conversation cb936df3-428d-436f-a731-3397cf339abd
429       2026-09-08T06:02:26.186Z  five_hour  resets 2026-09-08T06:30:00.000Z  conversation cb936df3-428d-436f-a731-3397cf339abd
429       2026-09-08T06:02:26.168Z  five_hour  resets 2026-09-08T06:30:00.000Z  conversation 913bc3ec-f5b3-4f25-903c-b7270474386d
          (44 more)
took      10615ms, at 2026-09-08T12:29:00.409Z
```

Measured cost, same box: 1,763 transcripts / 2.86 GB in total; the default 24h mtime window is ~240
files / ~570 MB and scans in 1.8–9.7s depending on how loaded the box is; a 7-day window is 1,596
files / 2.69 GB and ~11–50s. A full-history scan found 140 rejections in exactly three record shapes.

## Test results

`npx vitest run tests/overseer-usage.test.ts` — 48 passed. `npm run typecheck` — clean across all
four projects including the browser one that compiles `wire.ts`. Biome lint clean on the four files.

**Mutation check** — I broke the finished code eight ways, one at a time, and confirmed the suite
went red each time. All eight were caught:

| mutation | tests that went red |
|---|---|
| expired `resets_at` no longer refuses a percentage | 3 |
| missing `.cachedUsageUtilization` becomes an empty (zero-ish) reading | 1 |
| `resetsAt` seconds no longer converted to ms | 3 |
| `none` no longer has to prove it opened a transcript | 2 |
| the positive control stops counting lines | 2 |
| malformed candidates no longer force `unknown` | 1 |
| the `/login`-swap cache guard stops firing | 1 |
| `cannot-tell` collapses into `none` for a truncated scan | 1 |

**Be honest with me about this:** the tests were written AFTER the implementation, not before, and
the mutation table above is the substitute for red-first. Tell me if any test is passing for a reason
other than the behaviour it names.

## The diff — modified tracked files

```diff
diff --git a/scripts/overseer.ts b/scripts/overseer.ts
index 21cf53df..3db8fdb3 100644
--- a/scripts/overseer.ts
+++ b/scripts/overseer.ts
@@ -43,6 +43,7 @@ import {
   type RegisterEntry,
   type StatusSince,
 } from "../tools/overseer/store.js";
+import { collectUsage, type UsageReport } from "../tools/overseer/usage.js";
 
 /** Where the daemon looks for the dashboard unless told otherwise. */
 export const DEFAULT_FLEET_URL = "http://127.0.0.1:8787";
@@ -373,6 +374,71 @@ function describeAge(ms: number): string {
   return `${Math.round(minutes / 60)}h`;
 }
 
+/**
+ * Render a usage report for a person.
+ *
+ * THE POSITIVE CONTROL IS PRINTED EVERY TIME, including — especially — when
+ * the answer is "no limits hit". A bare "no limits hit" is the same sentence a
+ * probe that opened nothing would print, and the whole point of
+ * `ScanCoverage` is that the two must not read alike
+ * (docs/reusable/silent-success.md). Likewise an expired cached window prints
+ * its `why`, never a percentage: there is no percentage on that arm to print.
+ */
+function usageLines(report: UsageReport): string[] {
+  const out: string[] = [];
+  const a = report.account;
+  out.push(
+    a.kind === "value"
+      ? `account   ${a.email ?? "?"}  ${a.subscriptionType ?? "?"}  tier ${a.rateLimitTier ?? "?"}  uuid ${a.accountUuid ?? "?"}`
+      : a.kind === "logged-out"
+        ? `account   NOT LOGGED IN (projects dir ${a.projectsDirectory ?? "?"})`
+        : `account   could not tell: ${a.why}`,
+  );
+  out.push(`verdict   ${report.verdict.level.toUpperCase()}`);
+  for (const reason of report.verdict.reasons) out.push(`          ${reason}`);
+
+  if (report.cache.kind === "unknown") {
+    out.push(`cache     could not tell: ${report.cache.why}`);
+  } else {
+    out.push(`cache     fetched ${Math.round(report.cache.ageMs / 60_000)} min ago, account ${report.cache.accountUuid ?? "?"}`);
+    for (const w of report.cache.windows) {
+      if (w.kind === "value") out.push(`          ${w.window}: ${w.utilizationPercent}% used, resets ${w.resetsAt}`);
+      else if (w.kind === "expired") out.push(`          ${w.window}: EXPIRED — ${w.why}`);
+      else out.push(`          ${w.window}: unknown — ${w.why}`);
+    }
+  }
+
+  const c = report.rateLimits.coverage;
+  out.push(
+    `scanned   ${c.transcriptsOpened}/${c.transcriptsSelected} of ${c.transcriptsFound} transcripts, ${c.linesScanned} lines, ${c.candidateLines} candidates, ${c.tookMs}ms` +
+      `${c.transcriptsUnreadable > 0 ? `, ${c.transcriptsUnreadable} unreadable` : ""}` +
+      `${c.malformedCandidates > 0 ? `, ${c.malformedCandidates} MALFORMED` : ""}` +
+      `${c.truncatedByLimit ? ", TRUNCATED by --max-transcripts" : ""}`,
+  );
+  switch (report.rateLimits.kind) {
+    case "hits":
+      for (const h of report.rateLimits.hits.slice(0, 10)) {
+        out.push(
+          `429       ${h.hitAt ?? "?"}  ${h.window}  resets ${new Date(h.resetsAtMs).toISOString()}  conversation ${h.claudeSessionId ?? "?"}`,
+        );
+      }
+      if (report.rateLimits.hits.length > 10) out.push(`          (${report.rateLimits.hits.length - 10} more)`);
+      break;
+    case "none":
+      out.push("429       none in the scanned window — believable only against the `scanned` line above");
+      break;
+    case "unknown":
+      out.push(`429       could not tell: ${report.rateLimits.why}`);
+      break;
+    default: {
+      const never: never = report.rateLimits;
+      throw new Error(String(never));
+    }
+  }
+  out.push(`took      ${report.tookMs}ms, at ${report.collectedAt}`);
+  return out;
+}
+
 const HELP = [
   "overseer — the fleet's history, and the daemon that records it",
   "",
@@ -380,6 +446,7 @@ const HELP = [
   "  npx tsx scripts/overseer.ts status",
   "  npx tsx scripts/overseer.ts events [--limit N]",
   "  npx tsx scripts/overseer.ts notes [--limit N]",
+  "  npx tsx scripts/overseer.ts usage [--since-hours N] [--max-transcripts N] [--json]",
   "",
   `The store is $OVERSEER_STORE_DIR, or ~/.overseer. The dashboard is ${DEFAULT_FLEET_URL} unless --url says otherwise.`,
 ].join("\n");
@@ -416,6 +483,21 @@ async function main(argv: readonly string[]): Promise<number> {
       for (const note of read.notes) console.log(`${note.at}  ${describeNote(note)}`);
       return 0;
     }
+    case "usage": {
+      // A command rather than a daemon block for the same reason the header
+      // gives for the rest of this file: there is no scheduler here yet, and the
+      // honest simplest version of "how close are we to a limit" is something a
+      // person or another agent can run and read. It does not touch the store.
+      const sinceHours = flag(argv, "--since-hours");
+      const maxTranscripts = flag(argv, "--max-transcripts");
+      const report = await collectUsage({
+        ...(sinceHours === undefined ? {} : { sinceMs: Number(sinceHours) * 3600_000 }),
+        ...(maxTranscripts === undefined ? {} : { maxTranscripts: Number(maxTranscripts) }),
+      });
+      if (argv.includes("--json")) console.log(JSON.stringify(report, null, 2));
+      else console.log(usageLines(report).join("\n"));
+      return 0;
+    }
     case "run": {
       const controller = new AbortController();
       // SIGTERM is what systemd sends and SIGINT is what a person sends; both
diff --git a/tools/fleet/wire.ts b/tools/fleet/wire.ts
index 0197f685..3f3ace64 100644
--- a/tools/fleet/wire.ts
+++ b/tools/fleet/wire.ts
@@ -201,3 +201,250 @@ export type QueueView = {
   warning: string;
   since: number;
 };
+
+/* ------------------------------------------------------------------ *
+ * Claude usage limits, as tools/overseer/usage.ts measures them.
+ *
+ * Produced by `collectUsage` there; rendered by the fleet dashboard. Declared
+ * here rather than in usage.ts because usage.ts reaches `node:child_process`
+ * and `node:fs` — the exact transitive closure this file's header says must
+ * never become reachable from the client project.
+ *
+ * The measurements behind these shapes are in
+ * docs/project/orchestrator-direction.md § "What is actually observable about
+ * usage limits". Two facts drive every design choice below, and neither is
+ * obvious from the field names alone:
+ *
+ *  - `~/.claude.json`'s cached utilisation IS A CACHE, and a stale entry reads
+ *    exactly like a current one. Measured: a file 48 minutes old whose
+ *    `five_hour` window had reset 27 minutes earlier still read
+ *    `utilization: 70`.
+ *  - A 429 written into a session's own transcript cannot be stale, so it is
+ *    the ground truth and the cache is only a hint.
+ * ------------------------------------------------------------------ */
+
+/**
+ * A usage window's name, VERBATIM from the source — `five_hour`, `seven_day`,
+ * and, in the cache, a rotating set of per-model codenames (`nimbus_quill`,
+ * `iguana_necktie`, `seven_day_opus`, …) that Anthropic adds and removes
+ * without notice.
+ *
+ * Deliberately open, and not a closed union. A closed union would be a lie the
+ * first time a codename appears, and — worse — the kind of lie that lets an
+ * exhaustive `switch` compile while silently dropping a real window. The two
+ * stable names are `KnownUsageWindow`; render anything else by its raw name.
+ */
+export type UsageWindowName = string;
+
+/**
+ * The two windows stable enough to branch on.
+ *
+ * A literal union rather than a `const` array, because this file may hold no
+ * runtime values — a `const` here would be bundled into the browser. The array
+ * lives in tools/overseer/usage.ts and is typed against this.
+ */
+export type KnownUsageWindow = "five_hour" | "seven_day";
+
+/**
+ * One window's cached utilisation.
+ *
+ * `expired` CARRIES NO PERCENTAGE, and not by omission — not even under a name
+ * like `stalePercent`. The measured failure is that a void number reads exactly
+ * like a live one, and a renderer handed a numeric field will eventually render
+ * it, which is how the void number gets back on screen with a different label.
+ * The stale number survives as prose inside `why`, where it cannot be mistaken
+ * for a reading. Same repair as this file's own reason for existing: the
+ * consumer is not given the option.
+ */
+export type UsageWindowReading =
+  | {
+      kind: "value";
+      window: UsageWindowName;
+      /** 0-100, as the file gives it. */
+      utilizationPercent: number;
+      /** ISO 8601, verbatim from `resets_at`. */
+      resetsAt: string;
+      resetsAtMs: number;
+      /** How long until this window resets, from the `now` the producer was given. Always > 0 here. */
+      msUntilReset: number;
+    }
+  | {
+      kind: "expired";
+      window: UsageWindowName;
+      resetsAt: string;
+      resetsAtMs: number;
+      /** How long ago it reset. */
+      msSinceReset: number;
+      /** Including the stale percentage, in words. */
+      why: string;
+    }
+  | { kind: "unknown"; window: UsageWindowName; why: string };
+
+/**
+ * The whole `.cachedUsageUtilization` blob.
+ *
+ * `accountUuid` is not decoration: after a `/login` swap the cache can still
+ * hold the PREVIOUS account's numbers, so a reading has to say whose it is.
+ * The verdict refuses to let a cache from another account influence its level.
+ */
+export type UsageCacheReading =
+  | {
+      kind: "value";
+      accountUuid: string | null;
+      fetchedAtMs: number;
+      /** now - fetchedAtMs. Age alone does NOT invalidate a window; `resets_at` does. */
+      ageMs: number;
+      /** One entry per window present in the file. Windows the file says are null are absent, not zero. */
+      windows: UsageWindowReading[];
+    }
+  | { kind: "unknown"; why: string };
+
+/**
+ * Which account a reading belongs to.
+ *
+ * Recorded, never rotated: multiple Max subscriptions is medium-term by Greg's
+ * explicit call, so this stage records which account and builds no rotation.
+ */
+export type UsageAccount =
+  | {
+      kind: "value";
+      email: string | null;
+      orgId: string | null;
+      orgName: string | null;
+      /** `max`, `pro`, … from `claude auth status`. */
+      subscriptionType: string | null;
+      /** From `.oauthAccount`; the key the cache's own `accountUuid` is compared against. */
+      accountUuid: string | null;
+      /** e.g. `default_claude_max_20x`. */
+      rateLimitTier: string | null;
+    }
+  /** `claude auth status` answered, and the answer was "nobody is logged in". Not a failure. */
+  | { kind: "logged-out"; projectsDirectory: string | null }
+  | { kind: "unknown"; why: string };
+
+/** One real 429, as written into a session's transcript. Ground truth; cannot be stale. */
+export type RateLimitHit = {
+  /** `quotaLimits.rateLimitType` verbatim — `five_hour` or `seven_day` in every record seen. */
+  window: UsageWindowName;
+  /** `quotaLimits.resetsAt`, normalised to ms. */
+  resetsAtMs: number;
+  /** The transcript record's own `timestamp`, normalised to ms, or null if it had none. */
+  hitAtMs: number | null;
+  /** ISO, verbatim from the record. */
+  hitAt: string | null;
+  /** `quotaLimits.status`, e.g. `rejected`. */
+  status: string | null;
+  /**
+   * THE CONVERSATION UUID — the same id `QueuedItem.claudeSessionId` carries,
+   * and NOT tmux's session handle (`$1643`) or a pane id (`%2108`).
+   *
+   * Named in full because all three are in play on the dashboard's rows and
+   * they are not interchangeable: joining a rate limit against the wrong one
+   * puts a red badge on an agent that is working fine. It comes from the
+   * transcript record's own `sessionId` field, which is also the transcript's
+   * filename, so it is the id of the conversation that was rejected.
+   */
+  claudeSessionId: string | null;
+  /** Absolute path of the transcript the record was found in. */
+  transcriptPath: string;
+  /** The synthetic assistant message, e.g. "You've hit your session limit · resets 7:50am (Europe/London)". */
+  message: string | null;
+};
+
+/**
+ * THE POSITIVE CONTROL. A probe that finds nothing must prove it looked.
+ *
+ * Every number here is counted by the scan itself, so "no 429s" reads as
+ * "opened 235 transcripts, scanned 232,961 lines, found none" rather than as an
+ * unfalsifiable zero. The producer will not return `none` unless
+ * `transcriptsOpened` and `linesScanned` are both above zero and nothing
+ * rate-limit-shaped went unread. A renderer showing "no limits hit" should show
+ * these alongside it — and must respect `truncatedByLimit`, which means the
+ * absence covers less ground than it looks like.
+ */
+export type ScanCoverage = {
+  /** Transcripts the directory walk listed. */
+  transcriptsFound: number;
+  /** Those inside the mtime window and the transcript bound — the ones the scan meant to read. */
+  transcriptsSelected: number;
+  /** Transcripts actually opened and read to the end. THE number that makes a zero believable. */
+  transcriptsOpened: number;
+  /**
+   * Transcripts that vanished or errored between listing and reading. Real: on
+   * a box with live sessions a transcript can disappear between `readdir` and
+   * `open`, which killed a first pass of this scan outright.
+   */
+  transcriptsUnreadable: number;
+  /** Up to five of the unreadable ones, in the tool's own words. */
+  unreadableWhy: string[];
+  linesScanned: number;
+  /** Lines carrying the rate-limit marker, and so parsed as JSON. */
+  candidateLines: number;
+  /** Candidates that parsed. `candidateLines - linesParsed` did not, which a live file makes normal. */
+  linesParsed: number;
+  /**
+   * Candidates carrying a quota object the parser could not read — a rename or a
+   * shape change, not an absence. Non-zero with no hits forces `unknown`.
+   */
+  malformedCandidates: number;
+  /** Candidates carrying a readable quota object but no rejection signal. Drift made visible; not fatal. */
+  quotaLimitsWithoutErrorSignal: number;
+  /** The transcript bound cut the selection short: an absence covers less than the window claims. */
+  truncatedByLimit: boolean;
+  /** The mtime window applied, in ms, or null for "everything". */
+  sinceMs: number | null;
+  /** Wall-clock cost, so a caller can see what a poll is buying. */
+  tookMs: number;
+};
+
+export type RateLimitScan =
+  | { kind: "hits"; hits: RateLimitHit[]; coverage: ScanCoverage }
+  | { kind: "none"; coverage: ScanCoverage }
+  | { kind: "unknown"; why: string; coverage: ScanCoverage };
+
+/**
+ * One conversation's answer, for a dashboard row.
+ *
+ * `cannot-tell` exists for the same reason `UsageWindowReading` has no
+ * percentage on its expired arm, one level up: a bare `null` would collapse
+ * "this conversation has no limit in force" with "the scan could not tell",
+ * and the second has to reach the page as a sentence rather than as silence.
+ */
+export type ConversationRateLimit =
+  | { kind: "hit"; hit: RateLimitHit }
+  | { kind: "none" }
+  | { kind: "cannot-tell"; why: string };
+
+export type UsageLevel = "ok" | "approaching" | "limited" | "unknown";
+
+/**
+ * The verdict.
+ *
+ * `limited` means a 429 whose window has not yet reset — ground truth, and the
+ * arm a "Hit usage limits" status should read. `approaching` is derived from
+ * the cache and is therefore a hint; it is never reported from an expired
+ * window, nor from a cache belonging to a different account. `unknown` is a
+ * fourth arm rather than a fallback to `ok`, for the reason health.ts has one:
+ * a level computed while every source failed would say "fine" and mean nothing.
+ */
+export type UsageVerdict = {
+  level: UsageLevel;
+  reasons: string[];
+  /**
+   * The unexpired hit driving `limited`, or null.
+   *
+   * When several are in force this is the one that frees up LAST, because "due
+   * back at" has to be the moment work can actually resume — not the moment the
+   * first window clears.
+   */
+  activeLimit: RateLimitHit | null;
+};
+
+export type UsageReport = {
+  account: UsageAccount;
+  cache: UsageCacheReading;
+  rateLimits: RateLimitScan;
+  verdict: UsageVerdict;
+  collectedAt: string;
+  tookMs: number;
+};
```

## New file: `tools/overseer/usage.ts`

```ts
/**
 * Claude usage limits, for the Overseer and the fleet dashboard.
 *
 * WHY THIS EXISTS. Greg runs `/login` every couple of days to swap between Max
 * subscriptions when he hits a limit, and nothing on this box can say how close
 * the current account is, or which conversations have already been stopped by a
 * 429. This module is that reading. What is and is not observable was
 * researched and hand-verified on 2026-09-08 —
 * docs/project/orchestrator-direction.md § "What is actually observable about
 * usage limits" and § "Can we call an API instead? Mostly no, and not with an
 * admin key". Do not re-derive it here; that doc holds the measurements and the
 * reason there is no supported API to call instead.
 *
 * THE TWO SOURCES ARE NOT EQUAL, and the whole design turns on that.
 *
 *   (a) `~/.claude.json` → `.cachedUsageUtilization` is a HINT. It is a cache
 *       of headers from the last request, and A STALE ENTRY READS EXACTLY LIKE
 *       A CURRENT ONE — measured: the file was 48 minutes old and its
 *       `five_hour` window had reset 27 minutes earlier, so its
 *       `utilization: 70` described a window that no longer existed. The file
 *       always parses and always yields a plausible number; nothing in it
 *       announces that the number is void. So `resets_at` is not decoration,
 *       it is the validity check, and an expired window comes back as
 *       `{ kind: "expired" }` CARRYING NO PERCENTAGE AT ALL (tools/fleet/wire.ts
 *       says why not even under a scary name).
 *
 *   (b) A 429 in a session's own transcript is GROUND TRUTH. It cannot be
 *       stale: it carries the window that rejected the request and the unix
 *       timestamp at which that window resets. Cheapest reliable signal
 *       available, and the one the verdict trusts.
 *
 * THE SPLIT IS THE TESTABILITY STORY, copied from tools/fleet/health.ts and
 * tools/fleet/pane.ts: every `parse*` / `compute*` function here is pure —
 * string or already-parsed JSON in, a typed reading out, `now` taken as a
 * parameter so a test can pin it — and `collectUsage` is the one function that
 * touches the filesystem or runs a command. Nothing at module scope does I/O.
 *
 * A ZERO MUST NEVER MEAN "FINE", and neither must a silence. Every reading has
 * an explicit `kind: "unknown"` arm carrying `why` in words a person can act
 * on. Beyond that, the transcript scan carries a POSITIVE CONTROL
 * (`ScanCoverage`): a probe that found no 429s must be distinguishable from a
 * probe that opened nothing, so `summariseRateLimitScan` refuses to say "none"
 * unless it can show how many transcripts it opened and how many lines it
 * parsed. docs/reusable/silent-success.md is the class.
 *
 * WHERE THE TYPES LIVE. Every shape a renderer sees is declared once, in
 * tools/fleet/wire.ts, and imported here — never re-declared on the other side.
 * The fleet dashboard's postmortem of 2026-09-08 found sixteen hand-written
 * joins of one contract, ten of them lossy; two declarations of one shape is
 * the class, and wire.ts is the repair. Only the runtime values stay here,
 * because wire.ts may hold none: a `const` there would be bundled into the
 * browser.
 */
import { execFileSync } from "node:child_process";
import { createReadStream, type Dirent } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import type {
  ConversationRateLimit,
  KnownUsageWindow,
  RateLimitHit,
  RateLimitScan,
  ScanCoverage,
  UsageAccount,
  UsageCacheReading,
  UsageLevel,
  UsageReport,
  UsageVerdict,
  UsageWindowName,
  UsageWindowReading,
} from "../fleet/wire.js";

export type {
  ConversationRateLimit,
  KnownUsageWindow,
  RateLimitHit,
  RateLimitScan,
  ScanCoverage,
  UsageAccount,
  UsageCacheReading,
  UsageLevel,
  UsageReport,
  UsageVerdict,
  UsageWindowName,
  UsageWindowReading,
};

/**
 * The two windows stable enough to branch on, as a runtime array.
 *
 * Typed against `KnownUsageWindow` from wire.ts rather than declaring its own
 * union, so the list and the type cannot drift: adding a name here that wire.ts
 * does not know is a compile error, and so is the reverse.
 */
export const KNOWN_USAGE_WINDOWS: readonly KnownUsageWindow[] = ["five_hour", "seven_day"];

export function isKnownUsageWindow(w: UsageWindowName): w is KnownUsageWindow {
  return (KNOWN_USAGE_WINDOWS as readonly string[]).includes(w);
}

// ---------------------------------------------------------------------------
// Pure parsers. No fs, no execFileSync, no Date.now().
// ---------------------------------------------------------------------------

/** Narrow `unknown` to a plain object without pulling in a validation library. */
function obj(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}
function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * `resetsAt` in a transcript is unix SECONDS (every record seen: ~1.788e9).
 * Accept milliseconds too rather than silently producing a date in 1970 if that
 * ever changes — the discriminator is magnitude, and there is four orders of
 * magnitude of daylight between the two, so this cannot misfire on a real value.
 */
function resetsAtToMs(v: unknown): number | null {
  const n = num(v);
  if (n === null || n <= 0) return null;
  return n > 1e12 ? n : n * 1000;
}

/**
 * `~/.claude.json` (already parsed) → one reading per window.
 *
 * Takes the WHOLE file object rather than `.cachedUsageUtilization`, so the
 * "the key is not there" case — a fresh install, a `CLAUDE_CONFIG_DIR` pointed
 * somewhere else, a version that renamed it — is decided inside the pure
 * function and can be tested. That case is `unknown`, and emphatically not an
 * empty window list, which would render as "0% used everywhere".
 */
export function parseUsageCache(claudeJson: unknown, nowMs: number): UsageCacheReading {
  const root = obj(claudeJson);
  if (!root) return { kind: "unknown", why: "~/.claude.json did not parse as an object" };
  const cache = obj(root["cachedUsageUtilization"]);
  if (!cache) {
    return {
      kind: "unknown",
      why: "~/.claude.json has no .cachedUsageUtilization object — Claude Code has not cached a usage reading here (a fresh install, a different CLAUDE_CONFIG_DIR, or a renamed key). This is not 0% used.",
    };
  }
  const fetchedAtMs = num(cache["fetchedAtMs"]);
  if (fetchedAtMs === null) {
    return { kind: "unknown", why: `.cachedUsageUtilization.fetchedAtMs was not a number: ${JSON.stringify(cache["fetchedAtMs"])}` };
  }
  const utilization = obj(cache["utilization"]);
  if (!utilization) {
    return { kind: "unknown", why: ".cachedUsageUtilization.utilization was not an object" };
  }

  const windows: UsageWindowReading[] = [];
  for (const [window, raw] of Object.entries(utilization)) {
    // `limits` is a parallel array view of the same numbers and `extra_usage` is
    // a spend budget, not a rate-limit window. Both are skipped rather than
    // reported as unreadable windows: they are not windows.
    if (window === "limits" || window === "extra_usage") continue;
    // A null window means "this window does not apply to this account". Silence,
    // not failure, and not a reading — it must not appear as 0%.
    if (raw === null || raw === undefined) continue;
    windows.push(parseUsageWindow(window, raw, nowMs));
  }

  return {
    kind: "value",
    accountUuid: str(cache["accountUuid"]),
    fetchedAtMs,
    ageMs: nowMs - fetchedAtMs,
    windows,
  };
}

/**
 * One window entry → a reading, with `resets_at` as the validity check.
 *
 * THE ORDER OF THESE CHECKS IS THE WHOLE POINT. `resets_at` is tested before
 * the percentage is trusted, so a window that has already reset can never
 * produce a `value` arm no matter how well-formed its `utilization` is.
 */
export function parseUsageWindow(window: UsageWindowName, raw: unknown, nowMs: number): UsageWindowReading {
  const w = obj(raw);
  if (!w) return { kind: "unknown", window, why: `window entry was not an object: ${JSON.stringify(raw)}` };

  const resetsAt = str(w["resets_at"]);
  const utilizationPercent = num(w["utilization"]);

  if (resetsAt === null) {
    // Real and common: the per-model codename windows carry `utilization: 0`
    // with `resets_at: null`. There is no way to tell whether that 0 describes
    // a live window, so it is not reported as one.
    return {
      kind: "unknown",
      window,
      why: `no resets_at, so the utilization (${utilizationPercent ?? "absent"}) cannot be checked for validity — reporting it would be reporting a number that may describe a window that no longer exists`,
    };
  }
  const resetsAtMs = Date.parse(resetsAt);
  if (!Number.isFinite(resetsAtMs)) {
    return { kind: "unknown", window, why: `resets_at did not parse as a date: ${JSON.stringify(resetsAt)}` };
  }
  if (resetsAtMs <= nowMs) {
    return {
      kind: "expired",
      window,
      resetsAt,
      resetsAtMs,
      msSinceReset: nowMs - resetsAtMs,
      // The stale number lives in prose, on purpose — see UsageWindowReading in
      // wire.ts. A numeric field here would eventually be rendered.
      why: `this window reset ${Math.round((nowMs - resetsAtMs) / 60000)} minutes ago, so the cached utilization (${utilizationPercent ?? "absent"}%) describes a window that no longer exists`,
    };
  }
  if (utilizationPercent === null) {
    return { kind: "unknown", window, why: `resets_at is in the future but utilization was not a number: ${JSON.stringify(w["utilization"])}` };
  }
  return {
    kind: "value",
    window,
    utilizationPercent,
    resetsAt,
    resetsAtMs,
    msUntilReset: resetsAtMs - nowMs,
  };
}

/**
 * `claude auth status` stdout (JSON) joined with `.oauthAccount` from
 * `~/.claude.json`.
 *
 * Two sources because neither is complete: `auth status` has the email, org and
 * subscription type but no `accountUuid` to compare the cache against, and
 * `.oauthAccount` has the uuid and the rate-limit tier but is a cache of a
 * profile fetch. There is no `claude usage` subcommand to ask instead
 * (verified: it falls through to top-level help).
 */
export function parseAuthStatus(authStatusStdout: string, claudeJson: unknown): UsageAccount {
  let parsed: unknown;
  try {
    parsed = JSON.parse(authStatusStdout);
  } catch (err) {
    return {
      kind: "unknown",
      why: `claude auth status did not print JSON (${err instanceof Error ? err.message : String(err)}): ${authStatusStdout.trim().slice(0, 200)}`,
    };
  }
  const a = obj(parsed);
  if (!a) return { kind: "unknown", why: `claude auth status printed JSON that was not an object: ${authStatusStdout.trim().slice(0, 200)}` };
  if (a["loggedIn"] !== true) {
    return { kind: "logged-out", projectsDirectory: str(a["projectsDirectory"]) };
  }
  const oauth = obj(obj(claudeJson)?.["oauthAccount"]) ?? {};
  return {
    kind: "value",
    email: str(a["email"]),
    orgId: str(a["orgId"]),
    orgName: str(a["orgName"]),
    subscriptionType: str(a["subscriptionType"]),
    accountUuid: str(oauth["accountUuid"]),
    rateLimitTier: str(oauth["organizationRateLimitTier"]),
  };
}

/** What one transcript line turned out to be. Every arm is counted into `ScanCoverage`. */
export type RateLimitLineResult =
  | { kind: "hit"; hit: RateLimitHit }
  /** Parsed, but carries no `quotaLimits` anywhere — e.g. a tool result that merely mentions the word. */
  | { kind: "not-a-hit" }
  /** Has a `quotaLimits`, but no rate-limit error signal: a quota report, not a rejection. */
  | { kind: "no-error-signal" }
  /** Looks like a rate-limit record and could not be read. This is what shape drift looks like. */
  | { kind: "malformed"; why: string }
  /** Did not parse as JSON at all. Expected occasionally: a live session's last line can be half-written. */
  | { kind: "unparsed"; why: string };

/**
 * One transcript line → a hit, or a reason it is not one.
 *
 * `quotaLimits` is looked for at the top level AND under `message`. Every one of
 * the 140 records found in a full scan of 1,755 transcripts (854,065 lines) on
 * 2026-09-08 had it at the top level; the second lookup is insurance against the
 * shape moving, because if it moved and this only checked the top level the scan
 * would return a confident "none" rather than a visible failure — the exact
 * collapse docs/reusable/silent-success.md is about.
 */
export function parseRateLimitLine(line: string, transcriptPath: string): RateLimitLineResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (err) {
    return { kind: "unparsed", why: err instanceof Error ? err.message : String(err) };
  }
  const rec = obj(parsed);
  if (!rec) return { kind: "not-a-hit" };
  const msg = obj(rec["message"]);
  const q = obj(rec["quotaLimits"]) ?? obj(msg?.["quotaLimits"]);
  if (!q) return { kind: "not-a-hit" };

  const isApiError = rec["isApiErrorMessage"] === true || msg?.["isApiErrorMessage"] === true;
  const status429 = num(rec["apiErrorStatus"]) === 429 || num(msg?.["apiErrorStatus"]) === 429;
  const errRateLimit = rec["error"] === "rate_limit" || msg?.["error"] === "rate_limit";
  if (!isApiError && !status429 && !errRateLimit) return { kind: "no-error-signal" };

  const window = str(q["rateLimitType"]);
  const resetsAtMs = resetsAtToMs(q["resetsAt"]);
  if (window === null || resetsAtMs === null) {
    return {
      kind: "malformed",
      why: `a rate-limit record in ${transcriptPath} had quotaLimits but rateLimitType=${JSON.stringify(q["rateLimitType"])} resetsAt=${JSON.stringify(q["resetsAt"])} — the shape has changed`,
    };
  }

  const hitAt = str(rec["timestamp"]);
  const hitAtMs = hitAt !== null && Number.isFinite(Date.parse(hitAt)) ? Date.parse(hitAt) : null;
  const content = msg?.["content"];
  const firstText = Array.isArray(content) ? str(obj(content[0])?.["text"]) : null;

  return {
    kind: "hit",
    hit: {
      window,
      resetsAtMs,
      hitAtMs,
      hitAt,
      status: str(q["status"]),
      // The transcript's `sessionId` is the CONVERSATION uuid — the same id the
      // file is named after, and the same one `QueuedItem.claudeSessionId`
      // carries. It is not tmux's `$…` handle. See the field's doc in wire.ts.
      claudeSessionId: str(rec["sessionId"]) ?? str(rec["session_id"]),
      transcriptPath,
      message: firstText,
    },
  };
}

/**
 * Hits plus coverage → a scan result, and this is where a zero has to earn
 * belief.
 *
 * "None" is refused unless the scan can show it opened a transcript and parsed
 * a line, and refused again if it found records shaped like rate-limit
 * rejections that it could not read — because "I could not read the only
 * candidates I found" is not the same answer as "there are none", and rendering
 * them the same is how a broken probe passes for a quiet one.
 */
export function summariseRateLimitScan(hits: RateLimitHit[], coverage: ScanCoverage): RateLimitScan {
  if (hits.length > 0) {
    // Newest first, so a caller taking [0] gets the most recent rejection.
    const sorted = [...hits].sort((a, b) => (b.hitAtMs ?? 0) - (a.hitAtMs ?? 0));
    return { kind: "hits", hits: sorted, coverage };
  }
  if (coverage.transcriptsOpened === 0) {
    return {
      kind: "unknown",
      why: `no transcript was opened (found ${coverage.transcriptsFound}, selected ${coverage.transcriptsSelected}, unreadable ${coverage.transcriptsUnreadable}${coverage.unreadableWhy.length > 0 ? `: ${coverage.unreadableWhy.join("; ")}` : ""}) — this says nothing about whether a limit was hit`,
      coverage,
    };
  }
  if (coverage.linesParsed === 0 && coverage.candidateLines > 0) {
    return {
      kind: "unknown",
      why: `${coverage.candidateLines} candidate line(s) contained the rate-limit marker and none of them parsed as JSON — the scan is broken, not the box quiet`,
      coverage,
    };
  }
  if (coverage.malformedCandidates > 0) {
    return {
      kind: "unknown",
      why: `${coverage.malformedCandidates} record(s) looked like rate-limit rejections and could not be read — the transcript shape has probably changed, so an absence of hits cannot be trusted`,
      coverage,
    };
  }
  if (coverage.linesScanned === 0) {
    return {
      kind: "unknown",
      why: `opened ${coverage.transcriptsOpened} transcript(s) but read 0 lines — nothing was actually examined`,
      coverage,
    };
  }
  return { kind: "none", coverage };
}

/**
 * Two ISO/epoch instants for the same window are the same window if they are
 * within this of each other. The cache carries sub-second precision
 * (`…:59.790550+00:00`) and a transcript's `resetsAt` is whole unix seconds, so
 * exact equality would call one window two.
 */
const SAME_WINDOW_TOLERANCE_MS = 2 * 60 * 1000;

/**
 * Does this 429 contradict the current account's live cache? If so, why.
 *
 * FOUND BY RUNNING THIS AGAINST THE LIVE BOX, 2026-09-08, and it is the one
 * thing the plan did not anticipate. A TRANSCRIPT 429 CARRIES NO ACCOUNT ID.
 * Greg swaps between Max subscriptions with `/login` every couple of days, so
 * the transcripts on this box hold rejections belonging to accounts that are no
 * longer logged in — and a rejection from a previous account looks exactly like
 * one from the current account, right down to a `resetsAt` in the future.
 * Measured: 25 `seven_day` rejections from 2026-09-07 all recorded
 * `resetsAt` 2026-09-12T18:00Z, while the current account's cache said its
 * `seven_day` window was 22% used and resets 2026-09-15T04:59Z. The collector
 * reported LIMITED for an account with 78% of its week left.
 *
 * THE TEST IS A DIRECT CONTRADICTION, NOT AN INFERENCE. One account has exactly
 * one current window per name, so a live cached window and an in-force
 * rejection for that same name must agree on when it resets. When they do not,
 * one of them is not about this account — and the cache is the one that says
 * whose it is (`accountUuid`), while the rejection says nothing. So the
 * rejection is the one set aside.
 *
 * This is NOT the cache overruling ground truth about whether a limit was hit.
 * The rejection is still true; it is true about somebody else. Only a cached
 * window on the `value` arm can do this — an expired or unknown cached window
 * describes nothing and cannot contradict anything.
 */
export function contradictsCachedWindow(hit: RateLimitHit, cache: UsageCacheReading): string | null {
  if (cache.kind !== "value") return null;
  const cached = cache.windows.find((w) => w.window === hit.window);
  if (cached === undefined || cached.kind !== "value") return null;
  if (Math.abs(cached.resetsAtMs - hit.resetsAtMs) <= SAME_WINDOW_TOLERANCE_MS) return null;
  return `this ${hit.window} rejection says the window resets at ${new Date(hit.resetsAtMs).toISOString()}, but the logged-in account's cache says its ${hit.window} window is ${cached.utilizationPercent}% used and resets at ${cached.resetsAt} — one account has one current ${hit.window} window, so this rejection belongs to a different account (Greg swaps Max subscriptions with /login, and a transcript 429 carries no account id)`;
}

/**
 * One conversation's answer, for a dashboard row.
 *
 * NAMED FOR THE ID IT TAKES. `claudeSessionId` is the conversation uuid, not
 * tmux's `$1643` and not a pane's `%2108`; the dashboard's rows carry all three
 * and joining against the wrong one puts a red badge on an agent that is
 * working fine.
 *
 * `cannot-tell` is a third arm rather than a `null`, for the same reason the
 * expired window carries no percentage: a bare null would collapse "this
 * conversation has no limit in force" into "the scan could not tell", and the
 * second has to reach the page as a sentence. A truncated scan that did not
 * cover this conversation is `cannot-tell` too — it is an absence of evidence,
 * and this is the one place that knows the difference.
 */
export function latestHitForConversation(
  scan: RateLimitScan,
  claudeSessionId: string,
  nowMs: number,
  /**
   * The current account's cache, so a rejection belonging to a PREVIOUS account
   * can be set aside — see `contradictsCachedWindow`, which is a real defect
   * this collector had until it was run against the live box. Optional, and the
   * cost of omitting it is that another account's rejection can be reported
   * against a row that is working fine.
   */
  cache?: UsageCacheReading,
): ConversationRateLimit {
  if (scan.kind === "unknown") return { kind: "cannot-tell", why: scan.why };
  const hits = scan.kind === "hits" ? scan.hits : [];
  const mine = hits.filter((h) => h.claudeSessionId === claudeSessionId);
  // The one that frees up LAST is the one that actually gates this conversation.
  const active = mine
    .filter((h) => h.resetsAtMs > nowMs)
    .filter((h) => cache === undefined || contradictsCachedWindow(h, cache) === null)
    .sort((a, b) => b.resetsAtMs - a.resetsAtMs);
  const binding = active[0];
  if (binding !== undefined) return { kind: "hit", hit: binding };
  if (mine.length === 0 && scan.coverage.truncatedByLimit) {
    // We saw nothing for this conversation AND we know the scan did not cover
    // everything, so "no limit" is not a claim we are entitled to make.
    return {
      kind: "cannot-tell",
      why: `the scan stopped at ${scan.coverage.transcriptsSelected} of ${scan.coverage.transcriptsFound} transcripts, and none of the ones it read belonged to this conversation`,
    };
  }
  return { kind: "none" };
}

/**
 * The readings → one level and its reasons.
 *
 * TRUST ORDER, and it is not symmetrical:
 *  - An unexpired 429 wins outright. It is ground truth and cannot be stale.
 *  - The cache can only ever raise `approaching`, never `limited`, and only
 *    from a `value` window belonging to the CURRENT account. A cache left over
 *    from a `/login` swap describes somebody else's headroom; letting it set
 *    the level would be a confident wrong number of exactly the shape this
 *    module exists to refuse.
 *  - Nothing readable at all is `unknown`, not `ok`.
 */
export function computeUsageVerdict(input: {
  account: UsageAccount;
  cache: UsageCacheReading;
  rateLimits: RateLimitScan;
  nowMs: number;
  /** Utilisation at or above this counts as `approaching`. This module's own cutoff, not a documented one. */
  approachingPercent?: number;
}): UsageVerdict {
  const approachingPercent = input.approachingPercent ?? 80;
  const reasons: string[] = [];
  let level: UsageLevel = "ok";
  let activeLimit: RateLimitHit | null = null;

  /**
   * The cache, but only if it is THIS account's — decided once, because both
   * halves below need the same answer. A cache left over from a `/login` swap
   * describes somebody else's headroom, so it may neither raise `approaching`
   * nor be used to disqualify a rejection.
   */
  const accountUuid = input.account.kind === "value" ? input.account.accountUuid : null;
  const cacheIsAnotherAccounts =
    input.cache.kind === "value" &&
    accountUuid !== null &&
    input.cache.accountUuid !== null &&
    input.cache.accountUuid !== accountUuid;
  const ownCache: UsageCacheReading | null = input.cache.kind === "value" && !cacheIsAnotherAccounts ? input.cache : null;

  // (b) Ground truth first.
  if (input.rateLimits.kind === "hits") {
    const unexpired = input.rateLimits.hits.filter((h) => h.resetsAtMs > input.nowMs);
    // A rejection that contradicts this account's own live cache belongs to a
    // different account — see `contradictsCachedWindow`. Reported, not dropped
    // silently: "25 rejections that are not yours" is exactly the sentence a
    // person needs to see, and dropping them quietly would be its own silent
    // success.
    const disqualified: { hit: RateLimitHit; why: string }[] = [];
    const active: RateLimitHit[] = [];
    for (const h of unexpired) {
      const why = ownCache === null ? null : contradictsCachedWindow(h, ownCache);
      if (why === null) active.push(h);
      else disqualified.push({ hit: h, why });
    }
    if (disqualified.length > 0) {
      const first = disqualified[0];
      if (first !== undefined) {
        reasons.push(
          `set aside ${disqualified.length} rejection(s) that have not expired but are not this account's: ${first.why}`,
        );
      }
    }
    if (ownCache === null && unexpired.length > 0) {
      reasons.push(
        "could not check whether these rejections belong to the logged-in account — a transcript 429 carries no account id, and there is no usable cache for the current account to compare it against",
      );
    }
    // The one that frees up last is the one that actually gates work.
    active.sort((a, b) => b.resetsAtMs - a.resetsAtMs);
    const binding = active[0];
    if (binding !== undefined) {
      level = "limited";
      activeLimit = binding;
      reasons.push(
        `a real ${binding.window} rejection is still in force — hit at ${binding.hitAt ?? "an unknown time"}, resets at ${new Date(binding.resetsAtMs).toISOString()}${binding.claudeSessionId ? ` (conversation ${binding.claudeSessionId})` : ""}`,
      );
    } else {
      // Spell out WHICH of the two reasons applies to how many. "all of them
      // already reset" was wrong the first time it printed on this box: 25 of
      // the 54 had not reset, they belonged to another account.
      const expired = input.rateLimits.hits.length - unexpired.length;
      reasons.push(
        `${input.rateLimits.hits.length} rate-limit rejection(s) found, none in force for this account (${expired} already reset${disqualified.length > 0 ? `, ${disqualified.length} another account's` : ""})`,
      );
    }
  } else if (input.rateLimits.kind === "none") {
    const c = input.rateLimits.coverage;
    reasons.push(
      `no rate-limit rejection in ${c.transcriptsOpened} transcript(s), ${c.linesScanned} line(s) scanned${c.truncatedByLimit ? " — WARNING: the scan was cut short by its own transcript limit, so this absence is partial" : ""}`,
    );
  } else {
    reasons.push(`could not scan transcripts for rate-limit rejections: ${input.rateLimits.why}`);
  }

  // (a) The hint, and only if it is this account's hint.
  let cacheUsable = false;
  if (input.cache.kind === "unknown") {
    reasons.push(`could not read the cached utilisation: ${input.cache.why}`);
  } else if (cacheIsAnotherAccounts) {
    reasons.push(
      `ignoring the cached utilisation: it belongs to account ${input.cache.accountUuid}, and the logged-in account is ${accountUuid} — probably a /login swap since the cache was written`,
    );
  } else if (ownCache !== null && ownCache.kind === "value") {
    for (const w of ownCache.windows) {
      if (w.kind === "expired") {
        reasons.push(`cached ${w.window}: ${w.why}`);
        continue;
      }
      if (w.kind === "unknown") continue; // per-model codename windows are noisy; the reading carries the why
      cacheUsable = true;
      if (w.utilizationPercent >= approachingPercent) {
        if (level === "ok") level = "approaching";
        reasons.push(
          `cached ${w.window} utilisation is ${w.utilizationPercent}% (>= ${approachingPercent}%), window resets at ${w.resetsAt}`,
        );
      }
    }
  }

  const groundTruthReadable = input.rateLimits.kind !== "unknown";
  if (!groundTruthReadable && !cacheUsable) {
    reasons.unshift(
      "neither source could be read (no usable transcript scan and no valid cached window) — this is not the same as having headroom",
    );
    return { level: "unknown", reasons, activeLimit: null };
  }
  if (level === "ok" && reasons.length === 0) reasons.push("no limit hit and no window near its cap");
  return { level, reasons, activeLimit };
}

// ---------------------------------------------------------------------------
// I/O. Everything above is pure; everything below is the one place that reads a
// file or runs a command.
// ---------------------------------------------------------------------------

export type CollectUsageOptions = {
  /** Default `~/.claude.json`. */
  claudeJsonPath?: string;
  /** Default `~/.claude/projects`. */
  projectsDir?: string;
  /**
   * Only scan transcripts modified within this many ms. Default 24h.
   *
   * MEASURED on this box, 2026-09-08: 1,755 transcripts / 2.86 GB in total;
   * the last 24h is 235 files / 569 MB and scans in ~1.8s, the last 7 days is
   * 1,596 files / 2.69 GB and ~11s. 24h finds 124 of the 140 rejections that
   * exist in all of history. Pass `null` to scan everything, and accept the
   * cost.
   */
  sinceMs?: number | null;
  /** Hard bound on transcripts opened, newest first. Default 500. Sets `truncatedByLimit`. */
  maxTranscripts?: number;
  /** Pinned clock, for tests and for a caller that wants one `now` across several collectors. */
  nowMs?: number;
  /** Skip `claude auth status` (it spawns a process). Default false. */
  skipAuthStatus?: boolean;
};

/** Bytes we search for before turning a line into a string. See `scanTranscript`. */
const MARKER = Buffer.from("rateLimitType");
const NEWLINE = 0x0a;
/** A single JSONL record over this size is not a record we can use; do not buffer it forever. */
const MAX_LINE_BYTES = 64 * 1024 * 1024;

/** Every `.jsonl` under `dir`, recursively, with its mtime. Never throws. */
async function listTranscripts(dir: string): Promise<{ files: { path: string; mtimeMs: number }[]; why: string[] }> {
  const files: { path: string; mtimeMs: number }[] = [];
  const why: string[] = [];
  const walk = async (d: string): Promise<void> => {
    let entries: Dirent[];
    try {
      entries = await readdir(d, { withFileTypes: true });
    } catch (err) {
      why.push(`${d}: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.isFile() && e.name.endsWith(".jsonl")) {
        try {
          const st = await stat(p);
          files.push({ path: p, mtimeMs: st.mtimeMs });
        } catch (err) {
          // Real: a transcript can vanish between readdir and stat on a box with
          // live sessions. Counted, never fatal.
          why.push(`${p}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
  };
  await walk(dir);
  return { files, why };
}

/**
 * Scan one transcript for rate-limit records.
 *
 * CHUNKED BUFFER SEARCH, not `readline`. Only a line that actually contains the
 * marker is ever turned into a JS string. Measured on the 24h window on this
 * box: 9.9s with readline, 1.8s this way, identical results — which is the
 * difference between a scan a dashboard can afford to poll and one it cannot.
 * The carry buffer holds a partial line across chunk boundaries, so a record
 * straddling a read is still found (tests/overseer-usage.test.ts pads a file
 * past 1 MiB to prove it).
 */
async function scanTranscript(
  filePath: string,
): Promise<{ ok: true; lines: number; results: RateLimitLineResult[] } | { ok: false; why: string }> {
  const results: RateLimitLineResult[] = [];
  let lines = 0;
  // Annotated rather than inferred: `Buffer.alloc` returns the narrower
  // `Buffer<ArrayBuffer>`, and `subarray` on a stream chunk returns
  // `Buffer<ArrayBufferLike>`, so the inferred type refuses the reassignment.
  let carry: Buffer = Buffer.alloc(0);
  try {
    const stream = createReadStream(filePath, { highWaterMark: 1 << 20 });
    for await (const chunk of stream as AsyncIterable<Buffer>) {
      const buf = carry.length > 0 ? Buffer.concat([carry, chunk]) : chunk;
      let start = 0;
      for (;;) {
        const nl = buf.indexOf(NEWLINE, start);
        if (nl === -1) break;
        lines++;
        const line = buf.subarray(start, nl);
        if (line.indexOf(MARKER) !== -1) results.push(parseRateLimitLine(line.toString("utf8"), filePath));
        start = nl + 1;
      }
      carry = buf.subarray(start);
      if (carry.length > MAX_LINE_BYTES) carry = Buffer.alloc(0);
    }
    if (carry.length > 0) {
      lines++;
      if (carry.indexOf(MARKER) !== -1) results.push(parseRateLimitLine(carry.toString("utf8"), filePath));
    }
    return { ok: true, lines, results };
  } catch (err) {
    return { ok: false, why: `${filePath}: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/**
 * Read `~/.claude.json`. Its own arm rather than a thrown error, because a
 * missing or unreadable config is a thing the report should say out loud.
 */
async function readClaudeJson(p: string): Promise<{ ok: true; value: unknown } | { ok: false; why: string }> {
  try {
    return { ok: true, value: JSON.parse(await readFile(p, "utf8")) };
  } catch (err) {
    return { ok: false, why: `${p}: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/** Run `claude auth status`. Never throws; a failure becomes an `unknown` account. */
function runAuthStatus(): { ok: true; out: string } | { ok: false; why: string } {
  try {
    const out = execFileSync("claude", ["auth", "status"], {
      encoding: "utf8",
      timeout: 20_000,
      maxBuffer: 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, out };
  } catch (err) {
    return { ok: false, why: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Collect everything and return a report plus a verdict.
 *
 * Each source is read independently: a missing `~/.claude.json` does not stop
 * the transcript scan, and a failed `claude auth status` does not stop either.
 * Nothing here can produce a percentage or a "no limits" that is not backed by
 * a count in `ScanCoverage`.
 */
export async function collectUsage(options: CollectUsageOptions = {}): Promise<UsageReport> {
  const startedAt = Date.now();
  const nowMs = options.nowMs ?? Date.now();
  const claudeJsonPath = options.claudeJsonPath ?? path.join(homedir(), ".claude.json");
  const projectsDir = options.projectsDir ?? path.join(homedir(), ".claude", "projects");
  const sinceMs = options.sinceMs === undefined ? 24 * 60 * 60 * 1000 : options.sinceMs;
  const maxTranscripts = options.maxTranscripts ?? 500;

  const cfg = await readClaudeJson(claudeJsonPath);
  const claudeJson: unknown = cfg.ok ? cfg.value : null;
  const cache: UsageCacheReading = cfg.ok
    ? parseUsageCache(cfg.value, nowMs)
    : { kind: "unknown", why: `could not read ${claudeJsonPath}: ${cfg.why}` };

  let account: UsageAccount;
  if (options.skipAuthStatus === true) {
    account = { kind: "unknown", why: "claude auth status was skipped by the caller" };
  } else {
    const auth = runAuthStatus();
    account = auth.ok ? parseAuthStatus(auth.out, claudeJson) : { kind: "unknown", why: `claude auth status failed: ${auth.why}` };
  }

  const rateLimits = await scanForRateLimits({ projectsDir, sinceMs, maxTranscripts, nowMs });
  const verdict = computeUsageVerdict({ account, cache, rateLimits, nowMs });

  return {
    account,
    cache,
    rateLimits,
    verdict,
    collectedAt: new Date(nowMs).toISOString(),
    tookMs: Date.now() - startedAt,
  };
}

/**
 * The transcript half of the collection, separately callable because it is the
 * expensive half and a caller may want it on its own cadence.
 */
export async function scanForRateLimits(args: {
  projectsDir: string;
  sinceMs: number | null;
  maxTranscripts: number;
  nowMs: number;
}): Promise<RateLimitScan> {
  const scanStartedAt = Date.now();
  const listed = await listTranscripts(args.projectsDir);
  const unreadableWhy: string[] = [...listed.why];
  let transcriptsUnreadable = listed.why.length;

  const sinceMs = args.sinceMs;
  const inWindow = sinceMs === null ? listed.files : listed.files.filter((f) => args.nowMs - f.mtimeMs <= sinceMs);
  // Newest first, so that if `maxTranscripts` bites it drops the oldest — the
  // ones least likely to hold a rejection that is still in force.
  inWindow.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const truncatedByLimit = inWindow.length > args.maxTranscripts;
  const selected = truncatedByLimit ? inWindow.slice(0, args.maxTranscripts) : inWindow;

  const hits: RateLimitHit[] = [];
  let transcriptsOpened = 0;
  let linesScanned = 0;
  let candidateLines = 0;
  let linesParsed = 0;
  let malformedCandidates = 0;
  let quotaLimitsWithoutErrorSignal = 0;

  for (const f of selected) {
    const r = await scanTranscript(f.path);
    if (!r.ok) {
      transcriptsUnreadable++;
      if (unreadableWhy.length < 5) unreadableWhy.push(r.why);
      continue;
    }
    transcriptsOpened++;
    linesScanned += r.lines;
    for (const res of r.results) {
      candidateLines++;
      switch (res.kind) {
        case "hit":
          linesParsed++;
          hits.push(res.hit);
          break;
        case "not-a-hit":
          linesParsed++;
          break;
        case "no-error-signal":
          linesParsed++;
          quotaLimitsWithoutErrorSignal++;
          break;
        case "malformed":
          linesParsed++;
          malformedCandidates++;
          if (unreadableWhy.length < 5) unreadableWhy.push(res.why);
          break;
        case "unparsed":
          // Not counted as parsed and not as malformed: a live session's final
          // line can genuinely be half-written when we read it.
          break;
        default: {
          const never: never = res;
          throw new Error(`unhandled RateLimitLineResult: ${JSON.stringify(never)}`);
        }
      }
    }
  }

  const coverage: ScanCoverage = {
    transcriptsFound: listed.files.length,
    transcriptsSelected: selected.length,
    transcriptsOpened,
    transcriptsUnreadable,
    unreadableWhy,
    linesScanned,
    candidateLines,
    linesParsed,
    malformedCandidates,
    quotaLimitsWithoutErrorSignal,
    truncatedByLimit,
    sinceMs,
    tookMs: Date.now() - scanStartedAt,
  };
  return summariseRateLimitScan(hits, coverage);
}
```

## New file: `tests/overseer-usage.test.ts`

```ts
/**
 * Claude usage limits — tools/overseer/usage.ts.
 *
 * WHICH FIXTURES ARE REAL. Everything named `-real` under
 * tests/fixtures/overseer-usage/ is a real capture taken on this box on
 * 2026-09-08 while writing the module:
 *
 *  - `transcript-429-five-hour-real.jsonl`, `transcript-429-seven-day-real.jsonl`
 *    and `transcript-429-five-hour-lowpriority-real.jsonl` are three real 429
 *    records lifted verbatim out of three real session transcripts. The
 *    `lowpriority` one exists because the `quotaLimits` key set genuinely
 *    varies between records (it carries three extra `lowPriority*` keys) and a
 *    parser that only ever saw one key set would be untested against the
 *    other. A full scan of 1,755 transcripts / 854,065 lines found 140 such
 *    records in exactly three shapes; all three are here.
 *  - `transcript-no-429-real.jsonl` is six real, benign transcript lines
 *    (tool results, no article or user prose).
 *  - `claude-json-real.json` is the real `.cachedUsageUtilization` and
 *    `.oauthAccount` from `~/.claude.json`, with the two account UUIDs
 *    replaced by fixed placeholders. Percentages, window names, ISO reset
 *    strings and nulls are exactly as captured — including the per-model
 *    codename window (`nimbus_quill`) that carries `utilization: 0` with
 *    `resets_at: null`, which is the case that must NOT read as 0% used.
 *  - `auth-status-real.json` is the real `claude auth status` output, org UUID
 *    likewise replaced.
 *
 * FABRICATED, AND DECLARED AS SUCH: `claude-json-stale.json` reproduces the
 * measured failure from docs/project/orchestrator-direction.md — a file 48
 * minutes old whose `five_hour` window reset 27 minutes ago while still
 * reading `utilization: 70`. `claude-json-no-cache.json` and
 * `auth-status-logged-out.json` and `transcript-429-malformed.jsonl` are
 * likewise fabricated, because a config with no cache, a logged-out box, and a
 * transcript whose rate-limit shape has drifted cannot be provoked live
 * without logging Greg out or editing his config.
 *
 * WHAT THIS FILE IS FOR. The parsers are the testability story (see the top of
 * usage.ts). This exercises them against real records, against the stale-cache
 * failure that motivated the module, and against a probe that is broken rather
 * than quiet — the last being the one that will actually go wrong in
 * production, per docs/reusable/silent-success.md.
 */
import { cp, mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  computeUsageVerdict,
  contradictsCachedWindow,
  isKnownUsageWindow,
  latestHitForConversation,
  parseAuthStatus,
  parseRateLimitLine,
  parseUsageCache,
  parseUsageWindow,
  scanForRateLimits,
  summariseRateLimitScan,
  type RateLimitHit,
  type ScanCoverage,
} from "../tools/overseer/usage.js";

const FIXTURES = path.resolve(import.meta.dirname, "fixtures/overseer-usage");
const fx = (name: string) => readFileSync(path.join(FIXTURES, name), "utf8");
const fxJson = (name: string): unknown => JSON.parse(fx(name));

/** The instant `claude-json-real.json` was captured, plus a minute. */
const NOW_REAL = Date.parse("2026-09-08T12:00:00.000Z");

const tempDirs: string[] = [];
async function transcriptDir(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "overseer-usage-"));
  tempDirs.push(dir);
  // A nested project directory, because that is the real shape:
  // ~/.claude/projects/<slug>/<session>.jsonl, with subagents one deeper.
  const project = path.join(dir, "-home-greg-code-spideryarn2");
  await mkdir(project, { recursive: true });
  for (const [name, contents] of Object.entries(files)) {
    await writeFile(path.join(project, name), contents);
  }
  return dir;
}
afterAll(async () => {
  // Left in place deliberately if removal fails: a stray temp dir is cheaper
  // than a test that fails for a reason unrelated to what it asserts.
  const { rm } = await import("node:fs/promises");
  for (const d of tempDirs) await rm(d, { recursive: true, force: true }).catch(() => {});
});

// ---------------------------------------------------------------------------
// (a) The cache, and the reason it is only a hint.
// ---------------------------------------------------------------------------

describe("parseUsageCache — the cache is a hint, and resets_at is the validity check", () => {
  it("reads the real file's five_hour and seven_day windows while they are still open", () => {
    const r = parseUsageCache(fxJson("claude-json-real.json"), NOW_REAL);
    expect(r.kind).toBe("value");
    if (r.kind !== "value") throw new Error("unreachable");
    expect(r.accountUuid).toBe("00000000-1111-2222-3333-444444444444");
    expect(r.fetchedAtMs).toBe(1788868334947);

    const fiveHour = r.windows.find((w) => w.window === "five_hour");
    expect(fiveHour).toEqual({
      kind: "value",
      window: "five_hour",
      utilizationPercent: 1,
      resetsAt: "2026-09-08T16:49:59.790529+00:00",
      resetsAtMs: Date.parse("2026-09-08T16:49:59.790529+00:00"),
      msUntilReset: Date.parse("2026-09-08T16:49:59.790529+00:00") - NOW_REAL,
    });

    const sevenDay = r.windows.find((w) => w.window === "seven_day");
    expect(sevenDay?.kind).toBe("value");
    if (sevenDay?.kind !== "value") throw new Error("unreachable");
    expect(sevenDay.utilizationPercent).toBe(22);
  });

  it("REFUSES A PERCENTAGE for a window whose resets_at has passed — the measured failure", () => {
    // The captured case: the file was 48 minutes old and its five_hour window
    // had reset 27 minutes earlier, so `utilization: 70` described a window
    // that no longer existed.
    const r = parseUsageCache(fxJson("claude-json-stale.json"), NOW_REAL);
    expect(r.kind).toBe("value");
    if (r.kind !== "value") throw new Error("unreachable");
    expect(r.ageMs).toBe(48 * 60_000);

    const fiveHour = r.windows.find((w) => w.window === "five_hour");
    expect(fiveHour?.kind).toBe("expired");
    if (fiveHour?.kind !== "expired") throw new Error("unreachable");
    expect(fiveHour.msSinceReset).toBe(27 * 60_000);
    expect(fiveHour.window).toBe("five_hour");
    // THE POINT: no numeric field anywhere on this arm can be rendered as a
    // utilisation. The stale 70 survives only as prose inside `why`.
    expect(Object.keys(fiveHour).sort()).toEqual(["kind", "msSinceReset", "resetsAt", "resetsAtMs", "why", "window"].sort());
    expect(fiveHour).not.toHaveProperty("utilizationPercent");
    expect(JSON.stringify(fiveHour)).not.toMatch(/"[a-zA-Z]*[Pp]ercent"\s*:\s*70/);
    expect(fiveHour.why).toContain("70");
    expect(fiveHour.why).toContain("no longer exists");

    // …while the seven_day window in the same stale file is still open and is
    // still reported. Staleness is per window, not per file.
    const sevenDay = r.windows.find((w) => w.window === "seven_day");
    expect(sevenDay?.kind).toBe("value");
  });

  it("says unknown, not 0%, when .cachedUsageUtilization is absent", () => {
    const r = parseUsageCache(fxJson("claude-json-no-cache.json"), NOW_REAL);
    expect(r.kind).toBe("unknown");
    if (r.kind !== "unknown") throw new Error("unreachable");
    expect(r.why).toContain("cachedUsageUtilization");
    expect(r.why).toContain("not 0% used");
  });

  it("says unknown for a per-model codename window that has utilization 0 and no resets_at", () => {
    // Real: `nimbus_quill` in the captured file. A 0 with nothing to validate
    // it against is not a reading, and must not render as "plenty of headroom".
    const r = parseUsageCache(fxJson("claude-json-real.json"), NOW_REAL);
    if (r.kind !== "value") throw new Error("unreachable");
    const codename = r.windows.find((w) => w.window === "nimbus_quill");
    expect(codename?.kind).toBe("unknown");
    if (codename?.kind !== "unknown") throw new Error("unreachable");
    expect(codename.why).toContain("no resets_at");
  });

  it("skips `limits` and `extra_usage`, which are not windows", () => {
    const r = parseUsageCache(fxJson("claude-json-real.json"), NOW_REAL);
    if (r.kind !== "value") throw new Error("unreachable");
    expect(r.windows.map((w) => w.window)).not.toContain("limits");
    expect(r.windows.map((w) => w.window)).not.toContain("extra_usage");
  });

  it("says unknown when the file itself did not parse into an object", () => {
    expect(parseUsageCache("not an object", NOW_REAL).kind).toBe("unknown");
    expect(parseUsageCache(null, NOW_REAL).kind).toBe("unknown");
  });

  it("treats a resets_at exactly at `now` as expired, not as a live window", () => {
    const at = "2026-09-08T12:00:00.000Z";
    const r = parseUsageWindow("five_hour", { utilization: 99, resets_at: at }, Date.parse(at));
    expect(r.kind).toBe("expired");
  });
});

// ---------------------------------------------------------------------------
// (c) Which account a reading belongs to.
// ---------------------------------------------------------------------------

describe("parseAuthStatus", () => {
  it("joins the real auth status with .oauthAccount for the uuid and the rate-limit tier", () => {
    const r = parseAuthStatus(fx("auth-status-real.json"), fxJson("claude-json-real.json"));
    expect(r).toEqual({
      kind: "value",
      email: "greg@rehearsable.ai",
      orgId: "55555555-6666-7777-8888-999999999999",
      orgName: "greg@rehearsable.ai's Organization",
      subscriptionType: "max",
      accountUuid: "00000000-1111-2222-3333-444444444444",
      rateLimitTier: "default_claude_max_20x",
    });
  });

  it("distinguishes logged-out (an answer) from unreadable (a failure)", () => {
    const out = parseAuthStatus(fx("auth-status-logged-out.json"), null);
    expect(out.kind).toBe("logged-out");
    const broken = parseAuthStatus("claude: command not found", null);
    expect(broken.kind).toBe("unknown");
    if (broken.kind !== "unknown") throw new Error("unreachable");
    expect(broken.why).toContain("did not print JSON");
  });
});

// ---------------------------------------------------------------------------
// (b) The 429 in a transcript. Ground truth.
// ---------------------------------------------------------------------------

describe("parseRateLimitLine — real 429 records", () => {
  it("parses the real five_hour rejection to the right window and reset", () => {
    const r = parseRateLimitLine(fx("transcript-429-five-hour-real.jsonl").trim(), "/fake/t.jsonl");
    expect(r.kind).toBe("hit");
    if (r.kind !== "hit") throw new Error("unreachable");
    expect(r.hit).toEqual({
      window: "five_hour",
      // resetsAt in the record is unix SECONDS: 1788436200.
      resetsAtMs: 1788436200 * 1000,
      hitAt: "2026-09-03T10:33:53.385Z",
      hitAtMs: Date.parse("2026-09-03T10:33:53.385Z"),
      status: "rejected",
      claudeSessionId: "055bc66d-d4bf-4794-924f-8c662035fb7e",
      transcriptPath: "/fake/t.jsonl",
      message: "You've hit your session limit · resets 12:50pm (Europe/London)",
    });
    expect(isKnownUsageWindow(r.hit.window)).toBe(true);
  });

  it("parses the real seven_day rejection", () => {
    const r = parseRateLimitLine(fx("transcript-429-seven-day-real.jsonl").trim(), "/fake/t.jsonl");
    expect(r.kind).toBe("hit");
    if (r.kind !== "hit") throw new Error("unreachable");
    expect(r.hit.window).toBe("seven_day");
    expect(r.hit.resetsAtMs).toBe(1789236000 * 1000);
    expect(r.hit.message).toContain("weekly limit");
  });

  it("parses the variant carrying the extra lowPriority* keys identically", () => {
    const r = parseRateLimitLine(fx("transcript-429-five-hour-lowpriority-real.jsonl").trim(), "/fake/t.jsonl");
    expect(r.kind).toBe("hit");
    if (r.kind !== "hit") throw new Error("unreachable");
    expect(r.hit.window).toBe("five_hour");
    expect(r.hit.resetsAtMs).toBe(1788418200 * 1000);
  });

  it("calls a line with no quotaLimits not-a-hit, so source code mentioning the word is not a false alarm", () => {
    // This very repository now contains the string `rateLimitType`, so every
    // agent transcript that reads usage.ts will produce candidate lines that
    // are not rejections. They must not count as shape drift.
    const line = JSON.stringify({ type: "user", message: { role: "user", content: 'grep rateLimitType tools/overseer/usage.ts' } });
    expect(parseRateLimitLine(line, "/fake/t.jsonl").kind).toBe("not-a-hit");
  });

  it("calls quotaLimits with no rate-limit error signal a report, not a rejection", () => {
    const line = JSON.stringify({ type: "assistant", quotaLimits: { status: "allowed", resetsAt: 1788436200, rateLimitType: "five_hour" } });
    expect(parseRateLimitLine(line, "/fake/t.jsonl").kind).toBe("no-error-signal");
  });

  it("calls a rejection whose quotaLimits shape has drifted MALFORMED, not absent", () => {
    const lines = fx("transcript-429-malformed.jsonl").trim().split("\n");
    // Missing resetsAt, and a null rateLimitType: both are shape drift.
    expect(parseRateLimitLine(lines[0] as string, "/fake/t.jsonl").kind).toBe("malformed");
    expect(parseRateLimitLine(lines[1] as string, "/fake/t.jsonl").kind).toBe("malformed");
    // Truncated JSON is `unparsed`, which is expected occasionally on a live file.
    expect(parseRateLimitLine(lines[2] as string, "/fake/t.jsonl").kind).toBe("unparsed");
  });

  it("finds a quotaLimits nested under `message`, so a shape move does not read as silence", () => {
    const line = JSON.stringify({
      type: "assistant",
      timestamp: "2026-09-08T10:00:00.000Z",
      message: { isApiErrorMessage: true, error: "rate_limit", quotaLimits: { status: "rejected", resetsAt: 1788436200, rateLimitType: "five_hour" } },
    });
    const r = parseRateLimitLine(line, "/fake/t.jsonl");
    expect(r.kind).toBe("hit");
  });
});

// ---------------------------------------------------------------------------
// THE HONEST-FAILURE REQUIREMENT. A probe that found nothing must prove it
// looked, and must not report an absence it cannot back.
// ---------------------------------------------------------------------------

const emptyCoverage = (over: Partial<ScanCoverage> = {}): ScanCoverage => ({
  transcriptsFound: 0,
  transcriptsSelected: 0,
  transcriptsOpened: 0,
  transcriptsUnreadable: 0,
  unreadableWhy: [],
  linesScanned: 0,
  candidateLines: 0,
  linesParsed: 0,
  malformedCandidates: 0,
  quotaLimitsWithoutErrorSignal: 0,
  truncatedByLimit: false,
  sinceMs: null,
  tookMs: 0,
  ...over,
});

describe("summariseRateLimitScan — a zero has to earn belief", () => {
  it("refuses `none` when it opened nothing", () => {
    const r = summariseRateLimitScan([], emptyCoverage({ transcriptsFound: 12, transcriptsSelected: 12 }));
    expect(r.kind).toBe("unknown");
    if (r.kind !== "unknown") throw new Error("unreachable");
    expect(r.why).toContain("no transcript was opened");
  });

  it("refuses `none` when it opened files but read no lines", () => {
    const r = summariseRateLimitScan([], emptyCoverage({ transcriptsOpened: 3, linesScanned: 0 }));
    expect(r.kind).toBe("unknown");
  });

  it("refuses `none` when it found rate-limit-shaped records it could not read", () => {
    const r = summariseRateLimitScan(
      [],
      emptyCoverage({ transcriptsOpened: 3, linesScanned: 900, candidateLines: 2, linesParsed: 2, malformedCandidates: 2 }),
    );
    expect(r.kind).toBe("unknown");
    if (r.kind !== "unknown") throw new Error("unreachable");
    expect(r.why).toContain("shape has probably changed");
  });

  it("returns `none` only with a positive control attached", () => {
    const r = summariseRateLimitScan([], emptyCoverage({ transcriptsOpened: 235, linesScanned: 232961 }));
    expect(r.kind).toBe("none");
    expect(r.coverage.transcriptsOpened).toBe(235);
    expect(r.coverage.linesScanned).toBe(232961);
  });

  it("sorts hits newest first", () => {
    const mk = (hitAtMs: number, window: string): RateLimitHit => ({
      window,
      resetsAtMs: hitAtMs + 1000,
      hitAtMs,
      hitAt: new Date(hitAtMs).toISOString(),
      status: "rejected",
      claudeSessionId: "s",
      transcriptPath: "/fake/t.jsonl",
      message: null,
    });
    const r = summariseRateLimitScan([mk(1000, "a"), mk(3000, "b"), mk(2000, "c")], emptyCoverage({ transcriptsOpened: 1, linesScanned: 1 }));
    if (r.kind !== "hits") throw new Error("unreachable");
    expect(r.hits.map((h) => h.window)).toEqual(["b", "c", "a"]);
  });
});

describe("scanForRateLimits — the I/O half, against transcript directories on disk", () => {
  it("finds the two real rejections and says how much it opened to find them", async () => {
    const dir = await transcriptDir({
      "a.jsonl": fx("transcript-429-five-hour-real.jsonl"),
      "b.jsonl": fx("transcript-429-seven-day-real.jsonl"),
      "c.jsonl": fx("transcript-no-429-real.jsonl"),
    });
    const r = await scanForRateLimits({ projectsDir: dir, sinceMs: null, maxTranscripts: 100, nowMs: NOW_REAL });
    expect(r.kind).toBe("hits");
    if (r.kind !== "hits") throw new Error("unreachable");
    expect(r.hits.map((h) => h.window).sort()).toEqual(["five_hour", "seven_day"]);
    expect(r.coverage.transcriptsFound).toBe(3);
    expect(r.coverage.transcriptsOpened).toBe(3);
    expect(r.coverage.linesScanned).toBe(8); // 1 + 1 + 6
    expect(r.coverage.candidateLines).toBe(2);
  });

  it("yields `none` for a transcript with no 429 — with the count that makes the zero believable", async () => {
    const dir = await transcriptDir({ "c.jsonl": fx("transcript-no-429-real.jsonl") });
    const r = await scanForRateLimits({ projectsDir: dir, sinceMs: null, maxTranscripts: 100, nowMs: NOW_REAL });
    expect(r.kind).toBe("none");
    if (r.kind !== "none") throw new Error("unreachable");
    // THE POSITIVE CONTROL: without these a broken probe and a quiet box are
    // the same answer.
    expect(r.coverage.transcriptsOpened).toBe(1);
    expect(r.coverage.linesScanned).toBe(6);
    expect(r.coverage.transcriptsUnreadable).toBe(0);
  });

  it("says unknown, not none, when the projects directory does not exist", async () => {
    const r = await scanForRateLimits({
      projectsDir: path.join(tmpdir(), "overseer-usage-does-not-exist-4a7f"),
      sinceMs: null,
      maxTranscripts: 100,
      nowMs: NOW_REAL,
    });
    expect(r.kind).toBe("unknown");
    if (r.kind !== "unknown") throw new Error("unreachable");
    expect(r.coverage.transcriptsOpened).toBe(0);
    expect(r.coverage.transcriptsUnreadable).toBe(1);
  });

  it("marks an absence as partial when its own transcript limit cut the scan short", async () => {
    const dir = await transcriptDir({
      "a.jsonl": fx("transcript-no-429-real.jsonl"),
      "b.jsonl": fx("transcript-no-429-real.jsonl"),
      "c.jsonl": fx("transcript-no-429-real.jsonl"),
    });
    const r = await scanForRateLimits({ projectsDir: dir, sinceMs: null, maxTranscripts: 2, nowMs: NOW_REAL });
    expect(r.coverage.truncatedByLimit).toBe(true);
    expect(r.coverage.transcriptsSelected).toBe(2);
    expect(r.coverage.transcriptsOpened).toBe(2);
  });

  it("excludes transcripts outside the mtime window, and says what window it applied", async () => {
    const dir = await transcriptDir({ "a.jsonl": fx("transcript-429-five-hour-real.jsonl") });
    // nowMs far in the future puts the just-written file outside a 1-hour window.
    const r = await scanForRateLimits({ projectsDir: dir, sinceMs: 3600_000, maxTranscripts: 100, nowMs: Date.now() + 10 * 3600_000 });
    expect(r.kind).toBe("unknown");
    expect(r.coverage.transcriptsFound).toBe(1);
    expect(r.coverage.transcriptsSelected).toBe(0);
    expect(r.coverage.sinceMs).toBe(3600_000);
  });

  it("reads a marker split across the 1 MiB chunk boundary", async () => {
    // The chunked buffer scan is the reason this module is fast enough to poll;
    // its one failure mode is a record straddling a read boundary. Pad with
    // benign lines until the rejection starts past 1 MiB.
    const filler = `${JSON.stringify({ type: "user", pad: "x".repeat(4000) })}\n`;
    const padded = filler.repeat(300) + fx("transcript-429-five-hour-real.jsonl");
    expect(padded.length).toBeGreaterThan(1 << 20);
    const dir = await transcriptDir({ "big.jsonl": padded });
    const r = await scanForRateLimits({ projectsDir: dir, sinceMs: null, maxTranscripts: 100, nowMs: NOW_REAL });
    expect(r.kind).toBe("hits");
    if (r.kind !== "hits") throw new Error("unreachable");
    expect(r.hits[0]?.window).toBe("five_hour");
  });

  it("recurses into the subagents/ directory, where a third of the real rejections live", async () => {
    const dir = await transcriptDir({ "a.jsonl": fx("transcript-no-429-real.jsonl") });
    await mkdir(path.join(dir, "-home-greg-code-spideryarn2", "a", "subagents"), { recursive: true });
    await cp(
      path.join(FIXTURES, "transcript-429-five-hour-lowpriority-real.jsonl"),
      path.join(dir, "-home-greg-code-spideryarn2", "a", "subagents", "agent-x.jsonl"),
    );
    const r = await scanForRateLimits({ projectsDir: dir, sinceMs: null, maxTranscripts: 100, nowMs: NOW_REAL });
    expect(r.kind).toBe("hits");
    if (r.kind !== "hits") throw new Error("unreachable");
    expect(r.coverage.transcriptsFound).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// The verdict, and its trust order.
// ---------------------------------------------------------------------------

const hit = (over: Partial<RateLimitHit> = {}): RateLimitHit => ({
  window: "five_hour",
  resetsAtMs: NOW_REAL + 3600_000,
  hitAtMs: NOW_REAL - 60_000,
  hitAt: new Date(NOW_REAL - 60_000).toISOString(),
  status: "rejected",
  claudeSessionId: "055bc66d-d4bf-4794-924f-8c662035fb7e",
  transcriptPath: "/fake/t.jsonl",
  message: null,
  ...over,
});

describe("computeUsageVerdict", () => {
  it("reports `limited` from an unexpired 429, and hands back the hit that gates work longest", () => {
    const soon = hit({ window: "five_hour", resetsAtMs: NOW_REAL + 3600_000 });
    const late = hit({ window: "seven_day", resetsAtMs: NOW_REAL + 4 * 24 * 3600_000 });
    const v = computeUsageVerdict({
      account: { kind: "unknown", why: "skipped" },
      cache: { kind: "unknown", why: "skipped" },
      rateLimits: { kind: "hits", hits: [soon, late], coverage: emptyCoverage({ transcriptsOpened: 1, linesScanned: 2 }) },
      nowMs: NOW_REAL,
    });
    expect(v.level).toBe("limited");
    expect(v.activeLimit?.window).toBe("seven_day");
  });

  it("does not report `limited` from a 429 whose window has already reset", () => {
    const v = computeUsageVerdict({
      account: { kind: "unknown", why: "skipped" },
      cache: parseUsageCache(fxJson("claude-json-real.json"), NOW_REAL),
      rateLimits: { kind: "hits", hits: [hit({ resetsAtMs: NOW_REAL - 1 })], coverage: emptyCoverage({ transcriptsOpened: 1, linesScanned: 2 }) },
      nowMs: NOW_REAL,
    });
    expect(v.level).toBe("ok");
    expect(v.activeLimit).toBeNull();
    expect(v.reasons.join(" ")).toContain("already reset");
  });

  it("raises `approaching` from a live cached window over the cutoff — but never `limited`", () => {
    const v = computeUsageVerdict({
      account: { kind: "unknown", why: "skipped" },
      cache: {
        kind: "value",
        accountUuid: null,
        fetchedAtMs: NOW_REAL - 60_000,
        ageMs: 60_000,
        windows: [
          { kind: "value", window: "five_hour", utilizationPercent: 92, resetsAt: "2026-09-08T16:00:00Z", resetsAtMs: NOW_REAL + 1, msUntilReset: 1 },
        ],
      },
      rateLimits: { kind: "none", coverage: emptyCoverage({ transcriptsOpened: 2, linesScanned: 40 }) },
      nowMs: NOW_REAL,
    });
    expect(v.level).toBe("approaching");
  });

  it("IGNORES a cache belonging to a different account — the /login-swap trap", () => {
    const v = computeUsageVerdict({
      account: { kind: "value", email: "greg@rehearsable.ai", orgId: "o", orgName: null, subscriptionType: "max", accountUuid: "AAAA", rateLimitTier: "default_claude_max_20x" },
      cache: {
        kind: "value",
        accountUuid: "BBBB",
        fetchedAtMs: NOW_REAL - 60_000,
        ageMs: 60_000,
        windows: [
          { kind: "value", window: "five_hour", utilizationPercent: 99, resetsAt: "2026-09-08T16:00:00Z", resetsAtMs: NOW_REAL + 1, msUntilReset: 1 },
        ],
      },
      rateLimits: { kind: "none", coverage: emptyCoverage({ transcriptsOpened: 2, linesScanned: 40 }) },
      nowMs: NOW_REAL,
    });
    expect(v.level).toBe("ok");
    expect(v.reasons.join(" ")).toContain("ignoring the cached utilisation");
  });

  it("says `unknown`, not `ok`, when neither source could be read", () => {
    const v = computeUsageVerdict({
      account: { kind: "unknown", why: "claude auth status failed" },
      cache: { kind: "unknown", why: "no .cachedUsageUtilization" },
      rateLimits: { kind: "unknown", why: "no transcript was opened", coverage: emptyCoverage() },
      nowMs: NOW_REAL,
    });
    expect(v.level).toBe("unknown");
    expect(v.reasons[0]).toContain("not the same as having headroom");
  });

  it("says `unknown` when the only cached windows are expired and the scan failed", () => {
    const v = computeUsageVerdict({
      account: { kind: "unknown", why: "skipped" },
      cache: parseUsageCache(fxJson("claude-json-stale.json"), Date.parse("2026-09-20T00:00:00Z")),
      rateLimits: { kind: "unknown", why: "no transcript was opened", coverage: emptyCoverage() },
      nowMs: Date.parse("2026-09-20T00:00:00Z"),
    });
    expect(v.level).toBe("unknown");
  });

  it("warns in its own reasons when a `none` came from a truncated scan", () => {
    const v = computeUsageVerdict({
      account: { kind: "unknown", why: "skipped" },
      cache: parseUsageCache(fxJson("claude-json-real.json"), NOW_REAL),
      rateLimits: { kind: "none", coverage: emptyCoverage({ transcriptsOpened: 500, linesScanned: 900, truncatedByLimit: true }) },
      nowMs: NOW_REAL,
    });
    expect(v.reasons.join(" ")).toContain("cut short");
  });
});

// ---------------------------------------------------------------------------
// One conversation's answer, for a dashboard row. Requested by the session that
// owns FleetStatus, and the reason for the third arm is its argument: a bare
// `null` would collapse "no limit in force" with "the scan could not tell".
// ---------------------------------------------------------------------------

describe("latestHitForConversation", () => {
  const scanOf = (hits: RateLimitHit[], over: Partial<ScanCoverage> = {}) =>
    summariseRateLimitScan(hits, emptyCoverage({ transcriptsOpened: 3, linesScanned: 300, ...over }));

  it("returns the hit belonging to that conversation, not another one's", () => {
    const mine = hit({ claudeSessionId: "mine", window: "five_hour" });
    const theirs = hit({ claudeSessionId: "theirs", window: "seven_day", resetsAtMs: NOW_REAL + 9e9 });
    const r = latestHitForConversation(scanOf([mine, theirs]), "mine", NOW_REAL);
    expect(r.kind).toBe("hit");
    if (r.kind !== "hit") throw new Error("unreachable");
    expect(r.hit.claudeSessionId).toBe("mine");
  });

  it("returns `none` when that conversation's only rejection has already reset", () => {
    const r = latestHitForConversation(scanOf([hit({ claudeSessionId: "mine", resetsAtMs: NOW_REAL - 1 })]), "mine", NOW_REAL);
    expect(r.kind).toBe("none");
  });

  it("returns `cannot-tell`, never `none`, when the scan itself could not tell", () => {
    const broken = summariseRateLimitScan([], emptyCoverage({ transcriptsFound: 40 }));
    expect(broken.kind).toBe("unknown");
    const r = latestHitForConversation(broken, "mine", NOW_REAL);
    expect(r.kind).toBe("cannot-tell");
    if (r.kind !== "cannot-tell") throw new Error("unreachable");
    expect(r.why).toContain("no transcript was opened");
  });

  it("returns `cannot-tell` when a truncated scan never reached this conversation", () => {
    const r = latestHitForConversation(scanOf([hit({ claudeSessionId: "someone-else" })], { truncatedByLimit: true }), "mine", NOW_REAL);
    expect(r.kind).toBe("cannot-tell");
    if (r.kind !== "cannot-tell") throw new Error("unreachable");
    expect(r.why).toContain("stopped at");
  });

  it("still answers `hit` for a conversation the truncated scan DID reach", () => {
    const r = latestHitForConversation(scanOf([hit({ claudeSessionId: "mine" })], { truncatedByLimit: true }), "mine", NOW_REAL);
    expect(r.kind).toBe("hit");
  });

  it("picks the rejection that frees up last when a conversation has two", () => {
    const soon = hit({ claudeSessionId: "mine", window: "five_hour", resetsAtMs: NOW_REAL + 3600_000 });
    const late = hit({ claudeSessionId: "mine", window: "seven_day", resetsAtMs: NOW_REAL + 4 * 24 * 3600_000 });
    const r = latestHitForConversation(scanOf([soon, late]), "mine", NOW_REAL);
    if (r.kind !== "hit") throw new Error("unreachable");
    expect(r.hit.window).toBe("seven_day");
  });
});

// ---------------------------------------------------------------------------
// A REJECTION FROM A PREVIOUS ACCOUNT. Found by running the collector against
// the live box on 2026-09-08 — the plan did not anticipate it, and it is the
// only defect this stage shipped and fixed.
//
// A transcript 429 carries no account id. Greg swaps between Max subscriptions
// with `/login`, so this box's transcripts hold rejections belonging to
// accounts that are no longer logged in, and one of those looks exactly like a
// current rejection right down to a `resetsAt` in the future. Live numbers: 25
// `seven_day` rejections from 2026-09-07, all recording `resetsAt`
// 2026-09-12T18:00Z, while the current account's cache said its `seven_day`
// window was 22% used and resets 2026-09-15T04:59Z. The collector said LIMITED
// for an account with 78% of its week left.
// ---------------------------------------------------------------------------

describe("contradictsCachedWindow — the /login-swap rejection", () => {
  /** The live capture: what the current account's cache actually said. */
  const liveCache = () => parseUsageCache(fxJson("claude-json-real.json"), NOW_REAL);
  /** The live rejection: 2026-09-07, seven_day, resets 2026-09-12T18:00Z. */
  const previousAccountHit = () =>
    hit({
      window: "seven_day",
      resetsAtMs: 1789236000 * 1000,
      hitAt: "2026-09-07T05:31:22.319Z",
      hitAtMs: Date.parse("2026-09-07T05:31:22.319Z"),
      claudeSessionId: "bccde256-313a-4664-a395-6f473c2f4fff",
    });

  it("names the contradiction when a rejection and a live cached window disagree on the reset", () => {
    const why = contradictsCachedWindow(previousAccountHit(), liveCache());
    expect(why).not.toBeNull();
    expect(why).toContain("different account");
    expect(why).toContain("2026-09-15T04:59:59.790550+00:00");
  });

  it("does NOT contradict when the two agree within the sub-second precision gap", () => {
    // The cache carries `…:59.790550+00:00`; a transcript's resetsAt is whole
    // unix seconds. Exact equality would call one window two.
    const cached = liveCache();
    if (cached.kind !== "value") throw new Error("unreachable");
    const sevenDay = cached.windows.find((w) => w.window === "seven_day");
    if (sevenDay?.kind !== "value") throw new Error("unreachable");
    const agreeing = hit({ window: "seven_day", resetsAtMs: Math.floor(sevenDay.resetsAtMs / 1000) * 1000 });
    expect(contradictsCachedWindow(agreeing, cached)).toBeNull();
  });

  it("cannot contradict from an expired or unknown cached window — those describe nothing", () => {
    const stale = parseUsageCache(fxJson("claude-json-stale.json"), NOW_REAL);
    // five_hour is `expired` in that fixture, so a five_hour rejection is not disqualified.
    expect(contradictsCachedWindow(hit({ window: "five_hour", resetsAtMs: NOW_REAL + 9e6 }), stale)).toBeNull();
    expect(contradictsCachedWindow(hit({ window: "nimbus_quill", resetsAtMs: NOW_REAL + 9e6 }), stale)).toBeNull();
    expect(contradictsCachedWindow(hit(), { kind: "unknown", why: "no cache" })).toBeNull();
  });

  it("the verdict is NOT `limited` for a rejection that belongs to a previous account", () => {
    const v = computeUsageVerdict({
      account: parseAuthStatus(fx("auth-status-real.json"), fxJson("claude-json-real.json")),
      cache: liveCache(),
      rateLimits: {
        kind: "hits",
        hits: [previousAccountHit()],
        coverage: emptyCoverage({ transcriptsOpened: 239, linesScanned: 237547 }),
      },
      nowMs: NOW_REAL,
    });
    expect(v.level).not.toBe("limited");
    expect(v.activeLimit).toBeNull();
    expect(v.reasons.join(" ")).toContain("not this account's");
  });

  it("…but IS `limited` for a rejection that agrees with the live cached window", () => {
    const cached = liveCache();
    if (cached.kind !== "value") throw new Error("unreachable");
    const sevenDay = cached.windows.find((w) => w.window === "seven_day");
    if (sevenDay?.kind !== "value") throw new Error("unreachable");
    const v = computeUsageVerdict({
      account: parseAuthStatus(fx("auth-status-real.json"), fxJson("claude-json-real.json")),
      cache: cached,
      rateLimits: {
        kind: "hits",
        hits: [hit({ window: "seven_day", resetsAtMs: Math.floor(sevenDay.resetsAtMs / 1000) * 1000 })],
        coverage: emptyCoverage({ transcriptsOpened: 239, linesScanned: 237547 }),
      },
      nowMs: NOW_REAL,
    });
    expect(v.level).toBe("limited");
    expect(v.activeLimit?.window).toBe("seven_day");
  });

  it("says out loud that it could not check provenance when there is no usable cache", () => {
    const v = computeUsageVerdict({
      account: { kind: "unknown", why: "skipped" },
      cache: { kind: "unknown", why: "no .cachedUsageUtilization" },
      rateLimits: {
        kind: "hits",
        hits: [previousAccountHit()],
        coverage: emptyCoverage({ transcriptsOpened: 3, linesScanned: 300 }),
      },
      nowMs: NOW_REAL,
    });
    // Ground truth still wins when nothing can dispute it — but the doubt is stated.
    expect(v.level).toBe("limited");
    expect(v.reasons.join(" ")).toContain("carries no account id");
  });

  it("latestHitForConversation sets the same rejection aside when handed the cache", () => {
    const scan = summariseRateLimitScan([previousAccountHit()], emptyCoverage({ transcriptsOpened: 3, linesScanned: 300 }));
    const withoutCache = latestHitForConversation(scan, "bccde256-313a-4664-a395-6f473c2f4fff", NOW_REAL);
    expect(withoutCache.kind).toBe("hit");
    const withCache = latestHitForConversation(scan, "bccde256-313a-4664-a395-6f473c2f4fff", NOW_REAL, liveCache());
    expect(withCache.kind).toBe("none");
  });
});
```

## Fixtures (real captures unless the test header declares otherwise)

### `auth-status-logged-out.json`

```
{
  "loggedIn": false,
  "authMethod": null,
  "apiProvider": null,
  "analyticsDisabled": false,
  "projectsDirectory": "/tmp/scratch-config/projects"
}

```

### `auth-status-real.json`

```
{
  "loggedIn": true,
  "authMethod": "claude.ai",
  "apiProvider": "firstParty",
  "analyticsDisabled": false,
  "projectsDirectory": "/home/greg/.claude/projects",
  "email": "greg@rehearsable.ai",
  "orgId": "55555555-6666-7777-8888-999999999999",
  "orgName": "greg@rehearsable.ai's Organization",
  "subscriptionType": "max"
}

```

### `claude-json-no-cache.json`

```
{
  "numStartups": 412,
  "installMethod": "native",
  "oauthAccount": {
    "accountUuid": "00000000-1111-2222-3333-444444444444",
    "emailAddress": "greg@rehearsable.ai",
    "organizationUuid": "55555555-6666-7777-8888-999999999999",
    "organizationName": "greg@rehearsable.ai's Organization",
    "organizationType": "claude_max",
    "organizationRateLimitTier": "default_claude_max_20x",
    "userRateLimitTier": null
  }
}

```

### `claude-json-real.json`

```
{
  "cachedUsageUtilization": {
    "fetchedAtMs": 1788868334947,
    "accountUuid": "00000000-1111-2222-3333-444444444444",
    "utilization": {
      "five_hour": {
        "utilization": 1,
        "resets_at": "2026-09-08T16:49:59.790529+00:00",
        "limit_dollars": null,
        "used_dollars": null,
        "remaining_dollars": null,
        "locked_reason": null
      },
      "seven_day": {
        "utilization": 22,
        "resets_at": "2026-09-15T04:59:59.790550+00:00",
        "limit_dollars": null,
        "used_dollars": null,
        "remaining_dollars": null,
        "locked_reason": null
      },
      "seven_day_oauth_apps": null,
      "seven_day_opus": null,
      "seven_day_sonnet": null,
      "seven_day_cowork": null,
      "seven_day_omelette": null,
      "tangelo": null,
      "iguana_necktie": null,
      "omelette_promotional": null,
      "nimbus_quill": {
        "utilization": 0,
        "resets_at": null,
        "limit_dollars": null,
        "used_dollars": null,
        "remaining_dollars": null,
        "locked_reason": null
      },
      "cinder_cove": null,
      "copper_kite": null,
      "amber_ladder": null,
      "juniper_tide": null,
      "extra_usage": {
        "is_enabled": false,
        "monthly_limit": null,
        "used_credits": null,
        "utilization": null,
        "currency": null,
        "decimal_places": null,
        "disabled_reason": null,
        "user_disabled": false,
        "spend_limit_reached": false,
        "credits_ever_enabled": false,
        "daily": null,
        "weekly": null
      },
      "limits": [
        {
          "kind": "session",
          "group": "session",
          "percent": 1,
          "severity": "normal",
          "resets_at": "2026-09-08T16:49:59.790529+00:00",
          "scope": null,
          "is_active": false
        },
        {
          "kind": "weekly_all",
          "group": "weekly",
          "percent": 22,
          "severity": "normal",
          "resets_at": "2026-09-15T04:59:59.790550+00:00",
          "scope": null,
          "is_active": true
        },
        {
          "kind": "weekly_scoped",
          "group": "weekly",
          "percent": 2,
          "severity": "normal",
          "resets_at": "2026-09-15T04:59:59.790721+00:00",
          "scope": {
            "model": {
              "id": null,
              "display_name": "Fable"
            },
            "surface": null
          },
          "is_active": false
        }
      ],
      "spend": {
        "used": {
          "amount_minor": 0,
          "currency": "USD",
          "exponent": 2
        },
        "limit": null,
        "percent": 0,
        "severity": "normal",
        "enabled": false,
        "disabled_reason": null,
        "cap": null,
        "balance": null,
        "auto_reload": null,
        "disclaimer": "Usage credits cover you when you hit your plan limits. [Learn more](https://support.claude.com/articles/12429409)",
        "can_purchase_credits": false,
        "can_toggle": false
      },
      "member_dashboard_available": false
    }
  },
  "oauthAccount": {
    "accountUuid": "00000000-1111-2222-3333-444444444444",
    "emailAddress": "greg@rehearsable.ai",
    "organizationUuid": "55555555-6666-7777-8888-999999999999",
    "hasExtraUsageEnabled": false,
    "billingType": "stripe_subscription",
    "accountCreatedAt": "2024-11-26T09:54:47.247069Z",
    "subscriptionCreatedAt": "2026-08-27T14:16:52.423500Z",
    "ccOnboardingFlags": {},
    "claudeCodeTrialEndsAt": null,
    "claudeCodeTrialDurationDays": null,
    "seatTier": null,
    "displayName": "Greg",
    "fullName": "Greg Detre",
    "profileFetchedAt": 1788845815487,
    "organizationRole": "admin",
    "workspaceRole": null,
    "organizationName": "greg@rehearsable.ai's Organization",
    "organizationType": "claude_max",
    "organizationRateLimitTier": "default_claude_max_20x",
    "userRateLimitTier": null
  }
}

```

### `claude-json-stale.json`

```
{
  "cachedUsageUtilization": {
    "fetchedAtMs": 1788865920000,
    "accountUuid": "00000000-1111-2222-3333-444444444444",
    "utilization": {
      "five_hour": {
        "utilization": 70,
        "resets_at": "2026-09-08T11:33:00.000000+00:00",
        "limit_dollars": null,
        "used_dollars": null,
        "remaining_dollars": null,
        "locked_reason": null
      },
      "seven_day": {
        "utilization": 22,
        "resets_at": "2026-09-15T04:59:59.790550+00:00",
        "limit_dollars": null,
        "used_dollars": null,
        "remaining_dollars": null,
        "locked_reason": null
      },
      "seven_day_opus": null,
      "nimbus_quill": {
        "utilization": 0,
        "resets_at": null,
        "limit_dollars": null,
        "used_dollars": null,
        "remaining_dollars": null,
        "locked_reason": null
      },
      "extra_usage": {
        "is_enabled": false,
        "monthly_limit": null,
        "used_credits": null,
        "utilization": null,
        "currency": null,
        "decimal_places": null,
        "disabled_reason": null,
        "user_disabled": false,
        "spend_limit_reached": false,
        "credits_ever_enabled": false,
        "daily": null,
        "weekly": null
      },
      "limits": [
        {
          "kind": "session",
          "group": "session",
          "percent": 70,
          "severity": "normal",
          "resets_at": "2026-09-08T11:33:00.000000+00:00",
          "scope": null,
          "is_active": true
        }
      ]
    }
  },
  "oauthAccount": {
    "accountUuid": "00000000-1111-2222-3333-444444444444",
    "emailAddress": "greg@rehearsable.ai",
    "organizationUuid": "55555555-6666-7777-8888-999999999999",
    "organizationName": "greg@rehearsable.ai's Organization",
    "organizationType": "claude_max",
    "organizationRateLimitTier": "default_claude_max_20x",
    "userRateLimitTier": null
  }
}

```

### `transcript-429-five-hour-lowpriority-real.jsonl`

```
{"parentUuid":"38047f40-650a-40f1-bd43-6ac137f8bb6d","isSidechain":true,"agentId":"a9c67e98b542d5c96","type":"assistant","uuid":"39ff32c7-1a2d-4396-a828-6d9a373b5460","timestamp":"2026-09-03T06:22:24.628Z","message":{"diagnostics":null,"id":"8f6033fe-589c-4565-8fff-271fe9257ee9","container":null,"model":"<synthetic>","role":"assistant","stop_details":null,"stop_reason":"stop_sequence","stop_sequence":"","type":"message","usage":{"output_tokens_details":null,"input_tokens":0,"output_tokens":0,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"server_tool_use":{"web_search_requests":0,"web_fetch_requests":0},"service_tier":null,"cache_creation":{"ephemeral_1h_input_tokens":0,"ephemeral_5m_input_tokens":0},"inference_geo":null,"iterations":null,"speed":null},"content":[{"type":"text","text":"You've hit your session limit · resets 7:50am (Europe/London)"}],"context_management":null},"requestId":"req_011Ceg2PoEszBt26kyi99ff3","quotaLimits":{"status":"rejected","resetsAt":1788418200,"unifiedRateLimitFallbackAvailable":false,"rateLimitType":"five_hour","overageStatus":"rejected","overageDisabledReason":"org_level_disabled","isUsingOverage":false,"lowPriorityOffer":"control","lowPriorityRetryAfterSeconds":20,"lowPriorityMaxWaitSeconds":1200},"error":"rate_limit","isApiErrorMessage":true,"apiErrorStatus":429,"userType":"external","entrypoint":"cli","cwd":"/home/greg/code/spideryarn2/.claude/worktrees/cost-all-modes","sessionId":"055bc66d-d4bf-4794-924f-8c662035fb7e","version":"2.1.251","gitBranch":"worktree-cost-all-modes","slug":"greedy-noodling-snail"}

```

### `transcript-429-five-hour-real.jsonl`

```
{"parentUuid":"efad44f4-506d-4455-ae20-069469e17fc9","isSidechain":false,"type":"assistant","uuid":"baf2bdf6-ff83-4919-add9-3b511eca9dd4","timestamp":"2026-09-03T10:33:53.385Z","message":{"diagnostics":null,"id":"463a3c50-8e9f-420e-aa9f-878799e9a1f2","container":null,"model":"<synthetic>","role":"assistant","stop_details":null,"stop_reason":"stop_sequence","stop_sequence":"","type":"message","usage":{"output_tokens_details":null,"input_tokens":0,"output_tokens":0,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"server_tool_use":{"web_search_requests":0,"web_fetch_requests":0},"service_tier":null,"cache_creation":{"ephemeral_1h_input_tokens":0,"ephemeral_5m_input_tokens":0},"inference_geo":null,"iterations":null,"speed":null},"content":[{"type":"text","text":"You've hit your session limit · resets 12:50pm (Europe/London)"}],"context_management":null},"requestId":"req_011CegMa4cb8S2gKvNrjZc51","quotaLimits":{"status":"rejected","resetsAt":1788436200,"unifiedRateLimitFallbackAvailable":false,"rateLimitType":"five_hour","overageStatus":"rejected","overageDisabledReason":"org_level_disabled","isUsingOverage":false},"error":"rate_limit","isApiErrorMessage":true,"apiErrorStatus":429,"session_id":"055bc66d-d4bf-4794-924f-8c662035fb7e","userType":"external","entrypoint":"cli","cwd":"/home/greg/code/spideryarn2/.claude/worktrees/cost-all-modes","sessionId":"055bc66d-d4bf-4794-924f-8c662035fb7e","version":"2.1.251","gitBranch":"worktree-cost-all-modes","slug":"greedy-noodling-snail"}

```

### `transcript-429-malformed.jsonl`

```
{"type":"assistant","timestamp":"2026-09-08T10:00:00.000Z","sessionId":"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee","error":"rate_limit","isApiErrorMessage":true,"apiErrorStatus":429,"quotaLimits":{"status":"rejected","rateLimitType":"five_hour"}}
{"type":"assistant","timestamp":"2026-09-08T10:01:00.000Z","sessionId":"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee","error":"rate_limit","isApiErrorMessage":true,"apiErrorStatus":429,"quotaLimits":{"status":"rejected","resetsAt":1788880000,"rateLimitType":null}}
{"type":"assistant","timestamp":"2026-09-08T10:02:00.000Z","error":"rate_limit","isApiErrorMessage":true,"apiErrorStatus":429,"quotaLimits":{"status":"rejected","resetsAt":1788880000,"rateLimitType":"five_hour"

```

### `transcript-429-seven-day-real.jsonl`

```
{"parentUuid":"b1be5b4d-655a-4d97-99a2-d09ab6de1a32","isSidechain":false,"type":"assistant","uuid":"b60ebacb-99bf-4367-b14d-029ac35fe6be","timestamp":"2026-09-07T02:27:39.244Z","message":{"diagnostics":null,"id":"ef3120d7-17ae-4bf1-9c0f-02491723059d","container":null,"model":"<synthetic>","role":"assistant","stop_details":null,"stop_reason":"stop_sequence","stop_sequence":"","type":"message","usage":{"output_tokens_details":null,"input_tokens":0,"output_tokens":0,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"server_tool_use":{"web_search_requests":0,"web_fetch_requests":0},"service_tier":null,"cache_creation":{"ephemeral_1h_input_tokens":0,"ephemeral_5m_input_tokens":0},"inference_geo":null,"iterations":null,"speed":null},"content":[{"type":"text","text":"You've hit your weekly limit · resets Sep 12, 7pm (Europe/London)"}],"context_management":null},"requestId":"req_011CeoHjAuR2fTBfxBRNfXE1","quotaLimits":{"status":"rejected","resetsAt":1789236000,"unifiedRateLimitFallbackAvailable":false,"rateLimitType":"seven_day","overageStatus":"rejected","overageDisabledReason":"out_of_credits","isUsingOverage":false},"error":"rate_limit","isApiErrorMessage":true,"apiErrorStatus":429,"session_id":"130c77e4-1fdf-446d-9f6a-512535b5ce31","userType":"external","entrypoint":"cli","cwd":"/home/greg/code/spideryarn2/.claude/worktrees/upload-html-file","sessionId":"130c77e4-1fdf-446d-9f6a-512535b5ce31","version":"2.1.263","gitBranch":"worktree-upload-html-file"}

```

### `transcript-no-429-real.jsonl`

```
{"parentUuid":"32337f6f-2819-417b-bb80-baa511c4a444","isSidechain":false,"promptId":"c30f4b77-d037-4350-be5a-fc1228e03794","type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_01S4SdLZZxU6Nw9YRrfpvoW3","content":[{"type":"tool_reference","tool_name":"EnterWorktree"},{"type":"tool_reference","tool_name":"ExitWorktree"}]}]},"uuid":"ee4e3711-606a-4ade-b702-9e514a76ecc5","timestamp":"2026-09-07T01:09:25.515Z","toolUseResult":{"matches":["EnterWorktree","ExitWorktree"],"query":"select:EnterWorktree,ExitWorktree","total_deferred_tools":165},"sourceToolAssistantUUID":"32337f6f-2819-417b-bb80-baa511c4a444","session_id":"130c77e4-1fdf-446d-9f6a-512535b5ce31","userType":"external","entrypoint":"cli","cwd":"/home/greg/code/spideryarn2","sessionId":"130c77e4-1fdf-446d-9f6a-512535b5ce31","version":"2.1.263","gitBranch":"dev"}
{"parentUuid":"b9cb19a9-fa9f-4108-8f6f-f3cfae2ac484","isSidechain":false,"promptId":"c30f4b77-d037-4350-be5a-fc1228e03794","type":"user","message":{"role":"user","content":[{"tool_use_id":"toolu_01TLoqQhPm3ttkdcoVmHmC3g","type":"tool_result","content":"usage: npx tsx scripts/plan-name.ts [--dir=plans|research|postmortems|tutorials] <description of the work>","is_error":false}]},"uuid":"535e7b4c-c847-447a-953b-3e86579b8e14","timestamp":"2026-09-07T01:11:52.828Z","toolUseResult":{"stdout":"usage: npx tsx scripts/plan-name.ts [--dir=plans|research|postmortems|tutorials] <description of the work>","stderr":"","interrupted":false,"isImage":false,"noOutputExpected":false},"sourceToolAssistantUUID":"b9cb19a9-fa9f-4108-8f6f-f3cfae2ac484","session_id":"130c77e4-1fdf-446d-9f6a-512535b5ce31","userType":"external","entrypoint":"cli","cwd":"/home/greg/code/spideryarn2/.claude/worktrees/upload-html-file","sessionId":"130c77e4-1fdf-446d-9f6a-512535b5ce31","version":"2.1.263","gitBranch":"worktree-upload-html-file"}
{"parentUuid":"2314daaa-5ffd-41b4-902e-9f00299b6cdb","isSidechain":false,"promptId":"c30f4b77-d037-4350-be5a-fc1228e03794","type":"user","message":{"role":"user","content":[{"tool_use_id":"toolu_01MMmjLT22zBwGN4cQyWpEk1","type":"tool_result","content":"---\nugrep: warning: supabase/migrations/: No such file or directory","is_error":false}]},"uuid":"584ae38f-b439-490b-9d23-474761b5baf7","timestamp":"2026-09-07T01:13:27.839Z","toolUseResult":{"stdout":"---\nugrep: warning: supabase/migrations/: No such file or directory","stderr":"","interrupted":false,"isImage":false,"noOutputExpected":false},"sourceToolAssistantUUID":"2314daaa-5ffd-41b4-902e-9f00299b6cdb","session_id":"130c77e4-1fdf-446d-9f6a-512535b5ce31","userType":"external","entrypoint":"cli","cwd":"/home/greg/code/spideryarn2/.claude/worktrees/upload-html-file","sessionId":"130c77e4-1fdf-446d-9f6a-512535b5ce31","version":"2.1.263","gitBranch":"worktree-upload-html-file"}
{"parentUuid":"80e19c8a-07b7-44f2-b72d-f000f014a750","isSidechain":false,"promptId":"c30f4b77-d037-4350-be5a-fc1228e03794","type":"user","message":{"role":"user","content":[{"tool_use_id":"toolu_01CbfPxT56XsuPX54GixAaPG","type":"tool_result","content":"drizzle\nsupabase/config.toml\ndrizzle/0014_uploads_and_job_work_key.sql\nsrc/source.ts\ntests/db-schema.test.ts\nsrc/db/schema.ts","is_error":false}]},"uuid":"ca3d6fbd-4d6f-41a0-9759-48a5f78f2b2d","timestamp":"2026-09-07T01:13:30.550Z","toolUseResult":{"stdout":"drizzle\nsupabase/config.toml\ndrizzle/0014_uploads_and_job_work_key.sql\nsrc/source.ts\ntests/db-schema.test.ts\nsrc/db/schema.ts","stderr":"","interrupted":false,"isImage":false,"noOutputExpected":false},"sourceToolAssistantUUID":"80e19c8a-07b7-44f2-b72d-f000f014a750","session_id":"130c77e4-1fdf-446d-9f6a-512535b5ce31","userType":"external","entrypoint":"cli","cwd":"/home/greg/code/spideryarn2/.claude/worktrees/upload-html-file","sessionId":"130c77e4-1fdf-446d-9f6a-512535b5ce31","version":"2.1.263","gitBranch":"worktree-upload-html-file"}
{"parentUuid":"b42728b8-c075-448e-83b6-3572585a41ba","isSidechain":false,"promptId":"c30f4b77-d037-4350-be5a-fc1228
```

## How to report

One numbered finding per issue, each with: severity (P0 blocks the commit / P1 should be
fixed now / P2 worth noting), the file and line, the concrete failure — inputs and state that
produce the wrong output — and the smallest fix. If a finding is a judgement call rather than
a defect, say so. If you find nothing at a severity, say that explicitly rather than padding.

END YOUR ANSWER WITH A ONE-LINE VERDICT: whether this should be committed as-is, committed
with named fixes, or reworked.
