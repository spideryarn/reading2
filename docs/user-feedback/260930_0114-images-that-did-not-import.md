# Articles whose images did not import

**[SPIDERYARN-READING2-6A](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-6A)** · reported
2026-09-30 01:14 UTC · kind: suggestion · from an admin (Greg) · *shipped* — with production re-runs
and one question left for Greg

## What Greg said

> I think you now have access to the production database. So have a look at some of the articles,
> and look for cases where the images didn't import correctly, and check that they now do. This might
> involve going back to the original sources to see, you know, what it was about the images that
> caused a problem and consider what fixes might solve things, and then, you know, run spikes to see
> if you can fix them and then make whatever updates are needed so that going forwards it won't be a
> problem. Now, in some cases, I can imagine this potentially would require real complexity or risk.
> If that's the case, probably hold off. We're only looking for sort of clean, general, robust
> approaches that won't add too much complexity. If it's going to be loads of complexity, it's really
> hard, then let's discuss it first. Prioritise your changes by a combination of ease and value.

## What we did

Production was readable from the box for the first time, and was read and never written. Every query
ran in `begin read only … rollback`, and the bucket was read by `object/info` only. Of 41 live
articles, five causes, ranked by ease × value in
[the plan](../plans/260930e-figures-readability-deletes-with-their-wrapper.md):

1. **Built, on `dev`: figures Readability deleted along with their wrapper.** A picture has no text,
   so the `div` around it is judged by the link text beside it. On Springer Nature pages it was the
   *Full size image* button (8 of 8 figures lost on a Nature Neuroscience article; also Scientific
   Data). On Substack it was a caption with a link in it (9 of 23 lost). The button is now furniture,
   and a rule before Readability unwraps a wrapper only where Readability's own link rules would
   delete it. Both run under the existing prose fallback. GPT Sol reviewed the plan and the code.
2. **Already fixed: 113 images across 4 articles failed `storage`**, the 415 of
   [260903f](../postmortems/260903f-the-bucket-allowlist-drifted-again-on-production.md). They need
   a re-run.
3. **31 PDF figures on 8 articles were refused before the model locator shipped** on 2026-09-28.
   They need a re-run.
4. **For Greg to decide: PDF figures the locator also refuses.** `ambiguous` (two figures on one
   page) is 36 of the 53 failures; one article made 4 locator calls and got none. Doing better is the
   multi-figure pairing the earlier PDF plans deferred on purpose, so it is written up and not built.
5. Small ones: three articles from before the step existed, three PDFs from before figure markers
   (these need a paid re-extraction), and a lead illustration Readability leaves out by design.

All 63 stored images are really in the bucket.

**The production re-runs are listed in the plan**, § *What production needs*, and none has been
run. They are writes to production: the three web articles need the article's **Reset**, and the
rest need `npx tsx scripts/stage.ts assets <slug>`. The web ones only help after this code is
deployed.
