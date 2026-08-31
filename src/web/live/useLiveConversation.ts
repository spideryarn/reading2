/**
 * **The browser half of live conversation mode** — a spike, 2026-08-31.
 * docs/plans/live-conversation.md, and src/live.ts for the server half.
 *
 * The audio never touches our server. This hook opens a `RTCPeerConnection`
 * straight to OpenAI, using a short-lived token our server minted, and from
 * then on the conversation is between the reader's microphone and the model.
 * Our server is asked exactly two things: for the token, and to run a tool.
 *
 * That is not a shortcut, it is the only shape available. Audio relayed through
 * a Vercel function would need a long-lived socket, which a serverless function
 * does not have — and WebRTC buys three things a hand-rolled socket would have
 * to reimplement badly: jitter buffering, echo cancellation, and a server-side
 * output buffer that truncates itself the moment the reader talks over it.
 *
 * ## Two things here exist so this can be tested at all
 *
 * A browser agent cannot grant a microphone permission — it is browser chrome,
 * not page content, and the whole two-pass dictation work stopped at exactly
 * that line (docs/project/dictation.md § What a browser pass could and could
 * not check). So:
 *
 * - **`microphone: false` sends a silent synthetic track** built from an
 *   `AudioContext`, which needs no permission. Everything else is the shipping
 *   path: the same token, the same SDP exchange, the same data channel, the
 *   same events.
 * - **`say(text)` injects a typed turn** the way a spoken one arrives. It is
 *   what makes the tool loop, the pointing and the model's own transcript
 *   checkable without anybody speaking.
 *
 * Neither is a stub of the thing being tested. They are two ways in to the same
 * live session.
 *
 * ## Every event is recorded, including the ones we do not handle
 *
 * `seen` counts every `type` that arrives, handled or not. It was added because
 * the event names are the part of this API most likely to be wrong in whatever
 * we read: the pre-GA beta called the assistant's transcript
 * `response.audio_transcript.*` and the current API calls it
 * `response.output_audio_transcript.*`, and a handler written against the wrong
 * one produces a conversation that talks and shows nothing, with no error
 * anywhere.
 *
 * It earned its place on the first run. Both spellings were handled, and the
 * tally settled it by measurement — 99 `output_audio_transcript` deltas, zero
 * of the other — so the dead branch is gone and this is how to check again if
 * it ever moves. It also confirmed `output_audio_buffer.started`/`.stopped`,
 * which the documentation does not describe and which drive the speaking pill.
 */

import { useCallback, useRef, useState } from "react";

/** Where the connection is. `failed` carries a sentence in `error`. */
export type LivePhase = "idle" | "connecting" | "live" | "closing" | "failed";

/** One side's turn, assembled as it arrives. */
export interface LiveLine {
  /** OpenAI's item id. The identity — deltas arrive against it. */
  id: string;
  role: "reader" | "companion";
  text: string;
  /** Has the final transcript landed, or is this still filling in? */
  done: boolean;
}

/** Somewhere in the article the model pointed at, via `show_passage`. */
export interface LivePointer {
  blockIds: string[];
  why: string;
  at: number;
}

/** A server-side tool the model ran, for the strip. */
export interface LiveToolRun {
  callId: string;
  name: string;
  label: string;
  detail: string;
  ms: number;
}

export interface LiveApi {
  phase: LivePhase;
  error: string | null;
  /** Both sides, in the order their turns began. */
  lines: LiveLine[];
  pointers: LivePointer[];
  tools: LiveToolRun[];
  /** Is the reader being heard right now? Server VAD's opinion, not ours. */
  hearing: boolean;
  /** Is the model talking right now? */
  speaking: boolean;
  /** Every event type seen, and how many. The instrument — see the header. */
  seen: Record<string, number>;
  start: (opts?: { microphone?: boolean }) => void;
  stop: () => void;
  /** Put a typed turn in, as if it had been spoken. */
  say: (text: string) => void;
}

/** Where the spike's server is. src/../scripts/live-spike.ts. */
const SPIKE = "http://127.0.0.1:5399";

/**
 * A track that carries silence, so an offer can have audio in it with no
 * permission prompt.
 *
 * A gain of zero rather than a muted track: a muted track is still a
 * `getUserMedia` track and still needs the grant. This is an oscillator that is
 * never audible, which is a real `MediaStreamTrack` from the peer connection's
 * point of view and costs the reader nothing because there is no reader.
 */
function silentTrack(): MediaStreamTrack {
  const ctx = new AudioContext();
  const dest = ctx.createMediaStreamDestination();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  gain.gain.value = 0;
  osc.connect(gain).connect(dest);
  osc.start();
  const track = dest.stream.getAudioTracks()[0];
  if (!track) throw new Error("no synthetic audio track [live-no-track]");
  return track;
}

export function useLiveConversation(slug: string): LiveApi {
  const [phase, setPhase] = useState<LivePhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<LiveLine[]>([]);
  const [pointers, setPointers] = useState<LivePointer[]>([]);
  const [tools, setTools] = useState<LiveToolRun[]>([]);
  const [hearing, setHearing] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [seen, setSeen] = useState<Record<string, number>>({});

  const pc = useRef<RTCPeerConnection | null>(null);
  const dc = useRef<RTCDataChannel | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  /** Call ids already claimed by `answerTool`. See the note there. */
  const answered = useRef<Set<string>>(new Set());

  /** Fold one turn's text in, creating the line the first time we hear of it. */
  const put = useCallback(
    (id: string, role: LiveLine["role"], text: string, mode: "append" | "set", done: boolean) => {
      setLines((prev) => {
        const i = prev.findIndex((l) => l.id === id);
        if (i === -1) return [...prev, { id, role, text, done }];
        const next = [...prev];
        const was = next[i]!;
        next[i] = { ...was, text: mode === "append" ? was.text + text : text, done };
        return next;
      });
    },
    [],
  );

  const send = useCallback((msg: unknown) => {
    const channel = dc.current;
    if (channel?.readyState === "open") channel.send(JSON.stringify(msg));
  }, []);

  /**
   * A tool the model asked for.
   *
   * `show_passage` is answered here, in this frame — it is the only tool with
   * no server behind it, and the reason it exists (src/live.ts) is that
   * everything else makes a talking companion go quiet while it waits.
   *
   * **The result goes back even when the tool failed.** A realtime response
   * that asked for a function and never got an output leaves the conversation
   * wedged: the model is waiting, the reader is waiting, and nothing on screen
   * says so. An error in the `output` field is a turn the model can talk its
   * way out of.
   */
  const answerTool = useCallback(
    async (callId: string, name: string, rawArgs: string) => {
      /* **One output per call id, ever, and the check is first.** Two events
         can carry the same call — the streaming `…arguments.done` and the
         finished item inside `response.done` — and answering twice is not a
         doubled log line, it is two `response.create`s, which the session
         refuses with "Conversation already has an active response in progress"
         and the reader sees as an error on a turn that otherwise worked.
         Synchronous check-and-claim, so two events in one tick cannot both
         pass. */
      if (answered.current.has(callId)) return;
      answered.current.add(callId);

      const started = Date.now();
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(rawArgs || "{}") as Record<string, unknown>;
      } catch {
        args = {};
      }

      const finish = (output: unknown, label: string, detail: string) => {
        setTools((t) => [
          ...t,
          { callId, name, label, detail, ms: Date.now() - started },
        ]);
        send({
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: callId,
            output: typeof output === "string" ? output : JSON.stringify(output),
          },
        });
        /* And then ask it to carry on talking. Realtime does not resume by
           itself after a function output — without this the model has the
           answer and never says it, which looks exactly like a model that
           decided not to reply. */
        send({ type: "response.create" });
      };

      if (name === "show_passage") {
        const ids = Array.isArray(args.blockIds) ? args.blockIds.map(String) : [];
        const why = typeof args.why === "string" ? args.why : "";
        setPointers((p) => [...p, { blockIds: ids, why, at: Date.now() }]);
        finish(
          `Showed the reader ${ids.length} passage${ids.length === 1 ? "" : "s"}.`,
          "pointed at",
          ids.join(" "),
        );
        return;
      }

      try {
        const res = await fetch(`${SPIKE}/tool`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slug, name, args }),
        });
        const out = (await res.json()) as { content?: string; label?: string; detail?: string };
        if (!res.ok) throw new Error(out.label ?? `tool failed (${res.status})`);
        finish(out.content ?? "", out.label ?? name, out.detail ?? "");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        finish(`That tool failed: ${message}`, name, `failed — ${message}`);
      }
    },
    [send, slug],
  );

  const onEvent = useCallback(
    (raw: MessageEvent<string>) => {
      let e: Record<string, unknown>;
      try {
        e = JSON.parse(raw.data) as Record<string, unknown>;
      } catch {
        return;
      }
      const type = String(e.type ?? "");
      setSeen((s) => ({ ...s, [type]: (s[type] ?? 0) + 1 }));

      /* The reader's own words. `completed` is the only one that carries a
         transcript worth showing — the deltas on this one are the transcriber's
         partial guesses and they rewrite themselves. */
      if (type === "conversation.item.input_audio_transcription.completed") {
        put(String(e.item_id ?? ""), "reader", String(e.transcript ?? "").trim(), "set", true);
        return;
      }
      if (type === "conversation.item.input_audio_transcription.failed") {
        put(String(e.item_id ?? ""), "reader", "(couldn't make that out)", "set", true);
        return;
      }

      /* **The model's own words, and this spelling is measured rather than
         read.** The pre-GA beta called these `response.audio_transcript.*` and
         plenty of writing still does. A live session on 2026-08-31 sent
         `response.output_audio_transcript.delta` 99 times and the beta spelling
         never once, so the fallback that was here has gone: a branch no traffic
         can reach is not a safety net, it is a second thing to keep in step.
         `seen` in the returned API is how to check this again if it changes. */
      if (type === "response.output_audio_transcript.delta") {
        put(String(e.item_id ?? ""), "companion", String(e.delta ?? ""), "append", false);
        return;
      }
      if (type === "response.output_audio_transcript.done") {
        put(String(e.item_id ?? ""), "companion", String(e.transcript ?? ""), "set", true);
        return;
      }

      if (type === "input_audio_buffer.speech_started") return setHearing(true);
      if (type === "input_audio_buffer.speech_stopped") return setHearing(false);
      if (type === "output_audio_buffer.started") return setSpeaking(true);
      if (type === "output_audio_buffer.stopped" || type === "output_audio_buffer.cleared") {
        return setSpeaking(false);
      }

      if (type === "response.function_call_arguments.done") {
        void answerTool(
          String(e.call_id ?? ""),
          String(e.name ?? ""),
          String(e.arguments ?? "{}"),
        );
        return;
      }

      if (type === "error") {
        const detail = e.error as { message?: string } | undefined;
        setError(detail?.message ?? "the live session reported an error [live-event]");
        return;
      }

      /* **`response.done` also carries the function call**, as a complete item
         in `response.output`. The streaming event above has fired for every
         call observed so far, so this is a safety net rather than the path —
         and `answered` is what makes having both safe.

         **This used to do its de-duplicating inside a `setTools` updater, and
         that was the bug the first browser pass found.** A state updater must
         be pure; React invokes it twice in development, so `answerTool` ran
         twice, two `function_call_output`s and two `response.create`s went down
         the channel, and the session answered "Conversation already has an
         active response in progress" — with fifty duplicate-key warnings
         underneath it. Checking a ref before doing the work is the fix, and the
         reason it has to be a ref rather than `tools` is timing: a tool that is
         still in flight has not been appended yet, so the list cannot answer
         "have we started this one?" at all. */
      if (type === "response.done") {
        setSpeaking(false);
        const output = (e.response as { output?: unknown[] } | undefined)?.output ?? [];
        for (const item of output) {
          const it = item as { type?: string; call_id?: string; name?: string; arguments?: string };
          if (it.type !== "function_call" || !it.call_id) continue;
          void answerTool(it.call_id, it.name ?? "", it.arguments ?? "{}");
        }
      }
    },
    [answerTool, put],
  );

  const stop = useCallback(() => {
    setPhase("closing");
    dc.current?.close();
    /* Every sender's track, not just the microphone's: the synthetic silent
       track is a sender too, and leaving an AudioContext oscillator running
       after a hang-up is a page that quietly keeps a device awake. Braces
       because the arrow must not return the callback's value. */
    for (const sender of pc.current?.getSenders() ?? []) {
      sender.track?.stop();
    }
    pc.current?.close();
    dc.current = null;
    pc.current = null;
    setHearing(false);
    setSpeaking(false);
    setPhase("idle");
  }, []);

  const start = useCallback(
    (opts: { microphone?: boolean } = {}) => {
      const microphone = opts.microphone ?? true;
      setPhase("connecting");
      setError(null);
      setSeen({});
      /* A new session mints new call ids, but clearing is what stops this
         growing for the life of the tab across repeated connections. */
      answered.current.clear();

      void (async () => {
        try {
          /* One: our server mints a token. It is the only thing in this whole
             flow that touches the API key, and it is over before any audio
             device is opened — a reader who is going to be refused should find
             out before they are asked for their microphone. */
          const res = await fetch(`${SPIKE}/session`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ slug }),
          });
          const minted = (await res.json()) as { token?: string; error?: string };
          if (!res.ok || !minted.token) {
            throw new Error(minted.error ?? `could not start a session (${res.status})`);
          }

          /* Two: the peer connection, with the data channel created BEFORE the
             offer. A channel added afterwards is not in the SDP, so it never
             opens and the conversation has audio and no events — which reads as
             a model that will not answer. */
          const conn = new RTCPeerConnection();
          pc.current = conn;

          const el = new Audio();
          el.autoplay = true;
          audio.current = el;
          conn.ontrack = (ev) => {
            el.srcObject = ev.streams[0] ?? null;
          };

          const channel = conn.createDataChannel("oai-events");
          dc.current = channel;
          channel.addEventListener("message", onEvent as EventListener);
          channel.addEventListener("open", () => setPhase("live"));

          const track = microphone
            ? (await navigator.mediaDevices.getUserMedia({ audio: true })).getAudioTracks()[0]
            : silentTrack();
          if (!track) throw new Error("no microphone track [live-no-track]");
          conn.addTrack(track);

          /* Three: the SDP exchange, straight to OpenAI with the ephemeral
             token. Our key is not in this browser and never was. */
          const offer = await conn.createOffer();
          await conn.setLocalDescription(offer);
          /* `sdp` is optional on the type and must not be sent as the string
             "undefined": that reaches OpenAI as a malformed offer and comes
             back as a 400 about SDP, one layer away from the thing that is
             actually wrong. Caught by the typechecker, kept as a check. */
          if (!offer.sdp) throw new Error("the browser produced no SDP offer [live-no-offer]");
          const answer = await fetch("https://api.openai.com/v1/realtime/calls", {
            method: "POST",
            body: offer.sdp,
            headers: {
              Authorization: `Bearer ${minted.token}`,
              "Content-Type": "application/sdp",
            },
          });
          if (!answer.ok) {
            throw new Error(
              `OpenAI refused the connection (${answer.status}): ${(await answer.text()).slice(0, 200)}`,
            );
          }
          await conn.setRemoteDescription({ type: "answer", sdp: await answer.text() });
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
          setPhase("failed");
        }
      })();
    },
    [onEvent, slug],
  );

  const say = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (trimmed === "") return;
      /* Rendered locally rather than waiting for it to come back: a typed turn
         has no input transcription event, because nothing was transcribed. */
      put(`typed-${Date.now()}`, "reader", trimmed, "set", true);
      send({
        type: "conversation.item.create",
        item: { type: "message", role: "user", content: [{ type: "input_text", text: trimmed }] },
      });
      send({ type: "response.create" });
    },
    [put, send],
  );

  return { phase, error, lines, pointers, tools, hearing, speaking, seen, start, stop, say };
}
