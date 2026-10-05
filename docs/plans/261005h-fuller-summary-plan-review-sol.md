The direction is sound, but the prompt and measurement need tightening before implementation. No P0s.

The diagnosis is substantially correct: `PROFILE_RULES` and the shared plain-words rule strengthen reason 2, while paperwork, bold and list rules are not plausible stronger causes. The new section, however, creates conflicts the diagnosis did not account for.

1. **F1 — P1 — established: the profile exception is both too broad and in the wrong precedence position.**

   - **(a)** “The piece’s own names … which no reader knows” is false for established names such as ImageNet, a Stroop task, or a method the profile explicitly names. More importantly, the narrowed sentence appears before the later shared instructions that say a specialist does not need field terms explained and “Assume the background they claim” ([simple-summary.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbrntjxu-fuller-summary-for-new-reader/src/simple-summary.ts:583), [plain-words.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbrntjxu-fuller-summary-for-new-reader/src/plain-words.ts:38), [profile.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbrntjxu-fuller-summary-for-new-reader/src/profile.ts:180)). Brief already needed `AFTER_PROFILE` for precisely this precedence problem.
   - **(b)** Put this after `PROFILE_RULES`, as Fuller's `AFTER_PROFILE`:

     > **FOR FULLER, CLAIMED BACKGROUND DOES NOT INCLUDE THIS PIECE’S NEW LABELS**  
     > Ordinary established terms in the background the reader claims may remain unexplained. A term, abbreviation, label, or special meaning introduced by this piece does not become known merely because it belongs to the same field; treat it as new unless the profile itself names it. Where this differs from “Assume the background they claim” above, this paragraph wins.

     Delete “the general knowledge of their field”; it is not an operational boundary.

2. **F2 — P1 — established: mandatory definitions can contradict “Only what the piece says.”**

   - **(a)** If a paper names a data set or method without explaining it, the new section requires a definition while the later fidelity rule forbids outside knowledge ([simple-summary.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbrntjxu-fuller-summary-for-new-reader/src/simple-summary.ts:609)). The model can satisfy both only by inventing from prior knowledge or by guessing from context. The fidelity guard checks contradictions against cited passages; it does not reliably reject unsupported background.
   - **(b)** Add:

     > Explain a name only as far as the piece itself supports. If the piece does not explain it, give only the role the piece gives it—for example, “the data set used for training”—or leave the name out. Never add a definition from outside knowledge.

3. **F3 — P1 — established: the eval cannot detect the most important proposed regression.**

   - **(a)** A judge given only two summaries cannot tell whether both omitted a main finding. The in-progress eval explicitly says fidelity is not judged because the piece is absent ([new-reader.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbrntjxu-fuller-summary-for-new-reader/evals/simple/new-reader.ts:32)). The guard cannot detect omissions either. Thus an easier summary that lost important findings can pass. It also does not directly test whether the profiled summary defines items the reader says they know. “Beyond the control’s split” and “does not swing the other way” lack numerical definitions, so the two success criteria are not fully falsifiable.
   - **(b)** Replace the success criteria with:

     > Followability passes if the mean audit count across `new1a/new1b` is lower than the old mean by more than the absolute difference between `new0a` and `new0b`, and at least 7 of the 10 profiled old/new pairs prefer new. Separately, a source-grounded judge reads each piece and its shuffled summaries and lists every main finding omitted, bent or blurred. Ship only if the new arm introduces no new-only major omission or distortion. For profiled runs, list every explanation of an item in `readers.json.known`; any systematic increase fails.

     Five deliberately difficult pieces with two draws are enough for a first prompt decision after that addition. One same-family judge is weak; the cheapest strengthening is a second, cross-family judge only for disputed pairs and alleged major omissions, not more articles or writes.

4. **F4 — P2 — established: the section duplicates existing rules and contradicts the handhold rule.**

   - **(a)** The current prompt already says to define jargon on first use, retain the author’s key term, and audit unfamiliar words ([simple-summary.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbrntjxu-fuller-summary-for-new-reader/src/simple-summary.ts:585), [plain-words.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbrntjxu-fuller-summary-for-new-reader/src/plain-words.ts:51)). The new section states these again. Its “if used once, leave the name out” conflicts with retaining an author’s key term as a handhold: a central coined term may occur only once in the summary but matter when the reader reaches the article.
   - **(b)** Replace that bullet with:

     > Leave out a name the reader does not need. Keep the author’s key terms as handholds, even if they appear only once here; among other names, prefer those you use again.

     The simpler design worth evaluating is not the vague one-sentence arm. It is the existing rules plus two targeted additions: classify piece-introduced labels as terms, and forbid references the summary has not introduced.

5. **F5 — P2 — reasoned: “never point into the piece” is over-broad.**

   - **(a)** “The second experiment” is perfectly followable if the summary has already introduced the first and second experiments. The absolute rule encourages repeated mini-definitions and works against the 30-word sentence cap and “call it that every time.”
   - **(b)** Replace it with:

     > Do not refer to a part, result, model or label before this summary has introduced it. “The second experiment” is fine after this summary has explained the experiments; otherwise say what it is.

6. **F6 — P2 — reasoned: the last bullet chooses the wrong thing to sacrifice.**

   - **(a)** “Fewer findings” can directly undo Greg’s request for Fuller to be longer and more detailed, while the current prompt promises evidence behind each main finding. Raising the length numbers now would mix two changes and discard recently measured bands.
   - **(b)** Keep the lengths and replace the bullet with:

     > Stay inside the existing length. Keep the main findings. Pay for the context they need by cutting secondary findings, method detail and repetition—not by squeezing out explanations.

     Raise lengths only if the eval shows that a faithful, followable summary cannot retain the main findings within the existing band.

7. **F7 — P2 — established: the global eval environment switch is avoidable and can mis-stamp an answer.**

   - **(a)** A module-load environment switch in `src/` affects every summary call in that process. If an unrelated job runs there, it can write the old prompt stamped as `/10`. It cannot reach deployed production if it is removed before push and never deployed, but it is not safely confined while present. It also contradicts the prompting guide’s “separate arms in time, not in code” rule ([prompting-guide.md](/home/greg/code/spideryarn2/.claude/worktrees/fbrntjxu-fuller-summary-for-new-reader/docs/project/prompting-guide.md:204)).
   - **(b)** Replace the plan paragraph with:

     > Run the old arms from a clean worktree at `d1eec9994` and the candidate arms from this worktree. Each result records the commit and rendered-system hash. No prompt selector or old prompt variant is added to `src/`.

     The exhausted key remains a genuine blocker; do not use another key or route. Holding the change off `dev` until measurement is the correct call.

8. **F8 — P2 — established: the research understates which instructions are the project’s own inferences.**

   - **(a)** “Every name … is new to every reader” is broader than the cited standalone-summary guidance. “Leave out a term used once” has no source at all, yet the plan says only two bullets are ours ([research doc](/home/greg/code/spideryarn2/.claude/worktrees/fbrntjxu-fuller-summary-for-new-reader/docs/research/261005c-what-makes-a-longer-summary-followable-by-someone-who-has-not-read-the-piece.md:137)). “A summariser is in exactly this position” also turns evidence about humans into a claim about models. Nature, Cochrane/Fowler and several studies are used through search summaries rather than read pages; the body discloses that, but the final table drops the qualification.
   - **(b)** Change “exactly this position” to “an analogous position”; mark the used-once rule as “our guard against over-defining; no source tests it”; change the plan’s “Two are ours” to “Several applications are ours”; and label Nature/Cochrane/Fowler as “search summary only” in the table.

9. **F9 — P2 — established: two existing tests must change, and two contracts need new assertions.**

   - **(a)** The only existing literal pins that must change are:

     - [tests/simple-two-levels.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbrntjxu-fuller-summary-for-new-reader/tests/simple-two-levels.test.ts:291): `/10`, final Fuller hash, and its now-false test name/comment; retain Brief’s old hash.
     - [tests/simple-summary.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbrntjxu-fuller-summary-for-new-reader/tests/simple-summary.test.ts:1541): `/10`.

     `simple-length-bands`, `stage-stamp-agreement`, and the other constant-consuming tests need no expectation change. A direct probe established that `/9` and `/10` currently produce the same fingerprint.
   - **(b)** Add assertions that the new section is Fuller-only, the final profile override occurs after `PROFILE_RULES`, and a `/9` row is not stale although its prompt version is outdated.

     During this review, concurrent stage-2 edits appeared. The permitted test then ran with `--configLoader runner`: **12 passed, 1 failed**, exactly because Fuller’s old hash remained pinned; Brief’s hash remained unchanged. I changed no files.

Direct answers:

- **Should it go to Brief?** No. Brief already constrains itself to two explained terms, one plain method phrase, and fewer facts; Greg reports it works. Preserve its bytes.
- **Fewer findings or higher lengths?** Neither as written. Keep the present lengths and main findings; cut secondary findings, method detail and repetition. Reconsider length only if the source-grounded eval demonstrates an unavoidable coverage loss.
- **Will “the general knowledge of their field” be read as intended?** No reliably. It is vague and encourages broad inference. Use the explicit “ordinary established terms / labels introduced by this piece / unless the profile names it” distinction in F1.

VERDICT: build with the changes above — fix F1 and F3 first.