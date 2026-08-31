/**
 * **The button that starts a live conversation, and the one control beside it.**
 *
 * It sits next to `DictationButton` in the composer, and the two are
 * deliberately different things rather than two modes of one control: dictation
 * turns speech into text in the box, and this holds a conversation. Pressing
 * either while the other is running politely ends it — `mic-lock.ts` arbitrates
 * that, because WebKit supports one microphone source at a time.
 *
 * ## The dropdown, and why it is not a checkbox
 *
 * `session.audio.input.noise_reduction` takes `near_field` or `far_field` and
 * runs *before* the voice-activity detector, so it decides how often a room is
 * treated as somebody talking. The first thing Greg noticed about live
 * conversation was the companion answering a question he had not asked during a
 * pause with background noise.
 *
 * So there are three states, not two: headset, laptop, and **"work it out"** —
 * which is a real answer and the default. It says what it guessed and what it
 * guessed *from*, because a control that silently disagrees with the reader is
 * worse than no control: nothing on screen would say it had been ignored.
 * `mic-placement.ts` has the guessing and the rule that an explicit choice is
 * never re-guessed.
 *
 * ## Why it is disabled while connected
 *
 * The value is baked into the session at mint time. It could be changed later
 * with `session.update` and that is the refinement if a reader ever needs it
 * mid-conversation, but until then a control that appears to work and changes
 * nothing is worse than one that is plainly unavailable.
 */
import { useState } from "react";
import { LoaderCircle, Radio } from "lucide-react";

import type { MicPlacement } from "../../types.js";
import { PLACEMENT_LABEL, rememberPlacement, rememberedPlacement } from "./mic-placement.js";
import type { LiveApi } from "./useLiveConversation.js";

export function LiveButton({
  live,
  disabled,
  onStart,
  labelled,
}: {
  live: LiveApi;
  disabled?: boolean | undefined;
  /** Press to begin. The panel supplies the conversation. */
  onStart(): void;
  /**
   * Show the word beside the icon even when nothing is running.
   *
   * Review's composer is full-width and Greg asked for talking to be
   * emphasised there; chat's is about 400px and already holds a textarea, Send
   * and the dictation microphone. **A prop rather than a CSS rule**, because
   * the label is conditionally *rendered* — a `.review .chat-live-label`
   * selector would have styled an element that is not there, which is the kind
   * of rule that looks like it works and does nothing.
   */
  labelled?: boolean | undefined;
}) {
  /* `null` means "let it work it out", which is a third option rather than an
     absent value — so a select with three entries, not a checkbox. */
  const [chosen, setChosen] = useState<MicPlacement | null>(() => rememberedPlacement());
  const connecting = live.phase === "connecting";
  const on = live.phase === "live";
  const closing = live.phase === "closing";

  return (
    <span className="chat-live">
      <button
        type="button"
        className={`chat-live-btn${on ? " on" : ""}${connecting || closing ? " opening" : ""}`}
        /* **`aria-label` rather than a `title`**, and no `title` at all: with an
           `aria-label` present an unused `title` becomes the accessible
           description, so the slot is already spoken for. Same rule as
           `DictationButton`. */
        aria-label={
          on
            ? "End the live conversation"
            : connecting
              ? "Starting a live conversation"
              : "Start a live conversation"
        }
        aria-pressed={on}
        /* Disabled through the hang-up, which is not instant: it holds the
           channel open for a moment so the last thing said can be written down.
           A button that could be pressed again in that window would start a
           session against a conversation whose tail is about to move. */
        disabled={disabled || connecting || closing}
        onClick={() => {
          if (on) void live.stop();
          else onStart();
        }}
      >
        {connecting || closing ? (
          <LoaderCircle className="cmt-spinner" size={14} />
        ) : (
          <Radio size={14} />
        )}
      </button>
      {/* **The word only once there is something to say with it.** A chat
          composer is about 400px wide and already holds a textarea, Send, the
          dictation microphone and now this; a permanent "Live" label is width
          spent on a button whose icon and `aria-label` already say what it is.
          While the session is running the label is not decoration — it is the
          one place "listening" and "speaking" are said in words rather than in
          colour. Review mode shows it throughout, because that composer is
          full-width and Greg asked for talking to be emphasised there. */}
      {(on || labelled) && (
        <span className="chat-live-label" aria-hidden="true">
          {on ? (live.hearing ? "Listening…" : live.speaking ? "Speaking…" : "Live") : "Live"}
        </span>
      )}

      <label className="chat-live-mic">
        <span className="sr-only">Where your microphone is</span>
        <select
          value={chosen ?? "auto"}
          disabled={on || connecting || closing}
          /* Its own `onKeyDown` stop, for the reason the textarea beside it has
             one: this form sits inside the reading view, whose ↑/↓ navigation
             listens on the window and would scroll the article while the reader
             was choosing. */
          onKeyDown={(e) => e.stopPropagation()}
          onChange={(e) => {
            const next = e.target.value === "auto" ? null : (e.target.value as MicPlacement);
            setChosen(next);
            /* Remembered on this machine, because it is a fact about this
               hardware rather than about the reader — see `mic-placement.ts`. */
            rememberPlacement(next);
          }}
          title={describe(live)}
        >
          {/* Short, because the space is a chat composer's. What each one
              means is in the `sr-only` label above and in the `title`, which is
              also where the guess is reported — see `describe`. */}
          <option value="auto">Auto</option>
          <option value="headset">{PLACEMENT_LABEL.headset}</option>
          <option value="laptop">{PLACEMENT_LABEL.laptop}</option>
        </select>
      </label>
    </span>
  );
}

/**
 * What the session actually decided, and what from.
 *
 * Reported rather than assumed, because the reader can only judge a guess they
 * can see. `null` before the first connection: `enumerateDevices` returns blank
 * labels until the microphone permission has been granted once for this origin,
 * so there is genuinely nothing to say yet.
 */
function describe(live: LiveApi): string {
  const where = live.placement;
  if (!where) return "Where your microphone is. Noise reduction is set from this.";
  const what = PLACEMENT_LABEL[where.placement];
  if (where.from === "chosen") return `Using ${what} — your choice.`;
  if (where.from === "guessed") return `Guessed ${what} from “${where.label ?? ""}”.`;
  return `Assumed ${what} — the browser would not name the device.`;
}
