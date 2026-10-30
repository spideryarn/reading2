# The push doc hint, judged after three weeks: keep it

Up: [investigations.md](../project/investigations.md). The decision this informs is item 6 of
[261007a](../plans/261007a-docs-sweep-signposts-truth-and-coverage.md#6-the-push-checkpoint-the-cheapest-mechanism);
queue item `qi-hxg5w49c`. Run 2026-10-30. The scripts are in
[261030a-push-doc-hint-judged/](261030a-push-doc-hint-judged/).

## What was asked

[`.claude/hooks/push-doc-hint.sh`](../../.claude/hooks/push-doc-hint.sh) tells an agent, as it
pushes, which docs under `docs/project/` name a file the push changed. Greg agreed to judge it by
how often its list led to a doc edit. If that is rare, the hint is noise: remove it or narrow it. If
it is often, keep it.

## What was measured

Three measures, from three sources. Each one checks a different weakness in the others.

1. **The log.** `push-doc-hint.log` in the shared `.git` directory has 455 lines, from 433 distinct
   HEADs, between 2026-10-07 and 2026-10-29. The hint is long: 380 of the 433 were cut at ten docs,
   and the median line says "and 41 more", so a typical push was told about roughly 51 of the 162
   docs. The commonest reasons are generic file names (`routes.ts`, `types.ts`, `schema.ts`,
   `messages.ts`), a generated file (`feedback-endings.generated.ts`), and docs that merely link to
   a doc the push changed.
2. **Git history** (`analyse.py`, `sharp.py`). A doc the hint showed was edited within six hours,
   by a later commit on the same first-parent line, at 5.2% (209 of 3,995 doc-mentions). For a doc
   it did not show, the rate was 2.4–2.5%. Within 24 hours, 35 of 433 hints (8.1%) were followed by
   an edit to a line that names the very file the hint gave. History cannot say *why* a doc was
   edited.
3. **The agents' own transcripts** (`episodes.py`, `baseline.py`, `ctx.py`), which can. The hint was
   shown 451 times, in 364 push episodes (a run of pushes less than ten minutes apart counts once).
   In 94 of them the agent said something about it. In 45, it edited a `docs/project/` doc within
   the next 40 tool calls. Reading each one by hand ([classify.txt](261030a-push-doc-hint-judged/classify.txt)),
   **32 were post-push doc fixes**: the agent pushed, checked the docs, found a sentence its change
   had made false or incomplete, and fixed it. The other 13 were planned work or the repair of a
   merge clash. Some of the 32:
   - *"One doc the hint names is now incomplete: `ai-gateway.md` says Dig deeper is the only
     per-reader allowance."*
   - *"(arXiv today)" is now stale; fixing it.* (architecture.md)
   - *"That bullet in `content-extraction.md` is now false, so I'm correcting it."*

**The baseline.** The same detector, run over every push in the transcripts (they reach back to
2026-09-09), with no hand reading:

| push episodes | followed by a `docs/project/` edit |
|---|---|
| before the hook | 21 / 541 = 3.9% |
| after the hook, hint shown | 48 / 364 = 13.2% |
| after the hook, no hint (nothing matched) | 4 / 80 = 5.0% |

## What was decided

**Keep it, unchanged.** About one hinted push in eleven (32 of 364, 8.8%) ended with a stale
sentence fixed, on the agent's own account, straight after the push. Before the hook, any kind of
post-push doc edit happened after about one push in twenty-five. That is roughly 32 false or
incomplete sentences fixed in three weeks, for one line of context and about half a second per
push.

**Narrowing was ruled out.** Only 15 of the 32 fixes were to a doc in the hint's first ten. In the
rest, the agent found the stale sentence with its own grep. So the hint works as a prompt to look,
at the moment that matters, more than as an accurate list. A narrower list, for example one that
ignores `routes.ts` and doc-to-doc links, would read better, but nothing here says it would lead to
more fixes. It could even prompt fewer pushes. Several agents called the list "generic" and checked
anyway.

## How far to trust it

The data is observational, so the 9–10-point gap is not a clean causal estimate. The work done in
the two periods differs. The "no hint" pushes were chosen by the hook itself, so they are smaller
and touch fewer files. The transcripts cover Claude Code sessions only. Against that, three measures
point the same way: the gap in history, the gap in transcripts, and the agents' own words in the 32
cases. The decision only needs "often enough to be worth one line", and it clears that.

GPT Sol checked the numbers. It reproduced them and found two bugs. The baseline looked for the hint
only in the first few entries after a push, but 58 of 451 hints arrived later. The edit detector
also counted a `docs/project/../../CLAUDE.md` path. Both are fixed in the scripts here, and the
figures above are the corrected ones. Sol also spot-checked twelve of the hand classifications and
agreed with all of them. Its verdict was keep.
