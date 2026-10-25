---
id: q-d5ucbd
report: spya-xsfrsg
status: answered
asked: 2026-10-24
title: The Chrome extension is built: when you're at your laptop, will you do the Web Store step and send me the item id?
refs: qi-64ngfhks · qi-4ma69gtp · qi-mpjegxhn · docs/plans/261024q-chrome-extension-one-click-add-the-page.md · docs/plans/261024y-a-second-press-on-a-page-already-on-the-shelf-opens-it.md · docs/project/chrome-extension.md · docs/user-feedback/261023_2231-chrome-extension-one-click-add-the-page.md · SPIDERYARN-READING2-NE
acted: spya-fs5wyy, spya-bk5etj
---
One thing left, and you said you'd do it from the laptop: put the Chrome extension in the Chrome Web Store, then send me the item id it shows (32 letters). I then wire production to it and add a Help section, and the next deploy makes it work for you. One sitting of about 20 minutes; the steps are below under Details.

The second part you chose (2A) is done: a press on a page you already have now says it is already on your shelf and offers to open it, instead of adding a second copy. This report stays open until the store step, as you asked.

Details

What you asked (report spya-xsfrsg, 23 October): a Chrome extension, one click to add the page you are on, partly because some sites check you are human and turn our server away but let you in. Do most of it yourself, leave me the store step, make updates seamless.

What is built (on dev, not deployed):
- The button copies the page as your browser shows it, in that tab only, opens a Spideryarn tab beside it, and that tab uploads the page with your own sign-in. You land on the add page with its "why are you reading this" box.
- The extension holds no password, token or key of yours, and never talks to our server itself. It asks Chrome only for access to the tab you press it on, when you press it. No install warning.
- New since your reply: pressing it on a page already on your shelf says "This article is already on your shelf, so adding it again cost nothing." with an Open the article button, and adds nothing. If Spideryarn can't check, it says so and offers Try again rather than adding a copy.
- Checked in a real Chromium on the box, and reviewed twice by GPT Sol.

The store steps (also in docs/project/chrome-extension.md under Publishing):
1. Open https://chrome.google.com/webstore/devconsole signed in as the Google account that should own it, with 2-step verification on. Pay the one-time fee (about $5) and verify the email.
2. New item: upload extension/dist/spideryarn-extension-0.1.0.zip. It is built, not kept: npm run extension:build on an up-to-date dev makes it (on the box, then an agent copies it to your laptop, or on the laptop itself), so it includes the change above.
3. Fill the Store listing and Privacy practices tabs by pasting from extension/store/listing.md: every field's wording is there, matching our /privacy page. Distribution: Unlisted. Submit for review (usually a few days). The data-use section ticks nearly every category (health, financial, location and so on). That is on GPT Sol's advice and is the honest answer: the extension copies whatever page you press it on, and a page can show any of those. It does not mean the extension looks for them.
4. Tell me the item id. I set it in the app and add a Help section, and the next deploy makes it work in production.
5. Optional, for updates without the dashboard: a Google Cloud service account (steps in the doc) and its key kept outside the repo. Then each update is: bump the version, npm run extension:build, npm run extension:publish. Chrome installs reviewed updates for everyone within hours.

Not built yet, written down for later: select a passage and land in a chat about it; Firefox and Safari.

Greg's reply spya-fs5wyy, 2026-10-24:
"Yes let's do 1A when I'm back in front of my computer. Keep this report open.

2A"

Greg's reply spya-bk5etj, 2026-10-25 11:21:
"I think you should have received it right now."

Settled: the store item is eeedpogihlbbjghpanopajebiencekak (submitted for review, Unlisted). It is wired into production (f4d796440, 59000f581, deployed in 4b0d4dd3), and the extension is now findable from Help's Adding an article, the command bar, and the add page when a site turns our server away (plan 261025b, on dev). Nothing more is owed.
