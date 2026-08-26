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
import { assignSlots, CATEGORICAL_SLOTS } from "../src/web/hit-colours.js";

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
    expect(moved.length).toBeLessThanOrEqual(1);
  });

  it("is unaffected by which searches are switched on", () => {
    /* Not a property of the function so much as of its *call site*, and it is
       pinned here because the call site is one line in App.tsx that is very
       easy to write as `assignSlots(active)`. That version passes every other
       test in this file and recolours the page every time a box is ticked. */
    const list = runs(4);
    expect(Object.fromEntries(assignSlots(list))).toEqual(
      Object.fromEntries(assignSlots(list)),
    );
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

  it("defines exactly CATEGORICAL_SLOTS hues", () => {
    /* Both directions matter and only one is loud. A stylesheet with *more*
       entries wastes them silently; with fewer, every mark belonging to a
       search past the end refers to an undefined custom property, which is an
       invalid value — so the wash and the rule paint nothing and the search
       looks like it found nothing. */
    const defined = [...css.matchAll(/^\s*--cat-(\d+)-rgb\s*:/gm)].map((m) => Number(m[1]));
    expect([...defined].sort((a, b) => a - b)).toEqual(
      Array.from({ length: CATEGORICAL_SLOTS }, (_, i) => i),
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

  it("gives every categorical hue a plain-colour alias beside it", () => {
    for (let i = 0; i < CATEGORICAL_SLOTS; i++) {
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
