/**
 * **"↩ back to ⟨mode⟩"** — the way back into a band that stepped aside.
 *
 * On a phone a mode's band lies over the whole article, so a passage link
 * tapped inside it steps the band aside to show the paragraph (Reader.tsx §
 * `bandJump`). Greg, 2026-09-29: *"close the panel on link tap on phone for all
 * modes"*, with a clear way back — this pill is that way back. Pressing it
 * brings the band back exactly as it was left; nothing in it was unmounted.
 *
 * It stands where `ReturnChip`'s *back to ⟨section⟩* stands and wears its
 * classes, so the strip above the Dock makes room for it the same way
 * (dock.css § `--return-chip-h`). Reader draws one or the other, never both:
 * while the band is away, "back" means the band.
 *
 * **No ×**, unlike `ReturnChip`: a hidden pill would leave the band away with
 * nothing on screen saying so, and the way back is the promise. GPT Sol, plan
 * review, 2026-09-29. docs/plans/260929g-on-a-phone-a-band-link-closes-the-band.md.
 */
import { useEffect, useRef } from "react";

export function BandBackChip({
  label,
  takeFocus,
  onBack,
}: {
  /** The mode's name as the Dock says it — `MODE_LABEL`. */
  label: string;
  /**
   * Focus was inside the band when it went: take it here, rather than leave it
   * on an element that is no longer drawn. Reader gives it back when the band
   * returns.
   */
  takeFocus: boolean;
  onBack(): void;
}) {
  const button = useRef<HTMLButtonElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: on mount only — the pill appears when the band goes.
  useEffect(() => {
    if (takeFocus) button.current?.focus({ preventScroll: true });
  }, []);
  return (
    <div className="return-chip band-back-chip" role="note">
      <button ref={button} type="button" className="return-chip-go" onClick={onBack}>
        <span aria-hidden="true">↩</span> back to {label}
      </button>
    </div>
  );
}
