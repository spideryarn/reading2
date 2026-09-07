## Verdict

**Refuse as written.** No P0 found. F1–F5 are established P1s: the plan misses authoritative acceptance coverage, creates a forbidden feature import, contradicts the five-slot invariant, can partially disarm a Referee test, and omits required documentation work.

## Findings

### F1 — P1 — established: the planned tests do not verify `Reader`’s actual passage wiring

(a) [`passage-mode-cleanup.test.tsx`](/home/greg/code/spideryarn2/.claude/worktrees/a1-a3-reader-composition/tests/passage-mode-cleanup.test.tsx:276) is explicitly a miniature reader with one shared setter. A pure `selectPassages` test likewise supplies slots directly. Neither catches wiring such as:

```tsx
<TimelineBand onFound={setIdeaFound} ... />
```

That compiles. Timeline’s band test passes; `selectPassages("timeline", fixtureSlots)` passes; cleanup passes. In the real reader, `timelineFound` stays empty and Timeline shows no prose or spine marks.

The authoritative A3 acceptance requires the real sequence, visible marks/ring/spine at each commit, StrictMode, and A → B → A article changes. The candidate replaces that with band-level and pure-function tests.

(b) Replace the Stage 4 test/acceptance bullets with:

> Add a Reader-level wiring test, not only the band-only lifecycle harness. Give Ideas, Timeline, Search, Criteria and Claims distinguishable published passages, then drive Ideas → Timeline → Search with pending work → Referee Criteria ↔ Claims → Plain → Back. At every commit assert the actual prose marks, selected ring and Spine matches agree. Run the same sequence under StrictMode and across article A → B → A. Each arm asserts that its producer mounted and published. Prove the test by swapping Timeline’s setter with Ideas’ and require the failure to name Timeline’s missing marks.

### F2 — P1 — established: the proposed Chat/Remember destinations force a forbidden feature-to-feature import

(a) The authority says feature modules must not import each other. The plan places `ConversationBand` in `modes/chat` and `RememberBand` in `modes/remember`, but [`RememberBand` directly renders `ConversationBand`](/home/greg/code/spideryarn2/.claude/worktrees/a1-a3-reader-composition/src/web/App.tsx:3987). Therefore `RememberMode.tsx` must import `ConversationMode.tsx`.

(b) Replace the two destination rows with:

> `src/web/modes/conversation/ConversationModes.tsx` — `ConversationBand`, `ConversationKind`, `isConversationThread`, `RememberBand`, and `QuizSubBand`. Chat and Remember are two compositions of one conversation controller and move together; no mode feature imports another.

A neutral shared `src/web/conversation/ConversationBand.tsx` would also work, but adds another seam without buying anything yet.

### F3 — P1 — established: the sixth-slot fix contradicts the explicit five-slot invariant and is not the smallest fix

(a) The Referee bug is real. In a React 19.2.8 probe matching the source effects, the sequence was:

```text
criteria layout publish
claims passive clear
settled criteria DOM empty
```

The plan is right that the incoming publication is lost. It is not entitled to say the clear necessarily happens “after paint”; React flushed it before the settled paint in this case.

But the proposed sixth `Found[]` slot directly contradicts “the five producer slots stay five.” It also makes `Reader` subscribe to `?referee=` solely to compensate for effect timing.

The smaller fix is for Claims’ unmount clear to be a layout cleanup. React destroys outgoing layout effects before mounting incoming layout effects, so Claims clears first and Criteria publishes last.

(b) Replace the Referee subsection with:

> The five reader slots remain five. Claims is the exceptional `unkeyed` lifecycle shape: its unmount clear is a layout cleanup, because it shares Referee’s slot with Criteria. All keyed/derived producers retain passive unmount cleanup because their reader slots are separate. Reproduce Claims → Criteria red first and assert Criteria’s marks survive the settled commit and StrictMode.

The helper’s unkeyed cleanup should have this shape:

```tsx
const { kind, onFound } = input;

useLayoutEffect(() => {
  if (kind !== "unkeyed") return;
  return () => onFound([]);
}, [kind, onFound]);
```

Its passive unmount effect must skip `unkeyed`.

### F4 — P1 — established: moving Referee can silently remove the controller itself from the copy scanner

(a) [`referee-copy-is-about-the-model.test.ts`](/home/greg/code/spideryarn2/.claude/worktrees/a1-a3-reader-composition/tests/referee-copy-is-about-the-model.test.ts:156) currently parses `App.tsx`, but its second discovery rule uses non-recursive `readdirSync(WEB)` at line 180.

If the AST anchor is merely repointed to nested `modes/referee/RefereeMode.tsx`:

- imported panels still satisfy `RENDERED_BY_THE_BAND`;
- root-level referee files still satisfy `IMPORTS_THE_DOMAIN`;
- every positive-count floor remains green;
- `RefereeMode.tsx` itself is absent from `REFEREE_SURFACES`.

A mutation in an already-discovered panel can still make the test red and appear to validate the migration, while a forbidden executable sentence added directly to `RefereeMode.tsx` passes.

(b) Add this exact requirement to Stage 1:

> `referee-copy-is-about-the-model` must recursively discover nested client files, seed the scanned surface set with `RefereeMode.tsx` itself, and resolve relative imports from the importing file rather than from `src/web`. Its mutation is an executable “nothing in this paper…” sentence inserted into `RefereeMode.tsx`; the expected failure must name that file and phrase. Mutating only an imported panel is not evidence that the moved controller is covered.

### F5 — P1 — established: required documentation work is absent

(a) The authoritative checklist requires updates to `new-mode`, `web-client`, URL state, and feature signposts. The candidate mentions only `new-mode`. All tests can remain green while feature docs continue directing maintainers to `App.tsx`, because `App.tsx` still exists and those links are not broken.

(b) Add:

> Each controller batch updates its feature doc’s code signposts. Stage 3 updates `web-client.md` for the new `article/`, `reader/` and `modes/` boundaries. Stage 4 updates `new-mode.md` and `url-state.md` for exhaustive dispatch/selection. These are signpost corrections and require no important-doc wording approval.

### F6 — P2 — established: the stage/commit boundaries are unnecessarily broad

(a) The checklist is an inventory, not an ordering constraint. Its A1 prose actually says to begin with Ideas/Timeline and use Chat later. Access-first by itself would create a cycle, but that does not make leaves-first a “deviation.”

Stage 1 nevertheless puts eight controllers into one commit despite the authority saying “small batches.” Stage 3’s Reader-first move is independently cycle-free and is a good stopping point; access can follow in a second commit.

(b) Replace the ordering section’s opening with:

> The checklist does not prescribe commit order. Implementation follows dependency order: controller batches, Chat/Remember, Reader/position, then article access. Each batch ends green and committed. Reader/position and article access are separate commits; neither contains an import cycle.

### F7 — P2 — established: the test census is inaccurate

(a) The plan says four test files import the Stage 1 exports; there are five:

- `passage-mode-cleanup`
- `glossary-band-selection`
- `pressing-a-chip-arms-it`
- `referee-tooltips`
- `arrows-belong-to-the-article`

It also lists eleven source-test names, calls them twelve, and omits [`page-title.test.ts`](/home/greg/code/spideryarn2/.claude/worktrees/a1-a3-reader-composition/tests/page-title.test.ts:419), which reads `ArticlePage` from `App.tsx`.

`no-raw-nul-bytes` and `eager-client-graph` should be rerun, not repointed: both already discover moved files. `glossary-band-wiring` spans ArticlePage, Reader, and several mode files, so it cannot be repointed to one destination.

(b) Replace the census with the five importer names above and state:

> Ten direct source checks move or split, including `page-title.test.ts`. `no-raw-nul-bytes` and `eager-client-graph` remain unchanged and must still pass. `glossary-band-wiring` reads the owning files separately rather than concatenating them into a synthetic “App” source.

### F8 — P3 — established: there are nine non-producer modes, not ten

(a) Fourteen modes minus five producer slots equals nine. The current default arm serves ten modes only because Search itself is the tenth.

(b) Replace:

> `NO_FOUND` for the ten non-producers

with:

> Search explicitly returns `slots.search`; the nine non-producer modes—Plain, Hierarchy, Chat, Glossary, Summary, Diagram, Remember, Outline and Debate—return `NO_FOUND`.

## Answers to the six suspicions

1. Leaves-first is right, but the checklist is not an ordering constraint. Calling it an inversion is unnecessary.
2. The local `band()` function is React-safe. Its function identity is irrelevant because it is invoked, not rendered as a component. Only one feature branch can render for a `Mode`; preserve `FeatureBoundary`, `key={mode}`, and the separate `VisitorBand`.
3. The conditional dependency element is sound: the array retains constant length/order, and each producer’s `kind` is stable. Raw parent setters must remain the callbacks.
4. The fresh result object is harmless while immediately destructured; the contained array identities govern the existing memos.
5. The Referee publication is genuinely lost, but “after paint” is not guaranteed. Keep five slots and use a layout unmount cleanup for Claims.
6. Split Stage 3 into two commits: Reader/position first, article access second.

The permitted baseline test passed: `passage-mode-cleanup.test.tsx`, 4/4. No repository file was changed.