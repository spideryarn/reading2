F1 — **blocker** — The `reference` chain works, but the claimed final count of 132 does not.

Evidence:

- Pages 127–128 provide ordinary footnotes 1–20.
- Page 129’s heading is transparent, so 20 anchors reference 21.
- References then advance without a label gap through 93.
- The unlabelled `continues` records correctly complete 60 on page 132 and 67 on page 133.
- The first record of the next chunk is an ordinary `footnote continues` that completes recovered note 93, before note 94 begins ([notes-chunks.json](/var/tmp/spideryarn-worktrees/fbrg5kk6-rovelli-import-inspect/data/261023b/notes-chunks.json:472)).
- However, note 122 has both a real label and body and `continues: true` ([notes-chunks.json](/var/tmp/spideryarn-worktrees/fbrg5kk6-rovelli-import-inspect/data/261023b/notes-chunks.json:689)). `collectNotes` checks `continues` before parsing the label, so it appends all of note 122 to note 121; the following page’s unlabelled continuation joins that combined note ([pdf-read.ts](/var/tmp/spideryarn-worktrees/fbrg5kk6-rovelli-import-inspect/src/pdf-read.ts:2405)). The proposed changes therefore produce 131 notes, not 132, and marker 122 remains unlinked.

Change: make a valid non-empty label authoritative over `continues`: a labelled record always starts a new note, exactly as `endnotesTypedAsProse` already does. Only an unlabelled `continues` record may join the previous note. Add the real 121/122/continuation/123 sequence as a test.

F2 — **should-fix** — A footnote anchor alone is not sufficient protection against real reference lists.

The ordinary cases are safe:

- A numbered bibliography beginning at 1 breaks the chain.
- `[n]` does not match `NOTE_LABEL`.
- Four-digit author-year entries such as `1970 …` do not match its one-to-three-digit numeric alternative.
- Symbol labels cannot participate in `last + 1`.

But a plausible false positive remains: a paper’s first bibliography page contains numbered references followed in reading order by a page footnote `20`; the next page continues the references at `21`. Because every heading currently passes—including “References” or “Bibliography”—21 onward would become notes. This is especially plausible when footnotes and the references share a page, or when the model omitted the bibliography’s opening records; content-check failures are nonfatal.

Change: activate this repair only inside an explicit `Notes`/`Endnotes` section, preserving activation across Rovelli’s chapter headings, and terminate it at an explicit `References`/`Bibliography` heading. Alternatively, require the recovered run to be closed by a later correctly typed numeric footnote; Rovelli has footnote 94. Also ensure a symbol-labelled or otherwise unnumbered footnote resets the numeric anchor rather than leaving an older number live.

F3 — **nit** — `renderHtml` is the right seam, and the proposed ordering does not disturb extraction.

`checkChunk` and `bibliographyPages` run before front-matter handling and rendering, over the original record types ([pdf-read.ts](/var/tmp/spideryarn-worktrees/fbrg5kk6-rovelli-import-inspect/src/pdf-read.ts:4131)). `reference` and `footnote` are both outside `CHECKED` ([pdf.ts](/var/tmp/spideryarn-worktrees/fbrg5kk6-rovelli-import-inspect/src/pdf.ts:365)), while recall already counts all transcribed text. Thus the repair neither changes the gate nor reduces the `reference` share used by `bibliographyPages`.

`continuationTargets` is computed before render-time retyping, and the repair preserves indexes, so its entries remain aligned. Note continuations are joined separately by `collectNotes`; they do not need targets.

Change: invoke the new helper after `endnotesTypedAsProse`, so a recovered prose note may legitimately anchor a recovered reference run:

```ts
endnotesTypedAsReferences(endnotesTypedAsProse(transcribed))
```

Add an interaction test, but do not move the repair before checking or recompute `continuationTargets` from repaired types.

F4 — **blocker** — Unconditionally skipping a label-only footnote can corrupt a legitimate split note.

A valid model output can be:

```text
footnote "12"
footnote "The body of note twelve.", continues: true
```

If `"12"` is simply skipped, the continuation either joins note 11—because `collectNotes` retains the prior note—or becomes an unlabelled note when no prior note exists. The plan’s current test covers only Rovelli’s `paragraph · footnote "53" · paragraph` shape and does not detect this failure ([pdf-footnotes.test.ts](/var/tmp/spideryarn-worktrees/fbrg5kk6-rovelli-import-inspect/tests/pdf-footnotes.test.ts:547)).

Change: hold a bare label provisionally. If the next eligible footnote is an unlabelled continuation on the same or next page, create a new note using the held label and that body. Otherwise discard the bare label. Use the same label grammar for digits, superscript digits, symbols, and optional punctuation so this recognition cannot drift from `NOTE_LABEL`.

F5 — **nit** — The Refresh/Rebuild claim is correct, with a small wording caveat.

`chunkKey` includes source hash, pages, context, prompt fingerprint, reader id, and token ceiling ([pdf-read.ts](/var/tmp/spideryarn-worktrees/fbrg5kk6-rovelli-import-inspect/src/pdf-read.ts:3024)). The evidence says none of today’s 36 keys matches the 33 old rows.

There is no successful shelf path that silently reuses the old revision’s rendered records:

- A web article sends `force: ["fetch"]`.
- An upload such as Rovelli sends `force: ["extract"]` and rebuilds from stored source ([ShelfEntry.tsx](/var/tmp/spideryarn-worktrees/fbrg5kk6-rovelli-import-inspect/src/web/ShelfEntry.tsx:693)).
- `cascadeForce` forces the downstream extraction stages ([jobs.ts](/var/tmp/spideryarn-worktrees/fbrg5kk6-rovelli-import-inspect/src/jobs.ts:1138)).

A failed fetch can prevent extraction, but then no new revision is published. A retry could reuse checkpoints written earlier in that same new attempt, not the old 33. Change the plan’s wording from “Refresh” to “the first successful Refresh/Rebuild against the inspected checkpoint state” for precision.

F6 — **should-fix** — The planned tests do not exercise several load-bearing transitions.

The current Rovelli-shaped test has a heading after recovered note 22, but no recovered reference after that heading, so it does not prove that headings preserve the chain ([pdf-footnotes.test.ts](/var/tmp/spideryarn-worktrees/fbrg5kk6-rovelli-import-inspect/tests/pdf-footnotes.test.ts:490)).

Add tests for:

- reference 34 → chapter heading → reference 35;
- 60 → unlabelled continuation → 61;
- 67 → unlabelled continuation → 68;
- recovered 93 → ordinary `footnote continues` → 94;
- labelled `footnote 122` with `continues: true`;
- a bare label followed by a legitimate footnote continuation;
- “References” followed by `N+1`;
- a same-page footnote/reference-list collision;
- author-year, `[n]`, and symbol-label negatives.

The production replay should reproduce chunk context removal/deduplication rather than naïvely concatenating stored checkpoint arrays.

F7 — **should-fix** — Two required completion items are missing.

This is a bug with an identified class, so the repository instructions require a postmortem under `docs/postmortems/`; the plan currently adds only a line to `content-extraction.md`. The completion stage also omits linting the touched files. Add the postmortem, its owner signpost, and targeted lint to the stages.

BUILD WITH CHANGES