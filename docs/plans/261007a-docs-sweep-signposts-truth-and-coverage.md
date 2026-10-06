# The docs sweep: do the signposts work, is `docs/project/` true, and is every area owned

Started 2026-10-07 by a session the Overseer opened at Greg's request. The sixth codebase sweep
([261006j](261006j-sixth-codebase-sweep-umbrella.md)) did not sweep `docs/` beyond identifiers; this
is that part.

## What Greg asked for

> When the box calms down is a good moment to potentially go broader and deeper on that
> [docs/reusable/improve-the-codebase.md], i.e. look for other areas that could be
> improved/tidied up/refactored/etc, both in the codebase and the UI and anywhere else, and kick off
> one or more agents to try and get things into good shape before the next round of development.
>
> If it's consequential, requires tradeoffs, product decisions, or is hard to reverse, etc, then
> let's discuss first.
>
> — Greg, 2026-10-06

> make sure our docs are comprehensive (i.e. lots of little docs, each with lots of signposting to
> other docs and code etc, and human intent (mostly quotes/paraphrases from me), and that the
> important ones are linked to from @AGENTS.md . It may help to create overview docs as hubs. And
> ideally we update them periodically (e.g. when pushing, or deploying)
>
> — Greg, 2026-10-06

The policy this is measured against is
[documentation-policy.md](../reusable/documentation-policy.md).

## Stages

| | What | Done when |
|---|---|---|
| S1 | **Measure the signposts.** Eight planning tasks, each run twice by a fresh agent holding only AGENTS.md; three of the eight held back unread | the "where I got lost" lists for the five open tasks are in this doc |
| S2 | **`open-questions.md` shrinks.** Decided and moot questions go to the doc that owns them | three open questions left, and a table of where the rest went |
| S3 | **Is `docs/project/` true, and can a long doc be entered?** One agent per group of docs: fix what is false against the code, add a section map to every long doc, close the signpost gaps S1 found, and report what needs a decision | each group's findings file exists; doc-links green |
| S4 | **Coverage.** Code with no owning doc, areas with no hub, docs with no intent where Greg's words exist; write the missing small docs | the new docs are owned and linked |
| S5 | **GPT Sol reviews** the diff against the code, and fixes what it finds | verdict in hand, findings each checked |
| S6 | **Re-measure** on the three held-back tasks, two runs each, and compare with their before-runs | the comparison is in this doc |
| S7 | **The batch for Greg**: rule-doc wording with before and after, what AGENTS.md should link, and the cheapest push checkpoint | sent to the Overseer |

Not in this job, by the Overseer's brief: the interior of `infra/hetzner/provision.sh` and the old
screenshots under `docs/plans/`, both with the box-rebuild session.

**The simpler option passed over:** read the docs myself and fix what looks wrong. The policy says
why not: *"you already know where everything is"*. And splitting the over-long docs in this pass was
passed over too — a split moves anchors that hundreds of links land on, and deciding what is history
is a judgment per doc. This pass maps the long docs and lists the ones worth splitting; it does not
split them.

## S1 — the measurement

The brief every run got is the policy's: plan, do not do; report the docs opened, the code to
reuse, the rules, and where you got lost. Runs were Sonnet subagents, told not to read October's
plans or `git log`, because each task is a near-variant of work that really landed this month.

| | Task | Set |
|---|---|---|
| T1 | A bot-check interstitial from a vendor we have not seen is imported as the article; refuse it | open |
| T2 | `/admin/costs`: a per-article column for the average wait for the first token | open |
| T3 | An "Ask in chat" button on each Timeline event | open |
| T4 | The Readiness panel shows how long the last full check run took | open |
| T5 | A reader reports a duplicated quote on a phone; take the report from start to finish | open |
| T6 | Rename the Debate mode to "Responses", all the way down | held back |
| T7 | An OSF Preprints landing page should import the paper | held back |
| T8 | Shorten the FAQ answers by changing the prompt, and show it did no harm | held back |

### What the ten open runs found

Nobody was lost on the first hop. AGENTS.md to the entry point to the owning doc worked in all ten
runs. What failed was the second hop, and it failed in three ways.

1. **The owning doc is too long to enter.** All ten runs said so, of `glossary.md` (1,687
   lines), `quotes.md`, `content-extraction.md`, `ai-gateway.md`, `fleet-dashboard-modes.md` and
   `feedback-reports.md`. A read stops at about 860 lines, so the section a run needed — at line 950
   of `glossary.md` in both T3 runs — was found by grep or not at all. *Fix in S3: a section map at
   the top of every long doc.*
2. **The neighbour that owns the answer is not linked from the doc the task leads to.**
   - T1, both runs: `fetching.md` is where "we imported a bot wall" leads, and it has no link to
     `content-extraction.md`'s typed refusals or to `src/challenge-page.ts`. Nor does anything list
     the places a new provider touches, or say how a page is captured for the fixture the rule
     demands.
   - T3, both runs: `timeline.md` does not mention chat; the pattern was found only because the
     task named Glossary. Nothing lists the places that switch on a chat's origin mode.
   - T2, both runs: nothing says what the `ai_calls` ledger records about time, so "is the first
     token timed at all?" took a grep of the schema. `admin-costs.md` says *"No token and no
     duration figure on the page"* without saying whether that covers a latency column.
   - T4, both runs: `readiness.md` does not say a run's duration is already recorded and drawn, and
     its *Where it lives* omits the client parser and the tests.
   - T5, both runs: `quotes.md` does not say what is de-duplicated where; `phone-and-touch.md` does
     not say how to reproduce at a phone's width.
3. **A line under an entry point does not say what a reader would search for.** T1: the line for
   `content-extraction.md` says nothing of refusals or bot checks. T5: nothing in AGENTS.md says
   "a Feedback report arrives → `feedback-reports.md`"; both runs guessed the file name.

Two runs also met a real question the docs cannot answer — whether a latency column is welcome on
`/admin/costs` (T2), and who decides when a vendor's page cannot be captured (T1). Those are
decisions, not signposts.

The six held-back runs are on disk, unread, until S6.

## S2 — open-questions.md

276 lines to 124. Three questions are open: Q6, Q11 and Q12.

- **Q1** was adopted in practice (`structure-step.md` treats authored headings as hard boundaries);
  the two options it beat are now one sentence in `granularity-zoom.md` § Where the tree comes from.
- **Q4, Q5 and Q8** are moot rather than decided: they were about the gist columns, removed
  2026-09-29, and the fisheye view, never built. Q8's recommendation moved into the fisheye section.
- **Q7** was already answered in `ai-gateway.md` § What an article costs to arrive, and the copy in
  this file was a second home for the same table.
- **Q2, Q3, Q9, Q10** were stubs.
- **Q11** stays open, and now says that stage 4.5 already fetches the bytes its second option was
  charged with fetching.

A table at the bottom keeps each old anchor on one line pointing at the owner, because about forty
links in plans and in `original-version/` land on `#q1` … `#q10`.

## Log

- 2026-10-07 — S1 measured, S2 landed.
