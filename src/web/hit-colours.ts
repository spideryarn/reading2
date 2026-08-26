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
 * ## What the assignment has to be, and what it cannot be
 *
 * The requirement that shapes everything below is **stability**. A saved search
 * is a thing the reader comes back to — that is the whole reason it is saved
 * (SearchPanel.tsx § Saved) — and a colour that means "this question" is worth
 * nothing if it is a different colour tomorrow. So:
 *
 * - **Appending a search never recolours an existing one.** Runs are walked
 *   oldest-first and each takes a slot nobody before it has taken, so a new
 *   search can only ever consume a slot that was free.
 * - **A reload does not reshuffle.** Nothing here reads the clock, the order the
 *   server happened to answer in, or which searches are switched on. Given the
 *   same set of runs it returns the same map, on any machine.
 *
 * And the honest cost, because it is real and there is no version of this
 * without one: **deleting a search can recolour the searches made after it.**
 * Its slot is freed, and a later run whose first choice was that slot will take
 * it next time round. Two ways out were considered and both are worse. Storing
 * the colour on the run means a schema change, a migration, and a server that
 * has an opinion about the palette — for a value that is derived. Never reusing
 * a freed slot means keeping a tombstone list forever so that the tenth search
 * in a five-colour palette knows what the third one used to be. A colour
 * changing when you delete the search above it is a thing the reader watched
 * happen; the other two are silent.
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
     case nobody tests. */
  return [...runs].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
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
export function assignSlots(runs: { id: string; createdAt: string }[]): Map<string, number> {
  const slots = new Map<string, number>();
  const taken = new Set<number>();
  for (const run of inCreationOrder(runs)) {
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
    slots.set(run.id, slot);
    taken.add(slot);
  }
  return slots;
}
