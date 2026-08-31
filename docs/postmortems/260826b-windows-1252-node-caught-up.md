# The test that asserted somebody else's bug

**2026-08-25.** `npm test` had been green all day. Then it wasn't, and nothing in the repo had
changed:

```
tests/fetch.test.ts > decodeHtml > does not use Node's decoder, which gets windows-1252 wrong

AssertionError: expected '€''""–—' not to be '€''""–—' // Object.is equality
 ❯ tests/fetch.test.ts:355:25
    354|     expect(viaUs).toBe("€''""–—");
    355|     expect(viaNode).not.toBe(viaUs);
```

Line 354 passed. Our decoder was still right. Line 355 failed, and what line 355 asserted was that
**Node's decoder was wrong**.

## What actually happened

`node` on this laptop was replaced at 18:21 that afternoon — Homebrew, 20.x to 26.7.0 — and Node had
fixed the bug the test was pinning.

Two upstream changes did it, both landing on `main` in December 2025:

- [#60893](https://github.com/nodejs/node/pull/60893) added a real windows-1252 decoder rather than
  reaching for ISO-8859-1.
- [#61093](https://github.com/nodejs/node/pull/61093) went much further and reimplemented **all** the
  single-byte encodings in JavaScript against the WHATWG index tables, taking ICU out of that path
  entirely. It also fixed ibm866, koi8-u, windows-874, windows-1253 and windows-1255, added
  `iso-8859-16` and `x-user-defined`, and made windows-1252 about a hundred times faster on ASCII.

They shipped in **24.13.1** and **25.4.0**, January 2026.

Verified rather than assumed, since the whole point of the exercise was not to trust a plausible
story. The same seven bytes, on the two Node binaries that happen to be on this machine:

| | 0x80 | 0x91 | 0x92 | 0x93 | 0x94 | 0x96 | 0x97 |
|---|---|---|---|---|---|---|---|
| **v20.19.5** (ICU 77.1) | 0080 | 0091 | 0092 | 0093 | 0094 | 0096 | 0097 |
| **v26.7.0** (ICU 78.3) | 20AC | 2018 | 2019 | 201C | 201D | 2013 | 2014 |

The tell that this was a reimplementation and not an ICU upgrade: v26.7.0 supports
`x-user-defined`, which v20.19.5 throws on. No ICU version supplies that; the spec's index table
does.

So the team lead's hypothesis was right, and acting on it would still have caused a regression.

## The near miss

The test's own comment told you what to do:

> If this test ever goes red, Node has been fixed and the dependency can go.

[fetching.md](../project/fetching.md#the-decoder-is-not-nodes) said the same thing, in more words. The
instruction was written by someone who had measured carefully, and it was wrong — because it named
*one* reason for the dependency, and by August 2026 the dependency had four more.

Node fixed the **single-byte** encodings. Its **multi-byte legacy** decoders still go through ICU,
and ICU is not the WHATWG index. Comparing Node 26.7.0 against `@exodus/bytes` over every one- and
two-byte sequence in each encoding the sniffer can name:

| Encoding | Sequences that differ | What Node does | What the spec says |
|---|---|---|---|
| `shift_jis` | 1,380 | 0x1A → U+001C, 0x1C → U+007F, 0x7F → U+001A, 0x80 → U+FFFD | An ASCII byte or 0x80 decodes to itself |
| `big5` | 6,891 | 0x80 → U+0080, 0xFF → U+F8F8 | Both are errors |
| `euc-jp` | 10,871 | 0x80–0x9F pass through as C1 controls | Not lead bytes; error |
| `euc-kr` | 13,457 | 0x80–0x9F pass through as C1 controls | Error |

Everything else — every single-byte encoding, UTF-8, UTF-16LE/BE, GBK, GB18030, ISO-2022-JP,
`x-user-defined` — now agrees exactly.

The Shift_JIS row is the uncomfortable one, because Shift_JIS is not a hypothetical here. The Aozora
Bunko edition of *I Am a Cat* is the worked example the whole encoding section of
[fetching.md](../project/fetching.md#character-encoding) is built on. Its title decodes identically
either way, which is exactly the kind of luck that lets a thing look tested.

So: the red test said "Node is fixed". The doc said "then the dependency can go". Both were true
sentences and the conclusion was false, and the way it would have failed is
[silent success](../reusable/silent-success.md) again — no crash, just a Japanese page arriving with
three control characters transposed and nobody's test noticing.

## Root cause

Not the Node upgrade. The Node upgrade is weather.

**The test asserted a fact about a third party rather than a requirement of ours.** `expect(viaNode)
.not.toBe(viaUs)` is a claim about Node's behaviour. We do not control it, do not depend on it, and
would be delighted if it changed. A test whose passing depends on somebody else's bug surviving is a
timer, and when it goes off it goes off in the worst possible register: a green suite turns red with
no local change, which reads as *our* regression, and the fastest way to make it green again is to
delete the thing it was guarding.

The second half of the cause is that **the justification and the pin drifted apart.** The dependency
was taken for windows-1252 in August 2026 and the test, the JSDoc and the doc all recorded that one
reason. Nobody ever wrote down the other four, because nobody had looked; the reason was true, it was
just no longer the whole reason. A pin that records one of five reasons will tell you to delete a
five-reason dependency the moment the first one lapses.

Introduced in `841ed6b` — *"Fetch a page properly, because other people's servers lie"* — which is the
commit that created the whole stage. The test was correct and well-evidenced on the day it was
written. It had a shelf life nobody costed.

## What changed

The dependency stays. Two tests replaced the one, and **neither one says anything about Node**:

- `decodes the windows-1252 C1 range as punctuation, not control characters` — asserts `decodeHtml`
  returns `€‘’“”–—`. This is the requirement. It was always the requirement; it was just sharing a
  test with a claim that wasn't.
- `decodes the Shift_JIS bytes Node's own decoder still gets wrong` — asserts `decodeHtml` of
  `[0x1A, 0x1C, 0x7F, 0x80]` under Shift_JIS is those four code points.

The second one is doing the guarding job the first used to do, and it is worth being precise about
why the shape is different. It catches the same regression — swap `SpecTextDecoder` back for the
global and it fails today — but it catches it by asserting **our** output, so:

- if someone breaks our decoder, it goes red, correctly;
- if Node fixes Shift_JIS tomorrow, it stays **green**. It never becomes a false alarm.

That is the whole trick. The old test could only tell you the dependency was still needed by
*failing*. This one tells you nothing when the dependency stops being needed — which is the right
trade, because "we could drop a dependency" is not an emergency and should not arrive as a red build.

Instead, [fetching.md](../project/fetching.md#the-decoder-is-not-nodes) now carries a copy-pasteable
one-liner that diffs the two decoders across all four encodings, so the question can be re-answered
in ten seconds by whoever next wonders. The doc, the JSDoc in [`src/fetch.ts`](../../src/fetch.ts)
and the test comments all now say *both* halves: what Node fixed, and what it hasn't.

## What would have caught it earlier

- **Writing the test as an assertion about us in the first place.** There was never a version of this
  where "Node is wrong" needed to be an assertion. It is an observation, and observations belong in
  the doc, where going stale costs a paragraph rather than a build.
- **Listing every reason a dependency is there, not the one that prompted it.** Ten minutes with a
  loop over 256 bytes × 32 encodings — which is all the table above is — would have found the
  multi-byte gap on day one, and the doc would have said "five reasons" instead of "one". The check
  is cheap enough that there is no excuse for having reasoned about it instead.
- **Noticing that a red test with no local change is a diagnosis, not a fix.** The failure said
  something in the environment moved. That is worth ten minutes before touching the assertion,
  because the loudest available fix — delete the assertion, delete the dependency — was the wrong
  one here and would have looked entirely reasonable in the commit message.

## The general shape

> A test that pins somebody else's bug is a countdown. It goes red when the world improves, it reads
> as your regression when it does, and the cheapest way to silence it is usually to remove your own
> defence. Assert what you require, and put what you merely observed in the doc.

The same question applies anywhere this repo pins external behaviour. Worth a look with this in mind:
the `classifyNetworkError` table in [`tests/fetch.test.ts`](../../tests/fetch.test.ts), which pins
Node's `cause.code` strings; the Readability edge cases in stage 2; and anything asserting what a
model returns. Most of those are fine — they pin a contract we depend on, which is the opposite case.
The one to watch is any assertion whose sense is *negative*: "X does **not** do Y". That is where the
countdown hides.

## See also

- [fetching.md § The decoder is not Node's](../project/fetching.md#the-decoder-is-not-nodes) — the
  measurements, the version history and the re-check command
- [silent-success.md](../reusable/silent-success.md) — how the deletion would have failed, and the
  family the original bug belongs to
- [third-party-library-selection.md](../reusable/third-party-library-selection.md) — the house rule
  the dependency was chosen under, which asks for the decision to be written down; this is the case
  for writing down *all* of it
