# Dictation is slow on a weak connection

**SPIDERYARN-READING2-39** · 2026-09-12 08:18Z · Greg (admin, established with
`scripts/feedback-reporter.ts`) · an iPad, in production, from the Feedback dialog.

> Using the voice mode works quite well to dictate, like, a message, like in the feedback dialog, but
> it's quite slow. I'm on an iPad on a not very good Wi-Fi. I don't know where that slowness is. Is it
> the transcription? I wonder if it's the upload. Is there any way in which we could upload something
> more compressed, or I don't know, try running some spikes to measure this on a slow internet
> connection and see if you can figure out where the slowness is and then improve it so that voice
> dictation feels much snappier.

**Ending: in progress.**

It is the upload: an iPad records dictation at 192 kbps, several times what speech needs, and on a
1 Mbps link that is ~10 s of upload against ~2 s of transcription.
[260912b](../plans/260912b-dictation-slow-on-weak-wifi.md).
