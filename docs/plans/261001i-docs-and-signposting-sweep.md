# Docs and signposting sweep

Make the docs the easiest way for a future agent to do the right thing: find the right doc, follow
the right policy, stay consistent, and find and reuse the code that already exists instead of
writing a second copy.

Greg, 2026-10-01, verbatim:

> Let's make sure our docs and signposting are in good shape. … consider whether we should add or
> split our docs, whether the signposting is adequate, or anything else that will make it easier for
> future agents to do the right thing, find the right docs, follow the right policies, be
> consistent, discover & reuse the right bits of the code, etc etc. The main principle is that docs
> should emphasise intent (supplied from me) and signposting (to other docs, code, etc etc). Apply &
> update @docs/reusable/documentation-policy.md accordingly.

Not a Sentry report, so there is no note in `docs/user-feedback/` and no line on
`awaiting-approval.md` to take off.

## Where it starts

Measured 2026-10-01 on `dev` at `4a7862f3`:

- `docs/project/` is 111 files and ~61,000 lines (`wc -l docs/project/*.md`); the largest is
  `diagram.md` at 2,349. `docs/reusable/` is 40 files. 139 postmortems, ~2,700 plan files.
- `tests/doc-links.test.ts` already enforces: every relative link and anchor resolves (markdown and
  bare `foo.md#x` in source comments); one owner per `docs/project/` doc via the `↳` lists in
  `AGENTS.md`; the owner links to each doc it claims; no line-number citations in evergreen docs;
  `file § symbol` citations name a symbol the file still holds.
- What it does **not** check: a backticked repo path that is not a link (`` `src/foo.ts` `` in prose)
  and no longer exists; whether a doc links back up to its parent; whether code points at its doc.
- Early sign of drift: `architecture.md`'s pipeline diagram still says each stage writes
  `data/<slug>/…`, two releases after the filesystem store was deleted.
- 103 auto-memory files, many of them traps every agent should see (see Stage 4).

## What done looks like

1. A before/after measure of discoverability on the same 12 probe tasks, scored the same way.
2. `documentation-policy.md` updated (Greg asked for it directly).
3. A "shared building blocks" signpost so an agent finds the existing helper.
4. Drift and duplication cut back to pointers in the worst offenders; buried rules and recurring
   postmortem classes carried into the doc that owns them; memory traps moved into docs.
5. One or two new cheap, sure checks in `tests/doc-links.test.ts`.
6. Proposals for `AGENTS.md`, entry-point rule wording and `docs/reusable/` rule text, before/after,
   for the Overseer to take to Greg — not committed.
7. Code-duplication candidates ranked by ease × value for the Overseer — not refactored.

## Stages

### Stage 0 — baseline probes (parallel with Stage 1)

Twelve tasks drawn from recent plans and feedback notes. For each, a fresh Sonnet subagent is told:
read only `AGENTS.md` to start, then navigate the docs and code as you would to do the task, without
editing anything; report the docs you opened in order, the code files and the existing helpers you
would reuse, the rules you would follow, and where you got lost. In parallel an answer key is
written for each task from the plan that actually did it (the docs, files, helpers and rules it
needed). Scoring per probe: recall of the answer-key docs, recall of the helpers, the rules missed,
and a "would have written a second copy" flag. Re-run identically in Stage 5.

Twelve probes, not fifteen: each costs a subagent twice, and twelve spans every entry point.

### Stage 1 — trawls (read-only subagents, conclusions only)

- **A. Code duplication.** Second copies of relative time, date formatting, fetch wrappers, model
  calls outside the gateway, tooltip patterns, debounce, clipboard, slug/escaping, etc. For each:
  the copies, which one is canonical, and how an agent would find it today.
- **B. Doc shape and drift.** Docs too big to read; overlapping docs; code areas with no owning doc;
  prose that describes code (and whether it has drifted); facts with two homes.
- **C. Buried rules.** Rules in plans and postmortems that never reached the owning doc, and
  postmortem classes that recur with no doc warning about them.
- **D. Memory → docs.** For each auto-memory file: project knowledge or personal/machine-local, and
  if project knowledge, which doc and section owns it, and whether it is already there.
- **E. Paraphrased intent.** Places a doc states Greg's intent in its own voice where his words exist
  in a plan or note.

### Stage 2 — policy and checks

- Update `documentation-policy.md` (direct, per the request) with what the trawls show is missing:
  at minimum, link down to code and up to the parent, entry-point lines say *when* you'd open a doc,
  shared-code signposting, and that code points back to its doc.
- Add the cheap check(s) to `tests/doc-links.test.ts`, red-first: a backticked repo path in an
  evergreen doc that no longer exists. Others proposed, not built, unless equally cheap and sure.
- Sol review of the stage (workspace-write).

### Stage 3 — signposting and building blocks

- A shared-building-blocks doc (owner decided from Stage 1A — probably `architecture.md`), listing
  each reusable helper by file and symbol and when to reach for it; header comments in the canonical
  modules pointing to their doc.
- Entry-point `↳` lines and one-line descriptions sharpened to "when you'd open it" (signposting —
  no approval).
- Worst drift cut back to pointers (non-rule docs), buried rules carried home *where the owning doc
  is not a rule doc*; rule-doc changes become proposals.
- Sol review.

### Stage 4 — memory to docs, and proposals

- Move the project-knowledge memories into their owning docs (non-rule docs directly; rule docs as
  proposals). List the moved memory files for the Overseer; delete none.
- Write the batch of rule-wording proposals (before/after, one-line reason each) into this plan,
  and send them to the Overseer.
- Sol review.

### Stage 5 — re-run the probes, debrief

Same twelve probes, same brief, same scoring. Report the difference honestly, including probes that
did not move.

## Constraints

- Other sessions are editing docs: small targeted edits, merge `origin/dev` often, keep doc-links
  green. `security-map.md` only at its signposts. No code change except comments pointing to docs and
  new doc tests.
- No deploy. Push to `dev`.

## The simpler option passed over

Skip the probes and just fix what the trawls find. Cheaper, but then there is no evidence the
signposting helped, and the probes are also the best trawl of where an agent actually gets lost.
Kept, at twelve.

## Plan review (GPT Sol, 2026-10-01) and what changed

[261001i-docs-and-signposting-sweep-plan-review-sol.md](261001i-docs-and-signposting-sweep-plan-review-sol.md).
No P0; three P1s.

- **R1 (P1), teaching to the test — accepted.** The twelve are now an *in-sample diagnostic*. Four
  held-out tasks ([holdout-tasks.md](261001i-probes/holdout-tasks.md)) were probed on the
  unchanged tree at `4a7862f3`, keyed by Opus, and the orchestrator does not read either until the
  after round. Only the held-out four support a general claim. The rubric also strips credit
  for any doc sentence that names one probe's answer and would serve no other task.
- **R2 (P1), keys from historical plans — accepted.** Three of the twelve turned out to be already
  built or premised on something that does not exist (P01, P05, P11), and two are underspecified
  (P06, P12). The keys were written against current code as well as the plans and say so. The rubric
  now scores the expected **disposition** (implement / already done / diagnose / ask) and
  **precision** ([scoring.md](261001i-probes/scoring.md)). The final score is a single blind pass
  over both rounds under shuffled names. The tasks were kept rather than replaced: "notice it is
  already built" is exactly the discoverability being measured.
- **R3 (P1), the approval boundary — accepted, with one reading.** Rule-ness is judged by the
  wording, not the file. A sentence that tells an agent to do something new is a proposal wherever
  it would land. A trap stated as a fact ("X fails because Y; see Z") is knowledge, and moves
  directly. `documentation-policy.md` is the one rule doc edited directly, because Greg's request
  says so in as many words ("Apply & update @docs/reusable/documentation-policy.md"); its before and
  after go into the debrief. Everything else that is rule wording is batched for the Overseer
  uncommitted, as the brief says.
- **R4 (P2), the backticked-path check — accepted; dropped.** Sol found 63 missing-path mentions,
  many of them deliberate history ("`src/store/import.ts` was deleted"), which syntax cannot tell
  apart from a stale pointer. It is replaced by the **backlink check**: every doc an entry point
  claims links back up to that entry point. It reuses `ownershipFromAgentsMd`, and Sol counts 42
  missing today, all fixable as signposts.
- **R5 (P2), the building-blocks catalogue — accepted.** No repo-wide inventory. Instead: a header
  comment in each genuinely canonical module saying what it is canonical for, with a link to its doc;
  and a short `file § symbol` + "reach for it when" list in the domain owner (UI in
  `web-client.md`, server in `architecture.md`), restricted to helpers that are reused across areas
  or have been reimplemented.
- **R6 (P2), order — accepted, mostly.** Baseline frozen before any edit (done: no doc was touched
  before every before-file was written). The after round runs on this branch *before* the final
  merge of `dev`, with both commits recorded, so other sessions' doc edits are not credited to this
  sweep. Memory moves are bounded to a ranked first batch; the remainder is listed.

## Log

(updated at the end of each stage)

- **Stage 0, done.** Twelve in-sample probes and keys, four held-out probes and keys, on
  `4a7862f3`. The diagnostic score is [score-before.md](261001i-probes/score-before.md).
