---
reports: spya-gdv6dk, spya-esh49q
ending: shipped
---
# Every model on its latest version; Haiku 5.5 and an Opus digest, measured

Reports `spya-gdv6dk` (2026-10-08 22:40 UTC) and `spya-esh49q` (22:46 UTC), both from Greg (an
admin, proven by `scripts/feedback-reporter.ts` exit 0), taken as one piece of work.

> There's a new Claude Haiku 5.5 model that is cheaper than GPT Luna, especially for prompts fewer
> than 100,000 tokens, and apparently pretty good. Can you do some web research with Sonnet and
> consider whether there are places where we might want to use this, and then run some evals to see
> how it compares.

> we should check that we're using Sonnet 5.5, or in fact, we should always be using the latest
> versions of any of our models. So that's worth a minimal update to our docs. […] It crossed my
> mind to wonder whether we could do some kind of initial preparatory work with a frontier model
> like Opus 5.5 […] then cheaper, less capable models, when given the article plus this output from
> Opus, would be able to do basically as good a job as Opus would have done

**Ending: shipped**, on `dev`. Plan:
[261009a](../plans/261009a-latest-model-versions-haiku-5-5-and-an-opus-digest-spike.md); write-up and
recommendation:
[investigations/261009a](../investigations/261009a-haiku-5-5-and-an-opus-digest-for-cheaper-models.md).
**$5.65 of OpenRouter spent**, against a $10 ceiling.

- **Latest versions.** The capable tier was on Sonnet 5; it is now Sonnet 5.5, same price, and
  nothing Sonnet 5 wrote reads as stale. The quick tier, help chat and PDF reader moved from GPT-5.6
  Luna to GPT-6 Luna, at half the price; quiz verdict needed a fix to survive the move (it now asks
  for no reasoning). Two jobs stay back where a measurement said the newer model is worse at that
  job: Summary's fidelity guard (GPT-5.6 Luna — 44 needless alarms, no extra faults caught) and the
  PDF figure locator (Gemini 3 Flash preview — 3.8 is three times the cost and wait for no gain).
  The rule is one paragraph in [setup-dev.md § Which model everything uses](../project/setup-dev.md#which-model-everything-uses).
- **Deferred half, queued:** the Overseer's attention classifier and the fleet describer still run
  GPT-5.6 Luna; they need a request change first. Overseer queue `qi-w49xhv3r`.
- **Haiku 5.5:** no job for it today. It ties GPT-6 Luna on price under 100k tokens and costs 5×
  more above, and its tokenizer counts ~38% more tokens; it was level or behind on help chat, title
  tidy and the reading tasks.
- **The digest:** given an Opus digest, Sonnet 5.5 was the best of five arms on both blind judges,
  above Opus alone — but Haiku with the digest stayed about a point behind Opus, so it is a quality
  idea, not a way to get Opus quality from cheap models. On the summaries: Summary has been written
  on Opus since 2026-10-01, and on these articles Sonnet 5.5 alone scored level with it. The
  write-up's recommendation ends with what to try next and where the per-article cost really goes.
