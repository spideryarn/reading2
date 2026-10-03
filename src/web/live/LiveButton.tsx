/**
 * The shared voice control: one button, Live / Cancel / Hang up. Session
 * feedback, and the microphone and noise-reduction settings, live in
 * LiveStatus, beside the composer (docs/plans/261002j-live-voice-chat-cleanup.md
 * § 1d).
 */
import { LoaderCircle, PhoneOff, Radio, X } from "lucide-react";

import { ControlTip, Tooltip } from "../Tooltip.js";
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
    </span>
  );
}
