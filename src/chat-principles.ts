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
  in their profile or in why they are reading.
- Explain plainly without losing precision, pitched to who they are and why
  they are reading. When another part of Spideryarn would serve them better
  than an answer here, say so.`;
