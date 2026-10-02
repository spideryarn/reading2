/**
 * One banner on the shelf, on a phone, until dismissed: Spideryarn is better
 * on a bigger screen, and failing that, sideways.
 *
 * > Spideryarn does not work that well on a mobile phone. It works, but because
 * > of the small screen the experience is suboptimal. So I wonder if we should
 * > show some kind of banner to people when they open it on a phone to say that
 * > it's probably best on a larger screen, and failing that, in Landscape mode.
 * >
 * > — Greg, 2026-10-01 (spya-fcbnhq)
 *
 * The sibling of `SmallScreenHint`, and built the same way on purpose — a lazy
 * initialiser, one bit that the × writes, `role="note"`, the same
 * `.small-screen-hint` styles. Who sees it is `small-screen-hint.ts` §
 * `isPhone`, which asks the device rather than the layout.
 * docs/plans/261002b-include-public-chip-on-the-shelf-empty-shelf-help-and-a-phone-banner-on-the-shelf.md § Part C.
 */
import { useState } from "react";
import { X } from "lucide-react";
import {
  readPhone,
  rememberShelfPhoneHintDismissed,
  shouldShowShelfPhoneHint,
} from "./small-screen-hint.js";

export function ShelfPhoneHint() {
  const [phone, setPhone] = useState(readPhone);
  if (!shouldShowShelfPhoneHint(phone)) return null;

  return (
    <div className="small-screen-hint" role="note">
      <p className="small-screen-hint-text">
        <b>Spideryarn works best on a larger screen</b> — a tablet or a computer.
        {/* The landscape advice only where there is a landscape to turn to —
            `SmallScreenHint`'s rule, and its reason: told to rotate a phone
            already sideways, a reader learns we are not looking. **Chosen by
            CSS, not read in render**, so it follows a rotation with nothing to
            subscribe to: this component reads its facts once, and a reader who
            takes the advice would otherwise be left holding it. GPT Sol, plan
            review, 2026-10-02. */}
        <span className="tw:landscape:hidden">
          {" "}
          On a phone, turning it sideways gives the reading view more room.
        </span>
        <span className="tw:portrait:hidden"> On a phone, this way round gives it the most room.</span>
      </p>
      <button
        type="button"
        className="small-screen-hint-close"
        onClick={() => {
          rememberShelfPhoneHintDismissed();
          setPhone((p) => ({ ...p, dismissed: true }));
        }}
        title="Don't show this again"
        aria-label="Dismiss"
      >
        <X size={14} />
      </button>
    </div>
  );
}
