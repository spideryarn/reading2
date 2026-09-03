/**
 * **What the experimental-features switch is, in two sentences, in one place.**
 *
 * There are two switches for one setting now — the checkbox on `/profile`
 * (SettingsSection.tsx) and the button at the end of the bottom bar
 * (Dock.tsx § the switch itself). They explain the same thing, so they say it
 * with the same words: a reader who reads one and then the other must not be
 * told two subtly different stories about what they turned on.
 *
 * **Not in src/messages.ts**, which the plan for this work named as the home and
 * was wrong about: that file is the reader-facing *failure* copy and says so in
 * its first line — every sentence there exists because a call failed, and
 * `FailureKind` decides what the reader should do about it. This is a
 * description of a control that is working. docs/project/copy.md is about that
 * file, not about this one.
 *
 * The split into two is `ControlTip`'s (Tooltip.tsx): **what it does** the
 * reader could guess by pressing it, and **what it does not promise** they could
 * not — and here the second is the whole point of the switch.
 */

/** What turning it on does. */
export const EXPERIMENTAL_WHAT =
  "Show features that are still being built, alongside the ones we think are ready. Off by default.";

/** What it does not promise — the honest warning, which is why the switch exists. */
export const EXPERIMENTAL_HOW =
  "Nothing here is finished: an experimental feature can be slow, get things wrong, or disappear in the next release. Turning this off hides them from the controls — it never deletes anything, and a link you already have goes on working.";

/** The name both controls carry, so they cannot drift apart either. */
export const EXPERIMENTAL_NAME = "Experimental features";

/**
 * **What we last knew, and not a value to move.** `apiFetch` serves a saved body
 * when the network is gone, and another device may have moved this since — so
 * saying "off" about a copy, next to a live-looking control, is how a reader
 * turns off something that was never on in front of them.
 *
 * **It ends without a call to action on purpose**: both controls offer a *check
 * again*, in the shape each of them has — a button beside the line on
 * `/profile`, and the press itself in the bar — and the sentence would be wrong
 * for one of them if it named either. It said *"Reconnect to change it"* until
 * 2026-09-03, which was a dead end: `offline.ts` listens for going offline and
 * not for coming back, so nothing ever asked again on the reader's behalf.
 */
export const experimentalOffline = (on: boolean) =>
  `Offline — this is what we last knew: ${on ? "on" : "off"}.`;

/**
 * On, and **when** where there is room to say it.
 *
 * `since` is the line that answers *have I been looking at half-built things all
 * this time without realising*, and only `/profile` has room for it — the bar
 * passes `null`. `timeAgo` says "yesterday" up close and a date past a month, so
 * the phrasing has to read correctly for both: *turned on yesterday* and *turned
 * on 12 Aug 2026* both do, where "since 3 days ago" does not.
 */
export const experimentalIsOn = (since: string | null) =>
  `On${since ? `, turned on ${since}` : ""}. Unfinished features are shown alongside the rest.`;

/** Off, said as a reassurance rather than as an absence. */
export const EXPERIMENTAL_IS_OFF = "Off. You are seeing the features we think are ready.";
