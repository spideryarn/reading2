/**
 * **Which colour a shelf topic wears** — a palette *slot*, never a colour.
 *
 * Greg, 2026-09-28, on the "More detail" view of the Topics row: *"can we do
 * better? e.g. use colour per term"*. The colour is decoration keyed to the
 * topic's **rank** — its position in the server's order, which is the order the
 * row draws — not to anything the topic means (plan 260928d § Assumptions
 * pending Greg, 2). So the same shelf gives the same colours on every reload,
 * and a topic's colour can change when the shelf changes enough to re-rank it.
 *
 * The hues are the categorical palette's, `--cat-N` in
 * styles/colourscales.css — the same split hit-colours.ts keeps: this file says
 * *which slot*, the stylesheet says *what colour*, so a palette change is one
 * edit in one place (docs/project/colour-scales.md).
 *
 * **The order is the colour-blind-safe seven first.** Slots 0–6 are
 * Okabe–Ito's chromatic hues, lifted for the dark page, and they go to the
 * first seven topics — the ones the row leads with. Slot 7, the light neutral,
 * is skipped: a grey reads as "not coloured" beside chips that are. The eight
 * opt-in hues (8–15) follow; colour-scales.md is honest that two pairs of them
 * collapse under dichromacy, which is tolerable here because every swatch sits
 * beside its topic's label, and the colour is never the only way to tell two
 * topics apart. Past fifteen it repeats.
 */
import type { CSSProperties } from "react";

/** The palette slots topics are given, in rank order. */
export const TOPIC_SLOTS: readonly number[] = [0, 1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14, 15];

/** The palette slot for the topic at this rank (0 = first). */
export function topicSlot(rank: number): number {
  const i = ((rank % TOPIC_SLOTS.length) + TOPIC_SLOTS.length) % TOPIC_SLOTS.length;
  return TOPIC_SLOTS[i] ?? 0;
}

/**
 * The style that puts a slot's colour in `--topic`, for a `tw:bg-[var(--topic)]`
 * (or border) class beside it. A palette *reference*, never a colour value —
 * the same shape as `--cat-rgb` in SearchPanel.tsx.
 */
export function topicColourStyle(slot: number): CSSProperties {
  return { "--topic": `var(--cat-${slot})` } as CSSProperties;
}
