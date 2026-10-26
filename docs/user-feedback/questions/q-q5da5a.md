---
id: q-q5da5a
report: spya-shpsvx
status: answered
asked: 2026-10-26
title: Should the iPhone home-screen icon have a dark background?
refs: SPIDERYARN-READING2-P9 · docs/project/main-icon.md § Dark mode on an iPhone · docs/user-feedback/261026_0248-home-screen-icon-ivory-in-dark-mode.md · public/app-icon-dark-1024.png · src/email-frame.ts · docs/plans/261026i-home-screen-icon-follows-the-phone-mode-dark-by-default.md · qi-8yqe3ztx
acted: spya-e50wvz
---
The white is almost certainly the home-screen icon's cream square, and iOS gives a website's home-screen icon no proper dark version. Which should it be?

A. Dark charcoal for everyone (recommended). Matches Spideryarn's own dark default and stops glaring on your dark home screen. Costs a little contrast: the book's dark cover sits on charcoal, though its pages and the orange spider still stand out. Light-mode readers get a dark tile too, as with many apps. Simple and certain.

B. Whichever mode the phone is in when the icon is added. Dark-mode people get charcoal, light-mode people keep cream. Others report this works, but we have not tried it on a phone, and the icon never switches afterwards if you change mode. A few lines of extra code.

C. Keep cream for everyone. Best contrast for the book, but it stays the bright square you noticed.

If the white square you meant is not the home-screen icon (a Safari tab, the Favorites page, or the spider in the page), say where and that changes the answer.

Details

What you reported, on 2026-10-26 at 02:48 from your iPhone: "I'm in dark mode on my iPhone, and for some reason the new Spideryarn icon still has a white background."

Which icon. There are three. The small icon in a Safari tab and the spider in the page itself both have see-through backgrounds, so they take on whatever is behind them. The home-screen icon is the only one with a filled-in background: cream, chosen on 2026-10-24 so the dark book shows up well. So that is very probably the one, though I could not see your phone.

Why it does not follow dark mode. Native apps can ship separate dark, tinted and (since iOS 26) clear versions of their icon. A website saved to the home screen has no way to say "this one is for dark mode", and when developers asked Apple about it on its forums in 2024 and 2025 they got no answer. iOS also takes one snapshot of the icon when you add it. So the only trick available is B: hand iOS the dark picture if the phone is in dark mode at that moment. A see-through icon is not a way out: people report iOS fills it with black, in light mode too.

What each choice touches. The same picture is the Android home-screen icon and the small logo in our emails; A would make those dark too, which suits the emails' dark header. B keeps them cream.

After you choose. The agent who picks this up makes the change, and it goes out in the next deploy. Your existing home-screen icon will not change by itself, because iOS keeps the picture it took. To see the new one: press and hold the Spideryarn icon and remove it, then in Safari open spideryarn.com, tap Share, then Add to Home Screen. Check it in both light and dark mode.

Greg's reply, 2026-10-26 (spya-e50wvz, in the Feedback dialog), read as B with dark whenever in doubt:

> Maybe we can try and offer a switch between light and dark mode, but if in doubt, default to dark mode for the icon

Acted on, 2026-10-26 (queue item qi-8yqe3ztx): done on dev, out with the next deploy. The switch is your phone's own light or dark setting, not a new Spideryarn setting: when you add Spideryarn to the home screen with the phone in dark mode you get a charcoal icon, and in light mode the cream one. Wherever it cannot tell, it is charcoal: the Android icon, and the small logo in our emails (which sits on their dark header). The icon on your home screen now will not change by itself. To see the new one: press and hold it, remove it, then in Safari open spideryarn.com, tap Share, then Add to Home Screen. To check the other mode, switch the phone, remove and add it again. Not yet tried on a real phone: WebKit's own code shows the page's choice is read, but Safari's last step is closed, so your re-add is the test; and iOS 26's tinted or clear home-screen styles may still change either picture. The plan: docs/plans/261026i-home-screen-icon-follows-the-phone-mode-dark-by-default.md.
