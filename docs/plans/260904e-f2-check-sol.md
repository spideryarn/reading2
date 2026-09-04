# F2's fix, verified — the narrowly scoped check the new rule demands

> gpt-5.6-sol, high, 2026-09-04. Prompt: [260904e-f2-check-prompt.md](260904e-f2-check-prompt.md).
> Candidate: commit `270e289c`, one file in scope.
>
> This is the rule obeying itself on the day it was written. F2 was an established P1 whose
> final fix came *after* the round-two snapshot, so
> [engineering-manager.md § GPT Sol](../reusable/engineering-manager.md#gpt-sol) requires exactly
> this: a check of the fix, discovery closed. **Verdict: fix verified.**

### Six-step walkthrough

1. **Round one establishes F1/P1.**  
   F1 becomes an “established P0 or P1.” The ordinary second review round remains required.

2. **The first fix is inadequate.**  
   That fix goes into the round-two snapshot and is assessed there.

3. **Round two reports F1 still open.**  
   Discovery closes, but F1 remains established. It is not excluded merely because it was found in round one.

4. **A second fix is made after round two.**  
   This is now the finding’s “final fix,” and it was not in the round-two snapshot.

5. **Before landing, that second fix must receive a narrowly scoped check.**  
   The sequence therefore no longer slips through.

6. **If the scoped check still reports F1 open, it cannot simply be treated as fixed and landed.**  
   The rule requires it to be settled or overruled through Fable or Greg before landing.

### Answers

1. **Does the sequence still slip through?**  
   No. The retrospective condition—“whose final fix was not in the round-two snapshot”—catches the second fix at step 4 and mandates its verification at step 5.

2. **Is “if it comes back still open” handled adequately?**  
   Yes. It creates a clear terminal path: an unresolved P0/P1 must go through Fable or Greg before landing. It does not start an unlimited third discovery round.

3. **Does the explanatory paragraph weaken or narrow the rule?**  
   No. The normative paragraph applies to **any established P0 or P1** meeting the snapshot condition. The added paragraph explains why that condition is broader than “newly found”; it does not state that the illustrated round-one-P1 sequence is the only covered case. Its omission of P0 from the example does not narrow the preceding explicit P0/P1 rule.

**Verdict: fix verified.**