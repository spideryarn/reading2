# Four smaller prompt and effort measurements: chat web reach, FAQ order, Remember brevity, Referee claims effort

Written 2026-10-02 from four plans of 2026-09-13 to 2026-09-30, none with a research write-up. Each is
a short section; the plan holds the full tables.
Plans: [260913b](../plans/260913b-chat-and-comment-questions-reach-for-the-web-and-the-citations-list.md),
[260929g](../plans/260929g-faq-difficulty-centrality-and-a-threshold.md),
[260930g](../plans/260930g-briefer-chat-and-explain-answers.md),
[260928c](../plans/260928c-referee-claims-fail-on-long-pieces.md).
All used `claude-sonnet-5` through the gateway.

## 1. Chat: does a question about a passage reach for the web? (2026-09-13)

**Question.** Greg wanted chat answers to the gutter "?" and to wider-context questions to search the
web and say which half of an answer came from the article. Would a prompt change do it without making
every question search?

**Measured.** `evals/chat-web-reach.ts`, two local articles, three runs per cell, controls that must
not search. Thresholds were fixed before the after-run. Results: `evals/results/chat-web-reach-*.json`.

| web searches out of 3 | before (Seth / Gwern) | after | threshold |
|---|---|---|---|
| "wider debate?" | 0 / 0 | 2 / 3 | at least 2: pass |
| bare "?" press | 0 / 0 | 0 / 1 | at least 2: **fail** |
| controls (paragraph meaning, word use) | 0 / 0 | 0 / 0 | at most 1: pass |

A hand read of the 30 after-answers found only 2 of the 12 that searched fully passing: the rest stated at
least one outside fact unlinked. Answers that marked something as not from the article, per three runs
of 6 answers: "?" 0, then 3, then 6 after a one-line reminder in the final message; "since" 0, 0, then 4.
No invented block id in ninety answers.

**Decision.** Keep the "?" miss as measured: the threshold was wrong, not the prompt, because the "?" is
anchored to the same passage as the plain control and a trigger separating them would pull the control
in (arbitrated by Fable, read-only; Fable is retired since 2026-09-28). Add a fifth origin, background
knowledge, marked in the sentence, and a chat-only provenance reminder beside the question. This
partly overruled Sol's F3 (no unlinked factual memory at all). Lives in `docs/project/chat-tools.md`.

**Dead ends.** A worked example in `SYSTEM`; a structured "From the article / Beyond" format; a post-hoc
check. **Caveat:** the default search engine returns no `url_citation` annotations (measured 2026-09-01),
so the "From the web" list is often empty and the links in the prose carry the web half.

## 2. FAQ: prioritised order against reading order (2026-09-29)

**Question.** Greg: the FAQ opened with dense, low-level questions; could each question carry
difficulty and centrality scores, as the Glossary does, so the default list shows the high-level ones first?

**Measured.** `evals/faq-levels/run.ts`, six articles, four
arms (`faq/3` twice, `faq/4` twice), 24 calls, about $2.30. A fresh Opus judge read blind pairs of the first
five questions. Results: `evals/results/faq-levels/` (`judge.txt`, keys, pairs).

| comparison | wins | ties |
|---|---|---|
| old prompt vs itself (control) | 3-2 | 1 |
| prompt wording, old vs new (two draws) | 1-2 and 1-2 | 3 and 3 |
| rule: reading order vs prioritised (two draws) | 1-3 and 0-4 | 2 and 2 |

Prioritised beat reading order 7-1 over two draws; the prompt's wording alone was inside the control's
spread. Default bar: 0.20, calibrated on three articles and checked on three (89% and 91% of questions
shown, against a predeclared 80% average floor).

**Decision.** Keep the sort, with `priority = centrality x (1 - difficulty)`. A Sol review confirmed the
bar changed none of the twelve judged openings. Lives in `docs/project/faq.md`.

**Caveats.** Two `faq/4` runs write different questions (1.7 of 3 top-three overlap on average).
Greg's own article is on production only and was not in the set.

## 3. Remember: did a "briefer" line shorten replies? (2026-09-30)

**Question.** Greg asked for chat and Explain answers a little briefer. Remember's replies were in
scope too.

**Measured.** `evals/remember-stances.ts`, eight readers by four stances, 32 replies per arm;
before-1 and before-2, then after. Results: `evals/results/remember-stances.260930g-*.md`. Words per
reply: **209 and 225 before, 210 after.** (Chat and Explain, in the same plan: Explain 280/268 to 233,
chat 357/373 to 262; those are for the plain-words plan, not this write-up.)

**Decision.** Reverted: a prompt line that measurably does nothing is noise and a cache write for
nothing. Replies already average about 210 words, below where chat now lands. Several still exceeded
three paragraphs, so the wording was not followed as a cap.
**Caveat:** the after run was skimmed for counts rather than read in full.

## 4. Referee claims: what effort stops the long-piece failures? (2026-09-28)

**Question.** Referee claims failed on long pieces with `[ai-no-room]` and `[ai-overflowed-fixed]`.
What request makes Sonnet 5 reliably finish?

**Measured.** One call per row on `noema-mythology-of-conscious-ai` (8,290 words), through
`openRouterStream` directly. Per-run lines: `evals/results/referee-claims-long-pieces-260928.jsonl`.

| request | thinking tokens | result | time | cost |
|---|---|---|---|---|
| 12,000, no `reasoning` (as in production) | 12,000 | nothing, finish `length` | 127 s | $0.12 |
| 24,000, `effort: "high"` | 13,212 | parses | 160 s | $0.19 |
| 24,000, `effort: "medium"` | 0 | 15 claims, 0 dropped | 53 s | $0.11 |
| 12,000, `effort: "low"` | 0 | 12 claims, 1 passage unquoted | 47 s | $0.10 |

At `high` the 160 s run was close to the 180 s timeout, a second failure waiting behind the first.
Siblings (criteria, literature) were measured by an Opus subagent in the plan's § Siblings.

**Decision.** `reasoning: { effort: "medium" }` on claims, with a thinking reservation (not zero,
since thinking varied 2.4x on identical input on a 152,077-word PDF), plus a deadline that fits the
largest answer and a shared effort table (`CHAT_REASONING` / `effortOf` in `src/ai-call.ts`). Lives in the plan's "What landed" section.

**Dead end.** Raising `max_tokens` alone (48,000: worked once at 113 s, but thinking stays unbounded).
**Caveat:** one run per effort; the plan says "measured once per effort". `medium` spending zero
thinking tokens here is new, and not explained.

## Not covered here

`evals/results/referee-claims.md` and `referee-mirror.md` are Claims and Mirror output on five synthetic
papers, read by hand against a rule (the model asserts linkage, never adequacy); they check a prompt
rule rather than choose a model, effort or design.

Up: [research.md](../project/research.md)
