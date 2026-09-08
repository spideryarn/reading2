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
import { createHash } from "node:crypto";
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
 * The two windows stable enough to branch on, as a runtime value.
 *
 * A `Record<KnownUsageWindow, true>` RATHER THAN AN ARRAY, and that is the
 * whole point: an array typed `readonly KnownUsageWindow[]` does NOT fail to
 * compile when wire.ts's union grows a member the array is missing — it only
 * rejects members the union does not have. This file claimed otherwise until
 * GPT Sol checked it (finding 8, 2026-09-08). A record's keys are checked in
 * both directions, so a name added to the union and not here, or here and not
 * in the union, is a compile error.
 */
const KNOWN_USAGE_WINDOW_SET: Record<KnownUsageWindow, true> = { five_hour: true, seven_day: true };

export const KNOWN_USAGE_WINDOWS: readonly KnownUsageWindow[] = Object.keys(
  KNOWN_USAGE_WINDOW_SET,
) as KnownUsageWindow[];

export function isKnownUsageWindow(w: UsageWindowName): w is KnownUsageWindow {
  return Object.hasOwn(KNOWN_USAGE_WINDOW_SET, w);
}

/**
 * The longest window a rejection can still be inside.
 *
 * `seven_day` is the longest Anthropic operates, so a rejection older than this
 * has necessarily reset. It is what makes an mtime-bounded scan able to be
 * CONCLUSIVE: a transcript holding an unexpired hit was written no earlier than
 * that hit, so a window at least this long cannot miss one.
 */
export const LONGEST_ACTIVE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The default mtime window: the longest active window plus a day of margin for
 * clock skew and timezone edges.
 *
 * COSTS ~34s AND 2.9 GB ON THIS BOX, measured 2026-09-08 over 1,766 transcripts
 * and 866,185 lines. That is deliberate. It was 24h — ~240 files and 2-10s —
 * until GPT Sol pointed out (finding 2) that an unexpired `seven_day` rejection
 * two days old sits in a file the 24h window excludes, so the scan returned
 * `none` and the verdict `ok` for an account that was in fact limited. A cheap
 * answer that can be wrong in the calm direction is the thing this module
 * exists to refuse, so the default buys the conclusive answer and a caller who
 * wants the cheap one passes a shorter `sinceMs` and gets `unknown` rather than
 * a false `none`.
 */
export const DEFAULT_SINCE_MS = 8 * 24 * 60 * 60 * 1000;

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
 * The stable id for one rejection — see `RateLimitHit.id` in wire.ts.
 *
 * A hash rather than the composed string itself, because the composed string
 * contains an absolute filesystem path and the id is carried into a store and
 * onto a page, where the path has no business being (the dashboard declined
 * `transcriptPath` for exactly that reason).
 *
 * DETERMINISTIC AND CONTENT-DERIVED — no clock, no counter, no randomness.
 * An undated rejection falls back to the literal `undated`, so two undated
 * rejections for the same window in the same transcript would collide; that is
 * accepted, because `classifyHit` refuses an undated rejection anyway (its
 * chronology cannot be checked), so neither could ever be carried forward as a
 * fact.
 */
export function rateLimitHitId(transcriptPath: string, hitAt: string | null, window: UsageWindowName): string {
  return createHash("sha256").update(`${transcriptPath}|${hitAt ?? "undated"}|${window}`).digest("hex").slice(0, 20);
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
    //
    // THIS MODULE PUBLISHES NO MONEY, DELIBERATELY. The window entries carry
    // `limit_dollars` / `used_dollars` / `remaining_dollars` (all null on this
    // account) and `extra_usage` carries `used_credits` and a monthly limit, and
    // none of it is read: the question here is headroom in a subscription
    // window, which is a percentage and a reset time. **If anyone later wants a
    // cost figure beside the utilisation, read `src/ai-spend.ts` first** — not
    // to import it (the fleet and Overseer tools must not depend on anything
    // under `src/`; see orchestrator-direction.md § Principles) but for the case
    // list, which is already paid for. Its trap is the same shape as the stale
    // `resets_at` this file exists to guard: on a BYOK key the gateway reports
    // `cost: 0` for a call that cost real money, the true figure is in
    // `cost_details.upstream_inference_cost`, and an "unpriced" counter stays at
    // zero because a cost DID arrive — it was just the wrong one. Reported by
    // `orchestrator-setup`, 2026-09-08.
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
  if (utilizationPercent < 0 || utilizationPercent > 100) {
    // The wire contract says 0-100 and nothing enforced it. GPT Sol's finding
    // 7: a `-1` sailed through as a `value` arm, which then counted as a usable
    // cached window, which then let the verdict be `ok` on the strength of a
    // number that cannot mean anything.
    return {
      kind: "unknown",
      window,
      why: `utilization was ${utilizationPercent}, which is outside 0-100 — a percentage that cannot mean anything must not be reported as one`,
    };
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

  // ONLY AN EXPLICIT `false` IS "LOGGED OUT". `!== true` used to be the test,
  // which made `{}`, a renamed key and a wrongly-typed field all report
  // confidently that nobody is signed in — GPT Sol's finding 6. "Logged out" is
  // an ANSWER; not recognising the output is a FAILURE, and this module's whole
  // rule is that those must not render alike.
  if (a["loggedIn"] === false) {
    return { kind: "logged-out", projectsDirectory: str(a["projectsDirectory"]) };
  }
  if (a["loggedIn"] !== true) {
    return {
      kind: "unknown",
      why: `claude auth status printed JSON with no usable loggedIn boolean (got ${JSON.stringify(a["loggedIn"])}) — the output shape has changed, which is not the same as being logged out`,
    };
  }

  const oauth = obj(obj(claudeJson)?.["oauthAccount"]) ?? {};
  const email = str(a["email"]);
  const orgId = str(a["orgId"]);
  const accountUuid = str(oauth["accountUuid"]);
  const organizationUuid = str(oauth["organizationUuid"]);

  // An account with no identity at all is not an account we can attribute a
  // reading to, and `{ loggedIn: true }` alone used to produce a `value` arm
  // with every field null — which downstream reads as "we know who this is".
  if (email === null && orgId === null) {
    return {
      kind: "unknown",
      why: "claude auth status says logged in but carried neither an email nor an orgId — nothing here identifies the account a reading would belong to",
    };
  }
  // THE TWO SOURCES MUST BE POSITIVELY LINKED BEFORE THEIR FIELDS ARE MERGED.
  //
  // This ran only when BOTH org ids existed, which is the same logical error
  // for the third time in one day: current auth with `orgId: "NEW-ORG"` beside
  // stale OAuth data carrying `accountUuid: "OLD-ACCOUNT"` and no
  // `organizationUuid` produced a `value` account holding OLD-ACCOUNT — and a
  // cache for that uuid could then raise `approaching` or judge a rejection.
  // GPT Sol's round-2 finding 5, and its words are the ones worth keeping:
  // *"not observed to disagree is being treated as positive agreement."*
  //
  // So the OAuth-derived fields survive only on a proven link. The auth identity
  // (email, orgId, subscription) is still reported, because `auth status` said
  // it directly; what is dropped is everything inferred from a file that cannot
  // be shown to describe the same organisation.
  const linked = orgId !== null && organizationUuid !== null && orgId === organizationUuid;
  if (orgId !== null && organizationUuid !== null && !linked) {
    return {
      kind: "unknown",
      why: `claude auth status says org ${orgId} but ~/.claude.json's .oauthAccount says ${organizationUuid} — the config is stale relative to the login, so its accountUuid cannot be used to attribute a reading`,
    };
  }

  return {
    kind: "value",
    email,
    orgId,
    orgName: str(a["orgName"]),
    subscriptionType: str(a["subscriptionType"]),
    // Null unless the link is proven. A null `accountUuid` makes `attributeCache`
    // refuse, which is the honest outcome: we know who is logged in, and we
    // cannot show that this config describes them.
    accountUuid: linked ? accountUuid : null,
    rateLimitTier: linked ? str(oauth["organizationRateLimitTier"]) : null,
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

  // THE REJECTION SIGNAL IS WHAT MAKES A RECORD INTERESTING, not the quota
  // object — and that ordering is GPT Sol's finding 4. Testing for
  // `quotaLimits` first meant a rejection that had merely MOVED or RENAMED its
  // quota object came back `not-a-hit`, indistinguishable from an ordinary
  // line, and the scan would have reported a confident "none".
  //
  // 429 OR the literal error string, and `isApiErrorMessage` is deliberately
  // NOT in that OR: it marks any API error, so including it promoted a generic
  // failure carrying a `quotaLimits { status: "allowed" }` into a rate-limit
  // hit and could produce LIMITED (Sol's finding 5). It is kept below only to
  // decide whether an unreadable record is drift worth shouting about.
  const status429 = num(rec["apiErrorStatus"]) === 429 || num(msg?.["apiErrorStatus"]) === 429;
  const errRateLimit = rec["error"] === "rate_limit" || msg?.["error"] === "rate_limit";
  const isApiError = rec["isApiErrorMessage"] === true || msg?.["isApiErrorMessage"] === true;
  const rejected = status429 || errRateLimit;

  const q = obj(rec["quotaLimits"]) ?? obj(msg?.["quotaLimits"]);
  if (!rejected) {
    if (!q) {
      // An ordinary line — including one that merely mentions these keys, which
      // every transcript of an agent reading this file now does.
      return { kind: "not-a-hit" };
    }
    // A QUOTA OBJECT THAT SAYS `rejected` IS A REJECTION, whatever the outer
    // fields say. GPT Sol's round-2 finding 4: a complete quota object with
    // `status: "rejected"` came back `no-error-signal`, which `absenceGap` does
    // not treat as a gap, so renaming or dropping the two outer fields would
    // have failed quietly even though the record says plainly that it was
    // refused. Malformed, so the absence cannot be trusted.
    if (q["status"] === "rejected") {
      return {
        kind: "malformed",
        why: `a quotaLimits object in ${transcriptPath} says status "rejected" but the record carries neither apiErrorStatus 429 nor error "rate_limit" — the outer rejection fields have changed shape`,
      };
    }
    // A genuine `status: "allowed"` report. Not a refusal, and not drift.
    return { kind: "no-error-signal" };
  }
  if (q && q["status"] !== undefined && q["status"] !== "rejected") {
    // The other half of the same finding: an outer rejection paired with a quota
    // object that says it was allowed. One of the two is lying and this scan
    // cannot tell which, so it must not silently become a hit.
    return {
      kind: "malformed",
      why: `a record in ${transcriptPath} carries an outer rejection signal but a quotaLimits status of ${JSON.stringify(q["status"])} — the two disagree and this scan cannot tell which is right`,
    };
  }
  if (!q) {
    return {
      kind: "malformed",
      why: `a rejection in ${transcriptPath} (status ${JSON.stringify(rec["apiErrorStatus"] ?? msg?.["apiErrorStatus"])}, error ${JSON.stringify(rec["error"] ?? msg?.["error"])}) carried no quotaLimits object at the top level or under message — the record shape has changed and this scan can no longer read when the window resets`,
    };
  }

  const window = str(q["rateLimitType"]);
  const resetsAtMs = resetsAtToMs(q["resetsAt"]);
  if (window === null || resetsAtMs === null) {
    return {
      kind: "malformed",
      why: `a rate-limit record in ${transcriptPath}${isApiError ? "" : " (not even flagged isApiErrorMessage)"} had quotaLimits but rateLimitType=${JSON.stringify(q["rateLimitType"])} resetsAt=${JSON.stringify(q["resetsAt"])} — the shape has changed`,
    };
  }

  const hitAt = str(rec["timestamp"]);
  const hitAtMs = hitAt !== null && Number.isFinite(Date.parse(hitAt)) ? Date.parse(hitAt) : null;
  const content = msg?.["content"];
  const firstText = Array.isArray(content) ? str(obj(content[0])?.["text"]) : null;

  return {
    kind: "hit",
    hit: {
      // Content-derived, so scanning the same transcript twice yields the same
      // id and a store can recognise a rejection it already knows about.
      id: rateLimitHitId(transcriptPath, hitAt, window),
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
  const gap = absenceGap(coverage);
  if (hits.length > 0) {
    // Newest first, so a caller taking [0] gets the most recent rejection.
    //
    // NOTE THAT `hits` IS RETURNED EVEN WHEN COVERAGE IS INCOMPLETE. What was
    // found was found; the incompleteness lives in `coverage` and is the
    // CALLER's to respect when it wants to conclude an ABSENCE. It used to
    // short-circuit here before the completeness checks, so a scan holding one
    // long-expired hit and one unreadable rate-limit record returned `hits` and
    // the verdict then read "nothing in force" off it — GPT Sol's finding 3,
    // third path. `absenceIsConclusive` is exported for exactly this reason.
    const sorted = [...hits].sort((a, b) => (b.hitAtMs ?? 0) - (a.hitAtMs ?? 0));
    return { kind: "hits", hits: sorted, coverage };
  }
  if (gap !== null) return { kind: "unknown", why: gap, coverage };
  return { kind: "none", coverage };
}

/**
 * Why an absence of hits in this scan cannot be believed, or null if it can.
 *
 * ONE PREDICATE, USED EVERYWHERE AN ABSENCE IS CONCLUDED — the verdict, the
 * per-conversation answer, and `summariseRateLimitScan` itself. It was three
 * separate ad-hoc tests, and GPT Sol found three ways past them (finding 3):
 * one readable benign transcript alongside any number of unreadable ones
 * returned `none`; one parsed candidate alongside one unparsed one returned
 * `none` because only "ALL candidates unparsed" was rejected; and a known
 * expired hit short-circuited the malformed check entirely.
 *
 * The mtime clause is finding 2: a scan bounded to less than the longest
 * window can miss a rejection that is still in force, so its silence is
 * partial by construction, however healthy its counts look.
 */
export function absenceGap(coverage: ScanCoverage): string | null {
  if (coverage.transcriptsOpened === 0) {
    return `no transcript was opened (found ${coverage.transcriptsFound}, selected ${coverage.transcriptsSelected}, unreadable ${coverage.transcriptsUnreadable}${coverage.unreadableWhy.length > 0 ? `: ${coverage.unreadableWhy.join("; ")}` : ""}) — this says nothing about whether a limit was hit`;
  }
  if (coverage.linesScanned === 0) {
    return `opened ${coverage.transcriptsOpened} transcript(s) but read 0 lines — nothing was actually examined`;
  }
  if (coverage.transcriptsUnreadable > 0) {
    return `${coverage.transcriptsUnreadable} transcript(s) could not be read${coverage.unreadableWhy.length > 0 ? ` (${coverage.unreadableWhy.slice(0, 2).join("; ")})` : ""} — any one of them could hold the rejection that is in force`;
  }
  if (coverage.candidateLines > coverage.linesParsed) {
    // MEASURED BEFORE BEING TIGHTENED, because the comment here used to excuse
    // this as normal ("a live session's final line can be half-written"): a
    // full pass over 1,766 transcripts and 866,185 lines on 2026-09-08 found
    // 267 candidate lines and ZERO that failed to parse. So it is not routine,
    // and treating it as routine was a guess that would have hidden real drift.
    return `${coverage.candidateLines - coverage.linesParsed} of ${coverage.candidateLines} candidate line(s) did not parse as JSON — a full pass over this box found zero such lines, so this is drift rather than a half-written record`;
  }
  if (coverage.malformedCandidates > 0) {
    return `${coverage.malformedCandidates} record(s) looked like rate-limit rejections and could not be read — the transcript shape has probably changed, so an absence of hits cannot be trusted`;
  }
  if (coverage.truncatedByLimit) {
    return `the scan stopped at ${coverage.transcriptsSelected} of ${coverage.transcriptsFound} transcripts, so it did not look everywhere a rejection could be`;
  }
  if (coverage.sinceMs !== null && coverage.sinceMs < LONGEST_ACTIVE_WINDOW_MS) {
    return `the scan only covered transcripts modified in the last ${Math.round(coverage.sinceMs / 3600_000)}h, and a seven-day rejection can still be in force ${Math.round(LONGEST_ACTIVE_WINDOW_MS / 3600_000)}h after the transcript holding it was last written`;
  }
  return null;
}

/** The readable half of `absenceGap`, for a caller that only wants the boolean. */
export function absenceIsConclusive(coverage: ScanCoverage): boolean {
  return absenceGap(coverage) === null;
}

/**
 * Two instants for the same window are the same window if they are within this
 * of each other.
 *
 * **DO NOT "TIDY" THIS TO AN EXACT COMPARISON.** The two sides genuinely
 * disagree on precision: the cache carries sub-second ISO
 * (`2026-09-15T04:59:59.790550+00:00`) and a transcript's `resetsAt` is a whole
 * unix second (`1789236000`). Exact equality would call one window two, and
 * every rejection would then be unattributable — which fails in the
 * safe-looking direction, so nothing would go red and nobody would notice.
 *
 * ONE SECOND, WHICH IS EXACTLY WHAT THE FORMATS JUSTIFY. It was two minutes,
 * then five seconds, on the argument that a tight bound manufactures false
 * ambiguity. GPT Sol pointed out that argument only looks one way: a wide bound
 * manufactures false ATTRIBUTION, and two accounts whose reset instants happen
 * to fall four seconds apart would be treated as one window and could produce
 * `limited`. Whole seconds against milliseconds cannot differ by more than 1s,
 * so anything beyond that is a bound with no evidence behind it.
 */
const SAME_WINDOW_TOLERANCE_MS = 1000;

/**
 * Everything needed before one rejection can be compared against the cache at
 * all — i.e. before the comparison means anything.
 *
 * THIS EXISTS BECAUSE "NOT PROVEN TO BE SOMEBODY ELSE'S" IS NOT "PROVEN TO BE
 * OURS". The first version treated any cache that had not been positively
 * identified as another account's as this account's, so with `claude auth
 * status` failing — or either uuid simply absent — an unattributed cache could
 * still disqualify a real rejection and the verdict came back `ok`. GPT Sol's
 * finding 1, and it is the same shape as everything else here: an absence of
 * contradiction read as a positive fact.
 */
export type CacheAttribution =
  | { kind: "attributed"; cache: UsageCacheReading & { kind: "value" } }
  | { kind: "cannot-attribute"; why: string };

/**
 * Can this cache be used to reason about this account's rejections?
 *
 * Every clause is a thing that must be POSITIVELY TRUE, not merely
 * un-contradicted: the account was read, both sides name an account, they name
 * the same one, and the cache was fetched after the rejection it is being used
 * to judge (a cache older than a rejection describes a window that may have
 * rolled since).
 */
export function attributeCache(
  account: UsageAccount,
  cache: UsageCacheReading,
  /**
   * The rejection being judged, or null for the whole-cache question ("may this
   * cache's percentages colour the verdict at all"). A per-rejection caller
   * MUST pass one: a rejection with no timestamp cannot have its chronology
   * checked, and `classifyHit` refuses it rather than letting it through.
   */
  hitAtMs: number | null,
): CacheAttribution {
  if (cache.kind !== "value") return { kind: "cannot-attribute", why: `the cached utilisation could not be read: ${cache.why}` };
  if (account.kind === "logged-out") return { kind: "cannot-attribute", why: "nobody is logged in, so there is no account to attribute a cache to" };
  if (account.kind !== "value") return { kind: "cannot-attribute", why: `the logged-in account could not be established: ${account.why}` };
  // I CALLED THIS AN EQUIVALENT MUTANT AND WAS WRONG — worth leaving as a note,
  // because the mistake is this file's own recurring theme.
  //
  // The claim was: deleting this line changes nothing, since the uuid-inequality
  // check below rejects a null on either side anyway. I verified that across all
  // six null/non-null combinations — and only checked the `kind`. GPT Sol's
  // round-2 finding 9: the `why` differs, which is the half a person reads. With
  // a non-null cache uuid the message becomes a mismatch against `null`, and
  // with both null it blames the cache for the account's missing field. So the
  // branch is not redundant, it is a more precise diagnostic, and it is tested
  // as one.
  //
  // The shape of the error: I confirmed equivalence of the DISCRIMINATOR and
  // claimed equivalence of the VALUE. A check that answers a weaker question
  // than the one asked.
  if (account.accountUuid === null) return { kind: "cannot-attribute", why: "the logged-in account has no accountUuid in ~/.claude.json's .oauthAccount" };
  if (cache.accountUuid === null) return { kind: "cannot-attribute", why: "the cached utilisation carries no accountUuid, so there is nothing to match it against" };
  if (cache.accountUuid !== account.accountUuid) {
    return {
      kind: "cannot-attribute",
      why: `the cached utilisation belongs to account ${cache.accountUuid} and the logged-in account is ${account.accountUuid} — probably a /login swap since the cache was written`,
    };
  }
  // STRICTLY AFTER, AND A TIMESTAMP IS REQUIRED. `hitAtMs !== null && …` let a
  // rejection with no timestamp through, and `<` let a cache fetched in the
  // same millisecond through — two more "not observed to be wrong" holes, GPT
  // Sol's round-2 finding 1. `hitAtMs === null` is passed only by the
  // whole-cache question, which has no rejection in hand; per-rejection callers
  // always have one.
  if (hitAtMs !== null && cache.fetchedAtMs <= hitAtMs) {
    return {
      kind: "cannot-attribute",
      why: `the cache was fetched at ${new Date(cache.fetchedAtMs).toISOString()}, not after this rejection at ${new Date(hitAtMs).toISOString()} — a snapshot no newer than the rejection cannot say whether it is this account's`,
    };
  }
  return { kind: "attributed", cache };
}

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
 * WHAT THIS ESTABLISHES IS AN AMBIGUITY, NOT AN ATTRIBUTION, and the first
 * version of it overreached. One account has exactly one current window per
 * name, so a live cached window and an in-force rejection for that name cannot
 * both describe it — that much is a contradiction and is certain. What is NOT
 * certain is *which* of the two is foreign: a previous account is far and away
 * the likeliest explanation, but these are undocumented fields with no
 * stability contract, and a reset recalculation or some other same-account
 * state change cannot be ruled out. GPT Sol, 2026-09-08: *"Cache disagreement
 * is not proof that a rejection belongs to another account."*
 *
 * So a contradicted rejection is **neither counted as in force nor dismissed**.
 * It makes the verdict `unknown` and the per-conversation answer
 * `cannot-tell`, carrying both observations and naming the previous-account
 * explanation as likely. The first version silently discarded it and returned
 * `ok`, which is the same defect this module exists to prevent, merely aimed in
 * the other direction: turning an ambiguity into a confident negative.
 *
 * THIS IS AN ATTRIBUTION PROBLEM, NOT A CREDIBILITY CONTEST, and the
 * distinction is the answer to the obvious objection that a hint must not
 * overrule ground truth. The dashboard session, 2026-09-08: a 429 is ground
 * truth about a FACT — some account hit a limit, and here is when its window
 * resets — and it is not evidence about WHOSE account, because it carries no
 * account id at all. The cache is the only artefact on this box carrying
 * `accountUuid`. So the cache is not outranking the measurement; it is supplying
 * the one field the measurement is missing.
 *
 * That reframe is right and it is why the comparison is legitimate at all. It
 * does NOT license concluding the answer, though, which is where the first
 * version went wrong: the only source that could attribute the rejection is
 * absent, so the honest output is "cannot attribute", not "attributed
 * elsewhere". `attributeCache` above is what makes the comparison meaningful
 * when it runs, and refuses to run it when it would not be.
 *
 * Only a cached window on the `value` arm can do this — an expired or unknown
 * cached window describes nothing and cannot contradict anything.
 *
 * THE CALLER MUST DISCARD EXPIRED REJECTIONS TOO. See `WINDOW ROLLOVER` inside
 * `computeUsageVerdict`: there is one legitimate case where the same account's
 * cache and one of its own rejections disagree, and it is only out of reach
 * because such a rejection has necessarily already expired. This function
 * misjudges that case in isolation and a test asserts that it does — the
 * precondition belongs to the caller, and "fixing" it in here (by, say,
 * accepting any hit that resets before the cached window does) breaks the
 * foreign-account case this exists for. Mutation-checked, both ways.
 */
export type HitAttribution =
  /** The cache confirms it: same account, same window, same reset instant. Ground truth we can act on. */
  | { kind: "ours" }
  /** The cache contradicts it. Neither in force nor dismissed — see above. */
  | { kind: "contradicted"; why: string }
  /** The comparison could not be made at all. NOT the same as "no contradiction". */
  | { kind: "cannot-attribute"; why: string };

/**
 * Classify one rejection against the cache: ours, contradicted, or unattributable.
 *
 * THREE ARMS, BECAUSE TWO WAS THE SAME BUG ONE LEVEL UP. This returned
 * `string | null` until GPT Sol's round-2 finding 1, and `null` meant BOTH "the
 * two observations agree" and "the comparison was impossible" — so unknown auth
 * plus an unreadable cache plus some old account's unexpired rejection came out
 * as `LIMITED`, and the ambiguity recorded alongside could not overturn it
 * because `limited` outranks doubt. **A test pinned that behaviour**, which is
 * the part worth remembering: I had written the round-1 fix, understood the
 * principle, and then re-made the identical mistake in the function that
 * implements it — "not proven to be somebody else's" read as "proven to be
 * ours", at the level of a single rejection instead of a whole cache.
 *
 * `ours` is now a POSITIVE finding and the only arm that lets a rejection set
 * the verdict to `limited`.
 */
export function classifyHit(hit: RateLimitHit, account: UsageAccount, cache: UsageCacheReading): HitAttribution {
  if (hit.hitAtMs === null) {
    return { kind: "cannot-attribute", why: "this rejection carries no timestamp, so the cache's chronology cannot be checked against it" };
  }
  const attribution = attributeCache(account, cache, hit.hitAtMs);
  if (attribution.kind !== "attributed") return { kind: "cannot-attribute", why: attribution.why };
  const cached = attribution.cache.windows.find((w) => w.window === hit.window);
  if (cached === undefined) {
    return { kind: "cannot-attribute", why: `the cache has no ${hit.window} window to compare this rejection against` };
  }
  if (cached.kind !== "value") {
    return {
      kind: "cannot-attribute",
      why: `the cached ${hit.window} window is not a usable reading (${cached.kind === "expired" ? cached.why : cached.why})`,
    };
  }
  if (Math.abs(cached.resetsAtMs - hit.resetsAtMs) <= SAME_WINDOW_TOLERANCE_MS) return { kind: "ours" };
  return {
    kind: "contradicted",
    why: `this ${hit.window} rejection says the window resets at ${new Date(hit.resetsAtMs).toISOString()}, but the logged-in account's own cache — fetched after it, and carrying the same accountUuid — says its ${hit.window} window is ${cached.utilizationPercent}% used and resets at ${cached.resetsAt}. One account has one current ${hit.window} window, so these two cannot both describe it. The likeliest explanation by far is that the rejection belongs to an account that has since been swapped out with /login, because a transcript 429 carries no account id at all — but that is an explanation, not a proof, so this rejection is neither counted as in force nor dismissed`,
  };
}

/**
 * Kept as the narrow question "do these two disagree", for a caller that only
 * wants the sentence. **Do not use it to decide whether a rejection is in
 * force** — `null` here still means "not contradicted", which includes "could
 * not compare". `classifyHit` is the one that distinguishes them.
 */
export function contradictsCachedWindow(hit: RateLimitHit, account: UsageAccount, cache: UsageCacheReading): string | null {
  const c = classifyHit(hit, account, cache);
  return c.kind === "contradicted" ? c.why : null;
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
   * can be set aside — see `contradictsCachedWindow`.
   *
   * REQUIRED, NOT OPTIONAL, and that is the point. It was optional for about an
   * hour, and the dashboard session — which had just spent a day removing
   * sixteen cases of a producer being careful and a consumer not having to be —
   * asked for it to be required instead: *"an optional parameter whose omission
   * silently produces a wrong answer is the shape this module spent 2026-09-08
   * removing… I would rather not be trusted here."* It is right. Omitting it
   * would put a red "rate limited" badge on rows that are working fine, and a
   * required parameter makes that a compile error instead. Pass
   * `report.cache` verbatim; an `unknown` cache is a perfectly good argument
   * and disqualifies nothing.
   */
  cache: UsageCacheReading,
  /**
   * The logged-in account. REQUIRED for the same reason `cache` is: without it
   * the cache cannot be attributed, and an unattributed cache used to be able
   * to disqualify a live rejection. GPT Sol's finding 1 — `latestHitForConversation`
   * was the worse of the two call sites, because it took the cache without the
   * account at all, so after a `/login` swap a previous account's cache could
   * silently clear a current account's rejection.
   */
  account: UsageAccount,
): ConversationRateLimit {
  if (scan.kind === "unknown") return { kind: "cannot-tell", why: scan.why };
  const hits = scan.kind === "hits" ? scan.hits : [];
  const mine = hits.filter((h) => h.claudeSessionId === claudeSessionId);
  // EXPIRY FIRST, and here the order genuinely matters now that a contradiction
  // no longer removes a rejection but promotes it to an ambiguity. A rolled-over
  // rejection (see WINDOW ROLLOVER in `computeUsageVerdict`) legitimately
  // disagrees with this account's own cache, and it is only harmless because it
  // has already expired — so it must be discarded as expired BEFORE anything
  // asks whether it contradicts the cache, or a conversation whose limit lapsed
  // hours ago would report `cannot-tell` for a week.
  const unexpired = mine.filter((h) => h.resetsAtMs > nowMs);
  const doubts: string[] = [];
  const ours: RateLimitHit[] = [];
  for (const h of unexpired) {
    const c = classifyHit(h, account, cache);
    if (c.kind === "ours") ours.push(h);
    else doubts.push(c.why);
  }

  // AN INCOMPLETE SCAN MAY NOT NAME THE BINDING REJECTION. GPT Sol's round-2
  // finding 2: with one known five-hour rejection and an unreadable transcript
  // that might hold a later seven-day one, returning the five-hour hit tells the
  // page work resumes hours before it does. Being limited is still true; WHICH
  // limit is not established.
  const gap = absenceGap(scan.coverage);
  if (ours.length > 0 && gap !== null) {
    return {
      kind: "cannot-tell",
      why: `a ${ours[0]?.window ?? "rate"} rejection is in force for this conversation, but the scan cannot say which one frees up last: ${gap}`,
    };
  }
  // The one that frees up LAST is the one that actually gates this conversation.
  ours.sort((a, b) => b.resetsAtMs - a.resetsAtMs);
  const binding = ours[0];
  if (binding !== undefined) return { kind: "hit", hit: binding };

  const firstDoubt = doubts[0];
  if (firstDoubt !== undefined) {
    // Neither in force nor dismissed. Reporting `none` here is what round-1
    // finding 1 was about, and reporting `hit` is what round-2 finding 1 was.
    return { kind: "cannot-tell", why: firstDoubt };
  }
  if (mine.length === 0 && gap !== null) {
    // We saw nothing for this conversation. Whether that means anything depends
    // entirely on whether the scan was in a position to see it, which is one
    // question with one answer, asked in one place.
    return { kind: "cannot-tell", why: `${gap} — and none of what it did read belonged to this conversation` };
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
   * Is this cache positively this account's? Decided once, because both halves
   * below need the same answer — and decided by `attributeCache`, which
   * requires every clause to be TRUE rather than merely un-contradicted. The
   * `hitAtMs` argument is null here because this is the whole-cache question;
   * the per-rejection question re-asks it with the rejection's own timestamp.
   */
  const attribution = attributeCache(input.account, input.cache, null);

  /**
   * A contradicted rejection is neither in force nor dismissed, so it has to
   * make the answer LESS certain rather than more. Collected here and applied
   * after both halves have had their say.
   */
  const ambiguities: string[] = [];

  // (b) Ground truth first.
  if (input.rateLimits.kind === "hits") {
    /**
     * WINDOW ROLLOVER, AND WHY THE ORDER OF THESE TWO FILTERS IS LOAD-BEARING.
     *
     * Expiry is filtered FIRST, and `contradictsCachedWindow` only ever sees
     * what survives. That is not incidental tidiness — it is the whole reason
     * the contradiction rule is safe.
     *
     * There is exactly one case where the same account's cache and one of its
     * own rejections legitimately disagree on a reset instant: the window rolled
     * over in between. A `five_hour` rejection at 06:02 naming `resetsAt` 06:30,
     * with the cache fetched at 06:35, shows that same account's `five_hour`
     * window resetting at 11:30. Two reset instants two minutes apart are
     * impossible for one account; five hours apart are ordinary. Handed to
     * `contradictsCachedWindow`, that rejection would be discarded as another
     * account's — wrongly.
     *
     * It cannot happen here, because a rolled-over rejection has necessarily
     * ALREADY EXPIRED (its window ended before the cache's did, and the cache's
     * has not ended yet), so the expiry filter removes it first and the
     * contradiction check never sees it. Every rejection that reaches
     * `contradictsCachedWindow` describes a window that is still open, and for
     * one account a window that is still open is THE current window — so it
     * must agree with a live cached one.
     *
     * SO: DO NOT REORDER THESE, and do not relax the expiry test into the same
     * pass. Spotted by the dashboard session, 2026-09-08, before it could
     * happen; tests/overseer-usage.test.ts pins the order rather than the
     * outcome, by asserting which of the two counts a rolled-over rejection
     * lands in.
     */
    const unexpired = input.rateLimits.hits.filter((h) => h.resetsAtMs > input.nowMs);
    // A rejection contradicting this account's own live cache is an AMBIGUITY,
    // not an attribution — see `contradictsCachedWindow`. It is neither counted
    // as in force nor dismissed, and it drags the verdict to `unknown`.
    // THREE OUTCOMES PER REJECTION, not two. Only `ours` — a positive
    // confirmation from an attributable cache — may set `limited`. Both other
    // arms raise doubt. See `classifyHit`.
    const contradicted: { hit: RateLimitHit; why: string }[] = [];
    const unattributable: { hit: RateLimitHit; why: string }[] = [];
    const ours: RateLimitHit[] = [];
    for (const h of unexpired) {
      const c = classifyHit(h, input.account, input.cache);
      if (c.kind === "ours") ours.push(h);
      else if (c.kind === "contradicted") contradicted.push({ hit: h, why: c.why });
      else unattributable.push({ hit: h, why: c.why });
    }
    const firstContradiction = contradicted[0];
    if (firstContradiction !== undefined) {
      ambiguities.push(
        `${contradicted.length} unexpired rejection(s) contradict the logged-in account's own cache and cannot be attributed either way: ${firstContradiction.why}`,
      );
    }
    const firstUnattributable = unattributable[0];
    if (firstUnattributable !== undefined) {
      ambiguities.push(
        `could not check whether ${unattributable.length} unexpired rejection(s) belong to the logged-in account — a transcript 429 carries no account id, and ${firstUnattributable.why}`,
      );
    }

    const gap = absenceGap(input.rateLimits.coverage);
    // The one that frees up last is the one that actually gates work.
    ours.sort((a, b) => b.resetsAtMs - a.resetsAtMs);
    const binding = ours[0];
    if (binding !== undefined) {
      level = "limited";
      if (gap === null) {
        activeLimit = binding;
        reasons.push(
          `a real ${binding.window} rejection is still in force — hit at ${binding.hitAt ?? "an unknown time"}, resets at ${new Date(binding.resetsAtMs).toISOString()}${binding.claudeSessionId ? ` (conversation ${binding.claudeSessionId})` : ""}`,
        );
      } else {
        // Limited is established; WHICH limit is not. Naming this one as
        // `activeLimit` would tell the page work resumes at its reset when a
        // transcript the scan could not read may hold a later one. GPT Sol's
        // round-2 finding 2.
        activeLimit = null;
        reasons.push(
          `a real ${binding.window} rejection is still in force (resets at ${new Date(binding.resetsAtMs).toISOString()} at the earliest), but the scan cannot establish which rejection frees up last, so no reset time is claimed: ${gap}`,
        );
      }
    } else {
      // Spell out WHICH reason applies to how many. "all of them already reset"
      // was wrong the first time it printed on this box: 25 of the 54 had not
      // reset, they were unattributable.
      const expired = input.rateLimits.hits.length - unexpired.length;
      const unresolved = contradicted.length + unattributable.length;
      reasons.push(
        `${input.rateLimits.hits.length} rate-limit rejection(s) found, none of them confirmed in force for this account (${expired} already reset${unresolved > 0 ? `, ${unresolved} unattributable` : ""})`,
      );
      // An absence concluded from a scan that could not see everything is not an
      // absence. One predicate, asked here as everywhere else.
      if (gap !== null) ambiguities.push(`the scan that found no rejection in force was itself incomplete: ${gap}`);
    }
  } else if (input.rateLimits.kind === "none") {
    const c = input.rateLimits.coverage;
    reasons.push(`no rate-limit rejection in ${c.transcriptsOpened} transcript(s), ${c.linesScanned} line(s) scanned`);
    // Belt and braces: `summariseRateLimitScan` will not return `none` with a
    // gap, but this function must not depend on that to stay honest.
    const gap = absenceGap(c);
    if (gap !== null) ambiguities.push(`the scan reported no rejection but was incomplete: ${gap}`);
  } else {
    reasons.push(`could not scan transcripts for rate-limit rejections: ${input.rateLimits.why}`);
  }

  // (a) The hint, and only if it is this account's hint.
  let cacheUsable = false;
  if (attribution.kind !== "attributed") {
    reasons.push(`not using the cached utilisation: ${attribution.why}`);
  } else {
    for (const w of attribution.cache.windows) {
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

  /**
   * AN AMBIGUITY OUTRANKS A CALM ANSWER AND YIELDS TO A CERTAIN ONE.
   *
   * `limited` survives — a rejection we could attribute is a fact, and a second
   * one we could not does not make it less true. Anything softer becomes
   * `unknown`, because "ok" and "approaching" are both claims that nothing is
   * currently stopping work, and an unattributable unexpired rejection is
   * precisely a reason to doubt that. The alternative — what this did an hour
   * ago — was to discard the doubt and report `ok`, which is the same collapse
   * as a zero reading as healthy, just arrived at from the other side.
   */
  if (ambiguities.length > 0 && level !== "limited") {
    for (const a of ambiguities) reasons.push(a);
    reasons.unshift("cannot say this account has headroom — see the ambiguities below");
    return { level: "unknown", reasons, activeLimit: null };
  }
  for (const a of ambiguities) reasons.push(a);
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
   * Only scan transcripts modified within this many ms. Default
   * `DEFAULT_SINCE_MS` (8 days), which is the shortest window whose silence can
   * be believed — see `LONGEST_ACTIVE_WINDOW_MS`.
   *
   * MEASURED on this box, 2026-09-08: 1,766 transcripts / 2.9 GB / 866,185
   * lines in total, ~34s for the lot. A 24h window is ~240 files and 2-10s
   * depending on how loaded the box is, and it is what this defaulted to until
   * GPT Sol pointed out that it can miss a `seven_day` rejection that is still
   * in force. **Anything shorter than 7 days makes an absence inconclusive**,
   * and `absenceGap` will say so rather than let it read as headroom. Pass
   * `null` to scan everything.
   */
  sinceMs?: number | null;
  /**
   * Hard bound on transcripts opened, newest first. Sets `truncatedByLimit`,
   * which makes any absence inconclusive — so this is a guard against
   * pathological growth, NOT a routine cost control.
   *
   * Default 5,000. It was 500, which was fine while the default mtime window
   * was 24h (~240 files) and became wrong the moment that went to 8 days: the
   * first live run after the change opened 500 of 1,770 and every verdict came
   * back `unknown` because the scan had cut itself short. Two defaults that
   * were each defensible and together were not. 5,000 is ~3x the current
   * corpus; if it ever bites, the honest answer is a longer look or a shorter
   * `sinceMs`, not a quieter bound.
   */
  maxTranscripts?: number;
  /** Pinned clock, for tests and for a caller that wants one `now` across several collectors. */
  nowMs?: number;
  /** Skip `claude auth status` (it spawns a process). Default false. */
  skipAuthStatus?: boolean;
};

/**
 * Bytes that make a line worth parsing. See `scanTranscript`.
 *
 * THREE INDEPENDENT MARKERS, NOT ONE, and that is GPT Sol's finding 4. It was
 * `rateLimitType` alone — the very field most likely to be renamed — so a
 * rejection that kept `"error":"rate_limit"` and `apiErrorStatus: 429` but
 * moved or renamed its quota key would never have become a candidate at all,
 * never been parsed, and the scan would have reported a confident "none". A
 * marker set that can go silent as a group is not a positive control.
 *
 * MEASURED COST, 2026-09-08 over 866,185 lines: `rateLimitType` alone matched
 * 244 lines, `"rate_limit"` 140, `"apiErrorStatus"` 163, and the union 267. So
 * the insurance costs 23 extra `JSON.parse` calls across the whole corpus.
 */
const MARKERS = [Buffer.from("rateLimitType"), Buffer.from('"rate_limit"'), Buffer.from('"apiErrorStatus"')];
const NEWLINE = 0x0a;

/** True if any marker appears in this line's bytes, without decoding it. */
function isCandidateLine(line: Buffer): boolean {
  for (const m of MARKERS) if (line.indexOf(m) !== -1) return true;
  return false;
}
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
      // A SYMLINK IS COUNTED AS UNREADABLE, NOT SKIPPED. Following one risks a
      // loop and a file read twice, so it is still not followed — but silently
      // skipping it put a transcript outside coverage without saying so, and a
      // benign file beside it could then support a `none`. GPT Sol's round-2
      // finding 6. There are none under `~/.claude/projects` today; the point is
      // that if there ever are, `absenceGap` refuses silence rather than this
      // being discovered by a missed rejection.
      if (e.isSymbolicLink() && (e.name.endsWith(".jsonl") || !e.name.includes("."))) {
        why.push(`${p}: a symlink — not followed, and not scanned, so it is outside this scan's coverage`);
        continue;
      }
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
        if (isCandidateLine(line)) results.push(parseRateLimitLine(line.toString("utf8"), filePath));
        start = nl + 1;
      }
      carry = buf.subarray(start);
      if (carry.length > MAX_LINE_BYTES) {
        // A single JSONL record this large is not one we can use, and silently
        // dropping the carry would resynchronise at the next newline while the
        // line count and the candidate count quietly went wrong. Failing the
        // whole transcript puts it in `transcriptsUnreadable` with a reason,
        // where an absence of hits is already qualified by it.
        return {
          ok: false,
          why: `${filePath}: a single line exceeded ${MAX_LINE_BYTES} bytes without a newline — refusing to guess where the records are`,
        };
      }
    }
    if (carry.length > 0) {
      // AN UNTERMINATED FINAL LINE IS VALIDATED EVEN WITHOUT A MARKER. GPT Sol's
      // round-2 finding 3: it used to be counted as a line and parsed only if it
      // already carried a marker, so a half-written record — which could acquire
      // the rejection fields a moment later — was invisible to coverage and a
      // broken scan could still return `none`.
      //
      // MEASURED BEFORE ADOPTING, because the cost of being wrong here is that
      // every scan on a busy box returns `unknown`: of 1,772 transcripts on this
      // box on 2026-09-08, ZERO ended without a trailing newline. Records are
      // written a whole line at a time. So this fires on genuine truncation, not
      // on ordinary concurrent writing — and it retires the guess I had written
      // into this file earlier, that a half-written final line was routine.
      lines++;
      const tail = carry.toString("utf8");
      if (isCandidateLine(carry)) results.push(parseRateLimitLine(tail, filePath));
      else if (tail.trim().length > 0) {
        try {
          JSON.parse(tail);
        } catch {
          return {
            ok: false,
            why: `${filePath}: the final line has no newline and is not valid JSON (${tail.length} bytes) — a truncated record could be a rejection this scan cannot see`,
          };
        }
      }
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
  const sinceMs = options.sinceMs === undefined ? DEFAULT_SINCE_MS : options.sinceMs;
  const maxTranscripts = options.maxTranscripts ?? 5000;

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

// ---------------------------------------------------------------------------
// Reading a report back. Pure, exhaustive, and null on the first mismatch.
// ---------------------------------------------------------------------------

/**
 * `UsageReport` from `unknown` — for the Overseer store reading its own
 * `current.json` back after a restart.
 *
 * WHY THIS LIVES HERE AND NOT IN THE STORE. It is the `RateLimitHit.id`
 * argument a second time: a parser written by the consumer is a second
 * hand-written declaration of the type, and it fails in the quiet direction —
 * a field silently absent reads as a report that merely says less. The arms of
 * `UsageCacheReading`, `RateLimitScan` and `UsageAccount` are knowledge this
 * module has and the store does not, so checking the discriminant and casting
 * the tail is exactly the failure GPT Sol found in the attention session's
 * parser: `{"evidence":{"kind":"dialog"}}` with no question and no options
 * parsed as valid and threw at render, having crossed the one boundary the
 * design exists to hold.
 *
 * A checkpoint is a persistence, version and corruption boundary even though we
 * wrote the bytes, so nothing here trusts its input: every field is checked,
 * every union arm is exhaustive, and no tail is cast once a discriminant looks
 * right.
 *
 * NULL ON THE FIRST MISMATCH, never a partial report. The caller turns that
 * into an explicit "could not read it, and here is why" — a half-parsed report
 * is the thing a store most needs not to have.
 *
 * PURE: no clock, no I/O, no environment. It runs inside `parseCheckpoint`,
 * which is called before the lock is proven and on a path that must not do
 * anything.
 */
export function parseUsageReport(u: unknown): UsageReport | null {
  const r = obj(u);
  if (!r) return null;
  const account = parseAccountBack(r["account"]);
  if (account === null) return null;
  const cache = parseCacheBack(r["cache"]);
  if (cache === null) return null;
  const rateLimits = parseScanBack(r["rateLimits"]);
  if (rateLimits === null) return null;
  const verdict = parseVerdictBack(r["verdict"]);
  if (verdict === null) return null;
  const collectedAt = str(r["collectedAt"]);
  if (collectedAt === null) return null;
  const tookMs = num(r["tookMs"]);
  if (tookMs === null) return null;
  return { account, cache, rateLimits, verdict, collectedAt, tookMs };
}

/** A string that is allowed to be null, but not absent and not another type. */
function nullableStr(v: unknown): { ok: true; value: string | null } | { ok: false } {
  if (v === null) return { ok: true, value: null };
  return typeof v === "string" ? { ok: true, value: v } : { ok: false };
}
function nullableNum(v: unknown): { ok: true; value: number | null } | { ok: false } {
  if (v === null) return { ok: true, value: null };
  return typeof v === "number" && Number.isFinite(v) ? { ok: true, value: v } : { ok: false };
}
/** A string, required and non-empty — `str` already rejects "" and we keep that. */
function reqStr(v: unknown): string | null {
  return str(v);
}
function reqNum(v: unknown): number | null {
  return num(v);
}
function reqBool(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}
function strArray(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const out: string[] = [];
  for (const item of v) {
    if (typeof item !== "string") return null;
    out.push(item);
  }
  return out;
}

function parseAccountBack(u: unknown): UsageAccount | null {
  const a = obj(u);
  if (!a) return null;
  switch (a["kind"]) {
    case "value": {
      const email = nullableStr(a["email"]);
      const orgId = nullableStr(a["orgId"]);
      const orgName = nullableStr(a["orgName"]);
      const subscriptionType = nullableStr(a["subscriptionType"]);
      const accountUuid = nullableStr(a["accountUuid"]);
      const rateLimitTier = nullableStr(a["rateLimitTier"]);
      if (!email.ok || !orgId.ok || !orgName.ok || !subscriptionType.ok || !accountUuid.ok || !rateLimitTier.ok) return null;
      return {
        kind: "value",
        email: email.value,
        orgId: orgId.value,
        orgName: orgName.value,
        subscriptionType: subscriptionType.value,
        accountUuid: accountUuid.value,
        rateLimitTier: rateLimitTier.value,
      };
    }
    case "logged-out": {
      const projectsDirectory = nullableStr(a["projectsDirectory"]);
      if (!projectsDirectory.ok) return null;
      return { kind: "logged-out", projectsDirectory: projectsDirectory.value };
    }
    case "unknown": {
      const why = reqStr(a["why"]);
      return why === null ? null : { kind: "unknown", why };
    }
    default:
      return null;
  }
}

function parseWindowBack(u: unknown): UsageWindowReading | null {
  const w = obj(u);
  if (!w) return null;
  const window = reqStr(w["window"]);
  if (window === null) return null;
  switch (w["kind"]) {
    case "value": {
      const utilizationPercent = reqNum(w["utilizationPercent"]);
      const resetsAt = reqStr(w["resetsAt"]);
      const resetsAtMs = reqNum(w["resetsAtMs"]);
      const msUntilReset = reqNum(w["msUntilReset"]);
      if (utilizationPercent === null || resetsAt === null || resetsAtMs === null || msUntilReset === null) return null;
      // The same range the producer enforces. A stored -1 is as meaningless as
      // a freshly parsed one.
      if (utilizationPercent < 0 || utilizationPercent > 100) return null;
      return { kind: "value", window, utilizationPercent, resetsAt, resetsAtMs, msUntilReset };
    }
    case "expired": {
      const resetsAt = reqStr(w["resetsAt"]);
      const resetsAtMs = reqNum(w["resetsAtMs"]);
      const msSinceReset = reqNum(w["msSinceReset"]);
      const why = reqStr(w["why"]);
      if (resetsAt === null || resetsAtMs === null || msSinceReset === null || why === null) return null;
      // Belt and braces on the arm's whole reason for existing: an expired
      // reading must carry no percentage, so a stored one that has grown a
      // numeric field is not a reading this module produced.
      if ("utilizationPercent" in w) return null;
      return { kind: "expired", window, resetsAt, resetsAtMs, msSinceReset, why };
    }
    case "unknown": {
      const why = reqStr(w["why"]);
      return why === null ? null : { kind: "unknown", window, why };
    }
    default:
      return null;
  }
}

function parseCacheBack(u: unknown): UsageCacheReading | null {
  const c = obj(u);
  if (!c) return null;
  switch (c["kind"]) {
    case "value": {
      const accountUuid = nullableStr(c["accountUuid"]);
      const fetchedAtMs = reqNum(c["fetchedAtMs"]);
      const ageMs = reqNum(c["ageMs"]);
      if (!accountUuid.ok || fetchedAtMs === null || ageMs === null) return null;
      if (!Array.isArray(c["windows"])) return null;
      const windows: UsageWindowReading[] = [];
      for (const item of c["windows"]) {
        const w = parseWindowBack(item);
        if (w === null) return null;
        windows.push(w);
      }
      return { kind: "value", accountUuid: accountUuid.value, fetchedAtMs, ageMs, windows };
    }
    case "unknown": {
      const why = reqStr(c["why"]);
      return why === null ? null : { kind: "unknown", why };
    }
    default:
      return null;
  }
}

function parseHitBack(u: unknown): RateLimitHit | null {
  const h = obj(u);
  if (!h) return null;
  const id = reqStr(h["id"]);
  const window = reqStr(h["window"]);
  const resetsAtMs = reqNum(h["resetsAtMs"]);
  const hitAtMs = nullableNum(h["hitAtMs"]);
  const hitAt = nullableStr(h["hitAt"]);
  const status = nullableStr(h["status"]);
  const claudeSessionId = nullableStr(h["claudeSessionId"]);
  const transcriptPath = reqStr(h["transcriptPath"]);
  const message = nullableStr(h["message"]);
  if (id === null || window === null || resetsAtMs === null || transcriptPath === null) return null;
  if (!hitAtMs.ok || !hitAt.ok || !status.ok || !claudeSessionId.ok || !message.ok) return null;
  return {
    id,
    window,
    resetsAtMs,
    hitAtMs: hitAtMs.value,
    hitAt: hitAt.value,
    status: status.value,
    claudeSessionId: claudeSessionId.value,
    transcriptPath,
    message: message.value,
  };
}

function parseCoverageBack(u: unknown): ScanCoverage | null {
  const c = obj(u);
  if (!c) return null;
  const transcriptsFound = reqNum(c["transcriptsFound"]);
  const transcriptsSelected = reqNum(c["transcriptsSelected"]);
  const transcriptsOpened = reqNum(c["transcriptsOpened"]);
  const transcriptsUnreadable = reqNum(c["transcriptsUnreadable"]);
  const unreadableWhy = strArray(c["unreadableWhy"]);
  const linesScanned = reqNum(c["linesScanned"]);
  const candidateLines = reqNum(c["candidateLines"]);
  const linesParsed = reqNum(c["linesParsed"]);
  const malformedCandidates = reqNum(c["malformedCandidates"]);
  const quotaLimitsWithoutErrorSignal = reqNum(c["quotaLimitsWithoutErrorSignal"]);
  const truncatedByLimit = reqBool(c["truncatedByLimit"]);
  const sinceMs = nullableNum(c["sinceMs"]);
  const tookMs = reqNum(c["tookMs"]);
  if (
    transcriptsFound === null ||
    transcriptsSelected === null ||
    transcriptsOpened === null ||
    transcriptsUnreadable === null ||
    unreadableWhy === null ||
    linesScanned === null ||
    candidateLines === null ||
    linesParsed === null ||
    malformedCandidates === null ||
    quotaLimitsWithoutErrorSignal === null ||
    truncatedByLimit === null ||
    !sinceMs.ok ||
    tookMs === null
  ) {
    return null;
  }
  return {
    transcriptsFound,
    transcriptsSelected,
    transcriptsOpened,
    transcriptsUnreadable,
    unreadableWhy,
    linesScanned,
    candidateLines,
    linesParsed,
    malformedCandidates,
    quotaLimitsWithoutErrorSignal,
    truncatedByLimit,
    sinceMs: sinceMs.value,
    tookMs,
  };
}

function parseScanBack(u: unknown): RateLimitScan | null {
  const s = obj(u);
  if (!s) return null;
  const coverage = parseCoverageBack(s["coverage"]);
  if (coverage === null) return null;
  switch (s["kind"]) {
    case "hits": {
      if (!Array.isArray(s["hits"])) return null;
      const hits: RateLimitHit[] = [];
      for (const item of s["hits"]) {
        const h = parseHitBack(item);
        if (h === null) return null;
        hits.push(h);
      }
      // An empty `hits` array is not a `hits` scan — that is `none`, and the
      // difference is the whole positive control.
      if (hits.length === 0) return null;
      return { kind: "hits", hits, coverage };
    }
    case "none":
      return { kind: "none", coverage };
    case "unknown": {
      const why = reqStr(s["why"]);
      return why === null ? null : { kind: "unknown", why, coverage };
    }
    default:
      return null;
  }
}

function parseVerdictBack(u: unknown): UsageVerdict | null {
  const v = obj(u);
  if (!v) return null;
  const level = v["level"];
  if (level !== "ok" && level !== "approaching" && level !== "limited" && level !== "unknown") return null;
  const reasons = strArray(v["reasons"]);
  if (reasons === null) return null;
  // A MISSING `activeLimit` KEY IS REFUSED, but by the two lines below rather
  // than by an `in` check of its own: an absent key is `undefined`, which is
  // not `null`, so it goes to `parseHitBack(undefined)`, comes back null, and
  // is rejected. There WAS an `in` guard here and a mutation pass showed
  // deleting it changed nothing — the same redundancy GPT Sol caught me
  // mis-describing as an equivalent mutant earlier in this file, except this
  // time the whole observable value is identical rather than just the
  // discriminator, so the line really was dead. The test that pins the
  // behaviour stays; it just no longer names the line that enforces it.
  const activeLimit = v["activeLimit"] === null ? null : parseHitBack(v["activeLimit"]);
  if (v["activeLimit"] !== null && activeLimit === null) return null;
  // `limited` is the only level that may carry one, and any other level
  // carrying one is a report this module did not write.
  if (activeLimit !== null && level !== "limited") return null;
  return { level, reasons, activeLimit };
}
