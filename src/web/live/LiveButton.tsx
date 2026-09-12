/** The shared voice control. Session feedback lives in LiveStatus, beside the composer. */
import { useEffect, useRef, useState } from "react";
import { LoaderCircle, PhoneOff, Radio, X } from "lucide-react";

import type { MicPlacement } from "../../types.js";
import { ControlTip, Tooltip } from "../Tooltip.js";
import { rememberPlacement, rememberedPlacement } from "./mic-placement.js";
import type { LiveApi } from "./useLiveConversation.js";

export function LiveButton({ live, disabled, onStart, labelled, continues }: {
  live: LiveApi;
  disabled?: boolean | undefined;
  onStart(): void;
  labelled?: boolean | undefined;
  /**
   * The open thread already has messages, so the click carries it on out loud
   * rather than beginning one. **Not "has been live before"**: chat messages do
   * not record their input mode, and this prop does not consult the separate
   * realtime-session journal or its linked usage rows. The visible label is
   * therefore "Live" either way and never "Resume": beside a typed thread,
   * "Resume" read as picking up a call the reader never made
   * (SPIDERYARN-READING2-3G). The difference is said in the accessible name and
   * the tooltip, where there is room for a sentence.
   */
  continues?: boolean | undefined;
}) {
  const [chosen, setChosen] = useState<MicPlacement | null>(() => rememberedPlacement());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const connecting = live.phase === "connecting";
  const on = live.phase === "live";
  const closing = live.phase === "closing";
  const action = on ? "Hang up" : connecting ? "Cancel" : closing ? "Finishing…"
    : continues ? "Continue this conversation live" : "Start a live conversation";

  return (
    <span className="chat-live">
      <Tooltip placement="top" keepSide className="tip-soon" content={
        <ControlTip head="Talk about the article"
          state={on || connecting || closing ? undefined
            : continues ? "Continues this conversation out loud, with its recent completed turns."
            : "Starts a new conversation, out loud."}
          what="Have a two-way spoken conversation with the article in front of you. You can interrupt the answer."
          how="Your audio goes directly to OpenAI. The words join this same conversation, so you can hang up, type or dictate, then press Live again."
        />
      }>
        <button type="button"
          className={`chat-live-btn${on ? " on" : ""}${connecting || closing ? " opening" : ""}`}
          aria-label={action}
          disabled={closing || (disabled && !on && !connecting)}
          onClick={() => { if (on || connecting) void live.stop(); else onStart(); }}
        >
          {closing ? <LoaderCircle className="cmt-spinner" size={14} />
            : connecting ? <X size={14} /> : on ? <PhoneOff size={14} /> : <Radio size={14} />}
          <span className="chat-live-label" aria-hidden="true">
            {on || connecting || closing ? action : labelled ? "Live conversation" : "Live"}
          </span>
        </button>
      </Tooltip>
      <Tooltip placement="top" keepSide className="tip-soon" content={
        <ControlTip head="Microphone setup"
          what="Auto estimates whether your microphone is close to your mouth or across the room."
          how="Choose Headphones or Laptop mic to set noise reduction yourself. Changing this during a call saves the turn and reconnects."
          state={live.placement ? `Using ${live.placement.placement === "headset" ? "headphone" : "laptop"} noise reduction.` : undefined}
        />
      }>
        <label className="chat-live-mic">
          <span className="sr-only">Microphone setup</span>
          <select value={chosen ?? "auto"} disabled={connecting || closing}
            onKeyDown={(e) => e.stopPropagation()}
            onChange={(e) => {
              const next = e.target.value === "auto" ? null : e.target.value as MicPlacement;
              setChosen(next);
              rememberPlacement(next);
              if (on) void live.stop().then(() => { if (mounted.current) onStart(); });
            }}
          >
            <option value="auto">Auto</option>
            <option value="headset">Headphones</option>
            <option value="laptop">Laptop mic</option>
          </select>
        </label>
      </Tooltip>
    </span>
  );
}
