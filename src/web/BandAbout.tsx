/**
 * **A band's (i): the sentences about the whole list, behind an icon at the
 * end of its order row.** Greg asked for the same move twice — FAQ's promise,
 * 2026-09-30 (SPIDERYARN-READING2-62): *"move this text … into a tooltip, e.g.
 * behind an `(i)` icon"*; and Citations' two notes the same day (`spya-nca765`):
 * *"that could be inside an information icon tooltip"*. It was FAQ's
 * `AboutPassages` until the second band wanted it; one component, so the two
 * look and behave alike. Plan 261001l.
 *
 * Controlled, as Trajectory's *About this route* is, so a tap toggles it on a
 * touch device with no hover; hover and focus open it too.
 */
import { type ReactNode, useState } from "react";
import { Info } from "lucide-react";
import { Tooltip } from "./Tooltip.js";

export function BandAbout({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Tooltip content={children} placement="bottom" open={open} onOpenChange={setOpen} className="band-about-card">
      <button
        type="button"
        className={`band-about${open ? " on" : ""}`}
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
      >
        <Info size={14} />
      </button>
    </Tooltip>
  );
}
