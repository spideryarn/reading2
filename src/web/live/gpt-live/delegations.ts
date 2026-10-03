/**
 * **GPT-Live's tool loop, relayed by the browser.**
 *
 * A pure reducer: no network, no clock, no React. `useGptLive` feeds it the
 * events from the data channel and the result of each tool it ran, and gets
 * back a list of **effects** to perform: run this tool, send this event, this
 * delegation has its final answer, this one failed, here is a usage figure.
 * docs/plans/261003a-gpt-live-alongside-realtime-for-live-conversation.md § Tools.
 *
 * ## The wire
 *
 * The voice model hands a question to a text model (the *backend*). That is a
 * **delegation**, and it has an id. The backend's Responses events arrive
 * wrapped: `{type: "response.event", delegation_id, event}`. A function call
 * arrives as the nested `response.output_item.done`; the browser answers with
 * `response.item.create {function_call_output}` and then `response.create`,
 * and the continuation is a **new response id under the same delegation id**.
 *
 * So everything here is keyed by delegation id, then response id. A nested
 * `response.output_item.done` carries no response id of its own; it belongs to
 * the response most recently created under its delegation.
 *
 * ## The rules
 *
 * - **A call id runs once, ever.** A repeated `output_item.done` is ignored.
 * - **One continuation per response**, and only when that response has
 *   completed *and* every call in it has an output. The outputs and the
 *   `response.create` go out together, in that order, as one batch. Nothing is
 *   sent before the response completes: that is the order the spike and
 *   WhatNext both use, and no other order has been tried against the provider.
 * - **A tool is started as soon as its call arrives**, without waiting for the
 *   response to complete, because the reader is listening to silence.
 * - **A tool failure is still an output.** The caller passes the failure text
 *   to `toolSettled` like any result.
 * - **Malformed arguments are answered, not run.** The output says so.
 * - **Four tool rounds per delegation.** A round is one continuation. A call
 *   that arrives after the fourth is not run; its output is `OVER_CAP_OUTPUT`.
 * - **A completed response with no function calls is the delegation's final.**
 *   That moment is what the stall rule (`./stall.ts`) counts from.
 * - **`response.failed`, `response.incomplete` and a nested `error`** end the
 *   response. Its unanswered calls are named in the `failed` effect so the
 *   caller can show them as errors, nothing is sent, and a late `toolSettled`
 *   for one of them does nothing.
 *
 * ## Not ported from Realtime: reader speech cancels nothing
 *
 * `../tool-responses.ts` drops a pending continuation when the reader starts
 * speaking, because in Realtime the next voice turn will answer with the tool
 * results already in context. **Here it would be a bug.** GPT-Live's backend
 * is waiting on these outputs and no reader turn will ever supply them, so a
 * dropped continuation leaves the delegation waiting for ever. This reducer
 * has no input for reader speech at all.
 *
 * ## What it cannot know
 *
 * `response.create` carries no delegation id; the provider works out which
 * delegation continues from the outputs just sent. With one delegation that is
 * unambiguous. With two overlapping it is the provider's behaviour, and the
 * spike traces show only one delegation at a time. What this reducer
 * guarantees is its own half: each delegation's outputs are followed
 * immediately by its own `response.create`, and events coming back are filed
 * by the delegation id they carry.
 */

/** A delegation gets this many continuations. Calls after that are answered without running. */
export const MAX_TOOL_ROUNDS = 4;
/** The output for a call past the cap. */
export const OVER_CAP_OUTPUT = "Answer now from what you have.";
/** The output for a call whose arguments were not a JSON object. */
export const MALFORMED_ARGS_OUTPUT = JSON.stringify({
  error: "The arguments were not a valid JSON object, so the tool was not run.",
});
/** The delegation id used when a nested event carries none. */
const UNCORRELATED = "uncorrelated";

/** What the browser may send back. Both are on the data channel's client allowlist. */
export type DelegationClientEvent =
  | {
      type: "response.item.create";
      item: { type: "function_call_output"; call_id: string; output: string };
    }
  | { type: "response.create" };

export type DelegationEffect =
  /** A delegation was seen for the first time. The stall rule's "a delegation is running". */
  | { type: "started"; delegationId: string; offsetMs: number | null; at: number }
  /** Run this tool, then call `toolSettled(callId, output)`. `show_passage` arrives here like any other. */
  | {
      type: "runTool";
      callId: string;
      name: string;
      args: Record<string, unknown>;
      delegationId: string;
    }
  /** Put this on the data channel, in the order given. */
  | { type: "send"; event: DelegationClientEvent }
  /** The backend's last response completed with no function calls: its answer is ready to be spoken. */
  | {
      type: "delegationFinal";
      delegationId: string;
      responseId: string;
      at: number;
      /** Every call the delegation made, in order, so the caller can gather its receipts. */
      callIds: string[];
    }
  /** A backend response failed, was cut short, or errored. Nothing more will be sent for it. */
  | {
      type: "failed";
      delegationId: string;
      message: string;
      at: number;
      /** Calls that were still running. Their results will be ignored; show them as errors. */
      callIds: string[];
    }
  /** A backend response's token usage, passed through untouched for the meter. One per response id. */
  | {
      type: "usage";
      delegationId: string;
      responseId: string;
      model: string | null;
      usage: Record<string, unknown>;
    };

/**
 * Where one backend response is.
 *
 * `open` until it completes. `waiting` when it completed having made calls,
 * some of which have no output yet. `continued` once its batch has been sent.
 */
type ResponseState = "open" | "waiting" | "continued" | "final" | "dead";

interface BackendResponse {
  id: string;
  state: ResponseState;
  calls: string[];
}

interface Call {
  delegationId: string;
  response: BackendResponse;
  /** Null while the tool is running. */
  output: string | null;
}

interface Delegation {
  id: string;
  responses: Map<string, BackendResponse>;
  /** The response most recently created and not yet ended. */
  active: BackendResponse | null;
  /** Continuations sent. */
  rounds: number;
  calls: string[];
}

/** The events this reducer acts on, parsed from the wire. Everything else is ignored. */
type Wire =
  | { kind: "delegation"; delegationId: string; responseId: string | null; offsetMs: number | null }
  | { kind: "created"; delegationId: string; responseId: string }
  | { kind: "call"; delegationId: string; callId: string; name: string; rawArgs: string }
  | {
      kind: "completed";
      delegationId: string;
      responseId: string | null;
      model: string | null;
      usage: Record<string, unknown> | null;
    }
  | {
      kind: "ended";
      delegationId: string;
      responseId: string | null;
      model: string | null;
      usage: Record<string, unknown> | null;
      message: string;
    };

export class DelegationLoop {
  private readonly delegations = new Map<string, Delegation>();
  private readonly calls = new Map<string, Call>();

  /**
   * Feed one event from the data channel, with the time it arrived.
   *
   * Returns rather than calls back, so the caller owns the order things are
   * done in. Events this reducer has no rule for return nothing.
   */
  push(event: Record<string, unknown>, now: number): DelegationEffect[] {
    const wire = parse(event);
    if (!wire) return [];
    const effects: DelegationEffect[] = [];
    const delegation = this.delegation(wire.delegationId, now, wire.kind === "delegation" ? wire.offsetMs : null, effects);
    switch (wire.kind) {
      case "delegation":
        if (wire.responseId) this.response(delegation, wire.responseId);
        return effects;
      case "created":
        delegation.active = this.response(delegation, wire.responseId);
        return effects;
      case "call":
        return [...effects, ...this.called(delegation, wire)];
      case "completed":
        return [...effects, ...this.completed(delegation, wire, now)];
      case "ended":
        return [...effects, ...this.ended(delegation, wire, now)];
      default:
        return unreachable(wire);
    }
  }

  /**
   * A tool finished, or failed: either way this is its output.
   *
   * Ignored for a call id that was never issued, that already has an output,
   * or whose response has ended.
   */
  toolSettled(callId: string, output: string): DelegationEffect[] {
    const call = this.calls.get(callId);
    if (!call || call.output !== null) return [];
    call.output = output;
    const delegation = this.delegations.get(call.delegationId);
    return delegation ? this.continuation(delegation, call.response) : [];
  }

  private delegation(id: string, now: number, offsetMs: number | null, effects: DelegationEffect[]): Delegation {
    let delegation = this.delegations.get(id);
    if (!delegation) {
      delegation = { id, responses: new Map(), active: null, rounds: 0, calls: [] };
      this.delegations.set(id, delegation);
      effects.push({ type: "started", delegationId: id, offsetMs, at: now });
    }
    return delegation;
  }

  private response(delegation: Delegation, id: string): BackendResponse {
    let response = delegation.responses.get(id);
    if (!response) {
      response = { id, state: "open", calls: [] };
      delegation.responses.set(id, response);
    }
    return response;
  }

  /** The response an event belongs to: by its own id when it has one, else the active one. */
  private find(delegation: Delegation, responseId: string | null): BackendResponse | null {
    if (responseId) return delegation.responses.get(responseId) ?? null;
    return delegation.active;
  }

  private called(delegation: Delegation, wire: Extract<Wire, { kind: "call" }>): DelegationEffect[] {
    if (this.calls.has(wire.callId)) return [];
    let response = delegation.active;
    /* No response in progress to belong to: its `response.created` was not
       seen. Held under a nameless response, which the next completion for this
       delegation takes over (`adopt`). */
    if (!response) {
      response = { id: "", state: "open", calls: [] };
      delegation.responses.set("", response);
      delegation.active = response;
    }
    const call: Call = { delegationId: delegation.id, response, output: null };
    this.calls.set(wire.callId, call);
    response.calls.push(wire.callId);
    delegation.calls.push(wire.callId);

    if (delegation.rounds >= MAX_TOOL_ROUNDS) {
      call.output = OVER_CAP_OUTPUT;
      return this.continuation(delegation, response);
    }
    const args = parseArgs(wire.rawArgs);
    if (!args) {
      call.output = MALFORMED_ARGS_OUTPUT;
      return this.continuation(delegation, response);
    }
    return [{ type: "runTool", callId: wire.callId, name: wire.name, args, delegationId: delegation.id }];
  }

  private completed(delegation: Delegation, wire: Extract<Wire, { kind: "completed" }>, now: number): DelegationEffect[] {
    const response = this.adopt(delegation, wire.responseId);
    if (response.state !== "open") return [];
    if (delegation.active === response) delegation.active = null;
    const effects: DelegationEffect[] = usageOf(delegation, response, wire);
    if (response.calls.length === 0) {
      response.state = "final";
      effects.push({
        type: "delegationFinal",
        delegationId: delegation.id,
        responseId: response.id,
        at: now,
        callIds: [...delegation.calls],
      });
      return effects;
    }
    response.state = "waiting";
    return [...effects, ...this.continuation(delegation, response)];
  }

  private ended(delegation: Delegation, wire: Extract<Wire, { kind: "ended" }>, now: number): DelegationEffect[] {
    const response = wire.responseId ? this.adopt(delegation, wire.responseId) : delegation.active;
    /* A repeat of an ending already handled, or a failure report for a
       response that was already continued or was the final. */
    if (response && response.state !== "open" && response.state !== "waiting") return [];
    const closed: string[] = [];
    const effects: DelegationEffect[] = [];
    if (response) {
      response.state = "dead";
      if (delegation.active === response) delegation.active = null;
      for (const callId of response.calls) {
        /* Still running. Its result, when it comes, finds the response dead
           and goes nowhere. */
        if (this.calls.get(callId)?.output === null) closed.push(callId);
      }
      effects.push(...usageOf(delegation, response, wire));
    }
    effects.push({ type: "failed", delegationId: delegation.id, message: wire.message, at: now, callIds: closed });
    return effects;
  }

  /** The response a terminal event names, taking over the nameless one if its `created` was missed. */
  private adopt(delegation: Delegation, responseId: string | null): BackendResponse {
    const known = this.find(delegation, responseId);
    if (known) return known;
    const nameless = delegation.responses.get("");
    if (nameless && nameless.state === "open" && responseId) {
      delegation.responses.delete("");
      nameless.id = responseId;
      delegation.responses.set(responseId, nameless);
      return nameless;
    }
    return this.response(delegation, responseId ?? "");
  }

  /** The batch for a response, if it is due: every output, then one `response.create`. */
  private continuation(delegation: Delegation, response: BackendResponse): DelegationEffect[] {
    if (response.state !== "waiting") return [];
    const effects: DelegationEffect[] = [];
    for (const callId of response.calls) {
      const output = this.calls.get(callId)?.output;
      if (output === null || output === undefined) return [];
      effects.push({
        type: "send",
        event: { type: "response.item.create", item: { type: "function_call_output", call_id: callId, output } },
      });
    }
    response.state = "continued";
    delegation.rounds++;
    effects.push({ type: "send", event: { type: "response.create" } });
    return effects;
  }
}

function usageOf(
  delegation: Delegation,
  response: BackendResponse,
  wire: { model: string | null; usage: Record<string, unknown> | null },
): DelegationEffect[] {
  if (!wire.usage || response.id === "") return [];
  return [{ type: "usage", delegationId: delegation.id, responseId: response.id, model: wire.model, usage: wire.usage }];
}

function parse(event: Record<string, unknown>): Wire | null {
  if (event.type === "session.delegation.created") {
    const delegation = record(event.delegation);
    const id = text(delegation?.id);
    if (!id) return null;
    return {
      kind: "delegation",
      delegationId: id,
      responseId: text(delegation?.response_id),
      offsetMs: typeof event.offset_ms === "number" ? event.offset_ms : null,
    };
  }
  if (event.type !== "response.event") return null;
  const nested = record(event.event);
  if (!nested) return null;
  const delegationId = text(event.delegation_id) ?? UNCORRELATED;
  const response = record(nested.response);
  const responseId = text(response?.id);
  const model = text(response?.model);
  const usage = record(response?.usage);

  switch (nested.type) {
    case "response.created":
      return responseId ? { kind: "created", delegationId, responseId } : null;
    case "response.output_item.done": {
      const item = record(nested.item);
      const callId = text(item?.call_id);
      if (item?.type !== "function_call" || !callId) return null;
      return {
        kind: "call",
        delegationId,
        callId,
        name: text(item.name) ?? "",
        rawArgs: typeof item.arguments === "string" ? item.arguments : "",
      };
    }
    case "response.completed":
      return { kind: "completed", delegationId, responseId, model, usage };
    case "response.failed":
    case "response.incomplete":
    case "error": {
      const reason =
        text(record(response?.error)?.message) ??
        text(record(response?.incomplete_details)?.reason) ??
        text(nested.message) ??
        text(record(nested.error)?.message) ??
        String(nested.type).replace("response.", "");
      return {
        kind: "ended",
        delegationId,
        responseId,
        model,
        usage,
        message: `The delegated response did not finish: ${reason}`,
      };
    }
    default:
      return null;
  }
}

/** The arguments as an object, or null when they are not one. An empty string is no arguments. */
function parseArgs(raw: string): Record<string, unknown> | null {
  if (raw.trim() === "") return {};
  try {
    return record(JSON.parse(raw));
  } catch {
    return null;
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function unreachable(value: never): never {
  throw new Error(`Unhandled delegation event: ${JSON.stringify(value)}`);
}
