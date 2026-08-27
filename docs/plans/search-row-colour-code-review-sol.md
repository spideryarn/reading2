# GPT Sol's review of the colour picker

> **What this is.** A cross-family code review of
> [search-row-colour.md](search-row-colour.md) and the code built from it, run on 2026-08-27 with
> `scripts/run-codex.ts --model gpt-5.6-sol --effort high`. Kept because the findings are the
> reasoning behind half a dozen lines that would otherwise look arbitrary.
>
> **Every finding here was checked and every one of them was real.** All seven are fixed; the
> comment beside each fix names this review. The `file.ts:NN` citations were markdown links to
> absolute paths in the original and are plain code spans here, because
> `tests/doc-links.test.ts` resolves every link in `docs/` and an absolute path is not one it can
> follow.

I would not merge yet. The core seam is sound, but there are five functional issues.

## Findings

1. **High — pinned slots stop being reserved after palette exhaustion.** Once all eight slots enter `taken`, probing gives up and restores the automatic run’s hashed first choice—even if that slot was reader-chosen (`hit-colours.ts:265`). Concrete input: `runs(9)`, with newest `spya-ak0008` pinned to slot `1`, also assigns automatic `spya-aj0007` to `1`. Repetition is unavoidable after eight, but it could repeat an automatic slot instead. The reservation test uses only eight total runs, so it cannot expose this (`hit-colours.test.ts:141`).

2. **High — filesystem retry deletes the chosen colour; Postgres preserves it.** The retry branch rebuilds `SearchRun` field-by-field without `existing.colour` (`searches.ts:328`). Postgres’s reset update omits `colour`, thereby retaining it (`pg-searches.ts:218`). Thus a coloured failed run loses its override when retried under the filesystem store. The existing retry tests never combine retry with a colour (`searches.test.ts:246`).

3. **Medium — rapid choices can persist in reverse order.** Every pick starts an independent PATCH with no per-run sequencing (`useSearch.ts:387`). Pick 2, then 4; if PATCH 4 reaches the database first and PATCH 2 finishes last, the UI remains 4 through `chosen`, while reload returns 2. The PATCH mock always resolves immediately, so the tests cannot catch reordering (`use-search.test.ts:96`).

4. **Medium — `.srch-swatches` is two unrelated components.** The picker uses that class (`SearchPanel.tsx:1641`), but so does the results legend (`SearchPanel.tsx:1353`). Consequently the legend receives the picker’s padding, border, background and shadow (`styles.css:4349`); conversely, the later legend rule changes the picker’s display and gap (`styles.css:4663`). The jsdom picker test does not load or evaluate these styles.

5. **Medium — the stores do not implement their stated validation contract.** The contract says both stores check `isStorableColour` (`contracts.ts:561`), but filesystem `recolourRun` writes directly (`searches.ts:514`); Postgres relies only on its constraint (`pg-searches.ts:417`). Directly storing `64`, `-1`, or `2.5` therefore succeeds on files and fails on Postgres. The test named “refuses to store” tests only the detached predicate, never storage (`searches.test.ts:186`).

6. **Low — Automatic’s selected state is wrong for assistive technology.** In automatic mode, the derived hue announces `aria-pressed=true` (`SearchPanel.tsx:1668`), while the visually current Automatic button has no pressed/selected state (`SearchPanel.tsx:1681`). The deliberate dual visual marking can remain, but the stored selection needs an accessible state.

7. **Low — a raw JSON `null` body produces 500, not validation’s 400.** Destructuring occurs directly on `readBody()`’s result (`routes.ts:2946`); JSON `null` throws before `isStorableColour`, and the generic handler maps it to 500. The missing-field test sends `{}`, not raw `null` (`routes.test.ts:843`).

## Checked and fine

- The colour-value seam holds: TypeScript stores slot numbers and CSS-token references only; actual palette values remain in `styles/colourscales.css`.
- Slot `0`, `{colour:null}`, missing/`undefined`, database null-to-absent conversion, and import/export’s preservation of `0` are correct.
- The loose `<64` bound is defensible forward compatibility, not a defect.
- Postgres recolouring without an attempt fence is safe: it updates only `colour`, while finish updates answer/attempt fields, so an in-flight model call is not invalidated.
- Import/export code is correct, but the corpus currently has no coloured `searches.json`, so the generic round-trip test cannot catch omission of this new field.
- Picker ownership is safe: keyed rows and closures keep it attached to the correct run. Escape, outside dismissal and focus return are wired correctly. `modal={false}` means focus is not actually trapped—Tab exits and closes—so the “focus trapped” comment is inaccurate. Global arrow navigation remains the sole arrow-key handler rather than double-firing.