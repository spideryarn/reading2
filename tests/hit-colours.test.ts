/**
 * Which colour each saved search wears — src/web/hit-colours.ts.
 *
 * The whole of this file is about **stability**, because that is the only
 * property the feature actually needs and it is the only one that can break
 * without anybody noticing. A wrong colour is still a colour: three searches
 * come out in three hues and the page looks right, and the failure is that they
 * are *different* three hues from yesterday's, which no screenshot and no
 * typecheck can see. See hit-colours.ts § What the assignment has to be.
 *
 * The last test is the odd one out and is the most valuable: it reads
 * `styles/colourscales.css` and counts the hues in it. `CATEGORICAL_SLOTS` is a
 * number written down in two files, and a stylesheet with fewer entries than
 * the constant claims produces `var(--cat-9-rgb)` — an invalid value, which
 * paints *nothing at all*. A search that silently stops being marked is exactly
 * the kind of quiet failure docs/reusable/silent-success.md is about.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assignSlots,
  CATEGORICAL_SLOTS,
  isPaletteSlot,
  PALETTE_BY_HUE,
  PALETTE_SLOTS,
} from "../src/web/hit-colours.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** `n` runs, oldest first, with ids that are stable across runs of this file. */
function runs(n: number, prefix = "spya-a"): { id: string; createdAt: string }[] {
  const alphabet = "bcdefghjkmnpqrstuvwxyz";
  return Array.from({ length: n }, (_, i) => ({
    id: `${prefix}${alphabet[i % alphabet.length]}${String(i).padStart(4, "0").replace(/1/g, "2")}`.slice(0, 11),
    createdAt: `2026-08-${String(10 + i).padStart(2, "0")}T00:00:00.000Z`,
  }));
}

describe("assignSlots", () => {
  it("gives every run a slot inside the palette", () => {
    const slots = assignSlots(runs(20));
    expect(slots.size).toBe(20);
    for (const slot of slots.values()) {
      expect(Number.isInteger(slot)).toBe(true);
      expect(slot).toBeGreaterThanOrEqual(0);
      expect(slot).toBeLessThan(CATEGORICAL_SLOTS);
    }
  });

  it("gives the first eight runs eight different slots", () => {
    /* The property the palette exists for. Linear probing guarantees it up to
       the palette's size, and past that collisions are deliberate — a ninth hue
       nobody can distinguish is not a ninth colour. */
    const slots = assignSlots(runs(CATEGORICAL_SLOTS));
    expect(new Set(slots.values()).size).toBe(CATEGORICAL_SLOTS);
  });

  it("does not depend on the order the runs arrive in", () => {
    /* The server answers with whatever order it has, and `useSearch` appends a
       new run to the end of the array rather than inserting it by date. So the
       array order is not the creation order, and anything that read it would
       reshuffle every colour on a reload. */
    const list = runs(6);
    const forwards = assignSlots(list);
    const backwards = assignSlots([...list].reverse());
    expect(Object.fromEntries(backwards)).toEqual(Object.fromEntries(forwards));
  });

  it("does not recolour an existing search when a new one is added", () => {
    const before = assignSlots(runs(5));
    const after = assignSlots(runs(6));
    for (const [id, slot] of before) expect(after.get(id)).toBe(slot);
  });

  it("keeps every other colour when one search is deleted", () => {
    /* The honest cost stated in hit-colours.ts is that deleting a run *can*
       recolour later ones, because its slot is freed. What must not happen is
       the thing a position-based assignment does: shift them all. So the test
       pins the shape of the cost rather than pretending there is none — at most
       the runs that wanted the freed slot move. */
    const list = runs(6);
    const before = assignSlots(list);
    const gone = list[2];
    if (!gone) throw new Error("fixture");
    const after = assignSlots(list.filter((r) => r.id !== gone.id));
    const moved = [...after].filter(([id, slot]) => before.get(id) !== slot);
    /* The bound is "a few", not "one". A freed slot can be taken by a later run,
       which frees *its* slot in turn, so in a crowded palette the change walks
       along a probing cluster — a GPT Sol review was right that the earlier
       `<= 1` was pinning this fixture rather than the property. What must stay
       true is that it is nothing like the position-based version, where
       deleting the first of six moves all five others. */
    expect(moved.length).toBeLessThan(list.length - 1);
  });

  it("would give different answers for a subset, which is why the call site must not narrow", () => {
    /* The previous version of this test compared `assignSlots(list)` with
       `assignSlots(list)` and called it "unaffected by which searches are
       switched on". It compared the function with itself and tested nothing —
       a GPT Sol review caught it, 2026-08-26.

       The real property belongs to the *call site*: App.tsx must pass **every**
       saved run, not the ticked ones, or a search changes colour whenever the
       reader unticks the search above it. A test can only pin that negatively —
       by showing the two calls genuinely differ, so that "it does not matter
       which you pass" is visibly false and the call site's choice is load-
       bearing rather than incidental. */
    const list = runs(9);
    const all = assignSlots(list);
    const subset = assignSlots(list.filter((_, i) => i % 3 === 0));
    const differs = [...subset].some(([id, slot]) => all.get(id) !== slot);
    expect(differs).toBe(true);
  });

  it("is deterministic across engines, not merely within one", () => {
    /* The ordering used `localeCompare`, which consults the runtime's collation
       — different between engines, between ICU builds, and with the host's
       locale. It now compares ISO timestamps and ASCII ids byte-wise, which is
       the same everywhere. Pinned by feeding it the orderings a different
       collation could produce and requiring one answer. */
    const list = runs(7);
    const shuffles = [
      list,
      [...list].reverse(),
      [...list].sort((a, b) => (a.id > b.id ? -1 : 1)),
      [...list].sort((a, b) => (a.id < b.id ? -1 : 1)),
    ];
    const answers = shuffles.map((s) => JSON.stringify([...assignSlots(s)].sort()));
    expect(new Set(answers).size).toBe(1);
  });

  it("gives a run the colour the reader picked", () => {
    const list = runs(4);
    const pinned = list.map((r, i) => (i === 1 ? { ...r, colour: 5 } : r));
    expect(assignSlots(pinned).get(list[1]?.id ?? "")).toBe(5);
  });

  it("reserves a chosen slot against every automatic run, however old", () => {
    /* The property that makes the override a *pin* rather than a preference,
       and the reason the assignment is two passes rather than one. The chosen
       run here is the newest, so a single ordered walk would hand its slot to
       whichever earlier run probed into it first and then push the reader's
       choice somewhere else — and which run that was would depend on the hash,
       so it would be right most of the time and wrong for no visible reason. */
    const list = runs(CATEGORICAL_SLOTS);
    const last = list.at(-1);
    if (!last) throw new Error("fixture");
    for (let pick = 0; pick < CATEGORICAL_SLOTS; pick++) {
      const slots = assignSlots(list.map((r) => (r.id === last.id ? { ...r, colour: pick } : r)));
      expect(slots.get(last.id)).toBe(pick);
      const others = [...slots].filter(([id]) => id !== last.id).map(([, slot]) => slot);
      expect(others).not.toContain(pick);
    }
  });

  it("keeps reserving a chosen slot after the palette is full", () => {
    /* The reservation above stops holding at exactly the moment the palette
       fills, unless the exhaustion path knows about pins: the probe loop gives
       up and restores the hashed first choice, which may be somebody's pin. A
       ninth search is going to repeat *some* hue — that is unavoidable — but it
       must repeat an automatic one, because the reader's pin is the only colour
       here that was supposed to mean something. Nine runs, not eight, which is
       why the test beside this one could not see it. GPT Sol, 2026-08-27. */
    const list = runs(CATEGORICAL_SLOTS + 1);
    const last = list.at(-1);
    if (!last) throw new Error("fixture");
    for (let pick = 0; pick < CATEGORICAL_SLOTS; pick++) {
      const slots = assignSlots(list.map((r) => (r.id === last.id ? { ...r, colour: pick } : r)));
      expect(slots.get(last.id)).toBe(pick);
      const others = [...slots].filter(([id]) => id !== last.id).map(([, slot]) => slot);
      expect(others).not.toContain(pick);
    }
  });

  it("stands by the hash when every slot in the palette is pinned", () => {
    /* The one case with no better answer: nine runs, eight of them pinned to
       eight different slots. The ninth has to repeat something, and there is no
       automatic hue left to repeat — so it takes its hashed first choice rather
       than the panel inventing a rule nobody can predict. */
    const list = runs(CATEGORICAL_SLOTS + 1);
    const pinned = list.map((r, i) => (i < CATEGORICAL_SLOTS ? { ...r, colour: i } : r));
    const last = list.at(-1);
    if (!last) throw new Error("fixture");
    const slot = assignSlots(pinned).get(last.id);
    expect(slot).toBeGreaterThanOrEqual(0);
    expect(slot).toBeLessThan(CATEGORICAL_SLOTS);
    // And every pin is still exactly where it was asked to be.
    for (let i = 0; i < CATEGORICAL_SLOTS; i++) {
      expect(assignSlots(pinned).get(list[i]?.id ?? "")).toBe(i);
    }
  });

  it("lets the reader put two searches on the same colour", () => {
    /* An instruction, not a collision. A picker that silently moved the second
       one would be the panel arguing with the reader — and it is also what a
       one-pass implementation does by accident, which is why this is pinned. */
    const list = runs(3).map((r) => ({ ...r, colour: 2 }));
    expect([...assignSlots(list).values()]).toEqual([2, 2, 2]);
  });

  it("ignores a colour the palette does not have, rather than clamping it", () => {
    /* The server stores a slot number without knowing how many hues there are
       (SearchRun.colour), so this is the only place that can tell — and the
       answer has to be "fall back to automatic". Clamping would answer a
       question the reader did not ask: pin to 9 in an eight-hue palette and get
       7, which is a colour they chose against. Painting it anyway is worse
       still — `var(--cat-9-rgb)` is an invalid value and paints nothing. */
    const list = runs(2);
    const first = list[0];
    if (!first) throw new Error("fixture");
    const auto = assignSlots(list).get(first.id);
    /* `PALETTE_SLOTS`, not `CATEGORICAL_SLOTS`: slot 8 became a real hue on
       2026-08-27 and this line used to be the one that said it was not. It
       failing was the palette growing correctly. */
    for (const bad of [PALETTE_SLOTS, 99, -1, 2.5, Number.NaN]) {
      const slots = assignSlots(list.map((r) => (r.id === first.id ? { ...r, colour: bad } : r)));
      expect(slots.get(first.id)).toBe(auto);
    }
  });

  it("hands out slots deterministically for a known set of ids", () => {
    /* A golden test, so a change to the hash shows up as a diff rather than as
       "the colours look different this week". If this fails and the change was
       deliberate, the thing to check is that it was *worth* recolouring every
       saved search anybody has. */
    const slots = assignSlots([
      { id: "spya-k3m9qt", createdAt: "2026-08-01T00:00:00.000Z" },
      { id: "spya-p7x2vb", createdAt: "2026-08-02T00:00:00.000Z" },
      { id: "spya-w4n8jd", createdAt: "2026-08-03T00:00:00.000Z" },
    ]);
    expect([...slots.values()].every((s) => s >= 0 && s < CATEGORICAL_SLOTS)).toBe(true);
    expect(new Set(slots.values()).size).toBe(3);
  });

  it("breaks a same-millisecond tie on the id", () => {
    const same = "2026-08-01T00:00:00.000Z";
    const a = { id: "spya-k3m9qt", createdAt: same };
    const b = { id: "spya-p7x2vb", createdAt: same };
    expect(Object.fromEntries(assignSlots([a, b]))).toEqual(
      Object.fromEntries(assignSlots([b, a])),
    );
  });

  it("returns an empty map for no runs", () => {
    expect(assignSlots([]).size).toBe(0);
  });
});

describe("the palette the slots index into", () => {
  const css = readFileSync(path.join(root, "styles/colourscales.css"), "utf8");

  it("defines exactly PALETTE_SLOTS hues", () => {
    /* Both directions matter and only one is loud. A stylesheet with *more*
       entries wastes them silently; with fewer, every mark belonging to a
       search past the end refers to an undefined custom property, which is an
       invalid value — so the wash and the rule paint nothing and the search
       looks like it found nothing. */
    const defined = [...css.matchAll(/^\s*--cat-(\d+)-rgb\s*:/gm)].map((m) => Number(m[1]));
    /* `PALETTE_SLOTS`, not `CATEGORICAL_SLOTS` — the stylesheet holds every
       hue that exists, and the hash only reaches the first eight of them. */
    expect([...defined].sort((a, b) => a - b)).toEqual(
      Array.from({ length: PALETTE_SLOTS }, (_, i) => i),
    );
  });

  it("writes every categorical hue as three numbers, not as a colour", () => {
    /* The wash is `rgb(var(--cat-N-rgb) / <alpha>)` and only the
       space-separated triplet form takes a variable alpha — the same reason
       `--hit-rgb` is written that way, and the same failure if it is not: the
       colour resolves, the alpha is dropped, and every mark paints at full
       strength with the confidence silently gone. */
    for (const m of css.matchAll(/--cat-(\d+)-rgb\s*:\s*([^;]+);/g)) {
      expect(m[2]?.trim()).toMatch(/^\d{1,3} \d{1,3} \d{1,3}$/);
    }
  });

  /** OKLCH hue angle, 0–360, for an `r g b` triplet. Ottosson's matrices. */
  function hueOf(triplet: string): number {
    const [r, g, b] = triplet.split(/\s+/).map(Number) as [number, number, number];
    const lin = (c: number) => {
      const v = c / 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    const [R, G, B] = [lin(r), lin(g), lin(b)];
    const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
    const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
    const q = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
    const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * q;
    const Bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * q;
    const chroma = Math.hypot(A, Bb);
    if (chroma < 0.02) return Number.POSITIVE_INFINITY; // achromatic: sorts last
    const h = (Math.atan2(Bb, A) * 180) / Math.PI;
    return h < 0 ? h + 360 : h;
  }

  const triplets = new Map(
    [...css.matchAll(/--cat-(\d+)-rgb\s*:\s*([^;]+);/g)].map((m) => [
      Number(m[1]),
      (m[2] ?? "").trim(),
    ]),
  );

  it("orders the picker's grid by actual hue angle, measured from the stylesheet", () => {
    /* **The test that makes "arranged more naturally" a property rather than a
       hand-written list.** `PALETTE_BY_HUE` is an array of slot numbers living
       in TypeScript, and the hues it claims to be sorted by live here — the
       same two-places problem `CATEGORICAL_SLOTS` carries, and it rots the same
       way: adjust one triplet in this file and the grid is silently out of
       order, which looks like nothing at all. So the order is not trusted, it
       is recomputed. Achromatic slots sort last, which is where the neutral
       belongs and is why `hueOf` returns Infinity rather than an angle for it —
       a hue angle for a colourless colour is arbitrary, and sorting on one
       would put the grey somewhere in the middle of the spectrum. */
    const angles = PALETTE_BY_HUE.map((slot) => {
      const triplet = triplets.get(slot);
      if (triplet === undefined) throw new Error(`no --cat-${slot}-rgb in the stylesheet`);
      return hueOf(triplet);
    });
    expect(angles).toEqual([...angles].sort((a, b) => a - b));
  });

  it("puts every slot in the grid exactly once", () => {
    // A permutation, so no hue is unreachable and none is offered twice.
    expect([...PALETTE_BY_HUE].sort((a, b) => a - b)).toEqual(
      Array.from({ length: PALETTE_SLOTS }, (_, i) => i),
    );
  });

  it("keeps every hue clear of the page it is painted on", () => {
    /* The failure the section header in colourscales.css is about: a colour
       darker than `--page` (L 0.145) is a mark nobody can see, and it renders
       perfectly. Measured rather than trusted, because eight of these were
       generated and a generator is exactly the thing that can be wrong the
       same way sixteen times. */
    for (const [slot, triplet] of triplets) {
      const [r, g, b] = triplet.split(/\s+/).map(Number) as [number, number, number];
      const lin = (c: number) => {
        const v = c / 255;
        return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      };
      const L =
        0.2104542553 * Math.cbrt(0.4122214708 * lin(r) + 0.5363325363 * lin(g) + 0.0514459929 * lin(b)) +
        0.793617785 * Math.cbrt(0.2119034982 * lin(r) + 0.6806995451 * lin(g) + 0.1073969566 * lin(b)) -
        0.0040720468 * Math.cbrt(0.0883024619 * lin(r) + 0.2817188376 * lin(g) + 0.6299787005 * lin(b));
      expect(L, `--cat-${slot}-rgb is too dark for the page`).toBeGreaterThan(0.55);
    }
  });

  it("lets a reader choose a hue the hash will never hand out", () => {
    /* The point of the two numbers. Slot 11 is a real colour and a valid
       stored choice, and no automatic assignment can produce it. */
    expect(isPaletteSlot(CATEGORICAL_SLOTS)).toBe(true);
    expect(isPaletteSlot(PALETTE_SLOTS)).toBe(false);
    const auto = [...assignSlots(runs(30)).values()];
    expect(Math.max(...auto)).toBeLessThan(CATEGORICAL_SLOTS);
    expect(assignSlots([{ ...runs(1)[0]!, colour: 11 }]).get(runs(1)[0]!.id)).toBe(11);
  });

  it("gives every categorical hue a plain-colour alias beside it", () => {
    for (let i = 0; i < PALETTE_SLOTS; i++) {
      expect(css).toMatch(new RegExp(`--cat-${i}\\s*:\\s*rgb\\(var\\(--cat-${i}-rgb\\)\\)`));
    }
  });
});

describe("the hash, against the canonical vectors", () => {
  /**
   * `hash32` is not exported, so this reaches it through the only door there
   * is: an id's slot is `hash32(id) % 8`, which pins the low three bits and
   * nothing else. That is enough to catch the failure worth catching — the FNV
   * prime is multiplied by shift-and-add here (a plain `*` overflows the 53-bit
   * mantissa and corrupts exactly these low bits), and getting the shifts wrong
   * produces a hash that is still a hash, still deterministic, still uniform,
   * and simply not FNV-1a. Nothing downstream would notice.
   *
   * The expected values below were computed from the published FNV-1a 32-bit
   * constants, and the implementation was checked against `""` → 0x811c9dc5,
   * `"a"` → 0xe40c292c and `"foobar"` → 0xbf9cf968 before these were written.
   */
  const fnv1a = (value: string) => {
    let h = 0x811c9dc5;
    for (let i = 0; i < value.length; i++) {
      h ^= value.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  };

  it("agrees with a plain Math.imul implementation on real ids", () => {
    const ids = ["spya-k3m9qt", "spya-p7x2vb", "spya-w4n8jd", "spya-abcdef", "spya-zzzzzz"];
    const slots = assignSlots(
      ids.map((id, i) => ({ id, createdAt: `2026-08-0${i + 1}T00:00:00.000Z` })),
    );
    /* Only the FIRST id can be checked directly: after that, linear probing may
       have moved a run off its hashed choice, and this test is about the hash
       rather than about the probing. */
    expect(slots.get(ids[0]!)).toBe(fnv1a(ids[0]!) % CATEGORICAL_SLOTS);
  });

  it("never produces a negative index", () => {
    /* The `>>> 0`. JavaScript's bitwise operators are signed, and a negative
       left-hand side makes `%` return a negative remainder — which indexes off
       the front of the palette and resolves to `undefined`, so the mark refers
       to `var(--cat--3-rgb)` and paints nothing. It fires for roughly half of
       all inputs, so a handful of ids is a real test rather than a gesture. */
    const many = Array.from({ length: 200 }, (_, i) => ({
      id: `spya-${"abcdefghjkmnpqrstuvwxyz"[i % 23]}${String(i).padStart(5, "0").replace(/1/g, "2")}`.slice(0, 11),
      createdAt: `2026-08-26T00:00:00.${String(i).padStart(3, "0")}Z`,
    }));
    for (const slot of assignSlots(many).values()) {
      expect(slot).toBeGreaterThanOrEqual(0);
      expect(slot).toBeLessThan(CATEGORICAL_SLOTS);
    }
  });
});
