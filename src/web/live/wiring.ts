/**
 * **The five requests a live session makes of our own server**, behind one seam.
 *
 * Everything else in live conversation goes browser↔OpenAI: the audio, the
 * events, the model's answer. Our server is asked for a ticket to open the
 * session with, for a tool the model called to be run — and, since Stage 2B of
 * docs/plans/260902g-cost-tracking-that-can-set-a-price.md, told what the
 * session spent, because the `usage` object OpenAI attaches to every turn is
 * delivered to this tab and to nothing else. This is all five, and it is an
 * argument rather than an import for the reason `ChatEffects` is: it is what
 * lets the same hook drive the real app and the throwaway preview page, whose
 * whole value is that it is not behind the auth gate
 * (docs/project/browser-testing.md).
 *
 * There is no `speak` here. Writing a finished exchange into the thread is not
 * a live-session concern at all — it goes through the chat controller, as an
 * operation with an identity and a projection, and the hook is handed that
 * function separately. A `speak` in this interface would read as one more
 * endpoint and it is the opposite: it is the seam where live conversation stops
 * being its own feature and becomes a turn in a conversation.
 */
import type { MicPlacement } from "../../types.js";
import type { MeterTransport, PostOutcome } from "./meter.js";
import { apiFetch, failure, readJson } from "../lib/api.js";

/** What one live session is opened with. The server's half is `liveChatToken`. */
export interface LiveTicket {
  /** The `ek_…` client secret. Short-lived, one connection. */
  token: string;
  /**
   * **This server's own journal row for the conversation**, and the thing every
   * accounting report is addressed to — not the OpenAI session id, which this
   * server never sees.
   *
   * `null` where there is no journal: the preview page talks to
   * `scripts/live-spike.ts`, which mints a token and writes no row, so a session
   * opened from there is genuinely unmetered rather than metered badly. The hook
   * says so once in the console rather than posting reports at an id nothing
   * owns.
   */
  sessionId: string | null;
  /** Unix seconds. */
  expiresAt: number;
  /** The model the created session actually got, from OpenAI rather than us. */
  model: string;
  /**
   * The conversation so far, windowed and with our block ids stripped out.
   *
   * Built on the server so that `recentHistory` stays the one thing deciding
   * what a model may see, and so the ids come out in one place — see
   * `liveSeedItems` in src/live.ts for why seeding a *voice* model with typed
   * history verbatim is a trap.
   */
  seed: { role: "user" | "assistant"; text: string }[];
  /**
   * The row that was last when the seed was taken, or `null` for an empty
   * conversation.
   *
   * The first spoken exchange claims exactly this, and the pair travels
   * together on purpose: a tail read separately from the history it belongs to
   * is a claim about a conversation that never existed.
   */
  tailId: string | null;
}

/** What a tool run comes back as. Trimmed from `ToolOutcome` on the server. */
export interface LiveToolResult {
  content: string;
  label: string;
  detail: string;
}

export interface LiveWiring extends MeterTransport {
  /** Mint a session for this conversation, and get its history with it. */
  ticket(slug: string, threadId: string, placement: MicPlacement, signal?: AbortSignal): Promise<LiveTicket>;
  /** Run one chat tool the model asked for. */
  runTool(
    slug: string,
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<LiveToolResult>;
  /* The three accounting calls come from `MeterTransport` in ./meter.ts, which
     is where the queue that drives them lives. Extended rather than restated,
     so the meter's own tests can supply a transport without a ticket or a tool
     runner — and **required rather than optional**, because the alternative is
     a wiring that silently meters nothing and a `usage` figure that reads as a
     cheap conversation rather than as an absent one. */
}

/**
 * **What one accounting post came back as**, in the three-way form the meter's
 * queue needs. The distinction that matters is 400 from 500.
 *
 * A 4xx is the server having read the report and refused it — `badReport` in
 * src/live.ts answers a malformed or impossible report that way *on purpose*,
 * so that the browser stops rather than retrying something that can never be
 * accepted. A 5xx or a thrown `fetch` is the request not having arrived, which
 * is worth trying again.
 *
 * `408` and `429` are the two 4xx statuses that mean "not now" rather than
 * "not ever", so they retry.
 */
async function post(path: string, body: unknown, keepalive: boolean): Promise<PostOutcome> {
  try {
    const res = await apiFetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      /* Only on the last pass. A keepalive request survives the page unloading,
         within a small per-page budget and with no feedback about whether it
         arrived — which is why the hook posts every turn as it happens and
         treats this as a hint. `navigator.sendBeacon` is not an option at all:
         it cannot set an `Authorization` header, and every route under `/api/`
         takes a bearer token and no cookie. */
      ...(keepalive ? { keepalive: true } : {}),
    });
    if (res.ok) return "accepted";
    if (res.status === 408 || res.status === 429 || res.status >= 500) return "retry";
    /* **Said out loud, once per refusal.** The body of a 400 from this endpoint
       names the field that was wrong, and a meter that dropped those silently
       would look exactly like a meter with nothing to send. Nothing reaches the
       reader: an accounting failure is not their problem and there is nothing
       they could do about it. */
    console.error(`[live-meter] ${res.status} on ${path}`, (await failure(res)).message);
    return "refused";
  } catch {
    return "retry";
  }
}

/**
 * The real one: the app's own API, behind the auth gate.
 *
 * **It throws**, unlike `ChatEffects`, and that is the difference in what the
 * caller does with a failure. A chat effect's failure is an event the reducer
 * has to admit or refuse; a live session's is fatal to the session — there is
 * nothing to draw, nothing to withdraw, and the only sensible answer is to stop
 * and say why. The hook has one `catch` around the whole of `start` for exactly
 * that, and it releases the microphone before it reports.
 */
export const apiWiring: LiveWiring = {
  async ticket(slug, threadId, placement, signal) {
    const res = await apiFetch(
      `/api/chat/${encodeURIComponent(slug)}/${encodeURIComponent(threadId)}/live`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ placement }),
        ...(signal ? { signal } : {}),
      },
    );
    if (!res.ok) throw await failure(res);
    const ticket = await readJson<Partial<LiveTicket>>(res);
    /* Checked rather than cast. Without a token there is nothing to connect
       with, and the string "undefined" reaching the SDP exchange comes back as
       a 400 about SDP — one layer away from what is actually wrong. */
    if (!ticket.token) throw new Error("The server started a session without a key for it.");
    return {
      token: ticket.token,
      expiresAt: ticket.expiresAt ?? 0,
      model: ticket.model ?? "",
      seed: ticket.seed ?? [],
      /* `null` rather than `??`-ing to something: an absent tail and a tail of
         `null` mean the same thing here — an empty conversation — and there is
         no third answer to guess at. */
      tailId: ticket.tailId ?? null,
      /* **Absent is not fatal, and deliberately.** A session id missing from
         this response means a server too old to journal, and refusing to start
         would take a working feature down over accounting. The hook says so in
         the console and meters nothing. */
      sessionId: typeof ticket.sessionId === "string" ? ticket.sessionId : null,
    };
  },

  async runTool(slug, name, args, signal) {
    const res = await apiFetch(`/api/chat/${encodeURIComponent(slug)}/live-tool`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, args }),
      ...(signal ? { signal } : {}),
    });
    if (!res.ok) throw await failure(res);
    const out = await readJson<Partial<LiveToolResult>>(res);
    return { content: out.content ?? "", label: out.label ?? name, detail: out.detail ?? "" };
  },

  /* The three accounting posts. None of them throws and none of them tells the
     reader anything: a conversation that is going well must not be interrupted
     because the ledger could not be written, and a conversation that has ended
     has nobody left to tell. */
  liveConnected(sessionId, keepalive) {
    return post(`/api/live/${encodeURIComponent(sessionId)}/connected`, {}, keepalive);
  },

  liveUsage(sessionId, report, keepalive) {
    return post(`/api/live/${encodeURIComponent(sessionId)}/usage`, report, keepalive);
  },

  liveClose(sessionId, reason, keepalive) {
    return post(`/api/live/${encodeURIComponent(sessionId)}/close`, { reason }, keepalive);
  },
};
