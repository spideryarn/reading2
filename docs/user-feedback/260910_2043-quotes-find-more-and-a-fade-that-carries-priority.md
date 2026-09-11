# Quotes: Find more, a fade that carries priority, and important over striking

**[SPIDERYARN-READING2-2W](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-2W)** · reported
2026-09-10 20:43 UTC · report `spya-cuxy49` · sent from `/changelog#release-75`, build `3bc0878f`

**Ending: shipped.** All three items are on `dev`, not deployed. The Sentry issue should be marked
*resolved*. This session has no Sentry sign-in, so the next feedback sweep sets that from this line.

## What Greg said

> Tweak the Quotes mode:
> - It's good that it now shows the quotes with the outline-border in the main text - perhaps
>   slightly fade the border based on the priority-score (but even low-priority quotes should still
>   be clearly visible)
> - Try and find more quotes by default, and make a small tweak to the prompt to emphasise important
>   rather than striking when highlighting them
> - Remove the "Choose them again" button, and add a "Find more" button

## What we did

[260911a](../plans/260911a-quotes-find-more-and-a-fade-that-carries-priority.md) has the design, the
options passed over, and the review that changed it.

- **The fade.** Stroke *weight* already carried priority (1px / 3px, since
  [260907c](../plans/260907c-quotes-drawn-as-a-stroke-in-the-prose-with-weight-carrying-priority.md)),
  so this is a second channel on the same mark: the outline's alpha now runs 0.70 → 1.00 with
  priority. The two move the same way, so a heavier quote is always also a brighter one and they
  cannot cancel. "Clearly visible" is a tested number: the faintest possible stroke is checked
  against the page colour and has to clear 4.5:1.
- **More, and importance first.** One quote per ~200 words (10–40 a pass), up from ~300 (8–32); the
  prompt now tells the model to look for the lines the argument rests on first and to keep a merely
  well-put one only when it is exceptionally so. `quotes/4`.
- **Find more replaces Choose them again, and it is an append, not a rename.** A forced run on a
  list from the same article keeps every quote you have — words, scores, id — and asks for more with
  the taken lines listed. *"Nothing more worth keeping turned up."* when a pass finds none, and the
  list stops at 120. *Choose them again* survives only on the **stale** banner (the article changed,
  so some lines may no longer be in it), where replacing is the only honest action.

## What happens to the lists you already have

After this deploys every existing list is from an older prompt, and its banner now reads *"These
include lines chosen by an earlier version of the prompt. Find more uses the current one, and keeps
these."* — no button. Find more works on it straight away.

## Checked in a real browser

On `fowler-phrenology`: the fade reads as a slight change and the faintest stroke stays clearly
visible (about 5.3:1 against the page). One Find more took the list from 15 to 48 in 34 seconds,
with all 15 originals unchanged. It also turned up five new lines starting mid-sentence, so the
prompt now bans those too. The details are in the plan, under § Stage 3.

## Three things for Greg, none blocking

- **That sentence stays on an old list for good.** A Find more keeps the list's older prompt stamp,
  because most of its lines still are the older prompt's choosing — GPT Sol showed that restamping
  them would claim the new prompt chose lines it never saw. If the sentence is noise, the options are
  to drop the outdated banner for quotes, or to put a "choose them all again" on the Metadata page.
- **There is no way left to throw a current list away and start again**, including for a new
  profile — that was *Choose them again*'s other job. Say if you want it back somewhere quiet.
- **Find more's lines are the tail, and the prose shows all of them.** In the browser pass every
  one of the 33 new lines scored below the bar, so each drew a faint stroke. In the default "in
  order" view every quote is outlined, and the bar that hides them is only reachable inside quotes
  mode. If that is too much outline, the smallest fix is to make the prose follow the bar by
  default.
