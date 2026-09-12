# Dictation is slow on a weak connection

**SPIDERYARN-READING2-39** · 2026-09-12 08:18Z · Greg (admin, established with
`scripts/feedback-reporter.ts`) · an iPad, in production, from the Feedback dialog.

> Using the voice mode works quite well to dictate, like, a message, like in the feedback dialog, but
> it's quite slow. I'm on an iPad on a not very good Wi-Fi. I don't know where that slowness is. Is it
> the transcription? I wonder if it's the upload. Is there any way in which we could upload something
> more compressed, or I don't know, try running some spikes to measure this on a slow internet
> connection and see if you can figure out where the slowness is and then improve it so that voice
> dictation feels much snappier.

**Ending: shipped** — on `dev`, not deployed.

What changed: on an iPad (and in Safari) the recording now asks for 48 kbps instead of WebKit's
default 192 kbps, so a dictation uploads roughly four times less; Chrome and Firefox are unchanged.
The server's log line now says what rate each recording actually arrived at.

Two things for Greg, neither blocking:

- **After the next deploy, one dictation on the iPad**, and then the `dictation transcribed` log line
  for it: `kbps` ~48 means the hint was taken, ~192 that it was silently refused. Best done with the
  same passage read once before the deploy and once after, to check the transcript did not get worse
  (nothing on the box can record AAC, so 48 kbps AAC has no quality measurement yet).
- **A question: Opus/WebM first on every browser?** About 3.5× smaller again on Chrome and on iPads
  running 18.4+, at the price of a failed dictation's saved recording being a `.webm`, which a Mac or
  an iPad will not open with a double-click. Not built; one line if yes.

The size of the upload is the biggest lever: an iPad records dictation at 192 kbps, several times what
speech needs, and on a modelled 1 Mbps link that was ~10 s of upload against ~2 s of transcription.
(Your actual link was not measured, so that is the strongest lever rather than a proven cause.)
[260912b](../plans/260912b-dictation-slow-on-weak-wifi.md).
