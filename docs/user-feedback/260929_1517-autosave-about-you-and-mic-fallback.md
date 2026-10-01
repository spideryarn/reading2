---
reports: spya-k3q9mc, spya-czbj9r
ending: shipped
---
# "About you" saves itself and says so; the microphone stops warning about the one it opened

Two of Greg's own reports from the Feedback dialog (he is admin; `scripts/feedback-reporter.ts`
confirmed both rows). Neither reached Sentry (`mirrored_at` is null on both), so there is no Sentry
issue to resolve. Neither had been built: checked against `git log origin/dev`, `docs/plans/`, this
directory and `gjd-remote ls` on 2026-10-01. Text read from production, read-only. The time in the
file name is the earlier report's.

`spya-k3q9mc`, 2026-09-29, the Feedback dialog on an iPhone:

> On iPhone in feedback I got this message when I tried to use the mic after accepting the
> permissions dialog
>
> The microphone you chose isn't available. Using another one.
>
> This was we were using AirPod headphones on an iPhone. Weirdly, it did actually seem to work. So
> the text got added, but it gave me this error message. I get the sense that usually there's a
> post-processing step where an LLM of some kind tidies things up. That didn't seem to run, as far as
> I could tell. But so it seems like it works to a greater degree than it would seem, but not
> completely.

`spya-czbj9r`, 2026-09-30, `/profile`:

> In the "Profile / About You", make it clearer when it has saved (e.g. show some loading spinner and
> then green-checkmark or similar. And if I try and close the page before it has saved, either warn
> the user, or auto-save. Maybe auto-save any time it has been idle for a few seconds?
>
> Perhaps this could be a reusable text-input-box auto-save component that we could reuse in other
> places (e.g. Article/Metadata/Why are you reading), etc?

**Ending: Shipped.** On `dev` as `COMMIT`, not deployed.

What we did ([plan 261001l](../plans/261001l-autosave-about-you-and-honest-mic-fallback.md)):

- **About you, and Why you're reading this one** (Metadata) both save two seconds after you stop
  typing, as well as when you click away. Underneath, the box says *Unsaved changes*, then a spinner
  and *Saving…*, then a green tick and *Saved*, or *Not saved* and why. If you close or reload the
  page with a save still pending, the browser asks first; on a phone, where it cannot ask, hiding the
  tab saves. The reusable part is two pieces: the box (`ProfileBox`) and the save behind it
  (`useAutosavedText`), so another box that holds saved text can use both.
- **The microphone warning.** Your chosen microphone's saved id stopped working, so the app opened
  the default one instead, which may well have been the same AirPods. Why the id went stale on iOS
  is not known. The app now remembers the microphone's name as well as its id. If the one that
  opens is the only input with that name, and it really is that input, there is no warning and the
  new id is kept. Otherwise it still warns, and now names both: *Couldn't use the microphone you
  chose (AirPods Pro), so this is using iPhone Microphone.* A choice saved before names were kept
  gets one warning and is then forgotten. Not testable on an iPhone from here. The tests fake the
  three cases.
- **The tidy-up step did run.** All five of your dictations in the five minutes before the report
  went to the transcriber and came back fine. On an iPhone there are no live words, so the text that
  appeared *was* the transcribed text. There is no second step that rewrites it. The only clean-up
  after transcription is removing ums and ahs.
