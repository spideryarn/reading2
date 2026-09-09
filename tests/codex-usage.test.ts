/**
 * Codex usage-limit fixtures are documented in tests/fixtures/codex-usage/README.md.
 * The collector tests all inject a fake executor: this file never spawns codex
 * and never talks to OpenAI.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  collectCodexUsage,
  parseCodexAppServerReply,
  parseCodexSessionUsage,
  parseCodexUsageBucket,
  type CodexUsageExecutor,
} from "../tools/overseer/codex-usage.js";

const FIXTURES = path.resolve(import.meta.dirname, "fixtures/codex-usage");
const fixture = (name: string): unknown => JSON.parse(readFileSync(path.join(FIXTURES, name), "utf8"));
const NOW_MS = Date.parse("2026-09-09T08:00:00.000Z");

function degenerateBucket(limitId: string): unknown {
  const root = fixture("app-server-degenerate-windows.json") as {
    result: { rateLimitsByLimitId: Record<string, unknown> };
  };
  return root.result.rateLimitsByLimitId[limitId];
}

function parsedBucket(limitId: string) {
  const parsed = parseCodexUsageBucket(degenerateBucket(limitId), NOW_MS, limitId);
  expect(parsed.kind).toBe("value");
  if (parsed.kind !== "value") throw new Error(parsed.why);
  return parsed.value;
}

describe("Codex usage windows preserve source position and duration", () => {
  it("does not report the reversed bucket's 300-minute primary window as weekly", () => {
    const bucket = parsedBucket("reversed");
    const primary = bucket.windows.find((window) => window.slot === "primary");
    const secondary = bucket.windows.find((window) => window.slot === "secondary");
    expect(primary?.windowMinutes).toBe(300);
    expect(secondary?.windowMinutes).toBe(10080);
  });

  it("keeps a null duration as a named unknown instead of guessing from the slot", () => {
    expect(parsedBucket("no-duration").windows).toEqual([
      expect.objectContaining({ kind: "unknown", slot: "primary", windowMinutes: null }),
    ]);
  });

  it("does not publish a percentage whose reset is null", () => {
    const [window] = parsedBucket("no-reset").windows;
    expect(window).toEqual(
      expect.objectContaining({ kind: "unknown", slot: "primary", windowMinutes: 10080 }),
    );
    expect(window).not.toHaveProperty("usedPercent");
  });

  it("keeps an unfamiliar positive duration as a value", () => {
    const raw = structuredClone(degenerateBucket("unknown-window")) as {
      primary: { resetsAt: number };
    };
    raw.primary.resetsAt = (NOW_MS + 42 * 60_000) / 1000;
    const parsed = parseCodexUsageBucket(raw, NOW_MS, "unknown-window");
    expect(parsed.kind).toBe("value");
    if (parsed.kind !== "value") throw new Error(parsed.why);
    expect(parsed.value.windows).toEqual([
      expect.objectContaining({ kind: "value", slot: "primary", windowMinutes: 42, usedPercent: 7 }),
    ]);
  });

  it("preserves a set rateLimitReachedType", () => {
    const limited = parsedBucket("limited");
    expect(limited.rateLimitReachedType).toBe("rate_limit_reached");
    expect(limited.windows).toEqual([
      expect.objectContaining({ kind: "value", usedPercent: 100, windowMinutes: 10080 }),
    ]);
  });

  it("rejects resetsAt that is not later than the source reading", () => {
    const parsed = parseCodexUsageBucket(degenerateBucket("limited"), Date.parse("2026-09-16T00:00:00Z"));
    expect(parsed.kind).toBe("value");
    if (parsed.kind !== "value") throw new Error(parsed.why);
    expect(parsed.value.windows).toEqual([
      expect.objectContaining({ kind: "unknown", slot: "primary", windowMinutes: 10080 }),
    ]);
    expect(parsed.value.windows[0]).not.toHaveProperty("usedPercent");
  });
});

describe("parseCodexAppServerReply", () => {
  it("reads the real multi-bucket response and reset-credit count", () => {
    const reading = parseCodexAppServerReply(fixture("app-server-rate-limits.json"), NOW_MS);
    expect(reading.kind).toBe("value");
    if (reading.kind !== "value") throw new Error(reading.why);
    expect(reading.accountId).toBe("account-id-redacted-not-a-database-row");
    expect(reading.readAt).toBe("2026-09-09T08:00:00.000Z");
    expect(reading.resetCredits).toBe(2);
    expect(reading.buckets.map((bucket) => bucket.limitId)).toEqual(["codex", "codex_bengalfox"]);
    expect(reading.buckets[0]?.windows).toEqual([
      expect.objectContaining({ kind: "value", slot: "primary", windowMinutes: 10080, usedPercent: 24 }),
    ]);
    expect(reading.buckets[0]).toEqual(
      expect.objectContaining({ spendControlReached: false, individualLimit: null }),
    );
  });

  it.each([
    {
      name: "spend control was reached",
      mutate: (bucket: Record<string, unknown>) => {
        bucket.spendControlReached = true;
      },
      why: "spend-control state was reached or unavailable",
    },
    {
      name: "an individual limit was reported",
      mutate: (bucket: Record<string, unknown>) => {
        bucket.individualLimit = {
          limit: "10",
          used: "10",
          remainingPercent: 0,
          resetsAt: 1789435399,
        };
      },
      why: "individual spend limit",
    },
    {
      name: "rateLimitReachedType was omitted",
      mutate: (bucket: Record<string, unknown>) => {
        delete bucket.rateLimitReachedType;
      },
      why: "omitted rateLimitReachedType",
    },
    {
      name: "individualLimit was omitted",
      mutate: (bucket: Record<string, unknown>) => {
        delete bucket.individualLimit;
      },
      why: "individual spend-limit state was unavailable",
    },
  ])("fails the general bucket closed when $name", ({ mutate, why }) => {
    const reply = structuredClone(fixture("app-server-rate-limits.json")) as {
      result: {
        rateLimits: Record<string, unknown>;
        rateLimitsByLimitId: Record<string, Record<string, unknown>>;
      };
    };
    mutate(reply.result.rateLimits);
    const canonical = reply.result.rateLimitsByLimitId.codex;
    if (!canonical) throw new Error("fixture has no codex bucket");
    mutate(canonical);

    expect(parseCodexAppServerReply(reply, NOW_MS)).toEqual(
      expect.objectContaining({ kind: "unknown", retryable: false, why: expect.stringContaining(why) }),
    );
  });

  it("uses the bare rateLimits bucket only when the canonical map is absent", () => {
    const reply = structuredClone(fixture("app-server-rate-limits.json")) as Record<string, unknown>;
    const result = reply.result as Record<string, unknown>;
    delete result.rateLimitsByLimitId;
    const reading = parseCodexAppServerReply(reply, NOW_MS);
    expect(reading.kind).toBe("value");
    if (reading.kind !== "value") throw new Error(reading.why);
    expect(reading.buckets.map((bucket) => bucket.limitId)).toEqual(["codex"]);
  });

  it("makes a persistent authentication error non-retryable", () => {
    const reading = parseCodexAppServerReply(fixture("app-server-not-authenticated.json"), NOW_MS);
    expect(reading).toEqual(expect.objectContaining({ kind: "unknown", retryable: false }));
    expect(reading.kind === "unknown" ? reading.why : "").toContain("codex login");
  });

  it("makes a failed live fetch retryable", () => {
    const reading = parseCodexAppServerReply(
      { id: 2, error: { code: -32603, message: "failed to fetch codex rate limits" } },
      NOW_MS,
    );
    expect(reading).toEqual({ kind: "unknown", why: "failed to fetch codex rate limits", retryable: true });
  });

  it("returns unknown when the duplicate general snapshots disagree", () => {
    const reply = structuredClone(fixture("app-server-rate-limits.json")) as {
      result: { rateLimitsByLimitId: Record<string, { primary: { usedPercent: number } }> };
    };
    const canonical = reply.result.rateLimitsByLimitId.codex;
    if (!canonical) throw new Error("fixture has no codex bucket");
    canonical.primary.usedPercent = 31;
    const reading = parseCodexAppServerReply(reply, NOW_MS);
    expect(reading).toEqual(
      expect.objectContaining({ kind: "unknown", retryable: false, why: expect.stringContaining("disagreed") }),
    );
  });

  it("accepts duplicate general snapshots whose validated meanings agree", () => {
    const reply = structuredClone(fixture("app-server-rate-limits.json")) as {
      result: { rateLimits: Record<string, unknown> };
    };
    delete reply.result.rateLimits.limitName;

    const reading = parseCodexAppServerReply(reply, NOW_MS);
    expect(reading.kind).toBe("value");
    if (reading.kind !== "value") throw new Error(reading.why);
    expect(reading.buckets[0]).toEqual(expect.objectContaining({ limitId: "codex", limitName: null }));
  });

  it("does not publish an implausible reset beyond the window's own duration", () => {
    const reply = structuredClone(fixture("app-server-rate-limits.json")) as {
      result: {
        rateLimits: { primary: { resetsAt: number } };
        rateLimitsByLimitId: Record<string, { primary: { resetsAt: number } }>;
      };
    };
    reply.result.rateLimits.primary.resetsAt = 100_000_000_000;
    const canonical = reply.result.rateLimitsByLimitId.codex;
    if (!canonical) throw new Error("fixture has no codex bucket");
    canonical.primary.resetsAt = 100_000_000_000;

    const reading = parseCodexAppServerReply(reply, NOW_MS);
    expect(reading.kind).toBe("value");
    if (reading.kind !== "value") throw new Error(reading.why);
    expect(reading.buckets[0]?.windows).toEqual([
      expect.objectContaining({ kind: "unknown", slot: "primary", windowMinutes: 10080 }),
    ]);
    expect(reading.buckets[0]?.windows[0]).not.toHaveProperty("usedPercent");
  });

  it("preserves a used percentage above 100", () => {
    const reply = structuredClone(fixture("app-server-rate-limits.json")) as {
      result: {
        rateLimits: { primary: { usedPercent: number }; rateLimitReachedType: string | null };
        rateLimitsByLimitId: Record<
          string,
          { primary: { usedPercent: number }; rateLimitReachedType: string | null }
        >;
      };
    };
    reply.result.rateLimits.primary.usedPercent = 101;
    reply.result.rateLimits.rateLimitReachedType = "rate_limit_reached";
    const canonical = reply.result.rateLimitsByLimitId.codex;
    if (!canonical) throw new Error("fixture has no codex bucket");
    canonical.primary.usedPercent = 101;
    canonical.rateLimitReachedType = "rate_limit_reached";

    const reading = parseCodexAppServerReply(reply, NOW_MS);
    expect(reading.kind).toBe("value");
    if (reading.kind !== "value") throw new Error(reading.why);
    expect(reading.buckets[0]).toEqual(
      expect.objectContaining({
        rateLimitReachedType: "rate_limit_reached",
        windows: [expect.objectContaining({ kind: "value", usedPercent: 101 })],
      }),
    );
  });

  it("does not substitute a model-specific bucket when canonical codex is absent", () => {
    const reply = structuredClone(fixture("app-server-rate-limits.json")) as {
      result: { rateLimitsByLimitId: Record<string, unknown> };
    };
    delete reply.result.rateLimitsByLimitId.codex;
    const reading = parseCodexAppServerReply(reply, NOW_MS);
    /* The persisted format can represent the surviving model buckets, but the
       producer intentionally does not emit that state today. Keeping this as a
       top-level unknown makes the consumer unable to mistake a model bucket
       for general subscription headroom; the reason carries what was absent. */
    expect(reading).toEqual(
      expect.objectContaining({ kind: "unknown", why: expect.stringContaining("no general codex bucket") }),
    );
  });

  it("validates each map key against the inner limitId", () => {
    const reply = structuredClone(fixture("app-server-rate-limits.json")) as {
      result: { rateLimitsByLimitId: Record<string, Record<string, unknown>> };
    };
    const spark = reply.result.rateLimitsByLimitId.codex_bengalfox;
    if (!spark) throw new Error("fixture has no Spark bucket");
    spark.limitId = "codex_elsewhere";
    const reading = parseCodexAppServerReply(reply, NOW_MS);
    expect(reading).toEqual(
      expect.objectContaining({ kind: "unknown", why: expect.stringContaining("disagreed with its bucket's limitId") }),
    );
  });
});

describe("parseCodexSessionUsage", () => {
  it("reads the real session log's window_minutes and float used_percent", () => {
    const parsed = parseCodexSessionUsage(fixture("session-rollout-token-count.json"), NOW_MS);
    expect(parsed.kind).toBe("value");
    if (parsed.kind !== "value") throw new Error(parsed.why);
    expect(parsed.value.observedAt).toBe("2026-09-09T07:56:49.298Z");
    expect(parsed.value.bucket.limitId).toBe("codex");
    expect(parsed.value.bucket.windows).toEqual([
      expect.objectContaining({ kind: "value", slot: "primary", windowMinutes: 10080, usedPercent: 24 }),
    ]);
  });
});

type SpawnCall = {
  command: string;
  args: readonly string[];
  options: Parameters<CodexUsageExecutor["spawn"]>[2];
};

class FakeCodexChild {
  readonly pid = 4321;
  readonly writes: unknown[] = [];
  stdinEnded = false;
  private stdoutListener: ((chunk: Buffer | string) => void) | null = null;
  private errorListener: ((error: Error) => void) | null = null;
  private exitListener: ((code: number | null, signal: NodeJS.Signals | null) => void) | null = null;

  constructor(
    private readonly reply: unknown | null,
    private readonly replyBeforeInitialize: unknown | null = null,
  ) {}

  writeStdin = (line: string): void => {
    const message = JSON.parse(line) as Record<string, unknown>;
    this.writes.push(message);
    if (message.id === 1) {
      if (this.replyBeforeInitialize !== null) this.emit(this.replyBeforeInitialize);
      queueMicrotask(() => this.emit({ jsonrpc: "2.0", id: 1, result: {} }));
    } else if (message.method === "account/rateLimits/read" && this.reply !== null) {
      this.emitMany(
        { jsonrpc: "2.0", method: "remoteControl/status/changed", params: {} },
        { jsonrpc: "2.0", id: 99, result: { irrelevant: true } },
        this.reply,
      );
    }
  };

  onStdout = (listener: (chunk: Buffer | string) => void): void => {
    this.stdoutListener = listener;
  };

  onError = (listener: (error: Error) => void): void => {
    this.errorListener = listener;
  };

  onExit = (listener: (code: number | null, signal: NodeJS.Signals | null) => void): void => {
    this.exitListener = listener;
  };

  /** Deliberately available on the fake but absent from the executor contract. */
  endStdin(): void {
    this.stdinEnded = true;
  }

  emitError(error: Error): void {
    this.errorListener?.(error);
  }

  emitExit(code: number | null, signal: NodeJS.Signals | null): void {
    this.exitListener?.(code, signal);
  }

  emitChunk(chunk: Buffer | string): void {
    this.stdoutListener?.(chunk);
  }

  private emit(message: unknown): void {
    this.stdoutListener?.(`${JSON.stringify(message)}\n`);
  }

  private emitMany(...messages: unknown[]): void {
    this.stdoutListener?.(`${messages.map((message) => JSON.stringify(message)).join("\n")}\n`);
  }
}

function fakeExecutor(reply: unknown | null, replyBeforeInitialize: unknown | null = null): {
  child: FakeCodexChild;
  executor: CodexUsageExecutor;
  spawns: SpawnCall[];
  kills: { pid: number; signal: NodeJS.Signals }[];
} {
  const child = new FakeCodexChild(reply, replyBeforeInitialize);
  const spawns: SpawnCall[] = [];
  const kills: { pid: number; signal: NodeJS.Signals }[] = [];
  return {
    child,
    spawns,
    kills,
    executor: {
      spawn: (command, args, options) => {
        spawns.push({ command, args, options });
        return child;
      },
      kill: (pid, signal) => {
        kills.push({ pid, signal });
      },
    },
  };
}

describe("collectCodexUsage app-server protocol", () => {
  it("ignores an id-2 reply until the rate-limit request has been sent", async () => {
    const reply = fixture("app-server-rate-limits.json");
    const fake = fakeExecutor(reply, reply);

    const reading = await collectCodexUsage({ nowMs: NOW_MS, executor: fake.executor });

    expect(reading.kind).toBe("value");
    expect(fake.child.writes).toEqual([
      expect.objectContaining({ id: 1, method: "initialize" }),
      expect.objectContaining({ method: "initialized" }),
      expect.objectContaining({ id: 2, method: "account/rateLimits/read" }),
    ]);
  });

  it("decodes a UTF-8 character split across stdout chunks", async () => {
    const reply = structuredClone(fixture("app-server-rate-limits.json")) as {
      result: {
        rateLimits: { limitName: string | null };
        rateLimitsByLimitId: Record<string, { limitName: string | null }>;
      };
    };
    reply.result.rateLimits.limitName = "é";
    const canonical = reply.result.rateLimitsByLimitId.codex;
    if (!canonical) throw new Error("fixture has no codex bucket");
    canonical.limitName = "é";
    const fake = fakeExecutor(null);
    const pending = collectCodexUsage({ nowMs: NOW_MS, executor: fake.executor });
    await vi.waitFor(() => expect(fake.child.writes).toHaveLength(3));

    const bytes = Buffer.from(`${JSON.stringify(reply)}\n`);
    const characterStart = bytes.indexOf(Buffer.from("é"));
    if (characterStart < 0) throw new Error("serialized reply did not contain the test character");
    fake.child.emitChunk(bytes.subarray(0, characterStart + 1));
    fake.child.emitChunk(bytes.subarray(characterStart + 1));

    const reading = await pending;
    expect(reading.kind).toBe("value");
    if (reading.kind !== "value") throw new Error(reading.why);
    expect(reading.buckets[0]?.limitName).toBe("é");
  });

  it("stamps and validates the reading when the rate-limit reply arrives", async () => {
    const reply = structuredClone(fixture("app-server-rate-limits.json")) as {
      result: {
        rateLimits: { primary: { resetsAt: number } };
        rateLimitsByLimitId: Record<string, { primary: { resetsAt: number } }>;
      };
    };
    const resetAtMs = NOW_MS + 1_000;
    reply.result.rateLimits.primary.resetsAt = resetAtMs / 1000;
    const canonical = reply.result.rateLimitsByLimitId.codex;
    if (!canonical) throw new Error("fixture has no codex bucket");
    canonical.primary.resetsAt = resetAtMs / 1000;
    const fake = fakeExecutor(reply);
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(NOW_MS);

    try {
      const pending = collectCodexUsage({
        env: { HOME: "/home/tester" },
        executor: fake.executor,
      });
      dateNow.mockReturnValue(NOW_MS + 2_000);
      const reading = await pending;
      expect(reading.kind).toBe("value");
      if (reading.kind !== "value") throw new Error(reading.why);
      expect(reading.readAt).toBe("2026-09-09T08:00:02.000Z");
      expect(reading.buckets[0]?.windows[0]).toEqual(
        expect.objectContaining({ kind: "unknown", slot: "primary", windowMinutes: 10080 }),
      );
    } finally {
      dateNow.mockRestore();
    }
  });

  /**
   * THE CHILD GETS AN EXACT SET, not "the secrets minus a few".
   *
   * `toEqual` on the whole `env` is the assertion that matters, and it is why
   * `ORDINARY_SETTING` is in the parent and absent from the expectation: this is
   * an allowlist, so a variable does not cross merely by being harmless. An
   * assertion shaped as "CODEX_API_KEY is not in here" would pass just as well
   * against a child handed the entire environment minus one name, which is the
   * bug this is meant to make impossible.
   *
   * The allowlist replaced `sanitisedEnv` on 2026-09-09 — see `childEnvironment`
   * in the module for the two reasons. Under the denylist `ORDINARY_SETTING`
   * crossed and this test asserted that it did.
   */
  it("gives the child exactly the allowlisted variables, initializes in order, and matches reply id 2", async () => {
    const fake = fakeExecutor(fixture("app-server-rate-limits.json"));
    const reading = await collectCodexUsage({
      nowMs: NOW_MS,
      env: {
        PATH: "/test/bin",
        HOME: "/home/tester",
        CODEX_HOME: "/home/tester/.codex-work",
        CODEX_API_KEY: "must-not-cross",
        OTHER_API_TOKEN: "also-must-not-cross",
        DATABASE_URL: "postgres://must-not-cross",
        ORDINARY_SETTING: "does not cross either — this is an allowlist",
      },
      executor: fake.executor,
    });

    expect(reading.kind).toBe("value");
    expect(fake.spawns).toEqual([
      {
        command: "codex",
        args: ["app-server", "--listen", "stdio://"],
        options: {
          detached: true,
          stdio: ["pipe", "pipe", "ignore"],
          env: {
            PATH: "/test/bin",
            HOME: "/home/tester",
            CODEX_HOME: "/home/tester/.codex-work",
          },
        },
      },
    ]);
    expect(fake.child.writes).toEqual([
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { clientInfo: { name: "overseer", version: "0.0.1", title: "overseer" } },
      },
      { jsonrpc: "2.0", method: "initialized", params: {} },
      { jsonrpc: "2.0", id: 2, method: "account/rateLimits/read", params: {} },
    ]);
    expect(fake.child.stdinEnded).toBe(false);
    expect(fake.kills).toContainEqual({ pid: -4321, signal: "SIGKILL" });
  });

  it("kills the whole process group and returns retryable unknown on timeout", async () => {
    vi.useFakeTimers();
    try {
      const fake = fakeExecutor(null);
      const pending = collectCodexUsage({
        nowMs: NOW_MS,
        timeoutMs: 25,
        env: { HOME: "/home/tester", CODEX_HOME: "/home/tester/.codex-work" },
        executor: fake.executor,
      });
      await vi.advanceTimersByTimeAsync(25);
      await expect(pending).resolves.toEqual({
        kind: "unknown",
        why: "codex app-server gave no rate-limit reply within 25ms",
        retryable: true,
      });
      expect(fake.kills).toEqual([{ pid: -4321, signal: "SIGKILL" }]);
      expect(fake.child.stdinEnded).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects a reading attributed to a different intended account", async () => {
    const fake = fakeExecutor(fixture("app-server-rate-limits.json"));
    const reading = await collectCodexUsage({
      nowMs: NOW_MS,
      expectedAccountId: "expected-account",
      env: { HOME: "/home/tester" },
      executor: fake.executor,
    });
    expect(reading).toEqual(
      expect.objectContaining({ kind: "unknown", retryable: false, why: expect.stringContaining("not the intended account") }),
    );
  });
});
