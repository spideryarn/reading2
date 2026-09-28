/**
 * **A claims run that thought through its whole allowance and wrote nothing** —
 * what the log says, and what the referee is told.
 *
 * The failure behind docs/plans/260928c-referee-claims-fail-on-long-pieces.md,
 * in the shape the wire actually delivered it: reasoning deltas only, a usage
 * block whose `reasoning_tokens` equals `completion_tokens`, then
 * `finish_reason: "length"` and `[DONE]`. In production the log line for this
 * said `finishReason: "length"` and nothing about where the tokens went, so it
 * read as *the input was too big* — which is what the reader-facing sentence
 * said too, and neither was true: the input does not count against
 * `max_tokens`.
 *
 * ## Why a child process
 *
 * src/log.ts is `silent` under `NODE_ENV=test`, so an in-process assertion
 * would pass against a logger that emits nothing. Same harness and reasoning as
 * tests/chat-empty-answer-log.test.ts.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const src = (file: string) => JSON.stringify(path.join(ROOT, "src", file));

/** What the stream reports it spent thinking — the number the log must carry. */
const THOUGHT = 12_345;

let stdout = "";
let stderr = "";

beforeAll(() => {
  const body = `await (async () => {
    const { runClaims } = await import(${src("referee-claims-run.ts")});
    const frame = (payload) => "data: " + JSON.stringify(payload) + "\\n\\n";
    globalThis.fetch = async () => ({
      ok: true,
      headers: new Headers(),
      body: new ReadableStream({
        start(c) {
          const enc = new TextEncoder();
          const frames = [
            frame({ model: "anthropic/claude-sonnet-5", choices: [{ delta: { reasoning: "Let me work through the paper" } }] }),
            frame({ choices: [{ delta: { reasoning: " section by section." } }] }),
            frame({ choices: [{ finish_reason: "length", delta: {} }] }),
            frame({ choices: [], usage: {
              prompt_tokens: 20240,
              completion_tokens: ${THOUGHT},
              completion_tokens_details: { reasoning_tokens: ${THOUGHT} },
            } }),
            "data: [DONE]\\n\\n",
          ];
          for (const f of frames) c.enqueue(enc.encode(f));
          c.close();
        },
      }),
    });
    try {
      await runClaims({
        meta: { title: "A long essay" },
        blocks: [{ id: "spya-anc234", text: "We show that the method halves annotation time." }],
      });
      /* A return is the one way this fixture is invalid. Use the process status
         rather than a marker written after Pino's synchronous destination: the
         status is also what proves the child itself completed successfully. */
      process.exitCode = 2;
    } catch {
      // Expected. The in-process claims test pins the reader-facing throw.
    }
  })();`;

  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.LOG_LEVEL;
  env.NODE_ENV = "development";
  // Nothing is sent anywhere — `fetch` is replaced above.
  env.OPENROUTER_API_KEY = "test-key-not-a-real-one";

  /* Node's loader path, rather than the `tsx` CLI: the CLI opens an IPC socket
     even for `-e`, which is forbidden in the same sandbox this test is meant
     to work in and made the test fail before it exercised a log line. */
  const child = spawnSync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "--eval", body],
    {
      env,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    },
  );
  stdout = child.stdout ?? "";
  stderr = child.stderr ?? "";
  if (child.signal || child.status !== 0) {
    throw new Error(
      `the log-test child failed (status ${String(child.status)}, signal ${String(child.signal)}): ` +
        `${child.error ? String(child.error) : ""}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
    );
  }
}, 120_000);

function lines(): Record<string, unknown>[] {
  return stdout
    .split("\n")
    .filter((l) => l.trim().startsWith("{"))
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

function noTextLine(): Record<string, unknown> {
  const found = lines().find((l) => typeof l.msg === "string" && l.msg.endsWith("returned no text"));
  if (!found) throw new Error(`no "returned no text" line.\nstdout:\n${stdout}\nstderr:\n${stderr}`);
  return found;
}

describe("a claims run that spent its whole allowance thinking", () => {
  it("logs how much of the allowance went on thinking", () => {
    const line = noTextLine();
    expect(line.finishReason).toBe("length");
    expect(line.reasoningTokens).toBe(THOUGHT);
    expect(line.outputTokens).toBe(THOUGHT);
  });

  it("is also named by the gateway, which warns for any chat job this happens to", () => {
    /* `warnIfThinkingAteTheCeiling` in src/ai-call.ts — the line that is there
       for the next caller, not this one, so it is checked on this one. */
    const warn = lines().find(
      (l) => typeof l.msg === "string" && l.msg.includes("stopped at its token ceiling"),
    );
    expect(warn, stdout).toBeDefined();
    expect(warn?.level).toBe("warn");
    expect(warn?.job).toBe("referee-claims");
    expect(warn?.reasoningTokens).toBe(THOUGHT);
    expect(warn?.effort).toBe("medium");
    expect(warn?.ceiling).toBeGreaterThan(THOUGHT);
  });
});
