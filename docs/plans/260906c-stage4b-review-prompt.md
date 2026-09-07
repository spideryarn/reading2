# Stage 4b review prompt — the passage selection and the band dispatch

You are reviewing **one commit**, `7a3f6919`, on branch `worktree-a1-a3-reader-composition` in the
Spideryarn repo. It is the last stage of a five-stage refactor of `src/web/App.tsx`
(5,920 → 407 lines). The plan is
`docs/plans/260906c-separate-article-access-reader-composition-and-mode-controllers.md`; the brief
it implements is `docs/plans/260905e-main-app-architecture-review.md` items **A1** and **A3**.

The full diff is at `/tmp/claude-1000/-home-greg-code-spideryarn2/c637f8f5-4ecb-4e6c-91a2-13dbe3fce0b0/scratchpad/stage4b.diff`
(1,962 lines). Read the files at HEAD too — the diff of `Reader.tsx` is a large block move and reads
badly as a diff.

## What the stage was asked to do

From A3, verbatim:

> Finish with the exhaustive `switch` at the composition point: `plain` and `hierarchy` render no
> band explicitly, `never` exhaustiveness is required, and the existing total tables in `modes.ts`,
> `title-text.ts`, `visitor.ts`, `Dock.tsx` and activation policy keep their coverage.

And two constraints from the user's brief that bound the whole job:

> Move functions without changing interfaces first.
>
> Do not hide sixteen unrelated values in a `readerContext` object and call the interface smaller.

Acceptance: *adding a fixture mode makes every required policy decision visible, and leaves the
article-access and position code untouched.*

## Every non-byte-identical edit in this commit, enumerated

There is no relocation in this stage — everything below is a real change. Nothing is claimed to be a
pure move.

### 1. `src/web/reader/passages.ts` — new, 143 lines

`selectPassages(mode: Mode, slots: PassageSlots): PassageSlot`. `PassageSlot` is
`{ readonly found: Found[]; readonly openKey: string | null }`. `PassageSlots` has five fields:
`ideas`, `quotes`, `timeline`, `referee`, `search`. Exhaustive `switch` over `Mode` with
`const unhandled: never = mode` in the default. Exports a module-level `NO_FOUND: Found[] = []`; a
module-level `const NOTHING: PassageSlot = { found: NO_FOUND, openKey: null }` is returned by the
nine non-producer arms.

### 2. `src/web/reader/Reader.tsx` — two changes, both real

**(a) The two ternary chains became one call.** Before:

```ts
const passages =
  mode === "ideas" ? ideaFound
  : mode === "quotes" ? quoteFound
  : mode === "timeline" ? timelineFound
  : mode === "referee" ? refereeFound
  : found;
const openPassage =
  mode === "ideas" ? openOccurrence
  : … : openHit;
```

After:

```ts
const { found: passages, openKey: openPassage } = selectPassages(mode, {
  ideas: { found: ideaFound, openKey: openOccurrence },
  quotes: { found: quoteFound, openKey: quoteOpenKey },
  timeline: { found: timelineFound, openKey: openTimelineKey },
  referee: { found: refereeFound, openKey: openRefereeKey },
  search: { found, openKey: openHit },
});
```

**This is a behaviour change and it is the point of the stage**: nine modes (`plain`, `hierarchy`,
`chat`, `glossary`, `summary`, `diagram`, `remember`, `outline`, `debate`) used to fall through to
Search's slot and now get `NOTHING`.

**(b) Seventeen sibling `&&` / ternary JSX expressions at the bottom of `Reader`'s return became a
local `function band(): ReactNode` with a `switch (mode)`**, called as `{band()}` at the same
position. `{!owner && gap && <VisitorBand gap={gap} signedIn={signedIn} />}` stayed above it,
unchanged. `band()` closes over `Reader`'s scope and threads zero props; it calls no hooks.

Three owner/visitor pairs changed shape from `{owner && <X/>}{!owner && artefacts?.x && <VisitorX/>}`
to `if (owner) return <X/>; return artefacts?.x ? <VisitorX/> : null;` (quotes, timeline; glossary
is `if (glossaryRead) … ; return artefacts?.glossary ? … : null`).

I verified the JSX preservation mechanically rather than by reading: the multiset of
`<ComponentName` occurrences, `prop={expr}` bindings and `prop="literal"` bindings over the whole
file is **identical** before and after — 241 features, zero differences — and I proved that checker
can fail by feeding it a one-prop mutation, which it reported. So no gate, `key`, `resetKey`,
`FeatureBoundary` or `artefacts?.x` test was dropped or added.

### 3. `tests/every-mode-says-which-passages-it-marks.test.ts` — new, 141 lines

Unit test over `selectPassages`. Four `it`s: each producer gets its own slot's *pair* (`toBe` on
both fields); the nine non-producers get `NO_FOUND` **by identity** (`toBe`, because four memos in
`Reader` key on the array identity); Search's results reach Search and stop there; and a coverage arm
asserting the union of the producer list and the nine equals `MODES` exactly, with no mode in two
arms.

### 4. `tests/the-marks-in-the-prose-belong-to-the-mode-showing.test.tsx` — new, 699 lines

The Reader-level wiring test your F1 on the plan demanded. Mounts the **whole app** at
`/read/<slug>` signed in as the owner (harness lifted from
`tests/a-broken-mode-leaves-the-article-readable.test.tsx`, which lifted it from
`tests/public-network-trace.test.tsx`). Each producer marks its own paragraph and no other. Drives
**Ideas → Timeline → Search with its saved-run GET held open → Criteria → Claims → Criteria → Plain
→ Back**, then releases the held reply in another mode. Three arms: plain, under `StrictMode`, and
across an article change A → B → A.

`agree(where, blocks, ring)` asserts four projections together at every commit: `mark.hit` per
`tr[data-block]`; `mark.hit[data-hit-open]`; `td.text.has-hit`; and the `.spine-match` count.

**Red proof, which I ran myself rather than taking on trust.** Applying your own mutation —
`<TimelineBand … onFound={setIdeaFound}>` — fails **only** in this file, all three arms:

```
AssertionError: timeline: the phrase marks: expected [] to deeply equal [ 'spya-cccccc' ]
```

`tests/passage-mode-cleanup.test.tsx` and the new selection unit test both stayed green under that
mutation.

### 5. `tests/glossary-band-wiring.test.ts` — 64 lines changed

One existing assertion was rewritten because the shape it matched no longer exists: it read
`/mode === "quotes"\s*\?\s*quoteOpenKey/` from `Reader.tsx`'s source text. It now asserts both
halves — that `Reader` builds `quotes: { found: quoteFound, openKey: quoteOpenKey }` and that
`passages.ts` answers `case "quotes": return slots.quotes;`.

A new `describe("the band dispatch")` was **added**, with three source-text assertions: `key={mode}`
on `ConversationBand`, the `switch`/`never` default inside `band()`, and `plain`/`hierarchy`
returning `null` in their own cases. It exists because an end-of-stage mutation found a
**pre-existing hole**: deleting `key={mode}` from `ConversationBand` left
`conversation-band-send-new`, `remember-url-rules`, `public-network-trace` and the new harness all
green, though one component mounted by two modes (chat and Remember-recall) is exactly what that key
is for.

### 6. Docs

`docs/project/new-mode.md`: the band branch left the "residue" list and joined the table of
compiler-checked totals, alongside `selectPassages`; a new table under *Before you call it finished*
of what a fifteenth mode makes red. `docs/project/url-state.md`: a paragraph recording that the mode
→ passage-slot mapping is total. The plan doc records what landed, the two corrections and the
acceptance run.

## Two corrections the build made to my plan, which you should check I have not fudged

1. **The one stale frame `selectPassages` removes is not observable from a React test.** `act`
   flushes the commit and the passive cleanup together, so a harness cannot stand in the frame
   between them. That half of the claim rests on the unit test over the nine non-producers; the
   harness proves the settled truth at every step. Both the test's docblock and the plan say so.
2. **`spya-krit34` is not a valid block id** — the charset excludes `i`, so a `?crits=` fixture
   silently never switched on while its rows still drew. Fixed in the fixture.

## The acceptance criterion, measured

Adding a fifteenth word to `MODES` (then reverted) produced six source typecheck errors and one in a
test, plus one red test with no typecheck at all:

| Red | Asks for |
|---|---|
| `src/title-text.ts` § `MODE_LABEL` | the word a person sees |
| `src/messages.ts` § `OWNER_MODE_NOTE` | the owner's note |
| `src/web/Dock.tsx` § `ModesMissingFromDock` | a bar row, with `experimental:` decided |
| `src/web/visitor.ts` § `POLICY` | what a visitor may see |
| `src/web/reader/Reader.tsx` § `band()` | the band, or explicit `null` |
| `src/web/reader/passages.ts` § `selectPassages` | the slot, or `NO_FOUND` |
| `tests/public-network-trace.test.tsx` § `BAND_SAYS` | what a visitor's band says |
| `tests/every-mode-says-which-passages-it-marks.test.ts` | red without a typecheck |

The article-access unit (`src/web/article/`) and the position code (`src/web/reader/useReadingPosition.ts`,
`measure.ts`) are untouched by this commit — check that.

## Results

- `npx vitest run` over the four directly relevant files: 4 files, 29 tests, `EXIT=0`.
- `npm run typecheck`: clean, all three projects, 1,418 files covered.
- `npx biome lint` on the touched files: two infos, both `noExcessiveCognitiveComplexity` — `Reader`
  at 46 (down from 54) and `band()` at 46 in its own right. Pre-existing non-gate finding.

## What I want from you

Rank findings P1/P2/P3 with the evidence for each. In particular:

1. **Is `selectPassages` actually total and actually correct per mode?** Read `src/modes.ts` and
   check the fourteen arms against it. Is any mode in the nine that in fact has a passage producer?
2. **Did the `band()` rewrite change any rendering condition?** My multiset check proves no
   component or prop binding changed, but it cannot see *nesting* or *which branch a binding sits
   in*. Check the three owner/visitor pairs and the `FeatureBoundary` around Ideas by reading.
3. **Can collapsing seventeen sibling positions into one child slot make React reuse an instance
   across a mode change?** I argue no — one element per case, no two modes returning the same
   top-level component type, and `ConversationBand` keyed on `mode`. Check that argument.
4. **Is the new wiring test load-bearing, or does it have a silent-success shape?** See
   `docs/reusable/silent-success.md`. It is 699 lines and the largest thing here; I care more about
   whether it can go red for the right reasons than about its style.
5. **Is the `NO_FOUND` identity claim real** — do the four memos in `Reader` genuinely key on the
   array identity, so that returning a fresh `[]` would recompute in Plain?
6. Anything in the docs that is now wrong.

Be adversarial. A finding that names a concrete failing input is worth more than a style note.
