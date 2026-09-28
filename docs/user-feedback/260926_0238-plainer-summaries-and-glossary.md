# Summaries and the glossary should explain the jargon, in simpler words

[SPIDERYARN-READING2-44](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-44) (2026-09-26
02:38 UTC, `kind=suggestion`), from an admin, in production, build `3a556849`, in the glossary on
`bf03197835-spya-qfwsw2` (overseer queue `qi-qpsx92kg`).

> we want the summaries to really use simpler language, because half the problem is we may not know
> what the jargon means, and the glossary as well especially should explain in simpler language.

**Ending: Shipped** — on `dev`, not deployed. Resolve 44.

What we did: the rule both prompts had since 2026-09-03 kept "the article's own words for the things
it names", which exempted every piece of jargon. Summary lines now keep the author's term only as a
handhold and must make the sentence understandable without already knowing it. Glossary entries are
written for a reader from outside the field: the plain meaning first, and no second hard word. Both
say plainer must not mean vaguer. On three jargon-heavy local articles, a blind, shuffled
side-by-side found the new lines plainer in 70 of 91 pairs (the old prompt against itself: 55–46),
with fidelity problems as rare on each side. The cost is named in the plan: depth-1 summary lines run
past their 25-word limit more often.
[260926a-plainer-summaries-and-glossary.md](../plans/260926a-plainer-summaries-and-glossary.md).

**Reaches:** summaries on newly added articles only (existing trees keep their lines until their
stage is re-run). Every owner's existing glossary shows a *written by a different version* banner
with *Find them again*.

**Greg answered both open questions on 2026-09-28**, and widened the first:

> 4a Yes, we want to make this plainer/simpler language rule common across *all* prompts that
> generate text of any kind. And ideally also in a way that it will apply to all future prompts

- **Depth-1 summary lines may run to 30 words** (he said plain beats short). The median stayed at
  24; a blind read of the new prompt against the original found it plainer in 67 of 87 pairs.
- **Every prompt that writes words for a reader now shares one plain-words rule**, `plainWords()` in
  `src/plain-words.ts`: plain words where the text explains or asks, the author's own term in labels
  and headings, copies untouched, and a reader's stated background respected. A test makes it the
  default for new prompts, and
  [prompting-guide.md](../project/prompting-guide.md) is where it is written down, signposted from
  AGENTS.md. After credit was restored, blind reads found the new answers plainer in 25 of 36
  pairs, against an 8–10 same-prompt control; the other generated artefacts moved 77–45, with 116
  ties, against a 51–48 control with 93 ties. Fidelity was roughly even. The full per-kind results,
  caveats and saved evidence are in the plan.

**Reaches, since 2026-09-28:** new trees and new glossaries, as before; every owner's existing
ideas, quotes, timeline, quiz, FAQ, debate and citations show their *outdated* banner with a
regenerate button. Arc, sketch and illustrated store the flag and do not show it, so their old
versions stay until regenerated. Chat, Explain, search and the rest use the new rule from the next
request.

**Left for Greg:** nothing from this report. The plan's § Deferred has what was left on purpose.
