/**
 * **The key at the foot of every spine card**: what the spine is, and what the
 * colours on it right now mean.
 *
 * > In the tooltip for the Spine, also explain to the user what the Spine
 * > means/how it works/what all the colours etc connote.
 * >
 * > — Greg, 2026-10-19, `spya-ah5ws6`
 *
 * **Only the marks the rail is drawing now**, not the full legend. The full one
 * is nine kinds of mark on a card that cannot scroll (where.ts §
 * `SPINE_LIMITS`), most of them absent at any moment; the question a reader is
 * actually asking is "what is *that* purple?", about something in front of them.
 * The full legend stays on `/help/spine`, and is not even named here: the
 * spine's cards do not take the pointer (Tooltip.tsx), so a link in one could
 * never be clicked, and a line that looks like one costs height on a card that
 * has none to spare (GPT Sol, plan review F6).
 *
 * Each swatch wears the mark's own token, so the key cannot drift from the
 * rail's colours by being restated — styles/tooltip.css § the spine's key.
 * docs/plans/261020e-spine-card-explains-the-spine-and-keys-its-colours.md.
 */

/**
 * What the spine's lane marks are, in the open mode's words: `label` for the
 * key's chip, `one` / `many` for a count of them — the card's footer and each
 * band button's accessible name. reader/passages.ts § `railMarks` picks it.
 */
export interface RailMarks {
  label: string;
  one: string;
  many: string;
}

/** Search's words, which is what the lanes were built for and the default. */
export const SEARCH_RAIL_MARKS: RailMarks = {
  label: "search matches",
  one: "search match",
  many: "search matches",
};

/** For a mode whose slot never reaches the lane — never shown, but total. */
export const GENERIC_RAIL_MARKS: RailMarks = {
  label: "marked passages",
  one: "marked passage",
  many: "marked passages",
};

/** One kind of mark, keyed. `swatch` picks the CSS that draws it like the mark. */
export type SpineKeyItem =
  | { kind: "here" }
  | { kind: "screen" }
  | { kind: "supplement" }
  | { kind: "reading" }
  | { kind: "from" }
  | { kind: "quotes" }
  /** The lane marks, one swatch per lane in that lane's colour (`laneColour`). */
  | { kind: "lanes"; label: string; colours: readonly string[] };

/** What `Spine` already knows about what it is drawing. */
export interface SpineKeyInput {
  supplement: boolean;
  reading: boolean;
  from: boolean;
  quotes: boolean;
  /** Each drawn lane's colour, in lane order; empty when the lane draws nothing. */
  laneColours: readonly string[];
  /** What the lane marks are, in the open mode's words — `railMarksLabel`. */
  marksLabel: string;
}

/**
 * The key's chips, in the rail's own left-to-right, back-to-front order of
 * importance: where you are first, then the optional marks.
 *
 * *you are here* and *on screen* are always drawn while the rail is (the
 * viewport box always; the brighter part always, the section fill when the part
 * has sections), so they are always keyed.
 */
export function spineKeyItems(input: SpineKeyInput): SpineKeyItem[] {
  const items: SpineKeyItem[] = [{ kind: "here" }, { kind: "screen" }];
  if (input.laneColours.length > 0) {
    items.push({ kind: "lanes", label: input.marksLabel, colours: input.laneColours });
  }
  if (input.quotes) items.push({ kind: "quotes" });
  if (input.reading) items.push({ kind: "reading" });
  if (input.from) items.push({ kind: "from" });
  if (input.supplement) items.push({ kind: "supplement" });
  return items;
}

/* `here` is the brighter part and the stronger section fill inside it, which
   the swatch draws at the section fill's strength — the sentence above says
   what the paler tint is. */
const WORDS: Record<Exclude<SpineKeyItem["kind"], "lanes">, string> = {
  here: "where you are",
  screen: "on screen",
  supplement: "notes & references",
  reading: "time spent reading",
  from: "where you jumped from",
  quotes: "quotes",
};

/**
 * The key itself. `aria-hidden`, because the card is each band button's
 * *description* (useRole wires it as `aria-describedby`): unhidden, a screen
 * reader would read the same legend after every one of fifty band names. The
 * facts it carries for a sighted reader are colours, which say nothing aloud.
 */
export function SpineKey({ items }: { items: readonly SpineKeyItem[] }) {
  return (
    <div className="tip-key" aria-hidden="true">
      <p className="tip-key-what">
        The spine is the whole article, top to bottom, to scale: each tinted band a part, each
        hairline a section. Point to read one; click to go there.
      </p>
      <ul className="tip-key-items">
        {items.map((item) => (
          <li key={item.kind} data-key={item.kind}>
            {item.kind === "lanes" ? (
              <>
                {item.colours.map((c, i) => (
                  <span
                    // biome-ignore lint/suspicious/noArrayIndexKey: one swatch per lane, in lane order; the position is the lane.
                    key={i}
                    className="tip-key-swatch tip-key-lanes"
                    style={{ background: `rgb(${c})` }}
                  />
                ))}
                {item.label}
              </>
            ) : (
              <>
                <span className={`tip-key-swatch tip-key-${item.kind}`} />
                {WORDS[item.kind]}
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
