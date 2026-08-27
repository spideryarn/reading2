/**
 * Which colour each saved search wears — the *number*, never the colour.
 *
 * Greg's ask, 2026-08-26: *"assign a categorical colour to each of the Search
 * highlights"*, so that several searches can be switched on at once and a mark
 * in the prose still says which question found it. This file answers only the
 * half of that a stylesheet cannot: **which slot of the palette a given search
 * gets.** The slots themselves — the actual hues, and why those hues — are in
 * `styles/colourscales.css` and docs/project/colour-scales.md.
 *
 * That split is the same one annotate.ts already keeps for the confidence wash
 * and states in one line: *the colour belongs to the design tokens and the
 * confidence belongs to the model.* A module that returned `#4477aa` would put
 * a hex value beyond the reach of the theme, and a palette change would then
 * mean editing TypeScript.
 *
 * ## The reader can override it — 2026-08-27
 *
 * Greg: *"In Search mode, I'd like to be able to change the colour for a given
 * row."* So a run may carry a `colour` of its own (`SearchRun.colour`), and
 * everything below applies to the runs that do not.
 *
 * This reverses a call made on this page a day earlier. Storing the colour was
 * rejected as *"a schema change, a migration, and a server that has an opinion
 * about the palette — for a value that is derived"*, and it is worth being
 * exact about which third of that changed. The schema change and the migration
 * were real and have been paid. The third was never an objection to the field:
 * it was an objection to storing a value nobody had an opinion about, and a
 * colour the reader picked is not derived from anything. **The seam it was
 * really protecting is still intact** — what is stored is a slot *number*, the
 * server never learns what colour it names, and the hues are still one edit in
 * colourscales.css.
 *
 * Two consequences follow, and both are the reason the override is applied
 * before anything else rather than as a special case inside the loop:
 *
 * - **A chosen slot is reserved.** An automatic run may not take a slot some
 *   other run was pinned to, whether that run was created before it or after.
 *   Otherwise pinning search five to slot 3 would depend on whether search two
 *   had already probed its way there.
 * - **Two chosen runs may share a hue.** If the reader pins two searches to the
 *   same colour, they get the same colour. That is an instruction, not a
 *   collision, and a picker that silently moved the second one would be the
 *   panel arguing with the reader.
 *
 * ## What the assignment has to be, and what it cannot be
 *
 * The requirement that shapes everything below is **stability**. A saved search
 * is a thing the reader comes back to — that is the whole reason it is saved
 * (SearchPanel.tsx § Saved) — and a colour that means "this question" is worth
 * nothing if it is a different colour tomorrow. So:
 *
 * - **Appending a search never recolours an existing one.** Runs are walked
 *   oldest-first and each takes a slot nobody before it has taken, so a new
 *   search can only ever consume a slot that was free. One caveat, because the
 *   sentence is otherwise slightly too strong: "appending" means *later in
 *   creation order*. A run created in the same millisecond as an existing one
 *   can sort before it on the id tie-break and take its slot. That needs two
 *   searches saved inside the same millisecond, which a human cannot do and a
 *   fixture does constantly — so it is a thing to know when writing tests
 *   rather than a thing a reader will meet.
 * - **A reload does not reshuffle.** Nothing here reads the clock, the order the
 *   server happened to answer in, or which searches are switched on. Given the
 *   same set of runs it returns the same map, on any machine.
 *
 * And the honest cost, because it is real and there is no version of this
 * without one: **deleting a search can recolour the searches made after it.**
 * Its slot is freed, and a later run whose first choice was that slot will take
 * it next time round — and then *its* old slot is free, so in a full palette
 * the change can walk along a probing cluster rather than stopping at one run.
 * Usually it moves nothing; the worst case is not "exactly one".
 *
 * Two ways out were considered and both are worse. Storing the colour on the
 * run means a schema change, a migration, and a server that has an opinion
 * about the palette — for a value that is derived. Never reusing a freed slot
 * means keeping a tombstone list forever so that the tenth search in a
 * five-colour palette knows what the third one used to be. A colour changing
 * when you delete the search above it is a thing the reader watched happen;
 * the other two are silent.
 *
 * **The first of those two was built anyway on 2026-08-27, and this paragraph
 * is deliberately left standing.** It is still the right answer to the
 * question it was asked — *should a derived colour be stored?* — and the
 * override is not that. A run with no `colour` is still assigned exactly as
 * described here, and still moves when the search above it is deleted. What
 * the reader now has is a way to say *no, this one is blue*, which is the only
 * thing that ever needed storing. See § The reader can override it, above.
 *
 * ## Why the *preference* is a hash rather than the position
 *
 * The simple version of this — first run gets slot 0, second gets slot 1 — has
 * one flaw, and it is the flaw that makes the deletion cost above much worse
 * than it needs to be: deleting the first of five searches shifts *all four*
 * remaining ones by a slot, so every colour on the page changes at once. With a
 * hashed preference the deletion only disturbs runs that actually wanted the
 * freed slot, which is usually none of them.
 *
 * The ids are already random (src/ids.ts), so hashing one is a cheap way of
 * saying "pick a slot arbitrarily but always the same one".
 */

/**
 * How many distinct hues the categorical palette holds.
 *
 * **This number lives in two places and they must agree**: here, and the
 * `--cat-0-rgb` … `--cat-7-rgb` block in `styles/colourscales.css`. Making it
 * one place would mean either reading computed styles from the DOM (which is
 * not available to a test, and not available before first paint) or moving the
 * hues into TypeScript (which is the thing the file comment above refuses).
 *
 * The failure if they drift is quiet in one direction and loud in the other: a
 * palette with *more* colours than this simply never uses the extra ones, and a
 * palette with *fewer* leaves marks referring to `var(--cat-9-rgb)`, which is
 * an invalid value and paints nothing at all. So `tests/hit-colours.test.ts`
 * reads the stylesheet and counts, rather than trusting this comment.
 *
 * Eight is not arbitrary. It is the length of the Okabe–Ito palette the hues
 * are drawn from, and it is at the top of the range the research is willing to
 * call distinguishable — see docs/project/colour-scales.md § How many is too
 * many. A ninth hue that nobody can tell from the third is not a ninth colour.
 */
export const CATEGORICAL_SLOTS = 8;

/**
 * How many hues the palette holds **in total** — what a reader may choose from.
 *
 * Greg, 2026-08-27: *"And add more colours, arranged more naturally."*
 *
 * **Two numbers, and the gap between them is the whole design.** The eight
 * above are what the hash hands out on its own; these sixteen are what the
 * picker offers. Growing one number rather than two would have been simpler
 * and wrong twice over:
 *
 * - **Every saved search would change colour.** The automatic slot is
 *   `hash32(id) % CATEGORICAL_SLOTS`. Change the modulus and every run in
 *   every article lands somewhere else — which is precisely the one thing this
 *   file exists to prevent, and it would happen silently, once, to everybody.
 * - **The distinguishability argument would break where it actually matters.**
 *   Eight is the top of the range anyone claims is reliably distinguishable,
 *   and the automatic set is the hard case: nobody chose those hues, several
 *   of them are overlaid on the same paragraph, and the reader is trying to
 *   tell apart searches they never coloured. A hue somebody picked on purpose
 *   is a different question. styles/colourscales.css has the measurements,
 *   including the pairs that collapse under dichromacy.
 *
 * So a slot of 11 is a perfectly good stored colour and can never be handed
 * out by accident. `isPaletteSlot` bounds on this number, because the question
 * it answers is *"does this name a hue we have?"* — and everything that paints
 * (annotate.ts, TableView.tsx, the picker) bounds on it too.
 */
export const PALETTE_SLOTS = 16;

/**
 * The slots in **hue order**, for anything that shows the palette as a palette.
 *
 * This is the "arranged more naturally" half of Greg's ask. Slot numbers are
 * an accident of when a hue was added — the eight Okabe–Ito ones came first
 * and the eight that fill their gaps came second — so laying the picker out in
 * slot order would scatter the spectrum. In hue order the grid reads as a
 * wheel unrolled: crimson through the warms to yellow, down through the greens
 * and teals to the blues, round the violets and back to red, with the one
 * colourless slot parked at the end where it cannot interrupt the run.
 *
 * **A list of numbers, so the seam holds.** Nothing here is a colour; this is
 * an ordering *of slots*, and it is as much as TypeScript is allowed to know.
 * It does mean the order and the stylesheet have to agree, which is the same
 * two-places problem `CATEGORICAL_SLOTS` carries — so it is checked the same
 * way: `tests/hit-colours.test.ts` reads colourscales.css, converts every
 * triplet to OKLCH, and requires this array to be sorted by hue angle. A hue
 * that moves therefore turns a test red rather than quietly putting the grid
 * out of order.
 */
export const PALETTE_BY_HUE: readonly number[] = [
  8, 1, 6, 3, // crimson, vermilion, orange, yellow
  9, 10, 2, 11, // yellow-green, green, bluish green, teal
  12, 0, 4, 13, // cyan-blue, sky blue, blue, violet
  14, 15, 5, 7, // purple, magenta, reddish purple, and the neutral last
];

/**
 * What `assignSlots` needs to know about a run: who it is, when it arrived,
 * and whether the reader has already said what colour it should be.
 *
 * Structural rather than `SearchRun`, so this module still imports nothing —
 * which is what lets `tests/hit-colours.test.ts` build six runs out of two
 * fields each, and what keeps the file honest about depending on the ids and
 * the clock and nothing else.
 */
export interface PalettedRun {
  id: string;
  createdAt: string;
  /** The reader's own choice. Absent, or out of range, means "work it out". */
  colour?: number | undefined;
}

/**
 * Does this number name a hue we actually have?
 *
 * `PALETTE_SLOTS`, **not** `CATEGORICAL_SLOTS` — the question is "does this
 * name a hue we have?", not "would the hash have chosen it?". A reader can pin
 * a search to slot 11, which no automatic assignment will ever produce.
 *
 * **The only place that can answer**, because it is the only side of the seam
 * that knows how big the palette is — the server stores a slot without knowing
 * what colour it is (`SearchRun.colour`), and the CSS knows the colours
 * without knowing the number. So a stored `9` is not corrupt data and must not
 * be treated as such: it is a choice this build cannot honour, and the row
 * quietly goes back to its automatic hue rather than referring to
 * `var(--cat-9-rgb)`, which is an invalid value and paints nothing at all.
 *
 * Both ends of the range, and `Number.isInteger` before either: the identical
 * three-part check `annotate.ts` makes before interpolating a slot into a
 * custom-property *name*, where `NaN` and `2.5` are not errors anywhere, they
 * are just marks that never appear.
 */
export function isPaletteSlot(value: number | undefined): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value < PALETTE_SLOTS
  );
}

/**
 * FNV-1a, 32-bit — a hash chosen for being boring and identical everywhere.
 *
 * Nothing cryptographic is wanted here and nothing about the distribution
 * matters much, because the ids being hashed are already uniform. What *does*
 * matter is that it is deterministic across machines and across JavaScript
 * engines, which rules out anything built on a `Map` iteration order or a
 * `sort` whose comparator can tie.
 *
 * `>>> 0` on the way out because JavaScript's bitwise operators produce a
 * *signed* 32-bit integer, and a negative left-hand side turns `%` into a
 * negative remainder — which would index off the front of the palette and
 * resolve to `undefined`. That is the whole bug this line exists to prevent,
 * and it fires for roughly half of all inputs.
 *
 * `charCodeAt` reads UTF-16 code units where FNV specifies bytes. Identical for
 * everything this is ever called on — a Spideryarn id is `spya-` plus six
 * characters from a 32-symbol ASCII alphabet (src/ids.ts) — and it is written
 * down because the two only diverge above U+007F, which is exactly the kind of
 * difference that would not show up until somebody reused this for something
 * else. Verified against the canonical vectors: `""` → `0x811c9dc5`,
 * `"a"` → `0xe40c292c`, `"foobar"` → `0xbf9cf968`.
 */
function hash32(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    /* The FNV prime, 16777619, by shift-and-add rather than by `*`: a plain
       multiply overflows the 53-bit float mantissa and the low bits — the ones
       the modulo below reads — come back wrong. `Math.imul` would also do, and
       this is the same arithmetic written out. */
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

/** The oldest-first order the assignment walks, and the only order it depends on. */
function inCreationOrder<T extends { id: string; createdAt: string }>(runs: T[]): T[] {
  /* `id` breaks the tie, so two searches saved in the same millisecond — which
     a fixture does routinely and a fast reader can do for real — come out in a
     fixed order rather than in whatever order the array arrived in. Without it
     the "a reload does not reshuffle" promise above is false for exactly the
     case nobody tests.

     **Plain `<`, not `localeCompare`.** These are ISO-8601 timestamps and
     `spya-` ids: both are ASCII, both sort correctly byte-wise, and byte order
     is the same everywhere. `localeCompare` is not — it consults the runtime's
     collation, which differs between engines, between ICU builds, and with the
     host's locale. For these strings it will almost always agree; "almost
     always" is the wrong guarantee for a function whose whole promise is that
     the same set of searches gets the same colours on any machine. Raised by a
     GPT Sol review, 2026-08-26. */
  return [...runs].sort((a, b) => {
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * A palette slot for every run — `0` … `CATEGORICAL_SLOTS - 1`.
 *
 * Linear probing from a hashed first choice, oldest run first. Past the eighth
 * search the palette is exhausted and colours start repeating, which is
 * deliberate and is the least-bad option: the alternatives are inventing a
 * ninth hue nobody can distinguish from an existing one, or refusing to colour
 * a search at all. Two searches sharing a colour is a thing the reader can see
 * and work around by switching one off; a colourless search is a hole in the
 * scheme. The panel does not pretend otherwise — the criterion is printed
 * beside every dot.
 *
 * Deterministic given the same set of runs, and independent of which of them
 * are switched on: a search's colour must not change when the reader ticks the
 * box next to it.
 */
export function assignSlots(runs: PalettedRun[]): Map<string, number> {
  const slots = new Map<string, number>();
  const taken = new Set<number>();

  /* The reader's own choices first, all of them, before a single automatic run
     probes. Two passes rather than one because a pin is not a preference: an
     automatic run must not be sitting in a slot that a *later* run was pinned
     to, and inside one ordered walk it would be. `taken` collects them, so the
     probing below routes around every pin at once.

     A slot outside the palette is ignored rather than clamped, and the row
     falls back to auto. The server stores a number and does not know how many
     hues there are (`SearchRun.colour`), so this is the only place that can
     tell, and clamping would silently answer a question the reader did not
     ask — pin to 9 in an eight-hue palette and get 7, which is a colour they
     chose against. */
  const pinned = new Set<number>();
  for (const run of runs) {
    if (!isPaletteSlot(run.colour)) continue;
    slots.set(run.id, run.colour);
    taken.add(run.colour);
    pinned.add(run.colour);
  }

  for (const run of inCreationOrder(runs)) {
    if (slots.has(run.id)) continue;
    const first = hash32(run.id) % CATEGORICAL_SLOTS;
    let slot = first;
    for (let step = 0; step < CATEGORICAL_SLOTS && taken.has(slot); step++) {
      slot = (first + step + 1) % CATEGORICAL_SLOTS;
    }
    /* Past the eighth run every slot is taken and the loop above runs out
       without finding one, leaving `slot` back at the first choice. That is the
       wrap: the ninth search wears the same hue as whichever earlier one hashed
       to the same place. Note that `taken` is deliberately *not* cleared at that
       point — clearing it would start a second pass that re-derived the same
       eight assignments and handed the ninth run slot 0 regardless of its hash,
       which is a worse collision than the hashed one. */
    if (taken.has(slot) && pinned.has(slot)) {
      /* **A repeat has to fall on an automatic slot before a pinned one.**
         Repeating is unavoidable in a full palette, but the two repeats are not
         equally bad: colliding with another automatic hue costs a distinction
         nobody asked for, while colliding with a *chosen* one takes the meaning
         out of the reader's own choice — the whole point of pinning a search is
         that its colour says "this question", and a ninth search wearing it
         says it twice. So one more probe, skipping only the pins. If every slot
         is pinned there is genuinely nothing better, and the hashed first
         choice stands. GPT Sol's review, 2026-08-27, which pointed out that the
         reservation above stops holding at exactly the moment the palette
         fills — and that a test using eight runs cannot see it. */
      let alt = first;
      for (let step = 0; step < CATEGORICAL_SLOTS && pinned.has(alt); step++) {
        alt = (first + step + 1) % CATEGORICAL_SLOTS;
      }
      if (!pinned.has(alt)) slot = alt;
    }
    slots.set(run.id, slot);
    taken.add(slot);
  }
  return slots;
}
