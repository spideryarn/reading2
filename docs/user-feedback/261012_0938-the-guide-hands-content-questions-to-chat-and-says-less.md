---
reports: spya-es283p
ending: shipped
comment: Ask the guide about what the article says and it now offers an orange "Ask in Chat" button that starts a new Chat with your question. Its next steps sit under a heading and stand out more, and it says about half as much.
---
# The guide hands content questions to Chat, its next steps stand out, and it says less

An admin suggestion from Greg (`scripts/feedback-reporter.ts` exit 0), #576 `spya-es283p`
(SPIDERYARN-READING2-HT), filed 2026-10-12 at 09:38 UTC from `/changelog`, build `378ca6cb`. Queue
item `qi-6zjz6m4r`, session `fbes283p-guide-hands-off-to-chat`. Plan and both GPT Sol reviews:
[261012f](../plans/261012f-guide-hands-content-questions-to-a-new-chat.md); the measurement:
[261012a](../investigations/261012a-guide-hands-off-to-chat-and-shorter-measured.md).

> If you ask the guide chat something substantive about the content itself, I wonder if it would be
> better to actually spawn a new chat and say, okay, my job here is just to help you figure out how
> to use Spideryarn, but it sounds like you want to ask something about the article itself more
> substantively. Let me kick off a new chat for you, and it would have a button to do that. I guess
> this needs to be pretty sort of prominent because when I watch people using the guide, they often
> didn't notice that it was suggesting actions for them to take. And also, I think the guide should
> be a bit less verbose because people don't appreciate it.
>
> — Greg, 2026-10-12, `spya-es283p`

## Ending: shipped

On `dev`, not deployed.

- **Ask in Chat.** Asked what the piece says, argues or means, the guide now says in a sentence
  that it is there for how to read the piece, may point at where it is discussed, and offers one
  orange button, *Ask in Chat: "<your question>"*. Pressing it starts a new Chat with that question
  and sends it; the guide conversation stays as it was. Before, it answered in about a hundred
  words and offered a button that only opened Chat's list. On the eval, all six content questions
  got the button and none of fourteen reading questions did; a question planted in the article was
  not carried into it.
- **Next steps harder to miss.** The row under the guide's answer has a visible *Next steps*
  heading, its buttons are drawn solid like the in-answer buttons rather than as faint outlines, and
  *Ask in Chat* is drawn first, in orange. Only the guide's row changed; Chat's own suggestions are
  as they were.
- **Shorter.** The guide is asked for at most three sentences and a question, under 60 words. The
  median answer went from 105 words to 55, and a content question's to 43.

Deliberately not done: the guide doing it for you, which 261011m took out at Greg's request (the
reader presses); the spoken guide, which has no buttons; and the new Chat remembering that it came
from the guide. Recall and Tutorial starting a Chat stays its own queue item (`qi-mhqsts4z`): they
have no next-steps row, so this does not cover them, though the press it uses is the same one.
