# Fuller is written for someone who has not read the piece

Up: [plans.md](../project/plans.md) · the feature: [summaries.md](../project/summaries.md) · the
research: [261005c](../research/261005c-what-makes-a-longer-summary-followable-by-someone-who-has-not-read-the-piece.md)

**Status, 2026-10-05: shipped to `dev` as `simple-prompt/11`, measured — and what shipped is the
smaller option this plan passed over, not the section it proposed.** The section was built and
measured, and passed its two tests for a reader with a profile. But this plan also said that if
two bullets did as well as the section, the two bullets would ship; set side by side they tied.
The measurement is
[261005b](../investigations/261005b-fuller-summary-for-a-new-reader-prompt-eval.md); what is built
is in [summaries.md](../project/summaries.md#written-for-someone-who-has-not-read-it-since-2026-10-05).
For a reader with no profile no improvement is claimed, and that is queued as `qi-4meqvjr4`. It
waited five hours on the box's model key (§ What was blocking it).

**Where this plan and the eval's files say `/10`, read `/11`.** This was to be `simple-prompt/10`
and was measured under that name. A separate change to Brief's length landed first the same
evening and took the number, so the Fuller bytes measured here ship unchanged in the combined
`simple-prompt/11`; `/10` is the Brief change alone.

**Read § What changes below as the proposal, not as the source.** The two bullets that shipped
are its first and fifth; the paragraph after the profile rules shipped as written.

## What Greg asked for

> The brief summary is quite good, but the fuller summary often is hard for me to understand. And I
> think it's because, I mean, it's fine that it uses some jargon from the article, but you have to
> write it as if it's for someone who has not yet read the article. So I guess if you're going to
> use jargon, you have to define it.
>
> Realty though they key principle is to write the fuller summary for someone who hasn't read it yet
> rather than for someone who has.
>
> Use Sonnet for web research on what makes for a really good summary, and tweak the prompts
> accordingly.
>
> — Greg, 2026-10-05 (`spya-rntjxu`, SPIDERYARN-READING2-DE)

Filed from `2605-20355v1-spya-ygtwkz`, an arXiv paper, in Summary's Fuller view. That article is
only in production, which a session cannot read, so its Fuller has not been seen by whoever wrote
this plan. That is a limit on the diagnosis below.

Summary writes two levels, each its own model call: **Brief**, about 80 words, and **Fuller**,
about 250 to 900 words depending on the piece's length. Greg is happy with Brief. This changes
Fuller only.

## Why Fuller reads that way today

Three things in Fuller's prompt (`simpleSystem("fuller")` in
[`src/simple-summary.ts`](../../src/simple-summary.ts)), read against the research:

1. **The rule about terms is there, but it is one line among many, and it is about "jargon".**
   "Where you do use a term, say what it means in the same sentence." A model that has just read
   the whole piece does not feel the piece's own names as jargon: its abbreviations, the name of
   its method, "Experiment 2", "the baseline condition". This is the curse of knowledge, and the
   research says telling a writer about it is not enough on its own.
2. **The reader's profile switches the rule off further than it should.** Fuller is told "what
   they say they already know counts as everyday words for them: use it without explaining it."
   Greg's profile says he knows machine learning. A name a paper coins is not something any
   reader already knows, but nothing in the prompt says so. Brief ignores the profile for words,
   which is one reason Brief reads well.
3. **Fuller is told what its extra room is for, and all of it is detail**: how the work was done,
   the evidence and numbers, the limits, how the steps connect. Nothing says the reader has to be
   able to follow each of those. Methods and numbers are where a piece's own names cluster.

Read in the Fullers already under `evals/results/simple/` (written by today's prompt, with no
profile), the failure is real but mild: "cannot be treated as a symmetry group" with no word on
what one is; "a classic test that cannot tell a six-node ring from two triangles"; "the
time-stretching result only guarantees…", pointing at a result the summary never gave; "making
the 2020s possibly 'sigmoid or singularity'", a quoted phrase left to explain itself. With a
profile it is expected to be worse, for reason 2. **That expectation is not yet measured.**

## What changes

### The section that was built first and not shipped

One new section in Fuller's prompt, and one new paragraph after the shared profile rules. Brief's
prompt stays the same bytes, and a test pins that.

**The new section**, after THE READER and before LENGTH. This is the text the eval's `new1` arms
measured. `NOT_READ` in the source now holds only its first and fifth bullets, with no heading,
no opening paragraph and no closing check:

```
WRITTEN FOR SOMEONE WHO HAS NOT READ THE PIECE

The reader has not read the piece and does not have it open. All they know of
it is what your sentences so far have told them. You have just read all of it,
so its words feel familiar to you. They are not familiar to the reader.

- A name the piece introduces is a term like any other, however plain it
  looks: a term it coins or uses in its own sense, an abbreviation, its label
  for a method, model, measure, group, condition or experiment. The first time
  you use one, say what it is in the same sentence, in everyday words.
- Explain a name only as far as the piece itself supports. If the piece does
  not explain it, give only the role the piece gives it ("the data set used
  for training"), or leave the name out. Never add a definition from outside
  knowledge.
- Leave out a name the reader does not need. Keep the author's key terms as
  handholds, even if they appear only once here; among other names, prefer
  those you use again.
- Once you have named something, call it that every time. A second name reads
  as a second thing.
- Do not refer to a part, result, model or label before this summary has
  introduced it. "The second experiment" is fine after this summary has said
  what the experiments were; otherwise say what it is.
- Words quoted from the piece need the same care. If a quoted phrase would not
  make sense on its own to this reader, say what it means in plain words.
- Before a finding, give the reader what it takes to follow it: what was being
  asked, and what was compared with what. A number comes with what it counts
  and what it is set against.
- Stay inside the length below. Keep the main findings. Pay for the context
  they need by cutting secondary findings, method detail and repetition, not
  by squeezing out explanations.

Before you finish, read each paragraph as someone who has seen only the
paragraphs above it. For each name, each abbreviation and each "the …" in it,
ask whether that person would know what it refers to. If not, say what it is
or take it out.
```

**The new paragraph**, which did ship, after `PROFILE_RULES`, where Brief's own exception
already sits (`AFTER_PROFILE.fuller`). It is last so that it, and not "Assume the background they claim", is
the final word:

```
FOR THIS VERSION, THE READER'S BACKGROUND DOES NOT COVER WHAT THIS PIECE INTRODUCES

Ordinary, established terms from the background the reader claims may stay
unexplained. A term, abbreviation, label or special meaning that this piece
introduces is different: it does not become known because it belongs to the
same field. Treat it as new unless the reader's description itself names it.
Where this differs from "Assume the background they claim" above, this
paragraph wins.
```

`SIMPLE_PROMPT_VERSION` goes to `simple-prompt/10`. As with `/8` and `/9`, every stored summary
becomes *outdated*, which is silent, and none is rewritten for it; *Write it again* and Metadata's
Rerun write the new one. The stored shape, the limits, the schema and the fingerprint do not
change, so a `/9` row is not made stale. A test holds each of those.

Where each bullet comes from is in the research doc's table. **Several are our own applications
and not a source's**: that a name the piece introduces is new to a specialist too, not referring
to what the summary has not introduced, and leaving out a name the reader does not need.

## The options passed over

- **Two bullets, not a section.** Today's rules plus two additions: a name the piece introduces
  counts as a term, and nothing is referred to before the summary has introduced it; with the
  same paragraph after the profile rules. It is the smallest change that names the two faults.
  Passed over as the *only* change because the research says a writer who has the knowledge
  needs things to check, not only a rule (research § 4). **It is not assumed worse: it is an arm
  of the eval** (`new2`), and if it does as well as the section, the two bullets ship and the
  section does not. (The first draft's simpler arm was one sentence, "write this for someone who
  has not read the piece"; GPT Sol's review, F4, said that arm was too vague to be the real
  alternative, and this one is.)
- **Fuller ignores the reader's background for words, as Brief does.** It would remove reason 2
  outright. Passed over because it is a product change Greg did not ask for: Fuller taking the
  reader's field as known was his own request on 2026-09-30, and "it's fine that it uses some
  jargon". The narrower sentence keeps that and takes only the piece's own names out of it.
- **A second model call that rewrites Fuller for a new reader.** More cost, a longer wait, and a
  second place for a claim to bend. Not until one prompt section has been measured and found
  wanting.
- **Changing the shared `plainWords` rule or `PROFILE_RULES`.** Both reach many prompts; this is
  one level of one prompt.

## Measuring it

The method is [prompting-guide.md § Measuring a prompt change](../project/prompting-guide.md#measuring-a-prompt-change).
`evals/simple/probe.ts` calls production's `generateSimpleSummary` on Opus with the fidelity guard
on, as a press does. A new free script, `evals/simple/new-reader.ts`, reads its result files.

**Five local pieces**, picked because each coins names of its own: the Vision Transformer paper
(`arxiv-2010-spya-tkm7nm`), the information-decomposition paper
(`entropy-24-00930-spya-pywwkq`), *A Matched Filter Hypothesis for Cognitive Control*
(`fd-src-nihms-536461-spya-nr87dn-spya-en7r25`), the hippocampus paper
(`s41598-023-33209-9-spya-s0qydm`) and Levin's *Self-Improvising Memory*
(`levin-self-improvising-memory-spya-gj60pu`). All five are in the `standard` length band.

**The reader** is `about` from `evals/simple/readers.json`, a synthetic technical reader shaped
like the admin's own profile, because the report came from a profiled reader. One arm each way
has no profile.

| arm | prompt | reader | writes |
|---|---|---|---:|
| `high-about-new0a`, `new0b` | today's (`/9`), twice; the second is the control | about | 10 |
| `high-about-new1a`, `new1b` | the section and the profile sentence (`/10`) | about | 10 |
| `high-about-new2a` | the two bullets and the paragraph, no section | about | 5 |
| `high-none-new0a`, `high-none-new1a` | today's, and `/10` | none | 10 |

About 35 writes at roughly $0.20 each: about $7.

**How an arm gets its prompt: separated in time, not in code.** The prompt was edited in stage
2, before any write, because the key was out. So the old arms are written with
`src/simple-summary.ts` put back to its bytes at `d1eec9994` for the length of the run, and the
`new2` arm with the variant recorded in the investigation; the file is then restored. No selector
and no old variant is added to `src/`. (The first draft had an eval-only environment variable;
GPT Sol's review, F7: a switch read at module load reaches every summary written in that process
and can stamp an old prompt as `/10`.) Each result file records a hash of the source file and of
the system prompts it sent, and `new-reader.ts table` refuses two prompts under one hash.

**Four checks, declared before any write:**

1. **Audit, one summary at a time.** A fresh subagent that has not read the pieces is given each
   Fuller alone, in a shuffled order under a random id, and lists everything it could not follow
   from the summary alone: a word, abbreviation, name or quoted phrase, or a reference to
   something the summary never introduced. The score is the count per summary.
   **Passes if** the mean count over `new1a` and `new1b` is lower than the mean over `new0a` and
   `new0b` by more than the means of `new0a` and `new0b` differ from each other.
2. **Blind pairs.** Same piece, old against new, sides from the tested `blindCoin`, with the
   old-against-old control and the section-against-two-bullets pairs mixed in. The judge answers:
   which could you follow more easily, having not read the piece; which tells you more of what
   the piece did and found; is either padded; does either talk down; which would you rather have.
   **Passes if** at least 7 of the 10 profiled old/new pairs prefer the new prompt.
3. **Against the piece.** The two judges above hold only summaries, so neither can see a finding
   that every summary left out. A third reads one piece in full and every Fuller of it, shuffled,
   and lists for each: a main finding omitted, a claim bent or blurred, and, for the profiled
   reader, an explanation of something `readers.json` says they already know.
   **Passes if** the new prompt has no major omission or distortion that the old prompt's
   summaries of the same piece do not also have, and explains what the reader knows no more
   often than the old prompt does. A disputed pair or an alleged major omission goes to GPT Sol
   as a second, cross-family judge.
4. **Screens, from the files.** Words written against the "never more than" (definitions cost
   words, so this is the likeliest regression), failed writes, and the fidelity guard's verdict
   on each Fuller.

`new-reader.ts score` prints the first two as PASSES or FAILS. And the outputs are read by the
session, whatever the numbers say. The length numbers are not changed here: they rise only if
check 3 shows a faithful, followable summary cannot keep the main findings inside its band.

**What it cannot show.** Five pieces, all academic papers, one synthetic reader. Not the article
Greg filed from. Judges that are models of the writer's family, with GPT Sol only on what they dispute.

## What was blocking it

Every paid call from this box goes through one OpenRouter key, and on 2026-10-05 at about 11:25
UTC that key had spent its monthly limit: `GET /api/v1/key` answered `limit: 300`,
`limit_remaining: 0`. All fifteen writes of the "before" arms failed in under a second with
`403 Key limit exceeded (monthly limit)` and cost nothing. Only Greg can raise it. The Overseer
has been told and has told him.

**Until it has room, the prompt change is committed in the worktree
`fbrntjxu-fuller-summary-for-new-reader` and is not on `dev`.** A prompt change nobody has
measured is not pushed.

**Still at its limit at 14:38 BST, three hours on**, checked at 13:21, 13:56 and 14:38. So, as the
Overseer asked: the docs, the eval script and the judges' briefs are on `dev`, and
`src/simple-summary.ts` and its two tests on `dev` are `simple-prompt/9`, byte for byte.

**`dev`'s history does hold the edit, and the commit that took it back out.** The `/10` edit was
first committed together with these docs (`dd71128c5`), so pushing the docs pushed that commit too;
the commit after it puts the three files back to `dev`'s bytes, and that is the tree `dev` has. A
clean second worktree holding only the docs would have kept the edit out of the history as well
(GPT Sol's code review, F1), and was passed over: this session can work in one worktree only, and
what a reader gets is decided by the tree, which is unchanged. The `/10` edit is applied again as
the last commit of the branch `worktree-fbrntjxu-fuller-summary-for-new-reader`, and that commit
is not pushed.

**Greg raised the limit to $400 at about 17:30 BST**, and the eval ran that evening as the steps
below say, with two rounds added after the first was read (the investigation says which, and
why). The measured prompt then went to `dev` as its own commit, as `/11`.

**The steps, as they were written while it was blocked**, in that worktree:

1. `git merge origin/dev`, and check `src/simple-summary.ts` still carries `NOT_READ`.
2. The old arms. For this run use `src/simple-summary.ts` exactly as it was at the pinned commit
   `d1eec9994` (`git show d1eec9994:src/simple-summary.ts`, saved over it, with the edited file
   kept aside), and not whatever `origin/dev` holds by then: another Summary prompt change may
   have landed. Write `high-about-new0a`, `high-about-new0b` and `high-none-new0a` with
   `npx tsx evals/simple/probe.ts run --arm <arm> --power high <the five slugs>`, then put the
   edited file back.
3. The new arms on the edited file: `high-about-new1a`, `high-about-new1b`, `high-none-new1a`.
4. The two-bullet arm, `high-about-new2a`: `NOT_READ.fuller` cut down to its first and fifth
   bullets with no heading, no opening paragraph and no closing check; then the file restored.
5. `npx tsx evals/simple/new-reader.ts table`, then `audit`, `pairs` and `grounded`; the three
   briefs in [`evals/simple/new-reader-judges.md`](../../evals/simple/new-reader-judges.md), each
   to a fresh subagent; then `score`.
6. Stages 3 and 4 below.

## Stages

1. The research doc, this plan, GPT Sol's review of the plan. *Done.*
2. The prompt, its version, its tests, and `evals/simple/new-reader.ts`. *Done.*
3. The eval, written up in
   [261005b](../investigations/261005b-fuller-summary-for-a-new-reader-prompt-eval.md). *Done.*
   The prompt was changed from it: the section came out and its two bullets stayed.
4. GPT Sol's reviews of the code, [summaries.md](../project/summaries.md), the feedback note,
   push. *Done.*

## GPT Sol's review of the plan

[The review](261005h-fuller-summary-plan-review-sol.md), 2026-10-05, read-only: *build with the
changes above*, no P0, nine findings, all taken.

| | finding | what changed |
|---|---|---|
| F1 | the profile sentence was too broad ("no reader knows" is false of ImageNet) and sat before the shared rules it had to override | it is a paragraph after `PROFILE_RULES`, with a boundary a model can apply: established terms stay, what this piece introduces is new unless the profile names it |
| F2 | "say what it is" can force a definition the piece never gives, against "Only what the piece says" | a bullet: explain only as far as the piece supports, else give its role or leave it out |
| F3 | a judge holding only summaries cannot see an omitted finding, and the criteria had no numbers | check 3, against the piece, and a number on checks 1 and 2 |
| F4 | "used once, leave it out" fought the handhold rule | the author's key terms stay even if used once |
| F5 | "never point into the piece" forbade "the second experiment" after the experiments were introduced | the rule is about what the summary has not yet introduced |
| F6 | "fewer findings" undid "longer and more detailed" | keep the main findings; cut secondary findings, method detail and repetition |
| F7 | the eval-only environment variable | gone; arms are separated in time |
| F8 | the research doc claimed more than its sources | its table now marks what is ours and what was only a search summary |
| F9 | which tests change, and three new assertions | `tests/simple-two-levels.test.ts` |

## GPT Sol's review of the code

[The review](261005h-fuller-summary-code-review-sol.md), 2026-10-05, read-only, of what was about
to be pushed and of the held-back prompt ([the diff](261005h-fuller-summary-code-review.diff)):
*push Part 1 with the changes above*. It found no defect in the prompt itself. Seven findings; five
taken, one answered in prose, one declined.

| | finding | what was done |
|---|---|---|
| F1 | the prompt edit is in this branch's history, so pushing the docs pushes it | **answered, not fixed in git**: § What was blocking it says so plainly. `dev`'s tree stayed `/9` until the measured push |
| F2 | `score` accepted a repeated or extra section, a repeated answer line, an answer the brief forbids, and a judge file written for an older shuffle | exact section lists, one line a question, each question's own choices, and a `blind-id:` the judge copies and `score` checks |
| F3 | a partial experiment could print PASSES | a missing run throws when a judge file is built, and `score` wants every piece under every arm |
| F4 | "Awaiting Greg" is defined as "nothing built", and here things are built | **declined**: the report needs something only Greg can give, and of the three endings that is this one. Leaving it with no ending means the next feedback sweep hands it to a new session |
| F5 | the pickup steps took the old prompt from `origin/dev`, which moves | pinned to `d1eec9994` |
| F6 | the two-bullet arm was still called "sentence" in the script | renamed |
| F7 | the side balance was printed for all test pairs, and the criterion counts ten of them | printed per kind and reader |

Each new refusal in `score` was watched refusing, on made-up files: a missing run, a judge file
for another shuffle, a repeated section, a forbidden answer and a repeated answer line; and both
PASSES lines were watched printing FAILS.

**The full suite**, on the tree that was pushed: 35,294 passed, 4 failed in 5 files, all of them
tests that want a build this worktree has not run (`has a build to inspect`, and the fleet
dashboard's server wiring). None touches Summary.

## GPT Sol's review of the conclusion

[The review](261005h-fuller-summary-code-review-2-sol.md), 2026-10-05, read-only, of the eval's
write-up and result files before the push: ***ship the two-bullet arm instead***. Every figure
reproduced. Seven findings, all taken.

| | finding | what was done |
|---|---|---|
| R1 | the section was shipped on a comparison designed after the direct tie was known; the declared rule was the direct comparison, and that was 5 to 5 | **the two bullets ship.** The source, its pinned hash, the investigation's conclusion, summaries.md and the note all changed |
| R2 | the check against the piece "passed" over one distortion no old summary made | the ledger and the investigation say so, and say the pass is a judgement |
| R3 | the note said "no main finding was lost"; five were omitted, each also omitted by an old summary | the comparative claim, in those words |
| R4 | "25 summaries" was 25 judgments of 20 summaries | corrected |
| R5 | "no profile can claim a term the paper coins" is false: the rule exempts a term the profile names | reworded in summaries.md and the note; "not shown" became "mixed; no improvement claimed" |
| R6 | one judge listed nine main findings where its brief said five to eight | recorded under What it cannot show |
| R7 | the branch needs the merge before the push, and what changes if the Brief session lands first | merged; the Brief session agreed to go second and take `/11` |

**What this review caught is the thing this repo's rules exist for**: the session had built the
section, the section had passed its own tests, and the write-up found a reason to keep it. The
reviewer was asked, in so many words, whether that was "a rescue of the version I had already
built", and said yes.

## Ledger

The whole of it is in
[261005b](../investigations/261005b-fuller-summary-for-a-new-reader-prompt-eval.md). In short,
55 writes on five papers, $9.61, none failed.

**The section**, the proposal above, against the four checks:

| check | reader with a profile | reader with no profile |
|---|---|---|
| 1. audit: places that could not be followed, a summary | 1.3 old, 0.6 new; the two old draws 0.6 apart. **Passes**, narrowly | 2.7 old, 1.5 new; not a declared test |
| 2. pairs: which would you rather have | new in **9 of 10**; the bar was 7. **Passes** | old in 7 of 10: a real signal against it |
| 3. against the piece | every omitted finding was also omitted by an old summary of the same piece. One new ViT summary made a distinct error about where ViT overtook ResNets; it was judged not major enough to fail. Nothing the reader claimed to know was explained. **Passes under that judgement** | the same |
| 4. screens | about 40 words longer; 4 of 20 past "never more than 600", the longest 633; every guard verdict passed | |

**The option passed over, which shipped.** The plan's rule: *if it does as well as the section,
the two bullets ship and the section does not.*

| | two bullets | the section |
|---|---|---|
| set directly against each other, profiled reader, ten pairs | 5 | 5 |
| the same, reader with no profile, five pairs | 4 | 1 |
| audit, profiled reader | 0.6 and 0.8 | 0.6 |
| Fullers past 600 words | 0 of 15 | 4 of 20 |
| against the old prompt, profiled reader, ten pairs each (different rounds and judges) | 6 | 9 |
| against the old prompt, reader with no profile | 3 of 5 | 3 of 10 |

A tie on the declared comparison, so the two bullets shipped. Against the old prompt they were
easier to follow in 6 pairs and harder in 1, and preferred in 6 of 10: the improvement that
shipped is a modest one.

**What the plan got wrong.** It expected the fault to be worse with a profile, because the
profile licenses the field's terms. On these five pieces the old prompt left *fewer* unfollowable
places for the profiled reader (1.3 a summary) than for the reader with none (2.7): the audit
judge, told what the profiled reader knows, lets the field's terms pass. And it expected the
larger change to be needed, on the research's finding that an attitude is not enough: two plain
rules did as well as eight and a closing check.
