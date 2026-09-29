1. **F1 — P1 — `offeredDepths` will drop valid passes under the new counting rule.**  
   [plan:96](</home/greg/code/spideryarn2/.claude/worktrees/fb4p-trajectory-snippet-diversity/docs/plans/260929e-trajectory-each-pass-walks-only-its-new-stops.md:96>), [trajectory-route.ts:46](</home/greg/code/spideryarn2/.claude/worktrees/fb4p-trajectory-snippet-diversity/src/web/trajectory-route.ts:46>)

   The plan says `offeredDepths` already asks whether a depth adds stops. In fact it compares the current cumulative count with the preceding cumulative count. If `countAt` starts returning exact-depth counts, equal or smaller nonempty passes disappear. This occurs in the measured data: one route has exact pass counts 2 / 2 / 4 ([JSON:504](</home/greg/code/spideryarn2/.claude/worktrees/fb4p-trajectory-snippet-diversity/evals/results/trajectory-diversity-2026-09-29T13-11-37-091Z.json:504>)); More would be omitted and the door would jump from Gist to Most.

   Change `offeredDepths` explicitly to “depth has at least one `s.depth === d` stop.” Add tests where exact pass counts are equal and decreasing, covering `offeredDepths`, `effectiveDepth`, and `doorAfter`.

2. **F2 — P1 — The evidence does not support “within Gist and More, diversity is already good.”**  
   [plan:47](</home/greg/code/spideryarn2/.claude/worktrees/fb4p-trajectory-snippet-diversity/docs/plans/260929e-trajectory-each-pass-walks-only-its-new-stops.md:47>), [trajectory-diversity.ts:138](</home/greg/code/spideryarn2/.claude/worktrees/fb4p-trajectory-snippet-diversity/scripts/eval/trajectory-diversity.ts:138>), [trajectory-diversity.ts:192](</home/greg/code/spideryarn2/.claude/worktrees/fb4p-trajectory-snippet-diversity/scripts/eval/trajectory-diversity.ts:192>)

   The shared-Idea metric uses only `record.carries`, omitting `record.beside`, even though the route prompt treats both as Idea coverage. More importantly, exact Idea IDs and lexical Jaccard are proxies, not semantic-restatement measures. The plan correctly says Jaccard’s zero is not evidence, but then treats one shared-Idea pair as positive evidence. The earlier blind evaluation judged whether new stops repeated an earlier pass; it did not judge repetition among stops within the same pass.

   The cheaper direct answer is a small blind/manual semantic read of the exact-depth Gist, More, and Most lists already produced—no new route calls required. Score pairs or stops for “same point again,” preserve the stop text and judgment in the result artifact, and either substantiate or withdraw the “already good” claim. This should not block the client fix for literal repeats, but it should block declaring the within-level concern answered.

3. **F3 — P1 — Exact-depth passes conflict with the meaning the stored route was generated to have.**  
   [plan:67](</home/greg/code/spideryarn2/.claude/worktrees/fb4p-trajectory-snippet-diversity/docs/plans/260929e-trajectory-each-pass-walks-only-its-new-stops.md:67>), [plan:111](</home/greg/code/spideryarn2/.claude/worktrees/fb4p-trajectory-snippet-diversity/docs/plans/260929e-trajectory-each-pass-walks-only-its-new-stops.md:111>), [trajectory.md:229](</home/greg/code/spideryarn2/.claude/worktrees/fb4p-trajectory-snippet-diversity/docs/project/trajectory.md:229>), [trajectory.ts:824](</home/greg/code/spideryarn2/.claude/worktrees/fb4p-trajectory-snippet-diversity/src/trajectory.ts:824>)

   The prompt allocates stops on the assumption that More includes Gist and Most includes both: “MORE: most of the rest of the ideas as well” means cumulative coverage. Under the proposed client behavior, a direct More visit can contain only two stops, and Most is no longer the complete pass—only its final tranche. That also makes the plan’s option-5 rationale, “Most being every quote is what makes it complete,” false after the proposed change.

   Choose and state one of these contracts:

   - Preserve cumulative passes for direct depth selection/depth-only links, but make the sequential **More detail** path walk only stops not encountered in the completed shallower pass.
   - Adopt tranche semantics everywhere, but then describe More/Most as additions rather than independently deeper skims and reconsider the prompt targets/version.

   Greg’s latest report is enough to justify tranche semantics for the sequential walk, but “no prompt change” is only sound if the new passes are not claimed to stand alone.

4. **F4 — P1 — Stop-over-depth precedence needs a centralized resolver; the current evaluation order implements the opposite rule.**  
   [TrajectoryMode.tsx:417](</home/greg/code/spideryarn2/.claude/worktrees/fb4p-trajectory-snippet-diversity/src/web/modes/trajectory/TrajectoryMode.tsx:417>), [trajectory-panel.test.tsx:1407](</home/greg/code/spideryarn2/.claude/worktrees/fb4p-trajectory-snippet-diversity/tests/trajectory-panel.test.tsx:1407>)

   Currently the code resolves `depth`, filters the route, and only then resolves `stop`; the existing integration test explicitly expects a stop outside that pass to lose. Merely replacing `visibleRoute` with an exact-depth filter will therefore not implement the plan.

   Add a pure location resolver that:

   1. Finds a known requested stop in the full stored route.
   2. Uses that stop’s depth when present.
   3. Otherwise resolves the requested depth normally.
   4. Builds that pass and selects its requested or first stop.

   Pin these cases in integration tests: conflicting `depth`/valid `stop`, unknown stop fallback, deep-link arrival without a push, Back/Forward without re-arming arrival, depth-button landing on stop 1, and the door’s `deeper` landing with one pushed entry. With that resolution order, I found no inherent conflict with the arrival mailbox or history behavior.

5. **F5 — P2 — Several live contracts that assert nesting are missing from the change scope.**  
   [types.ts:1206](</home/greg/code/spideryarn2/.claude/worktrees/fb4p-trajectory-snippet-diversity/src/types.ts:1206>), [types.ts:1288](</home/greg/code/spideryarn2/.claude/worktrees/fb4p-trajectory-snippet-diversity/src/types.ts:1288>), [params.ts:417](</home/greg/code/spideryarn2/.claude/worktrees/fb4p-trajectory-snippet-diversity/src/web/params.ts:417>), [trajectory.css:148](</home/greg/code/spideryarn2/.claude/worktrees/fb4p-trajectory-snippet-diversity/src/web/styles/trajectory.css:148>)

   `src/types.ts` says depth *d* shows every stop at `depth ≤ d`, and `Trajectory.visible` remains explicitly cumulative. Those facts can remain true as storage/model semantics, but they must be distinguished from the new client pass. Otherwise the type contract will contradict the UI. The CSS for `.seen` also needs removal but is absent from the stage’s file list.

   Add `src/types.ts`, `src/web/params.ts`, and `src/web/styles/trajectory.css` to the scope. Keep `Trajectory.visible` documented as cumulative generation/validation data, while naming exact-depth client counts separately.

6. **F6 — P2 — The table is numerically correct, but the result artifact is not sufficient to audit its semantic claims.**  
   [trajectory-diversity.ts:228](</home/greg/code/spideryarn2/.claude/worktrees/fb4p-trajectory-snippet-diversity/scripts/eval/trajectory-diversity.ts:228>), [trajectory-diversity.ts:233](</home/greg/code/spideryarn2/.claude/worktrees/fb4p-trajectory-snippet-diversity/scripts/eval/trajectory-diversity.ts:233>), [JSON:545](</home/greg/code/spideryarn2/.claude/worktrees/fb4p-trajectory-snippet-diversity/evals/results/trajectory-diversity-2026-09-29T13-11-37-091Z.json:545>)

   I independently summed the per-article rows. All five table rows, percentages, and denominators are correct:

   - Gist: 20, 1 same-Idea pair, 3/14 same-section transitions
   - More nested: 47, 20 repeated, 4 pairs, 10/41
   - More added: 27, 0 repeated, 1 pair, 7/21
   - Most nested: 103, 47 repeated, 15 pairs, 46/97
   - Most added: 56, 0 repeated, 3 pairs, 36/50

   However, stop IDs, quote text, Idea associations, and section names are printed only to stdout and are not saved in the JSON. The “not unique” example and any later semantic review therefore cannot be reproduced from the cited artifact. Save the per-stop snapshot in the JSON. Also correct the script header’s reference from plan `260929d` to `260929e`, and describe the default input as the six hard-coded slugs rather than dynamically “every stored route.”

**Verdict: approve with changes.**

The narrow conclusion is sound: the literal between-level repeats are structural, and an exact-depth client walk removes them without regenerating routes. But the plan must fix `offeredDepths`, make stop/depth resolution explicit, and stop presenting the current proxy metrics as evidence that within-level semantic diversity is already solved.