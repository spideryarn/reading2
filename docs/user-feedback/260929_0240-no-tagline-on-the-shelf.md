# No tagline on the signed-in shelf

SPIDERYARN-READING2-4W, from Greg (admin), in production, build `cba650a3`, on the signed-in
homepage. The time in the file name is when this session received the report from the Overseer, not
Sentry's *First Seen*, which this session could not read.

> On logged-in Homepage, I'm not sure I like the tagline:
> - Perhaps get rid of "Pick a piece" from the tagline? In fact, let's change "Read deeply, at
>   whatever level of detail you need. Pick a piece." to "Read deeply & efficiently". Or maybe
>   actually just remove the tagline from the logged-in Homepage.

**Ending: Shipped** — on `dev`, not deployed. Resolve 4W (this session has no Sentry sign-in, so the
next feedback sweep does the status write).

What we did: removed the tagline from the shelf's header, taking his last thought. The header still
looks right without it (browser-checked at 1440 and 390): the spider and heading, the Profile /
Feedback row, then the add-an-article box.

**An assumption Greg can overturn in one line:** removal rather than "Read deeply & efficiently". If
he'd rather have the shorter line, the comment left in `Library.tsx` where the `<p>` was has his
wording. The sign-in page's similar sentence ("…Sign in to get to your shelf.") was left alone, since
it isn't the signed-in homepage.

Plan: [260929a](../plans/260929a-logo-beside-the-wordmark-beta-to-the-right-no-shelf-tagline.md).
