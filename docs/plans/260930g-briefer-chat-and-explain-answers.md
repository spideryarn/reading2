# Chat and Explain answers, a little briefer

For [SPIDERYARN-READING2-6X](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-6X), a
suggestion from Greg (admin, verified by `scripts/feedback-reporter.ts`, exit 0), sent from chat on
`pmc13013618-spya-uekgh6`:

> Make a minimal tweak to the prompt for chat and comment responses and question responses etc to be
> a little bit briefer.
>
> — Greg, 2026-09-30

## Which prompts answer the reader

| surface | call | prompt | its length line today |
|---|---|---|---|
| Chat, a comment's follow-up turns, and the "?" in the gutter (a chat turn with `help`) | `converse` | `SYSTEM` in [`src/converse.ts`](../../src/converse.ts) | *Do not pad. Two or three short paragraphs is usually right; one is often better.* |
| A comment's first answer, a question on a selection, the glossary's *Check the web* | `explainStream` | `SYSTEM` in [`src/explain.ts`](../../src/explain.ts) | *Do not pad. Two or three short paragraphs is usually right; one is often better. Never more than four.* |
| Remember mode's reply to what the reader says they took from the piece | `converse`, `kind: "remember"` | `REMEMBER_SYSTEM` in [`src/converse.ts`](../../src/converse.ts) | *Short. Two or three paragraphs. A Signposts reply is three or four lines. If you are writing a fourth paragraph you have started explaining the article instead of helping them read it.* |

Each prompt already carries one length line, so the minimal tweak is to that line and nothing else.

## The change

- **explain.ts:** *Do not pad. One or two short paragraphs is usually right, and one is often
  enough. Never more than three.*
- **converse.ts `SYSTEM`:** *Do not pad. One or two short paragraphs is usually right, and one is
  often enough. Most answers need fewer than 300 words. Go longer when they ask for more, such as a
  summary.* (Chat has no hard cap, because a reader may ask it for a summary; that stays.)
- **converse.ts, a new `lengthLine`** in chat's final user message, beside `provenanceLine`: *Keep
  it brief, as WHAT IT MUST NOT DO says: most answers need fewer than 300 words, unless they ask for
  more.* Chat only, below the cache breakpoint. **Not in the first draft of this plan** — added
  because the measurement below showed chat ignoring every wording of the rule in `SYSTEM`. It
  copies the lever `provenanceLine` already uses for the same reason, and has its own test,
  `tests/chat-length-line.test.ts` (seen red with the line removed).
- **converse.ts `REMEMBER_SYSTEM`:** tried *Short. One or two paragraphs, three at most.*, measured,
  and **reverted**: it changed nothing (see Result). Remember ships as it was.

**What else moves with it:**

- `tests/explain-request-snapshot.test.ts` pins the whole explain request, as a snapshot and as three
  inline hashes (ordinary, deep, profiled). Update both, deliberately, and say so in the commit.
- The `max_tokens` comment in converse.ts that quotes chat's old "two or three short paragraphs", and
  the same quote in [glossary.md](../project/glossary.md) about *Check the web* reusing explain's
  length rule.
- No prompt here carries a version stamp, so there is nothing to bump.
- **Cache:** each changed prompt is its own cached prefix, so the first call per article on each of
  chat and Explain after deploy pays one cold write. Once, and small.

**Left alone, on purpose:**

- `helpSection` in converse.ts — the help turn is a chat turn, so it gets both `SYSTEM`'s rule and
  the new `lengthLine`; measured below, it needed nothing of its own.
- `DEEP` in explain.ts — "go and look properly" asks for more work, not more words, and it inherits
  the new length line anyway.
- `QUIZ_MARK_SYSTEM` (the reply to a quiz answer) — already "Two paragraphs at most, and often one".
- `live.ts` (spoken) — already "Two or three sentences".
- Candidates (the referee shortlist) — its output is a list with sources, not a prose answer.
- FAQ, quiz questions, summaries — pre-generated, not responses to the reader.

**The simpler option passed over:** adding "Keep it brief." above the existing line. It adds a second
length rule next to the first, which is the shape the prompting guide warns against (one rule, not
two), and it leaves "two or three paragraphs" still telling the model otherwise.

## How "a little briefer" becomes a number

Following [prompting-guide.md § Measuring a prompt change](../project/prompting-guide.md#measuring-a-prompt-change):

**Chat and Explain** — [`evals/plain-words/answers.ts`](../../evals/plain-words/answers.ts) calls
production's own `explainStream` and `converse` (tools on) on 18 fixed cases: three articles, two
terms each, asked three ways (bare term and sentence go to Explain, a question to chat). `report`
prints words per answer by kind.

1. `before-30` and `before-31` on the commit before the change — the second is the control.
2. `after-30` on the commit with it.
3. **Targets, separately for Explain (12 cases) and chat (6):** words per answer down roughly
   **15–35%**, with the before-30 → after-30 gap well outside before-30 → before-31. More than ~40%
   down is not "a little", and I would soften the wording and re-run.
4. **Fidelity, blind.** `pairs --a before-30 --b after-30`, check the key is balanced, and a fresh
   subagent reading only the pairs file judges each pair: which answers the question better for a
   reader outside the field, and did either leave out something the reader needed? Read the verdicts
   for Explain and chat separately.
5. Read a handful of the after answers.

`--keep-unfinished` (added to the harness here): the first two tries at the baseline both died on
one Explain answer that hit the 1,500-token cap, which the harness treats as a failed arm because
*Check the web* would discard it. For a length comparison that answer is exactly the one that matters,
so the flag keeps it and `report` counts it in its own column. **An unfinished answer is a diagnostic,
not a success:** if any arm has one, I report the count, and compare word averages with and without
it — the inclusive one from `report`, the exclusive one by a short script over the arm's JSON, kept
with the results. (On the retry, neither baseline arm had one.)

**Remember** — [`evals/remember-stances.ts`](../../evals/remember-stances.ts): eight readers × four
stances, tools off, words per answer printed on each answer's heading. Every run writes the same
`evals/results/remember-stances.md`, so each is copied to its own name straight after it finishes —
`remember-stances.260930g-before-1.md`, `-before-2.md`, `-after.md`. (Two runs overlapped, so
each transcript was taken from its own job log rather than the shared file; and since the Remember
change was reverted, the shared file is left as it was on dev.) Compare mean words per answer the same way as above, and
**read all 32 after-answers**, which is the harness's own pass condition. (Its header line said
"Seven readers"; there are eight since `justTellMe`, fixed here.)

**Smoke cases the harness cannot see** (after only, read by me): a `help` turn from the gutter, a
`deep` Explain, and a chat "summarise this article for me" — to check the new line neither starves
the help answer, nor stops a deep look saying what it ruled out, nor clips a summary the reader asked
for.

Budget: a few dollars in all.

## Deferred

- Anything structural (a length setting on the profile, per-surface caps): not asked for.
- *Check the web*'s own prompt, which glossary.md already names as worth doing.
- **Remember briefer.** If Greg wants it too, the lever that worked on chat (a line beside the
  reader's message, with a word budget) is the one to try, measured with `evals/remember-stances.ts`
  against the two baselines committed here.

## Reviews

- **Plan, GPT Sol (read-only), round 1: "revise".** Seven findings, all checked and all right. The
  first draft said Remember had no length line (it has one, and Greg's "etc" covers a reply to the
  reader), that no test pinned explain's line (the request snapshot does), and set one pooled target
  that twelve Explain cases would dominate over six chat ones. It also asked for the smoke cases,
  a stated policy on unfinished answers, Quiz marking's exclusion named with its reason, and the
  cache cost counted per surface. All folded in above.
- **Plan, round 2: "revise", on the eval procedure only** — the prompt changes and every round-1
  fix were confirmed. Three findings, all right: Remember's runs overwrite one file, it has eight
  readers not seven and every answer should be read, and the "without unfinished" average had no
  way to be produced. Folded in; the procedure changes are mechanical, so no round 3.
- **Code, GPT Sol (workspace-write, fixes in place): "pass with fixes".** Four P2s, all checked. It
  softened the fidelity conclusion to what one control can show, and recorded Remember's null
  result. It made `tests/chat-length-line.test.ts` pin the whole reminder and the budget in
  `SYSTEM`, and cover Candidates and a turn with history (before, the test passed with the budget
  deleted). And it fixed two comments that still quoted the old wording or named the wrong section
  (`live.ts`, and converse.ts's `max_tokens`). Reverting the Remember line was my call after
  reading its note: it did not suggest reverting.

## Result

Words per answer, all calls to production's own functions. Each "before" arm is the old prompt;
two of them show how much one prompt varies from run to run.

| surface | before (two runs) | after, final prompt | change |
|---|---|---|---|
| Explain (comments, selections, *Check the web*), 12 cases | 280, 268 | 233 (the same Explain prompt in all five after arms: 235, 237, 243, 228, 233) | **−15%** |
| Chat, 6 cases | 357, 373 | 262 | **−28%** |
| Gutter "?" (a chat help turn), 4 passages | 471 | 341 | **−28%** |
| Remember, 32 replies | 209, 225 | 210 (reverted) | none: within the before runs' spread |

The arms are in `evals/results/plain-words/answers/`. Their Explain prompt is the final one
throughout. Their chat prompt is not: `after-30` has the paragraph count only, `after-31` adds "a
short paragraph is a few sentences", `after-32` has a 250-word budget in `SYSTEM`, `after-33` has the
same budget beside the question too, and `after-34` is what shipped. Each arm's `sourceSha256` names
the bytes.

**Chat needed three attempts, and the first two are the finding.** With only the paragraph count
changed, chat went from four paragraphs to two and made each one twice as long: 342 and 339 words,
only 6–7% below the before runs' mean and short of the measured target. A word budget in `SYSTEM`
(250) gave 324. The same budget as a line beside the question gave 247, i.e. −32%, with every answer
landing near 250; the model treats the
number as a target. 300 gives 262 (−28%), which is what shipped. Explain moved on the paragraph
count alone and got no word budget.

**Fidelity, blind** (a fresh Opus judge reading only the pairs file,
`pairs-before-30-vs-after-34.*`). The key was balanced, 10/8. The final prompt was preferred in 9
pairs, the old one in 6, with 3 ties. The judge found two losses, both in final-prompt chat
answers: that transfer entropy cannot show how inputs interact, and Seth's hedge that artificial
consciousness is not ruled out. **The control**, the old prompt judged against itself
(`pairs-before-30-vs-before-31.*`), found four losses, **the same two points among them**. The
omissions therefore occur under ordinary run-to-run variation too; this one control does not show
that brevity can never make them more likely, but it gives no basis for attributing these two to the
prompt change.

**Remember did not show a clear length effect.** Its after run averaged 210 words, against 209 and
225 before. The outputs still followed the stance rules overall, but one used a banned phrase and
one was cut off, both failures also present in the before runs. Several answers still exceeded three
paragraphs, so the new wording was not even followed as a cap. **So it was reverted**: a prompt
line that measurably does nothing is noise in the prompt and a cache write for nothing. Remember's
replies already average about 210 words, below where chat now lands, so it is already the briefest
of the three. Because it was reverted, the 32 after-answers were skimmed for the counts rather than
read in full, as the plan had asked.

**Smoke cases** (read by hand, not committed): a requested section-by-section summary went from 768
to 344 words. It still covers every section with citations and still runs past the budget, so "unless
they ask for more" is working. A deep Explain still searched twice and says what it found (290 → 292
words).

**Unfinished answers:** none in any arm after the first two attempts at the baseline. So the
with-and-without comparison is moot.
