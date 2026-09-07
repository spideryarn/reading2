## Verdict

Refuse. I found no user-visible behaviour change, but F14 and F15 are established P1 violations of the authoritative “pure relocation” contract.

## Findings

### F14 — P1 — established: `NO_SEARCHES` is an unlicensed interface change

The candidate moves `NO_SEARCHES` from module-private state in `App.tsx` to an exported member of [reader-capability.ts](/home/greg/code/spideryarn2/.claude/worktrees/a1-a3-reader-composition/src/web/reader-capability.ts:190). That is `const` → `export const`, despite the brief permitting that edit only for moved bands rendered by `Reader`.

(a) `git diff f103698b~1..1360ec84 -- src/web/reader-capability.ts src/web/App.tsx` shows the private constant deleted and the new public export/import added. It changes no runtime behaviour, but it does change a module interface and moves something whose sole consumer remains `Reader`.

(b) Leave the constant and its docblock private in `App.tsx` until `Reader` moves in Stage 3; remove the new export/import.

### F15 — P1 — established: F5 remains partly unclosed

Stage 1 requires each batch to update its feature docs’ code signposts. The candidate updates Glossary, Quotes, Timeline, Search and Referee, but [diagram.md](/home/greg/code/spideryarn2/.claude/worktrees/a1-a3-reader-composition/docs/project/diagram.md:15) still names only `DiagramPanel.tsx`, and [summaries.md](/home/greg/code/spideryarn2/.claude/worktrees/a1-a3-reader-composition/docs/project/summaries.md:37) still names only `SummaryPanel.tsx` and `tree.ts`.

(a) `git grep 'DiagramMode\\|SummaryMode' 1360ec84 -- docs/project/diagram.md docs/project/summaries.md` returns no matches, although both documents have explicit code inventories.

(b) Add `DiagramMode.tsx` and `SummaryMode.tsx` to those existing inventories. These are signpost-only edits.

### F16 — P2 — established: two `site-footer` guards lost the moved controllers

[site-footer.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/a1-a3-reader-composition/tests/site-footer.test.tsx:174) scans only immediate `src/web/*.tsx` files for forbidden `<SiteFooter>` mounts. Its `ADMIN_EMAIL` guard repeats the same flat scan at [line 262](/home/greg/code/spideryarn2/.claude/worktrees/a1-a3-reader-composition/tests/site-footer.test.tsx:262). Before extraction, all eight controller bodies lived in scanned `App.tsx`; now none is scanned.

(a) Add an imported `<SiteFooter />`, or an `ADMIN_EMAIL` import, to `modes/referee/RefereeMode.tsx`. Both guards remain green because `readdirSync(WEB)` never visits `modes/`. The same mutation in the old `RefereeBand` inside `App.tsx` was caught.

(b) Share one recursive `.ts`/`.tsx` collector between both checks and add a nested mode file as a positive witness.

### F17 — P2 — established: the Referee recursion and resolver repairs are not mutation-sensitive

The seed is load-bearing: removing it fails the explicit controller assertion. The other two repairs are not.

- Replacing `clientComponents` with the old flat walker leaves every current structural assertion green. The “nested” assertion inspects `REFEREE_SURFACES`, which already contains the explicitly seeded nested controller.
- Replacing `localTarget` with the old basename-under-`src/web` resolver also preserves today’s set because every directly rendered imported panel still lives at the root with a unique basename.

(a) My independent harness applied the flat-walker model: all five structural floors remained true, including the nested-path floor.

(b) Assert directly that `clientComponents(WEB)` contains the controller. Separately calibrate `localTarget` with a path the basename resolver cannot answer, such as resolving `./RefereeMode.js` from the controller itself.

### F18 — P2 — reasoned: reader-visible Referee copy can leave the scan through a `.ts` module

The recursive rule intentionally discovers only `.tsx` files, while the rendered-component rule follows JSX components rather than imported values.

(a) Move `REFEREE_VIEW_TIP` into `modes/referee/RefereeCopy.ts`, import it into the controller, and put “nothing in this paper…” in one value. The controller remains seeded, but the executable sentence is in an ignored `.ts` file; the copy assertion stays green.

(b) Either follow local copy modules under `modes/referee/`, or assert that the reader-visible Records remain declared in the scanned controller so such a move fails loudly.

### F19 — P2 — reasoned: eager mode loading is true but not enforced

The static closure currently contains all eight new `*Mode.tsx` files. However, [eager-client-graph.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/a1-a3-reader-composition/tests/eager-client-graph.test.ts:508) positively names only generic reader modules, and merely requires that the dynamic set contain `main.tsx`.

(a) Convert `DebateMode.tsx` to a literal `React.lazy(() => import(...))` boundary. The closure remains comfortably above 200 files, the required positives remain, and the extra dynamic mode is not rejected. This violates the documented offline-mode contract without this test necessarily failing.

(b) Recursively discover `src/web/modes/**/*Mode.tsx`, require every one in the eager closure, and reject dynamic edges into that directory.

### F20 — P3 — established: one moved Timeline docblock is substantively false

[TimelineMode.tsx](/home/greg/code/spideryarn2/.claude/worktrees/a1-a3-reader-composition/src/web/modes/timeline/TimelineMode.tsx:27) says Timeline is owners-only, that no `VisitorTimelineBand` exists, and that `POLICY` is `owners-only`. The same file defines `VisitorTimelineBand`, while `POLICY.timeline` is now `artefact`.

Leaving it byte-identical was correct for this strict relocation stage; it remains a real follow-up defect, unlike most “above/below” references.

(b) Later, describe `TimelineBand` as the owner/job controller and `VisitorTimelineBand` as the payload-only visitor controller.

## Other results

- All controller units are byte-identical to the pre-change `App.tsx` after removing only the declared band export prefixes. Stage 1b’s four bodies each have exactly one contiguous pre-change match, with order and adjacency preserved.
- No dead runtime import was found; every new relative specifier resolves to exactly one `.ts` or `.tsx` file.
- The direct source-test anchors that remain in `App.tsx` still resolve, including the overlooked `note-arrival` check.
- Keeping the 531-line Referee controller intact was the right relocation-stage decision.
- The Search ASCII diagram remains aligned.
- Eleven inspected source/graph suites passed, 171 tests. `no-raw-nul-bytes` could not load because this sandbox rejects its `spawnSync git` call with `EPERM`.
- I changed no repository file; the audit harnesses were under `/tmp`.