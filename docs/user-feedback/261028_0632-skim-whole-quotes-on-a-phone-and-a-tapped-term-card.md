---
reports: spya-r246pf
ending: shipped
comment: On a phone, Skim now shows every quote in full, so you can read down the route without leaving it. A tapped glossary term should now keep its card open; we could not make it fail off your iPhone, so please tap one after the next deploy.
---
# Skim on a phone: whole quotes, and a tapped term's card

> I'm using skim mode on an iPhone. As you know, it shows the mode but not the text. Or I can look at
> the text but not the mode; it only shows one of them at a time. That's fine. As a result, though, I
> think it would probably be helpful if skim mode actually showed the full quotes, because otherwise
> what I keep having to do is click on a quote to be taken to the text and then back to skim mode to
> see the next one. (Although I suppose I could keep just clicking next step in the text. That would
> probably work too.)
>
> The other thing I noticed is that I tried clicking on one of the glossary entries in skim mode on
> my phone, and it didn't seem to show the entry. So I guess that's a bug.
>
> — Greg, 2026-10-28 (`spya-r246pf`, admin, suggestion, on Skim, iPhone; proven with
> `feedback-reporter.ts`, exit 0; Sentry event not matched)

**Ending: shipped**, on `dev`, not deployed. Plan:
[261028a](../plans/261028a-skim-on-a-phone-shows-whole-quotes-and-a-tapped-term-card-stays-open.md).
This session has no Sentry sign-in and did not write the Sentry status; the next feedback sweep
does.

- **Whole quotes on a phone.** Where Skim covers the article, every row's quote is now drawn in
  full, not cut at about 100 characters with the rest in a hover card that a finger could never
  reach (a tap on a row goes to the article). A wide window is unchanged. Built without asking: it is
  what the report asks for, keyed on the existing "band covers the prose" test, with no setting.
- **The glossary tap.** Not reproduced: Chromium and WebKit at phone width with touch opened and
  kept the card every time. GPT Sol and a read of Floating UI's source found a real hole that fits:
  the guard that keeps a finger's card open ignored hover's `"hover"` close but not its
  `"safe-polygon"` one, and an interactive card such as Skim's term card closes through the second.
  It is closed, with a test that was red first. Also, a tapped chip no longer stays looking pressed
  on iOS. [Postmortem](../postmortems/261028a-a-touch-guard-named-one-of-hover-s-two-close-reasons.md).
- **Still to check, on the device:** queue item `qi-jx2rb7bx`. After the next deploy, tap a term
  under a Skim stop on the iPhone. If it still shows nothing, say what you saw (nothing, a flash, or
  a card cut off), and the next session starts from there.
- GPT Sol reviewed the plan and the code together, after the build, because the change was small;
  its six findings (two re-measurements on rotation, four stale comments and docs) are fixed.
