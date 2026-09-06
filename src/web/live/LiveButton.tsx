/** The shared voice control. Session feedback lives in LiveStatus, beside the composer. */
import { useEffect, useRef, useState } from "react";
import { LoaderCircle, PhoneOff, Radio, X } from "lucide-react";

import type { MicPlacement } from "../../types.js";
import { ControlTip, Tooltip } from "../Tooltip.js";
import { rememberPlacement, rememberedPlacement } from "./mic-placement.js";
import type { LiveApi } from "./useLiveConversation.js";

export function LiveButton({ live, disabled, onStart, labelled, resume }: {
  live: LiveApi;
  disabled?: boolean | undefined;
  onStart(): void;
  labelled?: boolean | undefined;
  resume?: boolean | undefined;
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
  const action = on ? "Hang up" : connecting ? "Cancel" : closing ? "Finishing…" : resume ? "Resume live" : "Start a live conversation";

  return (
    <span className="chat-live">
      <Tooltip placement="top" keepSide className="tip-soon" content={
        <ControlTip head="Talk about the article"
          what="Have a two-way spoken conversation with the article in front of you. You can interrupt the answer."
          how="Your audio goes directly to OpenAI. The words join this same conversation, so you can hang up, type or dictate, then resume."
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
            {on || connecting || closing ? action : resume ? "Resume" : labelled ? "Live conversation" : "Live"}
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
