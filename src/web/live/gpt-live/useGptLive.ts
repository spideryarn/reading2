/**
 * **The browser half of live conversation on GPT-Live**, the second engine.
 * docs/plans/261003a-gpt-live-alongside-realtime-for-live-conversation.md is
 * the design; src/live-gpt.ts is the server half.
 *
 * It returns the same `LiveApi` as `useLiveConversation` (OpenAI Realtime), so
 * the Live button, the status strip, the transcript and Reconnect do not know
 * which engine they are showing. The two are built side by side to be compared
 * and one will be deleted, so nothing here is abstracted into a provider
 * framework. Read `../useLiveConversation.ts`'s header first: what a session
 * does not own (writing rows down), why appends are a serial queue, and why the
 * session epoch exists are the same here and are not repeated.
 *
 * ## What is different on this wire
 *
 * - **One request opens the call.** There is no short-lived client secret, so
 *   the SDP offer goes to our server, which passes it to OpenAI and returns the
 *   answer (`wiring.session`). So the microphone is opened *before* that
 *   request, not after: the offer needs a track. It also means a reader who
 *   refuses the microphone costs nothing, since OpenAI bills fifteen seconds
 *   the moment a session is created.
 * - **No seeding barrier.** The history went to OpenAI inside the create
 *   request. The microphone opens on `session.started` and the tail check.
 * - **No turns.** Transcripts arrive as 200 ms fragments with no ids and no
 *   "done". `./segments.ts` turns them into exchanges; this hook feeds it and
 *   writes what it freezes.
 * - **Tools belong to a second model.** The voice hands a question to a text
 *   model (a *delegation*), whose function calls reach this tab wrapped in
 *   `response.event`. `./delegations.ts` decides what to run and what to send
 *   back; this hook performs what it returns.
 * - **No voice-detector or playback events.** `hearing` and `speaking` are
 *   estimates: a fragment from that side in the last second or so. The idle
 *   cap resets on reader fragments. There is no "open turn" stall.
 * - **An open minute is a billed minute.** Five cents, silence included, where
 *   Realtime bills nothing while nobody speaks. So this engine has its own,
 *   shorter idle cap (`GPT_LIVE_IDLE_CAP_MS`).
 * - **The call is closed by asking.** `session.close`, then `session.closed`,
 *   which carries the final seconds billed.
 *
 * ## The logic is in three pure reducers, and this file should stay thin
 *
 * `Segmenter` (fragments to rows), `DelegationLoop` (the tool loop) and
 * `gptLiveStallOf` (is a reply owed). Each has its own tests. What is left here
 * is sequencing: the start, the hang-up, and which ref an event updates.
 *
 * ## Shared with the Realtime hook, and copied from it
 *
 * **Shared** (`../session-shared.ts`): the caps and deadlines, `startupMessage`,
 * `silentTrack`, `shownPassage`. Also `../stall.ts` for the microphone and
 * connection stalls, `../meter.ts`'s queue, `../wiring.ts`, the microphone lock,
 * the device memory and `useAudioLevel`.
 *
 * **Copied**, because each is woven through that hook's own refs and staleness
 * checks and lifting it out would have meant rewriting the Realtime hook. When
 * one engine is deleted, delete its copy and nothing else moves:
 *
 * - the microphone claim and `getUserMedia` with its two fallbacks (`start`)
 * - `abandon` and the staleness check after every await (`start`)
 * - the peer connection's `connectionstatechange` handling and the audio
 *   element with its `pause` listener (`start`)
 * - `enableAudio`
 * - the serial write queue (`commit`)
 * - the Sentry report for a stall (`checkStall`)
 * - the caps effect, the `pagehide` and unmount effect
 * - `reconnect` and its intent token, and `hangUp`
 *
 * ## What `LiveApi` asks for that this engine answers differently
 *
 * - `placement` is always null. GPT-Live has no noise-reduction setting, so
 *   nothing is resolved and nothing is sent; null is what the UI already reads
 *   as "nothing to say".
 * - `hearing` and `speaking` trail the audio by the transcript delay.
 * - `say(text)` sends a typed turn. A typed message produces no input
 *   transcript on this wire, so the text is also given to the segmenter as a
 *   literal reader text at the last observed timeline edge. Wall time cannot
 *   place it: the provider's timeline may have stopped meanwhile.
 *   Nothing in the app calls it; it is how a browser check with no microphone
 *   asks a question.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

import { claimMicrophone, releaseMicrophone, type MicClaim } from "../../mic-lock.js";
import { audioConstraint, defaultInputListed, deviceMissing, labelled, rememberedDevice } from "../../mic-devices.js";
import { captureClientFailure } from "../../monitoring.js";
import { useAudioLevel } from "../../useAudioLevel.js";
import {
  DISCONNECT_GRACE_MS,
  GRACE_POLL_MS,
  HANGUP_GRACE_MS,
  SEED_TIMEOUT_MS,
  SESSION_CAP_MS,
  STALL_REPORT_AFTER_MS,
  TOOL_TIMEOUT_MS,
  shownPassage,
  silentTrack,
  startupMessage,
} from "../session-shared.js";
import { stallOf, type LiveStall } from "../stall.js";
import type { LiveApi, LiveLine, LiveOptions, LivePhase, LivePointer, LiveStep, LiveToolRun } from "../useLiveConversation.js";
import { apiWiring } from "../wiring.js";
import { ownLabel } from "../../lib/own-label.js";
import { DelegationLoop, type DelegationEffect } from "./delegations.js";
import { GptLiveMeter, backendReport, voiceReport, type GptLiveUsageReport } from "./meter.js";
import { Segmenter, type Speaker, type SpokenExchange as FrozenExchange } from "./segments.js";
import { gptLiveStallOf, sessionZero, timelineOrigin, type DelegationDebt } from "./stall.js";

/**
 * **How long the reader may say nothing before this engine ends the call.**
 * Two minutes, where Realtime's `IDLE_CAP_MS` (../session-shared.ts) is five.
 *
 * GPT-Live bills $0.05 for every minute a session is open, silence included;
 * Realtime bills by the token and nothing while nobody speaks. A reader reads
 * between questions, and a peer's measurement put a twenty-minute session with
 * five questions at about $1.00 here against $0.25 there
 * (docs/investigations/261002r-gpt-live-spike.md § Cost per minute, both
 * ways). Closing sooner is what OpenAI's own guide suggests. It costs the
 * reader one press of Live and a second or two of reconnecting; the
 * conversation is seeded from the thread, so it picks up where it left off.
 *
 * **What the clock counts** (the caps effect below):
 *
 * - It starts again at every reader fragment that was speech. Not the
 *   companion's, and not a cough the transcript wrote in brackets.
 * - It does not run while a delegation is running: the reader asked, and is
 *   waiting.
 * - It starts again when a delegation ends, so the answer and the reader's
 *   reply to it get the full two minutes however long the backend took.
 *
 * So a call is never ended under an answer in flight. A reply that is still
 * owed two minutes after it became owed does not hold the call open: by then
 * the no-reply notice has offered Reconnect for a hundred seconds, and holding
 * on would bill silence up to the twenty-minute cap.
 */
export const GPT_LIVE_IDLE_CAP_MS = 2 * 60_000;

/**
 * How recently a fragment must have arrived for that side to count as talking.
 *
 * Fragments are 200 ms windows and the spike shows gaps of 600 ms between two
 * words of one sentence, so anything under a second flickers mid-sentence.
 */
const FRAGMENT_RECENT_MS = 1_200;

/**
 * How long with no fragment before a hang-up stops waiting for more.
 *
 * Transcripts trail the audio by a few hundred milliseconds. A hang-up after a
 * pause waits for none of this; one in the middle of a sentence waits until
 * the fragments stop, up to `HANGUP_GRACE_MS`.
 */
const FRAGMENT_QUIET_MS = 800;

/** How long a hang-up waits for `session.closed` after asking for it. The spike's took about half a second. */
const CLOSE_WAIT_MS = 3_000;

/** How often `hearing`, `speaking` and the stall rule are re-read while live. */
const PULSE_MS = 500;

/**
 * What to say when OpenAI ends the call. The four reasons the plan names; any
 * other reason gets the last sentence. None of them blames the reader, and each
 * says what to do next (docs/project/copy.md).
 */
const CLOSED_SENTENCE: Record<string, string> = {
  expired: "The live conversation reached its time limit and has ended. Press Live to carry on.",
  content: "The voice service ended this call because of something that was said. Press Live to start again, or carry on typing.",
  connection_lost: "The live connection was lost. Try Live again or carry on typing.",
  remote_hangup: "The voice service ended the call. Press Live to carry on, or carry on typing.",
};
const CLOSED_OTHER = "The live conversation ended. Try Live again or carry on typing.";

/** The counts a stall or error report carries. Numbers only, never a word anybody said. */
interface Tally {
  readerFragments: number;
  companionFragments: number;
  delegations: number;
  finals: number;
  failures: number;
  mutes: number;
  disconnects: number;
  providerErrors: number;
}

const freshTally = (): Tally => ({
  readerFragments: 0,
  companionFragments: 0,
  delegations: 0,
  finals: 0,
  failures: 0,
  mutes: 0,
  disconnects: 0,
  providerErrors: 0,
});

type RunTool = Extract<DelegationEffect, { type: "runTool" }>;

const wordsIn = (text: string): number => text.split(/\s+/).filter(Boolean).length;

/**
 * **Tap to talk is not offered on this engine**, so its three actions do
 * nothing and `talkMode` is always `hands-free`.
 *
 * It is OpenAI Realtime's push-to-talk: the browser turns that session's voice
 * detector off and commits the audio buffer itself (plan 261003d). A GPT-Live
 * session has no such events, and no detector this page can switch. Nothing
 * shows the control either: it is offered beside the `open-turn` stall, which
 * this hook never reports (`turnOpenSince: null` in `checkStall`).
 */
const notOffered = (): void => {};

export function useGptLive(slug: string, opts: LiveOptions = {}): LiveApi {
  const [phase, setPhase] = useState<LivePhase>("idle");
  /**
   * Which connecting step this call is on, for LiveStatus. This engine's order
   * is not Realtime's: the microphone comes first, and one request to our
   * server is both the ticket and the connection — so there is no `ticket`
   * step, and `transport` is that request.
   */
  const [step, setStep] = useState<LiveStep | null>(null);
  /** A reconnect is waiting for its hang-up, so the panel can offer to cancel it. */
  const [reconnectPending, setReconnectPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<LiveLine[]>([]);
  const [hasUnsavedLines, setHasUnsavedLines] = useState(false);
  const [pointers, setPointers] = useState<LivePointer[]>([]);
  const [tools, setTools] = useState<LiveToolRun[]>([]);
  const [hearing, setHearing] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [seen, setSeen] = useState<Record<string, number>>({});
  const [inputTrack, setInputTrack] = useState<MediaStreamTrack | null>(null);
  const [inputContext, setInputContext] = useState<AudioContext | null>(null);
  const inputMeter = useAudioLevel(inputTrack, inputContext);
  const [deviceLabel, setDeviceLabel] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [playbackBlocked, setPlaybackBlocked] = useState(false);
  /** A delegation is running: the backend is working on a question. */
  const [working, setWorking] = useState(false);
  const [pendingTools, setPendingTools] = useState<{ callId: string; name: string }[]>([]);
  const [stall, setStall] = useState<LiveStall | null>(null);
  const [threadId, setThreadId] = useState<string | null>(null);

  /** Everything the caller supplies, behind a ref that cannot go stale. See the Realtime hook. */
  const wired = useRef(opts);
  wired.current = opts;

  const pc = useRef<RTCPeerConnection | null>(null);
  const dc = useRef<RTCDataChannel | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const context = useRef<AudioContext | null>(null);
  const claim = useRef<MicClaim | null>(null);
  const releasedResolve = useRef<(() => void) | null>(null);
  const micTrack = useRef<MediaStreamTrack | null>(null);
  const meter = useRef<GptLiveMeter | null>(null);
  /** Pagehide journals the end immediately, but keeps accounting open through close grace. */
  const meterEnded = useRef(false);
  const startup = useRef<{ timer: ReturnType<typeof setTimeout>; abort: AbortController } | null>(null);
  const connectionDeadline = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** The two reducers. One of each per call: their ids belong to one connection. */
  const segmenter = useRef(new Segmenter());
  const loop = useRef(new DelegationLoop());

  /** Which session is the current one. Bumped by every start and stop. See the Realtime hook. */
  const epoch = useRef(0);
  /** The hang-up in progress, so a second press joins it. */
  const closing = useRef<Promise<void> | null>(null);
  /** Set by the failure path, so the hang-up it triggers ends on `failed`. */
  const failed = useRef(false);
  /** An append was refused or lost: nothing more may be written this call. */
  const failing = useRef(false);
  const endedBecause = useRef("reader");
  /** `session.started` has arrived, the tail matched, and the microphone is on. */
  const ready = useRef(false);
  /** Set once in `start`; called when `session.started` arrives. */
  const openTheMicrophone = useRef<(() => void) | null>(null);
  /** `session.closed` has arrived, from our asking or the provider's own decision. */
  const closedSeen = useRef(false);
  const closedResolve = useRef<(() => void) | null>(null);

  /** Appends run one at a time. See `commit` in the Realtime hook. */
  const writing = useRef<Promise<void>>(Promise.resolve());
  const tail = useRef<string | null>(null);
  const boundThread = useRef<string | null>(null);
  const startedThread = useRef("");

  /** Segment ids whose exchange has been handed to `speak`, so their lines leave the live transcript. */
  const handedOff = useRef(new Set<string>());
  /** Lines kept from an earlier call on this thread whose words could not be saved. */
  const kept = useRef<LiveLine[]>([]);
  /**
   * Which start of this hook the segmenter's lines belong to — `LiveLine.session`.
   * A kept line carries the number of the call it was said in, so the thread
   * shows it before this call's words (../tail.ts).
   */
  const sessionNo = useRef(0);
  const shown = useRef<LiveLine[]>([]);
  const unsaved = useRef(false);

  /**
   * **The facts the stall rule and the two pills are read from**, as refs: they
   * are fed several times a second and only the results render.
   *
   * Two clocks. `…Arrived` is when a fragment reached this tab. `…Ms` is where
   * it sits on the session's own timeline, and `zero` is the running estimate
   * of where that timeline starts on this tab's clock (`sessionZero`).
   */
  const zero = useRef<number | null>(null);
  /** `arrived - end_ms` of the latest fragment that was speech: how far behind the timeline is now. */
  const latestOffset = useRef<number | null>(null);
  const startedAt = useRef<number | null>(null);
  const readerArrived = useRef(0);
  const companionArrived = useRef(0);
  const fragmentArrived = useRef(0);
  const readerEndMs = useRef<number | null>(null);
  /** Typed questions have a wall-clock arrival, but no provider speech timestamp. */
  const typedReaderAt = useRef<number | null>(null);
  const companionStartMs = useRef<number | null>(null);
  const debts = useRef(new Map<string, DelegationDebt>());
  const delegationEndedAt = useRef<number | null>(null);
  const micMuted = useRef(false);
  const connectionState = useRef("new");
  const began = useRef(0);
  const tally = useRef<Tally>(freshTally());
  const stallSeen = useRef<{ kind: LiveStall; since: number } | null>(null);
  const stallReported = useRef(new Set<LiveStall>());
  const errorsReported = useRef(new Set<string>());

  /** Tools in flight, by call id, so a hang-up or a failed response can abort them. */
  const toolRequests = useRef(new Map<string, AbortController>());
  /** Calls whose backend response ended while they ran. Their results go nowhere. */
  const deadCalls = useRef(new Set<string>());
  const typed = useRef(0);

  const reconnecting = useRef(0);
  const reconnectSeq = useRef(0);
  const microphoneWanted = useRef(true);

  /** Copied from the Realtime hook. */
  const enableAudio = useCallback(async () => {
    const ctx = context.current;
    if (ctx?.state === "suspended") {
      try { await ctx.resume(); } catch { /* Playback below still offers recovery. */ }
    }
    const player = audio.current;
    if (!player?.srcObject) return;
    try {
      await player.play();
      if (audio.current === player && !closing.current) setPlaybackBlocked(context.current?.state === "suspended");
    } catch {
      if (audio.current === player && !closing.current) setPlaybackBlocked(true);
    }
  }, []);

  /**
   * The transcript on screen: words kept from a failed save, then every segment not yet handed over.
   *
   * `now` is for the handoff and its undo only, and is the Realtime hook's
   * `flushLines`: the live words are drawn in the thread (../LiveTail.tsx), so
   * taking an exchange's lines out must render in the same commit as the chat
   * controller's provisional rows for it going in, or there is a frame with
   * both copies or neither. The rule at both call sites is the same as there:
   * change the controller, then this.
   */
  const refreshLines = useCallback((now = false) => {
    shown.current = [
      ...kept.current,
      ...segmenter.current.lines()
        .filter((line) => !handedOff.current.has(line.id))
        .map((line) => ({ ...line, session: sessionNo.current })),
    ];
    const next = shown.current;
    if (now) flushSync(() => setLines(next));
    else setLines(next);
  }, []);

  const send = useCallback((msg: unknown) => {
    const channel = dc.current;
    if (channel?.readyState === "open") channel.send(JSON.stringify(msg));
  }, []);

  const stopRef = useRef<() => Promise<void>>(async () => {});

  /**
   * Where the session timeline's zero is on this tab's clock, as far as the
   * fragments so far can say. Before any fragment, the moment the session
   * started. `./stall.ts` § Two clocks.
   */
  const origin = useCallback((now: number): number => {
    if (zero.current === null) return startedAt.current ?? now;
    return timelineOrigin(zero.current, latestOffset.current ?? zero.current);
  }, []);

  const failSession = useCallback((message: string, reason: string) => {
    setError(message);
    failed.current = true;
    endedBecause.current = reason;
    void stopRef.current();
  }, []);

  /**
   * **Ask whether this call is stuck, and say so.** The microphone and
   * connection stalls are `../stall.ts`'s, asked with none of the Realtime
   * facts this wire does not have; the missing reply is `./stall.ts`'s.
   */
  const checkStall = useCallback(() => {
    if (!pc.current || !ready.current || closing.current) {
      stallSeen.current = null;
      setStall(null);
      return;
    }
    const now = Date.now();
    const from = origin(now);
    const lastReader = [...segmenter.current.segments()].reverse().find((s) => s.role === "reader");
    const kind =
      stallOf({
        now,
        micMuted: micMuted.current,
        connection: connectionState.current,
        turnOpenSince: null,
        owedSince: null,
        responseActive: false,
        lastEventAt: now,
        speaking: false,
        toolRunning: false,
      }) ??
      gptLiveStallOf({
        now,
        readerLastAt: typedReaderAt.current ?? (readerEndMs.current === null ? null : from + readerEndMs.current),
        readerWords: lastReader ? wordsIn(lastReader.text) : 0,
        companionLastBeganAt: companionStartMs.current === null ? null : from + companionStartMs.current,
        readerReplyArrivedAt: typedReaderAt.current === null ? null : companionArrived.current,
        delegations: [...debts.current.values()],
        delegationEndedAt: delegationEndedAt.current,
      });
    setStall(kind);
    if (!kind) {
      stallSeen.current = null;
      return;
    }
    if (stallSeen.current?.kind !== kind) stallSeen.current = { kind, since: now };
    if (now - stallSeen.current.since < STALL_REPORT_AFTER_MS || stallReported.current.has(kind)) return;
    stallReported.current.add(kind);
    /* One report per kind per call, counts only. The name carries the kind for
       the reason the Realtime hook gives: the message is withheld and the name
       is what Sentry groups on. */
    const report = new Error("live conversation stalled");
    report.name = `GptLiveStall-${kind}`;
    const t = tally.current;
    captureClientFailure(report, {
      live_engine: "gpt-live",
      live_stall: kind,
      live_reader_fragments: t.readerFragments,
      live_companion_fragments: t.companionFragments,
      live_delegations: t.delegations,
      live_finals: t.finals,
      live_failures: t.failures,
      live_mutes: t.mutes,
      live_disconnects: t.disconnects,
      live_provider_errors: t.providerErrors,
    });
  }, [origin]);

  /**
   * Queue frozen exchanges for the thread, one at a time, in order.
   *
   * Copied from the Realtime hook's `commit`, where the reasons are written
   * out: each append claims the previous one's stored id, and a refusal ends
   * the call rather than carrying on with a tail this tab cannot vouch for.
   * The differences: lines are taken off the screen by segment id, and the
   * body names the engine so the row is marked with the right model.
   */
  const commit = useCallback((exchanges: FrozenExchange[]) => {
    const speak = wired.current.speak;
    if (!speak) return;
    for (const exchange of exchanges) {
      writing.current = writing.current.then(async () => {
        if (failing.current) return;
        const thread = boundThread.current;
        if (!thread) return;
        for (const id of exchange.itemIds) handedOff.current.add(id);
        /* `speak` installs its provisional rows before any network wait; the
           live copy then leaves in the same commit. See `refreshLines`. */
        const landing = speak({
          threadId: thread,
          question: exchange.question,
          answer: exchange.answer,
          expectedTailId: tail.current,
          ...(exchange.passages.length > 0 ? { passages: exchange.passages } : {}),
          ...(exchange.tools.length > 0
            ? { tools: exchange.tools.map((t) => ({ ...t, status: "done" as const })) }
            : {}),
          ...(exchange.interrupted ? { interrupted: true } : {}),
          engine: "gpt-live",
        });
        refreshLines(true);
        const landed = await landing;
        if (!landed.ok) {
          /* Back on screen. The segmenter keeps every segment for the life of
             the call, so un-hiding them is all it takes. The controller has
             already taken its provisional rows out by the time it says so. */
          for (const id of exchange.itemIds) handedOff.current.delete(id);
          refreshLines(true);
          unsaved.current = true;
          setHasUnsavedLines(true);
          setError(landed.error);
          failing.current = true;
          endedBecause.current = "append-refused";
          /* A task later, not from inside the queue: `stop` awaits this chain. */
          setTimeout(() => void stopRef.current(), 0);
          return;
        }
        tail.current = landed.tailId;
        if (landed.threadId !== boundThread.current) {
          boundThread.current = landed.threadId;
          setThreadId(landed.threadId);
          wired.current.onThreadId?.(landed.threadId, startedThread.current);
        }
      });
    }
  }, [refreshLines]);

  /** Hand one bill to the meter, or count that it could not be read. */
  const meterReport = useCallback((report: GptLiveUsageReport | null) => {
    const m = meter.current;
    if (!m) return;
    if (report) {
      m.report(report);
      return;
    }
    m.couldNotRead();
    console.error(
      "[live-meter] a GPT-Live usage event arrived without the numbers needed to price it; this call's cost is understated",
    );
  }, []);

  const performRef = useRef<(effects: DelegationEffect[]) => void>(() => {});

  /**
   * Run one tool the backend asked for, and give the loop its output.
   *
   * **A failure is still an output**: the backend is waiting on it, and an
   * error it can talk its way out of is better than a delegation that never
   * continues. `show_passage` is answered here, as in the Realtime hook.
   */
  const runTool = useCallback(async ({ callId, name, args, delegationId }: RunTool) => {
    /* Which call asked, captured before any await. A tool can outlive the call
       that asked for it, and everything `settle` touches is shared. */
    const era = epoch.current;
    const loopThen = loop.current;
    const sameCall = () => era === epoch.current && loop.current === loopThen;
    const started = Date.now();
    setPendingTools((previous) => [...previous, { callId, name }]);

    const settle = (output: string, label: string, detail: string) => {
      if (!sameCall()) return;
      setPendingTools((previous) => previous.filter((tool) => tool.callId !== callId));
      /* Its backend response already failed: shown as failed then, and the
         loop would ignore this result anyway. */
      if (deadCalls.current.has(callId)) return;
      setTools((t) => [...t, { callId, name, label, detail, ms: Date.now() - started }]);
      /* The receipt, held by the segmenter until this delegation's final. */
      segmenter.current.push({ type: "tool", delegationId, tool: { name, label, detail } });
      performRef.current(loop.current.toolSettled(callId, output));
    };

    if (name === "show_passage") {
      const passage = shownPassage(args, wired.current.blocks);
      /* No id the article has: no pointer, and nothing to store. The backend
         is still answered, and `output` tells it nothing was shown. */
      if (passage.blockIds.length > 0) {
        setPointers((p) => [...p, { blockIds: passage.blockIds, why: passage.why, at: Date.now() }]);
        segmenter.current.push({
          type: "passage",
          delegationId,
          passage: { blockIds: passage.blockIds, why: passage.why },
        });
      }
      settle(passage.output, passage.label, passage.detail);
      return;
    }

    const request = new AbortController();
    toolRequests.current.set(callId, request);
    const timeout = setTimeout(() => request.abort(), TOOL_TIMEOUT_MS);
    try {
      const out = await Promise.race([
        (wired.current.wiring ?? apiWiring).runTool(slug, name, args, request.signal),
        new Promise<never>((_, reject) => {
          request.signal.addEventListener("abort", () => reject(new Error("The tool took too long. Try again.")), { once: true });
        }),
      ]);
      settle(out.content, out.label, out.detail);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      settle(`That tool failed: ${message}`, name, `failed — ${message}`);
    } finally {
      clearTimeout(timeout);
      if (toolRequests.current.get(callId) === request) toolRequests.current.delete(callId);
    }
  }, [slug]);

  /**
   * Do what the delegation loop said. The loop decides; this only acts.
   *
   * While the call is closing, nothing is run and nothing is sent. Usage is
   * still reported, and a final still pins its receipts, because both describe
   * work that has already happened.
   */
  const perform = useCallback((effects: DelegationEffect[]) => {
    for (const effect of effects) {
      switch (effect.type) {
        case "started":
          debts.current.set(effect.delegationId, { id: effect.delegationId, startedAt: effect.at, finalAt: null });
          tally.current.delegations += 1;
          break;
        case "runTool":
          if (!closing.current) void runTool(effect);
          break;
        case "send":
          if (!closing.current) send(effect.event);
          break;
        case "delegationFinal": {
          const debt = debts.current.get(effect.delegationId);
          if (debt) debt.finalAt = effect.at;
          delegationEndedAt.current = effect.at;
          tally.current.finals += 1;
          commit(segmenter.current.push({ type: "delegation-final", delegationId: effect.delegationId }));
          break;
        }
        case "usage":
          meterReport(backendReport(effect.responseId, effect.usage));
          break;
        case "failed": {
          /* The stall rule is told a delegation ended, not which: it restarts
             the reader's clock from here. `./stall.ts`. */
          debts.current.delete(effect.delegationId);
          delegationEndedAt.current = effect.at;
          tally.current.failures += 1;
          /* Aborting is what takes each off the "Using tools…" list: the
             abort settles the run, and `settle` sees it is dead. */
          for (const callId of effect.callIds) {
            deadCalls.current.add(callId);
            toolRequests.current.get(callId)?.abort();
          }
          setTools((t) => [
            ...t,
            {
              callId: `failed-${effect.delegationId}-${effect.at}`,
              name: "delegation",
              label: "Checking the article",
              detail: `failed — ${effect.message}`,
              ms: 0,
            },
          ]);
          break;
        }
        default:
          effect satisfies never;
      }
    }
    setWorking([...debts.current.values()].some((debt) => debt.finalAt === null));
  }, [commit, meterReport, runTool, send]);
  performRef.current = perform;

  /** One transcript fragment: the clocks, the pills, then the segmenter. */
  const fragment = useCallback((role: Speaker, e: Record<string, unknown>, now: number) => {
    const startMs = e.start_ms;
    const endMs = e.end_ms;
    const delta = e.delta;
    if (typeof startMs !== "number" || typeof endMs !== "number" || typeof delta !== "string") return;
    const eventId = typeof e.event_id === "string" && e.event_id !== "" ? e.event_id : `${role}:${startMs}:${endMs}:${delta}`;
    /* The segmenter first: it is the one that knows whether this was speech.
       A bracketed sound comes in pieces (" [hum" then "]"), so no check on one
       delta here could tell. */
    const heard = segmenter.current.take({ role, eventId, startMs, endMs, delta });
    if (heard.speech) {
      zero.current = sessionZero(zero.current, now, endMs);
      latestOffset.current = now - endMs;
      fragmentArrived.current = now;
      if (role === "reader") {
        /* Only the reader's voice resets the idle clock. */
        readerArrived.current = now;
        typedReaderAt.current = null;
        readerEndMs.current = Math.max(readerEndMs.current ?? 0, endMs);
        tally.current.readerFragments += 1;
        if (!closing.current) setHearing(true);
      } else {
        companionArrived.current = now;
        companionStartMs.current = Math.max(companionStartMs.current ?? 0, startMs);
        tally.current.companionFragments += 1;
        if (!closing.current) setSpeaking(true);
      }
    }
    commit(heard.exchanges);
    refreshLines();
  }, [commit, refreshLines]);

  const onEvent = useCallback((raw: MessageEvent<string>) => {
    let e: Record<string, unknown>;
    try {
      e = JSON.parse(raw.data) as Record<string, unknown>;
    } catch {
      return;
    }
    const type = String(e.type ?? "");
    const nested = type === "response.event" ? String((e.event as { type?: unknown } | undefined)?.type ?? "") : "";
    const counted = nested ? `${type}/${nested}` : type;
    setSeen((s) => ({ ...s, [counted]: (s[counted] ?? 0) + 1 }));
    const now = Date.now();

    switch (type) {
      case "session.started":
        startedAt.current = now;
        openTheMicrophone.current?.();
        return;
      case "session.input_transcript.delta":
        fragment("reader", e, now);
        return;
      case "session.output_transcript.delta":
        fragment("companion", e, now);
        return;
      case "session.delegation.created":
      case "response.event":
        perform(loop.current.push(e, now));
        return;
      case "session.usage.updated":
        meterReport(voiceReport(e));
        return;
      case "session.closed": {
        /* The final figure for the call, whoever closed it. */
        meterReport(voiceReport(e));
        closedSeen.current = true;
        closedResolve.current?.();
        if (closing.current) return;
        /* Not our doing: the provider ended the call. Say why, then the
           ordinary hang-up, which writes what was said. */
        const reason = typeof e.reason === "string" ? e.reason : "unknown";
        /* `ownLabel`, because the reason is the provider's string: a bare
           lookup answers `toString` with a function, and a state setter
           calls a function it is handed (lib/own-label.ts). */
        setError(ownLabel(CLOSED_SENTENCE, reason) ?? CLOSED_OTHER);
        endedBecause.current = `provider-${reason}`.slice(0, 60);
        void stopRef.current();
        return;
      }
      case "error": {
        /* **Logged and counted, not the end of the call.** `event_not_allowed`
           is this tab having sent something the allowlist refuses, and the
           call carries on. If the provider cannot continue it closes the
           session or the channel, and each of those has its own ending. The one
           exception is an error before the call has started, when there is
           nothing to carry on with. Only the code is logged: the message can
           quote what was sent. */
        const detail = e.error as { code?: unknown; type?: unknown } | undefined;
        const code = String(detail?.code ?? detail?.type ?? "unknown").replace(/[^a-z0-9_]/gi, "_").slice(0, 60);
        tally.current.providerErrors += 1;
        console.error(`[gpt-live] the voice service reported an error (${code}); ${tally.current.providerErrors} so far this call`);
        if (!errorsReported.current.has(code)) {
          errorsReported.current.add(code);
          const report = new Error("live conversation provider error");
          report.name = `GptLiveError-${code}`;
          captureClientFailure(report, { live_engine: "gpt-live", live_error: code, live_ready: ready.current });
        }
        if (!ready.current && !closing.current) {
          failSession("Live voice is unavailable right now. Try again, or carry on typing or dictation.", "provider-error");
        }
        return;
      }
      default:
        return;
    }
  }, [fragment, perform, meterReport, failSession]);

  /**
   * **Hang up: device first, then the last words, then ask the call to close,
   * then write, then tear down.**
   *
   * 1. The microphone track is stopped and the claim released at once, so the
   *    next claimant (dictation) waits for nothing else.
   * 2. The channel is kept while fragments are still arriving, up to
   *    `HANGUP_GRACE_MS`: the transcript of the last sentence trails its audio.
   * 3. `session.close`, and up to `CLOSE_WAIT_MS` for `session.closed`, which
   *    carries the final seconds billed. Skipped if the provider closed first.
   * 4. End the transport, then freeze and write everything still held. Keeping
   *    a producer alive during slow appends leaves no last snapshot to save.
   * 5. Await the writes, and tell the journal why it ended.
   */
  const stop = useCallback((): Promise<void> => {
    if (closing.current) return closing.current;
    /* Bumped first, so a `start` still in its awaits abandons. */
    epoch.current += 1;
    setPhase("closing");
    stallSeen.current = null;
    setStall(null);
    if (connectionDeadline.current) clearTimeout(connectionDeadline.current);
    connectionDeadline.current = null;
    if (startup.current) {
      clearTimeout(startup.current.timer);
      startup.current.abort.abort();
      startup.current = null;
    }
    for (const request of toolRequests.current.values()) request.abort();
    toolRequests.current.clear();
    setPendingTools([]);
    setWorking(false);
    setPlaybackBlocked(false);
    setInputTrack(null);
    setInputContext(null);
    const oldContext = context.current;
    context.current = null;
    if (oldContext && oldContext.state !== "closed") void oldContext.close?.().catch(() => {});

    const finish = (async () => {
      micTrack.current?.stop();
      micTrack.current = null;
      if (claim.current) releaseMicrophone(claim.current);
      releasedResolve.current?.();
      releasedResolve.current = null;
      claim.current = null;
      setHearing(false);

      const channel = dc.current;
      const open = () => channel?.readyState === "open";
      const until = Date.now() + HANGUP_GRACE_MS;
      while (
        !failing.current &&
        !closedSeen.current &&
        open() &&
        Date.now() < until &&
        Date.now() - fragmentArrived.current < FRAGMENT_QUIET_MS
      ) {
        await new Promise((r) => setTimeout(r, GRACE_POLL_MS));
      }

      if (channel && open() && !closedSeen.current) {
        let waited: ReturnType<typeof setTimeout> | null = null;
        const closed = new Promise<void>((resolve) => {
          closedResolve.current = resolve;
          waited = setTimeout(resolve, CLOSE_WAIT_MS);
        });
        channel.send(JSON.stringify({ type: "session.close" }));
        await closed;
        if (waited) clearTimeout(waited);
        closedResolve.current = null;
      }

      /* The close grace is over. Disconnect the producer before the final
         snapshot, rather than taking a fixed number of snapshots while it
         can still change during every awaited save. */
      dc.current?.close();
      for (const sender of pc.current?.getSenders() ?? []) {
        sender.track?.stop();
      }
      pc.current?.close();
      dc.current = null;
      pc.current = null;
      if (audio.current) {
        audio.current.pause?.();
        audio.current.srcObject = null;
        audio.current = null;
      }

      const rest = segmenter.current.closing();
      if (rest.unattached.tools.length + rest.unattached.passages.length > 0) {
        /* Counts only. A tool's label can hold the reader's own search. */
        console.error(
          `[gpt-live] ${rest.unattached.tools.length} tool runs and ${rest.unattached.passages.length} passages had no exchange to go on and were not stored`,
        );
      }
      commit(rest.exchanges);
      await writing.current;

      /* Last, and not awaited: see the Realtime hook. Anything still queued
         gets one `keepalive` attempt inside `flush`. */
      const ending = meter.current;
      meter.current = null;
      if (ending) {
        if (!meterEnded.current) ending.end(endedBecause.current);
        void ending.flush();
      }

      ready.current = false;
      setSpeaking(false);
      setWorking(false);
      setPlaybackBlocked(false);
      setPhase(failed.current ? "failed" : "idle");
      closing.current = null;
    })();

    closing.current = finish;
    return finish;
  }, [commit]);
  stopRef.current = stop;

  const start = useCallback((o: { threadId: string; microphone?: boolean }) => {
    /* A duplicate gesture cannot replace what a call or a hang-up still owns. */
    if (startup.current || closing.current || pc.current || claim.current) return;
    const microphone = o.microphone ?? true;
    epoch.current += 1;
    const mine = epoch.current;

    setPhase("connecting");
    setStep("microphone");
    setError(null);
    setSeen({});
    /* Words a failed save left on screen stay, if this is the same thread. */
    const preserve = startedThread.current === o.threadId && unsaved.current;
    kept.current = preserve
      ? shown.current
          .filter((line) => line.text.trim() !== "")
          .map((line) => ({ ...line, id: `kept-${mine}-${line.id}`, done: true }))
      : [];
    unsaved.current = preserve;
    setHasUnsavedLines(preserve);
    handedOff.current = new Set();
    startedThread.current = o.threadId;
    sessionNo.current += 1;
    segmenter.current = new Segmenter();
    loop.current = new DelegationLoop();
    refreshLines();
    setDeviceLabel(null);
    setNotice(null);
    setPlaybackBlocked(false);
    setWorking(false);
    setPendingTools([]);
    setPointers([]);
    setTools([]);
    setHearing(false);
    setSpeaking(false);
    setStall(null);
    writing.current = Promise.resolve();
    failing.current = false;
    failed.current = false;
    closing.current = null;
    ready.current = false;
    openTheMicrophone.current = null;
    closedSeen.current = false;
    closedResolve.current = null;
    boundThread.current = o.threadId;
    setThreadId(o.threadId);
    meter.current = null;
    meterEnded.current = false;
    endedBecause.current = "reader";
    zero.current = null;
    latestOffset.current = null;
    startedAt.current = null;
    readerArrived.current = Date.now();
    companionArrived.current = 0;
    fragmentArrived.current = 0;
    readerEndMs.current = null;
    typedReaderAt.current = null;
    companionStartMs.current = null;
    debts.current = new Map();
    delegationEndedAt.current = null;
    micMuted.current = false;
    connectionState.current = "new";
    began.current = Date.now();
    tally.current = freshTally();
    stallSeen.current = null;
    stallReported.current = new Set();
    errorsReported.current = new Set();
    deadCalls.current = new Set();
    typed.current = 0;
    reconnecting.current = 0;
    microphoneWanted.current = microphone;

    const abort = new AbortController();
    const timer = setTimeout(() => {
      if (mine !== epoch.current) return;
      failSession("The live session did not finish starting. Check microphone permission, then try again or carry on typing.", "startup-timeout");
    }, SEED_TIMEOUT_MS);
    startup.current = { timer, abort };

    /* Web Audio inside the gesture, as the Realtime hook does. */
    let ctx: AudioContext | null = null;
    try {
      const AudioCtor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioCtor) {
        ctx = new AudioCtor();
        if (ctx.state === "suspended") void ctx.resume().catch(() => {});
        context.current = ctx;
        setInputContext(ctx);
      } else {
        setNotice("The microphone level meter is unavailable in this browser.");
      }
    } catch {
      setNotice("The microphone level meter is unavailable in this browser.");
    }

    let conn: RTCPeerConnection | null = null;
    let track: MediaStreamTrack | null = null;
    let channel: RTCDataChannel | null = null;
    let held: MicClaim | null = null;
    let installedMeter: GptLiveMeter | null = null;
    /** Stop only what this attempt took, and clear a shared ref only if it is still ours. */
    const abandon = () => {
      track?.stop();
      channel?.close();
      conn?.close();
      if (ctx && ctx !== context.current && ctx.state !== "closed") void ctx.close?.().catch(() => {});
      if (pc.current === conn) pc.current = null;
      if (dc.current === channel) dc.current = null;
      if (micTrack.current === track) micTrack.current = null;
      if (installedMeter && meter.current === installedMeter) meter.current = null;
      if (held && claim.current === held) {
        releaseMicrophone(held);
        releasedResolve.current?.();
        releasedResolve.current = null;
        claim.current = null;
      }
    };
    const stale = () => mine !== epoch.current;

    void (async () => {
      try {
        const wiring = wired.current.wiring ?? apiWiring;
        if (!wiring.session || !wiring.gptLiveUsage) {
          throw new Error("This page cannot start a GPT-Live call. [live-not-set-up]");
        }

        /* **One: the microphone.** Before anything is asked of our server,
           because the offer needs a track and because creating the session is
           what OpenAI bills for. Claimed before `getUserMedia`, and only when a
           real device is wanted: see the Realtime hook. */
        const preferred = rememberedDevice();
        let fallbackNotice: string | null = null;
        if (microphone) {
          held = {
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
          if (stale()) return abandon();

          if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser cannot open a microphone. Use a supported browser or carry on typing.");
          let stream: MediaStream;
          const defaultListed = preferred === null && (await defaultInputListed());
          if (stale()) return abandon();
          try {
            stream = await navigator.mediaDevices.getUserMedia(audioConstraint(preferred, defaultListed));
          } catch (failure) {
            if (stale()) return abandon();
            if (!(preferred || defaultListed) || !deviceMissing(failure)) throw failure;
            const fallbackDefaultListed = preferred !== null && (await defaultInputListed());
            if (stale()) return abandon();
            let namedDefaultVanished = false;
            try {
              stream = await navigator.mediaDevices.getUserMedia(audioConstraint(null, fallbackDefaultListed));
            } catch (fallbackFailure) {
              if (stale()) return abandon();
              if (!fallbackDefaultListed || !deviceMissing(fallbackFailure)) throw fallbackFailure;
              namedDefaultVanished = true;
              stream = await navigator.mediaDevices.getUserMedia(audioConstraint(null));
            }
            if (preferred) {
              fallbackNotice = namedDefaultVanished
                ? "Your chosen microphone is unavailable. Using another microphone."
                : "Your chosen microphone is unavailable. Using the system default microphone.";
            }
          }
          track = stream.getAudioTracks()[0] ?? null;
        } else {
          if (!ctx) throw new Error("This browser cannot create the test audio track.");
          track = silentTrack(ctx);
        }
        if (stale()) return abandon();
        if (!track) throw new Error("no microphone track [live-no-track]");
        if (fallbackNotice) setNotice(fallbackNotice);
        if (microphone) {
          /* **Created disabled.** It is enabled on `session.started` and the
             tail check, and not before: a call that hears the reader before the
             thread is known to be the one it was seeded from would write their
             words against the wrong history. */
          track.enabled = false;
          micTrack.current = track;
          setDeviceLabel(labelled(track));
          track.addEventListener?.("ended", () => {
            if (!stale()) failSession("The microphone disconnected. Choose an available input and try Live again.", "microphone-ended");
          });
          const heard = track;
          micMuted.current = heard.muted === true;
          heard.addEventListener?.("mute", () => {
            if (stale()) return;
            micMuted.current = true;
            tally.current.mutes += 1;
            checkStall();
          });
          heard.addEventListener?.("unmute", () => {
            if (stale()) return;
            micMuted.current = false;
            checkStall();
          });
        }

        /* **Two: the peer connection**, with the data channel created before
           the offer so that it is in the SDP. */
        conn = new RTCPeerConnection();
        pc.current = conn;
        conn.addEventListener("connectionstatechange", () => {
          const state = conn?.connectionState;
          if (stale()) return;
          connectionState.current = state ?? "new";
          if (state === "disconnected") tally.current.disconnects += 1;
          checkStall();
          if (connectionDeadline.current) clearTimeout(connectionDeadline.current);
          connectionDeadline.current = null;
          if (state === "disconnected") {
            connectionDeadline.current = setTimeout(() => {
              if (!stale() && conn?.connectionState === "disconnected") {
                failSession("The live connection was lost. Try Live again or carry on typing.", "connection-lost");
              }
            }, DISCONNECT_GRACE_MS);
          }
          if (state === "failed" || state === "closed") {
            failSession("The live connection was lost. Try Live again or carry on typing.", "connection-lost");
          }
        });

        const el = new Audio();
        el.autoplay = true;
        audio.current = el;
        el.addEventListener?.("pause", () => {
          if (stale() || audio.current !== el || closing.current || !el.srcObject) return;
          setPlaybackBlocked(true);
        });
        conn.ontrack = (ev) => {
          if (stale()) return;
          el.srcObject = ev.streams[0] ?? new MediaStream([ev.track]);
          void enableAudio();
        };

        channel = conn.createDataChannel("oai-events");
        dc.current = channel;
        const opened = channel;
        opened.addEventListener("message", (event) => {
          /* Events keep arriving through the hang-up, and are wanted; an old
             channel's must never reach a newer call's reducers. */
          if (dc.current === opened) onEvent(event as MessageEvent<string>);
        });
        opened.addEventListener("open", () => {
          if (!stale()) meter.current?.connected();
        });
        opened.addEventListener("close", () => {
          if (!stale() && !closing.current) failSession("The live connection ended. Try Live again or carry on typing.", "channel-closed");
        });
        conn.addTrack(track);

        const offer = await conn.createOffer();
        await conn.setLocalDescription(offer);
        if (stale()) return abandon();
        if (!offer.sdp) throw new Error("the browser produced no SDP offer [live-no-offer]");

        /* **Three: our server opens the session** and returns OpenAI's answer.
           Last, because this is the step that is billed. */
        setStep("transport");
        const ticket = await wiring.session(slug, o.threadId, { sdp: offer.sdp }, abort.signal);
        const transport = {
          liveConnected: (id: string, keepalive: boolean) => wiring.liveConnected(id, keepalive),
          liveUsage: (id: string, report: GptLiveUsageReport, keepalive: boolean) =>
            wiring.gptLiveUsage?.(id, report, keepalive) ?? Promise.resolve("refused" as const),
          liveClose: (id: string, reason: string | null, keepalive: boolean) => wiring.liveClose(id, reason, keepalive),
        };
        if (stale()) {
          /* The session exists and nobody will use it. Tell the journal, so
             the row does not read as a call that is still running. */
          const orphan = new GptLiveMeter({ sessionId: ticket.sessionId, transport });
          orphan.end("abandoned-start");
          void orphan.flush();
          return abandon();
        }
        tail.current = ticket.tailId;
        installedMeter = new GptLiveMeter({ sessionId: ticket.sessionId, transport });
        meter.current = installedMeter;

        /* **The last check before the call can hear anything**: the tail this
           tab believes in now against the one the session was seeded from. */
        openTheMicrophone.current = () => {
          if (stale() || ready.current) return;
          clearTimeout(timer);
          if (startup.current?.abort === abort) startup.current = null;
          const now = wired.current.tailNow?.(o.threadId);
          if (now !== undefined && now !== ticket.tailId) {
            setError("This conversation changed while the session was starting. Try Live again.");
            endedBecause.current = "thread-moved";
            void stopRef.current();
            return;
          }
          ready.current = true;
          began.current = Date.now();
          readerArrived.current = Date.now();
          if (micTrack.current) {
            micTrack.current.enabled = true;
            setInputTrack(micTrack.current);
          }
          setPhase("live");
        };

        await conn.setRemoteDescription({ type: "answer", sdp: ticket.sdp });
        if (stale()) return abandon();
        /* Until `session.started` and the tail check let the microphone open. */
        setStep("seeding");
      } catch (err) {
        /* A stale attempt reports nothing and tears down nothing shared. */
        if (stale()) return abandon();
        failed.current = true;
        endedBecause.current = "failed-to-start";
        await stopRef.current();
        setError(startupMessage(err));
        setPhase("failed");
      }
    })();
  }, [onEvent, slug, refreshLines, failSession, enableAudio, checkStall]);

  const say = useCallback((text: string) => {
    const trimmed = text.trim();
    if (trimmed === "" || !ready.current || closing.current) return;
    const now = Date.now();
    typed.current += 1;
    readerArrived.current = now;
    typedReaderAt.current = now;
    commit(
      segmenter.current.push({
        type: "typed",
        eventId: `typed-${typed.current}`,
        text: trimmed,
      }),
    );
    refreshLines();
    send({
      type: "response.item.create",
      item: { type: "message", role: "user", content: [{ type: "input_text", text: trimmed }] },
    });
    send({ type: "response.create" });
  }, [commit, refreshLines, send]);

  /**
   * The caps. Copied from the Realtime hook, with fragments standing in for
   * the voice detector, and with this engine's own idle rule
   * (`GPT_LIVE_IDLE_CAP_MS` says what the clock counts and why).
   */
  useEffect(() => {
    if (phase !== "live") return;
    const delegationRunning = () => [...debts.current.values()].some((debt) => debt.finalAt === null);
    const tick = setInterval(() => {
      const now = Date.now();
      /* Never while the reader is talking: it will fire on the next tick. */
      if (now - readerArrived.current < FRAGMENT_RECENT_MS) return;
      const quietSince = Math.max(readerArrived.current, delegationEndedAt.current ?? 0);
      if (!delegationRunning() && now - quietSince > GPT_LIVE_IDLE_CAP_MS) {
        setError(
          "The live conversation ended because nobody had spoken for a couple of minutes. Press Live and it picks up where it left off.",
        );
        endedBecause.current = "idle-cap";
        void stopRef.current();
        return;
      }
      /* Also the backstop for a backend that never finishes, which the idle rule waits on. */
      if (now - began.current > SESSION_CAP_MS) {
        setError("The live conversation has been going a while and has ended. Press Live to carry on.");
        endedBecause.current = "session-cap";
        void stopRef.current();
      }
    }, 10_000);
    return () => clearInterval(tick);
  }, [phase]);

  /** The pulse: the two pills and the stall rule, while live. */
  useEffect(() => {
    if (phase !== "live") return;
    const beat = () => {
      const now = Date.now();
      setHearing(now - readerArrived.current < FRAGMENT_RECENT_MS && tally.current.readerFragments > 0);
      setSpeaking(now - companionArrived.current < FRAGMENT_RECENT_MS);
      checkStall();
    };
    beat();
    const tick = setInterval(beat, PULSE_MS);
    return () => clearInterval(tick);
  }, [phase, checkStall]);

  /** Leaving the page or the owner ends the call. Copied from the Realtime hook. */
  useEffect(() => {
    const leaving = () => {
      if (!(pc.current || dc.current || claim.current || startup.current || context.current)) return;
      endedBecause.current = "pagehide";
      const ending = meter.current;
      if (ending && !meterEnded.current) {
        meterEnded.current = true;
        void ending.checkpoint();
        ending.end("pagehide");
      }
      void stopRef.current();
    };
    window.addEventListener("pagehide", leaving);
    return () => {
      window.removeEventListener("pagehide", leaving);
      epoch.current += 1;
      reconnecting.current = 0;
      endedBecause.current = "unmounted";
      if (pc.current || dc.current || claim.current || startup.current || context.current) void stopRef.current();
    };
  }, []);

  /** Reconnect: the ordinary hang-up, then the ordinary start. Copied from the Realtime hook. */
  const reconnect = useCallback(() => {
    if (!pc.current || !ready.current || closing.current || startup.current) return;
    const thread = boundThread.current;
    if (!thread) return;
    reconnectSeq.current += 1;
    const mine = reconnectSeq.current;
    const microphone = microphoneWanted.current;
    endedBecause.current = stallSeen.current ? `reconnect-${stallSeen.current.kind}` : "reconnect";
    void stop().then(() => {
      if (reconnecting.current !== mine) return;
      reconnecting.current = 0;
      setReconnectPending(false);
      if (failed.current) return;
      start({ threadId: thread, microphone });
    });
    reconnecting.current = mine;
    setReconnectPending(true);
  }, [stop, start]);

  /** The hang-up callers see: the reader's own stop also cancels a waiting reconnect. */
  const hangUp = useCallback((): Promise<void> => {
    if (reconnecting.current !== 0) {
      reconnecting.current = 0;
      setReconnectPending(false);
      endedBecause.current = "reader";
    }
    return stop();
  }, [stop]);

  return {
    phase,
    step: phase === "connecting" ? step : null,
    error,
    lines,
    hasUnsavedLines,
    pointers,
    tools,
    hearing,
    speaking,
    inputLevel: inputMeter.level,
    measuringInput: phase === "live" && inputMeter.measuring,
    quietInput: phase === "live" && inputMeter.quiet,
    deviceLabel,
    notice,
    playbackBlocked,
    enableAudio,
    thinking: (working || pendingTools.length > 0) && !speaking,
    pendingTools,
    seen,
    placement: null,
    threadId,
    start,
    stop: hangUp,
    say,
    stall,
    reconnect,
    reconnecting: reconnectPending,
    talkMode: "hands-free",
    enterTapToTalk: notOffered,
    talk: notOffered,
    doneTalking: notOffered,
  };
}
