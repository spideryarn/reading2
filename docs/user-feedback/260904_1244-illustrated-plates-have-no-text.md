# The illustrated plates have no text in them

**[SPIDERYARN-READING2-12](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-12)** · reported
2026-09-04 12:44 UTC · resolved 2026-09-04 · *legibility shipped; the prompt box deferred*

## What the reader said

> I use the illustrated diagram sub mode. There should be a text input box with a microphone next to
> it for me to add something to the prompt for how I want the image to come out. Also, the images
> that are generated don't have any text. So they're just the images, and without the text, it's
> almost impossible to make sense of what the image is about. So it needs to not just depict things
> as images, but also show the text. And because space will be at a premium, maybe it should have a
> decent sized font and/or less white space… we want the text to be readable even when the image is
> in thumbnail.

## The finding that unblocked it

The standing rule was that an image model cannot be trusted with words — the earlier spike had one
render `SΩUL MACHINE`, and a plan had generalised that into a law. Greg asked for it to be retested
with Nano Banana. It was, and **the law was wrong**: across 15 plates and 111 supplied strings, 105
short labels and 6 full sentences, not one character came back wrong.
[The research doc](../research/260904a-nano-banana-text-in-generated-images.md) has the numbers.

It also came back on **OpenRouter's own `/v1/images`**, on the existing key with a settled
`usage.cost` — so no direct-Google seam, no new provider account, and the privacy page stays true.
The happiest available answer to *"even if that means we don't use OpenRouter"*.

And **1K beats 2K**: cheaper, 40% faster, and *more* legible at thumbnail, because at 2K the model
spends the extra pixels on detail rather than on type.

## What shipped

Plates are drawn by `google/gemini-3.1-flash-image` at 1K, 2:3. The brief model writes a `title` per
vignette, which we upper-case so the picture and the legend cannot disagree, and the legend beneath
the plate now shows that title above what it depicts — so a title read off a vignette can be matched
to its passage. **The checked quote is untouched**: words we generated and verified still outrank
words the model painted.

`ImageRequest` lost `quality`, `output_format` and `output_compression` — none is in this model's
`supported_parameters`, and the endpoint 404s on a parameter its upstream does not know. A test
asserts each is *absent* from the outgoing body, because a `toMatchObject` cannot see an extra key.

## The rule, and getting it backwards first

The one failure mode the spike found was **invented** words: the model captions any vignette the
prompt draws but does not name, and an invented caption was the only kind it ever misspelled. So the
rule is *caption every drawn vignette, or none* — enforced in code rather than asked for in the
prompt.

The first implementation applied it to the vignettes that **survived** filtering, and fell back to a
wordless plate when one was dropped. Run for real, **the plate came back lettered anyway**: the brief
model writes its titles into the composition prose as well, in place, where "render no text" simply
loses. It lettered 10 of 11 scenes correctly and repeated one caption on the 12th — exactly the
failure the rule existed to prevent.

**That was caught by looking at the picture.** The call returned 200 and the code believed it had
produced a wordless plate. The rule now covers what is *drawn*, which includes the dropped scene.

A four-word cap on titles also went: on a real run, two five-word titles cost two whole plates every
caption they had, over strings that letter perfectly. Characters govern legibility; words were a
proxy for them.

## PNG, and why we store it

`output_format: "jpeg"` is not honoured for this model. Re-encoding needs a decoder, and the only one
here is deliberately kept out of the API bundle because it costs 34 MB there; a hand-rolled JPEG
encoder is a DCT and a Huffman table. So the PNG is stored as it arrives: ~1.9 MB a plate against
~150 KB, so ~7.6 MB an article — a rounding error against the model spend, but a real cost in the
reader's download, and named as one in the docs. A `.jpeg` URL can never serve a PNG: the route
requires the extension to match the stored record, since both kinds now coexist.

## What it costs, which went up

Observed 2026-09-04: brief $0.21–$0.42, plates $0.068 each at 12–14 s, three per article. So
**$0.40–$0.65 an article, up from $0.27–$0.40** — partly a longer brief now it writes captions, and
partly that a plate is priced on the wire instead of arriving as a $0.013 BYOK figure.
`ILLUSTRATED_PRICE` and every copy of the old range were updated, because that number sits in front
of the reader's press.

## Verified by looking, at the size the complaint was about

Eleven real plates from three real articles, through the shipping stage, read at 288 px. Every
caption on every captioned plate spelled correctly and readable — including `TRAJECTORY "POISONED"`,
`30-40% IMPOSSIBLE`, `THREE RESEARCH WORKSTREAMS`, `533 AGENTS JOIN THE ATTACK`. A 12-vignette plate
is at the edge and still legible; nine is comfortable.

Two honest residuals, both recorded: the model still draws pseudo-glyphs on scrolls and banners in an
article *about* transcripts, and it occasionally duplicates a scene and so its caption.

## Deferred: the prompt box with a microphone

Not laziness — it is a provenance change wearing a text field. `guidance` was **deliberately**
removed from the job API, from `Job` and from `sameWork`, because a job freezes its inputs so that a
restart or a dedupe cannot change an artefact. Threading transient UI text into an enqueue would
break retry-after-restart, dedupe, freshness and `npm run illustrated` from a slug — all four. It
needs an article-scoped *stored* instruction, frozen at enqueue, in `sameWork`, and in the
fingerprint: a migration and a public-projection decision, which is its own stage.
