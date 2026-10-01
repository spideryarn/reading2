/**
 * **A band's (i): the sentences about the whole band, behind an icon in its
 * top-right corner.** Greg asked for the same move three times — FAQ's promise,
 * 2026-09-30 (SPIDERYARN-READING2-62): *"move this text … into a tooltip, e.g.
 * behind an `(i)` icon"*; Citations' two notes the same day (`spya-nca765`):
 * *"that could be inside an information icon tooltip"*; and then every mode,
 * 2026-10-01 (`spya-ucu35y`): *"Move this into a tooltip for a (i) icon in the
 * top-right … Each mode should have such an (i) icon"*.
 *
 * A mode does not render this itself: it hands its card to `ModeSurface`'s
 * `about`, which puts this in the band's corner, the same place in every band.
 * Plans 261001l (the component) and 261001m (the corner); docs/project/mode.md
 * § No description line in the band says what goes in the card.
 *
 * Controlled, as Skim's *About this route* was, so a tap toggles it on a
 * touch device with no hover; hover and focus open it too.
 */
import { type ReactNode, useState } from "react";
import { Info } from "lucide-react";
import { MODE_CATALOG } from "../mode-catalog.js";
import type { Mode } from "../modes.js";
import { exactly, howLong, relativeAgo } from "./relative-time.js";
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

/**
 * **How a mode's contents were made, in one line** — the provenance half of a
 * band's (i): *"Written by claude-sonnet-5 (tweets/5), 1 Oct 2026, 14:03 (3
 * hours ago), in 20.0s."* It was Tweets' foot until Greg moved it, 2026-10-01
 * (spya-ucu35y).
 *
 * Every field is optional because a **visitor's** artefact carries none of them
 * (src/public-types.ts strips them), and with nothing to say it draws nothing
 * rather than "Written by an unknown model". The date is both forms,
 * design-css-overview.md § Dates; `relativeAgo` reads the clock as the card
 * renders, and `Tooltip` renders its content only while open, so the "ago" is
 * as fresh as the moment somebody reads it. A duration it cannot know is left
 * out rather than said as "an unknown time".
 */
export function AboutMade({
  generator,
  version,
  generatedAt,
  elapsedMs,
  verb = "Written",
}: {
  generator?: string | undefined;
  version?: string | undefined;
  generatedAt?: string | undefined;
  elapsedMs?: number | undefined;
  /** The participle the sentence starts with: "Searched" for Debate, "Drawn" for a picture. */
  verb?: string;
}) {
  const exact = exactly(generatedAt);
  const took =
    elapsedMs !== undefined && Number.isFinite(elapsedMs) && elapsedMs >= 0 ? howLong(elapsedMs) : null;
  if (!generator && !exact && !took) return null;
  const ago = relativeAgo(generatedAt, Date.now());
  const when = exact ? `${exact}${ago ? ` (${ago})` : ""}` : null;
  /* "Written by m, 1 Oct…" with a model; "Written 1 Oct…" without one;
     and "Written in 20s" when an old artefact kept only its duration. */
  const head = generator
    ? [`${verb} by ${generator}${version ? ` (${version})` : ""}`, when].filter(Boolean).join(", ")
    : when
      ? `${verb} ${when}`
      : verb;
  const separator = took && !when ? " " : ", ";
  return <p className="band-about-made">{`${head}${took ? `${separator}in ${took}` : ""}.`}</p>;
}

/**
 * **What the mode is, and the part nobody could guess** — the opening of every
 * band's (i), from `MODE_CATALOG`: the same `description` and `how` the
 * Dock's card on the mode's button says (GPT Sol, plan review 261001m: reuse the
 * copy that already exists rather than write a second one per mode).
 */
export function AboutMode({ mode }: { mode: Mode }) {
  const { description, how } = MODE_CATALOG[mode];
  return (
    <>
      <p className="band-about-what">{description}.</p>
      <p>{how}</p>
    </>
  );
}
