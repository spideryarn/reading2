---
id: q-t5xjqn
report: spya-wu83xh
status: open
asked: 2026-10-11
title: Skim: should visitors to a shared article also see the line that maps each pass?
refs: qi-g8pdgfgg · docs/plans/261011r-skim-more-always-longer-than-gist-a-pass-intro-shorter-quotes-skim-for-box.md · docs/user-feedback/261011_0149-skim-more-beats-gist-a-map-per-pass-shorter-stops-skim-for-box.md · src/public/dto.ts publicSkim · docs/project/security-map.md
---
You asked Skim to situate its quotes. Each pass (Gist, More, Most) now opens with one or two AI-written sentences saying what that walk goes through and in what order. For now only the article's owner sees them. Should visitors to a shared or public article see them too?

A. Yes, show them to visitors as well. Visitors already walk the same route and see the same AI questions above the quotes, so they would get the same map. Costs: one more field in the list of what a stranger is sent. That list is one of the app's security defences, so an unattended agent may not change it without your say-so.
B. No, owner only, as built. Costs: a visitor walks the route with no map, which is the disjointed feeling you reported.

Recommendation: A. The line is plain text about the article, written under the same rules as the questions visitors already see: never about the reader, never what the piece found.

Details

What you reported (2026-10-11): Skim feels "disorienting and disjointed", and you asked for "brief kind of introductory or summary or linking statements".

What was built (on dev, not deployed): when a route is planned, the same AI call now also writes an intro for each pass, for example: "Starts with the meaning gap, then the Django test of transfer and its results, and ends on matching evaluation to purpose." It sits at the top of the list of stops, in the AI typeface. A route planned before this has none until it is planned again.

Why visitors do not get it yet: what a stranger receives is built field by field from a fixed list (src/public/dto.ts). That list is named in the security map as a defence, and the rule for agents working unattended is to ask before changing one. GPT Sol's review said it is safe to add: the intro is shown as text only, never as a link or an address, and the AI questions already cross the same way.

What it would take: add the field to that list and to its test, which checks that nothing about the owner (such as who the route was planned for) goes with it. About an hour.

Reply "A" or "B"; anything else, say so.
