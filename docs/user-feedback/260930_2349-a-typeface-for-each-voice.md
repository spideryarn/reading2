---
reports: spya-rryap3
ending: shipped
---
# A typeface for each voice: the author's, the AI's, the reader's

[SPIDERYARN-READING2-7C](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-7C), a suggestion
from Greg (admin, verified by `scripts/feedback-reporter.ts`, exit 0), sent from Summary mode on
`dongetal25-spya-vfmvmm`, build `fe57a1ea`. The time in the file name is the feedback row's
`created_at` (22:49:05Z), in London time.

> I'm leaning towards the idea of using font to distinguish the author-generated from AI-generated
> from user-generated text. Let's use:
> - Courier for all AI-generated text
> - A serif front for the author-text, e.g. Times new Roman
> - Arial or something like that for user-generated
> - and it's just occurred to me that UI text could perhaps be yet another font...!?
>
> Use your judgment. Perhaps try a v1 of this and I'll see how I feel about it, and then we can do a
> v2 that really goes to town if it feels good.

**Ending: Shipped** to `dev`, as the v1, **behind the Experimental switch**: with it on, the reading
view sets the article (and every verbatim quote of it) in a serif, anything a model wrote in
Courier, and anything you typed in Arial. Geist stays the chrome, which makes it the fourth voice.
Needs a deploy; no migration.

Two judgment calls on your named faces: **Courier Prime** rather than Courier New (still Courier, but
drawn to be read at body size; Courier New is a hairline on a dark page), and **Source Serif 4**
rather than Times New Roman (a screen serif, the same on every device, and it keeps the
dark-mode weight). Arial is as you said. The reasoning, the full list of what is in which voice, and
the screenshots are in [261001d](../plans/261001d-typeface-per-voice.md). GPT Sol reviewed the plan
and the code, and fixed what it found.

**For Greg, the v2 questions:** section titles stay Geist, because the model copies the author's
heading verbatim and only the spine's tooltip can tell which is which; block ids are already Courier
and now look like AI text; the serif may want a size step; and whether to take it out from behind
the switch.
