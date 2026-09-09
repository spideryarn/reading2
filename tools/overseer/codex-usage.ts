/**
 * The ChatGPT/Codex subscription's live usage reading.
 *
 * This mirrors the pure/impure split and explicit-unknown rule documented in
 * tools/overseer/usage.ts. The source-specific measurements and protocol traps
 * are in docs/plans/260909d-read-the-codex-subscription-usage-limits-and-show-them-beside-claude-s.md.
 */
import { spawn } from "node:child_process";
import { isDeepStrictEqual } from "node:util";

import { sanitisedEnv } from "../../scripts/subagent-cli.js";
import type { CodexUsageBucket, CodexUsageReading, CodexUsageWindow } from "../fleet/wire.js";

export type { CodexUsageBucket, CodexUsageReading, CodexUsageWindow };

type ParseResult<T> = { kind: "value"; value: T } | { kind: "unknown"; why: string };

export type CodexSessionUsageParse = ParseResult<{
  observedAt: string;
  bucket: CodexUsageBucket;
}>;

type CodexUsageChild = {
  pid: number | undefined;
  writeStdin: (line: string) => void;
  endStdin: () => void;
  onStdout: (listener: (chunk: Buffer | string) => void) => void;
  onError: (listener: (error: Error) => void) => void;
  onExit: (listener: (code: number | null, signal: NodeJS.Signals | null) => void) => void;
};

export type CodexUsageExecutor = {
  spawn: (
    command: string,
    args: readonly string[],
    options: {
      detached: true;
      env: NodeJS.ProcessEnv;
      stdio: readonly ["pipe", "pipe", "ignore"];
    },
  ) => CodexUsageChild;
  kill: (pid: number, signal: NodeJS.Signals) => void;
};

export type CollectCodexUsageOptions = {
  nowMs?: number;
  timeoutMs?: number;
  /** If supplied, a different non-null accountId makes the reading unusable. */
  expectedAccountId?: string;
  /** Parent environment, injectable so the exact child environment is testable. */
  env?: NodeJS.ProcessEnv;
  /** The subprocess seam. Production gets the real app-server when this is omitted. */
  executor?: CodexUsageExecutor;
};

export const DEFAULT_CODEX_USAGE_TIMEOUT_MS = 20_000;

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nonemptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nullableString(value: unknown): ParseResult<string | null> {
  if (value === null || value === undefined) return { kind: "value", value: null };
  const parsed = nonemptyString(value);
  return parsed === null
    ? { kind: "unknown", why: `expected a non-empty string or null, got ${JSON.stringify(value)}` }
    : { kind: "value", value: parsed };
}

function resetInstantMs(value: unknown): number | null {
  const parsed = finiteNumber(value);
  if (parsed === null || parsed <= 0) return null;
  // The app-server and session log currently use unix seconds. Accepting an
  // already-millisecond value prevents a future unit change becoming 1970.
  return parsed > 1e12 ? parsed : parsed * 1000;
}

function isoInstant(value: number): string | null {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function unknownWindow(
  slot: "primary" | "secondary",
  windowMinutes: number | null,
  why: string,
): CodexUsageWindow {
  return { kind: "unknown", slot, windowMinutes, why };
}

function buildWindow(
  slot: "primary" | "secondary",
  rawWindowMinutes: unknown,
  rawUsedPercent: unknown,
  rawResetsAt: unknown,
  sourceAtMs: number,
  sourceNames: { duration: string; percent: string; reset: string },
): CodexUsageWindow {
  const windowMinutes = finiteNumber(rawWindowMinutes);
  if (windowMinutes === null || windowMinutes <= 0) {
    return unknownWindow(
      slot,
      windowMinutes,
      `${sourceNames.duration} was not a positive number (${JSON.stringify(rawWindowMinutes)}); the ${slot} slot is provenance, not a window name, so its duration cannot be guessed`,
    );
  }

  const resetsAtMs = resetInstantMs(rawResetsAt);
  const resetsAt = resetsAtMs === null ? null : isoInstant(resetsAtMs);
  if (resetsAtMs === null || resetsAt === null) {
    return unknownWindow(
      slot,
      windowMinutes,
      `${sourceNames.reset} was not a positive unix timestamp (${JSON.stringify(rawResetsAt)}), so the percentage cannot be checked against a reset`,
    );
  }
  if (resetsAtMs <= sourceAtMs) {
    const sourceAt = isoInstant(sourceAtMs) ?? String(sourceAtMs);
    return unknownWindow(
      slot,
      windowMinutes,
      `${sourceNames.reset} (${resetsAt}) was not later than the source reading (${sourceAt}), so this window cannot be reported as current`,
    );
  }

  const usedPercent = finiteNumber(rawUsedPercent);
  if (usedPercent === null || usedPercent < 0 || usedPercent > 100) {
    return unknownWindow(
      slot,
      windowMinutes,
      `${sourceNames.percent} was not a percentage from 0 to 100 (${JSON.stringify(rawUsedPercent)})`,
    );
  }

  return {
    kind: "value",
    slot,
    windowMinutes,
    usedPercent,
    resetsAt,
    resetsAtMs,
  };
}

function parseAppServerWindow(
  slot: "primary" | "secondary",
  raw: unknown,
  nowMs: number,
): CodexUsageWindow {
  const window = object(raw);
  if (!window) {
    return unknownWindow(slot, null, `the app-server's ${slot} window was not an object: ${JSON.stringify(raw)}`);
  }
  return buildWindow(
    slot,
    window.windowDurationMins,
    window.usedPercent,
    window.resetsAt,
    nowMs,
    { duration: "windowDurationMins", percent: "usedPercent", reset: "resetsAt" },
  );
}

function parseSessionWindow(
  slot: "primary" | "secondary",
  raw: unknown,
  sourceAtMs: number,
): CodexUsageWindow {
  const window = object(raw);
  if (!window) {
    return unknownWindow(slot, null, `the session log's ${slot} window was not an object: ${JSON.stringify(raw)}`);
  }
  // These are deliberately named one by one. The real session source uses
  // window_minutes, not the mechanically converted windowDurationMins.
  return buildWindow(
    slot,
    window.window_minutes,
    window.used_percent,
    window.resets_at,
    sourceAtMs,
    { duration: "window_minutes", percent: "used_percent", reset: "resets_at" },
  );
}

function parseCredits(raw: unknown, source: string): ParseResult<CodexUsageBucket["credits"]> {
  if (raw === null || raw === undefined) return { kind: "value", value: null };
  const credits = object(raw);
  if (!credits) return { kind: "unknown", why: `${source}.credits was not an object or null` };
  const hasCredits = credits.hasCredits ?? credits.has_credits;
  const unlimited = credits.unlimited;
  const balance = credits.balance;
  if (typeof hasCredits !== "boolean" || typeof unlimited !== "boolean") {
    return { kind: "unknown", why: `${source}.credits did not carry boolean hasCredits and unlimited fields` };
  }
  if (balance !== null && balance !== undefined && typeof balance !== "string") {
    return { kind: "unknown", why: `${source}.credits.balance was not a string or null` };
  }
  return {
    kind: "value",
    value: { hasCredits, unlimited, balance: typeof balance === "string" ? balance : null },
  };
}

/** Parse one camelCase app-server bucket without assigning meaning to its slots. */
export function parseCodexUsageBucket(
  raw: unknown,
  nowMs: number,
  expectedLimitId?: string,
): ParseResult<CodexUsageBucket> {
  if (isoInstant(nowMs) === null) return { kind: "unknown", why: `source time was not a valid instant: ${String(nowMs)}` };
  const bucket = object(raw);
  if (!bucket) return { kind: "unknown", why: `rate-limit bucket was not an object: ${JSON.stringify(raw)}` };

  const limitId = nonemptyString(bucket.limitId);
  if (limitId === null) return { kind: "unknown", why: `rate-limit bucket had no non-empty limitId` };
  if (expectedLimitId !== undefined && limitId !== expectedLimitId) {
    return {
      kind: "unknown",
      why: `rateLimitsByLimitId key ${JSON.stringify(expectedLimitId)} disagreed with its bucket's limitId ${JSON.stringify(limitId)}`,
    };
  }

  const limitName = nullableString(bucket.limitName);
  if (limitName.kind === "unknown") return limitName;
  const planType = nullableString(bucket.planType);
  if (planType.kind === "unknown") return planType;
  const reached = nullableString(bucket.rateLimitReachedType);
  if (reached.kind === "unknown") return reached;
  const credits = parseCredits(bucket.credits, `bucket ${limitId}`);
  if (credits.kind === "unknown") return credits;

  const windows: CodexUsageWindow[] = [];
  for (const slot of ["primary", "secondary"] as const) {
    const value = bucket[slot];
    if (value !== null && value !== undefined) windows.push(parseAppServerWindow(slot, value, nowMs));
  }

  return {
    kind: "value",
    value: {
      limitId,
      limitName: limitName.value,
      windows,
      planType: planType.value,
      credits: credits.value,
      rateLimitReachedType: reached.value,
    },
  };
}

function parseSessionBucket(raw: unknown, sourceAtMs: number): ParseResult<CodexUsageBucket> {
  const bucket = object(raw);
  if (!bucket) return { kind: "unknown", why: `session rate_limits was not an object` };
  const limitId = nonemptyString(bucket.limit_id);
  if (limitId === null) return { kind: "unknown", why: `session rate_limits had no non-empty limit_id` };
  const limitName = nullableString(bucket.limit_name);
  if (limitName.kind === "unknown") return limitName;
  const planType = nullableString(bucket.plan_type);
  if (planType.kind === "unknown") return planType;
  const reached = nullableString(bucket.rate_limit_reached_type);
  if (reached.kind === "unknown") return reached;
  const credits = parseCredits(bucket.credits, `session bucket ${limitId}`);
  if (credits.kind === "unknown") return credits;

  const windows: CodexUsageWindow[] = [];
  for (const slot of ["primary", "secondary"] as const) {
    const value = bucket[slot];
    if (value !== null && value !== undefined) windows.push(parseSessionWindow(slot, value, sourceAtMs));
  }
  return {
    kind: "value",
    value: {
      limitId,
      limitName: limitName.value,
      windows,
      planType: planType.value,
      credits: credits.value,
      rateLimitReachedType: reached.value,
    },
  };
}

/**
 * Parse a session-log snapshot for source-shape coverage only.
 *
 * collectCodexUsage never calls this: a historical observation is not a safe
 * live fallback. Keeping its result distinct from CodexUsageReading makes that
 * boundary visible in the type system.
 */
export function parseCodexSessionUsage(record: unknown, nowMs: number): CodexSessionUsageParse {
  if (isoInstant(nowMs) === null) return { kind: "unknown", why: `current time was not a valid instant: ${String(nowMs)}` };
  const root = object(record);
  const payload = object(root?.payload);
  if (!root || !payload || root.type !== "event_msg" || payload.type !== "token_count") {
    return { kind: "unknown", why: `record was not an event_msg/token_count session record` };
  }
  const observedAt = nonemptyString(root.timestamp);
  const sourceAtMs = observedAt === null ? Number.NaN : Date.parse(observedAt);
  if (observedAt === null || !Number.isFinite(sourceAtMs)) {
    return { kind: "unknown", why: `session record timestamp was not a parseable date` };
  }
  if (sourceAtMs > nowMs) {
    return { kind: "unknown", why: `session record timestamp ${observedAt} is later than the supplied current time` };
  }
  const bucket = parseSessionBucket(payload.rate_limits, sourceAtMs);
  if (bucket.kind === "unknown") return bucket;
  return { kind: "value", value: { observedAt, bucket: bucket.value } };
}

function unknownReply(why: string, retryable: boolean): CodexUsageReading {
  return { kind: "unknown", why, retryable };
}

function readAppServerError(root: Record<string, unknown>): CodexUsageReading | null {
  if (root.error === null || root.error === undefined) return null;
  const error = object(root.error);
  if (!error) return unknownReply(`Codex app-server error was not an object`, false);
  const code = finiteNumber(error.code);
  const message = nonemptyString(error.message) ?? `Codex app-server returned an error without a message`;
  if (code === -32600) return unknownReply(`${message} — run codex login for this CODEX_HOME`, false);
  if (code === -32603) return unknownReply(message, true);
  return unknownReply(`Codex app-server error ${code ?? "with no numeric code"}: ${message}`, false);
}

function readAccountId(result: Record<string, unknown>): ParseResult<string | null> {
  if (result.accountId === null || result.accountId === undefined) return { kind: "value", value: null };
  const accountId = nonemptyString(result.accountId);
  return accountId === null
    ? { kind: "unknown", why: `accountId was not a non-empty string or null` }
    : { kind: "value", value: accountId };
}

function readBuckets(result: Record<string, unknown>, nowMs: number): ParseResult<CodexUsageBucket[]> {
  const rawMapValue = result.rateLimitsByLimitId;
  const hasCanonicalMap = rawMapValue !== null && rawMapValue !== undefined;
  if (!hasCanonicalMap) {
    const fallback = parseCodexUsageBucket(result.rateLimits, nowMs);
    if (fallback.kind === "unknown") {
      return {
        kind: "unknown",
        why: `no canonical rateLimitsByLimitId map and the rateLimits fallback was unusable: ${fallback.why}`,
      };
    }
    return fallback.value.limitId === "codex"
      ? { kind: "value", value: [fallback.value] }
      : {
          kind: "unknown",
          why: `no canonical rateLimitsByLimitId map and the fallback bucket was ${fallback.value.limitId}, not the general codex bucket`,
        };
  }

  const rawMap = object(rawMapValue);
  if (!rawMap) return { kind: "unknown", why: `rateLimitsByLimitId was present but was not an object` };
  const rawTarget = rawMap.codex;
  if (rawTarget === undefined) {
    return {
      kind: "unknown",
      why: `rateLimitsByLimitId was present but had no general codex bucket; model-specific buckets cannot substitute for subscription headroom`,
    };
  }

  const buckets: CodexUsageBucket[] = [];
  for (const [key, rawBucket] of Object.entries(rawMap)) {
    const bucket = parseCodexUsageBucket(rawBucket, nowMs, key);
    if (bucket.kind === "unknown") return bucket;
    buckets.push(bucket.value);
  }

  if (result.rateLimits !== null && result.rateLimits !== undefined) {
    const bare = object(result.rateLimits);
    if (!bare) return { kind: "unknown", why: `rateLimits was present but was not an object` };
    if (bare.limitId === "codex" && !isDeepStrictEqual(bare, rawTarget)) {
      return { kind: "unknown", why: `the general codex snapshots in rateLimits and rateLimitsByLimitId disagreed` };
    }
  }
  return { kind: "value", value: buckets };
}

function readResetCredits(result: Record<string, unknown>): ParseResult<number | null> {
  if (result.rateLimitResetCredits === null || result.rateLimitResetCredits === undefined) {
    return { kind: "value", value: null };
  }
  const availableCount = finiteNumber(object(result.rateLimitResetCredits)?.availableCount);
  return availableCount !== null && Number.isInteger(availableCount) && availableCount >= 0
    ? { kind: "value", value: availableCount }
    : { kind: "unknown", why: `rateLimitResetCredits.availableCount was not a non-negative integer` };
}

/** Parse one complete JSON-RPC reply from account/rateLimits/read. */
export function parseCodexAppServerReply(reply: unknown, nowMs: number): CodexUsageReading {
  const readAt = isoInstant(nowMs);
  if (readAt === null) return unknownReply(`source time was not a valid instant: ${String(nowMs)}`, false);
  const root = object(reply);
  if (!root) return unknownReply(`Codex app-server reply was not an object`, false);

  const appServerError = readAppServerError(root);
  if (appServerError) return appServerError;

  const result = object(root.result);
  if (!result) return unknownReply(`Codex app-server reply had neither a usable result nor an error`, false);
  const accountId = readAccountId(result);
  if (accountId.kind === "unknown") return unknownReply(accountId.why, false);
  const buckets = readBuckets(result, nowMs);
  if (buckets.kind === "unknown") return unknownReply(buckets.why, false);
  const resetCredits = readResetCredits(result);
  if (resetCredits.kind === "unknown") return unknownReply(resetCredits.why, false);

  return {
    kind: "value",
    accountId: accountId.value,
    readAt,
    buckets: buckets.value,
    resetCredits: resetCredits.value,
  };
}

function jsonMessages(buffer: string): { rest: string; messages: Record<string, unknown>[] } {
  const lines = buffer.split("\n");
  const rest = lines.pop() ?? "";
  const messages: Record<string, unknown>[] = [];
  for (const line of lines) {
    try {
      const message = object(JSON.parse(line));
      if (message) messages.push(message);
    } catch {
      // Unparseable output is not a reply. The hard timeout still bounds it.
    }
  }
  return { rest, messages };
}

function enforceExpectedAccount(
  reading: CodexUsageReading,
  expectedAccountId: string | undefined,
): CodexUsageReading {
  if (reading.kind !== "value" || reading.accountId === null || expectedAccountId === undefined) return reading;
  return reading.accountId === expectedAccountId
    ? reading
    : unknownReply(
        `Codex app-server answered for account ${reading.accountId}, not the intended account ${expectedAccountId}`,
        false,
      );
}

/**
 * Spawn one short-lived app-server and read the reply for request id 2.
 * This is the only function in this module that reads process state or performs I/O.
 */
export async function collectCodexUsage(options: CollectCodexUsageOptions = {}): Promise<CodexUsageReading> {
  const nowMs = options.nowMs ?? Date.now();
  const timeoutMs = options.timeoutMs ?? DEFAULT_CODEX_USAGE_TIMEOUT_MS;
  const parentEnv = options.env ?? process.env;
  // Passing no credentials is run-codex.ts's subscription mode: in particular
  // CODEX_API_KEY is absent, while ordinary HOME and CODEX_HOME survive.
  const childEnv = sanitisedEnv(parentEnv);

  const executor: CodexUsageExecutor = options.executor ?? {
    spawn: (command, args, spawnOptions) => {
      const child = spawn(command, [...args], {
        detached: spawnOptions.detached,
        env: spawnOptions.env,
        stdio: [...spawnOptions.stdio],
      });
      return {
        pid: child.pid,
        writeStdin: (line) => {
          child.stdin.write(line);
        },
        endStdin: () => {
          child.stdin.end();
        },
        onStdout: (listener) => {
          child.stdout.on("data", listener);
        },
        onError: (listener) => {
          child.on("error", listener);
        },
        onExit: (listener) => {
          child.on("exit", listener);
        },
      };
    },
    kill: (pid, signal) => {
      process.kill(pid, signal);
    },
  };

  let child: CodexUsageChild;
  try {
    child = executor.spawn("codex", ["app-server", "--listen", "stdio://"], {
      detached: true,
      env: childEnv,
      stdio: ["pipe", "pipe", "ignore"],
    });
  } catch (error) {
    return unknownReply(`could not start codex app-server: ${error instanceof Error ? error.message : String(error)}`, true);
  }

  return await new Promise<CodexUsageReading>((resolve) => {
    let buffer = "";
    let settled = false;
    let initialized = false;
    let timer: NodeJS.Timeout | undefined;

    const killGroup = (): void => {
      if (child.pid === undefined) return;
      try {
        executor.kill(-child.pid, "SIGKILL");
      } catch {
        // The app-server may already have exited after writing its reply.
      }
    };
    const finish = (reading: CodexUsageReading): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      killGroup();
      resolve(reading);
    };
    const send = (message: unknown): boolean => {
      try {
        child.writeStdin(`${JSON.stringify(message)}\n`);
        return true;
      } catch (error) {
        finish(unknownReply(`could not write to codex app-server: ${error instanceof Error ? error.message : String(error)}`, true));
        return false;
      }
    };

    const handleResponse = (response: Record<string, unknown>): void => {
      if (settled) return;
      if (response.id === 1 && !initialized) {
        if (response.error !== undefined) {
          finish(unknownReply(`codex app-server refused initialization: ${JSON.stringify(response.error)}`, false));
          return;
        }
        initialized = true;
        if (!send({ jsonrpc: "2.0", method: "initialized", params: {} })) return;
        send({ jsonrpc: "2.0", id: 2, method: "account/rateLimits/read", params: {} });
        return;
      }
      if (response.id === 2) {
        finish(enforceExpectedAccount(parseCodexAppServerReply(response, nowMs), options.expectedAccountId));
      }
    };

    child.onStdout((chunk) => {
      buffer += chunk.toString();
      const decoded = jsonMessages(buffer);
      buffer = decoded.rest;
      for (const response of decoded.messages) handleResponse(response);
    });
    child.onError((error) => finish(unknownReply(`codex app-server failed: ${error.message}`, true)));
    child.onExit((code, signal) => {
      finish(
        unknownReply(
          `codex app-server exited before replying (code ${String(code)}, signal ${String(signal)})`,
          true,
        ),
      );
    });

    timer = setTimeout(
      () => finish(unknownReply(`codex app-server gave no rate-limit reply within ${timeoutMs}ms`, true)),
      timeoutMs,
    );
    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { clientInfo: { name: "overseer", version: "0.0.1", title: "overseer" } },
    });
    // Deliberately no stdin.end(): app-server is a bidirectional protocol peer.
  });
}
