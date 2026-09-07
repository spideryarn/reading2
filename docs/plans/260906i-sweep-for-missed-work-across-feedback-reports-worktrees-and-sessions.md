# Sweep for missed work: feedback reports, worktrees, and sleeping sessions

**Status:** the dispatch is done and most of it has landed, 2026-09-07. § How the fourteen turned
out is the record. Two things wait on Greg, one of which blocks a deploy. Written before the work, per
[engineering-manager.md](../reusable/engineering-manager.md).

Greg asked for a sweep rather than a feature: *find anything valuable that we had intended but
didn't get round to*, and put an agent on each of it. Three places hold that kind of debt, and they
fail in different ways, which is why all three get looked at rather than just the queue:

| where | how work goes missing there |
|---|---|
| the Sentry feedback queue | a report arrives and nothing picks it up — visible, because `is:unresolved` is the bookkeeping |
| `docs/user-feedback/` and `docs/plans/` | a report **shipped**, with the hard half named as deferred inside the note — invisible, because the issue is `resolved` |
| worktrees and `gjd-remote` sessions | a session finished a stage and stopped, or died; the commits are real and on no branch anyone reads |

The third is the one nothing watches. `git status` is clean in a worktree whose branch is five
commits ahead of `dev`, and `gjd-remote ls` says `idle` for both "finished and pushed" and
"stopped halfway".

## What done looks like

- Every unresolved feedback report has an agent on it, or a written reason it does not.
- Every worktree/branch with unmerged commits is either landed, given an agent, or written down
  here as deliberately abandoned.
- Every idle session that stopped mid-job is resumed or superseded.
- Nothing is deployed. The loop lands on `dev` and stops
  ([feedback-reports.md](../project/feedback-reports.md)).

## Stages

1. **Trawl** — four parallel audits: the Sentry queue, the feedback notes' deferrals, the plans'
   unfinished stages, the worktrees and sessions. (Findings below.)
2. **Judge** — Fable on which of the deferred product work is worth doing at all, GPT Sol on the
   engineering-shaped items. The bar is [vision.md](../project/vision.md), not "the request was
   harmless".
3. **Dispatch** — one `gjd-remote` session per item, `--wait` staggered across 3–8h so no more than
   about three run at once, and so two agents never land on the same files in the same wave.
4. **Record** — this doc updated with what went out, and `awaiting-approval.md` with anything that
   needs Greg.

## Findings

### The Sentry queue is not where the debt is

39 feedback issues in thirty days: 37 `resolved`, one `ignored` (the test submission), and **one
unprocessed** — `SPIDERYARN-READING2-2A`, filed by Greg at 17:09 UTC today. `awaiting-approval.md`
has nothing awaiting approval. So the bookkeeping the loop is responsible for is being done, and
looking only at the queue would have found one afternoon's work and concluded the tree was clean.

### Most of the in-flight work already has an owner

Sixteen `gjd-remote` sessions are alive, and the ones holding half-finished worktrees have mostly
armed their own wake-ups. **`a1-a3` is the case worth stating carefully**, because the session audit
and the worktree audit contradicted each other and one of them was reading a progress bar: the
refactor is real and finished-looking, and its session has a cron one-shot at 03:23 that starts with
`git fetch && git merge origin/dev`, deliberately deferred so a conflict resolution can be shown to
Greg rather than guessed at. So **nothing new should be pointed at `a1-a3`, `a5`, `a8`,
`deepen-fat-sections` or the command bar** — they are asleep, not abandoned, and a second agent on
the same worktree is worse than none.

That leaves a much shorter list than the audits suggested: the work with **no owner at all**.

### The debt is in worktrees nobody swept

Verified rather than taken from the audit: `origin/dev` is `4459a045`, its `src/web/App.tsx` is
**6,105 lines**, and `worktree-a1-a3-reader-composition` is **8 commits ahead** carrying
`src/web/modes/{conversation,debate,diagram,glossary,ideas,…}` — the split of that file into ten
mode controllers, 93 files, +10,867/−5,849. Its own plan doc says stages 1–4 are built and
committed. **None of it has touched `dev`.**

That is the biggest single piece of finished-but-unlanded work in the tree, and it is also the one
that rots fastest: `critiques-mode`, `structure-mode` and `a5-mode-surface` all have live edits to
`App.tsx`, so every day it waits, the merge gets worse. **It goes out first, and the others go out
in later waves so they merge onto the new shape rather than the old one.** That ordering is the main
reason this sweep is scheduled in waves at all.

| worktree | state | judgement |
|---|---|---|
| `a1-a3-reader-composition` | 8 commits, plan says stages 1–4 done | land first — finished-looking, and blocks the rest |
| `pdf-figures` | stages A–E done, F is "browser pass running" | cheap to finish |
| `a10-style-ownership` | mid-merge: conflicts fixed, not committed | one commit and a push |
| `back-to-where-you-jumped-from` | "Stages A and B built; B2, C and the docs are not" | close; finish it |
| `structure-mode` | stage 1 committed, a large uncommitted stage 2 stalled | resume — first work out what the uncommitted diff is |
| `a5-mode-surface` | top commit says "written but not yet verified" | needs the verification pass before it can land |
| `a8-shared-geometry` | plan says stage 3 blocked on five P1s from Sol | only worth resuming with the P1s |
| `delete-article-permanently` | 3 P0s fixed, uncommitted migration, blob-GC race left open | **needs Greg** on the blob-GC race |

Sixteen other branches and worktrees are fully merged and can be swept without ceremony.

### Three findings that did not survive checking, and why that is the point

A sweep like this is mostly other agents' claims, and a deferral decays in both directions — the
work sometimes gets done and nobody updates the note. Three of the trawls' recommendations were
wrong, all three in the comfortable direction of "here is more work to do":

- **`tests/client-imports.test.ts` is red on `dev`.** It is not. It passes; the import it complains
  about moved to `../step-order.js` on 2026-09-04.
- **`/design` answers 200 with no server-side gate.** True, and deliberate, and documented as such
  in [admin.md](../project/admin.md) and `src/web/router.ts`: the page reads no data, so there is
  nothing behind it to refuse anybody, and its code is a public asset either way. It is on the
  admin list as developer furniture, not as a defence.
- **`open-questions.md` should lose Q2, Q3, Q7, Q9 as decided.** Q2, Q3 and Q9 are *already*
  collapsed to anchor stubs, which is what keeps eight inbound deep links working. And Q7 is still
  genuinely open — "log a real ingest end to end" is the part that never happened, and it is now
  one run rather than an experiment, because `src/pipeline.ts` already logs the four token counts.

The last of those turned a proposed deletion into a small piece of real work.

### And in "Recorded, not built" inside notes that shipped

The pattern worth naming: a report ends `resolved`, correctly, and the *hard half* is written into
the note as deferred — where nothing ever reads it again, because `resolved` is the end of the
bookkeeping. The debate/glossary postmortem is the clearest case: readers are still told a
permanent, **charged** failure is "worth a go" on a second attempt, because `PublishRefused` has no
reason kinds.

## What ownership changes about the answer

Fable's ranking was made without the session audit, and it named four worktrees that already have a
live agent inside them. **Ownership is the first filter, ahead of value**: a second agent on an
owned worktree is worse than no agent, because it produces a conflict nobody asked for in a tree
somebody is mid-review on. Measured, not assumed — `git rev-list --left-right --count` and a
`git merge-tree` dry run against today's `origin/dev` for each:

| worktree | ahead / behind | conflicts | owner | verdict |
|---|---|---|---|---|
| `a1-a3-reader-composition` | 8 / **125** | 2 (`App.tsx`, `site-footer.test.tsx`) | cron-armed 03:23 | **Greg's call** — see below |
| `a10-style-ownership` | 9 / 83 | 2 (`styles.css`, `spine-width.test.ts`) | working, on those two | leave alone |
| `back-to-where-you-jumped-from` | 8 / **0** | 0 | working, Stage B review | leave alone |
| `delete-article-permanently` | 5 / 3 | 0 | working | leave alone |
| `a5-mode-surface` | 5 / 5 | 0 | cron-armed | leave alone |
| `pdf-figures` | 2 / 58 | **0** | **none** | dispatch |
| `structure-mode` | 4 / **593** | **19** | none | abandon the tree, keep the plan |

### `a1-a3` is not a scheduling crux, and that was the day's biggest correction

The first read of this sweep was "land the App.tsx split first, because everything else conflicts
with it the longer it waits". That was wrong twice over, and Fable caught it:

1. **The branch is 125 commits behind, not merely ahead.** Only two files conflict, so it is not
   a redo — but the file that conflicts is the one that lost 5,515 lines, so resolving it means
   deciding, for every feature added to `App.tsx` in those 125 commits, which of the ten new mode
   controllers it belongs in. That is careful work, not a merge.
2. **[260905e](260905e-main-app-architecture-review.md) says in its own status line: *"reviewed
   proposal, not adopted or built"*.** Landing it tonight would be an unapproved architecture
   change made by an unattended sweep, which is exactly the thing this project's rules reserve for
   Greg.

So it goes to Greg as a question, and the right order is the opposite of the first instinct: land
the small, clean `App.tsx` touches first, then do the split as a declared freeze with nobody else in
the file.

## The GPT Sol review, and what it changed

Sol reviewed this plan before anything was dispatched, found no P0s and five P1s, and **four of the
five were right about things I had checked myself and got wrong**. They are recorded here rather
than quietly fixed, because each is a different way a sweep like this goes wrong.

- **R3 — S3 contained work that is already built.** Class-killer (b), the biome-config guard, exists
  on `dev` as `tests/biome-config-is-live.test.ts`. I had "verified" it as unbuilt by checking that
  the `lint` script asserts nothing — which was true, and irrelevant, because the fix landed as a
  test rather than as the `package.json` change T2.1 proposed. **I checked the proposed shape of the
  fix instead of the class it closes.** Item (b) is dropped.
- **R1 — S5 is an edit to a defence, and I judged it additive.** Wrong.
  [security-map.md § Where the defences physically live](../project/security-map.md#where-the-defences-physically-live)
  lists `src/routes.ts`, `src/fetch.ts` **and** `src/link-summary.ts`, whose row explicitly names
  *"its own limiter bucket, with a day and a global fuse, because this one spends money"* — the very
  machinery S5 was told to copy. "Additive" describes the diff, not the authorisation boundary. S5
  becomes a **plan-only session**: research, plan doc, Sol review, a line in `awaiting-approval.md`,
  and nothing built.
- **R4 — the `a1-a3` question to Greg was stale.** The work has its own plan —
  `260906c-separate-article-access-reader-composition-and-mode-controllers.md`, which is **on the
  branch and not yet on `dev`**, so it cannot be linked from here — with its own stage-1 and
  stage-3/4a Sol reviews and a status line reading *"stages 1–4 built and committed"*. 260905e's "not adopted" is the umbrella review; 260906c is the commission. So it is
  **active work with a live owner**, not an architecture change awaiting approval, and the right
  action is neither to land it nor to ask about it but to leave its owner to the 03:23 merge it has
  already scheduled.
- **R2 — the waves were delays, not ordering.** `--wait` staggers starts; it does not make S1 land
  before S3 begins. Sol also found a collision the plan missed: S2 must reach `src/pipeline.ts`
  (`acquireUpload` rejects non-PDF input and builds a PDF manifest), which the live
  `extraction-stage-c` session is editing. Every brief now carries its dependency as an instruction
  the agent checks for itself — *is this on `dev` yet, and if not, do the part that does not
  depend on it* — because that is the only form of ordering a wall clock can actually deliver.

Its one P2 worth taking whole (**R7**): `src/pdf-read.ts:782` throws a bare `Error` for a missing
`OPENROUTER_API_KEY`, so a permanent misconfiguration flows into the retryable path. Same class as
S1's, so it joins S1 rather than becoming its own job.

I disagreed with nothing material enough to overrule.

## Dispatched

Five sessions that build, and one that only writes. Ownerless work only, `--wait` staggered.
Nothing starts now: load average was 21.7 on 16 cores with ten sessions live.

| | wait | the job | ordering it must respect |
|---|---|---|---|
| S1 | 3h | **`PublishRefused` reason kinds** — permanent vs transient, so a deterministic refusal stops inviting a charged retry. Plus the missing-key case in `src/pdf-read.ts` | first; owns `src/jobs.ts` for the night |
| S4 | 4h | **`pdf-figures` stage F** and land it | early on purpose — it touches `App.tsx`, and should land before `a1-a3` merges at 03:23 |
| S2 | 5h | **Report 2A** — upload an HTML file; verify a URL to a PDF works | after `extraction-stage-c` lands; hard stop before any defence |
| S3 | 6.5h | **Class-killers a, c, d, e** (not b, already built) plus **a conflict-marker check** in `npm run check` | after S1, because of `src/jobs.ts` |
| S5 | 7h | **A spend cap on the paid per-request endpoints** — **plan and review only, nothing built** | none; it writes no code |
| S6 | 8h | **The depth-1 node with no Socratic question**, and **Q7 — one real ingest, logged** | the ingest run goes last and alone |

### The largest finding, which is not a job

An audit of all 89 postmortems found **roughly ninety prevention items still unbuilt**, extracted
from about 230 recommendations. That is the same shape as
[260905b § T2.1](260905b-improve-the-codebase-third-sweep.md)'s finding at four times the scale, and
it is not something to dispatch — it is the input to the next
[improve-the-codebase](../reusable/improve-the-codebase.md) sweep, and it wants the shape-and-age
classification T2.1 says has never been done. Two of them are cheap enough to have been pulled out
into S7; the rest are recorded here so the next sweep starts from a list rather than from a grep.

Its top-ranked item is worth naming, because it kills four postmortems' recommendations at once:
**tracked adversarial fixtures for the hierarchy and label pipeline** — a one-word block, a
headingless title, an old-HTML page, a supplement-treatment block. 260830a, 260830e, 260831b and
260905d each independently say the corpus never had that shape, which is why the bug was invisible.
It is a day's work and it is not tonight's, because live sessions are in exactly those files.

### Three more claims that did not survive checking

The trawls are cheap and they are wrong in the same direction every time — towards *more work to
do*. Alongside the three earlier ones:

- **"Five file readers should move to `dataRoot()`"** — `src/store/data-root.ts` and
  `src/job-scope.ts` were **deleted on 2026-09-05** when every store became Postgres. The
  recommendation points at a module that no longer exists.
- **"`db:chain` should run after a merge touching `drizzle/`"** — already built.
  `scripts/check.ts:148` runs it. Only the conflict-marker half of that recommendation is missing,
  and that is what S7 gets.
- **Fable's "`a1-a3`'s one substantive change is `App.tsx` +2/−5,515"** — that is the diff of one
  file. There are 93 files and ten new mode directories. It did not change the conclusion, but it
  would have made the brief wrong.

**A deferral is a claim, and it decays in both directions.** Six of the roughly forty candidates
this sweep started with were already done, already deliberate, or aimed at deleted code. That is
the argument for checking each one in the tree rather than believing the note — and it is the same
rule 260905b states about itself and then breaks once, in the item it labels "the cautionary one,
and it is mine".

### Deliberately not dispatched

- **Dictation on real speech** — an agent would only synthesise a corpus again, which is the thing
  that made the existing numbers unconvincing. It needs Greg to record about ten clips.
- **The quiz difficulty slider** — the simplest version already shipped, and the note's own analysis
  shows the proposed blend reproduces the original complaint. A knob for something that should be a
  default.
- **Reader-added glossary terms, and the tweet-thread chat tool** — the first needs a migration and
  a public-projection decision; the second compresses the article for an audience somewhere else,
  which is close to an anti-goal.
- **`structure-mode`** — 593 behind, 19 conflicting files, and its last commit had drifted from
  *merging* Hierarchy and Outline into *adding a third mode*, which is the opposite of the intent.

## The second wave: what Greg's answers changed

Greg answered seven questions in one sitting on the evening of 2026-09-06 and then went to bed with
*"proceed autonomously, fanning out with `gjd-remote new-claude` with `--wait` set randomly within
7-12h"*. The answers are the interesting part of this document, because **three of the seven were not
one of the options put to him**, and two of those dissolved a trade-off an agent had already accepted
as fixed:

| asked | answered | what it changed |
|---|---|---|
| per-reader spend cap? | **no — the OpenRouter account already has a global monthly cap** | session killed; recorded in [ai-gateway.md](../project/ai-gateway.md), with what the account cap does *not* buy |
| Structure mode: replace, drop, or third? | **third, behind Experimental Features** — *"I don't know if Structure will be better, so let's build it as a third, and that way I can flip back and forth to compare"* | the objection ("the band is meant to shrink") simply does not apply behind the switch. It is an instrument, not an addition |
| permanent delete: blobs? | **ignore — another agent has it** | left alone |
| the draft sweeper that never ran? | **sweep on demand**, plus *"create a new docs/project/cron-scheduler.md … as an example of where a scheduler would be useful in future"* | a decision *and* a new doc; two sweepers with no caller turned out to be one class |
| dictation: measure real speech? | **no — switch to OpenAI, rewrite `/privacy`** | overruled the evidence knowingly; see below |
| the yellow highlighter for quotes? | **neither — a border rather than a fill**, weight carrying priority | search hits fill, quotes outline: nobody borrows a channel |
| the quiz difficulty slider? | **declined — make the quiz adaptive instead** | removes the control rather than tuning it |
| `toc/6` backfill? | **leave it, new articles only** — plus *"there should be a way to re-run any of the generated modes"* | recorded in [hierarchy.md](../project/hierarchy.md#prompt-versions); the re-run became its own session |

**The dictation one is the one to re-read later.** He was shown that we do not use Whisper, that a
bake-off had scored the current model 78/78 on hard terms that were in the vocabulary, that OpenAI
was excluded on two *measured* grounds (no ZDR endpoint on OpenRouter; `input_audio` refuses
`MediaRecorder`'s webm), and that `/privacy` **publicly tells readers `zdr: true` is set on
dictation**. He chose to go ahead anyway. That is his call and it is made — but the session is told
to run `npm run eval:dictation-gate` first in case the OpenRouter route has since opened, and the
privacy rewrite is gated: **a line in `awaiting-approval.md` says the wording needs his sign-off
before the next deploy**, because landing on `dev` is safe and deploying a page that misdescribes
what happens to people's voices is not.

One consequence nobody asked about and the session is told to name: `OPENAI_API_KEY` is a separate
billing account, **outside** the OpenRouter cap that is now the only spend ceiling we have.

## Everything dispatched, in the order it wakes

Fourteen sessions. The early ones came out of the trawls; everything from 03:34 came out of Greg's
answers.

| wakes | session | what it does |
|---|---|---|
| 00:07 | `publish-refused-reason-kinds` | permanent vs transient refusals, so a deterministic failure stops inviting a charged retry; plus the missing-key case in `pdf-read.ts` |
| 01:07 | `pdf-figures-stage-f` | finish and land the figures worktree — merges clean, no owner |
| 02:07 | `fb2a-upload-an-html-file` | the one unprocessed report: upload an HTML file, verify a URL to a PDF |
| 03:07 | `class-killers-and-a-conflict-check` | four of T2.1's five (not b — already built) plus the conflict-marker check |
| 03:34 | `fb1v-socratic-v4-and-the-eval` | ship V4, then repair the eval, then the depth-1 gap, then answer Q7 |
| 04:22 | `fb15-dictation-to-openai` | the model switch and the privacy rewrite, gated on Greg before deploy |
| 05:28 | `fb1z-quotes-outlined-by-priority` | quotes outlined rather than filled, weight carrying importance |
| 05:44 | `cost-tracking-that-sets-a-price` | 260902g, "planned, not built" since 2026-09-02 — and now the only control is a global cap |
| 05:58 | `structure-mode-as-a-third-mode` | Structure behind the Experimental Features switch |
| 06:31 | `fb21-adaptive-quiz` | right answer harder, wrong answer easier, and no visible level |
| 07:39 | `rerun-any-generated-mode` | the re-run button — and the plan says *don't* build staleness detection |
| 08:42 | `adversarial-fixtures-four-postmortems` | one fixture set closing four postmortems' open recommendation |
| 09:43 | `cheap-postmortem-preventions` | three verified-small preventions, plus one the session picks and justifies |
| 10:45 | `split-routes-one-slice` | `src/routes.ts` is 8,180 lines and grew 423 in a day; one bounded slice, following A1's shape |

Two more sessions in `gjd-remote ls` (`make-sure-all-the-modes`, `the-hierarchy-mode-has-a`) belong
to somebody else and are not part of this.

**The `--wait` stagger is not ordering** — GPT Sol's R2, and it was right. Where one session depends
on another, the dependency is written into the brief as something the agent checks for itself:
*is this on `dev` yet, and if not, do the part that does not depend on it.* Six briefs carry a check
for whether the `App.tsx` split has landed, because a new mode written against the old 6,105-line
file would hand its owner a conflict nobody needs.

## How the fourteen turned out

Checked 2026-09-07 15:00, against the panes and against `git log origin/dev` — **69 commits landed
overnight**, typecheck is clean, and `doc-links` is green again.

| landed | still going | note |
|---|---|---|
| `publish-refused-reason-kinds` · `pdf-figures-stage-f` · `class-killers-and-a-conflict-check` · `fb15-dictation-to-openai` · `fb1z-quotes-outlined-by-priority` · upload-an-HTML-file · the routes split | `structure-mode-as-a-third-mode` (suite running) · `rerun-any-generated-mode` (in its worktree) · `adversarial-fixtures` · `cheap-postmortem-preventions` · `split-routes-one-slice` | `fb1v-socratic-v4`, `cost-tracking` and `fb21-adaptive-quiz` had not begun at 15:00 — each woke, judged the box too loaded, and armed a one-shot for ~16:36 |

**Two of the fourteen were redundant, and both agents worked that out for themselves rather than
duplicating.** `fb2a-upload-an-html-file` found another session already on report 2A and stood down;
`split-routes-one-slice` found `worktree-api-dispatch-by-domain` **already splitting `src/routes.ts`**
— its stage 3a had moved about 280 lines — and deferred rather than picking a slice against a moving
file. That second one is a brief I should not have written: the sweep looked for work nobody was
doing and this was work somebody was already doing. The session caught what the dispatch missed.

### What the sessions found that the sweep did not

Three findings came out of the work that no audit would have produced, and all three are worth more
than the tasks that surfaced them:

- **The zero-data-retention promise was already unreachable.** `fb15` was sent to move dictation to
  OpenAI and rewrite `/privacy` accordingly. It stayed on OpenRouter (`openai/gpt-transcribe`), which
  removed the separate-billing-account problem entirely — and then *probed* the endpoint and found
  that **OpenRouter does not apply routing on its transcription endpoint at all**: an impossible
  `only: ["anthropic"]` returns a transcript anyway, and so does `zdr: true` for a model absent from
  the ZDR list. So the flag nobody could keep was a flag nobody had been reading. `zdr` is now set on
  nothing. [260907c](260907c-dictation-onto-an-openai-transcriber.md).
- **An uploaded file's name is in its public URL.** `slugFromFilename` mints the slug from the
  filename stem and the slug is in `PublicMeta`, so publishing `confidential-client-acme.html`
  publishes `confidential-client-acme`. True of PDFs since August; found only because the upload work
  was about to assert the opposite in a comment.
- **A memory of mine was wrong.** The `adversarial-fixtures` session found that the 84-of-360
  constitution cut is the fixture corpus's **deliberate negative fixture** — it has no
  `labels.sourceHash`, so publication correctly refuses — and not a degraded copy, which is what a
  prior session had recorded and what its brief inherited.

### And one thing the audit of the sessions got wrong

A Sonnet pass over the panes reported four sessions *"blocked on an interactive Bash approval
prompt … apparently weren't in auto-accept mode"*. Checked by hand: **all four say `⏵⏵ auto mode on`
and none is blocked.** What it had read as a pending approval was the `❯` input line carrying text
somebody had typed and not sent. This is the second time in two days a pane-reader has produced a
confident wrong answer about session state — the first read a context-usage bar as progress. The
lesson is in the agent memory, and it is the same one: **check a session's claim against `git log`
and its worktree, never against a screenshot of its terminal.**

## What is left for Greg

Everything else was answered. Two things remain, and neither blocks anything queued above:

1. **The dictation privacy wording needs sign-off before the next deploy.** The session writes the
   proposed sentences into its plan doc and adds the line to
   [`awaiting-approval.md`](../user-feedback/awaiting-approval.md). Landing on `dev` is safe; a
   deploy in between would publish a page that misdescribes what happens to a reader's voice.
2. **Cluster C of the public-read audit is Greg's and cannot be an agent's**: the Vercel WAF rate
   limit lives in the dashboard, and there is no Vercel credential on this box. It is the one item
   from that audit that nothing here can move.

And one thing that is nobody's to answer yet: the postmortem audit's **ninety unbuilt prevention
items**. Two are being built tonight and one fixture set closes four more, but the body of it is the
input to the next [improve-the-codebase](../reusable/improve-the-codebase.md) sweep — and what it
most wants is the shape-and-age classification over all 70 postmortems that
[260905b § T2.1](260905b-improve-the-codebase-third-sweep.md) says has never been done, which would
turn its central hypothesis into a finding or kill it.
