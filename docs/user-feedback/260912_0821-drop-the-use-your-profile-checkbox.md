# Drop the "Use your profile" checkbox, always use the profile

**[SPIDERYARN-READING2-3B](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-3B)** · reported
2026-09-12 08:21 UTC · kind `suggestion` · sent from
`/read/entropy-24-00930-spya-bmvfyb?at=spya-mt5nt3&mode=summary&remember=quiz&deep=2`, build
`607b57a0`, an iPad

**Ending: shipped.** On `dev`, not deployed. The Sentry issue should be marked *resolved*. This
session has no Sentry sign-in, so the next feedback sweep sets that from this line.

## What Greg said

> All the places where it has a little checkbox saying "use your profile", and remove that from the
> UI. Just always have it as on. So just assume that we're always going to use the profile, and we
> don't need to include it in the UI to ask them. So the UI is a bit tidier and more compact.

## What we did

[260913a](../plans/260913a-drop-the-use-your-profile-checkbox.md). The checkbox is gone from all
seven places it appeared — the glossary, quotes, ideas, tweets, sketch, and the chat composer, which
is also Remember's — and so is the "Using your profile" sentence that stood in for it on runs that
start themselves. The whole row goes, including the little 👤 button beside it; the *written for
you* badge on a finished list still opens the panel showing what your profile says, and the Command
bar's Profile row is the way to edit it. Every new list and every chat answer now uses the profile.
The server still accepts `useProfile: false`, because the candidates chat needs it.

**A reader who had it unticked** keeps their plain glossaries, summaries and so on exactly as they
were, not marked out of date. Whatever they ask to be *rewritten* is written for their profile.
**Find more** is the one exception: it continues in whatever the list was written with, because
adding profiled terms to a plain glossary replaces it and drops terms (GPT Sol's review). The only
way left to not be profiled is to empty both profile boxes.
