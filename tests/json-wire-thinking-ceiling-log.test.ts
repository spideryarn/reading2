/**
 * **A non-streamed call whose thinking spent its allowance is named in the log,
 * the same as a streamed one.**
 *
 * `warnIfThinkingAteTheCeiling` (src/ai-call.ts) was added on 2026-09-28 at the
 * end of `openRouterStream` only, so the calls that go through `openRouterJson`
 * — Debate's passes and synthesis, the PDF front-matter pass, the PDF reader —
 * could stop on `length` after thinking and leave nothing saying where the
 * tokens went. That is postmortem 260928b's class (*a lesson kept in a helper
 * does not reach the other wire*) a second time; plan 261010f.
 *
 * Debate is the job used here because it is the one whose answers have come
 * closest to the ceiling in production, and it is a provider-default job, so
 * the line must say so.
 *
 * ## Why a child process
 *
 * src/log.ts is `silent` under `NODE_ENV=test`, so an in-process assertion
 * would pass against a logger that emits nothing. Same harness and reasoning as
 * tests/referee-claims-no-room-log.test.ts.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const src = (file: string) => JSON.stringify(path.join(ROOT, "src", file));

/** What the body reports it spent thinking — the number the log must carry. */
const THOUGHT = 6_543;
const OUTPUT = 8_000;
/** Text in the answer that must never reach a log line. */
const SECRET = "the-article-prose-that-must-not-be-logged";

let stdout = "";
let stderr = "";

beforeAll(() => {
  const body = `await (async () => {
    const { openRouterJson } = await import(${src("ai-call.ts")});
    const reply = (finish) => ({
      ok: true,
      status: 200,
      headers: new Headers(),
      text: async () => JSON.stringify({
        model: "anthropic/claude-sonnet-5",
        choices: [{ finish_reason: finish, message: { content: ${JSON.stringify(`{"rows": ["${SECRET}`)} } }],
        usage: {
          prompt_tokens: 20240,
          completion_tokens: ${OUTPUT},
          completion_tokens_details: { reasoning_tokens: ${THOUGHT} },
        },
      }),
    });
    let n = 0;
    globalThis.fetch = async () => reply(n++ === 1 ? "stop" : "length");
    // The first stops on its ceiling; the second, a clean stop, must not warn.
    const first = await openRouterJson("reception", { model: "anthropic/claude-sonnet-5", max_tokens: ${OUTPUT}, messages: [] });
    if (first.json?.choices?.[0]?.finish_reason !== "length") throw new Error("the warning changed the returned body");
    await openRouterJson("reception", { model: "anthropic/claude-sonnet-5", max_tokens: ${OUTPUT}, messages: [] });
    // Embeddings share openRouterJson. Even a malformed reply that happens to
    // carry chat-like fields must not be treated as a chat-wire ceiling event.
    await openRouterJson("embeddings", { model: "voyage/test", max_tokens: ${OUTPUT}, input: ["x"] });
  })();`;

  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.LOG_LEVEL;
  env.NODE_ENV = "development";
  // Nothing is sent anywhere — `fetch` is replaced above.
  env.OPENROUTER_API_KEY = "test-key-not-a-real-one";

  const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", body], {
    env,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  stdout = child.stdout ?? "";
  stderr = child.stderr ?? "";
  if (child.signal || child.status !== 0) {
    throw new Error(
      `the log-test child failed (status ${String(child.status)}, signal ${String(child.signal)}): ` +
        `${child.error ? String(child.error) : ""}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
    );
  }
}, 120_000);

function warnings(): Record<string, unknown>[] {
  return stdout
    .split("\n")
    .filter((l) => l.trim().startsWith("{"))
    .map((l) => JSON.parse(l) as Record<string, unknown>)
    .filter((l) => typeof l.msg === "string" && l.msg.includes("stopped at its token ceiling"));
}

describe("a non-streamed call that thought through its ceiling", () => {
  it("is named once, with the job, the ceiling, where the tokens went and the effort", () => {
    const found = warnings();
    expect(found, stdout).toHaveLength(1);
    const warn = found[0];
    expect(warn?.level).toBe("warn");
    expect(warn?.job).toBe("reception");
    expect(warn?.ceiling).toBe(OUTPUT);
    expect(warn?.reasoningTokens).toBe(THOUGHT);
    expect(warn?.outputTokens).toBe(OUTPUT);
    expect(warn?.effort).toBe("provider-default");
  });

  it("carries none of the answer's text", () => {
    expect(stdout).not.toContain(SECRET);
    expect(stderr).not.toContain(SECRET);
  });
});
