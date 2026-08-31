/**
 * One line, once, telling an iPhone reader how to get the browser out of the way.
 *
 * Sits directly above the dock, on the article's pages, and never comes back
 * once dismissed. The decision of whether to show it at all is
 * `install-hint.ts`; everything here is the strip.
 *
 * **The environment is read once, on mount, and not watched.** Every one of the
 * four facts either cannot change during a visit (the platform) or, if it did,
 * would mean the reader had just installed the app — in which case they are in a
 * new window and this component mounts again anyway. A `matchMedia` listener
 * here would be machinery for a case that cannot arrive.
 *
 * docs/plans/260828av-mobile-screen-real-estate.md § 1.
 */
import { useState } from "react";
import { Share, X } from "lucide-react";
import { readEnvironment, rememberDismissed, shouldOfferInstall } from "./install-hint.js";

export function InstallHint() {
  /* Lazy initialiser rather than an effect: `readEnvironment` touches
     `localStorage` and `matchMedia`, and running it in render on every update
     would ask the same unchanging questions of the browser dozens of times a
     scroll. The lazy form runs it exactly once per mount. */
  const [show, setShow] = useState(() => shouldOfferInstall(readEnvironment()));
  if (!show) return null;

  return (
    /* `role="note"` rather than `status` or `alert`: nothing has happened, and a
       live region would interrupt a screen-reader user mid-sentence to tell
       them about a visual affordance they are not using. It is announced when
       they reach it, like any other text. */
    <div className="install-hint" role="note">
      <p className="install-hint-text">
        {/* The icon is named in the sentence as well as drawn, because the
            reader has to find the real one in a toolbar we do not control and
            "the share button" is what it is called there. Decorative here, so
            it is hidden from the reading order. */}
        Add Spideryarn to your Home Screen for the whole screen — tap{" "}
        <Share size={13} aria-hidden="true" className="install-hint-icon" /> Share, then{" "}
        <b>Add to Home Screen</b>.
      </p>
      <button
        type="button"
        className="install-hint-close"
        onClick={() => {
          rememberDismissed();
          setShow(false);
        }}
        title="Don't show this again"
        aria-label="Dismiss"
      >
        <X size={14} />
      </button>
    </div>
  );
}
