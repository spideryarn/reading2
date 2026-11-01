---
id: q-ns76uq
report: spya-d5e2jk
status: open
asked: 2026-10-29
title: Should Haiku write the citations list? It finds far more, for a seventh of the cost, but describes a little worse.
refs: qi-cypykdrn · qi-mf9r5hjk · q-knkbsk · docs/investigations/261101a-citations-recall-haiku-vs-sonnet-prompt-eval.md · docs/plans/261101a-citations-every-work-cheaply-with-haiku.md · docs/plans/261029b-citations-in-a-comma-separated-list-are-all-read.md · docs/user-feedback/261028_2353-citations-in-a-comma-separated-list.md · docs/investigations/261027a-how-often-citations-are-missed.md
acted: spya-yyvxm0
---
I ran the evals you asked for. You were right: the prompt told the model to stop at 80 works, and Haiku 5.5 at high effort, with a prompt that asks for every work and shows many citation shapes, found more than today's Sonnet on 5 of 7 test papers and the same on the other 2, which were already complete, in every run, for about a seventh of the cost. But its one-line notes on each work are a little worse, and a long list takes 2 to 4 minutes instead of 1. Switch?

A. Yes, switch to Haiku (recommended). Footnoted and numbered papers get most of their works instead of a fraction: the Wikipedia page 22% today, 61% to 99% with Haiku; a superscript-numbered paper 6% today, 99%. Cost per list about 1 to 4 cents instead of 5 to 30. Gives up: the notes. In a blind read of 24 pairs, Sonnet's was preferred 10 times, Haiku's 6, 8 ties, and Haiku had 3 slips to Sonnet's 1. A long list takes 2 to 4 minutes, but it is made in the background on import, not while you watch. High-powered AI would no longer upgrade this step. The list can grow to 300 works, not 80.

B. Keep Sonnet, with the new prompt and the 300 limit. Notes stay as good as today. The Wikipedia page went to 97% in its one run. But Sonnet still stops early on long author-year papers (code's fill covers those), the superscript paper stays at 6%, and the cost stays at 5 to 30 cents.

C. Not now.

I recommend A: finding the works is the thing that is broken, the notes are a little worse but not wrong, and it is cheaper. Neither model is perfect yet on a long footnoted page: Haiku found 99%, 73% and 61% of the Wikipedia page in three runs. After the switch, the next step would be code that makes a row from every footnote, as it already does for author-year citations.

Details

What you reported (28 October, on Butlin and Long's Consciousness in AI paper): "A lot of citations in this paragraph are getting missed somehow ... I think it's going to need an LLM to pick them out. And then that might do a better job with footnotes as well." On 29 October code began reading comma-separated lists, which fixed that paragraph. I then asked whether long papers should get more model calls.

What you replied (29 October): run evals on a few papers, ideally with Haiku 5.5 at medium or higher reasoning, give it many examples of citation formats, find all of them, more cheaply. You suspected the prompt or the model.

What I did. Seven papers: yours, LeCun's, Dropout, Attention, a Scientific Reports paper with superscript numbers, Clark and Chalmers, and Wikipedia's Synesthesia (152 footnotes). A subagent first counted every work each one cites, 667 in all, by reading the text, not from any model's list. Then each model and prompt made a list (high-effort Haiku three times on six papers, twice on LeCun's), and I scored it the way the app would show it, code's own additions included. The whole eval cost $2.95.

What each part did:
- Today's prompt says "at most 80 works, keep the ones it leans on most". Removing that and adding the examples was not enough at medium effort: Haiku and Sonnet both still stopped at about 60 of your paper's 251. At high effort Haiku listed 170 to 260. So it was the prompt and the amount of thinking together. One call had room for every work, though a second call may still be the fix for the runs that stopped early.
- On author-year papers like yours, a reader barely sees the difference: code's own reading already fills in about 96% whatever the model does. The model matters for footnotes and numbered citations, which code cannot read.
- Today's Sonnet nearly fails on the superscript paper: it listed 4, then 14 on a second run, out of 70, only the ones named in a sentence. Haiku found 69 every time.
- No made-up citation turned up when I read the extra rows by hand: they were real works the page lists, such as the Wikipedia page's Further reading. The count for that page is a little rough, because it also names a few works outside its footnotes.
- The highest effort, xhigh, ran out of room on the Wikipedia page and took 7 minutes on yours, so high is the setting.

If you say A, the build is: Haiku pinned for this step, with its name shown truthfully, the new prompt, the limit raised to 300, and one long list checked through the step that writes a note on each cited work. Each piece is measured against this same eval before it goes to dev. Your article's own list is not re-made unless you ask: Find them again on its Metadata page would do it.

Greg's reply, 2026-10-29 (spya-yyvxm0):
"Let's run some evals on a few papers. I'm hoping we can do this with Haiku v5.5, maybe with a medium or higher amount of reasoning. Give it a bunch of examples of what citation formats can look like, and we definitely want it to find all of the citations, but I also feel like it should be able to do this more cheaply. I'm surprised that the model didn't find them all. I feel like that's probably a failure of prompting, or we need to pick a different model."
