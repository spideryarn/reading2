/**
 * **GPT-Live's tool loop, relayed by the browser** — the pure rules behind it.
 * src/web/live/gpt-live/delegations.ts.
 *
 * The failures here are quiet ones. A tool that runs twice, a continuation
 * sent before the response it continues has completed, a continuation never
 * sent at all: each leaves a voice that says "let me check" and then nothing,
 * with no error on the channel. The first test replays a real trace from the
 * spike; the rest are the orderings that trace does not contain.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import { backendReport } from "../src/web/live/gpt-live/meter.js";

import {
  DelegationLoop,
  MALFORMED_ARGS_OUTPUT,
  MAX_TOOL_ROUNDS,
  OVER_CAP_OUTPUT,
  type DelegationEffect,
} from "../src/web/live/gpt-live/delegations.js";

/* ---------- the events, as the data channel sends them ---------- */

const nested = (delegation: string, event: Record<string, unknown>) => ({
  type: "response.event",
  delegation_id: delegation,
  event,
});
const created = (delegation: string, response: string) =>
  nested(delegation, { type: "response.created", response: { id: response, status: "in_progress" } });
const call = (delegation: string, callId: string, args = '{"topic":"lighthouse"}', name = "lookup_passage") =>
  nested(delegation, {
    type: "response.output_item.done",
    item: { type: "function_call", status: "completed", arguments: args, call_id: callId, name },
  });
const USAGE = { input_tokens: 811, output_tokens: 20, total_tokens: 831 };
const completed = (delegation: string, response: string) =>
  nested(delegation, {
    type: "response.completed",
    response: { id: response, status: "completed", model: "gpt-6-luna", output: [], usage: USAGE },
  });
/** The backend's answer, as a message item. Not a function call, so it starts nothing. */
const message = (delegation: string) =>
  nested(delegation, {
    type: "response.output_item.done",
    item: { type: "message", role: "assistant", content: [{ type: "output_text", text: "Teal." }] },
  });

const kinds = (effects: DelegationEffect[]) =>
  effects.map((e) => (e.type === "send" ? `send:${e.event.type}` : e.type));
const of = <T extends DelegationEffect["type"]>(effects: DelegationEffect[], type: T) =>
  effects.filter((e): e is Extract<DelegationEffect, { type: T }> => e.type === type);
const outputs = (effects: DelegationEffect[]) =>
  of(effects, "send").flatMap((e) =>
    e.event.type === "response.item.create" ? [[e.event.item.call_id, e.event.item.output]] : [],
  );
const creates = (effects: DelegationEffect[]) =>
  of(effects, "send").filter((e) => e.event.type === "response.create").length;

/** Feed events one after another, a millisecond apart. */
function feed(loop: DelegationLoop, events: Record<string, unknown>[], from = 1_000): DelegationEffect[] {
  return events.flatMap((e, i) => loop.push(e, from + i));
}

describe("a real trace: one question, one tool, one answer", () => {
  it("runs the tool once, sends one output and one response.create, then reports the final", () => {
    const trace = JSON.parse(
      readFileSync(new URL("../evals/live/gpt-live-spike/spike-out-allow.json", import.meta.url), "utf8"),
    ) as { events: { t: number; dir: string; ev: Record<string, unknown> }[] };
    const loop = new DelegationLoop();
    const effects: DelegationEffect[] = [];
    for (const { t, dir, ev } of trace.events) {
      if (dir !== "in") continue;
      const now = loop.push(ev, t);
      effects.push(...now);
      /* The tool answers at once, as the spike's did. */
      for (const run of of(now, "runTool")) effects.push(...loop.toolSettled(run.callId, "Painted teal in 1987."));
    }
    expect(kinds(effects)).toEqual([
      "started",
      "runTool",
      "usage",
      "send:response.item.create",
      "send:response.create",
      "usage",
      "delegationFinal",
    ]);
    const [run] = of(effects, "runTool");
    expect(run).toMatchObject({ name: "lookup_passage", args: { topic: "lighthouse" } });
    expect(outputs(effects)).toEqual([[run?.callId, "Painted teal in 1987."]]);
    const [final] = of(effects, "delegationFinal");
    /* The moment the second backend response completed: what the stall rule counts from. */
    expect(final).toMatchObject({ delegationId: run?.delegationId, at: 5010, callIds: [run?.callId] });
    expect(of(effects, "started")[0]).toMatchObject({ delegationId: run?.delegationId, offsetMs: 1200 });
    expect(of(effects, "usage").map((u) => [u.model, u.usage.total_tokens])).toEqual([
      ["gpt-6-luna", 831],
      ["gpt-6-luna", 873],
    ]);
    expect(new Set(of(effects, "usage").map((u) => u.responseId)).size).toBe(2);
    expect(of(effects, "usage").map((u) => u.status)).toEqual(["completed", "completed"]);
  });
});

describe("one continuation per response, and only when it is due", () => {
  it("does not send anything before the response has completed, even with the tool already back", () => {
    const loop = new DelegationLoop();
    expect(kinds(feed(loop, [created("d1", "r1"), call("d1", "c1")]))).toEqual(["started", "runTool"]);
    expect(loop.toolSettled("c1", "found")).toEqual([]);
    const after = feed(loop, [completed("d1", "r1")]);
    expect(kinds(after)).toEqual(["usage", "send:response.item.create", "send:response.create"]);
  });

  it("does not send anything after the response completes until the tool is back", () => {
    const loop = new DelegationLoop();
    const before = feed(loop, [created("d1", "r1"), call("d1", "c1"), completed("d1", "r1")]);
    expect(of(before, "send")).toEqual([]);
    expect(kinds(loop.toolSettled("c1", "found"))).toEqual(["send:response.item.create", "send:response.create"]);
  });

  for (const order of [
    ["c1", "c2"],
    ["c2", "c1"],
  ] as const) {
    it(`waits for both of two calls in one response, settled ${order.join(" then ")}`, () => {
      const loop = new DelegationLoop();
      const start = feed(loop, [created("d1", "r1"), call("d1", "c1"), call("d1", "c2"), completed("d1", "r1")]);
      expect(of(start, "runTool").map((r) => r.callId)).toEqual(["c1", "c2"]);
      expect(of(start, "send")).toEqual([]);
      expect(loop.toolSettled(order[0], `out-${order[0]}`)).toEqual([]);
      const done = loop.toolSettled(order[1], `out-${order[1]}`);
      /* Both outputs, in the order the calls were made, then one response.create. */
      expect(kinds(done)).toEqual(["send:response.item.create", "send:response.item.create", "send:response.create"]);
      expect(outputs(done)).toEqual([
        ["c1", "out-c1"],
        ["c2", "out-c2"],
      ]);
    });
  }

  it("still answers a call whose response.created was never seen", () => {
    const loop = new DelegationLoop();
    expect(of(feed(loop, [call("d1", "c1")]), "runTool")).toHaveLength(1);
    loop.toolSettled("c1", "found");
    const done = feed(loop, [completed("d1", "r1")]);
    expect(kinds(done)).toEqual(["usage", "send:response.item.create", "send:response.create"]);
    expect(of(done, "usage")[0]?.responseId).toBe("r1");
  });

  it("treats a tool failure as an output like any other", () => {
    const loop = new DelegationLoop();
    feed(loop, [created("d1", "r1"), call("d1", "c1"), completed("d1", "r1")]);
    const done = loop.toolSettled("c1", '{"error":"The search timed out."}');
    expect(outputs(done)).toEqual([["c1", '{"error":"The search timed out."}']]);
    expect(creates(done)).toBe(1);
  });
});

describe("a call id runs once, ever", () => {
  it("ignores a repeated output_item.done, before and after the tool is back", () => {
    const loop = new DelegationLoop();
    const first = feed(loop, [created("d1", "r1"), call("d1", "c1"), call("d1", "c1")]);
    expect(of(first, "runTool")).toHaveLength(1);
    const done = [...feed(loop, [completed("d1", "r1")]), ...loop.toolSettled("c1", "found")];
    expect(outputs(done)).toEqual([["c1", "found"]]);
    /* The same call again, after its continuation has gone. */
    expect(feed(loop, [call("d1", "c1")])).toEqual([]);
    expect(feed(loop, [created("d1", "r2"), call("d1", "c1")])).toEqual([]);
  });

  it("ignores a second result for the same call, and a result for a call it never issued", () => {
    const loop = new DelegationLoop();
    feed(loop, [created("d1", "r1"), call("d1", "c1"), completed("d1", "r1")]);
    expect(creates(loop.toolSettled("c1", "found"))).toBe(1);
    expect(loop.toolSettled("c1", "found again")).toEqual([]);
    expect(loop.toolSettled("never-issued", "x")).toEqual([]);
  });

  it("keeps the first result when a tool reports twice before the response completes", () => {
    const loop = new DelegationLoop();
    feed(loop, [created("d1", "r1"), call("d1", "c1")]);
    loop.toolSettled("c1", "first");
    loop.toolSettled("c1", "second");
    expect(outputs(feed(loop, [completed("d1", "r1")]))).toEqual([["c1", "first"]]);
  });

  it("ignores a repeated response.completed", () => {
    const loop = new DelegationLoop();
    const effects = feed(loop, [created("d1", "r1"), message("d1"), completed("d1", "r1"), completed("d1", "r1")]);
    expect(of(effects, "delegationFinal")).toHaveLength(1);
    expect(of(effects, "usage")).toHaveLength(1);
  });
});

describe("calls that are answered without running", () => {
  for (const bad of ['{"topic":', "[1,2]", '"lighthouse"', "null"]) {
    it(`does not run a tool whose arguments are ${bad}, and still answers it`, () => {
      const loop = new DelegationLoop();
      const effects = feed(loop, [created("d1", "r1"), call("d1", "c1", bad), completed("d1", "r1")]);
      expect(of(effects, "runTool")).toEqual([]);
      expect(outputs(effects)).toEqual([["c1", MALFORMED_ARGS_OUTPUT]]);
      expect(creates(effects)).toBe(1);
    });
  }

  it("runs a tool that takes no arguments", () => {
    const loop = new DelegationLoop();
    const effects = feed(loop, [created("d1", "r1"), call("d1", "c1", "")]);
    expect(of(effects, "runTool")[0]?.args).toEqual({});
  });

  it("waits for the good call when a malformed one shares its response", () => {
    const loop = new DelegationLoop();
    const start = feed(loop, [created("d1", "r1"), call("d1", "bad", "{"), call("d1", "good"), completed("d1", "r1")]);
    expect(of(start, "send")).toEqual([]);
    expect(outputs(loop.toolSettled("good", "found"))).toEqual([
      ["bad", MALFORMED_ARGS_OUTPUT],
      ["good", "found"],
    ]);
  });

  it("stops running tools after four rounds and tells the backend to answer", () => {
    const loop = new DelegationLoop();
    const ran: string[] = [];
    for (let round = 1; round <= MAX_TOOL_ROUNDS; round++) {
      const effects = feed(loop, [created("d1", `r${round}`), call("d1", `c${round}`), completed("d1", `r${round}`)]);
      ran.push(...of(effects, "runTool").map((r) => r.callId));
      expect(creates(loop.toolSettled(`c${round}`, "found"))).toBe(1);
    }
    expect(ran).toEqual(["c1", "c2", "c3", "c4"]);
    /* The fifth round: answered, not run, and the backend is still continued so it can answer. */
    const fifth = feed(loop, [created("d1", "r5"), call("d1", "c5"), completed("d1", "r5")]);
    expect(of(fifth, "runTool")).toEqual([]);
    expect(outputs(fifth)).toEqual([["c5", OVER_CAP_OUTPUT]]);
    expect(creates(fifth)).toBe(1);
    const last = feed(loop, [created("d1", "r6"), message("d1"), completed("d1", "r6")]);
    expect(of(last, "delegationFinal")[0]?.callIds).toEqual(["c1", "c2", "c3", "c4", "c5"]);
  });

  it("counts rounds per delegation", () => {
    const loop = new DelegationLoop();
    for (let round = 1; round <= MAX_TOOL_ROUNDS; round++) {
      feed(loop, [created("d1", `r${round}`), call("d1", `c${round}`), completed("d1", `r${round}`)]);
      loop.toolSettled(`c${round}`, "found");
    }
    expect(of(feed(loop, [created("d2", "x1"), call("d2", "y1")]), "runTool")).toHaveLength(1);
  });
});

describe("the final", () => {
  it("is a completed response with no function calls, timed by when it arrived", () => {
    const loop = new DelegationLoop();
    const effects = [
      ...loop.push(created("d1", "r1"), 100),
      ...loop.push(message("d1"), 200),
      ...loop.push(completed("d1", "r1"), 300),
    ];
    expect(of(effects, "delegationFinal")).toEqual([
      { type: "delegationFinal", delegationId: "d1", responseId: "r1", at: 300, callIds: [] },
    ]);
    expect(of(effects, "send")).toEqual([]);
  });

  it("is not reported for a response that asked for a tool", () => {
    const loop = new DelegationLoop();
    const effects = feed(loop, [created("d1", "r1"), call("d1", "c1"), completed("d1", "r1")]);
    expect(of(effects, "delegationFinal")).toEqual([]);
  });

  it("announces a delegation once, from whichever event names it first", () => {
    const loop = new DelegationLoop();
    const effects = feed(loop, [
      { type: "session.delegation.created", offset_ms: 4000, delegation: { id: "d1", response_id: "r1" } },
      created("d1", "r1"),
      completed("d1", "r1"),
    ]);
    expect(of(effects, "started")).toEqual([{ type: "started", delegationId: "d1", offsetMs: 4000, at: 1_000 }]);
    /* And with no session.delegation.created at all, as in the spike's allowmin run. */
    expect(of(feed(new DelegationLoop(), [created("d9", "r1")]), "started")).toHaveLength(1);
  });
});

describe("a backend response that does not finish", () => {
  const failed = (delegation: string, response: string) =>
    nested(delegation, {
      type: "response.failed",
      response: { id: response, status: "failed", error: { message: "server_error" }, usage: USAGE, model: "gpt-6-luna" },
    });

  it("closes its open calls, reports the failure, and sends nothing", () => {
    const loop = new DelegationLoop();
    feed(loop, [created("d1", "r1"), call("d1", "c1"), call("d1", "c2")]);
    loop.toolSettled("c1", "found");
    const effects = loop.push(failed("d1", "r1"), 2_000);
    expect(kinds(effects)).toEqual(["usage", "failed"]);
    /* The usage of a failed response is billed, and says it failed (qi-p78m9ch9). */
    expect(of(effects, "usage")[0]).toMatchObject({ responseId: "r1", status: "failed" });
    expect(of(effects, "failed")[0]).toMatchObject({ delegationId: "d1", at: 2_000, callIds: ["c2"] });
    expect(of(effects, "failed")[0]?.message).toContain("server_error");
    /* The tool that was still running comes back to a response that is gone. */
    expect(loop.toolSettled("c2", "found late")).toEqual([]);
    expect(feed(loop, [failed("d1", "r1")])).toEqual([]);
  });

  it("treats response.incomplete and a nested error the same way", () => {
    const incomplete = new DelegationLoop();
    feed(incomplete, [created("d1", "r1"), call("d1", "c1")]);
    const cut = feed(incomplete, [
      nested("d1", {
        type: "response.incomplete",
        response: {
          id: "r1",
          status: "incomplete",
          incomplete_details: { reason: "max_output_tokens" },
          usage: USAGE,
        },
      }),
    ]);
    expect(of(cut, "usage")[0]).toMatchObject({ responseId: "r1", status: "incomplete" });
    expect(of(cut, "failed")[0]).toMatchObject({ callIds: ["c1"] });
    expect(of(cut, "failed")[0]?.message).toContain("max_output_tokens");

    const errored = new DelegationLoop();
    feed(errored, [created("d1", "r1"), call("d1", "c1")]);
    /* A nested error names no response: it ends the one in progress. */
    const err = feed(errored, [nested("d1", { type: "error", message: "backend unavailable" })]);
    expect(of(err, "failed")[0]).toMatchObject({ callIds: ["c1"] });
    expect(of(err, "failed")[0]?.message).toContain("backend unavailable");
    expect(errored.toolSettled("c1", "found late")).toEqual([]);
  });

  /* Sol's G1, G2 and G4 on the plan for qi-p78m9ch9. One response is billed
     once, by the first terminal event that carries usage, and says how that
     event ended it. */
  it("bills a response whose error came first and whose usage came after, without reviving it", () => {
    const loop = new DelegationLoop();
    feed(loop, [created("d1", "r1"), call("d1", "c1")]);
    feed(loop, [nested("d1", { type: "error", message: "backend unavailable" })]);
    const late = feed(loop, [failed("d1", "r1")]);
    expect(kinds(late)).toEqual(["usage"]);
    expect(of(late, "usage")[0]).toMatchObject({ responseId: "r1", status: "failed" });
    expect(feed(loop, [failed("d1", "r1")])).toEqual([]);
    expect(loop.toolSettled("c1", "found late")).toEqual([]);
  });

  it("bills a response once when it completed and then failed while its tools ran", () => {
    const loop = new DelegationLoop();
    const first = feed(loop, [created("d1", "r1"), call("d1", "c1"), completed("d1", "r1")]);
    expect(of(first, "usage").map((u) => u.status)).toEqual(["completed"]);
    const second = feed(loop, [failed("d1", "r1")]);
    expect(kinds(second)).toEqual(["failed"]);
  });

  it("does not consume billing when an early error carries unusable usage", () => {
    for (const usage of [{}, { input_tokens: 811 }, { input_tokens: -1, output_tokens: 20 }]) {
      const loop = new DelegationLoop();
      const early = feed(loop, [
        created("d1", "r1"),
        call("d1", "c1"),
        nested("d1", { type: "error", response: { id: "r1", usage } }),
      ]);
      expect(of(early, "usage").flatMap((u) => backendReport(u.responseId, u.usage, u.status) ?? [])).toEqual([]);
      const late = feed(loop, [failed("d1", "r1")]);
      expect(of(late, "usage").map((u) => backendReport(u.responseId, u.usage, u.status))).toEqual([
        { kind: "backend", responseId: "r1", status: "failed", inputTokens: 811, cachedInputTokens: 0, outputTokens: 20 },
      ]);
      expect(of(late, "failed")).toEqual([]);
      expect(loop.toolSettled("c1", "found late")).toEqual([]);
      expect(feed(loop, [failed("d1", "r1")])).toEqual([]);
    }
  });

  it.each(["final", "waiting", "continued"] as const)(
    "reports late completed usage once after the response became %s",
    (state) => {
      const loop = new DelegationLoop();
      feed(loop, [created("d1", "r1")]);
      if (state !== "final") feed(loop, [call("d1", "c1")]);
      feed(loop, [nested("d1", { type: "response.completed", response: { id: "r1" } })]);
      if (state === "continued") loop.toolSettled("c1", "found");
      const late = feed(loop, [completed("d1", "r1")]);
      expect(kinds(late)).toEqual(["usage"]);
      expect(of(late, "usage")[0]).toMatchObject({ responseId: "r1", status: "completed", usage: USAGE });
      expect(feed(loop, [completed("d1", "r1")])).toEqual([]);
    },
  );

  it("reads the ending off the event, whatever the response inside it says, and a nested error with usage is failed", () => {
    const disagreeing = feed(new DelegationLoop(), [
      created("d1", "r1"),
      nested("d1", { type: "response.failed", response: { id: "r1", status: "completed", usage: USAGE } }),
    ]);
    expect(of(disagreeing, "usage")[0]?.status).toBe("failed");

    const errored = feed(new DelegationLoop(), [
      created("d1", "r1"),
      nested("d1", { type: "error", message: "backend unavailable", response: { id: "r1", usage: USAGE } }),
    ]);
    expect(of(errored, "usage")[0]).toMatchObject({ responseId: "r1", status: "failed" });
  });

  it("does not stop a later response under the same delegation from working", () => {
    const loop = new DelegationLoop();
    feed(loop, [created("d1", "r1"), call("d1", "c1"), failed("d1", "r1")]);
    const effects = feed(loop, [created("d1", "r2"), message("d1"), completed("d1", "r2")]);
    expect(of(effects, "delegationFinal")).toHaveLength(1);
  });
});

describe("two delegations at once", () => {
  it("files each call under its own delegation, whichever response was created last", () => {
    const loop = new DelegationLoop();
    const effects = feed(loop, [
      created("d1", "r1"),
      created("d2", "r2"),
      /* d1's call arrives while d2's response is the newest. */
      call("d1", "c1"),
      call("d2", "c2"),
      completed("d2", "r2"),
    ]);
    expect(of(effects, "runTool").map((r) => [r.callId, r.delegationId])).toEqual([
      ["c1", "d1"],
      ["c2", "d2"],
    ]);
    /* d2 has completed and d1 has not: d1's result is held, d2's is sent. */
    expect(loop.toolSettled("c1", "one")).toEqual([]);
    expect(outputs(loop.toolSettled("c2", "two"))).toEqual([["c2", "two"]]);
    expect(outputs(feed(loop, [completed("d1", "r1")]))).toEqual([["c1", "one"]]);
  });

  it("keeps them apart when their continuations complete in reverse order", () => {
    const loop = new DelegationLoop();
    feed(loop, [
      created("d1", "r1"),
      call("d1", "c1"),
      completed("d1", "r1"),
      created("d2", "r2"),
      call("d2", "c2"),
      completed("d2", "r2"),
    ]);
    /* Each continuation is its own batch: one output, one response.create. */
    expect(kinds(loop.toolSettled("c1", "one"))).toEqual(["send:response.item.create", "send:response.create"]);
    expect(kinds(loop.toolSettled("c2", "two"))).toEqual(["send:response.item.create", "send:response.create"]);
    /* d1's continuation is created first and finishes last. */
    const effects = [
      ...loop.push(created("d1", "r1b"), 5_000),
      ...loop.push(created("d2", "r2b"), 5_001),
      ...loop.push(completed("d2", "r2b"), 6_000),
      ...loop.push(completed("d1", "r1b"), 7_000),
    ];
    expect(of(effects, "delegationFinal")).toEqual([
      { type: "delegationFinal", delegationId: "d2", responseId: "r2b", at: 6_000, callIds: ["c2"] },
      { type: "delegationFinal", delegationId: "d1", responseId: "r1b", at: 7_000, callIds: ["c1"] },
    ]);
    expect(of(effects, "send")).toEqual([]);
  });
});

describe("events it has no rule for", () => {
  it("does nothing with transcripts, usage ticks, or a top-level error", () => {
    const loop = new DelegationLoop();
    expect(
      feed(loop, [
        { type: "session.output_transcript.delta", start_ms: 0, end_ms: 200, delta: " Hi" },
        { type: "session.usage.updated", usage: { seconds: 15 } },
        { type: "error", error: { message: "event_not_allowed" } },
        nested("d1", { type: "response.in_progress", response: { id: "r1" } }),
      ]),
    ).toEqual([]);
  });
});
