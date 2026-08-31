/**
 * **How far the microphone is from the reader's mouth**, which is the only
 * thing OpenAI's noise reduction wants to know.
 *
 * `session.audio.input.noise_reduction` takes exactly two values — `near_field`
 * for a headset or a phone held close, `far_field` for a laptop across a desk
 * or a room mic — and it runs *before* the voice-activity detector, so it
 * decides how often a room gets treated as somebody talking. It is off by
 * default, which is the wrong default for us: the first thing Greg noticed
 * about live conversation was the companion answering a question he had not
 * asked, during a pause with background noise.
 *
 * ## It guesses, and `mic-devices.ts` refuses to — that is not a contradiction
 *
 * That file says, at length, that it **does not guess**: no preferring
 * `'default'`, no skipping a device because its label looks like a conferencing
 * loopback. The reason is that it decides *which microphone to open*, and
 * overriding what somebody chose in their own system settings is not ours to
 * do.
 *
 * This decides how to *filter what that microphone produces*. Nobody chose it,
 * there is no setting to override, and the alternative to a guess is not
 * neutrality — it is `null`, which is a choice too, and measurably the wrong
 * one for a laptop in a room. So: guess from the device's own name, show the
 * reader what was guessed, and let them say otherwise. An explicit choice is
 * never overridden by a later guess.
 *
 * ## The labels are empty until the permission is granted
 *
 * `enumerateDevices()` returns blank labels to a page that has never been given
 * the microphone, so the very first connection on a new origin cannot know what
 * it is listening to. That is why `DEFAULT_PLACEMENT` exists and why it is
 * `laptop`: a built-in microphone is the commonest thing an unknown device
 * turns out to be, and it is the case the reported bug came from. From the
 * second session onwards the label is there and the guess is real.
 */

import type { MicPlacement } from "../../types.js";
import { listInputs } from "../mic-devices.js";

/**
 * Near or far, and **declared in src/types.ts** because the server end needs
 * the same two words — see the note there. Re-exported so this file stays the
 * one import for everything about placement on the client.
 */
export type { MicPlacement };

/**
 * What an unknown device is assumed to be.
 *
 * `laptop` rather than `headset`, and the two failures are not symmetrical.
 * Guessing `laptop` for somebody on a headset over-processes speech that was
 * already clean; guessing `headset` for somebody on a laptop leaves the
 * background-noise problem exactly as it was found. One is a small loss of
 * fidelity, the other is the bug.
 */
export const DEFAULT_PLACEMENT: MicPlacement = "laptop";

/** Where an explicit choice is kept — this machine's hardware, not the reader's. */
const KEY = "spya.live.micPlacement";

/**
 * Words that put a microphone at the reader's face.
 *
 * Matched case-insensitively against the browser's own label for the device,
 * which is the same string the reader sees in their system sound settings.
 * Deliberately a list of things people wear rather than a clever rule: a rule
 * that tried to infer proximity from anything else would be guessing about the
 * guess.
 */
const NEAR = [
  "airpod",
  "headset",
  "headphone",
  "earbud",
  "earphone",
  "buds",
  "beats",
  "jabra",
  "plantronics",
  "poly ",
  "shokz",
  "bose qc",
  "wh-1000",
  "wf-1000",
];

/**
 * Words that put it across a desk or on a wall.
 *
 * `display` earns its place: an external monitor's built-in microphone is the
 * far-field case people least expect, because the reader is looking straight at
 * it and it feels close.
 */
const FAR = [
  "macbook",
  "built-in",
  "internal",
  "imac",
  "display",
  "webcam",
  "camera",
  "monitor",
  "array",
];

/**
 * What this device's name suggests, or `null` when it suggests nothing.
 *
 * **`null` rather than a default**, so the caller can tell "this looks like a
 * headset" apart from "no idea" — they lead to the same `near_field` today and
 * to different sentences on screen, and a function that folded them together
 * would make the UI lie about how much it knows.
 *
 * Near is tested before far on purpose: `"AirPods Pro (Built-in)"` and
 * `"Jabra Link on Display Audio"` are both real shapes, and what somebody is
 * wearing beats what it is plugged into.
 */
export function guessPlacement(label: string | null | undefined): MicPlacement | null {
  const name = (label ?? "").toLowerCase().trim();
  if (name === "") return null;
  if (NEAR.some((w) => name.includes(w))) return "headset";
  if (FAR.some((w) => name.includes(w))) return "laptop";
  return null;
}

/** An explicit choice the reader made here before, if any. */
export function rememberedPlacement(): MicPlacement | null {
  try {
    const v = window.localStorage.getItem(KEY);
    return v === "headset" || v === "laptop" ? v : null;
  } catch {
    /* `localStorage` throws outright in Safari's private mode and wherever site
       data is blocked. A microphone preference is not worth a blank page. */
    return null;
  }
}

/** Remember a choice, or forget it and go back to guessing when passed null. */
export function rememberPlacement(placement: MicPlacement | null): void {
  try {
    if (placement === null) window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, placement);
  } catch {
    /* Same as above. The session still gets the right value this time. */
  }
}

/** What was decided, and how — the second half is what the UI shows. */
export interface ResolvedPlacement {
  placement: MicPlacement;
  /** `chosen` beats `guessed` beats `default`. */
  from: "chosen" | "guessed" | "default";
  /** The device the guess was made from, for the reader to check against. */
  label: string | null;
}

/**
 * The placement to open a session with.
 *
 * **An explicit choice wins and is not re-guessed**, which is the whole reason
 * `from` exists: a reader who has said "headset" while plugged into a display
 * must not have it quietly corrected on the next connection, or the control
 * they were given does nothing and nothing says why.
 */
export async function resolvePlacement(
  preferredDeviceId: string | null = null,
): Promise<ResolvedPlacement> {
  const chosen = rememberedPlacement();
  const label = await currentLabel(preferredDeviceId);
  if (chosen) return { placement: chosen, from: "chosen", label };

  const guessed = guessPlacement(label);
  if (guessed) return { placement: guessed, from: "guessed", label };
  return { placement: DEFAULT_PLACEMENT, from: "default", label };
}

/**
 * The name of the device we are about to open — the reader's preferred one if
 * they have picked one, otherwise the first the browser lists.
 *
 * Reuses `listInputs` rather than calling `enumerateDevices` again, so there is
 * one place that knows how to survive a browser without it. Empty labels are
 * already filtered out there, so an empty list here means "no permission yet"
 * and is not an error.
 */
async function currentLabel(preferredDeviceId: string | null): Promise<string | null> {
  const inputs = await listInputs();
  if (inputs.length === 0) return null;
  const match = preferredDeviceId
    ? inputs.find((d) => d.deviceId === preferredDeviceId)
    : undefined;
  return (match ?? inputs[0])?.label ?? null;
}

/** What to call it on screen. Short, because it sits inside a composer. */
export const PLACEMENT_LABEL: Record<MicPlacement, string> = {
  headset: "Headset",
  laptop: "Laptop",
};
