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
 *    replaced by fixed placeholders. Those placeholders (`0f5e9c11-…`) are
 *    distinctive rather than the obvious `00000000-1111-…`, because the first
 *    attempt used the obvious one and `tests/fixture-ids.test.ts` caught it
 *    already being claimed by `overseer-diff.test.ts`. Nothing here inserts a
 *    row, so the collision was harmless — but a shared id says two fixtures are
 *    the same thing, and these are not. Percentages, window names, ISO reset
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
import { cp, mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  attributeCache,
  classifyHit,
  computeUsageVerdict,
  contradictsCachedWindow,
  isKnownUsageWindow,
  latestHitForConversation,
  parseAuthStatus,
  parseRateLimitLine,
  parseUsageCache,
  parseUsageWindow,
  rateLimitHitId,
  scanForRateLimits,
  summariseRateLimitScan,
  DEFAULT_SINCE_MS,
  KNOWN_USAGE_WINDOWS,
  LONGEST_ACTIVE_WINDOW_MS,
  type RateLimitHit,
  type ScanCoverage,
  type UsageCacheReading,
} from "../tools/overseer/usage.js";

const FIXTURES = path.resolve(import.meta.dirname, "fixtures/overseer-usage");
const fx = (name: string) => readFileSync(path.join(FIXTURES, name), "utf8");
const fxJson = (name: string): unknown => JSON.parse(fx(name));

/** The instant `claude-json-real.json` was captured, plus a minute. */
const NOW_REAL = Date.parse("2026-09-08T12:00:00.000Z");

/**
 * "I have no usable cache" as an explicit argument.
 *
 * `latestHitForConversation` takes the cache as a REQUIRED parameter, so this
 * is what a caller with nothing to offer passes. It exists as a named constant
 * rather than an inline literal because the whole point of the parameter being
 * required is that saying "I could not check" is a decision somebody made.
 */
const NO_CACHE = { kind: "unknown", why: "no cache in this test" } as const;

/**
 * "I could not establish the account" as an explicit argument, for the same
 * reason `NO_CACHE` exists: `contradictsCachedWindow` and
 * `latestHitForConversation` both require the account, because a cache that has
 * not been positively attributed must not be allowed to judge a rejection.
 */
const NO_ACCOUNT = { kind: "unknown", why: "no account in this test" } as const;

/** The real logged-in account, as `claude auth status` and `.oauthAccount` give it. */
const realAccount = () => parseAuthStatus(fx("auth-status-real.json"), fxJson("claude-json-real.json"));

/** The account uuid in the redacted fixtures, and so in any cache that must match them. */
const ACCOUNT_UUID = "0f5e9c11-1111-4111-8111-000000000001";

/**
 * A cache that POSITIVELY CONFIRMS the given rejections belong to `realAccount()`.
 *
 * Every attribution precondition has to hold at once — same account uuid,
 * fetched strictly after the rejection, and a live window for the same name
 * agreeing on the reset instant — so building one by hand in each test invited
 * a test that passed for the wrong reason. Since round 2, `cannot-attribute` is
 * no longer silently the same as "no contradiction", and a test that means
 * "this rejection is confirmed ours" has to say all of it.
 */
function cacheConfirming(...hits: RateLimitHit[]): UsageCacheReading {
  const latestHitAt = Math.max(...hits.map((h) => h.hitAtMs ?? 0));
  return {
    kind: "value",
    accountUuid: ACCOUNT_UUID,
    fetchedAtMs: latestHitAt + 1000,
    ageMs: 1000,
    windows: hits.map((h) => ({
      kind: "value" as const,
      window: h.window,
      utilizationPercent: 99,
      resetsAt: new Date(h.resetsAtMs).toISOString(),
      resetsAtMs: h.resetsAtMs,
      msUntilReset: 1,
    })),
  };
}

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
    expect(r.accountUuid).toBe("0f5e9c11-1111-4111-8111-000000000001");
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
      orgId: "0f5e9c11-2222-4222-8222-000000000002",
      orgName: "greg@rehearsable.ai's Organization",
      subscriptionType: "max",
      accountUuid: "0f5e9c11-1111-4111-8111-000000000001",
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
      id: rateLimitHitId("/fake/t.jsonl", "2026-09-03T10:33:53.385Z", "five_hour"),
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
      id: rateLimitHitId("/fake/t.jsonl", new Date(hitAtMs).toISOString(), window),
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

  it("reads a marker split ACROSS the 1 MiB chunk boundary, byte-exactly", async () => {
    // THIS TEST USED TO PROVE THE WRONG THING. It padded with ~1.2 MB of filler
    // and asserted the rejection was still found — but GPT Sol computed where
    // the marker actually landed (byte 1,208,518, i.e. 159,942 bytes INTO the
    // second chunk) and the record was wholly inside one read. It proved that
    // later chunks are scanned, not that a split marker survives. So the offset
    // is now computed in bytes and ASSERTED before the scan runs; if the
    // arithmetic ever stops landing the marker on the seam, the test says so
    // instead of quietly going back to proving the weaker thing.
    const CHUNK = 1 << 20;
    const record = fx("transcript-429-five-hour-real.jsonl").trimEnd();
    const markerOffsetInRecord = Buffer.from(record, "utf8").indexOf(Buffer.from("rateLimitType"));
    expect(markerOffsetInRecord).toBeGreaterThan(0);

    // Put the middle of the word "rateLimitType" exactly on the seam.
    const wantRecordStart = CHUNK - markerOffsetInRecord - 6;
    const filler = `${JSON.stringify({ type: "user", pad: "x".repeat(4000) })}\n`;
    const fillerBytes = Buffer.byteLength(filler);
    const wholeFillers = Math.floor(wantRecordStart / fillerBytes);
    // One short filler line makes up the remainder so the record starts on the
    // exact byte we want rather than the nearest multiple of 4-odd KB.
    const remainder = wantRecordStart - wholeFillers * fillerBytes;
    // The shim's own JSON is 25 bytes: `{"type":"user","pad":"` (22) + `"}` (2)
    // + the newline.
    expect(remainder).toBeGreaterThan(25);
    const shim = `${JSON.stringify({ type: "user", pad: "y".repeat(remainder - 25) })}\n`;
    const prefix = filler.repeat(wholeFillers) + shim;
    expect(Buffer.byteLength(prefix)).toBe(wantRecordStart);

    const padded = `${prefix + record}\n`;
    const markerAt = Buffer.from(padded, "utf8").indexOf(Buffer.from("rateLimitType"));
    // The marker must START before the seam and END after it.
    expect(markerAt).toBeLessThan(CHUNK);
    expect(markerAt + "rateLimitType".length).toBeGreaterThan(CHUNK);

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

const hit = (over: Partial<RateLimitHit> = {}): RateLimitHit => {
  const base = {
    window: "five_hour",
    resetsAtMs: NOW_REAL + 3600_000,
    hitAtMs: NOW_REAL - 60_000,
    hitAt: new Date(NOW_REAL - 60_000).toISOString(),
    status: "rejected",
    claudeSessionId: "055bc66d-d4bf-4794-924f-8c662035fb7e",
    transcriptPath: "/fake/t.jsonl",
    message: null,
    ...over,
  };
  // Derived from the overridden fields rather than fixed, so two hits that
  // differ in path, timestamp or window get different ids here exactly as they
  // would from a real scan — a fixture whose ids all matched would make a
  // carry-forward test pass for the wrong reason.
  return { id: rateLimitHitId(base.transcriptPath, base.hitAt, base.window), ...base };
};

describe("computeUsageVerdict", () => {
  it("reports `limited` from a CONFIRMED unexpired 429, and hands back the hit that gates work longest", () => {
    const soon = hit({ window: "five_hour", resetsAtMs: NOW_REAL + 3600_000 });
    const late = hit({ window: "seven_day", resetsAtMs: NOW_REAL + 4 * 24 * 3600_000 });
    const v = computeUsageVerdict({
      account: realAccount(),
      // Confirmed, not merely un-contradicted: `limited` now requires a positive
      // attribution, so the cache has to agree with both rejections.
      cache: cacheConfirming(soon, late),
      rateLimits: { kind: "hits", hits: [soon, late], coverage: emptyCoverage({ transcriptsOpened: 1, linesScanned: 2, sinceMs: null }) },
      nowMs: NOW_REAL,
    });
    expect(v.level).toBe("limited");
    expect(v.activeLimit?.window).toBe("seven_day");
  });

  it("does NOT report `limited` from a rejection it merely failed to disprove", () => {
    // This is the behaviour a test used to pin the wrong way round. With no
    // account and no cache, a rejection from some account is still a fact — but
    // whose account is not established, so the level is `unknown`. GPT Sol's
    // round-2 finding 1.
    const v = computeUsageVerdict({
      account: { kind: "unknown", why: "claude auth status failed" },
      cache: { kind: "unknown", why: "no cache" },
      rateLimits: { kind: "hits", hits: [hit()], coverage: emptyCoverage({ transcriptsOpened: 1, linesScanned: 2, sinceMs: null }) },
      nowMs: NOW_REAL,
    });
    expect(v.level).toBe("unknown");
    expect(v.activeLimit).toBeNull();
    expect(v.reasons.join(" ")).toContain("carries no account id");
  });

  it("keeps `limited` but claims NO reset time when the scan could not see everything", () => {
    // Limited is established; which rejection frees up last is not, because an
    // unreadable transcript could hold a later one. Naming this hit's reset as
    // `activeLimit` would tell the page work resumes hours before it does.
    const h = hit({ window: "five_hour", resetsAtMs: NOW_REAL + 3600_000 });
    const v = computeUsageVerdict({
      account: realAccount(),
      cache: cacheConfirming(h),
      rateLimits: {
        kind: "hits",
        hits: [h],
        coverage: emptyCoverage({ transcriptsOpened: 9, linesScanned: 900, transcriptsUnreadable: 1, sinceMs: null }),
      },
      nowMs: NOW_REAL,
    });
    expect(v.level).toBe("limited");
    expect(v.activeLimit).toBeNull();
    expect(v.reasons.join(" ")).toContain("no reset time is claimed");
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
      account: realAccount(),
      cache: {
        kind: "value",
        // Must match the real account's uuid: an unattributed cache is not
        // allowed to raise `approaching` either, for the same reason it is not
        // allowed to disqualify a rejection.
        accountUuid: "0f5e9c11-1111-4111-8111-000000000001",
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

  it("will NOT raise `approaching` from a cache it cannot attribute", () => {
    const v = computeUsageVerdict({
      account: { kind: "unknown", why: "claude auth status failed" },
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
    // 92% of WHOSE five-hour window? Unattributed, that number describes an
    // account we cannot name, so it may not colour this account's verdict.
    expect(v.level).toBe("ok");
    expect(v.reasons.join(" ")).toContain("not using the cached utilisation");
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
    expect(v.reasons.join(" ")).toContain("not using the cached utilisation");
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

  it("refuses to call a truncated scan's silence `ok`", () => {
    const v = computeUsageVerdict({
      account: { kind: "unknown", why: "skipped" },
      cache: parseUsageCache(fxJson("claude-json-real.json"), NOW_REAL),
      rateLimits: { kind: "none", coverage: emptyCoverage({ transcriptsOpened: 500, linesScanned: 900, truncatedByLimit: true }) },
      nowMs: NOW_REAL,
    });
    // It used to say `ok` and merely mention the truncation in prose. A level
    // is what gets rendered; a reason is what gets read afterwards, if at all.
    expect(v.level).toBe("unknown");
    expect(v.reasons.join(" ")).toContain("did not look everywhere");
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
    const r = latestHitForConversation(
      scanOf([mine, theirs], { sinceMs: null }),
      "mine",
      NOW_REAL,
      cacheConfirming(mine, theirs),
      realAccount(),
    );
    expect(r.kind).toBe("hit");
    if (r.kind !== "hit") throw new Error("unreachable");
    expect(r.hit.claudeSessionId).toBe("mine");
  });

  it("returns `cannot-tell` for a rejection it cannot attribute, rather than a hit", () => {
    // With no account and no cache, this conversation's rejection is a real
    // refusal of SOME account. Reporting it as this row's limit is a claim the
    // evidence does not support — GPT Sol's round-2 finding 1.
    const r = latestHitForConversation(
      scanOf([hit({ claudeSessionId: "mine" })], { sinceMs: null }),
      "mine",
      NOW_REAL,
      NO_CACHE,
      NO_ACCOUNT,
    );
    expect(r.kind).toBe("cannot-tell");
  });

  it("returns `none` when that conversation's only rejection has already reset", () => {
    const r = latestHitForConversation(scanOf([hit({ claudeSessionId: "mine", resetsAtMs: NOW_REAL - 1 })]), "mine", NOW_REAL, NO_CACHE, NO_ACCOUNT);
    expect(r.kind).toBe("none");
  });

  it("returns `cannot-tell`, never `none`, when the scan itself could not tell", () => {
    const broken = summariseRateLimitScan([], emptyCoverage({ transcriptsFound: 40 }));
    expect(broken.kind).toBe("unknown");
    const r = latestHitForConversation(broken, "mine", NOW_REAL, NO_CACHE, NO_ACCOUNT);
    expect(r.kind).toBe("cannot-tell");
    if (r.kind !== "cannot-tell") throw new Error("unreachable");
    expect(r.why).toContain("no transcript was opened");
  });

  it("returns `cannot-tell` when a truncated scan never reached this conversation", () => {
    const r = latestHitForConversation(scanOf([hit({ claudeSessionId: "someone-else" })], { truncatedByLimit: true }), "mine", NOW_REAL, NO_CACHE, NO_ACCOUNT);
    expect(r.kind).toBe("cannot-tell");
    if (r.kind !== "cannot-tell") throw new Error("unreachable");
    expect(r.why).toContain("stopped at");
  });

  it("says `cannot-tell` for a conversation the truncated scan DID reach — it cannot know which limit binds", () => {
    // This used to answer `hit`. A truncated scan may not have read a later
    // rejection for the same conversation, so naming this one as the limit tells
    // the page work resumes before it does. GPT Sol's round-2 finding 2.
    const h = hit({ claudeSessionId: "mine" });
    const r = latestHitForConversation(
      scanOf([h], { truncatedByLimit: true, sinceMs: null }),
      "mine",
      NOW_REAL,
      cacheConfirming(h),
      realAccount(),
    );
    expect(r.kind).toBe("cannot-tell");
    if (r.kind !== "cannot-tell") throw new Error("unreachable");
    expect(r.why).toContain("which one frees up last");
  });

  it("picks the rejection that frees up last when a conversation has two and the scan saw everything", () => {
    const soon = hit({ claudeSessionId: "mine", window: "five_hour", resetsAtMs: NOW_REAL + 3600_000 });
    const late = hit({ claudeSessionId: "mine", window: "seven_day", resetsAtMs: NOW_REAL + 4 * 24 * 3600_000 });
    const r = latestHitForConversation(
      scanOf([soon, late], { sinceMs: null }),
      "mine",
      NOW_REAL,
      cacheConfirming(soon, late),
      realAccount(),
    );
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
  /**
   * A `seven_day` rejection the REAL cache can confirm: same window, agreeing
   * reset instant (truncated to the whole second a transcript would record),
   * and dated before the cache's own `fetchedAtMs` of 1788868334947 so the
   * cache is a later snapshot than the rejection it is judging.
   */
  const confirmedByLiveCache = (cachedResetsAtMs: number) =>
    hit({
      window: "seven_day",
      resetsAtMs: Math.floor(cachedResetsAtMs / 1000) * 1000,
      hitAt: "2026-09-08T11:00:00.000Z",
      hitAtMs: Date.parse("2026-09-08T11:00:00.000Z"),
    });

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
    const why = contradictsCachedWindow(previousAccountHit(), realAccount(), liveCache());
    expect(why).not.toBeNull();
    expect(why).toContain("2026-09-15T04:59:59.790550+00:00");
    // It says the previous-account explanation is LIKELY, and says out loud
    // that it is an explanation rather than a proof — the whole of GPT Sol's
    // finding 1 is that these two must not be conflated.
    expect(why).toContain("likeliest explanation");
    expect(why).toContain("not a proof");
  });

  it("does NOT contradict when the two agree within the sub-second precision gap", () => {
    // The cache carries `…:59.790550+00:00`; a transcript's resetsAt is whole
    // unix seconds. Exact equality would call one window two.
    const cached = liveCache();
    if (cached.kind !== "value") throw new Error("unreachable");
    const sevenDay = cached.windows.find((w) => w.window === "seven_day");
    if (sevenDay?.kind !== "value") throw new Error("unreachable");
    const agreeing = hit({ window: "seven_day", resetsAtMs: Math.floor(sevenDay.resetsAtMs / 1000) * 1000 });
    expect(contradictsCachedWindow(agreeing, realAccount(), cached)).toBeNull();
  });

  it("cannot contradict from an expired or unknown cached window — those describe nothing", () => {
    const stale = parseUsageCache(fxJson("claude-json-stale.json"), NOW_REAL);
    // five_hour is `expired` in that fixture, so a five_hour rejection is not disqualified.
    expect(contradictsCachedWindow(hit({ window: "five_hour", resetsAtMs: NOW_REAL + 9e6 }), realAccount(), stale)).toBeNull();
    expect(contradictsCachedWindow(hit({ window: "nimbus_quill", resetsAtMs: NOW_REAL + 9e6 }), realAccount(), stale)).toBeNull();
    expect(contradictsCachedWindow(hit(), realAccount(), { kind: "unknown", why: "no cache" })).toBeNull();
  });

  it("REFUSES TO COMPARE AT ALL when the cache cannot be positively attributed", () => {
    // "Not proven to be somebody else's" is not "proven to be ours" — GPT Sol's
    // finding 1. Each of these used to let an unattributed cache disqualify a
    // real rejection and hand back `ok`.
    const cached = liveCache();
    const h = previousAccountHit();
    // auth status failed entirely
    expect(contradictsCachedWindow(h, NO_ACCOUNT, cached)).toBeNull();
    // logged out
    expect(contradictsCachedWindow(h, { kind: "logged-out", projectsDirectory: null }, cached)).toBeNull();
    // the account carries no uuid to match against
    expect(
      contradictsCachedWindow(h, { ...realAccount(), kind: "value", accountUuid: null } as never, cached),
    ).toBeNull();
    // the cache was fetched BEFORE the rejection, so its window may have rolled since
    if (cached.kind !== "value") throw new Error("unreachable");
    const staleFetch: UsageCacheReading = { ...cached, fetchedAtMs: (h.hitAtMs ?? 0) - 1 };
    expect(contradictsCachedWindow(h, realAccount(), staleFetch)).toBeNull();
  });

  it("the verdict is `unknown` — NOT `limited`, and NOT `ok` — for an unattributable rejection", () => {
    const v = computeUsageVerdict({
      account: realAccount(),
      cache: liveCache(),
      rateLimits: {
        kind: "hits",
        hits: [previousAccountHit()],
        coverage: emptyCoverage({ transcriptsOpened: 239, linesScanned: 237547, sinceMs: null }),
      },
      nowMs: NOW_REAL,
    });
    // The first version said `ok` here, which is the same collapse as a zero
    // reading as healthy, reached from the other side: an ambiguity turned into
    // a confident negative. GPT Sol's finding 1.
    expect(v.level).toBe("unknown");
    expect(v.activeLimit).toBeNull();
    expect(v.reasons.join(" ")).toContain("cannot say this account has headroom");
    expect(v.reasons.join(" ")).toContain("cannot be attributed either way");
  });

  it("…but IS `limited` for a rejection that agrees with the live cached window", () => {
    const cached = liveCache();
    if (cached.kind !== "value") throw new Error("unreachable");
    const sevenDay = cached.windows.find((w) => w.window === "seven_day");
    if (sevenDay?.kind !== "value") throw new Error("unreachable");
    const v = computeUsageVerdict({
      account: realAccount(),
      cache: cached,
      rateLimits: {
        kind: "hits",
        // Hit BEFORE the cache was fetched (1788868334947), so the cache is in a
        // position to confirm it. A cache no newer than the rejection can no
        // longer attribute it.
        hits: [confirmedByLiveCache(sevenDay.resetsAtMs)],
        coverage: emptyCoverage({ transcriptsOpened: 239, linesScanned: 237547, sinceMs: null }),
      },
      nowMs: NOW_REAL,
    });
    expect(v.level).toBe("limited");
    expect(v.activeLimit?.window).toBe("seven_day");
  });

  it("`limited` survives alongside an ambiguity — a certain rejection is not softened by an uncertain one", () => {
    const cached = liveCache();
    if (cached.kind !== "value") throw new Error("unreachable");
    const sevenDay = cached.windows.find((w) => w.window === "seven_day");
    if (sevenDay?.kind !== "value") throw new Error("unreachable");
    const v = computeUsageVerdict({
      account: realAccount(),
      cache: cached,
      rateLimits: {
        kind: "hits",
        hits: [confirmedByLiveCache(sevenDay.resetsAtMs), previousAccountHit()],
        coverage: emptyCoverage({ transcriptsOpened: 239, linesScanned: 237547, sinceMs: null }),
      },
      nowMs: NOW_REAL,
    });
    expect(v.level).toBe("limited");
    expect(v.activeLimit).not.toBeNull();
    // The doubt is still reported, it just does not overturn a fact.
    expect(v.reasons.join(" ")).toContain("cannot be attributed either way");
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
    // THIS TEST PINNED THE WRONG ANSWER UNTIL 2026-09-08. It asserted `limited`,
    // on the reasoning that "ground truth wins when nothing can dispute it" —
    // but nothing disputing it is not the same as something confirming it, and
    // an unattributable rejection may belong to an account that was swapped out
    // days ago. GPT Sol's round-2 finding 1 named this test by line number.
    expect(v.level).toBe("unknown");
    expect(v.activeLimit).toBeNull();
    expect(v.reasons.join(" ")).toContain("carries no account id");
  });

  it("latestHitForConversation says `cannot-tell` for the contradicted rejection, never `none`", () => {
    const scan = summariseRateLimitScan(
      [previousAccountHit()],
      emptyCoverage({ transcriptsOpened: 3, linesScanned: 300, sinceMs: null }),
    );
    // With no usable cache the rejection cannot be attributed, so it is neither
    // this conversation's limit nor absent — `cannot-tell` either way, for a
    // different reason than below. (It used to answer `hit` here, which was GPT
    // Sol's round-2 finding 1.)
    const withUnusableCache = latestHitForConversation(scan, "bccde256-313a-4664-a395-6f473c2f4fff", NOW_REAL, NO_CACHE, NO_ACCOUNT);
    expect(withUnusableCache.kind).toBe("cannot-tell");
    if (withUnusableCache.kind !== "cannot-tell") throw new Error("unreachable");
    expect(withUnusableCache.why).toContain("could not be read");

    // With a cache that CAN be attributed, the rejection is neither in force nor
    // dismissed. `none` here would tell the dashboard the row is fine, which is
    // exactly the claim we are not entitled to make.
    const attributed = latestHitForConversation(
      scan,
      "bccde256-313a-4664-a395-6f473c2f4fff",
      NOW_REAL,
      liveCache(),
      realAccount(),
    );
    expect(attributed.kind).toBe("cannot-tell");
    if (attributed.kind !== "cannot-tell") throw new Error("unreachable");
    expect(attributed.why).toContain("likeliest explanation");
  });
});

// ---------------------------------------------------------------------------
// The chunked buffer scan's edge cases. It replaced `readline` for speed
// (9.9s -> 1.8s on identical input), and the cost of that is owning the framing
// itself, so the framing is what these test.
// ---------------------------------------------------------------------------

describe("scanForRateLimits — framing", () => {
  it("reads a final record with no trailing newline", async () => {
    const dir = await transcriptDir({ "a.jsonl": fx("transcript-429-five-hour-real.jsonl").trimEnd() });
    const r = await scanForRateLimits({ projectsDir: dir, sinceMs: null, maxTranscripts: 100, nowMs: NOW_REAL });
    expect(r.kind).toBe("hits");
    if (r.kind !== "hits") throw new Error("unreachable");
    expect(r.coverage.linesScanned).toBe(1);
  });

  it("survives CRLF, which would otherwise leave a \\r inside the JSON", async () => {
    const dir = await transcriptDir({ "a.jsonl": `${fx("transcript-429-seven-day-real.jsonl").trimEnd()}\r\n` });
    const r = await scanForRateLimits({ projectsDir: dir, sinceMs: null, maxTranscripts: 100, nowMs: NOW_REAL });
    expect(r.kind).toBe("hits");
  });

  it("keeps a multi-byte character intact when its BYTES straddle the boundary", async () => {
    // Same correction as the marker test above: this padded past 1 MiB and
    // asserted the "·" survived, but the character actually sat 157,235 bytes
    // inside the second chunk. Now the first byte of the two-byte "é" is placed
    // on the last byte of chunk one, so decoding a chunk in isolation would
    // produce a replacement character.
    const CHUNK = 1 << 20;
    const filler = `${JSON.stringify({ type: "user", pad: "x".repeat(4000) })}\n`;
    const fillerBytes = Buffer.byteLength(filler);
    const wholeFillers = Math.floor((CHUNK - 200) / fillerBytes);
    const used = wholeFillers * fillerBytes;
    // A line whose "é" begins on byte CHUNK-1. `{"type":"user","pad":"` is 22
    // bytes of JSON before the padding starts.
    const before = CHUNK - 1 - used - 22;
    expect(before).toBeGreaterThan(0);
    const splitLine = `{"type":"user","pad":"${"z".repeat(before)}é${"z".repeat(10)}"}\n`;
    const body = filler.repeat(wholeFillers) + splitLine + fx("transcript-429-five-hour-real.jsonl");
    const buf = Buffer.from(body, "utf8");
    // The two bytes of "é" (0xC3 0xA9) must land either side of the seam.
    expect(buf[CHUNK - 1]).toBe(0xc3);
    expect(buf[CHUNK]).toBe(0xa9);

    const dir = await transcriptDir({ "a.jsonl": body });
    const r = await scanForRateLimits({ projectsDir: dir, sinceMs: null, maxTranscripts: 100, nowMs: NOW_REAL });
    expect(r.kind).toBe("hits");
    if (r.kind !== "hits") throw new Error("unreachable");
    expect(r.hits[0]?.message).toContain("·");
    // The split line itself must have parsed — a mangled é would make it
    // invalid UTF-8 rather than invalid JSON, so check the count instead.
    expect(r.coverage.linesScanned).toBe(wholeFillers + 2);
  });

  it("counts an empty transcript as opened but yields `unknown` if that is all there was", async () => {
    const dir = await transcriptDir({ "a.jsonl": "" });
    const r = await scanForRateLimits({ projectsDir: dir, sinceMs: null, maxTranscripts: 100, nowMs: NOW_REAL });
    expect(r.coverage.transcriptsOpened).toBe(1);
    expect(r.coverage.linesScanned).toBe(0);
    // Opened a file and read nothing out of it: that is not evidence of quiet.
    expect(r.kind).toBe("unknown");
  });

  it("counts a blank line as a line without pretending it was a record", async () => {
    const dir = await transcriptDir({ "a.jsonl": `\n${fx("transcript-429-five-hour-real.jsonl")}` });
    const r = await scanForRateLimits({ projectsDir: dir, sinceMs: null, maxTranscripts: 100, nowMs: NOW_REAL });
    expect(r.kind).toBe("hits");
    if (r.kind !== "hits") throw new Error("unreachable");
    expect(r.coverage.linesScanned).toBe(2);
    expect(r.coverage.candidateLines).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// WINDOW ROLLOVER — the one case where the same account's cache and one of its
// own rejections legitimately disagree, and the reason the order of the expiry
// filter and the contradiction filter is load-bearing.
//
// Spotted by the dashboard session on 2026-09-08 before it could happen. These
// tests PIN THE ORDER, not the outcome: both orderings produce a verdict of
// `ok`, so an assertion on `level` alone would pass either way and prove
// nothing. What separates them is which of the two counts the rejection lands
// in — "already reset" (correct: it is this account's, and it is over) versus
// "another account's" (wrong: it is this account's own rolled-over window).
// ---------------------------------------------------------------------------

describe("computeUsageVerdict — a rolled-over window is this account's, not somebody else's", () => {
  /**
   * The concrete case: a `five_hour` rejection at 06:02 naming `resetsAt` 06:30,
   * against a cache fetched at 06:35 whose `five_hour` window resets at 11:30.
   * Same account throughout. Two reset instants five hours apart is ordinary
   * rollover; two minutes apart would be impossible.
   */
  const NOW = Date.parse("2026-09-08T07:00:00.000Z");
  const rolledOver = () =>
    hit({
      window: "five_hour",
      resetsAtMs: Date.parse("2026-09-08T06:30:00.000Z"), // already reset by NOW
      hitAt: "2026-09-08T06:02:47.112Z",
      hitAtMs: Date.parse("2026-09-08T06:02:47.112Z"),
      claudeSessionId: "cb936df3-428d-436f-a731-3397cf339abd",
    });
  const cacheAfterRollover = (): UsageCacheReading => ({
    kind: "value",
    accountUuid: "0f5e9c11-1111-4111-8111-000000000001",
    fetchedAtMs: Date.parse("2026-09-08T06:35:00.000Z"),
    ageMs: NOW - Date.parse("2026-09-08T06:35:00.000Z"),
    windows: [
      {
        kind: "value",
        window: "five_hour",
        utilizationPercent: 3,
        resetsAt: "2026-09-08T11:30:00.000Z",
        resetsAtMs: Date.parse("2026-09-08T11:30:00.000Z"),
        msUntilReset: Date.parse("2026-09-08T11:30:00.000Z") - NOW,
      },
    ],
  });
  const verdictFor = (hits: RateLimitHit[]) =>
    computeUsageVerdict({
      account: parseAuthStatus(fx("auth-status-real.json"), fxJson("claude-json-real.json")),
      cache: cacheAfterRollover(),
      rateLimits: { kind: "hits", hits, coverage: emptyCoverage({ transcriptsOpened: 3, linesScanned: 300 }) },
      nowMs: NOW,
    });

  it("counts it as ALREADY RESET, never as another account's", () => {
    const v = verdictFor([rolledOver()]);
    const said = v.reasons.join(" ");
    expect(said).toContain("1 already reset");
    // If the contradiction filter ever ran before the expiry filter, this
    // rejection would be counted as somebody else's. It is not somebody
    // else's — it is this account's own window, five hours ago.
    expect(said).not.toContain("another account's");
    expect(said).not.toContain("not this account's");
  });

  it("still sets aside a genuinely foreign rejection in the same run", () => {
    // Both in one verdict, so the two paths cannot be satisfied by one branch:
    // the rolled-over one is expired, the foreign one is in force but has a
    // reset instant this account's live window contradicts.
    const foreign = hit({
      window: "five_hour",
      resetsAtMs: Date.parse("2026-09-08T09:00:00.000Z"), // in force at NOW, but not 11:30
      // BEFORE the cache was fetched (06:35), which matters: a cache older than
      // a rejection cannot speak to it, and `attributeCache` refuses to try.
      // This fixture originally put the rejection at 06:55 — after the fetch —
      // and the stricter rule correctly declined to judge it.
      hitAt: "2026-09-08T06:20:00.000Z",
      hitAtMs: Date.parse("2026-09-08T06:20:00.000Z"),
    });
    const said = verdictFor([rolledOver(), foreign]).reasons.join(" ");
    expect(said).toContain("1 already reset");
    expect(said).toContain("1 unattributable");
  });

  it("contradictsCachedWindow ALONE would misjudge it — which is why the caller filters first", () => {
    // Called directly, with no expiry filter in front of it, the rule does get
    // this wrong. That is not a defect in the rule; it is the precondition the
    // rule documents and the callers honour. Asserted so that anyone tempted to
    // "fix" it inside the function sees what the function is actually for.
    expect(contradictsCachedWindow(rolledOver(), realAccount(), cacheAfterRollover())).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The fixes from GPT Sol's review, each with the test that would have caught
// the defect. Written after a mutation pass showed that seven of the ten fixes
// were unguarded — the code was right and nothing would have noticed it going
// wrong again, which is the same "a fix nothing checks" shape as the defects
// themselves.
// ---------------------------------------------------------------------------

describe("Sol's findings — the guards, and what each one catches", () => {
  it("finding 4: a rejection whose quota object was RENAMED is malformed, not silence", async () => {
    // `transcript-429-renamed-quota.jsonl` deliberately contains no
    // `rateLimitType` anywhere: it keeps `"error":"rate_limit"` and
    // `apiErrorStatus: 429` but calls the object `quotaLimitsV2` with a
    // `windowKind` inside. Under the original single-marker prefilter this line
    // was never even a candidate, so the scan reported a confident `none`.
    const line = fx("transcript-429-renamed-quota.jsonl").trim();
    expect(line).not.toContain("rateLimitType");
    const r = parseRateLimitLine(line, "/fake/t.jsonl");
    expect(r.kind).toBe("malformed");
    if (r.kind !== "malformed") throw new Error("unreachable");
    expect(r.why).toContain("no quotaLimits object");

    // …and end to end, the scan must say `unknown` rather than `none`.
    const dir = await transcriptDir({ "a.jsonl": fx("transcript-429-renamed-quota.jsonl") });
    const scan = await scanForRateLimits({ projectsDir: dir, sinceMs: null, maxTranscripts: 100, nowMs: NOW_REAL });
    expect(scan.kind).toBe("unknown");
    expect(scan.coverage.candidateLines).toBe(1);
    expect(scan.coverage.malformedCandidates).toBe(1);
  });

  it("finding 5: isApiErrorMessage alone must not mint a rate-limit hit", () => {
    // A generic API failure that happens to carry a quota report. Three ORed
    // signals used to make this a hit, and a hit can produce LIMITED.
    const line = JSON.stringify({
      type: "assistant",
      timestamp: "2026-09-08T10:00:00.000Z",
      isApiErrorMessage: true,
      apiErrorStatus: 500,
      error: "overloaded",
      quotaLimits: { status: "allowed", resetsAt: 1788880000, rateLimitType: "five_hour" },
    });
    expect(parseRateLimitLine(line, "/fake/t.jsonl").kind).toBe("no-error-signal");
  });

  it("finding 6: unrecognised auth output is unknown, not confidently logged out", () => {
    for (const stdout of ["{}", '{"loggedIn":"yes"}', '{"signedIn":true}', '{"loggedIn":null}']) {
      const r = parseAuthStatus(stdout, null);
      expect(r.kind, stdout).toBe("unknown");
    }
    // Only an explicit false is an answer.
    expect(parseAuthStatus('{"loggedIn":false}', null).kind).toBe("logged-out");
  });

  it("finding 6: logged in with no identity at all is unknown, not an account of nulls", () => {
    expect(parseAuthStatus('{"loggedIn":true}', null).kind).toBe("unknown");
    // And a config describing a different organisation than the login cannot be
    // merged into one account.
    const mismatched = parseAuthStatus(fx("auth-status-real.json"), {
      oauthAccount: { accountUuid: "x", organizationUuid: "SOMETHING-ELSE" },
    });
    expect(mismatched.kind).toBe("unknown");
    if (mismatched.kind !== "unknown") throw new Error("unreachable");
    expect(mismatched.why).toContain("stale relative to the login");
  });

  it("finding 7: a utilization outside 0-100 is unknown, not a trusted reading", () => {
    for (const bad of [-1, 101, 1000]) {
      const r = parseUsageWindow("five_hour", { utilization: bad, resets_at: "2026-09-08T16:00:00Z" }, NOW_REAL);
      expect(r.kind, String(bad)).toBe("unknown");
      if (r.kind !== "unknown") throw new Error("unreachable");
      expect(r.why).toContain("outside 0-100");
    }
    // The boundaries themselves are legitimate.
    expect(parseUsageWindow("five_hour", { utilization: 0, resets_at: "2026-09-08T16:00:00Z" }, NOW_REAL).kind).toBe("value");
    expect(parseUsageWindow("five_hour", { utilization: 100, resets_at: "2026-09-08T16:00:00Z" }, NOW_REAL).kind).toBe("value");
  });

  it("finding 3: one unreadable transcript makes an absence inconclusive", () => {
    // One readable benign transcript alongside any number of unreadable ones
    // used to return `none`.
    const r = summariseRateLimitScan(
      [],
      emptyCoverage({ transcriptsOpened: 1, linesScanned: 200, transcriptsUnreadable: 1, unreadableWhy: ["/x.jsonl: ENOENT"] }),
    );
    expect(r.kind).toBe("unknown");
    if (r.kind !== "unknown") throw new Error("unreachable");
    expect(r.why).toContain("could not be read");
  });

  it("finding 3: one unparsed candidate alongside a parsed one makes an absence inconclusive", () => {
    // Only "ALL candidates unparsed" used to be rejected.
    const r = summariseRateLimitScan([], emptyCoverage({ transcriptsOpened: 3, linesScanned: 900, candidateLines: 2, linesParsed: 1 }));
    expect(r.kind).toBe("unknown");
    if (r.kind !== "unknown") throw new Error("unreachable");
    expect(r.why).toContain("did not parse as JSON");
  });

  it("finding 3: a known EXPIRED hit no longer short-circuits the malformed check", () => {
    // `hits` is still returned — what was found was found — but the verdict must
    // not read "nothing in force" off a scan that could not read its own
    // candidates.
    const scan = summariseRateLimitScan(
      [hit({ resetsAtMs: NOW_REAL - 1 })],
      emptyCoverage({ transcriptsOpened: 3, linesScanned: 900, candidateLines: 2, linesParsed: 2, malformedCandidates: 1, sinceMs: null }),
    );
    expect(scan.kind).toBe("hits");
    const v = computeUsageVerdict({ account: realAccount(), cache: liveCacheForSol(), rateLimits: scan, nowMs: NOW_REAL });
    expect(v.level).toBe("unknown");
    expect(v.reasons.join(" ")).toContain("was itself incomplete");
  });

  it("finding 2: a scan shorter than the longest window cannot conclude an absence", () => {
    const short = summariseRateLimitScan([], emptyCoverage({ transcriptsOpened: 240, linesScanned: 237547, sinceMs: 24 * 3600_000 }));
    expect(short.kind).toBe("unknown");
    if (short.kind !== "unknown") throw new Error("unreachable");
    expect(short.why).toContain("seven-day rejection can still be in force");

    // The default window is long enough, and then an absence is an answer.
    const full = summariseRateLimitScan([], emptyCoverage({ transcriptsOpened: 240, linesScanned: 237547, sinceMs: DEFAULT_SINCE_MS }));
    expect(full.kind).toBe("none");
  });

  it("finding 2: the default window is at least as long as the longest active window", () => {
    // The two constants have to move together; this is the assertion that says so.
    expect(DEFAULT_SINCE_MS).toBeGreaterThanOrEqual(LONGEST_ACTIVE_WINDOW_MS);
  });

  it("finding 8: the known-window list and its type cannot drift apart", () => {
    // `Record<KnownUsageWindow, true>` is checked in both directions, unlike the
    // array this used to be. The runtime list is derived from it.
    expect([...KNOWN_USAGE_WINDOWS].sort()).toEqual(["five_hour", "seven_day"]);
    expect(isKnownUsageWindow("five_hour")).toBe(true);
    expect(isKnownUsageWindow("seven_day")).toBe(true);
    expect(isKnownUsageWindow("nimbus_quill")).toBe(false);
    // Not fooled by inherited properties, which `Object.hasOwn` is the fix for.
    expect(isKnownUsageWindow("toString")).toBe(false);
    expect(isKnownUsageWindow("constructor")).toBe(false);
  });
});

/** The real cache, attributable to `realAccount()`. */
const liveCacheForSol = () => parseUsageCache(fxJson("claude-json-real.json"), NOW_REAL);

// ---------------------------------------------------------------------------
// GPT Sol's ROUND-2 findings, each with the guard that catches it. Round 1
// taught the lesson that a fix nobody checks is half a fix, so these were
// written alongside the changes rather than after a mutation pass found them
// missing.
// ---------------------------------------------------------------------------

describe("Sol round 2 — the guards", () => {
  it("finding 1: `classifyHit` distinguishes ours / contradicted / cannot-attribute", () => {
    const h = hit({ window: "five_hour", hitAt: "2026-09-08T11:00:00.000Z", hitAtMs: Date.parse("2026-09-08T11:00:00.000Z") });

    // Confirmed: same account, cache fetched after, window agrees.
    expect(classifyHit(h, realAccount(), cacheConfirming(h)).kind).toBe("ours");

    // Contradicted: same account, cache fetched after, window disagrees.
    const disagreeing: UsageCacheReading = {
      kind: "value",
      accountUuid: ACCOUNT_UUID,
      fetchedAtMs: (h.hitAtMs ?? 0) + 1000,
      ageMs: 1000,
      windows: [
        {
          kind: "value",
          window: "five_hour",
          utilizationPercent: 3,
          resetsAt: new Date(h.resetsAtMs + 9e6).toISOString(),
          resetsAtMs: h.resetsAtMs + 9e6,
          msUntilReset: 1,
        },
      ],
    };
    expect(classifyHit(h, realAccount(), disagreeing).kind).toBe("contradicted");

    // Cannot attribute: no account, no cache — and crucially NOT the same
    // answer as "ours". This was one value (`null`) for both until round 2.
    expect(classifyHit(h, NO_ACCOUNT, NO_CACHE).kind).toBe("cannot-attribute");
    // …nor when the cache simply has no such window to compare against.
    expect(classifyHit(hit({ window: "nimbus_quill" }), realAccount(), cacheConfirming(h)).kind).toBe("cannot-attribute");
  });

  it("finding 1: the cache must be fetched STRICTLY after the rejection, and the rejection must be dated", () => {
    const h = hit({ hitAt: "2026-09-08T11:00:00.000Z", hitAtMs: Date.parse("2026-09-08T11:00:00.000Z") });
    const sameMs: UsageCacheReading = { ...(cacheConfirming(h) as Extract<UsageCacheReading, { kind: "value" }>), fetchedAtMs: h.hitAtMs ?? 0 };
    // Equal timestamps used to pass, because the comparison was `<`.
    expect(classifyHit(h, realAccount(), sameMs).kind).toBe("cannot-attribute");

    // An undated rejection cannot have its chronology checked at all.
    const undated = hit({ hitAt: null, hitAtMs: null });
    const c = classifyHit(undated, realAccount(), cacheConfirming(h));
    expect(c.kind).toBe("cannot-attribute");
    if (c.kind !== "cannot-attribute") throw new Error("unreachable");
    expect(c.why).toContain("no timestamp");
  });

  it("finding 3: an unterminated final line that is not valid JSON makes the transcript unreadable", async () => {
    // MEASURED FIRST: zero of 1,772 transcripts on this box end without a
    // trailing newline, so this fires on genuine truncation rather than on
    // ordinary concurrent writing.
    const dir = await transcriptDir({
      "a.jsonl": `${fx("transcript-no-429-real.jsonl")}{"type":"assistant","timestamp":"2026-09-08`,
    });
    const r = await scanForRateLimits({ projectsDir: dir, sinceMs: null, maxTranscripts: 100, nowMs: NOW_REAL });
    // The half-written record carries no marker, so it used to be invisible and
    // the scan returned `none` with two lines scanned.
    expect(r.kind).toBe("unknown");
    expect(r.coverage.transcriptsUnreadable).toBe(1);
    if (r.kind !== "unknown") throw new Error("unreachable");
    expect(r.why).toContain("not valid JSON");
  });

  it("finding 3: and a benign transcript beside it cannot rescue the absence", async () => {
    // The version above has only one transcript, so it trips the "opened
    // nothing" clause. This is the shape that actually mattered: a readable
    // benign file that would otherwise support `none`.
    const dir = await transcriptDir({
      "good.jsonl": fx("transcript-no-429-real.jsonl"),
      "truncated.jsonl": `${fx("transcript-no-429-real.jsonl")}{"type":"assistant","timestamp":"2026-09-08`,
    });
    const r = await scanForRateLimits({ projectsDir: dir, sinceMs: null, maxTranscripts: 100, nowMs: NOW_REAL });
    expect(r.kind).toBe("unknown");
    expect(r.coverage.transcriptsOpened).toBe(1);
    expect(r.coverage.transcriptsUnreadable).toBe(1);
    if (r.kind !== "unknown") throw new Error("unreachable");
    expect(r.why).toContain("could not be read");
  });

  it("finding 3: a valid final record without a newline is still fine", async () => {
    const dir = await transcriptDir({ "a.jsonl": fx("transcript-429-five-hour-real.jsonl").trimEnd() });
    const r = await scanForRateLimits({ projectsDir: dir, sinceMs: null, maxTranscripts: 100, nowMs: NOW_REAL });
    expect(r.kind).toBe("hits");
    expect(r.coverage.transcriptsUnreadable).toBe(0);
  });

  it("finding 4: a quotaLimits saying `rejected` with no outer signal is malformed, not benign", () => {
    const line = JSON.stringify({
      type: "assistant",
      timestamp: "2026-09-08T10:00:00.000Z",
      quotaLimits: { status: "rejected", rateLimitType: "five_hour", resetsAt: 1788872400 },
    });
    const r = parseRateLimitLine(line, "/fake/t.jsonl");
    expect(r.kind).toBe("malformed");
    // …and therefore an absence built on it cannot be believed.
    const scan = summariseRateLimitScan([], emptyCoverage({ transcriptsOpened: 2, linesScanned: 90, candidateLines: 1, linesParsed: 1, malformedCandidates: 1, sinceMs: null }));
    expect(scan.kind).toBe("unknown");
  });

  it("finding 4: an outer rejection with a quota object saying `allowed` is malformed, not a hit", () => {
    const line = JSON.stringify({
      type: "assistant",
      timestamp: "2026-09-08T10:00:00.000Z",
      error: "rate_limit",
      apiErrorStatus: 429,
      quotaLimits: { status: "allowed", rateLimitType: "five_hour", resetsAt: 1788872400 },
    });
    expect(parseRateLimitLine(line, "/fake/t.jsonl").kind).toBe("malformed");
  });

  it("finding 4: a genuine `allowed` quota report with no outer signal stays benign", () => {
    const line = JSON.stringify({
      type: "assistant",
      quotaLimits: { status: "allowed", rateLimitType: "five_hour", resetsAt: 1788872400 },
    });
    expect(parseRateLimitLine(line, "/fake/t.jsonl").kind).toBe("no-error-signal");
  });

  it("finding 5: a one-sided organisation identity does not license the OAuth join", () => {
    // Current auth naming an org, stale OAuth data with an accountUuid and NO
    // organizationUuid. The uuid used to be adopted and could then attribute a
    // cache; now the account is reported without it.
    const r = parseAuthStatus(fx("auth-status-real.json"), { oauthAccount: { accountUuid: "OLD-ACCOUNT" } });
    expect(r.kind).toBe("value");
    if (r.kind !== "value") throw new Error("unreachable");
    expect(r.email).toBe("greg@rehearsable.ai");
    expect(r.accountUuid).toBeNull();
    expect(r.rateLimitTier).toBeNull();

    // The other one-sided case: an org uuid in the config, none from auth.
    const noAuthOrg = parseAuthStatus(JSON.stringify({ loggedIn: true, email: "greg@rehearsable.ai" }), {
      oauthAccount: { accountUuid: "OLD-ACCOUNT", organizationUuid: "SOME-ORG" },
    });
    expect(noAuthOrg.kind).toBe("value");
    if (noAuthOrg.kind !== "value") throw new Error("unreachable");
    expect(noAuthOrg.accountUuid).toBeNull();
  });

  it("finding 6: a symlinked transcript is counted as outside coverage, not skipped", async () => {
    const dir = await transcriptDir({ "a.jsonl": fx("transcript-no-429-real.jsonl") });
    const project = path.join(dir, "-home-greg-code-spideryarn2");
    await symlink(path.join(project, "a.jsonl"), path.join(project, "b.jsonl"));
    const r = await scanForRateLimits({ projectsDir: dir, sinceMs: null, maxTranscripts: 100, nowMs: NOW_REAL });
    // A benign real transcript beside it must not be able to support `none`.
    expect(r.kind).toBe("unknown");
    expect(r.coverage.transcriptsUnreadable).toBe(1);
    expect(r.coverage.unreadableWhy.join(" ")).toContain("symlink");
  });

  it("finding 9: the null-accountUuid branch gives its own diagnostic, which is why it exists", () => {
    // I called this an equivalent mutant on the strength of `kind` alone. The
    // `why` differs, and the `why` is the half a person reads.
    const withUuidCache = attributeCache(
      { kind: "value", email: "e", orgId: "o", orgName: null, subscriptionType: "max", accountUuid: null, rateLimitTier: null },
      cacheConfirming(hit()),
      null,
    );
    expect(withUuidCache.kind).toBe("cannot-attribute");
    if (withUuidCache.kind !== "cannot-attribute") throw new Error("unreachable");
    // Blames the ACCOUNT's missing field, not a mismatch against `null`.
    expect(withUuidCache.why).toContain("the logged-in account has no accountUuid");
    expect(withUuidCache.why).not.toContain("belongs to account");
  });
});

describe("Sol round 2 — finding 8, the same-window tolerance is exactly what the formats justify", () => {
  const at = (isoMs: number) => Date.parse("2026-09-12T18:00:00.000Z") + isoMs;
  const hitAt = Date.parse("2026-09-08T11:00:00.000Z");
  const cacheResettingAt = (resetsAtMs: number): UsageCacheReading => ({
    kind: "value",
    accountUuid: ACCOUNT_UUID,
    fetchedAtMs: hitAt + 1000,
    ageMs: 1000,
    windows: [
      {
        kind: "value",
        window: "seven_day",
        utilizationPercent: 22,
        resetsAt: new Date(resetsAtMs).toISOString(),
        resetsAtMs,
        msUntilReset: 1,
      },
    ],
  });
  const hitResettingAt = (resetsAtMs: number) =>
    hit({ window: "seven_day", resetsAtMs, hitAt: "2026-09-08T11:00:00.000Z", hitAtMs: hitAt });

  it("treats a sub-second difference as one window — whole seconds against milliseconds", () => {
    // The real pair: cache `…:59.790550+00:00`, transcript a whole unix second.
    expect(classifyHit(hitResettingAt(at(0)), realAccount(), cacheResettingAt(at(790))).kind).toBe("ours");
    expect(classifyHit(hitResettingAt(at(0)), realAccount(), cacheResettingAt(at(-999))).kind).toBe("ours");
  });

  it("treats a FOUR-SECOND difference as two windows, which five seconds did not", () => {
    // Sol's inverse argument: a wide bound manufactures false ATTRIBUTION. Two
    // accounts whose resets fall four seconds apart were one window at a
    // five-second tolerance, and could produce `limited` for the wrong account.
    expect(classifyHit(hitResettingAt(at(0)), realAccount(), cacheResettingAt(at(4000))).kind).toBe("contradicted");
    expect(classifyHit(hitResettingAt(at(0)), realAccount(), cacheResettingAt(at(1001))).kind).toBe("contradicted");
  });
});

// ---------------------------------------------------------------------------
// `RateLimitHit.id` — STABLE ACROSS SCANS.
//
// Requested by the Overseer session that will carry rejections forward between
// scans, and the test it asked for specifically. An id that changed per pass
// would make every rejection look new: nothing would ever be matched to what is
// already known, nothing would throw, and the count would quietly drift. That
// is a property an innocent-looking change can break — adding a nonce, a scan
// counter, a timestamp — with the rest of the suite staying green.
// ---------------------------------------------------------------------------

describe("RateLimitHit.id", () => {
  it("is IDENTICAL when the same transcript is scanned twice", async () => {
    const dir = await transcriptDir({
      "a.jsonl": fx("transcript-429-five-hour-real.jsonl"),
      "b.jsonl": fx("transcript-429-seven-day-real.jsonl"),
    });
    const args = { projectsDir: dir, sinceMs: null, maxTranscripts: 100, nowMs: NOW_REAL } as const;
    const first = await scanForRateLimits({ ...args });
    const second = await scanForRateLimits({ ...args });
    if (first.kind !== "hits" || second.kind !== "hits") throw new Error("unreachable");
    expect(first.hits.map((h) => h.id)).toEqual(second.hits.map((h) => h.id));
    expect(first.hits[0]?.id).toMatch(/^[0-9a-f]{20}$/);
  });

  it("differs between two rejections, and between the same record in two transcripts", () => {
    const fiveHour = parseRateLimitLine(fx("transcript-429-five-hour-real.jsonl").trim(), "/fake/a.jsonl");
    const sevenDay = parseRateLimitLine(fx("transcript-429-seven-day-real.jsonl").trim(), "/fake/a.jsonl");
    const elsewhere = parseRateLimitLine(fx("transcript-429-five-hour-real.jsonl").trim(), "/fake/b.jsonl");
    if (fiveHour.kind !== "hit" || sevenDay.kind !== "hit" || elsewhere.kind !== "hit") throw new Error("unreachable");
    expect(fiveHour.hit.id).not.toBe(sevenDay.hit.id);
    expect(fiveHour.hit.id).not.toBe(elsewhere.hit.id);
  });

  it("does not depend on anything outside the three parts it is derived from", () => {
    // If the derivation ever picked up the clock or a counter, this would drift.
    const a = rateLimitHitId("/p/t.jsonl", "2026-09-08T06:02:47.112Z", "five_hour");
    const b = rateLimitHitId("/p/t.jsonl", "2026-09-08T06:02:47.112Z", "five_hour");
    expect(a).toBe(b);
    expect(rateLimitHitId("/p/t.jsonl", "2026-09-08T06:02:47.112Z", "seven_day")).not.toBe(a);
    expect(rateLimitHitId("/p/u.jsonl", "2026-09-08T06:02:47.112Z", "five_hour")).not.toBe(a);
    expect(rateLimitHitId("/p/t.jsonl", "2026-09-08T06:02:48.112Z", "five_hour")).not.toBe(a);
    // An undated rejection is a defined, non-throwing case — it simply cannot be
    // carried forward, because `classifyHit` refuses it on chronology anyway.
    expect(rateLimitHitId("/p/t.jsonl", null, "five_hour")).toMatch(/^[0-9a-f]{20}$/);
  });

  it("carries no filesystem path into the id, which is why it is hashed", () => {
    // The dashboard declined `transcriptPath` as a field for the page; an id
    // that embedded it would smuggle it back in.
    const id = rateLimitHitId("/home/greg/.claude/projects/-secret-path/x.jsonl", "2026-09-08T06:02:47.112Z", "five_hour");
    expect(id).not.toContain("greg");
    expect(id).not.toContain("secret");
    expect(id).not.toContain("/");
  });
});
