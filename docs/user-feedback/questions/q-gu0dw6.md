---
id: q-gu0dw6
report: spya-xyje0z
status: open
asked: 2026-10-27
title: Several Skim briefs: where should the picker go, and does a new brief replace "why you're reading"?
refs: docs/plans/261027d-several-skim-briefs-per-article-and-a-picker-between-them.md · docs/plans/261027d-several-skim-briefs-plan-review-sol.md · docs/user-feedback/261027_1204-several-skim-briefs-per-article.md
---
You asked for several Skim briefs per article, a default plus ones you add, and a way to switch between them. Two choices are yours.

1. Where does the switcher go?
A (recommended). The "Reading for: ..." line above the route becomes the switcher: "Route for: understand the method ▾". Pressing it opens a short list: the default (with Edit, as today), each brief you added (with a bin), and "New brief...", which opens the familiar "What are you skimming for?" box. Small, and it sits where Skim already says what the route is for. Costs: a press to see the list.
B. Like Chat's list. A "‹ Briefs" button in the band's head opens a full list, one row per brief, with + to add one. Closest to Chat, but the list takes over the whole band and it is a press each way.
C. A row of chips above Gist · More · Most: "Default · Methods · vs Smith 2019 · +". Switching is one press and everything is visible, but it adds a second row of chips beside the depth chips, and long briefs get cut short, worst on a phone.

2. When you add a brief, what is its route planned for?
A (recommended). Your profile plus the new brief, in place of the article's "why you're reading" sentence. Each brief stands on its own, so it gives a really different route.
B. Your profile, the article's "why you're reading" sentence, and the new brief together. Added briefs lean back towards the default.

I am building 2A now, and everything that does not depend on question 1. It changes with one line if you pick 2B. Reply e.g. "1A 2A".

Details

What you asked, on 2026-10-27 while in Skim: "Could we allow for multiple Skim briefs, i.e. a default one (perhaps based on user profile + why you're reading), with the option to add one or more new briefs, and then select between them (kinda like how you can choose between Chat threads)."

What exists today. Skim has one route per article. It is planned for your reader profile plus the article's "why you're reading" sentence, the one Metadata and the add page also show. In Skim that sentence appears as "Reading for: ..." with Edit. Editing it re-plans the route. That sentence is shared: changing it also changes what every other mode was written for.

What I am building. The default brief is exactly today's route, untouched. Visitors to a shared article still see only that one. Each brief you add is a separate sentence with its own route. It is stored on the article and is yours only: it is in your export, and it is deleted if the article ever changes hands. Planning a brief's route goes through the same queue as the default, so Quotes and Ideas are refreshed first if they need it, and pressing twice does not pay twice. A brief can be edited (which re-plans it) or deleted. Skim remembers which brief you were on, and where in its route. In the address bar it shows as ?brief=.

What waits. The model key is over its monthly limit until 1 November, so no new route can actually be planned before then. The tests use a stand-in model. The picker itself waits for your answer to question 1.

Why 1A. Chat's list (B) suits dozens of conversations. You will likely have one to four briefs per article, and the route list already fills the band. Chips (C) are fastest to switch but crowd the band's head. A reuses the line that already names the brief.
