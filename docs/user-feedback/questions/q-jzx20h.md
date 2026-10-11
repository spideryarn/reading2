---
id: q-jzx20h
report: spya-skpxw2
status: open
asked: 2026-10-11
title: Chat attachments: attach one of your articles as a source, or a file kept only in the chat?
refs: SPIDERYARN-READING2-HA · qi-ghnqkf5v · docs/plans/261011v-chat-attachments.md · docs/plans/261011v-chat-attachments-plan-review-sol.md · docs/user-feedback/261011_0141-chat-attachments.md
---
You asked for attachments in chat, and invited push-back. My answer: yes, but only as "bring a second text into this conversation", never as "drop a file into the model". Which do you want built?

A. Attach an article as a source. In chat you press "Add a source" and pick one of your articles. To use a new file, you upload it as usual (it becomes an ordinary private article, costs one slot, and a long PDF takes minutes), then pick it. Chat reads that one article's passages, and every claim about it is a button that opens the exact passage. Chat keeps its web access. A few days' work. It changes two existing security defences (who may attach what, and which articles chat's tools may read), which is why I am asking rather than building.

B. A file kept only with the conversation, never an article. For your own draft or a manuscript you are refereeing. Much more work: new storage, export, delete and privacy-page wording. And in that conversation chat must lose web search and web pages, or a hostile article could leak your file through a web address. Claims about the file could not point to passages.

C. A now, and B later as its own piece of work, if you find you need it.

D. Neither, for now.

Recommended: A (C if you already know you want drafts kept out of your shelf). A covers comparing with a related paper, a reply, a supplement or your own draft, and keeps every claim checkable.

Details

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
