---
reports: spya-y6590g
ending: shipped
---
# Referee's hidden-instructions check: a sub-mode, in plain words

`spya-y6590g`, filed as a suggestion by Greg (admin; `feedback-reporter.ts` exit 0 on the
production row), 2026-10-07 05:44 UTC, from Referee mode on `2608-13566v1-spya-yurten`. Sentry
`SPIDERYARN-READING2-EH`. Overseer queue item `qi-vczavx82`. This session has no Sentry sign-in and
did not write the Sentry status; the next feedback sweep does.

> Re Referee / Hidden instructions:
> - Perhaps squirrel this info away as a sub-mode? It doesn't seem important enough to be right at
>   the top of Criteria
> - And it found stuff like `Characters that render as nothing / math#footnote1.m1.ltx_Math >
>   semantics > mrow > mo / 1× zero-width space U+200B`. Firstly, this is uninterpretable gibberish
>   to the user, and secondly it looks innocuous. Let's pre-filter with a small LLM to try and only
>   show stuff that might actually be of real concern/interest.

## What we did

Plan, both GPT Sol reviews and the questions:
[261007h](../plans/261007h-referee-hidden-instructions-become-a-sub-mode-in-plain-words.md).
What the band is now:
[referee-mode.md § The scan has its own chip](../project/referee-mode.md#the-scan-has-its-own-chip-since-2026-10-07).

- **Hidden text is its own sub-mode**, the fifth chip. Notices no longer opens itself, and holds only
  the confidentiality sentences. The chip shows a dot when something unexplained was found.
- **Each finding is in plain words**: what the trick is, then the CSS path and code points last and
  small. The 39 identical zero-width-space rows on that paper are one row, *39 times*. GPT Sol's
  code review also made the panel print direction-control characters as visible code points, and
  cap the length of a path a document wrote
  ([postmortem](../postmortems/261007h-escaped-attacker-text-can-still-control-presentation.md)).

## Deferred, for Greg

The pre-filter itself was not built. Any change to what the scanner flags is a change to a security
defence, and the text a small model would judge is written by whoever hid it, so a hidden "this is
harmless" could talk it into hiding the attack. The plan recommends a deterministic rule instead:
label a lone zero-width character inside MathML as ordinary typography. That is
[Q-scan-mathml] in the plan's § Questions for Greg, queue item `qi-xwj659j8`, and a line in
[awaiting-approval.md](awaiting-approval.md).
