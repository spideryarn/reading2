# Nano Banana and text in generated images

**The earlier finding is overturned, and it needs no new seam.** Google's Gemini image models
letter supplied text correctly and repeatably — and `google/gemini-3.1-flash-image` is served
through **OpenRouter's own `/v1/images` endpoint**, on our existing key, with a real `usage.cost`
and `is_byok: false`. So the retest Greg asked for produces a result the app can act on **without**
going round [ai-gateway.md](../project/ai-gateway.md)'s one-vendor rule.

Across **15 plates and 111 pieces of supplied text — 105 short labels and 6 full sentences — not one
character was wrong.** The comparable OpenAI spike two days earlier produced "SΩUL MACHINE" on the
first heading it was asked for, and the whole feature's text ban was written around that failure
([260903c-illustrated-diagram-sub-mode.md § Text in the picture](../plans/260903c-illustrated-diagram-sub-mode.md)).

This is a throwaway spike, run 2026-09-04. Nothing was wired into the app and no code was added to
`src/`. Greg asked for the retest in these terms:

> Re text in generated images, I have added GOOGLE_API_KEY to .env.local (and to .env.prod) - try
> with Nano Banana (even if that means we don't use OpenRouter) and see if that's better for text
>
> — Greg, 2026-09-04

## The verdict

**Yes, it changes the product decision.** Three separate claims, kept separate on purpose, because
a good spelling sample proves only the first of them (⟨Sol⟩, 2026-09-04):

1. **It can *letter*.** Supplied text comes out spelled exactly right. 105 of 105 short labels, and
   6 of 6 full sentences, across two models and both routes. `MÜNCHHAUSEN`, `EXPLOITGYM`,
   `PERSISTENT-SOL`, `533` — all correct, on every draw.
2. **It *places* text correctly, when told where.** Every title bound to a described scene
   (`the pastry bun with the face-like swirl — FACE IN THE BUN`) landed under that scene, on every
   draw. Where a drawn element was named in the composition but given **no** title, the model
   sometimes wrote one — see [§ The two real failure modes](#the-two-real-failure-modes).
3. **It says nothing about whether the words are *true*.** Nothing here tests whether the title
   belongs to that vignette, whether the vignette matches the quote, or whether the quote is in the
   article. Those are `260903c`'s problems and are entirely unchanged. **Sketch remains the
   checkable diagram of record**, and a correctly-spelt caption on a wrong vignette is still a
   confident-looking lie — a better-looking one than before.

So the product plan's rule — *"let the model letter each vignette with its short title only, ≤4
words, uppercase, and keep the real checked text in HTML beneath the image"* — **is supported, and
its cap is no longer load-bearing for safety.** Keep ≤4 words as a *design* choice if you want
(short titles read better under a small vignette); it is no longer needed as a *spelling* one.

**Sentences were tested, not extrapolated**, and they worked (T13, five verbatim article sentences,
57 words, letter for letter). But see [§ What the sentence option would
cost](#what-the-sentence-option-would-cost) — a verbatim quote inside a picture is a claim we
cannot check after the fact without reading the pixels back, and 15 clean draws is not a
production guarantee.

## The route: OpenRouter, and it is the one to take

`GET https://openrouter.ai/api/v1/images/models` on our key, 2026-09-04, lists three:

| OpenRouter id | resolutions | aspect ratios |
|---|---|---|
| **`google/gemini-3.1-flash-image`** (Nano Banana 2) | 512, 1K, 2K, 4K | incl. `2:3` |
| `google/gemini-3-pro-image` (Nano Banana Pro) | 1K, 2K, 4K | incl. `2:3` |
| `google/gemini-3.1-flash-lite-image` | 1K | incl. `2:3` |

The same T1 composition, sent to `POST /v1/images` in the same body shape `outgoingImage` in
[`src/ai-call.ts`](../../src/ai-call.ts) already builds:

| | direct Google | **OpenRouter, `2K`** | **OpenRouter, `1K`** |
|---|---|---|---|
| latency | 18.8 s | 18.2 s | **11.2 s** |
| dimensions | 1696×2528 | 1696×2528 | 848×1264 |
| image output tokens | 1,120 | 1,680 | 1,120 |
| money | ~$0.067 (published rate for that token count; **no cost field on the wire**) | `usage.cost` **$0.1012075**, `is_byok: false` | `usage.cost` **$0.0676075**, `is_byok: false` |
| labels correct | 10/10 | 10/10 | 10/10 |
| invented extra label | yes (`MALL TISSUE BLOB`) | no | no |

Four things follow, and the third is the one that decides the resolution:

- **The bill comes back priced, and not as BYOK.** `is_byok: false` and a real `usage.cost` means
  the existing `Meter` reads it exactly as it reads a chat call — no `byok_upstream_nanos`, no
  hand-maintained price table, no `cost_source: "computed"`. That is strictly better accounting
  than `openai/gpt-image-2` gets today, which is a BYOK row.
- **Direct Google has no cost field at all.** The Interactions API
  (`POST https://generativelanguage.googleapis.com/v1beta/interactions`) returns token counts and
  nothing else. Every dollar figure for the direct route in this doc is our arithmetic over
  Google's published per-image rate, and there is nothing to reconcile it against.
- **`1K` is cheaper, faster *and* more legible.** Not a trade-off: at 1K the model composes with
  proportionally larger lettering, so the 288 px thumbnail reads **better** at 848×1264 than at
  1696×2528 — 10.5 px cap height against 7.3 px, on the same ten-vignette prompt. Buy 1K.
- **`output_format: "jpeg"` is *not* honoured for this model.** Sent, ignored, PNG returned
  (`89504e47`, `media_type: image/png`, 1.9 MB at 1K / 6.9 MB at 2K). `gpt-image-2` honours it
  despite it being absent from `supported_parameters`; this one does not. `readPlate` catches this
  correctly — it decides from the signature — but `PLATE_MEDIA_TYPE` in
  [`src/illustrated-image.ts`](../../src/illustrated-image.ts) is JPEG-only and `storePlateImage`
  would refuse the bytes. `AssetExt` already has `"png"`, so widening is small; re-encoding is the
  alternative and costs a dependency the plan deliberately removed.

**The privacy page stays true on this route.** `src/web/PrivacyPage.tsx` tells readers OpenRouter
carries every AI call bar live voice, and Google is only sign-in. Going through OpenRouter keeps
that sentence honest. **If the direct route is ever taken instead, that page has to change in the
same piece of work** — a privacy page that has quietly stopped being true is worse than a slower
picture.

**Direct Google is a new owned paid seam, not a declared exception**, and this spike is not an
argument for building one: the gateway is where the single key, the meter and the `finally` that
records a failure as spend live, `ProviderAccount` has no Google arm, and a raw production fetch
would sit outside the OpenRouter account cap as well. ⟨Sol⟩, 2026-09-04. Since OpenRouter serves
the model, none of that has to be built.

## What was run

Five compositions in seven prompt variants, drawn from real briefs already in the repo
([`evals/results/illustrated-v2/`](../../evals/results/illustrated-v2/) and
[`illustrated-v2b/`](../../evals/results/illustrated-v2b/)), each wrapped in the shipping
`imagePrompt` envelope from [`src/illustrated.ts`](../../src/illustrated.ts) with only the
*Text in the picture* paragraph swapped — so what went out is what the app would send, minus the
text ban.

| # | case | model / route | supplied text | result |
|---|---|---|---|---|
| T1 | noema overview, 10 vignettes | flash, direct | 10 labels, ≤4 words, uppercase | 10/10 · **+1 invented, misspelt** |
| T10b | same prompt, redraw | flash, direct | 10 | 10/10 |
| T10c | same prompt, redraw | flash, direct | 10 | 10/10 |
| T5 | same prompt | **pro**, direct | 10 | 10/10 · **+1 invented, correct** |
| OR-2K | same prompt | flash, **OpenRouter** | 10 | 10/10 |
| OR-1K | same prompt, 1K | flash, **OpenRouter** | 10 | 10/10 |
| T2 | single vignette, long caption | flash, direct | 1 sentence, 11 words | correct |
| T3 | fortress plate, 3 registers | flash, direct | 7 labels incl. `533 AGENTS` | 7/7 |
| T8 | same prompt | **pro**, direct | 7 | 7/7 |
| T4 | proper nouns / odd spellings | flash, direct | 7 incl. `MÜNCHHAUSEN` | 7/7 · micro-gibberish on a drawn scroll |
| T12 | same prompt, redraw | flash, direct | 7 | 7/7 · same gibberish |
| T7 | same prompt | **pro**, direct | 7 | 7/7 · same gibberish |
| T6 | 5 large scenes | flash, direct | 5 | 5/5 |
| T9 | 5 large scenes, "very large" type | flash, direct | 5 | 5/5 |
| T13 | 5 scenes, **verbatim article sentences** | flash, direct | 5 sentences, 57 words | 57/57 words |

Every image was **looked at**, and every label cropped and read at 3× where there was any doubt.

### The exact strings that came back

Supplied (T4/T12/T7, three draws): `SCALA NATURAE` · `HUGGING FACE` · `EXPLOITGYM` ·
`PERSISTENT-SOL` · `ANTHROPIC CLAUDE` · `MÜNCHHAUSEN` · `SPIDERYARN`. All three draws, all seven,
correct — the hyphen, the umlaut and the run-together `EXPLOITGYM` included. Pro adds a full stop
after each and Flash wraps each in typographic quotes; neither was asked for, and neither is a
misspelling.

Longest correct run (T13, mixed case, italic):
*"like a face in a piece of toast or Mother Teresa in a cinnamon bun"* — 15 words, verbatim,
comma-perfect.

Wrong, in the whole spike: **`MALL TISSUE BLOB`**, once. Nobody asked for it.

## The two real failure modes

**1. An unlabelled element attracts an invented label.** T1's composition draws eleven things and
the prompt named ten. On two of six draws the model captioned the eleventh anyway — once
`TISSUE BLOB` (correct English, invented text) and once `MALL TISSUE BLOB`, which is `SMALL` with
its first letter eaten. **Every misspelling in this entire spike is that one string**, and it is
the one label the prompt did not supply.

The mitigation is structural rather than a stronger instruction: **caption every drawn vignette, or
none.** The brief model already emits one `depicts` per vignette, so the composition already knows
how many there are.

**2. A drawn writing surface gets pseudo-lettering.** The scribe roundel in T4/T12/T7 carries two
lines of glyph-shapes on the scroll — `ЄHOBBOZ / UUBBKKЗ`-ish, no readable word. `260903c` already
records this against the OpenAI model ("*illegible script-like texture is not 'text', and the rule
does not catch it*") and it is unchanged here on both Gemini models. It carries no misspelling
because it carries no word, and a reader could still fairly call it lettering. The fix is at the
*brief* level — don't ask for scribes, scrolls, ledgers and inscribed walls.

**Neither failure is a spelling failure. The model spells what it is told to spell.**

## Readable at thumbnail: yes, and 1K is why

Measured cap height, scaled to the 288 px band:

| plate | vignettes | plate px | cap at 288 px | at 1024 px (enlarged) |
|---|---|---|---|---|
| **OR-1K noema** | **10** | 848×1264 | **10.5 px** | 37 px |
| T1 noema (2K) | 10 | 1696×2528 | 7.3 px | 26 px |
| T3 fortress (2K) | 7 | 1696×2528 | 7.8 px | 28 px |
| T6 five scenes (2K) | 5 | 1696×2528 | 7.1 px | 25 px |
| T13 sentence captions (2K) | 5 | 1696×2528 | 9.0 px | 32 px |
| T9 five scenes, "very large" asked for (2K) | 5 | 1696×2528 | 9.5 px | 34 px |
| T2 single vignette caption (2K) | 1 | 1696×2528 | 10.7 px | 38 px |

Three things follow, and two of them would have been guessed wrong:

- **Readable at 288 px is achievable, even at ten vignettes — by asking for 1K, not 2K.** The
  OR-1K thumbnail is legible label by label. The 2K version of the same prompt is at the strained
  edge (~7 px cap, about a 10 px font: fine on a HiDPI screen, marginal on a laptop panel). A
  larger plate makes the *enlarged* view better and the *thumbnail* worse, because the model spends
  the extra pixels on detail rather than on type.
- **Fewer vignettes does not by itself buy bigger type.** T6 (five scenes) came back at 7.1 px, no
  better than T1's ten. The model sizes lettering as a roughly fixed fraction of the plate unless
  told otherwise.
- **A numeric size target works.** *"each title's capital letters must be at least one fortieth of
  the page's height, so that the title is still readable when the whole page is shrunk to the width
  of a thumb"* produced 56 px where one fortieth is 63 px — very nearly obeyed. "large enough to be
  read easily" produced 7.1 px and meant nothing.

**The enlarged view is still the right default for a busy plate**, but it is no longer the *only*
state in which the picture says anything. The baseline is the point: the current pipeline's
`openai-huggingface` overview at 288 px is a red-brown smudge with no identifiable scene and no
text at all. That is the reader's complaint, entire.

## The prompt wording that worked

Two paragraphs, both inside the existing trusted envelope — one replacing `src/illustrated.ts`
§ *Text in the picture* in the **brief** prompt, one replacing the corresponding sentences in
`imagePrompt`.

```
Text in the picture. Letter a short title beneath each scene, in clean capital letters in the
register's own hand, large enough to be read easily. Use EXACTLY these titles, spelled exactly as
written here, one per scene, and no other text anywhere on the page:
- <where the scene is> — <THE TITLE>
  …one line per vignette, every vignette named…

Spell every one of these titles exactly. Do not invent, translate, abbreviate or add any other
word, letter, number, signature or date anywhere in the picture.
```

Three things in that are load-bearing, each measured rather than reasoned to:

- **Each title is bound to a described position**, not left to float. Every draw put every title
  under the right scene.
- **"and no other text anywhere on the page"**, repeated in the closing sentence. It is what the
  two invented labels beat, which is why the real fix is coverage rather than emphasis.
- **The size clause is a number or it does nothing** (above).

For verbatim sentences, the same shape with *"exactly as written — same words, same spelling, same
capitalisation and punctuation — wrapping onto two lines where it does not fit"* and *"Copy every
caption letter for letter. Do not shorten, reword, translate or add anything."*

## What the sentence option would cost

<a id="what-the-sentence-option-would-cost"></a>

Putting the **real quoted line** in the picture is now technically on the table and is not free:

- **It needs an acceptance gate that reads the pixels back.** A quote in HTML beneath the image is
  checked by `quoteAppears` against the block's own text; a quote *inside* the image is checked by
  nobody. Trusting it in production means OCR-ing the plate and comparing exact strings, and
  failing the plate when they differ — otherwise this feature has re-acquired exactly the silent
  failure the text ban was written to prevent, only now with 15 clean draws as its excuse.
- **15 draws is a sample, not a rate.** It is enough to overturn "cannot be trusted with words" —
  the OpenAI failure was roughly 1-in-3 on a single heading, so 111 consecutive correct strings is
  a different regime rather than luck. It is not enough to put a number on the residual.
- **The cheap version is already good.** Short titles in the picture for wayfinding, the checked
  quote in HTML beneath it, is the plan on the table and this spike supports it as it stands.

## What this is not evidence about

- **Three compositions, one register family** — antique map and illuminated page, which is what the
  feature draws. Nothing here says a photographic or modern register letters as well.
- **English, plus one German diacritic.** No non-Latin script was tried.
- **Nothing about accuracy or placement-against-the-article.** Every check here is "did the picture
  render the string we handed it, where we said". Whether that string was the right one for that
  vignette is `260903c`'s problem and is unchanged.
- **No reference image was sent.** The zoom plates pass the overview as `input_references`; that
  path is untested here.

## The images

In the session scratchpad, `nano-*` (throwaway; not in the repo):

- `nano-or-t1-noema-1k.png` and `nano-or-t1-noema-1k-thumb288.png` — **the recommended route**:
  OpenRouter, `google/gemini-3.1-flash-image`, 1K, ten labels, readable at 288 px.
- `nano-t1-noema-10-flash.jpeg` — the same prompt direct at 2K, and the one plate carrying the
  invented `MALL TISSUE BLOB`.
- `nano-t9-big5-bigtype-flash.jpeg` (+ `-thumb288.png`) — what the numeric size clause buys.
- `nano-t4-proper-nouns-flash.jpeg` — `MÜNCHHAUSEN`, `EXPLOITGYM`, `SCALA NATURAE`, and the scroll
  gibberish.
- `nano-t13-sentence-captions-flash.jpeg` — five verbatim article sentences, 57 words, all correct.
- `nano-baseline-gptimage2-oaihf-thumb288.png` — the current pipeline at 288 px, for comparison.

## See also

- [260903c-illustrated-diagram-sub-mode.md](../plans/260903c-illustrated-diagram-sub-mode.md) — the
  feature, the "SΩUL MACHINE" spike, and the text ban this would replace
- [diagram.md](../project/diagram.md) — Sketch, the checkable diagram Illustrated is a second view of
- [ai-gateway.md](../project/ai-gateway.md) — the one-vendor rule, and what a bypass would owe
