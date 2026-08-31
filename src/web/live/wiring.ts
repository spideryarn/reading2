/**
 * **The two requests a live session makes of our own server**, behind one seam.
 *
 * Everything else in live conversation goes browser↔OpenAI: the audio, the
 * events, the model's answer. Our server is asked exactly two things — for a
 * ticket to open the session with, and to run a tool the model called. This is
 * both of them, and it is an argument rather than an import for the reason
 * `ChatEffects` is: it is what lets the same hook drive the real app and the
 * throwaway preview page, whose whole value is that it is not behind the auth
 * gate (docs/project/browser-testing.md).
 *
 * There is no `speak` here. Writing a finished exchange into the thread is not
 * a live-session concern at all — it goes through the chat controller, as an
 * operation with an identity and a projection, and the hook is handed that
 * function separately. A `speak` in this interface would read as one more
 * endpoint and it is the opposite: it is the seam where live conversation stops
 * being its own feature and becomes a turn in a conversation.
 */
import type { MicPlacement } from "../../types.js";
import { apiFetch, failure, readJson } from "../lib/api.js";

/** What one live session is opened with. The server's half is `liveChatToken`. */
export interface LiveTicket {
  /** The `ek_…` client secret. Short-lived, one connection. */
  token: string;
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

export interface LiveWiring {
  /** Mint a session for this conversation, and get its history with it. */
  ticket(slug: string, threadId: string, placement: MicPlacement): Promise<LiveTicket>;
  /** Run one chat tool the model asked for. */
  runTool(
    slug: string,
    name: string,
    args: Record<string, unknown>,
  ): Promise<LiveToolResult>;
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
  async ticket(slug, threadId, placement) {
    const res = await apiFetch(
      `/api/chat/${encodeURIComponent(slug)}/${encodeURIComponent(threadId)}/live`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ placement }),
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
    };
  },

  async runTool(slug, name, args) {
    const res = await apiFetch(`/api/chat/${encodeURIComponent(slug)}/live-tool`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, args }),
    });
    if (!res.ok) throw await failure(res);
    const out = await readJson<Partial<LiveToolResult>>(res);
    return { content: out.content ?? "", label: out.label ?? name, detail: out.detail ?? "" };
  },
};
