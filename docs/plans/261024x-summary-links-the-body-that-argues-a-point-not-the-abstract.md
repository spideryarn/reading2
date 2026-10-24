# Summary links the body that argues a point, not the abstract

Report `spya-hnw9xq` (#698, admin, suggestion, 2026-10-24), on
`arxiv-2308-08708-spya-xax6v4` (*Consciousness in Artificial Intelligence*), Summary › Fuller.

> Make a minimal update to the way the summary that we generate links to the main text. In this
> example, which you can look at in the production database, the summary that we generated seems
> to mostly link to the executive summary in the main text. Now, firstly, actually, I think
> probably the executive summary in the abstract should be default folded, and I think we now have
> mechanisms, if we were to rerun this import, that would notice them and default fold them,
> because we have our own summary and structure modes that do a lot of this kind of work that we'd
> rather use. But the key point I'm trying to make is that the summary linking to the executive
> summary is less useful than linking to the main part of the text that really lays out the
> argument being linked to in detail. That's more useful.
>
> — Greg, 2026-10-24 (`spya-hnw9xq`)

Owner docs: [summaries.md](../project/summaries.md) § A summary is a door,
[front-and-back-matter.md](../project/front-and-back-matter.md).

## What production shows (read-only, 2026-10-24)

The article's current revision, 667 blocks. Its opening: title and authors (0–1), *Abstract* (2–3),
authors (4–23), acknowledgements and funding (24–38), **Executive Summary (39–53)**, contents
(54–101); the report itself starts at 102 and the bibliography at 415. `matter` is `null`: it was
imported before the step existed, so nothing but the old byline rule folds anything.

The stored summary is `simple-prompt/12`. Where its paragraph links land:

| level | links into the abstract or executive summary (blocks 0–53) |
|---|---|
| Brief, 2 paragraphs | **4 of 4** — the abstract (3), the executive summary's opening (40) and its last paragraph (53) |
| Fuller, 9 paragraphs | **9 of 22**; 5 of 9 paragraphs lead with one |

So the report is right, and Brief is worse than the Fuller he was reading.

## Why it happens

The prompt asks for *"the one to three blocks of the article above that best support"* each
paragraph (`src/simple-summary.ts` § WHERE EACH PARAGRAPH COMES FROM). A summary's paragraph is a
compressed claim, and the passages most like a compressed claim are the article's own compressed
claims: its abstract and executive summary. "Best support" read literally rewards the closest
paraphrase, not the passage worth going to. Nothing says the link is for a reader who wants the
detail — which is the whole reason the links exist ([§ A summary is a door](../project/summaries.md#a-summary-is-a-door)).

## What to build

**One rule in the prompt, under WHERE EACH PARAGRAPH COMES FROM, for both levels**: the link is
where the reader goes for more. Every passage chosen must support the paragraph; among those that
do, prefer where the body lays the point out over the piece's abstract or an executive summary at
its start. Never pick a merely related passage to avoid them, and use them for a claim the body
does not make. (Narrowed after the plan review, below.)

The sentence links need nothing of their own: a sentence may only name one of its paragraph's ids.

`SIMPLE_PROMPT_VERSION` → `simple-prompt/13`. As with `/8`–`/12`, every stored summary becomes
*outdated*, which is silent, and none is rewritten; the input fingerprint does not move, so nothing
goes stale. Greg's article keeps its links until its Summary is rerun from Metadata — his press, not
ours (no production writes from this run).

**Passed over: a deterministic filter.** Drop the abstract (from `matter`) from the ids the model
may cite. It cannot cover the executive summary, which `matter` deliberately never marks (below);
it would also remove the abstract for the one paragraph where it really is the only source; and
`matter` is a successor job that may not exist yet when Summary is written. A prompt rule is the
minimal change Greg asked for, and the measurement below says whether it is enough.

**Also passed over: changing the fidelity guard.** It checks each paragraph against what it cites;
a body passage that says the point in detail should pass as well as the abstract does. The
measurement watches its flag rate in case it does not.

## Measuring it

[prompting-guide.md § Measuring a prompt change](../project/prompting-guide.md#measuring-a-prompt-change),
with production's own function through `evals/simple/probe.ts`, no profile (`none`), high power,
guard on, as a press does.

- **Articles**: the reported one's local copy (`arxiv-2308-08708-spya-w598t3`), Llama 2
  (`arxiv-2307-09288v2-spya-smdqsk`), *Generative AI at Work* (`nber-w31161-spya-dkgc83`), Dropout
  (`jmlr-v15-srivastava14a-spya-sd3uzs`), and one essay with no abstract as a control for harm
  (`greatwork-spya-yw4d3t`).
- **Arms, separated in time**: `link0a` and `link0b` on the commit before the change (the second is
  the control), `link1a` and `link1b` on the commit with it. 20 presses, about $3–5.
- **Primary, mechanical and free**: the share of paragraph ids, and separately of sentence ids,
  that land in each paper's front summary, marked by hand: the reported article 2–3 and 39–53,
  Llama 2 71–72, *Generative AI at Work* 5–6, Dropout 3–4. The change ships if it lowers that share
  well beyond the gap between `link0a` and `link0b`, on Brief and on Fuller.
- **Must not get worse**: the fidelity guard's flags and retries, write failures, word counts, and
  paragraphs dropped for having no valid id.
- **A blind judge**, a fresh subagent reading only a pairs file, Fuller only: each pair is one
  article's two summaries with every sentence's linked passage beside it, sides from `blindCoin`,
  the key apart and checked for balance. Old against new (the test), old against old (the
  control). Two questions per pair: whose links more often take a reader to where the piece lays
  that point out in detail; and did either summary lose, bend or blur a claim, or link a passage
  that does not support its sentence?
- **Read the outputs**, the essay's especially.

Written up as an investigation under `docs/investigations/`, linked from here.

## GPT Sol's plan review, and what changed

[The review](261024x-summary-links-the-body-that-argues-a-point-not-the-abstract-plan-review-sol.md)
([prompt](261024x-summary-links-the-body-that-argues-a-point-not-the-abstract-plan-review-prompt.md)):
the diagnosis, the `/13` handling and asking about the fold are sound; five changes, all taken.

1. **Narrower rule**: only an abstract or an executive summary at the front. Previews, key-points
   boxes and closing recaps are not measured by this corpus, and a closing summary is body content
   (`src/paperwork.ts`). Deferred, not built.
2. **Support first.** The guard reads only the cited passages and passes what they do not mention
   (`src/simple-check.ts`), so it cannot catch a body link that is merely nearby. The rule is
   ordered: every passage must support the paragraph; among those that do, prefer the body; never
   pick a merely related passage to avoid the front summary; use the front summary for a claim
   made nowhere else.
3. **Raw id share is a screen**, since a paragraph can dilute it by adding body ids. Also counted:
   paragraphs with any front-summary id, paragraphs whose *first* chip is one, sentences linked to
   one over all sentences, and the share of sentences with any link at all.
4. **Gates written before the after arms ran** (below), and the judge reads Brief too.
5. Bookkeeping named: the `/13` history comment, the version pins in `tests/simple-summary.test.ts`
   and `tests/simple-two-levels.test.ts` (version and both hashes), summaries.md § A summary is a
   door. No change to `SIMPLE_VERSION`, the check version or the fingerprint.

### The gates (written 2026-10-24, after `link0a`/`link0b`, before any `after` arm)

Summed over the four papers, both `after` arms against both `before` arms, each level separately:

- **G1 destination**: paragraphs with any front-summary id fall by at least half, on Brief and on
  Fuller, and by more than the gap between `link0a` and `link0b`.
- **G2 first chip**: paragraphs whose first chip is in the front summary fall, on both levels.
- **G3 coverage**: sentences with a link fall by no more than 10 percentage points.
- **G4 no harm**: no write fails; no paragraph dropped for want of an id; guard flags and retries
  at most one more in total than `before`; the essay's word counts and guard verdicts unchanged in
  kind.
- **G5 judge**: in decided test pairs, the new links win at least two in three while the control
  stays within 3–1 either way; and the new arms are named for unsupported or merely related links,
  and for losing or bending a claim, no more often than the old ones.

The baseline, `link0a` · `link0b`: Brief ¶ ids in the front summary 9/17 · 9/20, Fuller 14/100 ·
12/100; on the reported article, Fuller sentences 20/33 · 19/32.

## The fold half: Greg's claim, checked

Today's `matter` step, run three times on the local copy of the same article (scratch script, one
Haiku call each, nothing stored), gave the same answer every time: **the abstract folds, the
executive summary does not.** It also folds the title and authors, the authors list, the
acknowledgements and funding, the contents and the bibliography.

So the claim is half right. A re-import (or anything that re-runs `matter`) would fold the
abstract. It would not fold the executive summary, and that is not a miss: plan
[261018a](261018a-front-and-back-matter-marked-at-import-and-folded-by-default.md) § Decided here,
for Greg to overturn, says *"Appendices, glossaries, notes and executive summaries are not folded"*,
and front-and-back-matter.md lists an executive summary under *Not matter, and never folded*. The
reason was GPT Sol's (in `src/paperwork.ts`): an executive summary may make claims the body never
returns to. This report reads like Greg overturning it, but with a "probably", and it reverses a
recorded decision and needs the matter eval re-run on three sets — so it goes to him as a question
(`docs/user-feedback/questions/`), with a recommendation, and is not built here.

## Stages

1. This plan, GPT Sol's plan review, the `before` arms.
2. The prompt rule, `/13`, tests; the `after` arms; the judge; the investigation.
3. GPT Sol's code review; docs (summaries.md); the question; the note; push to `dev`.
