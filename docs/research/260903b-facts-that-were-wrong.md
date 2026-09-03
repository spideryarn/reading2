# Facts that were wrong

What four days of session debriefs say about restated facts, and what to do about them.

## Why this exists

An agent, debriefing on 2026-09-03:

> One thing I'd flag about my own work here: three separate times in this lineage, someone has
> confidently stated an inventory that was wrong — the ancestor plan's appendix, then my first
> draft, then my first draft again a few hours later after a merge. I've made the plan date every
> count and carry no line numbers for moving files, but the durable fix is stage A's manifest, and
> I've asked Sol whether that guard is real or just another check that agrees with the bug.

Greg, the same morning:

> This is not the first time. What can we do about this general problem? e.g. documentation policy
> in @AGENTS.md that there should be a single source of truth for facts (to minimise things getting
> out of sync) with everything else signposting to that; and in fact, documentation should prefer
> not to state facts, but rather signpost to the canonical place for that fact (e.g. instead of
> restating a fact about the code, much better to signpost to the actual place in the code where
> that's defined) so it's always up to date; always cite/signpost to original source, perhaps
> annotated with a date or level of confidence?
>
> — Greg, 2026-09-03

This note is the evidence behind the answer: how often it happens, what shapes it takes, what has
already been tried, and — the part that changes the answer — where a written rule existed, had
mostly been read, and did not hold.

## Method

Every session transcript on this box touched between 2026-08-31 and 2026-09-03: 97 sessions across
the primary checkout and eleven worktrees. The USER and ASSISTANT prose was extracted (tool calls and
results stripped — 4.5 MB of prose from 236 MB of transcript), split into eight balanced buckets, and
each bucket was read in full by one Sonnet subagent with one shared prompt asking for process
complaints of eight shapes: a written fact wrong and believed; two copies drifted; a confident claim
retracted; a check that agreed with the bug; the same mistake across agents; contradictory
instructions; work re-derived; and any "what can we do about this" moment. The readers quoted
verbatim with session id and timestamp. The recipe is
[trawl-session-transcripts.md](../reusable/trawl-session-transcripts.md).

The readers' compressed reports are the appendix below. **Counts in this note are one classifier's
reading of those reports, taken 2026-09-03, and the classes overlap** — treat them as the size of the
thing, not as a number to carry forward. The quotes are what to trust; every one below was checked
against the transcript by the author of this note.

## What was found

Roughly 140 findings. The largest class by a distance is
[silent success](../reusable/silent-success.md) — a check that agreed with the bug — which is
already written up and is not this note's subject. The subject is the second-largest: **a written
fact that was wrong and was believed.** It comes in three shapes.

### 1. Inventories: a count, or a list of places

The trigger's shape, and the most literal recurrence. A number or a list is typed from memory or
from a partial sweep, then copied forward as fact.

- A test-file count in one plan went 76 → "28 of 400" → 75 of 431 → 111 across one night. *"Four
  lists in this plan have turned out wrong, including ones I wrote… three agents have spent time
  verifying lists that should have been right."* (3c67234f, 2026-09-01)
- *"Grep the genre, not the list"* was written into a plan after its own first draft undercounted
  every duplication it found (3→5, 4→18, 3→6→7→13), and the session that wrote the rule then
  undercounted three more times with the rule loaded: "three copies" of `sourceHashFor` were
  eight sites in six files. (145cc03c, 2026-09-02)
- *"Nine places store the string `"toc"`, and no single sweep found more than six of them."*
  (2b63afc4, 2026-08-31)
- "Twelve" `takeRunLock` call sites were fourteen. The agent's fix is the policy in miniature:
  *"Rather than write fourteen, I replaced every such claim with a description plus
  `grep -rn takeRunLock tests/`, and re-dated the one that was a measurement."* (5126e9cc,
  2026-09-02)
- *"The plan said 'settle in both branches of `settleIn`'. Fable counted five sites that end a job;
  Sol then found two more."* The two missing were the Stop button and the closed tab, and the bug
  behind them would have permanently killed a three-slot free account. *"The recurring failure on
  this feature was confident sentences about code that described nothing."* (stripe-wiring,
  2026-09-03)
- "Six migrations" declare foreign keys into `auth.users`: eleven constraints across seven.
  (70852e00, 2026-09-01)
- *"'One lock' was ten… an agent read a comment saying 'same trick as X' and filed X as an
  instance."* The rule **a citation is not an instance** went into
  [improve-the-codebase.md](../reusable/improve-the-codebase.md) that night, and the next sweep
  broke it: *"I verified the role the comment named, not the object's actual uses."*
  (glossary-delete-pg, 2026-09-03)
- The trigger itself: *"19 comparison sites across 10 files… My earlier numbers were taken before
  this worktree merged 31 commits."* (delete-store-flag, 2026-09-03)
- Smaller: a mode count that assumed a merge had landed (8 visible, not 7); a grep truncated at 30
  lines that dropped the one `const` the audit was about; four audits that swept `src/`, `tests/`
  and `docs/` and not `scripts/`, where the only live caller was.

**The common cause is not carelessness.** Some of these were right when taken and rotted; others —
the truncated grep, the sweep that skipped `scripts/` — were wrong from birth because the sweep's
scope was narrower than its sentence. Nothing about a bare number says which. A count that carries
its command, what the command covered, and the date can be re-run and its edge seen; a bare number
can only be believed.

### 2. Restated code facts, in docs and in comments

Greg's target, and it is real. Where a doc or comment says what the code does, the code moves and
the prose does not.

- `docs/project/table-of-contents.md` said `COVERAGE_FLOOR` "went from 0.95 to 1"; the code said
  0.95. *"Both claims in that paragraph are stale — exactly the failure mode CLAUDE.md warns
  about."* (2b63afc4, 2026-08-31)
- **Every line-number citation in an evergreen doc that was checked was wrong** — six of six on
  2026-09-03: `src/glossary.ts:1060` was inside a prompt string, `src/jobs.ts:443` was a comment
  about `force`, `scripts/gjd-remote.ts:341` was about `spawnSync`. `tests/doc-links.test.ts` was
  green on all of them, because it checks the file exists and a file is nearly always there.
- `version-control.md` said "Vercel is not connected to this repo"; `deploy.ts` said a push builds
  on Vercel's machine. An agent reasoning from the doc, in that same session, was evaluating
  whether pushing worktrees to `main` was safe. (70852e00, 2026-09-01)
- `worktrees.md` and a plan said a template database copy can't work "because Postgres cannot
  enforce a cross-database foreign key". Sol, Fable and a research agent each disagreed unprompted:
  the copy carries its own `auth` schema. The wrong sentence had blocked the right design.
  (test-db-isolation, 2026-09-03)
- `glossary.md` described "old glossaries with no scores" — a population git history says never
  existed. `admin.md` wrote a symptom off as a hot-reload artefact, a hypothesis that read as a
  finding. `.env.example` says set `SPIDERYARN_STORE=postgres`; a newer script says *DO NOT*.
- Comments are the same thing one layer down. *"I corrected the wrong diagnosis in both docs and
  told you so — but left it asserted as fact in four code comments… I reset the same trap while
  congratulating myself for springing it."* (7ff2067c, 2026-09-01). Sol flagged *"eleven comments
  claiming more than the code did, accumulated in a single day"* (stripe-wiring). One wrong
  sentence about `finish_reason` was copied, comment included, into seven files over six days
  (e2c75e68). And the sharpest: *"the third time across this feature that the finding which
  mattered was a comment describing the intended behaviour while the code did the opposite, and
  the author reading past it because he wrote both"* (957af82b, 2026-09-01) — then again in an
  unrelated feature two days later, a comment that *"described, correctly and in detail, the
  behaviour the code did not have"* (ccfc2804).

### 3. Statements of status

A decision, written up, read back later as a thing that exists.

- A plan headed **"Status: decided, not built"** was remembered — by Greg too — as shipped; a
  repo-wide grep returned one hit, in prose. *"A decision that was made, reviewed, written down and
  then read back later as if it had shipped."* (c01f98ba, 2026-09-02)
- *"A written-down defect with an unchanged default is a defect with a paper trail, not a
  mitigation."* `copy.md` said a string was "recorded rather than fixed"; eight days later an author
  with that note in reach made the identical mistake. (recorded-not-fixed, 2026-09-03)
- *"A plan document is a record, not a queue."* A bug fully diagnosed in a plan on day two was
  rediscovered on day six; the remedy chosen was to leave the note *in the code, at the line*.
  (0c750cfb, 2026-09-01)

## The counter-evidence

This is the part that changes the answer. A policy sentence is the natural fix, and the transcripts
contain five cases where the sentence existed and did not hold. In four of them the author had
demonstrably met it — had written it the night before, cited it in the file's own header, or had it
under review at the time; in the first, the doc existed and `CLAUDE.md` pointed at it, which is all
that can be said:

- *"Every lesson I 'learned' today was already written down in `testing.md`… That is exactly the
  mistake I made. So the honest prevention isn't another paragraph — the paragraph existed and was
  ignored, by me, in a repo whose CLAUDE.md points at it. It has to be mechanical."* (5126e9cc,
  2026-09-02)
- Fable, reviewing a sweep: *"Warning prose demonstrably didn't work. The Sol review found my run
  broke four rules that were already in the doc, while the doc was loaded… What actually corrected
  the run was structure with a reviewer behind it — the umbrella doc's table, and the Sol gate that
  read it."* (145cc03c, 2026-09-02)
- `evals/quiz.ts` cited `silent-success.md` in its own header, twenty lines above a summary that
  reported eight failures as eight marks. *"That is the evidence that awareness of the pattern is
  not a control."* (e2c75e68, 2026-09-01)
- "A citation is not an instance" was added one night and broken the next morning (above).
- The `| tail` exit-code trap has a postmortem (`260831c`) and was walked into three times in one
  day across two sessions (055bc66d, 145cc03c, b4f76bf7).

What did hold, in the same transcripts, was **a form that something independent could falsify, at
the seam where the fact gets used**. `typecheck:committed` against a `git archive` extract, after a
working tree that typechecked in twelve worktrees and in no commit. `REQUIRE_POSTGRES=1` on the
gate, after "test clean" was a lucky roll. The `grep -rn takeRunLock tests/` that replaced
"fourteen". The table with required fields that Sol read. Not every form: the appendix also has
`db:chain` checking a snapshot's structure and not its content, and a test asserting against the
very function the component calls — gates that shared the bug's assumption, which is
[silent success](../reusable/silent-success.md) again. Independence is the property, not shape.

And one finding cuts the other way, and should: `worktrees.md` had granted a rebase exception that
`AGENTS.md` bans, and the fix — one home for the rule, a signpost from the other doc — worked
(70852e00, 2026-09-01). The policy helps. What the transcripts do not show is that it is enough.

So the answer is Greg's policy **and** a form for it that something checks — not the policy alone.

## What to do, ranked by ease × value

1. **Done in this piece of work — a guard on citations.** `tests/doc-links.test.ts` now fails on any
   line-number citation into this repo from an evergreen doc (`AGENTS.md`, `docs/project/`,
   `docs/reusable/`, the Hetzner runbook), and checks that a `` `src/file.ts` § `symbol` ``
   citation names something the file still contains. Plans, postmortems and research notes are
   records of a moment and keep their line numbers. It went red on nine citations, all of which
   were rewritten to the symbol form; a mutated symbol turns it red again. It is a small guard, and
   it is the one that could be built the same day as the evidence.

   Its first draft was itself the thing this note is about. GPT Sol's review
   ([260903b-facts-that-were-wrong-review-sol.md](260903b-facts-that-were-wrong-review-sol.md))
   showed that a citation of a *deleted* file was silently dropped as "external", so deleting a
   cited file made the test greener; that the linked form — a markdown link to the file, then
   `` § `sym` ``, which is how most of the corpus writes it — was not parsed at all; and
   that `includes()` let `` § `Bloc` `` pass on `Block`. All three fixed, each with a positive
   control that would have failed before. Parsing the linked form then found one stale citation
   among thirty-odd (`quiz.md` cited `GET /api/quiz/:slug`; `routes.ts` writes it with a column of
   spaces), which is the guard earning its first keep.
2. **A rule with a form, in `AGENTS.md`** — one bullet, replacing the current "One source of
   truth" sentence: a fact the code holds is a citation, not a restatement; an inventory is the
   command, what it covered, and the date; anything else says who, when, and how sure. Made
   2026-09-03 in Sol's tighter wording, approved by Greg through
   [edit-important-docs.md](../reusable/edit-important-docs.md). GPT Sol's review of the first
   draft caught it carrying a count of its own ("forty of them wrong"), which is the rule failing
   inside its own sentence; the link to this note is the evidence, so the number goes.
3. **A fourth species in [written-down-is-not-checked.md](../reusable/written-down-is-not-checked.md)**:
   a count or a list without its generating command, scope and date. That doc already has the
   dated-future-claim, the absence, and the same-shaped sample; the inventory is their sibling, and
   the fix belongs beside the other three. Scope is not optional — the truncated grep and the sweep
   that skipped `scripts/` were wrong from birth, and command + date alone would reproduce them.
   Made 2026-09-03, kept to the principle at Greg's request.
4. **Derive lists from the code rather than typing them.** The mode sweeps that hand-listed seven
   of twelve modes; the `MODES`-walking inventory that
   [260902o](../plans/260902o-adding-a-mode-the-recurring-edits-and-how-to-make-them-one.md) is
   about; the manifest the trigger's agent asked Sol about. This is the strongest fix and the most
   work; it is a plan, not a line in a doc.
5. **Plans say what their status is evidence of.** The misread plan *already* said "decided, not
   built" and was read as built, so a status word alone is not a prevention. What
   [write-planning-doc.md](../reusable/write-planning-doc.md) could ask for is
   *Status as of <date>: … — evidence: <commit / test / grep>*, and the sentence that a plan is a
   record of a decision, never evidence that a thing shipped. Lowest value of the five; made
   2026-09-03.
   A "settled, don't re-open" section in sweep write-ups was considered and is not proposed: the
   appendix records that wording already failing without a reviewer behind it.

## The simpler option passed over

Add Greg's sentence to `AGENTS.md` and stop. It is nearly there already ("One source of truth…
name the file and let the reader look"), and the trawl shows agents restating anyway. The
counter-evidence above is why that alone was not enough: the rule that failed most often in these
transcripts was one the agent had open at the time.

## Appendix: the readers' reports

One compressed report per bucket, as saved during the trawl. Session ids are the transcript file
names under `~/.claude/projects/` on the Hetzner box; timestamps are the message's.
# Bucket 1 (sessions: 3c67234f 09-01 primary (big), 522140da, 431d3b7e 09-03, 8709a514)

F1 db:migrate applied nothing for four migrations, printed success (3c67234f 08-31T20:02). Class 4. Documented in database.md.
F2 probe wanted zero rows so a missing constraint read as success (08-31T21:11). Class 4. Mutation-test every probe.
F3 commit that wrote nothing still reported success — carry-forward denylist (08-31T21:09). Class 4. "any test of a carry-forward system needs a stale-fixture case".
F4 corpus check used blobStore() (falls back to files) where prod uses postgresBlobStore() (08-31T21:11). Class 4. "a readiness check must import the exact same helper the production path uses".
F5 409/404 arrived as 500 since 08-28; test imported raw store bypassing guard (09-01T13:39). Class 4. Structural fix.
F6 agent accepted "a narrower guarantee" framing; Sol: same race (09-01T06:34). Class 3.
F7 guard in caller not primitive; "a guard living in one caller is a guard the next caller forgets" (09-01T07:32). Class 6.
F8 agent overclaimed what a test proved (09-01T07:34). Class 3.
F9 benchmark numbers wrong (unbarriered rig) (09-01T13:45). Class 3. Not doc.
F10 coordinating agent misclassified deliberate negative fixture as "unloadable", brief told subagent to fix it; subagent checked (09-01T13:46). Class 3. Fix: fixture's intended-broken status must live at the fixture itself.
F11 **test-file count wrong repeatedly across one night**: "28 of 400" → real 75 of 431 → "what the original 76 said before someone improved on it" → later 111. "Four lists in this plan have turned out wrong, including ones I wrote… three agents have spent time verifying lists that should have been right." (08-31T21:14, 09-01T05:45, 09-01T13:36). Class 1/2. Closest parallel to trigger.
F12 "the unit is the change, not the file" seam — seven occurrences on one plan across sessions (08-31T22:07…09-01T13:40). Class 5. Mechanical fix converged on (simulate commit against clean HEAD).
F13 fixture UUID collisions recurred after tests/fixture-ids.test.ts existed (522140da 09-01T05:56). Class 5. testing.md: mint with crypto.randomUUID().
F14 privacy page: two rounds of false claims about system behaviour ("Delete an article and it goes" — actually archive sets archived_at) found by reading code, Sol found fifteen (431d3b7e 09-02T16:20/16:23). Class 1. Doc should signpost code.
F15 shared tree cost more than the work (431d3b7e 09-02T18:29). Class 5/8. Worktrees.
F16 drizzle-kit generate no-TTY exit 0 wrote nothing; three agents independently reached same wrong conclusion (09-02T18:29). Class 5. database.md.
F17 repair tool's guard refuses the case it exists for (09-01T15:55). Class 4.
F18 review returned empty twice, each time misleading (08-31T20:04, 22:11). Class 4. Already a rule.
F19 docstring says N+1 runner "impossible"; depends on isolation level nobody sets (09-01T16:19). Class 3. Fix: record the dependency where the invariant lives (sql.md).

Recurring: class 4 (6), class 3 (5+), class 5 (3; F12 ×7), class 1 (F11, F14).
Greg: "It's also not the end of the world if your commits include some of their work." (8709a514 09-01T07:17); "Don't worry too much if things are in a temporarily broken state" (09-01T05:34).
# Bucket 2 (b6f0e15b 09-02 primary (referee), experimental-mode-gate ba9c8220, 3dd4e18d, 8197fffd, ac29c419, b3c1b323)

F1 Mirror safety claim overstated then retracted; "I generalised it wrongly" (b6f0e15b 08-31T23:57). Class 3.
F2 same research claim (ICLR) overstated twice in one plan; "recorded it in the plan as a pattern rather than twice as an incident" (08-31T22:56). Class 5. Fix: cite the exact quote/number at first use, link back thereafter.
F3 comment diagnoses the bug correctly then code uses the operator that can't see it; copied comment-and-all into a sibling hook (09-01T17:04). Class 4/2.
F4 Candidates never worked in any session; tests green, "real run" reported success; "nobody was standing on the step between them" (09-01T13:06). Class 4.
F5 **agent: "Five bugs today were found by a reviewer, a browser, or an eval — none by the test suite… every one of them was a green check standing between two things that had never been connected"** (09-01T16:46). Class 4/8. Proposed adding "the tell" to silent-success.md.
F6 Claims 501 in prod for 4h; store-parity.test.ts contains `referee` zero times (09-01T13:58). Class 4. AGENTS.md note landed.
F7 sub-agent trusted the doc, reported a false bug; the doc had drifted from a Greg-requested default (09-01T09:03). Class 2. "corrected the doc instead of the code".
F8 "13 modes today, hide 5, leaves 8 visible, not 7. I'd counted Structure as already merged." (ba9c8220 09-03T02:58). Class 3. Fix: derive from MODES.length.
F9 doc table invented false "why not ready" reasons for working features; four rows wrong; caught by Sol spot-checking each row against its cited doc (09-03T07:13). Class 1/5.
F10 sub-agent weakened a test invariant it was told not to; circular assertion against visibleModes() (09-03T07:31). Class 5/4.
F11 grep truncated at 30 lines → missed labels.ts:57 in an "all sites" audit; same error twice in the session (3dd4e18d 09-03T03:32). Class 1.
F12 styles.css comment says .ideas is .gloss with a class beside it; sizes differed 0.88 vs 0.95rem (8197fffd 09-03T04:20). Class 2/4.
F13 recurring gate run set the store var for the whole suite, 170 deterministic failures; "A mistake of mine worth a doc line" (ac29c419 09-03T03:34). Class 3/7.
F14 conflated ~/gjd-remote drop dir with gjd-remote source; Greg's one-line challenge surfaced it (b3c1b323 08-31T19:44). Class 3.
# Bucket 3 (825a890f 08-31, e99bfb9c, d469182f 09-02, 7ff2067c 09-01, b4f76bf7, stripe-wiring 89c12f94, test-db-isolation 794fd4d3, 25a84f61, 1c8eb342)

F1 two agents minted 0032/0033 with different names; prod deployed without migrations (825a890f 08-31T18:13). Class 2/1.
F2 test regex matched a comment ("This used to be fsLocations(slug)"), not code (e99bfb9c 08-31T18:01). Class 4.
F3 Greg 09-02T16:16: "Another agent said: 'Sol couldn't run anything in its sandbox, so every finding is reasoning rather than reproduction' Is this true? Do you think we could/should relax the constraints?" → sandbox profile landed. Class 8.
F4 **corrected the wrong diagnosis in both docs but left it asserted in four code comments: "I reset the same trap while congratulating myself for springing it."** (7ff2067c 09-01T07:50). Class 2/3. Fix: grep the corrected wording tree-wide.
F5 "independently verified" by the same flawed method; impossible 772s>740s data point rationalised away (09-01T10:04). Class 3/4.
F6 test that couldn't fail — live references mutated in place (09-01T09:23). Class 4.
F7 seed postcondition read half the rule; shelf listed, route 404'd (b4f76bf7 09-02T08:42). Class 4/1.
F8 tail exit code again (09-02T08:39). Class 4.
F9 quota wrong by 5×, caught by Greg not review (89c12f94 09-02T17:39). Class 3.
F10 **Sol "flagged eleven comments claiming more than the code did, accumulated in a single day"** (09-03T00:48). Class other: comments as drifting second copies.
F11 **plan's inventory of "where a job ends" wrong twice: "settle in both branches of settleIn" → Fable five sites → Sol two more (Stop button, closed tab); "The recurring failure on this feature was confident sentences about code that described nothing."** (09-03T05:54). Class 1. Closest to trigger.
F12 proposed excluding src/web/ from spend scan — would blind it to live voice; peer caught (09-02T19:09). Class 3.
F13 **three sessions applied migrations without pushing, ~2h across four sessions; "The one-line rule that prevents it — push a migration in the same breath as applying it — is written down nowhere"** (09-02T17:39). Class 6/7/8.
F14 `npm run check` "test clean" was a lucky roll; three runs, three failure sets (794fd4d3 09-03T02:19). Class 4/8. Greg: "what about tests etc?"
F15 **worktrees.md + 260902c said "Postgres cannot enforce a cross-database FK" — wrong, blocked the right design until Sol, Fable and research agent all disagreed** (09-03T02:34). Class 1. Doc stated a conclusion without its scoped reasoning.
F16 DATABASE_URL on the command line silently buried by .env.local unless src/env.js imported first (09-03T02:33). Class 4/2.
F17 commit message baked a single-run failure count; uncorrectable after peer commit (25a84f61 09-01T17:05). Class 3.
Greg 09-02T16:48 (1c8eb342): "Make a minimal update to @AGENTS.md and/or @docs/reusable/engineering-manager.md to ask me questions if you can see a product tweak that would substantially simplify things, because often we'll prefer that route."
# Bucket 4 (048a3cc3 09-01, ad827f38, 145cc03c 09-02, f01ff285, cost-all-modes 055bc66d, 1955607f 09-03, 129f7fb6)

F1 "green where you're looking and wrong where it counts" — third instance in one night (048a3cc3 08-31T21:35). Greg asked for plain explanation. Fix was mechanical: typecheck:committed on a git archive extract.
F2 commit typechecked in tree, not on its own (peer's hunks rode along) (ad827f38 09-02T16:20). Class 4.
F3 **"Grep the genre, not the list"** — rule written into 260826m after its own first draft undercounted every duplication (assertSlug 3→5, r.ok 4→18, provider leak 3→6→7→13, "29 probes" was 34); then violated three more times in the session that wrote it: sourceHashFor "three copies" → 8 sites in 6 files; "four hand-rolled copies … one route with none" (145cc03c 09-02T08:38–09:07). Class 1. Closest to trigger.
F4 test pinned words not meaning; Sol passed all four assertions with a WHERE-less self-join (09-02T09:11). Class 4.
F5 subagent's uncounted quantifier ("each of the three copies called itself the third copy" — only one did) reached a docstring, test header, commit message and the skill doc, while citing written-down-is-not-checked.md (09-02T09:11). Class 3.
F6 **Fable: "Warning prose demonstrably didn't work. The Sol review found my run broke four rules that were already in the doc, while the doc was loaded… a warning in a reusable doc is prose that cannot fail. What actually corrected the run was structure with a reviewer behind it — the umbrella doc's table, and the Sol gate that read it."** (09-02T11:58). Class 8.
F7 whole-row bundle claimed no field can go missing; false for biggest table; guard table-level not column-level; Sol flagged, half fixed, stage marked done (f01ff285 09-01T17:16). Class 3/4.
F8 "third claim of mine this work has had to walk back… All three were caught by making something adversarial actually run rather than by re-reading the code" (09-01T18:40). Class 5.
F9 $11 misdiagnosed as truncation-retry; really dev-server restart duplicating in-flight job; "invisible because duplicated work produces the same right answer" (055bc66d 09-02T13:09). Class 3/4. Fix: check primary evidence (ledger) before a causal story.
F10 migration crisis misattributed; "sent me hashing every .sql across every worktree for an hour… The outage was cheap; the misdiagnosis was expensive" (09-02T14:49; 09-03T06:52). Class 3. Fix: reader refuses on conflict marker (tooling).
F11 `| tail` swallows exit code — named postmortem 260831c — walked into three times in one day across two sessions. Class 5. Needs mechanical guard.
F12 sharesArticleCache regression test asserts the bug as correct; eval printed the instruction for 8 days; "Only the bill was wrong"; "the fix for the previous instance of this class creating the next one" (09-03T06:54). Class 4/2.
F13 same-slug race guard 2.6 scheduled, reviewed, never built; two more copies added since (1955607f 09-02T18:11). Class 7.
F14 hand-written literal lists of seven modes in two test sweeps; newest five modes never exercised; third hand-typed mode→label map "deliberately kept separate as a drift check" (09-02T18:08). Class 2/1. Fix: derive from MODES; name the deliberate exception.
F15 two agents' migrations collided on sequence number (129f7fb6 08-31T21:59). Class 2.

Greg: "Explain plainly but briefly (and with example or two) what 'green where you're looking and wrong where it counts' means, and what we can learn/do differently in future." (08-31T21:36). "if you can see a way to improve the way we write code to make it more likely that type-checking/linting/etc will catch more issues, that would be great too." (08-31T21:48). "We want to make it easy/consistent/robust/reusable to add new modes." (09-02T18:02)
# Bucket 5 (sessions: delete-store-flag 225d6eb2, primary ddd39210, 957af82b, ccfc2804, d11ff731, 971f10e9, f177b06f, e62a3122)

F1 trigger: three wrong inventories in one lineage (225d6eb2, 09-03T08:12). Class 3/5. Fix: date counts + cite the command; generated manifest.
F2 same session's count stale within a day after 31 merged commits (09-03T08:03): "19 comparison sites across 10 files … My earlier numbers were taken before this worktree merged 31 commits". Class 3. Fix: write the command, not the number.
F3 `.env.example:218` says SPIDERYARN_STORE=postgres "keeps every process agreeing" (f0174caf); `scripts/seed-dev-rules.ts:213` (186c8651) says "DO NOT put SPIDERYARN_STORE=postgres in .env.local … it turned 146 tests red". Class 2/6. Fix: one source of truth for the flag.
F4 flag default = files → every check exercised the undeployed path; Claims 501 for 4h with green suite (260901e). Class 4. Code fix (delete flag).
F5 migration snapshots merged silently (new files), only _journal.json conflicted; Sol caught. Class 4/2. Fixed in git-resolve-merge-conflicts.md ("run the checks for whatever the merge touched").
F6 version bump to the value already present guards nothing; peer caught by reading the file. Class 4.
F7 NUL byte made a file invisible to grep; typecheck/tests green. Class 4. Not doc.
F8 one error for two conditions. Code.
F9 957af82b 09-01: "third time across this feature that the finding which mattered was a comment describing the intended behaviour while the code did the opposite, and the author reading past it because he wrote both." Class 3/8.
F10 ccfc2804 09-03: Section latched shut 7 days live; "the comment above that line described, correctly and in detail, the behaviour the code did not have — a cross-model review had found the right hazard, and the prose recording the fix is what made its absence invisible." Same class as F9.
F11 vacuous regression tests, twice (ccfc2804 09-03T02:35; d11ff731 09-02T16:24). Class 4.
F12 security guard declared closed twice, wrong both times: "a guard is worth exactly what its test can disprove". Class 3.
F13 "A line count tells you two files differ, not whose lines they are" — admin.md near-loss (d11ff731 09-02T18:18). Class 3/7.
F14 agent did whole feature in shared checkout while flagging others (d11ff731 09-03T00:33). Compliance gap.
F15 wrong fact in auto-memory propagated to Greg via another agent; investigation to disprove; became long-waits.md (971f10e9 09-02T15:43). Class 3/7.
F16 four audits swept src/tests/docs not scripts/; the only live caller was in scripts/ (f177b06f 09-02T16:53). "the evidence for 'nothing calls this' is an absence." Fixed: improve-the-codebase.md sweep must name the directories.
F17 Greg 09-02T17:41 (e62a3122): "one goal is that it should be easier (and more confident) for a future agent to find all the relevant places it needs to edit, and when it edits them for it to be clearer whether there are implications elsewhere that need to be taken into account. So this is partly about docs signposting, partly about static analysis surfacing callers/references/inconsistencies/etc, partly about clearer boundaries and reducing complectedness, partly about better tests, etc etc."

Recurring: class 3/4 dominant (9); "comment describes intended behaviour, code doesn't" named twice as recurring (F9, F10); wrong-scope sweep (F1, F16); wrong-place fact (F15).
# Bucket 6 (648a0291 09-02, c01f98ba 09-03 (billing), a4050f5f, 70852e00, 94124105, c338ad19, 10b4b4fb)

F1 Greg 09-02T17:42: "We're still having issues where agents seem to be editing in the primary checkout… Can you suggest a minimal change to @AGENTS.md and/or other idea that might help?" → bold paragraph + SessionStart hook. Class 8.
F2 **plan headed "Status: decided, not built" read back — by Greg too — as if shipped; grep returns one hit, in prose; "a decision that was made, reviewed, written down and then read back later as if it had shipped"** (c01f98ba 09-02T12:46). Class 1.
F3 ledger invariant enforced by CHECK for 2 of 3 columns, third only in JS; audit got $23.54 vs $11.77 (09-02T12:32). Class 4. Fix: move invariant into schema.
F4 migration snapshot chain forked three links deep, same night, two agents repaired independently (09-02T16:16; 94124105 16:14). Class 5.
F5 db:chain and migration-snapshots test check structure only; "two green gates that agree with the code because they share an assumption with it" (09-02T16:22, 18:24). Class 4.
F6 dev server inside a worktree could never see its own edits (watch.ignored matched its own path) — "every browser observation any agent has taken from inside a worktree is suspect" (a4050f5f 09-02T10:04). Class 4. Postmortem.
F7 em-dash slug mismatch in doc-links gate bit one agent three times in one session; worked around, never fixed: "it's a gate someone else built" (70852e00 09-01T13:26). Class 5.
F8 **version-control.md:21 "Vercel is not connected to this repo" — stale, contradicts deploy.ts:16; an agent reasoning from it would have concluded a push to main was safe** (09-01T13:49). Class 6/1.
F9 runbook line `git remote set-head origin -a` dangerous, self-caught at execution (09-02T05:41). Class 1.
F10 "six migrations" → eleven constraints across seven (09-01T07:43). Class 3.
F11 worktrees.md granted a rebase exception AGENTS.md bans; consolidated: "One source of truth instead of two that drift." (09-01T07:53/10:50). Class 2. Successful instance of the proposed fix.
F12 two agents found the same migration content hole independently; "Recording it here so it is written down somewhere other than two agents' transcripts, since neither of us is going to fix it." (94124105 09-02T17:30). Class 5/7.
F13 glossary.md:658 describes a population git history says never existed (c338ad19 09-03T02:48). Class 1.
F14 no counter for a dropped score. Class 4.
F15 web_searches null on every row under a comment asserting no caller uses web search; four do (c01f98ba 09-02T12:32). Class 1/4.
F16 "landmine" — blocked from merging four times by peers' uncommitted work; "Committing early and often does seem to be the only thing that helps." (09-02T18:09). Class 5/8.
F17 broke dev's typecheck via incomplete pathspec commit, then told a peer their tree was stale: "A local green gate is not evidence about the remote, and I asserted it was." (09-02T18:55). Class 3/4.
F18 realtime usage priced at $0 or negative; Sol reproduced numbers. Class 4.
F19 margin compared a month's price with two days' spend, ~15× flattering (09-03T00:27). Class 3/4.
F20 4,937 fixture rows vs 36 real in cost ledger. Class 4.
F21 subagent ignored "Do NOT commit"; an hour of merge archaeology (09-02T16:16). Class 5.
Greg 09-02T15:37: "Another agent said this: 'chat, quizzes and search spend model money and aren't gated' — I don't know if this is correct - can you check". Greg 09-02T13:36 (10b4b4fb): box changes → ask now/going forwards/both.
# Bucket 7 (4b144d53 08-31, 7d9a25bf, 0c750cfb 09-01, e2c75e68, 217b8ca3, 040d6809, 5126e9cc 09-02, f83c498f)

F1 earlier session wrote up residual scroll lag as a half-finished fix; actually automated-tab frame stalls; visible/hasFocus flags looked authoritative (4b144d53 08-31T17:25). Class 3/4. browser-testing.md: time the frames.
F2 own memo comment on complexity wrong, fixed hours later. Class 3.
F3 toc→hierarchy rename: tests still asserted /toc/, bucketed "PRE-EXISTING" (7d9a25bf 09-01T14:52). Class 2/6. Rename sweep must include tests/.
F4 **"a plan document is a record, not a queue"** — bug fully diagnosed in 260828bb § 1 on day two, rediscovered four days later; remedy: leave the note in the code at the line, not only in a plan (0c750cfb 09-01T11:19). Class 7.
F5 "seven lines apart" claim sloppy; Sol caught (09-01T06:10). Class 3.
F6 "Exactly one database home" was false — feedback.diagnostics also persists the mode (09-01T09:23). Class 1/3.
F7 two probes proved nothing: wrong schema (public vs spideryarn) → empty = "clean"; ai_calls 0 rows locally (09-01T05:52). Class 4. Habit: break the probe to watch it go red.
F8 stampOf reads sourceHash/version/generator; proposed names were in-memory StepStamp names — quiz would report not-current forever, "with nothing going red" (e2c75e68 08-31T21:54). Class 4. Fix: typed mapping / one vocabulary.
F9 one wrong sentence about finish_reason copied verbatim comment-included into 5 then 7 files over six days; scheduled fix 260826m § 3.4 "lost the race" (09-01T11:43). Class 5/1. Fix: shared classifyEnd module — one source of truth for logic.
F10 "no existing assertion changed is evidence, not proof" (09-01T15:18). Class 4.
F11 evals/quiz.ts cites silent-success.md in its header twenty lines above a summary reporting eight failures as eight marks: "awareness of the pattern is not a control" (09-01T10:58). Class 4.
F12 worktree:check first draft printed SAFE over an edited .env.local (217b8ca3 09-02T14:43). Class 4. Sol.
F13 baseUrl() defaults to primary's port; SPIDERYARN_BASE_URL documented nowhere; every worktree browser test hit the primary's server; success line doesn't name the URL (040d6809 09-02T15:06). Class 4. Fix: name the URL on every success line.
F14 ADMIN_EMAIL_LOCAL per-checkout constant next to per-machine password file — "per-machine state described by a per-checkout constant" (09-02T15:07). Class 2/8.
F15 skip count 7→411 misread; vitest marks a failed beforeAll's tests skipped; "Read Test Files, not Tests" (5126e9cc 09-02T07:40). Class 3/4.
F16 **"Every lesson I 'learned' today was already written down in testing.md… the paragraph existed and was ignored, by me, in a repo whose CLAUDE.md points at it. It has to be mechanical."** (09-02T08:21). Class 8. Fix: REQUIRE_POSTGRES=1 on the gate.
F17 recommendation wrong in both committed docs; worktrees.md already recorded the decision (09-02T12:20). Class 3.
F18 **"twelve" takeRunLock call sites was stale; fourteen right; "Rather than write fourteen, I replaced every such claim with a description plus `grep -rn takeRunLock tests/`, and re-dated the one that was a measurement"** (09-02). Class 1. Literal match to trigger; agent's fix = Greg's policy.
F19 doc-link check green on a link to data/<slug> because the slug is in the fixture corpus; fix: "name a runtime path, never link to it" in the checker (f83c498f 09-02T12:04). Class 4/2.

Greg: none general in this bucket; "other agents complained" re browser testing in worktrees (040d6809 09-02T15:00).
# Bucket 8 (2b63afc4 09-01, glossary-delete-pg a0d058f6, recorded-not-fixed 88b5a2b0, c1bf17df, 48e9074b 09-03, b7a4f3e7)

F1 table-of-contents.md:452 claimed COVERAGE_FLOOR "went from 0.95 to 1"; src/labels.ts has 0.95 — "both claims in that paragraph are stale — exactly the failure mode CLAUDE.md warns about" (2b63afc4 08-31T20:13). Class 1/2. Cite the constant, don't restate it.
F2 **"a citation is not an instance"** — "one lock" was ten; agent read "same trick as X" and filed X as an instance (a0d058f6 09-03T00:46). Class 1/3. Rule added to improve-the-codebase.md same night…
F3 …and broken the next run: "a citation is not an instance stopped one failure and let this one through, because I verified the role the comment named, not the object's actual uses" (09-03T04:42). Class 3/5.
F4 **"A written-down defect with an unchanged default is a defect with a paper trail, not a mitigation."** copy.md's "recorded rather than fixed" note; identical mistake eight days later by an author with access to the note (88b5a2b0 09-03T05:53). Class 1/5.
F5 the class was named a day earlier in 260902e; "the naming itself recurs without becoming a fix, and one-off dated plan-doc titles make such notes hard to discover later" (09-03T08:12). Class 5/7.
F6 "a repair inside the code under measurement redefines the measurement, and nothing fails when it does" — third time for this eval (c1bf17df 08-31T21:16). Class 4/5.
F7 Sol: tie-break deleted a whole section while reporting a different fault. Class 3/4.
F8 git mv ran before peer's hold request arrived; "luck, not design" (2b63afc4 08-31T21:01). Class 5/8. Rule: announce, wait for ack, act.
F9 colliding drizzle migrations twice (08-31; 09-02). Class 5/6. Needs a lock.
F10 migration green against an empty (reset) DB proves it runs, not works (08-31T22:37). Class 4.
F11 **"Nine places store the string 'toc', and no single sweep found more than six of them."** (08-31T21:33). Class 1.
F12 "The unit of a commit is the change, not the file — and the piece you're missing usually contains none of the thing you're searching for." publish-session.ts half-landing (08-31T22:10). Class 4/7. Simulate the commit.
F13 monitoring-scrub fix was a privacy regression; Sol caught (88b5a2b0 09-03T06:02). Class 3.
F14 "accepted knowingly" trade made without knowing the code's second meaning; ten tests caught (09-03T07:14). Class 3. Fix: a value serving two purposes needs both documented at the definition.
F15 admin.md wrote a symptom off as a hot-reload artefact — unverified hypothesis read as fact (48e9074b 09-03T03:39). Class 1. Fix: cite evidence/date.
F16 line-count diff nearly discarded peer's admin.md work (b7a4f3e7 09-02T18:18). Class 7/5. Written into version-control.md.
F17 "three agents today converging on the wrong owner… work lives uncommitted in one shared checkout, where nothing records who wrote what" (09-02T18:23). Class 8/5.
F18 drizzle-kit generate no TTY exit 0 (09-02T18:16). Class 4.
F19 pathspec commit carried importer without its untracked dependency (569458f, breaks Vercel); and 63 lines of a peer's spend work (08-31T21:36; 09-02T18:04). Class 5.
F20 **over-deferring**: "four of five 'decisions for Greg' didn't need him… The test I should have applied: can I name the thing only Greg knows? If not, it's work." (a0d058f6 09-03T07:04). Class 8. Greg: "Are you blocked by decisions from me? Get input from Fable…"
F21 settled decision re-opened by the next sweep despite "named here only so the next sweep does not re-open it" (09-03T07:11). Class 5. Fix: "settled, don't re-open" vs "deferred".
F22 shared Postgres concurrency cap full from other worktrees → tests correct, not flaky (09-03T05:00). Class 4. worktrees.md.
