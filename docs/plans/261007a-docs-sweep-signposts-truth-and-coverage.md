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

## S3 — is `docs/project/` true, and can a long doc be entered?

Two rounds, because the first did not do the job it was sent for.

**Round one**: nineteen Sonnet subagents, one per group of about 4,500 lines, each given four jobs
(truth, a section map, signposts, a report). **Eight of the nineteen did the maps and the signposts
and skipped the truth read**, and said so: *"I did not read all 4,400 lines"*. A brief that asks for
four things gets the three that are easy to finish. **Round two** was fourteen agents with one job
and half the lines each, told to read every line and to report the last line number they read. All
fourteen read to the end.

What landed, across both:

- **A section map (`## In this doc`) on 66 docs**, every one over 400 lines bar
  `hetzner-remote-server-box.md`, which another session was editing. Each bullet says what a reader
  comes looking for, not what the heading says. `feedback-reports.md`'s opens with "handed one
  report? read these, in this order".
- **About 230 statements corrected**, each checked against the code by the agent that changed it.
  Four kinds made up most of them:
  - **the filesystem store, in the present tense** — `supabase-local.md` said the app *"still reads
    and writes JSON files under data/"*; `security.md` said the job queue *"is still on disk and
    carries no owner"*; `setup-dev.md` said *"nothing in the app talks to [the local database] yet"*;
  - **"not built yet" for what is built** — `structure-step.md` four times, `deployment.md`,
    `ingest-queue.md`'s transactional stage runner, `dictation.md`'s *"the app has never played a
    sound; no WebRTC"*;
  - **the gist columns and Hierarchy mode as live** — `web-client.md` eleven times, `diagram.md`
    saying a visitor is pinned to Force in one section and to the Sketch in another;
  - **counts** — four webhook events (five), three tsconfig projects (four), fourteen modes
    (seventeen), "six places in three files" to add a dashboard tab (five), lint in 20 ms (20 s).
- **The gaps S1 found are closed**: `fetching.md` links the bot-check registry and
  `content-extraction.md` lists the places a new provider touches; `ai-gateway.md` says which timing
  columns the ledger has and links the table; `quotes.md` says the three places a quote can appear
  twice; `readiness.md` says a run's duration is recorded and drawn and names its client parser and
  tests; `database.md` opens with a migration in five lines; `phone-and-touch.md` says how to
  reproduce at a phone's width; `timeline.md`, `ideas.md` and `quotes.md` say which modes have "Ask
  in chat" and where the pattern is.
- **The entry points**, under [engineering-manager.md § Along the way](../reusable/engineering-manager.md#along-the-way)'s
  *"a fix that only makes the doc match the code"*: `architecture.md`'s pipeline diagram said
  `hierarchy` and its fingerprint table listed a step that is gone; `design-css-overview.md`'s one
  breakpoint was *760px* and is 731, with 760 nowhere in the code; `security-map.md` described a 501
  from `requirePostgres()`, which went with the filesystem store. Six rule docs gained a section map
  and no other change.

**Not done, on purpose**: no doc was split, and no heading was renamed even where the heading is now
false (`deployment.md` § *What does not work in production yet* is all history), because a heading's
anchor is linked from elsewhere and a rename wants its own link sweep. Both lists are in § For the
next sweep.

## S4 — coverage

A scan of `src/`, `tools/`, `scripts/`, `infra/` and `evals/` for files no doc names found 496 of
1,603. Most are evals and one-off scripts, which `evals/README.md` and the plans own. Two real gaps:

- **`tools/fleet/` and `tools/overseer/`**: 256 files, about half named nowhere, and ten docs about
  them hanging off one entry point with nothing saying which to open.
  **[fleet-and-overseer-overview.md](../project/fleet-and-overseer-overview.md)** is the hub: a
  table from the task to the doc, the code by area with its way in, and the areas no doc owns
  (admission, holds and receipts, the Deploys tab, the launch protocol, most of the page's panels).
- **A chat started from a mode**: the measurement's T3 found nothing lists the places a new origin
  mode has to be told to. **[chat-from-a-mode.md](../project/chat-from-a-mode.md)** does, each
  marked loud or silent. One is silent in the way that matters: `originFromColumns` in
  `src/thread-origin.ts` falls through to "no origin" for any mode it does not name.

## S5 — GPT Sol's review

[The prompt](261007a-docs-sweep-signposts-truth-and-coverage-review-prompt.md) and
[the answer](261007a-docs-sweep-signposts-truth-and-coverage-review-sol.md). Candidate: the three
commits `bb90fab92`, `a6c8b1079` and `e42f25600`. Verdict **ship**, no P0, and **31 findings, 30 of
them P1, each fixed by the reviewer** in 25 docs (commit `f64676ebc`).

That is the number to remember about this method: of roughly 330 corrections made by Sonnet
subagents who were told to verify each against the code, about one in eleven was itself false or
claimed too much. Some replaced a stale sentence with a confident wrong one — `library.md`'s date
*"with no fallback"* (it falls back to `created_at`), `ingest-queue.md`'s new claim that fencing
never takes an expired claim away (`settleExpired` does), `supabase-local.md`'s *"this database and
nothing else"* (Storage holds the sources and images). Three were in the new `chat-from-a-mode.md`,
written by Opus: a wrong component name, a wrong test helper and the compiler-failure sequence the
wrong way round. **A truth sweep without a second family reading the result would have left about
thirty fresh errors carrying today's date.**

Six of the 31 were re-checked here against the source (R7, R13, R22, R23, R26, R28): all hold.

What it cleared: no instruction was changed in any rule doc; `public-shelf.md`'s rewritten
`robots.txt` paragraph is right; `feedback-reports.md`'s "fifth party" still means what it meant;
and AGENTS.md's *"bar one declared exception"* is one product feature, Live.

What it left: `security.md`'s sanitiser-stamp section *"would benefit from a larger historical
cleanup"*; it now says at its entrance what Postgres does.

A second, narrow round checked the reviewer's own 31 fixes and the two sections written after it
(§ Log has its verdict).

## S6 — the re-measurement, on the three tasks nobody had read

Six runs after the fixes, set against the six before. The before-reports were opened only once the
fixes were committed.

| | Before (two runs) | After (two runs) |
|---|---|---|
| T6, rename Debate | reached `rename-or-move.md` and `mode.md`; one run: *"mode.md is 620 lines; the relevant bit was found only by heading names"* | same route; one run: *"the 'In this doc' map found Retiring a mode at once. No complaint."* |
| T7, OSF landing page | reached `fetching.md`; one run: *"760 lines, and the OSF-relevant part is spread across three places"* | same route; one run: *"782 lines but its 'In this doc' list and headings made the right part easy to find"* |
| T8, shorten FAQ answers | both found from `faq.md` that the task's premise is false: FAQ writes no answers | the same, in six and seven tool calls |

**What that supports, and what it does not.** The complaint that a doc was too long to enter came
up in three of the six before-runs and one of the six after, and two after-runs credited the map by
name without being asked about it. That is the general fix working on tasks it was not written for.
It is six runs against six, on three tasks, by one model; the tool-call counts moved (15 and 14 down
to 8 and 8 on the slower run of T6 and T7) by about as much as two runs of one task differ, so I
claim nothing from them.

**What did not move, and should not have:** each task's own gap. Nothing lists the places a mode's
name is stored in the database, so all four T6 runs found the column, the two CHECK constraints and
the job names by grepping the schema. `fetching.md` says OSF "is still not" a paper source and links
the reason instead of stating it, so all four T7 runs could not tell whether the reason still holds.
Those were unread until now. Both are closed in the last commit of this job, after the measurement
and not counted in it.

T8 was a bad task, and a useful one: I wrote it believing FAQ mode writes answers. All four runs
found from `faq.md` that it does not, and said they would stop and ask.

One finding belongs to AGENTS.md: the rename rule sits under **Delegating**, and a T6 run found
`rename-or-move.md` by listing the directory. It is item 4b below.

## For Greg — the batch

Nothing in this section is done. Each item is a change to wording that is a rule, so it waits for a
yes. The numbers are for answering with ("1 and 3, not 2").

### 1. `version-control.md` — a merge conflict no longer goes to Greg

**Decided 2026-10-07: done** (997246843). Greg: *"re version-control.md changes - yes, approved"*.

**Background.** Since 2026-09-10 AGENTS.md says an agent resolves a merge conflict itself, asking
GPT Sol or Opus when unsure, and comes to Greg only for a real product trade-off. The sixth sweep
carried a note that `version-control.md` still said otherwise. Read end to end, it says so in one
sentence, in the list of reasons to merge rather than rebase.

Before (`docs/project/version-control.md`, reason 2 under § Always merge, never rebase):

> 2. **A replayed conflict is one round trip per commit.** Rebase replays each of your commits over
>    the new base, so a single conflict can surface as many times as you have commits — and under
>    git-resolve-merge-conflicts.md's *"Make a proposal. Don't make changes yet"* rule, that is a
>    round trip with Greg each time. One merge, one proposal.

After:

> 2. **A replayed conflict is one resolution per commit.** Rebase replays each of your commits over
>    the new base, so a single conflict can surface as many times as you have commits — and each time
>    git-resolve-merge-conflicts.md has you write a proposal and have it checked before you edit.
>    One merge, one proposal.

And in its See also, *"read both sides' history, propose before editing, and don't reach for the
commands that discard a side"* becomes *"read both sides' history, write the proposal down, resolve
it yourself (Sol or Opus if unsure; Greg only for a real product trade-off), and don't reach for the
commands that discard a side"*.

*Recommend:* yes. It makes the doc agree with a rule already approved.

### 2. "Merge `origin/dev` when you wake" is in one doc, and not the one agents load

**Decided 2026-10-07: the `version-control.md` pointer is done** (997246843); the optional AGENTS.md words were not asked for and are not added.

**Background.** The rule, with Greg's words of 2026-09-06, is in `worktrees.md` § The workflow and
nowhere else. `version-control.md` does not mention it and AGENTS.md does not either.

Proposed, in `version-control.md` after *"Most landings never conflict…"*:

> **Merge `origin/dev` when you wake up, too** — after a resume, a compaction or a long wait, before
> anything else, not only when the work is done: worktrees.md § The workflow.

And, optionally, eight words in AGENTS.md § Work in a worktree: *"…and merge `origin/dev` whenever
you wake."*

*Recommend:* the pointer in `version-control.md`, yes. The AGENTS.md words only if you see sessions
skipping it; that file is paid for on every turn.

### 3. `code-quality-overview.md` — the table of gates is missing two, and miscounts one

**Decided 2026-10-07: done.** Greg, 2026-10-07: *"re wording changes … yes to all (just try to keep them minimal, especially in AGENTS.md)"*.

**Background.** This table is what tells an agent which commands are gates. `scripts/check.ts` now
runs two it does not list, and there are four tsconfig projects, not three.

| Row | Before | After |
|---|---|---|
| `npm run typecheck` | all three tsconfig projects, plus guards that the checking happened | every tsconfig project (four today: the node side, the client, the fleet client, the tests), plus guards that the checking happened |
| `npm run build` | …**Both passes**: the client, then the API function | the same, plus: `npm run build:fleet` is a gate of its own inside `check`, because three fleet test files read its output |
| *(new row)* `npm run check:conflicts` | — | that no file carries a conflict marker — **gate** — static-analysis.md § Conflict markers |
| `npm run check` | all of the above bar the last, gates first | all the rows above it except `check:staged-revert`, gates first |

*Recommend:* yes to all four.

### 4. AGENTS.md — four things it should point at and does not

**Decided 2026-10-07: 4a, 4b and 4c done, kept short.** Greg, 2026-10-07: *"re wording changes … yes to all (just try to keep them minimal, especially in AGENTS.md)"*.

**Background.** Greg, 2026-10-06: *"…and that the important ones are linked to from @AGENTS.md"*.
Three one-line signposts are already in (the fleet hub, `chat-from-a-mode.md`, and the corrected
lines for `shelf-terms.md` and `fleet-dashboard-modes.md`); a signpost needs no approval. These four
change or add a sentence that tells an agent what to do, so they do.

- **4a. A reader's report.** Both runs of the "a reader reported…" task guessed the file name.
  Proposed, under § Before you call it finished: *"**Handed a reader's report from the Feedback
  button?** feedback-reports.md is the whole run: reading the report, the three ways it ends, and
  the note."*
- **4b. Renaming.** The rename rule is under § Delegating, because it says to send a subagent. An
  agent planning a rename looks under § Writing code. Proposed: move the bullet there unchanged, and
  add to its end *"…and a name a reader sees is renamed all the way down, stored values included:
  rename-or-move.md § A rename on screen is a rename all the way down."*
- **4c. The fleet and the Overseer.** Proposed, as a fourth doc in the "worth reading before you
  touch the area" sentence: *"…and **fleet-and-overseer-overview.md** before anything under
  `tools/fleet/` or `tools/overseer/` — ten docs and 256 files, and it says which to open."*
- **4d. Withdrawn.** AGENTS.md describes `ai-gateway.md` as *"every paid call goes through
  OpenRouter, bar one declared exception"*, and the code declares six things outside the gateway. I
  suspected the line. GPT Sol checked: the one exception is one product feature, Live, and the other
  entries are tools and evals, which the line is not counting. It stands.

*Recommend:* 4a and 4b yes; 4c yes if the Overseer agrees the hub reads true.

### 5. `vision.md` — "Where this goes after granularity zoom" lists built things as future

**Decided 2026-10-07: done.**

**Background.** The list marks three items **Built** and leaves the rest as intentions. Two of the
rest exist: *Notes and highlights* (Comments, since August) and *Recall* (Learn and Quiz). The
heading also names granularity zoom, whose columns went on 2026-09-29. This is the intent doc, so I
have not touched it.

Proposed: mark those two **Built** with a link each (`comments.md`; `learn-mode.md` and `quiz.md`),
in the same form as the three above them, and leave the heading and every other line alone.

*Recommend:* yes. It is the smallest change that stops the doc under-reporting what exists.

### 6. The push checkpoint — the cheapest mechanism

**Decided 2026-10-07: B, a hint, to be built and judged after a week.**

**Background.** The policy now says: check the docs before you push, for the areas your change
touched. Nothing prompts it. This sweep is the evidence for what happens without a prompt: about 230
statements had gone false, most of them a removal that was never followed into the docs.

Three options.

```
A. Nothing more            B. A hint at push                  C. A gate
   the policy line only       the existing Bash hook sees        npm run check fails if a
                              `git push` and prints:             changed file is named by a
                              "these docs name files you         doc that did not change
                              changed and were not touched:
                              structure-step.md (structure.ts)
                              mode.md (modes.ts)"
   costs nothing              ~60 lines, never blocks            blocks; most hits are false
   prompts nothing            prompts at the right moment        (a doc names a file whose
                                                                 change it does not care about)
```

**B in use:** an agent that edits `src/structure.ts` and pushes sees two doc names it had not
opened, reads the two sections, and either fixes a sentence or moves on. It costs one grep of
`docs/project/` per push. **What B gives up:** it cannot tell a relevant change from an irrelevant
one, so some of its lines will be noise, and a hint that is usually noise gets ignored. The honest
test is to run it for a week and count how often its list led to an edit.

*Recommend:* B, built as a hint and reviewed after a week; not C.

**Built 2026-10-07** as [`.claude/hooks/push-doc-hint.sh`](../../.claude/hooks/push-doc-hint.sh),
a second hook on the Bash `PreToolUse` matcher beside `protect-shared-tree.sh`. It is a separate
file because the two have opposite contracts: that one refuses on any doubt, this one always exits
0 and goes quiet on any error. "Changed" means the files in the non-merge commits of
`origin/dev..HEAD`. The hint goes to the agent as `additionalContext`, because stderr on exit 0
reaches nobody. Non-push calls return before Git or the doc scan; a push costs about 0.5s, and the
doc scan is one grep. The time bound is the registration's `timeout: 5`, past which Claude Code lets
the call through. Its tests are `bash .claude/hooks/push-doc-hint.test.sh`.

GPT Sol's code review
([answer](261007a-docs-sweep-push-hint-code-review-sol.md)) fixed rename handling, nested docs, a
pipeline that could print a hint from partial `git` output, and a missing-file guard on the
registration. It also added a Python shell tokenizer, a self-re-exec under `timeout` and size caps,
which took the hook to 216 lines. I took those three out again. Greg had asked for minimal, and a
wrong guess costs one line of noise: `echo "git push"` gets a needless hint, and
`cd elsewhere && git push` gets the session repo's list. The test file says so.

**It will be judged on 2026-10-14** by how often its list led to a doc edit. Every hint appends a
line to `push-doc-hint.log` in the shared `.git` directory, giving the time, the HEAD pushed and the
docs named, so the review can check each line against later commits. Queue item `qi-hxg5w49c` asks
the Overseer to do that review.

### Three questions that are not wording

**Answered 2026-10-07.** 1: the live endpoint is subscribed — `npm run stripe:check -- --prod` checks every event in `HANDLED_EVENTS`, this one included, and passed (so "stripe:check does not look" below was wrong). 2: Greg, *"yes it does"*; auth.md's section marked history. 3: Greg, *"yes"*; splitting is a second job.

1. **Is `invoice.finalization_failed` switched on at the live Stripe endpoint?** The endpoint was
   set up on 2026-09-03; the code began handling that event on 2026-09-04. If the event was never
   added in the Stripe dashboard, an invoice that cannot be collected is never noticed. Nothing in
   the repo can tell, and `npm run stripe:check` does not look. Only the dashboard can answer.
2. **Does Google sign-in work in production today?** `auth.md` has a heading *"The button on the
   live site does not work yet"* from 2026-08-27, and says the consent screen is in Testing, which
   would admit only listed users. Your words of 2026-09-29, *"We're currently emphasising Gmail"*,
   suggest it works. If it does, that section is history and I will mark it so.
3. **May the over-long docs be split?** Twenty-odd reference docs are mostly dated narration around
   a small live core. The policy says the story belongs in a plan. Splitting moves anchors that
   other docs link to, and deciding what is history is a judgment on each, so I mapped them and did
   not split them. A yes means a second job: one doc at a time, the live part kept, the history
   moved to `docs/plans/` or `docs/investigations/` with links repointed. § For the next sweep has
   the list and a proposed cut for each.

## For the next sweep

**Docs worth splitting**, with the cut each reader proposed:

| Doc | Lines | The cut |
|---|---:|---|
| `ingest-queue.md` | 2,580 | mostly dated history; keep the queue's contract and routes |
| `search.md` | 1,820 | the third search and the embedding eval to `library.md` |
| `billing.md` | 1,760 | the quota section (about 540 lines) to `billing-quota.md`; "The first live sale" is narration |
| `glossary.md` | 1,710 | the mode / term look-up and Dig deeper / history |
| `diagram.md` | 1,690 | "The graph Force is drawn from" (360) and the step bar (200) out; August review stories to a line each |
| `overseer-direction.md` | 1,670 | attention (285 lines), the backlog (275) and usage limits (115) each to a doc |
| `structure-step.md` | 1,650 | "Two passes" (370 lines of eval history) to an investigation |
| `testing.md` | 1,600 | five docs in one; its per-file table lists about 40 of 1,764 test files |
| `comments.md`, `chat-tools.md` | 1,530, 1,210 | by topic |
| `performance.md` | 1,500 | about 300 lines of recipes; twelve dated write-ups to `docs/investigations/` |
| `library.md` | 1,400 | shelf actions; cached paint, preload and offline |
| `database.md` | 1,450 | the migration ledger, fork and repair material to `migrations.md` |
| `deployment.md` | 1,330 | site visibility and health each to a doc; 150 lines of a wall that is gone |
| `security.md` | 1,320 | three history sections to a postmortem |
| `worktrees.md` | 1,240 | how to operate / how it came to be |
| `referee-mode.md` | 1,170 | Candidates (150 lines of wire measurements); website copy notes to `website-text.md` |
| `content-extraction.md` | 1,140 | Readability / refusals and the bot-check registry / metadata |
| `web-client.md` | 1,050 | five topics; appearance and client data each to a doc |
| `touch.md`, `keyboard.md`, `url-state.md` | 940, 840, 890 | each is half the removed gist columns in the present tense |
| `granularity-zoom.md`, `column-context.md` | 920, 445 | 500 lines and 440 lines of history around a small live core |
| `reading-view-overview.md` § the command bar | 250 | says it has no doc of its own; has outgrown that |

**The split, done 2026-10-07 (question 3), and what it found.** The ten worst docs above were split
with one rule set: what is true now, the intent, every Greg quote and the signposts stay; dated
narration moves verbatim to `docs/plans/261007g-<doc>-history.md`, or to the plan it came from, with a
pointer left behind; no sentence reworded and no topic carved out. Each doc was done by an Opus
subagent. A sentence-level checker then confirmed that every old sentence survives in the doc or a
destination, and `tests/doc-links.test.ts` stayed green. GPT Sol reviewed each batch and moved back
what it judged live: the claim guidance, the billing traps, a Greg instruction in `glossary.md` and
Greg's archive intent in `library.md`. Each doc is its own commit.

| Doc | Lines before → after |
|---|---|
| `ingest-queue.md` | 2,677 → 2,579 |
| `search.md` | 1,844 → 1,786 |
| `billing.md` | 1,765 → 1,700 |
| `overseer-direction.md` | 1,706 → 1,661 |
| `glossary.md` | 1,706 → 1,660 |
| `diagram.md` | 1,705 → 1,579 |
| `structure-step.md` | 1,660 → 1,557 |
| `testing.md` | 1,632 → 1,549 |
| `comments.md` | 1,571 → 1,533 |
| `library.md` | 1,568 → 1,523 |

**About 4–7% came out of each, not the half the table implied.** All ten agents and all three
reviews say the same thing. These docs are not mostly narration. They are mostly live reasoning
with a date attached: "since X it does Y, because Z". A sentence like that is both, and moving text
without rewording cannot split it. So the length that is left is in two places, and each would be
its own job:

- **Topic splits.** Most proposed cuts in the table are topics, not history: billing's quota
  section; diagram's "graph Force is drawn from" and step bar; overseer-direction's attention,
  backlog and usage limits; glossary's dig-deeper and look-up; library's shelf actions, cached paint
  and offline; search's third search; testing's five docs; structure-step's deepening wave. Each
  needs a new `docs/project/` doc with an owner line, so it needs a yes per doc.
- **Rewriting the mixed sentences into the present tense**, with the dated part moved to the plan.
  That is rewording, which Greg's rule for this job ruled out. It would shrink these docs most, and
  it is the riskiest edit there is to a rule doc.

**Left from the list:** everything below `library.md` in the table (`database.md`, `performance.md`,
`deployment.md`, `security.md`, `worktrees.md`, `referee-mode.md`, `content-extraction.md`,
`web-client.md`, the gist-column trio, `granularity-zoom.md`/`column-context.md`, and the command
bar). The job stopped at ten, as briefed.

**Statements the splitters found false and left alone**, because this job moves text and does not
correct it. Each is a one-line fix for whoever owns the area. **All taken on 2026-10-07 by
a follow-up session, [§ Log](#log)**: each was checked against the code, and each is marked *fixed* or *wrong* (the doc
was still true) below.

- `ingest-queue.md` § When this becomes Postgres still argues from concurrency 1 and from files.
  Concurrency is `SPIDERYARN_JOB_CONCURRENCY`, and the files are gone. — *Fixed*: the cap is now
  "concurrency 1 when this was written, `SPIDERYARN_JOB_CONCURRENCY` since" (`src/jobs.ts`), and the
  files sentence is in the past tense.
- `search.md` § The mode band says the gist columns go away while you search. They were removed on
  2026-09-29. The fallback bullet says "just under 0.7 prints as 70", but the floor is 0.65. —
  *Fixed*, both (`QUICK_FLOOR = 0.65` in `src/quick-search.ts`).
- `billing.md`: "The live row that needs a backfill" is probably moot, since that subscription was
  scheduled to end 2026-10-03. The ChatGPT-tiers note says multiples of 50 cents, while the live section says whole
  units. — *Fixed in part*: the ChatGPT note was right; it was the live section that was wrong
  (`tests/billing-tiers.test.ts` asserts `% 50`). The section now opens with "probably moot,
  unverified": `customer.subscription.deleted` resyncs the row, but the production read that would
  confirm it was refused this session's permissions. **Still open: someone with production access
  reads that row.**
- `overseer-direction.md` says the scheduler has no home, but `scripts/overseer.ts` arms
  `OVERSEER_JOBS`. It also contradicts itself twice: Two tenses against Divergence on who owns the
  vitals history, and § The gates against § Route on who drops a case. — *Fixed*, all three: the
  scheduler is `tools/overseer/scheduler.ts`, armed by `OVERSEER_JOBS_ENABLED=1` or, for deterministic
  rules only, `OVERSEER_RULES_ENABLED=1`; session jobs remain held without a launch protocol. The
  vitals history is the dashboard's (`tools/fleet/health-history.ts`); dropping a case is Greg's, as § The gates and
  `overseer.md` say. **Code left for the Overseer:** `tools/overseer/attention-classify.ts`' prompt
  still routes "whether a case can be dropped" to `"fable"`, which is both the wrong owner and a
  retired model.
- `glossary.md` § Where it lives says the Dock is a toggle; it is a `radiogroup`. § What is still
  open has two near-duplicate bullets. — *Fixed*, both; the two bullets are one.
- `diagram.md` contradicts itself in three places:
  - Lanes says sideways means centrality, but the moved story says `laneX` was rewritten away
    from exactly that. — *Fixed* (`src/web/scatter.ts`, `laneX`).
  - The visitor section says Force is the default, but Sketch has been since 2026-09-04. — *Fixed*.
  - The Interaction bullets say ← folds a node, but the "Folding a part away is gone" bullet says
    it does not. — *Fixed* (`DiagramPanel.tsx`).

  It also says "never the other six" when there are five pictures. — *Fixed*: "the other three",
  five kinds less the two the gate covers.
- `structure-step.md` § Worked example says the example tree stands in "until stage 4 exists". The
  Schema block omits `question` and `treatment`. — First *fixed*. Second *wrong* as a false
  statement: the prose above the block already said those fields were missing. The block was
  brought up to date anyway, from `src/types.ts`.
- `testing.md`:
  - Three lanes says "five today", but `LANES_BEYOND_THE_SCAN` needs counting. — *Wrong*: it has
    exactly five. `vitest.config.ts` and one entry's reason said four; both corrected.
  - "A wedged row's second symptom" describes a skip that can no longer happen. — *Fixed*: it now
    arrives as a failure, `Nothing answered on that DATABASE_URL`.
  - The `takeRunLock` advice names a `reachable` that `pgReady` no longer returns. — *Fixed*.
- `comments.md`:
  - "There is one reader" is wrong, since `pg-comments.ts` stamps `ownerId`. — *Fixed*.
  - The transport table says one POST, but the answer streams. — *Fixed*.
  - "No way to see every comment at once" predates the drawer and Marginalia. — *Fixed*, as history
    with both named.
  - "Three things" item 4 says a duplicate POST resets the comment, but `create` answers 409. —
    *Fixed*, but the finding was half right: the same Save twice gets the stored row back, and
    409 is only for a different comment. Retry resets in `beginAnswer`.
- `library.md`:
  - It says `/read/public` 404s, but the public shelf renders. — *Fixed*.
  - "Both stores" and "the filesystem store has no visibility column" describe a store that is
    gone. — *Fixed*.
  - The **Archived** chip is now **Include archived**. — *Fixed*.

**Headings that are now false** and were left, because a heading's anchor is linked from elsewhere:
`deployment.md` § *What does not work in production yet* and § *Still to do before this is a real
deployment*; `sentry-error-monitoring.md` § *The two gaps, both open*; `auth.md` § *The button on the
live site does not work yet*; `ai-gateway.md` § *The three calls allowed round the outside…* (five
now) and § *One gateway, five wires* (six); `live-conversation.md` § *Which model, and why not
GPT-Live yet*; `setup-dev.md` § *Signing in needs four more* (five). — **Taken on 2026-10-07**: seven
renamed, with every link to them repointed. They are now *What did not work in production at first*,
*What it took to become a real deployment*, *The button on the live site did not work at first*,
*The calls allowed round the outside, and the test that keeps them declared* (17 declarations and
6 unmetered, so no count was right), *One gateway, a wire for each shape*, *The default model, and
why it is not GPT-Live*, and *What signing in needs*. The Sentry one is *unverified in part*:
the missing-DSN gap is still open (`SENTRY_DSN` is `breaks: null` in `src/vercel-health.ts`). There
is no alert configuration in the repo, but that cannot establish whether external Sentry alert
rules exist. The heading was left alone; calling both gaps open needs a Sentry-side check.

**Code areas no doc owns**, from the hub's survey of `tools/fleet/`: admission; holds, receipts and
request keys; new, rename and describe session; the Deploys tab, diagnostics and revision; the
launch protocol; the Sessions, Box health, Overseer, Queued ideas, Deploys and Questions panels.
And `admission-journal.ts` at the repo root, which `vitest.config.ts` imports.

**Code findings**, reported and not fixed, because this job is docs:

- `originFromColumns` in `src/thread-origin.ts` is not exhaustive: a new origin mode reads as "no
  origin" and nothing fails. `ORIGIN_MODES`' `satisfies` does not catch an omission either.
- `--danger` and `--ink-faintest` are used in four rules and defined nowhere, so each always takes
  its fallback (the sixth sweep's item 3, confirmed).
- `tests/public-client-fetch.test.ts` cites `requirePostgres` and the filesystem store's 501 in a
  comment; `src/ingest.ts` near line 424 has the same era's comment on `isSlug`.
- `mode.md`'s list of what a new mode turns red predates `MODE_CATALOG`, `MODE_ICON` and
  `MODE_TARGET`. It wants re-measuring by adding a mode on a scratch branch.

**On the method**, for whoever runs the next one:

- **One job per brief.** Asked for truth, a map, signposts and a report, eight of nineteen agents
  skipped the truth read. Asked only to read every line and say the last line number read, fourteen
  of fourteen did.
- **A subagent may be refused a findings file outside the repo** in this harness, though the first
  sixteen were not; plan for the report to come back as the reply.
- **The anchor rule is the test's, not GitHub's**: a run of spaces becomes one hyphen. Fifteen map
  links broke on it.

## Log

- 2026-10-07 — S1 measured, S2 landed.
- 2026-10-07 — S3 round one and round two, S4, and S6 landed; S5 round one, ship.
- 2026-10-07 — the two held-back gaps closed (`mode.md` § Renaming a mode, `fetching.md` on OSF).
- 2026-10-07 — S5 round two,
  [ship](261007a-docs-sweep-signposts-truth-and-coverage-review-2-sol.md): all 31 of round one's
  fixes hold. Seven findings in the two new sections, six P1, each fixed: the stored-name list in
  `mode.md` had missed `jobs.reset.regenerate[]`, the stored prompt tag, the browser's saved view and
  offline keys, and the feedback rows that keep the old name as evidence; and `fetching.md` said
  `asked_url` already makes an OSF article findable, when that look-up needs a registered source.
  Two re-checked here (S2 against the Skim migration, S7 against `find-article.ts`). Discovery is
  closed at two rounds.
- 2026-10-07 — merged `origin/dev` (three conflicts on one fact, in `fleet-dashboard-modes.md` and
  its two one-line descriptions: `0664f77bd` had made the last unchecked registration a compile
  error; their side kept). On the merged tree `de1c9b5f9`: `npm run typecheck` clean, `npm test`
  1,760 files passed and 1 skipped, doc-links 17 of 17. Pushed to `dev` as `17dc16dca` after a
  second merge that brought only other sessions' commits. Not deployed.
- 2026-10-07 — Greg said yes to item 6 (B) and question 3. The push hint was built and GPT
  Sol reviewed it (§ 6). The ten worst docs were split, with a GPT Sol review for each batch of three
  or four (§ For the next sweep, *The split*). Not deployed.
- 2026-10-07 — the two left-alone lists taken by a follow-up session (worktree
  `261007-docs-false-statements`), each claim checked against the code: of 26 statements, 23 fixed,
  two wrong and one (the billing row) unverifiable without a production read; of eight headings,
  seven renamed with every link repointed, one unverified in part. Four stale code comments found
  on the way were
  corrected too (`vitest.config.ts`, `tests/store-migration-registry.ts`,
  `tests/billing-tiers.test.ts`, `tests/helpers/pg-ready.ts`). Left for the Overseer: that
  production read, and `attention-classify.ts` routing case-dropping to a retired model.

**Where it stands: done enough to stop here.** The signposts were measured and mended, the tree was
read for what is false, and the two areas with code and no hub have one. What remains is real and
is not this job's to take without a yes: the batch above, and the splitting of the over-long docs.
