# 261020d — Code review: the principles every chat shares

Review of commit `eb29fbe34`, against
[the plan](261020d-principles-every-chat-shares.md), its
[plan review](261020d-plan-review-sol.md), and the committed eval evidence. Findings were written
before the fixes below, as requested.

1. **Medium — the committed evidence does not identify the exact shared prompt that was
   evaluated.** `evals/chat-principles/results/after.json:4-7` records
   `chatPrinciples=f7ed99e2…`, but `src/chat-principles.ts` in `eb29fbe34` hashes to
   `6d12ae01…`; its `converse` hash does match the committed file (`8144ed8d…`). The difference
   could be comments only, but no committed artefact proves that, so
   `docs/investigations/261020a-chat-principles-measured.md:31` overstates the provenance of the
   shipped wording. The before arms' `converse` hash does exactly match `b6b244ba0`; their
   `chatPrinciples` hash names an uncommitted file that the old `converse.ts` did not import.
   **Recommend:** do not rewrite a historical hash to today's value. Recover the evaluated file or
   rerun before treating the result as proof of the exact shipped prompt. **Fixed for future
   runs:** the harness now records hashes of the five fully assembled system prompts, not only
   whole source files; the investigation discloses the present mismatch.

2. **Medium — the blind verdict counts are right, but the verdicts were missing.** Unblinding the
   supplied choices against `evals/chat-principles/results/key-before-after.txt:1-24` gives after
   12, before 12 (X 12, Y 12). Against `key-before-before2.txt:1-24` it gives before 13, before2
   10, same 1 (X 7, Y 16, same 1), exactly as
   `docs/investigations/261020a-chat-principles-measured.md:50-54` claims. Without the choices in
   Git, however, neither total follows from the committed artefacts. **Fixed:** saved both supplied
   winner lists beside their pairs and keys, with their unblinded totals, and linked them from the
   investigation.

3. **Medium — a newly typed conversation kind could silently escape the coverage test.**
   `tests/chat-principles.test.ts:53` iterated `THREAD_KINDS`, while `src/types.ts:4369` declares
   that value as `readonly ThreadKind[]`, which does not prove it contains every union member. A
   contributor could add a union member plus `systemFor` and `COVERAGE` branches, omit it from
   `THREAD_KINDS`, and leave its prompt without the principles while this test stayed green.
   **Fixed:** execute the prompt assertion from the exhaustive `COVERAGE` record itself, and
   separately require its keys and `THREAD_KINDS` to be the same set.

4. **Low — the “near the top” assertion did not establish what its name promised.**
   `tests/chat-principles.test.ts:66-73` allowed any byte offset below 2,000 and only required the
   section to precede `PLAIN WORDS`, which is near the end of all five prompts. The current
   insertions are sound — after each mode's opening description and before its detailed rule
   sections — but the test would permit drift below early rules. **Fixed:** require the shared
   heading to be the first all-capitals rule-section heading in each carried prompt.

5. **Medium — the opener claim was manually true in spirit but false as written and contradicted
   the machine screen.** `docs/investigations/261020a-chat-principles-measured.md:13-16,48` calls
   the result 8/8 versus 0/4 “concession openers”, while every saved JSON summary says
   `pushbackConcedes: "0/4"`: the regex in `evals/chat-principles/run.ts:187-214` does not match
   “too strong” or “loose”. More importantly, after's `pushback-agents` run 1 literally begins
   “Part of my earlier answer was wrong”, so 0/4 concessions is not true. What all twelve replies
   do support is narrower: all eight old openings volunteer retreat without first stating what
   supported core still stands; all four new openings explicitly recheck and state what they still
   hold, while correcting real looseness. **Fixed:** the investigation now names that manual
   criterion and no longer presents it as the regex's concession count. Its “praise opener” row is
   also renamed because the regex scans the whole reply.

6. **Low — the pairing is complete, but balance and the late merge were documented too strongly.**
   `pairRows` in `evals/guide/conversations.ts:409-428` correctly rejects empty, duplicate,
   missing and extra `(case, run)` rows; each result has exactly two rows for all twelve cases, so
   the Learn/Tutorial append did not mispair anything. But
   `evals/chat-principles/run.ts:342-345` balances sides only across all 24 pairs, not within each
   case; in three cases both runs put the same arm on the same side, so the per-case two-win
   descriptions are position-confounded. Also
   `docs/investigations/261020a-chat-principles-measured.md:32-33` wrongly says seeds 1–7 were all
   unbalanced (seed 3 is 12/12), while each result's `extraRuns` named only a label, time and hash,
   not the appended cases or rows. **Fixed:** the investigation says seed 8 was globally balanced,
   qualifies the per-case result, and documents the manual append; the two before files now name
   the four appended row keys. **Recommend:** require within-case side balance before making
   per-case comparative claims in a future eval.

7. **Medium — replacing “make deep reading cheaper” lost the efficiency half of Greg's request.**
   `src/chat-principles.ts:41-55` preserves depth, independence and the prohibition on replacing
   reading, but it never preserves “cheaper”, “sooner”, or Greg's “get there quicker” from
   `docs/user-feedback/261020_0200-the-principles-every-chat-shares.md:17-23`. Neither the rest of
   `SYSTEM` nor `GUIDE_SYSTEM` states that goal. Removing Chat's “They are reading it” loses
   nothing valid and fixes the assumption Greg reported. The shared section otherwise creates no
   unresolved contradiction in SYSTEM, LEARN_SYSTEM, TUTORIAL_SYSTEM, EXPLORE_SYSTEM or
   GUIDE_SYSTEM: their more specific answer, question, length, provenance and mode-routing rules
   win as the shared preface says; overlap is principle-level rather than a second copy of the
   mechanics. **Recommend, not fixed:** restore “sooner than they would alone” and rerun the paid
   comparison. Editing the shared prompt without that measurement would violate the prompting
   guide and the instruction not to run paid evals in this review.

8. **Low — three docs overstate or misdescribe the implementation.**
   `docs/project/prompting-guide.md:167-170` says the section is straight after one opening
   paragraph and “restates none” of the detailed sections; Learn and Tutorial have three opening
   paragraphs, Explore has two, and the broad principles intentionally overlap the detailed
   owners. **Fixed:** it now says “after the opening description” and distinguishes principle
   overlap from duplicated mechanics. `docs/user-feedback/questions/q-rwkq2e.md:23` says
   paragraph rather than passage and that reading time never leaves the database, although Quiz
   already receives it in the browser; option C at line 13 also sounds as though chats receive no
   profile, notes or experience rather than only no inferred reading progress. The feedback note's
   frontmatter at `docs/user-feedback/261020_0200-the-principles-every-chat-shares.md:4` says every
   chat has the section although Live is deferred, and its filename does not use either report's
   `2026-10-19` timestamp. **Recommend, not fixed:** correct and rename those two feedback files,
   then regenerate `src/feedback-questions.generated.ts` and
   `src/feedback-endings.generated.ts`; both generated source files are expressly outside this
   review's allowed edit scope. The question's plain-text body, one exact `Details` line, and
   `refs:` shape are otherwise correct.

9. **No defect — caching and production stamps remain sound.** The change touches only fixed
   system-prompt bytes. `src/converse.ts:2553-2562` still builds the article as a separate,
   deterministic message with the explicit breakpoint, so it stays byte-identical between turns;
   the changed system causes one expected cold prefix write per kind and article after deploy.
   Conversation answers have no persisted prompt-version stamp to bump. **Strengthened:** the new
   test now compares the whole system-plus-article prefix across changing history, profile and
   question for every thread kind, and compares the article message across kinds.

Verdict: revise the evidence and guards before landing; the five prompt insertions are compatible, but the exact evaluated wording is not reproducible and the efficiency principle remains unmeasured and missing.
