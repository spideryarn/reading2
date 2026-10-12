---
id: q-jzx20h
report: spya-skpxw2
status: open
asked: 2026-10-11
acted: spya-zake3w
title: Attachments to an article: what should one be, now that you can @-mention your articles in chat?
refs: SPIDERYARN-READING2-HA · SPIDERYARN-READING2-HX · qi-ghnqkf5v · qi-c8vnqatv · docs/plans/261011v-chat-attachments.md · docs/plans/261011v-chat-attachments-plan-review-sol.md · docs/plans/261012d-chat-at-mention-your-own-articles.md · docs/plans/261012d-chat-at-mention-plan-review-sol.md · docs/user-feedback/261011_0141-chat-attachments.md · docs/user-feedback/261012_1006-chat-at-mention-your-articles.md
---
Built from your answer: in Chat, type @ and pick any of your own articles (on the shelf, archived, or ones you made public). It comes into that conversation whole, a line at the top says so, and the answer's references to it are buttons that open it at the passage. So a file you upload the ordinary way can already be brought into a chat once it is ready.

Not built: "attachments to an article", your better-still. Every version of it needs a new kind of thing stored with the article, so I am asking which one, rather than guessing. What would you use it for first?

A. An attachment is a document tied to this article. You upload it from the article (or from its chat). It becomes a hidden article of its own: not on your shelf, no slot, deleted along with its parent. It is listed first when you type @ in that article's chats, under "Attached to this article". Chat can quote it and link to the passage, like any article. About a few days' work.

B. A text addendum. You paste or dictate notes onto the article, and chat can @-mention them and cite them. The cheapest, and enough for "my scribbles" if they are typed. It does not take files.

C. Photos or scans of handwritten scribbles, read as pictures. Needs a model that reads images, and a spending limit on chat, which it does not have yet. Much bigger; later.

D. Nothing more for now: upload as an ordinary article, then @-mention it.

Recommended: B if your scribbles are mostly typed notes, A if they are mostly files (PDFs, drafts). Either way, one risk carries over from before: a private draft that chat can read, in a chat that can also fetch web pages, could in principle be leaked a little at a time by a hostile web page. That is the same today for your notes and the article itself.

One smaller thing: you wrote "including archived and public". I took "public" to mean your own articles that you have made public. Chat cannot read other people's public articles, and letting it would widen what a hostile article could put in front of the model. If you meant other people's, say so and I will ask that separately.

Details

Your reply, 12 October:

> I was thinking it would be a way to upload my scribbles or similar or some other addendum to the current article. Let's keep things simple. Maybe it's local to that chat for now? (and indicates that) / Or better still, maybe there's a way to add attachments to an article, and this uploading them to a Chat would be one way. I don't have a clear sense of what we'd use this for yet, so if it's really complicated we should discuss. But it feels like it should be straightforward enough. / And ideally then I could @-mention any attachment to the current article in a chat.

Earlier question, 11 October: A, attach one of your articles to a chat as a source (recommended); B, a file kept only with the conversation, with web access cut; C, A now and B later; D, neither. Your reply above chose A's direction, which is what was built.

What you asked, on 11 October: "It would be nice if the various chat modes could accept attachments, PDFs, etc. There may be protections that you need to put in place to make this secure, or if you think it's a terrible idea (e.g. because of complexity/security/etc), push back."

Nothing is built yet. Opus and GPT Sol were asked separately and came to the same view, and GPT Sol then reviewed the plan.

Why not simply put the file into the conversation, the way ChatGPT does? When chat was first built it deliberately left attachments out. Chat here is defensible only because every claim points back to a passage you can open, and a file pasted into the model has no passages. Answers about it would be confident claims with no way to check them, which is one of the anti-goals in vision.md. It is also costly: a PDF sent whole is several thousand tokens a page on every turn, and chat has no spending limit per reader today.

Why turning the file into an article fixes that. An article has stable passage ids. The private storage, export and permanent delete you already have cover it, and chat can already search your other articles. What is missing is saying "this one", and letting a claim about another article be a button. Today chat may only name another article's title. A builds both.

Why B is bigger. Your own draft is the most valuable thing a hostile web page could try to steal. Chat can fetch web pages and run web searches, and a page can try to make it put your words into a web address. A length limit only slows that down. Note that your articles are already private to you, so B is not about privacy from other readers. It is about keeping a file off your shelf, and away from the web, inside one conversation.

What you would see with A: a small chip above the chat naming the source, with an Archived or Source deleted mark if that happens, and citations that open the source at the passage.

Deferred, whichever you choose, each to be queued separately:
- attaching a freshly uploaded file automatically when it is ready, instead of coming back to pick it;
- a cheaper "reference" import, priced like a minimal paper and readable while a PDF is still being transcribed (a price, so yours);
- the Learn, Tutorial, Explore, guide and referee chats;
- images and screenshots;
- a spending limit on chat.
