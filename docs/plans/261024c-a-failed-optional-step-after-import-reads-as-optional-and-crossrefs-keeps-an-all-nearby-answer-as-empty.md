# A failed step after an import reads as what it is, and crossrefs keeps an all-nearby answer as empty

Report `spya-rvj2p7` (#684, Greg, admin, 2026-10-23). Postmortem:
[261024a](../postmortems/261024a-a-guard-against-an-emptied-answer-must-ask-which-rule-emptied-it.md).

> I have no idea what that error means, and the article seemed to work, so it's just a very
> confusing message.
>
> — Greg, 2026-10-23 (spya-rvj2p7)

The card he saw, on the signed-in home page, for job `spya-dqbje9` on
`effective-expressiveness-spya-z8dehh`:

```
Linking the article to itself
Linking the article to itself did not finish. What went wrong has been recorded for whoever
supports this app, and a step that stops like this often comes out differently on a second
attempt — so trying again is worth a go. [jb-step-again]
```

and *Report this* opened the Feedback box with *"This import failed."* as its first line.

## What happened

Read-only, from Vercel's runtime log for that job (`POST /api/jobs/spya-dqbje9/advance`,
2026-10-23T22:07:11Z, deploy `dpl_E1PD89scshRTcZDAbojTSAxaj6cp`):

> The model named 3 links and none of them could be kept, so there is nothing to write. Dropped: 0
> naming a block id that is not in this article's body, 3 to their own block or the one beside it,
> 0 under 2 or over 12 words, 0 whose phrase is not in the block it named, 0 whose phrase occurs
> more than once there, 0 overlapping an earlier link, 0 malformed.

The article is 9 blocks and 486 words (the `revision published` line just before). The import had
finished and published; `crossrefs` is one of the automatic-extra jobs queued *by* that publication
([ingest-queue.md § The add page](../project/ingest-queue.md#the-add-page)). Its cap on that article
is 3 links (`linkCap`); the model offered 3, every one to its own block or the next, and
`buildCrossrefs` threw because a non-empty answer had been emptied by validation.

Two separate defects:

1. **A legitimate "nothing to link" was treated as a failed answer.** The throw exists so that an
   answer the validator could not read — wrong ids, phrases that are not there — does not quietly
   publish an empty list over a good one, and does not hide a validator bug behind "no links". But
   `nearby` (self or adjacent) is a judgement rule about *which* links are worth drawing, not a sign
   the model misread the article. On a nine-paragraph piece, "the only links I can find are to the
   paragraph next door" *is* the answer "nothing worth linking".
2. **A failure in a job that cannot hurt the article read like the import failed.** The card names
   the step by a label that means nothing to a reader, says nothing about the article being fine,
   and the report prefill says *This import failed* about a job that was never an import.

## The change

### 1. `buildCrossrefs`: an answer whose every link points next door is an empty answer

When validation empties a non-empty answer, it still throws — **unless every row was dropped as
`nearby`** (its own block or the one beside it). Then it returns `links: []` with the `dropped`
counts, exactly as the model's own `{ "links": [] }` would be: it publishes, the job finishes, and
the reader sees nothing because there is nothing.

**Only `nearby`.** The first draft of this plan exempted `length`, `ambiguous` and `overlap` too, as
"judgement rules". GPT Sol's plan review (finding 2) showed why not: `length` and `ambiguous` are a
good relation anchored on a phrase the prose cannot mark, which a retry can repair; and `length` is
checked before `unquoted` (`toLinks`), so a one-word phrase that is not in the block at all would
count as `length` and publish empty over a misreading. `overlap` and `truncated` cannot empty a list.

`tests/crossrefs.test.ts`, red first: three `nearby` rows build an empty artefact with
`dropped.nearby === 3`; `nearby` plus a `length` drop throws; `nearby` plus an `unquoted` drop
throws; a `nearby` count supplied from an earlier call cannot make a new malformed row pass; the
existing "unknown id + ambiguous" case still throws.

Comments that state the old rule are updated: the module header (point 5), `buildCrossrefs`'s
empty outcomes, and `rerun-steps.ts`'s crossrefs entry. cross-references.md says it in a paragraph.

**What it gives up:** a Metadata re-run whose links all point next door now replaces a good list
with an empty one. That is already true of the model answering `[]`, so it is not a new kind of
loss.

### 2. The step's label says what it makes

`pipeline.ts` `crossrefs.label`: *Linking the article to itself* → **Adding cross-references** —
the name Metadata's *AI processing* already gives the step
([261009x](261009x-metadata-ai-processing-named-as-the-modes-are.md)), and a word anyone who has
read a book knows. The label is the running row and the head of the failure sentence
(`STEP_GAVE_UP`), so both change. The table in 261009x is history and stays.

### 3. A failed automatic-extra job says the article is fine

`displayJob` (`src/job-state.ts`): when the status is `error` (states `failed` and `interrupted`)
and **every step of the job is in `AUTO_MODE_STEPS`** (the main modes plus cross-references, and
already including what Skim reads first), the card's sentence is new copy, `ARTICLE_UNAFFECTED`:

> The article itself is unchanged. Only this extra did not finish.

Provably true for those jobs: each step writes its own artefact into the claim's draft, and a
job publishes that draft only on a `done` ending (`src/jobs.ts` § the session one claim runs on).

The first draft said this under *every* non-import job, and *"still there to read"*. Sol (finding
1) found both untrue: a failed `labels` marks the published revision's labels failed
(`src/store/pg-session.ts`), and a mode job can be queued by slug while the article's import is
still running, so there may be nothing to read yet. Hence the `AUTO_MODE_STEPS` predicate, and
*unchanged*.
An import, `labels`, `structure` and the rest keep today's silence.

The `SENTENCES` map stays total over states; the branch is one line in `displayJob` beside the
existing `slow` one, and the constant lives with the import-state sentences in `job-state.ts`, added
to copy.md's list of them (finding 5). Tests: `tests/job-state.test.ts` red first (crossrefs,
glossary interrupted, Skim's three-step job carry it; fetch, `labels`, `structure` do not), and a
mounted `JobCard` assertion in `tests/job-card-progress.test.tsx` (finding 4), seen red by breaking
the predicate.

### 4. *Report this* says what failed

`importProblemReport` (`src/web/import-report.ts`): first line *This import failed.* for a job with
a `fetch` step, and **This job failed.** for any other. Neutral, because a job named by slug cannot
prove its article was ever published (finding 3). Rebuild, Start again and *Read this* carry `fetch`
and still say *import*, which they are. `tests/import-report.test.ts` red first.

## Considered and not done

- **Hide failed mode jobs from the home page.** Simpler on screen, but a failure nobody sees is a
  mode that silently never appears, and Retry is the way to get it. The sentence in §3 gets the
  benefit (no alarm) without the cost.
- **Retry the step once inside the job when everything was dropped.** More calls and more code for a
  case §1 turns into a success.
- **Change the prompt to avoid adjacent links on short articles.** It already states the rule; a
  prompt change bumps `PROMPT_VERSION` and stales every article's links for no reader gain.
- **A misread/judged map over every drop counter** — the first draft; see §1 for why only `nearby`
  is safe to exempt.
- **The same rule in the siblings** (`faq.ts`, `sources-claims.ts`, `skim.ts` all throw on an
  answer validation empties). Not touched here: their rules differ and none has failed this way. The
  postmortem names the class so the next one is recognised.

## Stages

One stage: the four changes, tests red first, gates (`npm test`, `npm run typecheck`, lint on touched
files), GPT Sol code review, commit, push to `dev`. A browser check of the card is not worth a
Sonnet run for one sentence under the steps; the mounted `JobCard` test covers what is drawn.

## Reviews

- Plan: GPT Sol, 2026-10-24, six findings, all taken — the two High ones narrowed §1 and §3 as
  described there ([answer](261024c-crossrefs-failure-wording-plan-review-sol.md)).
- Code: GPT Sol, 2026-10-24, three fixes made in place, all kept
  ([answer](261024c-crossrefs-failure-wording-code-review-sol.md)): the all-`nearby` test counts
  only this call's drops, since `dropped` is an accumulator; `auto-mode-steps.js` joins the client
  import allowlist; and the job-state wording says *automatic extras*, because cross-references is
  not a mode.
- The full suite then found one more: `auto-mode-steps.ts` is new to the reader's startup bundle,
  so it went on `SHARED_WITH_READER` in `tests/eager-client-graph.test.ts` with its reason (a few
  hundred bytes, no new dependencies).
