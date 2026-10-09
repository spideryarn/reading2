---
reports: spya-caue42, spya-thpsnd
ending: shipped
comment: Shipped: Reception and Claims, and since 2026-10-09 the claims picker you chose: Claims lists the claims, you tick some or type your own, and one search checks them. Still waiting on you: should a visitor see your checks?
---

# Debate: Reception and Claims sub-modes, and a tidier panel

Report `spya-caue42` · suggestion from Greg (admin; the production row, read with
`feedback-unswept.ts --show`) · 2026-10-03, reading Levin 2024, *Self-Improvising Memory*, in
Debate. Sentry event `74461136547646cf9068ca35e78ef7aa`.

**Also part 2 of 3 of `spya-thpsnd`, steering Debate** (header added 2026-10-08, plan 261008i).
The part 1 note names this part; this note queued it (below) and the open question `q-sn37bt` asks
it, but the header named only `spya-caue42`, so thpsnd had two notes of three and read as waiting
on Greg, under *Needs a decision* with nothing to answer.

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
  `spya-thpsnd`): qi-k9deez4b, then qi-7e32ngyt. **Shipped 2026-10-09** (below).
- Listing every citer from a citation index: qi-aabv7jjy, already waiting on Greg since 261002i.
  On this paper the open web has no discussion to find and 39 papers cite it, so this is what
  would answer "how has it been received".
- A run that fails on an unclosed fence: qi-3vrt4czt.

**The question for Greg is now a file**, `docs/user-feedback/questions/q-sn37bt.md`, moved there from
`awaiting-approval.md` on 2026-10-07. He sees it in the Feedback dialog and replies there
([feedback-reports.md § Asking Greg a question](../project/feedback-reports.md#asking-greg-a-question-and-acting-on-his-answer)).

**Greg answered q-sn37bt on 2026-10-08** (*"C list the claims first, let them pick, and also B allow
them to input their own"*), and both shipped on 2026-10-09 as
[261008i](../plans/261008i-debate-claims-picked-by-the-reader.md). Pressing Debate searches for
Reception only. Pressing Claims lists the piece's main claims, with no web search. The owner ticks
claims or types one, and Check runs one search over them, about 20 cents, each claim answered on its
own; Dig further looks again elsewhere. Checks are the owner's; whether a visitor should see them is
the follow-up question `q-cgwene`.
