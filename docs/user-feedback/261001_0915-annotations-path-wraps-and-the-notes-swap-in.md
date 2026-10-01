---
reports: spya-dn3mjt, spya-dp63rf
ending: shipped
---
# Annotations: the path at the top wraps, and the notes swap in on a narrow window

Two suggestions from Greg (admin, verified: `feedback-reporter.ts` exit 0 on both rows), handled as
one entry (Overseer queue `qi-aytxwf8h`), both from
`/read/what-if-we-had-bigger-brains-imagining-minds-beyond-ours` on build `7aaead6d`. This session
ran on a pool account with no Sentry sign-in, so the Sentry status write is the next sweep's.

> Annotations mode has a rail at the top telling you where you are in the doc - the text is
> truncated too much

SPIDERYARN-READING2-7M (`spya-dn3mjt`), 2026-10-01 09:15Z.

> It would be great to be able to have Annotations mode (in the right-hand-column) *as well as*
> another mode in the left-hand-column.
>
> In other words, Annotations mode can be activated/deactivated independently of whatever other
> modes are active or not in the left-hand-column.
>
> But it's more complicated, because if I'm on a narrow screen, probably we can't show both left and
> right, so probably whichever has been activated most recently trumps/swaps out the other. Or
> something along those lines.
>
> And also consider how it should work on mobile.
>
> Use screenshots, spikes etc.
>
> If implementing this is going to create a lot of complexity, look for a simple, clean approach.

SPIDERYARN-READING2-7P (`spya-dp63rf`), 2026-10-01 09:38Z.

**Ending: shipped, both.** On `dev`, not deployed;
[261001k](../plans/261001k-annotations-head-path-wraps-and-the-notes-swap-in-on-a-narrow-window.md).

- **7P** was mostly built 85 minutes after it was filed, on a build Greg did not have: commit
  `eb76050d` ([261001i](../plans/261001i-annotations-column-beside-a-band-mode.md)) made
  Annotations a switch of its own (`?margin=1`) that stays on beside any band, both drawn from
  900px. What was missing was half of his narrow-window rule: a band pressed last already won, but
  pressing Annotations under a band did nothing visible, and a second press turned the notes off.
  Now, where the two do not fit together but the notes fit alone (612px and up), pressing
  Annotations swaps the band out. **Mobile**: on a phone held upright the notes do not fit even
  alone, so the press leaves the band open and nothing changes; a phone on its side swaps like a
  small window. Inline notes on a phone stay passed over, and the head alone on a phone (the path and
  the arc, no notes) is named as deferred.
- **7M**: the path at the top of the column (the part and the section) was one line ending in an
  ellipsis; each title is now on a line of its own and wraps, two lines each before it is cut. The
  arc sentence below it is still cut at three lines, with the whole of it on hover or tap — say if
  that was the part that read as too short.
