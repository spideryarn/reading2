---
reports: spya-pnnamg
ending: shipped
---
# A comment draft vanished, and Ask AI should be a button

Report `spya-pnnamg`, from Greg (admin), 2026-10-03 19:42, on the Entropy article, relayed by the
Overseer:

> I highlighted a word I didn't understand and clicked highlight or comment, and then I ticked the
> save and ask AI, and then clicked something else, and I don't know what happened, but it
> disappeared. So maybe save and ask AI should be a button, or I think it should auto-save, and so
> then ask AI would be a button. And it's just generally a bit confusing.

**Ending: Shipped**, on `dev`. Plan
[261003i](../plans/261003i-the-comment-box-never-loses-a-draft-and-ask-ai-is-a-button.md).

## What had happened

The box kept everything as an unsaved draft until **Save** was pressed, and the tick-box did
nothing when ticked: it only changed what Save would do later. Five things then threw the draft
away without a word: Cancel, the ×, Escape, selecting any other words in the article (a small
accidental drag was enough), and leaving the page. Which one took his cannot be told from the
report; all five are closed.

## What changed

- **Ask AI is a button.** The tick-box is gone. The box now ends **Discard … Ask AI, Save**. Ask AI
  saves the comment and opens the conversation on those words, in one press. It does not send
  anything to the model until you press Send there, exactly as before.
- **It auto-saves.** If you typed anything or picked a colour, every way out except **Discard**
  saves it: the ×, Escape, selecting other words, going to another page, reloading. Under the
  buttons it says so: *"Nothing is asked unless you press Ask AI. Closing this keeps what you
  wrote."*
- **Discard** (it was *Cancel*) is the one press that throws a draft away, and it sits on its own
  at the left.
- **On an iPad or phone the three buttons are finger-sized.** They were 25 to 29px tall.
- Underneath: a comment saved in the first moments after a page opens can no longer be wiped from
  the screen by the page's own first load of comments, and an edit or a delete can no longer
  overtake the save it belongs to.

## One place it is narrower than "it should auto-save"

**A box you never touched saves nothing.** Saving a bookmark the instant the box opens would leave
a mark behind every time someone selects a sentence only to copy it, which was Greg's own complaint
on 2026-09-05. So auto-save starts with the first thing you do in the box. If he wants the stricter
reading on touch, where pressing *Highlight or comment* is already a deliberate act, that is
`[Q-box-save-on-open]` below.

## Limits, said plainly

- A save that fails on the network **after** the box has closed is still lost (the Dock says the
  write failed). Keeping a recoverable copy is its own piece of work.
- Reloading or closing the tab saves on a best-effort basis; a crashed or killed browser saves
  nothing.
- By touch, a second box cannot be started while one is open: close the first (which saves it),
  then select again.

## Checked

GPT Sol reviewed the plan (six findings; one overruled after an Opus arbitration, recorded in the
plan) and the code twice. Browser check on desktop, an iPad profile in Chromium and WebKit, and a
phone width: 14 of 14, including his exact case (select a word, press Ask AI, nothing typed).

## Questions

**[Q-box-save-on-open]** On touch only, should pressing *Highlight or comment* save a plain
bookmark straight away, before anything is typed or coloured?
- **A (recommended): no**, as built. Nothing is stored until you do something in the box.
  Consistent with the mouse, and no stray marks. Costs nothing.
- **B: yes, on touch.** The press itself is the intent, so the words are bookmarked at once and the
  box only refines it; Discard would then delete it. About two hours. It gives up consistency with
  the mouse, and a mis-tap leaves a bookmark to clean up.

**[Q-highlight-menu]** (still open, from `spya-rze8qh`) bears directly on *"it's just generally a
bit confusing"*. This change makes the box safe; it does not make it light: marking a word still
means reading a quote, a colour row, a text field and three buttons. Option **B** of that question
(colour dots right at the selection, one press, and the box only when you choose *Comment…*) takes
the box out of the common case altogether. **Recommendation unchanged: B**, and this report is the
strongest evidence for it so far.
