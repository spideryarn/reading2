---
id: q-c8h4zg
report: spya-zytb0g
status: open
asked: 2026-10-28
title: Mockups: which way of drawing them do you like, and should they go live without a deploy?
refs: docs/plans/261028b-feedback-discussions-monospace-mockups-and-admin-mockups-page.md § Stage 3, § Stage 5 · docs/project/admin.md § /admin/mockups · docs/mockups/
---
/admin/mockups now exists. Below are the same idea drawn three ways. Tap each id to open its mockup:

m-tn6vxn  A. ASCII, in a monospaced block. It can sit inside a question like this one.
m-mxyef8  B. A wireframe drawn in our own colours and type, then screenshotted.
m-tsy26a  C. A screenshot of the real app. This is the Discussion button built today.

Two questions:

1. Which should an agent reach for by default?
1A. ASCII for early ideas, and B when the look matters. Both are cheap and quick.
1B. B by default, so you nearly always see something that looks real. That costs an agent a few minutes per mockup.
1C. Whichever the agent judges best, as long as it says why.
Recommendation: 1A.

2. When should a new mockup become visible?
2A. Keep it as it is. A mockup is a file in the repo, and you see it after the next deploy, usually within a few hours. Costs nothing more.
2B. Publish mockups the way questions are published, so you see one the moment it is made. That needs a small database table, an image store and a publish script, about a day of work. It also means agents write images to production, which is a new kind of write that you would be approving.
Recommendation: 2A for now. Switch to 2B if waiting for a deploy ever holds up a decision.

Image models (OpenRouter's image API) can be tried after 1 November, when our monthly limit resets. I will add one as a style D then, and you can compare it.

Details

What this is for. On 28 October you asked (report 723) for a way to see an agent's proposal rather than just read it. At the least that meant ASCII, which needs to be monospaced, and ideally a /admin/mockups page that decision questions can link to. You suggested trying a few approaches and comparing them.

What was built. Three things.
- A question can now hold a block of text between two lines of three backticks, and the dialog shows that block monospaced, so ASCII lines up.
- /admin/mockups is a table of mockups. Each one has its own page with text, ASCII and images, and only an admin can open it.
- A mockup's id written in a question, like m-tn6vxn above, becomes a link that opens it in a new tab, so your reply stays put.

Why the mockups are files rather than a database. Agents may write only one thing to production on their own, which is publishing a question. A mockup kept as a file needs no new permission, so it has to wait for the next deploy, which the Overseer runs every few hours. Option 2B would change that.

The styles in a little more detail.
- A, ASCII: free and instant. Good for layout and order. It shows nothing of colour, type or spacing.
- B, a wireframe in our CSS: a small HTML page using the app's real colour and type settings, photographed in a headless browser. It looks like the app without anyone building the feature. It can drift if the styles change later.
- C, the real app: exactly what you would get. It only exists once the thing is built, or prototyped on a branch, so it suits choosing between finished variants rather than early ideas.
- Not tried: Claude's own design artifacts (pages hosted on claude.ai). They are quick to make, but they live outside Spideryarn, need a claude.ai sign-in, and would split the record across two places.

Reply with something like "1A 2A".
