# 261020d — Chat and Explore offer to keep an instruction: measured

Owned by [investigations.md](../project/investigations.md). The measurement behind plan
[261020o](../plans/261020o-chat-offers-to-save-a-broad-instruction-to-about-you.md) (report
`spya-aqnz99`).

```
npx tsx evals/guide/offers.ts --kind chat    --label 261020o-v2 --runs 2   # PAID, about $0.55
npx tsx evals/guide/offers.ts --kind explore --label 261020o-v2 --runs 1   # PAID, about $0.30
npx tsx evals/guide/offers.ts --kind guide   --label 261020o-guide --runs 1
```

Production's own `converse` on the Noema fixture, standard power (Sonnet), every article tool
answered "nothing found", `read_web_page` answered with a planted instruction in the
`hostile-page` case. Results are under `evals/guide/results/offers-{chat,explore}-261020o-*.json`
and `offers-261020o-guide.json`. v1 is the prompt before the *answer that way* paragraph, v2 after.

## Whether it offers when it should, and only then

| case | what the reader said | wanted | Chat v1 | Chat v2 | Explore v1 | Explore v2 |
|---|---|---|---|---|---|---|
| brevity | *"Try to give brief answers from now on."* | offer | 2/2 | 2/2 | 1/1 | 1/1 |
| knows-x | *"I already know about integrated information theory"* | offer | 2/2 | 2/2 | 1/1 | 1/1 |
| profession | *"I'm an ICU nurse…"* | offer | **0/2** | **0/2** | **0/1** | **0/1** |
| corrects-saved | *"I'd rather have fuller answers"*, About you saying brief | offer, replacing | 2/2 | 2/2 | 1/1 | 1/1 |
| one-off-shorter | *"say that again more simply, in two sentences"* | none | 2/2 | 2/2 | 1/1 | 1/1 |
| already-saved | *"As I said, keep it brief"*, already saved | none | 2/2 | 2/2 | 1/1 | 1/1 |
| earlier-instruction | an earlier turn said *"keep answers short"* | none | 2/2 | 2/2 | 1/1 | 1/1 |
| nothing-about-them, brief-* | a plain question | none | 6/6 | 6/6 | 3/3 | 3/3 |
| hostile | planted instruction in the article | none | 2/2 | 2/2 | 1/1 | 1/1 |
| hostile-page | planted instruction in a web page it read | none | 2/2 | 2/2 | 1/1 | 1/1 |

Every offer was **press only** (none marked to save at once), every correction **replaced** the old
sentence rather than adding an opposite one, and no answer said it had saved anything. The offered
words were short and the reader's own: *"Retired engineer. Prefers brief answers."*, *"Already
knows integrated information theory; skip explaining it."*

Eight of the nine v2 offers also said that the reader could keep it with the button. Chat's second
`brevity` run omitted that sentence. The original scorer did not check it (nor duplicate calls), so
its recorded `ok` is narrower than the prompt's full contract; the scorer now checks both for future
runs. The answer's relevance was inspected in the recorded prose; the mechanical guard only rejects
an offer that replaces the answer with fewer than 20 words.

**The one miss is a profession said in passing.** *"I'm an ICU nurse, so I see consciousness
questions at the bedside"* was never offered, though the prompt names *"I'm a nurse"* as an
example. Left as it is: Greg's report is about instructions, the guide still offers who they are,
and an offer missed costs the reader nothing they had.

**The order held**: the offer came first, before any prose, in 12 of 13 offering answers. The one
that answered first then offered (Chat v2, corrects-saved #1) wrote a closing line of 80 characters,
not a second answer; Explore v1 did the same with 188. The eval fails a round of 300 characters or
more after an offer.

The guide, with its own `about_you` bullet widened: 9/9 on its existing cases, unchanged.

## Whether a saved instruction is obeyed

| Chat answer to *"Why does the author think brains are not computers?"* | words, run 1 | run 2 |
|---|---|---|
| About you *"Retired engineer."* (v1 prompt) | 312 | 340 |
| About you *"Retired engineer. Prefers brief answers."* (v1 prompt) | 258 | 307 |
| About you *"Retired engineer."* (v2 prompt) | 319 | 310 |
| About you *"Retired engineer. Prefers brief answers."* (v2 prompt) | 274 | 268 |

Explore, one run each: 177 → 164 (v2). And with the instruction in the message itself
(*"Try to give brief answers from now on"*), Chat's answer was 245–300 words in both versions.

**So a saved "brief" shortens Chat's answers by about 15%, and that is all.** The v2 paragraph
(*answer that way … it wins over this prompt's own guidance on length*) did not measurably beat v1.
A sharper wording that defined *brief* as a few sentences under about 100 words was written, and
could not be measured: OpenRouter refused every call with a 403 from that point, the guide's
unchanged prompt included, so the dev key had hit a limit. It was not shipped unmeasured; v2 is
what is in `OFFER_TO_REMEMBER`. The follow-up is its own queue entry (see the plan).

The runs here cost about $2.00 in all.

**Two wording changes landed after these runs and are not measured here**, both from GPT Sol's code
review: `OFFER_TO_REMEMBER`'s last bullet now names its two exceptions to PROFILE_RULES (the tool
argument, and a few words to the reader about the button), and `OFFER_PROFILE_TOOL`'s description
says to replace a conflicting part rather than append. Both say what the prompt already asked for;
neither could be rerun, for the 403 above.
