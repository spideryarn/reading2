/**
 * The shared voice control: one button, Live / Cancel / Hang up. Session
 * feedback, and the microphone and noise-reduction settings, live in
 * LiveStatus, beside the composer (docs/plans/261002j-live-voice-chat-cleanup.md
 * § 1d).
 *
 * **One exception, and only with Experimental features on: the voice-engine
 * choice** (plan 261003a), as a small arrow joined to the right of the Live
 * button (plan 261010a; Greg, spya-t858ug: *"a little drop down arrow to the
 * right of the live button"*, where it had been a select beside it). It is here
 * rather than under LiveStatus's Advanced because that panel exists only during
 * and after a call, and the engine is chosen before one and pinned for the
 * whole of it.
 */
import { Check, ChevronDown, LoaderCircle, PhoneOff, Radio, X } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { useEffect, useRef, useState } from "react";

import type { LiveEngine } from "../../types.js";
import { MENU_ITEM, MENU_SURFACE, useFingerPressMenu } from "../menu.js";
import { ControlTip, Tooltip } from "../Tooltip.js";
import { useExperimental } from "../useExperimental.js";
import { ENGINE_COPY, ENGINE_ORDER, effectiveEngine, parseEngine, rememberEngine, useEnginePreference } from "./engine.js";
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
  /* **Which engine the next call uses**, offered only while Experimental
     features are on. With the switch off there is no choice and the engine is
     GPT-Live, every reader's. ./engine.ts, ./useLive.ts. */
  const experimental = useExperimental();
  const engine = effectiveEngine(useEnginePreference(), experimental.on);
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
          className={`chat-live-btn${experimental.on ? " split" : ""}${on ? " on" : ""}${connecting || closing ? " opening" : ""}`}
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
      {experimental.on && <EngineArrow engine={engine} busy={on || connecting || closing} />}
    </span>
  );
}

/**
 * **The engine menu, opened from an arrow joined to the Live button.**
 *
 * The house's Radix menu (`../menu.ts`, shared with the shelf's "⋯" and the
 * bar's More): its surface, its finger-sized items, and a finger opening it at
 * the click rather than the press. Two radio items, the default first.
 *
 * **Disabled for the whole of a call**: the engine is pinned to the call, and a
 * control that could be changed mid-call would say otherwise. **Its keys stop
 * here**, as the select's did, so a letter pressed while choosing is not also
 * one of the reading view's single-key shortcuts. The menu is portalled out of
 * this subtree, so its content stops them too.
 */
function EngineArrow({ engine, busy }: { engine: LiveEngine; busy: boolean }) {
  const [open, setOpen] = useState(false);
  const changeOpen = (next: boolean) => {
    if (!busy) setOpen(next);
  };
  const finger = useFingerPressMenu(open, changeOpen);
  /* A call can begin somewhere other than this trigger while its non-modal menu
     is open. Busy means the choice is closed as well as the button disabled. */
  useEffect(() => {
    if (busy) setOpen(false);
  }, [busy]);
  /** Keyboard picks return here; pointer picks leave the reading keys to the page. */
  const pickedByPointer = useRef(false);
  const stopKeys = (e: { stopPropagation(): void }) => e.stopPropagation();
  return (
    <DropdownMenu.Root open={open} onOpenChange={changeOpen} modal={false}>
      <Tooltip placement="top" keepSide className="tip-soon" enabled={!open} content={
        <ControlTip head="Voice engine"
          what={`${ENGINE_COPY["gpt-live"].label}: ${ENGINE_COPY["gpt-live"].tip.toLowerCase()}.`}
          how={`${ENGINE_COPY.realtime.label}: ${ENGINE_COPY.realtime.tip.toLowerCase()}.`}
          state={busy ? "Hang up to change it." : `Next call: ${ENGINE_COPY[engine].label}.`}
        />
      }>
        <DropdownMenu.Trigger asChild {...finger}>
          <button type="button" className="chat-live-arrow" disabled={busy}
            aria-label={`Voice engine: ${ENGINE_COPY[engine].label}`}
            onKeyDown={stopKeys}
          >
            <ChevronDown size={14} aria-hidden="true" />
          </button>
        </DropdownMenu.Trigger>
      </Tooltip>
      <DropdownMenu.Portal>
        <DropdownMenu.Content side="top" align="end" sideOffset={6} collisionPadding={10}
          onKeyDown={stopKeys}
          onCloseAutoFocus={(e) => {
            if (!pickedByPointer.current) return;
            pickedByPointer.current = false;
            e.preventDefault();
          }}
          className={`chat-live-engine-menu ${MENU_SURFACE} tw:min-w-[13rem] tw:max-w-[min(20rem,calc(100vw-1.75rem))]`}
        >
          <DropdownMenu.RadioGroup value={engine}
            onValueChange={(value) => {
              const next = parseEngine(value);
              if (next) rememberEngine(next);
            }}
          >
            {ENGINE_ORDER.map((name) => (
              <DropdownMenu.RadioItem key={name} value={name} className={MENU_ITEM}
                onClick={(e) => {
                  pickedByPointer.current = e.detail > 0;
                }}
              >
                <span className="tw:flex tw:min-w-0 tw:flex-1 tw:flex-col">
                  <span>{ENGINE_COPY[name].label}</span>
                  <span className="tw:text-xs tw:text-muted-foreground">{ENGINE_COPY[name].tip}</span>
                </span>
                <DropdownMenu.ItemIndicator>
                  <Check size={14} aria-hidden="true" className="tw:shrink-0 tw:text-highlight-text" />
                </DropdownMenu.ItemIndicator>
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
