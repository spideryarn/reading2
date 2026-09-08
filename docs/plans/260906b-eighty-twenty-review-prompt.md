# Review: the 80-20 cut to the Debate-mode eval plan

Read-only review. **Do not change any file.** Report findings only.

## What you are reviewing

`docs/plans/260906b-an-evaluation-for-debate-mode-and-what-it-finds.md`, and specifically the new
section **"The 80-20, decided 2026-09-08 — most of this eval is not needed to fix the bug"**, which
sits immediately before `### Stage B`. It proposes replacing Stages B–E with four cheaper steps
B′–E′, dropping the arms machinery, the blinded judge with its anchor gate, and the live
confirmation sweep.

You reviewed the original plan (rounds 1 and 2) and Stage P's code (round 3). Those ledgers are at
the end of the same file. **This is a new round on a scope cut, not a reopening of settled
findings** — do not re-litigate F9, F19, F35, F36, F45, F47, F49, F54 or F55 except where the cut
changes what they bear on.

## The claims the cut rests on — check each against the tree, not against my prose

1. **The frozen packets already exist on disk.** I claim `output/debate-runs/*/journal.jsonl` stores
   the raw provider response, and that `choices[0].message.annotations[].url_citation` gives `url`,
   `title` and `content` (the extract the model was shown) — 11 and 12 of them per pass. If true,
   Stage C's capture sweep is redundant. Verify by reading the files; they are in the tree.
2. **The bug is stochastic.** `docs/plans/260905f-debate-mode-stage-0-spike-results.md` § 4 records
   three Feynman rows pointing valence at the source's own subject. The journalled run
   `output/debate-runs/2026-09-06T09-24-37-cargocult-spya-rz663q/` reports the equivalent
   `skepticalinquirer.org` row as `corroborates`/`positive` — correct. I conclude any honest
   evidence must be a **rate over repetitions**. Is that conclusion sound, and does it have
   consequences for B′–E′ that I have not drawn?
3. **The prompt defect is a spec repair, not a matter of taste.** See `src/debate.ts`: `READING`
   (~line 1056), the direct-group system prompt (~line 1100) and the claims system prompt (~line
   1160). I claim group two binds valence's target in a sentence, group one binds it nowhere, and
   neither group's negation list rules out *the source's own subject* — which is what all three
   recorded errors are. Check the prompts and say whether that reading is right.
4. **Hand-labelling beats a blinded judge at this size.** The corpus is 26 reported rows over three
   articles. I claim a hand label is better evidence than a judged one here, and that the judge
   earns its place only if the rate moves by less than the noise.

## What I most want you to attack

- **Is the cut wrong?** Name the specific thing the dropped machinery would have caught that B′–E′
  will not. Your F47 established the judge can only measure *disagreement*, never wrong-target rate.
  Does hand-labelling inherit that same limit, or does it escape it? If it escapes it, say how, since
  that would be an argument the cut is *better* than the original and I have not made it.
- **The repetition design.** B′–E′ compares a rate before and after a prompt change, on the same
  frozen packets. How many repetitions, at what temperature, and what test separates a real move
  from noise? I have deliberately not specified this yet — tell me what it has to be, and whether
  n is achievable at a sane cost with a 26-row corpus.
- **P7 and the answer vocabulary.** The plan already warns that a prompt change that alters the
  answer vocabulary makes every row silently `unclear`/`unknown`. Does the cut weaken that guard,
  given it drops the live sweep?
- **What in B′–E′ is still more than is needed?** I have cut once; cut again if it deserves it.

## Severity scale

P0 the cut loses something that matters and the work would be wrong · P1 a real gap with a named fix
· P2 worth doing · P3 taste. Give every finding an ID.

My own suspicion, last so it does not lead you: I think the weakest part is D′, the hand labels —
I am the person who diagnosed the bug and would be writing the ground truth for it, which is the
shape of a check that shares an assumption with the thing it checks.
