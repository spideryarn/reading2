/**
 * One line from a scheduled job ON the box to the Overseer — box-health and the
 * daily worktree sweep. Plan docs/plans/261010d-standing-jobs-survive-a-reboot.md.
 *
 * **The same client as `gjd-remote tell-overseer`, minus the ssh.** Both read
 * the dashboard's `/api/state`, pick the Overseer's row with `overseerTarget`
 * and post it to `POST /api/steer/message`, so every pane check stays on the
 * server and nothing here repeats or weakens one. The job already runs on the
 * box, so it talks to 127.0.0.1 with `fetch` instead of ssh-ing to itself.
 *
 * **Speaker `box`**, never `greg`: the prefix tells the Overseer this came from
 * a timer, not from Greg and not from a session (actions.ts § SPEAKER_PREFIX).
 *
 * ## Exactly once, as far as the route allows
 *
 * Every message carries a `requestId` minted once and reused, byte for byte with
 * its body, for every retry (tools/fleet/request-key.ts). Resending an
 * envelope the dashboard already acted on returns the stored receipt and types
 * nothing; resending one that never arrived sends it. So a caller that could not
 * tell whether its message went — the connection dropped, or it was killed
 * after the POST and before it wrote down that it had sent — resends the SAME
 * envelope, never a new one. GPT Sol's plan-review finding 5.
 *
 * The route admits an unknown id only within an hour of minting
 * (`REQUEST_ID_SKEW_MS`), so a retry has an hour. After that the answer is
 * `abandoned`: the dashboard can no longer say whether it acted, so the caller
 * stops — never sends it again, because typing twice is the one thing this path
 * exists to prevent.
 */
import { randomBytes } from "node:crypto";

import { DEFAULT_FLEET_PORT, overseerTarget, readTellAnswer, type TellBody } from "./gjd-remote-tell.js";

/**
 * The most a box message may say. The route refuses over 4000 characters
 * AFTER adding the `box` prefix, which is under 200; a report longer than this
 * is not being read anyway.
 */
export const BOX_MESSAGE_MAX = 1500;

/** The steer body with this module's two additions: the speaker, and the key that makes a retry safe. */
export type BoxEnvelope = Omit<TellBody, "speaker"> & { speaker: "box"; requestId: string };

export type BoxNotifyOutcome =
  | { kind: "sent"; to: string }
  /** Nothing was typed. Trying again, with a new envelope if need be, is safe. */
  | { kind: "not-sent"; why: string }
  /** It may have been typed. Resend THIS envelope, and only this one. */
  | { kind: "uncertain"; why: string }
  /** The dashboard can no longer tell whether it acted on this envelope. Do not resend it. */
  | { kind: "abandoned"; why: string };

export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<{ status: number; text(): Promise<string> }>;

export type NotifyOptions = { port?: number; fetch?: FetchLike; timeoutMs?: number; now?: () => number };

/** One line, no control characters, at most `BOX_MESSAGE_MAX`. The route refuses the first two outright. */
export function oneLine(text: string): string {
  let clean = "";
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    clean += code < 0x20 || code === 0x7f ? " " : ch;
  }
  clean = clean.replace(/ {2,}/g, " ").trim();
  return clean.length <= BOX_MESSAGE_MAX ? clean : `${clean.slice(0, BOX_MESSAGE_MAX - 1)}…`;
}

/** `rq-<mint time in ms, base 36>-<20 hex>`, the shape `parseRequestId` takes. */
export function mintRequestId(nowMs: number): string {
  return `rq-${nowMs.toString(36)}-${randomBytes(10).toString("hex")}`;
}

function base(opts: NotifyOptions): string {
  return `http://127.0.0.1:${opts.port ?? DEFAULT_FLEET_PORT}`;
}

function fetcher(opts: NotifyOptions): FetchLike {
  return opts.fetch ?? (fetch as unknown as FetchLike);
}

/**
 * The envelope for one new message, addressed to whoever holds the Overseer
 * claim now — or why there is no one to address. Sends nothing.
 */
export async function prepareEnvelope(
  text: string,
  opts: NotifyOptions = {},
): Promise<{ kind: "ready"; envelope: BoxEnvelope; to: string } | { kind: "not-sent"; why: string }> {
  const url = `${base(opts)}/api/state`;
  let snapshot: unknown;
  try {
    const res = await fetcher(opts)(url, { signal: AbortSignal.timeout(20_000) });
    if (res.status !== 200) return { kind: "not-sent", why: `the dashboard answered ${res.status} for /api/state` };
    snapshot = JSON.parse(await res.text());
  } catch (e) {
    return { kind: "not-sent", why: `could not read the dashboard at ${base(opts)}: ${(e as Error).message}` };
  }
  const target = overseerTarget(snapshot, oneLine(text));
  if (!target.ok) return { kind: "not-sent", why: target.why };
  const { speaker: _greg, ...rest } = target.body;
  const envelope: BoxEnvelope = { ...rest, speaker: "box", requestId: mintRequestId((opts.now ?? Date.now)()) };
  return { kind: "ready", envelope, to: target.name };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * What the route's answer means for this envelope. `readTellAnswer` reads the
 * ordinary answers; the two it does not know are a REPLAY — the stored receipt
 * of an envelope already accepted — and the two request-id refusals.
 */
export function readBoxAnswer(httpStatus: number, raw: string, to: string): BoxNotifyOutcome {
  let body: unknown = null;
  try {
    body = JSON.parse(raw);
  } catch {
    /* readTellAnswer says so below */
  }
  if (httpStatus === 200 && isRecord(body) && body["ok"] === true && body["op"] === "receipt" && body["replay"] === true) {
    const receipt = isRecord(body["receipt"]) ? body["receipt"] : {};
    const state = receipt["state"];
    if (state === "keys-submitted" || state === "completed") return { kind: "sent", to };
    if (state === "not-sent" || state === "withdrawn") return { kind: "not-sent", why: `the earlier attempt's receipt says ${String(state)}` };
    return { kind: "uncertain", why: `the earlier attempt's receipt is ${JSON.stringify(state)}${receipt["pending"] === true ? ", still pending" : ""}` };
  }
  if (isRecord(body) && body["ok"] === false && (body["code"] === "request-id-expired" || body["code"] === "request-id-conflict")) {
    return { kind: "abandoned", why: `${String(body["code"])}: ${String(body["why"] ?? "")}` };
  }
  const answer = readTellAnswer(httpStatus, raw);
  if (answer.ok) return { kind: "sent", to };
  return answer.textMayBeInTheBox ? { kind: "uncertain", why: answer.why } : { kind: "not-sent", why: answer.why };
}

/** Post one envelope — a new one, or a retry of one that came back uncertain. */
export async function postEnvelope(envelope: BoxEnvelope, to: string, opts: NotifyOptions = {}): Promise<BoxNotifyOutcome> {
  let status: number;
  let raw: string;
  try {
    const res = await fetcher(opts)(`${base(opts)}/api/steer/message`, {
      method: "POST",
      // The dashboard's own address as Origin: how a non-browser client opts in
      // to checkOrigin, as `tellPostCommand` does.
      headers: { "content-type": "application/json", origin: base(opts) },
      body: JSON.stringify(envelope),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 90_000),
    });
    status = res.status;
    raw = await res.text();
  } catch (e) {
    // The request may have left; whether it was typed is unknown.
    return { kind: "uncertain", why: `the request did not complete: ${(e as Error).message}` };
  }
  return readBoxAnswer(status, raw, to);
}

/** Retry only an uncertain answer, always with the identical prepared envelope. */
export async function postEnvelopeWithRetries(
  envelope: BoxEnvelope,
  to: string,
  opts: NotifyOptions & { tries?: number; gapMs?: number } = {},
): Promise<BoxNotifyOutcome> {
  let outcome: BoxNotifyOutcome = { kind: "uncertain", why: "not yet posted" };
  for (let i = 0; i < (opts.tries ?? 3); i++) {
    if (i > 0) await new Promise((resolve) => setTimeout(resolve, opts.gapMs ?? 30_000));
    outcome = await postEnvelope(envelope, to, opts);
    if (outcome.kind !== "uncertain") break;
  }
  return outcome;
}

/**
 * Prepare and post, retrying an UNCERTAIN answer with the same envelope up to
 * `tries` times, `gapMs` apart. Durable callers use `prepareEnvelope` and
 * `postEnvelopeWithRetries` directly so they can carry the envelope to a later
 * process as well.
 */
export async function tellOverseerFromBox(
  text: string,
  opts: NotifyOptions & { tries?: number; gapMs?: number } = {},
): Promise<BoxNotifyOutcome> {
  const prepared = await prepareEnvelope(text, opts);
  if (prepared.kind !== "ready") return prepared;
  return postEnvelopeWithRetries(prepared.envelope, prepared.to, opts);
}

/** The journal line for an outcome. */
export function describeBoxNotify(o: BoxNotifyOutcome): string {
  switch (o.kind) {
    case "sent":
      return `told the Overseer (${o.to})`;
    case "not-sent":
      return `NOT told the Overseer, nothing typed — ${o.why}`;
    case "uncertain":
      return `delivery to the Overseer UNCERTAIN — ${o.why}`;
    case "abandoned":
      return `delivery to the Overseer cannot be confirmed and will not be retried — ${o.why}`;
    default: {
      const unreachable: never = o;
      return String(unreachable);
    }
  }
}
