/**
 * **What a live session is doing, in one line, beside the composer.**
 *
 * The words themselves are in the thread (./LiveTail.tsx). What is here is the
 * state — a colour and a word — and a sentence, the level meter, anything that
 * needs the reader (a stall, blocked sound, a failure), and an Advanced
 * disclosure for the controls most readers never need.
 *
 * Greg's report is the spec (spya-f4eq7p, 2026-09-29): *"I click the live
 * button, and then nothing seemed to be happening for a minute, and I couldn't
 * tell if it was connecting or if it was listening to me or recording … if
 * there's a problem, I want it to be clear that there's a problem … stuff
 * around headphones and others … hide that in an advanced section."*
 * docs/plans/261002j-live-voice-chat-cleanup.md § 1c and § 1d.
 */
import { useEffect, useState } from "react";
import { MicLevel } from "../MicLevel.js";
import { PassageLinks } from "../PassageLinks.js";
import { ControlTip, Tooltip } from "../Tooltip.js";
import type { BlockId, MicPlacement } from "../../types.js";
import { listInputs, rememberedDevice, rememberDevice, type MicDevice } from "../mic-devices.js";
import { rememberPlacement, rememberedPlacement } from "./mic-placement.js";
import type { LiveStall } from "./stall.js";
import type { LiveApi, LiveStep } from "./useLiveConversation.js";

/**
 * What each stall means, said to the reader. ./stall.ts decides which one it
 * is; these say what happened in words that do not blame them, and sit beside
 * a Reconnect button, which is the answer to every one of them.
 */
const STALL_NOTICE: Record<LiveStall, string> = {
  "microphone-paused":
    "Your device has paused the microphone, so nothing you say is reaching the conversation. It may come back by itself — if not, reconnect.",
  connection: "The connection is unstable. It may recover by itself — if not, reconnect.",
  "open-turn":
    "Still hearing sound after half a minute. Background noise can keep your turn open — tap to talk keeps your microphone off until you speak.",
  "no-reply": "No reply yet. The connection or the voice service may have stalled — reconnect to carry on.",
};

/**
 * The connecting steps, in the order they happen, so a slow one is visibly
 * that one. The microphone step is where the browser's permission prompt is.
 */
const STEP: Record<LiveStep, string> = {
  ticket: "Starting…",
  microphone: "Opening your microphone…",
  transport: "Connecting to the voice service…",
  seeding: "Loading this conversation…",
};
const STEPS: LiveStep[] = ["ticket", "microphone", "transport", "seeding"];

/** The one state word, which the colour says too. */
type LiveState = "connecting" | "listening" | "ready" | "thinking" | "speaking" | "saving" | "stopped" | "error";
const STATE_WORD: Record<LiveState, string> = {
  connecting: "Connecting",
  listening: "Listening",
  ready: "Ready",
  thinking: "Thinking",
  speaking: "Speaking",
  saving: "Saving",
  stopped: "Stopped",
  error: "Error",
};

function describe(live: LiveApi): { state: LiveState; sentence: string } {
  if (live.phase === "connecting") return { state: "connecting", sentence: live.step ? STEP[live.step] : "Starting…" };
  if (live.phase === "closing") {
    return { state: "saving", sentence: live.reconnecting ? "Saving, then reconnecting…" : "Finishing and saving your conversation…" };
  }
  if (live.phase === "failed") return { state: "error", sentence: "Live conversation stopped" };
  if (live.phase === "idle") return { state: live.error ? "error" : "stopped", sentence: "Live conversation ended" };
  if (live.hearing) return { state: "listening", sentence: "Hearing you…" };
  if (live.pendingTools.length > 0) return { state: "thinking", sentence: "Using tools…" };
  if (live.speaking) return { state: "speaking", sentence: "Speaking…" };
  if (live.thinking) return { state: "thinking", sentence: "Thinking…" };
  if (live.talkMode === "tap-idle") {
    return { state: "ready", sentence: "The conversation isn’t listening. Tap Talk, speak, then tap Done." };
  }
  if (live.talkMode === "tap-sending") return { state: "thinking", sentence: "Sending…" };
  if (live.talkMode === "tap-talking") return { state: "listening", sentence: "Listening — tap Done when you’ve finished." };
  return { state: "listening", sentence: "Listening — go ahead" };
}

export function LiveStatus({ live, onRestart, blocks, onJump }: {
  live: LiveApi;
  /** Start again on this conversation after a failed attempt. */
  onRestart(): void;
  blocks?: ReadonlyMap<string, string> | undefined;
  onJump?: ((id: BlockId) => void) | undefined;
}) {
  const [devices, setDevices] = useState<MicDevice[]>([]);
  const [chosen, setChosen] = useState(() => rememberedDevice());
  const [placement, setPlacement] = useState<MicPlacement | null>(() => rememberedPlacement());
  const active = live.phase === "live" || live.phase === "connecting";
  const closing = live.phase === "closing";
  /* A stopped session can still hold words that never acquired an exchange
     owner. LiveTail keeps those words; keep their state beside them too. */
  const visible = live.phase !== "idle" || Boolean(live.error) || live.lines.length > 0;
  /* Dictation and Live share one preference, but this component stays mounted
     while it renders nothing in the idle phase. Re-read at the start of each
     connection so its picker describes the choice that capture just read, not
     the choice that existed when Chat first mounted. */
  useEffect(() => {
    if (live.phase === "connecting") setChosen(rememberedDevice());
  }, [live.phase]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a newly acquired device reveals labels that were hidden before permission
  useEffect(() => {
    if (!visible) return;
    let alive = true;
    const refresh = () => {
      void listInputs().then((inputs) => { if (alive) setDevices(inputs); });
    };
    refresh();
    navigator.mediaDevices?.addEventListener?.("devicechange", refresh);
    return () => {
      alive = false;
      navigator.mediaDevices?.removeEventListener?.("devicechange", refresh);
    };
  }, [visible, live.deviceLabel]);

  if (!visible) return null;
  const { state, sentence } = describe(live);
  /* The meter reads an always-enabled clone. Show it only while the
     conversation can hear the original track, or it depicts room noise that
     tap mode is deliberately keeping out. */
  const hearingInput = live.talkMode === "hands-free" || live.talkMode === "tap-talking";
  /** Use the hook's reconnect intent, so cancellation and failed saves still win. */
  const reconnectIfLive = () => {
    if (live.phase === "live") live.reconnect();
  };
  const failure = live.error && !active && !closing;
  const stalled = live.stall && live.phase === "live";
  const reconnect = (
    <button type="button" onClick={live.reconnect}
      title="End this call and start a fresh one in the same conversation. What was said is kept.">Reconnect</button>
  );
  return (
    <section className={`chat-live-status is-${state}`} aria-label="Live conversation" onKeyDown={(e) => e.stopPropagation()}>
      <div className="chat-live-status-head">
        <span className="chat-live-state">{STATE_WORD[state]}</span>
        {/* Hidden, with the quiet-input notice, whenever tap mode is not
            actively talking: the meter reads the capture, not what is sent,
            so it would show a street the conversation cannot hear. */}
        {active && live.measuringInput && hearingInput && <MicLevel level={live.inputLevel} detected={false} />}
        <span className="chat-live-sentence" role="status">{sentence}</span>
      </div>
      {live.phase === "connecting" && <ol className="chat-live-steps" aria-label="Connecting">
        {STEPS.map((step) => {
          const at = live.step ? STEPS.indexOf(live.step) : 0;
          const here = STEPS.indexOf(step);
          return <li key={step} className={here < at ? "done" : here === at ? "now" : "next"}
            aria-current={here === at ? "step" : undefined}>{STEP[step].replace("…", "")}</li>;
        })}
      </ol>}
      {live.phase === "connecting" && live.measuringInput && live.talkMode === "hands-free" && <p className="chat-live-notice">
        Your microphone is on. The conversation will hear you once it has loaded.
      </p>}
      {live.quietInput && active && hearingInput && <p className="chat-live-notice">No sound detected yet. Check your microphone under Advanced.</p>}
      {live.notice && <p className="chat-live-notice">{live.notice}</p>}
      {stalled && <div className="chat-live-notice chat-live-stall" role="status">
        <span>{STALL_NOTICE[live.stall!]}</span>{" "}
        {/* Reconnect alone sends a reader in a street back into the same
            street. Offered here, by the notice that names the problem, and
            nowhere before it: plan 261003d. */}
        {live.stall === "open-turn" && live.talkMode === "hands-free" &&
          <button type="button" onClick={live.enterTapToTalk}
            title="For the rest of this call: tap Talk, speak, then tap Done. Nothing is heard in between.">Tap to talk</button>}{" "}
        {reconnect}
      </div>}
      {/* Plain action buttons whose label changes, not an `aria-pressed`
          toggle: the state is in the sentence above. Talk waits while the
          companion answers — tap to talk is a walkie-talkie. */}
      {live.phase === "live" && live.talkMode !== "hands-free" && <div className="chat-live-actions">
        {live.talkMode === "tap-talking"
          ? <button type="button" onClick={live.doneTalking}>Done</button>
          : <button type="button" onClick={live.talk}
              disabled={live.talkMode === "tap-sending" || live.thinking || live.speaking || live.pendingTools.length > 0}>Talk</button>}
      </div>}
      {live.playbackBlocked && <div className="chat-live-notice">
        <span>Your browser paused the voice output.</span>{" "}
        <button type="button" onClick={() => void live.enableAudio()}>Enable sound</button>
      </div>}
      {failure && <div className="chat-live-failure" role="alert">
        <p>{live.error}</p>
        <button type="button" className="chat-live-retry" onClick={onRestart}>Try again</button>
      </div>}
      {/* Closing's error, before Try again can work: the Live button is
          disabled until the hang-up finishes. */}
      {live.error && closing && <p className="chat-live-error" role="alert">{live.error}</p>}
      {blocks && onJump && live.pointers.length > 0 && <PassageLinks
        passages={live.pointers.slice(-1)} blocks={blocks} onJump={onJump}
      />}
      {live.tools.length > 0 && <ul className="chat-live-tools" aria-label="Tools used">
        {live.tools.filter((tool) => tool.name !== "show_passage").map((tool) =>
          <li key={tool.callId}>{tool.label}{tool.detail ? ` — ${tool.detail}` : ""}</li>)}
      </ul>}
      {/* **Cancel a reconnect while its hang-up runs.** Reconnect is the
          ordinary hang-up and then the ordinary start, and the Live button is
          disabled while it closes — so without this a reader who pressed it
          and changed their mind would be put back into a call. `stop` cancels
          the pending restart. GPT Sol, plan review 261002j. */}
      {closing && live.reconnecting && <div className="chat-live-actions">
        <button type="button" onClick={() => void live.stop()}>Cancel reconnect</button>
      </div>}
      <details className="chat-live-advanced">
        <summary>Advanced</summary>
        {live.deviceLabel && <p className="chat-live-device">Microphone: {live.deviceLabel}</p>}
        {(devices.length > 0 || live.deviceLabel) && <label className="chat-live-device-picker">
          Microphone
          <select aria-label="Microphone device" value={chosen ?? ""} disabled={live.phase === "connecting" || closing}
            onChange={(e) => {
              const next = e.target.value || null;
              setChosen(next);
              rememberDevice(next);
              reconnectIfLive();
            }}
          >
            <option value="">System default</option>
            {devices.map((device) => <option key={device.deviceId} value={device.deviceId}>{device.label}</option>)}
            {chosen && !devices.some((device) => device.deviceId === chosen) &&
              <option value={chosen}>Your usual microphone (unavailable)</option>}
          </select>
        </label>}
        <Tooltip placement="top" keepSide className="tip-soon" content={
          <ControlTip head="Noise reduction"
            what="Auto estimates whether your microphone is close to your mouth or across the room."
            how="Choose Headphones or Laptop mic to set noise reduction yourself."
            state={live.placement ? `Using ${live.placement.placement === "headset" ? "headphone" : "laptop"} noise reduction.` : undefined}
          />
        }>
          <label className="chat-live-device-picker">
            Noise reduction
            <select aria-label="Noise reduction" value={placement ?? "auto"} disabled={live.phase === "connecting" || closing}
              onChange={(e) => {
                const next = e.target.value === "auto" ? null : e.target.value as MicPlacement;
                setPlacement(next);
                rememberPlacement(next);
                reconnectIfLive();
              }}
            >
              <option value="auto">Auto</option>
              <option value="headset">Headphones</option>
              <option value="laptop">Laptop mic</option>
            </select>
          </label>
        </Tooltip>
        {live.phase === "live" && <p className="chat-live-advanced-note">Changing either of these during a call saves what was said and reconnects.</p>}
        {live.phase === "live" && <div className="chat-live-actions">{reconnect}</div>}
      </details>
    </section>
  );
}
