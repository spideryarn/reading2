---
reports: spya-pmjy40, spya-wbhrm7, spya-usyhwy
ending: shipped
---

# Remember's header: the profile icon without words, a card on each sub-mode chip, and an (i) in short pieces

Three suggestions from Greg (admin; `feedback-reporter.ts` exited 0 on each report's production row),
2026-10-04 10:11-10:14 UTC, on `entropy-26-00481-with-cover-from-taylor-beck-spya-naz564`,
`?mode=remember` (the first with `&remember=quiz`). Batched by the Overseer as queue item
`qi-r88mcqag` because they are one subject.

`spya-pmjy40` ([SPIDERYARN-READING2-BY](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-BY)):

> In remember mode, you don't need the words written for you at the top. Just the little profile icon should be sufficient with a rich tooltip, and the same goes for any other modes.

`spya-wbhrm7` ([SPIDERYARN-READING2-BZ](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-BZ)):

> Provide rich tooltips for the remember mode submode buttons ant the top and any other submodes.

`spya-usyhwy` ([SPIDERYARN-READING2-C0](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-C0)):

> In the remember mode information tooltip, you do describe all of the different submodes, but in a previous feedback I said that each submode button should have its own tooltip. I still agree with that. I'd also say that for the rich tooltip for the remember mode information, it's like one big paragraph. Prefer smaller paragraphs or bullet points because it's much clearer.

**Shipped**, all three, as
[261004f](../plans/261004f-remember-header-profile-icon-only-and-a-card-on-each-sub-mode-chip.md):

- **`spya-pmjy40`.** The profile badge is an icon with no words in every mode (Quiz was the last one
  printing *written for you*), and it has a rich card on hover and keyboard focus. Pressing it still
  opens the profile panel, and the card gives way to the panel.
- **`spya-wbhrm7`.** Recall, Tutorial, Explore and Quiz each have their own card. The other five
  modes with sub-modes (Summary, Structure, Debate, Referee, Diagram) already had one per chip, so
  nothing changed there.
- **`spya-usyhwy`.** Remember's (i) is two short sentences and a four-line list. The same shorter
  sentence is on the Remember button's card in the bottom bar. The rule is written into
  [tooltips.md](../project/tooltips.md).

**Deferred, with its own queue entry (`qi-mw43dd2y`, source `spya-usyhwy`):** the same treatment for
the other modes' (i) and bottom-bar cards that are one long paragraph. The report was about
Remember's; the sweep is a separate copy job in which every sentence is a checked claim.

The Sentry status write was not attempted from this session (a pool account with no Sentry sign-in);
the next sweep does it from this note.
