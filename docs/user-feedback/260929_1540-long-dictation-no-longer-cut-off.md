# A long dictation is no longer cut off at two and a half minutes

SPIDERYARN-READING2-5B (`spya-a0ep9m`), from Greg (admin), filed from the Feedback dialog. The time
in the file name is when this session picked the report up. The report text came in the brief,
because this session had no Sentry access.

> Argh, I just got this error when recording a long message in the Feedback:
>
> "That was as much as we can transcribe at once. The rest wasn't recorded. [mic-full]"
>
> Is there any way we can avoid or fix or mitigate or work around this? I mean, at the very least,
> e.g. could you stop it and immediately restart it and append?

**Ending: Shipped.** It is on `dev` and not deployed. Resolve 5B; the next feedback sweep does the
Sentry status write.

**The cause was our own limit, not the transcription service's.** Each recording goes to the server
in one upload. Vercel refuses any upload over 4.5 MB, so the recorder stopped at 2.1 MB of audio,
which is about 2½ minutes in Chrome.

**The fix is Greg's suggestion, done out of sight.**

- Every two minutes, the recording quietly starts a new part.
- Each finished part is sent for transcription while you are still talking.
- When you press stop, the parts' text is joined in order and put in the box once.
- If any part fails, nothing half-finished goes in the box. The audio is kept, and Retry re-sends
  only the parts that failed.
- This applies to every microphone box, not just Feedback.

**What it costs.** No new provider, and no extra spend beyond paying for the seconds you actually
recorded.

**What is left for Greg:**

- **The whole dictation still stops at five minutes.** That is roughly what the Feedback box's
  4,000 characters hold. The change is that Chrome no longer stops at 2½. The limit is one constant
  (`MAX_MS` in `src/web/mic-recording.ts`) if you want more. Past about five minutes, the text will
  not fit the Feedback box.
- **The join between parts loses about 70 ms of audio**, measured in Chromium. That can garble at
  most one word every two minutes.
- **Not yet tried on an iPhone or iPad.** Safari's side is reasoned, not observed; Playwright's
  WebKit on this box has no recorder to test with.

Plan: [260929f](../plans/260929f-feedback-thank-you-as-a-toast-and-dictation-that-never-runs-out-of-tape.md)
§ Part B, revised after review.
