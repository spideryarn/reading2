Code review for plan docs/plans/261024d-chats-give-the-background-for-what-they-bring-in.md (read it first; your earlier plan review is docs/plans/261024d-chats-give-the-background-plan-review-sol.md).

The change: docs/plans/261024d-chats-give-the-background-code-review.diff (tracked changes since the merge base), plus two new untracked files — read them directly: evals/chat-principles/introduced.ts (a blind "bare names" counter: sheet builder + tally) and docs/investigations/261024a-chats-give-the-background-measured.md (the write-up). Raw results are in evals/chat-principles/results/ (bg-*.json, pairs-bg-*, key-bg-*, verdicts-bg-*, introduced-*).

Check:
1. The prompt edits in src/chat-principles.ts and src/converse.ts (EXPLORE_SYSTEM, "Say what you found"): wording, conflicts with the rules in each prompt that carries CHAT_PRINCIPLES (Chat, Learn/Recall, Explore, guide), and whether the example openings ("the philosopher…", "a 2019 survey of…") risk being copied literally or inventing facts.
2. introduced.ts: correctness of the shuffle (is it unbiased enough for a blind sheet? note the bit-loop then modulo), parsing in tally, anything that could silently miscount. run.ts edits (OWN_ARTICLES loader, new cases, judge wording).
3. Does the investigation's claim follow from the data in results/ — recompute the bare/brought totals per arm and the non-expert subset (excluding expert-others, expert-shown-others, expert-term, jargon-shown) from introduced-*-counts.txt and -key.txt, and check the win tallies against verdicts/keys. Flag any overclaim.
4. Anything else wrong.

You may fix clear defects inside these files (not the results/ data). Then write your findings as numbered items with severity, evidence (file:line) and what you changed, if anything. Be concise.
