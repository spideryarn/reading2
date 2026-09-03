/**
 * **Settings** — the part of `/profile` that changes what the app does, rather
 * than what the model knows.
 *
 * One switch today: experimental features, off by default. Greg, 2026-08-31:
 *
 * > when this is off, it shows just the features that are most valuable/polished
 * > (which is what we want for most users). When on, it includes extra features
 * > that might be still under development or not ready for production.
 *
 * What may go behind it, and the rule that a hidden feature stays reachable by
 * its own URL, are in docs/project/experimental-features.md. **Nothing is
 * behind it yet**, deliberately: the switch and the decision about which
 * features are not ready are two separate pieces of work, and doing them in one
 * move means neither gets argued properly.
 *
 * ## A checkbox, and the tooltip beside it rather than around it
 *
 * A checkbox in a `<label>` is what every other boolean in this app is
 * (AccessSharing.tsx, WrittenForYou.tsx, SearchPanel.tsx), and a settings page
 * is the last place to invent a second kind. The tooltip's trigger sits
 * *outside* the label for the reason WrittenForYou.tsx gives: a `<label>` turns
 * every click inside it into a toggle, so an info icon within one is a control
 * that flips the switch when a touch reader taps it to read the explanation.
 */
import { FlaskConical, Info, TriangleAlert } from "lucide-react";

import { ControlTip, Tooltip } from "./Tooltip.js";
import { timeAgo } from "./relative-time.js";
import { useExperimental } from "./useExperimental.js";

/**
 * The two sentences the tooltip exists for.
 *
 * The second is the one a reader cannot work out by pressing it — the rule
 * Tooltip.tsx § `ControlTip` states: what it does they could guess, what it
 * does *not* promise they could not. Here that is the honest warning, which is
 * the whole point of the switch: these are unfinished, and they may be slow,
 * wrong or gone next week.
 */
const WHAT =
  "Show features that are still being built, alongside the ones we think are ready. Off by default.";
const HOW =
  "Nothing here is finished: an experimental feature can be slow, get things wrong, or disappear in the next release. Turning this off hides them from the controls — it never deletes anything, and a link you already have goes on working.";

export function SettingsSection() {
  const experimental = useExperimental();
  /* Read once per render rather than per call: two lines derived from one
     timestamp should not be able to straddle a tick of the clock. */
  const since = timeAgo(experimental.since ?? undefined, Date.now());

  return (
    <div className="tw:flex tw:flex-col tw:gap-1.5">
      <div className="tw:flex tw:items-center tw:gap-2">
        <label className="tw:flex tw:items-center tw:gap-2 tw:text-sm tw:text-foreground">
          <input
            type="checkbox"
            /* The native box, tinted — the whole of what styles.css § the
               search ticks does, and for the reason written there: one
               property, and the browser keeps the tick, the focus ring and
               every keyboard behaviour. An arbitrary-value utility rather than
               a class, because this page is written in `tw:` throughout and a
               one-property rule in the stylesheet would be the only thing on
               `/profile` that is not. */
            className="tw:[accent-color:var(--highlight)]"
            checked={experimental.on}
            /* **Until the server has answered, there is nothing to toggle.** An
               enabled switch drawn from a default would let the reader send
               "off" over an "on" we had not read yet — a setting silently
               reset by looking at the page it lives on. */
            /* …and not while a save is in flight, which is the *visible* half
               of the one-write-at-a-time rule experimental-store.ts enforces:
               two PATCHes racing can leave the switch showing the opposite of
               what is stored. */
            disabled={!experimental.loaded || experimental.saving}
            onChange={(e) => experimental.set(e.target.checked)}
          />
          <FlaskConical size={13} className="tw:text-ink-faint" />
          <span>Experimental features</span>
        </label>
        <Tooltip
          placement="top"
          content={<ControlTip head="Experimental features" what={WHAT} how={HOW} />}
        >
          {/* A button rather than a bare icon: a tooltip nobody can reach with
              the keyboard is a tooltip half the readers do not have. `Tooltip`
              opens on focus as well as hover. */}
          <button
            type="button"
            className="tw:inline-flex tw:items-center tw:text-ink-faint tw:hover:text-foreground"
            aria-label="What experimental features are"
          >
            <Info size={13} />
          </button>
        </Tooltip>
      </div>

      <p className="tw:m-0 tw:text-xs tw:text-ink-faint" aria-live="polite">
        {experimental.loadError ? (
          /* **A load that failed, said as a load that failed.** This line used
             to read "Not saved — …" for it, which is a sentence about a save
             nobody attempted, and it left the reader with nothing to press.
             GPT Sol, 2026-08-31. */
          <span className="tw:inline-flex tw:items-center tw:gap-1 tw:text-highlight">
            <TriangleAlert size={12} /> Couldn't load this setting — {experimental.loadError}{" "}
            <button type="button" className="linky" onClick={experimental.reload}>
              Try again
            </button>
          </span>
        ) : experimental.error ? (
          /* Said out loud, and the switch has already sprung back to where it
             was — see experimental-store.ts. A control that keeps the
             position the reader put it in while the server never heard is the
             failure this line exists to prevent. */
          <span className="tw:inline-flex tw:items-center tw:gap-1 tw:text-highlight">
            <TriangleAlert size={12} /> Not saved — {experimental.error}
          </span>
        ) : experimental.saving ? (
          "Saving…"
        ) : experimental.stale ? (
          /* **What we last knew, and not a switch to press.** `apiFetch` serves
             a saved body when the network is gone, and another device may have
             changed this since. Saying "off" about a copy, next to a live-
             looking control, is how a reader turns something off that was never
             on in front of them. */
          `Offline — this is what we last knew: ${experimental.on ? "on" : "off"}. Reconnect to change it.`
        ) : !experimental.loaded ? (
          "Loading…"
        ) : experimental.on ? (
          /* When, because the column stores when — and this is the line that
             answers "have I been looking at half-built things all this time
             without realising". `timeAgo` says "yesterday" up close and a date
             past a month, so the phrasing has to read correctly for both:
             *turned on yesterday* and *turned on 12 Aug 2026* both do, where
             "since 3 days ago" does not. */
          `On${since ? `, turned on ${since}` : ""}. Unfinished features are shown alongside the rest.`
        ) : (
          "Off. You are seeing the features we think are ready."
        )}
      </p>
    </div>
  );
}
