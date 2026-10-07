/**
 * **A script or an eval may not spend into no ledger.**
 *
 * In October 2026 about $79 of the dev key's spend wrote no row: evals that
 * went through the gateway, so every call was metered, with no collector open
 * or with one that had no sink. docs/investigations/261007c-openrouter-spend-the-ledger-does-not-record.md.
 *
 * So `beginSpend`, which runs before a byte goes over the wire, refuses when the
 * process's entry file is under `evals/` or `scripts/` and nothing that writes
 * rows is listening. Anywhere else — the dev server, production, a test — it
 * keeps today's behaviour: a warning and a counter, because a refusal there
 * would break a reader's feature or a test rather than stop a leak.
 */
import { AsyncResource } from "node:async_hooks";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { streamMessage } from "../src/messages-stream.js";
import { transcribeWith } from "../src/transcribe.js";

import {
  UnrecordedSpendRefused,
  beginSpend,
  collectSpend,
  collectingSpend,
  overrideProcessEntryForTests,
  refusesUnrecordedSpend,
  resetUnscopedCalls,
} from "../src/ai-spend.js";
import { openRouterJson } from "../src/ai-call.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const at = (rel: string) => path.join(ROOT, rel);

afterEach(() => {
  overrideProcessEntryForTests(undefined);
  resetUnscopedCalls();
  vi.unstubAllGlobals();
});

describe("which processes refuse", () => {
  it.each([
    ["evals/guide/run.ts", true],
    ["evals/pdf/minimal-metadata/score.mts", true],
    ["scripts/eval/skim-coverage-eval.ts", true],
    ["scripts/probes/261001a-paper-read-probe.ts", true],
    ["src/server.ts", false],
    ["node_modules/vite/bin/vite.js", false],
    ["node_modules/vitest/vitest.mjs", false],
    ["evalsx/run.ts", false],
  ])("%s → %s", (rel, refuses) => {
    expect(refusesUnrecordedSpend(at(rel))).toBe(refuses);
  });

  it("no entry at all (a REPL, a worker) does not refuse", () => {
    expect(refusesUnrecordedSpend(undefined)).toBe(false);
  });

  it("a path outside the repo does not refuse", () => {
    expect(refusesUnrecordedSpend("/tmp/evals/run.ts")).toBe(false);
  });
});

describe("beginSpend, from an eval", () => {
  it("refuses with no collector open", () => {
    overrideProcessEntryForTests(at("evals/x/run.ts"));
    expect(() => beginSpend("chat", "anthropic/claude-sonnet-5")).toThrow(UnrecordedSpendRefused);
  });

  it("refuses inside a collector that has no sink", async () => {
    overrideProcessEntryForTests(at("scripts/eval/x.ts"));
    await expect(collectSpend(async () => beginSpend("chat", "m"), { attribution: { scopeKind: "eval" } })).rejects.toThrow(
      UnrecordedSpendRefused,
    );
  });

  it("refuses from a collector that has already closed", async () => {
    overrideProcessEntryForTests(at("evals/x/run.ts"));
    let later: (() => unknown) | undefined;
    await collectSpend(
      async () => {
        later = AsyncResource.bind(() => {
          expect(collectingSpend()).toBe(true);
          return beginSpend("chat", "m");
        });
      },
      { sink: async () => {} },
    );
    expect(() => later?.()).toThrow(UnrecordedSpendRefused);
  });

  it("proceeds inside a collector that writes rows", async () => {
    overrideProcessEntryForTests(at("evals/x/run.ts"));
    const { result } = await collectSpend(async () => beginSpend("chat", "m"), { sink: async () => {} });
    expect(typeof result).toBe("number");
  });

  it("an inner sinkless collector cannot borrow the outer collector's sink", async () => {
    overrideProcessEntryForTests(at("scripts/stage.ts"));
    await expect(
      collectSpend(
        async () => collectSpend(async () => beginSpend("structure", "m")),
        { sink: async () => {} },
      ),
    ).rejects.toThrow(UnrecordedSpendRefused);
  });

  it("names the job, the model and the fix", () => {
    overrideProcessEntryForTests(at("evals/x/run.ts"));
    expect(() => beginSpend("glossary", "anthropic/claude-sonnet-5")).toThrow(
      /glossary.*anthropic\/claude-sonnet-5[\s\S]*withLedger/,
    );
  });
});

describe("beginSpend, from anything else", () => {
  it.each([["src/server.ts"], ["node_modules/vitest/vitest.mjs"]])("%s keeps the old behaviour: no throw", (rel) => {
    overrideProcessEntryForTests(at(rel));
    expect(beginSpend("chat", "m")).toBeNull();
  });
});

describe("an entry path reached through a symlink", () => {
  it("still refuses, because both sides are resolved", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "spend-entry-"));
    const link = path.join(dir, "repo");
    symlinkSync(ROOT, link);
    try {
      expect(refusesUnrecordedSpend(path.join(link, "evals/guide/run.ts"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("through the gateway", () => {
  it("the Messages wire refuses before it opens a stream", async () => {
    overrideProcessEntryForTests(at("evals/x/run.ts"));
    const saved = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = "sk-or-test-not-a-real-key";
    try {
      await expect(
        (async () =>
          streamMessage(
            "structure",
            { max_tokens: 10, messages: [{ role: "user", content: "hi" }] },
            { power: "standard" },
          ).finalMessage())(),
      ).rejects.toThrow(UnrecordedSpendRefused);
    } finally {
      process.env.OPENROUTER_API_KEY = saved;
    }
  });

  it("dictation passes the refusal on, rather than calling it an unreachable service", async () => {
    overrideProcessEntryForTests(at("evals/dictation/bench-models.ts"));
    const fetch = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const saved = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = "sk-or-test-not-a-real-key";
    try {
      await expect(transcribeWith("AAAA", "webm", [], {})).rejects.toThrow(UnrecordedSpendRefused);
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      process.env.OPENROUTER_API_KEY = saved;
    }
  });

  it("an eval with no ledger open is refused before the provider is asked", async () => {
    overrideProcessEntryForTests(at("evals/x/run.ts"));
    const fetch = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    await expect(
      openRouterJson(
        "explain",
        { model: "anthropic/claude-sonnet-5", messages: [{ role: "user", content: "hi" }] },
        { apiKey: "sk-or-test" },
      ),
    ).rejects.toThrow(UnrecordedSpendRefused);
    expect(fetch).not.toHaveBeenCalled();
  });
});
