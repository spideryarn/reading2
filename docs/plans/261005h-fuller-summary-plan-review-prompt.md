# Review: a plan to write Summary's Fuller level for someone who has not read the piece

Repo: this worktree, branch `worktree-fbrntjxu-fuller-summary-for-new-reader`. TypeScript, ESM. A
reading app. Summary is a mode that writes plain-words paragraphs about an article at two lengths,
Brief (about 80 words) and Fuller (about 250 to 900), one model call each.

## The candidate

Live, pre-commit. Base `d1eec9994` (origin/dev as merged here). Untracked, and the whole of the
candidate:

- `docs/plans/261005h-fuller-summary-written-for-someone-who-has-not-read-the-piece.md` (the plan)
- `docs/research/261005c-what-makes-a-longer-summary-followable-by-someone-who-has-not-read-the-piece.md`
- this prompt

No code is changed yet. Start with the plan, then the research doc, then `src/simple-summary.ts`
(`simpleSystem`, `NOTCH_UP`, `KNOWN_WORDS`, `PITCH`, `FULLER_LENGTH`, `SIMPLE_PROMPT_VERSION`,
`inputFingerprint`), `src/plain-words.ts`, `src/profile.ts` § `PROFILE_RULES`,
`tests/simple-two-levels.test.ts`, `tests/simple-length-bands.test.ts`, `evals/simple/probe.ts`,
`evals/simple/length-bands.ts`, `docs/project/summaries.md`, `docs/project/prompting-guide.md`
(all of it, and § Measuring a prompt change in particular),
`docs/research/261002c-what-makes-a-good-summary.md`. That is where to begin, not the limit of
scope.

## What it is meant to do

An admin's report, quoted at the top of the plan. In short: Brief reads well; Fuller is often hard
to follow because it uses the article's terms as if the reader already knew them; the principle is
to write Fuller for someone who has not read the piece; do web research on what makes a good
summary and adjust the prompts from it.

The plan adds one section to Fuller's system prompt and narrows one sentence about the reader's
profile. Brief's prompt must not change by a byte. It then measures old against new with
production's own function. Simplest version first is a standing requirement of this repo, and so
is naming the simpler option that was passed over.

Out of scope: any UI change, the fidelity guard's design, the shared `plainWords` and
`PROFILE_RULES` text, streaming.

## A fact you should know, and should not work around

The eval cannot run today. The box's OpenRouter key has spent its monthly limit (the plan's § What
is blocking it). The plan says the prompt is not pushed until it is measured. Say if you think
that is the wrong call in either direction, but do not propose a different key or a different
route to a model: the limit is the owner's.

## What you can and cannot run, and what you may change

The tree is read-only for this review (`--sandbox review`). You can run one test file
(`npx vitest run tests/simple-two-levels.test.ts`) and a script that needs no database. You have
no network, so nothing that needs Postgres or a model will run.

## Attack it

Independently, before you read my questions below. The statements to test are the plan's own:

1. The diagnosis: the three reasons under "Why Fuller reads that way today" are what the prompt
   actually says, and nothing else in the prompt (the shared `plainWords` core, `PROFILE_RULES`,
   the paperwork rule, the bold and list rules) is a stronger cause the plan missed.
2. The new section does what it claims and fights nothing already in the prompt. Read it as the
   model will, in place, with everything around it. Look for: a rule it contradicts ("Only what
   the piece says", "Keep the author's key term", the length numbers, the sentence cap of 30
   words, "at most two sentences have a key"), a rule it now says twice in different words, and an
   instruction a model would over-apply (defining what the profile says the reader knows; a
   summary that is all definitions; quotation marks around everything).
3. The narrowed profile sentence does not contradict `PROFILE_RULES`' "Assume the background they
   claim" in a way that leaves the precedence to the model. Brief needed a paragraph placed after
   `PROFILE_RULES` for exactly that (`AFTER_PROFILE`); does Fuller now need one?
4. "Brief's prompt stays the same bytes", "the stored shape, the limits, the schema and the
   fingerprint do not change, so a `/9` row is not made stale", and everything that pins or reads
   the prompt or its version keeps working. Name every test that must change.
5. The eval-only environment variable: is it safe to have in `src/` for the length of this work,
   can it leak into a production write, and is there a simpler way to get a "before" arm after
   the prompt has been edited?
6. The measurement would detect a bad outcome: a Fuller that is easier but has lost findings, one
   that runs over its length, one that talks down, one that defines what the reader said they
   know. Are the two success criteria falsifiable as written? Is five pieces, one reader, one
   model judge enough to act on, and what is the cheapest thing that would make it enough?
7. The research doc: does any "taken" row claim more than its source supports? Is a finding
   attributed to a source that the doc itself says was not read?
8. Is there a simpler design that gets most of the value, which the plan missed or dismissed
   wrongly?

For each finding give:
  - an ID (F1, F2, …), a severity (P0/P1/P2/P3), and whether it is established (you ran or read
    something that shows it) or reasoned
  - (a) the concrete scenario the plan does not handle, or the contract in the code it contradicts
  - (b) the smallest change that closes it: exact replacement wording for the plan or the prompt
A finding with no (a) goes last.

## Then my questions

- Should the section go to Brief too? The plan says no, because Greg says Brief is good and a test
  pins its bytes.
- The section's last bullet tells the model to pay for definitions with fewer findings. Greg asked
  two days ago for Fuller to be "longer and more detailed still". Is that bullet the right trade,
  or should the length numbers rise instead?
- Is "the general knowledge of their field" a phrase a model will read the way it is meant?

## Verdict

End with one line: `VERDICT: build as written`, `VERDICT: build with the changes above`, or
`VERDICT: do not build`, and the two findings you would fix first.
