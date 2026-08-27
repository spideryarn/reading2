/**
 * **Which microphone.**
 *
 * This file exists because of a measurement rather than a design idea. On
 * 2026-08-27 Greg pressed the dictate button and nothing happened — twice, with
 * a working recogniser and a working level meter in between. What
 * `getUserMedia({ audio: true })` handed the page was:
 *
 * ```
 * "Microsoft Teams Audio Device (Virtual)"   readyState=live   muted=false
 * ```
 *
 * A conferencing loopback. Every sample it produced was exactly `0.0` — not a
 * quiet room, which measures −70 to −51 dBFS, but **digital silence**. The
 * recogniser transcribed nothing because there was nothing, and the meter drew
 * a flat line because the line was flat. Both were correct and neither was any
 * use, because nothing on the page said *which* microphone had produced that
 * zero. See docs/plans/microphone-device-and-recording.md for the numbers.
 *
 * So: name the device, and let the reader pick a different one.
 *
 * ## What this deliberately does not do
 *
 * **It does not guess.** No preferring `'default'`, no skipping devices whose
 * label matches `/virtual|teams|zoom/i`. Both would override a choice the
 * reader made in their browser's own settings on the strength of an assumption
 * about what they meant, and both are wrong for anybody who genuinely dictates
 * through a conferencing device. We say what we opened and offer the list; the
 * decision stays theirs.
 *
 * ## The two things that fail quietly
 *
 * 1. **Labels are empty strings until microphone permission is granted.** A
 *    picker built before the first `getUserMedia` is a list of blanks, so the
 *    caller must only offer it once there is a live track — see `labelled`.
 * 2. **A remembered `deviceId` can stop resolving** — the headset is unplugged,
 *    or the reader cleared site data and the ids rotated. An `exact` constraint
 *    then rejects rather than falling back, so the caller must catch and retry
 *    plain. A stored preference must never be a way for dictation to break.
 */

/** One audio input, as the reader would recognise it. */
export interface MicDevice {
  deviceId: string;
  label: string;
}

/**
 * Where the choice is kept.
 *
 * `localStorage` rather than the profile row on the server: this is a property
 * of *this machine's* hardware, not of the reader, and syncing it to a second
 * device would push a preference for a microphone that is not plugged into it.
 */
const KEY = "spya.dictation.deviceId";

/**
 * The remembered device, or null for "whatever the browser thinks is default".
 *
 * Every access is wrapped: `localStorage` throws outright in Safari's private
 * mode and wherever site data is blocked, and a microphone preference is not
 * worth taking a page down for.
 */
export function rememberedDevice(): string | null {
  try {
    const v = window.localStorage.getItem(KEY);
    return v && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

/** Remember a choice, or forget it when passed null. */
export function rememberDevice(deviceId: string | null): void {
  try {
    if (deviceId) window.localStorage.setItem(KEY, deviceId);
    else window.localStorage.removeItem(KEY);
  } catch {
    /* See `rememberedDevice`. The choice simply will not survive the reload. */
  }
}

/**
 * The constraint for a press.
 *
 * `exact` rather than `ideal` on purpose. `ideal` silently substitutes another
 * device when the named one is missing, which is precisely the class of
 * quiet-wrong-device failure this whole file is a response to; `exact` rejects
 * with `OverconstrainedError` and lets the caller decide out loud.
 */
export function audioConstraint(preferred: string | null): MediaStreamConstraints {
  return preferred ? { audio: { deviceId: { exact: preferred } } } : { audio: true };
}

/**
 * The audio inputs, with usable names.
 *
 * Filtered to entries that actually have a label, because an unlabelled row is
 * a row the reader cannot choose between — see failure 1 above. Returns an
 * empty list rather than throwing on any browser without `enumerateDevices`.
 */
export async function listInputs(): Promise<MicDevice[]> {
  try {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const all = await navigator.mediaDevices.enumerateDevices();
    return all
      .filter((d) => d.kind === "audioinput" && d.label !== "" && d.deviceId !== "")
      .map((d) => ({ deviceId: d.deviceId, label: d.label }));
  } catch {
    return [];
  }
}

/**
 * What to call the device on screen.
 *
 * `track.label` is the browser's own name for it and is exactly the string the
 * reader will see in their system's sound settings, which is what makes it
 * worth quoting verbatim rather than tidying. Null when the browser declines to
 * name it, in which case the caller says nothing rather than inventing a name.
 */
export function labelled(track: MediaStreamTrack | null): string | null {
  const label = track?.label?.trim();
  return label ? label : null;
}
