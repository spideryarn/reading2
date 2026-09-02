/**
 * **The browser half of live conversation mode.**
 * docs/plans/260831g-live-conversation.md for the wire, and
 * docs/plans/260831l-live-conversation-in-chat.md for how it became a turn in a
 * conversation rather than a mode of its own. src/live.ts is the server half.
 *
 * The audio never touches our server. This hook opens a `RTCPeerConnection`
 * straight to OpenAI, using a short-lived token our server minted, and from
 * then on the conversation is between the reader's microphone and the model.
 * Our server is asked for the token, for a tool to be run — and to be told what
 * the session spent, because the `usage` object OpenAI puts on every turn is
 * delivered to this tab and nowhere else. That last part is ./meter.ts, and
 * everything about it that is a judgment call is written down there.
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
 *
 * ## What it does NOT own
 *
 * **Writing anything down.** A finished exchange goes to `speak`, which is the
 * chat controller's operation — an id, a projection it alone may update, a 409
 * that repairs. A second writer beside that controller was the first thing GPT
 * Sol refused about this plan, and the reason is not tidiness: the point of
 * spoken turns landing in the thread is that the *typed* turn after them can
 * see what was said, and that only works if there is one set of rules about
 * writing to a conversation.
 *
 * **Deciding what order things happened in.** `ExchangeLedger` does that, from
 * OpenAI's own item ids, because the transcription of what the reader said
 * routinely arrives after the answer to it. See that file's header.
 *
 * ## The three orderings this hook is responsible for
 *
 * 1. **The seeding barrier.** The microphone track is created disabled and is
 *    enabled only once the channel is open, every seed item has come back, and
 *    the conversation's tail is still what the ticket said. A session that
 *    starts hearing before it has been told the history answers the first
 *    question with amnesia, and nothing on screen says why.
 * 2. **One append at a time, in conversation order.** The second exchange's
 *    `expectedTailId` is the first one's *stored* answer id, which does not
 *    exist until the first has landed. So they are a queue, not a fan-out.
 * 3. **The hang-up grace.** Stop stops the track and hands the device back at
 *    once, then holds the channel open for a moment so the last
 *    transcription — which arrives after the answer — can land before anything
 *    is written. Without it the reader's final question is silently missing
 *    from their own transcript. GPT Sol's finding 7.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import type { SpokenExchange } from "../useChat.js";
import type { SpokenLanded } from "../chat/controller.js";
import { claimMicrophone, releaseMicrophone, type MicClaim } from "../mic-lock.js";
import { ExchangeLedger, type Exchange } from "./exchanges.js";
import { LiveMeter, responseReport, transcriptionReport } from "./meter.js";
import { resolvePlacement, type ResolvedPlacement } from "./mic-placement.js";
import { apiWiring, type LiveWiring } from "./wiring.js";

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
  /**
   * Where the microphone was taken to be, and whether that was the reader's
   * choice, a guess from the device name, or the fallback.
   *
   * Resolved at connect time and reported back so the UI can say which — a
   * control that silently agrees with you is indistinguishable from one that
   * does nothing. Null before the first connection.
   */
  placement: ResolvedPlacement | null;
  /**
   * Which conversation this session belongs to, once it has one.
   *
   * The server may create the thread and may overrule the id the tab invented
   * for it, so this can move once — on the first exchange that lands.
   */
  threadId: string | null;
  start: (opts: { threadId: string; microphone?: boolean }) => void;
  /**
   * End it: hand the microphone back at once, keep the last words, then close.
   *
   * **Returns a promise, and Send must await it.** The typed path claims the
   * conversation's tail, and a flush still in flight is about to move it — so
   * an unawaited handoff turns the guard into a 409 we inflicted on ourselves.
   * docs/plans/260831l-live-conversation-in-chat.md § 1d.
   */
  stop: () => Promise<void>;
  /** Put a typed turn in, as if it had been spoken. */
  say: (text: string) => void;
}

/** How this hook is wired to our own server, and to the thread. */
export interface LiveOptions {
  /** Overridden by the preview page, which is not behind the auth gate. */
  wiring?: LiveWiring;
  /**
   * Write one finished exchange into the conversation.
   *
   * `useChat`'s `speak`. Absent on the preview page, where there is no chat
   * controller and the transcript is the point rather than the record.
   */
  speak?: (spoken: SpokenExchange) => Promise<SpokenLanded>;
  /**
   * What this tab believes is the last row of the conversation, **now**.
   *
   * Read once, at the seeding barrier, and compared with what the ticket said.
   * A function rather than a value because the answer changes while the session
   * is connecting, which is exactly the case it is here to catch.
   */
  tailNow?: (threadId: string) => string | null;
  /** The URL's `?thread=` follows, when the server overrules the id. */
  onThreadId?: (id: string) => void;
}

/**
 * How long the channel is held open after the reader hangs up.
 *
 * Not a guess at the network. It is the window in which OpenAI delivers the
 * things that arrive *after* the audio stops — above all
 * `…input_audio_transcription.completed` for the sentence just spoken, which
 * routinely lands after the answer to it. Closing at once keeps the answer and
 * loses the question, in the reader's own transcript, with nothing to show it
 * happened.
 *
 * It ends early whenever the ledger has nothing unfinished, so a reader who
 * stops after a completed answer waits for none of it.
 */
const HANGUP_GRACE_MS = 2_500;

/** How often the grace window asks whether it can stop waiting. */
const GRACE_POLL_MS = 100;

/**
 * How long a hang-up mutes the microphone before stopping it, so that a
 * sentence in progress can be closed and committed by the voice detector.
 *
 * The device is not handed back during this, which is the cost — so it is
 * entered only when a sentence looks open, and it ends the moment the commit
 * lands. A second is roughly what `semantic_vad` needs to decide a sentence has
 * finished.
 */
const SETTLE_MS = 1_200;

/**
 * How recently the reader must have been heard for a hang-up to assume they may
 * still be talking.
 *
 * `speech_started` travels from OpenAI to the browser, so at the exact moment
 * Stop is pressed the flag can be false while the reader is mid-word. This is
 * the width of that blind spot.
 */
const SPEECH_LATENCY_MS = 1_500;

/**
 * **The two caps, and why a live session needs any.**
 *
 * The meter measures this now (./meter.ts), but measuring is not limiting:
 * nothing on our server can end somebody's session, so the only thing standing
 * between a forgotten tab and an hour of billed room noise is a clock in the
 * browser. OpenAI ends a session at sixty minutes, which bounds the damage and
 * does not prevent it.
 *
 * Two clocks rather than one, because they answer different questions. The idle
 * one is the useful one: a reader who has stopped talking has stopped having a
 * conversation, whatever the tab still shows. The wall clock is the backstop
 * for a room that is never quiet — a fan, a television, an open window — where
 * the voice detector keeps finding speech that is not the reader's.
 *
 * Generous on purpose. A conversation with long pauses for thinking is exactly
 * what this feature is for (`semantic_vad` in src/live.ts exists for the same
 * reason), so the idle cap must not cut off somebody who is reading a paragraph
 * before they answer.
 */
const IDLE_CAP_MS = 5 * 60_000;
const SESSION_CAP_MS = 20 * 60_000;

/**
 * How long the seeding barrier may stay up before the session is called failed.
 *
 * Generous, because it covers the channel opening as well as the round trip for
 * every seeded item, and a slow connection is not a broken one. It is a deadline
 * on something going *wrong* rather than on the network being quick.
 */
const SEED_TIMEOUT_MS = 15_000;

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

export function useLiveConversation(slug: string, opts: LiveOptions = {}): LiveApi {
  const [phase, setPhase] = useState<LivePhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<LiveLine[]>([]);
  const [pointers, setPointers] = useState<LivePointer[]>([]);
  const [tools, setTools] = useState<LiveToolRun[]>([]);
  const [hearing, setHearing] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [seen, setSeen] = useState<Record<string, number>>({});
  const [placement, setPlacement] = useState<ResolvedPlacement | null>(null);

  const pc = useRef<RTCPeerConnection | null>(null);
  const dc = useRef<RTCDataChannel | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  /** Call ids already claimed by `answerTool`. See the note there. */
  const answered = useRef<Set<string>>(new Set());
  /**
   * **This session's claim on the page's one microphone**, and the resolver
   * that tells the next claimant the device has actually gone.
   *
   * Live conversation is a third claimant on a device `mic-lock.ts` was written
   * to arbitrate between two — and it is the greediest of the three, because it
   * holds the microphone for minutes rather than for the length of a sentence.
   * A session that took `getUserMedia` without claiming would be invisible to
   * the dictation hooks, which is exactly the failure that file exists to
   * prevent: WebKit supports one microphone source at a time, and the second
   * capture kills or silently reroutes the first.
   */
  const claim = useRef<MicClaim | null>(null);
  const releasedResolve = useRef<(() => void) | null>(null);

  /**
   * **Everything the caller supplies, behind a ref that cannot go stale.**
   *
   * `speak` closes over the chat controller and `tailNow` over the rendered
   * list, so both change identity on most renders — and a session lives for
   * minutes. Captured in `start`'s closure they would be whatever they were at
   * connect time, which for `tailNow` is the one value it must not be.
   */
  const wired = useRef(opts);
  wired.current = opts;

  /** The reader's microphone track, held so the hang-up can stop it first. */
  const micTrack = useRef<MediaStreamTrack | null>(null);

  /**
   * **What this conversation cost, on its way to our own ledger.** One per
   * session, and `null` when the ticket carried no journal row to report
   * against — see `LiveTicket.sessionId`.
   *
   * A ref for the same reason `ledger` is: it is fed from the event handler
   * several times a minute and nothing renders it.
   */
  const meter = useRef<LiveMeter | null>(null);

  /**
   * **When each response began**, keyed on OpenAI's response id.
   *
   * Realtime events carry no timestamps of their own, so the only start time
   * that exists is the moment this tab saw `response.created`. Without it every
   * realtime row would have a null duration and the ledger could not say how
   * long a turn took — and inventing one from the session's wall-clock would be
   * the duration of a *conversation* recorded as the duration of a call, which
   * is the mistake `ai_calls.duration_ms` losing its NOT NULL exists to avoid.
   */
  const responseStarts = useRef(new Map<string, string>());

  /**
   * **Why this session ended**, for the journal row.
   *
   * Free text with a length bound on the server (`realtimeCloseReason` in
   * src/live.ts), deliberately, so the list can live here and grow without a
   * server-side union lagging it and refusing a true report. Set at each place
   * that ends a session; `reader` is the default because pressing Stop is the
   * one ending nothing else has to announce.
   */
  const endedBecause = useRef<string>("reader");

  /**
   * The turn assembler. One per session — see `ExchangeLedger`.
   *
   * A ref rather than state: it is fed from an event handler many times a
   * second and nothing renders it. What renders is `lines`, which this hook
   * keeps beside it, and the *thread*, which the exchanges become.
   */
  const ledger = useRef(new ExchangeLedger());

  /**
   * **Appends run one at a time, and this is the queue.**
   *
   * Exchange two's `expectedTailId` is exchange one's *stored* answer id, so
   * they cannot go in parallel: the second would claim a tail that does not
   * exist yet and be refused. A promise chain rather than a worker, because the
   * ordering rule is the whole of the machinery.
   */
  const writing = useRef<Promise<void>>(Promise.resolve());

  /** What the next append will claim is last. From the ticket, then from each write. */
  const tail = useRef<string | null>(null);
  /** The conversation this session is bound to. Moves once if the server renames it. */
  const boundThread = useRef<string | null>(null);
  const [threadId, setThreadId] = useState<string | null>(null);

/**
   * The seeding barrier, **as a set of item ids rather than a count of events.**
   *
   * The first version counted events, on the argument that with the microphone
   * track disabled nothing but our own seeds can produce a
   * `conversation.item.created`. That much is true. What it also assumed is that
   * each seed produces exactly *one* such event — and the API has two spellings
   * for this, `conversation.item.created` and `conversation.item.added`, both of
   * which this hook handles because the spelling has moved once already. If a
   * session ever sends both, a count lifts the barrier at half the seeds, and
   * the surplus events then reach the ledger — where a seeded **user** item is
   * indistinguishable from a turn the reader has just taken, and its
   * transcription is never coming. `harvest` waits for a finished turn behind an
   * unfinished one, so every exchange of that session would be silently
   * unwritable: no error, no console, a conversation that simply never gets
   * written down.
   *
   * Distinct ids are right whichever way it turns out, and they are also what
   * lets a repeat of a seed's own event be recognised and dropped **after** the
   * barrier lifts.
   */
  const seeding = useRef<{ expected: number; ids: Set<string>; done: boolean }>({
    expected: 0,
    ids: new Set(),
    done: true,
  });

  /**
   * An append was refused or lost, so this session has stopped being able to
   * say where the conversation ends.
   *
   * A ref rather than state because it is read from inside the write queue and
   * from the event handler, both of which run outside a render — and because
   * what it triggers is `stop()`, which is not a re-render.
   */
  const failing = useRef(false);

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
   * Queue one finished exchange for the thread, behind everything before it.
   *
   * **Serial, and the ordering is not an optimisation to relax later.** Each
   * append claims the row it believes is last, and that row is the previous
   * append's *stored* answer — a name the server minted, which does not exist
   * until the previous one has come back. Two in flight means the second claims
   * a tail from before the first and is refused, correctly, for a reason that
   * would look like a bug.
   *
   * A refusal or a failure ends the session rather than carrying on. Every
   * later append would be claiming a tail this tab can no longer vouch for, so
   * the only honest next step is the one the plan names as the default on any
   * doubt: close, hand the microphone back, let the repair reload the thread,
   * and start a fresh seeded session if the reader wants one.
   */
  const commit = useCallback((exchanges: Exchange[]) => {
    const speak = wired.current.speak;
    if (!speak) return;
    for (const exchange of exchanges) {
      writing.current = writing.current.then(async () => {
        /* **Checked here, at the top of every link, and not only once when the
           queue was built.** `harvest` can return two completed exchanges at
           once, so both are chained before either has run — and if the first
           exhausts its retries, the second would still go, claiming the tail
           the first failed to move. The reader would end up with the *second*
           half of a conversation stored and the first missing, which is worse
           than losing both and says nothing about itself. GPT Sol, reviewing
           the built code, 2026-08-31. */
        if (failing.current) return;
        const thread = boundThread.current;
        if (!thread) return;
        const landed = await speak({
          threadId: thread,
          question: exchange.question,
          answer: exchange.answer,
          expectedTailId: tail.current,
          ...(exchange.passages.length > 0 ? { passages: exchange.passages } : {}),
          ...(exchange.tools.length > 0
            ? {
                /* The panel's shape is not the stored one: a stored run is
                   finished by definition, and `running` on disk is a spinner
                   nothing can end (src/types.ts § ToolRun.status). The server
                   sets it too — this is the same rule said on both sides, which
                   is worth it for the one field where a mistake is permanent. */
                tools: exchange.tools.map((t) => ({ ...t, status: "done" as const })),
              }
            : {}),
          ...(exchange.interrupted ? { interrupted: true } : {}),
        });
        if (!landed.ok) {
          setError(landed.error);
          failing.current = true;
          /* **Ended, and not from inside the queue.** `stop` awaits
             `writing.current`, so calling it on this line would be this link of
             the chain waiting for itself. A task later, this link has resolved
             and the wait is ordinary.

             Ended rather than carried on, because every later append would
             claim a tail this tab can no longer vouch for. A conflict has
             already started a repair in the reducer, which reloads the
             conversation; the reader can press Live again and get a session
             seeded from what is actually there. */
          endedBecause.current = "append-refused";
          setTimeout(() => void stopRef.current(), 0);
          return;
        }
        tail.current = landed.tailId;
        if (landed.threadId !== boundThread.current) {
          boundThread.current = landed.threadId;
          setThreadId(landed.threadId);
          wired.current.onThreadId?.(landed.threadId);
        }
        /* The live copy comes off now that the stored one is in the thread.
           Both would otherwise be on screen at once and the reader would watch
           their own question duplicate itself the instant it was saved. */
        setLines((prev) => prev.filter((l) => !exchange.itemIds.includes(l.id)));
      });
    }
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
      /**
       * **Which session asked for this**, captured before anything is awaited.
       *
       * A tool run is the longest thing in a live session that is not the
       * session itself — a library search takes seconds — and the reader can
       * hang up and start again inside one. Everything `finish` touches is
       * shared and mutable: the ledger, the data channel, the strip. So an old
       * session's tool would file its receipt on the *new* conversation's turn
       * and then send a `function_call_output` and a `response.create` down the
       * new session's channel, which either corrupts what it stores or makes it
       * answer a question nobody asked. GPT Sol, second review, 2026-08-31.
       */
      const era = epoch.current;
      const ledgerThen = ledger.current;
      const channelThen = dc.current;
      /** Is the session that asked for this still the one running? */
      const sameSession = () =>
        era === epoch.current && ledger.current === ledgerThen && dc.current === channelThen;
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
        /* Nothing is written and nothing is sent if the session that asked has
           gone. Dropping it is right: the reader hung up, so the answer is not
           wanted, and there is no conversation left for the model to say it
           into. */
        if (!sameSession()) return;
        setTools((t) => [
          ...t,
          { callId, name, label, detail, ms: Date.now() - started },
        ]);
        /* And on the exchange, which is what gets written down. The strip above
           is this session's; the ledger's copy belongs to the turn it happened
           in, and a run recorded against the wrong turn is a receipt for
           something the reader never asked. */
        ledger.current.tool(callId, { name, label, detail });
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
        /* The stored answer's own pointers. A spoken answer cites nothing in
           its text — it is forbidden to say an id aloud — so without these the
           transcript is an uncited claim, which is the one thing the chat
           contract exists to prevent. docs/plans/260831l-live-conversation-in-chat.md § 1b. */
        ledger.current.passage(callId, { blockIds: ids, why });
        finish(
          `Showed the reader ${ids.length} passage${ids.length === 1 ? "" : "s"}.`,
          "pointed at",
          ids.join(" "),
        );
        return;
      }

      try {
        const out = await (wired.current.wiring ?? apiWiring).runTool(slug, name, args);
        finish(out.content, out.label, out.detail);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        finish(`That tool failed: ${message}`, name, `failed — ${message}`);
      }
    },
    [send, slug],
  );

  /**
   * **Hand one paid event to the meter, or say why it could not be.**
   *
   * The `null` case is the one worth having a function for. It means an event
   * that certainly cost money arrived in a shape this tab could not price —
   * `response.done` without its modality split (openai-agents-js#538), or a
   * transcription whose usage came as tokens rather than seconds. Reporting it
   * with zeros in the gaps would put a real cost in the ledger as approximately
   * free, so nothing is sent; the count and the console line are what stop that
   * from being invisible. ./meter.ts § `responseReport`.
   */
  const meterEvent = useCallback((report: ReturnType<typeof responseReport>) => {
    const m = meter.current;
    if (!m) return;
    if (report) {
      m.report(report);
      return;
    }
    m.couldNotRead();
    console.error(
      "[live-meter] a paid event arrived without the numbers needed to price it; this session's cost is understated",
    );
  }, []);

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

      /* **The seeding barrier.** While it is up the microphone track is
         disabled, so VAD creates no items and nothing but our own seeds is in
         this stream. The moment every seeded item has been acknowledged,
         `openTheMicrophone` checks the tail and turns the track on.

         Seeds are deliberately NOT fed to the ledger below, **and are refused
         for the whole session rather than only while the barrier is up**: they
         are history, not turns, and a user item whose transcription is never
         coming would stall `harvest` — which holds a finished turn behind an
         unfinished one — for the rest of the conversation. Keeping the ids is
         what makes a second event for the same seed harmless. */
      /* The utterance has been committed — it is a conversation item now, so
         the ledger can see it and the grace window has something to wait on. */
      if (type === "input_audio_buffer.committed") midSentence.current = false;

      if (type === "conversation.item.created" || type === "conversation.item.added") {
        const id = String((e.item as { id?: unknown } | undefined)?.id ?? "");
        const role = (e.item as { role?: unknown } | undefined)?.role;
        if (role === "user") midSentence.current = false;
        if (!seeding.current.done) {
          if (id) seeding.current.ids.add(id);
          if (seeding.current.ids.size >= seeding.current.expected) {
            openTheMicrophone.current?.();
          }
          return;
        }
        if (id && seeding.current.ids.has(id)) return;
      }

      /* **Everything else goes to the ledger, and the ledger decides what is a
         finished exchange.** Not this handler: the transcription of what the
         reader said arrives after the answer to it, so anything keyed on
         arrival order writes an answer with no question. See exchanges.ts. */
      if (seeding.current.done) commit(ledger.current.push(e));

      /* The reader's own words. `completed` is the only one that carries a
         transcript worth showing — the deltas on this one are the transcriber's
         partial guesses and they rewrite themselves. */
      if (type === "conversation.item.input_audio_transcription.completed") {
        /* **And it is also a bill.** `gpt-live-transcribe` is a second model on
           a second rate card, billed per audio minute, and this event is the
           only place its usage appears — a meter that watched `response.done`
           alone would price half of live conversation at nothing.
           `startedAt` is null because there is no matching start event: the
           transcription of a sentence arrives long after the sentence, and the
           server's `duration_ms` is nullable for exactly this. */
        meterEvent(transcriptionReport(e, { startedAt: null, finishedAt: new Date().toISOString() }));
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

      /* **Only the reader's voice resets the idle clock.** Not the model's, and
         not our own tool traffic: a session that kept itself alive by answering
         its own last question would be exactly the forgotten tab this cap is
         for. */
      if (type === "input_audio_buffer.speech_started") lastHeard.current = Date.now();

      if (type === "input_audio_buffer.speech_started") {
        /* **The reader started talking, and whether that is an interruption is
           the ledger's question, not ours.** It marks the turn only when an
           answer is still being assembled — which is the honest reading of
           "you talked over it" and the one the stored row needs, because the
           server truncates the unplayed audio and keeps the transcript whole.
           So the text may run past what was heard, and the row says so rather
           than pretending. */
        ledger.current.interrupt();
        midSentence.current = true;
        return setHearing(true);
      }
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

      /* **When this turn began.** The only start time that exists — see
         `responseStarts`. Kept whatever else this event is, because a turn that
         ends in a function call is billed exactly like one that ends in
         speech. */
      if (type === "response.created") {
        const id = (e.response as { id?: unknown } | undefined)?.id;
        if (typeof id === "string" && id !== "") {
          responseStarts.current.set(id, new Date().toISOString());
        }
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
        /* **The usage is on this event and nowhere else, and until Stage 2B it
           was read for its function calls and thrown away.** Every turn — a
           spoken answer, a cancelled one the reader talked over, a
           tool-calling one — carries what it cost, and `response.done` is the
           only place OpenAI says so. docs/project/live-conversation.md § The
           meter. */
        const id = (e.response as { id?: unknown } | undefined)?.id;
        const startedAt =
          typeof id === "string" ? (responseStarts.current.get(id) ?? null) : null;
        if (typeof id === "string") responseStarts.current.delete(id);
        meterEvent(responseReport(e, { startedAt, finishedAt: new Date().toISOString() }));

        const output = (e.response as { output?: unknown[] } | undefined)?.output ?? [];
        for (const item of output) {
          const it = item as { type?: string; call_id?: string; name?: string; arguments?: string };
          if (it.type !== "function_call" || !it.call_id) continue;
          void answerTool(it.call_id, it.name ?? "", it.arguments ?? "{}");
        }
      }
    },
    [answerTool, put, commit, meterEvent],
  );

  /**
   * **Hang up: device first, words second, connection last.**
   *
   * The order is the whole of it, and each step is there because the obvious
   * order loses something.
   *
   * 1. **Stop the microphone track and hand the device back at once.** The next
   *    claimant — the dictation button the reader just pressed — is blocked on
   *    `released`, and every extra millisecond is a button that looks broken.
   *    Resolving it before the track is actually stopped would hand WebKit two
   *    live sources, which is the bug `mic-lock.ts` exists to prevent, so the
   *    stop comes first and the resolve immediately after.
   * 2. **Keep the channel open for a moment.** What arrives after the audio
   *    stops is the transcription of the sentence just spoken, which routinely
   *    lands after the answer to it. Closing here keeps the answer and loses the
   *    question — in the reader's own transcript, with nothing to show it
   *    happened. GPT Sol's finding 7, and the comment that used to sit on
   *    `MicClaim.stop` claiming there was nothing to preserve was simply wrong.
   * 3. **Then write everything down, and only then close.** `drain` takes the
   *    unfinished turns as they stand and marks them interrupted, which is what
   *    they are — better than discarding a turn the reader watched happen.
   *
   * Awaited by Send, which must not start a typed turn while an append is still
   * in flight: the typed path claims the tail and the flush is about to move it.
   */
  const stop = useCallback((): Promise<void> => {
    /* **The promise is the guard, not the phase.** `phase` is state, so a
       second press in the same tick reads the value from the last render — and
       two hang-ups at once is not hypothetical: the reader presses Stop and the
       unmount, or the Send handoff, calls it again a frame later. The second
       one would drain a ledger the first has drained and close a connection it
       is still using for the grace window. */
    /* **Not an `async` function**, so the guard above can hand back the *same*
       promise rather than a fresh one wrapping it. That is what makes "joined
       the hang-up already running" an observable fact rather than a claim, and
       it is asserted in tests/live-session-flow.test.tsx. */
    if (closing.current) return closing.current;
    /* **Bumped first**, so a `start` still working its way through its awaits
       abandons rather than opening a connection behind this teardown. */
    epoch.current += 1;
    setPhase("closing");

    const finish = (async () => {
      /* **Zero: let a sentence in progress finish, before the device goes.**
         Muting the track stops audio going up immediately — which is what the
         reader asked for — while leaving the transport alive, so the voice
         detector sees silence, closes the turn and commits it. Stopping the
         track instead does *not* commit an open utterance: nothing documents
         that it would, and the first version of this assumed it did because a
         fake transport in a test obligingly delivered the events anyway. GPT
         Sol, second review, 2026-08-31.

         The window is short and is only entered when there is reason to think
         a sentence is open — either the detector has said so, or the reader was
         heard within the last second and a half, which covers the case where
         `speech_started` is still in flight. Every other hang-up hands the
         device back exactly as fast as before. */
      const maybeMidSentence =
        midSentence.current || Date.now() - lastHeard.current < SPEECH_LATENCY_MS;
      if (maybeMidSentence && micTrack.current && dc.current?.readyState === "open") {
        micTrack.current.enabled = false;
        const settleBy = Date.now() + SETTLE_MS;
        while (midSentence.current && Date.now() < settleBy) {
          await new Promise((r) => setTimeout(r, GRACE_POLL_MS));
        }
      }

      /* One: the device, and the handover. Only the microphone's track —
         everything else waits until the connection is actually going, because a
         closed peer connection cannot deliver the events step two is for. */
      micTrack.current?.stop();
      micTrack.current = null;
      if (claim.current) releaseMicrophone(claim.current);
      releasedResolve.current?.();
      releasedResolve.current = null;
      claim.current = null;
      setHearing(false);

      /* Two: the grace. It ends the moment the ledger has nothing unfinished,
         so a reader who stops after a completed answer waits for none of it. */
      const until = Date.now() + HANGUP_GRACE_MS;
      while (
        !failing.current &&
        /* **Either an unfinished turn or an unfinished sentence.** The second
           is the one that was missing: between VAD opening and the item being
           created, the ledger has nothing pending and the words the reader is
           saying exist only in the audio going up. Ending the grace there loses
           the whole utterance. */
        (midSentence.current || ledger.current.pending() > 0) &&
        Date.now() < until &&
        dc.current?.readyState === "open"
      ) {
        await new Promise((r) => setTimeout(r, GRACE_POLL_MS));
      }

      /* Three: everything still unwritten, then wait for the queue to empty.
         `drain` before the await, so the last exchange is in the chain that is
         being waited on rather than queued behind the wait. */
      commit(ledger.current.drain());
      await writing.current;

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

      /* The audio element too. A paused element holding a dead stream keeps a
         decoder alive and, on some browsers, the tab's "playing audio" chrome. */
      if (audio.current) {
        audio.current.srcObject = null;
        audio.current = null;
      }

      /* **The last thing the ledger hears from this tab.** After the channel is
         closed, so nothing else can arrive to be reported, and **not awaited**:
         `stop` is awaited by Send before it starts a typed turn, and making the
         reader wait on an accounting round trip would spend the one thing they
         notice on the one thing they do not. Anything still queued gets a final
         keepalive attempt inside `flush`, which is a hint and not the path —
         every turn was posted as it happened. */
      const ending = meter.current;
      meter.current = null;
      if (ending) {
        ending.end(endedBecause.current);
        void ending.flush();
      }

      setSpeaking(false);
      /* **`idle` only if nothing else has claimed the outcome.** `start`'s
         catch tears the session down and *then* reports, so a hang-up that is
         part of a failure must not overwrite `failed` with `idle` on its way
         out — which it did, and the symptom was a session that had refused to
         start reading as ready to start. A ref rather than the phase, because
         the phase is state and has not re-rendered yet. */
      if (!failed.current) setPhase("idle");
      closing.current = null;
    })();

    closing.current = finish;
    return finish;
  }, [commit]);

  /**
   * The hang-up in progress, so a second press joins it rather than racing it.
   *
   * Two hang-ups at once is not hypothetical: the reader presses Stop, and the
   * unmount or the Send handoff calls it again a frame later. Without this the
   * second one drains a ledger the first has already drained and closes a
   * connection it is still using for the grace window.
   */
  const closing = useRef<Promise<void> | null>(null);
  /** Set by the failure path, so the hang-up it triggers cannot say `idle`. */
  const failed = useRef(false);

  /** When anything last happened in this session, and when it began. See the caps. */
  const lastHeard = useRef(0);
  const began = useRef(0);

  /**
   * **The reader is part way through saying something.**
   *
   * VAD opens on `speech_started` and the conversation item is created only
   * when it *closes* — so between those two the ledger has nothing pending and
   * the sentence being spoken exists nowhere but in the audio going up.
   *
   * The hang-up grace ends early when the ledger has nothing unfinished, which
   * is right and was silently wrong here: press Stop mid-sentence and the grace
   * ended instantly, taking the whole utterance with it. The reader's last
   * words simply do not appear, and nothing anywhere says so. GPT Sol,
   * reviewing the built code, 2026-08-31.
   */
  const midSentence = useRef(false);

  /**
   * **Which session is the current one.** Bumped by every start and by every
   * stop, and checked after every `await` inside `start`.
   *
   * Without it there is a leak with no control anywhere on the page that can
   * close it, and it is not hypothetical: `start` awaits the placement, then
   * the ticket, then the microphone, then a round trip to OpenAI. If the reader
   * leaves chat mode during any of those, the cleanup finds `pc.current` and
   * `dc.current` still null and does nothing — and the abandoned async function
   * then carries on, opens a peer connection, claims the microphone and goes
   * live, owned by nobody. GPT Sol's finding, reviewing the built code,
   * 2026-08-31.
   *
   * A counter rather than a boolean, because "is this still the current
   * session?" and "has any session been started?" are different questions and
   * the second answers the first wrongly the moment the reader presses Live
   * twice.
   */
  const epoch = useRef(0);

  /**
   * The current `stop`, reachable from a closure that must not go stale.
   *
   * `mic-lock` holds the claim object for as long as this session owns the
   * device and calls `stop()` on it much later, from whichever hook claims
   * next. Capturing `stop` directly in that object would freeze whatever
   * identity it had at connect time — which is fine today, because `stop` has
   * an empty dependency list, and is exactly the kind of "fine today" that
   * breaks silently the first time somebody gives it a dependency.
   */
  const stopRef = useRef(stop);
  stopRef.current = stop;

  /**
   * Lift the seeding barrier: check the tail, then turn the microphone on.
   *
   * A ref because it is called from the event handler, which is installed on
   * the channel once and must not be rebuilt to reach a newer closure.
   *
   * **The tail check is the last thing between a seeded session and a
   * conversation it is wrong about.** Somebody typing a turn in another tab
   * while this one connects leaves the model with history that is a turn short
   * and a first append that will be refused. Refusing here instead costs the
   * reader a sentence and no words; refusing there costs them whatever they
   * said in the meantime.
   */
  const openTheMicrophone = useRef<(() => void) | null>(null);

  const start = useCallback(
    (opts: { threadId: string; microphone?: boolean }) => {
      const microphone = opts.microphone ?? true;
      setPhase("connecting");
      setError(null);
      setSeen({});
      setLines([]);
      setPointers([]);
      setTools([]);
      /* A new session mints new call ids, but clearing is what stops this
         growing for the life of the tab across repeated connections. */
      answered.current.clear();
      /* **A fresh ledger per session, always.** Item ids are OpenAI's and are
         unique to a connection, so a ledger carried over would hold turns whose
         terminal events can never arrive — and `harvest` waits for a finished
         turn behind an unfinished one, so one stale entry would silence every
         exchange of the new session. */
      ledger.current = new ExchangeLedger();
      writing.current = Promise.resolve();
      failing.current = false;
      failed.current = false;
      midSentence.current = false;
      closing.current = null;
      boundThread.current = opts.threadId;
      setThreadId(opts.threadId);
      began.current = Date.now();
      lastHeard.current = Date.now();
      /* **A fresh meter per session, always**, and it is created below rather
         than here because it needs the session id off the ticket. The starts
         are keyed on response ids, which belong to one connection, so a carried
         map would only ever be a slow leak of times nothing will ask for. */
      meter.current = null;
      responseStarts.current.clear();
      endedBecause.current = "reader";

      /**
       * **This session's number, and the check that goes after every `await`.**
       *
       * Everything below is asynchronous and the reader can leave at any point
       * in it. `abandon` stops only what *this* attempt has taken, and clears
       * the shared refs only if they are still ours — a newer session may
       * already own them, and tearing down its connection because an older
       * attempt noticed it was stale would be a worse bug than the one this
       * fixes.
       */
      const mine = (epoch.current += 1);
      let conn: RTCPeerConnection | null = null;
      let track: MediaStreamTrack | null = null;
      let channel: RTCDataChannel | null = null;
      let held: MicClaim | null = null;
      /** This attempt's meter, so `abandon` can clear it only if it is still ours. */
      let installedMeter: LiveMeter | null = null;
      /**
       * **Every shared ref is cleared on identity, and nothing else is touched.**
       *
       * The first version said it did this and did not: it cleared `dc.current`
       * whenever *its own* `conn` was still null, and released `claim.current`
       * whoever it belonged to. So an attempt abandoned before it built
       * anything would tear down the connection and the microphone claim of the
       * session that had started in the meantime — which is a worse bug than
       * the leak the epoch was added to fix, and the unmount test could not see
       * it because there was no newer owner in it. GPT Sol, second review,
       * 2026-08-31.
       *
       * Four locals rather than four ref reads, because "ours" has to mean the
       * object this attempt created, not whatever the ref happens to hold now.
       */
      const abandon = () => {
        track?.stop();
        channel?.close();
        conn?.close();
        if (pc.current === conn) pc.current = null;
        if (dc.current === channel) dc.current = null;
        if (micTrack.current === track) micTrack.current = null;
        /* On identity, like everything else here. A session abandoned between
           the ticket and the connection has a journal row and nothing to report
           against it — which is exactly the "issued, never connected" row the
           server keeps that fact for. */
        if (installedMeter && meter.current === installedMeter) meter.current = null;
        if (held && claim.current === held) {
          releaseMicrophone(held);
          releasedResolve.current?.();
          releasedResolve.current = null;
          claim.current = null;
        }
      };
      /** Is this still the session the page wants? */
      const stale = () => mine !== epoch.current;

      void (async () => {
        try {
          /* One: our server mints a token. It is the only thing in this whole
             flow that touches the API key, and it is over before any audio
             device is opened — a reader who is going to be refused should find
             out before they are asked for their microphone. */
          /* **Resolved before minting, because noise reduction is part of the
             session being created.** It could be changed later over the data
             channel with `session.update`, and that is the refinement if a
             reader ever needs to switch mid-conversation — but doing it at mint
             time means one source of the value and no window in which the
             session disagrees with the control.

             It reads `enumerateDevices`, whose labels are blank until the
             microphone permission has been granted once for this origin. So the
             very first connection on a new origin falls back, and every one
             after it guesses properly. */
          const where = await resolvePlacement();
          if (stale()) return abandon();
          setPlacement(where);

          const wiring = wired.current.wiring ?? apiWiring;
          const ticket = await wiring.ticket(slug, opts.threadId, where.placement);
          /* **The tail travels with the history it belongs to**, and the first
             exchange claims exactly this. Read separately they would be a claim
             about a conversation that never existed. */
          if (stale()) return abandon();
          tail.current = ticket.tailId;
          /* **The meter, or a sentence saying there will not be one** — and
             after the staleness check, with everything else that writes a
             shared ref. An abandoned attempt that installed its own meter would
             leave the running session reporting to a journal row it does not
             own, which is the class of bug `abandon` exists to prevent.

             The session id is our own journal row, minted before the token was
             released, and every report is addressed to it. A ticket without one
             comes from the preview page's spike server, which writes no row, so
             posting would be reporting spend against a session nobody owns.
             Said out loud because the alternative is a feature that quietly
             stops being metered. */
          if (ticket.sessionId) {
            installedMeter = new LiveMeter({ sessionId: ticket.sessionId, transport: wiring });
            meter.current = installedMeter;
          } else {
            console.error("[live-meter] this session has no journal row, so its cost is not measured");
          }

          /* Two: the peer connection, with the data channel created BEFORE the
             offer. A channel added afterwards is not in the SDP, so it never
             opens and the conversation has audio and no events — which reads as
             a model that will not answer. */
          conn = new RTCPeerConnection();
          pc.current = conn;
          /* **The connection dying is the session ending.** A failed ICE
             negotiation or a channel the far end closed leaves a page that
             looks live and hears nothing, holding the microphone. `disconnected`
             is deliberately not in here: it is transient and recovers, and
             hanging up on a two-second network blip would be worse than the
             blip. */
          conn.addEventListener("connectionstatechange", () => {
            const state = conn?.connectionState;
            if (state === "failed" || state === "closed") {
              endedBecause.current = "connection-lost";
              if (!stale()) void stopRef.current();
            }
          });

          const el = new Audio();
          el.autoplay = true;
          audio.current = el;
          conn.ontrack = (ev) => {
            el.srcObject = ev.streams[0] ?? null;
          };

          channel = conn.createDataChannel("oai-events");
          dc.current = channel;
          channel.addEventListener("message", onEvent as EventListener);
          /* The far end hung up. Without this the page stays `live`, holding
             the microphone, with nothing arriving and nothing saying why. */
          channel.addEventListener("close", () => {
            endedBecause.current = "channel-closed";
            if (!stale() && !closing.current) void stopRef.current();
          });

          /* **The last check before the session can hear anything.** The tail
             this tab believes in now, against the one the ticket was built
             from: if somebody typed a turn while we were connecting, the model
             has history a turn short and the first append would be refused —
             after the reader had spoken. Refusing here costs them a sentence
             and none of their words. */
          openTheMicrophone.current = () => {
            /* No idempotence guard, and it must not have one: a session with
               nothing to seed reaches this with `done` already true, from the
               channel's own `open`. It is only ever called once anyway — the
               branch that calls it in `onEvent` runs only while `done` is
               false. */
            seeding.current = { ...seeding.current, done: true };
            clearTimeout(seedBy);
            const now = wired.current.tailNow?.(opts.threadId);
            if (now !== undefined && now !== ticket.tailId) {
              setError(
                "This conversation changed while the session was starting. Try Live again.",
              );
              endedBecause.current = "thread-moved";
              void stopRef.current();
              return;
            }
            if (micTrack.current) micTrack.current.enabled = true;
            setPhase("live");
          };
          /**
           * The history goes down the channel the moment it opens, and the
           * microphone stays off until every item has come back.
           *
           * Not in `instructions`: the article there is byte-stable for the
           * life of an article and cached at a tenth the price, so appending
           * the conversation to it would mint a different prefix every session
           * and pay full price for all of it. src/live.ts § liveSeedItems.
           */
          /**
           * **A barrier that never lifts is a microphone that never opens**, and
           * that is a worse failure than either thing it sits between: the
           * reader presses Live, the button says it is connecting, and nothing
           * ever happens or explains itself.
           *
           * It can happen for one reason — the acknowledgements not arriving in
           * the shape this hook expects, which is exactly the kind of thing an
           * API changes. Failing loudly is the honest answer: the alternative is
           * to open the microphone anyway, which is the amnesia bug the barrier
           * exists to prevent, arriving silently.
           */
          const seedBy = setTimeout(() => {
            if (seeding.current.done) return;
            setError("The live session did not finish starting. Try again.");
            failed.current = true;
            endedBecause.current = "seed-timeout";
            void stopRef.current();
          }, SEED_TIMEOUT_MS);

          /* Captured, so the seeding closure below cannot be re-narrowed by a
             later assignment to the mutable local. */
          const opened = channel;
          opened.addEventListener("open", () => {
            /* **A minted token is not a conversation**, and this is the event
               that tells the two apart. A reader can press Live and change
               their mind, and a denominator built on issued sessions would
               understate what a real conversation costs by however many of
               those there are, with nothing looking wrong. src/routes.ts §
               `liveConnected`. */
            meter.current?.connected();
            seeding.current = {
              expected: ticket.seed.length,
              ids: new Set(),
              done: ticket.seed.length === 0,
            };
            for (const item of ticket.seed) {
              opened.send(
                JSON.stringify({
                  type: "conversation.item.create",
                  item: {
                    type: "message",
                    role: item.role,
                    content: [
                      {
                        /* The field name differs by role and getting it wrong
                           is accepted-and-ignored rather than refused: an
                           assistant item takes `output_text`, a user item
                           `input_text`. */
                        type: item.role === "assistant" ? "output_text" : "input_text",
                        text: item.text,
                      },
                    ],
                  },
                }),
              );
            }
            if (seeding.current.done) openTheMicrophone.current?.();
          });

          /* **Claimed before `getUserMedia`, never after** — the whole value of
             the lock is the gap it closes, and a claim taken once the device is
             open is a claim on something that has already gone wrong.

             Only when a real microphone is wanted. The synthetic silent track
             opens no device, so claiming for it would make an automated check
             evict a reader's live dictation for a device it never touches. */
          if (microphone) {
            held = {
              /* Asked to stop by the next claimant.
                 **This is NOT yet the "stop properly, keep the words" that
                 `MicClaim.stop` promises, and saying so is the point.** For
                 dictation, stopping keeps the utterance in progress. Here,
                 `stop()` closes the data channel first — so a sentence already
                 spoken but whose `…input_audio_transcription.completed` has not
                 yet arrived is lost, silently, and the reader sees their last
                 words simply missing.

                 An earlier version of this comment claimed there was no
                 half-spoken sentence to preserve because words are committed as
                 they are said. That is false: the transcription of a committed
                 item arrives *after* the item, often after the assistant has
                 begun replying. Found by GPT Sol's review of
                 docs/plans/260831l-live-conversation-in-chat.md, finding 7.

                 **`stop` now honours the promise.** It stops the track and
                 resolves `released` first, so the next claimant waits only for
                 the device; the channel is held open for a moment after that,
                 so the transcription of the last sentence can land and be
                 written down. See `stop` below. Nothing here has to wait for
                 that — the microphone is already theirs. */
              stop: () => {
                endedBecause.current = "microphone-taken";
                void stopRef.current();
              },
              released: new Promise<void>((res) => {
                releasedResolve.current = res;
              }),
            };
            claim.current = held;
            await claimMicrophone(held);
            /* **Checked after the claim as well as before the device.** The
               claim waits on whoever held it last, which can be a whole
               dictation, and the reader may have left in the meantime — so this
               is the longest await in the function and the likeliest place to
               become stale. */
            if (stale()) return abandon();
          }

          track =
            (microphone
              ? (await navigator.mediaDevices.getUserMedia({ audio: true })).getAudioTracks()[0]
              : silentTrack()) ?? null;
          if (stale()) return abandon();
          if (!track) throw new Error("no microphone track [live-no-track]");
          /* **Created disabled, and that is the seeding barrier.** "Sent before
             the first response" does not prove "accepted before VAD created
             one": the reader can start talking the instant the connection is
             up, and a session that hears before it has been told the history
             answers with amnesia about the last five minutes. A disabled track
             sends silence, so no item can be created but ours — which is also
             what lets the barrier below simply count them.
             docs/plans/260831l-live-conversation-in-chat.md § 6. */
          if (microphone) {
            track.enabled = false;
            micTrack.current = track;
          }
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
              Authorization: `Bearer ${ticket.token}`,
              "Content-Type": "application/sdp",
            },
          });
          if (!answer.ok) {
            throw new Error(
              `OpenAI refused the connection (${answer.status}): ${(await answer.text()).slice(0, 200)}`,
            );
          }
          if (stale()) return abandon();
          await conn.setRemoteDescription({ type: "answer", sdp: await answer.text() });
          if (stale()) return abandon();
        } catch (err) {
          /* **Release before reporting.** Everything above this line can throw
             after the claim is taken — `getUserMedia` on a denied permission,
             a refused SDP exchange, a network that died between the two. A
             claim left standing is not a cosmetic leak: `claimMicrophone`
             chains every claimant onto the previous one's `released`, so a
             promise that never settles wedges the page's microphone for every
             dictation box on it, for the life of the tab, with no error
             anywhere pointing here.

             `stop()` does the whole release and is safe on a half-built
             session — every field it touches is null-guarded, which is worth
             more than a bespoke unwind path that would have to be kept in step
             with `stop` forever. */
          /* **A stale attempt reports nothing and tears down nothing shared.**
             Without this check the catch called the global `stop`, which closes
             whichever session is running *now* — so a ticket request that
             failed after the reader had already started a second session killed
             that session and reported the first one's error as its failure.
             GPT Sol, second review. */
          if (stale()) return abandon();
          failed.current = true;
          endedBecause.current = "failed-to-start";
          /* **Awaited, and the report comes after.** `stop` is asynchronous now
             — it holds the channel open for a moment so the last words can
             land — so reporting first and tearing down afterwards would have
             the teardown's own `setPhase` land on top of the failure. Nothing
             here is waiting on a reader: the microphone was handed back in
             `stop`'s first step. */
          await stopRef.current();
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

  /**
   * **The session does not outlive the thing that owns it.**
   *
   * A peer connection nothing owns is a microphone that stays open, events that
   * go nowhere and an exchange in flight that is never written down — and the
   * reader would have no way to end it but closing the tab. The hook is held at
   * the article level precisely so this fires on leaving the article or leaving
   * chat mode, and not on every conversation switch.
   *
   * **Guarded on there being a connection**, because `StrictMode` mounts and
   * unmounts once before anything real happens, and a teardown of nothing would
   * still take the phase through `closing`.
   *
   * The cleanup cannot await, so the flush it starts finishes on its own — the
   * write goes through the chat controller, which deliberately outlives this
   * component for exactly that reason (see controller.ts § `detach`).
   */
  /**
   * **The caps, checked on a slow clock while a session is running.**
   *
   * A timer rather than a deadline set at connect time, because the idle one
   * moves: every time the reader speaks it starts again. Ten seconds of
   * resolution is plenty for a cap measured in minutes and costs nothing.
   *
   * It reports *why* it ended, because a session that simply stops with no
   * explanation reads as a bug — and the reader can press Live again in the
   * same breath, which is the right answer to both caps.
   */
  useEffect(() => {
    if (phase !== "live") return;
    const tick = setInterval(() => {
      const now = Date.now();
      /* **Never in the middle of a sentence.** A cap that fires while the
         reader is talking ends the session and takes what they were saying with
         it — the hang-up mutes and settles first, but the honest fix is not to
         start at all. It will fire on the next tick, ten seconds later, which
         nobody will notice. GPT Sol, second review. */
      if (midSentence.current) return;
      if (now - lastHeard.current > IDLE_CAP_MS) {
        setError("The live conversation ended after a few minutes of quiet. Press Live to carry on.");
        endedBecause.current = "idle-cap";
        void stopRef.current();
        return;
      }
      if (now - began.current > SESSION_CAP_MS) {
        setError("The live conversation has been going a while and has ended. Press Live to carry on.");
        endedBecause.current = "session-cap";
        void stopRef.current();
      }
    }, 10_000);
    return () => clearInterval(tick);
  }, [phase]);

  useEffect(() => {
    /* **Leaving the page ends the session.** `pagehide` rather than `unload`,
       which is unreliable and blocks the bfcache; and deliberately **not**
       `visibilitychange` — a reader who looks at another tab while talking is
       having a conversation, not abandoning one, and hanging up on them would
       be the rudest possible reading of "hidden". */
    const leaving = () => {
      if (!(pc.current || dc.current)) return;
      endedBecause.current = "pagehide";
      /* **The hint, and it has to come first.** `stop` below is a chain of
         awaits — a settle window, a grace window, the write queue — and a page
         that is unloading will not run them, so anything the meter is still
         holding would go with the tab. This flushes it now, with `keepalive`,
         which is the one thing a browser will carry across an unload.

         It is a hint and never the path: the budget is small, there is no
         feedback about whether any of it arrived, and this is precisely the
         accepted loss — the last turn can vanish on a crash or an instant
         close. Every earlier turn was posted as it happened.
         ./meter.ts § `LiveMeter`. */
      const ending = meter.current;
      if (ending) {
        ending.end("pagehide");
        void ending.flush();
      }
      void stopRef.current();
    };
    window.addEventListener("pagehide", leaving);
    return () => {
      window.removeEventListener("pagehide", leaving);
      /* **The epoch is bumped whatever state we are in**, and that is the fix
         rather than the tidying. A `start` half way through its awaits has no
         peer connection yet, so a cleanup that only tears down what exists
         found nothing and let the abandoned attempt carry on to open one — a
         microphone held by a session with no owner and no control on the page
         that could close it. GPT Sol, reviewing the built code. */
      epoch.current += 1;
      endedBecause.current = "unmounted";
      if (pc.current || dc.current || claim.current) void stopRef.current();
    };
  }, []);

  return {
    phase,
    error,
    lines,
    pointers,
    tools,
    hearing,
    speaking,
    seen,
    placement,
    threadId,
    start,
    stop,
    say,
  };
}
