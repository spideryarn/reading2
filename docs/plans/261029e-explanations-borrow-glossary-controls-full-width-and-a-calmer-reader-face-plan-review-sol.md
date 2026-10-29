## P1 — must change before building

1. **The client freshness predicate is not equivalent to `existingFor`.**

   - Claim: `!stale && !outdated && !profileChanged` identifies an appendable artefact.
   - Evidence: [`profileIsStale`](</var/tmp/spideryarn-worktrees/fbay3u4w-explanations-layout-font/src/profile.ts:290>) returns `false` when the current reader has no profile, even if the artefact records an old profile hash. [`withProfileChanged`](</var/tmp/spideryarn-worktrees/fbay3u4w-explanations-layout-font/src/routes.ts:8251>) therefore reports `profileChanged: false`, while the proposed exact profile comparison in `existingFor` would reject it and rewrite.
   - Change: have the server return an authoritative `panelRun: "append" | "rewrite"` computed from the same predicate used by generation, as Glossary does. Do not reconstruct it from the three presentation flags. Ideally include the expected artefact identity in the run request so a profile change between GET and click cannot turn a displayed “Find more” into a silent rewrite.

2. **The version rule is unsafe on rollback.**

   - Claim: version inequality is the right meaning of “outdated.”
   - Evidence: Explanations currently uses `version !== PROMPT_VERSION` in [`src/explanations.ts:170`](</var/tmp/spideryarn-worktrees/fbay3u4w-explanations-layout-font/src/explanations.ts:170>). Quotes deliberately treats only older versions as outdated, specifically to avoid a rolled-back build downgrading newer artefacts: [`src/quotes.ts:1017`](</var/tmp/spideryarn-worktrees/fbay3u4w-explanations-layout-font/src/quotes.ts:1017>).
   - Change: compare ordered version numbers and classify only stored versions older than the running build as outdated. A stored `explanations/2` must remain current under a rolled-back `/1` build and must not be overwritten by a forced run. Because the currently deployed `/1` code lacks that rule, rollout needs a compatibility-first deployment if rollback safety is required immediately.

3. **The URL-state work is incomplete and could silently do nothing.**

   - Claim: adding `explby` and `explbar` to `params.ts` is enough.
   - Evidence: Explanations currently has explicitly “no URL state” and never calls `useQueryState`: [`ExplanationsMode.tsx:2`](</var/tmp/spideryarn-worktrees/fbay3u4w-explanations-layout-font/src/web/modes/explanations/ExplanationsMode.tsx:2>). FAQ’s controls work because its mode wires both parameters: [`FaqMode.tsx:66`](</var/tmp/spideryarn-worktrees/fbay3u4w-explanations-layout-font/src/web/modes/faq/FaqMode.tsx:66>). New query keys must also be classified by the last-view contract: [`last-view.ts:90`](</var/tmp/spideryarn-worktrees/fbay3u4w-explanations-layout-font/src/web/last-view.ts:90>).
   - Change: name `ExplanationsMode.tsx` and `last-view.ts` in the plan, wire both params with `useQueryState`, decide that they are remembered like `faqby`/`faqbar`, and add URL-state and last-view tests.

4. **Threshold filtering breaks “Open in Explanations” from the margin.**

   - Claim: the margin can remain unchanged.
   - Evidence: the panel currently declares every known explanation drawn because all are rendered: [`ExplanationsPanel.tsx:82`](</var/tmp/spideryarn-worktrees/fbay3u4w-explanations-layout-font/src/web/ExplanationsPanel.tsx:82>). After thresholding, a focused item can be known but absent from the DOM. Glossary explicitly coordinates focus with lowering its gate before landing.
   - Change: when the focused explanation is filtered out, lower `explbar` enough to reveal it before `useLandOnItem` runs, or temporarily reveal the focused row. Add a test opening a below-threshold explanation from the margin.

## P2 — should change

5. **The append compatibility contract needs to be explicit.**

   - Claim: adding `passes`, `lastAdded`, and item `addedAt` is straightforward.
   - Evidence: every existing `/1` artefact lacks those fields. Database JSON is cast to the TypeScript type rather than migrated at read time: [`loadExplanations`](</var/tmp/spideryarn-worktrees/fbay3u4w-explanations-layout-font/src/store/pg.ts:4480>). Quotes treats analogous fields as optional and uses fallbacks, for example [`pipeline.ts:4792`](</var/tmp/spideryarn-worktrees/fbay3u4w-explanations-layout-font/src/pipeline.ts:4792>).
   - Change: make the new persisted fields optional on read, while always writing them on new artefacts. Add a `previousExplanationsFrom` helper mirroring Quotes’ baseline reader and fail on an unusable baseline rather than silently treating corruption as “no previous list”: [`quotes.ts:1275`](</var/tmp/spideryarn-worktrees/fbay3u4w-explanations-layout-font/src/quotes.ts:1275>).

6. **`dropped` cannot become “this pass only” without changing its meaning.**

   - Claim: the saved artefact’s drop counts can describe only the newest append.
   - Evidence: the panel presents `made.dropped` as provenance for the displayed list: [`ExplanationsPanel.tsx:52`](</var/tmp/spideryarn-worktrees/fbay3u4w-explanations-layout-font/src/web/ExplanationsPanel.tsx:52>). Quotes accumulates artefact-level drop counts while retaining current-run counts separately: [`quotes.ts:1160`](</var/tmp/spideryarn-worktrees/fbay3u4w-explanations-layout-font/src/quotes.ts:1160>).
   - Change: keep saved `dropped` cumulative. Return current-pass validation and score-drop counts separately for logging. Define the score-drop type explicitly rather than saying only that it is “counted as GlossaryScoreDrops.”

7. **A run row on an empty completed list reverses the existing no-retry rule.**

   - Claim: show the run row on every finished list.
   - Evidence: `EXPLANATIONS_NONE` deliberately says an empty model result is a real answer with no retry: [`ExplanationsPanel.tsx:49`](</var/tmp/spideryarn-worktrees/fbay3u4w-explanations-layout-font/src/web/ExplanationsPanel.tsx:49>).
   - Change: either exclude empty lists from the run row, or explicitly change that product decision and update `explanations.md`. “Find more” with no baseline items is simply repeated regeneration.

8. **The response-token budget must account for two new required fields.**

   - Claim: the schema can gain required `difficulty` and `centrality` without another generation change.
   - Evidence: `ANSWER_TOKENS` is a hand-sized per-item estimate: [`explanations.ts:114`](</var/tmp/spideryarn-worktrees/fbay3u4w-explanations-layout-font/src/explanations.ts:114>), and it controls both the model limit and completion checking.
   - Change: add the two JSON fields to the per-item estimate and test a full 15-item response close to the maximum explanation length.

9. **Kalam is viable, but the proposed test weakening hides styles the product really draws.**

   - Claim: reader text is drawn only at upright 400 and 600, so testing Kalam at upright 400/700 is sufficient.
   - Evidence: reader-face text includes weight 500, such as [`mode-band.css:582`](</var/tmp/spideryarn-worktrees/fbay3u4w-explanations-layout-font/src/web/styles/mode-band.css:582>), and real italic reader text, `.prof-interim`: [`profile.css:243`](</var/tmp/spideryarn-worktrees/fbay3u4w-explanations-layout-font/src/web/styles/profile.css:243>). The current face test’s stated contract is to cover every style actually drawn.
   - Change: explicitly accept browser weight matching and synthetic italic as design decisions, then keep assertions or visual checks for 500/600 and italic instead of deleting them from the contract. Alternatively remove the italic styling or choose a face with a real italic. There is no obvious mechanical blocker: textarea fitting reruns on font changes in [`useFitTextarea.ts:35`](</var/tmp/spideryarn-worktrees/fbay3u4w-explanations-layout-font/src/web/useFitTextarea.ts:35>), and the relevant components use explicit line heights rather than Kalam-specific metric constants.

10. **The new top row would duplicate run actions in stale/profile states.**

   - Claim: the top row can coexist with the existing stale “Write it again” and profile rewrite actions.
   - Evidence: the stale panel already owns a rewrite button: [`ExplanationsPanel.tsx:227`](</var/tmp/spideryarn-worktrees/fbay3u4w-explanations-layout-font/src/web/ExplanationsPanel.tsx:227>). Glossary’s corresponding stale notice intentionally avoids another run control once the top row owns it.
   - Change: make the top row the single run action. Keep stale/profile notices explanatory or dismissible, without a second button.

11. **The append change leaves several authoritative comments false.**

   - Claim: the implementation can be understood from the new code alone.
   - Evidence: the pipeline currently says “No baseline read” at [`pipeline.ts:5346`](</var/tmp/spideryarn-worktrees/fbay3u4w-explanations-layout-font/src/pipeline.ts:5346>), the force-only comment says Explanations replaces rather than appends at [`pipeline.ts:694`](</var/tmp/spideryarn-worktrees/fbay3u4w-explanations-layout-font/src/pipeline.ts:694>), and `useExplanations` documents regeneration as replacement.
   - Change: list these comments/contracts explicitly in the implementation stage and update them with the code.

## P3 — nits

12. **The layout diagnosis is basically right, but its measurements are wrong.**

   - Claim: profile state “always” makes the reserved room 2.9rem.
   - Evidence: the Explanations override does replace `.tl-scroll`’s normal `0.7rem` with `--band-about-room`: [`explanations.css:24`](</var/tmp/spideryarn-worktrees/fbay3u4w-explanations-layout-font/src/web/styles/explanations.css:24>). But the one-control value is 1.9rem and the profile-badge formula is 3.6rem, not 2.9rem: [`mode-band.css:1979`](</var/tmp/spideryarn-worktrees/fbay3u4w-explanations-layout-font/src/web/styles/mode-band.css:1979>). `WrittenForYou` renders no badge when neither profiled nor changed: [`WrittenForYou.tsx:111`](</var/tmp/spideryarn-worktrees/fbay3u4w-explanations-layout-font/src/web/WrittenForYou.tsx:111>).
   - Change: correct the explanation. The proposed fix—restore normal scroller padding and put corner clearance only on the top control row—is still the simpler design.

13. **“Hardest” does not accurately name the proposed score.**

   - Claim: `difficulty` means intrinsic hardness.
   - Evidence: the proposed definition is the probability that this particular reader would get stuck; Glossary’s analogous definition is likelihood for a well-read non-specialist: [`glossary.ts:1353`](</var/tmp/spideryarn-worktrees/fbay3u4w-explanations-layout-font/src/glossary.ts:1353>).
   - Change: label that ordering “Most likely to trip you up,” or redefine the score as intrinsic difficulty. The two-score product itself is sensible: it supports the separate difficulty and centrality orders, while `difficulty × centrality` is an appropriate gate for prioritised reading.

The other central claims check out: changing only the system prompt/schema leaves `inputFingerprint` unchanged, so unchanged-source `/1` lists become outdated rather than stale; high-powered and capable generators compare equal through `sameGenerator`; a named forced Explanations run survives `FORCE_ONLY_WHEN_NAMED`; and the step can read its previous artefact using the same baseline mechanism as Quotes. No files were edited.