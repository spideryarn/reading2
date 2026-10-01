# Rule-wording proposals from the 261001i docs sweep, for Greg

Every change here rewords a rule, so it was **not made**: it waits for Greg, through the Overseer,
one set at a time ([edit-important-docs.md](../../reusable/edit-important-docs.md)). Each has a
before, an after and a one-line reason. They are grouped into sets of related edits and ordered by
ease × value, most first. Answer by number ("A1, A2, not A5").

The evidence behind them is in this directory: the probes (`before-P*.md`, `score-before.md`), the
trawls (`trawl-*.md`) and the writers' reports (`report-W*.md`).

---

## Set A — `AGENTS.md` (loaded every turn, so the highest value and the highest bar)

**A1. Name where the shared code is listed.** § Writing code, "Prefer simple over easy".

- Before: "Reuse the machinery that's already here rather than adding a second way to do the same
  thing, and when two designs work, take the one with fewer parts touching each other."
- After: "Reuse the machinery that's already here rather than adding a second way to do the same
  thing — architecture.md § Shared code (server) (link: `docs/project/architecture.md#shared-code-server`)
  and web-client.md § Shared code (client) (link: `docs/project/web-client.md#shared-code-client`) list it —
  and when two designs work, take the one with fewer parts touching each other."
- Reason: the rule exists but says nowhere to look. Two of twelve probes planned a second copy of
  code that exists, and trawl A found seven hand-rolled copies of the streamed-call shell.

**A2. Name the streaming helper.** § Writing code, "Stream any model call".

- Before: "The plumbing is already shared, so a new streaming endpoint is a generator and a route,
  not a project"
- After: "The plumbing is already shared — `src/stream-run.ts` § `runStream` on the server,
  `src/web/lib/sse.ts` § `readAnswerStream` in the browser — so a new streaming endpoint is a
  generator and a route, not a project"
- Reason: seven of the ten streamed calls copy `search.ts` instead of using `runStream`, which no doc
  named until this sweep.

**A3. Stop copying the step count.** § Writing code, "Every stage stays runnable on its own".

- Before: "Cache anything expensive on a content hash — twelve of the fifteen steps in `STEP_ORDER`
  do, and the exceptions are `fetch`, `extract` and `blocks`;"
- After: "Cache anything expensive on a content hash — every step in `src/pipeline.ts` § `STEPS`
  that declares a `stamp` does, and the exceptions include `fetch`, `extract` and `blocks`;"
- Reason: there are 21 steps and 18 `stamp:` entries today. The count had five homes with five
  different answers (trawl B §5).

**A4. Link the doc for the commonest postmortem class nobody can reach.** § Before you call it
finished, after "A check you have never seen fail is not evidence".

- Before: new.
- After: "- **A sentence is not a fix.** A comment, a deferral or a written-down defect with the
  default left unchanged is a defect with a paper trail —
  written-down-is-not-checked.md (link: `docs/reusable/written-down-is-not-checked.md`)."
- Reason: nine or more postmortems are in this class, and the doc that covers it is linked from no
  file an agent reads while writing the comment (trawl C Q2 row 2).

**A5. The "read before you touch" pair.** The line after the entry-point list.

- Before: "Two of those are worth reading before you touch anything they bear on:
  **granularity-zoom.md**, one of the features this app is for, and **block-ids.md**"
- After, option (a): drop `granularity-zoom.md` from this line and keep `block-ids.md` alone.
- After, option (b): keep it, but say "its first sections — the rest is the gist columns removed on
  2026-09-29".
- Reason: most of `granularity-zoom.md` now describes the tabular view and gist columns that were
  removed, so "read before you touch anything" sends every agent into history (trawl B §1). Greg's
  own words, 2026-09-07: *"granularity-zoom is a core feature, but by no means the only reason the
  app exists!"*

---

## Set B — `url-state.md`'s opening rule, which is false

**B1.** Opening paragraph.

- Before: "Nothing the reader can change lives in `useState`, and nothing lives in `localStorage` —
  with one exception since 2026-09-05, which is about *which address you arrive at* rather than
  about where state lives while you are here: § Reopening an article where you left it."
- After: "Nothing about *how you are looking at an article* lives in `useState` or `localStorage`:
  if a link should carry it, it is in the URL. `localStorage` holds what belongs to this browser
  rather than to the view — the address you last left an article at (§ Reopening an article where
  you left it), and per-browser preferences and dismissals: the referee card
  (`src/web/referee-card.ts`), hidden shelf columns (`shelf-hidden-columns.ts`), the add page's tick
  box (`auto-modes.ts`), the install and small-screen hints, the chosen microphone and its placement,
  the offline cache's partition, the `spya-perf` flag and the auth SDK's session. Each wraps its
  access, because a private window throws."
- Reason: the rule is broken in at least eight places, and two code comments still say
  `localStorage` is banned. Plan 260902f sent this edit to Greg on 2026-09-02, and it never came back.

---

## Set C — `silent-success.md` and `written-down-is-not-checked.md`

**C1.** `written-down-is-not-checked.md` § What to actually do — new: Greg's sentence from postmortem
260903e, quoted: *"A written-down defect with an unchanged default is a defect with a paper trail,
not a mitigation."* Reason: his words, in no evergreen doc.

**C2.** `silent-success.md` § The habit — new: "A guard is not committed until its author has pasted
the red message it produces into the commit." Reason: postmortem 260906e says this caught all nine
cases, and says the doc edit is owed.

**C3.** `silent-success.md` § Spotting the family — new: "When a person pastes evidence that
contradicts a check, the check becomes the suspect, not the system." (260831f). Reason: the same
class, a different entry point.

**C4.** `silent-success.md` — three new rows (from auto-memory): an `ls X || fallback` that prints
plausibly when the check failed; re-reading your own work as zero evidence; a guard whose subject and
definition of "correct" move together in one edit. Reason: each recurred, and lived only in one
agent's memory.

---

## Set D — the review workflow (`codex-cli-as-subagent.md`, `review-prompt-template.md`)

**D-1.** `codex-cli-as-subagent.md` § The house workflow — new: "When a finding says something
*claims too much*, grep the whole feature for the claim before editing, then fix, then grep again;
when it says X cannot see Y, list what else X cannot see." (260908e, 260907c). Reason: five
postmortems are a fix scoped to the first instance.

**D-2.** Same doc — new: "If `run-codex.ts` cannot spawn its nested Codex, an implement-and-review
stage reviews itself and reports success: grep the answer for 'could not start its nested'. And never
relaunch onto an `--output` path a killed run used — its grandchild can still write the old answer."
Reason: two auto-memories; both look like a clean review.

**D-3.** `review-prompt-template.md` — new: "Put the stage's conclusion in the candidate, and name the
finding you would least like to be wrong about." Reason: it caught an inconvenient result being
explained away.

---

## Set E — `engineering-manager.md`

**E1.** § Delegate — new: "A factual claim in a brief comes back verbatim in source comments and
docs, so check every load-bearing claim — above all 'nothing does X' — before you brief. When a fix
turns a silent gap into a refusal, write the fallback into the brief." Reason: auto-memory; one such
claim reversed a design decision.

**E2.** § Delegate, scratchpad paragraph — new: "A script in the scratchpad cannot resolve the repo's
`node_modules`; import by absolute path." Reason: auto-memory.

**E3.** § Stages — new, Greg's words, 2026-08-30 (`docs/plans/260831b-finish-the-database-move.md`):
*"Define the stages such that we get most of the value with working versions as soon as possible …
rather than deferring the main value to the end."* Reason: the staging rule is stated without its
author's reason.

---

## Set F — `long-waits.md`

**F1.** New: "A subagent that starts a tmux job ends its turn and reports nothing, so own long waits
yourself. Polling a log burns turns, not wall-clock: arm one waiter and stop. In a poll loop use
`grep -q`, never `grep -c … || echo 0`, which fires at once. `kill -0` fails from the sandbox; use
`[ -d /proc/<pid> ]`." Reason: four auto-memories, each a wasted afternoon.

---

## Set G — `version-control.md` (its wording is a rule)

**G1.** § Commit your own files by name — new: "Commit a reference and the thing it points at
together; when they cannot go together, push the referent first." (260906d). Reason: its own plan
calls this file's wording a rule.

**G2.** Same section — new: "After the commit, read `git status --short`: a ` M` on a file of yours
means it did not go in, and every gate stays green." Reason: auto-memory; a hand-typed pathspec
dropped a file silently.

**G3.** New: "Once you have merged `origin/dev`, `git diff <fork-point> HEAD` includes everyone
else's files; scope your own change with `git show --name-only --format= <your commits>`." Reason:
auto-memory.

---

## Set H — `write-planning-doc.md`

**H1.** Checklist — new: "Tightening an invariant over stored data: the stored data is migrated in the
same commit, or the plan says why it need not be." (260905d). Reason: three postmortems; the runtime
half is in `database.md`, the plan-time half nowhere.

---

## Set I — `vision.md`

**I1.** New, Greg 2026-09-07: *"granularity-zoom is a core feature, but by no means the only reason
the app exists! The glossary, concept-search, remembering, diagramming, etc all feel novel and
interesting."* Reason: AGENTS.md was already corrected to match; the quote itself is in no doc.

**I2.** § Simpler first — new, Greg 2026-08-29 (`docs/plans/260830d-v1-imports-on-vercel.md`):
*"Look for simplicity, and getting to a v1 now, while being aware of the long-term-best eventual
state and choosing stepping stones towards that."* Reason: adds the "stepping stones" half the
existing quote lacks.

---

## Set J — `feedback-reports.md` (pinned by hash) — **the pin is already stale**

**J0. Re-pin, independent of everything else.** `tools/overseer/standing-jobs.ts` pins
`docs/project/feedback-reports.md` at `055d2a9d…`. On `origin/dev` before this sweep the file hashed
`7de339cc…` — it has not matched since `9ee632ce` (the fb5K wording edits) — so the feedback-sweep
standing job may be refusing to dispatch. This sweep adds only an `Up:` line, which changes the hash
again. Whoever re-pins should read the current file.

**J1.** Resolve its contradictions (trawl C Q1 item 4): line ~220 says the Sentry status write is the
sweep's since 2026-09-11, line ~296 says each session does its own; step 2 says one session per
report, the plan says per queue entry since 2026-09-10.

**J2.** § dispatch — new: "A few minutes after dispatching, check `gjd-remote ls` for `? needs you`; a
session that came up without auto mode stops at its first approval." (W3 P4).

---

## Set K — smaller ones, one each

- **K1** `worktrees.md` § The workflow — new, Greg 2026-09-06: *"when you wake up, pull the latest
  changes to avoid a big merge conflict at the end"*, and run `scripts/worktree-freshen.ts` first
  after a cron, a long wait, a compaction or a `--resume` (W3 P1).
- **K2** `plans.md` (queued slices) — new: before starting a slice a plan has queued publicly,
  message the live peers and write *Claimed* into the plan (W3 P2).
- **K3** `docs/reusable/diagnose-box-resources.md` — new: `pgrep -fa vitest | wc -l` counts about
  five processes per suite (W3 P3).
- **K4** `testing.md` — new: record the sha a long gate started from, and check it is still `HEAD`
  before acting on its failure (W3 P5).
- **K5** `architecture.md` § Stage ownership — "communicate through the JSON artefacts on disk" →
  "through the artefacts it writes to the store" (W2). The rule is unchanged; "on disk" has been false
  since 2026-09-05.
- **K6** `database.md` — the two "refusal, never a fallback" rules name files, which are gone. W4
  generalised them to "fall back to something else" / "answer from anywhere else"; the orchestrator
  restored the original wording pending this (W4).
- **K7** `mode.md` — turn the two quoted conventions (mark a mode's items in the prose; a rated
  list ordered by priority with a threshold) into a checklist line (W5 #3).
- **K8** `overseer.md` — "20–35 coding agents" (the measured peak was 18 on 2026-09-08), and the
  session-kill judgement from the `tmux-outlives-closed-tabs` memory (`idle` is not abandoned; look
  for a pending `CronCreate` first).
