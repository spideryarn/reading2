---
id: q-vg2b69
report: spya-w95xmq
status: answered
asked: 2026-10-25
acted: spya-c03jnn
title: What should Sources show first, and should six sub-modes become three?
refs: docs/plans/261025c-sources-proposals-what-it-shows-first-and-fewer-sub-modes.md · docs/investigations/261025a-sources-trial-situate-reception-cited-by-on-six-articles.md · docs/user-feedback/261023_2305-sources-situate-the-piece-in-the-literature.md · docs/project/sources.md · qi-mbh8appj · docs/plans/261025h-sources-becomes-three-chips-a-cost-ladder-and-experiments.md · docs/investigations/261025h-situate-eval-haiku-sonnet-opus.md
---
I tried Search the literature on six real articles. On five of them it found what a careful reader in the field would point to (on the blog post it was thinner), for about $0.33 and 45 seconds an article; Reception, Cited by and Not cited mostly did not. So in every option, Sources goes from six chips to three: Where it sits, Bibliography, Links. Reception, Claims, Not cited and Investigate move inside the first one, folded, with nothing lost.

1. What should Where it sits show when you open it?
A. The Search the literature findings, made by themselves the first time you open Sources on an article. About $0.33 each time, on every article you open Sources on; sends the article to the AI without a press; at most four an hour.
B. Two short free lists first: the papers that came after it (filtered to those about its subject, for a well-cited paper) and the works it leans on most, with a Search the literature button. After you have pressed it once, the findings come first on every later visit (recommended). Nothing new is sent until you press.
C. Two chips, After and Before, each a list of papers, with the findings added to them as marks (disputes, builds on, mentions). Costs a little more per press, and a finding is no longer beside the sentence it is about.

2. Two rules that decide what the lists show:
A. Treat one paper held twice in the citation database as one, and take its citers together; and list translations and reprints of the piece under "Other editions of this piece" instead of as papers it did not cite (recommended).
B. The same, but hide translations and reprints entirely.
C. Leave both as they are: a paper held twice shows no citers, and its own translations stay in the not-cited list.

Details

What this is for. Over 22 reports since 11 September you have asked Sources for the same five things: who cited the piece and whether they agreed; whether its citations hold up; something beyond paraphrasing the article; the key themes and landmark papers; and fewer sub-modes. You answered on 25 October that before or after "depends on whether this is an old or a new article", and asked for proposals on what to show first.

What I tried, what came back, and what each option means in use, with sketches, are in the plan and the investigation (refs). In short: on five of six articles Search the literature found what a careful reader in the field would point to; Reception, Cited by and Not cited mostly did not. A spends money and sends the article out on every open; B opens on free lists and spends only on a press; C organises everything by paper, which loses the findings that are not a citing paper. Question 2 changes two rules chosen on purpose: a paper held twice refuses to show citers, and the piece's own translations count as works it did not cite.

(The question as first published was longer; it was shortened here, after the answer, to fit the published body.)

Greg's reply, 2026-10-25 (spya-c03jnn):

"1 It's hard for me to really make these judgments, so I'd be tempted to say just build a bunch of new submodes that exhibit different behaviors and interfaces, and I'll play with them and then have a sense of what's better and be able to give really concrete feedback. / 2 Yeah, use your judgment. I mean, it makes sense to avoid duplicates, unless they're somehow meaningfully distinct, or it makes sense to keep them as such.."

And his answer the same day, given with the job:

> I'm not totally sure what's best or that I fully understand the proposal. Here's what I'd suggest: if there's something we can do for free, great, let's do that proactively. If there's something that's going to cost money, only do that when we open the sources mode. If it's going to cost a lot of money, like per citation or something, then maybe we only do that when the user requests something for that citation rather than proactively.
>
> I mean ideally a mode would only cost a few cents. Given this is an important mode, you know, if it costs $0.30, okay, but then that should be upon user request. Do an eval to see if we can get away with using Haiku more heavily, with maybe Opus for anything that we think requires intelligence. And you know, yeah, be proactive if you think things can be unified into one submode. Great, let's do that.
>
> I think take screenshots, ask sub agents to take on the personas of UI/UX experts or product managers or researchers or naive users to look for things that might be confusing or where we can improve them, if you think that's worth doing. And if in doubt, I think it's cheap to create new experimental submodes that I can play around with, that each showcase left field ideas, some of which might have the seed of something really good. So I'd encourage that proceed autonomously, and I'd rather play than discuss.

Built as 1B and 2A (plan 261025h): three chips, Where it sits, Bibliography and Links, with Reception, Claims, Not cited and Investigate as tools inside the first. Where it sits opens on free lists. Search the literature has left the experimental switch, starts when you press to open Where it sits (plan 261026g, from your 26 October report; never on a link, reload or Back), and reads through a Haiku shortlist: about $0.30 with Sonnet, $0.52 under high-powered AI (eval 261025h). A paper held twice is joined; the piece's own editions and its authors' other works are listed apart from Not cited. Two experiments, Guess first and Evidence first, sit behind the experimental switch.

