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
 * its own URL, are in docs/project/experimental-features.md. **Some reading
 * modes are behind it**, drawn by the bottom bar only for a reader who turned
 * this on (Dock.tsx § visibleModes). Which ones, and why each is not ready, is
 * that doc's table — named there and not here, because this file has no other
 * reason to know and a copy of the list is a copy that goes stale. **This is no longer the only place the switch can be moved**: the
 * bottom bar draws one too, for a signed-in reader, at the end of the row
 * (Dock.tsx § the switch itself). Both read one store, so they cannot disagree,
 * and both say the same two sentences (experimental-copy.ts). What this page
 * still has and the bar has no room for is *when* it was turned on.
 *
 * **Both controls can be inert, and neither may be a dead end.** Every state
 * below either offers a press that does something or is about to resolve on its
 * own; the offline line is the one that was not, and it is where the bar's own
 * switch found the same hole (Dock.tsx § `PRESS`).
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
/* The two sentences and the name, shared with the bar's own switch. They moved
   out of this file on 2026-09-03 when a second control appeared: what it does,
   and what it does not promise, must read the same in both places. */
import {
  EXPERIMENTAL_HOW,
  EXPERIMENTAL_IS_OFF,
  EXPERIMENTAL_NAME,
  EXPERIMENTAL_WHAT,
  experimentalIsOn,
  experimentalOffline,
} from "./experimental-copy.js";
import { timeAgo } from "./relative-time.js";
import { useExperimental } from "./useExperimental.js";

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
          <span>{EXPERIMENTAL_NAME}</span>
        </label>
        <Tooltip
          placement="top"
          content={
            <ControlTip head={EXPERIMENTAL_NAME} what={EXPERIMENTAL_WHAT} how={EXPERIMENTAL_HOW} />
          }
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
            {/* **Not while a save is in flight**, because `reload()` refuses
                then — a read started mid-save carries the value the row held
                before the `PATCH` and can land after it
                (experimental-store.ts § reload). A button that silently does
                nothing is worse than one that is visibly unavailable, and the
                save is about to deliver the answer anyway.
                Both states at once is reachable: a failed load leaves
                `loadError` set, and the switch is still pressable by keyboard
                or label. docs/reusable/silent-success.md. */}
            {/* **Not `className="linky"`, which styled nothing here** — that
                class is scoped to `.cmt-dialog` / `.chat-dialog` /
                `.annotate-dialog`
                and this page is in none of them, so both buttons in this
                component were plain text in the middle of a sentence. The two
                utilities are all that is left to say: the reset in tailwind.css
                already gives a button its border, background, cursor and font.
                2026-09-04. */}
            <button
              type="button"
              className="tw:p-0 tw:underline tw:underline-offset-2 tw:disabled:no-underline tw:disabled:opacity-60"
              disabled={experimental.saving}
              onClick={experimental.reload}
            >
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
          /* **And a way out of it.** This line was a dead end until 2026-09-03:
             it said "Reconnect to change it" beside a disabled checkbox, and
             nothing anywhere asks again when the network comes back —
             `offline.ts` listens for going offline and not for coming back. So
             the reader sat looking at a cached answer with no way to refresh it
             short of reloading the page. GPT Sol found it in the bar's copy of
             the same state. */
          <span className="tw:inline-flex tw:items-center tw:gap-1">
            {experimentalOffline(experimental.on)}{" "}
            <button
              type="button"
              className="tw:p-0 tw:underline tw:underline-offset-2 tw:disabled:no-underline tw:disabled:opacity-60"
              disabled={experimental.saving}
              onClick={experimental.reload}
            >
              Check again
            </button>
          </span>
        ) : !experimental.loaded ? (
          "Loading…"
        ) : experimental.on ? (
          /* With the date, which is the one thing this page can say and the
             bar's switch cannot. experimental-copy.ts has the phrasing rule. */
          experimentalIsOn(since ?? null)
        ) : (
          EXPERIMENTAL_IS_OFF
        )}
      </p>
    </div>
  );
}
