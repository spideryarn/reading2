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

const TSX = fileURLToPath(new URL("../node_modules/.bin/tsx", import.meta.url));
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const src = (file: string) => JSON.stringify(path.join(ROOT, "src", file));

/** What the stream reports it spent thinking — the number the log must carry. */
const THOUGHT = 12_345;

let stdout = "";
let stderr = "";

beforeAll(() => {
  const body = `void (async () => {
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
      console.log(JSON.stringify({ level: "marker", outcome: "returned" }));
    } catch (err) {
      console.log(JSON.stringify({ level: "marker", outcome: "threw", message: String(err && err.message) }));
    }
  })();`;

  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.LOG_LEVEL;
  env.NODE_ENV = "development";
  // Nothing is sent anywhere — `fetch` is replaced above.
  env.OPENROUTER_API_KEY = "test-key-not-a-real-one";

  const child = spawnSync(TSX, ["-e", body], { env, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  stdout = child.stdout ?? "";
  stderr = child.stderr ?? "";
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

function outcome(): Record<string, unknown> {
  const found = lines().find((l) => l.level === "marker");
  if (!found) throw new Error(`the child never finished.\nstdout:\n${stdout}\nstderr:\n${stderr}`);
  return found;
}

describe("a claims run that spent its whole allowance thinking", () => {
  it("fails rather than returning an empty panel", () => {
    expect(outcome().outcome).toBe("threw");
  });

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

  it("tells the referee something true, and nothing they cannot act on", () => {
    const message = String(outcome().message);
    expect(message).toContain("[ai-no-room]");
    // The old sentence blamed the input, which does not count against the
    // ceiling, and advised a narrower ask — a control Claims does not have.
    expect(message).not.toMatch(/too much at once/);
    expect(message).not.toMatch(/shorter stretch/);
  });
});
