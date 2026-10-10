## Findings

**F1 — P1 — Last-view restoration bypasses the planned legacy lift.**  
The plan covers boot, navigation, and popstate lifts, and mentions `last-view` only as an inventory update ([plan:172](/var/tmp/spideryarn-worktrees/fbc2qmbg-peer-review-mode/docs/plans/261009l-peer-review-mode-merges-citations-and-debate.md:172), [plan:197](/var/tmp/spideryarn-worktrees/fbc2qmbg-peer-review-mode/docs/plans/261009l-peer-review-mode-merges-citations-and-debate.md:197)). But `restoredHref` filters and appends the stored query directly ([last-view.ts:421](/var/tmp/spideryarn-worktrees/fbc2qmbg-peer-review-mode/src/web/last-view.ts:421)), and the layout effect then calls `replaceState` after boot-time `settleAddress` has already run ([last-view.ts:777](/var/tmp/spideryarn-worktrees/fbc2qmbg-peer-review-mode/src/web/last-view.ts:777)). A remembered `?mode=debate&debate=claims` therefore parses through `RETIRED_MODES` as Peer review but lands on its default Bibliography.

Concrete fix: expose one pure canonicalizer used by `settleAddress`, `liftedLegacyHref`, and `restoredHref`. Run `liftLegacyDebateBy` before the Debate→Peer-review lift, let an explicit new `peer-review=` win, and remove the obsolete `debate` view parameter after translating it. Test boot, `navigate`, popstate, and stored last views for Citations, Reception, Claims, and `debateby=claim`.

**F2 — P1 — The Reception repeat-spend claim is false.**  
The plan says a search is repeated only from a stale banner ([plan:133](/var/tmp/spideryarn-worktrees/fbc2qmbg-peer-review-mode/docs/plans/261009l-peer-review-mode-merges-citations-and-debate.md:133)). Metadata deliberately offers every completed step again, with no per-reader limiter ([Metadata.tsx:1975](/var/tmp/spideryarn-worktrees/fbc2qmbg-peer-review-mode/src/web/Metadata.tsx:1975), [Metadata.tsx:1991](/var/tmp/spideryarn-worktrees/fbc2qmbg-peer-review-mode/src/web/Metadata.tsx:1991)), and posts a forced run on every sequential press ([Metadata.tsx:2035](/var/tmp/spideryarn-worktrees/fbc2qmbg-peer-review-mode/src/web/Metadata.tsx:2035)). The command bar exposes the same rerun machinery.

No navigation path accidentally spends: `useAutoRun` requires a claimed press ([useAutoRun.ts:154](/var/tmp/spideryarn-worktrees/fbc2qmbg-peer-review-mode/src/web/useAutoRun.ts:154)); pasted URLs, Back, popstate, and last-view restore do not arm it. A command-bar selection is an intentional press. But an owner can repeatedly force Reception after each run completes.

Concrete fix: correct the plan and explicitly accept the existing unbounded, deliberate rerun path—or add a server-side per-reader allowance before wider exposure. Do not claim `useRewriteHold` is a rate limit; it only prevents overlap while one rewrite is settling.

**F3 — P1 — The visitor policy cannot express the proposed any-of-three-artifacts rule.**  
`VisitorPolicy` accepts exactly one artefact key ([visitor.ts:139](/var/tmp/spideryarn-worktrees/fbc2qmbg-peer-review-mode/src/web/visitor.ts:139)), and `visitorGap` tests exactly that key ([visitor.ts:386](/var/tmp/spideryarn-worktrees/fbc2qmbg-peer-review-mode/src/web/visitor.ts:386)). `PublicArtefacts.debate` already combines `debate` and `debateClaims` ([public-artefacts.ts:86](/var/tmp/spideryarn-worktrees/fbc2qmbg-peer-review-mode/src/web/public-artefacts.ts:86)), but nothing combines that with `citations`. The plan’s “artefact policy” at [plan:190](/var/tmp/spideryarn-worktrees/fbc2qmbg-peer-review-mode/docs/plans/261009l-peer-review-mode-merges-citations-and-debate.md:190) is therefore not an existing policy shape.

There is also a partial-payload problem: if a visitor has Debate but no Citations, Peer review must open, yet `VisitorCitationsBand` requires a non-null citations artefact ([CitationsMode.tsx:101](/var/tmp/spideryarn-worktrees/fbc2qmbg-peer-review-mode/src/web/modes/citations/CitationsMode.tsx:101)).

Concrete fix: add an explicit `any-artefact` policy, probably over `["citations", "debate"]`, and define per-submode missing states inside the still-open Peer review surface. Add visitor tests for all combinations: citations only, reception only, claims only, mixed, and none.

**F4 — P1 — A shared counted header cannot be obtained merely by passing the wrapper’s reads into the existing panels.**  
The shape is structurally valid, but the plan understates the state lift. Bibliography’s count is calculated inside `CitationsPanel` ([CitationsPanel.tsx:887](/var/tmp/spideryarn-worktrees/fbc2qmbg-peer-review-mode/src/web/BibliographyPanel.tsx:887)). Reception’s count is after thread filtering ([DebatePanel.tsx:1103](/var/tmp/spideryarn-worktrees/fbc2qmbg-peer-review-mode/src/web/DebatePanel.tsx:1103)); Claims’ count incorporates the claims list, checks, filtered legacy rows, and count units ([DebatePanel.tsx:1146](/var/tmp/spideryarn-worktrees/fbc2qmbg-peer-review-mode/src/web/DebatePanel.tsx:1146)). Those values do not exist in the wrapper when it constructs a `head` React node.

Concrete fix: make the plan name a shared view-model/selectors layer that owns all three count derivations and is used by both the chip row and the panels. Do not duplicate simplified raw counts unless the product intentionally changes what the numbers mean.

`ModeSurface` itself is not a blocker: `head` accepts a node and produces one `.band-head`. Keep exactly one panel-owned `ModeSurface`; do not add an outer surface. Update the exact direct-child/header fixtures, and add targeted surface and boundary tests for all three owner views and visitor artifact combinations. The total `DRAWS` table alone will exercise only the default view.

**F5 — P1 — Stored chat origins are covered for “way back,” but their list filter and icon mapping are not.**  
The plan retains stored origins as `"debate" | "citations"` and updates `openOrigin` ([plan:195](/var/tmp/spideryarn-worktrees/fbc2qmbg-peer-review-mode/docs/plans/261009l-peer-review-mode-merges-citations-and-debate.md:195)). However, `threadSource` currently turns those values into live `Mode` values and separate Chat filters ([thread-source.ts:108](/var/tmp/spideryarn-worktrees/fbc2qmbg-peer-review-mode/src/web/thread-source.ts:108)); its labels also index the soon-retired modes ([thread-source.ts:167](/var/tmp/spideryarn-worktrees/fbc2qmbg-peer-review-mode/src/web/thread-source.ts:167)). Retiring the modes makes some of this fail compilation, but compilation will not decide the combined-filter behavior.

Concrete fix: map both stored origin shapes to `mode: "peer-review"` and `from: "peer-review"`, while retaining submode-specific tooltip wording. Canonicalize old `chatfrom=debate|citations` to the combined filter, including remembered last views. Test icons, filtering, and way-back destinations: cited work→Bibliography, lens→Reception, claim→Claims.

**F6 — P2 — The C1 join key is right, but its completeness and ordering claims are too strong.**  
`work.citedAt.includes(claim.blockId)` is the correct stable-ID join. `citedAt` has been required since the original Citations artefact, and the visitor projection already assumes it exists ([dto.ts:670](/var/tmp/spideryarn-worktrees/fbc2qmbg-peer-review-mode/src/public/dto.ts:670)); there is no legitimate older stored shape lacking it. A malformed row missing it can already crash public projection.

However, later direct-citation blocks may be absent because direct mentions are capped ([types.ts:4880](/var/tmp/spideryarn-worktrees/fbc2qmbg-peer-review-mode/src/types.ts:4880), [types.ts:5352](/var/tmp/spideryarn-worktrees/fbc2qmbg-peer-review-mode/src/types.ts:5352)), contradicting [plan:160](/var/tmp/spideryarn-worktrees/fbc2qmbg-peer-review-mode/docs/plans/261009l-peer-review-mode-merges-citations-and-debate.md:160). Filtering the globally first-cited list also cannot guarantee order within a later paragraph; the stored array is ordered by each work’s first citation in the whole document ([citations.ts:1822](/var/tmp/spideryarn-worktrees/fbc2qmbg-peer-review-mode/src/bibliography.ts:1822)).

Concrete fix: specify “in Bibliography order” and describe the join as best-effort for capped direct mentions. If complete paragraph coverage and paragraph-local order are requirements, the stored citation occurrence data must be extended first.

**F7 — P2 — `citeFocus` is reusable, but its lifecycle must become submode-aware.**  
The existing focus state is reusable, but it lives in `Reader`; `DebatePanel` has no callback that switches to Bibliography and sets it. More subtly, focus cleanup currently runs only when the top-level mode changes ([Reader.tsx:1624](/var/tmp/spideryarn-worktrees/fbc2qmbg-peer-review-mode/src/web/reader/Reader.tsx:1624)). Moving between Claims and Bibliography will no longer change `mode`, so an unconsumed focus can survive and cause a later unexpected jump.

Concrete fix: add one Reader-owned `openBibliographyWork(id)` handoff that sets focus and pushes the Bibliography view together. Clear citation and claim focus when leaving their respective Peer review submode, not merely when leaving Peer review. Test leaving before the target list finishes loading, Back, and two presses on the same work.

**F8 — P2 — Rerun-command semantics need a decision, not just a call-site mention.**  
`RERUN_MODE` assumes one artefact step per mode ([rerun-commands.ts:91](/var/tmp/spideryarn-worktrees/fbc2qmbg-peer-review-mode/src/web/rerun-commands.ts:91)). Mapping both `debate` and `citations` to Peer review would teach both paid commands the same “rerun peer review” aliases. The file already deliberately avoids this for Summary’s multiple steps ([rerun-commands.ts:96](/var/tmp/spideryarn-worktrees/fbc2qmbg-peer-review-mode/src/web/rerun-commands.ts:96)).

Concrete fix: remove both steps from `RERUN_MODE`; label them “Bibliography” and “Reception,” retain selected legacy aliases by hand, and do not make bare “rerun peer review” choose one arbitrarily. Add ranking tests.

**F9 — P2 — The deep-rename deferral is defensible only as an explicit exception with an enforceable handoff.**  
The project rule says an on-screen rename is renamed through identifiers, URLs, CSS, and storage in the same piece of work ([rename-or-move.md:51](/var/tmp/spideryarn-worktrees/fbc2qmbg-peer-review-mode/docs/reusable/rename-or-move.md:51)). Waiting because the product name is provisional is reasonable, but the current promise that Stage 3 “gets its own queue entry” is not yet the queue entry ([plan:68](/var/tmp/spideryarn-worktrees/fbc2qmbg-peer-review-mode/docs/plans/261009l-peer-review-mode-merges-citations-and-debate.md:68)). The “4,000 hits” claim also lacks the reproducible command/scope required for inventories.

Concrete fix: Stage 1 must create the actual dated queue item with owner, blocker (“Greg confirms the name”), acceptance criteria, and reproducible search evidence before this work closes. Put all new UI-facing vocabulary behind Peer-review-named adapters now; allow `citations`/`debate` only at explicit legacy storage/API seams. Record Greg’s approval of this exception or complete Stage 3 before calling the rename finished. With that, this is a managed deferral rather than “a sentence is not a fix.”

## Direct answers

1. The wrapper-plus-one-existing-surface design is sound. The complication is lifting exact counts and deliberately updating surface/boundary witnesses; `ModeSurface.head` itself is fine.

2. `peer-review` is safe. URL parsing, help anchor `mode-peer-review`, CSS/data attributes, feedback, and command identifiers all accept hyphens. Last-view storage keys are reader/slug keys, not mode keys. There is no general `/read/x/<mode>` path. `RETIRED_MODES` targeting `BandMode` is also fine because Peer review owns a band. A single word provides no technical advantage.

3. Boot, client navigation, and popstate can be covered by the proposed lift, provided `debateby` is lifted first. Last-view restore and legacy Chat filters are missing. Help aliases derive correctly from `RETIRED_MODES`; there are no Citations/Debate path forms to migrate.

4. Queuing only `citations` through both `DELEGATED_MODE_STEPS` and the server-side `AUTO_MODE_STEPS` list is correct. URL arrival, Back, and restore do not buy Reception. A Dock/chip or command-bar selection is a deliberate press. Forced Metadata/command reruns remain repeatable without a rate limit.

5. The block-ID join is correct and works for owners and visitors. Legitimate stored citations have `citedAt`; malformed absence is already unsafe elsewhere. Coverage is capped for direct mentions, paragraph-local order is not guaranteed, and the focus handoff needs the lifecycle fix above.

6. Holding Stage 3 is defensible because the name is genuinely unsettled, but only as an approved, tracked exception to the rename rule. Stage 1 must create the real handoff and avoid spreading the legacy names into new public abstractions.

7. The important missing/underspecified Stage 1 work is: last-view canonicalization, composite visitor policy and partial-artifact states, shared count derivation, Chat source/filter migration, rerun-command disambiguation, and targeted three-view surface/boundary tests. `layout.ts` needs no special entry because Peer review correctly receives the standard fallback.

**BUILD WITH CHANGES**