---
id: q-rwkq2e
report: spya-yyc7te
status: open
asked: 2026-10-20
title: Should chat take account of which parts of the article you have spent time on?
refs: qi-3tk6d9ga · qi-bkdxh4kb · docs/plans/261020d-principles-every-chat-shares.md · docs/user-feedback/261019_2015-the-principles-every-chat-shares.md · SPIDERYARN-READING2-KZ
---
Should the chats be told roughly how much of the article you have read, from the time each part has been on your screen?

A. Yes, one short line. Each chat turn gets a line like "about a quarter of the piece read so far", worked out the same way the quiz already decides what you have read. The chat uses it to pitch its answer and never mentions it. Cost: a little more of your reading data goes to the AI provider with each message, so the privacy page has to say so, and that page changes first.
B. Yes, section by section. As A, plus each main section marked read, glanced at, or not yet. More useful for "what does the methods section say?" questions, but more data sent, and the section names come from the article, so they need the same guard as article text.
C. No. The chats are not told about your reading progress; on that they go by what you say. Every chat is now told not to assume you have read the piece, which covers the main point of your report.

Recommended: C for now. The shared principles already stop the chats assuming you have read it, and in testing the old chats already coped well with "I haven't read it yet". A is the cheap next step if you want more.

Details

What you asked, 2026-10-19 (spya-yyc7te): "Make sure the chat responses are easy to understand, and don't assume that the user has read the paper at all (or maybe take a little bit into account the data about broadly which sections have/not been read)."

What is built, on dev and not yet deployed. Every chat about an article (Chat, Learn, Tutorial, Explore and the guide) now starts from one short shared set of principles: leave the reader sharper rather than more dependent, and get them there sooner; be candid rather than agreeable; make it clear how you know each thing; do not assume they have read the piece; explain plainly, pitched to them, and point at the part of Spideryarn that would serve them better. Chat used to say "They are reading it", and that line is gone. Tested blind against the old prompts it came out even overall, and on the thing it targets most it changed completely: when a reader said "I think you're wrong" with no reason, the old chats began by giving way 8 times out of 8, and the new ones began by rechecking and standing by their main point 8 times out of 8, while still fixing what really was loose.

Why the reading part needed you. Spideryarn already records how long each passage has been on your screen; it draws the shading down the spine from it, and the quiz uses it to ask only about what you have read. Today it is never sent to an AI provider. Sending it, or anything worked out from it, to the AI provider is new, and our privacy notes say to change the privacy page before doing that. That is your call, not mine.

What would decide it: whether the gain (a chat that knows you have not reached the methods yet) is worth one more kind of your data going to the AI provider with each message.
