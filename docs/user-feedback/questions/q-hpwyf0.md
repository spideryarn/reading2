---
id: q-hpwyf0
report: spya-cwb56b
status: open
asked: 2026-10-11
title: May an unattended agent build C, letting ChatGPT or Claude on the web make your articles public without your press?
refs: follows q-pe52f6 (reply spya-fsarqm) · qi-jpw55yrq (the build, held) · docs/plans/261010r-mcp-gift-any-article-and-send-makes-the-link.md · docs/user-feedback/261010_1737-mcp-draft-a-gift-for-any-article-send-makes-the-link.md · SPIDERYARN-READING2-GX · docs/project/security-map.md
---
You chose C on q-pe52f6: from ChatGPT or Claude on the web, on your admin account only, the agent may make an article public or hand over its private link without a press of yours. Nothing is built yet, because this removes a safety catch, and an agent working with nobody watching may not remove one on a reply alone. So the question is only who may build it.

A. Yes: the Overseer may give this build to an unattended agent now, on three conditions: it works only when the signed-in account is an admin's, checked on the server; every other account keeps the press exactly as today; and the security notes are updated in the same change. GPT Sol reviews the plan and the code. Gives up: you will not watch it being built.

B. No: build it only in a session you are watching.

C. Drop it after all, and keep the press, as built now.

Recommended: A. The admin-only check is one condition in code that a test can hold, and nobody but you is affected.

Details

Background. On 10 October you asked for the MCP (the connection that lets ChatGPT or Claude act on Spideryarn as you) to "just work" from ChatGPT, including making articles public. Drafting a gift was built. Making an article public, or handing its private link to the AI app, was not offered from a web app, because on your Mac a dialog asks you first, and a web app has no such dialog.

q-pe52f6 asked how you would like to approve those two actions from the web. You first asked why a press was needed at all; the question was rewritten to explain (a hidden line in a web page or email the agent reads could tell it to publish your articles). You then chose C: drop the press for these two tools on your admin account only.

Why ask again. Our feedback rules say an unattended agent does not loosen a security rule even on your reply, and the press on these two tools is one of the listed safety catches. You were asked the same thing about the guide saving your words (q-t3j8hj) and answered A there.

What C means in practice. From ChatGPT or Claude on the web, signed in as you, an agent could make any of your articles public, or give itself a private link to one, in the middle of a conversation. It would also be the one saying you have the right to share that article, which today only your press can say. Readers who are not admins see no change.

What would decide it: whether you are content for the change to be built and reviewed without you watching, given that it is limited to your account by a server-side check.
