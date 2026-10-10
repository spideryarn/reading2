---
reports: spya-c2qmbg
ending: shipped
comment: Shipped: Citations and Debate are one mode, now called Sources (your answer B), renamed all the way down, with Bibliography, Reception and Claims, out of Experimental. Old links still land.
---

# A citation's card offers Dig deeper; folding Citations into Debate awaits Greg

Report `spya-c2qmbg` · SPIDERYARN-READING2-BV · suggestion from Greg (admin; the production row,
read with `feedback-unswept.ts --show`) · 2026-10-03, reading the Entropy article
(`entropy-26-00481-with-cover-from-taylor-beck-spya-naz564`) in Structure. Sentry event
`7abc4194d0f94a258e7c70cf0982603f`.

> I've said before that I think I'd rather have fewer major modes and perhaps amalgamate them in and either hide or amalgamate them so we have submodes. Strikes me that, well, citations and debate modes are pretty closely related. Debate's already getting kind of complex with a few other submodes, but I think having citations in it might make sense because it's all about, well, I guess there's stuff that the paper cites and then stuff that other people say about the paper. And in an ideal world, we would probably want them to be related because debate mode's also saying, like, are the claims that this paper makes substantiated, which could include saying, do the citations that this paper cites actually agree in the way that the paper purports that they do? Anyway, I guess in an ideal world we'd find a way to combine citations and debate mode, maybe into just references or some other word that captures it all. And it could be debate, actually, or discussion or... anyway, I'll leave it to you what to call it. But so the thing that triggered me to think this was I was looking at a citation and it said, Do you want to search Scholar in the tooltip? So I clicked search Scholar and it took me to another page. It's just a Google Scholar search. That wasn't that interesting. What I was hoping is that it would have a button for dig deeper in the tooltip. I think maybe it does in the main citations mode? That's more generally what I wanted was for it to say, enable me to situate that citation within the wider debate. And I don't quite know how to do that, but maybe, you know, if I'm in the citations submode or whatever, and I'm looking at a citation, I can say dig deeper, or maybe there's a button to say see in wider debate, and it figures out which theme within the debate themes it fits into, and then, I don't know, fits it in there somehow. I suppose simpler would be just to have a chat, but maybe that's the backup plan if this all seems too complicated.

**Ending: shipped (Dig deeper on the card); the merge of Citations into Debate awaits Greg.**
The owner's hover card on a citation in the prose now has *Dig deeper*. One press starts the
citation's own dig, closes the card and opens Citations on that row, where the answer streams.
*search Scholar* stays beside it on a work the article gives no link for. Plan and reviews:
[261004b](../plans/261004b-citation-hover-card-offers-dig-deeper.md).

Not built, queued:

- One mode for Citations and Debate, a cited work listed beside the claim it is cited near, and a
  cited work placed in a debate thread (qi-vmnga65v): options, costs and a recommendation in
  [261004b § Part 2](../plans/261004b-citation-hover-card-offers-dig-deeper.md), on
  [awaiting-approval.md](awaiting-approval.md).

**Then, 2026-10-09: B and C1, shipped** (Greg's reply `spya-vcvxu5` to q-xf2xvb). Citations and
Debate are one mode, **Peer review**, out of the Experimental switch, with three sub-modes:
Bibliography (the former Citations, the default), Reception and Claims. Under each claim, *Cited in
this paragraph* names the works the article cites in that claim's paragraph. C2 (a model filing
cited works under Debate's themes) is not built, as recommended. Plan and reviews:
[261009l](../plans/261009l-peer-review-mode-merges-citations-and-debate.md). **Held, queued as
qi-j8py7rjw:** renaming the stored names (steps, columns, routes) all the way down, until Greg
confirms the name, which clashes with Referee mode's "peer review". That follow-up is asked in
q-xf2xvb.

**The question for Greg is now a file**, `docs/user-feedback/questions/q-xf2xvb.md`, moved there from
`awaiting-approval.md` on 2026-10-07. He sees it in the Feedback dialog and replies there
([feedback-reports.md § Asking Greg a question](../project/feedback-reports.md#asking-greg-a-question-and-acting-on-his-answer)).

**Then, 2026-10-10: renamed Sources, all the way down** (Greg's reply `spya-egmn6r` to q-xf2xvb:
*"B Sources. Rename comprehensively, eg including docs, code, database etc"*). The label, the mode
word (`?mode=sources`), and the stored names underneath (`citations` → `bibliography`, `debate` →
`reception`, `debate-claims` → `sources-claims`, `debate-check` → `sources-claim-check`). Old Peer
review, Citations and Debate links still land. The database is expanded rather than renamed in place,
so that no reader meets an error during the deploy. The expand is on `dev`, and the Overseer holds
its deploy for Greg's OK on one rare deploy-window race. **The contract half**, which removes the old
names after that deploy, is queued for the Overseer
([draft](../plans/261009w-contract-queue-item.md)). Plan and reviews:
[261009w](../plans/261009w-peer-review-becomes-sources-all-the-way-down.md). That ends the deferred
half, qi-j8py7rjw.
