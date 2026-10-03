---
reports: spya-ub4jnc
ending: shipped
---
# The where-am-I rail runs to three lines on a phone, and a map doc for phones and touch

One report from Greg, filed 2026-10-03 from an iPhone in portrait, relayed by the Overseer as an
admin's report (queue item `qi-m5efr853`). Proven from the production row with
`feedback-reporter.ts --report-id` (exit 0). SPIDERYARN-READING2-BB.

> The rail at the top that shows where I am is especially valuable on iPhone in portrait mode
> because I can't show the structure mode and the text at the same time. So perhaps it would be
> helpful to allow the rail to be two or maybe three lines, because right now it's like too
> truncated in portrait mode on an iPhone for it to be very useful. I can't tell whether it would
> also make sense for this to be the case for other devices, so maybe you could try experimenting
> with some screenshots with different widths and stuff like that. Also, it may be worth, if we
> don't already, having a document for touch devices and maybe even sort of iPhone or portrait
> iPhone specifically, with signposts to where we're doing stuff that's iPhone-specific and what
> policies we're applying that are specific to touch devices and whatever, and capturing my intent
> from previous conversations and feedback reports and stuff like that.
>
> — Greg, 2026-10-03 (`spya-ub4jnc`)

## What we did

Plan, GPT Sol's reviews, the experiment and its screenshots:
[261003n](../plans/261003n-where-am-i-rail-on-two-or-three-lines-on-a-phone-in-portrait-and-a-phone-portrait-doc.md).

- **The rail is three lines on a narrow window.** The headings breadcrumb puts the parts above on
  the first line and the section you are in on up to two more, in a bar 68px tall where it was 44.
  Before, a phone showed the part as its number alone and cut every long section title.
- **Only a narrow window gets it.** Three shapes were shot at eight widths: one line cuts crumbs at
  430px and below and nowhere wider, so the tested iPad and landscape-phone widths are unchanged; a
  desktop window dragged equally narrow gets the same treatment. Two lines still cut the section at
  320; three never did.
- **A map doc**: [phone-and-touch.md](../project/phone-and-touch.md). Greg's words on phones, iPads
  and fingers, quoted and dated; every policy in one line with the doc that owns it; and a table of
  where the code branches on the device. [touch.md](../project/touch.md) and
  [narrow-windows.md](../project/narrow-windows.md) still own the detail and point to it.

## Left for Greg

Two questions, in the debrief and in the plan: whether two lines (12px shorter, cuts the longest
titles on the smallest phones) would be better than three; and that the two rows are 28 and 39px
tall to press, under the 44px we hold other controls to, because the only fix is a taller bar.

Not checked on a real iPhone: the browser check was Chrome and WebKit at phone sizes on the box.
