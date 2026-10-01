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
 * zero. See docs/plans/260827k-microphone-device-and-recording.md for the numbers.
 *
 * So: name the device, and let the reader pick a different one.
 *
 * ## What this deliberately does not do
 *
 * **It does not guess.** No skipping devices whose label matches
 * `/virtual|teams|zoom/i`: that is wrong for anybody who genuinely dictates
 * through a conferencing device. We say what we opened and offer the list; the
 * decision stays theirs.
 *
 * **It does follow the system default, by name, on Chromium** — see
 * `audioConstraint`. That used to be on this list too, as overriding a choice
 * made in the browser's own settings. Greg's own Mac is why it moved: twice the
 * browser's choice was not the input macOS was set to (the Teams loopback
 * above, and his webcam in spya-g8byyd), and what he asked for was the system
 * default. A different microphone is still one pick away, in our picker.
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

/**
 * The browser's name for the remembered device, kept beside its id.
 *
 * **Because an id does not always resolve when the device is still there.** On
 * an iPhone with AirPods, every press said *"The microphone you chose isn't
 * available"* and then dictated perfectly well (spya-k3q9mc, Greg,
 * 2026-09-29). Why the id went stale was not established — an audio route
 * change and WebKit's own choice of default input both fit — but the name is
 * what `judgeFallback` compares to tell that case from a headset that really
 * has gone. Written only once a track from that exact id has opened, so it is
 * the name of what was opened, not a guess from a list.
 */
const LABEL_KEY = "spya.dictation.deviceLabel";

export function rememberedDeviceLabel(): string | null {
  try {
    const v = window.localStorage.getItem(LABEL_KEY);
    return v && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

export function rememberDeviceLabel(label: string | null): void {
  try {
    if (label) window.localStorage.setItem(LABEL_KEY, label);
    else window.localStorage.removeItem(LABEL_KEY);
  } catch {
    /* See `rememberedDevice`. */
  }
}

/**
 * Remember a choice, or forget it when passed null.
 *
 * A different id drops the remembered name: until the new device has opened,
 * the old name would vouch for a microphone it does not describe.
 */
export function rememberDevice(deviceId: string | null): void {
  if (deviceId !== rememberedDevice()) rememberDeviceLabel(null);
  try {
    if (deviceId) window.localStorage.setItem(KEY, deviceId);
    else window.localStorage.removeItem(KEY);
  } catch {
    /* See `rememberedDevice`. The choice simply will not survive the reload. */
  }
}

/**
 * The remembered device would not open by id, and the browser's default did.
 * Was that default the chosen microphone after all?
 *
 * - **`same-device`** — exactly one input on the machine carries the
 *   remembered name, and it is the one that opened. The chosen microphone
 *   under a new id: no warning, and the caller adopts the id.
 * - **`forget`** — the choice was stored before names were kept, so there is
 *   nothing to compare against. Warned about once, then dropped, because
 *   warning on every press for ever is the bug this exists to end.
 * - **`different`** — anything else, and the reader is told which one they
 *   had chosen.
 *
 * **A name alone is not identity** — labels are descriptive and need not be
 * unique (two "USB Audio Device"s), so a match must be unique among the inputs
 * and agree with the opened track's own id. Anything less warns, which is the
 * safe way round: the cost of a needless warning is a sentence, and the cost of
 * a wrongly silent one is a dictation from a microphone nobody chose. GPT Sol's
 * plan review, 2026-10-01, item 4.
 */
export type FallbackVerdict =
  | { kind: "same-device"; id: string }
  | { kind: "forget" }
  | { kind: "different"; wanted: string };

export function judgeFallback(
  rememberedLabel: string | null,
  opened: { label: string | null; id: string | null },
  inputs: MicDevice[],
): FallbackVerdict {
  if (rememberedLabel === null) return { kind: "forget" };
  const named = inputs.filter((d) => d.label === rememberedLabel);
  const only = named.length === 1 ? named[0] : undefined;
  if (only && opened.id !== null && only.deviceId === opened.id && opened.label === rememberedLabel) {
    return { kind: "same-device", id: opened.id };
  }
  return { kind: "different", wanted: rememberedLabel };
}

/**
 * The constraint for a press.
 *
 * `exact` rather than `ideal` on purpose. `ideal` silently substitutes another
 * device when the named one is missing, which is precisely the class of
 * quiet-wrong-device failure this whole file is a response to; `exact` rejects
 * with `OverconstrainedError` and lets the caller decide out loud.
 *
 * **With no pick, the system default — asked for by name where there is one.**
 * Chromium lists a virtual input whose id is `"default"` and which follows the
 * operating system's input. `{ audio: true }` does *not*: it opens Chromium's
 * own choice, from its microphone setting or the device chooser in its
 * permission prompt, and that can be a different device for as long as nobody
 * looks (spya-g8byyd). Measured on Chrome with fake devices, with Chrome's
 * default microphone set to "Fake Audio Input 1": `{ audio: true }` and
 * `{ deviceId: { ideal: "default" } }` both opened Input 1, and only `exact`
 * opened the default (plan 261001q). Safari and Firefox list no such id, and
 * there unconstrained capture is already the system microphone.
 *
 * `"default"` is Chromium's convention, not the standard's, which is why it is
 * asked for only when the browser has listed it.
 */
export function audioConstraint(preferred: string | null, defaultListed = false): MediaStreamConstraints {
  if (preferred) return { audio: { deviceId: { exact: preferred } } };
  return defaultListed ? { audio: { deviceId: { exact: "default" } } } : { audio: true };
}

/**
 * Whether the browser lists an input with the id `"default"` — Chromium's
 * system-default input, for `audioConstraint`.
 *
 * Read off the unfiltered list, because the label does not matter here. Before
 * the page has ever been granted the microphone, Chromium hides every id, so
 * the very first press asks plainly and every press after it by name. False on
 * any browser without `enumerateDevices`, or that throws from it.
 */
export async function defaultInputListed(): Promise<boolean> {
  try {
    if (!navigator.mediaDevices?.enumerateDevices) return false;
    const all = await navigator.mediaDevices.enumerateDevices();
    return all.some((d) => d.kind === "audioinput" && d.deviceId === "default");
  } catch {
    return false;
  }
}

/**
 * Whether a `getUserMedia` rejection means "that device is not there" — the
 * one failure that earns a second, unconstrained attempt.
 *
 * Read off the object rather than through `instanceof`: `OverconstrainedError`
 * is its own interface and is **not** reliably an `Error` or a `DOMException`,
 * and the check that assumed otherwise silently never fell back at all.
 */
export function deviceMissing(err: unknown): boolean {
  const name = (err as { name?: unknown } | null)?.name;
  return name === "OverconstrainedError" || name === "NotFoundError";
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
export function openedId(track: MediaStreamTrack): string | null {
  try {
    const id = typeof track.getSettings === "function" ? track.getSettings().deviceId : undefined;
    return id ? id : null;
  } catch {
    return null;
  }
}

/**
 * What to call the device on screen. (Its id, for re-remembering a device
 * whose old id stopped resolving, is `openedId` above.)
 */
export function labelled(track: MediaStreamTrack | null): string | null {
  const label = track?.label?.trim();
  return label ? label : null;
}
