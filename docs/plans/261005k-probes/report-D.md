# Report D: review and reasoning lessons

(Returned as text — the harness refused the subagent's own write — to be saved here by the orchestrator.)

Stage 1 of [261005k](../261005k-port-overseer-auto-memory-into-docs.md), batch D. 19 memory files
read in full on 2026-10-05; hashes are `sha256sum`, first 12 characters, taken at that read. No doc
was edited. The 2026-10-01 sweep moved none of these (`261001i-probes/report-W3.md`, `report-W4.md`;
`trawl-D-memory-and-quotes.md` items 30, 38, 41, 42 and its group c list them as not covered).

2 files eligible, 17 retain. 3 edits (`DE1`–`DE3`), 10 proposals (`DP1`–`DP10`).

## Table

| memory file | sha256 (first 12) | lessons | verdict |
|---|---|---|---|
| `re-reading-your-own-work-is-a-zero-check` | `68ea533dea0a` | L1 (re-reading your own work finds nothing; buy an external check; five holes, none found by re-reading) propose DP1. L2 (when a check is green, make it go red) already: `docs/reusable/silent-success.md` § The habit — "ask what you would have to measure for it to look **wrong**". L3 (two fixture-uuid collisions diagnosed as one habit; the refuting values were in my own message) already: `silent-success.md` § The habit — "two fixture-id collisions read as one bad habit, when one was a counting-block id that hit a real row and the others were captured ids shared on purpose". | retain |
| `codex-cli-404s-on-this-box` | `3c6fc973ab11` | L1 (the 404 is intermittent; retry; say plainly if the review could not run) already: `docs/reusable/codex-cli-as-subagent.md` § The house workflow in this repo — "Assume intermittent, not down." L2 (check exit code and that the answer file exists) already: same section — "exit 0, *and* read the answer file". L3 (the Bash tool's two-minute default kills a review; explicit timeout or tmux) propose DP9. L4 (a `model: "fable"` subagent is the substitute) dropped: stale — `AGENTS.md` § Delegating says "Fable is retired (Greg, 2026-09-28)", and `engineering-manager.md` § Delegate says the work waits rather than taking a stand-in. Also stale: `--model gpt-5.6-sol`; the house command is `--model sol`. | retain |
| `killed-codex-run-still-writes-its-answer` | `f405f19bb77b` | L1 (a killed run still writes the old answer to a reused `--output` path; unique path or delete first) propose DP9. L2 (ask the reviewer to echo a nonce) propose DP9. L3 (kill the process group, not the pid) propose DP9. L4 (judge a review by whether it answers the prompt sent) already: `codex-cli-as-subagent.md` § Gotchas — "reads as an answer to a *previous* prompt … Treat such an answer as suspect". L5 (the other ending: the run dies under memory pressure and writes nothing; match `--prompt-file` in `pgrep`; relaunch once) propose DP9. L6 (wait with `CronCreate` one-shots, not a shell loop) dropped: duplicate of `long-waits-need-a-persistent-monitor` (batch B). | retain |
| `ask-the-reviewer-to-check-the-conclusion` | `e7a758fada3b` | L1 (put the result in the candidate and ask for a judgement of the conclusions; name the finding you least want to be wrong about) propose DP5. L2 (a finding that changes a conclusion outranks one that changes a line) already: `docs/reusable/review-prompt-template.md` § The five rules, rule 4 — "Grade by the consequence, not the file". L3 (keep both the wrong conclusion and its correction in the plan doc) propose DP5. | retain |
| `an-unchecked-brief-claim-becomes-a-source-comment` | `16fb40772dcd` | L1 (a claim in a brief comes back verbatim in comments, docs and tests; grep each load-bearing one first) propose DP4. L2 (a review finding is the same hazard; enumerate the input space rather than test one instance) propose DP6. L3a (a peer session's confident claim is the same hazard) already: `silent-success.md` § Spotting the family — "the agreeing is what stopped the checking". L3b (a grep answers one direction; say which in the sentence that reports it) propose DP3. L4 ("nothing does X" is the riskiest shape) already: `docs/reusable/written-down-is-not-checked.md` § 2. A statement that asserts an absence — "An absence is only as good as the enumeration behind it". L5 (end every brief with "say which claims in this brief turned out to be false") propose DP4. L6 (a wrong claim has copies; hunt them all) propose DP4. L7 (re-check the claims a decision rests on) already: `codex-cli-as-subagent.md` § Four ways the second opinion gets wasted — "Test the load-bearing fact first." | retain |
| `name-the-fallback-before-the-reviewer-does` | `ecf8627dd075` | L1 (a brief that adds a throw, a 4xx or a refusal on a reader's path carries the fallback and an instruction to test the licence) propose DP4. L2 (list the refusal in the review prompt as the conclusion you least want wrong) propose DP5. L3 (when the fallback fires, the plan says documented, not closed) propose DP4. | retain |
| `a-check-can-answer-a-weaker-question` | `b1ba354f0a43` | L1a (a guard that reads a copy or a spelling of its subject cannot see the subject move) already: `docs/project/typechecking.md` § A guard you rely on, that only this gate can enforce — "the guard must read the thing it is guarding, not a copy of it". L1b (the seven bypasses of 2026-09-08 and what each moved) edit DE3. L2 (a grep in one direction reports on one direction; name the scope searched) propose DP3. | retain |
| `a-truncated-grep-becomes-an-exhaustive-list` | `44da9ebeaf01` | L1 (`grep … \| head -20` cut seven callers to three and the three became "the set" in a source comment; count first or re-run unbounded) propose DP3. `written-down-is-not-checked.md` § 4. An inventory names the cause ("the grep was truncated") but not what to do about `head`. | retain |
| `a-survey-cannot-see-an-absent-state` | `9794d6939cd2` | L1 (a rule derived from a census of live instances misses the beginning-of-life state; make one specimen first) propose DP2. | retain |
| `two-joins-that-disagree-are-a-measurement` | `b8a3dbb864cd` | L1 (build a second, independently derived join so it can disagree) propose DP2. L2 (`unknown` is its own column, never folded into the negative) propose DP2. L3 (zero unknowns is not a correct join) propose DP2. L4 (send the unfavourable reading to whoever decides, at the time) already, loosely: `codex-cli-as-subagent.md` § Four ways the second opinion gets wasted — "A result whose value is to somebody else is the one that gets dropped." | retain |
| `a-fallback-makes-a-failed-check-look-answered` | `57de320b38c0` | L1 (`ls X \|\| git show Y` prints plausible output when the check fails; read the exit code) propose DP2. L2 ("the commit is on dev" is not "the file is in my tree") propose DP2. | retain |
| `a-comment-is-not-a-traced-equality` | `598d07b8dbbf` | L1 (an equality inferred from an assignment and a comment, with the middle hop never opened) propose DP6. L2 (a hash built for caching may be weaker than one built for safety; ask what it protects before borrowing it) already, loosely: `docs/reusable/name-is-evidence.md` § The one that is not about identity at all — "Reusing a predicate because its name sounds like your question". | retain |
| `a-codex-self-review-looks-like-an-independent-one` | `537dc14c4c7f` | L1 (a Codex run asked to implement and review reviews itself when its nested run cannot start, and reports success) propose DP7. L2 (read the artefact's provenance line; re-run from your own shell; do not count it as the cross-family round) propose DP7. | retain |
| `a-header-comment-is-not-a-traced-check` | `e49cbd7db4f1` | L1 (a header saying what one component cannot see is not evidence about the system; trace the refusal path; say "unverified" if you could not) propose DP6. | retain |
| `a-fixing-reviewer-can-attribute-your-words-to-greg` | `d82eff31b991` | L1 (a write-capable review put a sentence from the prompt in a dated blockquote as Greg's decision) propose DP8. L2 (diff the docs it touched, grep its edits for `Greg`; say in the prompt whose decision a trade-off was) propose DP8. | retain |
| `write-capable-reviewer-can-invent-greg-quotes` | `5aa183a51cc2` | L1 (the same incident, 2026-10-04, plan 261004e) dropped: duplicate of `a-fixing-reviewer-can-attribute-your-words-to-greg` L1. L2 (tell a session that runs fixing reviews to grep the reviewer's doc edits for "Greg") dropped: duplicate of the same file's L2, carried by DP8. | eligible |
| `a-sibling-sweep-may-have-already-measured` | `2d4484ee3ce1` | L1 (what an earlier run appended to a queue entry is only in `overseer-queue show <id>`; `list`, `git log` and `gjd-remote ls` do not show it) edit DE1. L2 (on a long entry the fact is in the middle, not the newest appendix) edit DE1. L3 (read the entry before re-measuring; if nothing changed, append nothing) propose DP10. The Sentry specifics (the empty queue, the Vercel MCP boundary) are dropped as stale: `feedback-reports.md` § Where the queue lives — "The database is the queue; Sentry is optional context." | retain |
| `prove-an-empty-queue-with-a-control-query` | `731a87e04b7d` | L1 (a finding that is an absence needs a control that would come back non-empty) already: `silent-success.md` § The habit — "A number that can honestly be zero needs its positive control asserted by the same run." L2 (re-run the Sentry search without `is:unresolved`) dropped: stale — since 2026-10-02 the sweep starts from `scripts/feedback-unswept.ts` (exists), and `feedback-reports.md` § Where the queue lives says "exit 2 = could not read, not "none"". L3 (`qi-hpyc3az9` is unbuilt) dropped: one job, and the item is still in the queue itself (`overseer-queue.ts show qi-hpyc3az9`, read 2026-10-05). | eligible |
| `check-git-log-before-building-a-feedback-fix` | `f5865ba3498c` | L1 (check `git log` before planning a fix for a report) already: `docs/project/feedback-reports.md` § The run, step 3 — "First, check it isn't already done or in flight". L2 (the fix can arrive under a sibling report's name; `gjd-remote ls` cannot show it; the commits arrive only when `worktree:setup` merges, announced in one line) edit DE2. L3 (the record is plan 260908c) dropped: a pointer, and the file exists; DE2 links it. | retain |

## Edits

### DE1 — `docs/project/overseer-queue.md`, the paragraph "Two things the CLI says that mislead."

**Anchor** (insert a new paragraph directly after the paragraph that ends with this line; the line occurs once):

```
`authority:` line before the edit is what says which case it was.
```

**Text:**

```
**And `list` shows none of an item's body.** It cuts each title at 66 characters
(`scripts/overseer-queue.ts` § `describeItem`), so whatever earlier runs appended to an entry, and
its `History:` lines with their timestamps, appear only in `show <id>`. On 2026-09-20 a sweep
re-derived a measurement that a sibling sweep had appended to the same entry four hours earlier:
`git log` and `gjd-remote ls` both looked untouched, because the earlier sweep changed nothing in
the repo and its session had ended. It happened again on 2026-09-23, on an entry by then 154 lines
long with six dated appendices: the opening and the newest appendix were read, and the fact was in
an older one. Each author appends rather than revises, so the newest section is the least likely
to hold a fact recorded earlier.
```

Carries `a-sibling-sweep-may-have-already-measured` L1, L2.

### DE2 — `docs/project/feedback-reports.md` § The run, step 3

**Anchor** (insert directly after this line, keeping the three-space list indent; the line occurs once):

```
   its calls to make, not this loop's.
```

**Text:**

```

   **A sibling report's session is the likeliest author of the fix, and `gjd-remote ls` cannot
   show it.** Two symptoms of one cause arrive as two reports. On 2026-09-08 the fix for `-2H`
   landed from `-2J`'s session, under `-2J`'s name, fourteen minutes after `-2H`'s session took its
   opening snapshot; `-2H` was still unresolved and no session carried its id, both correctly.
   Those commits reach a worktree only when `npm run worktree:setup` merges them, and all it prints
   is *"merged origin/dev (…) — N commits this worktree did not have"*
   (`scripts/worktree-freshen.ts`), so a `git log` read before setup cannot see them —
   [260908c](../plans/260908c-the-feedback-box-zoom-was-fixed-ten-minutes-before-i-started.md).
```

Carries `check-git-log-before-building-a-feedback-fix` L2.

### DE3 — `docs/project/typechecking.md` § A guard you rely on, that only this gate can enforce

**Anchor** (insert a new paragraph directly after the paragraph that ends with these two lines — the last paragraph of the section, just above the heading "### The `@/` alias, and where it may live"):

```
test seam whose default is a stub, are the same failure — an instrument disconnected from its
subject.
```

**Text:**

```
**Measured on one guard, 2026-09-08: GPT Sol broke it three review rounds running, seven bypasses in
all, and every one was a single edit that moved the guard's subject and its definition of "correct"
together.** "The type mentions `EXPECTED` somewhere" passed a `string |` member. "The `satisfies`
target is spelled `readonly Expected[]`" passed once the interface was widened instead. "This one
literal is not assignable" passed once the alias in between was widened. `string extends keyof T`
missed a `` `w${string}` `` pattern index, which is narrower. Two degenerate cases sit under all of
them: `any` compares equal to everything, and a widened source widens both halves of a comparison
derived from it. Asking the compiler was not, by itself, the stronger question: a sampled literal
and an enumerated mechanism were both checks on a spelling. And a false `as` assertion cannot be
disproved from inside the type system at all, while it is trivially found as text.
```

Carries `a-check-can-answer-a-weaker-question` L1b.

## Proposals

All but DP10 are in `docs/reusable/`, so they are proposals whatever their wording.

### DP1 — `docs/reusable/silent-success.md` § The habit

**Before:**

```
**Reasoning about it is not checking it.** A regex reviewed by eye looked correct and matched the
wrong thing; the mutation run found it in seconds. Reasoning is the natural check par excellence,
because it re-runs the same assumption that produced the code.
```

**After:**

```
**Reasoning about it is not checking it.** A regex reviewed by eye looked correct and matched the
wrong thing; the mutation run found it in seconds. Reasoning is the natural check par excellence,
because it re-runs the same assumption that produced the code. **Re-reading your own work is the
same check, and it buys nothing.** On the night of 2026-09-07/08 five separate holes in one
migration's safety net each survived repeated reading by its author, and every one fell to
something external: a peer session, a cross-family review, or a probe run against a case that
should fail. When you catch yourself planning to read it carefully once more, spend that on one of
those three instead.
```

Why here: this is the paragraph a reader lands on when deciding whether thinking harder is a check.
Carries `re-reading-your-own-work-is-a-zero-check` L1.

### DP2 — `docs/reusable/silent-success.md` § Fourteen more, from the checks rather than the code

**Before** (the heading, and the last row of that table):

```
## Fourteen more, from the checks rather than the code
```

```
| An assertion that reddens above the line you care about | The test fails when the bug is introduced, so it covers it | *Which* assertion fired — a mutation can redden a test without ever reaching the one it is named for |
```

**After** (the heading renamed, and three rows added directly after that last row):

```
## Seventeen more, from the checks rather than the code
```

```
| An assertion that reddens above the line you care about | The test fails when the bug is introduced, so it covers it | *Which* assertion fired — a mutation can redden a test without ever reaching the one it is named for |
| A fallback chained onto an existence check | `ls X \|\| git show Y` printed a commit header, so the file is there | The check alone, by exit code — `test -e X && echo PRESENT \|\| echo ABSENT`, so both branches say which happened — and in *your* tree: a peer's commit being on the trunk does not put its file in a worktree that has not merged it |
| A rule derived from a census of what is running | All seventeen live instances agree, so the rule is obvious | One specimen made on purpose of the state nothing is in right now — just created, just failed, empty. A new session showed a greyed hint in its input box that no used session has, and the rule would have made every new session unsendable |
| A count that came from one join | Zero unknowns, and a plausible number | A second join, derived independently, kept beside the first so the two can disagree; `unknown` as its own column, never folded into "no". A pid join returned unknown for 4 of 4, an ancestry join returned zero unknowns and the wrong answer, and only the disagreement pointed at the cause |
```

Why here: each is a check that answered while defeated, which is this table's subject. The heading's
anchor has no inbound link (`grep -rn "fourteen-more-from-the-checks" docs AGENTS.md`, 2026-10-05:
no hits), so renaming it breaks nothing. Carries `a-fallback-makes-a-failed-check-look-answered`
L1, L2; `a-survey-cannot-see-an-absent-state` L1; `two-joins-that-disagree-are-a-measurement` L1,
L2, L3.

### DP3 — `docs/reusable/written-down-is-not-checked.md` § What to actually do

**Before:**

```
- **Never a bare count.** *"14 by `grep -rn takeRunLock tests/`, 2026-09-02"* — command, scope,
  date.
```

**After:**

```
- **Never a bare count.** *"14 by `grep -rn takeRunLock tests/`, 2026-09-02"* — command, scope,
  date.
- **Never a list from a search piped through `head`.** On 2026-09-08 `grep -rn … | head -20`
  showed three callers of seven, and the three went into a source comment as the set — in the
  comment written to correct a false claim. Count first (`grep -c`, `| wc -l`), or re-run it
  unbounded before the list becomes a sentence.
- **Say what you searched, in the sentence that reports the result.** A grep answers one
  direction. *"Nothing in `tools/overseer/` imports X"* is a claim a reader can size; *"the seam is
  one-way"* also needs the reverse grep, and on 2026-09-09 nobody had run it before a design
  decision was built on it.
```

Why here: both are inventories and absences reported without their edge, which is this list's
subject. Carries `a-truncated-grep-becomes-an-exhaustive-list` L1;
`an-unchecked-brief-claim-becomes-a-source-comment` L3b; `a-check-can-answer-a-weaker-question` L2.

### DP4 — `docs/reusable/engineering-manager.md` § Delegate

**Before** (new, after this paragraph):

```
A subagent starts with nothing but your prompt. Name the files, say what the stage excludes as well
as what it is for, say what done looks like, and ask for the conclusion rather than the material.
Run them in parallel only when their file sets don't overlap.
```

**After** (that paragraph unchanged, then):

```
**Grep every load-bearing claim in a brief before you send it.** The builder's only source for the
reasoning is the brief, so a fact asserted there comes back quoted in a source comment, a doc
paragraph and a test header at once, and each copy then reads as separately established. Three
false ones in one plan in September 2026 each cost a review cycle: a named caller, a "nothing loads
this file", a "this file calls that function". The same goes for a fact you took from a review
finding or from another session's message. Give the builder the grep rather than the conclusion,
and **end the brief with *"say which claims in this brief turned out to be false"*** — on
2026-09-08 two wrong instructions stayed out of the tree because both implementers reported the
problem instead of complying. When a claim does turn out wrong, find every copy of it, as you would
for a rename.

**A brief that adds a refusal carries its own retreat.** For a `throw`, a 4xx or any hard refusal on
a path a reader can reach, write two things before the work starts: the fallback, in one sentence,
as a decision already taken (*"if any ordinary request reaches the throw, do not keep it: log a
warning and return null"*), and an instruction to test the mechanism the "this cannot happen"
argument rests on, naming it. On 2026-09-07 the builder found the stated mechanism was the wrong
one, the reviewer found the replacement argument was false too, and because the fallback was
already written a P0 was a one-line decision. When the fallback fires, the plan says *documented*,
not *closed*.
```

Why here: § Delegate is where the doc says what a brief must contain. Carries
`an-unchecked-brief-claim-becomes-a-source-comment` L1, L5, L6;
`name-the-fallback-before-the-reviewer-does` L1, L3.

### DP5 — `docs/reusable/review-prompt-template.md` § The five rules, before the template

**Before** (new, after rule 3's paragraph, which ends with these two lines):

```
This is [codex-cli-as-subagent.md § If you can write the question, write the fix](codex-cli-as-subagent.md#the-house-workflow-in-this-repo)
applied to the prompt's layout rather than its content.
```

**After** (those lines unchanged, then):

```
**When the stage produced a result, the conclusion is part of the candidate.** List the results
file or the write-up in the manifest and say *read this as a reviewer of the conclusions, not only
of the code*. Then, under your own suspicions, write the one sentence you would least like to be
wrong about and ask for it by name; a refusal the stage introduced on a reader's path belongs
there. On 2026-09-07 an eval's write-up called its arms "not separable", and the reviewer, asked
directly whether that was explaining away an inconvenient result, showed that it compared two
statistics on different sampling scales and that three of the five arms were one recipe. A reviewer
handed only the diff cannot find that, because the defect is not in the code. Keep the wrong
conclusion and its correction both in the plan doc: deleting the wrong one loses the evidence of
which way the pull went.
```

Why here: it is a rule about what goes in the prompt and where, beside the rule on suspicions.
Carries `ask-the-reviewer-to-check-the-conclusion` L1, L3;
`name-the-fallback-before-the-reviewer-does` L2.

### DP6 — `docs/reusable/codex-cli-as-subagent.md` § The house workflow in this repo

**Before:**

```
**Check each finding yourself before acting on it.** Some of them are wrong. Fold what survives into
the plan, and add its questions to the ones for Greg.
```

**After:**

```
**Check each finding yourself before acting on it.** Some of them are wrong. Fold what survives into
the plan, and add its questions to the ones for Greg.

**Checking means tracing, not reading a description.** Open the function that does the thing and
every hop on the way to it. A comment says what a field *means*, never what it *equals*; a file
header says what one component cannot see, not what the system does. On 2026-09-09 a plan's central
mechanism rested on two values being the same thing, inferred from an assignment and a nearby
comment with the middle hop never opened, and it was false. On 2026-09-10 a security finding was
"verified" from a header describing a blind spot, when the check that covered it was one file over,
and it went to Greg as an alarm. For a claim about behaviour, run the small complete set of inputs
rather than one: a finding that a function "compares only the first two" ids was true, and the
obvious single test of it would have passed and seemed to refute it, because only the position of
the odd one decides. **A finding you could not trace is relayed as *unverified*, in that word.**
```

Why here: it is the paragraph that tells the caller to check a finding, and it does not say how.
Carries `an-unchecked-brief-claim-becomes-a-source-comment` L2;
`a-comment-is-not-a-traced-equality` L1; `a-header-comment-is-not-a-traced-check` L1.

### DP7 — `docs/reusable/codex-cli-as-subagent.md` § The house workflow in this repo

**Before** (new, after the paragraph that ends with this line):

```
[Gotchas](#gotchas). `retrying with CODEX_API_KEY` on stdout is the fallback working, not a failure.
```

**After** (that paragraph unchanged, then):

```
**And check that it was a second opinion.** A Codex run asked both to implement and to review can
end up reviewing its own work: when the wrapper cannot start a nested Codex process inside the
sandbox (the read-only filesystem, or the `listen EPERM` on tsx's IPC socket under
[Gotchas](#gotchas)), the same model takes the review brief itself. It does not fail. Measured
2026-09-09: it wrote a proper artefact with IDs, severities and two rounds, found two real P1s and
reported "accepted after fixes"; an independent pass over the same commit, launched from the
caller's own shell, then refused it on five established P1s. Exit 0, a fresh answer file and
plausible findings are all satisfied by a self-review. The only sign was one sentence in the
artefact saying the nested process could not start. So read a review artefact for how it was
produced, launch the review yourself from a fresh `run-codex.ts` invocation, and do not count a
self-review as the cross-family round.
```

Why here: it sits beside the existing "check that a verdict actually arrived" rule, and is the case
that rule passes. Carries `a-codex-self-review-looks-like-an-independent-one` L1, L2.

### DP8 — `docs/reusable/codex-cli-as-subagent.md` § The house workflow in this repo

**Before** (new, after the paragraph that ends with these two lines):

```
a **plan review**, where the only thing to fix is prose, and for any pass where you want the mutation
rather than the patch.
```

**After** (that paragraph unchanged, then):

```
**Read the reviewer's doc edits as well as its code, and grep them for `Greg`.** On 2026-10-04 a
write-capable review edited a plan doc and put a sentence from the review prompt, the caller's own
account of a trade-off it had taken, in a dated blockquote headed as Greg's decision. Greg had said
nothing. This repo treats his quoted words as rules, so a made-up one in a committed doc would be
read as his authority by every later agent, and nothing else checks it. In the prompt, say whose
decision each trade-off was (*"my decision, not the user's"*).
```

Why here: it is a cost of the write-capable default, stated where that default is described. Carries
`a-fixing-reviewer-can-attribute-your-words-to-greg` L1, L2 (and the duplicate
`write-capable-reviewer-can-invent-greg-quotes`).

### DP9 — `docs/reusable/codex-cli-as-subagent.md` § Gotchas

**Before:**

```
- **Stale-looking answers.** A run occasionally returns something that reads as an answer to a
  *previous* prompt. The wrapper writes a fresh temp `-o` file per run and never resumes a session,
  so it isn't output reuse on this side; the likely causes are upstream. Treat such an answer as
  suspect, re-run with a textually distinct prompt, and never let a single Codex pass carry a
  load-bearing claim ("X is already implemented", "this is safe") without a second check.
```

**After:**

```
- **Stale-looking answers.** A run occasionally returns something that reads as an answer to a
  *previous* prompt. The wrapper writes a fresh temp `-o` file per run and never resumes a session,
  so it isn't output reuse on this side; the likely causes are upstream. Treat such an answer as
  suspect, re-run with a textually distinct prompt, and never let a single Codex pass carry a
  load-bearing claim ("X is already implemented", "this is safe") without a second check.
- **One cause of a stale answer is on this side: relaunching onto an `--output` path a killed run
  used.** Measured 2026-09-07: a review was killed with `kill <pid>` and `pkill -P <pid>` and
  relaunched with a rewritten prompt at the same path. The first run survived both signals (it sits
  below the `npx` and `tsx` processes, in a process group of its own), finished, and wrote the
  *superseded* review to that path about eight minutes later. Exit code and "the file exists" both
  passed, the answer was acted on, and a design decision was reversed on it. So give every run its
  own `--output` path, or delete the file first and treat its reappearance as the signal; kill a
  run by process group (`kill -- -<pgid>`); and judge an answer by whether it discusses the prompt
  you sent. Asking the reviewer to echo a nonce from the prompt makes that mechanical.
- **The opposite ending: under memory pressure the run dies and writes nothing.** No answer file
  and no process whose `--prompt-file` is yours means it died, and relaunching onto the same path
  is then safe because nothing was written. Check with `pgrep -af "run-codex|codex"` and match the
  prompt file: several worktrees run reviews at once and a bare process count is somebody else's.
  Relaunch once; a second death is the box, not the run.
- **The Bash tool's own two-minute default kills a review mid-run.** Give the call an explicit
  timeout well above `--timeout-minutes`, or run it detached with `scripts/tmux-job.ts`.
```

Why here: Gotchas already has the stale-answer bullet, and it currently says the cause is not on
this side. Carries `killed-codex-run-still-writes-its-answer` L1, L2, L3, L5;
`codex-cli-404s-on-this-box` L3.

### DP10 — `docs/project/overseer-queue.md`, after the paragraph DE1 adds

**Before:** new, after the last line of DE1's text (`to hold a fact recorded earlier.`).

**After:**

```
So before a sweep investigates a standing question, read the entry that owns it whole with
`npx tsx scripts/overseer-queue.ts show <id>`, history timestamps included. If a sibling has
already measured and nothing has changed since, say so in the debrief and append nothing: another
"measured again, same" section is noise in a record Greg still has to read.
```

Why here: the queue doc owns how its entries are read and written, and this is a required step
rather than a description. Carries `a-sibling-sweep-may-have-already-measured` L3.

## Quotes, and doubts

**Greg quotes used: none.** No edit or proposal above quotes or paraphrases Greg. DP8 and DP6 name
him only as the subject of a fact ("Greg had said nothing", "it went to Greg as an alarm"); both
come from the memory's own account and are not his words. The italic strings in DP4, DP5 and DP8
(*"say which claims in this brief turned out to be false"*, *"if any ordinary request reaches the
throw…"*, *"my decision, not the user's"*, "not separable") are the Overseer's own wording from the
memory files, not Greg's.

**Doubts.**

1. **Biggest: how strict "already" should be for the reasoning lessons.** `silent-success.md` and
   `written-down-is-not-checked.md` state most of these classes in general form. I proposed a
   sentence wherever the memory held a concrete way to act that the doc lacks (DP1, DP3, DP2's
   rows), which leaves 17 of 19 retained and ten proposals for Greg. A reader who thinks the
   general form is enough could call `re-reading-your-own-work-is-a-zero-check`,
   `a-truncated-grep-becomes-an-exhaustive-list` and `a-survey-cannot-see-an-absent-state` eligible
   today and drop DP1, the first bullet of DP3 and DP2's census row.
2. **Three "already" rows are loose**, and are marked so: `two-joins` L4, `a-comment-is-not` L2
   (the cache-versus-safety hash point is only analogous to the predicate-reuse passage in
   `name-is-evidence.md`), and `an-unchecked-brief-claim` L3a. Each file is retained for other
   lessons, so none of them decides a verdict.
3. **DE2 and DE3 may read as advice.** Both are written as what happened and what the tool prints,
   but DE2 sits in a numbered procedure and `feedback-reports.md` was called "pinned" by the
   2026-10-01 sweep (report-W3, P4). If either reads as a rule, move it to a proposal.
4. **DP9 and the tree.** `scripts/run-codex.ts` has no signal handler (`grep -n "process.on("`:
   only `exit`, 2026-10-05) and spawns Codex detached, so a killed wrapper cannot take Codex with
   it; that matches the memory. I did not reproduce the incident, and the memory's explanation of
   which process wrote the stale file is its author's reading. The existing Gotchas bullet says
   stale answers are "not output reuse on this side"; the memory contradicts that for the reused
   `--output` case, so DP9 keeps the bullet and adds the exception rather than rewriting it.
   `--launch-dir` (newer than the memory) may already give each run its own answer path; I did not
   check whether it should replace the "unique `--output`" advice.
5. **DP7 was not re-verified.** The self-review is one measured incident (plan 260909h). The
   sandbox causes it names (`listen EPERM`, read-only filesystem) are documented in the same doc's
   Gotchas, but I did not confirm a nested `run-codex.ts` still behaves this way.
6. **DP2 renames a heading.** No inbound anchor link was found, but the proposal can equally keep
   "Fourteen more" and let the count be wrong, as the "six unrelated bugs" in the doc's first line
   already is against "The twelve".
7. **`prove-an-empty-queue-with-a-control-query` is eligible on a general passage.** Its concrete
   recipe is about a Sentry search that is no longer the sweep's input. If the Sentry search is
   still run as context and its zero is ever reported, the recipe would be worth one line in
   `feedback-reports.md`; I judged it not, because the doc says nothing the sweep depends on comes
   from Sentry.
8. **Docs found possibly out of date (not checked further):** `overseer-queue.md` still says "The
   sixteen clusters below" and that the markdown table is what gate 3 reads; I did not check either
   against `overseer.md`. `silent-success.md` opens with "six unrelated bugs" above a table headed
   "The twelve".
9. **`a-check-can-answer-a-weaker-question` names no file for the guard**, so DE3 cannot cite the
   code; it cites the date and the reviewer only.
10. **`write-capable-reviewer-can-invent-greg-quotes` is eligible only as a duplicate.** Its lesson
    is in no doc yet; it survives in `a-fixing-reviewer-can-attribute-your-words-to-greg`, which is
    retained until DP8 lands. Delete the duplicate only while that file still exists.
