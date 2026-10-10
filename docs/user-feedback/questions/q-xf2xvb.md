---
id: q-xf2xvb
report: spya-c2qmbg
status: answered
asked: 2026-10-03
title: Peer review is built. Keep that name, now that it clashes with Referee mode?
acted: spya-vcvxu5, spya-egmn6r
refs: SPIDERYARN-READING2-BV · qi-m9tmnpy3 · docs/plans/261009w-peer-review-becomes-sources-all-the-way-down.md · qi-vmnga65v · qi-m9sk699v · qi-j8py7rjw · docs/plans/261009l-peer-review-mode-merges-citations-and-debate.md · docs/plans/261004b-citation-hover-card-offers-dig-deeper.md § Part 2 · docs/user-feedback/261003_1947-citation-card-dig-deeper-and-citations-in-debate.md
---
Done as you said: one mode, Peer review, out of the Experimental switch, with Bibliography (the old Citations), Reception and Claims, plus the works cited under each claim (C1). It is on dev, waiting for the next deploy. One thing you could not have known when you picked the name: should it stay "Peer review"?

The clash. Referee mode, the mode for someone who is doing a peer review, already uses that phrase. Its landing-page tile says "For peer reviewers", and typing "peer review" in the command bar used to open it. Referee also has a sub-mode called Claims. Referee is behind the Experimental switch, so most readers will only ever see Peer review. You, and anyone with the switch on, see both buttons side by side.

A. Keep "Peer review" (as built). Referee keeps "peer reviewer" and "referee report"; "peer review" now finds the new mode. Costs nothing more now. Gives up: two buttons that sound like the same job, for anyone with the switch on.

B. Rename it now, to a word with no clash, e.g. "Context" (the conversation this piece is part of) or "Sources". It is one word on screen today, so it is cheap if done before the deeper rename below.

C. Keep "Peer review" and rename Referee instead, e.g. "Reviewing". Gives up a name that has stood since 1 September and matches what journals call the person.

Recommended: A, unless the two side by side bother you; then B with "Context".

Details

Why ask now. Your rule is that a rename goes all the way down, to the stored names as well as the screen. I renamed what you see and the mode's own address (?mode=peer-review; old Citations and Debate links still land in the right place). I held the deeper half: the names under it, about 4,000 places in the code and three database columns, still say citations and debate. Doing that twice, if the name then changed, would be the expensive way round. Once you answer, it is queued (one to two days), and it renames those to the chosen name.

What you will see. One Peer review button where Citations and Debate were. It opens on Bibliography, the list of works the piece cites. The chips across the top read Bibliography, Reception, Claims, each with its count. The button's card is your framing: "What this piece cites, and what others say about it"; each chip's card starts with its half of that. Under each claim in Claims, a line "Cited in this paragraph: Smith et al. 2019 · Lee 2021" names the works cited in that claim's paragraph; pressing one opens its row in Bibliography. It says only that they share a paragraph, never that a work supports the claim, and it costs no AI call.

What it costs to run. Out of the switch, Bibliography is now made when an article is added (one AI call), for anyone who has "generate the main modes" on. Reception's web search and the Claims list are never made in the background; they wait for a press, as before.

Is it a good idea? You asked. Yes, in my view and in a separate opinion from Opus: both halves answer one question, where this piece sits among other people's work, and one button for that takes nothing away. It took under a day of agent time. A GPT model reviewed the plan and then the code, separately.

Your reply of 9 Oct, which this answers:

"Do you think this is a good idea? I mean, your suggestions for question one are actually pretty good, and I'm inclined to go with B and then C1 to begin with. But I can't tell how much complexity there will be, or if you think this is actually a good UI decision. If you do, then let's go forward with it.

For question two, I guess let's move this out of experimental, this combined mode. I am hesitating what to call it. Debate doesn't feel quite right. Maybe peer review, because that, I think, incorporates the idea that it's both internal and external to the article, i.e. what they cite and also what other people say about them. And indeed that framing, what this article cites and what other people say about it, this article might be a good sort of TLDR somehow for the different submodes.

Let's call the sub-mode for citations listed in this article (i.e. the former Citations mode) "Bibliography", and this should be the first submode in this new peer review mode."

The question it answered, asked 3 Oct: should Citations become part of Debate? Options were A (two modes linked by buttons), B (one mode with three parts), C1 (list the works cited in each claim's paragraph, no AI call) and C2 (an AI files each cited work under a Debate theme). You chose B then C1. C2 is not built.

## Greg's answer, 2026-10-09 19:36 UTC (in the Feedback dialog, reply `spya-egmn6r`)

> B Sources.
>
> Rename comprehensively, eg including docs, code, database etc

Acted on 2026-10-09 by the feedback sweep: queued as qi-m9tmnpy3 (which replaces qi-j8py7rjw) and dispatched as session fbc2qmbg-rename-to-sources. It renames Peer review to Sources all the way down, together with the stored names that still say citations and debate. Old links keep working.

Done 2026-10-10, on dev (plan docs/plans/261009w-peer-review-becomes-sources-all-the-way-down.md): the mode is Sources on screen and underneath. Its address is ?mode=sources, and its three parts' stored names are bibliography, reception and sources-claims. Old Peer review, Citations and Debate links still open the right view. Typing "peer review" in the command bar now finds Sources first and Referee second; Referee's own word is "for peer reviewers". The database change comes in two halves so that no reader sees an error while a deploy is under way. The first half adds the new names beside the old ones; the Overseer is holding that deploy for your OK on one small risk. The second half removes the old names after that deploy and is queued for the Overseer.
