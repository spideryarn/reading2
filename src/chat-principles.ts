/**
 * **What every conversation about an article is for, once, near the top of
 * each conversation's prompt** — Chat, Learn's Recall, Explore and the guide.
 *
 * > Do we have a system prompt (for Chats) (or something equivalent that all
 * > Chats share)? … We want it to be concise. And probably framed in terms of
 * > broad principles, rather than a detailed list of rules.
 * >
 * > — Greg, 2026-10-19 (`spya-u3yw2a`)
 *
 * Principles, not rules: each line names a stance and leaves the detail to the
 * section that already owns it — `CLAIM_ORIGINS` and `widerWorld` for where a
 * claim came from, `plainWords` for plain words, `PROFILE_RULES` for who is
 * reading, `COMMAND_CHIPS` and the guide's mode buttons for pointing at the
 * rest of the app. A prompt's own rules win where they are more specific, the
 * precedence `plainWords`' core already uses, so Learn may still hold back an
 * answer and the guide may still stop at sixty words.
 *
 * **"Recheck, then hold or revise", not "do not give way".** The plan's first
 * draft said not to give way without a reason; GPT Sol's review (F2) pointed
 * out that teaches stubbornness, and Learn and Explore both say the model may
 * have misread the passage. Sycophancy is agreeing *because* they pushed.
 *
 * The evidence for the first line (help them think, not think for them) is
 * docs/research/261010a-reading-and-learning-evidence/06-cognitive-offloading.md
 * and docs/research/261010a-reading-and-learning-evidence/03-scaffolding-and-desirable-difficulty.md.
 * The plan and its measurement: docs/plans/261020d-principles-every-chat-shares.md.
 *
 * **"Nor that they know its field"** is Greg's, answering q-rwkq2e:
 *
 * > also perhaps a minimal prompt to tell the chats not too assume too much
 * > knowledge, unless the user exhibits it in the chat/profile/why-i'm-reading
 * > (to be on the safe side)?
 * >
 * > — Greg, 2026-10-20 (`spya-p9bhxh`)
 *
 * One clause on the bullet that already held the nearest rule; measured in
 * docs/investigations/261020g-chat-reading-so-far-measured.md (plan 261020ac).
 *
 * **"Nor that they know or remember a person, work, study or term you bring
 * in"** is Greg's too, after an Explore answer about who else had thought
 * about the piece named its sources with no who, what or why:
 *
 * > Like a good teacher tries to sort of anticipate what the reader may or may
 * > not know and doesn't assume that the reader has read everything that's
 * > being referred to. […] even if I'm a neuroscientist reading an article
 * > about neuroscience, I may not have read all the references or whatever
 * > recently, so I might be rusty
 * >
 * > — Greg, 2026-10-23 (`spya-bq9wv5`)
 *
 * How much to say is still the next line's "pitched to who they are". Where
 * the reader has a profile, `PROFILE_RULES` (src/profile.ts) is more specific
 * and wins: "Assume the background they claim. Do not explain what they have
 * told you they already know". That is the likeliest reason the measurement
 * saw no change for experts, against Greg's "even if I'm a neuroscientist";
 * changing it reaches every profile-aware prompt, so it is queued separately
 * (Overseer `qi-jq3tckr5`; GPT Sol's code review, F1). **Concrete on purpose**: "say briefly who
 * or what it is" showed no clear change; "introduce each where you name it, in
 * a few words", with two example openings, roughly halved the bare names for
 * a non-expert reader. Plan and measurement:
 * docs/plans/261024d-chats-give-the-background-for-what-they-bring-in.md and
 * docs/investigations/261024a-chats-give-the-background-measured.md.
 *
 * **"Choose the clearest example or analogy"** is Greg's, after a chat built
 * its analogy from his profile (a code path and a log line, for a CTO):
 *
 * > There may be a simpler or better analogy that doesn't involve my specific
 * > background
 * >
 * > — Greg, 2026-10-24 (`spya-furs26`)
 *
 * Worded so their field is still allowed where it is clearer (GPT Sol's plan
 * review, F2). This sentence alone barely moved it; what did was its echo
 * beside the profile, `withExampleReminder` in src/converse.ts. Plan and
 * measurement: docs/plans/261024v-chat-picks-the-clearest-example-not-the-reader-s-field.md
 * and docs/investigations/261024e-chat-examples-not-the-reader-s-field-measured.md.
 *
 * Which conversation kinds carry it is held by tests/chat-principles.test.ts.
 * Live's spoken prompts do not yet: they were tuned for terseness and can only
 * be measured with the realtime harness (the plan's § Deferred).
 */

export const CHAT_PRINCIPLES_HEADING = "WHAT EVERY CONVERSATION HERE IS FOR";

export const CHAT_PRINCIPLES = `${CHAT_PRINCIPLES_HEADING}

This is the spirit behind the rules below. Where a rule below is more
specific, it wins.

- Leave the reader sharper, not more dependent: understanding, remembering
  and thinking for themselves, and getting there sooner than they would alone.
  Never let talking to you stand in for reading the piece.
- Be candid, not agreeable. Do not flatter them, their ideas or the piece. If
  they have something wrong, say so plainly and kindly, with the reason. Do
  not agree merely because they push back: recheck, then hold or revise your
  answer and say why. Give the author's strongest reading before a criticism.
- Make it clear how you know each thing — the article, a page you found, or
  your own memory or reasoning — and say when you do not know, or the piece
  does not say.
- Do not assume they have read the piece, or the part you are discussing,
  unless they say so; nor that they know its field, unless they show it here,
  in their profile or in why they are reading. Nor that they know or remember
  a person, work, study or term you bring in: like a good teacher, introduce
  each where you name it, in a few words on who or what it is ("the
  philosopher…", "a 2019 survey of…"), and say why it matters here.
- Explain plainly without losing precision, pitched to who they are and why
  they are reading. Choose the clearest example or analogy: their job or field
  can make one clearer, but is not by itself a reason to use it, and a plain
  everyday one often works as well or better. When another part of Spideryarn
  would serve them better than an answer here, say so.`;
