# Port the Overseer's auto-memory into docs in Git, once

Queue item `qi-8836whem`. Status: **done** (2026-10-06) —
evidence: all 85 memory files deleted, the last ten after Greg answered the five proposals held
back for him, in
[the mapping § The five held back, answered](../investigations/261005d-overseer-auto-memory-ported-to-docs-the-mapping.md#the-five-held-back-answered).

## What this is for

The Overseer's Claude Code auto-memory lives in
`~/.claude/projects/-home-greg-code-spideryarn2/memory/` on the box. It is not in Git, so a new box
starts without it.

> I would rather that the things that you're learning don't get stored in your Claude code memory,
> because as I understand it, that's not in Git. I want to make sure that all our lessons are stored
> in Git, ideally in our docs.md files, so that if we were to start a new box, it would not have
> lost valuable insights.
>
> — Greg, 2026-10-05, as the queue item gives it. He dictated it, and the transcript has "Clawed
> code" where this says "Claude code".

The standing rule is already in [AGENTS.md § How we write docs here](../../AGENTS.md#how-we-write-docs-here)
("Record decisions where they belong"). This job is the one-off backfill: every memory file ends up
either in the doc that owns it, or dropped with a reason.

## What is there

85 memory files plus the `MEMORY.md` index (the queue item says 88; counted 2026-10-05, and three
files are missing from the index). About 190 KB. On 2026-10-01 a sweep already moved about thirty
trap memories into docs (`docs/plans/261001i-probes/report-W3.md`, `report-W4.md`), so many of the
remaining files are partly or wholly said somewhere already.

## The rules of the port

Revised after GPT Sol's plan review (PR-1 to PR-8, all accepted; see the log).

1. **A memory file is several lessons.** Each file is split into its distinct lessons, and each
   lesson gets its own disposition. A file is *eligible for deletion* only when every lesson in it is
   already in a doc or dropped with a reason; otherwise the mapping says *retain*.
2. **Check before writing.** For each lesson, grep the docs for its key terms and read the passage.
   "Already" means the lesson and how to act on it are there, and the row quotes the passage.
3. **One home per fact.** A fact or trap that is not in a doc goes into the one doc that owns the
   subject, as a short entry in that doc's own voice. No new doc unless nothing owns the subject.
4. **Any rule is proposed, not edited — wherever it would sit.** Anything that adds or changes an
   obligation, a prohibition, a permission or a required workflow is written as a numbered
   before/after proposal for the Overseer to put to Greg
   ([edit-important-docs.md](../reusable/edit-important-docs.md)), in every doc and every section.
   So is any change at all to `AGENTS.md`, the seven entry-point docs or `docs/reusable/*`. Only a
   description of how something behaves is edited directly. Unsure means propose.
5. **Greg's words are checked against the transcript, not the memory.** A model wrote the memory
   files, so quotation marks there prove nothing. A quote lands or is proposed as Greg's only when
   the exact string is found in a user message in the session transcripts under
   `~/.claude/projects/`. One not found is written as "the Overseer's notes record that…",
   marked unverified in the mapping, and its file is retained.
6. **No secret values**, in the docs, the reports or the proposals: no key, token, password,
   connection string or address. The *limits* on a credential — when Greg must be asked, how to use
   it safely — are lessons and are kept, usually as proposals.
7. **Drop claims, not files.** A stale claim (a tool that was down for a day, a plan since built) is
   checked against the tree and dropped with what was checked. The lasting lessons in the same file
   still get their own disposition.
8. **The memory files are not deleted.** The Overseer does that. The mapping records each file's
   content hash when it was read, so a file that has changed since is not deleted on a stale row.

## The simpler option passed over

Copy all 85 files into one `docs/project/overseer-memory.md`. It would be in Git in ten minutes.
Passed over because it is a second home for every fact that a doc already states, nobody would find
a tmux trap in a file named after memory, and the 2026-10-01 sweep already showed the lessons get
read when they sit in the doc that owns the subject.

## Stages

**Stage 1 — analyse (four parallel Opus subagents, one theme each; they edit nothing).** Each takes
about twenty memory files and writes a report under `docs/plans/261005k-probes/`: one row per file
with its hash and every lesson's disposition, the suggested edits ready to paste, the proposals in
before/after form, and every Greg quote it used. The brief is
[261005k-probes/brief.md](261005k-probes/brief.md). The themes:

- A. Greg's permissions and preferences, and Overseer practice.
- B. Box, tmux, waiting and process traps.
- C. Git, worktrees, tests, build and docs tooling.
- D. Review and reasoning lessons.

Done when: every one of the 85 files has exactly one row.

**Stage 2 — apply and assemble (one writer, in sequence).** Check every Greg quote against the
transcripts. Apply the suggested edits one at a time, moving to a proposal any that turns out to be
a rule. Assemble `docs/investigations/261005d-overseer-auto-memory-ported-to-docs-the-mapping.md`:
the table (file, hash, lessons, *eligible* or *retain*), then the numbered proposals. A script
checks the table against the directory: every file once, none twice, none unknown, hashes current.
`npm test` and `npm run typecheck`.

**Stage 3 — GPT Sol review, read-only.** The house default is a reviewer that fixes; here it only
reports, because the thing under review is evidence and a fixing reviewer once wrote a Greg quote
of its own. Hand it the commit and the memory directory. Ask it to check every *eligible* row
against the whole memory file and the passage cited, and to sample the rest for: an edit that is
really a rule, a lesson changed in the porting, a secret. Fix, push to `dev`, debrief the Overseer.

## Testing

This is prose, so the red-first rule has little to bite on. What can be mechanical is: the
completeness script (seen red against a table with a row removed before it is trusted), and the
existing `tests/doc-links.test.ts`. The check on meaning is Sol's sample, not a test.

## Log

- 2026-10-05 — plan written.
- 2026-10-05 — GPT Sol's plan review
  ([answer](261005k-port-overseer-auto-memory-plan-review-sol.md)): not ready, eight findings, all
  accepted. PR-1 lessons not files; PR-2 an explicit *eligible / retain* verdict; PR-3 any rule is a
  proposal wherever it sits, and the carve-out for the Overseer's trap list is gone; PR-4 quotes
  checked against transcripts; PR-5 drop claims not files; PR-6 keep a credential's limits; PR-7
  subagents analyse and one writer applies; PR-8 a content hash per row. Its last suggestion, a
  read-only final review, is taken too.
- 2026-10-05 — stage 1 done. Four reports under `261005k-probes/` (the harness refused each
  subagent's own write, so `save-report.py` took each from its transcript). 85 files, one row each.
- 2026-10-05 — stage 2 done. All 25 edits applied by one writer, in twelve `docs/project/` files;
  one sentence cut from BE10 as unverified. 43 proposals, none applied. The mapping is
  [261005d](../investigations/261005d-overseer-auto-memory-ported-to-docs-the-mapping.md): 35
  eligible, 50 retain. `check-mapping.py` green, and red with a row removed. **Quote check: four of
  twelve strings attributed to Greg were not found in any turn he typed** (AP1, AP2, AP5), only in
  the Overseer's compaction summaries and relays; the mapping says so and asks that they be
  confirmed. `tests/doc-links.test.ts` green after three link fixes, one of them a path in Sol's
  plan-review answer.
- 2026-10-05 — stage 3. GPT Sol's review of commit `11e1ff2c8`
  ([answer](261005k-port-overseer-auto-memory-result-review-sol.md)): not safe to delete on, twenty
  findings, no P0. All taken. RR-1 to RR-7 and RR-18: eight rows moved from *eligible* to *retain*
  (27 eligible, 58 retain), six of them with a new proposal RP1–RP6. RR-8 to RR-10: instructions
  among the edits rewritten as descriptions (BE5, BE6, BE10, BE11, CE1, CE7), the `grep` claims in
  CE6 corrected against GNU grep 3.11, and DE2's "only" removed. RR-11: the quote checker now
  rejects compaction summaries and relays, and the mapping says a hit is a candidate. RR-12 to
  RR-17: listed in the mapping as lessons no proposal carries yet. RR-19: left, and said. RR-20:
  the quote above marked. One round only: the fixes are narrower than the findings and every
  affected row is now *retain*, which is the safe direction.

- 2026-10-06 — the second half. Greg gave blanket approval for the remaining proposals (his words
  are in the mapping). AP1–AP10 were applied by the Overseer. This job applied 34 more (BP1, BP2,
  BP5, BP6, BP8–BP11, CP1–CP3, CP5–CP11, DP1–DP10, RP1–RP6), placed the six lessons no proposal
  carried and the two rows the result review left open, and held back five for Greg: BP12 and CP4,
  which each loosen an `AGENTS.md` rule, and BP3, BP4, BP7, which duplicate F1 and K3 of the
  2026-10-01 sweep. Rule 8 above ("the memory files are not deleted") was the first half's; the
  Overseer handed the deletion to this job, and 43 files went after the hashes were checked,
  leaving ten.
- 2026-10-06 — GPT Sol's read-only review of the second half (nonce echoed; it read all 53 files in
  full): nine findings, no invented attribution, no secret. All nine taken. F1: the heavy-lock
  line's drop now has its reason (the Overseer's commit calls the lock retired). F2: the "is my
  own server gone" check added to `browser-testing.md`. F3: exit 0, not 2, in `feedback-reports.md`.
  F4: the load and memory readings in `long-waits.md` put back at their own times. F5: BP6's diff
  command was empty after a merge, in the memory too; corrected. F6: `git diff HEAD` in
  `linting.md`. F7–F9: "commit before every merge", "re-run each red file" and "no deadline"
  scoped so they do not contradict the primary's fast-forward, the no-retry rule for a contended
  database, and `--timeout-minutes`.
