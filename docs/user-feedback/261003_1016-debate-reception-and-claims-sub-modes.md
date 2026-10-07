---
reports: spya-caue42
ending: shipped
comment: Shipped: the Reception and Claims sub-modes. Still waiting on you: should Claims let you choose which claim is checked, by typing or picking one, or stay as built, where the search chooses?
---

# Debate: Reception and Claims sub-modes, and a tidier panel

Report `spya-caue42` · suggestion from Greg (admin; the production row, read with
`feedback-unswept.ts --show`) · 2026-10-03, reading Levin 2024, *Self-Improvising Memory*, in
Debate. Sentry event `74461136547646cf9068ca35e78ef7aa`.

> I don't quite understand what debate mode is doing. The UI is confusing. Like, in this case, it seems to have found some interesting stuff about the RNA and C. elegans study, and like, oh, it turns out that's more controversial. All right, cool. But A, that's very specific. It's one claim. And B, it doesn't tell me anything about how the paper has been received more generally. I mean, this came out a little while ago, so I was hoping, you know, have other people reviewed it or critiqued it or discussed it? So maybe I'm asking for a few things. It may be that you could, as a first pass, say, which of these claims do you want me to check? So there could be a claims submode. So one claim might be, you know, about the RNA and C. elegans, and then there could be effectively a thread or something a bit like with the search mode for each claim, and then papers that have sort of evaluated the claim since then. Okay. And then there's a section, a separate submode besides claims for reception or critiques or responses or something. Yeah, reception sounds about right, which talks about, you know, other people who have—what have they said about this? I don't know if we need a separate submode for has it been cited, who has cited it. Is that the same thing as reception or is that different? Well, use your judgment. Maybe some quick evals, and also tidy up the UI.

**Ending: shipped (the two sub-modes, the tidy-up, the evals); the claims picker awaits Greg.**
Debate is now Reception and Claims on one control, with one list each and fewer controls and
notices. Claims lists each claim with its sources under it. "Who has cited it" is part of
Reception, which ends with a Google Scholar search for the citers. The quick evals found a bug:
the old default filter hid published replies and citing papers
([postmortem 261003h](../postmortems/261003h-debate-default-bar-hides-the-citing-papers-the-search-was-changed-to-find.md)).
Plan and reviews: [261003o](../plans/261003o-debate-reception-and-claims-sub-modes-and-a-tidier-panel.md);
evals: [investigation 261003g](../investigations/261003g-debate-on-a-thinly-received-paper-what-reception-finds-and-how-claims-spread.md).

Not built, each queued:

- Choosing which claim is checked, or typing one (also the "steer the debate" box from
  `spya-thpsnd`): qi-k9deez4b, on [awaiting-approval.md](awaiting-approval.md).
- Listing every citer from a citation index: qi-aabv7jjy, already waiting on Greg since 261002i.
  On this paper the open web has no discussion to find and 39 papers cite it, so this is what
  would answer "how has it been received".
- A run that fails on an unclosed fence: qi-3vrt4czt.

**The question for Greg is now a file**, `docs/user-feedback/questions/q-sn37bt.md`, moved there from
`awaiting-approval.md` on 2026-10-07. He sees it in the Feedback dialog and replies there
([feedback-reports.md § Asking Greg a question](../project/feedback-reports.md#asking-greg-a-question-and-acting-on-his-answer)).
