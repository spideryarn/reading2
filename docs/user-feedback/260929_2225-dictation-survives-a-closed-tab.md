# A closed tab no longer loses a dictation

SPIDERYARN-READING2-5M (`spya-bukkzu`), from Greg (admin, verified by account id), filed from the
Feedback dialog on `https://www.spideryarn.com/`. The time in the file name is when this session
picked the report up. The report text came in the brief, because this session had no Sentry access.

> I often find myself really saying a lot into these feedback boxes, talking for a few minutes, and
> I would be really sad if at the end of a few minutes of really rich thought, the contents got lost
> because, I don't know, there was a bug or the internet connection dropped or something like that.
> [...] if there's an easy, simple, clean way to make things robust, so maybe you store the audio or
> you just upload the audio if the transcript failed or something. [...] or maybe say, look, it
> failed but nothing's been lost. Try again when you have an internet connection. That's always a
> bit dodgy because the browser may just kind of throw away the tab. [...] try and make this voice
> input machinery pretty reusable across all the other places where we're doing it so that they all
> benefit from this.

**Ending: Shipped.** It is on `dev` and not deployed. Resolve 5M; the next feedback sweep does the
Sentry status write.

**What could still lose a dictation was the tab going away.** A failed upload already kept its
audio and offered Try again. But that audio lived only in the page, so closing, reloading or
crashing the tab lost it. So did the browser throwing the tab away, as Greg guessed it might.

**The fix, in every microphone box at once:**

- While you talk, the recording is also saved on your device, second by second.
- It is deleted once your words are in the box, or when you discard it.
- If the page goes first, the next time that same box is open you see *"A recording from earlier
  wasn't transcribed before the page closed. Nothing was lost"*. It comes with the usual
  **Try again**, **Save** and discard buttons.
- If the page died while you were still talking, the message says the last few seconds may be
  missing instead (`[mic-cut-off]`).
- When an upload fails, the row now says *"The audio is kept on this device, even if you close the
  page"*. It only says so when the copy really was saved.

**Where it applies.** Feedback, chat, comment follow-ups, annotations, quiz answers and both profile
boxes. The Feedback box only offers a recording back while the dialog is open.

**Privacy.** The copy never leaves your device just by being kept. It goes when its words are in the
box, when you discard it, when you press Sign out, or the first time you come back after a week.
`/privacy` now says so.

**What is left for Greg:**

- **The words in the box are not kept across a reload.** Once the transcript lands, the audio is
  deleted. If the tab then dies before you press Send, the text is lost, just as typed text would
  be. Keeping the Feedback draft itself is the natural next step; it is named in the plan.
- **Not tried on an iPhone or iPad.** In Chrome, a recording cut off mid-sentence was measured to
  decode, losing under a second. Safari was not measured.

Plan: [260929h](../plans/260929h-dictation-that-survives-a-closed-tab.md), reviewed by GPT Sol at
the plan and at the code.
