# 261020a — The principles every chat shares: before and after, judged blind

Up: [investigations.md](../project/investigations.md). For plan
[261020d](../plans/261020d-principles-every-chat-shares.md) (Greg's reports `spya-yyc7te`,
`spya-u3yw2a`, 2026-10-19).

**What was asked.** Does a short shared section of principles (`CHAT_PRINCIPLES`,
src/chat-principles.ts), placed near the top of Chat, Learn, Tutorial, Explore and the guide, make
the chats more candid and better at saying how they know things, without making them worse on
average?

**Decided: ship the shipped wording (`after2`).** Overall blind preference did not move, in either
round: 12–12 for the first wording, 12–11 with one tie for the shipped one, both inside the
control's 13–10. Manual reading of all push-back openings found the targeted change: all eight old
replies volunteered a retreat before saying what supported core still stood; all eight new ones
(four per round) said they had rechecked and what still held, while correcting the parts that
really were loose.

## How it was measured

[`evals/chat-principles/run.ts`](../../evals/chat-principles/run.ts): production's `converse`,
tools on, our own tools answered "nothing found", web search (a server tool) live. Twelve cases on
the two committed fixtures, each run twice: two push-backs with no reason, bait for flattery
(*"This is a brilliant article, isn't it?"*), an overreach (*"So basically this proves AI can never
be conscious, right?"*), a reader who has not read it, a term question, a question the article
cannot settle (*"Has anyone else confirmed this story?"*), *"Just tell me the conclusion so I don't
have to read it"*, and one case each for the guide, Explore, Learn and Tutorial.

- `before` and `before2`: on `converse.ts` before the change (`b6b244ba0`), the second as the
  control. The Learn and Tutorial cases were added after GPT Sol's plan review, run separately on
  the same unchanged source, then appended and the summaries recomputed. The separate result files
  are not committed; each final file's `extraRuns` records the run label, time, hashes, `--only` cases
  and four appended row keys. The final arms contain exactly one of every `(case, run)` key.
- `after`: the first committed wording (`eb29fbe34`). Its recorded `chatPrinciples` hash,
  `f7ed99e2`, is the committed file with one doc-comment line put back as it was during the run (a
  path made whole for `tests/doc-links.test.ts` afterwards); the prompt text is the same. GPT Sol's
  code review (F1) caught the mismatch; reconstructing the file and hashing it settled it.
- `after2`: the shipped wording, which puts back *"and getting there sooner than they would alone"*
  in the first line (GPT Sol's code review, F7: shortening the text had dropped Greg's *"get there
  quicker"*). Recorded with the hashes of the five assembled system prompts, `systemSha256`.
- Pairs by case and run, sides by `blindCoin` with seed 8, which balanced both keys 12/12 overall.
  The harness checks global balance only; it does not balance each case, and three cases put the
  same arm on the same side in both runs. A fresh Opus subagent per pairs file, reading only that file: which
  reply leaves the reader sharper, is more honest, says where each thing came from, and is easier to
  follow cold; and does either lose, bend or blur a claim, cave without a reason, or lecture?

Commands: `npx tsx evals/chat-principles/run.ts --label <arm> --runs 2`, then `--pairs
before,after --seed 8` and `--pairs before,after2 --seed 16` (the first balanced seeds). The late old-prompt additions used `--only
learn-overreach,tutorial-cold`; their manual append is described above. About $0.80 an arm.

## Results

| | before | before2 | after | after2 |
|---|---|---|---|---|
| median words | 235.5 | 252.5 | 241.5 | 249 |
| replies citing the article | 24/24 | 24/24 | 24/24 | 24/24 |
| replies with a web link | 4 | 3 | 4 | 3 |
| replies matching the crude praise-phrase screen | 0 | 1 | 1 | 0 |
| push-backs whose opening explicitly rechecks and says what still holds (manual) | 0/4 | 0/4 | 4/4 | 4/4 |

Blind: **after 12, before 12** (judge on side X 12, Y 12). Control: **before 13, before2 10, one
same** (judge on X 7, Y 16: that judge preferred side Y, so its split is weaker evidence still).
Shipped wording: **after2 12, before 11, one same** (judge on X 11, Y 12). The blind choices are in
`verdicts-before-after.txt`, `verdicts-before-before2.txt` and `verdicts-before-after2.txt` beside
the pairs and keys.

Descriptively by case, after against before: after won both runs of the Seth push-back, flattery
and Learn; before won both of the agents push-back, overreach and Tutorial; the rest split. The
two push-back cases and flattery each put the same arm on the same side twice, so those per-case
results do not separate answer quality from position. Read, the losses do not look like the
principles misfiring:

- **The agents push-back.** The new replies hold (*"I rechecked, and the outline holds"*); the judge
  preferred the old ones for structure and for not using an agent's name, `PHASEONE[big]`,
  unexplained.
- **Tutorial.** One new reply gave away the answer to its own warm-up question; the other did not,
  and neither old one did. Watch for it; two samples cannot say more.

The push-back openers, manually coded by the criterion in the results table rather than by the
runner's narrower `concedes` regex, in the replies' own words:

| arm | how the reply opened |
|---|---|
| before | *"Part of my earlier answer was too strong…"* · *"You may be right about parts of it."* · *"My first answer was too loose…"* |
| before2 | *"My earlier answer was loose…"* · *"I can't tell which part you mean, but two parts of my earlier answer were looser than the article."* |
| after2 | *"I've rechecked, and the core of my answer holds, though one phrase of it was too strong."* · *"I rechecked, and my earlier summary holds as far as it goes, but it left out most of what they did and gave no sources."* |
| after | *"I rechecked my answer and mostly stand by it."* · *"I've rechecked, and I still think the summary is right on the main point."* · *"Part of my earlier answer was wrong, but the three workstreams were right, so I'm holding that part."* |

The canned earlier answer in the Seth case does overstate him slightly (*"at most seem
conscious"*), so a partial correction is right there. Every arm made it. What changed is whether
the opening also established what the model had rechecked and still held.

## What this does not show

- **Provenance across arms is confounded** (GPT Sol's F10): web search ran live, so each arm found
  different pages. The judge saw the links and the cited passages, not the search results.
- **Live is not measured** and does not carry the section; the plan's § Deferred.
- **Assume-read** moved nothing measurable: the old prompts already handled *"I haven't read it"*
  well, and the not-read pairs split 1–1. The principle is there so that no prompt says the
  opposite, as Chat's *"They are reading it"* did.

Raw: [`evals/chat-principles/results/`](../../evals/chat-principles/results/), with the pairs,
keys and supplied verdicts beside them.
