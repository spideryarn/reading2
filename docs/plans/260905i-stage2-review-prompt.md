# Review request: A7 stage 2 — the annotation reuse itself

You have reviewed this job's plan (F1–F13) and its stage 1a (F14–F19). This is the **end-of-stage
review of stage 2, the optimisation**. Weight it higher than the plan reviews: a plan-stage review
cannot find a cache that returns a stale mark.

## The candidate

Repo root: `/home/greg/code/spideryarn2/.claude/worktrees/a7-annotation-measure`.

**Committed candidate.** The stage is one commit, `14253086`:

```
git show 14253086
```

Changed paths, all three:

- `src/web/TableView.tsx` — `anchorKey`, `resolveAnchors`, `applyOpen`, `marksCache`, `marksByBlock`,
  `NO_MARKS`, `ProseEntry`, `pressedIn`, `sameInputs`, `proseCache`, `proseHtml`
- `src/web/search-hits.ts` — `hitMarks`, and the new `unpressed` / `baseMarks`
- `tests/annotation-reuse.test.tsx` (new, 9 tests)

Context in earlier commits: `c7835411` (the instrument, with your F17/F18/F19 fixes),
`6a33c2d8` (the instrument and the stage-1a measurement), `89955db2` (the plan).
The plan's § "Stage 2" and § "Stage 2 result" say what was intended.

## What it does

Two changes, and the second is where the measured win is.

1. **`marksByBlock` resolves anchors on a key that omits everything a streamed token changes.**
   `anchorKey(comments, chats)` reduces the inputs to `(kind, id, blockId, start, quote.length,
   quote)` per anchor. `resolveAnchors` runs only when that key or `byId` changes. `applyOpen` then
   puts `open` on in a second pass and **returns the previous per-block array by identity** for every
   block that neither lost nor gained the ring.
2. **`proseHtml` keeps each block's inputs beside its `{ __html }`** and skips a block whose inputs
   all match — calling neither `annotateHtml` nor `addZoomHandles`. `hitMarks()` had to be split
   first so its per-block arrays no longer change when the pressed result does.

## What to attack — correctness first, and hard

This is a cache in front of the code that decides **where a reader's own words are underlined**. A
stale entry is a wrong underline, which is user-visible wrong behaviour.

1. **Can any input change and leave a block's html stale?** Enumerate what a block's rendered html
   actually depends on and check each against `ProseEntry` and `sameInputs`. Name anything that
   affects the output and is not in the key.
2. **`anchorKey` specifically.** Can two genuinely different anchor sets produce the same key? The
   quote's length precedes the quote, and each record is tagged `c` or `t` — is that sufficient
   against separator collisions, given `\n` is the separator and a quote may contain newlines? Can
   an anchor set change in a way the key misses — a reordering, a duplicate id, an added comment
   whose anchor is identical to an existing one, a comment whose `blockId` no longer exists?
3. **`byId` as a stand-in for block content.** `marksByBlock` treats the `byId` map's identity as
   proof the blocks' html has not changed. Is that sound here, given `byId` is
   `useMemo(new Map(blocks.map(...)), [blocks])`? What breaks it?
4. **`applyOpen`'s identity preservation.** When both open ids are null it returns `base` itself —
   the *same object* that is stored in the cache as `base`. Can any caller mutate what it gets back,
   or can `base` and `out` being the same object cause a later reuse to be wrong?
5. **`unpressed` in `search-hits.ts`.** A `WeakMap<Found[], Map<DivergingScale, …>>` whose arrays are
   shared and documented as must-not-mutate. Does every caller honour that? Is the `Found[]` identity
   key sound — does anything mutate a `Found[]` in place? Can `openKey` naming a mark that is not in
   `base` silently drop the ring?
6. **Overlapping marks.** A comment, a glossary term and a search hit over the same words must
   produce **one** `<mark>` carrying all the classes. Does the reuse path preserve that in every
   order of arrival, including when only one of the three changes?
7. **The tests.** You found in stage 1a that this job's tests could stay green through three
   mutations that broke the instrument. Do the same here: **mutate the two reuse branches and the
   equality contract and see whether `tests/annotation-reuse.test.tsx` actually catches it.** Try at
   least: dropping `html` from `sameInputs`; dropping `openTerm` from it; making `NO_MARKS` a fresh
   `[]`; making `applyOpen` rebuild every array; making `anchorKey` omit `start`. Report which
   mutations the suite misses. That is the finding I most want.
8. **Anything that will age badly** — a comment that will stop being true, an invariant held only by
   convention, a future mark kind that would silently bypass the key.

## Severity scale

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Grade by consequence, not by the file. Refuse only on an **established** P0 or P1. Every finding
gets a stable ID continuing the series — new ones start at **F20**; reuse an earlier ID only for the
same finding. Finish with an explicit verdict line.

You have no network, but every test here runs in jsdom and needs nothing outside the tree —
`npx vitest run tests/annotation-reuse.test.tsx` works. Say which findings you established by
running something.

## My own suspicions, worth less than yours

- `sameInputs` compares the three mark arrays by **identity** and the html by **value**. The
  asymmetry is deliberate and documented, but identity comparison is only as good as the promise
  that the producers hand back the same array — three different producers now have to keep that
  promise, and only one of them is in this diff.
- `applyOpen` returning `base` itself when nothing is open is the thing I would most expect to be
  subtly wrong.
- The `marksByBlock` counter now increments on the reuse path, so its `n` counts memo bodies that
  ran and did nothing. I think that is honest; tell me if it makes the instrument misleading.
