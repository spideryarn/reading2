---
id: q-d5ucbd
report: spya-xsfrsg
status: open
asked: 2026-10-24
title: The Chrome extension is built: will you do the store step, and should a second press open the copy you already have?
refs: qi-64ngfhks · qi-4ma69gtp · qi-mpjegxhn · docs/plans/261024q-chrome-extension-one-click-add-the-page.md · docs/project/chrome-extension.md · docs/user-feedback/261023_2231-chrome-extension-one-click-add-the-page.md · SPIDERYARN-READING2-NE
---
The Chrome extension you asked for is built and works end to end on a local server: one press adds the page as your browser shows it, so walled sites come through. Two things need you.

1. Put it in the Chrome Web Store. Only you can (your Google account, a one-time fee). One sitting of about 20 minutes, steps below under Details. Then tell me the item id it shows (32 letters) and I wire production to it.
   A: Yes, I'll do it from the laptop, by hand or with Claude in Chrome driving. (Recommended.)
   B: Not yet.

2. A press on a page that is already on your shelf adds it a second time (a second article and a slot), unless the first Spideryarn tab is still open. Fixing it needs one new read-only server route: "does this reader already have an article saved from this address?", owner-only, using the same lookup a pasted address already uses.
   A: Build the route; the extension then opens the article you already have. (Recommended.)
   B: Leave it: re-adding is rare.

Details

What you asked (report spya-xsfrsg, 23 October): a Chrome extension, one click to add the page you are on, partly because some sites check you are human and turn our server away but let you in. Later maybe: say why you are reading, or select text and land in a chat about it. Do most of it yourself, leave me the store step, make updates seamless.

What was built (on dev, not deployed):
- The button runs the same capture as the Save for Spideryarn bookmarklet in that tab only, opens a Spideryarn tab beside it, and that tab uploads the page with your own sign-in, through the ordinary upload. You land on the add page, which already has the "why are you reading this" box.
- The extension holds no password, token or key of yours, and never talks to our server itself. It asks Chrome for the least there is: access to the tab you press it on, when you press it. No install warning.
- Checked in a real Chromium on the box: the article arrives in about 7 seconds, "Saved from" the site; pressing twice makes one article; signed out, it goes through sign-in and carries on; it refuses Chrome's own pages. A PDF tab goes to the add page by its address.
- GPT Sol reviewed the plan (nine findings, all taken, including one that would have uploaded your page into another account if the account changed mid-handoff) and the code.

The store steps (question 1), also in docs/project/chrome-extension.md under Publishing:
1. Open https://chrome.google.com/webstore/devconsole signed in as the Google account that should own it, with 2-step verification on. Pay the one-time fee (about $5) and verify the email.
2. New item: upload extension/dist/spideryarn-extension-0.1.0.zip from the box (an agent can copy it to your laptop, or build it there with npm run extension:build).
3. Fill the Store listing and Privacy practices tabs by pasting from extension/store/listing.md: every field's wording is there, matching our /privacy page, which now has a paragraph on the extension. Distribution: Unlisted. Submit for review (usually a few days). One thing you may notice: the data-use section ticks nearly every category (health, financial, location and so on). That is on GPT Sol's advice and is the honest answer: the extension copies whatever page you press it on, and a page can show any of those. It does not mean the extension looks for them.
4. Tell me the item id. I set it in the app and add a Help section, and the next deploy makes it work in production.
5. Optional, for updates without the dashboard: a Google Cloud service account (steps in the doc) and its key kept outside the repo. Then each update is: bump the version, npm run extension:build, npm run extension:publish. Chrome installs reviewed updates for everyone within hours.

Question 2 in more detail: today the only guard against adding twice is in the extension, and it lasts while the first tab is open (up to 15 minutes). The route would answer yes or no from your own shelf only, never someone else's, and fetch nothing. It is small, but it is a new server route, which this run was told to ask about first.

Not built yet, written down for later: select a passage and land in a chat about it; Firefox and Safari.
