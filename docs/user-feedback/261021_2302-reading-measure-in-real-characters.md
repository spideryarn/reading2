---
reports: spya-vywcpu
ending: shipped
comment: You counted right: 70. Now about 60 a line (at most ~65 on nine lines in ten) at every text size. Phone margins were already minimal. One follow-on question for you: q-z3j0ep, Marginalia's gap vs band widths.
---
# The reading measure, counted in real characters

An administrator's report (`feedback-reporter.ts` exit 0, no addenda), #673, from a portrait iPad,
Plain view, Rovelli's *The Order of Time*:

> I did a rough count of the number of characters visible horizontally, and I think it was more like
> 70. … I thought we had done some research on the ideal sort of reading width … between sort of about
> 45 and 65. So it seems as though the column is now a bit too wide. … if we haven't done the
> research, do the research, and then let's try and, where we can, stay within these bounds. … on a
> portrait iPhone … keep the margins horizontally as absolutely small as possible … when we have
> space, that we are optimizing the reading experience. … If there are other things that make a
> difference, I don't know, line spacing, paragraph spacing, blah blah, then let's try and optimize
> those too.
>
> — Greg, 2026-10-21 23:02 UTC (`spya-vywcpu`)

**Ending: Shipped** to `dev`, not deployed. Plan, with GPT Sol's plan and code reviews:
[261022d](../plans/261022d-reading-measure-in-real-characters.md). Evidence:
[261022a](../research/261022a-reading-measure-line-spacing-and-paragraph-spacing-evidence.md).

- **He was right: median 70 characters a line** (p90 75, longest 80), measured at his iPad's
  725×967. The cause was the unit: `ch` is the width of a zero, and in Source Serif a zero is wider
  than the average character, so `65ch` held 70. Now `56ch`: median 60, p90 64, longest 69, at
  every text size wherever there is room. The rule is in
  [typography.md § The measure](../project/typography.md), and `scripts/measure-line-length.ts`
  counts it.
- **Text size**: his report from nine minutes later (`spya-e5t77w`) says `default` on that device.
  The setting is per device, so a home-screen app may not share Safari's.
- **Phone margins** were already at their minimum (12px rail + 0.6rem left; the right holds the
  reading mark): 42 characters on a 390px iPhone. Unchanged.
- **Line spacing (1.6) and paragraph spacing**: the evidence supports keeping both. The one fix is
  that a footnote mark no longer opens up its line (31px → 27px).
- **Quotations and callouts** stay narrower than the body, whatever the measure.
- **Corrected**: the "80 characters read 7% faster, 12% worse comprehension" figure we had been
  citing is not in the paper (Dyson & Kipping 1998).
- **Held for Greg**: the layout's lone-column cap is now wider than the text. Bringing it down
  moves Marginalia's notes ~120px closer, and it also widens mode bands on iPad-landscape windows:
  [q-z3j0ep](questions/q-z3j0ep.md).
