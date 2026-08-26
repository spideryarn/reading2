/**
 * **The one failure chat cannot currently be diagnosed from its own log.**
 *
 * Greg hit this on 2026-08-26. He asked chat to search his library, read the
 * best passage and compare it with the article; eight `search_library` calls
 * ran on screen, `read_library_passage` never did, and the turn ended on
 * *"The AI service finished without saying anything at all. [ai-empty]"* —
 * `saidNothing` in src/messages.ts, thrown from the `answer === ""` guard in
 * src/converse.ts.
 *
 * The line the server wrote about it said `model`, `ms` and `finishReason`, and
 * that is all. Not how many rounds had run, so a turn that reached the tool cap
 * and one that gave up on its first request are the same line. Not how many
 * tools had been called, so the eight on his screen appear nowhere in the
 * record. Not a token count, so a model that spent its entire output budget
 * thinking is indistinguishable from one that spent none — which is the
 * *specific* question that bug turns on, and the one the previous version of it
 * turned on too (docs/project/chat-tools.md § The bug that shaped the literal
 * search). Every one of those numbers already existed. They were on the success
 * line and nowhere else, which is exactly the wrong way round: an answer that
 * arrived needs no diagnosis.
 *
 * So this file is not really about a bug in the loop. It is about the loop
 * being *unfalsifiable* from a log — a check that always looks the same however
 * the turn failed is [silent success](../docs/reusable/silent-success.md)
 * pointed at whoever has to fix it next.
 *
 * ## What it reproduces
 *
 * Greg's turn, deterministically and for nothing: three rounds that ask for
 * tools — three calls, then three, then two, **eight in total**, which is how
 * eight calls fit inside a cap of three rounds — and then the fourth round,
 * which is offered no tools of ours and writes nothing. The tool is
 * `search_article_words`, which runs against the blocks in memory and touches
 * neither network nor disk.
 *
 * A second turn follows it, for the other way this ends: a stream that reports
 * its usage and then dies, which is the case where "what did this cost" and
 * "which rounds finished" give different answers.
 *
 * ## Why a child process
 *
 * src/log.ts builds its logger at import time and is `silent` under
 * `NODE_ENV=test`, so an in-process assertion would pass against a logger that
 * emits nothing at all — the vacuous green this repo keeps a document about.
 * The child runs with `NODE_ENV=development` and its stdout *is* the evidence.
 * Same reasoning, and the same harness, as tests/stop-details.test.ts.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const TSX = fileURLToPath(new URL("../node_modules/.bin/tsx", import.meta.url));
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const src = (file: string) => JSON.stringify(path.join(ROOT, "src", file));

/** Greg's shape: eight calls, spread three / three / two across the cap. */
const CALLS_PER_ROUND = [3, 3, 2];
const TOOL_CALLS = CALLS_PER_ROUND.reduce((a, b) => a + b, 0);
/** The three that asked, plus the one that was made to answer and didn't. */
const ROUNDS = CALLS_PER_ROUND.length + 1;

/**
 * The round that reports no usage at all — 0-based, so the second one.
 *
 * Providers do not always send a usage block, and `usage` is one variable read
 * once per round. Left standing between rounds it made a silent round bill as a
 * repeat of the one before it, which is the mirror of the bug the accumulator's
 * own comment describes. Found by a GPT Sol review, 2026-08-26, and the whole
 * reason this fixture is uneven rather than tidy.
 */
const SILENT_ROUND = 1;
/** Rounds that do report, which is what the sums below have to add up from. */
const REPORTING = [...Array(ROUNDS).keys()].filter((r) => r !== SILENT_ROUND);

/** Output tokens reported by the stream that then dies. See the second turn. */
const DIED_OUTPUT = 777;

let stdout = "";
let stderr = "";

beforeAll(() => {
  const body = `void (async () => {
    let round = 0;

    const frame = (payload) => "data: " + JSON.stringify(payload) + "\\n\\n";
    const stream = (frames) => new ReadableStream({
      start(c) {
        const enc = new TextEncoder();
        for (const f of frames) c.enqueue(enc.encode(f));
        c.enqueue(enc.encode("data: [DONE]\\n\\n"));
        c.close();
      },
    });

    /* Reported on all but one round. Not none: a turn that never reports usage
       logs nulls, which is a different claim from "it cost nothing" and must not
       be the one this test pins. Not all: the round that stays quiet is what
       proves the totals skip it rather than repeating the round before. */
    const usage = (out) => frame({
      choices: [],
      usage: { prompt_tokens: 1000, completion_tokens: out, prompt_tokens_details: { cached_tokens: 900 } },
    });

    globalThis.fetch = async () => {
      const wanted = ${JSON.stringify(CALLS_PER_ROUND)}[round] ?? 0;
      /* This round reports no usage — a provider that simply does not send the
         block. The totals must skip it, not repeat the previous round's. */
      const silent = round === ${SILENT_ROUND};
      round++;
      if (wanted === 0) {
        /* The last round, and this stub simply has nothing to say: a clean
           stream, a real finish_reason, and not one character. It could ask for
           a tool instead — a withheld round can, which is the whole of the
           postmortem beside this — but that path has its own message now, and
           what this file is measuring is the log line for the *silent* one. */
        return { ok: true, body: stream([
          frame({ model: "test/model", choices: [{ delta: {} }] }),
          ...(silent ? [] : [usage(20)]),
          frame({ choices: [{ finish_reason: "stop", delta: {} }] }),
        ]) };
      }
      const frames = [frame({ model: "test/model", choices: [{ delta: {} }] })];
      for (let i = 0; i < wanted; i++) {
        frames.push(frame({ choices: [{ delta: { tool_calls: [{
          index: i,
          id: "toolu_r" + round + "_" + i,
          type: "function",
          function: { name: "search_article_words", arguments: JSON.stringify({ query: "consciousness" }) },
        }] } }] }));
      }
      if (!silent) frames.push(usage(200));
      frames.push(frame({ choices: [{ finish_reason: "tool_calls", delta: {} }] }));
      return { ok: true, body: stream(frames) };
    };

    const { converse } = await import(${src("converse.ts")});
    const blocks = [{ id: "spya-k3m9qt", tag: "p", text: "Consciousness is not computation." }];
    const turn = async (name) => {
      try {
        for await (const _ of converse({
          meta: { title: "A piece", url: "https://example.com/a" },
          blocks,
          history: [],
          question: "search my library and compare it with this article",
          slug: "example",
        })) {
          // drained
        }
        console.log(JSON.stringify({ level: "marker", turn: name, outcome: "no error was thrown" }));
      } catch (err) {
        console.log(JSON.stringify({ level: "marker", turn: name, outcome: "threw", message: String(err && err.message) }));
      }
    };

    await turn("empty");

    /* A second turn, for the other half of the same question: a stream that
       reports its usage and *then* dies. The totals are banked at the end of a
       round, so this one never gets there — and the failure line has to say what
       the provider has already billed us for anyway. */
    round = 0;
    globalThis.fetch = async () => {
      /* pull, not start. A controller that enqueues and then errors inside
         start throws the queued chunks away — the usage block never reaches the
         parser and this turn measures nothing, which is how the first version
         of this test passed for the wrong reason. Handing them out one pull at
         a time makes the stream really deliver the usage and *then* die. */
      let n = 0;
      return {
        ok: true,
        body: new ReadableStream({
          pull(c) {
            const enc = new TextEncoder();
            n++;
            if (n === 1) return void c.enqueue(enc.encode(frame({ model: "test/model", choices: [{ delta: {} }] })));
            if (n === 2) return void c.enqueue(enc.encode(usage(${DIED_OUTPUT})));
            c.error(new Error("the connection went away"));
          },
        }),
      };
    };
    await turn("died");
  })();`;

  const env: NodeJS.ProcessEnv = { ...process.env };
  /* Neither the suite's LOG_LEVEL nor NODE_ENV=test may decide what this
     measures: "test" makes the logger silent, and every assertion below would
     then be satisfied by a child that printed nothing. */
  delete env.LOG_LEVEL;
  env.NODE_ENV = "development";
  // The constructor-equivalent guard: `converse` refuses without a key, and
  // that refusal would look exactly like the failure under test. Nothing is
  // sent anywhere — `fetch` is replaced above.
  env.OPENROUTER_API_KEY = "test-key-not-a-real-one";

  const child = spawnSync(TSX, ["-e", body], { env, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  stdout = child.stdout ?? "";
  stderr = child.stderr ?? "";
}, 120_000);

/** The child's stdout, one parsed object per line. */
function lines(): Record<string, unknown>[] {
  return stdout
    .split("\n")
    .filter((l) => l.trim().startsWith("{"))
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

/** The line this whole file is about. */
function emptyAnswerLine(): Record<string, unknown> {
  const found = lines().find((l) => String(l.msg ?? "").includes("returned no text"));
  if (!found) {
    throw new Error(
      `no "returned no text" line from the child` +
        `\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`,
    );
  }
  return found;
}

describe("a turn that spends itself on tools and answers with nothing", () => {
  it("reaches the reader as [ai-empty] — the bug Greg reported", () => {
    /* The control. Every assertion below is about a *log line*, and a child
       that never got as far as the failure would have no line to make claims
       about. This one says the failure happened and reached the reader in the
       words they saw. */
    const marker = lines().find((l) => l.level === "marker" && l.turn === "empty");
    expect(marker, `child produced no marker\n${stdout}\n${stderr}`).toBeTruthy();
    expect(marker?.outcome).toBe("threw");
    expect(String(marker?.message)).toContain("[ai-empty]");
  });

  it("says how many rounds ran, so the tool cap is visible in the record", () => {
    // Four: three that asked for tools and the one that was offered none.
    expect(emptyAnswerLine().rounds).toBe(ROUNDS);
  });

  it("says how many tools ran, because eight of them is the story", () => {
    /* And it is eight, not three. The cap is on *rounds*, and a model may ask
       for several tools in one — so a log carrying only `rounds` would still
       not have answered the question Greg's screenshot asked. */
    expect(emptyAnswerLine().tools).toBe(TOOL_CALLS);
  });

  it("says what the turn cost, so a spent budget is tellable from an idle one", () => {
    const line = emptyAnswerLine();
    /* Summed across rounds, not just the last one's — and summed over the
       rounds that actually reported, not over every round. One of these four
       says nothing, and before the fix its silence was filled in with the
       previous round's numbers. */
    expect(line.inputTokens).toBe(1000 * REPORTING.length);
    expect(line.cacheReadTokens).toBe(900 * REPORTING.length);
    // The last round is the cheap one; the tool rounds cost 200 each.
    const lastRoundReported = SILENT_ROUND !== ROUNDS - 1;
    const toolRoundsReported = REPORTING.filter((r) => r < CALLS_PER_ROUND.length).length;
    expect(line.outputTokens).toBe(200 * toolRoundsReported + (lastRoundReported ? 20 : 0));
  });

  it("still says the two things it always said", () => {
    const line = emptyAnswerLine();
    // `stop`, not `length` — which is what makes this `[ai-empty]` rather than
    // `[ai-no-room]`, and is the first thing anyone reading the log needs.
    expect(line.finishReason).toBe("stop");
    expect(line.chars).toBe(0);
  });

  it("counts tokens the provider already billed, even on a round that died", () => {
    /* The other way a turn ends without an answer. The totals are banked when a
       round's stream closes cleanly, so a stream that reported its usage and
       *then* broke never reached that line — and the failure line said the turn
       had cost nothing. These fields are named for what a turn cost, and the
       usage block is the provider's own billing record: leaving out tokens it
       has already told us about makes the number wrong at exactly the moment
       somebody is reading it to find out what a failure cost. Found by a GPT Sol
       review, 2026-08-26. */
    const line = lines().find((l) => String(l.msg ?? "").includes("broke off"));
    expect(line, `no "broke off" line from the child\n${stdout}\n${stderr}`).toBeTruthy();
    expect(line?.outputTokens).toBe(DIED_OUTPUT);
    expect(line?.inputTokens).toBe(1000);
    // And it is the first round of a fresh turn, with no tools behind it.
    expect(line?.rounds).toBe(1);
    expect(line?.tools).toBe(0);
  });

  it("keeps the reader's question and the article out of the log", () => {
    /* The rule from docs/project/logging.md, checked here because this file
       adds fields to an error line and that is exactly where prose leaks. */
    expect(stdout).not.toContain("search my library");
    expect(stdout).not.toContain("Consciousness is not computation");
  });
});
