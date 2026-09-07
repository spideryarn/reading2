/** Reader feedback for a session bound to the conversation currently on screen. */
import { useEffect, useRef, useState } from "react";
import { MicLevel } from "../MicLevel.js";
import { PassageLinks } from "../PassageLinks.js";
import type { BlockId } from "../../types.js";
import { listInputs, rememberedDevice, rememberDevice, type MicDevice } from "../mic-devices.js";
import type { LiveApi } from "./useLiveConversation.js";

function status(live: LiveApi): string {
  if (live.phase === "connecting") return "Starting live conversation…";
  if (live.phase === "closing") return "Finishing and saving your conversation…";
  if (live.phase === "failed") return "Live conversation stopped";
  if (live.hearing) return "Listening…";
  if (live.pendingTools.length > 0) return "Using tools…";
  if (live.speaking) return "Speaking…";
  if (live.thinking) return "Thinking…";
  return live.phase === "live" ? "Listening — you can speak now" : "Live conversation ended";
}

export function LiveStatus({ live, onRestart, onType, onDictate, blocks, onJump }: {
  live: LiveApi;
  onRestart(): void;
  onType(): void;
  onDictate?: (() => void) | undefined;
  blocks?: ReadonlyMap<string, string> | undefined;
  onJump?: ((id: BlockId) => void) | undefined;
}) {
  const [showTranscript, setShowTranscript] = useState(true);
  const [devices, setDevices] = useState<MicDevice[]>([]);
  const [chosen, setChosen] = useState(() => rememberedDevice());
  const mounted = useRef(true);
  const transcript = useRef<HTMLElement>(null);
  const follow = useRef(true);
  const active = live.phase === "live" || live.phase === "connecting";
  const visible = live.phase !== "idle" || Boolean(live.error) || live.lines.length > 0;
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
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
  // Follow new words until the reader scrolls back to inspect an earlier line.
  // biome-ignore lint/correctness/useExhaustiveDependencies: new text or showing the transcript changes its scroll height
  useEffect(() => {
    if (follow.current && transcript.current) transcript.current.scrollTop = transcript.current.scrollHeight;
  }, [live.lines, showTranscript]);

  if (!visible) return null;
  const switching = live.phase === "closing";
  return (
    <section className="chat-live-status" aria-label="Live conversation" onKeyDown={(e) => e.stopPropagation()}>
      <div className="chat-live-status-head">
        {active && live.measuringInput && <MicLevel level={live.inputLevel} detected={false} />}
        <span role="status">{status(live)}</span>
        <label className="chat-live-transcript-toggle">
          <input type="checkbox" aria-label="Show live transcript" checked={showTranscript}
            onChange={(e) => setShowTranscript(e.target.checked)} /> Transcript
        </label>
      </div>
      {live.deviceLabel && <p className="chat-live-device">Microphone: {live.deviceLabel}</p>}
      {live.quietInput && active && <p className="chat-live-notice">No sound detected yet. Check your microphone below.</p>}
      {live.notice && <p className="chat-live-notice">{live.notice}</p>}
      {(devices.length > 0 || live.deviceLabel) && <label className="chat-live-device-picker">
        Microphone
        <select aria-label="Microphone device" value={chosen ?? ""} disabled={switching}
          onChange={(e) => {
            const next = e.target.value || null;
            setChosen(next);
            rememberDevice(next);
            if (active) void live.stop().then(() => { if (mounted.current) onRestart(); });
          }}
        >
          <option value="">Browser default</option>
          {devices.map((device) => <option key={device.deviceId} value={device.deviceId}>{device.label}</option>)}
          {chosen && !devices.some((device) => device.deviceId === chosen) &&
            <option value={chosen}>Your usual microphone (unavailable)</option>}
        </select>
        {active && <small>Changing microphone reconnects the call.</small>}
      </label>}
      {live.playbackBlocked && <div className="chat-live-notice">
        <span>Your browser paused the voice output.</span>{" "}
        <button type="button" onClick={() => void live.enableAudio()}>Enable sound</button>
      </div>}
      {live.error && <p className="chat-live-error" role="alert">{live.error}</p>}
      {blocks && onJump && live.pointers.length > 0 && <PassageLinks
        passages={live.pointers.slice(-1)} blocks={blocks} onJump={onJump}
      />}
      {live.tools.length > 0 && <ul className="chat-live-tools" aria-label="Tools used">
        {live.tools.filter((tool) => tool.name !== "show_passage").map((tool) =>
          <li key={tool.callId}>{tool.label}{tool.detail ? ` — ${tool.detail}` : ""}</li>)}
      </ul>}
      {showTranscript && <section className="chat-live-transcript" ref={transcript} aria-label="Live transcript" aria-live="off"
        onScroll={(e) => {
          const el = e.currentTarget;
          follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
        }}
      >
        {live.hasUnsavedLines && <p className="chat-live-notice">Couldn’t confirm whether these earlier words were saved. They’re kept here for you.</p>}
        {live.lines.length === 0
          ? <p className="chat-live-transcript-empty">Your words and the reply appear here as you speak.</p>
          : live.lines.map((line) => <p key={line.id} className={`chat-live-line ${line.role}`}>
            <strong>{line.role === "reader" ? "You" : "Spideryarn"}</strong>{" "}
            {line.text || "…"}{!line.done && <span aria-hidden="true"> ▍</span>}
          </p>)}
      </section>}
      <div className="chat-live-actions">
        {!active && !switching && live.error && <button type="button" onClick={onRestart}>Retry live</button>}
        <button type="button" disabled={switching} onClick={onType}>Continue typing</button>
        {onDictate && <button type="button" disabled={switching} onClick={onDictate}>Use dictation</button>}
      </div>
    </section>
  );
}
