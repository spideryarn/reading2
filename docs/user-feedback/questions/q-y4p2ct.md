---
id: q-y4p2ct
report: spya-yt2v73
status: answered
asked: 2026-10-19
title: May the guide start making a mode in the background, without you pressing anything?
refs: qi-g6ryjr9y · docs/plans/261019p-guide-chat-plainer.md § Stage 2 · docs/user-feedback/261019_1944-guide-chat-plainer-less-nagging.md · SPIDERYARN-READING2-M3
acted: spya-tgeg6v
---
You asked for the guide to get modes ready in the background, so they are made by the time the reader opens them, but never to switch to them. Today nothing the guide suggests runs until the reader presses its button, and that rule is written down as one of our defences. So I have built the rest of your three reports and stopped here.

A. Yes, as you asked. The guide may start one mode a conversation on the reader's own article (Summary, Glossary, Skim, Quotes and a few others, from a fixed list), only on a message the reader typed. It never switches to it, and never says it is ready until it is. Its button still opens it. Cost: a mode may be made that nobody opens, a few cents to a few tens of cents each. Risk: a planted line in an article could get one mode made, at most one per conversation.
B. Yes, but with a press. The guide offers a "Get Summary ready" button. Pressing it starts the work without leaving the conversation. The defence stays as it is, but the reader does one more press.
C. No. Keep it as now. The mode's own button starts the work when pressed, and the reader waits while it is made.

Recommended: A, with the one-per-conversation cap. It is what you asked for, and the worst a hostile article can do is spend a few cents.

Details

What you asked, 2026-10-19 (spya-yt2v73): "The Guide should be allowed to initiate/generate other modes in the background that it thinks will be helpful for the user (so that they'll be ready when the user needs them), but it shouldn't actually switch to them unless the user presses a button in the Chat UI (to avoid confusing them). Also one of the available tools should be to generate a Skim-route based on what they're saying."

What is built already, from the same three reports, and on dev. The guide gives a concrete suggestion before asking anything. It asks about the reader's reading at most once more, as a guess they can tap. It never asks about the reader themselves. It does not assume they have read the piece. A question about a passage now gets a short answer of two or three sentences, linked to the passages, followed by the Ask in Chat button. The greeting no longer asks about you or quotes About you back. A new starter button reads "What is this piece about?". In a blind comparison the new guide won 19 of 22 pairs against the old, where the old against itself split 12 to 10.

Why this part needed you. Since 11 October (your report spya-gae0zv), the guide only proposes things; the reader presses. Our security notes list "a press is the only way any of it runs" as a defence. That matters because the guide reads the article, and an article can contain text written to steer an AI. Letting the guide start work on its own is a small change to that rule, so it is yours to make.

What A would look like in use. The reader says "I'm deciding whether to cite this". The guide answers with where to start and offers the Skim button, and while they read its answer, Skim's route is being made. When they press Skim, it opens at once instead of after a wait.

The Skim route "based on what they're saying". Skim already reads the reader's saved reason for reading when it plans a route, and the guide already saves a reason the reader types. So under A, "prepare Skim" after their reason is saved gives a route shaped by what they said. One catch: it must not start in the same turn as a new reason is offered, or it would be planned from the old one and immediately go out of date. A route steered by something narrower than their reason ("just the methods") would be new work in Skim itself, and I have left it out for now.

What would decide it: whether you are comfortable with the guide spending a little money on its own judgement (A), or want every spend to stay behind a press (B or C).

## Greg's answer, 2026-10-20 16:23 UTC (in the Feedback dialog, reply `spya-tgeg6v`)

> Maybe we make it an option, so the Guide has the option to do A, but there's a minimal explanation in the prompt that this incurs expense, so if it's not confident that the user will want it, it just does B
>
> Perhaps for important/common modes (e.g. Structure, Summary, etc), the threshold is lower, i.e. the Guide is more willing to kick them off?
>
> Use your judgment - let's not make this tooo complicated.

Acted on 2026-10-20: both, as one new kind of next step, docs/plans/261019p-guide-chat-plainer.md § Stage 2b. The guide offers "Get Skim ready" (B); when it is confident, it marks it to start at once and the page presses it for the reader, once a conversation, only after a message they typed (A). The prompt says it costs money and to start one more readily for Summary and Skim. Structure needs nothing: it is the outline, always there. A "plan me a route" now starts Skim, planned around their saved reason. Accepted as risk R30.
