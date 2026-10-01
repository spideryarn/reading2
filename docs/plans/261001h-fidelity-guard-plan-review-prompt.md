# Plan review: measuring the proposed Simple fidelity guard (261001h)

You are reviewing a measurement design before any paid call runs. Read-only. Be concrete and brief; P0/P1/P2 per finding.

## Context

Read `docs/plans/261001h-plain-words-summaries-keep-the-piece-s-contrasting-terms.md`, especially § The guard. Simple (a plain-words summary at three levels: brief, paragraphs, fuller) sometimes calls the PID paper's *recurrent* connections (which raise synergy) "feedback loops", the paper's name for the kind that lowers it. The proposed guard: after each level is written, one checker call reads each paragraph with the text of the blocks it cites and returns a verdict per paragraph; any "contradicts" uses the level's one remaining retry. Greg decides whether to build it; this job measures it first. Budget: under $1–2 of model calls.

## The design

- **Corpus** (free): every saved successful Simple run on the PID paper under `evals/results/simple/*/entropy-24-00930-spya-pywwkq.json`, which is 128 levels and 493 paragraphs from 56 arms. Older arms have only the `paragraphs` level. Cited block texts are resolved from the local database's current copy of the article (48 distinct blocks, and all resolved).
- **Labels** (`docs/plans/261001h-fidelity-guard-labels.json`): 30 faulty paragraphs, labelled by hand from every sentence that mentions feedback, loops or recurrence: 26 clear swaps, 3 glosses using the other kind's name, and 1 direction error. That reproduces the plan's own counts (6/18 pre, 3+2+1 post, 7+1 v2). Everything else is presumed faithful. Every alarm on an unlabelled paragraph is read by hand against its passages and recorded as a real other fault, a borderline case, or a false alarm. A paragraph left unlabelled on purpose as borderline: `high-none-pidpost5/fuller/3`, *"rises when neurons feed back and forth on each other (recurrent connections)"*.
- **Probe** (`scripts/probes/261001h-fidelity-guard-probe.ts`): `corpus | check <luna|sonnet> | score`. One call per level, with a run's three levels in parallel as in a press. The checker's system prompt is in the file (`SYSTEM`). It is deliberately generic: it names the class (a finding pinned to the wrong name, a reversed direction), not this paper or the word "feedback". JSON verdicts. An unreadable answer counts as a flag (fail closed).
- **Models.** setup-dev.md § Which model everything uses: *"a new job may be born on the quick tier by judgment"*, and the default is capable. I plan to measure **both**: Luna (quick, through `link-summary`'s route with `effort: low`) as the candidate for a three-calls-a-press guard, and Sonnet 5 (capable, the writer's own model, through `quiz-mark`'s route with the provider's default reasoning) as the comparison. Borrowing existing routes keeps `src/` untouched. The spend collector has no sink, so no `ai_calls` rows are written, and cost is read from the collector's own records. Estimated cost: ~$0.1–0.2 for Luna and ~$1 for Sonnet over all 128 levels.
- **Reported:** recall per fault kind (paragraph level), false alarms per unlabelled paragraph, the same at output level (since a flag costs a retry of the whole level), unreadable answers, cost per press, and press latency (the maximum of the three parallel calls; median and p90).
- **Then** a recommendation in the plan: build it, build it with a change, or don't.

## Questions

1. Is the labelled set sound enough for recall and false-alarm figures? What would bias them?
2. Is the checker prompt fair: not leaking the answer, and not so lenient or strict that the result is predetermined?
3. Is the model choice and the route-borrowing sound? Does anything there make the measured cost or latency unrepresentative of a built guard? A built guard would use the Messages wire and caching for Sonnet, for example.
4. Is anything missing that Greg would need before deciding? For example, the retry's chance of fixing the fault, or the false alarm rate on other articles: the controls Olah/Gwern runs exist in the same results directory.
