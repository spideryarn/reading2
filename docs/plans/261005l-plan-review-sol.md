The plan is directionally right: the visible rename is appropriately narrow, the internal identifier rename is correctly deferred, and Explore’s wider remit does not inherently duplicate Debate. I would not build it unchanged, however: there are four likely user-visible failures and the proposed evaluation cannot yet substantiate its own acceptance criteria.

### Findings

- **PR-1 — P1 — established: `learn: "remember"` can make Learn auto-reopen, contrary to the conversation-mode safety rule.**

  The plan adds the forward alias to `RETIRED_MODES` ([plan](/var/tmp/spideryarn-worktrees/fbmvmpks-remember-becomes-learn/docs/plans/261005l-remember-becomes-learn-and-explore-covers-critiques.md:54)). That map is specified as containing modes that have *left* the vocabulary ([modes.ts](/var/tmp/spideryarn-worktrees/fbmvmpks-remember-becomes-learn/src/modes.ts:317), [mode.md](/var/tmp/spideryarn-worktrees/fbmvmpks-remember-becomes-learn/docs/project/mode.md:520)); Learn has not.

  More importantly, `last-view.ts` filters conversation modes using the raw query value and a set containing `"remember"` ([last-view.ts](/var/tmp/spideryarn-worktrees/fbmvmpks-remember-becomes-learn/src/web/last-view.ts:183), [last-view.ts](/var/tmp/spideryarn-worktrees/fbmvmpks-remember-becomes-learn/src/web/last-view.ts:311)). A raw `?mode=learn` therefore evades the filter and can be saved and restored automatically, even though opening Remember/Learn may begin or focus a conversation.

  Other consumers are mostly harmless: Help gains an old-anchor alias, feedback normalizes the value, and the tests walking the map validate only successors. `settleAddress` does not canonicalize this generic alias, which is why the raw value survives.

  **Do instead:** omit the unrequested `?mode=learn` alias in stage 1. If forward aliases are wanted, add a properly named alias abstraction, canonicalize the address before last-view persistence, and test Help, feedback, and explicit-press behavior.

- **PR-2 — P1 — established: the proposed catalogue aliases break `remember quiz`.**

  The command bar builds sub-mode search text from the new parent label, the sub-mode label, and the sub-mode’s own aliases; it does not inherit aliases from the parent catalogue entry ([command-match.ts](/var/tmp/spideryarn-worktrees/fbmvmpks-remember-becomes-learn/src/web/command-match.ts:274)).

  Consequently:

  - `learn` finds the parent by its label.
  - `remember` finds the parent by its alias.
  - `learn quiz` finds the Quiz sub-mode.
  - `remember quiz` does not find Quiz.

  There is already a regression test requiring `remember quiz` to resolve to Remember › Quiz ([command-bar-sub-modes.test.tsx](/var/tmp/spideryarn-worktrees/fbmvmpks-remember-becomes-learn/tests/command-bar-sub-modes.test.tsx:278)). The plan says that test proves the alias continues to work, but its proposed implementation makes it fail.

  **Do instead:** make sub-mode command rows inherit the parent’s aliases, or add explicit legacy compound aliases such as `remember quiz`, `remember recall`, `remember tutorial`, and `remember explore`.

- **PR-3 — P1 — established: the public Features page would still visibly say Remember.**

  The inventory changes screenshot alt text but treats `remember.png` only as a developer-facing filename. The actual image displayed by the Features page contains a large “Remembering” heading, while `quiz.png` contains a large “Remember” heading. Both are live public images referenced by [FeaturesPage.tsx](/var/tmp/spideryarn-worktrees/fbmvmpks-remember-becomes-learn/src/web/FeaturesPage.tsx:306).

  This is not equivalent to the internal filename staying unchanged: a reader sees the old mode name inside the screenshots.

  **Do instead:** reshoot both `src/web/assets/remember.png` and `src/web/assets/quiz.png` with Learn visible. Their filenames may remain unchanged.

- **PR-4 — P1 — established: the fifth move contradicts the existing Explore format rules.**

  The plan allows a short list when the reader asks for one ([plan](/var/tmp/spideryarn-worktrees/fbmvmpks-remember-becomes-learn/docs/plans/261005l-remember-becomes-learn-and-explore-covers-critiques.md:126)), and the proposed critic script explicitly asks for a list. The unchanged shared format rule says “No lists, no headings” ([converse.ts](/var/tmp/spideryarn-worktrees/fbmvmpks-remember-becomes-learn/src/converse.ts:1461)).

  “Ask whether it holds, and whether it matters” also encourages two questions, while Explore permits at most one question ([converse.ts](/var/tmp/spideryarn-worktrees/fbmvmpks-remember-becomes-learn/src/converse.ts:1444)).

  `NO VERDICTS` is not the conflict: it concerns judging the reader, not assessing the article. The origins and attribution rules are compatible with the new move.

  **Do instead:** explicitly permit a short cited list only when requested, and say that an unrequested response selects either “does it hold?” or “does it matter?” rather than asking both.

- **PR-5 — P1 — reasoned: “fair first” lacks the rule that prevents false or already-answered objections.**

  The proposal says to cite the claim and mark uncertainty, but it does not require looking for the author’s qualification or answer elsewhere in the supplied article before raising the criticism. Nor does it guard claims that the article “leaves out” something. Tutorial already carries a warning against asserting that the article does not mention something, because supplied extraction may omit footnotes, captions, or side notes ([converse.ts](/var/tmp/spideryarn-worktrees/fbmvmpks-remember-becomes-learn/src/converse.ts:1186)).

  The second scripted critic turn asks the model to recover after an unfair objection; none of C1–C5 requires the first answer not to make that unfair objection.

  **Do instead:** require Explore to search the supplied article for the strongest relevant qualification or answer, include it or drop the objection, and scope absence claims narrowly: “this passage/argument does not address…” rather than “the article never mentions…”. It should also say what evidence would resolve a speculative concern.

- **PR-6 — P2 — established: the before/after procedure does not follow the project’s prompt-measurement contract for the new critic cases.**

  The guide requires two old-prompt runs, separately timed arms, randomized/balanced side assignment, and a blind judge ([prompting-guide.md](/var/tmp/spideryarn-worktrees/fbmvmpks-remember-becomes-learn/docs/project/prompting-guide.md:194)). The plan proposes one new before and one after, and suggests reusing the 2026-10-03 rev2 output as a second old sample.

  That old result has only the three existing readers; it cannot serve as the second old-prompt run for the newly added critic reader. The proposed human review also says side-by-side, but does not specify blinded, shuffled, balanced presentation.

  **Do instead:** run the new critic scripts twice against the old prompt and twice against the candidate prompt, preserve separate arm timing, and use tested blind/balanced side assignment.

- **PR-7 — P2 — established: C2, C4, and C5 are not tight enough to fail reliably.**

  The current judge’s move labels are `idea`, `case`, `connection`, `world`, `article`, and `other`; there is no `critique` label. This was verified with:

  ```text
  git show HEAD:evals/remember-explore.ts | nl -ba | sed -n '760,790p'
  ```

  Therefore C4’s “at most 1 in 5 unasked” has no stated instrument. An aggregate interpretation could also pass while one reader receives criticism on every turn. C2’s denominator—“every critique reply”—is similarly undefined. C5 requires taking up a reader’s doubt only once across two critic readers, allowing one article to fail completely.

  One critic per article is acceptable for this small qualitative evaluation if both are repeated and judged per conversation. The weakness is the instrumentation and aggregation, not necessarily the number of personas.

  **Do instead:** add a `critique`/`challenge` judge field with operational examples; calculate C4 per reader, not globally; define exactly which turns count for C2; and require C5 independently for each critic reader, preferably on its first substantive doubt.

- **PR-8 — P2 — established: the plan does not resolve Tutorial’s existing direction to take this work to Chat.**

  Tutorial says that when a reader starts speculating, objecting, or pursuing their own line of thought, it should tell them that Chat is the place to continue ([converse.ts](/var/tmp/spideryarn-worktrees/fbmvmpks-remember-becomes-learn/src/converse.ts:1177)). That is now precisely the territory assigned to Explore. The plan calls Tutorial already correct and leaves it unchanged.

  This is complicated by Explore remaining experimental: changing the handoff blindly could direct ordinary readers to a feature they cannot access.

  **Do instead:** make the boundary explicit in the plan. Either retain Chat as the universally available destination and document why, or condition the handoff so readers with Learn › Explore available are sent there.

### Other conclusions

The internal rename deferral is justified. The checked counts and underlying claims hold for the candidate commit: `"remember"` participates in three separate vocabularies; `?remember=` is persisted as part of remembered URL state; and `remember` is a stored thread kind protected by schema constraints and unique indexes. A full rename would require URL compatibility, local remembered-state compatibility, stored-row migration, schema/index changes, and tests. It is not cheap.

“Words change, identifiers do not” is therefore sound for stage 1. The exception is the proposed forward URL alias, which adds complexity without being part of Greg’s request.

The items retained because they use the verb are otherwise reasonable. “Remembering” as the temporary thread title describes an action and is normally replaced by the first utterance; the accessible “Remember what you took…” phrasing is also plainly a verb. The screenshot headings are different because their visual placement makes them read as the old feature name.

Explore and Debate need not collide. Debate is a stored, web-sourced survey of what other people have said; Explore is an interactive conversation that may test the author’s argument or the reader’s own concern. That distinction should remain explicit in the prompt and documentation.

The visible rename and wider Explore remit otherwise match Greg’s request. The plan does not need to rename internal identifiers, expose the experimental sub-mode more broadly, or turn every Explore turn into criticism.

I reviewed the committed candidate at `HEAD`; no files were changed. A concurrent uncommitted edit appeared in `evals/remember-explore.ts` during review, so evidence concerning that file was taken from `git show HEAD:…`.

VERDICT: build with changes