---
reports: spya-nbmce7, spya-q2w7yt, spya-gm858u
ending: shipped
comment: spya-nbmce7: Most now always longer than More; whether More must also beat Gist is q-vzd2xt
---
# Skim: a deeper pass is never shorter, Most beats More, and the prose has ‹ Previous stop

Three admin reports from Greg (`feedback-reporter.ts` exit 0 on each), filed 2026-10-09
23:44–23:47 UTC from Skim on `arxiv-1706-03762-spya-wyt7j0` (build `5f6d3d5f`): `spya-nbmce7`
(#532, `SPIDERYARN-READING2-GC`), `spya-q2w7yt` (#535, `-GF`), `spya-gm858u` (#533, `-GD`). Overseer
queue item `qi-67k544sa`. This session had no Sentry sign-in and did not write the Sentry status;
the next feedback sweep does.

> Levels of the skim mode were supposed to get more and more detailed, and yet in this case it seems
> as though the most detailed skim submode has fewer steps than the middle one.
>
> — Greg, 2026-10-09 (`spya-nbmce7`)

> Feedback report about the more, the higher level skim submodes not having as many steps. I just
> reran it again and it seemed to have more this time. I don't know.
>
> — Greg, 2026-10-09 (`spya-q2w7yt`)

> In skim mode, perhaps add a previous step as well as a next step in the article text. Perhaps the
> previous step is on the left-hand side and the next step is on the right, as it already is.
>
> — Greg, 2026-10-09 (`spya-gm858u`)

**Ending: Shipped**, all three. On `dev` and not deployed. Plan
[261010t](../plans/261010t-skim-deeper-passes-always-longer-and-a-previous-stop-door.md).

- **Why Most was shorter.** The rule that the passes grow still counted them the way they worked
  when More contained Gist. Since 2026-09-29 each pass walks only its own stops plus a few carried
  in, so nothing checked what you walk; your route was Gist 3, More 5, Most 4, and the re-run grew
  by luck. 8 of 29 production routes had a pass no longer than the one before. Postmortem
  [261010a](../postmortems/261010a-a-check-guarding-a-walk-that-had-changed-under-it.md).
- **Now (`skim/12`):** the rule counts each pass as walked, **Gist ≤ More < Most**; the prompt's
  targets are per pass; and a route that still breaks it is repaired before it is saved (a carried
  stop dropped, or the least important stop moved one pass deeper). Measured on six articles,
  two runs each: the old prompt broke the rule in 6 of 12 runs, the new one in 0 of 12
  ([261010a](../investigations/261010a-skim-per-pass-targets-and-walked-growth.md)). Gist's Idea
  coverage is 22–23 of 49 against the old prompt's 24–25, a marginal miss on two runs.
- **More may equal Gist.** Strictly longer was built and measured first, and on short articles it
  cut Gist to two stops and its coverage to 20. That choice is yours:
  [q-vzd2xt](questions/q-vzd2xt.md).
- **Routes planned before this keep their shape** until planned again from Metadata, including any
  of the 8.
- **‹ Previous stop** sits on the left of the door under the current stop, from stop 2 of a pass on;
  Next stop › / More detail › stay on the right. It does what ← does.
