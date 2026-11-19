# Role-play review: three small layout choices for the Sources digest

You are reviewing a design, not editing code. Do not change any file.

## The product, in short

Spideryarn is a reading app that **augments** reading rather than replacing it: it helps the reader
read efficiently but deeply, and internalise and interrogate. The article is in the middle; a band
beside it holds "modes" that take turns (Summary, Sources, Chat, …). Read
`docs/project/vision.md` (first screen) and `docs/project/principles.md` § 2 (progressive
disclosure: start clean, always a way further) and § 3.

**Sources › Digest** (new, experimental, owner only): one text about the piece's sources — a two-to-four
sentence overview, then four headed sections (*What it builds on*, *Who has taken it up*, *What it may
have missed*, *Worth checking: citations that may not say that*). Each section is a few short
paragraphs. Each sentence that names a passage is a link that lights while that passage is on screen
and jumps to it. Each paragraph has its passage-id chips, a **More** fold (the detail, then each source
with the exact words checked on its page) and its own **Ask in chat** button. At the foot: a folded
*What was searched*, then an **ask box**, then *Write it again*. A run costs about $1 and takes minutes,
once. Summary has the same ask box under its Brief and Fuller text. Each chat started this way is
listed in Chat as "Started from the digest" / "Started from Summary › Fuller", with a way back.

Full description: `docs/project/sources.md` § Digest. Code: `src/web/SourcesDigestPanel.tsx`.

## Screenshots of what is built (option A of everything)

In `/tmp/claude-1000/-home-greg-code-spideryarn2/81bb468f-ff19-49f0-93d2-930f31976680/scratchpad/shots/`: look at every PNG there (use the Read tool on each). The notes from the person who took
them are at the end of this brief.

## The three choices

### 3a. Where you ask

```
 A (built): both                          B: only per paragraph
 ─────────────────────────────            ─────────────────────────────
 WHAT IT BUILDS ON (i)                    WHAT IT BUILDS ON (i)
   Short paragraph…                         Short paragraph…
   k3m9qt  ▸ More           [💬]            k3m9qt  ▸ More           [💬]
 WHO HAS TAKEN IT UP (i)                  WHO HAS TAKEN IT UP (i)
   …                                        …
 ▸ What was searched (14 q, 28 s)         ▸ What was searched (14 q, 28 s)
 ┌──────────────────────────────┐
 │ Ask about this digest…  [Ask]│         (no box)
 └──────────────────────────────┘
 [Write it again]                         [Write it again]
```

### 3b. How long it is

```
 A (built): one level, More per paragraph   B: two levels, like Summary
 ─────────────────────────────────          ─────────────────────────────────
                                            ( Brief | Fuller )
 WHAT IT BUILDS ON (i)                      Brief: the overview and one short
   Two or three sentences.  ▸ More          paragraph per section, no More.
     (More: the detail, the sources         Fuller: what A shows, with each
      and their checked quotes)             paragraph's More.
                                            (costs a second write, ~+$0.35,
                                             or one bigger write)
```

### 3c. After you press Ask

```
 A (built): the chat opens in Chat's band   B: the chat grows inline under the box
 ─────────────────────────────────────      ─────────────────────────────────────
 band switches to Chat:                     band stays on the digest:
  ┌ Chat ───────────────────────┐            …digest…
  │ You: Which sources disagree │            ▸ What was searched
  │ AI: …answer streams here…   │            You: Which sources disagree…
  │ [reply…]                    │            AI: …answer streams here…
  └─────────────────────────────┘            [reply…]
 back on the digest, the box is replaced by
 the chat's mark (the shared control every
 mode uses for "this item has a chat"):
   💬 2 · the chat's gist or last answer…
 pressing it opens that chat in a card
 beside the digest.
```

B in 3c means a second place that draws a chat (a new embedded chat view inside a mode), which the app
does not have today: every other mode's "Ask in chat" opens Chat's band.

## Your role

{ROLE}

## What to return (under 450 words)

For each of 3a, 3b, 3c: your pick (A, B, or a specific variant you would prefer), and in two or three
sentences why, from your role. Then **up to three other things in the screenshots** you would change,
most important first, each concrete (what, where, to what). Be candid; "it's fine as built" is a valid
answer. Do not propose new features beyond these choices.

Out of scope: the look of the per-paragraph chat button (the bordered square) and of the chat's mark.
Both are the shared controls every mode uses for the same job (Glossary, Bibliography, Ideas, Where it
sits…), and the house rule is that controls doing the same job look the same everywhere. You may say
they are a problem, but say it as a note, not as one of your three changes.

## The screenshot-taker's notes

The `a*` shots are an early 5-paragraph seed whose box had already become a mark; the `b*` shots are a
realistic 12-paragraph digest (about 490 words, scroll height 2,034px at 1440×900) and are the ones to
judge. The model call behind the chat is refused locally (the key is at its limit), so the chat shows an
error where an answer would be; ignore that.

- Rhythm: every paragraph is the same unit: prose; then the faint passage-id chip and *More* on one
  line; then the bordered chat icon at the right. Section heads are small grey capitals with an (i), no
  rule above, and only slightly more space above them than between paragraphs, so in the full-column
  shot (b9) the four sections are hard to tell apart at a glance. Sentences whose passage is on screen
  are tinted, so several paragraphs show a wash.
- More open (b3): a left-ruled block, the detail in grey, the source as an orange link, its quote in
  the UI face, brighter than the prose.
- Foot (b4, b8): *What was searched* (folded), the ask box ("Ask about this digest…", a quiet *Ask*),
  a rule, then *Write it again* and the date.
- After Ask (b5): the band switches to Chat, with a "Back to …" line to the digest; the digest's text
  is the first message, fenced.
- Back on the digest (b6): the box has become the mark, "💬 1 · No answer yet", one quiet line.
- Phone (b7, b8): works at 390px; the longest heading wraps to two lines.
